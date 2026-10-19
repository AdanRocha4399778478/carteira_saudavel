import { describe, expect, test } from "bun:test";
import {
  applyIndicatorEdit,
  blockingIndicatorCount,
  buildApprovedIndicators,
  defaultIndicatorDraft,
  type IndicatorDraft,
} from "../src/lib/indicator-approval";
import type {
  ExistingIndicatorForMatch,
  IndicatorSuggestionPlan,
} from "../src/lib/indicator-match";
import type { IndicatorSuggestion } from "../src/lib/meeting-analysis";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate C (18/10/2026): rascunho
 * editável de uma sugestão de indicador até virar ApprovedIndicatorItem
 * (Gate D). Funções puras, sem I/O. blockingIndicatorCount reaproveita
 * validateApprovedIndicator (Gate D) — não reinventa a regra aqui.
 * ------------------------------------------------------------------ */

function suggestion(patch: Partial<IndicatorSuggestion> = {}): IndicatorSuggestion {
  return {
    name: patch.name ?? "Receita",
    kind: patch.kind ?? "valor",
    unit: patch.unit ?? "",
    direction: patch.direction ?? "maior_melhor",
    value: patch.value === undefined ? 100 : patch.value,
    baseline_value: patch.baseline_value ?? null,
    basis: patch.basis ?? "medido",
    measured_at: patch.measured_at ?? "",
    evidence: patch.evidence ?? "falamos que a receita foi 100",
    classification: patch.classification ?? "fact",
  };
}

function existing(patch: Partial<ExistingIndicatorForMatch> = {}): ExistingIndicatorForMatch {
  return {
    id: patch.id ?? "ind-1",
    name: patch.name ?? "Receita",
    kind: patch.kind ?? "valor",
    direction: patch.direction ?? "maior_melhor",
  };
}

function plan(patch: Partial<IndicatorSuggestionPlan> = {}): IndicatorSuggestionPlan {
  return {
    action: patch.action ?? "create",
    target: patch.target ?? null,
    ambiguous: patch.ambiguous ?? false,
    needsDirection: patch.needsDirection ?? false,
  };
}

describe("defaultIndicatorDraft — rascunho inicial a partir do plano, sem pré-seleção inventada", () => {
  test("casou (attach): action vem 'attach' com o alvo já preenchido", () => {
    const draft = defaultIndicatorDraft(
      suggestion(),
      plan({ action: "attach", target: existing({ id: "ind-9" }) }),
    );
    expect(draft.action).toBe("attach");
    expect(draft.targetIndicatorId).toBe("ind-9");
  });

  test("não casou (create): action vem 'create', sem alvo", () => {
    const draft = defaultIndicatorDraft(suggestion(), plan({ action: "create" }));
    expect(draft.action).toBe("create");
    expect(draft.targetIndicatorId).toBeNull();
  });

  test("ambíguo: começa como 'attach', SEM alvo (ajuste do dono do produto, 18/10/2026) — bloqueia até escolha manual, nunca escolhe um dos existentes sozinho", () => {
    // Antes deste ajuste, ambíguo começava como "create" (vindo direto de
    // plan.action). Decisão do dono do produto: ambíguo deve ficar
    // BLOQUEANTE em "attach" sem alvo, forçando o consultor a escolher um
    // existente, trocar pra "Criar novo" ou "Ignorar" — nunca criar por
    // omissão.
    const draft = defaultIndicatorDraft(suggestion(), plan({ action: "create", ambiguous: true }));
    expect(draft.action).toBe("attach");
    expect(draft.targetIndicatorId).toBeNull();
  });

  test("basis vazia na sugestão não pré-seleciona nada ('' permanece '')", () => {
    const draft = defaultIndicatorDraft(suggestion({ basis: "" }), plan());
    expect(draft.basis).toBe("");
  });

  test("basis presente na sugestão é usada (vem da IA, não é uma escolha nossa)", () => {
    const draft = defaultIndicatorDraft(suggestion({ basis: "estimado" }), plan());
    expect(draft.basis).toBe("estimado");
  });

  test("measured_at vazia na sugestão permanece vazia (vira a data da reunião na gravação)", () => {
    const draft = defaultIndicatorDraft(suggestion({ measured_at: "" }), plan());
    expect(draft.measuredAt).toBe("");
  });

  test("value vira texto pt-BR editável; baseline_value null vira texto vazio", () => {
    const draft = defaultIndicatorDraft(
      suggestion({ value: 1234.5, baseline_value: null }),
      plan(),
    );
    expect(draft.valueText).toBe("1234,5");
    expect(draft.baselineValueText).toBe("");
  });
});

describe("applyIndicatorEdit — mescla a edição; trocar de 'attach' sempre esvazia o alvo", () => {
  test("editar valueText preserva os demais campos", () => {
    const draft = defaultIndicatorDraft(suggestion(), plan());
    const next = applyIndicatorEdit(draft, { valueText: "200" });
    expect(next.valueText).toBe("200");
    expect(next.action).toBe(draft.action);
  });

  test("trocar pra 'create' esvazia targetIndicatorId mesmo que viesse preenchido", () => {
    const draft = defaultIndicatorDraft(
      suggestion(),
      plan({ action: "attach", target: existing({ id: "ind-1" }) }),
    );
    expect(draft.targetIndicatorId).toBe("ind-1");
    const next = applyIndicatorEdit(draft, { action: "create" });
    expect(next.targetIndicatorId).toBeNull();
  });

  test("trocar pra 'skip' também esvazia targetIndicatorId", () => {
    const draft = defaultIndicatorDraft(
      suggestion(),
      plan({ action: "attach", target: existing({ id: "ind-1" }) }),
    );
    const next = applyIndicatorEdit(draft, { action: "skip" });
    expect(next.targetIndicatorId).toBeNull();
  });

  test("escolher targetIndicatorId enquanto já está em 'attach' preserva a escolha", () => {
    const draft = defaultIndicatorDraft(suggestion(), plan({ action: "attach" }));
    const next = applyIndicatorEdit(draft, { targetIndicatorId: "ind-7" });
    expect(next.targetIndicatorId).toBe("ind-7");
  });
});

describe("buildApprovedIndicators — monta ApprovedIndicatorItem[] a partir das sugestões + rascunhos", () => {
  test("name/kind/unit/evidence vêm da sugestão, nunca do rascunho", () => {
    const s = suggestion({
      name: "Ticket médio",
      kind: "valor",
      unit: "R$",
      evidence: "disse isso",
    });
    const draft: IndicatorDraft = defaultIndicatorDraft(s, plan());
    const [item] = buildApprovedIndicators([s], [draft]);
    expect(item!.name).toBe("Ticket médio");
    expect(item!.kind).toBe("valor");
    expect(item!.unit).toBe("R$");
    expect(item!.evidence).toBe("disse isso");
  });

  test("value vem do texto do rascunho via parseNumberPtBr — texto inválido vira null, nunca 0", () => {
    const s = suggestion();
    const draft = applyIndicatorEdit(defaultIndicatorDraft(s, plan()), { valueText: "abc" });
    const [item] = buildApprovedIndicators([s], [draft]);
    expect(item!.value).toBeNull();
  });

  test("value '0' explícito no texto é aceito como zero, não como ausência", () => {
    const s = suggestion();
    const draft = applyIndicatorEdit(defaultIndicatorDraft(s, plan()), { valueText: "0" });
    const [item] = buildApprovedIndicators([s], [draft]);
    expect(item!.value).toBe(0);
  });

  test("baseline_value só é lido do rascunho quando action é 'create'", () => {
    const s = suggestion();
    const createDraft = applyIndicatorEdit(defaultIndicatorDraft(s, plan({ action: "create" })), {
      baselineValueText: "50",
    });
    const [createItem] = buildApprovedIndicators([s], [createDraft]);
    expect(createItem!.baseline_value).toBe(50);

    const attachDraft = applyIndicatorEdit(
      defaultIndicatorDraft(s, plan({ action: "attach", target: existing() })),
      { baselineValueText: "50" },
    );
    const [attachItem] = buildApprovedIndicators([s], [attachDraft]);
    expect(attachItem!.baseline_value).toBeNull();
  });

  test("target_indicator_id só é lido do rascunho quando action é 'attach'", () => {
    const s = suggestion();
    const draft = defaultIndicatorDraft(
      s,
      plan({ action: "attach", target: existing({ id: "ind-3" }) }),
    );
    const [item] = buildApprovedIndicators([s], [draft]);
    expect(item!.target_indicator_id).toBe("ind-3");
  });
});

describe("blockingIndicatorCount — mesma regra de validateApprovedIndicator, nunca uma cópia", () => {
  test("tudo válido: zero bloqueios", () => {
    const s = suggestion();
    const draft = defaultIndicatorDraft(s, plan({ action: "attach", target: existing() }));
    const items = buildApprovedIndicators([s], [draft]);
    expect(blockingIndicatorCount(items)).toBe(0);
  });

  test("criar sem direção bloqueia", () => {
    const s = suggestion({ direction: "" });
    const draft = defaultIndicatorDraft(s, plan({ action: "create", needsDirection: true }));
    const items = buildApprovedIndicators([s], [draft]);
    expect(blockingIndicatorCount(items)).toBe(1);
  });

  test("anexar sem alvo escolhido bloqueia", () => {
    const s = suggestion();
    const draft = applyIndicatorEdit(defaultIndicatorDraft(s, plan({ action: "create" })), {
      action: "attach",
    });
    expect(draft.targetIndicatorId).toBeNull();
    const items = buildApprovedIndicators([s], [draft]);
    expect(blockingIndicatorCount(items)).toBe(1);
  });

  test("ignorar nunca bloqueia, mesmo com todos os outros campos vazios", () => {
    const s = suggestion({ direction: "", basis: "" });
    const draft = applyIndicatorEdit(defaultIndicatorDraft(s, plan()), {
      action: "skip",
      valueText: "",
      basis: "",
    });
    const items = buildApprovedIndicators([s], [draft]);
    expect(blockingIndicatorCount(items)).toBe(0);
  });

  test("basis ausente bloqueia (sem pré-seleção — '' é sempre erro fora de skip)", () => {
    const s = suggestion({ basis: "" });
    const draft = defaultIndicatorDraft(s, plan({ action: "attach", target: existing() }));
    const items = buildApprovedIndicators([s], [draft]);
    expect(blockingIndicatorCount(items)).toBe(1);
  });

  test("conta vários itens bloqueantes ao mesmo tempo", () => {
    const s1 = suggestion({ direction: "" });
    const s2 = suggestion({ basis: "" });
    const draft1 = defaultIndicatorDraft(s1, plan({ action: "create" }));
    const draft2 = defaultIndicatorDraft(s2, plan({ action: "attach", target: existing() }));
    const items = buildApprovedIndicators([s1, s2], [draft1, draft2]);
    expect(blockingIndicatorCount(items)).toBe(2);
  });
});

describe("ambíguo — bloqueante até escolha manual (ajuste do dono do produto, 18/10/2026)", () => {
  function ambiguousDraft(s: IndicatorSuggestion) {
    return defaultIndicatorDraft(s, plan({ action: "create", ambiguous: true }));
  }

  test("começa em 'attach' sem alvo e conta como bloqueante", () => {
    const s = suggestion();
    const draft = ambiguousDraft(s);
    expect(draft.action).toBe("attach");
    expect(draft.targetIndicatorId).toBeNull();
    const items = buildApprovedIndicators([s], [draft]);
    expect(blockingIndicatorCount(items)).toBe(1);
  });

  test("trocar para 'skip' libera (ignorar nunca bloqueia)", () => {
    const s = suggestion();
    const draft = applyIndicatorEdit(ambiguousDraft(s), { action: "skip" });
    const items = buildApprovedIndicators([s], [draft]);
    expect(blockingIndicatorCount(items)).toBe(0);
  });

  test("trocar para 'create' sem direção continua bloqueando", () => {
    const s = suggestion({ direction: "" });
    const draft = applyIndicatorEdit(ambiguousDraft(s), { action: "create" });
    expect(draft.direction).toBe("");
    const items = buildApprovedIndicators([s], [draft]);
    expect(blockingIndicatorCount(items)).toBe(1);
  });

  test("escolher um alvo (continuando em 'attach') libera", () => {
    const s = suggestion();
    const draft = applyIndicatorEdit(ambiguousDraft(s), { targetIndicatorId: "ind-2" });
    expect(draft.action).toBe("attach");
    const items = buildApprovedIndicators([s], [draft]);
    expect(blockingIndicatorCount(items)).toBe(0);
  });
});
