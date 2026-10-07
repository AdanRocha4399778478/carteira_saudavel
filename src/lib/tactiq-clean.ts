/* ------------------------------------------------------------------ *
 * Limpeza do recorte exportado pelo Tactiq ANTES de enviar à IA.
 * Funções puras — não tocam no texto gravado em `meetings` nem no hash.
 * ------------------------------------------------------------------ */

// "Transcript" com T maiúsculo seguido de horário; \s+ casa espaço OU quebra
// de linha, porque o pdf.js entrega cada página como uma única "linha" (os
// itens de texto são unidos com espaço, não com \n) — ver transcript-source.ts.
const TRANSCRIPT_MARK = /Transcript\s+\d{1,2}:\d{2}/;
const SUMMARY_TITLE_RE = /(?:General - )?Summary and Action items|Short summary/i;

const TACTIQ_BOILERPLATE_PHRASES = [
  "Olá, estou transcrevendo esta chamada com minha extensão Tactiq AI. https://tactiq.io/r/transcribing",
  "Hi, I'm transcribing this call with my Tactiq AI extension. https://tactiq.io/r/transcribing",
];

/**
 * Remove o bloco de resumo/itens de ação que o Tactiq insere entre o
 * cabeçalho da reunião e a transcrição literal. Não depende de quebra de
 * linha: procura o marcador "Transcript <horário>" (sensível a maiúsculas)
 * e, só no texto ANTES dele, o título do bloco de resumo. Sem os dois
 * marcadores, devolve o texto idêntico.
 */
export function stripTactiqSummary(text: string): string {
  const transcriptMatch = TRANSCRIPT_MARK.exec(text);
  if (!transcriptMatch) return text;

  const header = text.slice(0, transcriptMatch.index);
  const titleMatch = SUMMARY_TITLE_RE.exec(header);
  if (!titleMatch) return text;

  return text.slice(0, titleMatch.index) + text.slice(transcriptMatch.index);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove, em qualquer posição do texto, a frase de propaganda que o Tactiq
 * insere ("estou transcrevendo esta chamada..."), inclusive repetida, e o
 * espaço que sobrar ao redor. Não remove mais nada.
 */
export function stripTactiqBoilerplate(text: string): string {
  let result = text;
  for (const phrase of TACTIQ_BOILERPLATE_PHRASES) {
    const re = new RegExp(`[ \\t]*${escapeRegExp(phrase)}[ \\t]*`, "g");
    result = result.replace(re, (match) => {
      const hadLeftSpace = /^[ \t]/.test(match);
      const hadRightSpace = /[ \t]$/.test(match);
      return hadLeftSpace && hadRightSpace ? " " : "";
    });
  }
  return result;
}
