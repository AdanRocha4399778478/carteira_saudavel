import type { ActionItem, Meeting, RiskItem } from "@/lib/domain";
import { daysSince, isOverdue } from "@/lib/domain";
import type { Decision, Project, ProjectContext } from "@/lib/projects";
import { CONTEXT_LISTS } from "@/lib/projects";
import type { ProjectHealth } from "@/lib/health";
import type { EvolutionRecord } from "@/lib/evolution";
import type { OrchestratorState } from "./types";

/* ------------------------------------------------------------------ *
 * Consolidação do estado do projeto para o Orquestrador.
 * Somente dados já existentes; nunca transcrição de reunião.
 * ------------------------------------------------------------------ */

export type StateInput = {
  project: Project;
  context: ProjectContext | null;
  health: ProjectHealth;
  actions: ActionItem[];
  risks: RiskItem[];
  decisions: Decision[];
  meetings: Meeting[];
  evolution: EvolutionRecord | null | undefined;
  mentionsCount?: number;
};

const sample = (items: { text: string }[] | undefined) =>
  (items ?? []).slice(0, 5).map((i) => i.text.slice(0, 160));

export function buildOrchestratorState(input: StateInput): OrchestratorState {
  const { project, context, health, actions, risks, decisions, meetings, evolution } = input;

  const counts = CONTEXT_LISTS.reduce<Record<string, number>>((acc, key) => {
    acc[key] = context?.[key]?.length ?? 0;
    return acc;
  }, {});

  const samples = CONTEXT_LISTS.reduce<Record<string, string[]>>((acc, key) => {
    const list = sample(context?.[key]);
    if (list.length) acc[key] = list;
    return acc;
  }, {});

  const open = actions.filter((a) => a.status !== "concluída");
  const sortedMeetings = [...meetings].sort((a, b) => b.meeting_date.localeCompare(a.meeting_date));
  const last = sortedMeetings[0] ?? null;
  const evoCounts = evolution?.summary?.counts;

  return {
    project: { id: project.id, name: project.name, status: project.status },
    context: {
      hasMainObjective: Boolean(context?.main_objective?.trim()),
      objectives: counts["objectives"] ?? 0,
      problems: counts["problems"] ?? 0,
      root_causes: counts["root_causes"] ?? 0,
      priorities: counts["priorities"] ?? 0,
      hypotheses: counts["hypotheses"] ?? 0,
      constraints: counts["constraints"] ?? 0,
      results: counts["results"] ?? 0,
      next_steps: counts["next_steps"] ?? 0,
      samples,
    },
    health: {
      score: health.score,
      status: health.status,
      priority: health.priority,
      movement: health.movement,
      topReasons: health.reasons.slice(0, 4),
    },
    actions: {
      total: actions.length,
      open: open.length,
      overdue: actions.filter((a) => isOverdue(a)).length,
      blocked: open.filter((a) => a.status === "bloqueada").length,
      done: actions.filter((a) => a.status === "concluída").length,
    },
    decisions: {
      total: decisions.length,
      pending: decisions.filter((d) => d.status === "pendente").length,
      approved: decisions.filter((d) => d.status === "aprovada").length,
      inProgress: decisions.filter((d) => d.status === "em_execucao").length,
      implemented: decisions.filter((d) => d.status === "implementada").length,
      overdue: decisions.filter(
        (d) =>
          d.due_date &&
          d.status !== "implementada" &&
          d.status !== "cancelada" &&
          new Date(d.due_date) < new Date(),
      ).length,
    },
    risks: {
      active: risks.filter((r) => r.active).length,
      critical: risks.filter((r) => r.active && r.level === "crítico").length,
      high: risks.filter((r) => r.active && r.level === "alto").length,
    },
    evolution: evolution
      ? {
          movement: evolution.movement,
          delayed: evoCounts?.DELAYED ?? 0,
          blocked: evoCounts?.BLOCKED ?? 0,
          regressed: evoCounts?.REGRESSED ?? 0,
          progressed: evoCounts?.PROGRESSED ?? 0,
          resolved: evoCounts?.RESOLVED ?? 0,
        }
      : null,
    latestMeeting: last
      ? { id: last.id, date: last.meeting_date, daysSince: daysSince(last.meeting_date) }
      : null,
    mentions: { total: input.mentionsCount ?? 0 },
  };
}

/* ---------------- state_hash ---------------- */

/**
 * Assinatura canônica do estado que MUDA a decisão. Amostras de texto e
 * campos cosméticos ficam de fora — só o que altera a recomendação entra,
 * para não recalcular a cada micro-edição.
 */
export function canonicalStateSignature(state: OrchestratorState): string {
  const payload = {
    project: state.project.status,
    ctx: {
      obj: state.context.hasMainObjective,
      o: state.context.objectives,
      p: state.context.problems,
      rc: state.context.root_causes,
      pr: state.context.priorities,
      h: state.context.hypotheses,
      cs: state.context.constraints,
      rs: state.context.results,
      ns: state.context.next_steps,
    },
    health: {
      // Arredondado para múltiplos de 5: variação mínima não recalcula.
      s: Math.round(state.health.score / 5) * 5,
      st: state.health.status,
      pr: state.health.priority,
      mv: state.health.movement,
    },
    actions: state.actions,
    decisions: state.decisions,
    risks: state.risks,
    evolution: state.evolution,
    meeting: state.latestMeeting ? [state.latestMeeting.id, state.latestMeeting.date] : null,
  };
  return JSON.stringify(payload);
}

export async function computeStateHash(state: OrchestratorState): Promise<string> {
  const data = new TextEncoder().encode(canonicalStateSignature(state));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
