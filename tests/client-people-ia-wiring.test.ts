import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Cadastro de pessoas e apelidos por cliente — Gate E (19/10/2026).
 * Teste ESTÁTICO por inspeção de código-fonte (padrão dos demais gates
 * desta tela). Sem banco, sem mock de rede.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const routeSource = read("src/routes/_authenticated/reuniao-inteligente.tsx");

describe("clientPeopleQuery reaproveitada (mesma função, nenhuma consulta nova)", () => {
  test("import vem de @/lib/client-people-data, a mesma usada pela tela de Pessoas", () => {
    expect(routeSource).toContain('import { clientPeopleQuery } from "@/lib/client-people-data";');
  });

  test("clientPeopleResult usa clientPeopleQuery(clientId), igual ao padrão de knownNamesSources", () => {
    expect(routeSource).toContain(
      "const clientPeopleResult = useQuery(clientPeopleQuery(clientId));",
    );
  });
});

describe("people enviado na análise (runAnalysis), esperando a consulta terminar", () => {
  test("peopleContext vem de buildPeoplePromptContext(clientPeopleResult.data ?? [])", () => {
    expect(routeSource).toContain("() => buildPeoplePromptContext(clientPeopleResult.data ?? []),");
  });

  test("runAnalysis espera clientPeopleQuery (fetchQuery) antes de montar analysisPeople, mesmo padrão de analysisKnownNames", () => {
    const idx = routeSource.indexOf("let analysisPeople = peopleContext;");
    expect(idx).toBeGreaterThan(-1);
    const block = routeSource.slice(idx, idx + 400);
    expect(block).toContain("await qc.fetchQuery(clientPeopleQuery(clientId));");
    expect(block).toContain("analysisPeople = buildPeoplePromptContext(people);");
  });

  test("a chamada a analyze() envia people: analysisPeople", () => {
    const idx = routeSource.indexOf("const raw = await analyze({");
    expect(idx).toBeGreaterThan(-1);
    const block = routeSource.slice(idx, idx + 700);
    expect(block).toContain("knownNames: analysisKnownNames,");
    expect(block).toContain("people: analysisPeople,");
  });
});

describe("canonicalizeAnalysisOwners roda ANTES de applySpeakerMapToAnalysis, no clique de Gerar preview", () => {
  test("createAndReview busca as pessoas (fetchQuery) antes de montar mappedAnalysis", () => {
    const startIdx = routeSource.indexOf("mutationFn: async (force: boolean) => {");
    const mappedIdx = routeSource.indexOf(
      "const mappedAnalysis = applySpeakerMapToAnalysis(",
      startIdx,
    );
    expect(startIdx).toBeGreaterThan(-1);
    expect(mappedIdx).toBeGreaterThan(startIdx);
    const block = routeSource.slice(startIdx, mappedIdx);
    expect(block).toContain(
      "peopleForCanonical = await qc.fetchQuery(clientPeopleQuery(clientId));",
    );
  });

  test("mappedAnalysis aplica canonicalizeAnalysisOwners na análise e canoniza o speakerMap, ANTES do mapa de falantes", () => {
    const idx = routeSource.indexOf("const mappedAnalysis = applySpeakerMapToAnalysis(");
    expect(idx).toBeGreaterThan(-1);
    const block = routeSource.slice(idx, idx + 300);
    expect(block).toContain(
      "canonicalizeAnalysisOwners(originalAnalysis ?? analysis, peopleForCanonical)",
    );
    expect(block).toContain("canonicalSpeakerMap,");
  });

  test("canonicalSpeakerMap troca entry.name por canonicalOwnerName, só quando há pessoas", () => {
    const idx = routeSource.indexOf("const canonicalSpeakerMap = peopleForCanonical.length");
    expect(idx).toBeGreaterThan(-1);
    const block = routeSource.slice(idx, idx + 250);
    expect(block).toContain("canonicalOwnerName(entry.name, peopleForCanonical)");
    expect(block).toContain(": speakerMap;");
  });

  test("sem cliente escolhido (clientId vazio), peopleForCanonical fica [] — nada muda", () => {
    const idx = routeSource.indexOf("let peopleForCanonical: ClientPerson[] = [];");
    expect(idx).toBeGreaterThan(-1);
    const block = routeSource.slice(idx, idx + 250);
    expect(block).toContain("if (clientId) {");
  });
});

describe("CORREÇÃO 1 — aviso quando o cadastro de pessoas não carrega", () => {
  test("o catch de runAnalysis (analysisPeople) mostra toast.warning, sem repetir por clique", () => {
    const idx = routeSource.indexOf("analysisPeople = buildPeoplePromptContext(people);");
    expect(idx).toBeGreaterThan(-1);
    const block = routeSource.slice(idx, idx + 300);
    expect(block).toContain("} catch {");
    expect(block).toContain("analysisPeople = [];");
    expect(block).toContain(
      'toast.warning(\n            "Não foi possível carregar o cadastro de pessoas deste cliente; seguindo sem ele.",\n          );',
    );
    // Só uma chamada a toast.warning dentro deste catch (sem duplicar o aviso).
    const catchStart = block.indexOf("} catch {");
    const catchBody = block.slice(catchStart, block.indexOf("}", catchStart + 20) + 1);
    expect(catchBody.split("toast.warning(").length - 1).toBe(1);
  });

  test("o catch de createAndReview (peopleForCanonical) mostra o mesmo aviso", () => {
    const idx = routeSource.indexOf(
      "peopleForCanonical = await qc.fetchQuery(clientPeopleQuery(clientId));",
    );
    expect(idx).toBeGreaterThan(-1);
    const block = routeSource.slice(idx, idx + 300);
    expect(block).toContain("} catch {");
    expect(block).toContain("peopleForCanonical = [];");
    expect(block).toContain(
      'toast.warning(\n            "Não foi possível carregar o cadastro de pessoas deste cliente; seguindo sem ele.",\n          );',
    );
  });
});

describe("CORREÇÃO 2 — participantes gravados usam o nome canônico (canonicalizeParticipantNames)", () => {
  test("import de canonicalizeParticipantNames vem de @/lib/client-people", () => {
    expect(routeSource).toContain("canonicalizeParticipantNames,");
  });

  test("info.participants aplica canonicalizeParticipantNames com peopleForCanonical, no ponto da gravação", () => {
    const idx = routeSource.indexOf("participants: canonicalizeParticipantNames(");
    expect(idx).toBeGreaterThan(-1);
    const block = routeSource.slice(idx, idx + 300);
    expect(block).toContain(".split(\",\")");
    expect(block).toContain("peopleForCanonical,");
  });

  test("a canonicalização de participantes acontece DEPOIS de peopleForCanonical já ter sido buscado", () => {
    const fetchIdx = routeSource.indexOf(
      "peopleForCanonical = await qc.fetchQuery(clientPeopleQuery(clientId));",
    );
    const participantsIdx = routeSource.indexOf("participants: canonicalizeParticipantNames(");
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(participantsIdx).toBeGreaterThan(fetchIdx);
  });
});

describe("Escopo do gate — nada fora do combinado foi tocado", () => {
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

  test("nenhuma migration nova nesta branch (comparado com origin/main)", () => {
    // Exceção explícita: migration reconciliada com a produção (já aplicada lá).
    // Qualquer OUTRA migration nova continua proibida.
    const ALLOWED_MIGRATIONS = [
      "supabase/migrations/20260927203713_add_project_context_erp_summaries.sql",
    "supabase/migrations/20261023200000_codificar_drift_producao.sql",
    "supabase/migrations/20261024120000_catalogo_contratos_entregas_cadencia.sql",
    ];
    const changed = ALLOWED_MIGRATIONS.reduce(
      (acc, file) => acc.split(file).join(""),
      changedOrNewPaths(),
    );
    expect(changed).not.toMatch(/supabase\/migrations\//);
  });

  // deduplication.ts era fora do escopo deste gate (Gate E, OWNER_ALIAS_SEED
  // continuava como estava) — passou a ser tocado de propósito pelo gate
  // "remove OWNER_ALIAS_SEED" (19/10/2026), que tem sua própria checagem de
  // escopo (ver remove-owner-alias-seed-scope.test.ts).

  test("health.ts e src/integrations/* não foram tocados neste gate", () => {
    const changed = changedOrNewPaths();
    expect(changed).not.toContain("health.ts");
    expect(changed).not.toMatch(/src\/integrations\//);
  });

  test("applyApprovedAnalysis (src/lib/meeting-analysis.ts) não foi tocado neste gate", () => {
    expect(changedOrNewPaths()).not.toContain("meeting-analysis.ts");
    const analysisSource = read("src/lib/meeting-analysis.ts");
    expect(analysisSource).toContain("export async function applyApprovedAnalysis(params: {");
  });
});
