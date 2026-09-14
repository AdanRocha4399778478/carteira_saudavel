import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { commitEmbeddingsBackfill, dryRunEmbeddingsBackfill } from "@/lib/embeddings-backfill.server";

/* Camada fina de RPC: toda a lógica vive em embeddings-backfill.server.ts */

const backfillInput = z.object({ mode: z.enum(["dry-run", "commit"]) });

export const runEmbeddingsBackfill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => backfillInput.parse(data))
  .handler(async ({ data, context }) =>
    data.mode === "dry-run"
      ? dryRunEmbeddingsBackfill(context.supabase)
      : commitEmbeddingsBackfill(context.supabase),
  );
