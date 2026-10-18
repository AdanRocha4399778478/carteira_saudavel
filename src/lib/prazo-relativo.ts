/* ------------------------------------------------------------------ *
 * Backlog B18 (17/10/2026) — resolve uma expressão relativa de prazo
 * ("semana que vem", "fim do mês"...) numa data absoluta, a partir da
 * data da reunião. A IA NUNCA calcula essa data: só registra a
 * expressão literal (due_hint/deadline_hint); só este código calcula.
 * Tabela fechada e decidida pelo consultor (17/10/2026) — o que não
 * estiver nela, ou for condicional ("depois de receber..."), vira null
 * e o prazo fica vazio até o consultor editar manualmente no preview.
 * Toda a aritmética é em UTC, por índice de dias (epoch day), nunca com
 * `new Date()` sem argumentos nem `Date.now()` — evita qualquer
 * dependência do fuso horário ou do relógio local de quem executa.
 * ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

const WEEKDAYS: Record<string, number> = {
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
};

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function toEpochDay(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromEpochDay(epochDay: number): string {
  const d = new Date(epochDay * DAY_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Último dia do mês `m1` (1-indexado) de `y` — lida sozinho com virada de ano e bissexto. */
function lastDayOfMonthEpoch(y: number, m1: number): number {
  return Math.floor(Date.UTC(y, m1, 0) / DAY_MS);
}

/** Segunda-feira (1) a domingo (7) — nunca o `getUTCDay()` cru (0=domingo). */
function weekdayMon1(epochDay: number): number {
  const dow = new Date(epochDay * DAY_MS).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function fridayOfWeek(epochDay: number): number {
  const monday = epochDay - (weekdayMon1(epochDay) - 1);
  return monday + 4;
}

function matchWeekday(text: string): number | null {
  for (const [name, num] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}(-feira| feira)?\\b`).test(text)) return num;
  }
  return null;
}

/** minúsculo, sem acento, sem pontuação, com alguns artigos normalizados ("desta" -> "esta"). */
function normalize(raw: string): string {
  let s = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,;:!?"'()]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  s = ` ${s} `;
  // Formas faladas ("essa/dessa/nessa", "nesta") equivalem a "esta" pra fins de
  // prazo — \b garante que só a palavra inteira é trocada, nunca um pedaço de
  // "pessoa", "dessas" ou "nessas" (plural não é a mesma expressão).
  s = s.replace(/\b(desta|nesta|essa|dessa|nessa)\b/g, "esta");
  s = s.replace(/\b(deste|neste|esse|desse|nesse)\b/g, "este");
  s = s.replace(/ da proxima/g, " a proxima");
  s = s.replace(/ do proximo/g, " o proximo");
  return s.trim();
}

/**
 * Resolve a expressão literal `hint` numa data "AAAA-MM-DD", ancorada em
 * `meetingDateIso`. Retorna null para: hint/data ausentes ou inválidos,
 * expressão não reconhecida, expressão condicional, ou dia da semana
 * citado que já passou ("esta semana" cujo fim de semana já passou) ou
 * que é o próprio dia da reunião.
 */
export function resolveRelativeDeadline(
  hint: string | null | undefined,
  meetingDateIso: string | null | undefined,
): string | null {
  if (!hint || !meetingDateIso) return null;
  const parsed = parseIsoDate(meetingDateIso);
  if (!parsed) return null;
  const meetingEpoch = toEpochDay(parsed.y, parsed.m, parsed.d);

  const text = normalize(hint);
  if (!text) return null;

  // Duas opções ("esta semana ou a próxima"/"...ou a semana que vem"): a mais distante.
  if (/esta semana ou a? ?(proxima( semana)?|semana que vem|seguinte)\b/.test(text)) {
    return fromEpochDay(fridayOfWeek(meetingEpoch) + 7);
  }

  if (/\bhoje\b/.test(text)) return fromEpochDay(meetingEpoch);
  if (/\bamanha\b/.test(text)) return fromEpochDay(meetingEpoch + 1);

  if (/\b(semana que vem|proxima semana|semana seguinte)\b/.test(text)) {
    return fromEpochDay(fridayOfWeek(meetingEpoch) + 7);
  }

  if (/\besta semana\b/.test(text)) {
    const friday = fridayOfWeek(meetingEpoch);
    return friday < meetingEpoch ? null : fromEpochDay(friday);
  }

  const weekday = matchWeekday(text);
  if (weekday !== null) {
    const meetingWeekday = weekdayMon1(meetingEpoch);
    if (meetingWeekday === weekday) return null;
    const diff = (weekday - meetingWeekday + 7) % 7;
    return fromEpochDay(meetingEpoch + diff);
  }

  const daysMatch = /\b(?:em|daqui a|dentro de|ao final de|ao fim de)\s+(\d+)\s+dias?\b/.exec(text);
  if (daysMatch) return fromEpochDay(meetingEpoch + Number(daysMatch[1]));

  const weeksMatch = /\b(?:em|daqui a|dentro de|ao final de|ao fim de)\s+(\d+)\s+semanas?\b/.exec(
    text,
  );
  if (weeksMatch) return fromEpochDay(meetingEpoch + Number(weeksMatch[1]) * 7);

  if (/\bfim do mes\b/.test(text)) {
    return fromEpochDay(lastDayOfMonthEpoch(parsed.y, parsed.m));
  }
  if (/\b(mes que vem|proximo mes)\b/.test(text)) {
    return fromEpochDay(lastDayOfMonthEpoch(parsed.y, parsed.m + 1));
  }
  if (/\bfim do ano\b/.test(text)) {
    return fromEpochDay(toEpochDay(parsed.y, 12, 31));
  }

  return null;
}
