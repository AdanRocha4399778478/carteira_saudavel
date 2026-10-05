import { describe, expect, test } from "bun:test";
import { isOrchestratorStateReady } from "../src/lib/orchestrator/ready";

/* ------------------------------------------------------------------ *
 * O Orquestrador só pode calcular e gravar uma recomendação quando as
 * 7 consultas que compõem o estado do projeto terminaram com sucesso.
 * isLoading não serve pra essa checagem: no react-query v5, isLoading é
 * falso para consulta desabilitada, o que esconderia um estado "nunca
 * vai carregar" como se já estivesse pronto.
 * ------------------------------------------------------------------ */
describe("isOrchestratorStateReady", () => {
  test("todas com sucesso = pronto", () => {
    expect(
      isOrchestratorStateReady([{ isSuccess: true }, { isSuccess: true }, { isSuccess: true }]),
    ).toBe(true);
  });

  test("uma pendente (isSuccess falso, consulta desabilitada) = não pronto", () => {
    expect(
      isOrchestratorStateReady([{ isSuccess: true }, { isSuccess: false }, { isSuccess: true }]),
    ).toBe(false);
  });

  test("uma em carregamento (isSuccess ainda falso) = não pronto", () => {
    expect(
      isOrchestratorStateReady([{ isSuccess: true }, { isSuccess: true }, { isSuccess: false }]),
    ).toBe(false);
  });

  test("uma com erro (isSuccess falso) = não pronto", () => {
    expect(
      isOrchestratorStateReady([{ isSuccess: false }, { isSuccess: true }, { isSuccess: true }]),
    ).toBe(false);
  });

  test("lista vazia = não pronto", () => {
    expect(isOrchestratorStateReady([])).toBe(false);
  });
});
