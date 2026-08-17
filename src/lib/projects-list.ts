import { queryOptions } from "@tanstack/react-query";
import { logDbError } from "@/lib/api";
import { type Client } from "@/lib/domain";
import { type Project } from "@/lib/projects";
import { supabase } from "@/lib/supabase/client";

const PROJECTS_LIST_COLUMNS =
  "id, client_id, name, status, consultant_id, target_end_date";
const PROJECTS_CLIENT_COLUMNS = "id, company_name, consultant_id";

/** Projetos canônicos com apenas os campos exibidos na listagem. */
export const projectsListQuery = () =>
  queryOptions({
    queryKey: ["projects", "list"],
    queryFn: async (): Promise<Project[]> => {
      const res = await supabase
        .from("projects")
        .select(PROJECTS_LIST_COLUMNS)
        .is("merged_into_project_id", null)
        .order("created_at", { ascending: false });
      if (res.error) {
        logDbError("projects", "select-list", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as Project[];
    },
  });

/**
 * Lookup de clientes da listagem e do modal de criação.
 * consultant_id é preservado para preencher o consultor padrão do novo projeto.
 */
export const projectsClientsQuery = () =>
  queryOptions({
    queryKey: ["clients", "projects-list"],
    queryFn: async (): Promise<Client[]> => {
      const res = await supabase
        .from("clients")
        .select(PROJECTS_CLIENT_COLUMNS)
        .order("company_name");
      if (res.error) {
        logDbError("clients", "select-projects-list", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as Client[];
    },
  });
