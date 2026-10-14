/* ------------------------------------------------------------------ *
 * Status inicial de uma decisão NOVA criada na aprovação de reunião.
 * Convenção do prompt da IA: título começando com "Definir" ou "Decidir
 * se" é decisão ainda a definir, não algo já acordado — fica "pendente".
 * Qualquer outro caso (incluindo título vazio) entra "aprovada".
 *
 * Literais em vez de importar DecisionStatus/DECISION_STATUSES de
 * projects.ts: não há ciclo de importação real (projects.ts não
 * importa meeting-analysis.ts nem este arquivo), mas os dois valores
 * usados aqui já foram confirmados como existentes em projects.ts.
 * ------------------------------------------------------------------ */

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const PENDING_TITLE_PREFIX_RE = /^(definir|decidir se)\b/;

export function initialDecisionStatus(title: string): "pendente" | "aprovada" {
  const trimmed = title.trim();
  if (!trimmed) return "pendente";
  return PENDING_TITLE_PREFIX_RE.test(normalize(trimmed)) ? "pendente" : "aprovada";
}
