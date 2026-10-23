import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Cadastro de pessoas e apelidos por cliente — Gate C/D (19/10/2026).
 * Teste ESTÁTICO por inspeção de código-fonte, padrão dos demais gates
 * desta tela (ver indicator-tela-wiring.test.ts). Sem banco, sem mock
 * de rede — só garante que a UI está ligada do jeito combinado e que
 * nada fora do escopo foi tocado.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const routeSource = read("src/routes/_authenticated/clientes/$clientId.tsx");
const personDialogSource = read("src/components/painel/PersonDialog.tsx");
const importDialogSource = read("src/components/painel/PeopleImportDialog.tsx");
const dataSource = read("src/lib/client-people-data.ts");

describe("aba Pessoas — 5ª aba do Tabs existente", () => {
  test("TabsTrigger de Pessoas vem depois de Reuniões, Ações, Riscos e Oportunidades", () => {
    const order = ["reunioes", "acoes", "riscos", "oportunidades", "pessoas"].map((value) =>
      routeSource.indexOf(`<TabsTrigger value="${value}">`),
    );
    for (const idx of order) expect(idx).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]!);
    }
  });

  test('TabsContent value="pessoas" existe, com botões Nova pessoa e Importar do histórico', () => {
    const idx = routeSource.indexOf('<TabsContent value="pessoas"');
    expect(idx).toBeGreaterThan(-1);
    const block = routeSource.slice(idx, idx + 2500);
    expect(block).toContain("Nova pessoa");
    expect(block).toContain("Importar do histórico");
  });

  test("estado vazio claro quando não há pessoa cadastrada", () => {
    expect(routeSource).toContain("Nenhuma pessoa cadastrada ainda");
    expect(routeSource).toContain("Use Importar do histórico ou Nova pessoa.");
  });

  test("lista mostra selo do lado, função (cargo), funções, apelidos e Inativa", () => {
    const idx = routeSource.indexOf('<TabsContent value="pessoas"');
    const block = routeSource.slice(idx, idx + 4000);
    expect(block).toContain("PERSON_SIDE_LABEL[p.side]");
    expect(block).toContain("p.role");
    expect(block).toContain("PERSON_FUNCTION_LABEL[fn]");
    expect(block).toContain("p.aliases.map");
    expect(block).toContain(">Inativa<");
  });
});

describe("CORREÇÃO 1 — apelido digitado e não confirmado não se perde no submit", () => {
  test("submit monta finalAliases a partir de form.aliases + splitAliasInput(aliasDraft), ANTES de validar e gravar", () => {
    const idx = personDialogSource.indexOf("function submit(e: React.FormEvent) {");
    expect(idx).toBeGreaterThan(-1);
    const block = personDialogSource.slice(idx, idx + 600);
    expect(block).toContain("splitAliasInput(aliasDraft)");
    expect(block).toContain("normalizeAliasList([...form.aliases, ...draftPieces])");
    const draftIdx = block.indexOf("draftPieces");
    const validateIdx = block.indexOf("validatePersonForm(");
    const mutateIdx = block.indexOf("mutation.mutate(finalAliases)");
    expect(draftIdx).toBeGreaterThan(-1);
    expect(draftIdx).toBeLessThan(validateIdx);
    expect(validateIdx).toBeLessThan(mutateIdx);
  });
});

describe("CORREÇÃO 2 — separar por vírgula E ponto e vírgula, com pedaços vazios ignorados", () => {
  test("addAliasFromDraft usa splitAliasInput (não só trim de um texto único)", () => {
    const idx = personDialogSource.indexOf("function addAliasFromDraft()");
    expect(idx).toBeGreaterThan(-1);
    const block = personDialogSource.slice(idx, idx + 250);
    expect(block).toContain("splitAliasInput(aliasDraft)");
  });

  test("onChange do campo de apelido separa por vírgula/ponto e vírgula e deixa só o último pedaço no campo", () => {
    const idx = personDialogSource.indexOf('id="person-alias"');
    expect(idx).toBeGreaterThan(-1);
    const block = personDialogSource.slice(idx, idx + 700);
    expect(block).toContain("/[,;]/");
    expect(block).toContain("const last = parts.pop()");
    expect(block).toContain('set("aliases", [...form.aliases, ...completed])');
    expect(block).toContain('setAliasDraft(last.replace(/^\\s+/, ""))');
  });
});

describe("CORREÇÃO 3 — erros por campo, cada um UMA vez (groupPersonErrors)", () => {
  test("PersonDialog usa groupPersonErrors, não mais errorsFor por palavra-chave", () => {
    expect(personDialogSource).toContain("groupPersonErrors");
    expect(personDialogSource).toContain("const fieldErrors = groupPersonErrors(errors);");
    expect(personDialogSource).not.toContain("errorsFor");
  });

  test("cada campo lê só a categoria própria (name/side/functions/aliases), e general aparece uma vez no rodapé", () => {
    expect(personDialogSource).toContain("fieldErrors.name.map(");
    expect(personDialogSource).toContain("fieldErrors.side.map(");
    expect(personDialogSource).toContain("fieldErrors.functions.map(");
    expect(personDialogSource).toContain("fieldErrors.aliases.map(");
    expect(personDialogSource).toContain("fieldErrors.general.map(");
  });
});

describe("CORREÇÃO 4 — apelidos gravados já normalizados", () => {
  test("create e update recebem finalAliases, que já passou por normalizeAliasList no submit", () => {
    expect(personDialogSource).toContain("aliases: finalAliases,");
    // Garante que o form.aliases cru (sem normalizar) não é o que vai pro banco.
    expect(personDialogSource).not.toContain("aliases: form.aliases,");
  });
});

describe("CORREÇÃO 5 — lado inicial da importação respeita suggestedSide", () => {
  test("defaultSideFor só pré-seleciona consultoria quando suggestedSide vier assim; vazio nos demais", () => {
    const idx = importDialogSource.indexOf("function defaultSideFor(");
    expect(idx).toBeGreaterThan(-1);
    const block = importDialogSource.slice(idx, idx + 200);
    expect(block).toContain('s.suggestedSide === "consultoria" ? "consultoria" : "";');
  });

  test("rowState usa defaultSideFor como valor inicial (não mais sempre vazio)", () => {
    expect(importDialogSource).toContain(
      "selected.get(s.normalized) ?? { checked: false, side: defaultSideFor(s) };",
    );
  });
});

describe("CORREÇÃO 6 — botão de editar pessoa com aria-label e title", () => {
  test('o botão ganha aria-label="Editar pessoa" e title="Editar"', () => {
    const idx = routeSource.indexOf("setEditingPerson(p);");
    expect(idx).toBeGreaterThan(-1);
    const block = routeSource.slice(Math.max(0, idx - 300), idx);
    expect(block).toContain('aria-label="Editar pessoa"');
    expect(block).toContain('title="Editar"');
  });
});

describe("Nada é criado sem clique — gravação só dentro de handlers/mutationFn", () => {
  test("client-people-data.ts não executa create/update/delete no escopo do módulo", () => {
    // As três funções são declaradas como `export async function ...` — nunca
    // chamadas soltas fora de uma função (o que seria execução ao importar).
    expect(dataSource).not.toMatch(
      /^\s*(createClientPerson|updateClientPerson|deleteClientPerson)\(/m,
    );
  });

  test("PersonDialog só chama as gravações dentro de mutationFn (useMutation)", () => {
    const idx = personDialogSource.indexOf("const mutation = useMutation({");
    expect(idx).toBeGreaterThan(-1);
    const block = personDialogSource.slice(idx, idx + 700);
    expect(block).toContain("mutationFn: async (finalAliases: string[]) => {");
    expect(block).toContain("updateClientPerson(person.id");
    expect(block).toContain("createClientPerson({");
  });

  test("PeopleImportDialog só chama createClientPerson dentro de importSelected, por clique do botão", () => {
    const fnIdx = importDialogSource.indexOf("async function importSelected()");
    expect(fnIdx).toBeGreaterThan(-1);
    const fnBlock = importDialogSource.slice(fnIdx, importDialogSource.indexOf("\n}", fnIdx));
    expect(fnBlock).toContain("createClientPerson({");
    expect(importDialogSource).toContain("onClick={() => void importSelected()}");
  });
});

describe("'Adicionar selecionadas' exige lado em TODAS as marcadas", () => {
  test("canImport só fica true quando toda linha marcada (checked) também tem side preenchido", () => {
    expect(importDialogSource).toContain(
      "const canImport = checkedRows.length > 0 && checkedRows.every((s) => rowState(s).side);",
    );
  });

  test("o botão usa canImport no disabled", () => {
    expect(importDialogSource).toContain("disabled={!canImport || importing}");
  });
});

describe("Excluir só para administrador", () => {
  test("o botão Excluir do PersonDialog só renderiza com person && isAdmin", () => {
    expect(personDialogSource).toContain("{person && isAdmin ? (");
  });

  test("o ConfirmDeleteDialog também só monta com person && isAdmin (defesa em profundidade)", () => {
    const occurrences = personDialogSource.split("person && isAdmin").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  test("useAccess (isAdmin) é importado e usado no PersonDialog", () => {
    expect(personDialogSource).toContain('import { useAccess } from "@/lib/auth/access";');
    expect(personDialogSource).toContain("const { isAdmin } = useAccess();");
  });
});

describe("Sem cor nova e sem HTML não sanitizado", () => {
  const newFiles = [routeSource, personDialogSource, importDialogSource];

  test("nenhum arquivo novo/tocado usa dangerouslySetInnerHTML", () => {
    for (const source of newFiles) {
      expect(source).not.toContain("dangerouslySetInnerHTML");
    }
  });

  test("nenhuma classe de cor fora do tema (hex ou paletas Tailwind cruas)", () => {
    const colorPattern =
      /#[0-9a-fA-F]{3,8}\b|bg-(red|green|blue|yellow|purple|pink|indigo|teal|orange)-[0-9]|text-(red|green|blue|yellow|purple|pink|indigo|teal|orange)-[0-9]/;
    for (const source of newFiles) {
      expect(source).not.toMatch(colorPattern);
    }
  });
});

/**
 * `git diff --name-only origin/main` só cobre arquivos já rastreados — um
 * arquivo novo (como uma migration adicionada por engano) apareceria como
 * untracked, não nesse diff. Por isso combinamos com `git status --porcelain`
 * (que lista untracked) pra cobrir os dois casos.
 */
function changedOrNewPaths(): string {
  let out = "";
  try {
    out += execSync("git diff --name-only origin/main", { cwd: root }).toString();
  } catch {
    /* sem origin/main alcançável neste ambiente — segue só com status */
  }
  try {
    out += execSync("git status --porcelain", { cwd: root }).toString();
  } catch {
    /* ambiente sem git — nada a somar */
  }
  return out;
}

describe("Escopo do gate — nada fora do combinado foi tocado", () => {
  test("nenhuma migration nova nesta branch (comparado com origin/main)", () => {
    // Exceção explícita: migration reconciliada com a produção (já aplicada lá).
    // Qualquer OUTRA migration nova continua proibida.
    const ALLOWED_MIGRATIONS = [
      "supabase/migrations/20260927203713_add_project_context_erp_summaries.sql",
    ];
    const changed = ALLOWED_MIGRATIONS.reduce(
      (acc, file) => acc.split(file).join(""),
      changedOrNewPaths(),
    );
    expect(changed).not.toMatch(/supabase\/migrations\//);
  });

  // intelligent-meeting.server.ts e reuniao-inteligente.tsx eram fora do
  // escopo do Gate C/D (daqui) — passaram a ser tocados de propósito pelo
  // Gate E (19/10/2026, cadastro de pessoas na IA e no preview), que tem
  // sua própria checagem de escopo em client-people-ia-wiring.test.ts.
  // deduplication.ts era fora do escopo do Gate C/D e do Gate E/F — passou a
  // ser tocado de propósito pelo gate "remove OWNER_ALIAS_SEED" (19/10/2026),
  // que tem sua própria checagem de escopo (ver owner-normalization.test.ts
  // e known-client-names.test.ts).

  test("health.ts e src/integrations/* não foram tocados neste gate", () => {
    const changed = changedOrNewPaths();
    expect(changed).not.toContain("health.ts");
    expect(changed).not.toMatch(/src\/integrations\//);
  });
});
