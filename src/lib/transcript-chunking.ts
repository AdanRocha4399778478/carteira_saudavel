/* ------------------------------------------------------------------ *
 * Processamento textual da transcrição para a camada de IA.
 * A divisão em blocos vive aqui — nunca no componente React.
 * Hoje transcrições dentro do limite são analisadas em bloco único;
 * a estrutura já permite analisar blocos e consolidar no futuro.
 * ------------------------------------------------------------------ */

export const MAX_BLOCK_CHARS = 60000;

export type TranscriptBlock = { index: number; total: number; text: string };

/** Divide em blocos respeitando parágrafos. */
export function splitTranscript(text: string, maxChars = MAX_BLOCK_CHARS): TranscriptBlock[] {
  const clean = text.trim();
  if (clean.length <= maxChars) return [{ index: 1, total: 1, text: clean }];

  const paragraphs = clean.split(/\n{2,}/);
  const blocks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > maxChars) {
      blocks.push(current);
      current = "";
    }
    if (p.length > maxChars) {
      for (let i = 0; i < p.length; i += maxChars) blocks.push(p.slice(i, i + maxChars));
      continue;
    }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current) blocks.push(current);

  return blocks.map((text, i) => ({ index: i + 1, total: blocks.length, text }));
}

/**
 * Texto efetivamente enviado à IA nesta etapa.
 * Bloco único quando cabe no limite; caso contrário, o primeiro bloco é
 * analisado e os demais ficam sinalizados para consolidação futura.
 */
export function prepareTranscriptForAnalysis(text: string): {
  prompt: string;
  blocks: TranscriptBlock[];
  partial: boolean;
} {
  const blocks = splitTranscript(text);
  const first = blocks[0]!;
  return {
    prompt: first.text,
    blocks,
    partial: blocks.length > 1,
  };
}
