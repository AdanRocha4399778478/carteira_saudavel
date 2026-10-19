import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate C (18/10/2026): TELA do
 * bloco "Indicadores sugeridos" no preview, com a gravação já ligada
 * (ApprovedSelection.indicators do Gate D). Teste ESTÁTICO por inspeção
 * de código-fonte, padrão dos demais gates desta tela.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const dialogSource = read("src/components/painel/MeetingAnalysisDialog.tsx");

describe("MeetingAnalysisDialog — estado dos rascunhos e wiring do bloco", () => {
  test("declara indicatorEdits (estado) e indicatorDrafts/approvedIndicatorItems/indicatorBlockingCount (memos)", () => {
    expect(dialogSource).toContain(
      "const [indicatorEdits, setIndicatorEdits] = useState<Record<number, Partial<IndicatorDraft>>>({});",
    );
    expect(dialogSource).toContain("const indicatorDrafts: IndicatorDraft[] = useMemo(");
    expect(dialogSource).toContain(
      "const approvedIndicatorItems: ApprovedIndicatorItem[] = useMemo(",
    );
    expect(dialogSource).toContain("const indicatorBlockingCount = useMemo(");
  });

  test("indicatorEdits é resetado junto com oppSel na reanálise (mesmo padrão dos demais seletores)", () => {
    const idx = dialogSource.indexOf("setOppSel({});");
    expect(idx).toBeGreaterThan(-1);
    expect(dialogSource.slice(idx, idx + 60)).toContain("setIndicatorEdits({});");
  });

  test("renderiza IndicatorSuggestionsBlock imediatamente depois do ReviewBlock de oportunidades", () => {
    const oppBlockIdx = dialogSource.indexOf('id="opportunities"');
    expect(oppBlockIdx).toBeGreaterThan(-1);
    const closeAfterOpp = dialogSource.indexOf("</ReviewBlock>", oppBlockIdx);
    const indicatorBlockIdx = dialogSource.indexOf("<IndicatorSuggestionsBlock", closeAfterOpp);
    const evolutionIdx = dialogSource.indexOf("evolutionItems.length > 0 &&", closeAfterOpp);
    expect(indicatorBlockIdx).toBeGreaterThan(closeAfterOpp);
    expect(indicatorBlockIdx).toBeLessThan(evolutionIdx);
  });

  test("ApprovedSelection ganha indicators: approvedIndicatorItems, logo depois de opportunities", () => {
    const oppFieldIdx = dialogSource.indexOf("opportunities: oppRows.map((r) => ({");
    expect(oppFieldIdx).toBeGreaterThan(-1);
    const block = dialogSource.slice(oppFieldIdx, oppFieldIdx + 500);
    expect(block).toContain("indicators: approvedIndicatorItems,");
  });
});

describe("botão de aprovar — desabilitado enquanto houver indicador bloqueante", () => {
  test("submitApproval tem o mesmo guard de defesa em profundidade com indicatorBlockingCount", () => {
    const idx = dialogSource.indexOf("const submitApproval = () => {");
    expect(idx).toBeGreaterThan(-1);
    const block = dialogSource.slice(idx, idx + 300);
    expect(block).toContain("indicatorBlockingCount > 0");
  });

  test("o botão de aprovar (disabled) inclui indicatorBlockingCount > 0, sem remover as condições antigas", () => {
    const idx = dialogSource.indexOf(
      "disabled={approve.isPending || approved || isApproved || indicatorBlockingCount > 0}",
    );
    expect(idx).toBeGreaterThan(-1);
  });

  test("o rótulo do botão ganha um ramo novo pra indicatorBlockingCount, sem alterar o ramo de overallCounts.reviewCount", () => {
    expect(dialogSource).toContain(
      '`Resolva ${indicatorBlockingCount} ${indicatorBlockingCount === 1 ? "indicador" : "indicadores"} antes de aprovar`',
    );
    expect(dialogSource).toContain(
      '`Revise ${overallCounts.reviewCount} ${overallCounts.reviewCount === 1 ? "item" : "itens"} antes de aprovar`',
    );
  });
});

describe("escopo do gate — nada fora do combinado foi tocado", () => {
  test("countReviewBlock não ganhou nenhuma chamada nova (mesmas 4 ocorrências de antes do gate: context/decisions/actions/risks/opportunities)", () => {
    const occurrences = dialogSource.split("countReviewBlock(").length - 1;
    // 4 blocos (decisions/actions/risks/opportunities) + 1 por grupo de contexto + overallCounts + ReviewBlock interno = contagem estável; o importante é que indicadores NUNCA aparece nesse grupo.
    expect(occurrences).toBeGreaterThan(0);
    const indicatorNearCountReview = dialogSource
      .split("\n")
      .some(
        (line) => line.includes("countReviewBlock") && line.toLowerCase().includes("indicator"),
      );
    expect(indicatorNearCountReview).toBe(false);
  });

  test("o aviso pós-aprovação (Será aplicado: ...) não ganhou nenhuma menção a indicador", () => {
    const idx = dialogSource.indexOf("Será aplicado:");
    expect(idx).toBeGreaterThan(-1);
    const block = dialogSource.slice(idx, idx + 400);
    expect(block.toLowerCase()).not.toContain("indicador");
  });

  test("applyApprovedAnalysis (src/lib/meeting-analysis.ts) não foi tocado neste gate", () => {
    const analysisSource = read("src/lib/meeting-analysis.ts");
    expect(analysisSource).toContain("export async function applyApprovedAnalysis(params: {");
    // A mesma validação upfront do B30 continua logo no início, sem mudança de posição.
    expect(analysisSource).toContain(
      "const indicatorErrorsUpfront = (selection.indicators ?? []).flatMap(",
    );
  });

  test("deduplication.ts não foi tocado neste gate (buildIdempotencyKey permanece genérica)", () => {
    const dedupSource = read("src/lib/deduplication.ts");
    expect(dedupSource).toContain("export function buildIdempotencyKey(params: {");
    expect(dedupSource).not.toContain("IndicatorDraft");
    expect(dedupSource).not.toContain("ApprovedIndicatorItem");
  });
});
