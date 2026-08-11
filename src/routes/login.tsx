import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { isSupabaseConfigured, BACKEND_CONFIG_ERROR } from "@/lib/supabase/client";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar — Carteira Saudável" },
      { name: "description", content: "Acesso restrito à plataforma Carteira Saudável." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { entrar, session, carregando } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (session) void navigate({ to: "/visao-geral", replace: true });
  }, [session, navigate]);

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email, senha);
      await navigate({ to: "/visao-geral", replace: true });
    } catch {
      setErro("E-mail ou senha inválidos.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-primary" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">Carteira Saudável</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">Acessar plataforma</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Use suas credenciais corporativas para continuar.
        </p>

        {!isSupabaseConfigured && (
          <p className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {BACKEND_CONFIG_ERROR}
          </p>
        )}

        <form onSubmit={aoEnviar} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="senha">Senha</Label>
            <Input
              id="senha"
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </div>

          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={enviando || carregando}>
            {enviando ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </div>
    </main>
  );
}
