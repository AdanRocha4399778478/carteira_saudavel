import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { actionsQuery, logDbError, riskRulesQuery } from "@/lib/api";
import { type ActionItem, type Client, type RiskRule } from "@/lib/domain";
import { MAX_QUERY_RETRIES } from "@/lib/query-errors";
import { supabase } from "@/lib/supabase/client";

type ActionClientLookup = Pick<Client, "id" | "company_name">;

const SLOW_QUERY_MS = 10_000;
const EMPTY_CLIENTS: ActionClientLookup[] = [];
const EMPTY_ACTIONS: ActionItem[] = [];
const EMPTY_RISK_RULES: RiskRule[] = [];

function actionsClientsQuery() {
  return {
    queryKey: ["clients", "actions-lookup"],
    queryFn: async (): Promise<ActionClientLookup[]> => {
      const res = await supabase
        .from("clients")
        .select("id, company_name")
        .order("company_name");
      if (res.error) {
        logDbError("clients", "select-actions-lookup", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as ActionClientLookup[];
    },
  };
}

/**
 * Dados exclusivos da tela Ações. O cadastro de clientes é usado apenas como
 * lookup de id e nome; ações e regras de risco permanecem completas porque a
 * tela edita ações e recalcula o risco do cliente após mutações.
 */
export function useActionsListData() {
  const results = useQueries({
    queries: [actionsClientsQuery(), actionsQuery(), riskRulesQuery()],
  });

  const [clientsResult, actionsResult, riskRulesResult] = results;
  const clientLookups =
    (clientsResult?.data as ActionClientLookup[] | undefined) ?? EMPTY_CLIENTS;
  // A tela e o ActionDialog consomem somente id/company_name deste array.
  // Mantemos o contrato Client[] existente para não ampliar o escopo deste PR.
  const clients = clientLookups as Client[];
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
    const map = new Map(clientLookups.map((client) => [client.id, client.company_name]));
    return (id: string | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [clientLookups]);

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
