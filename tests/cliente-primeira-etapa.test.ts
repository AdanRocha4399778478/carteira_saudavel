import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildKnownClientNames } from "../src/lib/deduplication";

/* ------------------------------------------------------------------ *
 * Backlog "Cliente (opcional) na primeira etapa" (17/10/2026) — deixa a
 * lista de nomes conhecidos (B19) disponível também no fluxo geral, sem
 * atalho. Sem cliente escolhido, nada muda. Com cliente escolhido, a
 * escolha do consultor sempre prevalece sobre a sugestão da IA — a
 * mesma regra que já valia pro preset. Nenhuma consulta nova, nenhuma
 * migration, lógica de dedupe e health.ts intocados.
 * ------------------------------------------------------------------ */

function read(path: string): string {
  return readFileSync(resolve(import.meta.dir, path), "utf8");
}

const source = read("../src/routes/_authenticated/reuniao-inteligente.tsx");

describe("(a) seletor 'Cliente (opcional)' existe na primeira etapa (step 'captura')", () => {
  test("o rótulo e o texto de apoio aparecem dentro do bloco da primeira etapa", () => {
    const stepStart = source.indexOf('{step === "captura" ? (');
    const stepEnd = source.indexOf('{step === "transcricao" ? (');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = source.slice(stepStart, stepEnd);
    expect(stepBlock).toContain("Cliente (opcional)");
    expect(stepBlock).toContain("Ajuda a IA a acertar os nomes de quem fala");
    expect(stepBlock).toContain("<ClientCombobox");
  });

  test("reaproveita o componente ClientCombobox e a lista clientsQuery já carregada (clients.data) — sem consulta nova", () => {
    const stepStart = source.indexOf('{step === "captura" ? (');
    const stepEnd = source.indexOf('{step === "transcricao" ? (');
    const stepBlock = source.slice(stepStart, stepEnd);
    expect(stepBlock).toContain("clients={clients.data ?? []}");
  });
});

describe("(b)/(c) o valor escolhido alimenta o MESMO estado clientId que o preset já alimenta", () => {
  test("clientId nasce do preset (igual antes) e o novo seletor escreve no mesmo estado via setClientId", () => {
    expect(source).toContain('const [clientId, setClientId] = useState(preset.clientId ?? "");');
    const stepStart = source.indexOf('{step === "captura" ? (');
    const stepEnd = source.indexOf('{step === "transcricao" ? (');
    const stepBlock = source.slice(stepStart, stepEnd);
    expect(stepBlock).toContain("value={clientId}");
    expect(stepBlock).toContain("onChange={(id) => setClientId(id)}");
  });

  test('vazio (sem preset, sem escolha manual) continua exatamente como antes: clientId começa ""', () => {
    // Nenhum valor default é forçado pelo novo seletor — só reaproveita
    // o mesmo estado que já existia, então sem clique nenhum o
    // comportamento é idêntico ao de antes desta mudança.
    expect(source).not.toContain('useState(preset.clientId ?? "", { forceDefault');
  });
});

describe("Precedência — minha escolha (preset OU seletor da 1ª etapa) sempre vence a sugestão da IA", () => {
  test("onSuccess de runAnalysis usa o clientId já escolhido antes de cair na sugestão da IA", () => {
    expect(source).toContain(
      'setClientId(\n        clientId ||\n          (identification.client_confidence >= 0.6 ? (identification.client_id ?? "") : ""),\n      );',
    );
  });

  test("não decide sozinho: o comentário explica que preset e escolha manual são o MESMO caminho de precedência", () => {
    expect(source).toContain(
      "Cliente já escolhido ANTES da análise sempre prevalece sobre a sugestão",
    );
  });
});

describe("Projeto sugerido pela IA nunca é de OUTRO cliente quando já havia um cliente escolhido", () => {
  test("a sugestão de projeto só é aplicada sem cliente escolhido OU quando o projeto é do cliente escolhido (client_id de projects.data)", () => {
    expect(source).toContain(
      "const suggestedProjectClientId = suggestedProjectId\n        ? (projects.data ?? []).find((p) => p.id === suggestedProjectId)?.client_id\n        : undefined;",
    );
    expect(source).toContain(
      "const suggestedProjectMatchesChosenClient =\n        !clientId || suggestedProjectClientId === clientId;",
    );
    expect(source).toContain(
      'setProjectId(\n        preset.projectId ?? (suggestedProjectMatchesChosenClient ? suggestedProjectId : ""),\n      );',
    );
  });

  test("preset.projectId continua vencendo sempre, igual a antes", () => {
    const projectAssignIdx = source.indexOf("setProjectId(\n        preset.projectId ??");
    expect(projectAssignIdx).toBeGreaterThan(-1);
  });
});

describe("Aviso discreto de cliente divergente — nunca bloqueia, sem cor nova", () => {
  test("o aviso só usa classes já existentes no tema (amber, mesmas de outros avisos do arquivo)", () => {
    expect(source).toContain(
      "rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-muted-foreground",
    );
  });

  test("a comparação usa normalizeText (reaproveitado de deduplication.ts) — sem fuzzy-match novo", () => {
    expect(source).toContain(
      'import { buildKnownClientNames, normalizeText } from "@/lib/deduplication";',
    );
    expect(source).toContain("const citedNorm = normalizeText(ident.client_name);");
  });

  test("o aviso não desabilita nenhum botão — é só um <p>, igual ao padrão de 'Falante sem nome'", () => {
    const warningLine = source.indexOf("A transcrição cita");
    expect(warningLine).toBeGreaterThan(-1);
    const surrounding = source.slice(warningLine - 300, warningLine + 300);
    expect(surrounding).not.toContain("disabled=");
  });
});

describe("(e)/(f) a análise aguarda clientKnownNamesQuery (fetchQuery, reaproveitando o cache) antes de chamar a IA, sem travar em falha", () => {
  test("fetchQuery usa a MESMA clientKnownNamesQuery do B19 (nenhuma consulta nova)", () => {
    expect(source).toContain(
      'import {\n  actionsQuery,\n  clientKnownNamesQuery,\n  clientMeetingsQuery,\n  clientsQuery,\n  logDbError,\n  opportunitiesQuery,\n  risksQuery,\n} from "@/lib/api";',
    );
    expect(source).toContain("await qc.fetchQuery(clientKnownNamesQuery(clientId))");
  });

  test("fetchQuery roda ANTES de chamar analyze(), dentro do mesmo mutationFn", () => {
    const mutationStart = source.indexOf("const runAnalysis = useMutation({");
    const fetchIdx = source.indexOf(
      "await qc.fetchQuery(clientKnownNamesQuery(clientId))",
      mutationStart,
    );
    const analyzeIdx = source.indexOf("const raw = await analyze({", mutationStart);
    expect(fetchIdx).toBeGreaterThan(mutationStart);
    expect(analyzeIdx).toBeGreaterThan(fetchIdx);
  });

  test("só busca quando há cliente escolhido — vazio pula a busca (comportamento atual idêntico)", () => {
    expect(source).toContain("if (clientId) {");
  });

  test("falha na consulta não trava a análise: try/catch segue sem a lista (nunca relança)", () => {
    const tryIdx = source.indexOf("try {\n          const sources = await qc.fetchQuery");
    const catchIdx = source.indexOf("} catch {\n          analysisKnownNames = [];\n        }");
    expect(tryIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(tryIdx);
  });

  test("knownNames enviada pra análise é a calculada na hora (fresca), não a reativa potencialmente atrasada", () => {
    expect(source).toContain("knownNames: analysisKnownNames,");
  });
});

describe("knownNames — vazia sem cliente, montada com cliente escolhido (nível da função pura, já coberta em B19)", () => {
  test("sem nomes e sem cliente: lista vazia (mesmo resultado de hoje, sem cliente nenhum)", () => {
    expect(buildKnownClientNames([], "")).toEqual([]);
  });

  test("com cliente e nomes: lista não fica vazia", () => {
    expect(buildKnownClientNames(["Maria", "João"], "cliente-1")).toEqual(["Maria", "João"]);
  });
});

describe("Escopo — health.ts, RLS, gatilhos e dedupe intocados; nenhuma migration", () => {
  test("reuniao-inteligente.tsx não importa health.ts", () => {
    expect(source).not.toContain('from "@/lib/health"');
  });

  test("usa só funções de dedupe já existentes (buildKnownClientNames, normalizeText) — nenhuma nova exportada por este backlog", () => {
    expect(source).toContain(
      'import { buildKnownClientNames, normalizeText } from "@/lib/deduplication";',
    );
  });
});
