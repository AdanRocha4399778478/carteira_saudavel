/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate C (18/10/2026): rascunho
 * editável de UMA sugestão de indicador da IA, até virar o item que
 * applyApprovedAnalysis grava (ApprovedIndicatorItem — ver Gate D,
 * meeting-analysis.ts). Funções puras, sem I/O; a tela
 * (IndicatorSuggestionsBlock.tsx) só chama estas funções.
 *
 * A validação de bloqueio REAPROVEITA validateApprovedIndicator (Gate D)
 * em vez de reinventar regras aqui — garante que "o que a tela deixa
 * aprovar" é exatamente "o que o backend aceita gravar", nunca uma cópia
 * que pode desalinhar.
 * ------------------------------------------------------------------ */

import type { IndicatorDirection, IndicatorPointBasis } from "./indicator-analysis";
import { formatNumberForInput, parseNumberPtBr } from "./indicator-form";
import type { IndicatorSuggestionPlan } from "./indicator-match";
import {
  validateApprovedIndicator,
  type ApprovedIndicatorItem,
  type IndicatorSuggestion,
} from "./meeting-analysis";

export type IndicatorDraft = {
  action: "attach" | "create" | "skip";
  /** Só usado quando action é "attach" — indicador escolhido à mão (ou pelo casamento automático). */
  targetIndicatorId: string | null;
  /** Texto bruto em pt-BR — parseNumberPtBr decide se é um número válido. */
  valueText: string;
  /** "" = sem pré-seleção (nunca escolhida por nós); obrigatória quando action não é "skip". */
  basis: IndicatorPointBasis | "";
  /** "" usa a data da reunião na gravação; se preenchida, precisa ser uma data real. */
  measuredAt: string;
  /** Só relevante (e obrigatória) quando action é "create" — indicators.direction é NOT NULL. */
  direction: IndicatorDirection | "";
  /** Texto bruto em pt-BR, só usado quando action é "create" — "" vira null (sem base). */
  baselineValueText: string;
};

/**
 * Rascunho inicial de UMA sugestão, a partir do plano de casamento
 * (planIndicatorSuggestion — indicator-match.ts). Casou (não ambíguo) →
 * começa como "attach" já com o alvo preenchido. Ambíguo (18/10/2026,
 * ajuste do dono do produto) → começa como "attach" TAMBÉM, mas SEM
 * alvo: nunca escolhe um dos existentes sozinho, e fica bloqueante
 * (ver blockingIndicatorCount) até o consultor escolher um na lista,
 * trocar pra "Criar novo" ou "Ignorar". Não casou e não ambíguo →
 * começa como "create", sem alvo. basis e direction só vêm preenchidos
 * quando a própria sugestão já veio com eles — nunca um valor escolhido
 * por nós.
 */
export function defaultIndicatorDraft(
  suggestion: IndicatorSuggestion,
  plan: IndicatorSuggestionPlan,
): IndicatorDraft {
  return {
    action: plan.ambiguous ? "attach" : plan.action,
    targetIndicatorId: plan.target?.id ?? null,
    valueText: formatNumberForInput(suggestion.value),
    basis: suggestion.basis,
    measuredAt: suggestion.measured_at,
    direction: suggestion.direction,
    baselineValueText: formatNumberForInput(suggestion.baseline_value),
  };
}

/**
 * Aplica uma edição do consultor a um rascunho. Trocar pra qualquer ação
 * diferente de "attach" sempre esvazia o alvo escolhido — evita um
 * targetIndicatorId de uma escolha anterior sobreviver escondido se o
 * consultor voltar pra "Anexar existente" depois.
 */
export function applyIndicatorEdit(
  draft: IndicatorDraft,
  patch: Partial<IndicatorDraft>,
): IndicatorDraft {
  const next = { ...draft, ...patch };
  if (next.action !== "attach") next.targetIndicatorId = null;
  return next;
}

/**
 * Monta a lista de ApprovedIndicatorItem (Gate D) a partir das sugestões
 * da IA e dos rascunhos atuais do consultor — name/kind/unit/evidence
 * sempre vêm da sugestão (não são editáveis nesta tela); o resto vem do
 * rascunho. `value`/`baseline_value` ausentes ou inválidos (texto que
 * não é um número pt-BR) viram `null`, nunca 0 — validateApprovedIndicator
 * trata `value: null` como erro de bloqueio (exceto quando action é
 * "skip").
 */
export function buildApprovedIndicators(
  suggestions: IndicatorSuggestion[],
  drafts: IndicatorDraft[],
): ApprovedIndicatorItem[] {
  return suggestions.map((suggestion, i) => {
    const draft = drafts[i];
    if (!draft) {
      throw new Error(`Rascunho ausente para o indicador sugerido no índice ${i}.`);
    }
    return {
      action: draft.action,
      target_indicator_id: draft.action === "attach" ? draft.targetIndicatorId : null,
      name: suggestion.name,
      kind: suggestion.kind,
      unit: suggestion.unit,
      direction: draft.direction,
      value: parseNumberPtBr(draft.valueText),
      baseline_value: draft.action === "create" ? parseNumberPtBr(draft.baselineValueText) : null,
      basis: draft.basis,
      measured_at: draft.measuredAt,
      evidence: suggestion.evidence,
    };
  });
}

/**
 * Quantos itens AINDA bloqueiam a aprovação — mesma regra que
 * applyApprovedAnalysis vai aplicar (validateApprovedIndicator), nunca
 * uma regra à parte. "Ignorar" nunca bloqueia.
 */
export function blockingIndicatorCount(items: ApprovedIndicatorItem[]): number {
  return items.filter((item) => validateApprovedIndicator(item).length > 0).length;
}
