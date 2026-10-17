import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { authErrorMessage, parseAuthErrorFromUrl } from "../src/lib/auth/messages";

/* ------------------------------------------------------------------ *
 * Backlog B24 (17/10/2026) — botão "Entrar com Google" e tratamento de
 * erro de retorno. O cadastro público é fechado no painel do Supabase
 * (fora deste repo): este fluxo nunca cria usuário novo, só entra com
 * conta já existente. Login por senha continua intocado.
 * ------------------------------------------------------------------ */

function read(path: string): string {
  return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("authErrorMessage — ramo novo só no contexto 'oauth' (B24)", () => {
  test("'signups not allowed' + contexto oauth: mensagem específica do Google", () => {
    expect(authErrorMessage({ message: "Signups not allowed for this instance" }, "oauth")).toBe(
      "Este e-mail Google não tem acesso. Use o e-mail cadastrado ou entre com senha.",
    );
  });

  test("'signup is disabled' + contexto oauth: mesma mensagem específica", () => {
    expect(authErrorMessage({ message: "Signup is disabled" }, "oauth")).toBe(
      "Este e-mail Google não tem acesso. Use o e-mail cadastrado ou entre com senha.",
    );
  });

  test("MESMA mensagem de erro SEM contexto oauth: continua a mensagem genérica de sempre (login/cadastro por senha intocados)", () => {
    expect(
      authErrorMessage({ message: "Signups not allowed for this instance", status: 422 }),
    ).toBe("Cadastro público desabilitado. Solicite acesso a um administrador.");
  });

  test("erro desconhecido, mesmo com contexto oauth: cai no texto genérico, nunca no texto técnico cru", () => {
    const msg = authErrorMessage(
      { message: "some_unmapped_provider_error_xyz", status: 422 },
      "oauth",
    );
    expect(msg).toBe("Não foi possível concluir a operação. Tente novamente.");
    expect(msg).not.toContain("xyz");
  });

  test("credencial inválida (login por senha) continua igual, sem relação com o ramo oauth", () => {
    expect(authErrorMessage({ message: "Invalid login credentials", status: 400 })).toBe(
      "E-mail ou senha incorretos.",
    );
  });

  test("'access_denied' + contexto oauth: login cancelado/não autorizado", () => {
    expect(authErrorMessage({ message: "access_denied: o usuário negou o acesso" }, "oauth")).toBe(
      "Login com Google cancelado ou não autorizado.",
    );
  });

  test("nenhum ramo de oauth devolve 'Sem conexão com o servidor' — nem para status 0 nem para mensagem de rede", () => {
    expect(authErrorMessage({ message: "failed to fetch" }, "oauth")).not.toBe(
      "Sem conexão com o servidor. Verifique sua rede e tente novamente.",
    );
    expect(authErrorMessage({ message: "qualquer coisa", status: 0 }, "oauth")).not.toBe(
      "Sem conexão com o servidor. Verifique sua rede e tente novamente.",
    );
  });
});

describe("parseAuthErrorFromUrl — função pura (B24, correção do defeito de status)", () => {
  test("'signups not allowed' vindo em search", () => {
    expect(
      parseAuthErrorFromUrl(
        "?error=access_denied&error_description=Signups%20not%20allowed%20for%20this%20instance",
        "",
      ),
    ).toEqual({ message: "access_denied: Signups not allowed for this instance", status: 400 });
  });

  test("'signups not allowed' vindo em hash (não em search)", () => {
    expect(
      parseAuthErrorFromUrl(
        "",
        "#error=access_denied&error_description=Signups%20not%20allowed%20for%20this%20instance",
      ),
    ).toEqual({ message: "access_denied: Signups not allowed for this instance", status: 400 });
  });

  test("'access_denied' sem descrição (ex.: usuário cancelou a tela do Google)", () => {
    expect(parseAuthErrorFromUrl("?error=access_denied", "")).toEqual({
      message: "access_denied",
      status: 400,
    });
  });

  test("sem error nem error_description em search nem hash: devolve null", () => {
    expect(parseAuthErrorFromUrl("", "")).toBeNull();
    expect(parseAuthErrorFromUrl("?foo=bar", "#baz=qux")).toBeNull();
  });
});

describe("Caminho real completo — parseAuthErrorFromUrl + authErrorMessage, sem status manual (reproduz o defeito corrigido)", () => {
  test("'signups not allowed' em search: mensagem específica do Google, nunca 'sem conexão'", () => {
    const urlError = parseAuthErrorFromUrl(
      "?error=access_denied&error_description=Signups+not+allowed+for+this+instance",
      "",
    );
    expect(urlError).not.toBeNull();
    const msg = authErrorMessage(urlError, "oauth");
    expect(msg).toBe(
      "Este e-mail Google não tem acesso. Use o e-mail cadastrado ou entre com senha.",
    );
  });

  test("'signups not allowed' em hash: mesmo resultado", () => {
    const urlError = parseAuthErrorFromUrl(
      "",
      "#error=access_denied&error_description=Signups+not+allowed+for+this+instance",
    );
    const msg = authErrorMessage(urlError, "oauth");
    expect(msg).toBe(
      "Este e-mail Google não tem acesso. Use o e-mail cadastrado ou entre com senha.",
    );
  });

  test("'access_denied' puro (cancelou a tela do Google): mensagem de cancelado, NUNCA 'sem conexão'", () => {
    const urlError = parseAuthErrorFromUrl("?error=access_denied", "");
    const msg = authErrorMessage(urlError, "oauth");
    expect(msg).toBe("Login com Google cancelado ou não autorizado.");
    expect(msg).not.toBe("Sem conexão com o servidor. Verifique sua rede e tente novamente.");
  });

  test("erro desconhecido da URL: cai no texto genérico, nunca no texto técnico cru e nunca 'sem conexão'", () => {
    const urlError = parseAuthErrorFromUrl(
      "?error=server_error&error_description=unexpected_provider_failure_xyz",
      "",
    );
    const msg = authErrorMessage(urlError, "oauth");
    expect(msg).toBe("Não foi possível concluir a operação. Tente novamente.");
    expect(msg).not.toContain("xyz");
    expect(msg).not.toBe("Sem conexão com o servidor. Verifique sua rede e tente novamente.");
  });

  test("sem erro na URL: parseAuthErrorFromUrl devolve null, nada é mostrado", () => {
    expect(parseAuthErrorFromUrl("", "")).toBeNull();
  });
});

describe("GATE — src/routes/auth.tsx: botão Google, type=button, redirectTo, login por senha intocado (B24)", () => {
  const source = read("../src/routes/auth.tsx");

  test("signInWithOAuth chamado com provider 'google' e redirectTo para /auth", () => {
    expect(source).toContain('provider: "google"');
    expect(source).toContain("redirectTo: `${window.location.origin}/auth`");
  });

  test('o botão é type="button" (nunca dispara o submit do formulário de senha)', () => {
    expect(source).toContain('<Button type="button" variant="outline" onClick={signInWithGoogle}>');
  });

  test("nenhuma imagem nem variante de cor nova — reaproveita o componente Button e a variante 'outline' já existente", () => {
    expect(source).not.toContain("<img");
    expect(source).not.toMatch(/variant=["'](?!outline|default|secondary|destructive|ghost|link)/);
  });

  test("o login por senha continua chamando signInWithPassword, sem alteração na função signIn", () => {
    expect(source).toContain("async function signIn(e: React.FormEvent) {");
    expect(source).toContain(
      "const { error } = await supabase.auth.signInWithPassword({ email, password });",
    );
  });

  test("leitura de erro de retorno chama parseAuthErrorFromUrl com search E hash", () => {
    expect(source).toContain("parseAuthErrorFromUrl(window.location.search, window.location.hash)");
  });

  test("erro de retorno usa authErrorMessage com o contexto 'oauth'", () => {
    expect(source).toContain('toast.error(authErrorMessage(urlError, "oauth"));');
  });

  test("a URL é limpa com history.replaceState, sem recarregar a página", () => {
    expect(source).toContain(
      'window.history.replaceState(window.history.state, "", url.toString());',
    );
  });

  test("não cria rota de callback dedicada: continua importando só a rota /auth existente (nenhum novo arquivo de rota)", () => {
    expect(source).toContain('createFileRoute("/auth")');
  });

  test("usa o cliente Supabase vivo (src/lib/supabase/client), nunca a árvore morta src/integrations/supabase", () => {
    expect(source).toContain('import { supabase } from "@/lib/supabase/client";');
    expect(source).not.toContain("integrations/supabase");
  });
});

describe("GATE — src/lib/auth/messages.ts: parseAuthErrorFromUrl lê search E hash (B24)", () => {
  const source = read("../src/lib/auth/messages.ts");

  test("lê de search e de hash, status sempre fixo em 400 (nunca 0)", () => {
    expect(source).toContain("new URLSearchParams(search)");
    expect(source).toContain('new URLSearchParams(hash.replace(/^#/, ""))');
    expect(source).toContain("status: 400");
  });
});

describe("GATE — src/lib/supabase/client.ts não foi alterado para ligar PKCE (fluxo continua implicit)", () => {
  test("detectSessionInUrl continua true, sem flowType novo (confirma o fluxo implicit já documentado)", () => {
    const source = read("../src/lib/supabase/client.ts");
    expect(source).toContain("detectSessionInUrl: true");
    expect(source).not.toContain("flowType");
  });
});
