import type { ActionItem, OpportunityItem, RiskItem } from "./domain";
import type { ContextItem, Decision, Project } from "./projects";

/* ------------------------------------------------------------------ *
 * SISTEMA ANTIDUPLICIDADE
 *
 * Camada única de decisão. Nenhum componente implementa regra de
 * duplicidade própria: todos perguntam a este serviço.
 *
 * Nível 1 — igualdade estrutural (texto normalizado + campos-chave)
 * Nível 2 — similaridade semântica (embedding, quando disponível) OU
 *           textual (Dice de tokens + trigramas), o que der maior score
 * Nível 3 — regra de negócio por entidade (escopo, status, prazo…)
 *
 * 2026-09-14: a comparação por embedding foi ativada (ver
 * cosineSimilarity/pickBest abaixo). Ela é OPCIONAL e aditiva — quando um
 * dos dois lados não tem vetor calculado ainda (item antigo, ou falha na
 * chamada de embeddings), o sistema cai automaticamente para o método por
 * palavras, que continua funcionando exatamente como antes. O score final
 * é sempre o MAIOR entre os dois métodos, nunca menor que o texto puro
 * conseguiria sozinho.
 * ------------------------------------------------------------------ */

/* ---------------- limiares (fonte única) ---------------- */

export const DEDUPE_THRESHOLDS = {
  /** Praticamente inequívoco — sugerir não criar. */
  exact: 0.95,
  /** Duplicidade provável — sugerir atualizar o existente. */
  high: 0.9,
  /** Faixa cinzenta — exige decisão humana. */
  review: 0.7,
} as const;

export type DedupeVerdict = "NEW" | "POSSIBLE_DUPLICATE" | "UPDATE_EXISTING" | "EXISTING";

export const VERDICT_LABEL: Record<DedupeVerdict, string> = {
  NEW: "Novo",
  POSSIBLE_DUPLICATE: "Possível duplicidade",
  UPDATE_EXISTING: "Atualiza existente",
  EXISTING: "Já existe",
};

/** Sinal de mudança de estado detectado no texto da nova menção. */
export type StatusSignal = "resolved" | "reopened" | null;

/**
 * Classe de status do item ENCONTRADO no match, usada para o ranking
 * status-aware (ver `OPEN_TIE_MARGIN` abaixo) e para `HistoryFlag`.
 * "dismissed" cobre ações canceladas e oportunidades descartadas; riscos
 * não têm um estado distinto de "descartado" (só `active`), então um
 * risco inativo é classificado como "done".
 */
export type ItemStatusClass = "open" | "done" | "dismissed";

/**
 * Sinal ortogonal ao veredito: o vencedor do match é o mesmo item, mas
 * já concluído (`recurrence`) ou já cancelado/descartado
 * (`previously_discarded`). Não substitui `type` — só informa a UI.
 * Nenhum dado real em produção tem hoje um item nesses status (todas as
 * 42 ações são "não iniciada"), então na prática esta flag é sempre
 * `null` até o primeiro caso real acontecer — ver docs/requisito-*.
 */
export type HistoryFlag = "recurrence" | "previously_discarded" | null;

export type FieldChange = { field: string; label: string; from: string; to: string };

export type DedupeMatch<T> = {
  type: DedupeVerdict;
  confidence: number;
  existing: T | null;
  existing_id: string | null;
  existing_label: string;
  reason: string;
  changes: FieldChange[];
  /** "resolvido"/"voltou a acontecer" detectado na nova menção. */
  statusSignal?: StatusSignal;
  /** Projeto de origem do item encontrado — preenchido por `annotateOrigin`. */
  matchedProjectId?: string | null;
  /** Classe de status do item encontrado — null quando não há match. */
  existingStatusClass?: ItemStatusClass | null;
  /** Ver `HistoryFlag`. Ortogonal a `type`; não muda o comportamento padrão. */
  historyFlag?: HistoryFlag;
};


function noMatch<T>(): DedupeMatch<T> {
  return {
    type: "NEW",
    confidence: 0,
    existing: null,
    existing_id: null,
    existing_label: "",
    reason: "Nenhum registro semelhante no escopo consultado.",
    changes: [],
  };
}

/* ---------------- normalização ---------------- */

const STOPWORDS = new Set([
  "a","o","as","os","um","uma","uns","umas","de","do","da","dos","das","em","no","na","nos","nas",
  "por","para","pra","com","sem","ao","aos","à","às","e","ou","que","se","ainda","já","mais","muito",
  "the","of","to","and","precisa","deve","devera","deverá","fazer","ser","estar","foi","sera","será",
]);

/** lowercase, sem acento, sem pontuação, espaços colapsados. */
export function normalizeText(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Núcleo semântico: normalizado e sem palavras vazias. */
export function normalizeCore(value: string): string {
  return normalizeText(value)
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .join(" ");
}

/** Responsável: primeiro nome normalizado — "João Silva" ≈ "o joão". */
export function normalizeOwner(value: string | null | undefined): string {
  const clean = normalizeText(value ?? "")
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return clean[0] ?? "";
}

/* ---------------- responsável: conjunto, não string única ---------------- */

/**
 * Rótulos que a transcrição usa quando não identificou a pessoa — nunca
 * confirmam nem descartam um conflito, porque não dizem quem é ninguém.
 * `normalizeOwner` já reduz ao primeiro token, então "Equipe operacional"
 * e "Responsável técnico" chegam aqui como só "equipe"/"responsavel".
 */
const GENERIC_OWNER_LABELS = new Set(["speaker", "equipe", "responsavel", "consultor", "consultoria"]);

/** Separa um campo de texto com múltiplos responsáveis: "/", ",", "&" ou " e ". */
function splitOwnerNames(value: string): string[] {
  return value
    .replace(/\([^)]*\)/g, " ") // remove qualificador entre parênteses ("Adam (consultor)" -> "Adam")
    .split(/\/|,|&|\se\s/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Alias de grafia por cliente — resolvido por tabela explícita, nunca por
 * distância de edição (aproximação de texto pode juntar pessoas diferentes
 * que só têm nomes parecidos). Semente temporária enquanto o local
 * definitivo de armazenamento não é decidido (proposta em aberto — ver
 * discussão da B3): hoje é só uma constante no código.
 */
const OWNER_ALIAS_SEED: Record<string, Record<string, string>> = {
  "9943b0f4-5220-4297-9f17-7fee64280da5": { ada: "adam" }, // Grupo Erinho — "Ada" e "Adam" são a mesma pessoa.
};

/** Resolve uma variação de grafia conhecida do responsável, pro cliente informado. */
export function resolveOwnerAlias(clientId: string | null | undefined, normalizedName: string): string {
  if (!clientId) return normalizedName;
  return OWNER_ALIAS_SEED[clientId]?.[normalizedName] ?? normalizedName;
}

/**
 * Conjunto de responsáveis conhecidos citados num campo de texto — não um
 * único nome. Separa multi-responsável, remove qualificadores entre
 * parênteses, descarta rótulos genéricos (viram DESCONHECIDO — nem
 * confirmam nem escondem conflito) e resolve alias de grafia por cliente.
 */
export function normalizeOwnerSet(
  value: string | null | undefined,
  clientId?: string | null,
): Set<string> {
  if (!value) return new Set();
  const names = splitOwnerNames(value)
    .map((n) => normalizeOwner(n))
    .filter((n) => n && !GENERIC_OWNER_LABELS.has(n))
    .map((n) => resolveOwnerAlias(clientId, n));
  return new Set(names);
}

/**
 * Conflito material de responsável: só quando os DOIS lados têm pelo menos
 * um nome conhecido (rótulo genérico não conta como nome) e os conjuntos
 * são disjuntos. Desconhecido de qualquer lado não afirma nem nega
 * conflito — fica em aberto, não bloqueia por falta de informação.
 */
export function hasOwnerConflict(
  incoming: string | null | undefined,
  existing: string | null | undefined,
  clientId?: string | null,
): boolean {
  const a = normalizeOwnerSet(incoming, clientId);
  const b = normalizeOwnerSet(existing, clientId);
  if (a.size === 0 || b.size === 0) return false;
  for (const name of a) if (b.has(name)) return false;
  return true;
}

/**
 * Função central de normalização para comparação. Todo o resto do sistema
 * deve usar esta (ou os helpers acima) — nunca normalizar em componentes.
 */
export const normalizeForMatching = normalizeText;

/* ---------------- sinais de mudança de estado ---------------- */

const RESOLVED_RE =
  /\b(resolvid|concluid|finalizad|entregu|encerrad|sanad|eliminad|realizad|ja foi (feito|enviado|entregue)|nao e mais (um )?(risco|problema)|deixou de ser)/;
const REOPENED_RE = /\b(reabert|voltou a|reapareceu|voltar a|novamente (um )?(risco|problema)|retomad)/;

/** Detecta, no texto da nova menção, que o item foi resolvido ou reabriu. */
export function detectStatusSignal(text: string): StatusSignal {
  const t = normalizeText(text);
  if (REOPENED_RE.test(t)) return "reopened";
  if (RESOLVED_RE.test(t)) return "resolved";
  return null;
}



/** Datas em ISO (YYYY-MM-DD) aceitando dd/mm/yyyy. */
export function normalizeDate(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const br = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (br) {
    const [, d, m, y] = br;
    const year = y!.length === 2 ? `20${y}` : y!;
    return `${year}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : "";
}

/* ---------------- similaridade (nível 2) ---------------- */

/** Radical simples (4 letras): aproxima "enviar"/"enviado", "revisar"/"revisão". */
function stem(token: string): string {
  return token.length > 4 ? token.slice(0, 4) : token;
}

function tokens(value: string): string[] {
  return normalizeCore(value).split(" ").filter(Boolean).map(stem);
}

function dice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const shared = new Set(a.filter((t) => setB.has(t))).size;
  return (2 * shared) / (new Set(a).size + setB.size);
}

function trigrams(value: string): Set<string> {
  const s = ` ${normalizeCore(value)} `;
  const out = new Set<string>();
  for (let i = 0; i < s.length - 2; i += 1) out.add(s.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((v) => {
    if (b.has(v)) inter += 1;
  });
  return inter / (a.size + b.size - inter);
}

/**
 * Similaridade textual 0..1. Combina sobreposição de tokens e trigramas
 * e trata contenção ("revisar contrato" ⊂ "joão revisar contrato").
 * Substituível por embeddings sem alterar as regras de negócio.
 */
export function similarity(a: string, b: string): number {
  const na = normalizeCore(a);
  const nb = normalizeCore(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  const base = Math.max(dice(ta, tb), jaccard(trigrams(a), trigrams(b)));
  const short = ta.length <= tb.length ? ta : tb;
  const longSet = new Set(ta.length <= tb.length ? tb : ta);
  const containment = short.length ? short.filter((t) => longSet.has(t)).length / short.length : 0;
  // Contenção total do núcleo é forte sinal, mas nunca chega a "idêntico".
  let score = Math.max(base, containment >= 1 ? 0.93 : containment * 0.85);
  // Todos os termos específicos do lado mais curto reaparecem no outro
  // ("estoque de tintas vencendo" ⊂ "risco de perda por produtos vencendo no
  // estoque de tintas"): é o mesmo assunto com redação mais longa.
  if (specificContainment(short, longSet)) score = Math.max(score, 0.9);
  // Qualificadores concorrentes ("contrato Suvinil" × "contrato bancário")
  // derrubam a pontuação: são assuntos diferentes, não redações diferentes.
  return hasCompetingQualifiers(ta, tb) ? Math.min(score, DEDUPE_THRESHOLDS.review - 0.02) : score;
}

/* ---------------- similaridade semântica (embeddings) ---------------- */

/**
 * Similaridade de cosseno entre dois vetores, normalizada para 0..1
 * (embeddings da OpenAI já vêm normalizados, então o cosseno bruto já
 * fica em -1..1 na prática quase sempre positivo; achatamos negativos
 * a 0 porque não fazem sentido como "similaridade").
 */
export function cosineSimilarity(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  const cos = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1, cos));
}

/**
 * Score final de um par de itens: o maior entre a comparação textual
 * (sempre disponível) e a semântica (só quando ambos os lados têm vetor).
 * Nunca fica pior que o método atual — só pode reconhecer MAIS pares.
 */
export function combinedSimilarity(
  textA: string,
  textB: string,
  embeddingA?: number[] | null,
  embeddingB?: number[] | null,
): number {
  const lexical = similarity(textA, textB);
  if (!embeddingA || !embeddingB) return lexical;
  const semantic = cosineSimilarity(embeddingA, embeddingB);
  return Math.max(lexical, semantic);
}

/** Núcleo específico do texto curto inteiramente presente no texto longo. */
function specificContainment(short: string[], longSet: Set<string>): boolean {
  const specific = short.filter((t) => !GENERIC_STEMS.has(t));
  return specific.length >= 2 && specific.every((t) => longSet.has(t));
}


/**
 * Vocabulário genérico de reunião: aparece em qualquer redação e por isso
 * nunca distingue dois assuntos. Guardado já em forma de radical.
 */
const GENERIC_STEMS = new Set(
  [
    "risco","riscos","perda","perdas","problema","problemas","situacao","questao","questoes",
    "produto","produtos","item","itens","novo","nova","novos","novas","proximo","proxima",
    "pendente","pendencia","urgente","importante","cliente","empresa","reuniao","assunto",
    "acao","acoes","prazo","status","atualizar","atualizacao","necessario","necessidade",
    "verificar","avaliar","analisar","definir","tratar","seguir","ficou","ficar",
  ].map((t) => (t.length > 4 ? t.slice(0, 4) : t)),
);

/**
 * Radical que realmente qualifica o assunto: não genérico e sem correspondente
 * do outro lado ("vencimento" ≈ "vencendo" compartilham o mesmo radical).
 */
function exclusiveQualifiers(own: string[], other: string[]): string[] {
  return own.filter((t) => t.length >= 4 && !GENERIC_STEMS.has(t) && !other.includes(t));
}

/** Os dois lados trazem qualificadores próprios → assuntos distintos. */
function hasCompetingQualifiers(ta: string[], tb: string[]): boolean {
  return exclusiveQualifiers(ta, tb).length > 0 && exclusiveQualifiers(tb, ta).length > 0;
}

/* ---------------- equivalência de entrega histórica ---------------- */

type DeliverableRelation = "none" | "related" | "same";

/**
 * Verbos descrevem como executar; o núcleo nominal descreve o que será
 * entregue. A lista é deliberadamente curta e usada apenas por decisions e
 * actions contra o histórico — não altera similarity() nem seus thresholds.
 */
const OPERATIONAL_VERB_PREFIXES = [
  "faz", "realiz", "entreg", "verific", "analis", "envi", "negoci", "cobr", "configur", "agend",
  "acompanh", "prepar", "implement", "consult", "mont", "busc", "levant", "compar", "desativ",
  "defin", "reduz", "retir", "revis", "atualiz", "contrat", "solicit", "organiz", "elabor",
  "estrutur", "produz", "confeccion",
] as const;

const CREATION_VERB_PREFIXES = ["faz", "realiz", "prepar", "mont", "elabor", "estrutur", "produz", "confeccion"] as const;
const DETAIL_PREFIXES = ["detalh", "aprofund", "especific"] as const;

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function deliverableProfile(text: string): { nucleus: string[]; verbs: string[] } {
  const words = normalizeCore(text).split(" ").filter(Boolean);
  const verbs = words.filter((word) => startsWithAny(word, OPERATIONAL_VERB_PREFIXES));
  const nucleus = words
    .filter((word) => !startsWithAny(word, OPERATIONAL_VERB_PREFIXES))
    .filter((word) => !startsWithAny(word, DETAIL_PREFIXES))
    .map(stem)
    .filter((word) => !GENERIC_STEMS.has(word));
  return { nucleus: [...new Set(nucleus)].sort(), verbs };
}

function deliverableRelation(a: string, b: string): DeliverableRelation {
  const left = deliverableProfile(a);
  const right = deliverableProfile(b);
  if (left.nucleus.length < 2 || right.nucleus.length < 2) return "none";
  if (left.nucleus.join("|") !== right.nucleus.join("|")) return "none";

  const leftCreation = left.verbs.some((verb) => startsWithAny(verb, CREATION_VERB_PREFIXES));
  const rightCreation = right.verbs.some((verb) => startsWithAny(verb, CREATION_VERB_PREFIXES));
  if (!left.verbs.length || !right.verbs.length || (leftCreation && rightCreation)) return "same";

  const sharedVerb = left.verbs.some((verb) => right.verbs.some((other) => stem(verb) === stem(other)));
  return sharedVerb ? "same" : "related";
}

function hasFilledConflict(
  incoming: string | null | undefined,
  existing: string | null | undefined,
  normalize: (value: string | null | undefined) => string = (value) => normalizeText(value ?? ""),
): boolean {
  const next = normalize(incoming);
  const current = normalize(existing);
  return !!next && !!current && next !== current;
}

function hasMaterialScopeConflict(
  incoming: string | null | undefined,
  existing: string | null | undefined,
): boolean {
  if (!normalizeText(incoming ?? "") || !normalizeText(existing ?? "")) return false;
  const left = tokens(incoming ?? "");
  const right = tokens(existing ?? "");
  return (
    similarity(incoming ?? "", existing ?? "") < DEDUPE_THRESHOLDS.review &&
    exclusiveQualifiers(left, right).length >= 2 &&
    exclusiveQualifiers(right, left).length >= 2
  );
}





function pickBest<T>(
  candidates: T[],
  text: string,
  get: (item: T) => string,
  embedding?: number[] | null,
  getEmbedding?: (item: T) => number[] | null | undefined,
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of candidates) {
    const score = getEmbedding
      ? combinedSimilarity(text, get(item), embedding, getEmbedding(item))
      : similarity(text, get(item));
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score > 0 ? best : null;
}

function pickBestHistorical<T>(
  candidates: T[],
  incomingText: string,
  incomingContext: string,
  getText: (item: T) => string,
  getContext: (item: T) => string,
  embedding?: number[] | null,
  getEmbedding?: (item: T) => number[] | null | undefined,
): { item: T; score: number; relation: DeliverableRelation } | null {
  let best: { item: T; score: number; relation: DeliverableRelation } | null = null;
  for (const candidate of candidates) {
    const candidateText = getText(candidate);
    const candidateEmbedding = getEmbedding?.(candidate);
    const rawScore = Math.max(
      combinedSimilarity(incomingText, candidateText, embedding, candidateEmbedding),
      combinedSimilarity(incomingContext, getContext(candidate), embedding, candidateEmbedding),
    );
    const relation = deliverableRelation(incomingText, candidateText);
    const score =
      relation === "same"
        ? Math.max(rawScore, DEDUPE_THRESHOLDS.high)
        : relation === "related"
          ? Math.max(rawScore, DEDUPE_THRESHOLDS.review)
          : rawScore;
    if (!best || score > best.score) best = { item: candidate, score, relation };
  }
  return best && best.score > 0 ? best : null;
}

/**
 * Margem de empate a favor de um candidato ABERTO no ranking de
 * ações/riscos/oportunidades (ver `pickBestPreferOpen`/
 * `pickBestHistoricalPreferOpen`). Valor inicial sem calibração com dado
 * real — nenhum item concluído/cancelado competiu com um aberto em
 * produção até agora (todas as 42 ações reais são "não iniciada").
 * Ajuste quando houver um caso real para medir contra.
 */
const OPEN_TIE_MARGIN = 0.05;

/**
 * Como `pickBest`, mas ranqueia por score entre TODOS os status (não só
 * abertos) e, se o candidato aberto de maior score estiver a até
 * `OPEN_TIE_MARGIN` do melhor score geral, ele vence mesmo que outro
 * status tenha pontuado mais alto — evitar duplicar um item aberto é
 * pior do que deixar passar uma recorrência. Usada só por
 * matchAction/matchRisk/matchOpportunity; matchDecision e
 * matchContextItem continuam em `pickBest`/`pickBestHistorical`, sem
 * noção de status.
 */
function pickBestPreferOpen<T>(
  candidates: T[],
  text: string,
  get: (item: T) => string,
  isOpen: (item: T) => boolean,
  embedding?: number[] | null,
  getEmbedding?: (item: T) => number[] | null | undefined,
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  let bestOpen: { item: T; score: number } | null = null;
  for (const item of candidates) {
    const score = getEmbedding
      ? combinedSimilarity(text, get(item), embedding, getEmbedding(item))
      : similarity(text, get(item));
    if (!best || score > best.score) best = { item, score };
    if (isOpen(item) && (!bestOpen || score > bestOpen.score)) bestOpen = { item, score };
  }
  if (!best || best.score <= 0) return null;
  if (bestOpen && bestOpen !== best && bestOpen.score >= best.score - OPEN_TIE_MARGIN) return bestOpen;
  return best;
}

/** Como `pickBestPreferOpen`, mas com a lógica de relação de `pickBestHistorical` (usada por `matchAction`). */
function pickBestHistoricalPreferOpen<T>(
  candidates: T[],
  incomingText: string,
  incomingContext: string,
  getText: (item: T) => string,
  getContext: (item: T) => string,
  isOpen: (item: T) => boolean,
  embedding?: number[] | null,
  getEmbedding?: (item: T) => number[] | null | undefined,
): { item: T; score: number; relation: DeliverableRelation } | null {
  let best: { item: T; score: number; relation: DeliverableRelation } | null = null;
  let bestOpen: { item: T; score: number; relation: DeliverableRelation } | null = null;
  for (const candidate of candidates) {
    const candidateText = getText(candidate);
    const candidateEmbedding = getEmbedding?.(candidate);
    const rawScore = Math.max(
      combinedSimilarity(incomingText, candidateText, embedding, candidateEmbedding),
      combinedSimilarity(incomingContext, getContext(candidate), embedding, candidateEmbedding),
    );
    const relation = deliverableRelation(incomingText, candidateText);
    const score =
      relation === "same"
        ? Math.max(rawScore, DEDUPE_THRESHOLDS.high)
        : relation === "related"
          ? Math.max(rawScore, DEDUPE_THRESHOLDS.review)
          : rawScore;
    if (!best || score > best.score) best = { item: candidate, score, relation };
    if (isOpen(candidate) && (!bestOpen || score > bestOpen.score))
      bestOpen = { item: candidate, score, relation };
  }
  if (!best || best.score <= 0) return null;
  if (bestOpen && bestOpen !== best && bestOpen.score >= best.score - OPEN_TIE_MARGIN) return bestOpen;
  return best;
}

function verdictFromScore(score: number): DedupeVerdict {
  if (score >= DEDUPE_THRESHOLDS.exact) return "EXISTING";
  if (score >= DEDUPE_THRESHOLDS.high) return "UPDATE_EXISTING";
  if (score >= DEDUPE_THRESHOLDS.review) return "POSSIBLE_DUPLICATE";
  return "NEW";
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/* ---------------- nível 3: regras por entidade ---------------- */

export type IncomingAction = {
  description: string;
  owner_name?: string;
  deadline?: string;
  priority?: string;
  /** Texto livre da menção (evidência) — usado só para ler sinais de status. */
  evidence?: string;
  /** Vetor semântico da descrição, calculado no servidor. Opcional. */
  embedding?: number[] | null;
};

/**
 * Escopo: ações do mesmo cliente/projeto ainda não concluídas.
 * Um novo prazo, responsável ou prioridade NUNCA gera ação nova —
 * vira atualização do registro existente.
 */
function actionStatusClass(a: ActionItem): ItemStatusClass {
  if (a.status === "concluída") return "done";
  if (a.status === "cancelada") return "dismissed";
  return "open";
}

function historyFlagOf(statusClass: ItemStatusClass): HistoryFlag {
  if (statusClass === "done") return "recurrence";
  if (statusClass === "dismissed") return "previously_discarded";
  return null;
}

export function matchAction(item: IncomingAction, candidates: ActionItem[]): DedupeMatch<ActionItem> {
  const best = pickBestHistoricalPreferOpen(
    candidates,
    item.description,
    item.description,
    (a) => a.description,
    (a) => a.description,
    (a) => actionStatusClass(a) === "open",
    item.embedding,
    (a) => a.embedding,
  );
  if (!best) return noMatch<ActionItem>();


  const sameOwner =
    !!normalizeOwner(item.owner_name) &&
    normalizeOwner(item.owner_name) === normalizeOwner(best.item.owner_name);
  // Mesmo responsável reforça a evidência de que é o mesmo compromisso.
  const score = Math.min(1, sameOwner ? best.score + 0.06 : best.score);

  const changes: FieldChange[] = [];
  const newDeadline = normalizeDate(item.deadline);
  const oldDeadline = normalizeDate(best.item.deadline);
  if (newDeadline && newDeadline !== oldDeadline)
    changes.push({ field: "deadline", label: "Prazo", from: oldDeadline || "—", to: newDeadline });
  if (
    normalizeOwner(item.owner_name) &&
    normalizeOwner(item.owner_name) !== normalizeOwner(best.item.owner_name)
  )
    changes.push({
      field: "owner_name",
      label: "Responsável",
      from: best.item.owner_name ?? "—",
      to: item.owner_name!,
    });
  if (item.priority && normalizeText(item.priority) !== normalizeText(best.item.priority ?? ""))
    changes.push({
      field: "priority",
      label: "Prioridade",
      from: best.item.priority ?? "—",
      to: item.priority,
    });

  const rawSignal = detectStatusSignal(`${item.description} ${item.evidence ?? ""}`);
  const conflictLabels = [
    hasOwnerConflict(item.owner_name, best.item.owner_name, best.item.client_id) ? "responsável" : null,
    hasFilledConflict(item.deadline, best.item.deadline, normalizeDate) ? "prazo" : null,
    hasFilledConflict(item.priority, best.item.priority) ? "prioridade" : null,
    (best.item.status === "concluída" || best.item.status === "cancelada") && rawSignal !== "reopened"
      ? "status"
      : null,
  ].filter((label): label is string => !!label);
  const materialConflict = conflictLabels.length > 0;

  let type = verdictFromScore(score);
  // Item praticamente idêntico mas com dado novo → atualizar, não recriar.
  if (type === "EXISTING" && changes.length > 0) type = "UPDATE_EXISTING";
  if (type === "POSSIBLE_DUPLICATE" && sameOwner && score >= DEDUPE_THRESHOLDS.review + 0.05)
    type = "UPDATE_EXISTING";
  if (best.relation === "same" && normalizeText(item.description) !== normalizeText(best.item.description))
    type = "UPDATE_EXISTING";
  if (type !== "NEW" && (best.relation === "related" || materialConflict)) type = "POSSIBLE_DUPLICATE";

  // Conclusão/retomada não cria ação nova: muda o estado da existente.
  const done = best.item.status === "concluída";
  // Menção de conclusão costuma ser curta ("o contrato já foi assinado"):
  // exige menos similaridade, mas fica em revisão quando o texto é fraco.
  if (rawSignal && type === "NEW" && score >= DEDUPE_THRESHOLDS.review - 0.2)
    type = "POSSIBLE_DUPLICATE";
  const statusSignal: StatusSignal =
    type === "NEW" ? null : rawSignal === "resolved" && done ? null : rawSignal === "reopened" && !done ? null : rawSignal;
  if (statusSignal && !materialConflict && best.relation !== "related") {
    type = "UPDATE_EXISTING";
    changes.push({
      field: "status",
      label: "Status",
      from: best.item.status ?? "—",
      to: statusSignal === "resolved" ? "concluída" : "em andamento",
    });
  }

  const existingStatusClass = type === "NEW" ? null : actionStatusClass(best.item);
  return {
    type,
    confidence: score,
    existing: best.item,
    existing_id: best.item.id,
    existing_label: best.item.description,
    statusSignal,
    existingStatusClass,
    historyFlag: existingStatusClass ? historyFlagOf(existingStatusClass) : null,
    reason:
      type === "NEW"
        ? "Nenhuma ação aberta semelhante neste cliente."
        : materialConflict
          ? `Mesma entrega provável (${pct(score)}), mas há conflito material de ${conflictLabels.join(" e ")}; requer revisão.`
          : best.relation === "same"
            ? `Mesmo núcleo de entrega identificado (${pct(score)}); a nova formulação detalha o item histórico.`
            : best.relation === "related"
              ? `Mesmo núcleo temático (${pct(score)}), mas a intenção ou etapa pode ser diferente; requer revisão.`
              : `Ação aberta semelhante (${pct(score)})${sameOwner ? ", mesmo responsável" : ""}${
                  changes.length ? `, com ${changes.map((c) => c.label.toLowerCase()).join(" e ")} diferente` : ""
                }.`,
    changes,
  };
}


export type IncomingDecision = {
  title: string;
  description?: string;
  reason?: string;
  owner?: string;
  due_date?: string;
  status?: string;
  embedding?: number[] | null;
};

/** Escopo: decisões do mesmo projeto. Decisão contrária vira substituição. */
export function matchDecision(
  item: IncomingDecision,
  candidates: Decision[],
): DedupeMatch<Decision> {
  const incomingContext = `${item.title} ${item.description ?? ""} ${item.reason ?? ""}`;
  const best = pickBestHistorical(
    candidates,
    item.title,
    incomingContext,
    (d) => d.title,
    (d) => `${d.title} ${d.description ?? ""} ${d.reason ?? ""}`,
    item.embedding,
    (d) => d.embedding,
  );
  if (!best) return noMatch<Decision>();

  const changes: FieldChange[] = [];
  if (item.owner && normalizeOwner(item.owner) !== normalizeOwner(best.item.owner))
    changes.push({ field: "owner", label: "Responsável", from: best.item.owner ?? "—", to: item.owner });
  if (item.due_date && normalizeDate(item.due_date) !== normalizeDate(best.item.due_date))
    changes.push({ field: "due_date", label: "Prazo", from: best.item.due_date ?? "—", to: item.due_date });
  if (item.status && normalizeText(item.status) !== normalizeText(best.item.status))
    changes.push({ field: "status", label: "Status", from: best.item.status ?? "—", to: item.status });

  const conflictLabels = [
    hasOwnerConflict(item.owner, best.item.owner, best.item.client_id) ? "responsável" : null,
    hasFilledConflict(item.due_date, best.item.due_date, normalizeDate) ? "prazo" : null,
    hasFilledConflict(item.status, best.item.status) ? "status" : null,
    hasMaterialScopeConflict(item.description, best.item.description) ? "escopo textual" : null,
  ].filter((label): label is string => !!label);
  const materialConflict = conflictLabels.length > 0;
  let type = verdictFromScore(best.score);
  if (type === "EXISTING" && changes.length > 0) type = "UPDATE_EXISTING";
  if (best.relation === "same" && normalizeText(incomingContext) !== normalizeText(`${best.item.title} ${best.item.description ?? ""} ${best.item.reason ?? ""}`))
    type = "UPDATE_EXISTING";
  if (type !== "NEW" && (best.relation === "related" || materialConflict)) type = "POSSIBLE_DUPLICATE";
  return {
    type,
    confidence: best.score,
    existing: best.item,
    existing_id: best.item.id,
    existing_label: best.item.title,
    reason:
      type === "NEW"
        ? "Nenhuma decisão semelhante neste projeto."
        : materialConflict
          ? `Mesma decisão provável (${pct(best.score)}), mas há conflito material de ${conflictLabels.join(" e ")}; requer revisão.`
          : best.relation === "same"
            ? `Mesmo núcleo de entrega identificado (${pct(best.score)}); a nova formulação detalha a decisão histórica.`
            : best.relation === "related"
              ? `Mesmo núcleo temático (${pct(best.score)}), mas a intenção ou etapa pode ser diferente; requer revisão.`
              : `Decisão semelhante já registrada neste projeto (${pct(best.score)}).`,
    changes,
  };
}

export type IncomingRisk = { description: string; level?: string; embedding?: number[] | null };

/** Escopo: riscos do mesmo cliente/projeto — ativos primeiro. */
/** Riscos não têm um estado "descartado" distinto — só `active`; inativo é tratado como "done" (resolvido). */
function riskStatusClass(r: RiskItem): ItemStatusClass {
  return r.active ? "open" : "done";
}

export function matchRisk(item: IncomingRisk, candidates: RiskItem[]): DedupeMatch<RiskItem> {
  const best = pickBestPreferOpen(
    candidates,
    item.description,
    (r) => r.description,
    (r) => r.active,
    item.embedding,
    (r) => r.embedding,
  );
  if (!best) return noMatch<RiskItem>();

  const changes: FieldChange[] = [];
  if (item.level && normalizeText(item.level) !== normalizeText(best.item.level ?? ""))
    changes.push({
      field: "level",
      label: "Criticidade",
      from: best.item.level ?? "—",
      to: item.level,
    });

  let type = verdictFromScore(best.score);
  if (type === "EXISTING" && changes.length > 0) type = "UPDATE_EXISTING";

  // Risco resolvido ou que voltou a acontecer é o MESMO risco, com novo estado.
  const rawSignal = detectStatusSignal(item.description);
  if (rawSignal && type === "NEW" && best.score >= DEDUPE_THRESHOLDS.review - 0.2)
    type = "POSSIBLE_DUPLICATE";
  const statusSignal: StatusSignal =
    type === "NEW"
      ? null
      : rawSignal === "resolved" && !best.item.active
        ? null
        : rawSignal === "reopened" && best.item.active
          ? null
          : rawSignal;
  if (statusSignal) {
    type = "UPDATE_EXISTING";
    changes.push({
      field: "active",
      label: "Situação",
      from: best.item.active ? "ativo" : "resolvido",
      to: statusSignal === "resolved" ? "resolvido" : "reaberto",
    });
  }

  const existingStatusClass = type === "NEW" ? null : riskStatusClass(best.item);
  return {
    type,
    confidence: best.score,
    existing: best.item,
    existing_id: best.item.id,
    existing_label: best.item.description,
    statusSignal,
    existingStatusClass,
    historyFlag: existingStatusClass ? historyFlagOf(existingStatusClass) : null,
    reason:
      type === "NEW"
        ? "Nenhum risco semelhante neste escopo."
        : `Risco semelhante (${pct(best.score)}) — registrar nova evidência em vez de duplicar.`,
    changes,
  };
}


export type IncomingOpportunity = {
  description: string;
  expected_benefit?: string;
  embedding?: number[] | null;
};

/** Escopo: oportunidades abertas do mesmo cliente. */
function opportunityStatusClass(o: OpportunityItem): ItemStatusClass {
  if (o.status === "fechada") return "done";
  if (o.status === "descartada") return "dismissed";
  return "open";
}

export function matchOpportunity(
  item: IncomingOpportunity,
  candidates: OpportunityItem[],
): DedupeMatch<OpportunityItem> {
  const best = pickBestPreferOpen(
    candidates,
    item.description,
    (o) => o.description,
    (o) => opportunityStatusClass(o) === "open",
    item.embedding,
    (o) => o.embedding,
  );
  if (!best) return noMatch<OpportunityItem>();
  const type = verdictFromScore(best.score);
  const existingStatusClass = type === "NEW" ? null : opportunityStatusClass(best.item);
  return {
    type,
    confidence: best.score,
    existing: best.item,
    existing_id: best.item.id,
    existing_label: best.item.description,
    existingStatusClass,
    historyFlag: existingStatusClass ? historyFlagOf(existingStatusClass) : null,
    reason:
      type === "NEW"
        ? "Nenhuma oportunidade aberta semelhante."
        : `Oportunidade aberta semelhante (${pct(best.score)}).`,
    changes: [],
  };
}

/** Escopo: itens da MESMA lista de contexto do mesmo projeto. */
export function matchContextItem(
  text: string,
  candidates: ContextItem[],
  embedding?: number[] | null,
): DedupeMatch<ContextItem> {
  const best = pickBest(candidates, text, (c) => c.text, embedding, (c) => c.embedding);
  if (!best) return noMatch<ContextItem>();
  const type = verdictFromScore(best.score);
  return {
    type,
    confidence: best.score,
    existing: best.item,
    existing_id: best.item.id,
    existing_label: best.item.text,
    reason:
      type === "NEW"
        ? "Item inédito nesta lista de contexto."
        : `Item semelhante já registrado nesta lista (${pct(best.score)}).`,
    changes: [],
  };
}

/** Escopo: projetos do MESMO cliente — nome + descrição. */
export function matchProject(
  item: { name: string; description?: string },
  candidates: Project[],
): DedupeMatch<Project> {
  const text = `${item.name} ${item.description ?? ""}`;
  const best = pickBest(candidates, text, (p) => `${p.name} ${p.description ?? ""}`);
  if (!best) return noMatch<Project>();
  const type = verdictFromScore(best.score);
  return {
    type,
    confidence: best.score,
    existing: best.item,
    existing_id: best.item.id,
    existing_label: best.item.name,
    reason:
      type === "NEW"
        ? "Nenhum projeto semelhante neste cliente."
        : `Projeto semelhante neste cliente (${pct(best.score)}) — confirme antes de criar outro.`,
    changes: [],
  };
}

/* ---------------- resolução escolhida pelo consultor ---------------- */

export type ResolutionMode = "create" | "update" | "skip";

export type ItemResolution = {
  mode: ResolutionMode;
  targetId: string | null;
  verdict: DedupeVerdict;
  confidence: number;
  reason: string;
  changes: FieldChange[];
  /** Mudança de estado aprovada junto com a atualização. */
  statusSignal?: StatusSignal;
  /** Cronologia do candidato encontrado em relação à reunião atual — ver `chronologyOf`. */
  chronology?: ChronologyStatus;
  /** Data (ISO, "AAAA-MM-DD") da reunião de origem do candidato, só para exibição. */
  candidateMeetingDate?: string | null;
  /** Ver `HistoryFlag` em deduplication.ts — repassado do match, só para exibição. */
  historyFlag?: HistoryFlag;
};

/** Sugestão padrão — casos ambíguos NUNCA decidem sozinhos (ficam em revisão). */
export function defaultResolution(match: DedupeMatch<unknown>): ItemResolution {
  // POSSIBLE_DUPLICATE nunca decide sozinho: fica retido até o consultor escolher.
  const mode: ResolutionMode =
    match.type === "EXISTING" || match.type === "POSSIBLE_DUPLICATE"
      ? "skip"
      : match.type === "UPDATE_EXISTING"
        ? "update"
        : "create";
  return {
    mode,
    targetId: match.type === "NEW" ? null : match.existing_id,
    verdict: match.type,
    confidence: match.confidence,
    reason: match.reason,
    changes: match.changes,
    statusSignal: match.statusSignal ?? null,
    historyFlag: match.historyFlag ?? null,
  };
}

/** Itens em faixa intermediária precisam de confirmação explícita. */
export function needsHumanReview(match: DedupeMatch<unknown>): boolean {
  return match.type === "POSSIBLE_DUPLICATE";
}

/* ---------------- cronologia ---------------- */

export type ChronologyStatus = "current_or_earlier" | "posterior" | "unknown";

/**
 * Compara a data da reunião de origem de um candidato com a da reunião
 * atual — datas são strings "AAAA-MM-DD", comparáveis lexicograficamente.
 * Data igual não conta como posterior. Qualquer data ausente vira
 * "unknown" (nunca bloqueia sozinha — a ausência de dado não é motivo pra
 * travar uma atualização legítima).
 */
export function chronologyOf(
  currentMeetingDate: string | null | undefined,
  candidateMeetingDate: string | null | undefined,
): ChronologyStatus {
  if (!currentMeetingDate || !candidateMeetingDate) return "unknown";
  return candidateMeetingDate > currentMeetingDate ? "posterior" : "current_or_earlier";
}

/**
 * Aplica a trava de cronologia a uma resolução já calculada: um candidato
 * de reunião posterior nunca pode ser alvo de "Atualizar existente" — o
 * veredito e a confiança são preservados (auditoria), só o modo de
 * resolução é rebaixado para "create" quando estava em "update".
 */
export function applyChronologyGuard(
  resolution: ItemResolution,
  chronology: ChronologyStatus,
  candidateMeetingDate?: string | null,
): ItemResolution {
  return {
    ...resolution,
    mode: chronology === "posterior" && resolution.mode === "update" ? "create" : resolution.mode,
    chronology,
    candidateMeetingDate: candidateMeetingDate ?? null,
  };
}

/* ---------------- escopo de comparação ---------------- */

/**
 * Restringe candidatos ao projeto: só entram registros ligados às reuniões
 * do projeto (ou sem reunião). Evita comparar com toda a base do cliente.
 * Sem reuniões conhecidas, mantém o escopo do cliente já recebido.
 */
export function scopeToProject<T extends { meeting_id?: string | null }>(
  candidates: T[],
  projectMeetingIds: Set<string> | string[] | null | undefined,
): T[] {
  if (!projectMeetingIds) return candidates;
  const ids = projectMeetingIds instanceof Set ? projectMeetingIds : new Set(projectMeetingIds);
  if (ids.size === 0) return candidates;
  const scoped = candidates.filter((c) => !c.meeting_id || ids.has(c.meeting_id));
  return scoped.length ? scoped : candidates;
}

/**
 * Anota o motivo de um match com a origem, quando o candidato encontrado
 * vier de um projeto diferente do projeto atual (comparação antiduplicidade
 * agora cruza todos os projetos do cliente, não só o projeto/reunião atual).
 * Não altera type/confidence/changes — só acrescenta contexto ao texto.
 */
export function annotateOrigin<T>(
  match: DedupeMatch<T>,
  itemProjectId: string | null | undefined,
  currentProjectId: string | null | undefined,
  projectNameById: Map<string, string>,
): DedupeMatch<T> {
  if (match.type === "NEW") return match;
  const withProjectId: DedupeMatch<T> = { ...match, matchedProjectId: itemProjectId ?? null };
  if (!itemProjectId || itemProjectId === currentProjectId) return withProjectId;
  const name = projectNameById.get(itemProjectId);
  const origin = name ? `Vem do projeto "${name}".` : "Vem de outro projeto do cliente.";
  return { ...withProjectId, reason: `${match.reason} ${origin}` };
}

/* ---------------- relatório de duplicidade (auditoria) ---------------- */

export type RankedCandidate<T> = {
  item: T;
  /** Mesmo score usado pelo matching real (lexical ou combinado) — determina a ordem. */
  score: number;
  /** Só a componente semântica, isolada — null quando algum dos dois lados não tem embedding. */
  cosine: number | null;
};

/**
 * Ranking dos N melhores candidatos por score (não só o primeiro, como
 * `pickBest`) — usado para auditoria: mostrar por que um item saiu "NEW"
 * também exige ver o que quase bateu e não bateu.
 */
export function rankCandidates<T>(
  candidates: T[],
  incomingText: string,
  getText: (item: T) => string,
  incomingEmbedding?: number[] | null,
  getEmbedding?: (item: T) => number[] | null | undefined,
  limit = 3,
): RankedCandidate<T>[] {
  const ranked = candidates.map((item) => {
    const text = getText(item);
    const embedding = getEmbedding?.(item);
    const hasBothEmbeddings = !!incomingEmbedding && !!embedding;
    const score = getEmbedding
      ? combinedSimilarity(incomingText, text, incomingEmbedding, embedding)
      : similarity(incomingText, text);
    const cosine = hasBothEmbeddings ? cosineSimilarity(incomingEmbedding, embedding) : null;
    return { item, score, cosine };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.max(0, limit));
}

export type DuplicateReportCandidate = {
  text: string;
  projectName: string | null;
  meetingId: string | null;
  meetingDate: string | null;
  status: string | null;
  owner: string | null;
  cosine: number | null;
};

export type DuplicateReportSuggestion = {
  category: string;
  text: string;
  classification?: string | null;
  ownerName: string | null;
  deadline: string | null;
  verdict: DedupeVerdict;
  confidence: number;
  /** true quando o candidato escolhido (targetId) veio de reunião posterior à atual — ver B1. */
  posterior: boolean;
  /** Melhores candidatos do cliente inteiro contra este item, mesmo quando o veredito é NEW — pra auditoria. */
  candidates: DuplicateReportCandidate[];
};

export type DuplicateReportConsolidation = {
  category: string;
  canonicalText: string;
  mergedTexts: string[];
};

export type DuplicateReportCounts = {
  total: number;
  new: number;
  updated: number;
  review: number;
  ignored: number;
};

export type DuplicateReportInput = {
  clientName: string;
  projectName: string;
  meetingId: string;
  meetingDate: string;
  counts: DuplicateReportCounts;
  consolidations: DuplicateReportConsolidation[];
  suggestions: DuplicateReportSuggestion[];
};

const VERDICT_REPORT_LABEL: Record<DedupeVerdict, string> = {
  NEW: "Novo",
  EXISTING: "Já existe (idêntico)",
  UPDATE_EXISTING: "Atualização",
  POSSIBLE_DUPLICATE: "Possível duplicidade",
};

/**
 * Relatório de duplicidade em markdown puro (sem embeddings) — pra copiar e
 * auditar fora da tela: por que cada sugestão saiu do jeito que saiu, e
 * contra o quê ela foi comparada. Função pura: recebe só dados já
 * carregados pelo diálogo, não acessa rede nem banco.
 */
export function formatDuplicateReport(input: DuplicateReportInput): string {
  const lines: string[] = [];
  lines.push("# Relatório de duplicidade — Reunião Inteligente");
  lines.push("");
  lines.push(`- Cliente: ${input.clientName}`);
  lines.push(`- Projeto: ${input.projectName}`);
  lines.push(`- Reunião: ${input.meetingDate} (id: ${input.meetingId})`);
  lines.push(
    `- Contadores: ${input.counts.total} total · ${input.counts.new} novo(s) · ${input.counts.updated} atualização(ões) · ${input.counts.review} para revisar · ${input.counts.ignored} ignorado(s)`,
  );
  lines.push("");

  if (input.consolidations.length > 0) {
    lines.push("## Consolidações internas (mesma reunião)");
    lines.push("");
    for (const c of input.consolidations) {
      lines.push(`- [${c.category}] "${c.canonicalText}" ← ${c.mergedTexts.map((t) => `"${t}"`).join(", ")}`);
    }
    lines.push("");
  }

  lines.push("## Sugestões");
  lines.push("");
  for (const s of input.suggestions) {
    lines.push(`### [${s.category}] ${s.text}`);
    const meta: string[] = [
      `Veredito: ${VERDICT_REPORT_LABEL[s.verdict]} (${Math.round(s.confidence * 100)}%)`,
    ];
    if (s.classification) meta.push(`Classificação: ${s.classification}`);
    if (s.ownerName) meta.push(`Responsável proposto: ${s.ownerName}`);
    if (s.deadline) meta.push(`Prazo proposto: ${s.deadline}`);
    if (s.posterior) meta.push("⚠ Candidato de reunião posterior — não oferecido para atualizar");
    lines.push(meta.join(" · "));
    if (s.candidates.length === 0) {
      lines.push("- Nenhum candidato no histórico do cliente.");
    } else {
      for (const c of s.candidates) {
        const parts = [
          `"${c.text}"`,
          c.projectName ? `projeto: ${c.projectName}` : "projeto: —",
          c.meetingDate ? `reunião: ${c.meetingDate}${c.meetingId ? ` (${c.meetingId})` : ""}` : "reunião: —",
          `status: ${c.status ?? "—"}`,
          `responsável: ${c.owner ?? "—"}`,
          `cosine: ${c.cosine === null ? "—" : c.cosine.toFixed(3)}`,
        ];
        lines.push(`- ${parts.join(" · ")}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

/* ---------------- serviço central ---------------- */

export type DedupeEntityType = "action" | "risk" | "decision" | "opportunity" | "context_item";

export type DedupeRequest =
  | { entityType: "action"; candidate: IncomingAction; existing: ActionItem[] }
  | { entityType: "risk"; candidate: IncomingRisk; existing: RiskItem[] }
  | { entityType: "decision"; candidate: IncomingDecision; existing: Decision[] }
  | { entityType: "opportunity"; candidate: IncomingOpportunity; existing: OpportunityItem[] }
  | { entityType: "context_item"; candidate: { text: string }; existing: ContextItem[] };

export type DedupeDecision = {
  classification: DedupeVerdict;
  confidence: number;
  existingEntityId: string | null;
  existingLabel: string;
  reason: string;
  proposedChanges: Record<string, { from: string; to: string }>;
  statusSignal: StatusSignal;
  requiresHumanReview: boolean;
  suggestedMode: ResolutionMode;
};

/**
 * Ponto ÚNICO de decisão antiduplicidade. Componentes e o fluxo de aplicação
 * perguntam aqui; nenhuma regra de duplicidade vive em React.
 */
export const deduplicationService = {
  match(req: DedupeRequest): DedupeMatch<unknown> {
    switch (req.entityType) {
      case "action":
        return matchAction(req.candidate, req.existing);
      case "risk":
        return matchRisk(req.candidate, req.existing);
      case "decision":
        return matchDecision(req.candidate, req.existing);
      case "opportunity":
        return matchOpportunity(req.candidate, req.existing);
      case "context_item":
        return matchContextItem(req.candidate.text, req.existing);
    }
  },
  classify(req: DedupeRequest): DedupeDecision {
    const match = deduplicationService.match(req);
    const resolution = defaultResolution(match);
    return {
      classification: match.type,
      confidence: match.confidence,
      existingEntityId: match.existing_id,
      existingLabel: match.existing_label,
      reason: match.reason,
      proposedChanges: Object.fromEntries(
        match.changes.map((c) => [c.field, { from: c.from, to: c.to }]),
      ),
      statusSignal: match.statusSignal ?? null,
      requiresHumanReview: needsHumanReview(match),
      suggestedMode: resolution.mode,
    };
  },
};


/* ---------------- idempotência ---------------- */

/** Hash estável (FNV-1a) do conteúdo aprovado — barato e determinístico. */
export function stableHash(value: unknown): string {
  const json = JSON.stringify(value) ?? "";
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Mesma análise + mesmo conteúdo aprovado = mesma chave. Clicar duas vezes
 * em "Aprovar" colide na constraint única e não grava nada de novo.
 */
export function buildIdempotencyKey(params: {
  analysisId: string | null;
  meetingId: string;
  payload: unknown;
}): string {
  return `${params.analysisId ?? `meeting:${params.meetingId}`}:${stableHash(params.payload)}`;
}
