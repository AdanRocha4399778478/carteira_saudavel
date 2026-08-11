import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;

export const BACKEND_CONFIG_ERROR = "Configuração do backend não encontrada.";

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured && typeof window !== "undefined") {
  console.error(BACKEND_CONFIG_ERROR);
}

/**
 * Cliente único da aplicação. Usa exclusivamente chaves públicas.
 * Nenhuma chave privada deve ser utilizada no navegador.
 */
export const supabase = createClient<Database>(url ?? "http://localhost", anonKey ?? "anon", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "carteira-saudavel-auth",
  },
});
