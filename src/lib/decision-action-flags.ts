import type { SpeakerMapEntry } from "./speaker-map";
import { similarity } from "./deduplication";

/* ------------------------------------------------------------------ *
 * Sinalizações para revisão humana (nunca decide sozinho — ver
 * client-isolation-guard.ts para o mesmo precedente):
 *
 * E1) AÇÃO CONDICIONAL: ação do CLIENTE cujo texto indica opção ou
 *     condição da vontade de quem executa ("caso queira", "se preferir",
 *     "pode enviar"...). Nunca sinaliza ação do consultor.
 * E2) DECISÃO QUE REPETE AÇÃO: decisão com o mesmo conteúdo de uma ação
 *     da MESMA análise (por similaridade textual), exceto pendência
 *     condicionada ("Definir..."/"Decidir se...").
 *
 * Funções puras, sem import de servidor.
 * ------------------------------------------------------------------ */

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const CONDITIONAL_TEXT_PATTERNS = [
  /\bcaso\s+queira\b/,
  /\bse\s+quiser\b/,
  /\bcaso\s+deseje\b/,
  /\bse\s+desejar\b/,
  /\bcaso\s+prefira\b/,
  /\bse\s+preferir\b/,
  /\bse\s+decidir\b/,
  /\bcaso\s+decida\b/,
  /\bse\s+topar\b/,
  /\bpode(m)?\s+(antecipar|adiantar|enviar|mandar|trazer|preparar)\b/,
];

/** Só o critério de TEXTO do E1 (independe de quem é o responsável). */
export function isConditionalActionText(description: string): boolean {
  const norm = normalize(description);
  return CONDITIONAL_TEXT_PATTERNS.some((p) => p.test(norm));
}

const CLIENT_TEXT_PREFIX = /^(cliente|a\s+cliente|o\s+cliente)\b/;

/** true quando a própria descrição já identifica o cliente como executor. */
function startsWithClientSubject(description: string): boolean {
  return CLIENT_TEXT_PREFIX.test(normalize(description).trim());
}

/** true quando o responsável (já resolvido pelo speaker_map) tem role "cliente". */
function isOwnerResolvedToClientRole(
  ownerName: string | null,
  speakerMap: SpeakerMapEntry[],
): boolean {
  const name = ownerName?.trim();
  if (!name) return false;
  const normOwner = normalize(name);
  return speakerMap.some(
    (entry) => entry.role === "cliente" && normalize(entry.name.trim()) === normOwner,
  );
}

/**
 * E1 completo: só sinaliza ação do CLIENTE (texto começando por
 * "Cliente"/"A cliente"/"O cliente" OU responsável resolvido para o papel
 * cliente no speaker_map) cujo texto bate em algum padrão condicional.
 * Nunca sinaliza ação do consultor.
 */
export function isConditionalClientAction(
  description: string,
  ownerName: string | null,
  speakerMap: SpeakerMapEntry[] = [],
): boolean {
  if (!isConditionalActionText(description)) return false;
  return startsWithClientSubject(description) || isOwnerResolvedToClientRole(ownerName, speakerMap);
}

const EXCLUDED_DECISION_TITLE_PREFIXES = [/^definir\b/, /^decidir\s+se\b/];

/**
 * calibrado com casos reais em que a similaridade textual entre decisão e
 * ação repetida ficou entre 0,37 e 0,67, e entre decisões e ações sem
 * relação, até 0,20; valor provisório.
 */
export const REPEATED_ACTION_THRESHOLD = 0.3;

/**
 * E2: decisão que repete o conteúdo de alguma ação da MESMA análise. Usa
 * REPEATED_ACTION_THRESHOLD (próprio, calibrado com casos reais) — NUNCA
 * DEDUPE_THRESHOLDS.review, que é do sistema antiduplicidade entre
 * reuniões, não entre decisão e ação da mesma análise. Exclui pendência
 * condicionada ("Definir...", "Decidir se..." — decisão e ação têm
 * conteúdos diferentes nesse caso). Devolve o texto da ação repetida, ou
 * null se não encontrar.
 */
export function findRepeatedActionForDecision(
  decisionTitle: string,
  decisionDescription: string | null,
  actionDescriptions: string[],
  threshold: number = REPEATED_ACTION_THRESHOLD,
): string | null {
  const normTitle = normalize(decisionTitle.trim());
  if (EXCLUDED_DECISION_TITLE_PREFIXES.some((p) => p.test(normTitle))) return null;

  const decisionText = [decisionTitle, decisionDescription ?? ""].filter(Boolean).join(" ").trim();
  if (!decisionText) return null;

  let best: { text: string; score: number } | null = null;
  for (const actionText of actionDescriptions) {
    if (!actionText.trim()) continue;
    const score = similarity(decisionText, actionText);
    if (score >= threshold && (!best || score > best.score)) best = { text: actionText, score };
  }
  return best ? best.text : null;
}
