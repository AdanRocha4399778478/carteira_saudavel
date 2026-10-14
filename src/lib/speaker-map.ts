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

function hasUsableConfidence(entry: SpeakerMapEntry): boolean {
  return entry.confidence === "alta" || entry.confidence === "média";
}

function isUsableEntry(entry: SpeakerMapEntry): boolean {
  return hasUsableConfidence(entry) && entry.name.trim().length > 0;
}

/**
 * B1: confiança alta/média, papel conhecido, nome vazio — o rótulo genérico
 * é MANTIDO como responsável (em vez de removido), já que ele pelo menos
 * identifica QUEM (cliente ou consultor) assumiu a tarefa, mesmo sem nome.
 * Participantes nunca usa esse caminho (ver participantsFromSpeakerMap).
 */
function hasKnownRoleButNoName(entry: SpeakerMapEntry): boolean {
  return hasUsableConfidence(entry) && entry.role !== "" && entry.name.trim().length === 0;
}

function buildLookups(map: SpeakerMapEntry[]): {
  names: Map<string, string>;
  keepLabel: Set<string>;
} {
  const names = new Map<string, string>();
  const keepLabel = new Set<string>();
  for (const entry of map) {
    const norm = normalizeLabel(entry.label);
    if (isUsableEntry(entry)) names.set(norm, entry.name.trim());
    else if (hasKnownRoleButNoName(entry)) keepLabel.add(norm);
  }
  return { names, keepLabel };
}

/**
 * Resolve um token ISOLADO (sem "e" composto): se não for rótulo genérico,
 * devolve o próprio token (nome real intacto). Se for genérico: nome
 * mapeado (confiança alta/média, nome preenchido); o próprio rótulo quando
 * a entrada só tem papel conhecido sem nome (B1 — ver hasKnownRoleButNoName);
 * ou `null` quando não há mapa válido nenhum (remove).
 */
function resolveToken(
  token: string,
  lookups: { names: Map<string, string>; keepLabel: Set<string> },
): string | null {
  if (!isGenericSpeaker(token)) return token;
  const norm = normalizeLabel(token);
  const name = lookups.names.get(norm);
  if (name) return name;
  if (lookups.keepLabel.has(norm)) return token;
  return null;
}

/**
 * Igual a `hasKnownRoleButNoName`, mas SEM exigir confiança alta/média —
 * usada só pelo aviso da tela (abaixo). A atribuição automática de
 * responsável (buildLookups/resolveToken, via hasKnownRoleButNoName) continua
 * exigindo confiança alta/média; confiança baixa continua esvaziando ali.
 */
function hasKnownRoleNoNameAnyConfidence(entry: SpeakerMapEntry): boolean {
  return entry.role !== "" && entry.name.trim().length === 0;
}

/**
 * Rótulos (ex.: "Speaker 2") de entradas com papel conhecido e nome vazio,
 * qualquer confiança — usado pela tela para avisar o consultor ANTES de
 * gerar o preview (B1). Falante com papel desconhecido nunca entra; falante
 * com nome preenchido nunca entra. Não exige confiança alta/média: mesmo com
 * confiança baixa (nome ainda não revisado), o consultor precisa ser
 * avisado, já que o rótulo genérico pode sobreviver como responsável.
 */
export function speakerLabelsNeedingName(map: SpeakerMapEntry[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const entry of map) {
    if (!hasKnownRoleNoNameAnyConfidence(entry)) continue;
    const key = normalizeLabel(entry.label);
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(entry.label);
  }
  return labels;
}

/**
 * Reescreve um campo de texto de responsável (decisions[].owner,
 * actions[].owner_name, meeting.action_owner): rótulo genérico isolado, ou
 * dentro de um composto "X e Y", é trocado pelo nome mapeado (confidence
 * alta ou média); mantido como o próprio rótulo quando a entrada só tem
 * papel conhecido sem nome (B1 — ver hasKnownRoleButNoName); ou removido
 * quando não há mapa válido nenhum, limpando o conectivo solto ("Cliente e
 * Speaker 2" sem mapeamento -> "Cliente"; com Speaker 2 = Adan Rocha ->
 * "Cliente e Adan Rocha"). Não diferencia maiúsculas/minúsculas (via
 * isGenericSpeaker). Nome real nunca é alterado. Sem nada para sobrar,
 * devolve "".
 */
export function rewriteOwnerText(value: string, map: SpeakerMapEntry[]): string {
  const text = value.trim();
  if (!text) return text;

  const lookup = buildLookups(map);

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

function normalizeForPrefixMatch(text: string): string {
  return text.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const CLIENT_SUBJECT_PREFIX_RE = /^(?:o |a )?cliente\s+\w+/;
const CONSULTANT_SUBJECT_PREFIX_RE = /^(?:o |a )?consultor\s+\w+/;
/** Quantas palavras iniciais olhar pra detectar os dois papéis citados juntos (ambíguo). */
const BOTH_ROLES_WORD_WINDOW = 6;

/**
 * true quando "cliente" e "consultor", como palavra inteira (não
 * "clientes"/"consultores"), aparecem nas primeiras BOTH_ROLES_WORD_WINDOW
 * palavras — ex.: "Cliente e consultor definem o prazo". Ambíguo demais pra
 * atribuir a um dos dois papéis.
 */
function mentionsBothRolesEarly(normalizedText: string): boolean {
  const words = normalizedText
    .split(/\s+/)
    .slice(0, BOTH_ROLES_WORD_WINDOW)
    .map((w) => w.replace(/[.,;:!?]+$/, ""));
  return words.includes("cliente") && words.includes("consultor");
}

/**
 * Nome (ou, sem nome, o rótulo — mesma condição de B1) da ÚNICA entrada do
 * mapa com esse papel. Com zero ou mais de uma entrada do papel, `null`.
 * Confiança baixa na única entrada também devolve `null` — na dúvida fica
 * vazio, tanto para usar o nome quanto para usar o rótulo.
 */
function ownerNameForRole(map: SpeakerMapEntry[], role: "cliente" | "consultor"): string | null {
  const matches = map.filter((entry) => entry.role === role);
  if (matches.length !== 1) return null;
  const entry = matches[0]!;
  if (!hasUsableConfidence(entry)) return null;
  const name = entry.name.trim();
  if (name) return name;
  return hasKnownRoleButNoName(entry) ? entry.label : null;
}

/**
 * B2: ação com owner_name vazio cujo texto (normalizado, sem acento e sem
 * diferenciar maiúscula) comece por "cliente"/"o cliente"/"a cliente" (ou,
 * do mesmo modo, "consultor"/"o consultor"/"a consultor") seguido de espaço
 * e de uma palavra qualquer — não só "deve", qualquer verbo — recebe o
 * responsável do papel correspondente, SÓ quando existir exatamente uma
 * entrada desse papel no mapa, com confiança alta ou média (ver
 * ownerNameForRole — baixa fica vazio, mesmo com nome preenchido).
 * "Clientes"/"consultores" no plural não contam (o \s+ exige espaço logo
 * após a palavra do papel, "clientes" não tem). Nunca atribui quando os
 * DOIS papéis aparecem nas primeiras palavras — ver mentionsBothRolesEarly
 * (ex.: "Cliente e consultor definem..."). Nunca sobrescreve um owner_name
 * já preenchido pela IA. Roda ANTES de rewriteOwnerText (ver
 * applySpeakerMapToAnalysis) — por isso o nome aqui ainda pode ser um nome
 * real ou, por B1, o próprio rótulo (que rewriteOwnerText depois mantém,
 * de forma consistente).
 */
export function fillActionOwnerByRole<T extends { description: string; owner_name: string }>(
  actions: T[],
  map: SpeakerMapEntry[],
): T[] {
  return actions.map((action) => {
    if (action.owner_name.trim()) return action;
    const norm = normalizeForPrefixMatch(action.description);
    const role = mentionsBothRolesEarly(norm)
      ? null
      : CLIENT_SUBJECT_PREFIX_RE.test(norm)
        ? "cliente"
        : CONSULTANT_SUBJECT_PREFIX_RE.test(norm)
          ? "consultor"
          : null;
    if (!role) return action;
    const owner = ownerNameForRole(map, role);
    return owner ? { ...action, owner_name: owner } : action;
  });
}

/**
 * Aplica o mapa confirmado aos 3 campos de responsável da análise, de uma
 * só vez. Devolve um objeto NOVO — `analysis` recebido não é mutado. B2
 * (fillActionOwnerByRole) roda ANTES da reescrita de rótulo por nome, para
 * as ações com owner_name vazio ainda poderem ser atribuídas por papel.
 */
export function applySpeakerMapToAnalysis(
  analysis: MeetingAnalysis,
  map: SpeakerMapEntry[],
): MeetingAnalysis {
  const actionsWithRoleOwner = fillActionOwnerByRole(analysis.actions, map);
  return {
    ...analysis,
    meeting: {
      ...analysis.meeting,
      action_owner: rewriteOwnerText(analysis.meeting.action_owner, map),
    },
    decisions: analysis.decisions.map((d) => ({ ...d, owner: rewriteOwnerText(d.owner, map) })),
    actions: actionsWithRoleOwner.map((a) => ({ ...a, owner_name: rewriteOwnerText(a.owner_name, map) })),
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

/**
 * B3: valor de Participantes depois de uma mudança no mapa de falantes.
 * Nunca sobrescreve uma edição manual do consultor (editedManually). Sem
 * isso, recalcula a partir do mapa ATUAL; se o mapa não tiver nenhum nome
 * usável (participantsFromSpeakerMap devolve ""), mantém o valor atual em
 * vez de esvaziar o campo. Função pura — não lê nem grava estado de tela.
 */
export function nextParticipantsValue(
  map: SpeakerMapEntry[],
  consultantName: string | undefined,
  currentValue: string,
  editedManually: boolean,
): string {
  if (editedManually) return currentValue;
  return participantsFromSpeakerMap(map, consultantName) || currentValue;
}
