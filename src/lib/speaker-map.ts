import { isGenericSpeaker } from "./identification-clean";
import type { MeetingAnalysis } from "./meeting-analysis";

/* ------------------------------------------------------------------ *
 * Mapa de falantes (rótulo da transcrição -> nome real), usado para
 * reescrever responsáveis que a IA deixou como rótulo genérico.
 * Funções puras — nenhuma delas muta o que recebe.
 * ------------------------------------------------------------------ */

/**
 * Convenção de "confirmado por edição humana": só editar o NOME confirma a
 * linha — nome não vazio vira confidence "alta" + confirmed true; nome
 * apagado vira "baixa" + confirmed false. Editar só o papel não muda
 * confidence/confirmed (ver applySpeakerMapEdit). `confirmed` é só para a
 * tela mostrar "confirmado" em vez de "alta" no Badge — rewriteOwnerText
 * olha somente `confidence`.
 */
export type SpeakerMapEntry = {
  label: string;
  name: string;
  role: "" | "consultor" | "cliente";
  confidence: "alta" | "média" | "baixa";
  evidence: string;
  confirmed: boolean;
};

/**
 * Edição humana de uma linha do mapa: editar o nome confirma a linha (nome
 * não vazio -> "alta" + confirmed; nome apagado -> "baixa" + não confirmed).
 * Editar só o papel preserva confidence/confirmed como estavam. Não muta a
 * entrada recebida.
 */
export function applySpeakerMapEdit(
  entry: SpeakerMapEntry,
  patch: Partial<SpeakerMapEntry>,
): SpeakerMapEntry {
  if ("name" in patch) {
    const name = patch.name ?? "";
    const filled = name.trim().length > 0;
    return { ...entry, name, confidence: filled ? "alta" : "baixa", confirmed: filled };
  }
  if ("role" in patch) {
    return { ...entry, role: patch.role ?? entry.role };
  }
  return { ...entry, ...patch };
}

function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/\s+/g, " ");
}

function isUsableEntry(entry: SpeakerMapEntry): boolean {
  return (entry.confidence === "alta" || entry.confidence === "média") && entry.name.trim().length > 0;
}

function buildLookup(map: SpeakerMapEntry[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const entry of map) {
    if (!isUsableEntry(entry)) continue;
    lookup.set(normalizeLabel(entry.label), entry.name.trim());
  }
  return lookup;
}

/**
 * Resolve um token ISOLADO (sem "e" composto): se não for rótulo genérico,
 * devolve o próprio token (nome real intacto). Se for genérico, devolve o
 * nome mapeado ou `null` quando não há mapa válido (remove).
 */
function resolveToken(token: string, lookup: Map<string, string>): string | null {
  if (!isGenericSpeaker(token)) return token;
  return lookup.get(normalizeLabel(token)) ?? null;
}

/**
 * Reescreve um campo de texto de responsável (decisions[].owner,
 * actions[].owner_name, meeting.action_owner): rótulo genérico isolado, ou
 * dentro de um composto "X e Y", é trocado pelo nome mapeado (confidence
 * alta ou média) ou removido quando não há mapa válido, limpando o
 * conectivo solto ("Cliente e Speaker 2" sem mapeamento -> "Cliente"; com
 * Speaker 2 = Adan Rocha -> "Cliente e Adan Rocha"). Não diferencia
 * maiúsculas/minúsculas (via isGenericSpeaker). Nome real nunca é alterado.
 * Sem nada para sobrar, devolve "".
 */
export function rewriteOwnerText(value: string, map: SpeakerMapEntry[]): string {
  const text = value.trim();
  if (!text) return text;

  const lookup = buildLookup(map);

  const commaTokens = text
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);

  const outTokens: string[] = [];
  for (const token of commaTokens) {
    const direct = resolveToken(token, lookup);
    if (direct !== token) {
      if (direct) outTokens.push(direct);
      continue;
    }

    const subparts = token
      .split(/\s+e\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);

    if (subparts.length > 1) {
      const resolvedSub: string[] = [];
      for (const sub of subparts) {
        const resolved = resolveToken(sub, lookup);
        if (resolved) resolvedSub.push(resolved);
      }
      if (resolvedSub.length > 0) outTokens.push(resolvedSub.join(" e "));
    } else {
      outTokens.push(token);
    }
  }

  return outTokens.join(", ");
}

/**
 * Converte o `speaker_map` já validado pelo schema (sem `confirmed`, que só
 * existe na tela) para o tipo usado por `applySpeakerMapToAnalysis` e pelo
 * editor. Usado pelos pontos de leitura que não passam por uma etapa de
 * edição humana antes de aplicar o mapa (reabrir rascunho, reparse interno).
 */
export function toSpeakerMapEntries(raw: MeetingAnalysis["speaker_map"]): SpeakerMapEntry[] {
  return raw.map((s) => ({ ...s, confirmed: false }));
}

/**
 * Aplica o mapa confirmado aos 3 campos de responsável da análise, de uma
 * só vez. Devolve um objeto NOVO — `analysis` recebido não é mutado.
 */
export function applySpeakerMapToAnalysis(
  analysis: MeetingAnalysis,
  map: SpeakerMapEntry[],
): MeetingAnalysis {
  return {
    ...analysis,
    meeting: {
      ...analysis.meeting,
      action_owner: rewriteOwnerText(analysis.meeting.action_owner, map),
    },
    decisions: analysis.decisions.map((d) => ({ ...d, owner: rewriteOwnerText(d.owner, map) })),
    actions: analysis.actions.map((a) => ({ ...a, owner_name: rewriteOwnerText(a.owner_name, map) })),
  };
}

/**
 * Lista de nomes para o campo Participantes: entradas do mapa com nome e
 * confiança alta ou média, sem duplicata, na ordem do mapa. A linha do
 * consultor sem nome preenchido cai no fallback de `consultantName`.
 */
export function participantsFromSpeakerMap(map: SpeakerMapEntry[], consultantName?: string): string {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const entry of map) {
    if (entry.confidence !== "alta" && entry.confidence !== "média") continue;
    const name = entry.name.trim() || (entry.role === "consultor" ? consultantName?.trim() : "") || "";
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names.join(", ");
}
