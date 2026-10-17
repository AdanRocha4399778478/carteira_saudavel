/**
 * Erro de retorno de OAuth lido da URL (ver parseAuthErrorFromUrl) — sempre
 * com status fixo 400 (nunca 0), pra nunca cair no ramo de "sem conexão" de
 * authErrorMessage, que trata status 0 como falha de rede.
 */
export type OAuthUrlError = { message: string; status: number };

/**
 * B24 — lê error/error_description de um retorno de OAuth (Supabase manda
 * em query string OU em hash, dependendo do ponto da falha — por isso os
 * dois precisam ser checados). Função pura: recebe o texto bruto de
 * `location.search`/`location.hash`, nunca lê `window` diretamente, pra dar
 * pra testar sem jsdom. Sem erro nenhum na URL, devolve null.
 */
export function parseAuthErrorFromUrl(search: string, hash: string): OAuthUrlError | null {
  const searchParams = new URLSearchParams(search);
  const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
  const code = searchParams.get("error") || hashParams.get("error");
  const description = searchParams.get("error_description") || hashParams.get("error_description");
  if (!code && !description) return null;
  // Junta código e descrição pra o casamento de texto em authErrorMessage
  // funcionar tanto por um quanto pelo outro (ex.: "access_denied: ...").
  const message = [code, description].filter(Boolean).join(": ");
  return { message, status: 400 };
}

/**
 * Tradução de erros do Supabase Auth para mensagens claras, sem revelar se um
 * e-mail existe (evita enumeração de usuários).
 */
export function authErrorMessage(
  error: { message?: string | undefined; status?: number | undefined } | null,
  context?: "oauth",
): string {
  if (!error) return "Não foi possível concluir a operação.";
  const raw = (error.message ?? "").toLowerCase();
  const status = error.status ?? 0;

  // B24 — contexto "oauth" (só o retorno do login com Google) é tratado
  // inteiramente aqui, com `return` antes de qualquer ramo abaixo: nenhum
  // ramo de oauth pode cair nos ramos genéricos por status (ex.: status 0
  // = "sem conexão", status 400 = "e-mail ou senha incorretos") que não
  // fazem sentido nesse contexto e que parseAuthErrorFromUrl nem usa do
  // jeito que esses ramos esperam.
  if (context === "oauth") {
    if (raw.includes("signups not allowed") || raw.includes("signup is disabled")) {
      return "Este e-mail Google não tem acesso. Use o e-mail cadastrado ou entre com senha.";
    }
    if (raw.includes("access_denied")) {
      return "Login com Google cancelado ou não autorizado.";
    }
    return "Não foi possível concluir a operação. Tente novamente.";
  }

  if (raw.includes("failed to fetch") || raw.includes("network") || status === 0) {
    return "Sem conexão com o servidor. Verifique sua rede e tente novamente.";
  }
  if (raw.includes("invalid login credentials") || status === 400) {
    return "E-mail ou senha incorretos.";
  }
  if (raw.includes("email not confirmed")) {
    return "Este acesso ainda não foi confirmado. Procure um administrador do painel.";
  }
  if (raw.includes("rate limit") || status === 429) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.";
  }
  if (raw.includes("expired") || raw.includes("invalid token") || status === 401) {
    return "Sua sessão expirou. Entre novamente.";
  }
  if (raw.includes("weak") || raw.includes("password should be")) {
    return "Senha muito fraca. Use pelo menos 8 caracteres com letras e números.";
  }
  if (raw.includes("signups not allowed") || raw.includes("signup is disabled")) {
    return "Cadastro público desabilitado. Solicite acesso a um administrador.";
  }
  if (status >= 500) {
    return "O servidor de autenticação está indisponível no momento. Tente novamente em instantes.";
  }
  return "Não foi possível concluir a operação. Tente novamente.";
}
