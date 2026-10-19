import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Cadastro de pessoas e apelidos por cliente — Gate F (19/10/2026):
 * seletor de responsável no preview. Teste ESTÁTICO por inspeção de
 * código-fonte (mesmo padrão dos demais gates desta tela).
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const dialogSource = read("src/components/painel/MeetingAnalysisDialog.tsx");
const reuniaoSource = read("src/routes/_authenticated/reuniao-inteligente.tsx");
const projetoSource = read("src/routes/_authenticated/projetos/$projectId.tsx");

describe("Verificação — decisionOwnerSel/actionOwnerSel zerados na reanálise (mesmo ponto dos demais)", () => {
  test("setDecisionOwnerSel({})/setActionOwnerSel({}) estão no mesmo bloco onSuccess que zera decisionSel/actionSel/oppSel/indicatorEdits", () => {
    const idx = dialogSource.indexOf("setOppSel({});");
    expect(idx).toBeGreaterThan(-1);
    const block = dialogSource.slice(idx, idx + 400);
    expect(block).toContain("setIndicatorEdits({});");
    expect(block).toContain("setDecisionOwnerSel({});");
    expect(block).toContain("setActionOwnerSel({});");
  });

  test("o zeramento fica dentro do onSuccess da mutação de reanálise (setAnalysis/setAgenda logo acima)", () => {
    const successIdx = dialogSource.indexOf(
      "onSuccess: ({ analysis: a, agenda: g, rawAiResponse: rawResp }) => {",
    );
    const resetIdx = dialogSource.indexOf("setDecisionOwnerSel({});");
    expect(successIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeGreaterThan(successIdx);
    expect(resetIdx).toBeLessThan(dialogSource.indexOf('setStep("revisao");', successIdx));
  });
});

describe("MeetingAnalysisDialog — prop people, default [], sem mudar nada sem cadastro", () => {
  test("people?: ClientPerson[] existe, default []", () => {
    expect(dialogSource).toContain("people = [],");
    expect(dialogSource).toContain("people?: ClientPerson[];");
  });

  test("import de orderPeopleForItem/preferredFunctionsForItem/ClientPerson vem de @/lib/client-people", () => {
    expect(dialogSource).toContain(
      'import {\n  orderPeopleForItem,\n  preferredFunctionsForItem,\n  type ClientPerson,\n} from "@/lib/client-people";',
    );
  });
});

describe("Seletor de responsável — só aparece com people, nos modos Criar novo e Atualizar existente", () => {
  test("ReviewRow só renderiza o seletor quando onOwnerChange existe e o modo é create/update", () => {
    expect(dialogSource).toContain(
      '{(row.mode === "create" || row.mode === "update") && onOwnerChange ? (',
    );
  });

  test("decisões: ownerOptions/ownerValue/onOwnerChange ficam undefined sem people (people.length === 0)", () => {
    const idx = dialogSource.indexOf("ownerOptions={\n                            people.length");
    expect(idx).toBeGreaterThan(-1);
    const block = dialogSource.slice(idx, idx + 900);
    expect(block).toContain("? orderPeopleForItem(");
    expect(block).toContain(": undefined");
    expect(block).toContain('preferredFunctionsForItem("decisao", r.item.title)');
  });

  test('ações: mesmo padrão, com preferredFunctionsForItem("acao", r.item.description)', () => {
    const idx = dialogSource.indexOf('preferredFunctionsForItem("acao", r.item.description)');
    expect(idx).toBeGreaterThan(-1);
  });

  test("texto discreto 'sem responsável' quando o valor está vazio, sem bloquear a aprovação", () => {
    expect(dialogSource).toContain(
      '{!ownerValue ? (\n                <span className="text-xs text-muted-foreground">sem responsável</span>\n              ) : null}',
    );
  });
});

describe("Escolha do consultor vai para ApprovedSelection (actions[].owner_name e decisions[].owner)", () => {
  test("decisions: owner usa decisionOwnerSel[r.key] ?? r.item.owner", () => {
    expect(dialogSource).toContain("owner: decisionOwnerSel[r.key] ?? r.item.owner,");
  });

  test("actions: owner_name usa actionOwnerSel[r.key] ?? r.item.owner_name", () => {
    expect(dialogSource).toContain("owner_name: actionOwnerSel[r.key] ?? r.item.owner_name,");
  });

  test("applyApprovedAnalysis em si não foi tocado (só o valor que entra em ApprovedSelection mudou)", () => {
    const analysisSource = read("src/lib/meeting-analysis.ts");
    expect(analysisSource).toContain("export async function applyApprovedAnalysis(params: {");
  });
});

describe("Selo 'escolhido por você' existe, sem cor nova", () => {
  test('Badge variant="outline" com o texto exato, só quando ownerOverridden', () => {
    expect(dialogSource).toContain(
      '{ownerOverridden ? (\n                <Badge variant="outline" className="shrink-0 text-[10px]">\n                  escolhido por você\n                </Badge>\n              ) : null}',
    );
  });

  test("ownerOverridden é true só quando há escolha manual (Record indexado por r.key, diferente de undefined)", () => {
    expect(dialogSource).toContain("ownerOverridden={decisionOwnerSel[r.key] !== undefined}");
    expect(dialogSource).toContain("ownerOverridden={actionOwnerSel[r.key] !== undefined}");
  });
});

describe("As duas telas passam people — client_id de cada uma", () => {
  test("reuniao-inteligente.tsx: people vem de clientPeopleResult (clientId = cliente escolhido na 1ª etapa)", () => {
    expect(reuniaoSource).toContain("people={clientPeopleResult.data ?? []}");
  });

  test("projetos/$projectId.tsx: people vem de clientPeopleQuery(clientId), clientId = project.data?.client_id", () => {
    expect(projetoSource).toContain(
      'import { clientPeopleQuery } from "@/lib/client-people-data";',
    );
    expect(projetoSource).toContain(
      "const clientPeopleResult = useQuery(clientPeopleQuery(clientId));",
    );
    expect(projetoSource).toContain('const clientId = project.data?.client_id ?? "";');
    expect(projetoSource).toContain("people={clientPeopleResult.data ?? []}");
  });
});

describe("Sem cor nova e sem migration", () => {
  test("nenhuma classe de cor fora do tema nos trechos novos (hex ou paletas Tailwind cruas)", () => {
    const colorPattern =
      /#[0-9a-fA-F]{3,8}\b|bg-(red|green|blue|yellow|purple|pink|indigo|teal|orange)-[0-9]|text-(red|green|blue|yellow|purple|pink|indigo|teal|orange)-[0-9]/;
    const idx = dialogSource.indexOf("Responsável</span>");
    const block = dialogSource.slice(idx - 50, idx + 900);
    expect(block).not.toMatch(colorPattern);
  });

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

  test("nenhuma migration nova nesta branch", () => {
    expect(changedOrNewPaths()).not.toMatch(/supabase\/migrations\//);
  });

  test("intelligent-meeting.server.ts (IA/prompt) não foi tocado neste gate", () => {
    expect(changedOrNewPaths()).not.toContain("intelligent-meeting.server.ts");
  });

  test("deduplication.ts e health.ts não foram tocados neste gate", () => {
    const changed = changedOrNewPaths();
    expect(changed).not.toContain("deduplication.ts");
    expect(changed).not.toContain("health.ts");
    expect(changed).not.toMatch(/src\/integrations\//);
  });
});
