import { describe, expect, test } from "bun:test";
import { isOverdue } from "../src/lib/domain";

/* ------------------------------------------------------------------ *
 * Achado real em produção (auditoria de ações "não iniciada", 01/10/2026):
 * ações de natureza contínua/recorrente (ex.: "Manter o acompanhamento
 * semanal...") tinham um prazo preenchido pela IA e contavam como
 * "vencidas" assim que essa data passava, mesmo sem representar um
 * compromisso de entrega única descumprido. `is_recurring` é booleano
 * estático e ortogonal a `status` — só exclui do cálculo de "vencida".
 * ------------------------------------------------------------------ */
describe("isOverdue — ação recorrente nunca conta como vencida", () => {
  const pastDeadline = "2000-01-01";

  test("ação não recorrente com prazo vencido continua vencida (comportamento preservado)", () => {
    expect(isOverdue({ deadline: pastDeadline, status: "não iniciada", is_recurring: false })).toBe(
      true,
    );
  });

  test("ação recorrente com o mesmo prazo vencido nunca conta como vencida", () => {
    expect(isOverdue({ deadline: pastDeadline, status: "não iniciada", is_recurring: true })).toBe(
      false,
    );
  });

  test("ação recorrente concluída continua não vencida (sem efeito colateral na regra de status)", () => {
    expect(isOverdue({ deadline: pastDeadline, status: "concluída", is_recurring: true })).toBe(
      false,
    );
  });

  test("chamadas antigas sem is_recurring (campo ausente) continuam funcionando — compatibilidade", () => {
    expect(isOverdue({ deadline: pastDeadline, status: "não iniciada" })).toBe(true);
  });

  test("sem prazo preenchido nunca é vencida, recorrente ou não", () => {
    expect(isOverdue({ deadline: null, status: "não iniciada", is_recurring: true })).toBe(false);
    expect(isOverdue({ deadline: null, status: "não iniciada", is_recurring: false })).toBe(false);
  });
});
