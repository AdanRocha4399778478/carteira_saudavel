/* ------------------------------------------------------------------ *
 * Trava de isolamento de cliente — marca (nunca apaga) itens cuja
 * evidência/descrição parece citar dados de OUTRO cliente cadastrado.
 * Pura, sem import de servidor. O cliente da própria reunião nunca é
 * marcado.
 *
 * Os 5 padrões rodam sobre o texto ORIGINAL (preposição sem diferenciar
 * caixa; "X" só conta se começar com maiúscula/acentuada ou dígito —
 * evita marcar "lá no final"/"na loja ou" por pegar uma palavra comum
 * em minúscula). Nome de ferramenta nunca conta como X. Nome de outro
 * cliente cadastrado só marca como palavra inteira (não pedaço de
 * palavra) e com pelo menos 3 caracteres.
 * ------------------------------------------------------------------ */

const FOREIGN_CLIENT_PATTERNS = [
  /\bno\s+cliente\s+([^\s,.;!?]+)/,
  /\bl[aáÁ]\s+no\s+([^\s,.;!?]+)/,
  /\bna\s+empresa\s+([^\s,.;!?]+)/,
  /\bno\s+grupo\s+([^\s,.;!?]+)/,
  /\bna\s+loja\s+([^\s,.;!?]+)/,
];

const TOOL_NAMES = new Set([
  "whatsapp", "gmail", "google", "excel", "instagram", "facebook",
  "drive", "zoom", "meet", "teams", "slack", "bling", "trello", "notion", "tactiq",
]);

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function startsUpperOrDigit(word: string): boolean {
  return /^[A-ZÀ-ÖØ-Þ0-9]/.test(word);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Devolve o trecho suspeito (para exibição) ou null se o texto não sinaliza outro cliente. */
export function checkForeignClientText(
  text: string,
  currentClientName: string,
  otherClientNames: string[],
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const currentNorm = normalize(currentClientName.trim());
  // Nome do cliente atual pode ter mais de uma palavra ("Grupo Erinho") —
  // comparar por palavra evita marcar o próprio cliente.
  const currentWords = new Set(currentNorm.split(/\s+/).filter(Boolean));

  for (const pattern of FOREIGN_CLIENT_PATTERNS) {
    const re = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(trimmed))) {
      const captured = match[1]!.replace(/[.,;:!?]+$/, "");
      if (!startsUpperOrDigit(captured)) continue;
      const capturedNorm = normalize(captured);
      if (currentNorm && (capturedNorm === currentNorm || currentWords.has(capturedNorm))) continue;
      if (TOOL_NAMES.has(capturedNorm)) continue;
      return match[0]!;
    }
  }

  const normalizedFull = normalize(trimmed);
  for (const name of otherClientNames) {
    const otherNorm = normalize(name.trim());
    if (otherNorm.length < 3 || otherNorm === currentNorm) continue;
    if (new RegExp(`\\b${escapeRegExp(otherNorm)}\\b`).test(normalizedFull)) return name.trim();
  }

  return null;
}

/**
 * Aplica `checkForeignClientText` a uma lista de itens, concatenando os
 * campos relevantes de cada um. Devolve só os índices marcados (chave
 * presente = marcado), com o trecho que bateu como valor.
 */
export function flagForeignClientItems<T>(
  items: T[],
  getFields: (item: T) => string[],
  currentClientName: string,
  otherClientNames: string[],
): Record<number, string> {
  const result: Record<number, string> = {};
  items.forEach((item, i) => {
    const text = getFields(item).filter(Boolean).join(" ");
    const snippet = checkForeignClientText(text, currentClientName, otherClientNames);
    if (snippet) result[i] = snippet;
  });
  return result;
}
