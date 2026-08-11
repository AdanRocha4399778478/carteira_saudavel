import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import { authErrorMessage } from "@/lib/auth/messages";

export const Route = createFileRoute("/redefinir-senha")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Definir nova senha | Painel de Saúde da Carteira" },
      {
        name: "description",
        content: "Defina uma nova senha de acesso ao painel interno de saúde da carteira.",
      },
      { property: "og:title", content: "Definir nova senha | Painel de Saúde da Carteira" },
      {
        property: "og:description",
        content: "Conclusão da recuperação de senha do painel da Resultados S/A.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

const MIN_LENGTH = 8;

function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<"checking" | "valid" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // O link de recuperação entrega uma sessão temporária (evento PASSWORD_RECOVERY).
  useEffect(() => {
    let active = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) setReady("valid");
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setReady((current) => (data.session ? "valid" : current === "valid" ? "valid" : "invalid"));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`Use pelo menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    toast.success("Senha atualizada. Entre novamente.");
    await supabase.auth.signOut();
    await router.navigate({ to: "/auth", replace: true });
  }

  return (
    <AuthShell title="Definir nova senha" description="Escolha uma senha forte e exclusiva.">
      {ready === "invalid" ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-attention-soft p-4 text-sm">
            <p className="font-semibold">Link inválido ou expirado</p>
            <p className="mt-1 text-muted-foreground">
              Solicite um novo link de redefinição para continuar.
            </p>
          </div>
          <Button onClick={() => router.navigate({ to: "/esqueci-senha" })}>
            Solicitar novo link
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="new-password">Nova senha</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">Confirmar nova senha</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={loading || ready !== "valid"}>
            {loading ? "Salvando…" : "Salvar nova senha"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
