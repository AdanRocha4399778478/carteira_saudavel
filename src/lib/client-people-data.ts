import { queryOptions } from "@tanstack/react-query";
import { logDbError } from "@/lib/api";
import { supabase } from "@/lib/supabase/client";
import type { ClientPerson, PersonFunction, PersonSide } from "@/lib/client-people";

/* ------------------------------------------------------------------ *
 * Cadastro de pessoas e apelidos por cliente — Gate C/D (19/10/2026).
 * Leitura e gravação de public.client_people (migration 20261019140000,
 * já aplicada). Delete é restrito a administrador pela RLS do banco — esta
 * camada só traduz o erro; a tela é quem esconde o botão para os demais.
 * ------------------------------------------------------------------ */

const CLIENT_PEOPLE_COLUMNS =
  "id, client_id, name, aliases, side, role, functions, active, created_by, created_at, updated_at";

type SupabaseErrorLike = { message: string; code?: string | null; details?: string | null };

/**
 * Traduz os dois erros de domínio do gatilho de `client_people` (ver
 * migration 20261019140000): 23505 (nome/apelido repetido no mesmo cliente)
 * e 23514 (nome/apelido sem nenhuma letra ou número). O gatilho já inclui o
 * nome do dono do conflito na mensagem de 23505 ("nome ou apelido já usado
 * por <nome> neste cliente") — usamos essa mensagem quando ela vem assim,
 * em vez de um texto genérico sem essa informação.
 */
export function translateClientPersonError(error: SupabaseErrorLike): string {
  if (error.code === "23505") {
    if (/nome ou apelido já usado por/i.test(error.message)) {
      return `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}.`;
    }
    return "Este nome ou apelido já é usado por outra pessoa deste cliente.";
  }
  if (error.code === "23514") {
    return "Nome ou apelido precisa ter letras ou números.";
  }
  return error.message;
}

export const clientPeopleQuery = (clientId: string) =>
  queryOptions({
    queryKey: ["client-people", "client", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<ClientPerson[]> => {
      const res = await supabase
        .from("client_people")
        .select(CLIENT_PEOPLE_COLUMNS)
        .eq("client_id", clientId)
        .order("name", { ascending: true });
      if (res.error) {
        logDbError("client_people", "select-client", res.error);
        throw new Error(translateClientPersonError(res.error));
      }
      return (res.data ?? []) as unknown as ClientPerson[];
    },
  });

export type CreateClientPersonInput = {
  client_id: string;
  name: string;
  aliases: string[];
  side: PersonSide;
  role: string | null;
  functions: PersonFunction[];
};

export async function createClientPerson(input: CreateClientPersonInput): Promise<ClientPerson> {
  const res = await supabase
    .from("client_people")
    .insert({
      client_id: input.client_id,
      name: input.name,
      aliases: input.aliases,
      side: input.side,
      role: input.role,
      functions: input.functions,
    })
    .select(CLIENT_PEOPLE_COLUMNS)
    .single();
  if (res.error) {
    logDbError("client_people", "insert", res.error);
    throw new Error(translateClientPersonError(res.error));
  }
  return res.data as unknown as ClientPerson;
}

export type UpdateClientPersonInput = Partial<{
  name: string;
  aliases: string[];
  side: PersonSide;
  role: string | null;
  functions: PersonFunction[];
  active: boolean;
}>;

export async function updateClientPerson(
  id: string,
  patch: UpdateClientPersonInput,
): Promise<ClientPerson> {
  const res = await supabase
    .from("client_people")
    .update(patch)
    .eq("id", id)
    .select(CLIENT_PEOPLE_COLUMNS)
    .single();
  if (res.error) {
    logDbError("client_people", "update", res.error);
    throw new Error(translateClientPersonError(res.error));
  }
  return res.data as unknown as ClientPerson;
}

/** Só administrador — a RLS do banco (app_private.is_admin()) já recusa os demais. */
export async function deleteClientPerson(id: string): Promise<void> {
  const res = await supabase.from("client_people").delete().eq("id", id);
  if (res.error) {
    logDbError("client_people", "delete", res.error);
    throw new Error(translateClientPersonError(res.error));
  }
}
