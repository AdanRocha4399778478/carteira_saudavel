/**
 * Impressão digital da transcrição.
 *
 * Serve para detectar reenvio do MESMO conteúdo (mesma reunião processada duas
 * vezes) antes de gravar uma nova reunião. O hash é calculado sobre o texto
 * normalizado, então diferenças de espaçamento, acentuação de quebras de linha
 * ou caixa não geram falsos negativos.
 */

function canonical(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** SHA-256 hex do conteúdo canônico da transcrição. */
export async function transcriptHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Chave única de processamento gravada na reunião.
 *
 * - normal: é o próprio hash — reenviar a mesma transcrição reaproveita a
 *   reunião já criada em vez de duplicar;
 * - forçado: o consultor confirmou que é outra reunião com conteúdo idêntico,
 *   então a chave ganha um sufixo aleatório (o hash continua gravado e
 *   rastreável).
 */
export function transcriptKey(hash: string, force: boolean): string {
  return force ? `${hash}:${crypto.randomUUID()}` : hash;
}
