import { describe, expect, test } from "bun:test";
import {
  matchIndicatorByName,
  planIndicatorSuggestion,
  type ExistingIndicatorForMatch,
} from "../src/lib/indicator-match";
import type { IndicatorSuggestion } from "../src/lib/meeting-analysis";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate B (18/10/2026). Regra do
 * dono do produto: identidade é nome normalizado + kind, exatos — nunca
 * similaridade nem embedding. Casou → anexar ponto; não casou → criar
 * indicador; duas chaves iguais entre os existentes → ambíguo, sem
 * casamento automático (seletor manual fica pro Gate C).
 * ------------------------------------------------------------------ */

function existing(patch: Partial<ExistingIndicatorForMatch> = {}): ExistingIndicatorForMatch {
  return {
    id: patch.id ?? "ind-1",
    name: patch.name ?? "Receita",
    kind: patch.kind ?? "valor",
    direction: patch.direction ?? "maior_melhor",
  };
}

function suggestion(patch: Partial<IndicatorSuggestion> = {}): IndicatorSuggestion {
  return {
    name: patch.name ?? "Receita",
    kind: patch.kind ?? "valor",
    unit: patch.unit ?? "",
    direction: patch.direction ?? "maior_melhor",
    value: patch.value ?? 100,
    baseline_value: patch.baseline_value ?? null,
    basis: patch.basis ?? "medido",
    measured_at: patch.measured_at ?? "",
    evidence: patch.evidence ?? "",
    classification: patch.classification ?? "fact",
  };
}

describe("matchIndicatorByName — nome normalizado + kind, exatos, nunca similaridade", () => {
  test("mesma grafia (acento e caixa diferentes) casa", () => {
    const result = matchIndicatorByName("patrimonio  liquido", "valor", [
      existing({ id: "ind-1", name: "Patrimônio Líquido", kind: "valor" }),
    ]);
    expect(result.ambiguous).toBe(false);
    expect(result.indicator?.id).toBe("ind-1");
  });

  test("mesmo nome, kind diferente, NÃO casa", () => {
    const result = matchIndicatorByName("Receita", "percentual", [
      existing({ id: "ind-1", name: "Receita", kind: "valor" }),
    ]);
    expect(result.indicator).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  test("lista vazia não casa (sem ambiguidade)", () => {
    const result = matchIndicatorByName("Receita", "valor", []);
    expect(result.indicator).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  test("duas linhas existentes com a mesma chave (nome normalizado + kind) são ambíguas — sem casamento automático", () => {
    const result = matchIndicatorByName("Receita", "valor", [
      existing({ id: "ind-1", name: "Receita", kind: "valor" }),
      existing({ id: "ind-2", name: "  RECEITA  ", kind: "valor" }),
    ]);
    expect(result.indicator).toBeNull();
    expect(result.ambiguous).toBe(true);
  });
});

describe("planIndicatorSuggestion — attach quando casa, create quando não casa", () => {
  test("casou → action 'attach', target é o indicador existente, needsDirection sempre false", () => {
    const plan = planIndicatorSuggestion(
      suggestion({ name: "Receita", kind: "valor", direction: "" }),
      [existing({ id: "ind-1", name: "Receita", kind: "valor" })],
    );
    expect(plan.action).toBe("attach");
    expect(plan.target?.id).toBe("ind-1");
    expect(plan.ambiguous).toBe(false);
    expect(plan.needsDirection).toBe(false);
  });

  test("lista vazia → action 'create', target null", () => {
    const plan = planIndicatorSuggestion(suggestion({ name: "Receita", kind: "valor" }), []);
    expect(plan.action).toBe("create");
    expect(plan.target).toBeNull();
    expect(plan.ambiguous).toBe(false);
  });

  test("ambíguo (duas chaves iguais) → action 'create', ambiguous true, sem casamento automático", () => {
    const plan = planIndicatorSuggestion(suggestion({ name: "Receita", kind: "valor" }), [
      existing({ id: "ind-1", name: "Receita", kind: "valor" }),
      existing({ id: "ind-2", name: "receita", kind: "valor" }),
    ]);
    expect(plan.action).toBe("create");
    expect(plan.target).toBeNull();
    expect(plan.ambiguous).toBe(true);
  });

  test("create com direction vazio marca needsDirection", () => {
    const plan = planIndicatorSuggestion(
      suggestion({ name: "Receita", kind: "valor", direction: "" }),
      [],
    );
    expect(plan.action).toBe("create");
    expect(plan.needsDirection).toBe(true);
  });

  test("create com direction preenchido NÃO marca needsDirection", () => {
    const plan = planIndicatorSuggestion(
      suggestion({ name: "Receita", kind: "valor", direction: "maior_melhor" }),
      [],
    );
    expect(plan.action).toBe("create");
    expect(plan.needsDirection).toBe(false);
  });

  test("attach nunca marca needsDirection, mesmo com direction vazio na sugestão", () => {
    const plan = planIndicatorSuggestion(
      suggestion({ name: "Receita", kind: "valor", direction: "" }),
      [existing({ id: "ind-1", name: "Receita", kind: "valor", direction: "menor_melhor" })],
    );
    expect(plan.action).toBe("attach");
    expect(plan.needsDirection).toBe(false);
  });
});
