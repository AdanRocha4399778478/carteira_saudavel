import type { MeetingAnalysis } from "@/lib/meeting-analysis";

export const PERSON_FUNCTIONS = ["executa", "monitora", "acompanha", "decide"] as const;

export type PersonFunction = (typeof PERSON_FUNCTIONS)[number];

export type PersonSide = "cliente" | "consultoria" | "terceiro";

/** Campos da linha de public.client_people (migration 20261019140000). */
export interface ClientPerson {
  id: string;
  client_id: string;
  name: string;
  aliases: string[];
  side: PersonSide;
  role: string | null;
  functions: PersonFunction[];
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Reproduz EXATAMENTE a normalização de `public.normalize_project_name` (a
 * mesma usada no índice único de `client_people` e em `projects.name`): tira
 * acento, deixa minúsculo, troca qualquer sequência fora de [a-z0-9] por um
 * único espaço, apara as pontas. Comparação sempre pelo resultado desta
 * função — nunca pelo texto original.
 */
export function normalizePersonName(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type ResolvePersonResult =
  | { person: ClientPerson; matchedBy: "name" | "alias"; ambiguous: false }
  | { person: null; ambiguous: true; candidates: ClientPerson[] }
  | { person: null; ambiguous: false };

/**
 * Casa um nome (vindo da IA ou da transcrição) contra as pessoas ATIVAS do
 * cliente. Só igualdade exata depois de `normalizePersonName` — nunca
 * similaridade, fonética ou prefixo ("Du" casa com quem tem o apelido "Du",
 * "Duda" não casa com ninguém só por começar igual). Nome vazio ou só
 * pontuação (normaliza para string vazia) nunca resolve. Mais de uma pessoa
 * ativa batendo (nome ou apelido repetido entre clientes diferentes não
 * deveria ocorrer por causa do banco, mas a função não presume isso) devolve
 * ambíguo, com as candidatas, em vez de escolher uma arbitrariamente.
 */
export function resolvePerson(name: string, people: ClientPerson[]): ResolvePersonResult {
  const normalized = normalizePersonName(name);
  if (!normalized) return { person: null, ambiguous: false };

  const matches: { person: ClientPerson; matchedBy: "name" | "alias" }[] = [];
  for (const person of people) {
    if (!person.active) continue;
    if (normalizePersonName(person.name) === normalized) {
      matches.push({ person, matchedBy: "name" });
      continue;
    }
    if (person.aliases.some((alias) => normalizePersonName(alias) === normalized)) {
      matches.push({ person, matchedBy: "alias" });
    }
  }

  if (matches.length === 1) {
    return { person: matches[0]!.person, matchedBy: matches[0]!.matchedBy, ambiguous: false };
  }
  if (matches.length > 1) {
    return { person: null, ambiguous: true, candidates: matches.map((m) => m.person) };
  }
  return { person: null, ambiguous: false };
}

/**
 * Nome canônico quando `resolvePerson` reconhece a pessoa; senão o nome
 * original, só aparado — nunca apaga um responsável que o cadastro ainda
 * não conhece.
 */
export function canonicalOwnerName(name: string, people: ClientPerson[]): string {
  const result = resolvePerson(name, people);
  if (result.person) return result.person.name;
  return (name ?? "").trim();
}

export type PersonHistoryOrigin =
  "responsável de ação" | "responsável de decisão" | "participante de reunião";

export interface PersonHistoryRow {
  name: string;
  origin: PersonHistoryOrigin;
}

export interface PersonSuggestion {
  /** Grafia original mais frequente dentro do grupo normalizado. */
  name: string;
  normalized: string;
  count: number;
  origins: { origin: PersonHistoryOrigin; count: number }[];
  suggestedSide: "consultoria" | null;
}

/**
 * Agrupa nomes do histórico (owner de ações/decisões, participante de
 * reunião) por `normalizePersonName` — nunca por parecença ("Victor" e
 * "Vitor" ficam SEPARADOS; a tela de cadastro decide se são a mesma pessoa).
 * Ordena as sugestões da mais para a menos frequente. `side` só vem
 * sugerido como "consultoria" quando o nome normalizado bate com um dos
 * `consultancyNames` (ex.: ["Adan Rocha"]); caso contrário `null`, para a
 * tela perguntar.
 */
export function suggestPeopleFromHistory(
  rows: PersonHistoryRow[],
  consultancyNames: string[] = [],
): PersonSuggestion[] {
  const normalizedConsultancy = new Set(consultancyNames.map((n) => normalizePersonName(n)));

  const groups = new Map<
    string,
    {
      displayCounts: Map<string, number>;
      total: number;
      origins: Map<PersonHistoryOrigin, number>;
    }
  >();

  for (const row of rows) {
    const normalized = normalizePersonName(row.name);
    if (!normalized) continue;

    const display = row.name.trim();
    let group = groups.get(normalized);
    if (!group) {
      group = { displayCounts: new Map(), total: 0, origins: new Map() };
      groups.set(normalized, group);
    }
    group.total += 1;
    group.displayCounts.set(display, (group.displayCounts.get(display) ?? 0) + 1);
    group.origins.set(row.origin, (group.origins.get(row.origin) ?? 0) + 1);
  }

  const suggestions: PersonSuggestion[] = [];
  for (const [normalized, group] of groups) {
    let bestDisplay = "";
    let bestCount = -1;
    for (const [display, count] of group.displayCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestDisplay = display;
      }
    }
    suggestions.push({
      name: bestDisplay,
      normalized,
      count: group.total,
      origins: Array.from(group.origins, ([origin, count]) => ({ origin, count })),
      suggestedSide: normalizedConsultancy.has(normalized) ? "consultoria" : null,
    });
  }

  suggestions.sort((a, b) => b.count - a.count);
  return suggestions;
}

/* ------------------------------------------------------------------ *
 * Gate E (19/10/2026): cadastro de pessoas usado pela IA e pelo preview.
 * O cadastro tem PRIORIDADE sobre a lista fixa OWNER_ALIAS_SEED (que
 * continua existindo como reserva, intocada nesta etapa) — decisão do
 * dono do produto: a lista fixa só sai quando os apelidos existentes
 * estiverem todos migrados pela tela.
 * ------------------------------------------------------------------ */

/** Reaproveitados pelo schema de entrada da IA (intelligent-meeting.server.ts) — mesmos limites dos dois lados. */
export const MAX_PEOPLE_IN_PROMPT = 30;
export const MAX_ALIASES_IN_PROMPT = 8;
export const MAX_ROLE_CHARS_IN_PROMPT = 60;

export interface PeoplePromptEntry {
  name: string;
  aliases: string[];
  side: PersonSide;
  role: string;
  functions: PersonFunction[];
}

/** Quebra de linha e caracteres de controle nunca vão pro prompt (texto de uma linha só). */
function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex -- remoção deliberada de controles antes de ir ao prompt da IA.
  return value.replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ").trim();
}

/**
 * Contexto compacto do cadastro de pessoas do cliente, pro prompt da IA.
 * Só pessoas ATIVAS; no máximo 30 pessoas e 8 apelidos por pessoa (as
 * PRIMEIRAS da lista recebida, ordem estável — nunca reordena nem escolhe
 * "as mais relevantes"); cargo cortado em 60 caracteres. Lista vazia (sem
 * cliente escolhido, ou cliente sem pessoa ativa) devolve [].
 */
export function buildPeoplePromptContext(people: ClientPerson[]): PeoplePromptEntry[] {
  return people
    .filter((p) => p.active)
    .slice(0, MAX_PEOPLE_IN_PROMPT)
    .map((p) => ({
      name: stripControlChars(p.name),
      aliases: p.aliases.slice(0, MAX_ALIASES_IN_PROMPT).map(stripControlChars),
      side: p.side,
      role: stripControlChars(p.role ?? "").slice(0, MAX_ROLE_CHARS_IN_PROMPT),
      functions: [...p.functions],
    }));
}

/**
 * Cópia da análise com os campos de responsável/falante trocados pelo nome
 * canônico, quando `canonicalOwnerName` reconhece a pessoa (nome ou apelido
 * batendo, pessoa ativa) — campos cobertos: `meeting.action_owner`,
 * `actions[].owner_name`, `decisions[].owner` e `speaker_map[].name`. Nome
 * desconhecido, ambíguo ou vazio fica intacto (nunca apaga responsável que
 * o cadastro não conhece). Nenhum outro campo é tocado; a entrada original
 * nunca é alterada (sempre devolve objetos/arrays novos nos campos que
 * mudam, mantendo o resto por referência).
 *
 * `identification.participants` (participantes da reunião) NÃO é campo de
 * `MeetingAnalysis` — vive num passo anterior, fora do objeto de análise —
 * por isso tem uma função irmã, `canonicalizeParticipantNames` abaixo, pra
 * quem precisar canonicalizar essa lista separadamente.
 */
export function canonicalizeAnalysisOwners(
  analysis: MeetingAnalysis,
  people: ClientPerson[],
): MeetingAnalysis {
  if (people.length === 0) return analysis;
  return {
    ...analysis,
    meeting: {
      ...analysis.meeting,
      action_owner: canonicalOwnerName(analysis.meeting.action_owner, people),
    },
    actions: analysis.actions.map((a) => ({
      ...a,
      owner_name: canonicalOwnerName(a.owner_name, people),
    })),
    decisions: analysis.decisions.map((d) => ({
      ...d,
      owner: canonicalOwnerName(d.owner, people),
    })),
    speaker_map: analysis.speaker_map.map((s) => ({
      ...s,
      name: canonicalOwnerName(s.name, people),
    })),
  };
}

/**
 * Mesma troca de `canonicalizeAnalysisOwners`, para uma lista solta de
 * nomes (ex.: `identification.participants`, ou o campo Participantes da
 * tela já separado por vírgula) — participante desconhecido fica com a
 * grafia original.
 */
export function canonicalizeParticipantNames(
  participants: string[],
  people: ClientPerson[],
): string[] {
  if (people.length === 0) return participants;
  return participants.map((name) => canonicalOwnerName(name, people));
}

/* ------------------------------------------------------------------ *
 * Gate F (19/10/2026) — seletor de responsável no preview. A IA continua
 * sem adivinhar (regra do prompt não muda); isto só ORDENA as opções que o
 * consultor vê, a escolha final é sempre dele.
 * ------------------------------------------------------------------ */

export type ReviewItemKind = "decisao" | "acao";

/** Radicais (sem acento/caixa) de verbo de monitoramento/acompanhamento — cobre formas conjugadas comuns. */
const MONITOR_VERB_STEMS = [
  "monitor",
  "acompanh",
  "revis",
  "cobr",
  "chec",
  "verific",
  "supervis",
  "confer",
];

/**
 * Funções preferidas pra sugerir responsável, por tipo de item. Decisão:
 * sempre "decide". Ação: "monitora"/"acompanha" quando o texto tiver um
 * verbo de monitoramento/acompanhamento (radical, sem acento/caixa,
 * comparado por palavra inteira); senão "executa". Só ordena as opções do
 * seletor — nunca escolhe um responsável sozinha.
 */
export function preferredFunctionsForItem(kind: ReviewItemKind, text: string): PersonFunction[] {
  if (kind === "decisao") return ["decide"];
  const words = normalizePersonName(text).split(" ").filter(Boolean);
  const hasMonitorVerb = words.some((word) =>
    MONITOR_VERB_STEMS.some((stem) => word.startsWith(stem)),
  );
  return hasMonitorVerb ? ["monitora", "acompanha"] : ["executa"];
}

/**
 * Ordem das opções do seletor de responsável: só pessoas ATIVAS; primeiro
 * as que têm alguma das `preferred` (mantendo a ordem do cadastro), depois
 * as demais (idem). O nome atual (sugerido pela IA ou já gravado) entra no
 * TOPO da lista, mas só quando não for ninguém do cadastro — pra nunca
 * sumir um nome real que o cadastro ainda não conhece; se `currentName` já
 * é uma pessoa cadastrada (nome ou apelido, sem ambiguidade), ela já está
 * representada pelo nome canônico e não entra duplicada.
 */
export function orderPeopleForItem(
  people: ClientPerson[],
  preferred: PersonFunction[],
  currentName: string,
): string[] {
  const active = people.filter((p) => p.active);
  const withPreferred = active.filter((p) => p.functions.some((f) => preferred.includes(f)));
  const rest = active.filter((p) => !withPreferred.includes(p));
  const names = [...withPreferred, ...rest].map((p) => p.name);

  const trimmedCurrent = currentName.trim();
  if (trimmedCurrent && !resolvePerson(trimmedCurrent, people).person) {
    return [trimmedCurrent, ...names];
  }
  return names;
}
