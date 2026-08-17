import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { logDbError, profilesQuery, type PublicProfile } from "@/lib/api";
import { consultantDisplayName } from "@/lib/consultants";
import { isOverdue, type ActionItem, type Client } from "@/lib/domain";
import { MAX_QUERY_RETRIES } from "@/lib/query-errors";
import { supabase } from "@/lib/supabase/client";

type ClientListAction = Pick<ActionItem, "client_id" | "status" | "deadline">;
type ClientListClient = Pick<
  Client,
  | "id"
  | "company_name"
  | "segment"
  | "consultant_id"
  | "account_status"
  | "current_satisfaction"
  | "current_value_score"
  | "current_risk_score"
  | "current_risk_level"
  | "current_quadrant"
  | "last_meeting_date"
>;

const CLIENT_LIST_COLUMNS =
  "id, company_name, segment, consultant_id, account_status, current_satisfaction, current_value_score, current_risk_score, current_risk_level, current_quadrant, last_meeting_date";
const SLOW_QUERY_MS = 10_000;
const EMPTY_ACTIONS: ClientListAction[] = [];
const EMPTY_CLIENTS: ClientListClient[] = [];
const EMPTY_PROFILES: PublicProfile[] = [];

function clientsListQuery() {
  return {
    queryKey: ["clients", "clients-list"],
    queryFn: async (): Promise<ClientListClient[]> => {
      const res = await supabase
        .from("clients")
        .select(CLIENT_LIST_COLUMNS)
        .order("company_name");
      if (res.error) {
        logDbError("clients", "select-clients-list", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as ClientListClient[];
    },
  };
}

function clientsListActionsQuery() {
  return {
    queryKey: ["actions", "clients-list"],
    queryFn: async (): Promise<ClientListAction[]> => {
      const res = await supabase
        .from("actions")
        .select("client_id, status, deadline");
      if (res.error) {
        logDbError("actions", "select-clients-list", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as ClientListAction[];
    },
  };
}

/**
 * Dados exclusivos da listagem de clientes. Clientes e ações chegam apenas
 * com os campos consumidos pela tabela, filtros, ordenação e indicadores.
 */
export function useClientsListData() {
  const results = useQueries({
    queries: [clientsListQuery(), clientsListActionsQuery(), profilesQuery()],
  });

  const [clientsResult, actionsResult, profilesResult] = results;
  const clients = (clientsResult?.data as ClientListClient[] | undefined) ?? EMPTY_CLIENTS;
  const actions = (actionsResult?.data as ClientListAction[] | undefined) ?? EMPTY_ACTIONS;
  const profiles = (profilesResult?.data as PublicProfile[] | undefined) ?? EMPTY_PROFILES;

  const isLoading = results.some((r) => r.isLoading && r.data === undefined);
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

  const openActionsByClient = useMemo(() => {
    const map = new Map<string, ClientListAction[]>();
    for (const action of actions) {
      if (action.status === "concluída") continue;
      const list = map.get(action.client_id) ?? [];
      list.push(action);
      map.set(action.client_id, list);
    }
    return map;
  }, [actions]);

  const overdueByClient = useMemo(() => {
    const map = new Map<string, number>();
    for (const action of actions) {
      if (!isOverdue(action)) continue;
      map.set(action.client_id, (map.get(action.client_id) ?? 0) + 1);
    }
    return map;
  }, [actions]);

  return {
    clients,
    profiles,
    isLoading,
    isSlow,
    error,
    refetchAll,
    consultantName,
    openActionsByClient,
    overdueByClient,
  };
}
