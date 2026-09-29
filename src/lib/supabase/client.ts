import { createClient } from "@supabase/supabase-js";

import { SUPABASE_PUBLIC_ANON_KEY, SUPABASE_PUBLIC_URL } from "./public-config";
import type { Database } from "./types";

const env = import.meta.env as Record<string, string | undefined>;

const envUrl = env["VITE_SUPABASE_URL"];
const envAnonKey = env["VITE_SUPABASE_ANON_KEY"] || env["VITE_SUPABASE_PUBLISHABLE_KEY"];

// Em Preview, nunca cair no fallback de produção de `public-config.ts` só
// porque as env vars de Preview não foram configuradas — isso faria o
// deploy de teste ler e escrever dados reais silenciosamente. Falha visível
// (erro no console + app não sobe) é preferível a isso em qualquer cenário.
if (import.meta.env["VITE_APP_ENV"] === "preview" && !(envUrl && envAnonKey)) {
  throw new Error(
    "Preview sem VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY configuradas — recusando usar as credenciais de produção como fallback.",
  );
}

const url = envUrl || SUPABASE_PUBLIC_URL;
const anonKey = envAnonKey || SUPABASE_PUBLIC_ANON_KEY;

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
