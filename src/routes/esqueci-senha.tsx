import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import { authErrorMessage } from "@/lib/auth/messages";

export const Route = createFileRoute("/esqueci-senha")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Recuperar acesso | Painel de Saúde da Carteira" },
      {
        name: "description",
        content: "Receba um link por e-mail para redefinir a senha do painel interno da carteira.",
      },
      { property: "og:title", content: "Recuperar acesso | Painel de Saúde da Carteira" },
      {
        property: "og:description",
        content: "Redefinição de senha para consultores e líderes da Resultados S/A.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setLoading(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    // Resposta idêntica exista ou não a conta: evita enumeração de usuários.
    setSent(true);
  }

  return (
    <AuthShell
      title="Recuperar acesso"
      description="Enviamos um link de redefinição para o seu e-mail corporativo."
    >
      {sent ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-attention-soft p-4 text-sm">
            <p className="font-semibold">Verifique seu e-mail</p>
            <p className="mt-1 text-muted-foreground">
              Se <strong>{email}</strong> estiver cadastrado, o link de redefinição chega em
              instantes. O link expira por segurança — solicite outro se necessário.
            </p>
          </div>
          <Button variant="outline" onClick={() => router.navigate({ to: "/auth" })}>
            Voltar ao login
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email-reset">E-mail</Label>
            <Input
              id="email-reset"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={loading || !email}>
            <ShieldCheck className="size-4" aria-hidden />
            {loading ? "Enviando…" : "Enviar link de redefinição"}
          </Button>
          <Link to="/auth" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            Voltar ao login
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
