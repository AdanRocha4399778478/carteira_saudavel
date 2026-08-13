import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { enrichInput, enrichRecommendation } from "@/lib/orchestrator.server";

/* Camada fina de RPC: a lógica de IA vive em orchestrator.server.ts */

export const enrichOrchestratorRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => enrichInput.parse(data))
  .handler(async ({ data }) => enrichRecommendation(data));
