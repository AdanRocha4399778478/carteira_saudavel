import { DEDUPE_THRESHOLDS, similarity } from "@/lib/deduplication";

/* ------------------------------------------------------------------ *
 * GATE 12 — consolidação temática + action-first.
 *
 * Módulo puro (sem Supabase/fetch/zod) — roda ANTES do dedupe contra o
 * banco (matchAction/matchDecision/... em deduplication.ts, que continua
 * 100% inalterado). Esta etapa só limpa repetição DENTRO da própria análise
 * recém-gerada pela IA (que hoje só é deduplicada por CHAVE EXATA entre
 * blocos, em `consolidate()`/`mergeList` de intelligent-meeting.server.ts —
 * por isso "sair da antecipação automática" e "reduzir antecipação" nunca
 * se juntavam: são textos diferentes, mesma chave normalizada nunca bate).
 *
 * Pipeline (intelligent-meeting.server.ts):
 *   análise bruta → consolidate() [merge exato entre blocos, já existia]
 *   → consolidateAnalysis() [ESTE MÓDULO: fuzzy dentro da análise já unida]
 *   → embeddings (getEmbeddings, inalterado)
 *   → dedupe contra o banco (deduplication.ts, inalterado)
 *   → revisão do consultor (MeetingAnalysisDialog.tsx)
 *
 * Reaproveita `similarity()` de deduplication.ts (a mesma função textual do
 * nível 2 do dedupe) como motor de comparação — não é um método novo, é o
 * mesmo já calibrado (containment, trigramas, qualificadores concorrentes)
 * usado num estágio anterior. Não usa embeddings (evita uma segunda chamada
 * à OpenAI — ver nota no GATE 12 sobre custo).
 * ------------------------------------------------------------------ */

/** Limiar de consolidação: reaproveita o mesmo "duplicidade provável" já calibrado do dedupe — não inventa um novo número mágico. */
export const CONSOLIDATION_THRESHOLD: number = DEDUPE_THRESHOLDS.high;

/* ---------------- consolidação textual genérica ---------------- */

export type TextCluster = { canonicalIndex: number; memberIndices: number[] };

/**
 * Agrupa itens quase idênticos (similarity >= threshold) de forma gulosa e
 * estável: cada item entra no primeiro/melhor cluster já formado cujo
 * representante atual bate o limiar; senão vira um cluster novo. O
 * representante do cluster é sempre o texto mais longo já visto (mais
 * completo) — nunca um texto sintetizado/inventado.
 */
export function clusterBySimilarity(texts: string[], threshold: number = CONSOLIDATION_THRESHOLD): TextCluster[] {
  const clusters: TextCluster[] = [];
  for (let i = 0; i < texts.length; i++) {
    const text = (texts[i] ?? "").trim();
    if (!text) continue;
    let best: { cluster: TextCluster; score: number } | null = null;
    for (const cluster of clusters) {
      const canonicalText = texts[cluster.canonicalIndex] ?? "";
      const score = similarity(text, canonicalText);
      if (score >= threshold && (!best || score > best.score)) best = { cluster, score };
    }
    if (best) {
      best.cluster.memberIndices.push(i);
      if (text.length > (texts[best.cluster.canonicalIndex] ?? "").length) {
        best.cluster.canonicalIndex = i;
      }
    } else {
      clusters.push({ canonicalIndex: i, memberIndices: [i] });
    }
  }
  return clusters;
}

/**
 * Aplica `clusterBySimilarity` a uma lista de itens de qualquer forma,
 * usando `getText` para extrair o texto comparável e `mergeInto` para
 * combinar um duplicado no canônico (preenchendo só campos vazios — nunca
 * sobrescreve informação já presente, nunca inventa).
 */
export function consolidateItems<T>(
  items: T[],
  getText: (item: T) => string,
  mergeInto: (canonical: T, duplicate: T) => T,
  threshold: number = CONSOLIDATION_THRESHOLD,
): { items: T[]; mergedCount: number; groups: TextCluster[] } {
  const texts = items.map(getText);
  const clusters = clusterBySimilarity(texts, threshold);
  const out: T[] = [];
  let mergedCount = 0;
  for (const cluster of clusters) {
    let canonical: T = items[cluster.canonicalIndex]!;
    for (const idx of cluster.memberIndices) {
      if (idx === cluster.canonicalIndex) continue;
      canonical = mergeInto(canonical, items[idx]!);
      mergedCount++;
    }
    out.push(canonical);
  }
  return { items: out, mergedCount, groups: clusters.filter((c) => c.memberIndices.length > 1) };
}

/** Merge padrão para strings: o cluster já escolhe o texto mais longo como canônico — nada a fazer aqui. */
export function keepCanonicalString(canonical: string, _duplicate: string): string {
  return canonical;
}

/**
 * Merge padrão para registros JSON-like: preenche campos VAZIOS do canônico
 * com o valor do duplicado, nunca sobrescreve um valor já preenchido, nunca
 * soma/inventa. Usado para decisions/actions/risks/opportunities — evita
 * perder owner/prazo/evidência quando um dos dois itens quase-idênticos
 * tinha um dado que o outro não tinha.
 */
export function mergeRecordPreferFilled(
  canonical: Record<string, unknown>,
  duplicate: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...canonical };
  for (const key of Object.keys(duplicate)) {
    const current = String(out[key] ?? "").trim();
    const incoming = String(duplicate[key] ?? "").trim();
    if (!current && incoming) out[key] = duplicate[key];
  }
  return out;
}

/* ---------------- action-first: classificação de execução ---------------- */

export type ExecutionClassification = "executable" | "strategic" | "ambiguous";

function normalizeForClassification(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Radicais de verbos operacionais — cobre a REGRA CENTRAL do GATE 12
 * (fazer/entregar/verificar/analisar/enviar/negociar/cobrar/configurar/
 * agendar/acompanhar/preparar/implementar) mais sinônimos operacionais
 * recorrentes em reunião consultiva (consultar, montar, buscar, levantar,
 * comparar, desativar, definir, reduzir, retirar, revisar, contratar...).
 * Radical, não palavra exata, para cobrir conjugações (agendar/agende/
 * agendou) sem depender de um lematizador.
 */
const EXECUTABLE_VERB_STEMS = [
  "faz", "entreg", "verific", "analis", "envi", "negoci", "cobr", "configur", "agend", "acompanh",
  "prepar", "implement", "consult", "mont", "busc", "levant", "compar", "desativ", "defin", "reduz",
  "retir", "sair", "revis", "atualiz", "contrat", "solicit", "organiz", "elabor", "estrutur",
];

/**
 * Marcadores de continuidade/estratégia: presença forte de "sem fim
 * definido", contínuo entre reuniões — não é uma tarefa que se conclui uma
 * vez. Downgrade para "ambiguous" mesmo com verbo operacional (ex.:
 * "acompanhar evolução da saúde financeira ao longo dos próximos ciclos").
 */
const STRATEGIC_MARKER_RE =
  /\b(ao longo|evolu[cç][aã]o|tendenci|em geral|continuamente|de forma continua|proximos ciclos|manter o foco|no dia a dia)\b/;

/**
 * Objeto abstrato/conceitual (não uma tarefa concreta e limitada) — ex.:
 * "reduzir dependência de antecipação" é uma orientação estratégica, não
 * uma ação executável isolada (a ação concreta seria "desativar
 * antecipação automática", "levantar taxas atuais" etc.).
 */
const ABSTRACT_OBJECT_RE = /\b(dependencia|necessidade|importancia|relevancia)\b/;

/**
 * Classifica um next_step em três buckets. "ambiguous" nunca é convertido
 * automaticamente — fica em next_steps e conta como pendente na UI (nunca
 * criar ação sozinha sobre um item ambíguo).
 */
export function classifyExecutionItem(text: string): ExecutionClassification {
  const t = normalizeForClassification(text);
  if (!t) return "strategic";
  const words = t.split(" ");
  const hasOperationalVerb = EXECUTABLE_VERB_STEMS.some((stem) => words.some((w) => w.startsWith(stem)));
  if (!hasOperationalVerb) return "strategic";
  if (STRATEGIC_MARKER_RE.test(t)) return "ambiguous";
  if (ABSTRACT_OBJECT_RE.test(t)) return "ambiguous";
  return "executable";
}

/* ---------------- action-first: normalização de next_steps ---------------- */

export type NormalizeExecutionItemsResult<S, A> = {
  /** Direções estratégicas não executáveis — permanecem em next_steps sem aviso. */
  strategicNextSteps: S[];
  /** Executáveis, mas classificação ambígua — permanecem em next_steps E contam como pendentes (Z). */
  pendingNextSteps: S[];
  /** Ações novas propostas para next_steps executáveis sem correspondente já existente. */
  proposedActions: A[];
  /** Executáveis que já tinham uma action semanticamente correspondente — não duplicados. */
  reusedCount: number;
  /** proposedActions.length + reusedCount — total de next_steps convertidos em execução. */
  convertedCount: number;
};

/**
 * Regra "action first" (Fase 3/4): todo next_step classificado como
 * EXECUTABLE deixa de existir como next_step e passa a existir como action
 * — nova (se não houver correspondente) ou reaproveitada (se já houver,
 * evitando duplicidade). STRATEGIC permanece. AMBIGUOUS permanece mas é
 * reportado como pendente — nunca decide sozinho.
 */
export function normalizeExecutionItems<S, A>(
  nextSteps: S[],
  getStepText: (step: S) => string,
  existingActions: A[],
  getActionText: (action: A) => string,
  buildAction: (step: S) => A,
  threshold: number = CONSOLIDATION_THRESHOLD,
): NormalizeExecutionItemsResult<S, A> {
  const strategicNextSteps: S[] = [];
  const pendingNextSteps: S[] = [];
  const proposedActions: A[] = [];
  let reusedCount = 0;

  for (const step of nextSteps) {
    const text = getStepText(step);
    const classification = classifyExecutionItem(text);

    if (classification === "strategic") {
      strategicNextSteps.push(step);
      continue;
    }
    if (classification === "ambiguous") {
      pendingNextSteps.push(step);
      continue;
    }

    const alreadyCovered =
      existingActions.some((a) => similarity(text, getActionText(a)) >= threshold) ||
      proposedActions.some((a) => similarity(text, getActionText(a)) >= threshold);

    if (alreadyCovered) {
      reusedCount += 1;
      continue;
    }
    proposedActions.push(buildAction(step));
  }

  return {
    strategicNextSteps,
    pendingNextSteps,
    proposedActions,
    reusedCount,
    convertedCount: proposedActions.length + reusedCount,
  };
}

/* ---------------- orquestração sobre o JSON bruto da análise ---------------- */

type Json = Record<string, unknown>;

function asArray(v: unknown): Json[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : [];
}

function textOf(item: Json, field: string): string {
  return String(item[field] ?? "");
}

export type ExecutionQualitySummary = {
  proposedActions: number;
  convertedFromNextSteps: number;
  pendingWithoutAction: number;
  pendingNextSteps: string[];
  repetitionGroupsReduced: number;
};

/**
 * Roda a consolidação fuzzy dentro de cada categoria (Fase 5/6) e a
 * normalização action-first de next_steps (Fase 3/4) sobre o objeto
 * `{identification, analysis}` já retornado por `consolidate()` em
 * intelligent-meeting.server.ts — mesma forma de entrada/saída, só com
 * menos repetição e next_steps executáveis convertidos em actions.
 * Nunca inventa: só reagrupa/preenche com dados já presentes na própria
 * análise recebida.
 */
export function consolidateAnalysis(consolidated: Json): { result: Json; quality: ExecutionQualitySummary } {
  const analysis = { ...((consolidated["analysis"] as Json) ?? {}) };
  const contextUpdates = { ...((analysis["context_updates"] as Json) ?? {}) };

  let repetitionGroupsReduced = 0;

  const CONTEXT_TEXT_LISTS = [
    "objectives",
    "problems",
    "root_causes",
    "priorities",
    "hypotheses",
    "constraints",
    "results",
  ] as const;

  for (const key of CONTEXT_TEXT_LISTS) {
    const items = asArray(contextUpdates[key]);
    const { items: merged, groups } = consolidateItems(items, (i) => textOf(i, "content"), mergeRecordPreferFilled);
    contextUpdates[key] = merged;
    repetitionGroupsReduced += groups.length;
  }

  // decisions/actions/risks/opportunities: consolidação fuzzy dentro da própria categoria.
  const decisionsConsolidated = consolidateItems(
    asArray(analysis["decisions"]),
    (i) => textOf(i, "title"),
    mergeRecordPreferFilled,
  );
  const risksConsolidated = consolidateItems(
    asArray(analysis["risks"]),
    (i) => textOf(i, "description"),
    mergeRecordPreferFilled,
  );
  const opportunitiesConsolidated = consolidateItems(
    asArray(analysis["opportunities"]),
    (i) => textOf(i, "description"),
    mergeRecordPreferFilled,
  );
  const actionsConsolidated = consolidateItems(
    asArray(analysis["actions"]),
    (i) => textOf(i, "description"),
    mergeRecordPreferFilled,
  );
  repetitionGroupsReduced +=
    decisionsConsolidated.groups.length +
    risksConsolidated.groups.length +
    opportunitiesConsolidated.groups.length +
    actionsConsolidated.groups.length;

  analysis["decisions"] = decisionsConsolidated.items;
  analysis["risks"] = risksConsolidated.items;
  analysis["opportunities"] = opportunitiesConsolidated.items;

  // next_steps: primeiro consolida fuzzy dentro da própria lista, depois action-first.
  const nextStepsConsolidated = consolidateItems(
    asArray(contextUpdates["next_steps"]),
    (i) => textOf(i, "content"),
    mergeRecordPreferFilled,
  );
  repetitionGroupsReduced += nextStepsConsolidated.groups.length;

  const execution = normalizeExecutionItems<Json, Json>(
    nextStepsConsolidated.items,
    (step) => textOf(step, "content"),
    actionsConsolidated.items,
    (action) => textOf(action, "description"),
    (step) => ({
      description: textOf(step, "content"),
      owner_name: "",
      deadline: "",
      priority: "",
      evidence: `Convertido automaticamente do próximo passo: "${textOf(step, "content")}"`,
      classification: "suggestion",
    }),
  );

  contextUpdates["next_steps"] = [...execution.strategicNextSteps, ...execution.pendingNextSteps];
  analysis["actions"] = [...actionsConsolidated.items, ...execution.proposedActions];
  analysis["context_updates"] = contextUpdates;

  return {
    result: { ...consolidated, analysis },
    quality: {
      proposedActions: execution.proposedActions.length,
      convertedFromNextSteps: execution.convertedCount,
      pendingWithoutAction: execution.pendingNextSteps.length,
      pendingNextSteps: execution.pendingNextSteps.map((s) => textOf(s, "content")),
      repetitionGroupsReduced,
    },
  };
}
