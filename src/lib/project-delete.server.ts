import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logDbError } from "@/lib/api";
import type { Database } from "@/lib/supabase/types";

/* ------------------------------------------------------------------ *
 * EXCLUSÃO ADMINISTRATIVA DE PROJETO — GATE 11B
 *
 * Orquestra do lado do servidor a exclusão segura de um projeto órfão/
 * residual: chama os RPCs `admin_delete_project_preview` (só leitura) e
 * `admin_delete_project` (transação no Postgres, admin-only, ver migration
 * 20260914220000_admin_delete_project.sql). Toda a regra de bloqueio
 * (meetings/actions/risks/decisions/opportunities/analysis_applications/
 * contexto) vive no banco — esta camada só chama o RPC e valida o formato
 * da resposta, nunca reimplementa nem contorna a checagem de admin ou de
 * dependências.
 *
 * O cliente Supabase usado aqui é sempre o autenticado por request, exposto
 * no context pelo middleware `requireSupabaseAuth` — nunca service role.
 * ------------------------------------------------------------------ */

export const projectDeleteInput = z.object({
  projectId: z.string().uuid("projectId precisa ser um UUID válido."),
});
export type ProjectDeleteInput = z.infer<typeof projectDeleteInput>;

type SupabaseLike = SupabaseClient<Database>;

export type ProjectDeleteCounts = {
  meetings: number;
  actions: number;
  risks: number;
  decisions: number;
  opportunities: number;
  analysis_applications: number;
  /** Informativo apenas — gerada automaticamente pelo orquestrador, nunca bloqueia (FK ON DELETE CASCADE). */
  orchestrator_recommendations: number;
};

/** Formato devolvido por `public.admin_delete_project_preview` (ver migration). */
export type PreviewAdminDeleteProjectResult = {
  project_id: string;
  project_name: string;
  client_id: string;
  client_name: string | null;
  can_delete: boolean;
  blocking_reason: string | null;
  counts: ProjectDeleteCounts;
  has_project_context: boolean;
  project_context_is_empty: boolean;
};

function isProjectDeleteCounts(value: unknown): value is ProjectDeleteCounts {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["meetings"] === "number" &&
    typeof v["actions"] === "number" &&
    typeof v["risks"] === "number" &&
    typeof v["decisions"] === "number" &&
    typeof v["opportunities"] === "number" &&
    typeof v["analysis_applications"] === "number" &&
    typeof v["orchestrator_recommendations"] === "number"
  );
}

/**
 * Valida o JSON bruto do RPC antes de expor para a UI — nunca confia
 * cegamente no formato de um `Json` genérico do Postgres.
 */
export function parsePreviewAdminDeleteProjectResult(raw: unknown): PreviewAdminDeleteProjectResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Resposta inesperada de admin_delete_project_preview: formato inválido.");
  }
  const r = raw as Record<string, unknown>;

  if (
    typeof r["project_id"] !== "string" ||
    typeof r["project_name"] !== "string" ||
    typeof r["client_id"] !== "string" ||
    typeof r["can_delete"] !== "boolean"
  ) {
    throw new Error(
      "Resposta inesperada de admin_delete_project_preview: campos obrigatórios ausentes.",
    );
  }
  if (!isProjectDeleteCounts(r["counts"])) {
    throw new Error("Resposta inesperada de admin_delete_project_preview: contagens inválidas.");
  }

  return {
    project_id: r["project_id"] as string,
    project_name: r["project_name"] as string,
    client_id: r["client_id"] as string,
    client_name: typeof r["client_name"] === "string" ? r["client_name"] : null,
    can_delete: r["can_delete"] as boolean,
    blocking_reason: typeof r["blocking_reason"] === "string" ? r["blocking_reason"] : null,
    counts: r["counts"] as ProjectDeleteCounts,
    has_project_context: r["has_project_context"] === true,
    project_context_is_empty: r["project_context_is_empty"] === true,
  };
}

/** Só leitura — nunca executa a exclusão. */
export async function previewAdminDeleteProject(
  supabase: SupabaseLike,
  data: ProjectDeleteInput,
): Promise<PreviewAdminDeleteProjectResult> {
  const { projectId } = data;

  const { data: rpcData, error } = await supabase.rpc("admin_delete_project_preview", {
    p_project_id: projectId,
  });

  if (error) {
    logDbError("projects", "admin_delete_project_preview", error);
    throw new Error(`Não foi possível carregar a prévia da exclusão: ${error.message}`);
  }

  return parsePreviewAdminDeleteProjectResult(rpcData);
}

export type AdminDeleteProjectResult = {
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string | null;
  deleted: true;
};

type RawAdminDeleteProjectResult = {
  project_id?: unknown;
  project_name?: unknown;
  client_id?: unknown;
  client_name?: unknown;
  deleted?: unknown;
};

/**
 * Executa a exclusão real. O RPC revalida TODAS as condições de bloqueio do
 * zero (não confia no preview já mostrado ao cliente) antes de apagar —
 * ver admin_delete_project na migration. Se qualquer dependência tiver
 * surgido entre o preview e este chamado, o RPC lança e nada é apagado.
 */
export async function adminDeleteProject(
  supabase: SupabaseLike,
  data: ProjectDeleteInput,
): Promise<AdminDeleteProjectResult> {
  const { projectId } = data;

  const { data: rpcData, error } = await supabase.rpc("admin_delete_project", {
    p_project_id: projectId,
  });

  if (error) {
    logDbError("projects", "admin_delete_project", error);
    throw new Error(`Não foi possível excluir o projeto: ${error.message}`);
  }

  const result = rpcData as unknown as RawAdminDeleteProjectResult | null;
  if (
    !result ||
    result.deleted !== true ||
    typeof result.project_id !== "string" ||
    typeof result.client_id !== "string"
  ) {
    throw new Error("Resposta inesperada de admin_delete_project: exclusão não confirmada.");
  }

  return {
    projectId: result.project_id,
    projectName: typeof result.project_name === "string" ? result.project_name : "",
    clientId: result.client_id,
    clientName: typeof result.client_name === "string" ? result.client_name : null,
    deleted: true,
  };
}
