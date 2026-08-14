import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "./types";

/**
 * Middleware de servidor: valida o bearer token enviado pelo navegador e
 * expõe um cliente Supabase que age como o usuário autenticado (RLS aplicada).
 * Usa apenas variáveis de ambiente do próprio projeto — sem vínculo externo.
 */

function isOpaqueApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // Chaves novas do Supabase são opacas, não são JWT.
    if (isOpaqueApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const supabaseUrl = process.env["SUPABASE_URL"];
    const supabaseKey = process.env["SUPABASE_PUBLISHABLE_KEY"];

    if (!supabaseUrl || !supabaseKey) {
      const message = "Configuração do backend não encontrada.";
      console.error(`[supabase] ${message}`);
      throw new Error(message);
    }

    const request = getRequest();
    const authHeader = request?.headers?.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new Error("Não autorizado: sessão ausente.");
    }

    const token = authHeader.slice("Bearer ".length);
    if (!token || token.split(".").length !== 3) {
      throw new Error("Não autorizado: token inválido.");
    }

    const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
      global: {
        fetch: createSupabaseFetch(supabaseKey),
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      throw new Error("Não autorizado: token inválido.");
    }

    return next({
      context: {
        supabase,
        userId: data.claims.sub,
        claims: data.claims,
      },
    });
  },
);
