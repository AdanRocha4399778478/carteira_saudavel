import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { logDbError } from "@/lib/api";
import { enrichOrchestratorRecommendation } from "@/lib/orchestrator.functions";
import { evaluateRules, toRecommendation } from "@/lib/orchestrator/rules";
import { canonicalStateSignature, computeStateHash } from "@/lib/orchestrator/state";
import type {
  OrchestratorAgent,
  OrchestratorState,
  ProjectStage,
  Recommendation,
  StoredRecommendation,
} from "@/lib/orchestrator/types";

/* ------------------------------------------------------------------ *
 * Serviço do Orquestrador (cliente).
 *
 * Antiduplicidade: se o `state_hash` não mudou desde a última
 * recomendação viva, nada é recalculado, a IA não é chamada e nenhuma
 * linha nova é criada — a recomendação existente é devolvida.
 * ------------------------------------------------------------------ */

const TABLE = "orchestrator_recommendations";

type Row = Record<string, unknown>;
type MutableRecommendationStatus = "approved" | "rejected" | "executed" | "superseded";

function fromRow(row: Row): StoredRecommendation {
  const bottleneck = (row["main_bottleneck"] ?? {}) as Record<string, unknown>;
  const erp = (row["erp_classification"] ?? {}) as Record<string, unknown>;
  return {
    id: String(row["id"]),
    project_id: String(row["project_id"]),
    project_stage: row["project_stage"] as ProjectStage,
    main_bottleneck: {
      type: (bottleneck["type"] as StoredRecommendation["main_bottleneck"]["type"]) ?? "INDEFINIDO",
      description: String(bottleneck["description"] ?? ""),
    },
    recommended_agent: row["recommended_agent"] as OrchestratorAgent,
    confidence: Number(row["confidence"] ?? 0),
    reason: String(row["reason"] ?? ""),
    expected_result: String(row["expected_result"] ?? ""),
    evidence: Array.isArray(row["evidence"]) ? (row["evidence"] as string[]) : [],
    alternative_agent: (row["alternative_agent"] as OrchestratorAgent | null) ?? null,
    alternative_reason: (row["alternative_reason"] as string | null) ?? null,
    erp_classification: {
      area: (erp["area"] as string | null) ?? null,
      process: (erp["process"] as string | null) ?? null,
    },
    status: row["status"] as StoredRecommendation["status"],
    state_hash: String(row["state_hash"] ?? ""),
    source: (row["source"] as "rules" | "ai") ?? "rules",
    created_at: String(row["created_at"] ?? ""),
    approved_at: (row["approved_at"] as string | null) ?? null,
    approved_by: (row["approved_by"] as string | null) ?? null,
  };
}

async function updateRecommendationStatus(
  id: string,
  status: MutableRecommendationStatus,
): Promise<void> {
  const res = await supabase
    .from(TABLE as never)
    .update({ status } as never)
    .eq("id", id);

  if (res.error) {
    logDbError(TABLE, `update-status-${status}`, res.error);
    throw new Error(res.error.message);
  }
}

async function latestRecommendation(projectId: string): Promise<StoredRecommendation | null> {
  const res = await supabase
    .from(TABLE as never)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) {
    logDbError(TABLE, "select-latest", res.error);
    throw new Error(res.error.message);
  }
  return res.data ? fromRow(res.data as Row) : null;
}

/** Histórico completo do projeto — auditoria das recomendações anteriores. */
export const orchestratorHistoryQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["orchestrator", "history", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<StoredRecommendation[]> => {
      const res = await supabase
        .from(TABLE as never)
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (res.error) {
        logDbError(TABLE, "select-history", res.error);
        return [];
      }
      return ((res.data ?? []) as Row[]).map(fromRow);
    },
  });

async function buildRecommendation(state: OrchestratorState): Promise<{
  recommendation: Recommendation;
  source: "rules" | "ai";
}> {
  const outcome = evaluateRules(state);
  const base = toRecommendation(outcome);

  // IA só entra quando a regra determinística não é forte o suficiente.
  if (outcome.strong) return { recommendation: base, source: "rules" };

  try {
    const ai = await enrichOrchestratorRecommendation({
      data: {
        state: state as unknown as Record<string, unknown>,
        deterministic: {
          stage: outcome.stage,
          agent: outcome.agent,
          strong: outcome.strong,
          reason: outcome.reason,
          bottleneck: outcome.bottleneck.description,
          evidence: outcome.evidence,
        },
      },
    });
    if (!ai.used) return { recommendation: base, source: "rules" };

    return {
      source: "ai",
      recommendation: {
        ...base,
        project_stage: (ai.project_stage as ProjectStage | null) ?? base.project_stage,
        recommended_agent: (ai.recommended_agent as OrchestratorAgent | null) ?? base.recommended_agent,
        main_bottleneck: {
          ...base.main_bottleneck,
          description: ai.main_bottleneck_description ?? base.main_bottleneck.description,
        },
        reason: ai.reason ?? base.reason,
        expected_result: ai.expected_result ?? base.expected_result,
        alternative_agent: (ai.alternative_agent as OrchestratorAgent | null) ?? base.alternative_agent,
        alternative_reason: ai.alternative_reason ?? base.alternative_reason,
        erp_classification: ai.erp_classification,
        confidence: Math.min(0.8, base.confidence + 0.15),
      },
    };
  } catch {
    // Degradação graciosa: a recomendação determinística continua válida.
    return { recommendation: base, source: "rules" };
  }
}

/**
 * Recomendação viva do projeto. Recalcula apenas quando o `state_hash`
 * muda (nova reunião, saúde, riscos, ações, decisões, evolução).
 */
export async function resolveRecommendation(
  projectId: string,
  state: OrchestratorState,
): Promise<StoredRecommendation> {
  const stateHash = await computeStateHash(state);
  const latest = await latestRecommendation(projectId);

  if (
    latest &&
    latest.state_hash === stateHash &&
    (latest.status === "suggested" || latest.status === "approved" || latest.status === "executed")
  ) {
    return latest;
  }
  // Uma recomendação rejeitada para o mesmo estado não é refeita.
  if (latest && latest.state_hash === stateHash && latest.status === "rejected") return latest;

  const { recommendation, source } = await buildRecommendation(state);

  // A recomendação anterior ainda sugerida deixa de valer.
  if (latest && latest.status === "suggested") {
    try {
      await updateRecommendationStatus(latest.id, "superseded");
    } catch (error) {
      console.error("[orchestrator] supersede-status", {
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  const insert = await supabase
    .from(TABLE as never)
    .insert({
      project_id: projectId,
      project_stage: recommendation.project_stage,
      main_bottleneck: recommendation.main_bottleneck,
      recommended_agent: recommendation.recommended_agent,
      confidence: recommendation.confidence,
      reason: recommendation.reason,
      expected_result: recommendation.expected_result,
      evidence: recommendation.evidence,
      alternative_agent: recommendation.alternative_agent,
      alternative_reason: recommendation.alternative_reason,
      erp_classification: recommendation.erp_classification,
      source,
      state_hash: stateHash,
    } as never)
    .select("*")
    .single();

  if (insert.error) {
    logDbError(TABLE, "insert", insert.error);
    throw new Error(insert.error.message);
  }
  return fromRow(insert.data as Row);
}

export const orchestratorQuery = (projectId: string, state: OrchestratorState | null) =>
  queryOptions({
    queryKey: ["orchestrator", projectId, state ? canonicalStateSignature(state) : "sem-estado"],
    enabled: !!projectId && !!state,
    // Não recalcula a cada render: só quando o estado muda ou o cache é invalidado.
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => resolveRecommendation(projectId, state as OrchestratorState),
  });

/* ---------------- decisão humana ---------------- */

export async function setRecommendationStatus(
  id: string,
  status: "approved" | "rejected",
): Promise<void> {
  await updateRecommendationStatus(id, status);
}
