import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildKnownClientNames, hasOwnerConflict, matchAction } from "../src/lib/deduplication";
import {
  canonicalOwnerName,
  canonicalizeParticipantNames,
  type ClientPerson,
} from "../src/lib/client-people";
import type { ActionItem } from "../src/lib/domain";

/* ------------------------------------------------------------------ *
 * Backlog B19 (17/10/2026) — Aline e Alice, da Medeiros, são a mesma
 * pessoa (grafia correta: Alice).
 *
 * Gate "remove OWNER_ALIAS_SEED" (19/10/2026) — a lista fixa de apelidos
 * por cliente (este era um dos dois exemplos: Medeiros, "Aline" = "Alice")
 * foi removida. Quem unifica grafias divergentes agora é o cadastro de
 * pessoas (canonicalOwnerName/canonicalizeParticipantNames), ANTES de
 * qualquer comparação de duplicidade ou montagem de knownNames — nunca
 * mais resolveOwnerAlias/OWNER_ALIAS_SEED, que não existem mais. Os
 * testes abaixo que dependiam da tabela fixa foram reescritos para
 * simular esse mesmo cadastro (uma pessoa Alice com apelido Aline).
 * ------------------------------------------------------------------ */

const MEDEIROS_CLIENT_ID = "7d2de5e9-24ef-4c6d-b24c-ae07595e777e";

function alicePerson(overrides: Partial<ClientPerson> = {}): ClientPerson {
  return {
    id: "p1",
    client_id: MEDEIROS_CLIENT_ID,
    name: "Alice",
    aliases: ["Aline"],
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

const action = (description: string, patch: Partial<ActionItem> = {}): ActionItem => ({
  id: patch.id ?? "a1",
  client_id: patch.client_id ?? "c1",
  meeting_id: patch.meeting_id ?? null,
  description,
  owner_name: patch.owner_name ?? null,
  deadline: patch.deadline ?? null,
  priority: patch.priority ?? "média",
  status: patch.status ?? "em andamento",
  erp_area: patch.erp_area ?? null,
  evidence: patch.evidence ?? null,
  created_at: patch.created_at ?? "",
  updated_at: patch.updated_at ?? "",
  embedding: patch.embedding ?? null,
});

describe("(a) Alice <-> Aline — agora via canonicalOwnerName (cadastro), não mais resolveOwnerAlias", () => {
  test("canonicalOwnerName resolve 'Aline' para 'Alice' só quando essa pessoa está cadastrada", () => {
    expect(canonicalOwnerName("Aline", [alicePerson()])).toBe("Alice");
  });

  test("sem a pessoa cadastrada (lista vazia), 'Aline' não é alterado", () => {
    expect(canonicalOwnerName("Aline", [])).toBe("Aline");
  });

  test("canonicalOwnerName não filtra por client_id — isolar por cliente é responsabilidade de quem monta `people`", () => {
    // Ver clientPeopleQuery/clientId em reuniao-inteligente.tsx e
    // MeetingAnalysisDialog.tsx: quem chama já passa só as pessoas do cliente
    // certo. Por isso a mesma pessoa, com client_id de outro cliente, ainda
    // resolve aqui — essa função não sabe nem precisa saber de isolamento.
    expect(
      canonicalOwnerName("Aline", [alicePerson({ client_id: "outro-cliente-qualquer" })]),
    ).toBe("Alice");
  });

  test("'Aline' vs 'Alice' SEM o cadastro: conflito real (não sabemos que são a mesma pessoa)", () => {
    expect(hasOwnerConflict("Aline", "Alice")).toBe(true);
  });

  test("'Aline' vs 'Alice' COM o cadastro: sem conflito quando os dois já chegam canonizados ('Alice' dos dois lados)", () => {
    const people = [alicePerson()];
    const incoming = canonicalOwnerName("Aline", people);
    const existing = canonicalOwnerName("Alice", people);
    expect(hasOwnerConflict(incoming, existing)).toBe(false);
  });

  test("ação de 16/10 com responsável 'Alice' casa com ação existente de 'Aline' sem 'conflito material', quando os dois já chegam canonizados", () => {
    const people = [alicePerson()];
    const match = matchAction(
      {
        description: "Enviar os extratos bancários dos meses 8 e 9 da conta da empresa",
        owner_name: canonicalOwnerName("Alice", people),
      },
      [
        action(
          "Enviar os extratos bancários dos meses 8 e 9 da conta da empresa para o consultor",
          { owner_name: canonicalOwnerName("Aline", people), client_id: MEDEIROS_CLIENT_ID },
        ),
      ],
    );
    expect(match.reason).not.toContain("conflito material");
    expect(match.type).not.toBe("POSSIBLE_DUPLICATE");
  });
});

describe("(b) sem fuzzy-match: nomes parecidos continuam diferentes sem apelido cadastrado", () => {
  test("'Ana' e 'Anna' não são unificados (ninguém cadastrado com esse apelido)", () => {
    expect(hasOwnerConflict("Ana", "Anna")).toBe(true);
  });

  test("o cadastro da Alice não afeta 'Ana'/'Anna' — só o apelido explícito 'Aline' bate", () => {
    const people = [alicePerson()];
    expect(canonicalOwnerName("Ana", people)).toBe("Ana");
    expect(canonicalOwnerName("Anna", people)).toBe("Anna");
  });
});

describe("(c) buildKnownClientNames — sem duplicados, sem vazios, limite 20", () => {
  test("Aline e Alice JUNTAS, sem canonicalizar antes: buildKnownClientNames não as unifica mais (não conhece o cadastro) — ficam as duas", () => {
    const names = buildKnownClientNames(["Aline", "Alice"], MEDEIROS_CLIENT_ID);
    expect(names).toEqual(["Aline", "Alice"]);
  });

  test("equivalente: canonicalizeParticipantNames (cadastro) UNIFICA antes de chegar em buildKnownClientNames — mesma garantia de hoje, numa camada anterior", () => {
    const people = [alicePerson()];
    const canonicalized = canonicalizeParticipantNames(["Aline", "Alice"], people);
    expect(canonicalized).toEqual(["Alice", "Alice"]);
    const names = buildKnownClientNames(canonicalized, MEDEIROS_CLIENT_ID);
    expect(names).toEqual(["Alice"]);
  });

  test("nomes repetidos e vazios: deduplica e descarta vazio/rótulo genérico", () => {
    const names = buildKnownClientNames(
      ["João Silva", "joão", "", null, undefined, "Speaker 1", "Equipe operacional"],
      "c1",
    );
    expect(names).toEqual(["João Silva"]);
  });

  test("nome com qualificador entre parênteses e multi-responsável separado por '/'", () => {
    const names = buildKnownClientNames(["Maria (financeiro)/Pedro"], "c1");
    expect(names).toEqual(["Maria", "Pedro"]);
  });

  test("limite de 20 nomes", () => {
    const raw = Array.from({ length: 30 }, (_, i) => `Pessoa${i}`);
    const names = buildKnownClientNames(raw, "c1");
    expect(names.length).toBe(20);
  });

  test("clientId não muda mais o resultado (parâmetro sem uso desde a remoção de OWNER_ALIAS_SEED, mantido na assinatura — ver reuniao-inteligente.tsx, fora do escopo deste gate)", () => {
    // buildKnownClientNames nunca filtrou por client_id internamente — quem
    // chama já passa só os nomes do cliente da reunião (ver
    // clientKnownNamesQuery e o filtro `a.client_id === clientId` em
    // reuniao-inteligente.tsx). O parâmetro clientId em si só servia pra
    // resolver o alias fixo, agora removido — por isso dois clientIds
    // diferentes devolvem exatamente o mesmo resultado.
    expect(buildKnownClientNames(["Aline"], "cliente-qualquer")).toEqual(["Aline"]);
    expect(buildKnownClientNames(["Aline"], MEDEIROS_CLIENT_ID)).toEqual(["Aline"]);
  });
});

describe("(d) SYSTEM_PROMPT: bloco e regra de nomes conhecidos", () => {
  const source = readFileSync(
    resolve(import.meta.dir, "../src/lib/intelligent-meeting.server.ts"),
    "utf8",
  );

  test("a regra de nomes conhecidos está no SYSTEM_PROMPT", () => {
    expect(source).toContain("Nomes já conhecidos deste cliente");
    expect(source).toContain(
      "Se o falante for CLARAMENTE uma das pessoas da lista (nome falado parecido com o nome conhecido E o contexto da fala é compatível com essa pessoa), use a grafia exata da lista.",
    );
    expect(source).toContain(
      'Se o nome falado não corresponder claramente a nenhum nome da lista, ou houver dúvida entre dois nomes da lista, deixe speaker_map[].name "" com confidence "baixa"',
    );
  });

  test("sem lista (cliente novo), o comportamento atual não muda — regra explícita no prompt", () => {
    expect(source).toContain(
      "Sem essa lista no cabeçalho (cliente novo ou ainda não identificado), siga normalmente a regra de speaker_map acima, sem nenhuma mudança de comportamento.",
    );
  });

  test("o cabeçalho só inclui a linha de nomes conhecidos quando a lista não está vazia (omitida sem nomes)", () => {
    expect(source).toContain(
      'data.knownNames.length\n        ? `Nomes já conhecidos deste cliente: ${JSON.stringify(data.knownNames)}`\n        : "",',
    );
  });

  test("analyzeInput aceita knownNames, com default vazio (sem quebrar chamadas antigas)", () => {
    expect(source).toContain("knownNames: z.array(z.string()).default([]),");
  });
});

describe("(e) cliente sem pessoa cadastrada: comportamento atual não regrediu", () => {
  test("Grupo Erinho (Ada/Adam): equivalente ao alias antigo, agora via cadastro — não interfere no cliente da Medeiros", () => {
    const erinhoPerson: ClientPerson = {
      ...alicePerson(),
      id: "p2",
      client_id: "9943b0f4-5220-4297-9f17-7fee64280da5",
      name: "Adam",
      aliases: ["Ada"],
    };
    expect(canonicalOwnerName("Ada", [erinhoPerson])).toBe("Adam");
    // A pessoa do Erinho não interfere na canonização de "Aline" da Medeiros.
    expect(canonicalOwnerName("Aline", [erinhoPerson])).toBe("Aline");
  });

  test("nomes reais e distintos, sem ninguém cadastrado: continuam conflitando", () => {
    expect(hasOwnerConflict("Maria", "João")).toBe(true);
  });
});
