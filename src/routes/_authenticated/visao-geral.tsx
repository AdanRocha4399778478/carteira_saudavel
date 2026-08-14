import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CalendarClock,
  Flame,
  Gauge,
  Lightbulb,
  ShieldAlert,
  Smile,
  Timer,
} from "lucide-react";
import { PageHeader } from "@/components/painel/PageHeader";
import { routeErrorComponent } from "@/components/painel/RouteError";
import { SectionErrorBoundary } from "@/components/painel/SectionErrorBoundary";
import { KpiCard } from "@/components/painel/KpiCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/painel/states";
import {
  AccountStatusBadge,
  ActionStatusBadge,
  QuadrantBadge,
  RiskBadge,
} from "@/components/painel/badges";
import {
  BandBars,
  EvolutionChart,
  RiskDonut,
  type EvolutionPoint,
} from "@/components/charts/charts";
import { SatisfactionValueMatrix } from "@/components/charts/SatisfactionValueMatrix";
import { InterventionCockpit } from "@/components/painel/InterventionCockpit";
import { useDashboardData } from "@/hooks/useCarteira";

import {
  ACCOUNT_STATUSES,
  RISK_LEVELS,
  daysSince,
  formatDate,
  formatScore,
  isOverdue,
  scoreBand,
} from "@/lib/domain";
import { consultantDisplayName } from "@/lib/consultants";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/visao-geral")({
  head: () => ({
    meta: [
      { title: "Visão Geral | Painel de Saúde da Carteira" },
      {
        name: "description",
        content:
          "Dashboard executivo com satisfação, valor gerado, risco de cancelamento e contas prioritárias.",
      },
      { property: "og:title", content: "Visão Geral | Painel de Saúde da Carteira" },
      {
        property: "og:description",
        content: "Indicadores consolidados da carteira de consultoria.",
      },
    ],
  }),
  component: DashboardPage,
  errorComponent: routeErrorComponent("Visão Geral"),
});

const PERIODS = [
  { value: "3", label: "Últimos 3 meses" },
  { value: "6", label: "Últimos 6 meses" },
  { value: "12", label: "Últimos 12 meses" },
  { value: "all", label: "Todo o período" },
];

const riskColorMap: Record<string, string> = {
  baixo: "var(--color-healthy)",
  médio: "var(--color-attention)",
  alto: "var(--color-highrisk)",
  crítico: "var(--color-critical)",
};

const bandColors = [
  "var(--color-critical)",
  "var(--color-attention)",
  "var(--color-neutral-info)",
  "var(--color-healthy)",
];

function monthKey(date: string) {
  return date.slice(0, 7);
}

function Panel({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="card-surface min-w-0 p-4 md:p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}

function DashboardPage() {
  const {
    clients,
    meetings,
    actions,
    profiles,
    opportunities,
    isLoading,
    isSlow,
    error,
    refetchAll,
    consultantName,
    nextActionByClient,
    overdueByClient,
  } = useDashboardData();

  const [period, setPeriod] = useState("6");
  const [consultant, setConsultant] = useState("all");
  const [status, setStatus] = useState("all");
  const [risk, setRisk] = useState("all");

  const monthsBack = period === "all" ? 120 : Number(period);
  const periodStart = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsBack);
    return d;
  }, [monthsBack]);
  const previousStart = useMemo(() => {
    const d = new Date(periodStart);
    d.setMonth(d.getMonth() - monthsBack);
    return d;
  }, [periodStart, monthsBack]);

  const filtered = useMemo(
    () =>
      clients.filter((c) => {
        if (consultant !== "all" && c.consultant_id !== consultant) return false;
        if (status !== "all" && c.account_status !== status) return false;
        if (risk !== "all" && c.current_risk_level !== risk) return false;
        return true;
      }),
    [clients, consultant, status, risk],
  );

  const filteredIds = useMemo(() => new Set(filtered.map((c) => c.id)), [filtered]);
  const clientName = useMemo(() => {
    const map = new Map(clients.map((c) => [c.id, c.company_name]));
    return (id: string) => map.get(id) ?? "—";
  }, [clients]);
  const scopedMeetings = useMemo(
    () => meetings.filter((m) => filteredIds.has(m.client_id)),
    [meetings, filteredIds],
  );
  const periodMeetings = useMemo(
    () => scopedMeetings.filter((m) => new Date(m.meeting_date) >= periodStart),
    [scopedMeetings, periodStart],
  );
  const previousMeetings = useMemo(
    () =>
      scopedMeetings.filter(
        (m) => new Date(m.meeting_date) >= previousStart && new Date(m.meeting_date) < periodStart,
      ),
    [scopedMeetings, previousStart, periodStart],
  );

  const avg = (values: (number | null)[]) => {
    const nums = values.filter((v): v is number => v !== null).map(Number);
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  };

  const activeClients = filtered.filter((c) => c.active && c.account_status !== "encerrado");
  const avgSatisfaction = avg(activeClients.map((c) => c.current_satisfaction));
  const avgValue = avg(activeClients.map((c) => c.current_value_score));
  const attention = activeClients.filter((c) => c.account_status === "atenção");
  const highRisk = activeClients.filter((c) => ["alto", "crítico"].includes(c.current_risk_level));
  const overdueActions = actions.filter((a) => filteredIds.has(a.client_id) && isOverdue(a));
  const staleClients = activeClients.filter((c) => (daysSince(c.last_meeting_date) ?? 999) > 45);
  const expansion = opportunities.filter(
    (o) => filteredIds.has(o.client_id) && o.status !== "descartada",
  );

  const satisfactionDelta =
    avg(periodMeetings.map((m) => m.satisfaction_score)) !== null &&
    avg(previousMeetings.map((m) => m.satisfaction_score)) !== null
      ? avg(periodMeetings.map((m) => m.satisfaction_score))! -
        avg(previousMeetings.map((m) => m.satisfaction_score))!
      : null;
  const valueDelta =
    avg(periodMeetings.map((m) => m.value_score)) !== null &&
    avg(previousMeetings.map((m) => m.value_score)) !== null
      ? avg(periodMeetings.map((m) => m.value_score))! -
        avg(previousMeetings.map((m) => m.value_score))!
      : null;

  const evolution: EvolutionPoint[] = useMemo(() => {
    const buckets = new Map<string, { sat: number[]; val: number[]; risk: number[] }>();
    for (const m of periodMeetings) {
      const key = monthKey(m.meeting_date);
      const b = buckets.get(key) ?? { sat: [], val: [], risk: [] };
      if (m.satisfaction_score !== null) b.sat.push(Number(m.satisfaction_score));
      if (m.value_score !== null) b.val.push(Number(m.value_score));
      b.risk.push(m.calculated_risk_score);
      buckets.set(key, b);
    }
    const mean = (arr: number[]) =>
      arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, b]) => {
        const [y, m] = key.split("-");
        return {
          label: `${m}/${y!.slice(2)}`,
          satisfacao: mean(b.sat),
          valor: mean(b.val),
          risco: mean(b.risk),
        };
      });
  }, [periodMeetings]);

  const riskDistribution = RISK_LEVELS.map((level) => ({
    name: level,
    value: activeClients.filter((c) => c.current_risk_level === level).length,
    color: riskColorMap[level]!,
  }));

  const bands = ["0 a 4", "5 a 6", "7 a 8", "9 a 10"] as const;
  const satisfactionBands = bands.map((band, i) => ({
    name: band,
    value: activeClients.filter((c) => scoreBand(Number(c.current_satisfaction ?? NaN)) === band)
      .length,
    color: bandColors[i]!,
  }));
  const valueBands = bands.map((band, i) => ({
    name: band,
    value: activeClients.filter((c) => scoreBand(Number(c.current_value_score ?? NaN)) === band)
      .length,
    color: bandColors[i]!,
  }));

  const priority = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          b.current_risk_score - a.current_risk_score ||
          Number(a.current_satisfaction ?? 10) - Number(b.current_satisfaction ?? 10),
      ),
    [filtered],
  );

  if (error) {
    return (
      <>
        <PageHeader title="Visão Geral" />
        <div className="p-4 md:p-8">
          <ErrorState error={error} onRetry={refetchAll} />
        </div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title="Visão Geral" description="Carregando indicadores da carteira" />
        <div className="p-4 md:p-8">
          <LoadingState slow={isSlow} onRetry={refetchAll} variant="dashboard" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Visão Geral"
        description="Saúde da carteira de consultoria em uma leitura executiva"
      >
        <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Período</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Consultor</Label>
            <Select value={consultant} onValueChange={setConsultant}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os consultores</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {consultantDisplayName(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Status da conta</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {ACCOUNT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Nível de risco</Label>
            <Select value={risk} onValueChange={setRisk}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os níveis</SelectItem>
                {RISK_LEVELS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PageHeader>

      <div className="flex flex-col gap-6 p-4 md:p-8">
        {filtered.length === 0 ? (
          <div className="card-surface">
            <EmptyState
              title="Nenhum cliente encontrado com os filtros atuais"
              description="Ajuste o consultor, o status ou o nível de risco para ver resultados."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setConsultant("all");
                    setStatus("all");
                    setRisk("all");
                  }}
                >
                  Limpar filtros
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Clientes ativos"
                value={String(activeClients.length)}
                description="Contas em consultoria no filtro selecionado"
                icon={Building2}
              />
              <KpiCard
                label="Satisfação média"
                value={formatScore(avgSatisfaction)}
                description="Média das últimas notas de satisfação (0 a 10)"
                icon={Smile}
                delta={satisfactionDelta}
                tone={
                  (avgSatisfaction ?? 0) >= 7
                    ? "healthy"
                    : (avgSatisfaction ?? 0) >= 5
                      ? "attention"
                      : "critical"
                }
              />
              <KpiCard
                label="Valor gerado médio"
                value={formatScore(avgValue)}
                description="Percepção média de valor entregue (0 a 10)"
                icon={Gauge}
                delta={valueDelta}
                tone={
                  (avgValue ?? 0) >= 7 ? "healthy" : (avgValue ?? 0) >= 5 ? "attention" : "critical"
                }
              />
              <KpiCard
                label="Clientes em atenção"
                value={String(attention.length)}
                description="Contas com status de atenção que exigem acompanhamento"
                icon={ShieldAlert}
                tone="attention"
              />
              <KpiCard
                label="Risco alto ou crítico"
                value={String(highRisk.length)}
                description="Contas que exigem intervenção imediata"
                icon={Flame}
                tone="critical"
              />
              <KpiCard
                label="Ações vencidas"
                value={String(overdueActions.length)}
                description="Ações com prazo vencido e ainda não concluídas"
                icon={Timer}
                tone="highrisk"
              />
              <KpiCard
                label="Sem reunião recente"
                value={String(staleClients.length)}
                description="Contas sem reunião há mais de 45 dias"
                icon={CalendarClock}
                tone="attention"
              />
              <KpiCard
                label="Oportunidades de expansão"
                value={String(expansion.length)}
                description="Oportunidades mapeadas nas últimas reuniões"
                icon={Lightbulb}
                tone="healthy"
              />
            </div>

            <Panel
              title="Evolução dos indicadores"
              description="Satisfação média, valor gerado médio e risco médio por mês de reunião"
            >
              {evolution.length ? (
                <SectionErrorBoundary label="o gráfico de evolução">
                  <EvolutionChart data={evolution} />
                </SectionErrorBoundary>
              ) : (
                <EmptyState
                  title="Sem reuniões no período"
                  description="Amplie o período do filtro para visualizar a evolução."
                />
              )}
            </Panel>

            <div className="grid gap-6 xl:grid-cols-3">
              <Panel
                title="Distribuição por risco"
                description="Clientes ativos por nível de risco"
              >
                <SectionErrorBoundary label="o gráfico de risco">
                  <RiskDonut data={riskDistribution} />
                </SectionErrorBoundary>
              </Panel>
              <Panel title="Distribuição da satisfação" description="Clientes por faixa de nota">
                <SectionErrorBoundary label="o gráfico de satisfação">
                  <BandBars data={satisfactionBands} label="Clientes" />
                </SectionErrorBoundary>
              </Panel>
              <Panel title="Distribuição de valor gerado" description="Clientes por faixa de nota">
                <SectionErrorBoundary label="o gráfico de valor gerado">
                  <BandBars data={valueBands} label="Clientes" />
                </SectionErrorBoundary>
              </Panel>
            </div>

            <Panel
              title="Matriz satisfação versus valor"
              description="Cada ponto é uma conta; clique para abrir a página do cliente"
            >
              <SectionErrorBoundary label="a matriz de satisfação versus valor">
                <SatisfactionValueMatrix clients={filtered} consultantName={consultantName} />
              </SectionErrorBoundary>
            </Panel>

            <Panel
              title="Cockpit de intervenção"
              description="Projetos consultivos ordenados por prioridade de intervenção e índice de saúde"
            >
              <SectionErrorBoundary label="o cockpit de intervenção">
                <InterventionCockpit clientName={clientName} />
              </SectionErrorBoundary>
            </Panel>

            <Panel
              title="Contas prioritárias"
              description="Ordenadas por maior risco de cancelamento"
            >
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Consultor</TableHead>
                      <TableHead>Satisfação</TableHead>
                      <TableHead>Valor gerado</TableHead>
                      <TableHead>Risco</TableHead>
                      <TableHead>Última reunião</TableHead>
                      <TableHead>Próxima ação</TableHead>
                      <TableHead>Prazo</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Detalhes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {priority.slice(0, 12).map((c) => {
                      const next = nextActionByClient.get(c.id);
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col">
                              {c.company_name}
                              <span className="text-xs text-muted-foreground">
                                {c.segment ?? "—"}
                              </span>
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
                            <div className="flex flex-col">
                              {formatDate(c.last_meeting_date)}
                              {(daysSince(c.last_meeting_date) ?? 0) > 45 ? (
                                <span className="flex items-center gap-1 text-xs text-highrisk">
                                  <AlertTriangle className="size-3" aria-hidden />
                                  {daysSince(c.last_meeting_date)} dias
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-56">
                            <span className="line-clamp-2 text-sm">
                              {next?.description ?? "Sem ação aberta"}
                            </span>
                          </TableCell>
                          <TableCell>
                            {next ? (
                              <div className="flex flex-col gap-1">
                                {formatDate(next.deadline)}
                                {isOverdue(next) ? (
                                  <ActionStatusBadge status={next.status} overdue />
                                ) : null}
                              </div>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <AccountStatusBadge status={c.account_status} />
                              <QuadrantBadge quadrant={c.current_quadrant} />
                              {(overdueByClient.get(c.id) ?? 0) > 0 ? (
                                <span className="text-xs text-critical">
                                  {overdueByClient.get(c.id)} ação(ões) vencida(s)
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
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          </>
        )}
      </div>
    </>
  );
}
