import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { analyzeInput, runMeetingAnalysis } from "@/lib/intelligent-meeting.server";

/* Camada fina de RPC: toda a lógica vive em intelligent-meeting.server.ts */

export const analyzeMeetingWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => analyzeInput.parse(data))
  .handler(async ({ data }) => runMeetingAnalysis(data));
