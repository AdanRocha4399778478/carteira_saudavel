/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 3 (17/10/2026): parse de número em
 * formato brasileiro e validação dos formulários de cadastro manual
 * (indicador e ponto), fora do componente — testável sem renderizar
 * nada. Regras do dono do produto: valor vazio NUNCA vira zero (é erro
 * de validação, nunca um 0 silencioso); a marca "medido"/"estimado" de
 * um ponto é sempre obrigatória, sem pré-seleção.
 * ------------------------------------------------------------------ */

import type { IndicatorDirection, IndicatorKind, IndicatorPointBasis } from "./indicator-analysis";

const KINDS: IndicatorKind[] = ["percentual", "valor", "tempo", "quantidade"];
const DIRECTIONS: IndicatorDirection[] = ["maior_melhor", "menor_melhor"];
const FREQUENCIES = ["semanal", "mensal"] as const;
type IndicatorFrequency = (typeof FREQUENCIES)[number];
const BASES: IndicatorPointBasis[] = ["medido", "estimado"];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Só dois formatos são aceitos, sem meio-termo: inteiro com vírgula decimal
// opcional ("12", "12,5", "-3,2"), ou milhar em pt-BR válido — grupos de
// EXATAMENTE 3 dígitos depois de cada ponto, com vírgula decimal opcional
// ("1.234", "1.234,5"). Qualquer outra coisa com ponto (um só dígito depois
// dele, grupos quebrados, mistura de formato) é rejeitada: não existe
// "quase milhar" que o parser tente adivinhar.
const INTEGER_OR_DECIMAL_RE = /^-?\d+(,\d+)?$/;
const THOUSANDS_RE = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/;

/**
 * Converte um número em texto no formato brasileiro para `number`. Aceita
 * só "12,5" (inteiro + vírgula decimal opcional) ou "1.234,5" (milhar
 * válido, grupos de 3 dígitos, + vírgula decimal opcional). Formato
 * americano ("12.5") e qualquer ponto que não seja milhar bem formado
 * (".", "..", "1.2.3") são rejeitados de propósito — é justamente o que
 * esse parser não deve adivinhar. Devolve `null` para vazio, texto
 * inválido, ou qualquer coisa que não vire um número finito — nunca 0.
 */
export function parseNumberPtBr(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!INTEGER_OR_DECIMAL_RE.test(trimmed) && !THOUSANDS_RE.test(trimmed)) return null;

  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Mensagem de erro para quando `parseNumberPtBr` já devolveu `null` pro
 * texto bruto. Só é chamada nesse cenário de falha — por isso basta olhar
 * se há um ponto no texto: todo ponto que chega aqui não é um milhar
 * válido (se fosse, o parser não teria falhado), o que geralmente significa
 * confusão com o formato americano ("12.5" em vez de "12,5").
 */
export function explainNumberParseError(raw: string): string {
  return raw.includes(".") ? "Use vírgula como separador decimal (ex.: 12,5)." : "Valor inválido.";
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Valida uma data "AAAA-MM-DD" incluindo a existência real do dia (mês de
 * 28 a 31 dias, ano bissexto) — recusa 2026-02-31 e 2026-13-01, não só o
 * formato. Sem `new Date()`/`Date.now()`: só aritmética de calendário, pra
 * não depender do fuso horário de quem executa.
 */
export function isValidCalendarDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] as number);
  return day >= 1 && day <= maxDay;
}

/**
 * Inverso de `parseNumberPtBr`, pra reabrir um campo editável: número ->
 * texto em pt-BR (vírgula decimal, sem separador de milhar — evita
 * confundir o parser ao salvar de novo sem alterar). `null`/`undefined`
 * vira string vazia, nunca "0".
 */
export function formatNumberForInput(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return new Intl.NumberFormat("pt-BR", { useGrouping: false, maximumFractionDigits: 10 }).format(
    value,
  );
}

export type IndicatorFormInput = {
  name: string;
  kind: IndicatorKind | "";
  unit: string;
  direction: IndicatorDirection | "";
  frequency: IndicatorFrequency | "";
  /** Texto bruto digitado, formato pt-BR — ver parseNumberPtBr. */
  baselineValue: string;
  baselineAt: string;
  /** Texto bruto digitado, formato pt-BR — ver parseNumberPtBr. */
  targetValue: string;
};

export type IndicatorFormValue = {
  name: string;
  kind: IndicatorKind;
  unit: string | null;
  direction: IndicatorDirection;
  frequency: IndicatorFrequency | null;
  baseline_value: number | null;
  baseline_at: string | null;
  target_value: number | null;
};

export type IndicatorFormErrors = Partial<Record<keyof IndicatorFormInput, string>>;

export type IndicatorFormResult =
  { ok: true; value: IndicatorFormValue } | { ok: false; errors: IndicatorFormErrors };

/**
 * Valida o formulário de indicador (criar ou editar — mesma validação
 * pros dois). Campos numéricos (baselineValue/targetValue) são
 * opcionais — podem ficar vazios — mas, se preenchidos, têm que ser um
 * número válido em pt-BR; nunca viram 0 por engano. baselineAt é
 * opcional, mas se preenchida precisa ser uma data válida.
 */
export function validateIndicatorForm(input: IndicatorFormInput): IndicatorFormResult {
  const errors: IndicatorFormErrors = {};

  const name = input.name.trim();
  if (!name) errors.name = "Informe o nome do indicador.";

  if (!input.kind || !KINDS.includes(input.kind)) {
    errors.kind = "Escolha o tipo do indicador.";
  }

  if (!input.direction || !DIRECTIONS.includes(input.direction)) {
    errors.direction = "Escolha a direção (maior é melhor ou menor é melhor).";
  }

  if (input.frequency && !FREQUENCIES.includes(input.frequency)) {
    errors.frequency = "Frequência inválida.";
  }

  let baselineValue: number | null = null;
  if (input.baselineValue.trim() !== "") {
    baselineValue = parseNumberPtBr(input.baselineValue);
    if (baselineValue === null) errors.baselineValue = explainNumberParseError(input.baselineValue);
  }

  if (input.baselineAt.trim() !== "" && !isValidCalendarDate(input.baselineAt.trim())) {
    errors.baselineAt = "Data da base inválida.";
  }

  let targetValue: number | null = null;
  if (input.targetValue.trim() !== "") {
    targetValue = parseNumberPtBr(input.targetValue);
    if (targetValue === null) errors.targetValue = explainNumberParseError(input.targetValue);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      // Os dois already-validated acima garantem que são membros do union.
      kind: input.kind as IndicatorKind,
      unit: input.unit.trim() || null,
      direction: input.direction as IndicatorDirection,
      frequency: input.frequency || null,
      baseline_value: baselineValue,
      baseline_at: input.baselineAt.trim() || null,
      target_value: targetValue,
    },
  };
}

export type IndicatorPointFormInput = {
  /** Texto bruto digitado, formato pt-BR — ver parseNumberPtBr. Obrigatório, nunca vira 0. */
  value: string;
  measuredAt: string;
  /** Obrigatória — "" é inválido, de propósito: a UI nunca pré-seleciona uma marca. */
  basis: IndicatorPointBasis | "";
  note: string;
};

export type IndicatorPointFormValue = {
  value: number;
  measured_at: string;
  basis: IndicatorPointBasis;
  note: string | null;
};

export type IndicatorPointFormErrors = Partial<Record<keyof IndicatorPointFormInput, string>>;

export type IndicatorPointFormResult =
  { ok: true; value: IndicatorPointFormValue } | { ok: false; errors: IndicatorPointFormErrors };

/**
 * Valida o formulário de ponto (criar ou editar). `value` e `measuredAt`
 * são obrigatórios; `basis` é obrigatória e sem pré-seleção — campo
 * vazio é erro de validação, nunca um valor-padrão escolhido por nós.
 */
export function validateIndicatorPointForm(
  input: IndicatorPointFormInput,
): IndicatorPointFormResult {
  const errors: IndicatorPointFormErrors = {};

  let value: number | null = null;
  if (input.value.trim() === "") {
    errors.value = "Informe o valor do ponto.";
  } else {
    value = parseNumberPtBr(input.value);
    if (value === null) errors.value = explainNumberParseError(input.value);
  }

  const measuredAt = input.measuredAt.trim();
  if (!measuredAt) {
    errors.measuredAt = "Informe a data do ponto.";
  } else if (!isValidCalendarDate(measuredAt)) {
    errors.measuredAt = "Data inválida.";
  }

  if (!input.basis || !BASES.includes(input.basis)) {
    errors.basis = "Escolha se o ponto é medido ou estimado.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      value: value as number,
      measured_at: measuredAt,
      basis: input.basis as IndicatorPointBasis,
      note: input.note.trim() || null,
    },
  };
}
