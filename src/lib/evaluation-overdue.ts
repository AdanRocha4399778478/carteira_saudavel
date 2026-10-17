import { logDbError } from "@/lib/api";
import { isDecisionOverdue } from "@/lib/domain";
import { supabase } from "@/lib/supabase/client";

/* ------------------------------------------------------------------ *
 * Backlog B1 (16/10/2026): alerta de "avaliação vencida". Mesma
 * definição única de "decisão vencida" (isDecisionOverdue em
 * domain.ts) — só filtra pelas marcadas como avaliação. O alerta some
 * só quando o status muda (via isDecisionOverdue, que já exclui
 * "implementada"/"cancelada"); não depende de reunião posterior.
 * ------------------------------------------------------------------ */

/** true quando a decisão é de avaliação (ex.: piloto de N dias) e está vencida. */
export function isEvaluationOverdue(decision: {
  due_date: string | null;
  status: string;
  is_evaluation: boolean;
}): boolean {
  return decision.is_evaluation && isDecisionOverdue(decision);
}

/** Decisões de avaliação vencidas, dentre as informadas. */
export function getOverdueEvaluations<
  T extends { due_date: string | null; status: string; is_evaluation: boolean },
>(decisions: T[]): T[] {
  return decisions.filter(isEvaluationOverdue);
}

/**
 * Decisão de avaliação (já filtrada por `is_evaluation = true` na própria
 * query) com o cliente embutido via o projeto — NUNCA `decisions.client_id`,
 * que pode ser nulo (ver overdue-decisions.ts). `project` vem nulo só se o
 * projeto tiver sido apagado sem cascata (não deveria acontecer: FK é
 * `on delete cascade`).
 */
export type EvaluationDecisionRow = {
  id: string;
  status: string;
  due_date: string | null;
  project_id: string;
  project: { client_id: string | null } | null;
};

/**
 * Única consulta para o alerta "avaliação vencida" — reaproveitada pela
 * página do cliente (filtra o resultado por clientId) e pela lista de
 * clientes (agrupa por clientId). Não carrega a tabela `projects` inteira:
 * só embute `client_id` via a relação já existente (decisions.project_id ->
 * projects.id), no mesmo padrão de `items:meeting_evolution_items(*)` em
 * evolution.ts.
 */
export function evaluationDecisionsQuery() {
  return {
    queryKey: ["decisions", "evaluation-overdue"],
    queryFn: async (): Promise<EvaluationDecisionRow[]> => {
      const res = await supabase
        .from("decisions")
        .select("id, status, due_date, project_id, project:projects(client_id)")
        .eq("is_evaluation", true);
      if (res.error) {
        logDbError("decisions", "select-evaluation-overdue", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as unknown as EvaluationDecisionRow[];
    },
  };
}

/** IDs de cliente com pelo menos uma avaliação vencida, dentre as linhas informadas. */
export function overdueEvaluationClientIds(rows: EvaluationDecisionRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const clientId = row.project?.client_id;
    if (!clientId) continue;
    if (!isDecisionOverdue(row)) continue;
    ids.add(clientId);
  }
  return ids;
}
