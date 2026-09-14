import { describe, expect, test } from "bun:test";
import {
  applyIgnoreBlock,
  applySafeResolutions,
  countReviewBlock,
  defaultModeForVerdict,
  formatBlockSummary,
  isSafeVerdict,
  needsReview,
  type ReviewBlockItem,
} from "../src/lib/review-blocks";

function item(
  key: number,
  verdict: ReviewBlockItem["verdict"],
  mode: ReviewBlockItem["mode"],
  hasOverride = false,
): ReviewBlockItem<number> {
  return { key, verdict, mode, hasOverride };
}

describe("GATE 10A — review-blocks: classificação de verdict", () => {
  test("isSafeVerdict é true para NEW/UPDATE_EXISTING/EXISTING e false só para POSSIBLE_DUPLICATE", () => {
    expect(isSafeVerdict("NEW")).toBe(true);
    expect(isSafeVerdict("UPDATE_EXISTING")).toBe(true);
    expect(isSafeVerdict("EXISTING")).toBe(true);
    expect(isSafeVerdict("POSSIBLE_DUPLICATE")).toBe(false);
  });

  test("defaultModeForVerdict espelha exatamente a regra de defaultResolution do dedupe", () => {
    expect(defaultModeForVerdict("NEW")).toBe("create");
    expect(defaultModeForVerdict("UPDATE_EXISTING")).toBe("update");
    expect(defaultModeForVerdict("EXISTING")).toBe("skip");
    // POSSIBLE_DUPLICATE nunca decide create/update sozinho.
    expect(defaultModeForVerdict("POSSIBLE_DUPLICATE")).toBe("skip");
  });

  test("possível duplicidade conta como 'requer revisão' até o consultor decidir explicitamente", () => {
    expect(needsReview(item(0, "POSSIBLE_DUPLICATE", "skip", false))).toBe(true);
    // Uma vez que o consultor escolheu manualmente (override), não é mais "pendente".
    expect(needsReview(item(0, "POSSIBLE_DUPLICATE", "create", true))).toBe(false);
    expect(needsReview(item(0, "NEW", "create", false))).toBe(false);
    expect(needsReview(item(0, "UPDATE_EXISTING", "update", false))).toBe(false);
    expect(needsReview(item(0, "EXISTING", "skip", false))).toBe(false);
  });
});

describe("GATE 10A — contagem por bloco", () => {
  test("countReviewBlock soma novas/atualizações/revisão/ignoradas corretamente", () => {
    const items: ReviewBlockItem<number>[] = [
      item(0, "NEW", "create"),
      item(1, "NEW", "create"),
      item(2, "UPDATE_EXISTING", "update"),
      item(3, "POSSIBLE_DUPLICATE", "skip"), // pendente — conta como "para revisar"
      item(4, "EXISTING", "skip"), // já existe — conta como ignorada
      item(5, "NEW", "skip", true), // consultor decidiu ignorar manualmente — ignorada
    ];
    const counts = countReviewBlock(items);
    expect(counts).toEqual({
      total: 6,
      // newCount conta por verdict (NEW), independente do modo escolhido —
      // por isso inclui o item 5, que é NEW mas foi manualmente ignorado.
      newCount: 3,
      updateCount: 1,
      reviewCount: 1,
      ignoredCount: 2,
    });
  });

  test("exemplo do GATE: 8 sugestões · 6 novas · 1 atualização · 1 para revisar", () => {
    const items: ReviewBlockItem<number>[] = [
      ...Array.from({ length: 6 }, (_, i) => item(i, "NEW", "create")),
      item(6, "UPDATE_EXISTING", "update"),
      item(7, "POSSIBLE_DUPLICATE", "skip"),
    ];
    const counts = countReviewBlock(items);
    expect(formatBlockSummary(counts)).toBe("8 sugestões · 6 novas · 1 atualização · 1 para revisar");
  });

  test("formatBlockSummary usa singular corretamente para contagem 1", () => {
    const counts = countReviewBlock([item(0, "NEW", "create")]);
    expect(formatBlockSummary(counts)).toBe("1 sugestão · 1 nova · 0 atualizações · 0 para revisar");
  });
});

describe("GATE 10A — Aplicar sugestões seguras / Aprovar bloco (applySafeResolutions)", () => {
  test("aplica o modo default a itens seguros sem override", () => {
    const items: ReviewBlockItem<number>[] = [
      item(0, "NEW", "create"),
      item(1, "UPDATE_EXISTING", "update"),
      item(2, "EXISTING", "skip"),
    ];
    expect(applySafeResolutions(items)).toEqual({ 0: "create", 1: "update", 2: "skip" });
  });

  test("não sobrescreve override manual já feito pelo consultor", () => {
    const items: ReviewBlockItem<number>[] = [
      // Consultor já escolheu "skip" para um item NEW — não deve virar "create".
      item(0, "NEW", "skip", true),
      // Sem override — este sim deve ganhar o default.
      item(1, "NEW", "create", false),
    ];
    const patch = applySafeResolutions(items);
    expect(patch).toEqual({ 1: "create" });
    expect(patch).not.toHaveProperty("0");
  });

  test("aprovar bloco preserva POSSIBLE_DUPLICATE para revisão — nunca autoaprova", () => {
    const items: ReviewBlockItem<number>[] = [
      item(0, "POSSIBLE_DUPLICATE", "skip", false),
      item(1, "NEW", "create", false),
    ];
    const patch = applySafeResolutions(items);
    // Só o item seguro (NEW) recebe patch; o possível duplicado fica de fora.
    expect(patch).toEqual({ 1: "create" });
    expect(patch).not.toHaveProperty("0");
  });

  test("itens já seguros mas com override diferente do default continuam preservados", () => {
    // Consultor decidiu "create" manualmente para um UPDATE_EXISTING (em vez de update).
    const items: ReviewBlockItem<number>[] = [item(0, "UPDATE_EXISTING", "create", true)];
    expect(applySafeResolutions(items)).toEqual({});
  });

  test("bloco inteiro seguro: patch cobre todos os itens", () => {
    const items: ReviewBlockItem<string>[] = [
      { key: "a", verdict: "NEW", mode: "create", hasOverride: false },
      { key: "b", verdict: "UPDATE_EXISTING", mode: "update", hasOverride: false },
    ];
    expect(applySafeResolutions(items)).toEqual({ a: "create", b: "update" });
  });
});

describe("GATE 10A — Ignorar bloco (applyIgnoreBlock)", () => {
  test("define todos os itens do bloco como skip, mesmo com override manual e POSSIBLE_DUPLICATE", () => {
    const items: ReviewBlockItem<number>[] = [
      item(0, "NEW", "create", true), // override manual — mesmo assim vira skip
      item(1, "POSSIBLE_DUPLICATE", "skip", false),
      item(2, "UPDATE_EXISTING", "update", false),
    ];
    expect(applyIgnoreBlock(items)).toEqual({ 0: "skip", 1: "skip", 2: "skip" });
  });

  test("bloco vazio produz patch vazio", () => {
    expect(applyIgnoreBlock([])).toEqual({});
  });
});
