import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { logDbError } from "./api";
import { daysSince, isOverdue, startOfToday, type ActionItem, type Meeting, type RiskItem } from "./domain";
import type { ContextItem, Decision } from "./projects";
import type { EvolutionRecord, ProjectMovement } from "./evolution";

/* ------------------------------------------------------------------ *
 * SAÚDE CONSULTIVA E PRIORIDADE DE INTERVENÇÃO
 *
 * Motor 100% determinístico: nenhuma nota vem de IA. Toda perda de
 * ponto tem um motivo explícito (`reasons`), e dimensões sem dado
 * suficiente são marcadas como indisponíveis — o peso delas é
 * redistribuído entre as demais em vez de virar "nota zero".
 * ------------------------------------------------------------------ */

export const HEALTH_DIMENSIONS = [
  "execucao",
  "evolucao",
  "riscos",
  "decisoes",
  "cadencia",
  "resultados",
] as const;
export type HealthDimensionKey = (typeof HEALTH_DIMENSIONS)[number];

export const HEALTH_CONFIG = {
  /** Pesos configuráveis (somam 100). */
  weights: {
    execucao: 25,
    evolucao: 20,
    riscos: 20,
    decisoes: 15,
    cadencia: 10,
    resultados: 10,
  } as Record<HealthDimensionKey, number>,
  /** Cadência esperada quando não há histórico suficiente para mediana. */
  defaultCadenceDays: 30,
  /** Ação aberta parada há mais tempo que isto conta como arrastada. */
  staleActionDays: 30,
  /** Faixas do índice de saúde. */
  statusThresholds: { saudavel: 80, atencao: 60, risco: 40 },
};

export const HEALTH_DIMENSION_LABEL: Record<HealthDimensionKey, string> = {
  execucao: "Execução",
  evolucao: "Evolução",
  riscos: "Riscos",
  decisoes: "Decisões",
  cadencia: "Cadência",
  resultados: "Resultados",
};

export const HEALTH_STATUSES = ["saudável", "atenção", "risco", "crítico"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const INTERVENTION_PRIORITIES = ["BAIXA", "MÉDIA", "ALTA", "URGENTE"] as const;
export type InterventionPriority = (typeof INTERVENTION_PRIORITIES)[number];

export const PRIORITY_TONE: Record<InterventionPriority, "healthy" | "neutral" | "attention" | "critical"> = {
  BAIXA: "healthy",
  MÉDIA: "neutral",
  ALTA: "attention",
  URGENTE: "critical",
};

export const HEALTH_TONE: Record<HealthStatus, "healthy" | "attention" | "highrisk" | "critical"> = {
  "saudável": "healthy",
  "atenção": "attention",
  risco: "highrisk",
  "crítico": "critical",
};

export type HealthDimension = {
  key: HealthDimensionKey;
  label: string;
  weight: number;
  /** 0 a 100; null quando não há dado suficiente. */
  score: number | null;
  /** Contribuição efetiva no índice final (já com peso redistribuído). */
  contribution: number;
  available: boolean;
  reasons: string[];
};

export type ProjectHealth = {
  score: number;
  status: HealthStatus;
  priority: InterventionPriority;
  movement: ProjectMovement | null;
  dimensions: HealthDimension[];
  /** Principais motivos de perda de pontos, do mais grave para o menos. */
  reasons: string[];
  /** Sinais brutos usados nas regras de prioridade — auditáveis. */
  signals: {
    openActions: number;
    overdueActions: number;
    blockedActions: number;
    criticalRisks: number;
    overdueDecisions: number;
    pendingDecisions: number;
    daysSinceLastMeeting: number | null;
    expectedCadenceDays: number;
    resultsCount: number;
  };
};

export type HealthInput = {
  actions: ActionItem[];
  risks: RiskItem[];
  decisions: Decision[];
  meetings: Meeting[];
  evolution: EvolutionRecord | null | undefined;
  results: ContextItem[];
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function isStale(action: ActionItem): boolean {
  if (action.status === "concluída") return false;
  const base = action.updated_at ?? action.created_at;
  const days = daysSince(base?.slice(0, 10) ?? null);
  return (days ?? 0) > HEALTH_CONFIG.staleActionDays;
}

function isDecisionOverdue(d: Decision): boolean {
  if (!d.due_date) return false;
  if (d.status === "implementada" || d.status === "cancelada") return false;
  return new Date(d.due_date) < startOfToday();
}

/** Mediana dos intervalos entre reuniões — a cadência real do projeto. */
export function expectedCadenceDays(meetings: Meeting[]): number {
  const dates = meetings
    .map((m) => m.meeting_date)
    .filter(Boolean)
    .sort()
    .map((d) => new Date(`${d.slice(0, 10)}T00:00:00`).getTime());
  if (dates.length < 3) return HEALTH_CONFIG.defaultCadenceDays;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    gaps.push(Math.round((dates[i]! - dates[i - 1]!) / 86_400_000));
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid]! : Math.round((gaps[mid - 1]! + gaps[mid]!) / 2);
  return Math.max(7, Math.min(90, median || HEALTH_CONFIG.defaultCadenceDays));
}

const MOVEMENT_SCORE: Record<ProjectMovement, number> = {
  avancando: 85,
  estavel: 60,
  atencao: 45,
  travado: 25,
  regredindo: 15,
};

export function computeProjectHealth(input: HealthInput): ProjectHealth {
  const { actions, risks, decisions, meetings, evolution, results } = input;

  /* -------- Execução -------- */
  const openActions = actions.filter((a) => a.status !== "concluída");
  const overdueActions = actions.filter((a) => isOverdue(a));
  const blockedActions = openActions.filter((a) => a.status === "bloqueada");
  const staleActions = openActions.filter(isStale);
  const execReasons: string[] = [];
  let execScore: number | null = null;
  if (actions.length > 0) {
    const done = actions.filter((a) => a.status === "concluída").length;
    const completion = done / actions.length;
    const overdueRatio = openActions.length ? overdueActions.length / openActions.length : 0;
    const blockedRatio = openActions.length ? blockedActions.length / openActions.length : 0;
    const staleRatio = openActions.length ? staleActions.length / openActions.length : 0;
    execScore = clamp(
      100 * (0.45 * completion + 0.55 * (1 - overdueRatio)) - 15 * blockedRatio - 10 * staleRatio,
    );
    if (overdueActions.length)
      execReasons.push(`${overdueActions.length} ação(ões) com prazo vencido`);
    if (blockedActions.length) execReasons.push(`${blockedActions.length} ação(ões) bloqueada(s)`);
    if (staleActions.length)
      execReasons.push(
        `${staleActions.length} ação(ões) sem movimento há mais de ${HEALTH_CONFIG.staleActionDays} dias`,
      );
    if (completion < 0.4) execReasons.push("menos de 40% das ações concluídas");
  } else {
    execReasons.push("nenhuma ação registrada no projeto");
  }

  /* -------- Evolução -------- */
  const evoReasons: string[] = [];
  let evoScore: number | null = null;
  let movement: ProjectMovement | null = null;
  if (evolution) {
    movement = evolution.movement;
    const c = evolution.summary?.counts;
    if (c && evolution.summary.total > 0) {
      const positive = c.PROGRESSED + c.RESOLVED;
      const negative = c.REGRESSED + c.REOPENED + c.BLOCKED + c.DELAYED;
      const base = MOVEMENT_SCORE[movement];
      const ratio = (positive - negative) / evolution.summary.total;
      evoScore = clamp(0.6 * base + 0.4 * (50 + 50 * ratio));
      if (c.REGRESSED) evoReasons.push(`${c.REGRESSED} item(ns) em regressão`);
      if (c.BLOCKED) evoReasons.push(`${c.BLOCKED} item(ns) bloqueado(s)`);
      if (c.DELAYED) evoReasons.push(`${c.DELAYED} item(ns) atrasado(s)`);
      if (c.REOPENED) evoReasons.push(`${c.REOPENED} item(ns) reaberto(s)`);
    } else {
      evoScore = MOVEMENT_SCORE[movement];
      evoReasons.push("última reunião não apresentou mudanças relevantes");
    }
  } else {
    evoReasons.push("sem comparação entre reuniões registrada");
  }

  /* -------- Riscos -------- */
  const activeRisks = risks.filter((r) => r.active);
  const criticalRisks = activeRisks.filter((r) => r.level === "crítico");
  const highRisks = activeRisks.filter((r) => r.level === "alto");
  const mediumRisks = activeRisks.filter((r) => r.level === "médio");
  const lowRisks = activeRisks.filter((r) => r.level === "baixo");
  const riskReasons: string[] = [];
  const riskScore = clamp(
    100 -
      (criticalRisks.length * 30 +
        highRisks.length * 18 +
        mediumRisks.length * 8 +
        lowRisks.length * 3),
  );
  if (criticalRisks.length) riskReasons.push(`${criticalRisks.length} risco(s) crítico(s) ativo(s)`);
  if (highRisks.length) riskReasons.push(`${highRisks.length} risco(s) alto(s) ativo(s)`);
  if (mediumRisks.length) riskReasons.push(`${mediumRisks.length} risco(s) médio(s) ativo(s)`);

  /* -------- Decisões -------- */
  const pendingDecisions = decisions.filter(
    (d) => d.status === "pendente" || d.status === "em_execucao" || d.status === "aprovada",
  );
  const overdueDecisions = decisions.filter(isDecisionOverdue);
  const decisionReasons: string[] = [];
  let decisionScore: number | null = null;
  if (decisions.length > 0) {
    const implemented = decisions.filter((d) => d.status === "implementada").length;
    const decided = decisions.filter((d) => d.status !== "pendente").length;
    const implementedRatio = implemented / decisions.length;
    const decidedRatio = decided / decisions.length;
    decisionScore = clamp(
      100 * (0.5 * implementedRatio + 0.5 * decidedRatio) - 12 * overdueDecisions.length,
    );
    if (overdueDecisions.length)
      decisionReasons.push(`${overdueDecisions.length} decisão(ões) com prazo vencido`);
    const stuck = decisions.filter((d) => d.status === "pendente").length;
    if (stuck) decisionReasons.push(`${stuck} decisão(ões) ainda pendente(s)`);
    if (implementedRatio < 0.3) decisionReasons.push("poucas decisões efetivamente implementadas");
  } else {
    decisionReasons.push("nenhuma decisão registrada no projeto");
  }

  /* -------- Cadência -------- */
  const sortedMeetings = [...meetings].sort((a, b) => b.meeting_date.localeCompare(a.meeting_date));
  const lastMeetingDate = sortedMeetings[0]?.meeting_date ?? null;
  const sinceLast = daysSince(lastMeetingDate);
  const expected = expectedCadenceDays(meetings);
  const cadenceReasons: string[] = [];
  let cadenceScore: number | null = null;
  if (sinceLast !== null) {
    const ratio = sinceLast / expected;
    cadenceScore = ratio <= 1 ? 100 : clamp(100 - 55 * (ratio - 1));
    if (ratio > 1)
      cadenceReasons.push(
        `${sinceLast} dias sem reunião (cadência esperada: ${expected} dias)`,
      );
  } else {
    cadenceReasons.push("nenhuma reunião registrada no projeto");
  }

  /* -------- Resultados -------- */
  const measurableMeetings = meetings.filter((m) => m.has_measurable_result).length;
  const resultsCount = results.length + measurableMeetings;
  const resultReasons: string[] = [];
  let resultScore: number | null = null;
  if (meetings.length >= 2 || results.length > 0) {
    resultScore = clamp(resultsCount === 0 ? 25 : 40 + 20 * resultsCount);
    if (resultsCount === 0) resultReasons.push("nenhum resultado alcançado registrado");
    else if (resultsCount < 3) resultReasons.push("poucos resultados registrados até aqui");
  } else {
    resultReasons.push("projeto recente demais para medir resultados");
  }

  /* -------- Consolidação com redistribuição de peso -------- */
  const raw: Record<HealthDimensionKey, { score: number | null; reasons: string[] }> = {
    execucao: { score: execScore, reasons: execReasons },
    evolucao: { score: evoScore, reasons: evoReasons },
    riscos: { score: riskScore, reasons: riskReasons },
    decisoes: { score: decisionScore, reasons: decisionReasons },
    cadencia: { score: cadenceScore, reasons: cadenceReasons },
    resultados: { score: resultScore, reasons: resultReasons },
  };

  const availableWeight = HEALTH_DIMENSIONS.reduce(
    (sum, key) => (raw[key].score === null ? sum : sum + HEALTH_CONFIG.weights[key]),
    0,
  );

  const dimensions: HealthDimension[] = HEALTH_DIMENSIONS.map((key) => {
    const { score, reasons } = raw[key];
    const weight = HEALTH_CONFIG.weights[key];
    const effective = availableWeight > 0 && score !== null ? (weight / availableWeight) * 100 : 0;
    return {
      key,
      label: HEALTH_DIMENSION_LABEL[key],
      weight,
      score,
      contribution: score === null ? 0 : Number(((score * effective) / 100).toFixed(1)),
      available: score !== null,
      reasons,
    };
  });

  const score =
    availableWeight === 0
      ? 50
      : clamp(dimensions.reduce((sum, d) => sum + d.contribution, 0));

  const status: HealthStatus =
    score >= HEALTH_CONFIG.statusThresholds.saudavel
      ? "saudável"
      : score >= HEALTH_CONFIG.statusThresholds.atencao
        ? "atenção"
        : score >= HEALTH_CONFIG.statusThresholds.risco
          ? "risco"
          : "crítico";

  const signals = {
    openActions: openActions.length,
    overdueActions: overdueActions.length,
    blockedActions: blockedActions.length,
    criticalRisks: criticalRisks.length + highRisks.length,
    overdueDecisions: overdueDecisions.length,
    pendingDecisions: pendingDecisions.length,
    daysSinceLastMeeting: sinceLast,
    expectedCadenceDays: expected,
    resultsCount,
  };

  const priority = computeInterventionPriority(score, movement, signals);

  /* Motivos ordenados pelo impacto real no índice. */
  const reasons = dimensions
    .filter((d) => d.available && (d.score ?? 100) < 80)
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
    .flatMap((d) => d.reasons.map((r) => `${d.label}: ${r}`));

  return { score, status, priority, movement, dimensions, reasons, signals };
}

/**
 * Prioridade de intervenção: regras explícitas, avaliadas do mais grave
 * para o menos grave. O índice sozinho nunca decide — sinais duros
 * (risco crítico, projeto travado, ações vencidas) sobem a prioridade.
 */
export function computeInterventionPriority(
  score: number,
  movement: ProjectMovement | null,
  s: ProjectHealth["signals"],
): InterventionPriority {
  const staleRatio =
    s.daysSinceLastMeeting !== null ? s.daysSinceLastMeeting / s.expectedCadenceDays : 0;

  if (
    score < 40 ||
    (s.criticalRisks > 0 && movement === "regredindo") ||
    s.overdueActions >= 5 ||
    (movement === "travado" && s.overdueActions > 0)
  )
    return "URGENTE";

  if (
    score < 60 ||
    s.criticalRisks > 0 ||
    movement === "regredindo" ||
    movement === "travado" ||
    s.overdueActions >= 3 ||
    staleRatio > 2
  )
    return "ALTA";

  if (
    score < 78 ||
    s.overdueActions > 0 ||
    s.overdueDecisions > 0 ||
    movement === "atencao" ||
    staleRatio > 1
  )
    return "MÉDIA";

  return "BAIXA";
}

/* ---------------- snapshots ---------------- */

export type HealthSnapshot = {
  id: string;
  project_id: string;
  meeting_id: string | null;
  score: number;
  health_status: string;
  intervention_priority: string;
  movement: string | null;
  breakdown: unknown;
  reasons: string[];
  created_at: string;
};

export function projectHealthSnapshotsQuery(projectId: string | null) {
  return queryOptions({
    queryKey: ["project_health_snapshots", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<HealthSnapshot[]> => {
      if (!projectId) return [];
      const res = await supabase
        .from("project_health_snapshots")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(24);
      if (res.error) {
        logDbError("project_health_snapshots", "select", res.error);
        return [];
      }
      return (res.data ?? []) as unknown as HealthSnapshot[];
    },
  });
}

/**
 * Grava o retrato da saúde no momento da aprovação de uma reunião.
 * Idempotente por reunião (índice único project_id + meeting_id).
 */
export async function saveHealthSnapshot(params: {
  projectId: string;
  clientId: string | null;
  meetingId: string | null;
  analysisId: string | null;
  health: ProjectHealth;
  userId: string | null;
}) {
  const payload = {
    project_id: params.projectId,
    client_id: params.clientId,
    meeting_id: params.meetingId,
    analysis_id: params.analysisId,
    score: params.health.score,
    health_status: params.health.status,
    intervention_priority: params.health.priority,
    movement: params.health.movement,
    breakdown: {
      dimensions: params.health.dimensions,
      signals: params.health.signals,
    } as never,
    reasons: params.health.reasons as never,
    created_by: params.userId,
  };

  if (params.meetingId) {
    const existing = await supabase
      .from("project_health_snapshots")
      .select("id")
      .eq("project_id", params.projectId)
      .eq("meeting_id", params.meetingId)
      .maybeSingle();
    if (existing.data) {
      const { error } = await supabase
        .from("project_health_snapshots")
        .update(payload as never)
        .eq("id", (existing.data as { id: string }).id);
      if (error) logDbError("project_health_snapshots", "update", error);
      return;
    }
  }

  const { error } = await supabase.from("project_health_snapshots").insert(payload as never);
  if (error) logDbError("project_health_snapshots", "insert", error);
}
