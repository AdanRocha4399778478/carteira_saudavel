import { describe, expect, test } from "bun:test";
import {
  orderPeopleForItem,
  preferredFunctionsForItem,
  type ClientPerson,
} from "../src/lib/client-people";

/* ------------------------------------------------------------------ *
 * Cadastro de pessoas e apelidos por cliente — Gate F (19/10/2026):
 * seletor de responsável no preview. A regra do prompt NÃO muda (a IA
 * continua sem adivinhar) — estas funções só ORDENAM as opções do
 * seletor; a escolha final é sempre do consultor.
 * ------------------------------------------------------------------ */

function person(overrides: Partial<ClientPerson> = {}): ClientPerson {
  return {
    id: "p1",
    client_id: "c1",
    name: "José Eduardo",
    aliases: ["Du", "Dudu"],
    side: "cliente",
    role: null,
    functions: [],
    active: true,
    created_by: null,
    created_at: "2026-10-19T00:00:00Z",
    updated_at: "2026-10-19T00:00:00Z",
    ...overrides,
  };
}

describe("preferredFunctionsForItem", () => {
  test("decisão sempre devolve ['decide'], qualquer texto", () => {
    expect(preferredFunctionsForItem("decisao", "Aprovar o orçamento")).toEqual(["decide"]);
    expect(preferredFunctionsForItem("decisao", "")).toEqual(["decide"]);
  });

  test("ação com verbo de execução simples devolve ['executa']", () => {
    expect(preferredFunctionsForItem("acao", "Enviar o relatório financeiro")).toEqual(["executa"]);
  });

  test("ação com verbo de monitoramento/acompanhamento devolve ['monitora', 'acompanha']", () => {
    for (const verb of [
      "monitorar",
      "acompanhar",
      "revisar",
      "cobrar",
      "checar",
      "verificar",
      "supervisionar",
      "conferir",
    ]) {
      expect(preferredFunctionsForItem("acao", `Vou ${verb} o andamento`)).toEqual([
        "monitora",
        "acompanha",
      ]);
    }
  });

  test("forma conjugada do verbo (radical) também conta", () => {
    expect(preferredFunctionsForItem("acao", "Cobrar a entrega até sexta")).toEqual([
      "monitora",
      "acompanha",
    ]);
    expect(preferredFunctionsForItem("acao", "Revisão mensal dos contratos")).toEqual([
      "monitora",
      "acompanha",
    ]);
  });

  test("sem acento e sem diferenciar maiúsculas", () => {
    expect(preferredFunctionsForItem("acao", "ACOMPANHAR o cliente de perto")).toEqual([
      "monitora",
      "acompanha",
    ]);
    expect(preferredFunctionsForItem("acao", "Verificação dos dados")).toEqual([
      "monitora",
      "acompanha",
    ]);
  });
});

describe("orderPeopleForItem", () => {
  test("quem tem a função preferida vem primeiro, mantendo a ordem do cadastro", () => {
    const a = person({ id: "a", name: "Ana", functions: ["executa"] });
    const b = person({ id: "b", name: "Bruno", functions: ["decide"] });
    const c = person({ id: "c", name: "Carla", functions: ["decide"] });
    const result = orderPeopleForItem([a, b, c], ["decide"], "");
    expect(result).toEqual(["Bruno", "Carla", "Ana"]);
  });

  test("pessoa inativa fica fora da lista", () => {
    const a = person({ id: "a", name: "Ana", active: false, functions: ["decide"] });
    const b = person({ id: "b", name: "Bruno", functions: ["decide"] });
    expect(orderPeopleForItem([a, b], ["decide"], "")).toEqual(["Bruno"]);
  });

  test("nome atual desconhecido (não é ninguém do cadastro) entra no topo", () => {
    const result = orderPeopleForItem([person({ name: "José Eduardo" })], ["decide"], "Luiz");
    expect(result).toEqual(["Luiz", "José Eduardo"]);
  });

  test("nome atual que já é pessoa cadastrada (nome ou apelido) NÃO duplica", () => {
    const resultByName = orderPeopleForItem(
      [person({ name: "José Eduardo" })],
      ["decide"],
      "José Eduardo",
    );
    expect(resultByName).toEqual(["José Eduardo"]);

    const resultByAlias = orderPeopleForItem(
      [person({ name: "José Eduardo", aliases: ["Dudu"] })],
      ["decide"],
      "Dudu",
    );
    expect(resultByAlias).toEqual(["José Eduardo"]);
  });

  test("nome atual vazio não entra na lista", () => {
    expect(orderPeopleForItem([person({ name: "José Eduardo" })], ["decide"], "")).toEqual([
      "José Eduardo",
    ]);
    expect(orderPeopleForItem([person({ name: "José Eduardo" })], ["decide"], "   ")).toEqual([
      "José Eduardo",
    ]);
  });

  test("nenhuma pessoa com a função preferida: todas ficam na ordem do cadastro, nome atual desconhecido no topo", () => {
    const a = person({ id: "a", name: "Ana", functions: ["executa"] });
    const b = person({ id: "b", name: "Bruno", functions: ["executa"] });
    expect(orderPeopleForItem([a, b], ["decide"], "Luiz")).toEqual(["Luiz", "Ana", "Bruno"]);
  });

  test("lista de pessoas vazia: só o nome atual (se houver)", () => {
    expect(orderPeopleForItem([], ["decide"], "Luiz")).toEqual(["Luiz"]);
    expect(orderPeopleForItem([], ["decide"], "")).toEqual([]);
  });
});
