/* ------------------------------------------------------------------ *
 * Data real da reunião, extraída do cabeçalho do Tactiq ("Meeting
 * started: ..."). Função pura — não toca no texto gravado nem no hash.
 * ------------------------------------------------------------------ */

const MEETING_STARTED_RE = /Meeting started:\s*([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})/;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WEEKDAYS_PT = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export type MeetingDate = { iso: string; weekday: string };

/**
 * Procura a PRIMEIRA ocorrência de "Meeting started: <Mês> <dia>, <ano>"
 * em qualquer posição do texto (o PDF entrega a página inteira numa linha
 * só). Devolve null quando não casa ou a data é inválida.
 */
export function extractMeetingDateFromHeader(text: string): MeetingDate | null {
  const match = MEETING_STARTED_RE.exec(text);
  if (!match) return null;

  const [, monthName, dayStr, yearStr] = match;
  const month = MONTHS[monthName!.toLowerCase()];
  if (!month) return null;

  const day = Number(dayStr);
  const year = Number(yearStr);
  if (!Number.isInteger(day) || !Number.isInteger(year)) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  const iso = `${year}-${pad2(month)}-${pad2(day)}`;
  const weekday = WEEKDAYS_PT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;

  return { iso, weekday };
}
