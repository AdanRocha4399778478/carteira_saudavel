import { describe, expect, test } from "bun:test";
import { normalizeIndicatorName } from "../src/lib/indicator-name";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate B (18/10/2026). Teste de
 * PARIDADE: normalizeIndicatorName foi extraída de meeting-analysis.ts
 * (onde era local) pra src/lib/indicator-name.ts, exportada, sem mudar
 * comportamento nenhum — só mudou de arquivo. Os casos abaixo são os
 * mesmos já exercitados indiretamente pela remoção de duplicados em
 * tests/indicators-ai-suggestion-schema.test.ts, repetidos aqui direto
 * contra a função, no novo local.
 * ------------------------------------------------------------------ */

describe("normalizeIndicatorName — minúsculo, sem acento, sem espaço extra", () => {
  test("maiúsculas e acentos são removidos", () => {
    expect(normalizeIndicatorName("Patrimônio Líquido")).toBe("patrimonio liquido");
  });

  test("espaços extras (dobrados, nas pontas) colapsam para um único espaço, sem sobra nas pontas", () => {
    expect(normalizeIndicatorName("  Receita   Mensal  ")).toBe("receita mensal");
  });

  test("duas grafias diferentes do mesmo nome normalizam para a mesma chave", () => {
    expect(normalizeIndicatorName("Patrimônio líquido")).toBe(
      normalizeIndicatorName("patrimonio  liquido"),
    );
  });

  test("já normalizado permanece idêntico (idempotente)", () => {
    const already = "ticket medio";
    expect(normalizeIndicatorName(already)).toBe(already);
  });

  test("string vazia permanece vazia", () => {
    expect(normalizeIndicatorName("")).toBe("");
  });
});
