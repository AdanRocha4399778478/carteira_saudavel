import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { logDbError, riskRulesQuery } from "@/lib/api";
import { type ActionItem, type Client, type RiskRule } from "@/lib/domain";
import { MAX_QUERY_RETRIES } from "@/lib/query-errors";
import { supabase } from "@/lib/supabase/client";

const SLOW_QUERY_MS = 10_000;
const EMPTY_CLIENTS: Client[] = [];
const EMPTY_ACTIONS: ActionItem[] = [];
const EMPTY_RISK_RULES: RiskRule[] = [];

function meetingsClientsQuery() {
  return {
    queryKey: ["clients", "meetings-lookup"],
    queryFn: async (): Promise<Client[]> => {
      const res = await supabase
        .from("clients")
        .select("id, company_name")
        .order("company_name");
      if (res.error) {
        logDbError("clients", "select-meetings-lookup", res.error);
        throw new Error(res.error.message);
      }
      // A tela e os diálogos de reunião consomem somente id/company_name deste array.
      return (res.data ?? []) as Client[];
    },
  };
}

function meetingsActionsQuery() {
  return {
    queryKey: ["actions", "meetings-overdue-support"],
    queryFn: async (): Promise<ActionItem[]> => {
      const res = await supabase
        .from("actions")
        .select("client_id, deadline, status");
      if (res.error) {
        logDbError("actions", "select-meetings-overdue-support", res.error);
        throw new Error(res.error.message);
      }
      // Os diálogos usam apenas estes campos para contar ações vencidas por cliente.
      return (res.data ?? []) as ActionItem[];
    },
  };
}

/**
 * Apoios exclusivos da listagem de Reuniões.
 * Clientes e ações chegam com payload mínimo; regras de risco permanecem completas
 * porque participam do cálculo e do recálculo após registrar/importar reunião.
 */
export function useMeetingsListSupportData() {
  const results = useQueries({
    queries: [meetingsClientsQuery(), meetingsActionsQuery(), riskRulesQuery()],
  });

  const [clientsResult, actionsResult, riskRulesResult] = results;
  const clients = (clientsResult?.data as Client[] | undefined) ?? EMPTY_CLIENTS;
  const actions = (actionsResult?.data as ActionItem[] | undefined) ?? EMPTY_ACTIONS;
  const riskRules = (riskRulesResult?.data as RiskRule[] | undefined) ?? EMPTY_RISK_RULES;

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

  const clientName = useMemo(() => {
    const map = new Map(clients.map((client) => [client.id, client.company_name]));
    return (id: string | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [clients]);

  return {
    clients,
    actions,
    riskRules,
    isLoading,
    isSlow,
    error,
    refetchAll,
    clientName,
  };
}
