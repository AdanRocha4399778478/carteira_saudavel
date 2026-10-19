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
