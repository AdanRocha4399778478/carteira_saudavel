import { queryOptions } from "@tanstack/react-query";
import { logDbError } from "@/lib/api";
import type { Client, Meeting } from "@/lib/domain";
import type { Decision, Project } from "@/lib/projects";
import { supabase } from "@/lib/supabase/client";

const PROJECT_DETAIL_COLUMNS =
  "id, client_id, name, description, status, start_date, target_end_date, consultant_id";
const PROJECT_CLIENT_COLUMNS = "id, company_name, consultant_id";
const PROJECT_EDIT_CLIENT_COLUMNS = "id, company_name";
const UNLINKED_MEETING_COLUMNS = "id, meeting_date, meeting_type";
const PROJECT_DECISION_COLUMNS =
  "id, meeting_id, title, description, reason, status, owner, due_date, embedding";

export const projectDetailQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["projects", "detail", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<Project | null> => {
      const res = await supabase
        .from("projects")
        .select(PROJECT_DETAIL_COLUMNS)
        .eq("id", projectId)
        .maybeSingle();
      if (res.error) {
        logDbError("projects", "select-detail", res.error);
        throw new Error(res.error.message);
      }
      return (res.data as Project | null) ?? null;
    },
  });

export const projectClientQuery = (clientId: string) =>
  queryOptions({
    queryKey: ["clients", "project-detail", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<Client | null> => {
      const res = await supabase
        .from("clients")
        .select(PROJECT_CLIENT_COLUMNS)
        .eq("id", clientId)
        .maybeSingle();
      if (res.error) {
        logDbError("clients", "select-project-detail", res.error);
        throw new Error(res.error.message);
      }
      return (res.data as Client | null) ?? null;
    },
  });

export const projectEditClientsQuery = () =>
  queryOptions({
    queryKey: ["clients", "project-edit-lookup"],
    queryFn: async (): Promise<Client[]> => {
      const res = await supabase
        .from("clients")
        .select(PROJECT_EDIT_CLIENT_COLUMNS)
        .order("company_name");
      if (res.error) {
        logDbError("clients", "select-project-edit-lookup", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as Client[];
    },
  });

export const projectUnlinkedMeetingsQuery = (clientId: string) =>
  queryOptions({
    queryKey: ["meetings", "unlinked", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<Meeting[]> => {
      const res = await supabase
        .from("meetings")
        .select(UNLINKED_MEETING_COLUMNS)
        .eq("client_id", clientId)
        .is("project_id", null)
        .order("meeting_date", { ascending: false });
      if (res.error) {
        logDbError("meetings", "select-unlinked-project", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as unknown as Meeting[];
    },
  });

/** Decisões do detalhe: apenas campos consumidos por UI, saúde, orquestrador e deduplicação. */
export const projectDecisionsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["decisions", "project-detail", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<Decision[]> => {
      const res = await supabase
        .from("decisions")
        .select(PROJECT_DECISION_COLUMNS)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (res.error) {
        logDbError("decisions", "select-project-detail", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as unknown as Decision[];
    },
  });
