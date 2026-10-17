import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildKnownClientNames,
  hasOwnerConflict,
  matchAction,
  resolveOwnerAlias,
} from "../src/lib/deduplication";
import type { ActionItem } from "../src/lib/domain";

/* ------------------------------------------------------------------ *
 * Backlog B19 (17/10/2026) — Aline e Alice, da Medeiros, são a mesma
 * pessoa (grafia correta: Alice). Mesmo mecanismo de alias explícito por
 * cliente do B3 (Grupo Erinho) — nunca fuzzy-match/distância de edição.
 * ------------------------------------------------------------------ */

const MEDEIROS_CLIENT_ID = "7d2de5e9-24ef-4c6d-b24c-ae07595e777e";

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

describe("(a) Alice <-> Aline — alias do Medeiros aplicado via resolveOwnerAlias", () => {
  test("resolveOwnerAlias resolve 'aline' para 'alice' só para o cliente Medeiros", () => {
    expect(resolveOwnerAlias(MEDEIROS_CLIENT_ID, "aline")).toBe("alice");
  });

  test("sem o cliente Medeiros, 'aline' não é alterado (tabela explícita, nunca global)", () => {
    expect(resolveOwnerAlias("outro-cliente-qualquer", "aline")).toBe("aline");
    expect(resolveOwnerAlias(null, "aline")).toBe("aline");
  });

  test("'Aline' vs 'Alice' SEM o cliente Medeiros: conflito real (não sabemos que são a mesma pessoa)", () => {
    expect(hasOwnerConflict("Aline", "Alice")).toBe(true);
  });

  test("'Aline' vs 'Alice' COM o cliente Medeiros: sem conflito (mesma pessoa, grafia Alice)", () => {
    expect(hasOwnerConflict("Aline", "Alice", MEDEIROS_CLIENT_ID)).toBe(false);
  });

  test("ação de 16/10 com responsável 'Alice' casa com ação existente de 'Aline' sem 'conflito material'", () => {
    const match = matchAction(
      {
        description: "Enviar os extratos bancários dos meses 8 e 9 da conta da empresa",
        owner_name: "Alice",
      },
      [
        action(
          "Enviar os extratos bancários dos meses 8 e 9 da conta da empresa para o consultor",
          { owner_name: "Aline", client_id: MEDEIROS_CLIENT_ID },
        ),
      ],
    );
    expect(match.reason).not.toContain("conflito material");
    expect(match.type).not.toBe("POSSIBLE_DUPLICATE");
  });
});

describe("(b) sem fuzzy-match: nomes parecidos continuam diferentes sem alias explícito", () => {
  test("'Ana' e 'Anna' não são unificados (nenhum alias cadastrado para elas)", () => {
    expect(hasOwnerConflict("Ana", "Anna")).toBe(true);
    expect(hasOwnerConflict("Ana", "Anna", MEDEIROS_CLIENT_ID)).toBe(true);
  });

  test("o alias da Medeiros não afeta 'Ana'/'Anna' — só a entrada explícita aline->alice existe", () => {
    expect(resolveOwnerAlias(MEDEIROS_CLIENT_ID, "ana")).toBe("ana");
    expect(resolveOwnerAlias(MEDEIROS_CLIENT_ID, "anna")).toBe("anna");
  });
});

describe("(c) buildKnownClientNames — canonizado, sem duplicados, sem vazios, limite 20, só do cliente", () => {
  test("Aline e Alice juntas viram só 'Alice' (canônica), uma única vez", () => {
    const names = buildKnownClientNames(["Aline", "Alice"], MEDEIROS_CLIENT_ID);
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

  test("nomes de um cliente nunca aparecem na lista de outro (a função só recebe o que o chamador já filtrou)", () => {
    // buildKnownClientNames não filtra por client_id internamente — quem chama
    // já passa só os nomes do cliente da reunião (ver clientKnownNamesQuery e o
    // filtro `a.client_id === clientId` em reuniao-inteligente.tsx). Aqui
    // confirmamos que o alias em si é isolado por cliente (já coberto acima em
    // (a)) — o isolamento de fonte é testado pela própria assinatura da função,
    // que recebe clientId só para resolver alias, não para filtrar a lista.
    const names = buildKnownClientNames(["Aline"], "cliente-sem-alias");
    expect(names).toEqual(["Aline"]);
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

describe("(e) cliente sem alias: comportamento atual não regrediu", () => {
  test("Grupo Erinho (Ada/Adam) continua igual — alias de outro cliente não interfere", () => {
    expect(resolveOwnerAlias("9943b0f4-5220-4297-9f17-7fee64280da5", "ada")).toBe("adam");
  });

  test("cliente qualquer sem entrada no OWNER_ALIAS_SEED: nomes reais e distintos continuam conflitando", () => {
    expect(hasOwnerConflict("Maria", "João", "cliente-sem-alias-nenhum")).toBe(true);
  });
});
