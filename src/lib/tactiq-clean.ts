/* ------------------------------------------------------------------ *
 * Limpeza do recorte exportado pelo Tactiq ANTES de enviar à IA.
 * Funções puras — não tocam no texto gravado em `meetings` nem no hash.
 * ------------------------------------------------------------------ */

const SUMMARY_TITLE = "General - Summary and Action items";
const TRANSCRIPT_TITLE = "Transcript";
const TIME_LINE_RE = /^\d{1,2}:\d{2}(:\d{2})?\s/;

/**
 * Remove o bloco de resumo/itens de ação que o Tactiq insere entre o
 * cabeçalho da reunião e a transcrição literal, quando os dois marcadores
 * exatos existem. Sem os dois marcadores, devolve o texto idêntico.
 */
export function stripTactiqSummary(text: string): string {
  const lines = text.split("\n");

  const summaryIdx = lines.findIndex((line) => line.trim() === SUMMARY_TITLE);
  if (summaryIdx === -1) return text;

  let transcriptIdx = -1;
  for (let i = summaryIdx + 1; i < lines.length; i++) {
    if (lines[i]!.trim() !== TRANSCRIPT_TITLE) continue;
    const next = lines[i + 1];
    if (next !== undefined && TIME_LINE_RE.test(next.trim())) {
      transcriptIdx = i;
      break;
    }
  }
  if (transcriptIdx === -1) return text;

  return [...lines.slice(0, summaryIdx), ...lines.slice(transcriptIdx)].join("\n");
}
