import { describe, expect, test } from "bun:test";
import {
  buildPeoplePromptContext,
  canonicalizeAnalysisOwners,
  canonicalizeParticipantNames,
  MAX_ALIASES_IN_PROMPT,
  MAX_PEOPLE_IN_PROMPT,
  MAX_ROLE_CHARS_IN_PROMPT,
  type ClientPerson,
} from "../src/lib/client-people";
import { parseAnalysis } from "../src/lib/meeting-analysis";

/* ------------------------------------------------------------------ *
 * Cadastro de pessoas e apelidos por cliente — Gate E (19/10/2026): a IA
 * e o preview passam a usar o cadastro. Funções puras, sem I/O.
 * ------------------------------------------------------------------ */

function person(overrides: Partial<ClientPerson> = {}): ClientPerson {
  return {
    id: "p1",
    client_id: "c1",
    name: "José Eduardo",
    aliases: ["Du", "Dudu", "Edu"],
    side: "cliente",
    role: "Sócio",
    functions: ["decide"],
    active: true,
    created_by: null,
    created_at: "2026-10-19T00:00:00Z",
    updated_at: "2026-10-19T00:00:00Z",
    ...overrides,
  };
}

describe("buildPeoplePromptContext — só ativas, com limites", () => {
  test("lista vazia devolve []", () => {
    expect(buildPeoplePromptContext([])).toEqual([]);
  });

  test("pessoa inativa é excluída", () => {
    expect(buildPeoplePromptContext([person({ active: false })])).toEqual([]);
  });

  test("campos compactos: name, aliases, side, role, functions", () => {
    const [entry] = buildPeoplePromptContext([person()]);
    expect(entry).toEqual({
      name: "José Eduardo",
      aliases: ["Du", "Dudu", "Edu"],
      side: "cliente",
      role: "Sócio",
      functions: ["decide"],
    });
  });

  test(`no máximo ${MAX_PEOPLE_IN_PROMPT} pessoas, as PRIMEIRAS da lista`, () => {
    const many = Array.from({ length: MAX_PEOPLE_IN_PROMPT + 10 }, (_, i) =>
      person({ id: `p${i}`, name: `Pessoa ${i}` }),
    );
    const result = buildPeoplePromptContext(many);
    expect(result).toHaveLength(MAX_PEOPLE_IN_PROMPT);
    expect(result[0]!.name).toBe("Pessoa 0");
    expect(result[MAX_PEOPLE_IN_PROMPT - 1]!.name).toBe(`Pessoa ${MAX_PEOPLE_IN_PROMPT - 1}`);
  });

  test(`no máximo ${MAX_ALIASES_IN_PROMPT} apelidos por pessoa, os PRIMEIROS`, () => {
    const aliases = Array.from({ length: MAX_ALIASES_IN_PROMPT + 5 }, (_, i) => `Apelido${i}`);
    const [entry] = buildPeoplePromptContext([person({ aliases })]);
    expect(entry!.aliases).toHaveLength(MAX_ALIASES_IN_PROMPT);
    expect(entry!.aliases[0]).toBe("Apelido0");
  });

  test(`cargo cortado em ${MAX_ROLE_CHARS_IN_PROMPT} caracteres`, () => {
    const longRole = "x".repeat(MAX_ROLE_CHARS_IN_PROMPT + 20);
    const [entry] = buildPeoplePromptContext([person({ role: longRole })]);
    expect(entry!.role).toHaveLength(MAX_ROLE_CHARS_IN_PROMPT);
  });

  test("cargo nulo vira string vazia", () => {
    const [entry] = buildPeoplePromptContext([person({ role: null })]);
    expect(entry!.role).toBe("");
  });

  test("remove quebras de linha e caracteres de controle do nome, cargo e apelidos", () => {
    const [entry] = buildPeoplePromptContext([
      person({
        name: "José\nEduardo",
        role: "Sócio\tadministrador",
        aliases: ["Du\r\nDudu"],
      }),
    ]);
    expect(entry!.name).toBe("José Eduardo");
    expect(entry!.role).toBe("Sócio administrador");
    expect(entry!.aliases[0]).toBe("Du Dudu");
  });
});

describe("canonicalizeAnalysisOwners — troca owner_name/owner/speaker_map.name/action_owner pelo nome canônico", () => {
  function analysisWith(overrides: Record<string, unknown>) {
    const result = parseAnalysis(overrides);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    return result.analysis;
  }

  test("'Dudu' vira 'José Eduardo' em ação, decisão, falante — campos cobertos", () => {
    const analysis = analysisWith({
      meeting: { action_owner: "Dudu" },
      actions: [{ description: "Enviar relatório", owner_name: "Dudu" }],
      decisions: [{ title: "Aprovar orçamento", owner: "dudu" }],
      speaker_map: [{ label: "Speaker 1", name: "DUDU", role: "cliente", confidence: "alta" }],
    });
    const people = [person()];
    const result = canonicalizeAnalysisOwners(analysis, people);
    expect(result.meeting.action_owner).toBe("José Eduardo");
    expect(result.actions[0]!.owner_name).toBe("José Eduardo");
    expect(result.decisions[0]!.owner).toBe("José Eduardo");
    expect(result.speaker_map[0]!.name).toBe("José Eduardo");
  });

  test("nome desconhecido fica intacto", () => {
    const analysis = analysisWith({
      actions: [{ description: "Enviar relatório", owner_name: "Fulano de Tal" }],
    });
    const result = canonicalizeAnalysisOwners(analysis, [person()]);
    expect(result.actions[0]!.owner_name).toBe("Fulano de Tal");
  });

  test("ambíguo (duas pessoas ativas com o mesmo apelido) fica intacto", () => {
    const analysis = analysisWith({
      actions: [{ description: "Enviar relatório", owner_name: "Ana" }],
    });
    const a = person({ id: "a", name: "Ana Paula", aliases: ["Ana"] });
    const b = person({ id: "b", name: "Ana Clara", aliases: ["Ana"] });
    const result = canonicalizeAnalysisOwners(analysis, [a, b]);
    expect(result.actions[0]!.owner_name).toBe("Ana");
  });

  test("pessoa inativa é ignorada (não resolve)", () => {
    const analysis = analysisWith({
      actions: [{ description: "Enviar relatório", owner_name: "Dudu" }],
    });
    const result = canonicalizeAnalysisOwners(analysis, [person({ active: false })]);
    expect(result.actions[0]!.owner_name).toBe("Dudu");
  });

  test("sem pessoas, devolve a MESMA referência (nada muda)", () => {
    const analysis = analysisWith({
      actions: [{ description: "Enviar relatório", owner_name: "Dudu" }],
    });
    const result = canonicalizeAnalysisOwners(analysis, []);
    expect(result).toBe(analysis);
  });

  test("nenhum outro campo muda (description, evidence, priority preservados)", () => {
    const analysis = analysisWith({
      actions: [
        {
          description: "Enviar relatório financeiro",
          owner_name: "Dudu",
          priority: "alta",
          evidence: "eu mando o relatório",
        },
      ],
    });
    const result = canonicalizeAnalysisOwners(analysis, [person()]);
    expect(result.actions[0]!.description).toBe("Enviar relatório financeiro");
    expect(result.actions[0]!.priority).toBe("alta");
    expect(result.actions[0]!.evidence).toBe("eu mando o relatório");
  });

  test("a entrada original não é alterada (imutabilidade)", () => {
    const analysis = analysisWith({
      actions: [{ description: "Enviar relatório", owner_name: "Dudu" }],
    });
    const before = JSON.stringify(analysis);
    canonicalizeAnalysisOwners(analysis, [person()]);
    expect(JSON.stringify(analysis)).toBe(before);
  });
});

describe("canonicalizeParticipantNames — mesma troca, para uma lista solta de nomes (ex.: identification.participants)", () => {
  test("apelido conhecido vira nome canônico; desconhecido fica intacto", () => {
    const result = canonicalizeParticipantNames(["Dudu", "Fulano de Tal"], [person()]);
    expect(result).toEqual(["José Eduardo", "Fulano de Tal"]);
  });

  test("sem pessoas, devolve a mesma lista", () => {
    const participants = ["Dudu"];
    expect(canonicalizeParticipantNames(participants, [])).toBe(participants);
  });
});
