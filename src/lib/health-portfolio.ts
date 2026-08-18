import { useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { logDbError } from "@/lib/api";
import {
  normalizeContext,
  type Decision,
  type ProjectContext,
} from "@/lib/projects";
import { computeProjectHealth, type ProjectHealth } from "@/lib/health";
import type { EvolutionRecord } from "@/lib/evolution";
import type { ActionItem, Meeting, RiskItem } from "@/lib/domain";

/* ------------------------------------------------------------------ *
 * Cockpit da carteira: calcula a saúde consultiva de todos os projetos
 * com consultas próprias e enxutas. O motor de saúde permanece no
 * frontend; esta camada busca apenas os campos consumidos pelo cálculo.
 * ------------------------------------------------------------------ */

const COCKPIT_PROJECT_COLUMNS = "id, client_id, name, status";
const COCKPIT_ACTION_COLUMNS =
  "client_id, meeting_id, status, deadline, created_at, updated_at";
const COCKPIT_RISK_COLUMNS = "client_id, meeting_id, level, active";
const COCKPIT_MEETING_COLUMNS = "id, project_id, meeting_date, has_measurable_result";
const COCKPIT_DECISION_COLUMNS = "project_id, status, due_date";
const COCKPIT_CONTEXT_COLUMNS = "project_id, results";
const COCKPIT_EVOLUTION_COLUMNS = "project_id, movement, summary, created_at";

type CockpitProject = {
  id: string;
  client_id: string;
  name: string;
  status: string;
};

const cockpitProjectsQuery = () =>
  queryOptions({
    queryKey: ["projects", "cockpit"],
    queryFn: async (): Promise<CockpitProject[]> => {
      const res = await supabase
        .from("projects")
        .select(COCKPIT_PROJECT_COLUMNS)
        .is("merged_into_project_id", null);
      if (res.error) {
        logDbError("projects", "select-cockpit", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as CockpitProject[];
    },
  });

const cockpitActionsQuery = () =>
  queryOptions({
    queryKey: ["actions", "cockpit"],
    queryFn: async (): Promise<ActionItem[]> => {
      const res = await supabase.from("actions").select(COCKPIT_ACTION_COLUMNS);
      if (res.error) {
        logDbError("actions", "select-cockpit", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as unknown as ActionItem[];
    },
  });

const cockpitRisksQuery = () =>
  queryOptions({
    queryKey: ["risks", "cockpit", "active"],
    queryFn: async (): Promise<RiskItem[]> => {
      const res = await supabase
        .from("risks")
        .select(COCKPIT_RISK_COLUMNS)
        .eq("active", true);
      if (res.error) {
        logDbError("risks", "select-cockpit-active", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as unknown as RiskItem[];
    },
  });

const cockpitMeetingsQuery = () =>
  queryOptions({
    queryKey: ["meetings", "cockpit"],
    queryFn: async (): Promise<Meeting[]> => {
      const res = await supabase.from("meetings").select(COCKPIT_MEETING_COLUMNS);
      if (res.error) {
        logDbError("meetings", "select-cockpit", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as unknown as Meeting[];
    },
  });

const cockpitDecisionsQuery = () =>
  queryOptions({
    queryKey: ["decisions", "cockpit"],
    queryFn: async (): Promise<Decision[]> => {
      const res = await supabase.from("decisions").select(COCKPIT_DECISION_COLUMNS);
      if (res.error) {
        logDbError("decisions", "select-cockpit", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as unknown as Decision[];
    },
  });

export const allProjectContextsQuery = () =>
  queryOptions({
    queryKey: ["project_context", "cockpit"],
    queryFn: async (): Promise<ProjectContext[]> => {
      const res = await supabase.from("project_context").select(COCKPIT_CONTEXT_COLUMNS);
      if (res.error) {
        logDbError("project_context", "select-cockpit", res.error);
        return [];
      }
      return ((res.data ?? []) as Record<string, unknown>[]).map(normalizeContext);
    },
  });

/**
 * O Cockpit consome somente a evolução mais recente de cada projeto. A view
 * security_invoker reduz o histórico no banco sem contornar as policies RLS
 * de meeting_evolution.
 */
export const allEvolutionsQuery = () =>
  queryOptions({
    queryKey: ["meeting_evolution", "cockpit", "latest"],
    queryFn: async (): Promise<EvolutionRecord[]> => {
      const res = await supabase
        .from("latest_project_evolution" as "meeting_evolution")
        .select(COCKPIT_EVOLUTION_COLUMNS);
      if (res.error) {
        logDbError("latest_project_evolution", "select-cockpit", res.error);
        return [];
      }
      return (res.data ?? []) as unknown as EvolutionRecord[];
    },
  });

export type ProjectHealthRow = {
  projectId: string;
  projectName: string;
  clientId: string;
  status: string;
  health: ProjectHealth;
};

const PRIORITY_ORDER = { URGENTE: 0, ALTA: 1, "MÉDIA": 2, BAIXA: 3 } as const;

function appendToMap<T>(map: Map<string, T[]>, key: string, item: T) {
  const bucket = map.get(key);
  if (bucket) bucket.push(item);
  else map.set(key, [item]);
}

export function useProjectsHealth() {
  const projects = useQuery(cockpitProjectsQuery());
  const actions = useQuery(cockpitActionsQuery());
  const risks = useQuery(cockpitRisksQuery());
  const meetings = useQuery(cockpitMeetingsQuery());
  const decisions = useQuery(cockpitDecisionsQuery());
  const contexts = useQuery(allProjectContextsQuery());
  const evolutions = useQuery(allEvolutionsQuery());

  const rows = useMemo<ProjectHealthRow[]>(() => {
    const list = projects.data ?? [];
    if (list.length === 0) return [];

    const meetingsByProject = new Map<string, Meeting[]>();
    for (const m of (meetings.data ?? []) as Meeting[]) {
      const pid = (m as Meeting & { project_id?: string | null }).project_id ?? null;
      if (!pid) continue;
      appendToMap(meetingsByProject, pid, m);
    }

    const actionsByMeeting = new Map<string, ActionItem[]>();
    const clientWideActions = new Map<string, ActionItem[]>();
    for (const action of actions.data ?? []) {
      if (action.meeting_id) appendToMap(actionsByMeeting, action.meeting_id, action);
      else appendToMap(clientWideActions, action.client_id, action);
    }

    const risksByMeeting = new Map<string, RiskItem[]>();
    const clientWideRisks = new Map<string, RiskItem[]>();
    for (const risk of risks.data ?? []) {
      if (risk.meeting_id) appendToMap(risksByMeeting, risk.meeting_id, risk);
      else appendToMap(clientWideRisks, risk.client_id, risk);
    }

    const decisionsByProject = new Map<string, Decision[]>();
    for (const decision of decisions.data ?? []) {
      appendToMap(decisionsByProject, decision.project_id, decision);
    }

    const contextByProject = new Map((contexts.data ?? []).map((c) => [c.project_id, c]));
    const latestEvolution = new Map((evolutions.data ?? []).map((e) => [e.project_id, e]));

    return list.map((p) => {
      const projectMeetings = meetingsByProject.get(p.id) ?? [];
      const scopedActions = [...(clientWideActions.get(p.client_id) ?? [])];
      const scopedRisks = [...(clientWideRisks.get(p.client_id) ?? [])];

      for (const meeting of projectMeetings) {
        scopedActions.push(...(actionsByMeeting.get(meeting.id) ?? []));
        scopedRisks.push(...(risksByMeeting.get(meeting.id) ?? []));
      }

      const health = computeProjectHealth({
        actions: scopedActions,
        risks: scopedRisks,
        decisions: decisionsByProject.get(p.id) ?? [],
        meetings: projectMeetings,
        evolution: latestEvolution.get(p.id) ?? null,
        results: contextByProject.get(p.id)?.results ?? [],
      });

      return {
        projectId: p.id,
        projectName: p.name,
        clientId: p.client_id,
        status: p.status,
        health,
      };
    });
  }, [projects.data, actions.data, risks.data, meetings.data, decisions.data, contexts.data, evolutions.data]);

  const ranked = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          PRIORITY_ORDER[a.health.priority] - PRIORITY_ORDER[b.health.priority] ||
          a.health.score - b.health.score,
      ),
    [rows],
  );

  return {
    rows,
    ranked,
    isLoading:
      projects.isLoading ||
      actions.isLoading ||
      risks.isLoading ||
      meetings.isLoading ||
      decisions.isLoading,
    error: projects.error ?? actions.error ?? meetings.error ?? null,
  };
}
