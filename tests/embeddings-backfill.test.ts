import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BACKFILL_TABLES,
  buildDryRunReport,
  buildEligibleCandidates,
  chunkCandidates,
  emptyCommitResult,
  isBackfillTable,
  summarizeTable,
  sumCommitResults,
  textFieldFor,
  type BackfillTable,
} from "../src/lib/embeddings-backfill";

/* ------------------------------------------------------------------ *
 * GATE 8B — backfill controlado de embeddings históricos.
 * ------------------------------------------------------------------ */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
}

const backfillPure = source("src/lib/embeddings-backfill.ts");
const backfillServer = source("src/lib/embeddings-backfill.server.ts");
const backfillFunctions = source("src/lib/embeddings-backfill.functions.ts");
const embeddingsServer = source("src/lib/embeddings.server.ts");
const deduplication = source("src/lib/deduplication.ts");
const meetingAnalysis = source("src/lib/meeting-analysis.ts");

describe("GATE 8B — texto-fonte por tabela (4, 5, 6, 7)", () => {
  test("actions usa description", () => {
    expect(textFieldFor("actions")).toBe("description");
  });
  test("risks usa description", () => {
    expect(textFieldFor("risks")).toBe("description");
  });
  test("decisions usa title (mesmo campo de intelligent-meeting.server.ts, não description)", () => {
    expect(textFieldFor("decisions")).toBe("title");
  });
  test("opportunities usa description", () => {
    expect(textFieldFor("opportunities")).toBe("description");
  });
});

describe("GATE 8B — elegibilidade (2, 3)", () => {
  test("linhas com texto válido viram candidatos elegíveis", () => {
    const { candidates, invalidCount } = buildEligibleCandidates("actions", [
      { id: "a1", description: "Fazer X" },
      { id: "a2", description: "Fazer Y" },
    ]);
    expect(candidates).toEqual([
      { id: "a1", text: "Fazer X" },
      { id: "a2", text: "Fazer Y" },
    ]);
    expect(invalidCount).toBe(0);
  });

  test("linha com texto vazio/whitespace não vira candidato", () => {
    const { candidates, invalidCount } = buildEligibleCandidates("risks", [
      { id: "r1", description: "  " },
      { id: "r2", description: "Risco real" },
      { id: "r3", description: "" },
    ]);
    expect(candidates).toEqual([{ id: "r2", text: "Risco real" }]);
    expect(invalidCount).toBe(2);
  });

  test("elegibilidade real vem só de linhas com embedding IS NULL — a query em fetchEligible já filtra isso no banco", () => {
    expect(backfillServer).toMatch(/\.is\("embedding", null\)/);
    // A função de elegibilidade nunca recebe/considera um campo "embedding" nas linhas — quem decide é o WHERE do SELECT.
    expect(backfillPure).not.toMatch(/row\["embedding"\]/);
  });

  test("item que já tem embedding nunca aparece nos candidatos (simulação de uma segunda execução)", () => {
    // Simula: na 1ª execução, 3 elegíveis; depois de preencher 2, uma 2ª leitura já não traria mais essas 2 linhas.
    const firstRun = buildEligibleCandidates("opportunities", [
      { id: "o1", description: "Oportunidade 1" },
      { id: "o2", description: "Oportunidade 2" },
      { id: "o3", description: "Oportunidade 3" },
    ]);
    expect(firstRun.candidates.length).toBe(3);
    const secondRun = buildEligibleCandidates("opportunities", [{ id: "o3", description: "Oportunidade 3" }]);
    expect(secondRun.candidates.length).toBe(1);
  });
});

describe("GATE 8B — lote (8)", () => {
  test("chunkCandidates respeita o tamanho do lote", () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const chunks = chunkCandidates(items, 96);
    expect(chunks.length).toBe(3);
    expect(chunks[0]?.length).toBe(96);
    expect(chunks[1]?.length).toBe(96);
    expect(chunks[2]?.length).toBe(8);
  });

  test("lista vazia não gera lote nenhum", () => {
    expect(chunkCandidates([], 96)).toEqual([]);
  });

  test("backfillTable usa getEmbeddings em lote (reaproveita embeddings.server.ts, não chama a API item a item)", () => {
    expect(backfillServer).toMatch(/getEmbeddings\(batch\.map/);
    expect(backfillServer).toContain('import { getEmbeddings } from "@/lib/embeddings.server"');
  });
});

describe("GATE 8B — erro parcial não aborta o backfill (9)", () => {
  test("o loop por item usa continue em erro/falha, nunca lança/aborta o lote inteiro", () => {
    const loopBody = backfillServer.slice(
      backfillServer.indexOf("for (let i = 0; i < batch.length; i++)"),
      backfillServer.indexOf("return result;"),
    );
    expect(loopBody).toContain("result.errors++");
    expect(loopBody).toContain("continue;");
    expect(loopBody).not.toMatch(/throw new Error/);
  });
});

describe("GATE 8B — UPDATE toca somente embedding e nunca sobrescreve (10, 15)", () => {
  test("o patch do UPDATE só contém o campo embedding", () => {
    expect(backfillServer).toMatch(/\.update\(\{ embedding: vector \} as never\)/);
  });

  test("o UPDATE tem WHERE id = ... AND embedding IS NULL — nunca sobrescreve um embedding já gravado", () => {
    const updateBlock = backfillServer.slice(
      backfillServer.indexOf(".update({ embedding: vector }"),
      backfillServer.indexOf(".select(\"id\");") + 20,
    );
    expect(updateBlock).toContain('.eq("id", candidate.id)');
    expect(updateBlock).toContain('.is("embedding", null)');
  });

  test("rerun após commit é idempotente: 0 candidatos elegíveis quando não sobram linhas com embedding null", () => {
    const rerun = buildEligibleCandidates("decisions", []);
    expect(rerun.candidates).toEqual([]);
    expect(buildDryRunReport({
      actions: summarizeTable([], 0, 96),
      risks: summarizeTable([], 0, 96),
      decisions: summarizeTable(rerun.candidates, 0, 96),
      opportunities: summarizeTable([], 0, 96),
    }).total_eligible).toBe(0);
  });
});

describe("GATE 8B — admin obrigatório em dry-run e commit (11, 12)", () => {
  test("dryRunEmbeddingsBackfill chama requireAdmin antes de qualquer leitura", () => {
    const fn = backfillServer.slice(
      backfillServer.indexOf("export async function dryRunEmbeddingsBackfill"),
      backfillServer.indexOf("export async function dryRunEmbeddingsBackfill") + 400,
    );
    const adminIdx = fn.indexOf("requireAdmin(supabase)");
    const fetchIdx = fn.indexOf("fetchEligible(supabase");
    expect(adminIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(adminIdx).toBeLessThan(fetchIdx);
  });

  test("commitEmbeddingsBackfill chama requireAdmin antes de qualquer backfillTable", () => {
    const fn = backfillServer.slice(
      backfillServer.indexOf("export async function commitEmbeddingsBackfill"),
    );
    const adminIdx = fn.indexOf("requireAdmin(supabase)");
    const tableIdx = fn.indexOf("backfillTable(supabase");
    expect(adminIdx).toBeGreaterThan(-1);
    expect(tableIdx).toBeGreaterThan(-1);
    expect(adminIdx).toBeLessThan(tableIdx);
  });

  test("requireAdmin reutiliza o RPC is_admin() já existente no banco — não reimplementa checagem de papel", () => {
    expect(backfillServer).toContain('supabase.rpc("is_admin")');
    expect(backfillServer).not.toContain("user_roles");
  });

  test("requireAdmin lança quando data !== true (não autenticado ou não-admin)", () => {
    expect(backfillServer).toMatch(/data !== true/);
  });
});

describe("GATE 8B — sem service role, sem chave exposta, sem tabela arbitrária vinda do cliente (5, 13, 9-seg)", () => {
  test("nenhum arquivo do GATE 8B referencia service role", () => {
    expect(backfillServer).not.toMatch(/service_role/i);
    expect(backfillFunctions).not.toMatch(/service_role/i);
    expect(backfillPure).not.toMatch(/service_role/i);
  });

  test("nenhum arquivo do GATE 8B referencia OPENAI_API_KEY diretamente (só embeddings.server.ts lida com a chave)", () => {
    expect(backfillServer).not.toMatch(/OPENAI_API_KEY/);
    expect(backfillFunctions).not.toMatch(/OPENAI_API_KEY/);
  });

  test("a whitelist de tabelas é fixa no servidor — o input do cliente não tem campo table/tables", () => {
    expect(backfillFunctions).toMatch(/z\.object\(\{\s*mode: z\.enum\(\["dry-run", "commit"\]\)\s*\}\)/);
    expect(backfillFunctions).not.toMatch(/table/i);
  });

  test("project_context nunca participa do backfill", () => {
    expect(BACKFILL_TABLES).not.toContain("project_context" as BackfillTable);
    expect(backfillServer).not.toContain("project_context");
    expect(backfillPure).not.toContain("project_context");
    expect(backfillFunctions).not.toContain("project_context");
  });

  test("isBackfillTable só aceita as 4 tabelas da whitelist", () => {
    expect(isBackfillTable("actions")).toBe(true);
    expect(isBackfillTable("risks")).toBe(true);
    expect(isBackfillTable("decisions")).toBe(true);
    expect(isBackfillTable("opportunities")).toBe(true);
    expect(isBackfillTable("project_context")).toBe(false);
    expect(isBackfillTable("profiles")).toBe(false);
    expect(isBackfillTable("'; drop table actions; --")).toBe(false);
  });
});

describe("GATE 8B — retorno nunca contém o vetor completo (14)", () => {
  test("DryRunReport/CommitReport só carregam contagens, nunca embeddings/vetores", () => {
    expect(backfillPure).not.toMatch(/embedding:\s*number\[\]/);
    expect(backfillPure).not.toMatch(/vector:\s*number\[\]/);
  });

  test("dry-run real não imprime embeddings nem a chave da OpenAI", () => {
    const dryRun = buildDryRunReport({
      actions: summarizeTable([{ id: "a1", text: "x" }], 0, 96),
      risks: summarizeTable([], 0, 96),
      decisions: summarizeTable([], 0, 96),
      opportunities: summarizeTable([], 0, 96),
    });
    const json = JSON.stringify(dryRun);
    expect(json).not.toContain("embedding");
    expect(json).not.toContain("sk-");
  });
});

describe("GATE 8B — agregação de resultados", () => {
  test("sumCommitResults soma corretamente todas as tabelas", () => {
    const total = sumCommitResults([
      { eligible: 16, processed: 16, updated: 15, skipped: 1, errors: 0 },
      { eligible: 7, processed: 7, updated: 7, skipped: 0, errors: 0 },
      { eligible: 14, processed: 14, updated: 13, skipped: 0, errors: 1 },
      { eligible: 5, processed: 5, updated: 5, skipped: 0, errors: 0 },
    ]);
    expect(total).toEqual({ eligible: 42, processed: 42, updated: 40, skipped: 1, errors: 1 });
  });

  test("emptyCommitResult começa zerado", () => {
    expect(emptyCommitResult()).toEqual({ eligible: 0, processed: 0, updated: 0, skipped: 0, errors: 0 });
  });

  test("buildDryRunReport soma total_eligible das 4 tabelas e writes é sempre 0", () => {
    const report = buildDryRunReport({
      actions: summarizeTable(Array.from({ length: 16 }, (_, i) => ({ id: String(i), text: "x" })), 0, 96),
      risks: summarizeTable(Array.from({ length: 7 }, (_, i) => ({ id: String(i), text: "x" })), 0, 96),
      decisions: summarizeTable(Array.from({ length: 14 }, (_, i) => ({ id: String(i), text: "x" })), 0, 96),
      opportunities: summarizeTable(Array.from({ length: 5 }, (_, i) => ({ id: String(i), text: "x" })), 0, 96),
    });
    expect(report.total_eligible).toBe(42);
    expect(report.writes).toBe(0);
    expect(report.mode).toBe("dry-run");
  });
});

describe("GATE 8B — dry-run nunca escreve (1)", () => {
  test("dryRunEmbeddingsBackfill não chama update/insert em nenhum lugar do seu corpo", () => {
    const fn = backfillServer.slice(
      backfillServer.indexOf("export async function dryRunEmbeddingsBackfill"),
      backfillServer.indexOf("export async function dryRunEmbeddingsBackfill") + 400,
    );
    expect(fn).not.toContain(".update(");
    expect(fn).not.toContain(".insert(");
  });
});

describe("GATE 8B — nenhuma alteração em dedupe/thresholds/matchers (16)", () => {
  test("símbolos do GATE 8B não vazam para deduplication.ts, embeddings.server.ts ou meeting-analysis.ts", () => {
    for (const forbidden of [
      "BackfillTable",
      "runEmbeddingsBackfill",
      "dryRunEmbeddingsBackfill",
      "commitEmbeddingsBackfill",
      "embeddings-backfill",
    ]) {
      expect(deduplication).not.toContain(forbidden);
      expect(embeddingsServer).not.toContain(forbidden);
      expect(meetingAnalysis).not.toContain(forbidden);
    }
  });

  test("embeddings.server.ts continua com a mesma assinatura pública getEmbeddings(texts) — não foi tocado para o backfill", () => {
    expect(embeddingsServer).toContain("export async function getEmbeddings(texts: string[])");
  });
});
