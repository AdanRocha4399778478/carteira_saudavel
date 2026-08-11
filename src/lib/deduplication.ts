import type { ActionItem, OpportunityItem, RiskItem } from "./domain";
import type { ContextItem, Decision, Project } from "./projects";

/* ------------------------------------------------------------------ *
 * SISTEMA ANTIDUPLICIDADE
 *
 * Camada única de decisão. Nenhum componente implementa regra de
 * duplicidade própria: todos perguntam a este serviço.
 *
 * Nível 1 — igualdade estrutural (texto normalizado + campos-chave)
 * Nível 2 — similaridade textual (Dice de tokens + trigramas)
 * Nível 3 — regra de negócio por entidade (escopo, status, prazo…)
 *
 * A assinatura de `similarity` é o ponto de extensão para embeddings:
 * basta trocar a implementação por uma comparação semântica; nada
 * mais no sistema precisa mudar.
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





function pickBest<T>(
  candidates: T[],
  text: string,
  get: (item: T) => string,
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of candidates) {
    const score = similarity(text, get(item));
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score > 0 ? best : null;
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
};

/**
 * Escopo: ações do mesmo cliente/projeto ainda não concluídas.
 * Um novo prazo, responsável ou prioridade NUNCA gera ação nova —
 * vira atualização do registro existente.
 */
export function matchAction(item: IncomingAction, candidates: ActionItem[]): DedupeMatch<ActionItem> {
  const open = candidates.filter((a) => a.status !== "concluída" && a.status !== "cancelada");
  const pool = open.length ? open : candidates;
  const best = pickBest(pool, item.description, (a) => a.description);
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

  let type = verdictFromScore(score);
  // Item praticamente idêntico mas com dado novo → atualizar, não recriar.
  if (type === "EXISTING" && changes.length > 0) type = "UPDATE_EXISTING";
  if (type === "POSSIBLE_DUPLICATE" && sameOwner && score >= DEDUPE_THRESHOLDS.review + 0.05)
    type = "UPDATE_EXISTING";

  // Conclusão/retomada não cria ação nova: muda o estado da existente.
  const rawSignal = detectStatusSignal(`${item.description} ${item.evidence ?? ""}`);
  const done = best.item.status === "concluída";
  // Menção de conclusão costuma ser curta ("o contrato já foi assinado"):
  // exige menos similaridade, mas fica em revisão quando o texto é fraco.
  if (rawSignal && type === "NEW" && score >= DEDUPE_THRESHOLDS.review - 0.2)
    type = "POSSIBLE_DUPLICATE";
  const statusSignal: StatusSignal =
    type === "NEW" ? null : rawSignal === "resolved" && done ? null : rawSignal === "reopened" && !done ? null : rawSignal;
  if (statusSignal) {
    type = "UPDATE_EXISTING";
    changes.push({
      field: "status",
      label: "Status",
      from: best.item.status ?? "—",
      to: statusSignal === "resolved" ? "concluída" : "em andamento",
    });
  }

  return {
    type,
    confidence: score,
    existing: best.item,
    existing_id: best.item.id,
    existing_label: best.item.description,
    statusSignal,
    reason:
      type === "NEW"
        ? "Nenhuma ação aberta semelhante neste cliente."
        : `Ação aberta semelhante (${pct(score)})${sameOwner ? ", mesmo responsável" : ""}${
            changes.length ? `, com ${changes.map((c) => c.label.toLowerCase()).join(" e ")} diferente` : ""
          }.`,
    changes,
  };
}


export type IncomingDecision = { title: string; description?: string };

/** Escopo: decisões do mesmo projeto. Decisão contrária vira substituição. */
export function matchDecision(
  item: IncomingDecision,
  candidates: Decision[],
): DedupeMatch<Decision> {
  const best = pickBest(candidates, item.title, (d) => `${d.title} ${d.description ?? ""}`);
  if (!best) return noMatch<Decision>();
  const type = verdictFromScore(best.score);
  return {
    type,
    confidence: best.score,
    existing: best.item,
    existing_id: best.item.id,
    existing_label: best.item.title,
    reason:
      type === "NEW"
        ? "Nenhuma decisão semelhante neste projeto."
        : `Decisão semelhante já registrada neste projeto (${pct(best.score)}).`,
    changes: [],
  };
}

export type IncomingRisk = { description: string; level?: string };

/** Escopo: riscos do mesmo cliente/projeto — ativos primeiro. */
export function matchRisk(item: IncomingRisk, candidates: RiskItem[]): DedupeMatch<RiskItem> {
  const active = candidates.filter((r) => r.active);
  const best = pickBest(active.length ? active : candidates, item.description, (r) => r.description);
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

  return {
    type,
    confidence: best.score,
    existing: best.item,
    existing_id: best.item.id,
    existing_label: best.item.description,
    statusSignal,
    reason:
      type === "NEW"
        ? "Nenhum risco semelhante neste escopo."
        : `Risco semelhante (${pct(best.score)}) — registrar nova evidência em vez de duplicar.`,
    changes,
  };
}


export type IncomingOpportunity = { description: string; expected_benefit?: string };

/** Escopo: oportunidades abertas do mesmo cliente. */
export function matchOpportunity(
  item: IncomingOpportunity,
  candidates: OpportunityItem[],
): DedupeMatch<OpportunityItem> {
  const open = candidates.filter((o) => o.status !== "fechada" && o.status !== "descartada");
  const best = pickBest(open.length ? open : candidates, item.description, (o) => o.description);
  if (!best) return noMatch<OpportunityItem>();
  const type = verdictFromScore(best.score);
  return {
    type,
    confidence: best.score,
    existing: best.item,
    existing_id: best.item.id,
    existing_label: best.item.description,
    reason:
      type === "NEW"
        ? "Nenhuma oportunidade aberta semelhante."
        : `Oportunidade aberta semelhante (${pct(best.score)}).`,
    changes: [],
  };
}

/** Escopo: itens da MESMA lista de contexto do mesmo projeto. */
export function matchContextItem(text: string, candidates: ContextItem[]): DedupeMatch<ContextItem> {
  const best = pickBest(candidates, text, (c) => c.text);
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
    targetId: match.existing_id,
    verdict: match.type,
    confidence: match.confidence,
    reason: match.reason,
    changes: match.changes,
    statusSignal: match.statusSignal ?? null,
  };
}

/** Itens em faixa intermediária precisam de confirmação explícita. */
export function needsHumanReview(match: DedupeMatch<unknown>): boolean {
  return match.type === "POSSIBLE_DUPLICATE";
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
