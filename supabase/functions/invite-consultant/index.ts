import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Função não configurada." }, 500);
  }
  if (!authorization) return json({ error: "Sessão não informada." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) return json({ error: "Sessão inválida." }, 401);

  const { data: adminRole, error: roleError } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (roleError) return json({ error: "Não foi possível validar sua permissão." }, 500);
  if (!adminRole) return json({ error: "Apenas administradores podem incluir consultores." }, 403);

  let input: { full_name?: unknown; email?: unknown };
  try {
    input = await request.json();
  } catch {
    return json({ error: "Dados do convite inválidos." }, 400);
  }

  const fullName = typeof input.full_name === "string" ? input.full_name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (fullName.length < 2 || !/^\S+@\S+\.\S+$/.test(email)) {
    return json({ error: "Informe nome e e-mail válidos." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });

  if (error) {
    const duplicate = /already|registered|exists/i.test(error.message);
    return json(
      {
        error: duplicate
          ? "Já existe um acesso cadastrado para este e-mail."
          : "Não foi possível enviar o convite.",
      },
      duplicate ? 409 : 500,
    );
  }

  return json({ id: data.user.id, email: data.user.email, full_name: fullName }, 201);
});
