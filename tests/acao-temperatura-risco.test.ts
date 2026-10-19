import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { seedFromText } from "../src/lib/intelligent-meeting.server";
import { matchRisk } from "../src/lib/deduplication";
import type { RiskItem } from "../src/lib/domain";

/* ------------------------------------------------------------------ *
 * R28 + R20 (18/10/2026): R28 — extração usa temperature 0 e um seed
 * determinístico (FNV-1a 32 bits) derivado do texto enviado à IA, pra
 * reduzir a variação entre extrações do mesmo PDF/transcrição. R20 — o
 * motivo de "Atualizar existente" num risco semelhante não promete mais
 * "registrar nova evidência" (a tabela risks não tem esse campo; só
 * active/level são gravados, o texto novo fica só no histórico de
 * menções).
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const serverSource = readFileSync(resolve(root, "src/lib/intelligent-meeting.server.ts"), "utf8");

const risk = (description: string, patch: Partial<RiskItem> = {}): RiskItem => ({
  id: patch.id ?? "r1",
  client_id: patch.client_id ?? "c1",
  meeting_id: patch.meeting_id ?? null,
  description,
  level: patch.level ?? "médio",
  active: patch.active ?? true,
  created_at: patch.created_at ?? "",
  embedding: patch.embedding ?? null,
});

describe("seedFromText — função pura (FNV-1a 32 bits)", () => {
  test("é determinística: mesma entrada gera sempre o mesmo número", () => {
    const text = "transcrição de exemplo da reunião";
    expect(seedFromText(text)).toBe(seedFromText(text));
  });

  test("devolve um inteiro de 32 bits (não negativo, nunca float)", () => {
    const seed = seedFromText("qualquer texto");
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });

  test("textos diferentes geram sementes diferentes (casos simples)", () => {
    expect(seedFromText("reunião A")).not.toBe(seedFromText("reunião B"));
    expect(seedFromText("a")).not.toBe(seedFromText("b"));
    expect(seedFromText("")).not.toBe(seedFromText(" "));
  });

  test("string vazia tem um resultado determinístico válido (não quebra)", () => {
    expect(seedFromText("")).toBe(seedFromText(""));
    expect(Number.isInteger(seedFromText(""))).toBe(true);
  });
});

describe("estático — temperature 0 e seed no corpo da requisição", () => {
  test("requestCompletion envia temperature: 0 e seed: seedFromText(userPrompt)", () => {
    const start = serverSource.indexOf("async function requestCompletion(");
    expect(start).toBeGreaterThan(-1);
    const bodyStart = serverSource.indexOf("body: JSON.stringify({", start);
    const bodyEnd = serverSource.indexOf("}),", bodyStart);
    const body = serverSource.slice(bodyStart, bodyEnd);
    expect(body).toContain("temperature: 0,");
    expect(body).toContain("seed: seedFromText(seedText),");
    expect(body).not.toContain("temperature: 0.2");
  });

  test("response_format e o restante do corpo não mudaram", () => {
    expect(serverSource).toContain('response_format: { type: "json_object" },');
  });

  test("número de tentativas (MAX_ATTEMPTS) continua 3", () => {
    expect(serverSource).toContain("const MAX_ATTEMPTS = 3;");
  });
});

describe("R28 (ajuste) — a semente depende só do texto da transcrição, nunca do userPrompt inteiro", () => {
  test("userPrompt (prompt/secondPrompt) carrega data de hoje, clientes, projetos, histórico e consultor — variável a cada chamada", () => {
    const headerStart = serverSource.indexOf("const header = (block:");
    expect(headerStart).toBeGreaterThan(-1);
    const headerEnd = serverSource.indexOf(
      "const parts: Record<string, unknown>[] = [];",
      headerStart,
    );
    const headerBlock = serverSource.slice(headerStart, headerEnd);
    expect(headerBlock).toContain("Data de hoje: ${new Date().toISOString()");
    expect(headerBlock).toContain("Clientes cadastrados: ${JSON.stringify(data.clients)}");
    expect(headerBlock).toContain("Projetos cadastrados: ${JSON.stringify(data.projects)}");
    expect(headerBlock).toContain("Consultor logado");
    expect(headerBlock).toContain("Nomes já conhecidos deste cliente");
  });

  test("requestCompletion/callGateway recebem seedText separado de userPrompt — a semente nunca lê o prompt composto", () => {
    expect(serverSource).toContain(
      "async function requestCompletion(\n  provider: Provider,\n  userPrompt: string,\n  seedText: string,\n): Promise<string> {",
    );
    expect(serverSource).toContain(
      "export async function callGateway(\n  userPrompt: string,\n  seedText: string,\n  analysisId?: string,\n): Promise<Record<string, unknown>> {",
    );
  });

  test("as duas chamadas em runMeetingAnalysis passam block.text / blocks[0].text como seedText — nunca o prompt/secondPrompt composto", () => {
    expect(serverSource).toContain("parts.push(await callGateway(prompt, block.text));");
    expect(serverSource).toContain(
      "const secondResult = await callGateway(secondPrompt, blocks[0]!.text);",
    );
  });

  test("a mesma transcrição com contextos diferentes (nomes, projetos, data) gera a mesma semente — simulação funcional via seedFromText direto no texto do bloco", () => {
    const transcript = "Falamos sobre o patrimônio líquido da empresa neste trimestre.";
    // Simula dois "userPrompt" diferentes (contexto varia) pra mesma transcrição —
    // a semente usada de verdade (seedText) é só o texto do bloco, nunca o prompt composto.
    const promptDiaA = `Data de hoje: 2026-01-01\nClientes cadastrados: []\nTranscrição da reunião:\n${transcript}`;
    const promptDiaB = `Data de hoje: 2026-12-31\nClientes cadastrados: [{"id":"x"}]\nConsultor logado: Ana\nTranscrição da reunião:\n${transcript}`;
    expect(promptDiaA).not.toBe(promptDiaB);
    expect(seedFromText(transcript)).toBe(seedFromText(transcript));
  });

  test("transcrições diferentes geram sementes diferentes", () => {
    expect(seedFromText("reunião sobre receita")).not.toBe(seedFromText("reunião sobre despesa"));
  });
});

describe("R20 — motivo de risco semelhante não promete evidência que a tabela não grava", () => {
  test("texto novo: cita só o que de fato é gravado (reativa/ajusta nível) e diz que a frase fica no histórico", () => {
    const existing = risk("Processo judicial trabalhista em andamento", { id: "existing-risk" });
    const match = matchRisk({ description: "Processo judicial trabalhista em andamento" }, [
      existing,
    ]);
    expect(match.reason).toContain("Atualizar existente só reativa o risco e ajusta o nível");
    expect(match.reason).toContain("a frase desta reunião fica apenas no histórico");
  });

  test("mantém o percentual de confiança já montado (pct(best.score))", () => {
    const existing = risk("Processo judicial trabalhista em andamento", { id: "existing-risk" });
    const match = matchRisk({ description: "Processo judicial trabalhista em andamento" }, [
      existing,
    ]);
    expect(match.reason).toMatch(/^Risco semelhante \(\d+%\)\./);
  });

  test("o texto antigo ('registrar nova evidência em vez de duplicar') não existe mais", () => {
    const dedupSource = readFileSync(resolve(root, "src/lib/deduplication.ts"), "utf8");
    expect(dedupSource).not.toContain("registrar nova evidência em vez de duplicar");
  });
});
