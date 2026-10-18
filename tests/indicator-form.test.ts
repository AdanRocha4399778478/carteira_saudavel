import { describe, expect, test } from "bun:test";
import {
  explainNumberParseError,
  formatNumberForInput,
  isValidCalendarDate,
  parseNumberPtBr,
  validateIndicatorForm,
  validateIndicatorPointForm,
  type IndicatorFormInput,
  type IndicatorPointFormInput,
} from "../src/lib/indicator-form";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 3 (17/10/2026): parse de número
 * pt-BR e validação dos formulários de cadastro manual, fora do
 * componente. Valor vazio NUNCA vira zero — é erro de validação. A
 * marca medido/estimado do ponto é sempre obrigatória, sem
 * pré-seleção.
 * ------------------------------------------------------------------ */

function indicatorInput(overrides: Partial<IndicatorFormInput> = {}): IndicatorFormInput {
  return {
    name: "Receita mensal",
    kind: "valor",
    unit: "",
    direction: "maior_melhor",
    frequency: "",
    baselineValue: "",
    baselineAt: "",
    targetValue: "",
    ...overrides,
  };
}

function pointInput(overrides: Partial<IndicatorPointFormInput> = {}): IndicatorPointFormInput {
  return {
    value: "100",
    measuredAt: "2026-05-31",
    basis: "medido",
    note: "",
    ...overrides,
  };
}

describe("parseNumberPtBr — formato brasileiro, nunca 0 pro que não dá pra ler", () => {
  test("'1.234,5' -> 1234.5 (ponto é separador de milhar)", () => {
    expect(parseNumberPtBr("1.234,5")).toBe(1234.5);
  });

  test("'12,5' -> 12.5", () => {
    expect(parseNumberPtBr("12,5")).toBe(12.5);
  });

  test("'143000' (sem separador nenhum) -> 143000", () => {
    expect(parseNumberPtBr("143000")).toBe(143000);
  });

  test("'-50,5' -> -50.5 (base negativa precisa funcionar)", () => {
    expect(parseNumberPtBr("-50,5")).toBe(-50.5);
  });

  test("vazio -> null, nunca 0", () => {
    expect(parseNumberPtBr("")).toBeNull();
    expect(parseNumberPtBr("   ")).toBeNull();
  });

  test("null/undefined -> null", () => {
    expect(parseNumberPtBr(null)).toBeNull();
    expect(parseNumberPtBr(undefined)).toBeNull();
  });

  test("texto inválido -> null, nunca 0", () => {
    expect(parseNumberPtBr("texto inválido")).toBeNull();
    expect(parseNumberPtBr("R$ 100")).toBeNull();
    expect(parseNumberPtBr("12,5,3")).toBeNull();
  });

  test("espaços nas pontas são ignorados", () => {
    expect(parseNumberPtBr("  12,5  ")).toBe(12.5);
  });

  test("'.' e '..' -> null (não '0' silencioso)", () => {
    expect(parseNumberPtBr(".")).toBeNull();
    expect(parseNumberPtBr("..")).toBeNull();
  });

  test("'12.5' -> null (formato americano é recusado, não lido como 125)", () => {
    expect(parseNumberPtBr("12.5")).toBeNull();
  });

  test("'1.234' (milhar válido, sem decimal) -> 1234", () => {
    expect(parseNumberPtBr("1.234")).toBe(1234);
  });

  test("'-0,5' -> -0.5", () => {
    expect(parseNumberPtBr("-0,5")).toBe(-0.5);
  });

  test("'0,5' -> 0.5", () => {
    expect(parseNumberPtBr("0,5")).toBe(0.5);
  });

  test("',5', '1.2.3' e '1,2,3' -> null (sem dígito antes da vírgula, milhar quebrado, vírgulas demais)", () => {
    expect(parseNumberPtBr(",5")).toBeNull();
    expect(parseNumberPtBr("1.2.3")).toBeNull();
    expect(parseNumberPtBr("1,2,3")).toBeNull();
  });

  test("'0.123' e '0.500' -> null (milhar não começa com zero à esquerda)", () => {
    expect(parseNumberPtBr("0.123")).toBeNull();
    expect(parseNumberPtBr("0.500")).toBeNull();
  });

  test("'10.000' -> 10000", () => {
    expect(parseNumberPtBr("10.000")).toBe(10000);
  });

  test("'100.000,5' -> 100000.5", () => {
    expect(parseNumberPtBr("100.000,5")).toBe(100000.5);
  });
});

describe("explainNumberParseError — mensagem específica pra confusão com formato americano", () => {
  test("texto com ponto (que já falhou o parse) pede vírgula como decimal", () => {
    expect(explainNumberParseError("12.5")).toBe("Use vírgula como separador decimal (ex.: 12,5).");
  });

  test("'0.123' (zero à esquerda, não é milhar válido) também pede vírgula", () => {
    expect(explainNumberParseError("0.123")).toBe(
      "Use vírgula como separador decimal (ex.: 12,5).",
    );
  });

  test("texto sem ponto cai na mensagem genérica", () => {
    expect(explainNumberParseError("abc")).toBe("Valor inválido.");
  });
});

describe("isValidCalendarDate — recusa data inexistente, não só o formato", () => {
  test("2026-02-31 é inválida (fevereiro não tem 31 dias)", () => {
    expect(isValidCalendarDate("2026-02-31")).toBe(false);
  });

  test("2026-13-01 é inválida (não existe mês 13)", () => {
    expect(isValidCalendarDate("2026-13-01")).toBe(false);
  });

  test("2028-02-29 é válida (2028 é bissexto)", () => {
    expect(isValidCalendarDate("2028-02-29")).toBe(true);
  });

  test("2026-02-29 é inválida (2026 não é bissexto)", () => {
    expect(isValidCalendarDate("2026-02-29")).toBe(false);
  });

  test("ano fora de 1990-2100 é inválido (erro de digitação, não um ponto no passado/futuro distante)", () => {
    expect(isValidCalendarDate("0026-10-17")).toBe(false);
    expect(isValidCalendarDate("2101-01-01")).toBe(false);
  });

  test("limites do intervalo (1990, 2026, 2100) são válidos", () => {
    expect(isValidCalendarDate("1990-01-01")).toBe(true);
    expect(isValidCalendarDate("2026-10-17")).toBe(true);
    expect(isValidCalendarDate("2100-12-31")).toBe(true);
  });
});

describe("formatNumberForInput — inverso de parseNumberPtBr, pra reabrir campo editável", () => {
  test("1234.5 -> '1234,5' (sem separador de milhar)", () => {
    expect(formatNumberForInput(1234.5)).toBe("1234,5");
  });

  test("null/undefined -> string vazia, nunca '0'", () => {
    expect(formatNumberForInput(null)).toBe("");
    expect(formatNumberForInput(undefined)).toBe("");
  });

  test("round-trip com parseNumberPtBr preserva o valor", () => {
    const original = -50.5;
    expect(parseNumberPtBr(formatNumberForInput(original))).toBe(original);
  });
});

describe("validateIndicatorForm", () => {
  test("formulário mínimo válido (só nome, tipo e direção)", () => {
    const result = validateIndicatorForm(indicatorInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Receita mensal");
      expect(result.value.baseline_value).toBeNull();
      expect(result.value.target_value).toBeNull();
    }
  });

  test("nome vazio é erro de validação", () => {
    const result = validateIndicatorForm(indicatorInput({ name: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBeTruthy();
  });

  test("tipo vazio é erro de validação", () => {
    const result = validateIndicatorForm(indicatorInput({ kind: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.kind).toBeTruthy();
  });

  test("direção vazia é erro de validação", () => {
    const result = validateIndicatorForm(indicatorInput({ direction: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.direction).toBeTruthy();
  });

  test("base com texto inválido é erro — NUNCA vira 0", () => {
    const result = validateIndicatorForm(indicatorInput({ baselineValue: "abc" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.baselineValue).toBeTruthy();
  });

  test("base e meta preenchidas em pt-BR são convertidas corretamente", () => {
    const result = validateIndicatorForm(
      indicatorInput({ baselineValue: "1.234,5", baselineAt: "2026-04-30", targetValue: "2.000" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.baseline_value).toBe(1234.5);
      expect(result.value.baseline_at).toBe("2026-04-30");
      expect(result.value.target_value).toBe(2000);
    }
  });

  test("data da base inválida é erro de validação", () => {
    const result = validateIndicatorForm(indicatorInput({ baselineAt: "30/04/2026" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.baselineAt).toBeTruthy();
  });

  test("data da base com formato certo mas dia inexistente (2026-02-31) é erro", () => {
    const result = validateIndicatorForm(indicatorInput({ baselineAt: "2026-02-31" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.baselineAt).toBeTruthy();
  });

  test("base '12.5' (formato americano) vira o aviso de vírgula, não 'Valor inválido.'", () => {
    const result = validateIndicatorForm(indicatorInput({ baselineValue: "12.5" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.baselineValue).toBe("Use vírgula como separador decimal (ex.: 12,5).");
    }
  });

  test("unidade e frequência vazias viram null, não string vazia", () => {
    const result = validateIndicatorForm(indicatorInput({ unit: "  ", frequency: "" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.unit).toBeNull();
      expect(result.value.frequency).toBeNull();
    }
  });
});

describe("validateIndicatorPointForm", () => {
  test("ponto mínimo válido", () => {
    const result = validateIndicatorPointForm(pointInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe(100);
      expect(result.value.basis).toBe("medido");
    }
  });

  test("marca (basis) vazia é erro de validação — nunca pré-selecionada", () => {
    const result = validateIndicatorPointForm(pointInput({ basis: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.basis).toBeTruthy();
  });

  test("valor vazio é erro de validação, NUNCA vira zero", () => {
    const result = validateIndicatorPointForm(pointInput({ value: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.value).toBeTruthy();
  });

  test("valor com texto inválido é erro de validação", () => {
    const result = validateIndicatorPointForm(pointInput({ value: "não é número" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.value).toBeTruthy();
  });

  test("data vazia é erro de validação", () => {
    const result = validateIndicatorPointForm(pointInput({ measuredAt: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.measuredAt).toBeTruthy();
  });

  test("data com formato certo mas inexistente (2026-13-01) é erro", () => {
    const result = validateIndicatorPointForm(pointInput({ measuredAt: "2026-13-01" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.measuredAt).toBeTruthy();
  });

  test("valor só com ponto ('.') nunca vira zero — é erro de validação", () => {
    const result = validateIndicatorPointForm(pointInput({ value: "." }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.value).toBeTruthy();
  });

  test("basis 'estimado' é aceito normalmente", () => {
    const result = validateIndicatorPointForm(pointInput({ basis: "estimado" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.basis).toBe("estimado");
  });

  test("nota vazia vira null, não string vazia", () => {
    const result = validateIndicatorPointForm(pointInput({ note: "   " }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.note).toBeNull();
  });

  test("valor em pt-BR com separador de milhar é convertido corretamente", () => {
    const result = validateIndicatorPointForm(pointInput({ value: "246.000,5" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.value).toBe(246000.5);
  });
});
