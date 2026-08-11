import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logDbError } from "./api";
import type { ItemResolution } from "./deduplication";

/* ------------------------------------------------------------------ *
 * EVOLUÇÃO ENTRE REUNIÕES
 *
 * A pergunta aqui não é "o que a reunião disse?", e sim "o que mudou
 * desde a última reunião?". A classificação é DETERMINÍSTICA sempre que
 * existe um fato comparável (prazo vencido, status alterado, nível de
 * risco diferente, decisão substituída); a IA só entra onde não há campo
 * estruturado para comparar — e, mesmo aí, o consultor pode sobrescrever
 * no preview antes de qualquer gravação.
 * ------------------------------------------------------------------ */

export const EVOLUTION_CLASSIFICATIONS = [
  "NEW",
  "PROGRESSED",
  "UNCHANGED",
  "DELAYED",
  "BLOCKED",
  "RESOLVED",
  "REGRESSED",
  "REOPENED",
  "SUPERSEDED",
] as const;

export type EvolutionClassification = (typeof EVOLUTION_CLASSIFICATIONS)[number];

export const EVOLUTION_LABEL: Record<EvolutionClassification, string> = {
  NEW: "Novo",
  PROGRESSED: "Avançou",
  UNCHANGED: "Sem mudança",
  DELAYED: "Atrasado",
  BLOCKED: "Bloqueado",
  RESOLVED: "Resolvido",
  REGRESSED: "Regrediu",
  REOPENED: "Reaberto",
  SUPERSEDED: "Substituído",
};

/** Tom visual por classificação — usa os tons das pílulas do painel. */
export type EvolutionTone = "healthy" | "attention" | "highrisk" | "critical" | "neutral";

export const EVOLUTION_TONE: Record<EvolutionClassification, EvolutionTone> = {
  NEW: "neutral",
  PROGRESSED: "healthy",
  UNCHANGED: "neutral",
  DELAYED: "attention",
  BLOCKED: "critical",
  RESOLVED: "healthy",
  REGRESSED: "critical",
  REOPENED: "attention",
  SUPERSEDED: "neutral",
};

export type EvolutionEntityType =
  | "action"
  | "risk"
  | "decision"
  | "opportunity"
  | "context_item";

export const EVOLUTION_ENTITY_LABEL: Record<string, string> = {
  action: "Ação",
  risk: "Risco",
  decision: "Decisão",
  opportunity: "Oportunidade",
  context_item: "Contexto",
};

export const MOVEMENTS = ["avancando", "estavel", "atencao", "travado", "regredindo"] as const;
export type ProjectMovement = (typeof MOVEMENTS)[number];

export const MOVEMENT_LABEL: Record<ProjectMovement, string> = {
  avancando: "Avançando",
  estavel: "Estável",
  atencao: "Requer atenção",
  travado: "Travado",
  regredindo: "Regredindo",
};

/* ---------------- entrada da classificação ---------------- */

/** Estado atual do registro já existente no banco, quando houver. */
export type ExistingSnapshot = {
  status?: string | null;
  deadline?: string | null;
  level?: string | null;
  active?: boolean | null;
} | null;

export type EvolutionCandidate = {
  entity_type: EvolutionEntityType;
  /** null quando o item ainda vai ser criado nesta aprovação. */
  entity_id: string | null;
  label: string;
  resolution: ItemResolution;
  existing?: ExistingSnapshot;
  evidence?: string | null;
};

export type EvolutionItem = {
  entity_type: EvolutionEntityType;
  entity_id: string | null;
  label: string;
  classification: EvolutionClassification;
  previous_state: string | null;
  current_state: string | null;
  evidence: string | null;
  confidence: number | null;
  source: "rule" | "ai";
};

const RISK_ORDER: Record<string, number> = { baixo: 1, "médio": 2, medio: 2, alto: 3, "crítico": 4, critico: 4 };

const CLOSED_STATUS = /(conclu|finaliz|entregu|implementad|encerrad)/i;
const BLOCKED_HINT =
  /(bloquead|travad|impedid|impediment|parad[oa]|sem retorno|aguardando (defini|retorno|aprova)|depende de terceiro)/i;

function riskWeight(level: string | null | undefined): number {
  return RISK_ORDER[String(level ?? "").toLowerCase()] ?? 0;
}

function isPastDate(value: string | null | undefined, today: string): boolean {
  return !!value && value < today;
}

function changeOf(resolution: ItemResolution, field: string) {
  return resolution.changes.find((c) => c.field === field);
}

function describeExisting(c: EvolutionCandidate): string | null {
  const e = c.existing;
  if (!e) return null;
  const parts = [
    e.status ? `status ${e.status}` : "",
    e.level ? `nível ${e.level}` : "",
    e.deadline ? `prazo ${e.deadline}` : "",
    e.active === false ? "inativo" : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Classificação determinística. Só devolve `source: "ai"` quando nenhum
 * campo estruturado explica a menção e restou apenas o texto da fala.
 */
export function classifyCandidate(
  candidate: EvolutionCandidate,
  today = new Date().toISOString().slice(0, 10),
): EvolutionItem {
  const { resolution: res, existing, evidence } = candidate;
  const base = {
    entity_type: candidate.entity_type,
    entity_id: candidate.entity_id,
    label: candidate.label,
    evidence: evidence?.trim() || null,
    confidence: res.verdict === "NEW" ? null : res.confidence,
  };
  const previous = describeExisting(candidate);

  const done = (
    classification: EvolutionClassification,
    current: string | null,
    source: "rule" | "ai" = "rule",
  ): EvolutionItem => ({ ...base, classification, previous_state: previous, current_state: current, source });

  // Item inédito no projeto.
  if (!candidate.entity_id && res.mode === "create" && res.verdict === "NEW") {
    return done("NEW", "registrado nesta reunião");
  }

  // Decisão nova que substitui uma anterior.
  if (res.mode === "create" && res.verdict === "UPDATE_EXISTING" && candidate.entity_type === "decision") {
    return done("SUPERSEDED", `substituída por "${candidate.label}"`);
  }

  // Mudança de estado explícita prevalece sobre qualquer outro sinal.
  if (res.statusSignal === "resolved") return done("RESOLVED", "concluído nesta reunião");
  if (res.statusSignal === "reopened") return done("REOPENED", "voltou a acontecer");

  if (candidate.entity_type === "risk") {
    const levelChange = changeOf(res, "level");
    if (levelChange) {
      const before = riskWeight(levelChange.from);
      const after = riskWeight(levelChange.to);
      if (after > before) return done("REGRESSED", `nível ${levelChange.to}`);
      if (after < before) return done("PROGRESSED", `nível ${levelChange.to}`);
    }
    if (existing?.active === false && res.mode === "update") return done("REOPENED", "risco reativado");
  }

  if (candidate.entity_type === "action") {
    const openAction = !CLOSED_STATUS.test(String(existing?.status ?? ""));
    const deadlineChange = changeOf(res, "deadline");
    // Prazo empurrado para frente ou já vencido e ainda aberto = atraso real.
    if (openAction && deadlineChange && deadlineChange.from && deadlineChange.to > deadlineChange.from) {
      return done("DELAYED", `prazo movido para ${deadlineChange.to}`);
    }
    if (openAction && isPastDate(existing?.deadline, today) && !deadlineChange) {
      return done("DELAYED", `prazo vencido em ${existing?.deadline}`);
    }
  }

  // Sem campo estruturado alterado: a fala é o único sinal.
  if (base.evidence && BLOCKED_HINT.test(base.evidence)) {
    return done("BLOCKED", "impedimento relatado na reunião", "ai");
  }

  if (res.mode === "update" && res.changes.length > 0) {
    return done("PROGRESSED", res.changes.map((c) => `${c.label}: ${c.to}`).join(" · "));
  }

  // Reconfirmação sem nenhuma mudança comparável.
  return done("UNCHANGED", "reconfirmado sem mudança");
}

export function buildEvolution(
  candidates: EvolutionCandidate[],
  today?: string,
): EvolutionItem[] {
  return candidates
    .filter((c) => c.label.trim().length > 0)
    .map((c) => classifyCandidate(c, today));
}

/* ---------------- resumo e movimento do projeto ---------------- */

export type EvolutionSummary = {
  counts: Record<EvolutionClassification, number>;
  total: number;
  highlights: string[];
};

export function summarizeEvolution(items: EvolutionItem[]): EvolutionSummary {
  const counts = Object.fromEntries(
    EVOLUTION_CLASSIFICATIONS.map((c) => [c, 0]),
  ) as Record<EvolutionClassification, number>;
  for (const item of items) counts[item.classification] += 1;

  const highlights = EVOLUTION_CLASSIFICATIONS.filter((c) => counts[c] > 0).map(
    (c) => `${counts[c]} ${EVOLUTION_LABEL[c].toLowerCase()}`,
  );
  return { counts, total: items.length, highlights };
}

/**
 * Movimento do projeto: leitura conservadora — regressão e bloqueio pesam
 * mais do que avanço, e "estável" só quando nada relevante mudou.
 */
export function computeMovement(summary: EvolutionSummary): ProjectMovement {
  const { counts, total } = summary;
  if (total === 0) return "estavel";
  const negative = counts.REGRESSED + counts.REOPENED;
  const stuck = counts.BLOCKED + counts.DELAYED;
  const positive = counts.PROGRESSED + counts.RESOLVED + counts.NEW;

  if (negative > 0 && negative >= positive) return "regredindo";
  if (counts.BLOCKED > 0 && counts.BLOCKED >= positive) return "travado";
  if (stuck > positive) return "atencao";
  if (positive > 0) return "avancando";
  return "estavel";
}

/* ---------------- persistência ---------------- */

export type EvolutionRecordInput = {
  projectId: string;
  clientId: string | null;
  meetingId: string;
  analysisId: string | null;
  previousMeetingId: string | null;
  items: EvolutionItem[];
};

/**
 * Gravação idempotente: uma reunião tem no máximo um registro de evolução
 * (índice único em meeting_id). Reaplicar a mesma análise substitui os
 * itens em vez de duplicar a linha do tempo.
 */
export async function saveEvolution(input: EvolutionRecordInput, userId: string | null) {
  const summary = summarizeEvolution(input.items);
  const movement = computeMovement(summary);

  const existing = await supabase
    .from("meeting_evolution")
    .select("id")
    .eq("meeting_id", input.meetingId)
    .maybeSingle();
  if (existing.error) logDbError("meeting_evolution", "select", existing.error);

  let evolutionId = (existing.data as { id: string } | null)?.id ?? null;

  if (evolutionId) {
    const { error } = await supabase
      .from("meeting_evolution")
      .update({
        summary: summary as never,
        movement,
        analysis_id: input.analysisId,
        previous_meeting_id: input.previousMeetingId,
      })
      .eq("id", evolutionId);
    if (error) logDbError("meeting_evolution", "update", error);
    await supabase.from("meeting_evolution_items").delete().eq("evolution_id", evolutionId);
  } else {
    const created = await supabase
      .from("meeting_evolution")
      .insert({
        project_id: input.projectId,
        client_id: input.clientId,
        meeting_id: input.meetingId,
        analysis_id: input.analysisId,
        previous_meeting_id: input.previousMeetingId,
        summary: summary as never,
        movement,
        created_by: userId,
      })
      .select("id")
      .single();
    if (created.error) {
      logDbError("meeting_evolution", "insert", created.error);
      return null;
    }
    evolutionId = (created.data as { id: string }).id;
  }

  if (input.items.length > 0) {
    const { error } = await supabase.from("meeting_evolution_items").insert(
      input.items.map((item) => ({
        evolution_id: evolutionId,
        project_id: input.projectId,
        client_id: input.clientId,
        meeting_id: input.meetingId,
        entity_type: item.entity_type,
        entity_id: item.entity_id,
        label: item.label,
        classification: item.classification,
        previous_state: item.previous_state,
        current_state: item.current_state,
        evidence: item.evidence,
        confidence: item.confidence,
        source: item.source,
      })) as never,
    );
    if (error) logDbError("meeting_evolution_items", "insert", error);
  }

  return { id: evolutionId, movement, summary };
}

/* ---------------- leitura ---------------- */

export type EvolutionRecord = {
  id: string;
  project_id: string;
  meeting_id: string;
  previous_meeting_id: string | null;
  movement: ProjectMovement;
  summary: EvolutionSummary;
  created_at: string;
  items: (EvolutionItem & { id: string })[];
};

/** Linha do tempo do projeto — reunião mais recente primeiro. */
export function projectEvolutionQuery(projectId: string | null) {
  return queryOptions({
    queryKey: ["meeting_evolution", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<EvolutionRecord[]> => {
      if (!projectId) return [];
      const res = await supabase
        .from("meeting_evolution")
        .select("*, items:meeting_evolution_items(*)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (res.error) {
        logDbError("meeting_evolution", "select", res.error);
        return [];
      }
      return ((res.data ?? []) as unknown as EvolutionRecord[]).map((r) => ({
        ...r,
        items: r.items ?? [],
      }));
    },
  });
}

/**
 * Itens que devem entrar na próxima pauta: nada avança sozinho, então
 * bloqueado, atrasado, regredido e reaberto sobem para o topo.
 */
export function evolutionAgendaTopics(record: EvolutionRecord | undefined): string[] {
  if (!record) return [];
  const priority: EvolutionClassification[] = ["BLOCKED", "REGRESSED", "DELAYED", "REOPENED"];
  return record.items
    .filter((i) => priority.includes(i.classification))
    .sort((a, b) => priority.indexOf(a.classification) - priority.indexOf(b.classification))
    .map((i) => `${EVOLUTION_LABEL[i.classification]}: ${i.label}`);
}
