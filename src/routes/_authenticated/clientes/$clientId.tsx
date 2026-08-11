import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarPlus,
  Lightbulb,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/painel/PageHeader";
import { routeErrorComponent } from "@/components/painel/RouteError";
import { EmptyState, ErrorState, LoadingState } from "@/components/painel/states";
import {
  AccountStatusBadge,
  ActionStatusBadge,
  Pill,
  QuadrantBadge,
  RiskBadge,
} from "@/components/painel/badges";
import { EvolutionChart, type EvolutionPoint } from "@/components/charts/charts";
import { ClientDialog } from "@/components/painel/ClientDialog";
import { ClientProjectsSection } from "@/components/painel/ClientProjectsSection";
import { MeetingDialog } from "@/components/painel/MeetingDialog";
import { ActionDialog } from "@/components/painel/ActionDialog";
import { useClientDetailData } from "@/hooks/useCarteira";
import { recalculateClient } from "@/lib/api";
import {
  QUADRANT_INFO,
  byMeetingDateDesc,
  computeRisk,
  daysSince,

  formatDate,
  formatScore,
  isOverdue,
  type ActionItem,
} from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/clientes/$clientId")({
  head: () => ({
    meta: [
      { title: "Visão do cliente | Painel de Saúde da Carteira" },
      {
        name: "description",
        content:
          "Histórico de reuniões, evolução de indicadores, ações, riscos e oportunidades da conta.",
      },
      { property: "og:title", content: "Visão do cliente | Painel de Saúde da Carteira" },
      {
        property: "og:description",
        content: "Visão 360 da conta de consultoria com histórico completo.",
      },
    ],
  }),
  component: ClientDetailPage,
  errorComponent: routeErrorComponent("Cliente"),
});

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
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

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value || "—"}</p>
    </div>
  );
}

function ClientDetailPage() {
  const { clientId } = Route.useParams();
  const queryClient = useQueryClient();
  const {
    clients,
    meetings,
    actions,
    risks,
    opportunities,
    riskRules,
    profiles,
    isLoading,
    isSlow,
    error,
    refetchAll,
    consultantName,
  } = useClientDetailData();

  const [editOpen, setEditOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [editingAction, setEditingAction] = useState<ActionItem | null>(null);

  const client = clients.find((c) => c.id === clientId) ?? null;
  const clientMeetings = useMemo(
    () => meetings.filter((m) => m.client_id === clientId).sort(byMeetingDateDesc),
    [meetings, clientId],
  );

  const clientActions = actions.filter((a) => a.client_id === clientId);
  const clientRisks = risks.filter((r) => r.client_id === clientId);
  const clientOpps = opportunities.filter((o) => o.client_id === clientId);
  const overdue = clientActions.filter((a) => isOverdue(a));

  const recalc = useMutation({
    mutationFn: () => recalculateClient(clientId, riskRules),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Indicadores recalculados a partir do histórico.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const evolution: EvolutionPoint[] = useMemo(
    () =>
      [...clientMeetings]
        .reverse()
        .map((m) => ({

          label: formatDate(m.meeting_date).slice(0, 5),
          satisfacao: m.satisfaction_score === null ? null : Number(m.satisfaction_score),
          valor: m.value_score === null ? null : Number(m.value_score),
          risco: m.calculated_risk_score,
        })),
    [clientMeetings],
  );

  const currentRisk = useMemo(() => {
    const latest = clientMeetings[0];
    return computeRisk(
      {
        satisfaction: latest?.satisfaction_score === undefined ? null : Number(latest.satisfaction_score),
        valueScore: latest?.value_score === undefined ? null : Number(latest.value_score),
        previousSatisfactions: clientMeetings
          .slice(1, 3)
          .map((m) => m.satisfaction_score)
          .filter((n): n is number => n !== null)
          .map(Number),
        hasMeasurableResult: latest?.has_measurable_result ?? false,
        overdueActions: overdue.length,
        daysSinceLastMeeting: daysSince(latest?.meeting_date ?? null),
        explicitComplaint: latest?.explicit_complaint ?? false,
        continuityDoubt: latest?.continuity_doubt ?? false,
        lowAdherence: latest?.low_client_adherence ?? false,
        missingInternalOwner: latest?.missing_internal_owner ?? false,
      },
      riskRules,
    );
  }, [clientMeetings, overdue.length, riskRules]);

  if (error) {
    return (
      <>
        <PageHeader title="Cliente" />
        <div className="p-4 md:p-8">
          <ErrorState error={error} onRetry={refetchAll} />
        </div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title="Cliente" description="Carregando histórico da conta" />
        <div className="p-4 md:p-8">
          <LoadingState slow={isSlow} onRetry={refetchAll} variant="detail" />
        </div>
      </>
    );
  }
  if (!client) {
    return (
      <>
        <PageHeader title="Cliente não encontrado" />
        <div className="p-4 md:p-8">
          <div className="card-surface">
            <EmptyState
              title="Esta conta não existe ou não está na sua carteira"
              description="Volte para a lista de clientes e selecione uma conta disponível."
              action={
                <Button asChild variant="outline">
                  <Link to="/clientes">
                    <ArrowLeft className="size-4" aria-hidden />
                    Voltar para clientes
                  </Link>
                </Button>
              }
            />
          </div>
        </div>
      </>
    );
  }

  const quadrant = QUADRANT_INFO[client.current_quadrant ?? ""] ?? null;

  return (
    <>
      <PageHeader
        title={client.company_name}
        description={`${client.segment ?? "Segmento não informado"} · ${consultantName(client.consultant_id)}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/clientes">
              <ArrowLeft className="size-4" aria-hidden />
              Clientes
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/reuniao-inteligente" search={{ clientId: client.id }}>
              <Sparkles className="size-4" aria-hidden />
              Reunião inteligente
            </Link>
          </Button>
          <Button size="sm" onClick={() => setMeetingOpen(true)}>
            <CalendarPlus className="size-4" aria-hidden />
            Registrar reunião
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingAction(null);
              setActionOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden />
            Nova ação
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" aria-hidden />
            Editar cadastro
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => recalc.mutate()}
            disabled={recalc.isPending}
          >
            <RefreshCw className="size-4" aria-hidden />
            Recalcular
          </Button>
        </div>
      </PageHeader>

      <div className="flex flex-col gap-6 p-4 md:p-8">
        <section className="card-surface grid gap-5 p-4 md:p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <AccountStatusBadge status={client.account_status} />
              <RiskBadge level={client.current_risk_level} score={client.current_risk_score} />
              <QuadrantBadge quadrant={client.current_quadrant} />
              {overdue.length ? (
                <Pill tone="critical" icon={AlertTriangle}>
                  {overdue.length} ação(ões) vencida(s)
                </Pill>
              ) : null}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Satisfação atual" value={formatScore(client.current_satisfaction)} />
              <Field label="Valor gerado atual" value={formatScore(client.current_value_score)} />
              <Field label="Início do projeto" value={formatDate(client.start_date)} />
              <Field
                label="Última reunião"
                value={`${formatDate(client.last_meeting_date)}${
                  daysSince(client.last_meeting_date) !== null
                    ? ` (${daysSince(client.last_meeting_date)} dias)`
                    : ""
                }`}
              />
              <Field label="Próxima reunião" value={formatDate(client.next_meeting_date)} />
              <Field label="Reuniões registradas" value={String(clientMeetings.length)} />
              <Field
                label="Ações abertas"
                value={String(clientActions.filter((a) => a.status !== "concluída").length)}
              />
              <Field label="Oportunidades" value={String(clientOpps.length)} />
            </div>
            {client.notes ? (
              <>
                <Separator className="my-4" />
                <Field label="Observações" value={client.notes} />
              </>
            ) : null}
          </div>

          <div className="min-w-0 rounded-2xl bg-muted/40 p-4">
            <p className="text-sm font-semibold">Composição do risco</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Pontuação {currentRisk.score} · nível {currentRisk.level}
            </p>
            {currentRisk.reasons.length ? (
              <ul className="mt-3 grid gap-2">
                {currentRisk.reasons.map((r) => (
                  <li key={r.label} className="flex items-start gap-2 text-sm">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-highrisk" aria-hidden />
                    <span className="min-w-0">
                      {r.label}
                      <span className="ml-1 font-semibold text-muted-foreground">+{r.points}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Nenhum critério de risco acionado. Conta saudável.
              </p>
            )}
            {quadrant ? (
              <>
                <Separator className="my-4" />
                <p className="text-sm font-semibold">{quadrant.title}</p>
                <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
                  {quadrant.readings.map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </section>

        <Section
          title="Evolução dos indicadores"
          description="Satisfação, valor gerado e risco por reunião registrada"
        >
          {evolution.length ? (
            <EvolutionChart data={evolution} />
          ) : (
            <EmptyState
              title="Nenhuma reunião registrada"
              description="Registre a primeira reunião para começar a acompanhar a evolução."
              action={<Button onClick={() => setMeetingOpen(true)}>Registrar reunião</Button>}
            />
          )}
        </Section>

        <ClientProjectsSection
          clientId={clientId}
          clients={clients}
          consultants={profiles}
        />



        <Tabs defaultValue="reunioes">
          <TabsList>
            <TabsTrigger value="reunioes">Histórico de reuniões</TabsTrigger>
            <TabsTrigger value="acoes">Ações</TabsTrigger>
            <TabsTrigger value="riscos">Riscos</TabsTrigger>
            <TabsTrigger value="oportunidades">Oportunidades</TabsTrigger>
          </TabsList>

          <TabsContent value="reunioes" className="mt-4 grid gap-4">
            {clientMeetings.length === 0 ? (
              <div className="card-surface">
                <EmptyState
                  title="Sem reuniões no histórico"
                  description="Cada reunião registrada é preservada e nunca sobrescreve as anteriores."
                />
              </div>
            ) : (
              clientMeetings.map((m) => (
                <article key={m.id} className="card-surface p-4 md:p-5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-base font-bold">
                        {formatDate(m.meeting_date)} · {m.meeting_type ?? "reunião"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {m.participants.length
                          ? m.participants.join(", ")
                          : "Participantes não informados"}
                      </p>
                    </div>
                    <RiskBadge level={m.calculated_risk_level} score={m.calculated_risk_score} />
                  </div>

                  {m.analysis_risk_level && m.analysis_risk_level !== m.calculated_risk_level ? (
                    <p className="mt-3 rounded-lg bg-attention-soft px-3 py-2 text-xs">
                      Risco informado pela análise: <strong>{m.analysis_risk_level}</strong> · risco
                      calculado pelo painel: <strong>{m.calculated_risk_level}</strong> (o cálculo do
                      painel é sempre o valor oficial).
                    </p>
                  ) : null}

                  {m.executive_summary ? (
                    <p className="mt-3 text-sm text-muted-foreground">{m.executive_summary}</p>
                  ) : null}


                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Satisfação" value={formatScore(m.satisfaction_score)} />
                    <Field label="Valor gerado" value={formatScore(m.value_score)} />
                    <Field label="Resultado mensurável" value={m.measurable_result} />
                    <Field label="Próxima ação" value={m.next_action} />
                    <Field label="Principal dor" value={m.main_pain} />
                    <Field label="Prioridade" value={m.main_priority} />
                    <Field label="Responsável pela ação" value={m.action_owner} />
                    <Field label="Prazo" value={formatDate(m.action_deadline)} />
                  </div>

                  {m.satisfaction_justification || m.value_justification ? (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field label="Justificativa da satisfação" value={m.satisfaction_justification} />
                      <Field label="Justificativa do valor" value={m.value_justification} />
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {m.explicit_complaint ? (
                      <Pill tone="critical">Reclamação explícita</Pill>
                    ) : null}
                    {m.continuity_doubt ? <Pill tone="critical">Dúvida de continuidade</Pill> : null}
                    {m.low_client_adherence ? <Pill tone="highrisk">Baixa adesão</Pill> : null}
                    {m.missing_internal_owner ? (
                      <Pill tone="attention">Sem responsável interno</Pill>
                    ) : null}
                    {m.has_measurable_result ? (
                      <Pill tone="healthy">Resultado mensurável</Pill>
                    ) : (
                      <Pill tone="attention">Sem resultado mensurável</Pill>
                    )}
                  </div>
                </article>
              ))
            )}
          </TabsContent>

          <TabsContent value="acoes" className="mt-4">
            <div className="card-surface overflow-hidden">
              {clientActions.length === 0 ? (
                <EmptyState
                  title="Nenhuma ação registrada"
                  description="Crie ações com prazo e responsável para acompanhar os compromissos."
                  action={
                    <Button
                      onClick={() => {
                        setEditingAction(null);
                        setActionOpen(true);
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
                        <TableHead>Responsável</TableHead>
                        <TableHead>Prazo</TableHead>
                        <TableHead>Prioridade</TableHead>
                        <TableHead>Área</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Editar</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientActions.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="max-w-72">
                            <span className="line-clamp-2 text-sm">{a.description}</span>
                          </TableCell>
                          <TableCell>{a.owner_name ?? "—"}</TableCell>
                          <TableCell>{formatDate(a.deadline)}</TableCell>
                          <TableCell className="capitalize">{a.priority}</TableCell>
                          <TableCell>{a.erp_area ?? "—"}</TableCell>
                          <TableCell>
                            <ActionStatusBadge status={a.status} overdue={isOverdue(a)} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingAction(a);
                                setActionOpen(true);
                              }}
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="riscos" className="mt-4 grid gap-3">
            {clientRisks.length === 0 ? (
              <div className="card-surface">
                <EmptyState
                  title="Nenhum risco registrado"
                  description="Riscos identificados nas reuniões aparecem aqui."
                />
              </div>
            ) : (
              clientRisks.map((r) => (
                <div
                  key={r.id}
                  className="card-surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Registrado em {formatDate(r.created_at)}
                    </p>
                  </div>
                  <RiskBadge level={r.level} />
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="oportunidades" className="mt-4 grid gap-3">
            {clientOpps.length === 0 ? (
              <div className="card-surface">
                <EmptyState
                  title="Nenhuma oportunidade mapeada"
                  description="Oportunidades de expansão registradas nas reuniões aparecem aqui."
                />
              </div>
            ) : (
              clientOpps.map((o) => (
                <div
                  key={o.id}
                  className="card-surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{o.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.expected_benefit ?? "Benefício não informado"}
                    </p>
                  </div>
                  <Pill tone="healthy" icon={Lightbulb}>
                    {o.status}
                  </Pill>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ListChecks className="size-4" aria-hidden />
          Conta atualizada em {formatDate(client.updated_at)}
        </div>
      </div>

      <ClientDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        client={client}
        consultants={profiles}
      />
      <MeetingDialog
        open={meetingOpen}
        onOpenChange={setMeetingOpen}
        clients={clients}
        meetings={meetings}
        actions={actions}
        riskRules={riskRules}
        defaultClientId={clientId}
      />
      <ActionDialog
        open={actionOpen}
        onOpenChange={setActionOpen}
        action={editingAction}
        clients={clients}
        riskRules={riskRules}
        defaultClientId={clientId}
      />
    </>
  );
}
