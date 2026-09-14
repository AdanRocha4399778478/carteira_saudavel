import { queryOptions } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";
import {
  accountStatusFromRisk,
  byMeetingDateDesc,
  computeRisk,
  daysSince,
  isOverdue,
  normalizeMeeting,
  quadrantOf,
  type ActionItem,
  type Client,
  type Meeting,
  type OpportunityItem,
  type Profile,
  type RiskItem,
  type RiskRule,
} from "./domain";


type SupabaseErrorLike = { message: string; code?: string; details?: string | null } | null;

export type PublicProfile = Pick<Profile, "id" | "full_name" | "active">;

/**
 * Registra tabela, operação e código do erro — nunca tokens ou credenciais.
 */
export function logDbError(table: string, operation: string, error: SupabaseErrorLike) {
  if (!error) return;
  console.error("[db]", { table, operation, code: error.code ?? null, message: error.message });
}

// `data` é `unknown` de propósito: colunas jsonb (ex. `embedding`) vêm
// tipadas como `Json` pelo Supabase, mais largo que o tipo de domínio
// (`number[] | null`) — o cast final para `T` já era a fonte de verdade
// aqui, isso só evita que TS rejeite o argumento antes de chegar nele.
function unwrap<T>(table: string, res: { data: unknown; error: SupabaseErrorLike }): T {
  if (res.error) {
    logDbError(table, "select", res.error);
    throw new Error(res.error.message);
  }
  return (res.data ?? []) as T;
}


export const profilesQuery = () =>
  queryOptions({
    queryKey: ["profiles"],
    queryFn: async () =>
      unwrap<PublicProfile[]>(
        "profile_directory",
        await supabase
          .from("profile_directory" as "profiles")
          .select("id, full_name, active")
          .order("full_name"),
      ),
  });

export const clientsQuery = () =>
  queryOptions({
    queryKey: ["clients"],
    queryFn: async () =>
      unwrap<Client[]>("clients",await supabase.from("clients").select("*").order("company_name")),
  });

export const clientQuery = (clientId: string) =>
  queryOptions({
    queryKey: ["clients", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const res = await supabase
        .from("clients")
        .select("id, company_name, consultant_id")
        .eq("id", clientId)
        .maybeSingle();
      if (res.error) {
        logDbError("clients", "select-one", res.error);
        throw new Error(res.error.message);
      }
      return (res.data as Pick<Client, "id" | "company_name" | "consultant_id"> | null) ?? null;
    },
  });

const MEETING_COLUMNS = "*";

export const meetingsQuery = () =>
  queryOptions({
    queryKey: ["meetings"],
    queryFn: async () =>
      unwrap<Record<string, unknown>[]>(
        "meetings",
        await supabase.from("meetings").select(MEETING_COLUMNS).order("meeting_date", { ascending: false }),
      ).map(normalizeMeeting),
  });

export type MeetingsPageParams = {
  page: number;
  pageSize: number;
  clientId: string | null;
  meetingType: string | null;
  search: string;
};

export type MeetingsPage = { rows: Meeting[]; total: number };

/**
 * Paginação e filtros aplicados no banco — a tela nunca carrega a tabela toda.
 */
export const meetingsPageQuery = (params: MeetingsPageParams) =>
  queryOptions({
    queryKey: [
      "meetings",
      "page",
      params.page,
      params.pageSize,
      params.clientId,
      params.meetingType,
      params.search,
    ],
    queryFn: async (): Promise<MeetingsPage> => {
      const from = (params.page - 1) * params.pageSize;
      let query = supabase
        .from("meetings")
        .select(MEETING_COLUMNS, { count: "exact" })
        .order("meeting_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, from + params.pageSize - 1);

      if (params.clientId) query = query.eq("client_id", params.clientId);
      if (params.meetingType) query = query.eq("meeting_type", params.meetingType);
      const term = params.search.trim();
      if (term) {
        const safe = term.replace(/[%,()]/g, " ").trim();
        if (safe)
          query = query.or(
            `executive_summary.ilike.%${safe}%,next_action.ilike.%${safe}%,main_pain.ilike.%${safe}%`,
          );
      }

      const res = await query;
      if (res.error) {
        logDbError("meetings", "select-page", res.error);
        throw new Error(res.error.message);
      }
      return {
        rows: ((res.data ?? []) as Record<string, unknown>[]).map(normalizeMeeting),
        total: res.count ?? 0,
      };
    },
  });

/** Histórico de um único cliente — usado nas prévias de risco dos diálogos. */
export const clientMeetingsQuery = (clientId: string) =>
  queryOptions({
    queryKey: ["meetings", "client", clientId],
    enabled: !!clientId,
    queryFn: async () =>
      unwrap<Record<string, unknown>[]>(
        "meetings",
        await supabase
          .from("meetings")
          .select(MEETING_COLUMNS)
          .eq("client_id", clientId)
          .order("meeting_date", { ascending: false }),
      ).map(normalizeMeeting),
  });


export const actionsQuery = () =>
  queryOptions({
    queryKey: ["actions"],
    queryFn: async () =>
      unwrap<ActionItem[]>(
        "actions",
        await supabase.from("actions").select("*").order("deadline", { ascending: true }),
      ),
  });

export const risksQuery = () =>
  queryOptions({
    queryKey: ["risks"],
    queryFn: async () =>
      unwrap<RiskItem[]>(
        "risks",
        await supabase.from("risks").select("*").order("created_at", { ascending: false }),
      ),
  });

export const opportunitiesQuery = () =>
  queryOptions({
    queryKey: ["opportunities"],
    queryFn: async () =>
      unwrap<OpportunityItem[]>(
        "opportunities",
        await supabase.from("opportunities").select("*").order("created_at", { ascending: false }),
      ),
  });

export const clientActionsQuery = (clientId: string) =>
  queryOptions({
    queryKey: ["actions", "client", clientId],
    enabled: !!clientId,
    queryFn: async () =>
      unwrap<ActionItem[]>(
        "actions",
        await supabase
          .from("actions")
          .select("id, client_id, meeting_id, description, owner_name, deadline, priority, status, erp_area, evidence, created_at, updated_at, embedding")
          .eq("client_id", clientId)
          .order("deadline", { ascending: true }),
      ),
  });

export const clientRisksQuery = (clientId: string) =>
  queryOptions({
    queryKey: ["risks", "client", clientId],
    enabled: !!clientId,
    queryFn: async () =>
      unwrap<RiskItem[]>(
        "risks",
        await supabase
          .from("risks")
          .select("id, client_id, meeting_id, description, level, active, created_at, embedding")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false }),
      ),
  });

export const clientOpportunitiesQuery = (clientId: string) =>
  queryOptions({
    queryKey: ["opportunities", "client", clientId],
    enabled: !!clientId,
    queryFn: async () =>
      unwrap<OpportunityItem[]>(
        "opportunities",
        await supabase
          .from("opportunities")
          .select("id, client_id, meeting_id, description, expected_benefit, status, created_at, embedding")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false }),
      ),
  });

export const riskRulesQuery = () =>
  queryOptions({
    queryKey: ["risk_rules"],
    queryFn: async () =>
      unwrap<RiskRule[]>("risk_rules",await supabase.from("risk_rules").select("*").order("rule_name")),
  });

export const meQuery = () =>
  queryOptions({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) return null;
      const profileRes = await supabase
        .from("profile_directory" as "profiles")
        .select("id, full_name, active")
        .eq("id", user.id)
        .maybeSingle();
      return {
        id: user.id,
        email: user.email ?? null,
        profile: (profileRes.data as PublicProfile | null) ?? null,
      };
    },
  });

export const ALL_QUERY_KEYS = [
  ["clients"],
  ["meetings"],
  ["actions"],
  ["risks"],
  ["opportunities"],
  ["risk_rules"],
  ["profiles"],
];

/**
 * Qualquer cliente Supabase compatível com o schema do projeto — o do
 * frontend (`@/lib/supabase/client`) ou o autenticado por request que o
 * middleware de servidor (`requireSupabaseAuth`) expõe no context.
 */
type SupabaseLike = SupabaseClient<Database>;

/**
 * Recalcula indicadores atuais do cliente a partir do histórico completo.
 * Nunca sobrescreve reuniões anteriores — apenas atualiza a linha do cliente.
 *
 * Aceita o cliente Supabase explicitamente para poder ser chamada tanto do
 * frontend quanto de uma server function autenticada (RLS aplicada em
 * qualquer um dos dois casos — nunca use um cliente com service role aqui).
 * Idempotente: rodar de novo com os mesmos dados produz o mesmo resultado,
 * então é seguro repetir a chamada se uma tentativa anterior falhar.
 */
export async function recalculateClientWithSupabase(
  supabaseClient: SupabaseLike,
  clientId: string,
  rules?: RiskRule[],
) {
  const meetings = unwrap<Record<string, unknown>[]>(
    "meetings",
    await supabaseClient
      .from("meetings")
      .select("*")
      .eq("client_id", clientId)
      .order("meeting_date", { ascending: false }),
  )
    .map(normalizeMeeting)
    .sort(byMeetingDateDesc);

  const actions = unwrap<ActionItem[]>(
    "actions",
    await supabaseClient.from("actions").select("*").eq("client_id", clientId),
  );

  const latest = meetings[0];
  const overdue = actions.filter((a) => isOverdue(a)).length;

  /**
   * Reuniões vindas do fluxo de IA não trazem notas nem sinais de risco
   * (o contrato de análise não os produz). Usar cegamente a última reunião
   * zeraria a saúde do cliente. Por isso os indicadores de nota/sinal vêm da
   * reunião mais recente que realmente possui avaliação; a data da última
   * reunião continua sendo a da reunião mais recente de fato.
   */
  const latestScored =
    meetings.find((m) => m.satisfaction_score !== null || m.value_score !== null) ?? null;
  const satisfaction = latestScored?.satisfaction_score ?? null;
  const valueScore = latestScored?.value_score ?? null;

  const risk = computeRisk(
    {
      satisfaction,
      valueScore,
      previousSatisfactions: meetings
        .filter((m) => m !== latestScored)
        .map((m) => m.satisfaction_score)
        .filter((n): n is number => n !== null)
        .slice(0, 2),
      hasMeasurableResult: meetings.some((m) => m.has_measurable_result),
      overdueActions: overdue,
      daysSinceLastMeeting: daysSince(latest?.meeting_date ?? null),
      explicitComplaint: latestScored?.explicit_complaint ?? false,
      continuityDoubt: latestScored?.continuity_doubt ?? false,
      lowAdherence: latestScored?.low_client_adherence ?? false,
      missingInternalOwner: latestScored?.missing_internal_owner ?? false,
    },
    rules,
  );

  const current = unwrap<Client[]>(
    "clients",
    await supabaseClient.from("clients").select("*").eq("id", clientId),
  );
  const keepEnded = current[0]?.account_status === "encerrado";

  const { error } = await supabaseClient
    .from("clients")
    .update({
      current_satisfaction: satisfaction,
      current_value_score: valueScore,
      current_risk_score: risk.score,
      current_risk_level: risk.level,
      // Sem nenhuma nota registrada não há quadrante confiável — melhor vazio
      // do que classificar a conta no pior quadrante por ausência de dado.
      current_quadrant:
        satisfaction === null && valueScore === null ? null : quadrantOf(satisfaction, valueScore),
      last_meeting_date: latest?.meeting_date ?? null,

      account_status: keepEnded ? "encerrado" : accountStatusFromRisk(risk.level),
    })
    .eq("id", clientId);
  if (error) {
    logDbError("clients", "update", error);
    throw new Error(error.message);
  }
  return risk;
}

/**
 * Atalho para o frontend: mesma lógica de `recalculateClientWithSupabase`,
 * usando o cliente Supabase do navegador. Nada aqui muda de comportamento —
 * é só a assinatura antiga preservada para não quebrar quem já chama
 * `recalculateClient(clientId, rules)`.
 */
export async function recalculateClient(clientId: string, rules?: RiskRule[]) {
  return recalculateClientWithSupabase(supabase, clientId, rules);
}

/* ---------------- importação transacional ---------------- */

export type ImportResult = {
  meeting_id: string;
  actions: number;
  risks: number;
  opportunities: number;
};

/**
 * Toda a importação (reunião + ações + riscos + oportunidades) roda em uma
 * única transação no banco: se qualquer etapa falhar, nada permanece gravado.
 */
export async function importMeetingTransaction(plan: {
  meeting: Record<string, unknown>;
  actions: Record<string, unknown>[];
  risks: Record<string, unknown>[];
  opportunities: Record<string, unknown>[];
}): Promise<ImportResult> {
  const { data, error } = await supabase.rpc("import_meeting", {
    p_meeting: plan.meeting as never,
    p_actions: plan.actions as never,
    p_risks: plan.risks as never,
    p_opportunities: plan.opportunities as never,
  });

  if (error) {
    logDbError("import_meeting", "rpc", error);
    throw new Error(error.message);
  }
  return data as unknown as ImportResult;
}

/** Detecta reunião potencialmente duplicada: mesmo cliente + data, ou mesmo conteúdo. */
export async function findSimilarMeetings(params: {
  clientId: string;
  meetingDate: string;
  importHash: string;
}): Promise<Meeting[]> {
  const res = await supabase
    .from("meetings")
    .select("*")
    .eq("client_id", params.clientId)
    .or(`meeting_date.eq.${params.meetingDate},import_hash.eq.${params.importHash}`);
  if (res.error) {
    logDbError("meetings", "select-duplicates", res.error);
    throw new Error(res.error.message);
  }
  return ((res.data ?? []) as Record<string, unknown>[]).map(normalizeMeeting);
}
