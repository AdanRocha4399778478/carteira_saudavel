import { describe, expect, test } from "bun:test";
import { validateApprovedIndicator, type ApprovedIndicatorItem } from "../src/lib/meeting-analysis";
import { buildIdempotencyKey } from "../src/lib/deduplication";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate D (18/10/2026): GRAVAÇÃO dos
 * indicadores aprovados. validateApprovedIndicator é pura e sem I/O — só
 * ela é testada diretamente aqui. A gravação em si (applyApprovedAnalysis)
 * usa o cliente Supabase do módulo direto (sem injeção), então, seguindo o
 * padrão já usado em tests/meeting-chronology-guard.test.ts para o mesmo
 * arquivo, é coberta por inspeção estática em
 * tests/indicator-gravacao-wiring.test.ts.
 * ------------------------------------------------------------------ */

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

describe("validateApprovedIndicator — skip nunca valida", () => {
  test("action 'skip' devolve lista vazia mesmo com todos os outros campos inválidos", () => {
    const errors = validateApprovedIndicator(
      item({
        action: "skip",
        name: "",
        kind: "",
        direction: "",
        value: null,
        basis: "",
        measured_at: "data invalida",
      }),
    );
    expect(errors).toEqual([]);
  });
});

describe("validateApprovedIndicator — cada erro isolado", () => {
  test("nome vazio", () => {
    expect(validateApprovedIndicator(item({ name: "" }))).toContain("nome vazio");
  });

  test("kind inválido (vazio ou fora da lista)", () => {
    expect(validateApprovedIndicator(item({ kind: "" }))).toContain("kind inválido");
  });

  test("criar sem direção", () => {
    expect(validateApprovedIndicator(item({ action: "create", direction: "" }))).toContain(
      "criar sem direção",
    );
  });

  test("anexar sem alvo", () => {
    expect(
      validateApprovedIndicator(item({ action: "attach", target_indicator_id: null })),
    ).toContain("anexar sem alvo");
  });

  test("value ausente (null) é recusado — nunca vira zero", () => {
    expect(validateApprovedIndicator(item({ value: null }))).toContain("value não finito");
  });

  test("value explícito 0 é aceito (não gera 'value não finito')", () => {
    expect(validateApprovedIndicator(item({ value: 0 }))).not.toContain("value não finito");
  });

  test("basis ausente", () => {
    expect(validateApprovedIndicator(item({ basis: "" }))).toContain("basis ausente");
  });

  test("measured_at inválida (texto que não é AAAA-MM-DD real)", () => {
    expect(validateApprovedIndicator(item({ measured_at: "maio de 2026" }))).toContain(
      "measured_at inválida",
    );
  });

  test("measured_at vazia NÃO é erro — vira a data da reunião na gravação", () => {
    expect(validateApprovedIndicator(item({ measured_at: "" }))).not.toContain(
      "measured_at inválida",
    );
  });

  test("anexar com alvo, direção vazia e sem erro de direção (só create exige direção)", () => {
    const errors = validateApprovedIndicator(
      item({ action: "attach", target_indicator_id: "ind-1", direction: "" }),
    );
    expect(errors).not.toContain("criar sem direção");
  });

  test("item totalmente válido (create) não gera nenhum erro", () => {
    expect(validateApprovedIndicator(item())).toEqual([]);
  });

  test("item totalmente válido (attach) não gera nenhum erro", () => {
    const attachItem = item({ action: "attach", target_indicator_id: "ind-1", direction: "" });
    expect(validateApprovedIndicator(attachItem)).toEqual([]);
  });
});

describe("buildIdempotencyKey — mecanismo usado pela chave de aplicação dos indicadores", () => {
  test("acrescentar uma chave não vazia ao payload muda o hash", () => {
    const withoutIndicators = buildIdempotencyKey({
      analysisId: "a1",
      meetingId: "m1",
      payload: { decisions: [], indicators: undefined },
    });
    const withIndicators = buildIdempotencyKey({
      analysisId: "a1",
      meetingId: "m1",
      payload: { decisions: [], indicators: [item()] },
    });
    expect(withIndicators).not.toBe(withoutIndicators);
  });

  test("omitir a chave por completo (spread condicional com {}) dá o MESMO hash que nunca tê-la declarado", () => {
    const explicit = buildIdempotencyKey({
      analysisId: "a1",
      meetingId: "m1",
      payload: { decisions: [] },
    });
    const viaEmptySpread = buildIdempotencyKey({
      analysisId: "a1",
      meetingId: "m1",
      payload: { decisions: [], ...{} },
    });
    expect(viaEmptySpread).toBe(explicit);
  });
});
