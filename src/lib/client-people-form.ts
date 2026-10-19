import {
  normalizePersonName,
  PERSON_FUNCTIONS,
  type ClientPerson,
  type PersonSide,
} from "@/lib/client-people";

/* ------------------------------------------------------------------ *
 * Cadastro de pessoas e apelidos por cliente — Gate C/D (19/10/2026).
 * Funções PURAS de validação do formulário de pessoa, sem I/O — a
 * confirmação do consultor e a gravação ficam na tela e em
 * client-people-data.ts.
 * ------------------------------------------------------------------ */

export interface PersonFormInput {
  name: string;
  aliases: string[];
  /** "" quando ainda não escolhido — nunca pré-selecionado pela tela. */
  side: PersonSide | "";
  role: string;
  functions: string[];
}

/**
 * Apara, remove entradas vazias (string vazia/só espaço) e duplicadas pela
 * normalização — mantém a grafia da PRIMEIRA ocorrência. Um apelido que
 * normaliza para vazio (só pontuação, ex. ".") NÃO é removido aqui — isso é
 * erro de validação (ver validatePersonForm), não limpeza silenciosa; dedup
 * entre dois apelidos assim ("." e "-") usa o texto aparado, não a
 * normalização, pra não juntar dois apelidos inválidos diferentes.
 */
export function normalizeAliasList(aliases: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of aliases) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = normalizePersonName(trimmed) || trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
 * Lista de erros em português do formulário de pessoa. `people` são as
 * pessoas já cadastradas do MESMO cliente (ativas ou não — a colisão de
 * nome/apelido vale contra qualquer uma, igual ao gatilho do banco);
 * `editingId` exclui a própria pessoa da checagem de colisão ao editar.
 */
export function validatePersonForm(
  input: PersonFormInput,
  people: ClientPerson[],
  editingId?: string | null,
): string[] {
  const errors: string[] = [];

  const normalizedName = normalizePersonName(input.name);
  if (!normalizedName) {
    errors.push("Informe o nome da pessoa (precisa ter letras ou números).");
  }

  if (!input.side) {
    errors.push("Selecione o lado: cliente, consultoria ou terceiro.");
  }

  const allowedFunctions: readonly string[] = PERSON_FUNCTIONS;
  for (const fn of input.functions) {
    if (!allowedFunctions.includes(fn)) {
      errors.push(`Função inválida: "${fn}".`);
    }
  }

  const aliasList = normalizeAliasList(input.aliases);
  for (const alias of aliasList) {
    const normalizedAlias = normalizePersonName(alias);
    if (!normalizedAlias) {
      errors.push(`Apelido "${alias}" precisa ter letras ou números.`);
      continue;
    }
    if (normalizedName && normalizedAlias === normalizedName) {
      errors.push(`Apelido "${alias}" não pode ser igual ao próprio nome.`);
    }
  }

  if (normalizedName || aliasList.length) {
    const ownTokens = new Set(
      [normalizedName, ...aliasList.map((a) => normalizePersonName(a))].filter(Boolean),
    );
    const others = people.filter((p) => p.id !== editingId);
    for (const person of others) {
      const personTokens = [person.name, ...person.aliases].map((t) => normalizePersonName(t));
      const collides = personTokens.some((token) => token && ownTokens.has(token));
      if (collides) {
        errors.push(`Nome ou apelido já é usado por ${person.name}.`);
      }
    }
  }

  return errors;
}

/**
 * Separa um texto colado/digitado em apelidos por vírgula OU ponto e
 * vírgula ("Du, Dudu; Edu" vira três). Apara cada pedaço e descarta os
 * vazios (separador duplicado, ou um dos dois nas pontas). Não remove
 * duplicados nem valida — isso é papel de normalizeAliasList/
 * validatePersonForm.
 */
export function splitAliasInput(text: string): string[] {
  return text
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export interface GroupedPersonErrors {
  name: string[];
  side: string[];
  functions: string[];
  aliases: string[];
  general: string[];
}

/**
 * Agrupa os erros de validatePersonForm por campo, pelo INÍCIO da
 * mensagem — cada erro aparece numa única categoria, nunca duas. Colisão
 * de nome/apelido com outra pessoa ("Nome ou apelido já é usado por ...")
 * vai para `general` (aparece uma vez no rodapé do formulário, não embaixo
 * de um campo específico, já que pode ter vindo do nome OU de um apelido).
 */
export function groupPersonErrors(errors: string[]): GroupedPersonErrors {
  const grouped: GroupedPersonErrors = {
    name: [],
    side: [],
    functions: [],
    aliases: [],
    general: [],
  };
  for (const error of errors) {
    if (error.startsWith("Informe o nome")) grouped.name.push(error);
    else if (error.startsWith("Selecione o lado")) grouped.side.push(error);
    else if (error.startsWith("Função inválida")) grouped.functions.push(error);
    else if (error.startsWith("Apelido")) grouped.aliases.push(error);
    else grouped.general.push(error);
  }
  return grouped;
}
