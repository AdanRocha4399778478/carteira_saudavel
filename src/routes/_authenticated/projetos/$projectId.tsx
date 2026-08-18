import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  Gavel,
  Link2,
  ListChecks,
  Pencil,
  Plus,
  Sparkles,
  Target,

  Unlink,
} from "lucide-react";
import { PageHeader } from "@/components/painel/PageHeader";
import { routeErrorComponent } from "@/components/painel/RouteError";
import { EmptyState, ErrorState, LoadingState } from "@/components/painel/states";
import { ActionStatusBadge, Pill, RiskBadge } from "@/components/painel/badges";
import { ProjectDialog } from "@/components/painel/ProjectDialog";
import { DecisionDialog } from "@/components/painel/DecisionDialog";
import { ContextListEditor } from "@/components/painel/ContextListEditor";
import { MeetingAnalysisDialog } from "@/components/painel/MeetingAnalysisDialog";
import {
  clientActionsQuery,
  clientOpportunitiesQuery,
  clientRisksQuery,
  profilesQuery,
} from "@/lib/api";
import { supabase } from "@/lib/supabase/client";
import {
  CONTEXT_LISTS,
  CONTEXT_LIST_LABEL,
  DECISION_STATUS_LABEL,
  PROJECT_STATUS_LABEL,
  decisionsQuery,
  ensureProjectContext,
  emptyContextLists,
  projectContextQuery,
  projectMeetingsQuery,
  saveProjectContext,
  setMeetingProject,
  type ContextItem,
  type ContextListKey,
  type Decision,
} from "@/lib/projects";
import { formatDate, isOverdue, type Meeting } from "@/lib/domain";
import {
  projectClientQuery,
  projectDetailQuery,
  projectEditClientsQuery,
  projectUnlinkedMeetingsQuery,
} from "@/lib/project-detail";
import {
  evolutionAgendaTopics,
  projectEvolutionQuery,
  EVOLUTION_ENTITY_LABEL,
  EVOLUTION_LABEL,
  EVOLUTION_TONE,
  MOVEMENT_LABEL,
  type EvolutionRecord,
} from "@/lib/evolution";
import { ProjectHealthCard } from "@/components/painel/ProjectHealthCard";
import { NextActionCard } from "@/components/painel/NextActionCard";
import {
  computeProjectHealth,
  projectHealthSnapshotsQuery,
  saveHealthSnapshot,
} from "@/lib/health";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/projetos/$projectId")({
  head: () => ({
    meta: [
      { title: "Projeto consultivo | Resultados S/A" },
      {
        name: "description",
        content:
          "Contexto atual, reuniões, decisões, ações e riscos de um projeto consultivo em andamento.",
      },
      { property: "og:title", content: "Projeto consultivo | Resultados S/A" },
      {
        property: "og:description",
        content: "Visão operacional completa de um projeto consultivo.",
      },
    ],
  }),
  component: ProjectDetailPage,
  errorComponent: routeErrorComponent("Projeto"),
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

function ItemList({ items, empty }: { items: ContextItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li key={item.id || i} className="flex gap-2 text-sm">
          <span className="text-muted-foreground">•</span>
          <span className="min-w-0">{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

type ContextForm = {
  executive_summary: string;
  current_scenario: string;
  main_objective: string;
} & Record<ContextListKey, ContextItem[]>;

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();

  const project = useQuery(projectDetailQuery(projectId));
  const clientId = project.data?.client_id ?? "";
  const client = useQuery(projectClientQuery(clientId));
  const profiles = useQuery(profilesQuery());
  const context = useQuery(projectContextQuery(projectId));
  const meetings = useQuery(projectMeetingsQuery(projectId));
  const decisions = useQuery(decisionsQuery(projectId));
  const actions = useQuery(clientActionsQuery(clientId));
  const risks = useQuery(clientRisksQuery(clientId));
  const opportunities = useQuery(clientOpportunitiesQuery(clientId));
  const evolution = useQuery(projectEvolutionQuery(projectId));

  const [editOpen, setEditOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [editingDecision, setEditingDecision] = useState<Decision | null>(null);
  const [linkMeetingId, setLinkMeetingId] = useState("");
  const [analysisMeeting, setAnalysisMeeting] = useState<Meeting | null>(null);
  const clients = useQuery({ ...projectEditClientsQuery(), enabled: editOpen });


  const [form, setForm] = useState<ContextForm>({
    executive_summary: "",
    current_scenario: "",
    main_objective: "",
    ...emptyContextLists(),
  });

  useEffect(() => {
    const ctx = context.data;
    if (!ctx) return;
    setForm({
      executive_summary: ctx.executive_summary ?? "",
      current_scenario: ctx.current_scenario ?? "",
      main_objective: ctx.main_objective ?? "",
      ...CONTEXT_LISTS.reduce(
        (acc, key) => ({ ...acc, [key]: ctx[key] }),
        {} as Record<ContextListKey, ContextItem[]>,
      ),
    });
  }, [context.data]);

  const consultantName = useMemo(() => {
    const id = project.data?.consultant_id ?? client.data?.consultant_id ?? null;
    return (profiles.data ?? []).find((p) => p.id === id)?.full_name ?? "—";
  }, [profiles.data, project.data, client.data]);

  const meetingIds = useMemo(() => new Set((meetings.data ?? []).map((m) => m.id)), [meetings.data]);

  /** Ações/riscos do projeto: ligados por reunião do projeto (inferência) ou pelo cliente. */
  const projectActions = useMemo(
    () =>
      (actions.data ?? []).filter(
        (a) => (a.meeting_id && meetingIds.has(a.meeting_id)) || a.client_id === client.data?.id,
      ),
    [actions.data, meetingIds, client.data],
  );
  const projectRisks = useMemo(
    () =>
      (risks.data ?? []).filter(
        (r) =>
          r.active && ((r.meeting_id && meetingIds.has(r.meeting_id)) || r.client_id === client.data?.id),
      ),
    [risks.data, meetingIds, client.data],
  );

  const openActions = projectActions.filter((a) => a.status !== "concluída");
  const overdueActions = projectActions.filter((a) => isOverdue(a));
  const pendingDecisions = (decisions.data ?? []).filter(
    (d) => d.status === "pendente" || d.status === "em_execucao",
  );
  const criticalRisks = projectRisks.filter((r) => r.level === "alto" || r.level === "crítico");

  /* Saúde consultiva: recalculada em tempo real a partir dos dados já carregados. */
  const latestEvolution = (evolution.data ?? [])[0] ?? null;
  const health = useMemo(
    () =>
      computeProjectHealth({
        actions: projectActions,
        risks: projectRisks,
        decisions: decisions.data ?? [],
        meetings: meetings.data ?? [],
        evolution: latestEvolution,
        results: context.data?.results ?? [],
      }),
    [projectActions, projectRisks, decisions.data, meetings.data, latestEvolution, context.data],
  );

  const snapshots = useQuery(projectHealthSnapshotsQuery(projectId));

  /* Snapshot idempotente: grava o retrato da saúde da última reunião analisada. */
  useEffect(() => {
    if (!latestEvolution || snapshots.isLoading) return;
    const already = (snapshots.data ?? []).some((s) => s.meeting_id === latestEvolution.meeting_id);
    if (already) return;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      await saveHealthSnapshot({
        projectId,
        clientId: project.data?.client_id ?? null,
        meetingId: latestEvolution.meeting_id,
        analysisId: null,
        health,
        userId: auth.user?.id ?? null,
      });
      void queryClient.invalidateQueries({ queryKey: ["project_health_snapshots", projectId] });
    })();
  }, [latestEvolution, snapshots.data, snapshots.isLoading, health, projectId, project.data, queryClient]);


  const unlinkedMeetings = useQuery(projectUnlinkedMeetingsQuery(client.data?.id ?? ""));

  const saveContext = useMutation({
    mutationFn: async () => {
      await ensureProjectContext(projectId);
      await saveProjectContext(projectId, {
        executive_summary: form.executive_summary.trim() || null,
        current_scenario: form.current_scenario.trim() || null,
        main_objective: form.main_objective.trim() || null,
        ...CONTEXT_LISTS.reduce(
          (acc, key) => ({ ...acc, [key]: form[key] }),
          {} as Record<ContextListKey, ContextItem[]>,
        ),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project_context", projectId] });
      toast.success("Contexto do projeto atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const linkMeeting = useMutation({
    mutationFn: async (payload: { meetingId: string; projectId: string | null }) =>
      setMeetingProject(payload.meetingId, payload.projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["meetings"] });
      setLinkMeetingId("");
      toast.success("Vínculo da reunião atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (project.isLoading || client.isLoading) {
    return (
      <div className="px-4 py-6 md:px-8">
        <LoadingState variant="detail" />
      </div>
    );
  }

  if (project.error) {
    return (
      <div className="px-4 py-6 md:px-8">
        <ErrorState error={project.error} onRetry={() => void project.refetch()} />
      </div>
    );
  }

  if (!project.data) {
    return (
      <div className="px-4 py-6 md:px-8">
        <div className="card-surface">
          <EmptyState
            title="Projeto não encontrado"
            description="Este projeto pode ter sido removido ou você não tem acesso a ele."
            action={
              <Link to="/projetos">
                <Button variant="outline" className="gap-2">
                  <ArrowLeft className="size-4" aria-hidden /> Voltar aos projetos
                </Button>
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const p = project.data;
  const setField = <K extends keyof ContextForm>(key: K, value: ContextForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="min-w-0">
      <PageHeader title={p.name} description={client.data?.company_name ?? "Cliente"}>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/projetos">
            <Button variant="outline" size="sm" className="gap-2">
              <ArrowLeft className="size-4" aria-hidden /> Projetos
            </Button>
          </Link>
          {client.data ? (
            <Link to="/clientes/$clientId" params={{ clientId: client.data.id }}>
              <Button variant="outline" size="sm">
                Ver cliente
              </Button>
            </Link>
          ) : null}
          <Button asChild size="sm" variant="outline" className="gap-2">
            <Link
              to="/reuniao-inteligente"
              search={{ clientId: p.client_id, projectId: p.id }}
            >
              <Sparkles className="size-4" aria-hidden /> Nova reunião inteligente
            </Link>
          </Button>
          <Button size="sm" className="gap-2" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" aria-hidden /> Editar projeto
          </Button>
        </div>
      </PageHeader>

      <div className="flex flex-col gap-4 px-4 py-6 md:px-8">
        <section className="card-surface grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5 md:p-5">
          <Field
            label="Status"
            value={
              <Pill tone={p.status === "ativo" ? "healthy" : "neutral"}>
                {PROJECT_STATUS_LABEL[p.status] ?? p.status}
              </Pill>
            }
          />
          <Field label="Cliente" value={client.data?.company_name ?? "—"} />
          <Field label="Consultor responsável" value={consultantName} />
          <Field label="Início" value={formatDate(p.start_date)} />
          <Field label="Previsão de término" value={formatDate(p.target_end_date)} />
        </section>

        <Tabs defaultValue="visao-geral">
          <TabsList className="flex-wrap">
            <TabsTrigger value="visao-geral">Visão Geral</TabsTrigger>
            <TabsTrigger value="contexto">Contexto</TabsTrigger>
            <TabsTrigger value="reunioes">Reuniões</TabsTrigger>
            <TabsTrigger value="evolucao">Evolução</TabsTrigger>
            <TabsTrigger value="acoes">Ações</TabsTrigger>
            <TabsTrigger value="decisoes">Decisões</TabsTrigger>
            <TabsTrigger value="riscos">Riscos</TabsTrigger>
            <TabsTrigger value="resultados">Resultados</TabsTrigger>
          </TabsList>

          {/* -------- Visão Geral -------- */}
          <TabsContent value="visao-geral" className="mt-4 flex flex-col gap-4">
            <ProjectHealthCard health={health} />
            <NextActionCard
              projectId={projectId}
              project={p}
              context={context.data ?? null}
              health={health}
              actions={projectActions}
              risks={projectRisks}
              decisions={decisions.data ?? []}
              meetings={meetings.data ?? []}
              evolution={latestEvolution}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

              <div className="card-surface p-4">
                <p className="text-xs text-muted-foreground">Ações abertas</p>
                <p className="mt-1 text-2xl font-bold">{openActions.length}</p>
              </div>
              <div className="card-surface p-4">
                <p className="text-xs text-muted-foreground">Ações atrasadas</p>
                <p className="mt-1 text-2xl font-bold text-critical">{overdueActions.length}</p>
              </div>
              <div className="card-surface p-4">
                <p className="text-xs text-muted-foreground">Decisões pendentes</p>
                <p className="mt-1 text-2xl font-bold">{pendingDecisions.length}</p>
              </div>
              <div className="card-surface p-4">
                <p className="text-xs text-muted-foreground">Riscos críticos</p>
                <p className="mt-1 text-2xl font-bold text-critical">{criticalRisks.length}</p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="Objetivo principal" description="O que estamos tentando alcançar.">
                <p className="text-sm">
                  {form.main_objective || "Ainda não definido — preencha na aba Contexto."}
                </p>
              </Section>
              <Section title="Resumo executivo" description="Onde estamos agora.">
                <p className="text-sm whitespace-pre-wrap">
                  {form.executive_summary || "Sem resumo executivo registrado."}
                </p>
              </Section>
              <Section title="Prioridades atuais">
                <ItemList items={form.priorities} empty="Nenhuma prioridade definida." />
              </Section>
              <Section title="Principais problemas">
                <ItemList items={form.problems} empty="Nenhum problema ativo registrado." />
              </Section>
              <Section title="Próximos passos" description="O que precisa acontecer agora.">
                <ItemList items={form.next_steps} empty="Nenhum próximo passo definido." />
              </Section>
              <Section title="Próxima pauta sugerida">
                <ItemList
                  items={[...form.priorities.slice(0, 3), ...form.next_steps.slice(0, 3)]}
                  empty="Defina prioridades e próximos passos para montar a pauta."
                />
              </Section>
            </div>
          </TabsContent>

          {/* -------- Contexto -------- */}
          <TabsContent value="contexto" className="mt-4 flex flex-col gap-4">
            <Section
              title="Estado atual do projeto"
              description="O contexto representa o presente; as reuniões preservam o histórico."
              action={
                <Button
                  size="sm"
                  onClick={() => saveContext.mutate()}
                  disabled={saveContext.isPending}
                >
                  {saveContext.isPending ? "Salvando…" : "Salvar contexto"}
                </Button>
              }
            >
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="ctx-objective">Objetivo principal</Label>
                  <Input
                    id="ctx-objective"
                    value={form.main_objective}
                    onChange={(e) => setField("main_objective", e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ctx-summary">Resumo executivo</Label>
                  <Textarea
                    id="ctx-summary"
                    rows={4}
                    value={form.executive_summary}
                    onChange={(e) => setField("executive_summary", e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ctx-scenario">Cenário atual</Label>
                  <Textarea
                    id="ctx-scenario"
                    rows={4}
                    value={form.current_scenario}
                    onChange={(e) => setField("current_scenario", e.target.value)}
                  />
                </div>
              </div>
            </Section>

            <div className="grid gap-4 lg:grid-cols-2">
              {CONTEXT_LISTS.map((key) => (
                <Section key={key} title={CONTEXT_LIST_LABEL[key]}>
                  <ContextListEditor
                    label={CONTEXT_LIST_LABEL[key]}
                    items={form[key]}
                    onChange={(items) => setField(key, items)}
                  />
                </Section>
              ))}
            </div>

            <div className="flex justify-end">
              <Button onClick={() => saveContext.mutate()} disabled={saveContext.isPending}>
                {saveContext.isPending ? "Salvando…" : "Salvar contexto"}
              </Button>
            </div>
          </TabsContent>

          {/* -------- Reuniões -------- */}
          {/* -------- Evolução entre reuniões -------- */}
          <TabsContent value="evolucao" className="mt-4 flex flex-col gap-4">
            <Section
              title="O que mudou desde a última reunião"
              description="Comparação entre o estado anterior do projeto e cada nova reunião analisada."
            >
              {evolution.isLoading ? (
                <LoadingState label="Carregando evolução" />
              ) : evolution.data && evolution.data.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {evolution.data.map((record) => (
                    <EvolutionCard
                      key={record.id}
                      record={record}
                      meetingDate={
                        (meetings.data ?? []).find((m) => m.id === record.meeting_id)?.meeting_date ??
                        record.created_at.slice(0, 10)
                      }
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Nenhuma evolução registrada"
                  description="A evolução é gerada quando uma reunião inteligente é aprovada neste projeto."
                />
              )}
            </Section>
          </TabsContent>

          <TabsContent value="reunioes" className="mt-4 flex flex-col gap-4">
            <div>
              <Button asChild className="gap-2">
                <Link
                  to="/reuniao-inteligente"
                  search={{ clientId: p.client_id, projectId: p.id }}
                >
                  <Sparkles className="size-4" aria-hidden /> Nova reunião inteligente
                </Link>
              </Button>
            </div>
            <Section
              title="Vincular reunião existente"
              description="O histórico é preservado: vincular apenas associa a reunião ao projeto."
            >
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid min-w-64 flex-1 gap-1.5">
                  <Label>Reunião sem projeto</Label>
                  <Select value={linkMeetingId} onValueChange={setLinkMeetingId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma reunião" />
                    </SelectTrigger>
                    <SelectContent>
                      {(unlinkedMeetings.data ?? []).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {formatDate(m.meeting_date)} — {m.meeting_type ?? "Reunião"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="gap-2"
                  disabled={!linkMeetingId || linkMeeting.isPending}
                  onClick={() => linkMeeting.mutate({ meetingId: linkMeetingId, projectId })}
                >
                  <Link2 className="size-4" aria-hidden /> Vincular
                </Button>
              </div>
            </Section>

            <Section title="Histórico de reuniões do projeto">
              {(meetings.data ?? []).length === 0 ? (
                <EmptyState
                  title="Nenhuma reunião vinculada"
                  description="Vincule reuniões existentes deste cliente ou registre novas reuniões."
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {(meetings.data ?? []).map((m) => (
                    <li
                      key={m.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg bg-muted/40 p-3"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold">
                          <CalendarCheck className="size-4 text-muted-foreground" aria-hidden />
                          {formatDate(m.meeting_date)} · {m.meeting_type ?? "Reunião"}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {m.executive_summary || "Sem resumo executivo."}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="gap-2"
                          onClick={() => setAnalysisMeeting(m)}
                        >
                          <Sparkles className="size-4" aria-hidden /> Analisar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-2"
                          disabled={linkMeeting.isPending}
                          onClick={() => linkMeeting.mutate({ meetingId: m.id, projectId: null })}
                        >
                          <Unlink className="size-4" aria-hidden /> Desvincular
                        </Button>
                      </div>

                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </TabsContent>

          {/* -------- Ações -------- */}
          <TabsContent value="acoes" className="mt-4">
            <Section
              title="Ações relacionadas"
              description="Ações das reuniões do projeto e da conta do cliente."
            >
              {projectActions.length === 0 ? (
                <EmptyState
                  title="Nenhuma ação relacionada"
                  description="Ações criadas nas reuniões deste cliente aparecerão aqui."
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {projectActions.map((a) => (
                    <li
                      key={a.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg bg-muted/40 p-3"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          <ListChecks className="size-4 text-muted-foreground" aria-hidden />
                          {a.description}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {a.owner_name || "Sem responsável"} · prazo {formatDate(a.deadline)}
                        </p>
                      </div>
                      <ActionStatusBadge status={a.status} overdue={isOverdue(a)} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </TabsContent>

          {/* -------- Decisões -------- */}
          <TabsContent value="decisoes" className="mt-4">
            <Section
              title="Decisões do projeto"
              description="Registre decisões e vincule-as às reuniões em que surgiram."
              action={
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    setEditingDecision(null);
                    setDecisionOpen(true);
                  }}
                >
                  <Plus className="size-4" aria-hidden /> Nova decisão
                </Button>
              }
            >
              {(decisions.data ?? []).length === 0 ? (
                <EmptyState
                  title="Nenhuma decisão registrada"
                  description="Decisões consultivas ficam rastreáveis por reunião e por status."
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {(decisions.data ?? []).map((d) => (
                    <li
                      key={d.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg bg-muted/40 p-3"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold">
                          <Gavel className="size-4 text-muted-foreground" aria-hidden />
                          {d.title}
                        </p>
                        {d.description ? (
                          <p className="mt-1 text-sm text-muted-foreground">{d.description}</p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {d.owner || "Sem responsável"} · prazo {formatDate(d.due_date)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Pill tone={d.status === "implementada" ? "healthy" : "neutral"}>
                          {DECISION_STATUS_LABEL[d.status] ?? d.status}
                        </Pill>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Editar decisão ${d.title}`}
                          onClick={() => {
                            setEditingDecision(d);
                            setDecisionOpen(true);
                          }}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </TabsContent>

          {/* -------- Riscos -------- */}
          <TabsContent value="riscos" className="mt-4">
            <Section title="Riscos ativos" description="Riscos das reuniões do projeto e da conta.">
              {projectRisks.length === 0 ? (
                <EmptyState
                  title="Nenhum risco ativo"
                  description="Riscos registrados nas reuniões deste cliente aparecerão aqui."
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {projectRisks.map((r) => (
                    <li
                      key={r.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg bg-muted/40 p-3"
                    >
                      <p className="flex min-w-0 items-start gap-2 text-sm">
                        <AlertTriangle
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        {r.description}
                      </p>
                      <RiskBadge level={r.level} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </TabsContent>

          {/* -------- Resultados -------- */}
          <TabsContent value="resultados" className="mt-4 flex flex-col gap-4">
            <Section
              title="Resultados alcançados"
              description="Consolidado no contexto do projeto."
            >
              <ItemList items={form.results} empty="Nenhum resultado registrado no contexto." />
            </Section>
            <Section
              title="Resultados mensuráveis por reunião"
              description="Histórico preservado das reuniões."
            >
              {(meetings.data ?? []).filter((m) => m.measurable_result).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma reunião do projeto registrou resultado mensurável.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {(meetings.data ?? [])
                    .filter((m) => m.measurable_result)
                    .map((m) => (
                      <li key={m.id} className="rounded-lg bg-muted/40 p-3">
                        <p className="flex items-center gap-2 text-sm font-semibold">
                          <Target className="size-4 text-muted-foreground" aria-hidden />
                          {formatDate(m.meeting_date)}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">{m.measurable_result}</p>
                      </li>
                    ))}
                </ul>
              )}
            </Section>
          </TabsContent>
        </Tabs>
      </div>

      <ProjectDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        project={p}
        clients={clients.data ?? []}
        consultants={profiles.data ?? []}
      />

      <DecisionDialog
        open={decisionOpen}
        onOpenChange={setDecisionOpen}
        projectId={projectId}
        clientId={p.client_id}
        meetings={meetings.data ?? []}
        decision={editingDecision}
      />

      <MeetingAnalysisDialog
        open={!!analysisMeeting}
        onOpenChange={(v) => !v && setAnalysisMeeting(null)}
        meeting={analysisMeeting}
        project={p}
        context={context.data ?? null}
        actions={actions.data ?? []}
        risks={risks.data ?? []}
        decisions={decisions.data ?? []}
        opportunities={(opportunities.data ?? []).filter((o) => o.client_id === p.client_id)}
        projectMeetingIds={(meetings.data ?? []).map((m) => m.id)}
      />
    </div>

  );
}

/** Cartão de uma reunião na linha do tempo de evolução do projeto. */
function EvolutionCard({ record, meetingDate }: { record: EvolutionRecord; meetingDate: string }) {
  const agenda = evolutionAgendaTopics(record);
  return (
    <article className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Reunião de {formatDate(meetingDate)}</h3>
          <p className="text-xs text-muted-foreground">
            {record.summary?.highlights?.join(" · ") || "Sem itens comparados"}
          </p>
        </div>
        <Pill
          tone={
            record.movement === "avancando"
              ? "healthy"
              : record.movement === "estavel"
                ? "neutral"
                : record.movement === "regredindo"
                  ? "critical"
                  : "attention"
          }
        >
          {MOVEMENT_LABEL[record.movement] ?? record.movement}
        </Pill>
      </div>

      <ul className="mt-3 space-y-2">
        {record.items.map((item) => (
          <li key={item.id} className="grid gap-1 rounded-md bg-muted/40 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 text-sm">
                <span className="text-muted-foreground">
                  {EVOLUTION_ENTITY_LABEL[item.entity_type] ?? item.entity_type} ·{" "}
                </span>
                {item.label}
              </p>
              <Pill tone={EVOLUTION_TONE[item.classification]}>
                {EVOLUTION_LABEL[item.classification] ?? item.classification}
              </Pill>
            </div>
            {(item.previous_state || item.current_state) && (
              <p className="text-xs text-muted-foreground">
                {[item.previous_state, item.current_state].filter(Boolean).join(" → ")}
              </p>
            )}
          </li>
        ))}
      </ul>

      {agenda.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed p-2">
          <p className="text-xs font-semibold">Levar para a próxima pauta</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {agenda.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
