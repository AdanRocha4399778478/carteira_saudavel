/* ------------------------------------------------------------------ *
 * GATE 8B — backfill controlado de embeddings históricos.
 *
 * Helpers puros (sem Supabase/OpenAI/fetch) usados por
 * `embeddings-backfill.server.ts` para decidir elegibilidade, mapear o
 * texto-fonte de cada tabela e agregar resultados — extraídos aqui para
 * serem testáveis sem tocar o banco, seguindo o mesmo padrão de
 * `review-blocks.ts` e `meeting-undo.shared.ts`.
 * ------------------------------------------------------------------ */

export const BACKFILL_TABLES = ["actions", "risks", "decisions", "opportunities"] as const;
export type BackfillTable = (typeof BACKFILL_TABLES)[number];

export function isBackfillTable(value: string): value is BackfillTable {
  return (BACKFILL_TABLES as readonly string[]).includes(value);
}

/**
 * Mesmo campo usado por `intelligent-meeting.server.ts` ao gerar o embedding
 * de um item novo (`embeddingTexts` em `runIntelligentMeetingAnalysis`):
 * decisions usa `title`; actions/risks/opportunities usam `description`.
 * Nunca inventar outro campo/combinação aqui.
 */
export function textFieldFor(table: BackfillTable): "title" | "description" {
  return table === "decisions" ? "title" : "description";
}

export type BackfillCandidate = { id: string; text: string };

/** Separa registros com texto-fonte utilizável dos que ficariam vazios/whitespace. */
export function buildEligibleCandidates(
  table: BackfillTable,
  rows: Record<string, unknown>[],
): { candidates: BackfillCandidate[]; invalidCount: number } {
  const field = textFieldFor(table);
  const candidates: BackfillCandidate[] = [];
  let invalidCount = 0;
  for (const row of rows) {
    const id = typeof row["id"] === "string" ? row["id"] : "";
    const text = String(row[field] ?? "").trim();
    if (!id || !text) {
      invalidCount++;
      continue;
    }
    candidates.push({ id, text });
  }
  return { candidates, invalidCount };
}

export function chunkCandidates<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) return items.length ? [items] : [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export type TableSummary = {
  eligible: number;
  invalidText: number;
  batches: number;
};

export function summarizeTable(
  candidates: BackfillCandidate[],
  invalidCount: number,
  batchSize: number,
): TableSummary {
  return {
    eligible: candidates.length,
    invalidText: invalidCount,
    batches: candidates.length === 0 ? 0 : Math.ceil(candidates.length / batchSize),
  };
}

export type DryRunReport = {
  mode: "dry-run";
  tables: Record<BackfillTable, TableSummary>;
  total_eligible: number;
  writes: 0;
};

export function buildDryRunReport(perTable: Record<BackfillTable, TableSummary>): DryRunReport {
  const total_eligible = BACKFILL_TABLES.reduce((sum, t) => sum + perTable[t].eligible, 0);
  return { mode: "dry-run", tables: perTable, total_eligible, writes: 0 };
}

export type CommitTableResult = {
  eligible: number;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

export function emptyCommitResult(): CommitTableResult {
  return { eligible: 0, processed: 0, updated: 0, skipped: 0, errors: 0 };
}

export function sumCommitResults(results: CommitTableResult[]): CommitTableResult {
  return results.reduce((acc, r) => ({
    eligible: acc.eligible + r.eligible,
    processed: acc.processed + r.processed,
    updated: acc.updated + r.updated,
    skipped: acc.skipped + r.skipped,
    errors: acc.errors + r.errors,
  }), emptyCommitResult());
}

export type CommitReport = {
  mode: "commit";
  tables: Record<BackfillTable, CommitTableResult>;
  totals: CommitTableResult;
};
