import { describe, expect, test } from "bun:test";
import {
  SECOND_PASS_MIN_CHARS,
  buildSecondPassInstruction,
  shouldRunSecondPass,
  summarizeExtracted,
} from "@/lib/second-pass";

describe("shouldRunSecondPass", () => {
  test("1 bloco com 12000+ caracteres roda; menos que isso não", () => {
    expect(shouldRunSecondPass(1, SECOND_PASS_MIN_CHARS)).toBe(true);
    expect(shouldRunSecondPass(1, SECOND_PASS_MIN_CHARS - 1)).toBe(false);
  });

  test("mais de 1 bloco nunca roda", () => {
    expect(shouldRunSecondPass(2, SECOND_PASS_MIN_CHARS)).toBe(false);
  });
});

describe("summarizeExtracted", () => {
  test("vazio devolve (nada)", () => {
    expect(summarizeExtracted([])).toBe("(nada)");
  });

  test("trunca, limita a 40 itens por categoria e inclui o responsável das ações", () => {
    const decisions = Array.from({ length: 45 }, (_, i) => ({ title: `Decisão ${i}` }));
    const parts = [
      {
        analysis: {
          decisions,
          actions: [{ description: "x".repeat(200), owner_name: "Adan Rocha" }],
        },
      },
    ];
    const result = summarizeExtracted(parts);
    expect(result).toContain("responsável: Adan Rocha");
    expect(result.split("\n").filter((l) => l.startsWith("- Decisão")).length).toBe(40);
    expect(result).toContain("…");
  });
});

describe("buildSecondPassInstruction", () => {
  test("contém o resumo, a frase SOMENTE e a instrução de não repetir", () => {
    const text = buildSecondPassInstruction("Decisões:\n- X");
    expect(text).toContain("Decisões:\n- X");
    expect(text).toContain("SOMENTE");
    expect(text).toContain("Não repita nem reescreva");
  });
});
