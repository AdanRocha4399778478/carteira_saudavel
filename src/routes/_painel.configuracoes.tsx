import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/shared/page-header";
import { useAuth } from "@/features/auth/hooks/use-auth";

export const Route = createFileRoute("/_painel/configuracoes")({
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const { user, perfil } = useAuth();

  return (
    <>
      <PageHeader titulo="Configurações" descricao="Dados da sessão atual." />
      <dl className="max-w-md space-y-3 rounded-lg border border-border bg-card p-5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">E-mail</dt>
          <dd className="truncate">{user?.email ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Nome</dt>
          <dd className="truncate">{perfil?.fullName ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Perfil</dt>
          <dd className="truncate">{perfil?.role ?? "—"}</dd>
        </div>
      </dl>
    </>
  );
}
