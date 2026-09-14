import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { undoMeetingInput, undoMeeting, previewMeetingUndo } from "@/lib/meeting-undo.server";

/* Camada fina de RPC: toda a lógica vive em meeting-undo.server.ts */

export const adminUndoMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => undoMeetingInput.parse(data))
  .handler(async ({ data, context }) => undoMeeting(context.supabase, data));

/** Só leitura — nunca executa o undo. Usada para mostrar o impacto antes da confirmação. */
export const previewAdminUndoMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => undoMeetingInput.parse(data))
  .handler(async ({ data, context }) => previewMeetingUndo(context.supabase, data));
