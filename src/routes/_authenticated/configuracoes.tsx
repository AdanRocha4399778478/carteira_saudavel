import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SlidersHorizontal, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/painel/PageHeader";
import { routeErrorComponent } from "@/components/painel/RouteError";
import { ErrorState, LoadingState } from "@/components/painel/states";
import { useSettingsData } from "@/hooks/useCarteira";
import { useAccess } from "@/lib/auth/access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { InviteConsultantDialog } from "@/components/painel/InviteConsultantDialog";
import { consultantDisplayName } from "@/lib/consultants";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações | Painel de Saúde da Carteira" },
      {
        name: "description",
        content: "Ajuste os pesos dos critérios que compõem o risco de cancelamento das contas.",
      },
      { property: "og:title", content: "Configurações | Painel de Saúde da Carteira" },
      {
        property: "og:description",
        content: "Parâmetros do cálculo de risco da carteira de consultoria.",
      },
    ],
  }),
  component: SettingsPage,
  errorComponent: routeErrorComponent("Configurações"),
});

function SettingsPage() {
  const { riskRules, profiles, isLoading, isSlow, error, refetchAll } = useSettingsData();
  const { access, isAdmin } = useAccess();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, { points: number; active: boolean }>>({});
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    setDraft(
      Object.fromEntries(riskRules.map((r) => [r.id, { points: r.points, active: r.active }])),
    );
  }, [riskRules]);

  const save = useMutation({
    mutationFn: async () => {
      for (const rule of riskRules) {
        const next = draft[rule.id];
        if (!next) continue;
        if (next.points === rule.points && next.active === rule.active) continue;
        const { error: err } = await supabase
          .from("risk_rules")
          .update({ points: next.points, active: next.active })
          .eq("id", rule.id);
        if (err) throw new Error(err.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["risk_rules"] });
      toast.success("Critérios de risco atualizados. Recalcule as contas para aplicar.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (error) {
    return (
      <>
        <PageHeader title="Configurações" />
        <div className="p-4 md:p-8">
          <ErrorState error={error} onRetry={refetchAll} />
        </div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title="Configurações" description="Carregando parâmetros" />
        <div className="p-4 md:p-8">
          <LoadingState slow={isSlow} onRetry={refetchAll} variant="settings" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Configurações"
        description="Sua conta, pesos do cálculo de risco e equipe de consultoria"
      >
        {isAdmin ? (
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <SlidersHorizontal className="size-4" aria-hidden />
            {save.isPending ? "Salvando…" : "Salvar critérios"}
          </Button>
        ) : null}
      </PageHeader>

      <div className="flex flex-col gap-6 p-4 md:p-8">
        <section className="card-surface p-4 md:p-5">
          <h2 className="text-base font-semibold">Minha conta</h2>
          <p className="text-xs text-muted-foreground">
            Dados da sessão atual e permissões concedidas.
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Nome</dt>
              <dd className="text-sm font-medium">{access?.profile?.full_name ?? "—"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">E-mail</dt>
              <dd className="truncate text-sm font-medium">{access?.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Papel</dt>
              <dd className="text-sm font-medium">{isAdmin ? "Administrador" : "Consultor"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            {isAdmin
              ? "Como administrador você enxerga e edita toda a carteira."
              : "Como consultor você enxerga apenas os clientes da sua carteira."}
          </p>
        </section>

        <section className="card-surface p-4 md:p-5">
          <h2 className="text-base font-semibold">Critérios de risco de cancelamento</h2>
          <p className="text-xs text-muted-foreground">
            A soma dos pontos define o nível: até 2 baixo, até 5 médio, até 8 alto, acima disso
            crítico.
          </p>
          {isAdmin ? null : (
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              Somente administradores podem alterar estes parâmetros.
            </p>
          )}
          <div className="mt-4 grid gap-3">
            {riskRules.map((rule) => (
              <div
                key={rule.id}
                className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_6rem_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{rule.rule_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {rule.description ?? rule.rule_key}
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Pontos</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    disabled={!isAdmin}
                    value={draft[rule.id]?.points ?? rule.points}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [rule.id]: {
                          points: Number(e.target.value),
                          active: d[rule.id]?.active ?? rule.active,
                        },
                      }))
                    }
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    disabled={!isAdmin}
                    checked={draft[rule.id]?.active ?? rule.active}
                    onCheckedChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        [rule.id]: { points: d[rule.id]?.points ?? rule.points, active: v },
                      }))
                    }
                  />
                  <span className="text-xs text-muted-foreground">Ativo</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card-surface p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Equipe</h2>
              <p className="text-xs text-muted-foreground">
                Consultores e líderes com acesso ao painel.
              </p>
            </div>
            {isAdmin ? (
              <Button type="button" variant="outline" onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-4" aria-hidden />
                Incluir consultor
              </Button>
            ) : null}
          </div>
          <ul className="mt-4 grid gap-2">
            {profiles.map((p) => (
              <li
                key={p.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{consultantDisplayName(p)}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.email ?? "—"}</p>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">
                  {!p.active ? "Inativo" : p.role === "admin" ? "Administrador" : "Consultor"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <InviteConsultantDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  );
}
