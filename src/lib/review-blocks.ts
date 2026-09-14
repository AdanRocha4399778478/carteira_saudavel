import type { DedupeVerdict, ResolutionMode } from "@/lib/deduplication";

/* ------------------------------------------------------------------ *
 * GATE 10A — helpers puros da revisão em blocos da Reunião Inteligente.
 *
 * Não decide nada sozinho: só classifica o que já foi decidido por
 * `defaultResolution` (dedupe) ou pelo consultor (seleção manual em
 * contextSel/decisionSel/actionSel/riskSel/oppSel) e produz contagens e
 * "patches" para aplicar em lote nessas mesmas seleções. A fonte de verdade
 * continua sendo os mapas de seleção existentes no componente — este módulo
 * nunca guarda estado.
 * ------------------------------------------------------------------ */

export type ReviewBlockItem<K extends string | number = string | number> = {
  key: K;
  verdict: DedupeVerdict;
  /** Resolução atual (override do consultor, se houver, senão o default do dedupe). */
  mode: ResolutionMode;
  /** true quando o consultor já fez uma escolha explícita para este item. */
  hasOverride: boolean;
};

export type ReviewBlockCounts = {
  total: number;
  newCount: number;
  updateCount: number;
  /** POSSIBLE_DUPLICATE ainda sem decisão explícita do consultor. */
  reviewCount: number;
  /** Resolução atual é "skip" e o item não está mais pendente de revisão. */
  ignoredCount: number;
};

/**
 * POSSIBLE_DUPLICATE nunca decide sozinho: some enquanto o consultor não fizer
 * uma escolha explícita para aquele item específico.
 */
export function needsReview(item: Pick<ReviewBlockItem, "verdict" | "hasOverride">): boolean {
  return item.verdict === "POSSIBLE_DUPLICATE" && !item.hasOverride;
}

/** Verdicts cuja resolução default é inequívoca — nunca inclui POSSIBLE_DUPLICATE. */
export function isSafeVerdict(verdict: DedupeVerdict): boolean {
  return verdict !== "POSSIBLE_DUPLICATE";
}

/** Mesma regra de `defaultResolution` (src/lib/deduplication.ts), só o modo. */
export function defaultModeForVerdict(verdict: DedupeVerdict): ResolutionMode {
  if (verdict === "UPDATE_EXISTING") return "update";
  if (verdict === "NEW") return "create";
  return "skip";
}

export function countReviewBlock(
  items: Pick<ReviewBlockItem, "verdict" | "hasOverride" | "mode">[],
): ReviewBlockCounts {
  const counts: ReviewBlockCounts = {
    total: items.length,
    newCount: 0,
    updateCount: 0,
    reviewCount: 0,
    ignoredCount: 0,
  };
  for (const item of items) {
    if (item.verdict === "NEW") counts.newCount++;
    else if (item.verdict === "UPDATE_EXISTING") counts.updateCount++;

    if (needsReview(item)) counts.reviewCount++;
    else if (item.mode === "skip") counts.ignoredCount++;
  }
  return counts;
}

function pluralPt(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Texto do cabeçalho do bloco — ex.: "8 sugestões · 6 novas · 1 atualização · 1 para revisar". */
export function formatBlockSummary(counts: ReviewBlockCounts): string {
  return [
    pluralPt(counts.total, "sugestão", "sugestões"),
    pluralPt(counts.newCount, "nova", "novas"),
    pluralPt(counts.updateCount, "atualização", "atualizações"),
    `${counts.reviewCount} para revisar`,
  ].join(" · ");
}

/**
 * "Aplicar sugestões seguras" / "Aprovar bloco": aplica a resolução default a
 * todo item cujo verdict é inequívoco (NEW/UPDATE_EXISTING/EXISTING) e que o
 * consultor ainda não decidiu manualmente. Nunca toca em POSSIBLE_DUPLICATE
 * nem em item com override — devolve só o patch para itens realmente afetados.
 */
export function applySafeResolutions<K extends string | number>(
  items: ReviewBlockItem<K>[],
): Partial<Record<K, ResolutionMode>> {
  const patch: Partial<Record<K, ResolutionMode>> = {};
  for (const item of items) {
    if (item.hasOverride) continue;
    if (!isSafeVerdict(item.verdict)) continue;
    patch[item.key] = defaultModeForVerdict(item.verdict);
  }
  return patch;
}

/**
 * "Ignorar bloco": ação explícita do consultor sobre o bloco inteiro — define
 * skip para TODOS os itens, inclusive os que já tinham override manual ou
 * eram POSSIBLE_DUPLICATE.
 */
export function applyIgnoreBlock<K extends string | number>(
  items: ReviewBlockItem<K>[],
): Record<K, ResolutionMode> {
  const patch = {} as Record<K, ResolutionMode>;
  for (const item of items) patch[item.key] = "skip";
  return patch;
}

/* ------------------------------------------------------------------ *
 * GATE 10D — feedback visual de "Aprovar bloco" / "Ignorar bloco".
 *
 * "Aprovar bloco" com itens já no default (ex.: 3 NEW → create) reaplica o
 * MESMO modo — os contadores de classificação (verdict) não mudam, e por
 * isso não são a fonte certa para dizer se o bloco foi revisado. Em vez
 * disso, guardamos uma decisão explícita + um "retrato" do modo de cada
 * item no instante da decisão; comparar esse retrato com o modo ATUAL do
 * item é o que detecta que o consultor mexeu manualmente depois.
 * ------------------------------------------------------------------ */

export type BlockDecisionKind = "approved" | "ignored";

export type BlockDecisionRecord<K extends string | number = string | number> = {
  decision: BlockDecisionKind;
  /** Modo de cada item no momento da decisão (patch aplicado + o que já estava). */
  snapshot: Partial<Record<K, ResolutionMode>>;
};

export type BlockStatus = "none" | BlockDecisionKind | "manual";

/**
 * Modo efetivo de cada item logo após um patch em lote: o patch tem
 * prioridade; item fora do patch mantém o modo que já tinha.
 */
export function snapshotAfterPatch<K extends string | number>(
  items: ReviewBlockItem<K>[],
  patch: Partial<Record<K, ResolutionMode>>,
): Partial<Record<K, ResolutionMode>> {
  const snapshot: Partial<Record<K, ResolutionMode>> = {};
  for (const item of items) snapshot[item.key] = patch[item.key] ?? item.mode;
  return snapshot;
}

/** true enquanto o modo atual de cada item do bloco ainda bate com o retrato guardado. */
export function blockMatchesSnapshot<K extends string | number>(
  items: ReviewBlockItem<K>[],
  snapshot: Partial<Record<K, ResolutionMode>>,
): boolean {
  return items.every((item) => snapshot[item.key] === item.mode);
}

/**
 * Estado visual coerente do bloco. Nunca afirma "aprovado"/"ignorado" se
 * algum item mudou de modo depois da decisão (edição manual do consultor,
 * ou uma nova decisão de bloco mais recente) — nesse caso vira "manual".
 */
export function computeBlockStatus<K extends string | number>(
  items: ReviewBlockItem<K>[],
  record: BlockDecisionRecord<K> | undefined,
): BlockStatus {
  if (!record) return "none";
  return blockMatchesSnapshot(items, record.snapshot) ? record.decision : "manual";
}
