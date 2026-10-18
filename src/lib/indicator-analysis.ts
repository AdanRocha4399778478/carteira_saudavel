/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 2 (17/10/2026): análise pura de um
 * indicador a partir do seu histórico de pontos (ver
 * supabase/migrations/20261017120000_create_indicators.sql para o
 * schema de `indicators`/`indicator_points`). Regras decididas pelo
 * dono do produto:
 *
 * - Resultado só conta pontos "medido". Ponto "estimado" nunca entra no
 *   cálculo (delta/variação/status/progresso) — só aparece separado em
 *   `latestEstimated`, quando for mais recente que o último medido.
 * - Faixa neutra de ±2% do valor de base, igual pra todo indicador,
 *   sobre o MÓDULO da base (base negativa não inverte a faixa).
 * - Sem recomendação automática, sem sugestão de prioridade — só
 *   números e a situação (melhorou/piorou/neutro).
 * - Valor ausente NUNCA vira zero: tudo que não puder ser calculado
 *   (falta base, falta meta, falta ponto medido etc.) devolve `null`.
 *
 * Função pura, sem I/O: nenhuma chamada a `new Date()` nem `Date.now()`
 * em lugar nenhum — `measured_at`/`created_at` são strings ISO
 * ("AAAA-MM-DD" e timestamp, respectivamente) comparadas como texto, o
 * que já ordena cronologicamente corretamente sem precisar de objeto
 * Date nenhum (evita qualquer dependência de fuso horário/relógio de
 * quem executa).
 * ------------------------------------------------------------------ */

export type IndicatorDirection = "maior_melhor" | "menor_melhor";
export type IndicatorPointBasis = "medido" | "estimado";
export type IndicatorKind = "percentual" | "valor" | "tempo" | "quantidade";
export type IndicatorStatus = "melhorou" | "piorou" | "neutro";

export type IndicatorForAnalysis = {
  direction: IndicatorDirection;
  baseline_value: number | null;
  target_value: number | null;
};

export type IndicatorPointForAnalysis = {
  value: number;
  /** "AAAA-MM-DD". */
  measured_at: string;
  basis: IndicatorPointBasis;
  /** Timestamp ISO — desempate quando dois pontos têm o mesmo measured_at. */
  created_at?: string | null;
};

export type IndicatorAnalysis = {
  /** Valor do último ponto "medido" (por measured_at). null se não houver nenhum. */
  currentMeasured: number | null;
  /** Valor do último ponto "estimado", só quando mais recente que o último medido (ou quando não há medido nenhum). Nunca entra em delta/variationPct/status. */
  latestEstimated: number | null;
  /** currentMeasured - baseline_value. */
  delta: number | null;
  /** delta / |baseline_value| * 100 — null se a base for 0 ou nula. */
  variationPct: number | null;
  /** melhorou/piorou/neutro — null se faltar baseline ou ponto medido. */
  status: IndicatorStatus | null;
  /** (currentMeasured - baseline) / (target - baseline) * 100, SEM limitar — negativo mostra piora. null se faltar base, meta, ponto medido, ou base === meta. */
  progressRaw: number | null;
  /** progressRaw limitado a [0, 100] — para barra de progresso. */
  progressBar: number | null;
};

const NEUTRAL_BAND_PCT = 2;

/**
 * Compara dois pontos por "quão recente" — primeiro por `measured_at`
 * (string "AAAA-MM-DD", comparação lexicográfica = cronológica), depois
 * por `created_at` (string ISO, mesma lógica) quando `measured_at`
 * empata. Retorna > 0 se `a` é mais recente que `b`, < 0 se `b` é mais
 * recente, 0 se empatam nos dois critérios.
 */
function compareRecency(a: IndicatorPointForAnalysis, b: IndicatorPointForAnalysis): number {
  if (a.measured_at !== b.measured_at) return a.measured_at > b.measured_at ? 1 : -1;
  const aCreated = a.created_at ?? "";
  const bCreated = b.created_at ?? "";
  if (aCreated !== bCreated) return aCreated > bCreated ? 1 : -1;
  return 0;
}

/**
 * Último ponto de uma lista (por `compareRecency`). Em empate total
 * (mesmo measured_at, mesmo created_at ou os dois ausentes), o critério
 * é ORDEM ESTÁVEL: o primeiro ponto do array nessa posição é mantido —
 * nunca o de maior `value`, nunca um critério implícito novo. Só troca o
 * "mais recente até agora" quando encontra algo ESTRITAMENTE mais
 * recente (`> 0`), nunca em empate (`=== 0`).
 */
function pickLatest(points: IndicatorPointForAnalysis[]): IndicatorPointForAnalysis | null {
  let best: IndicatorPointForAnalysis | null = null;
  for (const p of points) {
    if (best === null || compareRecency(p, best) > 0) best = p;
  }
  return best;
}

/**
 * Regra de status, decidida pelo dono do produto — com uma regra de
 * borda que precisa da confirmação dele (documentada aqui e no
 * relatório do gate): quando `baseline_value === 0`, não dá pra
 * calcular variação percentual (divisão por zero), então o status usa
 * só o SINAL do delta na direção desejada, sem faixa neutra percentual —
 * só delta exatamente 0 é neutro. Ou seja, com base zero, QUALQUER
 * desvio (por menor que seja) já conta como melhora ou piora; a faixa
 * neutra de ±2% só existe quando há uma base diferente de zero para
 * calcular o percentual sobre ela.
 */
function computeStatus(
  direction: IndicatorDirection,
  baseline: number,
  delta: number,
  variationPct: number | null,
): IndicatorStatus {
  if (baseline === 0) {
    if (delta === 0) return "neutro";
    const improved = direction === "maior_melhor" ? delta > 0 : delta < 0;
    return improved ? "melhorou" : "piorou";
  }
  // baseline !== 0 aqui, então variationPct sempre está definido (não-null).
  const pct = variationPct as number;
  if (Math.abs(pct) <= NEUTRAL_BAND_PCT) return "neutro";
  if (direction === "maior_melhor") return pct > NEUTRAL_BAND_PCT ? "melhorou" : "piorou";
  return pct < -NEUTRAL_BAND_PCT ? "melhorou" : "piorou";
}

/**
 * Analisa um indicador a partir do seu histórico de pontos. Nunca lança
 * — tudo que não puder ser calculado devolve `null` nos campos
 * correspondentes, nunca 0 nem um valor inventado.
 */
export function analyzeIndicator(
  indicator: IndicatorForAnalysis,
  points: IndicatorPointForAnalysis[],
): IndicatorAnalysis {
  const measuredPoints = points.filter((p) => p.basis === "medido");
  const estimatedPoints = points.filter((p) => p.basis === "estimado");

  const latestMeasuredPoint = pickLatest(measuredPoints);
  const latestEstimatedPoint = pickLatest(estimatedPoints);

  const currentMeasured = latestMeasuredPoint ? latestMeasuredPoint.value : null;

  // Estimado só conta quando é mais recente que o último medido — ou
  // quando não há medido nenhum ainda (nesse caso, "mais recente que
  // nada" é sempre verdade: é o único dado disponível pra mostrar).
  let latestEstimated: number | null = null;
  if (latestEstimatedPoint) {
    if (!latestMeasuredPoint || compareRecency(latestEstimatedPoint, latestMeasuredPoint) > 0) {
      latestEstimated = latestEstimatedPoint.value;
    }
  }

  const baseline = indicator.baseline_value;
  const target = indicator.target_value;

  const delta = currentMeasured !== null && baseline !== null ? currentMeasured - baseline : null;

  const variationPct =
    delta === null || baseline === null || baseline === 0
      ? null
      : (delta / Math.abs(baseline)) * 100;

  const status =
    baseline === null || currentMeasured === null || delta === null
      ? null
      : computeStatus(indicator.direction, baseline, delta, variationPct);

  const progressRaw =
    baseline === null || target === null || currentMeasured === null || baseline === target
      ? null
      : ((currentMeasured - baseline) / (target - baseline)) * 100;

  const progressBar = progressRaw === null ? null : Math.min(100, Math.max(0, progressRaw));

  return {
    currentMeasured,
    latestEstimated,
    delta,
    variationPct,
    status,
    progressRaw,
    progressBar,
  };
}

/**
 * Formata um valor de indicador em português do Brasil. `null`/
 * `undefined` vira "—" — NUNCA "0" nem "R$ 0,00": valor ausente não é
 * zero, é desconhecido.
 */
export function formatIndicatorValue(
  kind: IndicatorKind,
  unit: string | null | undefined,
  value: number | null | undefined,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  if (kind === "percentual") {
    return `${new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(value)}%`;
  }

  // Moeda só quando a unidade é explicitamente "R$", ou quando kind é
  // "valor" SEM unidade (ausente/vazia) — "valor" não é sinônimo de
  // dinheiro: um indicador kind "valor" com unidade "x" (razão), "pontos"
  // etc. nunca deve virar "R$ 1,80" por causa do kind sozinho.
  const hasUnit = typeof unit === "string" && unit.trim().length > 0;
  if (unit === "R$" || (kind === "valor" && !hasUnit)) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  }

  // tempo, quantidade e "valor" com unidade própria (x, pontos...): número
  // em pt-BR, unidade ao lado quando houver.
  const formatted = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
  return hasUnit ? `${formatted} ${unit}` : formatted;
}
