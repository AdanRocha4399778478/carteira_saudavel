import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatIndicatorSummary,
  summarizeIndicatorItems,
  type IndicatorItemsSummary,
} from "../src/lib/indicator-approval";
import type { ApplyResult, ApprovedIndicatorItem } from "../src/lib/meeting-analysis";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate F (18/10/2026): resumo
 * próprio dos indicadores sugeridos no rodapé do preview (NUNCA entra em
 * countReviewBlock) e aviso pós-aprovação citando indicadores
 * criados/pontos adicionados/pontos repetidos ignorados. summarizeIndicatorItems
 * e formatIndicatorSummary são puras e exportadas — testadas direto.
 * formatApplyResultMessage NÃO é exportada (MeetingAnalysisDialog.tsx) —
 * seguindo o padrão já usado em tests/meeting-analysis-review-ux.test.ts
 * (GATE B27A), reproduzida aqui com o corpo ATUAL (pós Gate F) e também
 * confirmada por inspeção estática do arquivo real.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const dialogSource = readFileSync(
  resolve(root, "src/components/painel/MeetingAnalysisDialog.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

function item(patch: Partial<ApprovedIndicatorItem> = {}): ApprovedIndicatorItem {
  return {
    action: patch.action ?? "create",
    target_indicator_id: patch.target_indicator_id ?? null,
    name: patch.name ?? "Receita",
    kind: patch.kind ?? "valor",
    unit: patch.unit ?? "",
    direction: patch.direction ?? "maior_melhor",
    value: patch.value === undefined ? 100 : patch.value,
    baseline_value: patch.baseline_value ?? null,
    basis: patch.basis ?? "medido",
    measured_at: patch.measured_at ?? "",
    evidence: patch.evidence ?? "",
  };
}

describe("summarizeIndicatorItems — cada item cai em exatamente uma categoria", () => {
  test("lista vazia: todas as categorias zero", () => {
    expect(summarizeIndicatorItems([])).toEqual({
      toCreate: 0,
      toAttach: 0,
      ignored: 0,
      toResolve: 0,
    });
  });

  test("a soma das categorias é sempre igual ao total de itens", () => {
    const items = [
      item({ action: "create" }),
      item({ action: "attach", target_indicator_id: "ind-1" }),
      item({ action: "skip" }),
      item({ action: "create", direction: "" }), // inválido: toResolve
    ];
    const s = summarizeIndicatorItems(items);
    expect(s.toCreate + s.toAttach + s.ignored + s.toResolve).toBe(items.length);
  });

  test("ignorado (action 'skip') nunca conta como toResolve, mesmo com todos os outros campos inválidos", () => {
    const s = summarizeIndicatorItems([
      item({ action: "skip", value: null, basis: "", direction: "" }),
    ]);
    expect(s).toEqual({ toCreate: 0, toAttach: 0, ignored: 1, toResolve: 0 });
  });

  test("item inválido (não ignorado) conta como toResolve, nunca como toCreate/toAttach", () => {
    const s = summarizeIndicatorItems([item({ action: "create", direction: "" })]);
    expect(s).toEqual({ toCreate: 0, toAttach: 0, ignored: 0, toResolve: 1 });
  });

  test("criar válido conta em toCreate", () => {
    const s = summarizeIndicatorItems([item({ action: "create" })]);
    expect(s).toEqual({ toCreate: 1, toAttach: 0, ignored: 0, toResolve: 0 });
  });

  test("anexar válido conta em toAttach", () => {
    const s = summarizeIndicatorItems([item({ action: "attach", target_indicator_id: "ind-1" })]);
    expect(s).toEqual({ toCreate: 0, toAttach: 1, ignored: 0, toResolve: 0 });
  });

  test("mistura de categorias simultaneamente", () => {
    const s = summarizeIndicatorItems([
      item({ action: "create" }),
      item({ action: "attach", target_indicator_id: "ind-1" }),
      item({ action: "attach", target_indicator_id: "ind-2" }),
      item({ action: "skip" }),
      item({ action: "skip" }),
      item({ action: "skip" }),
      item({ action: "create", basis: "" }),
    ]);
    expect(s).toEqual({ toCreate: 1, toAttach: 2, ignored: 3, toResolve: 1 });
  });
});

describe("formatIndicatorSummary — texto fixo, sem singular/plural", () => {
  test("lista vazia (todas as categorias zero) devolve string vazia", () => {
    expect(formatIndicatorSummary({ toCreate: 0, toAttach: 0, ignored: 0, toResolve: 0 })).toBe("");
  });

  test("texto com os quatro números, na ordem criar/anexar/ignorados/resolver", () => {
    const summary: IndicatorItemsSummary = { toCreate: 1, toAttach: 0, ignored: 0, toResolve: 0 };
    expect(formatIndicatorSummary(summary)).toBe(
      "Indicadores: 1 a criar · 0 a anexar · 0 ignorados · 0 a resolver",
    );
  });

  test("mesmo com só uma categoria > 0, não devolve string vazia", () => {
    expect(formatIndicatorSummary({ toCreate: 0, toAttach: 0, ignored: 1, toResolve: 0 })).not.toBe(
      "",
    );
  });
});

/**
 * Reprodução do corpo ATUAL de formatApplyResultMessage (pós Gate F) —
 * mesmo padrão de tests/meeting-analysis-review-ux.test.ts (GATE B27A).
 * A paridade com o arquivo real é confirmada pelos testes estáticos
 * abaixo.
 */
function formatApplyResultMessage(r: ApplyResult): string {
  if (r.alreadyApplied) return "Esta análise já havia sido aplicada — nada foi duplicado.";
  const created = r.context + r.decisions + r.actions + r.risks + r.opportunities;
  const parts = [`${created} criados`, `${r.updated} atualizados`, `${r.skipped} ignorados`];
  if (r.blockedByChronology > 0) parts.push(`${r.blockedByChronology} bloqueados por cronologia`);
  const base = `Reunião aprovada: ${parts.join(", ")}.`;

  const indicatorParts: string[] = [];
  if (r.indicatorsCreated > 0) {
    indicatorParts.push(
      `${r.indicatorsCreated} ${r.indicatorsCreated === 1 ? "indicador criado" : "indicadores criados"}`,
    );
  }
  if (r.indicatorPointsAdded > 0) {
    indicatorParts.push(
      `${r.indicatorPointsAdded} ${r.indicatorPointsAdded === 1 ? "ponto adicionado" : "pontos adicionados"}`,
    );
  }
  if (r.indicatorPointsSkipped > 0) {
    indicatorParts.push(
      `${r.indicatorPointsSkipped} ${
        r.indicatorPointsSkipped === 1 ? "ponto repetido ignorado" : "pontos repetidos ignorados"
      }`,
    );
  }
  if (indicatorParts.length === 0) return base;

  return `${base} ${indicatorParts.join(", ")}.`;
}

function result(patch: Partial<ApplyResult> = {}): ApplyResult {
  return {
    context: 0,
    decisions: 0,
    actions: 0,
    risks: 0,
    opportunities: 0,
    updated: 0,
    skipped: 0,
    alreadyApplied: false,
    blockedByChronology: 0,
    indicatorsCreated: 0,
    indicatorPointsAdded: 0,
    indicatorPointsSkipped: 0,
    ...patch,
  };
}

describe("formatApplyResultMessage — com e sem indicadores", () => {
  test("sem indicadores: mensagem IDÊNTICA à de antes do Gate F", () => {
    expect(formatApplyResultMessage(result({ decisions: 22, updated: 3, skipped: 3 }))).toBe(
      "Reunião aprovada: 22 criados, 3 atualizados, 3 ignorados.",
    );
  });

  test("com indicador criado e ponto adicionado: acrescenta a frase, singular correto", () => {
    expect(
      formatApplyResultMessage(
        result({ decisions: 1, indicatorsCreated: 1, indicatorPointsAdded: 1 }),
      ),
    ).toBe(
      "Reunião aprovada: 1 criados, 0 atualizados, 0 ignorados. 1 indicador criado, 1 ponto adicionado.",
    );
  });

  test("só pontos repetidos ignorados (sem criar/adicionar): acrescenta só essa categoria", () => {
    expect(formatApplyResultMessage(result({ indicatorPointsSkipped: 1 }))).toBe(
      "Reunião aprovada: 0 criados, 0 atualizados, 0 ignorados. 1 ponto repetido ignorado.",
    );
  });

  test("exemplo do backlog: 2 pontos adicionados e 1 ponto repetido ignorado, plural correto", () => {
    expect(
      formatApplyResultMessage(result({ indicatorPointsAdded: 2, indicatorPointsSkipped: 1 })),
    ).toBe(
      "Reunião aprovada: 0 criados, 0 atualizados, 0 ignorados. 2 pontos adicionados, 1 ponto repetido ignorado.",
    );
  });

  test("alreadyApplied continua retornando a mensagem fixa, sem mencionar indicadores", () => {
    expect(formatApplyResultMessage(result({ alreadyApplied: true, indicatorsCreated: 5 }))).toBe(
      "Esta análise já havia sido aplicada — nada foi duplicado.",
    );
  });
});

describe("estático — resumo de indicadores no rodapé, sem tocar countReviewBlock nem 'Será aplicado:'", () => {
  test("a linha de resumo vem logo depois do bloco 'Será aplicado:' e antes de 'total === 0'", () => {
    const footerIdx = dialogSource.indexOf("Será aplicado:");
    expect(footerIdx).toBeGreaterThan(-1);
    const footerBlockEnd = dialogSource.indexOf(")}", footerIdx);
    const summaryIdx = dialogSource.indexOf(
      "(analysis?.indicators ?? []).length > 0 &&",
      footerBlockEnd,
    );
    const zeroTotalIdx = dialogSource.indexOf("{total === 0 &&", footerBlockEnd);
    expect(summaryIdx).toBeGreaterThan(footerBlockEnd);
    expect(summaryIdx).toBeLessThan(zeroTotalIdx);
  });

  test("a linha de resumo só aparece quando há sugestões (guard em analysis?.indicators)", () => {
    expect(dialogSource).toContain(
      '{(analysis?.indicators ?? []).length > 0 && (\n                  <p className="text-xs text-muted-foreground">\n                    {formatIndicatorSummary(summarizeIndicatorItems(approvedIndicatorItems))}',
    );
  });

  test("o texto 'Será aplicado:' e seus contadores continuam EXATAMENTE como antes", () => {
    expect(dialogSource).toContain(
      'Será aplicado: {overallCounts.newCount} novo(s) · {overallCounts.updateCount}{" "}\n                    atualização(ões) · {overallCounts.ignoredCount} ignorado(s) · {overallCounts.reviewCount}{" "}\n                    para revisar',
    );
  });

  test("countReviewBlock não ganhou nenhuma chamada nova envolvendo indicadores", () => {
    const hasIndicatorCountReview = dialogSource
      .split("\n")
      .some(
        (line) => line.includes("countReviewBlock") && line.toLowerCase().includes("indicator"),
      );
    expect(hasIndicatorCountReview).toBe(false);
  });

  test("formatApplyResultMessage real acrescenta os campos de indicador só quando > 0", () => {
    const start = dialogSource.indexOf("function formatApplyResultMessage(");
    const end = dialogSource.indexOf("\nfunction ClassificationBadge", start);
    const fn = dialogSource.slice(start, end);
    expect(fn).toContain("r.indicatorsCreated > 0");
    expect(fn).toContain("r.indicatorPointsAdded > 0");
    expect(fn).toContain("r.indicatorPointsSkipped > 0");
    expect(fn).toContain("indicador criado");
    expect(fn).toContain("ponto adicionado");
    expect(fn).toContain("ponto repetido ignorado");
  });
});
