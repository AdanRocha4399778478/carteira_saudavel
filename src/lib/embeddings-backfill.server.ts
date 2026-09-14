import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbeddings } from "@/lib/embeddings.server";
import {
  BACKFILL_TABLES,
  buildDryRunReport,
  buildEligibleCandidates,
  chunkCandidates,
  emptyCommitResult,
  summarizeTable,
  sumCommitResults,
  textFieldFor,
  type BackfillTable,
  type CommitReport,
  type CommitTableResult,
  type DryRunReport,
} from "@/lib/embeddings-backfill";

/* ------------------------------------------------------------------ *
 * GATE 8B — backfill controlado de embeddings históricos.
 *
 * Preenche `embedding` em registros de actions/risks/decisions/opportunities
 * que ainda não têm (embedding IS NULL), reaproveitando `getEmbeddings`
 * (embeddings.server.ts, inalterado) e o mesmo texto-fonte usado por
 * `intelligent-meeting.server.ts` ao gerar embeddings novos.
 *
 * Autenticação/autorização: reaproveita `requireSupabaseAuth` (contexto do
 * chamador, sem service role) + o RPC `is_admin()` já existente no banco
 * (mesma função usada pela UI em src/lib/auth/access.ts, só que aqui
 * verificada no servidor). Nenhum novo mecanismo de permissão foi criado.
 *
 * Nunca sobrescreve: todo UPDATE é condicionado a `embedding IS NULL` tanto
 * na leitura quanto (de novo) no próprio WHERE do UPDATE — uma segunda
 * execução concorrente sobre o mesmo registro não sobrescreve um embedding
 * já gravado por outra execução, e não sobrescreve nenhum outro campo.
 * ------------------------------------------------------------------ */

const COMMIT_BATCH = 96; // mesmo MAX_BATCH prático de embeddings.server.ts.

async function requireAdmin(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) throw new Error("Não foi possível verificar permissão de administrador.");
  if (data !== true) throw new Error("Apenas administradores podem executar o backfill de embeddings.");
}

async function fetchEligible(supabase: SupabaseClient, table: BackfillTable) {
  const field = textFieldFor(table);
  const { data, error } = await supabase.from(table).select(`id, ${field}`).is("embedding", null);
  if (error) throw new Error(error.message);
  return buildEligibleCandidates(table, (data ?? []) as Record<string, unknown>[]);
}

/** DRY-RUN: só leitura. Nunca faz UPDATE. */
export async function dryRunEmbeddingsBackfill(supabase: SupabaseClient): Promise<DryRunReport> {
  await requireAdmin(supabase);
  const perTable = {} as Record<BackfillTable, ReturnType<typeof summarizeTable>>;
  for (const table of BACKFILL_TABLES) {
    const { candidates, invalidCount } = await fetchEligible(supabase, table);
    perTable[table] = summarizeTable(candidates, invalidCount, COMMIT_BATCH);
  }
  return buildDryRunReport(perTable);
}

async function backfillTable(supabase: SupabaseClient, table: BackfillTable): Promise<CommitTableResult> {
  const { candidates } = await fetchEligible(supabase, table);
  const result = emptyCommitResult();
  result.eligible = candidates.length;

  for (const batch of chunkCandidates(candidates, COMMIT_BATCH)) {
    const vectors = await getEmbeddings(batch.map((c) => c.text));
    for (let i = 0; i < batch.length; i++) {
      const candidate = batch[i];
      if (!candidate) continue;
      result.processed++;
      const vector = vectors[i];
      if (!vector) {
        // Falha ao calcular o embedding deste item (API/timeout/rede): registra
        // erro e segue para o próximo — nunca aborta o backfill inteiro.
        result.errors++;
        continue;
      }
      try {
        const { data, error } = await supabase
          .from(table)
          .update({ embedding: vector } as never)
          .eq("id", candidate.id)
          .is("embedding", null) // guarda contra sobrescrever um embedding gravado nesse meio-tempo.
          .select("id");
        if (error) {
          result.errors++;
          continue;
        }
        if (!data || data.length === 0) {
          // Outra execução já preencheu este registro entre a leitura e o update.
          result.skipped++;
          continue;
        }
        result.updated++;
      } catch {
        result.errors++;
      }
    }
  }
  return result;
}

/** COMMIT: processa somente embedding IS NULL, idempotente, nunca sobrescreve. */
export async function commitEmbeddingsBackfill(supabase: SupabaseClient): Promise<CommitReport> {
  await requireAdmin(supabase);
  const tables = {} as Record<BackfillTable, CommitTableResult>;
  for (const table of BACKFILL_TABLES) {
    tables[table] = await backfillTable(supabase, table);
  }
  return { mode: "commit", tables, totals: sumCommitResults(Object.values(tables)) };
}
