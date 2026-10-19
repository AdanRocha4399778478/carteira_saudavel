import { describe, expect, test } from "bun:test";
import {
  canonicalOwnerName,
  normalizePersonName,
  resolvePerson,
  suggestPeopleFromHistory,
  type ClientPerson,
} from "../src/lib/client-people";

/* ------------------------------------------------------------------ *
 * Cadastro de pessoas e apelidos por cliente — Gate B (funções puras,
 * sem I/O), 19/10/2026. Tabela já aplicada no banco (migration
 * 20261019140000). normalizePersonName precisa ter PARIDADE com
 * public.normalize_project_name (acento fora, minúsculo, fora de
 * [a-z0-9] vira espaço, trim).
 * ------------------------------------------------------------------ */

function person(overrides: Partial<ClientPerson> = {}): ClientPerson {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    client_id: "00000000-0000-0000-0000-00000000000c",
    name: "José Eduardo",
    aliases: ["Du", "Dudu", "Edu"],
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

describe("normalizePersonName — paridade com public.normalize_project_name", () => {
  test("acento, caixa e pontuação são removidos", () => {
    expect(normalizePersonName("José  Eduardo.")).toBe("jose eduardo");
  });

  test("duas grafias do mesmo nome normalizam igual", () => {
    expect(normalizePersonName("Édu")).toBe(normalizePersonName("Edu"));
    expect(normalizePersonName("Édu")).toBe("edu");
  });

  test("só pontuação normaliza para string vazia", () => {
    expect(normalizePersonName(".")).toBe("");
    expect(normalizePersonName("- ")).toBe("");
  });

  test("espaços múltiplos colapsam para um único espaço, sem sobra nas pontas", () => {
    expect(normalizePersonName("  Victor   Chammas  ")).toBe("victor chammas");
  });

  test("grafias parecidas mas diferentes NÃO normalizam igual (sem similaridade/fonética)", () => {
    expect(normalizePersonName("Victor")).not.toBe(normalizePersonName("Vitor"));
    expect(normalizePersonName("Duda")).not.toBe(normalizePersonName("Dudu"));
  });

  test("string vazia permanece vazia", () => {
    expect(normalizePersonName("")).toBe("");
  });
});

describe("resolvePerson — só igualdade exata depois de normalizar, nunca prefixo", () => {
  test("bate pelo nome canônico", () => {
    const people = [person()];
    const result = resolvePerson("josé eduardo", people);
    expect(result.ambiguous).toBe(false);
    expect(result.person?.id).toBe(people[0]!.id);
    if (!result.ambiguous) expect(result.matchedBy).toBe("name");
  });

  test("bate por apelido, inclusive em caixa alta (DUDU)", () => {
    const people = [person()];
    const result = resolvePerson("DUDU", people);
    expect(result.ambiguous).toBe(false);
    expect(result.person?.id).toBe(people[0]!.id);
    if (!result.ambiguous) expect(result.matchedBy).toBe("alias");
  });

  test("nome desconhecido não resolve", () => {
    const result = resolvePerson("Fulano de Tal", [person()]);
    expect(result.person).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  test("'Duda' NÃO casa com o apelido 'Dudu' (sem prefixo/similaridade)", () => {
    const result = resolvePerson("Duda", [person()]);
    expect(result.person).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  test("ambiguidade: duas pessoas ativas batendo devolve candidates, sem escolher uma", () => {
    const a = person({ id: "a", name: "Ana Paula", aliases: ["Ana"] });
    const b = person({ id: "b", name: "Ana Clara", aliases: ["Ana"] });
    const result = resolvePerson("Ana", [a, b]);
    expect(result.person).toBeNull();
    expect(result.ambiguous).toBe(true);
    if (result.ambiguous) {
      expect(result.candidates.map((c) => c.id).sort()).toEqual(["a", "b"]);
    }
  });

  test("pessoa inativa é ignorada", () => {
    const inactive = person({ active: false });
    const result = resolvePerson("josé eduardo", [inactive]);
    expect(result.person).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  test("lista vazia nunca resolve", () => {
    const result = resolvePerson("José Eduardo", []);
    expect(result.person).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  test("nome vazio ou só pontuação nunca resolve, mesmo com pessoas cadastradas", () => {
    expect(resolvePerson("", [person()]).person).toBeNull();
    expect(resolvePerson(" . ", [person()]).person).toBeNull();
  });
});

describe("canonicalOwnerName — mantém o original quando não resolve", () => {
  test("devolve o nome canônico quando resolvePerson encontra a pessoa", () => {
    expect(canonicalOwnerName("dudu", [person()])).toBe("José Eduardo");
  });

  test("devolve o nome original aparado quando não resolve (nunca apaga responsável desconhecido)", () => {
    expect(canonicalOwnerName("  Fulano de Tal  ", [person()])).toBe("Fulano de Tal");
  });

  test("pessoa inativa não resolve — mantém o nome original", () => {
    expect(canonicalOwnerName("josé eduardo", [person({ active: false })])).toBe("josé eduardo");
  });
});

describe("suggestPeopleFromHistory — agrupa por normalização, conta, ordena, nunca por parecença", () => {
  test("agrupa grafias que normalizam igual e conta ocorrências", () => {
    const suggestions = suggestPeopleFromHistory([
      { name: "José Eduardo", origin: "responsável de ação" },
      { name: "jose eduardo", origin: "responsável de ação" },
      { name: "José Eduardo", origin: "participante de reunião" },
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.normalized).toBe("jose eduardo");
    expect(suggestions[0]!.count).toBe(3);
  });

  test("ordena da mais para a menos frequente", () => {
    const suggestions = suggestPeopleFromHistory([
      { name: "Luiz", origin: "responsável de ação" },
      { name: "Maria", origin: "responsável de ação" },
      { name: "Maria", origin: "responsável de decisão" },
      { name: "Maria", origin: "participante de reunião" },
    ]);
    expect(suggestions.map((s) => s.name)).toEqual(["Maria", "Luiz"]);
    expect(suggestions[0]!.count).toBe(3);
    expect(suggestions[1]!.count).toBe(1);
  });

  test("'Victor' e 'Vitor' ficam SEPARADOS (nunca agrupa por parecença)", () => {
    const suggestions = suggestPeopleFromHistory([
      { name: "Victor", origin: "responsável de ação" },
      { name: "Vitor", origin: "participante de reunião" },
    ]);
    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((s) => s.normalized).sort()).toEqual(["victor", "vitor"]);
  });

  test("conta as origens de cada sugestão", () => {
    const suggestions = suggestPeopleFromHistory([
      { name: "Luiz", origin: "responsável de ação" },
      { name: "Luiz", origin: "responsável de ação" },
      { name: "Luiz", origin: "participante de reunião" },
    ]);
    const origins = suggestions[0]!.origins;
    expect(origins.find((o) => o.origin === "responsável de ação")?.count).toBe(2);
    expect(origins.find((o) => o.origin === "participante de reunião")?.count).toBe(1);
  });

  test("side 'consultoria' só quando o nome normalizado bate com a lista de consultoria", () => {
    const suggestions = suggestPeopleFromHistory(
      [
        { name: "Adan Rocha", origin: "participante de reunião" },
        { name: "José Eduardo", origin: "responsável de ação" },
      ],
      ["Adan Rocha"],
    );
    const adan = suggestions.find((s) => s.normalized === "adan rocha");
    const jose = suggestions.find((s) => s.normalized === "jose eduardo");
    expect(adan?.suggestedSide).toBe("consultoria");
    expect(jose?.suggestedSide).toBeNull();
  });

  test("sem lista de consultoria, nenhuma sugestão vem com side — a tela pergunta", () => {
    const suggestions = suggestPeopleFromHistory([
      { name: "Adan Rocha", origin: "participante de reunião" },
    ]);
    expect(suggestions[0]!.suggestedSide).toBeNull();
  });

  test("lista vazia devolve nenhuma sugestão", () => {
    expect(suggestPeopleFromHistory([])).toEqual([]);
  });

  test("linha com nome vazio/só pontuação é ignorada", () => {
    const suggestions = suggestPeopleFromHistory([
      { name: "  .  ", origin: "responsável de ação" },
      { name: "Luiz", origin: "responsável de ação" },
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.normalized).toBe("luiz");
  });
});
