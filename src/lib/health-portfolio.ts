import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logDbError, actionsQuery, meetingsQuery, risksQuery } from "@/lib/api";
import { normalizeContext, decisionsQuery, projectsQuery, type ProjectContext } from "@/lib/projects";
import { computeProjectHealth, type ProjectHealth } from "@/lib/health";
import type { EvolutionRecord } from "@/lib/evolution";
import type { Meeting } from "@/lib/domain";

/* ------------------------------------------------------------------ *
 * Cockpit da carteira: calcula a saúde consultiva de todos os projetos
 * reaproveitando as queries já existentes. Nenhuma métrica nova é
 * inventada — apenas agregação do que já está no banco.
 * ------------------------------------------------------------------ */

export const allProjectContextsQuery = () =>
  queryOptions({
    queryKey: ["project_context", "all"],
    queryFn: async (): Promise<ProjectContext[]> => {
      const res = await supabase.from("project_context").select("*");
      if (res.error) {
        logDbError("project_context", "select-all", res.error);
        return [];
      }
      return ((res.data ?? []) as Record<string, unknown>[]).map(normalizeContext);
    },
  });

export const allEvolutionsQuery = () =>
  queryOptions({
    queryKey: ["meeting_evolution", "all"],
    queryFn: async (): Promise<EvolutionRecord[]> => {
      const res = await supabase
        .from("meeting_evolution")
        .select("*, items:meeting_evolution_items(*)")
        .order("created_at", { ascending: false });
      if (res.error) {
        logDbError("meeting_evolution", "select-all", res.error);
        return [];
      }
      return ((res.data ?? []) as unknown as EvolutionRecord[]).map((r) => ({
        ...r,
        items: r.items ?? [],
      }));
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

export function useProjectsHealth() {
  const projects = useQuery(projectsQuery());
  const actions = useQuery(actionsQuery());
  const risks = useQuery(risksQuery());
  const meetings = useQuery(meetingsQuery());
  const decisions = useQuery(decisionsQuery());
  const contexts = useQuery(allProjectContextsQuery());
  const evolutions = useQuery(allEvolutionsQuery());

  const rows = useMemo<ProjectHealthRow[]>(() => {
    const list = projects.data ?? [];
    if (list.length === 0) return [];

    const allMeetings = (meetings.data ?? []) as Meeting[];
    const meetingsByProject = new Map<string, Meeting[]>();
    const projectByMeeting = new Map<string, string>();
    for (const m of allMeetings) {
      const pid = (m as Meeting & { project_id?: string | null }).project_id ?? null;
      if (!pid) continue;
      projectByMeeting.set(m.id, pid);
      meetingsByProject.set(pid, [...(meetingsByProject.get(pid) ?? []), m]);
    }

    const contextByProject = new Map((contexts.data ?? []).map((c) => [c.project_id, c]));
    const latestEvolution = new Map<string, EvolutionRecord>();
    for (const e of evolutions.data ?? []) {
      if (!latestEvolution.has(e.project_id)) latestEvolution.set(e.project_id, e);
    }

    return list.map((p) => {
      const projectMeetings = meetingsByProject.get(p.id) ?? [];
      const meetingIds = new Set(projectMeetings.map((m) => m.id));
      const scopedActions = (actions.data ?? []).filter(
        (a) =>
          (a.meeting_id && meetingIds.has(a.meeting_id)) ||
          (!a.meeting_id && a.client_id === p.client_id),
      );
      const scopedRisks = (risks.data ?? []).filter(
        (r) =>
          r.active &&
          ((r.meeting_id && meetingIds.has(r.meeting_id)) ||
            (!r.meeting_id && r.client_id === p.client_id)),
      );
      const scopedDecisions = (decisions.data ?? []).filter((d) => d.project_id === p.id);

      const health = computeProjectHealth({
        actions: scopedActions,
        risks: scopedRisks,
        decisions: scopedDecisions,
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
