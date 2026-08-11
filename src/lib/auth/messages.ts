/**
 * Tradução de erros do Supabase Auth para mensagens claras, sem revelar se um
 * e-mail existe (evita enumeração de usuários).
 */
export function authErrorMessage(error: { message?: string; status?: number } | null): string {
  if (!error) return "Não foi possível concluir a operação.";
  const raw = (error.message ?? "").toLowerCase();
  const status = error.status ?? 0;

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
