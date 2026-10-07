/* ------------------------------------------------------------------ *
 * Detecção de falante único na transcrição ORIGINAL (não no texto
 * enviado à IA). Funções puras — não tocam no texto gravado nem no hash.
 * ------------------------------------------------------------------ */

// Horário (m:ss, mm:ss ou h:mm:ss) + espaço + rótulo + ".:" + espaço.
// O ".:" é obrigatório para evitar falso positivo em fala comum
// (ex.: "às 14:30 vamos fazer assim: ok" não casa, porque "assim:" não
// tem ponto antes dos dois-pontos).
const SPEAKER_LABEL_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\s+([^:\n]{1,40}?)\.:\s/g;

const MIN_FALAS_PARA_DECIDIR = 5;

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function collectLabels(text: string): string[] {
  return [...text.matchAll(SPEAKER_LABEL_RE)].map((match) => normalizeLabel(match[1]!));
}

/**
 * Quantidade de rótulos de falante DISTINTOS encontrados no texto.
 * 0 quando o formato é desconhecido (nenhum rótulo casado) — nesse caso
 * quem chama NÃO deve anular nada.
 */
export function countDistinctSpeakers(text: string): number {
  return new Set(collectLabels(text)).size;
}

/**
 * true só quando existe exatamente um rótulo distinto E ele aparece em
 * pelo menos 5 falas (evita decidir com poucos dados).
 */
export function isSingleSpeakerTranscript(text: string): boolean {
  const labels = collectLabels(text);
  if (labels.length < MIN_FALAS_PARA_DECIDIR) return false;
  return new Set(labels).size === 1;
}

/**
 * Anula satisfaction_score e value_score em analysis.meeting quando a
 * transcrição ORIGINAL (não o texto enviado à IA) tem um único falante.
 * Não lança erro e devolve o resultado inalterado quando não for falante
 * único ou quando analysis/meeting não existirem. Não muda nenhum outro
 * campo.
 */
export function applySingleSpeakerGuard(
  result: Record<string, unknown>,
  transcript: string,
): Record<string, unknown> {
  if (!isSingleSpeakerTranscript(transcript)) return result;

  const analysis = result["analysis"];
  if (analysis === null || typeof analysis !== "object" || Array.isArray(analysis)) return result;

  const meeting = (analysis as Record<string, unknown>)["meeting"];
  if (meeting === null || typeof meeting !== "object" || Array.isArray(meeting)) return result;

  return {
    ...result,
    analysis: {
      ...(analysis as Record<string, unknown>),
      meeting: {
        ...(meeting as Record<string, unknown>),
        satisfaction_score: null,
        value_score: null,
      },
    },
  };
}
