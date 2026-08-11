import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuthShell } from "@/components/auth/AuthShell";
import { authErrorMessage } from "@/lib/auth/messages";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Acesso | Painel de Saúde da Carteira" },
      {
        name: "description",
        content: "Entre no painel interno de saúde da carteira da Resultados S/A.",
      },
      { property: "og:title", content: "Acesso | Painel de Saúde da Carteira" },
      { property: "og:description", content: "Acesso restrito a consultores e líderes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

// Cadastro público desabilitado por padrão: usuários devem ser convidados por um
// administrador. Habilite explicitamente com VITE_ENABLE_PUBLIC_SIGNUP="true".
const PUBLIC_SIGNUP_ENABLED = import.meta.env['VITE_ENABLE_PUBLIC_SIGNUP'] === "true";

function AuthPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Informe e-mail e senha.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Bem-vindo de volta!");
    await router.navigate({ to: "/visao-geral" });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName || !email || password.length < 6) {
      toast.error("Preencha nome, e-mail e uma senha com pelo menos 6 caracteres.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/visao-geral`,
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data.session) {
      setPendingConfirmation(true);
      toast.info("Confirme seu e-mail para ativar o acesso.");
      return;
    }
    toast.success("Conta criada com sucesso.");
    await router.navigate({ to: "/visao-geral" });
  }


  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div>
            <p className="font-display font-bold">Resultados S/A</p>
            <p className="text-xs text-sidebar-foreground/60">Uso interno</p>
          </div>
        </div>
        <div className="max-w-md">
          <h2 className="font-display text-3xl leading-tight font-bold">
            Painel de Saúde da Carteira
          </h2>
          <p className="mt-3 text-sm text-sidebar-foreground/70">
            Satisfação do empresário, valor gerado e risco de cancelamento em uma única visão
            executiva — para decidir onde atuar primeiro.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">
          Acesso restrito a consultores e líderes da Resultados S/A.
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="card-surface w-full max-w-md p-6">
          <h1 className="font-display text-xl font-bold">Acessar o painel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use seu e-mail corporativo e senha.
          </p>
          <Tabs defaultValue="entrar" className="mt-6">
            {PUBLIC_SIGNUP_ENABLED ? (
              <TabsList className="w-full">
                <TabsTrigger value="entrar" className="flex-1">
                  Entrar
                </TabsTrigger>
                <TabsTrigger value="criar" className="flex-1">
                  Criar conta
                </TabsTrigger>
              </TabsList>
            ) : null}

            <TabsContent value="entrar">
              <form onSubmit={signIn} className="flex flex-col gap-4 pt-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Senha</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  {loading ? "Entrando…" : "Entrar"}
                </Button>
                {PUBLIC_SIGNUP_ENABLED ? null : (
                  <p className="text-xs text-muted-foreground">
                    Novos acessos são criados por um administrador do painel.
                  </p>
                )}
              </form>
            </TabsContent>

            {PUBLIC_SIGNUP_ENABLED ? (
              <TabsContent value="criar">
                {pendingConfirmation ? (
                  <div className="flex flex-col gap-2 rounded-xl bg-attention-soft p-4 text-sm">
                    <p className="font-semibold">Confirmação de e-mail pendente</p>
                    <p className="text-muted-foreground">
                      Enviamos um link de confirmação para <strong>{email}</strong>. Confirme o
                      e-mail e depois faça login na aba “Entrar”.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={signUp} className="flex flex-col gap-4 pt-4">
                    <div className="grid gap-2">
                      <Label htmlFor="name">Nome completo</Label>
                      <Input
                        id="name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="email-new">E-mail</Label>
                      <Input
                        id="email-new"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="password-new">Senha</Label>
                      <Input
                        id="password-new"
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                    <Button type="submit" disabled={loading}>
                      {loading ? "Criando…" : "Criar conta"}
                    </Button>
                  </form>
                )}
              </TabsContent>
            ) : null}
          </Tabs>

        </div>
      </div>
    </div>
  );
}
