/* ------------------------------------------------------------------ *
 * REGRA B — ação/decisão CRIADA na aprovação com prazo vencido entra
 * pré-marcada como concluída. Funções puras, sem React e sem Supabase,
 * pra testar o critério de "vencida" e o mapeamento de status isolados
 * da tela. Vale só para itens com resolução "Criar novo" — quem decide
 * isso é o chamador (MeetingAnalysisDialog / applyApprovedAnalysis).
 * ------------------------------------------------------------------ */

import type { ActionStatus } from "./domain";
import { initialDecisionStatus } from "./decision-status";
import type { DecisionStatus } from "./projects";

/**
 * Prazo (string "AAAA-MM-DD", ou prefixo de datetime) estritamente anterior
 * a `todayIso` — comparação de texto, nunca `new Date(deadline)` (que leria
 * uma data-só como UTC; ver isDecisionOverdue em domain.ts). Prazo ausente
 * ou com formato inválido nunca é "vencido".
 */
export function isDeadlineBeforeToday(
  deadline: string | null | undefined,
  todayIso: string,
): boolean {
  if (!deadline) return false;
  const day = deadline.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day < todayIso;
}

/** Pré-marcação padrão de uma AÇÃO nova (resolução "Criar novo") — mesmo critério de isDeadlineBeforeToday, nomeado pelo campo que a ação usa (`deadline`). */
export function isNewActionPreMarkedCompleted(
  deadline: string | null | undefined,
  todayIso: string,
): boolean {
  return isDeadlineBeforeToday(deadline, todayIso);
}

/**
 * Pré-marcação padrão de uma DECISÃO nova (resolução "Criar novo") — mesmo
 * critério, campo `due_date`. Vale também para decisões "ainda a definir"
 * (pendentes) — a Regra B não exclui nenhuma pelo status inicial.
 *
 * Exceção (B1, 16/10/2026): decisão de avaliação (`isEvaluation` true, ex.:
 * piloto de N dias) NUNCA vem pré-marcada por prazo vencido — achado real em
 * produção, a decisão do Chammas ("Definir ao final de 60 dias...") nasceu
 * "implementada" só porque o due_date já estava vencido na aprovação,
 * escondendo o alerta de avaliação vencida. O consultor ainda pode marcar
 * "Concluída" manualmente se quiser.
 */
export function isNewDecisionPreMarkedCompleted(
  due_date: string | null | undefined,
  todayIso: string,
  isEvaluation = false,
): boolean {
  if (isEvaluation) return false;
  return isDeadlineBeforeToday(due_date, todayIso);
}

/** Status final de uma AÇÃO nova: marcada => "concluída"; senão, o padrão de hoje ("não iniciada"). */
export function resolveNewActionStatus(completed: boolean): ActionStatus {
  return completed ? "concluída" : "não iniciada";
}

/**
 * Status final de uma DECISÃO nova: marcada => "implementada"; senão, o
 * padrão de hoje (initialDecisionStatus pelo título).
 *
 * Exceção (B1, 16/10/2026): decisão de avaliação (`isEvaluation` true) nasce
 * SEMPRE "pendente" quando não marcada — nunca "aprovada" por
 * initialDecisionStatus — mesmo com prazo vencido. Só vira "implementada"
 * pela reunião posterior (fluxo de atualização, que não passa por aqui) ou
 * se o consultor marcar "Concluída" manualmente no preview.
 */
export function resolveNewDecisionStatus(
  completed: boolean,
  title: string,
  isEvaluation = false,
): DecisionStatus {
  if (isEvaluation) return completed ? "implementada" : "pendente";
  return completed ? "implementada" : initialDecisionStatus(title);
}
