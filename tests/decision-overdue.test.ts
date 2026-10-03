import { describe, expect, test } from "bun:test";
import { isDecisionOverdue } from "../src/lib/domain";

/* Decisão atrasada = DIA do due_date anterior ao dia de hoje (data local) E status
 * 'pendente', 'aprovada' ou 'em_execucao'. Prazo de hoje não é atrasada. */
function localDay(offsetDays: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("isDecisionOverdue", () => {
  const yesterday = localDay(-1);
  const today = localDay(0);
  const tomorrow = localDay(1);

  test("prazo ontem é atrasada", () => {
    expect(isDecisionOverdue({ due_date: yesterday, status: "pendente" })).toBe(true);
  });

  test("prazo hoje NÃO é atrasada", () => {
    expect(isDecisionOverdue({ due_date: today, status: "pendente" })).toBe(false);
  });

  test("prazo amanhã não é atrasada", () => {
    expect(isDecisionOverdue({ due_date: tomorrow, status: "pendente" })).toBe(false);
  });

  test("sem prazo nunca é atrasada", () => {
    expect(isDecisionOverdue({ due_date: null, status: "pendente" })).toBe(false);
    expect(isDecisionOverdue({ due_date: "", status: "em_execucao" })).toBe(false);
  });

  test("pendente, aprovada e em_execucao vencidas são atrasadas", () => {
    for (const status of ["pendente", "aprovada", "em_execucao"]) {
      expect(isDecisionOverdue({ due_date: yesterday, status })).toBe(true);
    }
  });

  test("implementada e cancelada vencidas nunca são atrasadas", () => {
    for (const status of ["implementada", "cancelada"]) {
      expect(isDecisionOverdue({ due_date: yesterday, status })).toBe(false);
    }
  });

  test("data inválida não é atrasada", () => {
    expect(isDecisionOverdue({ due_date: "lixo", status: "pendente" })).toBe(false);
  });
});
