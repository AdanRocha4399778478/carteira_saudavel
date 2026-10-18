/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 3 (17/10/2026): leitura dos
 * indicadores de um projeto com seus pontos (embed), pro painel "antes e
 * depois". Só leitura — criar/editar/apagar indicador e ponto é feito
 * direto nos diálogos (mesmo padrão de DecisionDialog), não aqui.
 * ------------------------------------------------------------------ */

import { queryOptions } from "@tanstack/react-query";
import { logDbError } from "@/lib/api";
import { supabase } from "@/lib/supabase/client";
import type {
  IndicatorDirection,
  IndicatorKind,
  IndicatorPointBasis,
} from "@/lib/indicator-analysis";

export type IndicatorPointRow = {
  id: string;
  indicator_id: string;
  client_id: string;
  project_id: string;
  value: number;
  measured_at: string;
  basis: IndicatorPointBasis;
  source: "manual" | "reuniao";
  source_meeting_id: string | null;
  evidence: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type IndicatorRow = {
  id: string;
  client_id: string;
  project_id: string;
  name: string;
  kind: IndicatorKind;
  unit: string | null;
  direction: IndicatorDirection;
  frequency: "semanal" | "mensal" | null;
  baseline_value: number | null;
  baseline_at: string | null;
  target_value: number | null;
  created_at: string;
  updated_at: string;
  indicator_points: IndicatorPointRow[];
};

const INDICATOR_COLUMNS =
  "id, client_id, project_id, name, kind, unit, direction, frequency, baseline_value, baseline_at, target_value, created_at, updated_at, indicator_points(id, indicator_id, client_id, project_id, value, measured_at, basis, source, source_meeting_id, evidence, note, created_at, updated_at)";

export const indicatorsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["indicators", "project", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<IndicatorRow[]> => {
      const res = await supabase
        .from("indicators")
        .select(INDICATOR_COLUMNS)
        .eq("project_id", projectId)
        .order("name", { ascending: true })
        .order("measured_at", { ascending: true, foreignTable: "indicator_points" });
      if (res.error) {
        logDbError("indicators", "select-project", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as unknown as IndicatorRow[];
    },
  });
