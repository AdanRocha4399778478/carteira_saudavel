import { useQueries } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MAX_QUERY_RETRIES } from "@/lib/query-errors";
import { supabase } from "@/lib/supabase/client";
import {
  actionsQuery,
  clientActionsQuery,
  clientMeetingsQuery,
  clientOpportunitiesQuery,
  clientRisksQuery,
  clientsQuery,
  logDbError,
  meetingsQuery,
  opportunitiesQuery,
  profilesQuery,
  riskRulesQuery,
  risksQuery,
  type PublicProfile,
} from "@/lib/api";
import {
  isOverdue,
  type ActionItem,
  type Client,
  type Meeting,
  type OpportunityItem,
  type RiskItem,
  type RiskRule,
} from "@/lib/domain";
import { consultantDisplayName } from "@/lib/consultants";

type TableKey =
  "clients" | "meetings" | "actions" | "profiles" | "risks" | "opportunities" | "risk_rules";

const QUERY_BY_TABLE = {
  clients: clientsQuery,
  meetings: meetingsQuery,
  actions: actionsQuery,
  profiles: profilesQuery,
  risks: risksQuery,
  opportunities: opportunitiesQuery,
  risk_rules: riskRulesQuery,
} as const;

const SLOW_QUERY_MS = 10_000;

const EMPTY: never[] = [];

/**
 * Base compartilhada: cada página declara apenas as tabelas que consome,
 * de modo que uma falha em uma tabela não usada não bloqueie a tela.
 */
function useCarteiraData(tables: readonly TableKey[]) {
  const results = useQueries({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queries: tables.map((t) => QUERY_BY_TABLE[t]() as any),
  });

  const byTable = new Map<TableKey, (typeof results)[number]>();
  tables.forEach((t, i) => byTable.set(t, results[i]!));

  // EMPTY é uma referência estável: um `[]` novo a cada render quebraria
  // dependências de useEffect/useMemo nas páginas.
  const get = <T>(t: TableKey): T[] => (byTable.get(t)?.data as T[] | undefined) ?? (EMPTY as T[]);

  const clients = get<Client>("clients");
  const meetings = get<Meeting>("meetings");
  const actions = get<ActionItem>("actions");
  const profiles = get<PublicProfile>("profiles");
  const risks = get<RiskItem>("risks");
  const opportunities = get<OpportunityItem>("opportunities");
  const riskRules = get<RiskRule>("risk_rules");

  // Loading só quando ainda não há dado algum em cache (evita tela vazia
  // durante refetch em segundo plano).
  const isLoading = results.some((r) => r.isLoading && r.data === undefined);
  const isRefreshing = results.some((r) => r.isFetching) && !isLoading;
  // Uma falha em refetch com cache disponível não derruba a tela: só
  // consideramos erro quando não há dados para exibir. `failureReason` cobre o
  // caso em que a consulta ainda está entre tentativas: sem isso a tela ficaria
  // presa em "carregando" enquanto o banco estiver indisponível.
  const failed = results.find(
    (r) =>
      r.data === undefined && (r.error || (r.failureCount >= MAX_QUERY_RETRIES && r.failureReason)),
  );
  const liveError = (failed?.error ?? failed?.failureReason ?? null) as Error | null;

  // Trava a última falha conhecida: tentativas seguintes recolocam a consulta em
  // "pending" e, sem essa trava, a tela voltaria ao skeleton indefinidamente.
  const [latchedError, setLatchedError] = useState<Error | null>(null);
  const hasData = results.some((r) => r.data !== undefined);
  useEffect(() => {
    if (liveError) setLatchedError(liveError);
    else if (hasData) setLatchedError(null);
  }, [liveError, hasData]);

  const error = liveError ?? latchedError;
  const refetchAll = () => {
    setLatchedError(null);
    results.forEach((r) => void r.refetch());
  };

  // Aviso visual de conexão lenta (> 10s) sem esconder o botão de retentativa.
  const [isSlow, setIsSlow] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setIsSlow(false);
      return;
    }
    const timer = setTimeout(() => setIsSlow(true), SLOW_QUERY_MS);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const consultantName = useMemo(() => {
    const map = new Map(profiles.map((p) => [p.id, consultantDisplayName(p)]));
    return (id: string | null) => (id ? (map.get(id) ?? "Não atribuído") : "Não atribuído");
  }, [profiles]);

  const clientName = useMemo(() => {
    const map = new Map(clients.map((c) => [c.id, c.company_name]));
    return (id: string | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [clients]);

  const openActionsByClient = useMemo(() => {
    const map = new Map<string, ActionItem[]>();
    for (const a of actions) {
      if (a.status === "concluída") continue;
      const list = map.get(a.client_id) ?? [];
      list.push(a);
      map.set(a.client_id, list);
    }
    return map;
  }, [actions]);

  const overdueByClient = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of actions) {
      if (!isOverdue(a)) continue;
      map.set(a.client_id, (map.get(a.client_id) ?? 0) + 1);
    }
    return map;
  }, [actions]);

  const nextActionByClient = useMemo(() => {
    const map = new Map<string, ActionItem>();
    for (const a of [...actions].sort((x, y) =>
      (x.deadline ?? "9999").localeCompare(y.deadline ?? "9999"),
    )) {
      if (a.status === "concluída") continue;
      if (!map.has(a.client_id)) map.set(a.client_id, a);
    }
    return map;
  }, [actions]);

  return {
    clients,
    meetings,
    actions,
    profiles,
    risks,
    opportunities,
    riskRules,
    isLoading,
    isRefreshing,

    isSlow,
    error,
    refetchAll,
    consultantName,
    clientName,
    openActionsByClient,
    overdueByClient,
    nextActionByClient,
  };
}

const CLIENT_DETAIL_COLUMNS =
  "id, company_name, segment, consultant_id, start_date, account_status, current_satisfaction, current_value_score, current_risk_score, current_risk_level, current_quadrant, last_meeting_date, next_meeting_date, notes, active, created_at, updated_at";

function clientDetailQuery(clientId: string) {
  return {
    queryKey: ["clients", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<Client | null> => {
      const res = await supabase
        .from("clients")
        .select(CLIENT_DETAIL_COLUMNS)
        .eq("id", clientId)
        .maybeSingle();
      if (res.error) {
        logDbError("clients", "select-one", res.error);
        throw new Error(res.error.message);
      }
      return (res.data as Client | null) ?? null;
    },
  };
}

/**
 * Visão de um único cliente: mantém a mesma interface consumida pela página,
 * mas todas as tabelas volumosas já chegam filtradas por client_id no banco.
 */
export function useClientDetailData() {
  const params = useParams({ strict: false }) as { clientId?: string };
  const clientId = params.clientId ?? "";

  const results = useQueries({
    queries: [
      clientDetailQuery(clientId),
      clientMeetingsQuery(clientId),
      clientActionsQuery(clientId),
      clientRisksQuery(clientId),
      clientOpportunitiesQuery(clientId),
      riskRulesQuery(),
      profilesQuery(),
    ],
  });

  const [clientResult, meetingsResult, actionsResult, risksResult, opportunitiesResult, riskRulesResult, profilesResult] =
    results;

  const client = (clientResult?.data as Client | null | undefined) ?? null;
  const clients = client ? [client] : (EMPTY as Client[]);
  const meetings = (meetingsResult?.data as Meeting[] | undefined) ?? (EMPTY as Meeting[]);
  const actions = (actionsResult?.data as ActionItem[] | undefined) ?? (EMPTY as ActionItem[]);
  const risks = (risksResult?.data as RiskItem[] | undefined) ?? (EMPTY as RiskItem[]);
  const opportunities =
    (opportunitiesResult?.data as OpportunityItem[] | undefined) ?? (EMPTY as OpportunityItem[]);
  const riskRules = (riskRulesResult?.data as RiskRule[] | undefined) ?? (EMPTY as RiskRule[]);
  const profiles = (profilesResult?.data as PublicProfile[] | undefined) ?? (EMPTY as PublicProfile[]);

  const isLoading = results.some((r) => r.isLoading && r.data === undefined);
  const isRefreshing = results.some((r) => r.isFetching) && !isLoading;
  const failed = results.find(
    (r) =>
      r.data === undefined && (r.error || (r.failureCount >= MAX_QUERY_RETRIES && r.failureReason)),
  );
  const liveError = (failed?.error ?? failed?.failureReason ?? null) as Error | null;

  const [latchedError, setLatchedError] = useState<Error | null>(null);
  const hasData = results.some((r) => r.data !== undefined);
  useEffect(() => {
    if (liveError) setLatchedError(liveError);
    else if (hasData) setLatchedError(null);
  }, [liveError, hasData]);

  const error = liveError ?? latchedError;
  const refetchAll = () => {
    setLatchedError(null);
    results.forEach((r) => void r.refetch());
  };

  const [isSlow, setIsSlow] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setIsSlow(false);
      return;
    }
    const timer = setTimeout(() => setIsSlow(true), SLOW_QUERY_MS);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const consultantName = useMemo(() => {
    const map = new Map(profiles.map((p) => [p.id, consultantDisplayName(p)]));
    return (id: string | null) => (id ? (map.get(id) ?? "Não atribuído") : "Não atribuído");
  }, [profiles]);

  return {
    clients,
    meetings,
    actions,
    profiles,
    risks,
    opportunities,
    riskRules,
    isLoading,
    isRefreshing,
    isSlow,
    error,
    refetchAll,
    consultantName,
  };
}

const DASHBOARD_CLIENT_COLUMNS =
  "id, company_name, segment, consultant_id, account_status, current_satisfaction, current_value_score, current_risk_score, current_risk_level, current_quadrant, last_meeting_date, active";
const DASHBOARD_MEETING_COLUMNS =
  "client_id, meeting_date, satisfaction_score, value_score, calculated_risk_score";
const DASHBOARD_ACTION_COLUMNS = "id, client_id, description, deadline, status";
const DASHBOARD_OPPORTUNITY_COLUMNS = "client_id, status";

function dashboardClientsQuery() {
  return {
    queryKey: ["clients", "dashboard"],
    queryFn: async (): Promise<Client[]> => {
      const res = await supabase
        .from("clients")
        .select(DASHBOARD_CLIENT_COLUMNS)
        .order("company_name");
      if (res.error) {
        logDbError("clients", "select-dashboard", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as Client[];
    },
  };
}

function dashboardMeetingsQuery() {
  return {
    queryKey: ["meetings", "dashboard"],
    queryFn: async (): Promise<Meeting[]> => {
      const res = await supabase
        .from("meetings")
        .select(DASHBOARD_MEETING_COLUMNS)
        .order("meeting_date", { ascending: false });
      if (res.error) {
        logDbError("meetings", "select-dashboard", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as Meeting[];
    },
  };
}

function dashboardActionsQuery() {
  return {
    queryKey: ["actions", "dashboard", "open"],
    queryFn: async (): Promise<ActionItem[]> => {
      const res = await supabase
        .from("actions")
        .select(DASHBOARD_ACTION_COLUMNS)
        .neq("status", "concluída")
        .order("deadline", { ascending: true });
      if (res.error) {
        logDbError("actions", "select-dashboard-open", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as ActionItem[];
    },
  };
}

function dashboardOpportunitiesQuery() {
  return {
    queryKey: ["opportunities", "dashboard", "active"],
    queryFn: async (): Promise<OpportunityItem[]> => {
      const res = await supabase
        .from("opportunities")
        .select(DASHBOARD_OPPORTUNITY_COLUMNS)
        .neq("status", "descartada");
      if (res.error) {
        logDbError("opportunities", "select-dashboard-active", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as OpportunityItem[];
    },
  };
}

/**
 * Dashboard executivo: consultas próprias e enxutas evitam reutilizar os
 * carregamentos globais das telas operacionais. O histórico de reuniões ainda
 * é preservado para manter exatamente os filtros de período existentes.
 */
export function useDashboardData() {
  const results = useQueries({
    queries: [
      dashboardClientsQuery(),
      dashboardMeetingsQuery(),
      dashboardActionsQuery(),
      profilesQuery(),
      dashboardOpportunitiesQuery(),
    ],
  });

  const [clientsResult, meetingsResult, actionsResult, profilesResult, opportunitiesResult] = results;
  const clients = (clientsResult?.data as Client[] | undefined) ?? (EMPTY as Client[]);
  const meetings = (meetingsResult?.data as Meeting[] | undefined) ?? (EMPTY as Meeting[]);
  const actions = (actionsResult?.data as ActionItem[] | undefined) ?? (EMPTY as ActionItem[]);
  const profiles = (profilesResult?.data as PublicProfile[] | undefined) ?? (EMPTY as PublicProfile[]);
  const opportunities =
    (opportunitiesResult?.data as OpportunityItem[] | undefined) ?? (EMPTY as OpportunityItem[]);

  const isLoading = results.some((r) => r.isLoading && r.data === undefined);
  const isRefreshing = results.some((r) => r.isFetching) && !isLoading;
  const failed = results.find(
    (r) =>
      r.data === undefined && (r.error || (r.failureCount >= MAX_QUERY_RETRIES && r.failureReason)),
  );
  const liveError = (failed?.error ?? failed?.failureReason ?? null) as Error | null;

  const [latchedError, setLatchedError] = useState<Error | null>(null);
  const hasData = results.some((r) => r.data !== undefined);
  useEffect(() => {
    if (liveError) setLatchedError(liveError);
    else if (hasData) setLatchedError(null);
  }, [liveError, hasData]);

  const error = liveError ?? latchedError;
  const refetchAll = () => {
    setLatchedError(null);
    results.forEach((r) => void r.refetch());
  };

  const [isSlow, setIsSlow] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setIsSlow(false);
      return;
    }
    const timer = setTimeout(() => setIsSlow(true), SLOW_QUERY_MS);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const consultantName = useMemo(() => {
    const map = new Map(profiles.map((p) => [p.id, consultantDisplayName(p)]));
    return (id: string | null) => (id ? (map.get(id) ?? "Não atribuído") : "Não atribuído");
  }, [profiles]);

  const clientName = useMemo(() => {
    const map = new Map(clients.map((c) => [c.id, c.company_name]));
    return (id: string | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [clients]);

  const overdueByClient = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of actions) {
      if (!isOverdue(a)) continue;
      map.set(a.client_id, (map.get(a.client_id) ?? 0) + 1);
    }
    return map;
  }, [actions]);

  const nextActionByClient = useMemo(() => {
    const map = new Map<string, ActionItem>();
    for (const a of actions) {
      if (!map.has(a.client_id)) map.set(a.client_id, a);
    }
    return map;
  }, [actions]);

  return {
    clients,
    meetings,
    actions,
    profiles,
    opportunities,
    isLoading,
    isRefreshing,
    isSlow,
    error,
    refetchAll,
    consultantName,
    clientName,
    overdueByClient,
    nextActionByClient,
  };
}

const CLIENTS_TABLES = ["clients", "actions", "profiles"] as const;
const MEETINGS_TABLES = ["clients", "meetings", "actions", "risk_rules"] as const;
/** A listagem de reuniões é paginada no banco — aqui só os apoios da tela. */
const MEETINGS_LIST_TABLES = ["clients", "actions", "risk_rules"] as const;
const ACTIONS_TABLES = ["clients", "actions", "risk_rules"] as const;
const SETTINGS_TABLES = ["risk_rules", "profiles"] as const;

export const useClientsData = () => useCarteiraData(CLIENTS_TABLES);
export const useMeetingsData = () => useCarteiraData(MEETINGS_TABLES);
export const useMeetingsListData = () => useCarteiraData(MEETINGS_LIST_TABLES);
export const useActionsData = () => useCarteiraData(ACTIONS_TABLES);
export const useSettingsData = () => useCarteiraData(SETTINGS_TABLES);
