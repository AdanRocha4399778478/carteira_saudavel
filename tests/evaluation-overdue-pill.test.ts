import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Teste estático (sem mock, sem chamar o banco): confirma só que o
 * Pill "avaliação vencida" entrou nas duas telas pedidas (página do
 * cliente e lista de clientes), reaproveitando a mesma consulta
 * (evaluationDecisionsQuery/overdueEvaluationClientIds), no mesmo
 * padrão de tests/regra-b.test.ts. Backlog B1 (16/10/2026).
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

describe("Pill 'avaliação vencida' — página do cliente ($clientId.tsx)", () => {
  const source = read("src/routes/_authenticated/clientes/$clientId.tsx");

  test("importa evaluationDecisionsQuery/overdueEvaluationClientIds de @/lib/evaluation-overdue", () => {
    expect(source).toContain(
      'import { evaluationDecisionsQuery, overdueEvaluationClientIds } from "@/lib/evaluation-overdue";',
    );
  });

  test("usa useQuery(evaluationDecisionsQuery()) — a mesma consulta, não uma nova", () => {
    expect(source).toContain("useQuery(evaluationDecisionsQuery())");
  });

  test("checa o cliente ATUAL da rota contra o Set devolvido por overdueEvaluationClientIds", () => {
    expect(source).toContain("overdueEvaluationClientIds(evaluationDecisions.data ?? []).has(");
    expect(source).toContain("clientId,");
  });

  test("o Pill fica ao lado do de ações vencidas, mesmo tone/ícone", () => {
    const overdueActionsPillIdx = source.indexOf("{overdue.length} ação(ões) vencida(s)");
    const evaluationPillIdx = source.indexOf("avaliação vencida", overdueActionsPillIdx);
    expect(overdueActionsPillIdx).toBeGreaterThan(-1);
    expect(evaluationPillIdx).toBeGreaterThan(overdueActionsPillIdx);
    const between = source.slice(overdueActionsPillIdx, evaluationPillIdx);
    // Entre os dois textos só deve haver o fechamento do Pill anterior e a
    // abertura condicional do novo — nenhuma outra seção de página no meio.
    expect(between).toContain("hasOverdueEvaluation ? (");
    expect(between).toContain('<Pill tone="critical" icon={AlertTriangle}>');
  });
});

describe("Pill 'avaliação vencida' — lista de clientes (index.tsx + useClientsListData.ts)", () => {
  const hookSource = read("src/hooks/useClientsListData.ts");
  const pageSource = read("src/routes/_authenticated/clientes/index.tsx");

  test("useClientsListData inclui evaluationDecisionsQuery() no mesmo useQueries — não cria busca solta", () => {
    const queriesStart = hookSource.indexOf("const results = useQueries({");
    const queriesEnd = hookSource.indexOf("});", queriesStart);
    const queriesBlock = hookSource.slice(queriesStart, queriesEnd);
    expect(queriesBlock).toContain("evaluationDecisionsQuery()");
  });

  test("isLoading/failed olham só as 3 consultas essenciais — evaluationDecisionsResult não entra", () => {
    expect(hookSource).toContain(
      "const essentialResults = [clientsResult, actionsResult, profilesResult];",
    );
    const essentialStart = hookSource.indexOf(
      "const essentialResults = [clientsResult, actionsResult, profilesResult];",
    );
    expect(essentialStart).toBeGreaterThan(-1);

    const isLoadingLine = hookSource.indexOf("const isLoading = essentialResults.some(");
    const failedBlockEnd = hookSource.indexOf("const liveError =");
    expect(isLoadingLine).toBeGreaterThan(essentialStart);
    const isLoadingToFailedBlock = hookSource.slice(isLoadingLine, failedBlockEnd);
    // Nem isLoading nem failed referenciam a query de avaliação diretamente —
    // só o array essentialResults, que já a exclui.
    expect(isLoadingToFailedBlock).not.toContain("evaluationDecisionsResult");
    expect(isLoadingToFailedBlock).toContain("essentialResults.some(");
    expect(isLoadingToFailedBlock).toContain("essentialResults.find(");
  });

  test("hasData (usado pelo latch de erro) também olha só as consultas essenciais", () => {
    expect(hookSource).toContain(
      "const hasData = essentialResults.some((r) => r.data !== undefined);",
    );
  });

  test("evaluationDecisionsResult continua no mesmo useQueries (cache/refetchAll compartilhados), só fora de isLoading/failed", () => {
    const queriesStart = hookSource.indexOf("const results = useQueries({");
    const queriesEnd = hookSource.indexOf("});", queriesStart);
    expect(hookSource.slice(queriesStart, queriesEnd)).toContain("evaluationDecisionsQuery()");
    expect(hookSource).toContain("results.forEach((r) => void r.refetch());");
  });

  test("useClientsListData agrupa por cliente com overdueEvaluationClientIds e expõe o resultado", () => {
    expect(hookSource).toContain("overdueEvaluationClientIds(evaluationDecisions)");
    expect(hookSource).toContain("evaluationOverdueClientIds,");
  });

  test("não carrega a tabela projects inteira dentro do hook da lista", () => {
    expect(hookSource).not.toContain('.from("projects")');
  });

  test("index.tsx consome evaluationOverdueClientIds do hook e renderiza por linha", () => {
    expect(pageSource).toContain("evaluationOverdueClientIds,");
    expect(pageSource).toContain("evaluationOverdueClientIds.has(c.id)");
  });

  test("o indicador da lista fica na mesma célula/coluna do indicador de ações vencidas", () => {
    const overdueActionsIdx = pageSource.indexOf("{overdueByClient.get(c.id)} vencida(s)");
    const evaluationIdx = pageSource.indexOf("avaliação vencida", overdueActionsIdx);
    const cellEndIdx = pageSource.indexOf("</TableCell>", overdueActionsIdx);
    expect(overdueActionsIdx).toBeGreaterThan(-1);
    expect(evaluationIdx).toBeGreaterThan(overdueActionsIdx);
    expect(evaluationIdx).toBeLessThan(cellEndIdx);
  });
});
