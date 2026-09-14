import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const dialogSource = read("src/components/painel/MeetingAnalysisDialog.tsx");
const dedupeSource = read("src/lib/deduplication.ts");
const analysisSource = read("src/lib/meeting-analysis.ts");

/* ------------------------------------------------------------------ *
 * GATE 10A — a lógica pura (contagem, safe-apply, ignore) já é coberta
 * comportamentalmente em tests/review-blocks.test.ts. Aqui verificamos só a
 * integração no componente: que os 3 níveis (resumo/blocos/revisão
 * individual) estão de fato ligados ao módulo puro, que o fluxo de
 * aprovação continua intocado, e que nada de dedupe/threshold mudou.
 * ------------------------------------------------------------------ */

describe("GATE 10A — nenhuma alteração em thresholds/dedupe/backend", () => {
  test("MeetingAnalysisDialog não define nenhuma lógica de dedupe própria — só importa de @/lib/deduplication", () => {
    expect(dialogSource).toContain(
      'import {\n  defaultResolution,\n  matchAction,\n  matchContextItem,\n  matchDecision,\n  matchOpportunity,\n  matchRisk,\n  scopeToProject,\n  VERDICT_LABEL,',
    );
    expect(dialogSource).toContain('from "@/lib/deduplication"');
    // Nenhum threshold ou peso numérico de confiança é definido no componente.
    expect(dialogSource).not.toMatch(/THRESHOLD/i);
  });

  test("src/lib/deduplication.ts não foi tocado por este GATE — defaultResolution continua com a mesma regra", () => {
    expect(dedupeSource).toContain(
      '  const mode: ResolutionMode =\n    match.type === "EXISTING" || match.type === "POSSIBLE_DUPLICATE"\n      ? "skip"\n      : match.type === "UPDATE_EXISTING"\n        ? "update"\n        : "create";',
    );
  });

  test("applyApprovedAnalysis é importado de @/lib/meeting-analysis e chamado uma única vez, só na aprovação", () => {
    expect(dialogSource).toContain('applyApprovedAnalysis,') ;
    expect(dialogSource).toContain('from "@/lib/meeting-analysis"');
    const occurrences = dialogSource.split("applyApprovedAnalysis(").length - 1;
    // Uma vez no import (sem parênteses, não conta aqui) e uma vez na chamada real.
    expect(occurrences).toBe(1);
    expect(dialogSource).toContain("const applied = await applyApprovedAnalysis({");
  });

  test("submitApproval mantém a trava contra clique duplo (idempotência de UI preservada)", () => {
    expect(dialogSource).toContain("const submitApproval = () => {");
    expect(dialogSource).toContain("if (submitting.current || approve.isPending || approved) return;");
  });

  test("closeOnApproved e REFRESH_KEYS continuam presentes e intocados", () => {
    expect(dialogSource).toContain("closeOnApproved?: boolean;");
    expect(dialogSource).toContain("if (closeOnApproved)");
    expect(dialogSource).toContain("const REFRESH_KEYS: readonly (readonly string[])[] = [");
    expect(dialogSource).toContain('for (const key of REFRESH_KEYS) void qc.invalidateQueries({ queryKey: key });');
  });
});

describe("GATE 10A — resumo geral (nível 1)", () => {
  test("card 'Revisão da análise' usa countReviewBlock e expõe 'Aplicar sugestões seguras'", () => {
    expect(dialogSource).toContain("function ReviewSummaryCard(");
    expect(dialogSource).toContain("<ReviewSummaryCard\n                  counts={overallCounts}\n                  onApplySafe={applyAllSafe}");
    expect(dialogSource).toContain("Aplicar sugestões seguras");
  });

  test("applyAllSafe cobre todos os blocos (contexto + decisões/ações/riscos/oportunidades) via applySafeResolutions, registrando a decisão como 'approved' (GATE 10D)", () => {
    const block = dialogSource.slice(
      dialogSource.indexOf("const applyAllSafe = () => {"),
      dialogSource.indexOf("};", dialogSource.indexOf("const applyAllSafe = () => {")),
    );
    expect(block).toContain("applyBlockDecision(`context:${g.list}`, g.items, setContextSel, applySafeResolutions(g.items), \"approved\")");
    expect(block).toContain('applyBlockDecision("decisions", decisionItems, setDecisionSel, applySafeResolutions(decisionItems), "approved")');
    expect(block).toContain('applyBlockDecision("actions", actionItems, setActionSel, applySafeResolutions(actionItems), "approved")');
    expect(block).toContain('applyBlockDecision("risks", riskItems, setRiskSel, applySafeResolutions(riskItems), "approved")');
    expect(block).toContain('applyBlockDecision("opportunities", oppItems, setOppSel, applySafeResolutions(oppItems), "approved")');
  });

  test("linha final antes do botão de aprovar mostra novos/atualizações/ignorados/para revisar", () => {
    expect(dialogSource).toContain("Será aplicado: {overallCounts.newCount} novo(s)");
    expect(dialogSource).toContain("{overallCounts.updateCount}{\" \"}\n                    atualização(ões)");
    expect(dialogSource).toContain("{overallCounts.ignoredCount} ignorado(s)");
    expect(dialogSource).toContain("{overallCounts.reviewCount}{\" \"}\n                    para revisar");
    // Não bloqueia a aprovação — só avisa quando há itens pendentes.
    expect(dialogSource).not.toMatch(/disabled=\{[^}]*reviewCount/);
  });
});

describe("GATE 10A — blocos recolhíveis (nível 2)", () => {
  test("ReviewBlock some quando o bloco está vazio e mostra 'Requer revisão' quando reviewCount > 0", () => {
    const block = dialogSource.slice(
      dialogSource.indexOf("function ReviewBlock("),
      dialogSource.indexOf("function ReviewRow(") === -1
        ? dialogSource.length
        : dialogSource.length,
    );
    expect(block).toContain("if (items.length === 0) return null;");
    expect(block).toContain("const needsAttention = counts.reviewCount > 0;");
    expect(block).toContain("Requer revisão");
  });

  test("cabeçalho do bloco usa formatBlockSummary (contagens) e tem os 3 botões de ação", () => {
    const block = dialogSource.slice(dialogSource.indexOf("function ReviewBlock("));
    expect(block).toContain("{formatBlockSummary(counts)}");
    expect(block).toContain("Aprovar bloco");
    expect(block).toContain("Ignorar bloco");
    expect(block).toContain('{triggerLabel}');
  });

  test("botão de abrir/recolher usa CollapsibleTrigger (aria-expanded vem do Radix) e tem aria-label com texto claro", () => {
    const block = dialogSource.slice(dialogSource.indexOf("function ReviewBlock("));
    expect(block).toContain("<CollapsibleTrigger asChild>");
    expect(block).toContain('aria-label={triggerLabel}');
    expect(block).toContain('const triggerLabel = open ? "Recolher" : "Revisar itens";');
  });

  test("todos os 4 blocos de entidade e os grupos de contexto usam <ReviewBlock>, nenhum usa mais <ReviewList>", () => {
    expect(dialogSource).toContain('<ReviewBlock\n                  id="decisions"');
    expect(dialogSource).toContain('<ReviewBlock\n                  id="actions"');
    expect(dialogSource).toContain('<ReviewBlock\n                  id="risks"');
    expect(dialogSource).toContain('<ReviewBlock\n                  id="opportunities"');
    expect(dialogSource).toContain("id={blockId}");
    expect(dialogSource).not.toContain("<ReviewList");
    expect(dialogSource).not.toContain("function ReviewList(");
  });

  test("'Aprovar bloco' chama applySafeResolutions (nunca autoaprova POSSIBLE_DUPLICATE) e 'Ignorar bloco' chama applyIgnoreBlock", () => {
    expect(dialogSource).toContain("applySafeResolutions(decisionItems)");
    expect(dialogSource).toContain("applyIgnoreBlock(decisionItems)");
    // Ambas passam pelo mesmo applyBlockDecision — nunca chamam setSel direto sem registrar a decisão.
    const decisionsBlock = dialogSource.slice(
      dialogSource.indexOf('<ReviewBlock\n                  id="decisions"'),
      dialogSource.indexOf("</ReviewBlock>", dialogSource.indexOf('id="decisions"')),
    );
    expect(decisionsBlock).toContain("applyBlockDecision(");
    expect(decisionsBlock).not.toMatch(/onApplySafe=\{\(\) => mergeSel/);
    expect(decisionsBlock).not.toMatch(/onIgnoreAll=\{\(\) => mergeSel/);
  });

  test("blocos seguros iniciam fechados e blocos com revisão necessária iniciam abertos (default fixado por análise)", () => {
    const effectBlock = dialogSource.slice(
      dialogSource.indexOf("useEffect(() => {\n    if (!analysis) return;"),
      dialogSource.indexOf("}, [analysis]);") + "}, [analysis]);".length,
    );
    expect(effectBlock).toContain('next[`context:${g.list}`] = countReviewBlock(g.items).reviewCount > 0;');
    expect(effectBlock).toContain('next["decisions"] = countReviewBlock(decisionItems).reviewCount > 0;');
    // Reavalia só quando uma NOVA análise carrega — nunca a cada seleção manual.
    expect(effectBlock).toContain("}, [analysis]);");
    // O estado de abertura é lido com fallback false — bloco sem entrada ainda começa fechado.
    expect(dialogSource).toContain('open={blockOpen["decisions"] ?? false}');
  });
});

describe("GATE 10A — revisão individual (nível 3)", () => {
  test("ReviewRow continua com Criar novo / Atualizar existente / Ignorar e os badges existentes", () => {
    expect(dialogSource).toContain('{ value: "create", label: "Criar novo" }');
    expect(dialogSource).toContain('{ value: "update", label: "Atualizar existente", disabled: !canUpdate }');
    expect(dialogSource).toContain('{ value: "skip", label: "Ignorar" }');
    expect(dialogSource).toContain("<ClassificationBadge value={classification} />");
    expect(dialogSource).toContain("<VerdictBadge resolution={row.resolution} />");
  });

  test("ReviewBlock só renderiza o conteúdo detalhado dentro de CollapsibleContent (Radix esconde quando fechado)", () => {
    expect(dialogSource).toContain(
      '<CollapsibleContent className="border-t p-3 pt-2">{children}</CollapsibleContent>',
    );
  });

  test("cada bloco de entidade e cada grupo de contexto envolve seu <ReviewRow> dentro de <ReviewBlock>…</ReviewBlock>", () => {
    for (const id of ["decisions", "actions", "risks", "opportunities"]) {
      const anchor = dialogSource.indexOf(`id="${id}"`);
      expect(anchor).toBeGreaterThan(-1);
      const blockOpen = dialogSource.lastIndexOf("<ReviewBlock", anchor);
      const blockClose = dialogSource.indexOf("</ReviewBlock>", anchor);
      expect(blockOpen).toBeGreaterThan(-1);
      expect(blockClose).toBeGreaterThan(blockOpen);
      expect(dialogSource.slice(blockOpen, blockClose)).toContain("<ReviewRow");
    }

    const contextAnchor = dialogSource.indexOf("const blockId = `context:${group.list}`;");
    expect(contextAnchor).toBeGreaterThan(-1);
    const contextOpen = dialogSource.indexOf("<ReviewBlock", contextAnchor);
    const contextClose = dialogSource.indexOf("</ReviewBlock>", contextAnchor);
    expect(dialogSource.slice(contextOpen, contextClose)).toContain("<ReviewRow");
  });
});

describe("GATE 10D — feedback visual de aprovar/ignorar bloco", () => {
  test("Aprovar bloco e Ignorar bloco chamam applyBlockDecision (não só mergeSel solto) — registra a decisão para o feedback visual", () => {
    expect(dialogSource).toContain("function applyBlockDecision<K extends string | number>(");
    // A definição usa genérico (`applyBlockDecision<K...>(`), então só as CHAMADAS
    // batem com a string "applyBlockDecision(" — 2 usos por bloco (approve/ignore) ×
    // 5 blocos (contexto+4 entidades) + 5 usos dentro de applyAllSafe = 15.
    const occurrences = dialogSource.split("applyBlockDecision(").length - 1;
    expect(occurrences).toBe(15);
  });

  test("status do bloco vem de computeBlockStatus (nunca é um booleano solto tipo 'aprovado = true')", () => {
    expect(dialogSource).toContain(
      'status={computeBlockStatus(items, blockDecisions[blockId])}',
    );
    expect(dialogSource).toContain(
      'status={computeBlockStatus(decisionItems, blockDecisions["decisions"])}',
    );
    expect(dialogSource).toContain(
      'status={computeBlockStatus(actionItems, blockDecisions["actions"])}',
    );
    expect(dialogSource).toContain(
      'status={computeBlockStatus(riskItems, blockDecisions["risks"])}',
    );
    expect(dialogSource).toContain(
      'status={computeBlockStatus(oppItems, blockDecisions["opportunities"])}',
    );
  });

  test("blockDecisions é resetado junto com blockOpen quando uma NOVA análise carrega (nunca vaza estado de revisão entre reuniões)", () => {
    const effectBlock = dialogSource.slice(
      dialogSource.indexOf("useEffect(() => {\n    if (!analysis) return;"),
      dialogSource.indexOf("}, [analysis]);") + "}, [analysis]);".length,
    );
    expect(effectBlock).toContain("setBlockOpen(next);");
    expect(effectBlock).toContain("setBlockDecisions({});");
  });

  test("ReviewBlock mostra '✓ Bloco aprovado' / '✓ Bloco ignorado' / 'Revisado manualmente' conforme o status", () => {
    const block = dialogSource.slice(dialogSource.indexOf("function ReviewBlock("));
    expect(block).toContain('status === "approved" && (');
    expect(block).toContain("✓ Bloco aprovado");
    expect(block).toContain('status === "ignored" && (');
    expect(block).toContain("✓ Bloco ignorado");
    expect(block).toContain('status === "manual" && (');
    expect(block).toContain("Revisado manualmente");
  });

  test("o botão já aplicado fica desabilitado (Aprovar bloco quando approved, Ignorar bloco quando ignored)", () => {
    const block = dialogSource.slice(dialogSource.indexOf("function ReviewBlock("));
    expect(block).toContain('disabled={status === "approved"}');
    expect(block).toContain('disabled={status === "ignored"}');
  });

  test("o resumo superior distingue classificação (verdict) de progresso de revisão por blocos, sem virar dashboard novo", () => {
    expect(dialogSource).toContain("blocksTotal: number;");
    expect(dialogSource).toContain("blocksReviewed: number;");
    expect(dialogSource).toContain("Progresso da revisão por blocos:");
    // Continua sendo só um <p>, não uma seção nova cheia de métricas.
    const summaryBlock = dialogSource.slice(
      dialogSource.indexOf("function ReviewSummaryCard("),
      dialogSource.indexOf("function ReviewBlock("),
    );
    expect((summaryBlock.match(/<section/g) ?? []).length).toBe(1);
  });

  test("nenhum comportamento de dedupe muda: contagens continuam vindo só de countReviewBlock (verdict/hasOverride/mode), status é um campo separado", () => {
    // countReviewBlock não recebe blockDecisions nem status como argumento em lugar nenhum.
    expect(dialogSource).not.toMatch(/countReviewBlock\([^)]*blockDecisions/);
    expect(dialogSource).not.toMatch(/countReviewBlock\([^)]*status/);
    // BlockDecisionRecord/BlockStatus não são importados nem usados por deduplication.ts,
    // meeting-analysis.ts ou embeddings.server.ts.
    const dedupeSource = read("src/lib/deduplication.ts");
    const embeddingsSource = read("src/lib/embeddings.server.ts");
    const analysisSrc = read("src/lib/meeting-analysis.ts");
    for (const src of [dedupeSource, embeddingsSource, analysisSrc]) {
      expect(src).not.toContain("BlockDecisionRecord");
      expect(src).not.toContain("BlockStatus");
      expect(src).not.toContain("blockDecisions");
    }
  });
});
