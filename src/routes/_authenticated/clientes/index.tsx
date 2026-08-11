import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowUpRight, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/painel/PageHeader";
import { routeErrorComponent } from "@/components/painel/RouteError";
import { EmptyState, ErrorState, LoadingState } from "@/components/painel/states";
import {
  AccountStatusBadge,
  QuadrantBadge,
  RiskBadge,
} from "@/components/painel/badges";
import { ClientDialog } from "@/components/painel/ClientDialog";
import { useClientsData } from "@/hooks/useCarteira";
import { ACCOUNT_STATUSES, RISK_LEVELS, formatDate, formatScore } from "@/lib/domain";
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

export const Route = createFileRoute("/_authenticated/clientes/")({
  head: () => ({
    meta: [
      { title: "Clientes | Painel de Saúde da Carteira" },
      {
        name: "description",
        content: "Lista completa das contas de consultoria com satisfação, valor gerado e risco.",
      },
      { property: "og:title", content: "Clientes | Painel de Saúde da Carteira" },
      {
        property: "og:description",
        content: "Gerencie as contas de consultoria da Resultados S/A.",
      },
    ],
  }),
  component: ClientsPage,
  errorComponent: routeErrorComponent("Clientes"),
});

type SortKey = "risk" | "satisfaction" | "value" | "name" | "meeting";

function ClientsPage() {
  const {
    clients,
    profiles,
    isLoading,
    isSlow,
    error,
    refetchAll,
    consultantName,
    overdueByClient,
    openActionsByClient,
  } = useClientsData();

  const [search, setSearch] = useState("");
  const [consultant, setConsultant] = useState("all");
  const [status, setStatus] = useState("all");
  const [risk, setRisk] = useState("all");
  const [sort, setSort] = useState<SortKey>("risk");
  const [dialogOpen, setDialogOpen] = useState(false);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = clients.filter((c) => {
      if (term && !`${c.company_name} ${c.segment ?? ""}`.toLowerCase().includes(term)) return false;
      if (consultant !== "all" && c.consultant_id !== consultant) return false;
      if (status !== "all" && c.account_status !== status) return false;
      if (risk !== "all" && c.current_risk_level !== risk) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (sort === "name") return a.company_name.localeCompare(b.company_name);
      if (sort === "satisfaction")
        return Number(a.current_satisfaction ?? 99) - Number(b.current_satisfaction ?? 99);
      if (sort === "value")
        return Number(a.current_value_score ?? 99) - Number(b.current_value_score ?? 99);
      if (sort === "meeting")
        return (a.last_meeting_date ?? "0000").localeCompare(b.last_meeting_date ?? "0000");
      return b.current_risk_score - a.current_risk_score;
    });
  }, [clients, search, consultant, status, risk, sort]);

  if (error) {
    return (
      <>
        <PageHeader title="Clientes" />
        <div className="p-4 md:p-8">
          <ErrorState error={error} onRetry={refetchAll} />
        </div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title="Clientes" description="Carregando carteira" />
        <div className="p-4 md:p-8">
          <LoadingState slow={isSlow} onRetry={refetchAll} variant="list" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Clientes"
        description={`${clients.length} contas cadastradas na carteira`}
      >
        <div className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="grid gap-1.5 xl:col-span-2">
            <Label className="text-xs text-muted-foreground">Buscar</Label>
            <div className="relative">
              <Search
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="pl-9"
                placeholder="Empresa ou segmento"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Consultor</Label>
            <Select value={consultant} onValueChange={setConsultant}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name}
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
                {ACCOUNT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Risco</Label>
            <Select value={risk} onValueChange={setRisk}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {RISK_LEVELS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Ordenar por</Label>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="risk">Maior risco</SelectItem>
                <SelectItem value="satisfaction">Menor satisfação</SelectItem>
                <SelectItem value="value">Menor valor gerado</SelectItem>
                <SelectItem value="meeting">Reunião mais antiga</SelectItem>
                <SelectItem value="name">Nome da empresa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="mt-1">
          <Plus className="size-4" aria-hidden />
          Novo cliente
        </Button>
      </PageHeader>

      <div className="p-4 md:p-8">
        <div className="card-surface min-w-0 overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState
              title="Nenhum cliente encontrado"
              description="Ajuste a busca e os filtros ou cadastre uma nova conta de consultoria."
              action={
                <Button onClick={() => setDialogOpen(true)}>
                  <Plus className="size-4" aria-hidden />
                  Novo cliente
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Consultor</TableHead>
                    <TableHead>Satisfação</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Risco</TableHead>
                    <TableHead>Quadrante</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Última reunião</TableHead>
                    <TableHead>Ações abertas</TableHead>
                    <TableHead className="text-right">Detalhes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          {c.company_name}
                          <span className="text-xs text-muted-foreground">{c.segment ?? "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {consultantName(c.consultant_id)}
                      </TableCell>
                      <TableCell>{formatScore(c.current_satisfaction)}</TableCell>
                      <TableCell>{formatScore(c.current_value_score)}</TableCell>
                      <TableCell>
                        <RiskBadge level={c.current_risk_level} score={c.current_risk_score} />
                      </TableCell>
                      <TableCell>
                        <QuadrantBadge quadrant={c.current_quadrant} />
                      </TableCell>
                      <TableCell>
                        <AccountStatusBadge status={c.account_status} />
                      </TableCell>
                      <TableCell>{formatDate(c.last_meeting_date)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col text-sm">
                          {openActionsByClient.get(c.id)?.length ?? 0} abertas
                          {(overdueByClient.get(c.id) ?? 0) > 0 ? (
                            <span className="text-xs font-semibold text-critical">
                              {overdueByClient.get(c.id)} vencida(s)
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" size="sm">
                          <Link to="/clientes/$clientId" params={{ clientId: c.id }}>
                            Abrir
                            <ArrowUpRight className="size-4" aria-hidden />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      <ClientDialog open={dialogOpen} onOpenChange={setDialogOpen} consultants={profiles} />
    </>
  );
}
