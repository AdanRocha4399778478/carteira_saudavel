import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { logDbError } from "@/lib/api";
import { DEFAULT_HOURLY_RATE_CENTS, type TimeEntry } from "@/lib/domain";

const TIME_ENTRY_COLUMNS =
  "id, client_id, project_id, consultant_id, erp_area, erp_subarea, description, started_at, ended_at, hourly_rate_cents, duration_seconds, amount_cents, created_at, updated_at";

/** Cronômetro em aberto do consultor logado (no máximo um, por regra do banco). */
export const runningTimerQuery = (consultantId: string | undefined) =>
  queryOptions({
    queryKey: ["time-entries", "running", consultantId],
    enabled: !!consultantId,
    queryFn: async (): Promise<TimeEntry | null> => {
      const res = await supabase
        .from("time_entries")
        .select(TIME_ENTRY_COLUMNS)
        .eq("consultant_id", consultantId as string)
        .is("ended_at", null)
        .maybeSingle();
      if (res.error) {
        logDbError("time_entries", "running", res.error);
        throw new Error(res.error.message);
      }
      return (res.data as TimeEntry | null) ?? null;
    },
  });

/** Apontamentos de um cliente, mais recentes primeiro — para o histórico na tela do cliente. */
export const clientTimeEntriesQuery = (clientId: string) =>
  queryOptions({
    queryKey: ["time-entries", "client", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<TimeEntry[]> => {
      const res = await supabase
        .from("time_entries")
        .select(TIME_ENTRY_COLUMNS)
        .eq("client_id", clientId)
        .order("started_at", { ascending: false })
        .limit(200);
      if (res.error) {
        logDbError("time_entries", "by-client", res.error);
        throw new Error(res.error.message);
      }
      return (res.data as TimeEntry[]) ?? [];
    },
  });

/** Inicia um cronômetro. Falha com mensagem clara se já existir um rodando (regra do banco). */
export async function startTimer(params: {
  clientId: string;
  projectId?: string | null;
  consultantId: string;
  erpArea: string;
  erpSubarea?: string | null;
  description?: string | null;
  hourlyRateCents?: number;
}): Promise<TimeEntry> {
  const insert = await supabase
    .from("time_entries")
    .insert({
      client_id: params.clientId,
      project_id: params.projectId ?? null,
      consultant_id: params.consultantId,
      erp_area: params.erpArea,
      erp_subarea: params.erpSubarea ?? null,
      description: params.description ?? null,
      hourly_rate_cents: params.hourlyRateCents ?? DEFAULT_HOURLY_RATE_CENTS,
    })
    .select(TIME_ENTRY_COLUMNS)
    .single();

  if (insert.error) {
    // Índice único (um cronômetro por consultor) — mensagem amigável em vez do erro cru do Postgres.
    if (insert.error.code === "23505") {
      throw new Error("Já existe um cronômetro rodando. Pare o atual antes de iniciar outro.");
    }
    logDbError("time_entries", "start", insert.error);
    throw new Error(insert.error.message);
  }
  return insert.data as TimeEntry;
}

/** Para um cronômetro, calculando duração e valor a partir da tarifa travada no início. */
export async function stopTimer(params: { id: string; description?: string | null }): Promise<TimeEntry> {
  const current = await supabase
    .from("time_entries")
    .select("started_at, hourly_rate_cents")
    .eq("id", params.id)
    .single();
  if (current.error) {
    logDbError("time_entries", "stop-fetch", current.error);
    throw new Error(current.error.message);
  }

  const startedAt = new Date(current.data.started_at as string).getTime();
  const endedAt = Date.now();
  const durationSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  const amountCents = Math.round((durationSeconds / 3600) * (current.data.hourly_rate_cents as number));

  const patch: Record<string, unknown> = {
    ended_at: new Date(endedAt).toISOString(),
    duration_seconds: durationSeconds,
    amount_cents: amountCents,
  };
  if (params.description !== undefined) patch["description"] = params.description;

  const update = await supabase
    .from("time_entries")
    .update(patch as never)
    .eq("id", params.id)
    .select(TIME_ENTRY_COLUMNS)
    .single();
  if (update.error) {
    logDbError("time_entries", "stop", update.error);
    throw new Error(update.error.message);
  }
  return update.data as TimeEntry;
}

/** Resumo do mês corrente por cliente: total de horas e valor gerado (R$). */
export const monthlyHoursSummaryQuery = () =>
  queryOptions({
    queryKey: ["time-entries", "monthly-summary"],
    queryFn: async (): Promise<{ client_id: string; seconds: number; amount_cents: number }[]> => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const res = await supabase
        .from("time_entries")
        .select("client_id, duration_seconds, amount_cents")
        .gte("started_at", monthStart)
        .not("ended_at", "is", null);
      if (res.error) {
        logDbError("time_entries", "monthly-summary", res.error);
        throw new Error(res.error.message);
      }
      const totals = new Map<string, { seconds: number; amount_cents: number }>();
      for (const row of res.data ?? []) {
        const key = row.client_id as string;
        const prev = totals.get(key) ?? { seconds: 0, amount_cents: 0 };
        prev.seconds += (row.duration_seconds as number | null) ?? 0;
        prev.amount_cents += (row.amount_cents as number | null) ?? 0;
        totals.set(key, prev);
      }
      return Array.from(totals.entries()).map(([client_id, v]) => ({ client_id, ...v }));
    },
  });

/** Formata segundos como "Xh Ymin" para exibição. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}min`;
  return `${h}h ${m}min`;
}

/** Formata centavos como "R$ X,XX". */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
