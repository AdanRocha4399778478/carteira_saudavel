/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate B (18/10/2026): casamento de
 * um indicador sugerido pela IA com os indicadores já existentes do
 * projeto. Regra do dono do produto (18/10/2026): identidade é NOME
 * NORMALIZADO (ver indicator-name.ts) + KIND iguais — nunca
 * similaridade de texto nem embedding (isso é deliberado: diferente do
 * dedupe de decisões/ações/riscos/oportunidades em deduplication.ts).
 *
 * Casou → a sugestão vira ANEXAR um novo ponto à série do indicador
 * existente. Não casou → vira CRIAR um indicador novo. Duas ou mais
 * chaves iguais entre os existentes → ambíguo, sem casamento automático
 * (o consultor escolhe à mão num seletor — isso é o Gate C, ainda não
 * implementado; aqui só a sinalização `ambiguous`). Criar um indicador
 * sem direção não é permitido pela modelagem (indicators.direction é
 * NOT NULL) — `needsDirection` sinaliza esse caso pro Gate C perguntar,
 * já que a IA pode ter vindo com direction "" (dúvida).
 *
 * Função pura, sem I/O — só compara os dados já carregados.
 * ------------------------------------------------------------------ */

import { normalizeIndicatorName } from "./indicator-name";
import type { IndicatorRow } from "./indicators-data";
import type { IndicatorSuggestion } from "./meeting-analysis";

/** Só os campos que o casamento precisa — qualquer linha de indicatorsQuery serve. */
export type ExistingIndicatorForMatch = Pick<IndicatorRow, "id" | "name" | "kind" | "direction">;

export type IndicatorMatch = {
  indicator: ExistingIndicatorForMatch | null;
  /** true quando duas ou mais linhas existentes têm a mesma chave (nome normalizado + kind). */
  ambiguous: boolean;
};

/**
 * Casa por nome normalizado + kind, exatos — nunca por similaridade.
 * Mais de um existente com a mesma chave é ambíguo: `indicator` vem
 * `null` e `ambiguous` vira `true` (sem escolher um dos dois sozinho).
 */
export function matchIndicatorByName(
  name: string,
  kind: string,
  existing: ExistingIndicatorForMatch[],
): IndicatorMatch {
  const key = normalizeIndicatorName(name);
  const matches = existing.filter((e) => normalizeIndicatorName(e.name) === key && e.kind === kind);
  if (matches.length === 0) return { indicator: null, ambiguous: false };
  if (matches.length > 1) return { indicator: null, ambiguous: true };
  return { indicator: matches[0]!, ambiguous: false };
}

export type IndicatorSuggestionPlan = {
  action: "attach" | "create";
  /** O indicador existente, só quando action é "attach". */
  target: ExistingIndicatorForMatch | null;
  /** Duas ou mais chaves iguais entre os existentes — nenhum casamento automático. */
  ambiguous: boolean;
  /**
   * Só relevante quando action é "create": a IA sugeriu o indicador sem
   * direção (direction ""), e indicators.direction é obrigatória — o
   * Gate C precisa perguntar antes de gravar. Sempre false ao anexar
   * (a direção já existe no indicador alvo).
   */
  needsDirection: boolean;
};

/**
 * Monta o plano de resolução de UMA sugestão da IA contra os
 * indicadores já existentes do projeto (ver regras no topo do arquivo).
 */
export function planIndicatorSuggestion(
  suggestion: IndicatorSuggestion,
  existing: ExistingIndicatorForMatch[],
): IndicatorSuggestionPlan {
  const { indicator, ambiguous } = matchIndicatorByName(suggestion.name, suggestion.kind, existing);
  if (indicator) {
    return { action: "attach", target: indicator, ambiguous: false, needsDirection: false };
  }
  return {
    action: "create",
    target: null,
    ambiguous,
    needsDirection: suggestion.direction === "",
  };
}
