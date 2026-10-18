/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate B (18/10/2026). Função
 * extraída de meeting-analysis.ts (onde era local, usada só para
 * remover duplicados dentro da mesma análise) — agora exportada para
 * também servir de chave de identidade no casamento com indicadores já
 * existentes do projeto (ver indicator-match.ts). Comportamento
 * idêntico ao original (ver teste de paridade em
 * tests/indicator-name.test.ts): nunca mudou, só mudou de arquivo.
 * ------------------------------------------------------------------ */

/**
 * Minúsculo, sem acento, sem espaços extras — a chave de identidade de um
 * indicador é esse nome normalizado + kind, nunca similaridade de texto.
 */
export function normalizeIndicatorName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}
