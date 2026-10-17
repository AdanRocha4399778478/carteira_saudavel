import { describe, expect, test } from "bun:test";
import { parseAnalysis } from "../src/lib/meeting-analysis";

/* ------------------------------------------------------------------ *
 * Backlog B1 (16/10/2026): is_evaluation é sugestão opcional da IA no
 * schema Zod de decisões — ausência vira false, nunca null (mesma
 * convenção do helper `flag` já usado para os booleanos de nível-
 * reunião, ver meeting-analysis.ts).
 * ------------------------------------------------------------------ */

function decisionsOf(decisions: unknown[]) {
  const result = parseAnalysis({ decisions });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.analysis.decisions;
}

describe("parseAnalysis — decisions[].is_evaluation", () => {
  test("is_evaluation true é preservado", () => {
    const decisions = decisionsOf([{ title: "Definir ao final de 60 dias", is_evaluation: true }]);
    expect(decisions[0]!.is_evaluation).toBe(true);
  });

  test("is_evaluation false é preservado", () => {
    const decisions = decisionsOf([{ title: "Adotar checklist", is_evaluation: false }]);
    expect(decisions[0]!.is_evaluation).toBe(false);
  });

  test("ausente vira false, nunca null/undefined", () => {
    const decisions = decisionsOf([{ title: "Adotar checklist" }]);
    expect(decisions[0]!.is_evaluation).toBe(false);
  });

  test("null vira false", () => {
    const decisions = decisionsOf([{ title: "Adotar checklist", is_evaluation: null }]);
    expect(decisions[0]!.is_evaluation).toBe(false);
  });
});
