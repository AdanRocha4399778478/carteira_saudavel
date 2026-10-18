import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Backlog B27B (18/10/2026), regra do consultor: "Atualizar existente" em
 * decisão MANTÉM o título existente — só descrição, motivo, responsável e
 * prazo atualizam (quando presentes). Em ação, a descrição também nunca é
 * sobrescrita; o texto novo continua acumulando no histórico de evidência
 * (comportamento já existente, só exibido de outra forma no preview — ver
 * tests/meeting-analysis-comparison-panel.test.ts). Teste estático, no
 * padrão de tests/meeting-chronology-guard.test.ts.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const source = readFileSync(resolve(root, "src/lib/meeting-analysis.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("applyApprovedAnalysis — patch de 'Atualizar existente' de decisão não inclui title", () => {
  const start = source.indexOf("/* ---------- decisões ---------- */");
  const end = source.indexOf("/* ---------- ações ---------- */");
  const decisionBlock = source.slice(start, end);

  test("o bloco de decisões foi localizado", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  test("o patch de atualização começa vazio ({}), não mais com { title: d.title }", () => {
    expect(decisionBlock).toContain("const patch: Record<string, unknown> = {};");
    expect(decisionBlock).not.toContain("{ title: d.title }");
  });

  test("title nunca é escrito no patch de atualização de decisão", () => {
    expect(decisionBlock).not.toMatch(/patch\["title"\]/);
  });

  test("description, reason, owner, due_date e embedding continuam condicionais (só quando presentes)", () => {
    expect(decisionBlock).toContain('if (d.description) patch["description"] = d.description;');
    expect(decisionBlock).toContain('if (d.reason) patch["reason"] = d.reason;');
    expect(decisionBlock).toContain('if (d.owner) patch["owner"] = d.owner;');
    expect(decisionBlock).toContain('if (d.due_date) patch["due_date"] = d.due_date;');
    expect(decisionBlock).toContain('if (d.embedding) patch["embedding"] = d.embedding;');
  });
});

describe("applyApprovedAnalysis — patch de ação continua sem sobrescrever description; evidência continua acumulando", () => {
  const start = source.indexOf("/* ---------- ações ---------- */");
  const end = source.indexOf("/* ---------- riscos ---------- */");
  const actionBlock = source.slice(start, end);

  test("description nunca é escrita no patch de atualização de ação", () => {
    expect(actionBlock).not.toMatch(/patch\["description"\]/);
  });

  test("evidence é sempre a concatenação da evidência anterior com o texto novo — nunca uma troca simples", () => {
    expect(actionBlock).toContain(
      'patch["evidence"] = [previousEvidence, note].filter(Boolean).join("\\n");',
    );
    expect(actionBlock).not.toMatch(/patch\["evidence"\]\s*=\s*a\.(evidence|description);/);
  });
});

describe("applyApprovedAnalysis — atualização com patch vazio não chama o banco (B27B, correção 2)", () => {
  const start = source.indexOf("/* ---------- decisões ---------- */");
  const end = source.indexOf("/* ---------- ações ---------- */");
  const decisionBlock = source.slice(start, end);

  test("decisão: o update só é chamado quando o patch tem pelo menos uma chave", () => {
    expect(decisionBlock).toContain("if (Object.keys(patch).length > 0) {");
    const guardIdx = decisionBlock.indexOf("if (Object.keys(patch).length > 0) {");
    const guardedCall = decisionBlock.slice(
      guardIdx,
      decisionBlock.indexOf("result.updated += 1;"),
    );
    expect(guardedCall).toContain('.from("decisions")');
    expect(guardedCall).toContain(".update(patch as never)");
  });

  test("decisão: result.updated soma 1 independentemente de o patch ter sido vazio ou não (fora do guard)", () => {
    const guardIdx = decisionBlock.indexOf("if (Object.keys(patch).length > 0) {");
    const afterGuard = decisionBlock.slice(guardIdx);
    const guardEnd = afterGuard.indexOf("\n      }\n");
    const afterGuardClose = afterGuard.slice(guardEnd);
    expect(afterGuardClose).toContain("result.updated += 1;");
  });

  test("decisão: nenhum throw fora do bloco guardado (patch vazio nunca lança erro)", () => {
    const guardIdx = decisionBlock.indexOf("if (Object.keys(patch).length > 0) {");
    const beforeGuard = decisionBlock.slice(0, guardIdx);
    // O guard em si é a última coisa antes do push de result.updated/mentions —
    // nada entre a montagem do patch e o guard pode lançar.
    expect(beforeGuard.slice(beforeGuard.lastIndexOf("const patch"))).not.toContain("throw");
  });

  test("ação e risco não precisaram do mesmo guard — o patch deles nunca fica vazio (evidence/active são sempre setados)", () => {
    const actionStart = source.indexOf("/* ---------- ações ---------- */");
    const actionEnd = source.indexOf("/* ---------- riscos ---------- */");
    const actionBlock2 = source.slice(actionStart, actionEnd);
    expect(actionBlock2).toContain('patch["evidence"] =');
    expect(actionBlock2).not.toContain("Object.keys(patch).length > 0");

    const riskStart = actionEnd;
    const riskEnd = source.indexOf("/* ---------- oportunidades ---------- */");
    const riskBlock = source.slice(riskStart, riskEnd);
    expect(riskBlock).toContain("const patch: Record<string, unknown> = { active:");
    expect(riskBlock).not.toContain("Object.keys(patch).length > 0");
  });

  test("oportunidade já tinha esse guard antes do B27B — continua intacto", () => {
    const oppStart = source.indexOf("/* ---------- oportunidades ---------- */");
    const oppBlock = source.slice(oppStart);
    expect(oppBlock).toContain("if (Object.keys(patch).length > 0) {");
  });
});
