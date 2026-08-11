import { createMiddleware } from "@tanstack/react-start";

import { supabase } from "./client";

/**
 * Anexa o access token da sessão atual às chamadas de server functions.
 * Registrado como `functionMiddleware` global em src/start.ts.
 */
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return next({
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
});
