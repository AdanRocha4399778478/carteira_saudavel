import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Copy, Loader2, Sparkles, Wand2 } from "lucide-react";
import {
  formatDate,
  isOverdue,
  type ActionItem,
  type Meeting,
  type OpportunityItem,
  type RiskItem,
} from "@/lib/domain";
import {
  CONTEXT_LIST_LABEL,
  type ContextListKey,
  type Decision,
  type Project,
  type ProjectContext,
} from "@/lib/projects";
import {
  ANALYSIS_TEMPLATE,
  applyApprovedAnalysis,
  buildAgenda,
  buildContextDiff,
  CLASSIFICATION_LABEL,
  meetingAnalysisQuery,
  meetingAnalysisService,
  OPERATION_LABEL,
  parseAnalysis,
  saveAnalysisDraft,
  type AnalysisAgenda,
  type ApprovedSelection,
  type ChangeOperation,
  type MeetingAnalysis,
} from "@/lib/meeting-analysis";
import {
  defaultResolution,
  matchAction,
  matchContextItem,
  matchDecision,
  matchOpportunity,
  matchRisk,
  scopeToProject,
  VERDICT_LABEL,
  type DedupeMatch,
  type ItemResolution,
  type ResolutionMode,
} from "@/lib/deduplication";
import {
  buildEvolution,
  computeMovement,
  summarizeEvolution,
  EVOLUTION_CLASSIFICATIONS,
  EVOLUTION_ENTITY_LABEL,
  EVOLUTION_LABEL,
  EVOLUTION_TONE,
  MOVEMENT_LABEL,
  type EvolutionCandidate,
  type EvolutionClassification,
  type EvolutionItem,
} from "@/lib/evolution";
import { Pill } from "@/components/painel/badges";

/**
 * Tudo que a aprovação pode ter mudado — invalidado em bloco para que a tela
 * reflita o novo estado sem exigir F5.
 */
const REFRESH_KEYS: readonly (readonly string[])[] = [
  ["projects"],
  ["project"],
  ["project_context"],
  ["project_health"],
  ["meetings"],
  ["meeting_analyses"],
  ["meeting_evolution"],
  ["actions"],
  ["decisions"],
  ["risks"],
  ["opportunities"],
  ["clients"],
  ["dashboard"],
];

/** Tempo em tela da confirmação antes do fechamento automático. */
const CLOSE_DELAY_MS = 800;

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Step = "entrada" | "revisao" | "pauta";

/** Linha do preview: item proposto + veredito antiduplicidade + escolha do consultor. */
type DedupeRow<T> = {
  item: T;
  match: DedupeMatch<unknown>;
  mode: ResolutionMode;
  resolution: ItemResolution;
};

function buildRow<T>(
  item: T,
  match: DedupeMatch<unknown>,
  override: ResolutionMode | undefined,
): DedupeRow<T> {
  const base = defaultResolution(match);
  const mode = override ?? base.mode;
  return { item, match, mode, resolution: { ...base, mode } };
}

function ClassificationBadge({ value }: { value: string }) {
  const variant = value === "fact" ? "secondary" : value === "suggestion" ? "outline" : "outline";
  return (
    <Badge variant={variant} className="shrink-0">
      {CLASSIFICATION_LABEL[value] ?? value}
    </Badge>
  );
}

function agendaToText(agenda: AnalysisAgenda): string {
  const block = (title: string, items: string[]) =>
    items.length ? `${title}\n${items.map((i) => `- ${i}`).join("\n")}\n` : "";
  return [
    `Objetivo: ${agenda.objective}`,
    "",
    block("Pauta", agenda.topics),
    block("Decisões pendentes", agenda.pending_decisions),
    block("Ações atrasadas", agenda.overdue_actions),
    block("Riscos críticos", agenda.critical_risks),
    block("Perguntas recomendadas", agenda.recommended_questions),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function MeetingAnalysisDialog({
  open,
  onOpenChange,
  meeting,
  project,
  context,
  actions,
  risks,
  decisions,
  opportunities = [],
  initialAnalysis = null,
  initialTranscript,
  projectMeetingIds,
  closeOnApproved = false,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  meeting: Meeting | null;
  project: Project | null;
  context: ProjectContext | null;
  actions: ActionItem[];
  risks: RiskItem[];
  decisions: Decision[];
  /** Oportunidades do cliente — escopo da checagem antiduplicidade. */
  opportunities?: OpportunityItem[];
  /** Reuniões do projeto — restringe a busca de duplicidade ao escopo do projeto. */
  projectMeetingIds?: string[];
  /** Análise já gerada pelo fluxo de Reunião Inteligente — abre direto no preview. */
  initialAnalysis?: MeetingAnalysis | null;
  initialTranscript?: string;
  /** Fecha o diálogo automaticamente após a aprovação bem-sucedida. */
  closeOnApproved?: boolean;
  /** Notifica a tela hospedeira após a aprovação (navegação, limpeza etc.). */
  onApplied?: () => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("entrada");
  const [transcript, setTranscript] = useState("");
  const [rawJson, setRawJson] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<MeetingAnalysis | null>(null);
  const [agenda, setAgenda] = useState<AnalysisAgenda | null>(null);

  // Escolha explícita do consultor por item (sobrepõe a sugestão do dedupe).
  const [contextSel, setContextSel] = useState<Record<string, ResolutionMode>>({});
  const [decisionSel, setDecisionSel] = useState<Record<number, ResolutionMode>>({});
  const [actionSel, setActionSel] = useState<Record<number, ResolutionMode>>({});
  const [riskSel, setRiskSel] = useState<Record<number, ResolutionMode>>({});
  const [oppSel, setOppSel] = useState<Record<number, ResolutionMode>>({});
  const [summarySel, setSummarySel] = useState(true);
  // Classificação de evolução ajustada manualmente pelo consultor.
  const [evoSel, setEvoSel] = useState<Record<string, EvolutionClassification>>({});
  /** Falha na aprovação: mantém o diálogo aberto, com transcrição e escolhas intactas. */
  const [approveError, setApproveError] = useState<string | null>(null);
  /** Confirmação visual antes do fechamento automático. */
  const [approved, setApproved] = useState(false);
  // Trava síncrona contra clique duplo: `isPending` só reflete no próximo render.
  const submitting = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const saved = useQuery({ ...meetingAnalysisQuery(meeting?.id ?? ""), enabled: open && !!meeting });


  useEffect(() => {
    if (!open) return;
    setStep("entrada");
    setErrors([]);
    setApproveError(null);
    setApproved(false);
    submitting.current = false;
    setAnalysis(null);
    setAgenda(null);
    setTranscript(initialTranscript ?? saved.data?.transcript ?? "");
    setRawJson("");
  }, [open, meeting?.id, saved.data?.transcript, initialTranscript]);

  // Fluxo inteligente: a análise chega pronta, então o diálogo abre no preview.
  useEffect(() => {
    if (!open || !initialAnalysis) return;
    setAnalysis(initialAnalysis);
    setAgenda(
      buildAgenda({
        suggested: initialAnalysis.agenda_recommendation,
        context,
        openActions,
        overdueActions,
        pendingDecisions,
        criticalRisks,
      }),
    );
    setStep("revisao");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAnalysis]);

  /**
   * Escopo antiduplicidade: mesmo cliente e, quando conhecido, mesmo projeto.
   * Comparar com toda a base do cliente gera falso positivo e custo à toa.
   */
  const meetingActions = useMemo(
    () =>
      scopeToProject(
        actions.filter((a) => a.client_id === meeting?.client_id),
        projectMeetingIds,
      ),
    [actions, meeting?.client_id, projectMeetingIds],
  );
  const scopedRisks = useMemo(
    () => scopeToProject(risks.filter((r) => r.client_id === meeting?.client_id), projectMeetingIds),
    [risks, meeting?.client_id, projectMeetingIds],
  );
  const overdueActions = useMemo(() => meetingActions.filter(isOverdue), [meetingActions]);
  const openActions = useMemo(
    () => meetingActions.filter((a) => a.status !== "concluída"),
    [meetingActions],
  );
  const pendingDecisions = useMemo(
    () => decisions.filter((d) => d.status === "pendente" || d.status === "em_execucao"),
    [decisions],
  );
  const criticalRisks = useMemo(
    () => risks.filter((r) => r.active && (r.level === "alto" || r.level === "crítico")),
    [risks],
  );

  const contextDiff = useMemo(
    () => (analysis ? buildContextDiff(context, analysis).filter((g) => g.proposed.length > 0) : []),
    [analysis, context],
  );

  /**
   * Cada item de contexto é comparado apenas com a MESMA lista do MESMO
   * projeto — escopo estreito evita falso positivo entre listas diferentes.
   */
  const contextRows = useMemo(
    () =>
      contextDiff.map((group) => ({
        ...group,
        rows: group.proposed.map((p) =>
          buildRow(p, matchContextItem(p.text, group.current, (p as { embedding?: number[] | null }).embedding), contextSel[p.key]),
        ),
      })),
    [contextDiff, contextSel],
  );

  const decisionRows: DedupeRow<MeetingAnalysis["decisions"][number]>[] = useMemo(
    () =>
      (analysis?.decisions ?? []).map((item, i) =>
        buildRow(
          item,
          matchDecision(
            { title: item.title, description: item.description, embedding: item.embedding ?? null },
            decisions,
          ),
          decisionSel[i],
        ),
      ),
    [analysis, decisions, decisionSel],
  );

  const actionRows: DedupeRow<MeetingAnalysis["actions"][number]>[] = useMemo(
    () =>
      (analysis?.actions ?? []).map((item, i) =>
        buildRow(
          item,
          matchAction(
            {
              description: item.description,
              owner_name: item.owner_name,
              deadline: item.deadline,
              priority: item.priority,
              embedding: item.embedding ?? null,
            },
            meetingActions,
          ),
          actionSel[i],
        ),
      ),
    [analysis, meetingActions, actionSel],
  );

  const riskRows: DedupeRow<MeetingAnalysis["risks"][number]>[] = useMemo(
    () =>
      (analysis?.risks ?? []).map((item, i) =>
        buildRow(
          item,
          matchRisk({ description: item.description, level: item.level, embedding: item.embedding ?? null }, scopedRisks),
          riskSel[i],
        ),
      ),
    [analysis, scopedRisks, riskSel],
  );

  const oppRows: DedupeRow<MeetingAnalysis["opportunities"][number]>[] = useMemo(
    () =>
      (analysis?.opportunities ?? []).map((item, i) =>
        buildRow(
          item,
          matchOpportunity(
            { description: item.description, expected_benefit: item.expected_benefit, embedding: item.embedding ?? null },
            opportunities,
          ),
          oppSel[i],
        ),
      ),
    [analysis, opportunities, oppSel],
  );

  /* ---------------- evolução desde a última reunião ---------------- */

  /**
   * A evolução olha para as MESMAS decisões do preview antiduplicidade: um
   * item retido por ambiguidade ainda não mudou nada, então fica de fora até
   * o consultor decidir.
   */
  const evolutionCandidates = useMemo<EvolutionCandidate[]>(() => {
    const decided = (r: { mode: ResolutionMode; resolution: ItemResolution }) =>
      r.mode !== "skip" || r.resolution.verdict === "EXISTING";

    const actionById = new Map(meetingActions.map((a) => [a.id, a]));
    const riskById = new Map(scopedRisks.map((r) => [r.id, r]));
    const decisionById = new Map(decisions.map((d) => [d.id, d]));
    const oppById = new Map(opportunities.map((o) => [o.id, o]));

    const list: EvolutionCandidate[] = [];

    decisionRows.filter(decided).forEach((r) => {
      const existing = r.resolution.targetId ? decisionById.get(r.resolution.targetId) : undefined;
      list.push({
        entity_type: "decision",
        entity_id: r.resolution.targetId,
        label: r.item.title,
        resolution: r.resolution,
        existing: existing ? { status: existing.status, deadline: existing.due_date } : null,
        evidence: r.item.description || r.item.reason || null,
      });
    });

    actionRows.filter(decided).forEach((r) => {
      const existing = r.resolution.targetId ? actionById.get(r.resolution.targetId) : undefined;
      list.push({
        entity_type: "action",
        entity_id: r.resolution.targetId,
        label: r.item.description,
        resolution: r.resolution,
        existing: existing ? { status: existing.status, deadline: existing.deadline } : null,
        evidence: r.item.description || null,
      });
    });

    riskRows.filter(decided).forEach((r) => {
      const existing = r.resolution.targetId ? riskById.get(r.resolution.targetId) : undefined;
      list.push({
        entity_type: "risk",
        entity_id: r.resolution.targetId,
        label: r.item.description,
        resolution: r.resolution,
        existing: existing ? { level: existing.level, active: existing.active } : null,
        evidence: r.item.evidence || r.item.impact || null,
      });
    });

    oppRows.filter(decided).forEach((r) => {
      const existing = r.resolution.targetId ? oppById.get(r.resolution.targetId) : undefined;
      list.push({
        entity_type: "opportunity",
        entity_id: r.resolution.targetId,
        label: r.item.description,
        resolution: r.resolution,
        existing: existing ? { status: existing.status } : null,
        evidence: r.item.evidence || null,
      });
    });

    return list;
  }, [decisionRows, actionRows, riskRows, oppRows, meetingActions, scopedRisks, decisions, opportunities]);

  const evolutionItems = useMemo<EvolutionItem[]>(() => {
    const computed = buildEvolution(evolutionCandidates);
    // A escolha do consultor prevalece sobre a regra.
    return computed.map((item, i) => {
      const override = evoSel[`${item.entity_type}:${i}`];
      return override ? { ...item, classification: override, source: "rule" as const } : item;
    });
  }, [evolutionCandidates, evoSel]);

  const evolutionSummary = useMemo(() => summarizeEvolution(evolutionItems), [evolutionItems]);
  const movement = useMemo(() => computeMovement(evolutionSummary), [evolutionSummary]);

  /** Itens em faixa cinzenta — a aprovação pede confirmação antes de seguir. */
  const pendingReview = useMemo(
    () =>
      [
        ...contextRows.flatMap((g) => g.rows),
        ...decisionRows,
        ...actionRows,
        ...riskRows,
        ...oppRows,
      ].filter((r) => r.match.type === "POSSIBLE_DUPLICATE").length,
    [contextRows, decisionRows, actionRows, riskRows, oppRows],
  );

  /* ---------------- análise ---------------- */

  const analyze = useMutation({
    mutationFn: async () => {
      if (!meeting) throw new Error("Reunião não encontrada.");
      const usarJson = rawJson.trim().length > 0;
      const result = await meetingAnalysisService.analyze(
        {
          project,
          project_context: context,
          meeting,
          transcription: transcript,
          open_actions: openActions,
          overdue_actions: overdueActions,
          pending_decisions: pendingDecisions,
          active_risks: risks.filter((r) => r.active),
          projects: project
            ? [
                {
                  id: project.id,
                  client_id: project.client_id,
                  name: project.name,
                  status: project.status,
                },
              ]
            : [],
          manual_json: rawJson,
        },
        usarJson ? "manual" : "ia",
      );
      if (!result.ok) throw new Error(result.errors.join("\n"));
      const nextAgenda = buildAgenda({
        suggested: result.analysis.agenda_recommendation,
        context,
        openActions,
        overdueActions,
        pendingDecisions,
        criticalRisks,
      });
      await saveAnalysisDraft({
        meetingId: meeting.id,
        projectId: project?.id ?? null,
        clientId: meeting.client_id,
        transcript,
        analysis: result.analysis,
        agenda: nextAgenda,
        status: "aguardando_revisao",
      });
      return { analysis: result.analysis, agenda: nextAgenda };
    },
    onSuccess: ({ analysis: a, agenda: g }) => {
      setErrors([]);
      setAnalysis(a);
      setAgenda(g);
      setContextSel({});
      setDecisionSel({});
      setActionSel({});
      setRiskSel({});
      setOppSel({});
      setSummarySel(true);
      setStep("revisao");
      void qc.invalidateQueries({ queryKey: ["meeting_analyses"] });
    },
    onError: (e: Error) => setErrors(e.message.split("\n")),
  });

  const loadSaved = () => {
    if (!saved.data) return;
    const parsed = parseAnalysis(saved.data.analysis);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setAnalysis(parsed.analysis);
    setAgenda(
      buildAgenda({
        suggested: parsed.analysis.agenda_recommendation,
        context,
        openActions,
        overdueActions,
        pendingDecisions,
        criticalRisks,
      }),
    );
    setStep("revisao");
  };

  /* ---------------- aprovação ---------------- */

  const approve = useMutation({
    mutationFn: async () => {
      if (!meeting || !analysis || !agenda) throw new Error("Nada para aprovar.");
      if (!project) throw new Error("Vincule a reunião a um projeto antes de aplicar a análise.");
      setApproveError(null);

      const contextItems = contextRows.flatMap((group) =>
        group.rows.map((r) => ({
          list: r.item.list as ContextListKey,
          text: r.item.text,
          operation: "adicionar" as ChangeOperation,
          resolution: r.resolution,
        })),
      );

      const selection: ApprovedSelection = {
        meetingSummary: summarySel ? analysis.meeting.executive_summary || null : null,
        measurableResult: summarySel ? analysis.meeting.measurable_result || null : null,
        contextItems,
        decisions: decisionRows.map((r) => ({
          title: r.item.title,
          description: r.item.description,
          reason: r.item.reason,
          owner: r.item.owner,
          due_date: r.item.due_date,
          resolution: r.resolution,
          embedding: r.item.embedding ?? null,
        })),
        actions: actionRows.map((r) => ({
          description: r.item.description,
          owner_name: r.item.owner_name,
          deadline: r.item.deadline,
          priority: r.item.priority,
          erp_area: r.item.erp_area,
          evidence: "",
          resolution: r.resolution,
          embedding: r.item.embedding ?? null,
        })),
        risks: riskRows.map((r) => ({
          description: r.item.description,
          level: r.item.level,
          resolution: r.resolution,
          embedding: r.item.embedding ?? null,
        })),
        opportunities: oppRows.map((r) => ({
          description: r.item.description,
          expected_benefit: r.item.expected_benefit,
          resolution: r.resolution,
          embedding: r.item.embedding ?? null,
        })),
        agenda,
      };

      const applied = await applyApprovedAnalysis({
        meeting,
        projectId: project.id,
        context,
        selection,
        analysisId: saved.data?.id ?? null,
        evolution: evolutionItems,
      });
      await saveAnalysisDraft({
        meetingId: meeting.id,
        projectId: project.id,
        clientId: meeting.client_id,
        transcript,
        analysis,
        agenda,
        status: "aprovada",
      });
      return applied;
    },
    onSuccess: (r) => {
      submitting.current = false;
      setApproveError(null);
      setApproved(true);
      toast.success(
        r.alreadyApplied
          ? "Esta análise já havia sido aplicada — nada foi duplicado."
          : `Projeto atualizado: ${r.context} itens de contexto, ${r.decisions} decisões, ${r.actions} ações, ${r.risks} riscos, ${r.opportunities} oportunidades.`,
      );
      // A tela precisa refletir tudo sem F5: contexto, entidades e indicadores.
      for (const key of REFRESH_KEYS) void qc.invalidateQueries({ queryKey: key });
      setStep("pauta");
      onApplied?.();
      // Sucesso encerra o fluxo, com um instante de confirmação visual.
      if (closeOnApproved)
        closeTimer.current = setTimeout(() => onOpenChange(false), CLOSE_DELAY_MS);
    },
    onError: (e: Error) => {
      submitting.current = false;
      setApproveError(e.message);
      toast.error(e.message);
    },
  });

  /** Uma submissão por vez: o backend já é idempotente, aqui evitamos o retrabalho. */
  const submitApproval = () => {
    if (submitting.current || approve.isPending || approved) return;
    submitting.current = true;
    approve.mutate();
  };

  const total =
    contextRows.reduce((n, g) => n + g.rows.length, 0) +
    decisionRows.length +
    actionRows.length +
    riskRows.length +
    oppRows.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b p-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden /> Reunião inteligente
          </DialogTitle>
          <DialogDescription>
            {meeting
              ? `${formatDate(meeting.meeting_date)} · ${meeting.meeting_type ?? "Reunião"} — transcrição, análise, revisão do consultor e próxima pauta.`
              : "Selecione uma reunião."}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[62vh]">
          <div className="space-y-5 p-6">
            {errors.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-semibold text-destructive">
                  <AlertTriangle className="size-4" aria-hidden /> Não foi possível validar a análise
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {approveError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-semibold text-destructive">
                  <AlertTriangle className="size-4" aria-hidden /> Não foi possível concluir a
                  atualização
                </p>
                <p className="mt-1 text-muted-foreground">
                  Sua transcrição e sua revisão foram preservadas. {approveError}
                </p>
              </div>
            )}

            {approved && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> Reunião
                  processada e projeto atualizado
                </p>
              </div>
            )}


            {step === "entrada" && (
              <Tabs defaultValue="transcricao">
                <TabsList>
                  <TabsTrigger value="transcricao">Transcrição</TabsTrigger>
                  <TabsTrigger value="json">JSON da análise</TabsTrigger>
                </TabsList>
                <TabsContent value="transcricao" className="mt-4 space-y-2">
                  <Label htmlFor="transcript">Transcrição ou anotações da reunião</Label>
                  <Textarea
                    id="transcript"
                    rows={12}
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder="Cole aqui a transcrição completa ou as anotações da reunião…"
                  />
                  <p className="text-xs text-muted-foreground">
                    Ao clicar em “Analisar reunião”, o agente de IA lê esta transcrição junto do
                    contexto do projeto, das ações abertas, das decisões pendentes e dos riscos
                    ativos, e devolve a proposta estruturada para sua revisão.
                  </p>
                </TabsContent>
                <TabsContent value="json" className="mt-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="raw-json">JSON estruturado da análise</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-2"
                      onClick={() => setRawJson(ANALYSIS_TEMPLATE)}
                    >
                      <Copy className="size-4" aria-hidden /> Usar modelo
                    </Button>
                  </div>
                  <Textarea
                    id="raw-json"
                    rows={12}
                    className="font-mono text-xs"
                    value={rawJson}
                    onChange={(e) => setRawJson(e.target.value)}
                    placeholder='{ "meeting": { "executive_summary": "…" }, "context_updates": { … } }'
                  />
                  <p className="text-xs text-muted-foreground">
                    Ferramenta avançada: se este campo estiver preenchido, a análise usa o JSON
                    colado em vez do agente de IA.
                  </p>
                </TabsContent>
              </Tabs>
            )}

            {step === "revisao" && analysis && (
              <div className="space-y-5">
                {analysis.meeting.executive_summary && (
                  <section className="rounded-lg border p-4">
                    <label className="flex items-start gap-3">
                      <Checkbox
                        checked={summarySel}
                        onCheckedChange={(v) => setSummarySel(v === true)}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">Resumo executivo</span>
                        <span className="block text-sm text-muted-foreground">
                          {analysis.meeting.executive_summary}
                        </span>
                        {meeting?.executive_summary ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            A reunião já possui resumo — o texto atual é preservado.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </section>
                )}

                {contextRows.map((group) => (
                  <section key={group.list} className="space-y-2">
                    <h3 className="text-sm font-semibold">
                      {CONTEXT_LIST_LABEL[group.list]}{" "}
                      <span className="font-normal text-muted-foreground">
                        ({group.current.length} atuais)
                      </span>
                    </h3>
                    <ul className="space-y-2">
                      {group.rows.map((r) => (
                        <ReviewRow
                          key={r.item.key}
                          primary={r.item.text}
                          secondary={OPERATION_LABEL[r.item.operation as ChangeOperation] ?? ""}
                          classification={r.item.classification}
                          row={r}
                          onChange={(mode) =>
                            setContextSel((s) => ({ ...s, [r.item.key]: mode }))
                          }
                        />
                      ))}
                    </ul>
                  </section>
                ))}

                <ReviewList
                  title="Decisões"
                  rows={decisionRows.map((r) => ({
                    ...r,
                    primary: r.item.title,
                    secondary: [r.item.owner, r.item.due_date].filter(Boolean).join(" · "),
                    classification: r.item.classification,
                  }))}
                  onChange={(i, mode) => setDecisionSel((s) => ({ ...s, [i]: mode }))}
                />
                <ReviewList
                  title="Ações"
                  rows={actionRows.map((r) => ({
                    ...r,
                    primary: r.item.description,
                    secondary: [r.item.owner_name, r.item.deadline, r.item.priority]
                      .filter(Boolean)
                      .join(" · "),
                    classification: r.item.classification,
                  }))}
                  onChange={(i, mode) => setActionSel((s) => ({ ...s, [i]: mode }))}
                />
                <ReviewList
                  title="Riscos"
                  rows={riskRows.map((r) => ({
                    ...r,
                    primary: r.item.description,
                    secondary: [r.item.level, r.item.impact, r.item.recommendation]
                      .filter(Boolean)
                      .join(" · "),
                    classification: r.item.classification,
                  }))}
                  onChange={(i, mode) => setRiskSel((s) => ({ ...s, [i]: mode }))}
                />
                <ReviewList
                  title="Oportunidades"
                  rows={oppRows.map((r) => ({
                    ...r,
                    primary: r.item.description,
                    secondary: r.item.expected_benefit,
                    classification: r.item.classification,
                  }))}
                  onChange={(i, mode) => setOppSel((s) => ({ ...s, [i]: mode }))}
                />

                {evolutionItems.length > 0 && (
                  <section className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold">Evolução desde a última reunião</h3>
                        <p className="text-xs text-muted-foreground">
                          {evolutionSummary.highlights.join(" · ")}
                        </p>
                      </div>
                      <Pill tone={movement === "avancando" ? "healthy" : movement === "estavel" ? "neutral" : movement === "regredindo" ? "critical" : "attention"}>
                        {MOVEMENT_LABEL[movement]}
                      </Pill>
                    </div>
                    <ul className="mt-3 space-y-2">
                      {evolutionItems.map((item, i) => (
                        <li
                          key={`${item.entity_type}:${i}`}
                          className="grid gap-2 rounded-md bg-muted/40 p-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm">
                              <span className="text-muted-foreground">
                                {EVOLUTION_ENTITY_LABEL[item.entity_type]} ·{" "}
                              </span>
                              {item.label}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {[item.previous_state, item.current_state].filter(Boolean).join(" → ") ||
                                "sem estado anterior registrado"}
                              {item.source === "ai" ? " · inferido da fala" : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Pill tone={EVOLUTION_TONE[item.classification]}>
                              {EVOLUTION_LABEL[item.classification]}
                            </Pill>
                            <Select
                              value={item.classification}
                              onValueChange={(v) =>
                                setEvoSel((s) => ({
                                  ...s,
                                  [`${item.entity_type}:${i}`]: v as EvolutionClassification,
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 w-[150px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {EVOLUTION_CLASSIFICATIONS.map((c) => (
                                  <SelectItem key={c} value={c}>
                                    {EVOLUTION_LABEL[c]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {pendingReview > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {pendingReview} item(ns) em possível duplicidade — revise a escolha antes de
                    aprovar.
                  </p>
                )}

                {total === 0 && (
                  <p className="text-sm text-muted-foreground">
                    A análise não trouxe itens novos em relação ao contexto atual.
                  </p>
                )}
              </div>
            )}

            {step === "pauta" && agenda && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Projeto atualizado. Esta é a pauta recomendada para a próxima reunião.
                </p>
                <Separator />
                <Textarea readOnly rows={16} value={agendaToText(agenda)} className="text-sm" />
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    void navigator.clipboard.writeText(agendaToText(agenda));
                    toast.success("Pauta copiada.");
                  }}
                >
                  <Copy className="size-4" aria-hidden /> Copiar pauta
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 border-t p-6 pt-4">
          {step === "entrada" && (
            <>
              {saved.data?.analysis && Object.keys(saved.data.analysis).length > 0 && (
                <Button type="button" variant="ghost" onClick={loadSaved}>
                  Abrir análise salva
                </Button>
              )}
              <Button
                type="button"
                className="gap-2"
                disabled={analyze.isPending || !meeting}
                onClick={() => analyze.mutate()}
              >
                {analyze.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Wand2 className="size-4" aria-hidden />
                )}
                {analyze.isPending ? "Analisando a reunião…" : "Analisar reunião"}
              </Button>
            </>
          )}
          {step === "revisao" && (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={approve.isPending}
                onClick={() => setStep("entrada")}
              >
                Voltar
              </Button>
              <Button
                type="button"
                disabled={approve.isPending || approved}
                className="gap-2"
                onClick={submitApproval}
              >
                {approve.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {approve.isPending
                  ? "Salvando…"
                  : approveError
                    ? "Tentar novamente"
                    : "Aprovar e atualizar projeto"}
              </Button>
            </>
          )}
          {step === "pauta" && (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Concluir
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Botões de resolução — o consultor decide criar, atualizar ou ignorar. */
function ResolutionControls({
  resolution,
  mode,
  onChange,
}: {
  resolution: ItemResolution;
  mode: ResolutionMode;
  onChange: (mode: ResolutionMode) => void;
}) {
  const canUpdate = !!resolution.targetId;
  const options: { value: ResolutionMode; label: string; disabled?: boolean }[] = [
    { value: "create", label: "Criar novo" },
    { value: "update", label: "Atualizar existente", disabled: !canUpdate },
    { value: "skip", label: "Ignorar" },
  ];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          size="sm"
          variant={mode === o.value ? "default" : "outline"}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function VerdictBadge({ resolution }: { resolution: ItemResolution }) {
  const variant =
    resolution.verdict === "NEW"
      ? "default"
      : resolution.verdict === "POSSIBLE_DUPLICATE"
        ? "destructive"
        : "outline";
  return (
    <Badge variant={variant} className="shrink-0">
      {VERDICT_LABEL[resolution.verdict]}
      {resolution.verdict === "NEW" ? "" : ` · ${Math.round(resolution.confidence * 100)}%`}
    </Badge>
  );
}

function ReviewRow({
  primary,
  secondary,
  classification,
  row,
  onChange,
}: {
  primary: string;
  secondary: string;
  classification: string;
  row: { match: DedupeMatch<unknown>; mode: ResolutionMode; resolution: ItemResolution };
  onChange: (mode: ResolutionMode) => void;
}) {
  return (
    <li className="rounded-lg bg-muted/40 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm">{primary}</p>
          {secondary && <p className="text-xs text-muted-foreground">{secondary}</p>}
          {row.resolution.verdict !== "NEW" && (
            <p className="mt-1 text-xs text-muted-foreground">{row.resolution.reason}</p>
          )}
          {row.resolution.changes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {row.resolution.changes.map((c) => (
                <li key={c.field}>
                  <span className="font-medium">{c.label}:</span> {c.from || "—"} → {c.to || "—"}
                </li>
              ))}
            </ul>
          )}
          <ResolutionControls resolution={row.resolution} mode={row.mode} onChange={onChange} />
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <ClassificationBadge value={classification} />
          <VerdictBadge resolution={row.resolution} />
        </span>
      </div>
    </li>
  );
}

function ReviewList({
  title,
  rows,
  onChange,
}: {
  title: string;
  rows: {
    primary: string;
    secondary: string;
    classification: string;
    match: DedupeMatch<unknown>;
    mode: ResolutionMode;
    resolution: ItemResolution;
  }[];
  onChange: (index: number, mode: ResolutionMode) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <ReviewRow
            key={`${title}-${i}`}
            primary={r.primary}
            secondary={r.secondary}
            classification={r.classification}
            row={r}
            onChange={(mode) => onChange(i, mode)}
          />
        ))}
      </ul>
    </section>
  );
}
