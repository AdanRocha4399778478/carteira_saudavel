import { combinedSimilarity, DEDUPE_THRESHOLDS, similarity } from "@/lib/deduplication";

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

/* ==================================================================== *
 * GATE 12B — consolidação SEMÂNTICA (embeddings), além da fuzzy lexical
 * acima. `consolidateAnalysis` (GATE 12A) fica intocada e continua
 * exportada/testada — esta é uma função SEPARADA, chamada pelo pipeline
 * no lugar dela quando embeddings temporários estão disponíveis.
 *
 * Por quê uma função nova em vez de estender `consolidateAnalysis`: a
 * lexical sozinha (GATE 12A) não reconhecia "sair da antecipação
 * automática" ≈ "reduzir a antecipação" (poucos tokens em comum). Medindo
 * com embeddings reais (text-embedding-3-small, script de diagnóstico —
 * ver GATE 12B Fase 11), esses pares batem 0.62-0.76 de cosseno — bem
 * abaixo de DEDUPE_THRESHOLDS.high (0.90), que por isso NÃO é reaproveitado
 * aqui (documentado no threshold abaixo, não é tentativa-e-erro).
 * ==================================================================== */

/**
 * Limiar de consolidação SEMÂNTICA — medido com pares reais (não fixture
 * ajustado por tentativa e erro), via `combinedSimilarity` (max(lexical,
 * cosseno), reaproveitando deduplication.ts sem alterá-lo):
 *
 *   DEVEM consolidar (combined medido):
 *     A) "verificar linha de crédito no banco" × "consultar banco sobre linha de crédito"  → 0.625
 *     B) "sair da antecipação automática"      × "reduzir a antecipação"                    → 0.757
 *     F) "reduzir antecipação"                 × "desativar antecipação automática"         → 0.700
 *   NÃO devem consolidar (combined medido):
 *     D) "cobrar clientes vencidos"            × "negociar prazo com fornecedores"           → 0.580
 *     E) "consultar linhas de crédito"         × "comparar CET com antecipação"               → 0.565
 *     C) "analisar taxas da maquininha"        × "comparar custo do crédito com antecipação"  → 0.486
 *     G) "montar balanço"                      × "cobrar clientes vencidos"                   → 0.306
 *
 * 0.60 é o valor mínimo que separa corretamente TODOS os 7 pares medidos
 * (maior "não deve" = D em 0.580; menor "deve" = A em 0.625). A margem real
 * é de só 0.045 — documentada como risco conhecido (ver relatório do GATE
 * 12B), não escondida. Escolhido UMA VEZ a partir da medição.
 */
export const SEMANTIC_CONSOLIDATION_THRESHOLD = 0.6;

const CONFLICT_FIELDS = ["owner_name", "owner", "deadline", "due_date"] as const;

/**
 * Fase 7 (GATE 12B): dois registros têm CONFLITO MATERIAL se ambos
 * preenchem o MESMO campo sensível (responsável/prazo) com valores
 * DIFERENTES. Nesse caso, nunca consolidar silenciosamente — mesmo com
 * texto/embedding muito parecidos, pode ser tarefa distinta ou atribuição
 * divergente que o consultor precisa ver separada.
 */
export function hasFieldConflict(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  for (const field of CONFLICT_FIELDS) {
    const va = String(a[field] ?? "").trim();
    const vb = String(b[field] ?? "").trim();
    if (va && vb && va.toLowerCase() !== vb.toLowerCase()) return true;
  }
  return false;
}

/** Merge que respeita conflito material — nunca mescla se `hasFieldConflict` for true (proteção redundante na borda; o clustering já deveria ter barrado via `canMerge`). */
export function mergeRecordPreferFilledGuarded(
  canonical: Record<string, unknown>,
  duplicate: Record<string, unknown>,
): Record<string, unknown> {
  if (hasFieldConflict(canonical, duplicate)) return canonical;
  return mergeRecordPreferFilled(canonical, duplicate);
}

/**
 * Clustering embedding-aware: mesma lógica gulosa de `clusterBySimilarity`,
 * mas o score de cada par é `combinedSimilarity` (max(lexical, cosseno) —
 * reaproveita deduplication.ts sem alterá-lo). `canMerge` é uma segunda
 * porta: mesmo com score acima do limiar, só entra no cluster se também
 * passar nessa checagem (usada para bloquear merge com conflito de
 * owner/prazo).
 */
export function clusterSemantic<T>(
  items: T[],
  getText: (item: T) => string,
  getEmbedding: (item: T) => number[] | null | undefined,
  threshold: number = SEMANTIC_CONSOLIDATION_THRESHOLD,
  canMerge: (a: T, b: T) => boolean = () => true,
): TextCluster[] {
  const clusters: TextCluster[] = [];
  for (let i = 0; i < items.length; i++) {
    const text = getText(items[i]!).trim();
    if (!text) continue;
    let best: { cluster: TextCluster; score: number } | null = null;
    for (const cluster of clusters) {
      const canonicalItem = items[cluster.canonicalIndex]!;
      const score = combinedSimilarity(
        text,
        getText(canonicalItem),
        getEmbedding(items[i]!),
        getEmbedding(canonicalItem),
      );
      if (score >= threshold && canMerge(canonicalItem, items[i]!) && (!best || score > best.score)) {
        best = { cluster, score };
      }
    }
    if (best) {
      best.cluster.memberIndices.push(i);
      if (text.length > getText(items[best.cluster.canonicalIndex]!).length) {
        best.cluster.canonicalIndex = i;
      }
    } else {
      clusters.push({ canonicalIndex: i, memberIndices: [i] });
    }
  }
  return clusters;
}

/** Aplica `clusterSemantic` a uma lista de itens e produz {items, mergedCount, groups}. */
export function consolidateItemsSemantic<T>(
  items: T[],
  getText: (item: T) => string,
  getEmbedding: (item: T) => number[] | null | undefined,
  mergeInto: (canonical: T, duplicate: T) => T,
  canMerge: (a: T, b: T) => boolean = () => true,
  threshold: number = SEMANTIC_CONSOLIDATION_THRESHOLD,
): { items: T[]; mergedCount: number; groups: TextCluster[] } {
  const clusters = clusterSemantic(items, getText, getEmbedding, threshold, canMerge);
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

/**
 * Variante embedding-aware de `normalizeExecutionItems`: mesma regra
 * action-first (Fase 3/4 do GATE 12), mas a checagem "já existe action
 * correspondente" usa `combinedSimilarity` em vez de só `similarity()` —
 * reconhece "consultar banco sobre crédito" como coberto por "verificar
 * linha de crédito no banco" mesmo com poucas palavras em comum.
 */
export function normalizeExecutionItemsSemantic<S, A>(
  nextSteps: S[],
  getStepText: (step: S) => string,
  getStepEmbedding: (step: S) => number[] | null | undefined,
  existingActions: A[],
  getActionText: (action: A) => string,
  getActionEmbedding: (action: A) => number[] | null | undefined,
  buildAction: (step: S) => A,
  threshold: number = SEMANTIC_CONSOLIDATION_THRESHOLD,
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

    const stepEmbedding = getStepEmbedding(step);
    const alreadyCovered =
      existingActions.some(
        (a) => combinedSimilarity(text, getActionText(a), stepEmbedding, getActionEmbedding(a)) >= threshold,
      ) ||
      proposedActions.some(
        (a) => combinedSimilarity(text, getActionText(a), stepEmbedding, getActionEmbedding(a)) >= threshold,
      );

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

export type SemanticGroup = { category: string; canonicalText: string; mergedTexts: string[] };

export type SemanticConsolidationSummary = {
  totalBefore: number;
  totalAfter: number;
  mergedCount: number;
  groups: SemanticGroup[];
};

/** Item de contexto com embedding TEMPORÁRIO anexado só para esta análise (nunca persistido). */
type ContextItemWithTempEmbedding = Json & { __embedding?: number[] | null };

function toSemanticGroups<T>(
  category: string,
  items: T[],
  getText: (item: T) => string,
  groups: TextCluster[],
): SemanticGroup[] {
  return groups.map((g) => ({
    category,
    canonicalText: getText(items[g.canonicalIndex]!),
    mergedTexts: g.memberIndices.filter((i) => i !== g.canonicalIndex).map((i) => getText(items[i]!)),
  }));
}

/* ==================================================================== *
 * GATE 12B.1 — proteção contra over-merge semântico.
 *
 * Erro real observado: em `priorities`, "Diminuir a dependência de capital
 * de curto prazo" foi fundido com "Melhorar previsibilidade financeira"
 * (combined medido = 0.6159 — passa o limiar 0.60). Ao mesmo tempo,
 * "Consultar o banco sobre linha de crédito para capital de giro" +
 * "Verificar quais linhas de crédito estão disponíveis no banco" (combined
 * medido = 0.6464) é um merge correto. A diferença real medida entre os
 * dois pares não está no score combinado (quase idêntico, 0.616 vs 0.646)
 * — está na sobreposição LEXICAL: o par certo compartilha vocabulário
 * ("banco", "linha", "crédito" — lexical 0.4286); o par errado não
 * compartilha nada (lexical 0.0135). Cosine sozinho, para contexto
 * estratégico curto e abstrato, não separa "mesma ideia parafraseada" de
 * "temas relacionados mas distintos" — precisa de uma segunda evidência.
 *
 * Medição completa dos 8 pares pedidos (Fase 6/7) + os 2 pares reais do
 * incidente confirma uma separação limpa por LEXICAL, com folga grande:
 *   maior lexical entre os "não devem consolidar" = 0.0435
 *   menor lexical entre os "devem consolidar"      = 0.4286
 * `lexicalFloor = 0.20` fica bem no meio dessa faixa (folga de ~0.24 para
 * cada lado) — não é o valor exato de nenhum par, escolhido com margem.
 * ==================================================================== */

export type SemanticConsolidationPolicy = {
  /** Score combinado (max(lexical, cosseno)) mínimo — mesmo valor para as duas categorias; o que muda é a exigência abaixo. */
  semanticThreshold: number;
  /** Similaridade LEXICAL mínima exigida quando `allowSemanticOnly` é false — evidência de núcleo conceitual comum, não só tema. */
  lexicalFloor: number;
  /** true: cosine sozinho já basta (categorias de EXECUÇÃO). false: exige TAMBÉM lexical >= lexicalFloor (CONTEXTO ESTRATÉGICO). */
  allowSemanticOnly: boolean;
};

/** actions/next_steps (antes da promoção)/decisions/risks/opportunities — itens concretos, factuais, curtos; cosine sozinho já se mostrou confiável nos dados medidos. */
const EXECUTION_POLICY: SemanticConsolidationPolicy = {
  semanticThreshold: SEMANTIC_CONSOLIDATION_THRESHOLD,
  lexicalFloor: 0,
  allowSemanticOnly: true,
};

/** objectives/problems/root_causes/priorities/hypotheses/constraints/results — texto estratégico/abstrato onde cosine sozinho gerou o over-merge real observado. */
const STRATEGIC_POLICY: SemanticConsolidationPolicy = {
  semanticThreshold: SEMANTIC_CONSOLIDATION_THRESHOLD,
  lexicalFloor: 0.2,
  allowSemanticOnly: false,
};

const STRATEGIC_CATEGORIES = new Set([
  "objectives",
  "problems",
  "root_causes",
  "priorities",
  "hypotheses",
  "constraints",
  "results",
]);

/**
 * Política de consolidação por categoria (Fase 4 do GATE 12B.1) —
 * centralizada e determinística: mesma categoria sempre devolve a mesma
 * política, sem estado. `actions`/`next_steps`/`decisions`/`risks`/
 * `opportunities` usam EXECUTION_POLICY (semantic-only permitido);
 * as 7 listas de contexto estratégico usam STRATEGIC_POLICY (exige
 * também overlap lexical mínimo — nunca "tematiza", só reconhece
 * paráfrase real do MESMO núcleo conceitual).
 */
export function semanticConsolidationPolicy(category: string): SemanticConsolidationPolicy {
  return STRATEGIC_CATEGORIES.has(category) ? STRATEGIC_POLICY : EXECUTION_POLICY;
}

/**
 * Decide se um par pode consolidar dado seus scores já calculados e a
 * política da categoria. Nunca decide sozinho por cosine alto quando a
 * política exige evidência lexical — essa é a proteção central deste GATE.
 */
export function meetsConsolidationPolicy(
  lexicalScore: number,
  combinedScore: number,
  policy: SemanticConsolidationPolicy,
): boolean {
  if (combinedScore < policy.semanticThreshold) return false;
  if (policy.allowSemanticOnly) return true;
  return lexicalScore >= policy.lexicalFloor;
}

/**
 * Orquestra a consolidação SEMÂNTICA (Fase 4-6 do GATE 12B) + action-first
 * embedding-aware, sobre o objeto `{identification, analysis}` já com
 * embeddings TEMPORÁRIOS anexados pelo chamador:
 *   - itens de context_updates carregam `__embedding` (temporário, apagado
 *     antes de retornar — NUNCA é persistido em project_context);
 *   - decisions/actions/risks/opportunities carregam `embedding` (o mesmo
 *     campo real que já existia e É persistido, como antes do GATE 12).
 *
 * Nunca consolida entre categorias diferentes (cada `consolidateItemsSemantic`
 * roda isoladamente por lista). Nunca sobrescreve owner/prazo em conflito
 * (`canMerge`/`mergeRecordPreferFilledGuarded`, Fase 7).
 */
export function consolidateAnalysisSemantically(consolidated: Json): {
  result: Json;
  quality: ExecutionQualitySummary;
  semantic: SemanticConsolidationSummary;
} {
  const analysis = { ...((consolidated["analysis"] as Json) ?? {}) };
  const contextUpdates = { ...((analysis["context_updates"] as Json) ?? {}) };

  const groups: SemanticGroup[] = [];
  let totalBefore = 0;
  let totalAfter = 0;
  let mergedCount = 0;

  const CONTEXT_TEXT_LISTS = [
    "objectives",
    "problems",
    "root_causes",
    "priorities",
    "hypotheses",
    "constraints",
    "results",
  ] as const;

  const getContextText = (i: Json) => textOf(i, "content");
  const getContextEmbedding = (i: ContextItemWithTempEmbedding) => i.__embedding ?? null;
  const stripTempEmbedding = (i: ContextItemWithTempEmbedding): Json => {
    const { __embedding, ...rest } = i;
    return rest;
  };

  /**
   * GATE 12B.1: aplica a política da categoria (Fase 2-4) por cima de
   * qualquer guarda já existente (ex.: conflito de owner/prazo). Para
   * categorias estratégicas, exige overlap lexical mínimo além do score
   * combinado já checado por `clusterSemantic` — é essa checagem extra que
   * impede o over-merge de "diminuir dependência de capital..." com
   * "melhorar previsibilidade financeira".
   */
  function withPolicyGuard<T>(
    getText: (item: T) => string,
    policy: SemanticConsolidationPolicy,
    extraGuard: (a: T, b: T) => boolean = () => true,
  ): (a: T, b: T) => boolean {
    return (a, b) => {
      if (!extraGuard(a, b)) return false;
      if (policy.allowSemanticOnly) return true;
      return similarity(getText(a), getText(b)) >= policy.lexicalFloor;
    };
  }

  for (const key of CONTEXT_TEXT_LISTS) {
    const items = asArray(contextUpdates[key]) as ContextItemWithTempEmbedding[];
    totalBefore += items.length;
    const policy = semanticConsolidationPolicy(key);
    const { items: merged, groups: catGroups } = consolidateItemsSemantic(
      items,
      getContextText,
      getContextEmbedding,
      mergeRecordPreferFilled,
      withPolicyGuard(getContextText, policy),
      policy.semanticThreshold,
    );
    groups.push(...toSemanticGroups(key, items, getContextText, catGroups));
    mergedCount += catGroups.reduce((sum, g) => sum + g.memberIndices.length - 1, 0);
    totalAfter += merged.length;
    contextUpdates[key] = merged.map(stripTempEmbedding);
  }

  // next_steps: política de EXECUÇÃO (pré-promoção) — consolida a própria
  // lista primeiro (embedding-aware), igual às demais categorias.
  const nextStepsRaw = asArray(contextUpdates["next_steps"]) as ContextItemWithTempEmbedding[];
  totalBefore += nextStepsRaw.length;
  const nextStepsPolicy = semanticConsolidationPolicy("next_steps");
  const nextStepsConsolidated = consolidateItemsSemantic(
    nextStepsRaw,
    getContextText,
    getContextEmbedding,
    mergeRecordPreferFilled,
    withPolicyGuard(getContextText, nextStepsPolicy),
    nextStepsPolicy.semanticThreshold,
  );
  groups.push(...toSemanticGroups("next_steps", nextStepsRaw, getContextText, nextStepsConsolidated.groups));
  mergedCount += nextStepsConsolidated.groups.reduce((sum, g) => sum + g.memberIndices.length - 1, 0);

  // decisions/risks/opportunities/actions: consolidação semântica intra-categoria
  // (política de EXECUÇÃO), com guarda de conflito de owner/prazo (Fase 7).
  const getEntityEmbedding = (i: Json) => (i["embedding"] as number[] | null | undefined) ?? null;
  const canMergeEntities = (a: Json, b: Json) => !hasFieldConflict(a, b);

  function consolidateEntityList(category: string, items: Json[], getText: (i: Json) => string) {
    totalBefore += items.length;
    const policy = semanticConsolidationPolicy(category);
    const consolidatedList = consolidateItemsSemantic(
      items,
      getText,
      getEntityEmbedding,
      mergeRecordPreferFilledGuarded,
      withPolicyGuard(getText, policy, canMergeEntities),
      policy.semanticThreshold,
    );
    groups.push(...toSemanticGroups(category, items, getText, consolidatedList.groups));
    mergedCount += consolidatedList.groups.reduce((sum, g) => sum + g.memberIndices.length - 1, 0);
    totalAfter += consolidatedList.items.length;
    return consolidatedList.items;
  }

  const decisions = consolidateEntityList("decisions", asArray(analysis["decisions"]), (i) => textOf(i, "title"));
  const risks = consolidateEntityList("risks", asArray(analysis["risks"]), (i) => textOf(i, "description"));
  const opportunities = consolidateEntityList(
    "opportunities",
    asArray(analysis["opportunities"]),
    (i) => textOf(i, "description"),
  );
  const actionsConsolidated = consolidateEntityList(
    "actions",
    asArray(analysis["actions"]),
    (i) => textOf(i, "description"),
  );

  analysis["decisions"] = decisions;
  analysis["risks"] = risks;
  analysis["opportunities"] = opportunities;

  // action-first embedding-aware: usa o embedding TEMPORÁRIO do next_step para
  // (a) checar cobertura contra actions existentes e (b) herdar como embedding
  // REAL da action promovida (mesmo texto — não perde o sinal para o dedupe seguinte).
  const execution = normalizeExecutionItemsSemantic<ContextItemWithTempEmbedding, Json>(
    nextStepsConsolidated.items,
    getContextText,
    getContextEmbedding,
    actionsConsolidated,
    (a) => textOf(a, "description"),
    getEntityEmbedding,
    (step) => ({
      description: textOf(step, "content"),
      owner_name: "",
      deadline: "",
      priority: "",
      evidence: `Convertido automaticamente do próximo passo: "${textOf(step, "content")}"`,
      classification: "suggestion",
      embedding: step.__embedding ?? null,
    }),
  );

  const finalNextSteps = [...execution.strategicNextSteps, ...execution.pendingNextSteps];
  contextUpdates["next_steps"] = finalNextSteps.map(stripTempEmbedding);
  const finalActions = [...actionsConsolidated, ...execution.proposedActions];
  analysis["actions"] = finalActions;
  analysis["context_updates"] = contextUpdates;

  // totalAfter: recontado diretamente dos arrays finais (mais confiável que
  // acumular parcialmente) — next_steps mudou de forma pelo action-first
  // (parte virou action, não "sumiu"), então soma-se aqui em vez de dentro
  // do loop de categorias de contexto.
  totalAfter += finalNextSteps.length + execution.proposedActions.length;

  return {
    result: { ...consolidated, analysis },
    quality: {
      proposedActions: execution.proposedActions.length,
      convertedFromNextSteps: execution.convertedCount,
      pendingWithoutAction: execution.pendingNextSteps.length,
      pendingNextSteps: execution.pendingNextSteps.map(getContextText),
      repetitionGroupsReduced: groups.length,
    },
    semantic: { totalBefore, totalAfter, mergedCount, groups },
  };
}
