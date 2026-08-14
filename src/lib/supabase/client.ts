import { createClient } from "@supabase/supabase-js";

import { SUPABASE_PUBLIC_ANON_KEY, SUPABASE_PUBLIC_URL } from "./public-config";
import type { Database } from "./types";

const env = import.meta.env as Record<string, string | undefined>;

const url = env["VITE_SUPABASE_URL"] || SUPABASE_PUBLIC_URL;
const anonKey =
  env["VITE_SUPABASE_ANON_KEY"] || env["VITE_SUPABASE_PUBLISHABLE_KEY"] || SUPABASE_PUBLIC_ANON_KEY;

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
