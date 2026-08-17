import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarPlus, FileJson, Search, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/painel/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/painel/states";
import { Pill, RiskBadge } from "@/components/painel/badges";
import { MeetingDialog } from "@/components/painel/MeetingDialog";
import { ImportMeetingDialog } from "@/components/painel/ImportMeetingDialog";
import { useMeetingsListSupportData } from "@/hooks/useMeetingsListSupportData";
import { meetingsListPageQuery } from "@/lib/meetings-list";
import { MEETING_TYPES, formatDate, formatScore, type Meeting } from "@/lib/domain";
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

const PAGE_SIZES = [20, 50, 100] as const;

export const Route = createFileRoute("/_authenticated/reunioes/")({
  head: () => ({
    meta: [
      { title: "Reuniões | Painel de Saúde da Carteira" },
      {
        name: "description",
        content:
          "Histórico imutável de reuniões de consultoria com satisfação, valor gerado e risco calculado.",
      },
      { property: "og:title", content: "Reuniões | Painel de Saúde da Carteira" },
      {
        property: "og:description",
        content: "Registre reuniões manualmente ou importe a estruturação em JSON.",
      },
    ],
  }),
  component: MeetingsPage,
  errorComponent: MeetingsRouteError,
});

function MeetingsRouteError({ error, reset }: { error: Error; reset: () => void }) {
  console.error("[reunioes] falha ao renderizar a listagem", {
    name: error.name,
    message: error.message,
  });
  return (
    <>
      <PageHeader title="Reuniões" />
      <div className="p-4 md:p-8">
        <ErrorState
          message={`Não foi possível exibir a listagem de reuniões: ${error.message}`}
          onRetry={reset}
        />
      </div>
    </>
  );
}

function MeetingsPage() {
  const { clients, actions, riskRules, error, refetchAll, clientName } = useMeetingsListSupportData();

  const [search, setSearch] = useState("");
  const [client, setClient] = useState("all");
  const [type, setType] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [search, client, type, pageSize]);

  const pageQuery = useQuery(
    meetingsListPageQuery({
      page,
      pageSize,
      clientId: client === "all" ? null : client,
      meetingType: type === "all" ? null : type,
      search,
    }),
  );

  const combinedError = (error ?? pageQuery.error) as Error | null;
  const rows = pageQuery.data?.rows ?? [];
  const total = pageQuery.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  if (combinedError) {
    return (
      <>
        <PageHeader title="Reuniões" />
        <div className="p-4 md:p-8">
          <ErrorState
            message={combinedError.message}
            onRetry={() => {
              refetchAll();
              void pageQuery.refetch();
            }}
          />
        </div>
      </>
    );
  }

  const isLoading = pageQuery.isLoading;

  return (
    <>
      <PageHeader
        title="Reuniões"
        description={
          isLoading
            ? "Carregando histórico"
            : `${total} ${total === 1 ? "reunião registrada" : "reuniões registradas"} — o histórico nunca é sobrescrito`
        }
      >
        <div className="grid w-full gap-3 md:grid-cols-4">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Buscar</Label>
            <div className="relative">
              <Search
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="pl-9"
                placeholder="Resumo, ação ou dor"
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
                <SelectItem value="all">Todos os clientes</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Tipo</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {MEETING_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Reuniões por página</Label>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} por página
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button onClick={() => setNewOpen(true)}>
            <CalendarPlus className="size-4" aria-hidden />
            Registrar reunião
          </Button>
          <Button asChild variant="outline">
            <Link to="/reuniao-inteligente">
              <Sparkles className="size-4" aria-hidden />
              Nova reunião inteligente
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileJson className="size-4" aria-hidden />
            Importar estruturação
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 p-4 md:p-8">
        {isLoading ? (
          <LoadingState onRetry={() => void pageQuery.refetch()} variant="meetings" />
        ) : rows.length === 0 ? (
          <div className="card-surface">
            <EmptyState
              title="Nenhuma reunião encontrada"
              description="Ajuste os filtros ou registre a primeira reunião do período."
              action={<Button onClick={() => setNewOpen(true)}>Registrar reunião</Button>}
            />
          </div>
        ) : (
          <>
            {rows.map((m) => (
              <MeetingCard key={m.id} meeting={m} clientName={clientName(m.client_id)} />
            ))}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Página {page} de {lastPage} · {total} no total
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || pageQuery.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= lastPage || pageQuery.isFetching}
                  onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                >
                  Próxima
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <MeetingDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        clients={clients}
        actions={actions}
        riskRules={riskRules}
      />
      <ImportMeetingDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        clients={clients}
        actions={actions}
        riskRules={riskRules}
      />
    </>
  );
}

function MeetingCard({ meeting: m, clientName }: { meeting: Meeting; clientName: string }) {
  const inconsistent = !m.meeting_date || !m.client_id;
  const participants = m.participants.length ? m.participants.join(", ") : "sem participantes";

  return (
    <article className="card-surface p-4 md:p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          {m.client_id ? (
            <Link
              to="/clientes/$clientId"
              params={{ clientId: m.client_id }}
              className="font-display truncate text-base font-bold hover:underline"
            >
              {clientName}
            </Link>
          ) : (
            <p className="font-display truncate text-base font-bold">{clientName}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {formatDate(m.meeting_date)} · {m.meeting_type ?? "reunião"} · {participants}
          </p>
        </div>
        <RiskBadge level={m.calculated_risk_level} score={m.calculated_risk_score} />
      </div>

      {inconsistent ? (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-attention-soft px-3 py-2 text-xs">
          <AlertTriangle className="size-3.5" aria-hidden />
          Registro incompleto: alguns campos obrigatórios estão ausentes neste histórico.
        </p>
      ) : null}

      {m.executive_summary ? (
        <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{m.executive_summary}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Pill tone="neutral">Satisfação {formatScore(m.satisfaction_score)}</Pill>
        <Pill tone="neutral">Valor {formatScore(m.value_score)}</Pill>
        {m.has_measurable_result ? (
          <Pill tone="healthy">Resultado mensurável</Pill>
        ) : (
          <Pill tone="attention">Sem resultado mensurável</Pill>
        )}
        {m.analysis_risk_level && m.analysis_risk_level !== m.calculated_risk_level ? (
          <Pill tone="neutral">Risco da análise: {m.analysis_risk_level}</Pill>
        ) : null}
        {m.explicit_complaint ? <Pill tone="critical">Reclamação</Pill> : null}
        {m.continuity_doubt ? <Pill tone="critical">Dúvida de continuidade</Pill> : null}
        {m.low_client_adherence ? <Pill tone="highrisk">Baixa adesão</Pill> : null}
        {m.missing_internal_owner ? <Pill tone="attention">Sem dono interno</Pill> : null}
      </div>

      {m.next_action ? (
        <p className="mt-3 text-sm">
          <span className="font-semibold">Próxima ação: </span>
          {m.next_action}
          {m.action_owner ? ` · ${m.action_owner}` : ""}
          {m.action_deadline ? ` · até ${formatDate(m.action_deadline)}` : ""}
        </p>
      ) : null}
    </article>
  );
}
