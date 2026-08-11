import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AppSidebar } from "@/components/painel/AppSidebar";
import { ErrorState, HeaderSkeleton, LoadingState } from "@/components/painel/states";
import { classifyError, errorMessageOf, logQueryError } from "@/lib/query-errors";

const AUTH_RETRIES = 2;
const AUTH_RETRY_DELAY_MS = 400;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A restauração da sessão do Supabase pode falhar por rede/latência.
 * Falha transitória NÃO significa "usuário deslogado": só redirecionamos
 * para /auth quando não existe sessão persistida; erros de rede são
 * retentados e, se persistirem, mostrados como erro localizado no shell.
 */
async function resolveSession(): Promise<Session | null> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= AUTH_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session) return null;

      const verified = await supabase.auth.getUser();
      if (verified.error) {
        // 401/403 definitivo = sessão inválida; transitório = nova tentativa.
        if (classifyError(verified.error) === "permanent") return null;
        throw verified.error;
      }
      return verified.data.user ? data.session : null;
    } catch (error) {
      lastError = error;
      if (classifyError(error) === "permanent") throw error;
      if (attempt < AUTH_RETRIES) await sleep(AUTH_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Falha ao restaurar a sessão");
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const session = await resolveSession();
    if (!session) throw redirect({ to: "/auth" });
    return { user: session.user };
  },
  component: ProtectedLayout,
  pendingComponent: AuthPending,
  errorComponent: AuthError,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <div className="sticky top-0 h-dvh">
        <AppSidebar />
      </div>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

function ProtectedLayout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

/** Autenticação em andamento: shell + skeleton, nunca tela de erro. */
function AuthPending() {
  return (
    <Shell>
      <HeaderSkeleton filters={0} />
      <div className="p-4 md:p-8">
        <LoadingState label="Verificando sua sessão…" variant="dashboard" />
      </div>
    </Shell>
  );
}

function AuthError({ error, reset }: { error: Error; reset: () => void }) {
  logQueryError(error, { scope: "auth:_authenticated" });
  return (
    <Shell>
      <div className="p-4 md:p-8">
        <ErrorState
          error={error}
          title="Não conseguimos confirmar sua sessão"
          message={`${errorMessageOf(error)} Sua sessão foi preservada — tente novamente.`}
          onRetry={reset}
        />
      </div>
    </Shell>
  );
}
