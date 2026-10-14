import { describe, expect, test } from "bun:test";
import { initialDecisionStatus } from "../src/lib/decision-status";

describe("initialDecisionStatus", () => {
  test.each([
    ["Definir percentual de comissão dos vendedores após análise de margens", "pendente"],
    ["  definir o novo prazo de entrega", "pendente"],
    ["DEFINIR valor mínimo", "pendente"],
    ["Implementar processo comercial padronizado", "aprovada"],
    ["Adotar política de bônus trimestral", "aprovada"],
    ["Definição de metas individuais", "aprovada"],
    ["Redefinir o escopo", "aprovada"],
    ["", "pendente"],
    ["   ", "pendente"],
    ["Decidir se aprova o orçamento até sexta", "pendente"],
    ["  decidir se renova o contrato", "pendente"],
    ["DECIDIR SE muda de fornecedor", "pendente"],
    ["Decidir se adia o lançamento", "pendente"],
    ["Redecidir se vale a pena", "aprovada"],
  ])("%s → %s", (title, expected) => {
    expect(initialDecisionStatus(title)).toBe(expected);
  });
});
