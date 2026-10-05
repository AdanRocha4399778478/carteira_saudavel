import { daysSince, isDecisionOverdue } from "@/lib/domain";
import type { Decision } from "@/lib/projects";

/* ------------------------------------------------------------------ *
 * Painel "Decisões atrasadas" da Visão geral: cruza decisões (cockpit)
 * com as linhas de projeto de useProjectsHealth. O cliente de cada
 * decisão vem do projeto (project_id obrigatório), nunca de
 * decision.client_id, que pode ser nulo.
 * ------------------------------------------------------------------ */

const PROJETO_ENCERRADO_STATUSES = new Set(["concluido", "cancelado"]);
const MAX_ROWS = 10;

export type OverdueDecisionProjectRow = {
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  status: string;
};

export type OverdueDecisionRow = {
  decisionId: string;
  title: string;
  owner: string;
  clientName: string;
  projectId: string;
  projectName: string;
  daysOverdue: number;
  dueDate: string;
};

export type OverdueDecisionsResult = {
  total: number;
  linhas: OverdueDecisionRow[];
  descartadas: number;
  excluidasPorProjetoEncerrado: number;
};

export function getOverdueDecisions(
  decisions: Decision[],
  projectRows: OverdueDecisionProjectRow[],
  filteredIds: Set<string>,
): OverdueDecisionsResult {
  const projectsById = new Map(projectRows.map((p) => [p.projectId, p]));

  let descartadas = 0;
  let excluidasPorProjetoEncerrado = 0;
  const candidates: OverdueDecisionRow[] = [];

  for (const decision of decisions) {
    if (!isDecisionOverdue(decision)) continue;

    const project = projectsById.get(decision.project_id);
    if (!project) {
      descartadas += 1;
      continue;
    }

    if (PROJETO_ENCERRADO_STATUSES.has(project.status)) {
      excluidasPorProjetoEncerrado += 1;
      continue;
    }

    if (!filteredIds.has(project.clientId)) continue;

    candidates.push({
      decisionId: decision.id,
      title: decision.title,
      owner: decision.owner && decision.owner.trim() ? decision.owner : "Sem responsável",
      clientName: project.clientName,
      projectId: project.projectId,
      projectName: project.projectName,
      daysOverdue: daysSince(decision.due_date) ?? 0,
      dueDate: decision.due_date!,
    });
  }

  candidates.sort(
    (a, b) =>
      b.daysOverdue - a.daysOverdue ||
      a.clientName.localeCompare(b.clientName) ||
      a.title.localeCompare(b.title),
  );

  return {
    total: candidates.length,
    linhas: candidates.slice(0, MAX_ROWS),
    descartadas,
    excluidasPorProjetoEncerrado,
  };
}
