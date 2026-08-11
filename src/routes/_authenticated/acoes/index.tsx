import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Pencil, Plus, Search, Timer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { recalculateClient } from "@/lib/api";
import { PageHeader } from "@/components/painel/PageHeader";
import { routeErrorComponent } from "@/components/painel/RouteError";
import { EmptyState, ErrorState, LoadingState } from "@/components/painel/states";
import { ActionStatusBadge } from "@/components/painel/badges";
import { KpiCard } from "@/components/painel/KpiCard";
import { ActionDialog } from "@/components/painel/ActionDialog";
import { useActionsData } from "@/hooks/useCarteira";
import {
  ACTION_STATUSES,
  ERP_AREAS,
  formatDate,
  isOverdue,
  type ActionItem,
} from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/acoes/")({
  head: () => ({
    meta: [
      { title: "Ações | Painel de Saúde da Carteira" },
      {
        name: "description",
        content: "Painel consolidado de ações combinadas, prazos, responsáveis e pendências.",
      },
      { property: "og:title", content: "Ações | Painel de Saúde da Carteira" },
      {
        property: "og:description",
        content: "Acompanhe prazos e responsáveis das ações da consultoria.",
      },
    ],
  }),
  component: ActionsPage,
  errorComponent: routeErrorComponent("Ações"),
});

function ActionsPage() {
  const {
    clients,
    actions,
    riskRules,
    isLoading,
    isSlow,
    error,
    refetchAll,
    clientName,
  } = useActionsData();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [client, setClient] = useState("all");
  const [status, setStatus] = useState("all");
  const [area, setArea] = useState("all");
  const [only, setOnly] = useState("open");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ActionItem | null>(null);

  const complete = useMutation({
    mutationFn: async (action: ActionItem) => {
      const { error: err } = await supabase
        .from("actions")
        .update({ status: "concluída" })
        .eq("id", action.id);
      if (err) throw new Error(err.message);
      await recalculateClient(action.client_id, riskRules);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["actions"] });
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Ação concluída.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return actions
      .filter((a) => {
        if (client !== "all" && a.client_id !== client) return false;
        if (status !== "all" && a.status !== status) return false;
        if (area !== "all" && a.erp_area !== area) return false;
        if (only === "open" && a.status === "concluída") return false;
        if (only === "overdue" && !isOverdue(a)) return false;
        if (
          term &&
          !`${a.description} ${a.owner_name ?? ""} ${clientName(a.client_id)}`
            .toLowerCase()
            .includes(term)
        )
          return false;
        return true;
      })
      .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  }, [actions, client, status, area, only, search, clientName]);

  const overdueCount = actions.filter((a) => isOverdue(a)).length;
  const openCount = actions.filter((a) => a.status !== "concluída").length;
  const doneCount = actions.filter((a) => a.status === "concluída").length;
  const dueSoon = actions.filter((a) => {
    if (a.status === "concluída" || !a.deadline) return false;
    const days = Math.ceil((new Date(a.deadline).getTime() - Date.now()) / 86_400_000);
    return days >= 0 && days <= 7;
  }).length;

  if (error) {
    return (
      <>
        <PageHeader title="Ações" />
        <div className="p-4 md:p-8">
          <ErrorState error={error} onRetry={refetchAll} />
        </div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title="Ações" description="Carregando compromissos" />
        <div className="p-4 md:p-8">
          <LoadingState slow={isSlow} onRetry={refetchAll} variant="list" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Ações" description="Compromissos combinados nas reuniões da carteira">
        <div className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Buscar</Label>
            <div className="relative">
              <Search
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="pl-9"
                placeholder="Ação, responsável ou cliente"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Cliente</Label>
            <Select value={client} onValueChange={setClient}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {ACTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Área do ERP</Label>
            <Select value={area} onValueChange={setArea}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {ERP_AREAS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Exibir</Label>
            <Select value={only} onValueChange={setOnly}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Apenas abertas</SelectItem>
                <SelectItem value="overdue">Apenas vencidas</SelectItem>
                <SelectItem value="all">Todas as ações</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          className="mt-1"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden />
          Nova ação
        </Button>
      </PageHeader>

      <div className="flex flex-col gap-6 p-4 md:p-8">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Ações abertas"
            value={String(openCount)}
            description="Compromissos ainda não concluídos"
            icon={Timer}
          />
          <KpiCard
            label="Ações vencidas"
            value={String(overdueCount)}
            description="Prazo estourado — impacta o risco das contas"
            icon={Timer}
            tone="critical"
          />
          <KpiCard
            label="Vencem em 7 dias"
            value={String(dueSoon)}
            description="Prazos próximos que exigem atenção"
            icon={Timer}
            tone="attention"
          />
          <KpiCard
            label="Concluídas"
            value={String(doneCount)}
            description="Ações entregues no histórico da carteira"
            icon={CheckCircle2}
            tone="healthy"
          />
        </div>

        <div className="card-surface overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState
              title="Nenhuma ação encontrada"
              description="Ajuste os filtros ou crie uma nova ação para a carteira."
              action={
                <Button
                  onClick={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                  Nova ação
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ação</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Prazo</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Área</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Gerenciar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="max-w-72">
                        <span className="line-clamp-2 text-sm">{a.description}</span>
                      </TableCell>
                      <TableCell>
                        <Link
                          to="/clientes/$clientId"
                          params={{ clientId: a.client_id }}
                          className="text-sm font-medium hover:underline"
                        >
                          {clientName(a.client_id)}
                        </Link>
                      </TableCell>
                      <TableCell>{a.owner_name ?? "—"}</TableCell>
                      <TableCell>{formatDate(a.deadline)}</TableCell>
                      <TableCell className="capitalize">{a.priority}</TableCell>
                      <TableCell>{a.erp_area ?? "—"}</TableCell>
                      <TableCell>
                        <ActionStatusBadge status={a.status} overdue={isOverdue(a)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {a.status !== "concluída" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => complete.mutate(a)}
                              disabled={complete.isPending}
                            >
                              <CheckCircle2 className="size-4" aria-hidden />
                              Concluir
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(a);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      <ActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action={editing}
        clients={clients}
        riskRules={riskRules}
      />
    </>
  );
}
