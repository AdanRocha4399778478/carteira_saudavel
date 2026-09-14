import { describe, expect, test } from "bun:test";
import {
  applyIgnoreBlock,
  applySafeResolutions,
  blockMatchesSnapshot,
  computeBlockStatus,
  countReviewBlock,
  defaultModeForVerdict,
  formatBlockSummary,
  isSafeVerdict,
  needsReview,
  snapshotAfterPatch,
  type BlockDecisionRecord,
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

describe("GATE 10D — feedback visual: reproduz o bug relatado (3 NEW já em default)", () => {
  test("Aprovar bloco em itens já no default (3 NEW → create) reaplica o MESMO patch — por isso os contadores não mudam", () => {
    const items: ReviewBlockItem<number>[] = [
      item(0, "NEW", "create", false),
      item(1, "NEW", "create", false),
      item(2, "NEW", "create", false),
    ];
    const before = countReviewBlock(items);
    const patch = applySafeResolutions(items);
    // O patch É real (não é um no-op silencioso) — mergeSel(setSel, patch) grava no estado.
    expect(patch).toEqual({ 0: "create", 1: "create", 2: "create" });

    // Mas como o modo já era "create", a contagem por classificação (verdict) não muda —
    // exatamente o sintoma relatado: "os contadores não mudam e o usuário não recebe feedback".
    const after = countReviewBlock(items.map((it) => ({ ...it, mode: patch[it.key] ?? it.mode })));
    expect(after).toEqual(before);
  });
});

describe("GATE 10D — snapshot e status visual do bloco", () => {
  test("1. clicar Aprovar bloco aplica as resoluções esperadas (patch correto, mesmo sem mudar o texto exibido)", () => {
    const items: ReviewBlockItem<number>[] = [
      item(0, "NEW", "create", false),
      item(1, "UPDATE_EXISTING", "update", false),
    ];
    const patch = applySafeResolutions(items);
    expect(patch).toEqual({ 0: "create", 1: "update" });
  });

  test("2. estado visual passa para 'approved' logo após Aprovar bloco", () => {
    const items: ReviewBlockItem<number>[] = [item(0, "NEW", "create", false)];
    const patch = applySafeResolutions(items);
    const record: BlockDecisionRecord<number> = {
      decision: "approved",
      snapshot: snapshotAfterPatch(items, patch),
    };
    // O item ainda está exatamente como o snapshot previu → status coerente "approved".
    expect(computeBlockStatus(items, record)).toBe("approved");
  });

  test("3. clicar Ignorar bloco aplica skip em todos os itens do bloco", () => {
    const items: ReviewBlockItem<number>[] = [
      item(0, "NEW", "create", false),
      item(1, "POSSIBLE_DUPLICATE", "skip", false),
      item(2, "UPDATE_EXISTING", "update", true), // até override manual vira skip
    ];
    const patch = applyIgnoreBlock(items);
    expect(patch).toEqual({ 0: "skip", 1: "skip", 2: "skip" });
  });

  test("4. estado visual passa para 'ignored' logo após Ignorar bloco", () => {
    const items: ReviewBlockItem<number>[] = [
      item(0, "NEW", "create", false),
      item(1, "UPDATE_EXISTING", "update", false),
    ];
    const patch = applyIgnoreBlock(items);
    const record: BlockDecisionRecord<number> = {
      decision: "ignored",
      snapshot: snapshotAfterPatch(items, patch),
    };
    // No componente real, o re-render seguinte já reflete o patch aplicado
    // (mergeSel muda contextSel/decisionSel/…, então o `mode` de cada item
    // recalcula). Simulamos isso aqui em vez de comparar contra o array antigo.
    const itemsAfterPatch = items.map((it) => ({ ...it, mode: patch[it.key] ?? it.mode, hasOverride: true }));
    expect(computeBlockStatus(itemsAfterPatch, record)).toBe("ignored");
  });

  test("5. edição manual posterior de UM item derruba o status para 'manual' — nunca mente que continua aprovado", () => {
    const items: ReviewBlockItem<number>[] = [
      item(0, "NEW", "create", false),
      item(1, "NEW", "create", false),
    ];
    const patch = applySafeResolutions(items);
    const record: BlockDecisionRecord<number> = {
      decision: "approved",
      snapshot: snapshotAfterPatch(items, patch),
    };
    expect(computeBlockStatus(items, record)).toBe("approved");

    // Consultor muda manualmente o item 1 para "skip" depois de aprovar o bloco.
    const afterManualEdit = [items[0]!, { ...items[1]!, mode: "skip" as const, hasOverride: true }];
    expect(blockMatchesSnapshot(afterManualEdit, record.snapshot)).toBe(false);
    expect(computeBlockStatus(afterManualEdit, record)).toBe("manual");
  });

  test("5b. se o item editado manualmente voltar a bater com o snapshot, o status volta a ser coerente (não fica preso em 'manual')", () => {
    const items: ReviewBlockItem<number>[] = [item(0, "NEW", "create", false)];
    const patch = applySafeResolutions(items);
    const record: BlockDecisionRecord<number> = {
      decision: "approved",
      snapshot: snapshotAfterPatch(items, patch),
    };
    const editedAway = [{ ...items[0]!, mode: "skip" as const, hasOverride: true }];
    expect(computeBlockStatus(editedAway, record)).toBe("manual");

    const editedBack = [{ ...items[0]!, mode: "create" as const, hasOverride: true }];
    expect(computeBlockStatus(editedBack, record)).toBe("approved");
  });

  test("6. POSSIBLE_DUPLICATE não é aprovado silenciosamente por Aprovar bloco — o snapshot registra o skip default, não create/update", () => {
    const items: ReviewBlockItem<number>[] = [
      item(0, "POSSIBLE_DUPLICATE", "skip", false),
      item(1, "NEW", "create", false),
    ];
    const patch = applySafeResolutions(items);
    expect(patch).not.toHaveProperty("0"); // nunca decide o duplicado sozinho
    const record: BlockDecisionRecord<number> = {
      decision: "approved",
      snapshot: snapshotAfterPatch(items, patch),
    };
    // O snapshot do item 0 é o modo que ele JÁ tinha (skip) — não vira create/update.
    expect(record.snapshot[0]).toBe("skip");
    // Bloco aparece como coerentemente "aprovado" (nenhum item mudou de modo desde a
    // decisão), mas isso não significa que o duplicado foi resolvido — a contagem
    // reviewCount continua > 0 e o badge "Requer revisão" continua visível (ver
    // countReviewBlock/needsReview, testados acima).
    expect(computeBlockStatus(items, record)).toBe("approved");
    expect(needsReview(items[0]!)).toBe(true);
  });

  test("status 'none' quando nenhuma decisão foi tomada ainda", () => {
    const items: ReviewBlockItem<number>[] = [item(0, "NEW", "create", false)];
    expect(computeBlockStatus(items, undefined)).toBe("none");
  });
});
