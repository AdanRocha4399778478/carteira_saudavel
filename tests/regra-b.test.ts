import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isDeadlineBeforeToday,
  isNewDecisionPreMarkedCompleted,
  resolveNewActionStatus,
  resolveNewDecisionStatus,
} from "../src/lib/regra-b";

const TODAY = "2026-06-10";

describe("isDeadlineBeforeToday — exemplos neutros, data de referência injetada", () => {
  test("prazo ontem (2026-06-09) é vencido", () => {
    expect(isDeadlineBeforeToday("2026-06-09", TODAY)).toBe(true);
  });

  test("prazo hoje (2026-06-10) NÃO é vencido", () => {
    expect(isDeadlineBeforeToday("2026-06-10", TODAY)).toBe(false);
  });

  test("prazo amanhã (2026-06-11) NÃO é vencido", () => {
    expect(isDeadlineBeforeToday("2026-06-11", TODAY)).toBe(false);
  });

  test("sem prazo (vazio, null ou undefined) NÃO é vencido", () => {
    expect(isDeadlineBeforeToday("", TODAY)).toBe(false);
    expect(isDeadlineBeforeToday(null, TODAY)).toBe(false);
    expect(isDeadlineBeforeToday(undefined, TODAY)).toBe(false);
  });

  test("prazo em formato inválido NÃO é vencido", () => {
    expect(isDeadlineBeforeToday("amanhã", TODAY)).toBe(false);
    expect(isDeadlineBeforeToday("2026-6-9", TODAY)).toBe(false);
    expect(isDeadlineBeforeToday("10/06/2026", TODAY)).toBe(false);
  });
});

describe("isNewDecisionPreMarkedCompleted — Regra B vale só para decisão (R02, 18/10/2026: ação nunca vem pré-marcada)", () => {
  test("decisão com due_date vencido é pré-marcada (inclusive 'ainda a definir')", () => {
    expect(isNewDecisionPreMarkedCompleted("2026-06-09", TODAY)).toBe(true);
  });

  test("decisão sem due_date nunca é pré-marcada", () => {
    expect(isNewDecisionPreMarkedCompleted(null, TODAY)).toBe(false);
  });
});

describe("resolveNewActionStatus — mapeamento de status de ação nova", () => {
  test("marcada => 'concluída'", () => {
    expect(resolveNewActionStatus(true)).toBe("concluída");
  });

  test("não marcada => padrão de hoje, 'não iniciada'", () => {
    expect(resolveNewActionStatus(false)).toBe("não iniciada");
  });
});

describe("resolveNewDecisionStatus — mapeamento de status de decisão nova", () => {
  test("decisão comum marcada => 'implementada'", () => {
    expect(resolveNewDecisionStatus(true, "Revisar contrato com fornecedor")).toBe("implementada");
  });

  test("decisão 'ainda a definir' (título começa com Definir) marcada => 'implementada', não 'pendente'", () => {
    expect(resolveNewDecisionStatus(true, "Definir o preço do plano")).toBe("implementada");
  });

  test("decisão 'ainda a definir' NÃO marcada => mantém o padrão de hoje, 'pendente'", () => {
    expect(resolveNewDecisionStatus(false, "Definir o preço do plano")).toBe("pendente");
  });

  test("decisão comum NÃO marcada => mantém o padrão de hoje, 'aprovada'", () => {
    expect(resolveNewDecisionStatus(false, "Revisar contrato com fornecedor")).toBe("aprovada");
  });
});

describe("B1 (16/10/2026) — exceção à Regra B para decisão de avaliação (isEvaluation)", () => {
  test("isNewDecisionPreMarkedCompleted: avaliação com prazo vencido NÃO vem pré-marcada (achado real: caso Chammas)", () => {
    expect(isNewDecisionPreMarkedCompleted("2026-06-09", TODAY, true)).toBe(false);
  });

  test("isNewDecisionPreMarkedCompleted: sem isEvaluation, comportamento atual inalterado (regressão)", () => {
    expect(isNewDecisionPreMarkedCompleted("2026-06-09", TODAY, false)).toBe(true);
    expect(isNewDecisionPreMarkedCompleted("2026-06-09", TODAY)).toBe(true);
  });

  test("resolveNewDecisionStatus: avaliação NÃO marcada nasce sempre 'pendente', mesmo com título que não começa com 'Definir'", () => {
    expect(resolveNewDecisionStatus(false, "Revisar contrato com fornecedor", true)).toBe(
      "pendente",
    );
    expect(resolveNewDecisionStatus(false, "Definir o preço do plano", true)).toBe("pendente");
  });

  test("resolveNewDecisionStatus: avaliação marcada 'Concluída' manualmente vira 'implementada'", () => {
    expect(
      resolveNewDecisionStatus(true, "Definir ao final de 60 dias se o papel será mantido", true),
    ).toBe("implementada");
  });

  test("resolveNewDecisionStatus: sem isEvaluation, comportamento atual inalterado (regressão)", () => {
    expect(resolveNewDecisionStatus(false, "Definir o preço do plano", false)).toBe("pendente");
    expect(resolveNewDecisionStatus(false, "Revisar contrato com fornecedor", false)).toBe(
      "aprovada",
    );
    expect(resolveNewDecisionStatus(false, "Definir o preço do plano")).toBe("pendente");
    expect(resolveNewDecisionStatus(false, "Revisar contrato com fornecedor")).toBe("aprovada");
  });
});

describe("GATE REGRA B — leitura de `completed` em applyApprovedAnalysis, por inspeção estática (sem Supabase)", () => {
  const source = readFileSync(resolve(import.meta.dir, "../src/lib/meeting-analysis.ts"), "utf8");

  test("import de resolveNewActionStatus/resolveNewDecisionStatus a partir de ./regra-b", () => {
    expect(source).toContain(
      'import { resolveNewActionStatus, resolveNewDecisionStatus } from "./regra-b";',
    );
  });

  test("status da decisão nova usa resolveNewDecisionStatus(d.completed === true, d.title, d.is_evaluation === true) — só no bloco de criação", () => {
    const createBlockStart = source.indexOf(
      "// create — pode substituir uma decisão anterior sem apagá-la",
    );
    const createBlockEnd = source.indexOf("/* ---------- ações ---------- */");
    expect(createBlockStart).toBeGreaterThan(-1);
    expect(createBlockEnd).toBeGreaterThan(createBlockStart);
    const createBlock = source.slice(createBlockStart, createBlockEnd);
    expect(createBlock).toContain(
      "status: resolveNewDecisionStatus(d.completed === true, d.title, d.is_evaluation === true),",
    );
  });

  test("status da ação nova usa resolveNewActionStatus(a.completed === true) — só no bloco de criação (fora do ramo 'update')", () => {
    const actionsSectionStart = source.indexOf("/* ---------- ações ---------- */");
    const updateBlockEnd = source.indexOf(
      'if (res.mode === "update" && res.targetId) {',
      actionsSectionStart,
    );
    const createBlock = source.slice(
      source.indexOf("const insert = await supabase", updateBlockEnd),
      source.indexOf(".insert({\n        client_id: meeting.client_id,", updateBlockEnd) + 400,
    );
    expect(createBlock).toContain("status: resolveNewActionStatus(a.completed === true),");
  });

  test("ApprovedSelection expõe `completed?: boolean` nos itens de decisions e actions", () => {
    const typeStart = source.indexOf("export type ApprovedSelection = {");
    const typeEnd = source.indexOf("export type ApplyResult = {");
    const typeBlock = source.slice(typeStart, typeEnd);
    const occurrences = typeBlock.split("completed?: boolean;").length - 1;
    expect(occurrences).toBe(2);
  });
});

describe("R02 (18/10/2026) — ação nunca vem pré-marcada como concluída; só a escolha manual conta", () => {
  const dialogSource = readFileSync(
    resolve(import.meta.dir, "../src/components/painel/MeetingAnalysisDialog.tsx"),
    "utf8",
  );

  test("isNewActionPreMarkedCompleted não é mais exportada por regra-b.ts nem importada/usada no diálogo", () => {
    const regraBSource = readFileSync(resolve(import.meta.dir, "../src/lib/regra-b.ts"), "utf8");
    expect(regraBSource).not.toContain("export function isNewActionPreMarkedCompleted");
    expect(dialogSource).not.toContain("import { isNewActionPreMarkedCompleted");
    expect(dialogSource).not.toContain("isNewActionPreMarkedCompleted(");
  });

  test("ação com prazo vencido (resolução 'Criar novo', sem escolha manual) NÃO vem pré-marcada — completed cai direto em false", () => {
    expect(dialogSource).toContain(
      'completed: r.mode === "create" ? (actionCompletedSel[r.key] ?? false) : false,',
    );
  });

  test("marcar a caixa 'Concluída' à mão (actionCompletedSel) continua valendo e sendo gravado", () => {
    expect(dialogSource).toContain("completed={actionCompletedSel[r.key] ?? false}");
    expect(dialogSource).toContain(
      "onCompletedChange={(v) =>\n                            setActionCompletedSel((s) => ({ ...s, [r.key]: v }))\n                          }",
    );
  });

  test("isNewDecisionPreMarkedCompleted continua importada e usada no diálogo — Regra B vale só para decisão", () => {
    expect(dialogSource).toContain(
      'import { isNewDecisionPreMarkedCompleted } from "@/lib/regra-b";',
    );
    expect(dialogSource).toContain("isNewDecisionPreMarkedCompleted(");
  });
});
