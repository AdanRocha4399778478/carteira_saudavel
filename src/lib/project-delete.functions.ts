import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import {
  adminDeleteProject,
  previewAdminDeleteProject,
  projectDeleteInput,
} from "@/lib/project-delete.server";

/* Camada fina de RPC: toda a lógica vive em project-delete.server.ts */

export const previewProjectDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => projectDeleteInput.parse(data))
  .handler(async ({ data, context }) => previewAdminDeleteProject(context.supabase, data));

/** Não fazer commit/exclusão real: só chamar após o admin confirmar digitando "EXCLUIR". */
export const deleteProjectAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => projectDeleteInput.parse(data))
  .handler(async ({ data, context }) => adminDeleteProject(context.supabase, data));
