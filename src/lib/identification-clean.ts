import { MEETING_TYPES } from "@/lib/domain";

export type MeetingType = (typeof MEETING_TYPES)[number];

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Compara sem diferenciar maiúsculas/acentos; fora do enum (ou vazio) vira "". */
export function normalizeMeetingType(value: unknown): MeetingType | "" {
  if (typeof value !== "string") return "";
  const normalized = normalizeForCompare(value);
  if (!normalized) return "";
  const match = MEETING_TYPES.find((t) => normalizeForCompare(t) === normalized);
  return match ?? "";
}

const GENERIC_SPEAKER_RE = /^(speaker|falante|participante)\s*\d+\.?$|^unknown\.?$/i;

function isGenericSpeaker(token: string): boolean {
  return GENERIC_SPEAKER_RE.test(token.trim());
}

/**
 * Separa por vírgula ou ponto e vírgula; remove rótulos genéricos de falante
 * ("Speaker 1", "Falante 2", "Participante 3", "Unknown", com ou sem ponto
 * final). "e" só é tratado como separador quando um dos lados é um rótulo
 * genérico (ex.: "Adan e Speaker 2" -> "Adan") — "Adan e Elias" permanece
 * intacto, sem forçar vírgula numa frase que já lê bem em português.
 * Junta o restante com ", ". Sem nomes reais, devolve "".
 */
export function cleanParticipants(value: string): string {
  const tokens = value
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);

  const result: string[] = [];
  for (const token of tokens) {
    if (isGenericSpeaker(token)) continue;

    const subparts = token
      .split(/\s+e\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);

    if (subparts.length > 1 && subparts.some(isGenericSpeaker)) {
      for (const sub of subparts) if (!isGenericSpeaker(sub)) result.push(sub);
    } else {
      result.push(token);
    }
  }

  return result.join(", ");
}
