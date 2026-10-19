import { describe, expect, test } from "bun:test";
import {
  groupPersonErrors,
  normalizeAliasList,
  splitAliasInput,
  validatePersonForm,
  type PersonFormInput,
} from "../src/lib/client-people-form";
import type { ClientPerson } from "../src/lib/client-people";

/* ------------------------------------------------------------------ *
 * Cadastro de pessoas e apelidos por cliente — Gate C/D (19/10/2026).
 * Validação pura do formulário de pessoa, sem I/O. Mensagens em
 * português; nenhuma regra de negócio nova além das já decididas: lado
 * obrigatório sem pré-seleção, apelido só vale dentro do cliente.
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

function input(overrides: Partial<PersonFormInput> = {}): PersonFormInput {
  return {
    name: "Maria Silva",
    aliases: [],
    side: "cliente",
    role: "",
    functions: [],
    ...overrides,
  };
}

describe("normalizeAliasList — apara, remove vazios e duplicados pela normalização", () => {
  test("apara espaços e remove entradas vazias", () => {
    expect(normalizeAliasList(["  Du  ", "", "   ", "Dudu"])).toEqual(["Du", "Dudu"]);
  });

  test("duplicados pela normalização mantêm a grafia da primeira ocorrência", () => {
    expect(normalizeAliasList(["Du", "DU", "du "])).toEqual(["Du"]);
  });

  test("apelidos que normalizam para vazio (só pontuação) NÃO são removidos aqui — é erro de validação, não limpeza", () => {
    expect(normalizeAliasList([".", "Du"])).toEqual([".", "Du"]);
  });
});

describe("validatePersonForm — nome", () => {
  test("nome vazio é erro", () => {
    const errors = validatePersonForm(input({ name: "" }), []);
    expect(errors.some((e) => e.toLowerCase().includes("nome"))).toBe(true);
  });

  test("nome só com pontuação (sem letras ou números) é erro", () => {
    const errors = validatePersonForm(input({ name: " . " }), []);
    expect(errors.some((e) => e.toLowerCase().includes("nome"))).toBe(true);
  });

  test("nome válido não gera erro de nome", () => {
    const errors = validatePersonForm(input({ name: "Maria Silva" }), []);
    expect(errors.some((e) => e.toLowerCase().includes("nome"))).toBe(false);
  });
});

describe("validatePersonForm — lado", () => {
  test("lado ausente é erro", () => {
    const errors = validatePersonForm(input({ side: "" }), []);
    expect(errors.some((e) => e.toLowerCase().includes("lado"))).toBe(true);
  });

  test("lado preenchido não gera erro", () => {
    const errors = validatePersonForm(input({ side: "consultoria" }), []);
    expect(errors.some((e) => e.toLowerCase().includes("lado"))).toBe(false);
  });
});

describe("validatePersonForm — funções", () => {
  test("função fora de PERSON_FUNCTIONS é erro", () => {
    const errors = validatePersonForm(input({ functions: ["executa", "voa"] }), []);
    expect(errors.some((e) => e.includes('"voa"'))).toBe(true);
  });

  test("funções válidas não geram erro", () => {
    const errors = validatePersonForm(input({ functions: ["executa", "decide"] }), []);
    expect(errors.some((e) => e.toLowerCase().includes("função"))).toBe(false);
  });
});

describe("validatePersonForm — apelidos", () => {
  test("apelido vazio/só pontuação é erro", () => {
    const errors = validatePersonForm(input({ aliases: ["."] }), []);
    expect(errors.some((e) => e.toLowerCase().includes("apelido"))).toBe(true);
  });

  test("apelido igual ao próprio nome é erro", () => {
    const errors = validatePersonForm(input({ name: "Maria Silva", aliases: ["maria silva"] }), []);
    expect(
      errors.some(
        (e) => e.toLowerCase().includes("apelido") && e.toLowerCase().includes("próprio nome"),
      ),
    ).toBe(true);
  });

  test("apelido diferente do nome não gera esse erro", () => {
    const errors = validatePersonForm(input({ name: "Maria Silva", aliases: ["Mari"] }), []);
    expect(errors.some((e) => e.toLowerCase().includes("próprio nome"))).toBe(false);
  });
});

describe("validatePersonForm — colisão com outra pessoa do cliente", () => {
  test("nome repetido de outra pessoa é erro, citando o nome dela", () => {
    const existing = [person({ name: "Maria Silva" })];
    const errors = validatePersonForm(input({ name: "maria silva" }), existing);
    expect(errors.some((e) => e.includes("já é usado por Maria Silva"))).toBe(true);
  });

  test("apelido repetido de outra pessoa é erro, citando o nome dela", () => {
    const existing = [person({ name: "José Eduardo", aliases: ["Du"] })];
    const errors = validatePersonForm(input({ name: "Pessoa Nova", aliases: ["du"] }), existing);
    expect(errors.some((e) => e.includes("já é usado por José Eduardo"))).toBe(true);
  });

  test("edição da própria pessoa não colide consigo mesma", () => {
    const existing = [person({ id: "p1", name: "José Eduardo", aliases: ["Du"] })];
    const errors = validatePersonForm(
      input({ name: "José Eduardo", aliases: ["Du"] }),
      existing,
      "p1",
    );
    expect(errors.some((e) => e.includes("já é usado por"))).toBe(false);
  });

  test("colisão contra pessoa INATIVA também é erro (o banco não distingue)", () => {
    const existing = [person({ name: "Maria Silva", active: false })];
    const errors = validatePersonForm(input({ name: "maria silva" }), existing);
    expect(errors.some((e) => e.includes("já é usado por Maria Silva"))).toBe(true);
  });
});

describe("validatePersonForm — formulário válido devolve lista vazia", () => {
  test("sem erros quando tudo está certo", () => {
    const errors = validatePersonForm(
      input({ name: "Maria Silva", side: "cliente", functions: ["executa"], aliases: ["Mari"] }),
      [],
    );
    expect(errors).toEqual([]);
  });
});

describe("splitAliasInput — separa por vírgula e ponto e vírgula", () => {
  test("colar 'Du, Dudu; Edu' vira três apelidos", () => {
    expect(splitAliasInput("Du, Dudu; Edu")).toEqual(["Du", "Dudu", "Edu"]);
  });

  test("texto vazio entre separadores é ignorado", () => {
    expect(splitAliasInput("Du,,  ; Edu")).toEqual(["Du", "Edu"]);
  });

  test("apara cada pedaço", () => {
    expect(splitAliasInput("  Du  ,  Dudu  ")).toEqual(["Du", "Dudu"]);
  });

  test("sem separador devolve um único pedaço", () => {
    expect(splitAliasInput("Du")).toEqual(["Du"]);
  });

  test("string vazia devolve lista vazia", () => {
    expect(splitAliasInput("")).toEqual([]);
  });
});

describe("groupPersonErrors — cada erro numa única categoria, pelo início da mensagem", () => {
  test("'Informe o nome...' vai para name", () => {
    const grouped = groupPersonErrors([
      "Informe o nome da pessoa (precisa ter letras ou números).",
    ]);
    expect(grouped.name).toHaveLength(1);
    expect(grouped.side).toHaveLength(0);
  });

  test("'Selecione o lado...' vai para side", () => {
    const grouped = groupPersonErrors(["Selecione o lado: cliente, consultoria ou terceiro."]);
    expect(grouped.side).toHaveLength(1);
  });

  test("'Função inválida...' vai para functions", () => {
    const grouped = groupPersonErrors(['Função inválida: "voa".']);
    expect(grouped.functions).toHaveLength(1);
  });

  test("'Apelido ...' vai para aliases", () => {
    const grouped = groupPersonErrors(['Apelido "." precisa ter letras ou números.']);
    expect(grouped.aliases).toHaveLength(1);
  });

  test("'Apelido ... não pode ser igual ao próprio nome' vai SÓ para aliases, não para general", () => {
    const grouped = groupPersonErrors([
      'Apelido "Maria Silva" não pode ser igual ao próprio nome.',
    ]);
    expect(grouped.aliases).toHaveLength(1);
    expect(grouped.general).toHaveLength(0);
  });

  test("'Nome ou apelido já é usado por ...' vai para general", () => {
    const grouped = groupPersonErrors(["Nome ou apelido já é usado por Maria Silva."]);
    expect(grouped.general).toHaveLength(1);
  });

  test("mensagem desconhecida vai para general", () => {
    const grouped = groupPersonErrors(["Algo inesperado aconteceu."]);
    expect(grouped.general).toHaveLength(1);
  });

  test("várias mensagens, cada uma na sua categoria, nenhuma duplicada em duas", () => {
    const grouped = groupPersonErrors([
      "Informe o nome da pessoa (precisa ter letras ou números).",
      "Selecione o lado: cliente, consultoria ou terceiro.",
      'Função inválida: "voa".',
      'Apelido "." precisa ter letras ou números.',
      "Nome ou apelido já é usado por Maria Silva.",
    ]);
    expect(grouped.name).toHaveLength(1);
    expect(grouped.side).toHaveLength(1);
    expect(grouped.functions).toHaveLength(1);
    expect(grouped.aliases).toHaveLength(1);
    expect(grouped.general).toHaveLength(1);
  });
});
