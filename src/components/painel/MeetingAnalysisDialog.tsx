import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  computeDeliveryClarity,
  formatDate,
  isOverdue,
  todayIsoLocal,
  type ActionItem,
  type Meeting,
  type OpportunityItem,
  type RiskItem,
} from "@/lib/domain";
import { isNewDecisionPreMarkedCompleted } from "@/lib/regra-b";
import { resolveRelativeDeadline } from "@/lib/prazo-relativo";
import {
  CONTEXT_LIST_LABEL,
  type ContextItem,
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
  type ApplyResult,
  type ApprovedIndicatorItem,
  type ApprovedSelection,
  type ChangeOperation,
  type ExecutionQuality,
  type MeetingAnalysis,
  type SemanticConsolidation,
} from "@/lib/meeting-analysis";
import { applySpeakerMapToAnalysis, toSpeakerMapEntries } from "@/lib/speaker-map";
import {
  applyIndicatorEdit,
  blockingIndicatorCount,
  buildApprovedIndicators,
  defaultIndicatorDraft,
  formatIndicatorSummary,
  summarizeIndicatorItems,
  type IndicatorDraft,
} from "@/lib/indicator-approval";
import { IndicatorSuggestionsBlock } from "@/components/painel/IndicatorSuggestionsBlock";
import {
  planIndicatorSuggestion,
  type ExistingIndicatorForMatch,
  type IndicatorSuggestionPlan,
} from "@/lib/indicator-match";
import { flagForeignClientItems } from "@/lib/client-isolation-guard";
import { isConditionalClientAction } from "@/lib/decision-action-flags";
import {
  annotateOrigin,
  applyChronologyGuard,
  chronologyOf,
  defaultResolution,
  formatDuplicateReport,
  matchAction,
  matchContextItem,
  matchDecision,
  matchOpportunity,
  matchRisk,
  rankCandidates,
  scopeDedupeCandidates,
  scopeToProject,
  VERDICT_LABEL,
  type ChronologyStatus,
  type DedupeMatch,
  type DuplicateReportCandidate,
  type DuplicateReportSuggestion,
  type FieldChange,
  type ItemResolution,
  type ResolutionMode,
} from "@/lib/deduplication";
import {
  applyIgnoreBlock,
  applySafeResolutions,
  computeBlockStatus,
  countReviewBlock,
  firstItemNeedingReview,
  formatBlockSummary,
  needsReview,
  snapshotAfterPatch,
  type BlockDecisionRecord,
  type BlockStatus,
  type ReviewBlockCounts,
  type ReviewBlockItem,
} from "@/lib/review-blocks";
import {
  buildEvolution,
  computeMovement,
  summarizeEvolution,
  EVOLUTION_CLASSIFICATIONS,
  EVOLUTION_ENTITY_LABEL,
  EVOLUTION_LABEL,
  MOVEMENT_LABEL,
  type EvolutionCandidate,
  type EvolutionClassification,
  type EvolutionItem,
} from "@/lib/evolution";
import { Pill } from "@/components/painel/badges";
import {
  orderPeopleForItem,
  preferredFunctionsForItem,
  type ClientPerson,
} from "@/lib/client-people";

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

/** Gate F — sentinela do Select de responsável (Radix não aceita value=""), mesmo padrão de DecisionDialog/IndicatorDialog. */
const NO_OWNER_VALUE = "__none__";

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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type Step = "entrada" | "revisao" | "pauta";

/** Linha do preview: item proposto + veredito antiduplicidade + escolha do consultor. */
type DedupeRow<T, K extends string | number = string | number> = {
  /** Chave estável usada nos mapas de seleção (contextSel/decisionSel/…) e nos blocos. */
  key: K;
  item: T;
  match: DedupeMatch<unknown>;
  mode: ResolutionMode;
  resolution: ItemResolution;
  /** true quando o consultor já escolheu explicitamente um modo para este item. */
  hasOverride: boolean;
};

function buildRow<T, K extends string | number>(
  key: K,
  item: T,
  match: DedupeMatch<unknown>,
  override: ResolutionMode | undefined,
  chronology?: { currentMeetingDate: string | null | undefined; candidateMeetingDate: string | null | undefined },
): DedupeRow<T, K> {
  const base = defaultResolution(match);
  const guarded = chronology
    ? applyChronologyGuard(
        base,
        chronologyOf(chronology.currentMeetingDate, chronology.candidateMeetingDate),
        chronology.candidateMeetingDate,
      )
    : base;
  // Posterior nunca vira "update", nem por override manual (o botão já vem desabilitado na UI).
  const mode = override && !(override === "update" && guarded.chronology === "posterior") ? override : guarded.mode;
  return { key, item, match, mode, resolution: { ...guarded, mode }, hasOverride: override !== undefined };
}

/** Converte linhas de dedupe (já com key/match/mode) no formato que review-blocks.ts entende. */
function toReviewItems<K extends string | number>(
  rows: { key: K; match: DedupeMatch<unknown>; mode: ResolutionMode }[],
  sel: Record<K, ResolutionMode>,
  foreignClientFlags?: Record<number, string>,
  conditionalActionFlags?: Record<number, true>,
): ReviewBlockItem<K>[] {
  return rows.map((r) => ({
    key: r.key,
    verdict: r.match.type,
    confidence: r.match.confidence,
    mode: r.mode,
    hasOverride: sel[r.key] !== undefined,
    historyFlag: r.match.historyFlag ?? null,
    statusSignal: r.match.statusSignal ?? null,
    foreignClientFlag: foreignClientFlags?.[r.key as number] !== undefined,
    conditionalActionFlag: conditionalActionFlags?.[r.key as number] !== undefined,
  }));
}

/** Aplica um patch de seleção em lote — no-op se o patch estiver vazio. */
function mergeSel<K extends string | number>(
  setSel: Dispatch<SetStateAction<Record<K, ResolutionMode>>>,
  patch: Partial<Record<K, ResolutionMode>>,
) {
  if (Object.keys(patch).length === 0) return;
  setSel((s) => ({ ...s, ...patch }));
}

/**
 * B18 — valor padrão do campo de prazo antes de qualquer edição manual:
 * a data explícita que a IA extraiu (`explicit`), ou, se vazia, a
 * sugestão calculada a partir da expressão relativa (`hint`) e da data
 * da reunião. "" quando não há data explícita nem hint resolvível — a IA
 * nunca inventa, e este código também não.
 */
function defaultItemDueDate(
  explicit: string,
  hint: string,
  meetingDateIso: string | null | undefined,
): string {
  if (explicit) return explicit;
  return resolveRelativeDeadline(hint, meetingDateIso) ?? "";
}

/** true quando o valor exibido vem só da sugestão (hint), sem edição manual nem data explícita da IA. */
function isSuggestedDueDate(
  explicit: string,
  hint: string,
  meetingDateIso: string | null | undefined,
  override: string | undefined,
): boolean {
  return (
    override === undefined && !explicit && resolveRelativeDeadline(hint, meetingDateIso) !== null
  );
}

/**
 * GATE B27A — mensagem de sucesso pós-aprovação com TODOS os números de
 * `ApplyResult`, não só o que foi criado: criados (soma de context,
 * decisions, actions, risks, opportunities), atualizados (`r.updated`),
 * ignorados (`r.skipped`) e, só quando > 0, bloqueados por cronologia
 * (`r.blockedByChronology` — item cujo alvo de "Atualizar existente" veio
 * de uma reunião posterior à atual, defesa em profundidade do backend).
 */
function formatApplyResultMessage(r: ApplyResult): string {
  if (r.alreadyApplied) return "Esta análise já havia sido aplicada — nada foi duplicado.";
  const created = r.context + r.decisions + r.actions + r.risks + r.opportunities;
  const parts = [`${created} criados`, `${r.updated} atualizados`, `${r.skipped} ignorados`];
  if (r.blockedByChronology > 0) parts.push(`${r.blockedByChronology} bloqueados por cronologia`);
  const base = `Reunião aprovada: ${parts.join(", ")}.`;

  // Indicadores de resultado parte 4, Gate F — só aparece quando algo de
  // indicador foi de fato gravado; sem indicadores, a mensagem acima
  // permanece exatamente como sempre foi.
  const indicatorParts: string[] = [];
  if (r.indicatorsCreated > 0) {
    indicatorParts.push(
      `${r.indicatorsCreated} ${r.indicatorsCreated === 1 ? "indicador criado" : "indicadores criados"}`,
    );
  }
  if (r.indicatorPointsAdded > 0) {
    indicatorParts.push(
      `${r.indicatorPointsAdded} ${r.indicatorPointsAdded === 1 ? "ponto adicionado" : "pontos adicionados"}`,
    );
  }
  if (r.indicatorPointsSkipped > 0) {
    indicatorParts.push(
      `${r.indicatorPointsSkipped} ${
        r.indicatorPointsSkipped === 1 ? "ponto repetido ignorado" : "pontos repetidos ignorados"
      }`,
    );
  }
  if (indicatorParts.length === 0) return base;

  return `${base} ${indicatorParts.join(", ")}.`;
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
  allDecisions,
  clientMeetings = [],
  clientProjects = [],
  clientName,
  otherClientNames = [],
  opportunities = [],
  indicators = [],
  people = [],
  initialAnalysis = null,
  rawAiResponse = null,
  initialTranscript,
  projectMeetingIds,
  closeOnApproved = false,
  onApplied,
  onPersistDraftMeeting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /**
   * No fluxo de Reunião Inteligente, `meeting` pode ser um rascunho em
   * memória (`id: ""`) que ainda não existe no banco — todo o dedupe abaixo
   * só depende de `client_id`/`meeting_date`, então funciona igual. A
   * gravação real só acontece em `onPersistDraftMeeting`, no momento da
   * aprovação (ver comentário na definição do prop).
   */
  meeting: Meeting | null;
  project: Project | null;
  context: ProjectContext | null;
  actions: ActionItem[];
  risks: RiskItem[];
  /** Decisões do projeto atual — usadas na pauta e na aba Decisões (fora deste diálogo). */
  decisions: Decision[];
  /** Todas as decisões do cliente (qualquer projeto) — universo da checagem antiduplicidade. Cai para `decisions` quando ausente. */
  allDecisions?: Decision[];
  /** Todas as reuniões do cliente (qualquer projeto) — usadas só pra identificar de qual projeto veio um item comparado. */
  clientMeetings?: Meeting[];
  /** Nome dos projetos do cliente — usado junto com `clientMeetings` pra rotular a origem de um item comparado de outro projeto. */
  clientProjects?: { id: string; name: string }[];
  /** Nome do cliente — só para o cabeçalho do relatório de duplicidade copiável. */
  clientName?: string;
  /** Nome dos OUTROS clientes cadastrados — trava de isolamento (ver client-isolation-guard.ts). */
  otherClientNames?: string[];
  /** Oportunidades do cliente — escopo da checagem antiduplicidade. */
  opportunities?: OpportunityItem[];
  /**
   * Indicadores já existentes do PROJETO identificado (mesmo tipo de
   * indicatorsQuery, src/lib/indicators-data.ts) — usados só pra casar as
   * sugestões de indicador da IA (ver indicatorPlans/planIndicatorSuggestion
   * em indicator-match.ts). [] quando o projeto ainda não foi identificado.
   */
  indicators?: ExistingIndicatorForMatch[];
  /**
   * Gate F (19/10/2026) — cadastro de pessoas do cliente (client_people),
   * mesma fonte que a IA usa (buildPeoplePromptContext). [] quando o
   * cliente não tem cadastro — nesse caso a linha de ação/decisão fica
   * EXATAMENTE como antes (sem seletor de responsável).
   */
  people?: ClientPerson[];
  /** Reuniões do projeto — restringe a busca de duplicidade ao escopo do projeto. */
  projectMeetingIds?: string[];
  /** Análise já gerada pelo fluxo de Reunião Inteligente — abre direto no preview. */
  initialAnalysis?: MeetingAnalysis | null;
  /**
   * JSON bruto da resposta da IA (mesclada por chunk, antes da consolidação
   * semântica e do schema Zod do cliente) — só para auditoria. Salvo junto
   * com a análise ao aprovar, nunca lido de volta nem usado para renderizar
   * a revisão.
   */
  rawAiResponse?: string | null;
  initialTranscript?: string;
  /** Fecha o diálogo automaticamente após a aprovação bem-sucedida. */
  closeOnApproved?: boolean;
  /** Notifica a tela hospedeira após a aprovação (navegação, limpeza etc.). */
  onApplied?: () => void;
  /**
   * Presente só quando `meeting` é um rascunho (`id: ""`): grava a reunião de
   * verdade e devolve a linha real, chamado no início da aprovação — nunca
   * antes. Ausente para o fluxo antigo (reunião já existente vinda de
   * $projectId.tsx), que continua gravando de imediato como sempre gravou.
   */
  onPersistDraftMeeting?: () => Promise<Meeting>;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("entrada");
  const [transcript, setTranscript] = useState("");
  const [rawJson, setRawJson] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<MeetingAnalysis | null>(null);
  const [agenda, setAgenda] = useState<AnalysisAgenda | null>(null);
  /** JSON bruto da IA para este ciclo — vem de `rawAiResponse` (fluxo de Reunião
   * Inteligente) ou da própria mutação `analyze` abaixo (fluxo de $projectId.tsx). */
  const [rawAiResponseState, setRawAiResponseState] = useState<string | null>(null);

  // Escolha explícita do consultor por item (sobrepõe a sugestão do dedupe).
  const [contextSel, setContextSel] = useState<Record<string, ResolutionMode>>({});
  const [decisionSel, setDecisionSel] = useState<Record<number, ResolutionMode>>({});
  const [actionSel, setActionSel] = useState<Record<number, ResolutionMode>>({});
  /**
   * Regra B — caixa "Concluída" por item (só exibida/usada quando a
   * resolução do item é "Criar novo"). undefined = sem override manual,
   * usa o padrão calculado pelo prazo vencido (ver isNew*PreMarkedCompleted).
   */
  const [decisionCompletedSel, setDecisionCompletedSel] = useState<Record<number, boolean>>({});
  const [actionCompletedSel, setActionCompletedSel] = useState<Record<number, boolean>>({});
  /**
   * B1 — caixa "Avaliação" por decisão (só exibida/usada quando a resolução
   * é "Criar novo"). undefined = sem override manual, usa a sugestão da IA
   * (r.item.is_evaluation). Decisão de avaliação é sempre exceção à Regra B
   * — ver isNewDecisionPreMarkedCompleted/resolveNewDecisionStatus.
   */
  const [decisionEvaluationSel, setDecisionEvaluationSel] = useState<Record<number, boolean>>({});
  /**
   * B18 — prazo por item (só exibido/usado quando a resolução é "Criar
   * novo"). undefined = sem edição manual, usa o padrão: a data explícita
   * da IA (due_date/deadline) ou, se vazia, a sugestão calculada a partir
   * do hint e da data da reunião (ver resolveRelativeDeadline/defaultItemDueDate).
   * "" é uma edição válida (consultor limpou o campo de propósito) — grava
   * sem prazo, nunca reaparece a sugestão.
   */
  const [decisionDueDateSel, setDecisionDueDateSel] = useState<Record<number, string>>({});
  const [actionDeadlineSel, setActionDeadlineSel] = useState<Record<number, string>>({});
  /**
   * Gate F — responsável escolhido por mim no seletor (ação/decisão, modos
   * "Criar novo" e "Atualizar existente"). undefined = sem escolha manual,
   * usa o valor sugerido pela IA (r.item.owner/owner_name). "" é uma escolha
   * válida ("(sem responsável)") — nunca reaparece a sugestão da IA depois.
   */
  const [decisionOwnerSel, setDecisionOwnerSel] = useState<Record<number, string>>({});
  const [actionOwnerSel, setActionOwnerSel] = useState<Record<number, string>>({});
  const [riskSel, setRiskSel] = useState<Record<number, ResolutionMode>>({});
  const [oppSel, setOppSel] = useState<Record<number, ResolutionMode>>({});
  /** Indicadores de resultado parte 4, Gate C — edições do consultor sobre o rascunho padrão de cada sugestão. */
  const [indicatorEdits, setIndicatorEdits] = useState<Record<number, Partial<IndicatorDraft>>>({});
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

  const saved = useQuery({ ...meetingAnalysisQuery(meeting?.id ?? ""), enabled: open && !!meeting?.id });

  /** Regra B — "hoje" em texto, hora local, pra decidir prazo vencido (ver regra-b.ts). */
  const todayIso = todayIsoLocal();

  /**
   * Aprovação é definitiva: reunião já aprovada abre em modo leitura — nunca
   * mais editável nem reaprovável, mesmo depois de fechar e reabrir o
   * diálogo (achado real: Grupo Erinho ficou com status regredido porque
   * "Analisar reunião" rodou de novo numa reunião já aprovada).
   */
  const isApproved = saved.data?.status === "aprovada";


  useEffect(() => {
    if (!open) return;
    setStep("entrada");
    setErrors([]);
    setApproveError(null);
    setApproved(false);
    submitting.current = false;
    setAnalysis(null);
    setAgenda(null);
    setRawAiResponseState(null);
    setTranscript(initialTranscript ?? saved.data?.transcript ?? "");
    setRawJson("");
  }, [open, meeting?.id, saved.data?.transcript, initialTranscript]);

  // Fluxo inteligente: a análise chega pronta, então o diálogo abre no preview.
  useEffect(() => {
    if (!open || !initialAnalysis) return;
    setAnalysis(initialAnalysis);
    setRawAiResponseState(rawAiResponse ?? null);
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

  /**
   * Escopo antiduplicidade (R17, 18/10/2026, decisão do dono do produto):
   * SÓ o projeto da reunião atual — nunca o cliente inteiro. Antes, o
   * universo comparado cruzava todos os projetos do mesmo cliente de
   * propósito; um achado real mostrou isso sobrescrevendo, quase, o item
   * de outro projeto (par a 56% pré-marcado "Atualizar existente"). A
   * lógica de similaridade em si (matchAction/matchDecision/matchRisk/
   * matchOpportunity) não muda, só o universo comparado — e evolução de um
   * item entre projetos diferentes do mesmo cliente deixa de ser
   * detectada aqui (o roteamento por assunto, R22, trata isso depois).
   */
  const projectMeetingIdSet = useMemo(() => new Set(projectMeetingIds ?? []), [projectMeetingIds]);
  const dedupeActions = useMemo(
    () => scopeDedupeCandidates(actions, projectMeetingIdSet),
    [actions, projectMeetingIdSet],
  );
  const dedupeRisks = useMemo(
    () => scopeDedupeCandidates(risks, projectMeetingIdSet),
    [risks, projectMeetingIdSet],
  );
  const dedupeDecisions = useMemo(
    () => scopeDedupeCandidates(allDecisions ?? decisions, projectMeetingIdSet),
    [allDecisions, decisions, projectMeetingIdSet],
  );
  const dedupeOpportunities = useMemo(
    () => scopeDedupeCandidates(opportunities, projectMeetingIdSet),
    [opportunities, projectMeetingIdSet],
  );

  /** meeting_id → project_id, pra descobrir de qual projeto veio uma ação/risco/oportunidade comparado. */
  const projectIdByMeetingId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of clientMeetings) if (m.project_id) map.set(m.id, m.project_id);
    return map;
  }, [clientMeetings]);
  /** meeting_id → meeting_date, pra travar "Atualizar existente" quando o candidato vem de reunião posterior. */
  const meetingDateByMeetingId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of clientMeetings) if (m.meeting_date) map.set(m.id, m.meeting_date);
    return map;
  }, [clientMeetings]);
  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of clientProjects) map.set(p.id, p.name);
    return map;
  }, [clientProjects]);

  const withOrigin = <T,>(
    match: DedupeMatch<T>,
    itemProjectId: string | null | undefined,
  ): DedupeMatch<T> => annotateOrigin(match, itemProjectId, project?.id, projectNameById);

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
          buildRow(
            p.key,
            p,
            matchContextItem(p.text, group.current, (p as { embedding?: number[] | null }).embedding),
            contextSel[p.key],
          ),
        ),
      })),
    [contextDiff, contextSel],
  );

  const originForMeetingId = (meetingId: string | null | undefined): string | null =>
    meetingId ? (projectIdByMeetingId.get(meetingId) ?? null) : null;
  const dateForMeetingId = (meetingId: string | null | undefined): string | null =>
    meetingId ? (meetingDateByMeetingId.get(meetingId) ?? null) : null;
  const chronologyFor = (candidateMeetingId: string | null | undefined) => ({
    currentMeetingDate: meeting?.meeting_date,
    candidateMeetingDate: dateForMeetingId(candidateMeetingId),
  });

  const decisionRows: DedupeRow<MeetingAnalysis["decisions"][number], number>[] = useMemo(
    () =>
      (analysis?.decisions ?? []).map((item, i) => {
        const match = matchDecision(
          {
            title: item.title,
            description: item.description,
            reason: item.reason,
            owner: item.owner,
            due_date: item.due_date,
            status: item.status,
            embedding: item.embedding ?? null,
          },
          dedupeDecisions,
        );
        return buildRow(
          i,
          item,
          withOrigin(match, match.existing?.project_id ?? null),
          decisionSel[i],
          chronologyFor(match.existing?.meeting_id),
        );
      }),
    [analysis, dedupeDecisions, decisionSel, project?.id, projectNameById, meeting?.meeting_date, meetingDateByMeetingId],
  );

  const actionRows: DedupeRow<MeetingAnalysis["actions"][number], number>[] = useMemo(
    () =>
      (analysis?.actions ?? []).map((item, i) => {
        const match = matchAction(
          {
            description: item.description,
            owner_name: item.owner_name,
            deadline: item.deadline,
            priority: item.priority,
            evidence: item.evidence,
            embedding: item.embedding ?? null,
          },
          dedupeActions,
        );
        return buildRow(
          i,
          item,
          withOrigin(match, originForMeetingId(match.existing?.meeting_id)),
          actionSel[i],
          chronologyFor(match.existing?.meeting_id),
        );
      }),
    [
      analysis,
      dedupeActions,
      actionSel,
      project?.id,
      projectIdByMeetingId,
      projectNameById,
      meeting?.meeting_date,
      meetingDateByMeetingId,
    ],
  );

  const riskRows: DedupeRow<MeetingAnalysis["risks"][number], number>[] = useMemo(
    () =>
      (analysis?.risks ?? []).map((item, i) => {
        const match = matchRisk(
          { description: item.description, level: item.level, embedding: item.embedding ?? null },
          dedupeRisks,
        );
        return buildRow(
          i,
          item,
          withOrigin(match, originForMeetingId(match.existing?.meeting_id)),
          riskSel[i],
          chronologyFor(match.existing?.meeting_id),
        );
      }),
    [
      analysis,
      dedupeRisks,
      riskSel,
      project?.id,
      projectIdByMeetingId,
      projectNameById,
      meeting?.meeting_date,
      meetingDateByMeetingId,
    ],
  );

  const oppRows: DedupeRow<MeetingAnalysis["opportunities"][number], number>[] = useMemo(
    () =>
      (analysis?.opportunities ?? []).map((item, i) => {
        const match = matchOpportunity(
          { description: item.description, expected_benefit: item.expected_benefit, embedding: item.embedding ?? null },
          dedupeOpportunities,
        );
        return buildRow(
          i,
          item,
          withOrigin(match, originForMeetingId(match.existing?.meeting_id)),
          oppSel[i],
          chronologyFor(match.existing?.meeting_id),
        );
      }),
    [
      analysis,
      dedupeOpportunities,
      oppSel,
      project?.id,
      projectIdByMeetingId,
      projectNameById,
      meeting?.meeting_date,
      meetingDateByMeetingId,
    ],
  );

  /**
   * Indicadores de resultado parte 4, Gate B — plano de cada indicador
   * sugerido pela IA contra os indicadores já existentes do projeto
   * (ver indicator-match.ts; identidade é nome normalizado + kind, nunca
   * similaridade). SÓ o cálculo por enquanto: ainda não renderiza nada na
   * tela nem entra em ApprovedSelection — isso é um gate futuro (preview +
   * seletor manual pra caso ambíguo).
   */
  const indicatorPlans: IndicatorSuggestionPlan[] = useMemo(
    () => (analysis?.indicators ?? []).map((item) => planIndicatorSuggestion(item, indicators)),
    [analysis, indicators],
  );

  /**
   * Indicadores de resultado parte 4, Gate C — rascunho editável de cada
   * sugestão (ver indicator-approval.ts): parte do plano do Gate B
   * (indicatorPlans acima) e aplica as edições do consultor por cima.
   */
  const indicatorDrafts: IndicatorDraft[] = useMemo(
    () =>
      (analysis?.indicators ?? []).map((item, i) =>
        applyIndicatorEdit(
          defaultIndicatorDraft(item, indicatorPlans[i]!),
          indicatorEdits[i] ?? {},
        ),
      ),
    [analysis, indicatorPlans, indicatorEdits],
  );
  const approvedIndicatorItems: ApprovedIndicatorItem[] = useMemo(
    () => buildApprovedIndicators(analysis?.indicators ?? [], indicatorDrafts),
    [analysis, indicatorDrafts],
  );
  const indicatorBlockingCount = useMemo(
    () => blockingIndicatorCount(approvedIndicatorItems),
    [approvedIndicatorItems],
  );

  /* ---------------- trava de isolamento de cliente (client-isolation-guard.ts) ---------------- */

  const decisionForeignFlags = useMemo(
    () =>
      flagForeignClientItems(
        analysis?.decisions ?? [],
        (d) => [d.title, d.description, d.reason],
        clientName ?? "",
        otherClientNames,
      ),
    [analysis, clientName, otherClientNames],
  );
  const actionForeignFlags = useMemo(
    () =>
      flagForeignClientItems(
        analysis?.actions ?? [],
        (a) => [a.description, a.evidence],
        clientName ?? "",
        otherClientNames,
      ),
    [analysis, clientName, otherClientNames],
  );
  const riskForeignFlags = useMemo(
    () =>
      flagForeignClientItems(
        analysis?.risks ?? [],
        (r) => [r.description, r.evidence],
        clientName ?? "",
        otherClientNames,
      ),
    [analysis, clientName, otherClientNames],
  );
  const oppForeignFlags = useMemo(
    () =>
      flagForeignClientItems(
        analysis?.opportunities ?? [],
        (o) => [o.description, o.evidence],
        clientName ?? "",
        otherClientNames,
      ),
    [analysis, clientName, otherClientNames],
  );

  /* ---------------- E1/E2 — decisão-ou-ação (decision-action-flags.ts) ---------------- */

  const speakerMapEntries = useMemo(
    () => (analysis ? toSpeakerMapEntries(analysis.speaker_map) : []),
    [analysis],
  );

  /** E1: ação do cliente cujo texto indica opção/condição da vontade de quem executa. */
  const actionConditionalFlags = useMemo(() => {
    const result: Record<number, true> = {};
    (analysis?.actions ?? []).forEach((a, i) => {
      if (isConditionalClientAction(a.description, a.owner_name, speakerMapEntries))
        result[i] = true;
    });
    return result;
  }, [analysis, speakerMapEntries]);

  /* ---------------- GATE 10A — revisão em blocos ---------------- */

  const contextItemsByGroup = useMemo(
    () => contextRows.map((g) => ({ list: g.list, items: toReviewItems(g.rows, contextSel) })),
    [contextRows, contextSel],
  );
  const decisionItems = useMemo(
    () => toReviewItems(decisionRows, decisionSel, decisionForeignFlags),
    [decisionRows, decisionSel, decisionForeignFlags],
  );
  const actionItems = useMemo(
    () => toReviewItems(actionRows, actionSel, actionForeignFlags, actionConditionalFlags),
    [actionRows, actionSel, actionForeignFlags, actionConditionalFlags],
  );
  const riskItems = useMemo(
    () => toReviewItems(riskRows, riskSel, riskForeignFlags),
    [riskRows, riskSel, riskForeignFlags],
  );
  const oppItems = useMemo(
    () => toReviewItems(oppRows, oppSel, oppForeignFlags),
    [oppRows, oppSel, oppForeignFlags],
  );

  const allReviewItems = useMemo(
    () => [
      ...contextItemsByGroup.flatMap((g) => g.items),
      ...decisionItems,
      ...actionItems,
      ...riskItems,
      ...oppItems,
    ],
    [contextItemsByGroup, decisionItems, actionItems, riskItems, oppItems],
  );
  const overallCounts = useMemo(() => countReviewBlock(allReviewItems), [allReviewItems]);

  /** Mesma ordem em que os blocos aparecem na tela — ver firstItemNeedingReview. */
  const orderedReviewBlocks = useMemo<
    { blockId: string; items: ReviewBlockItem<string | number>[] }[]
  >(
    () => [
      ...contextItemsByGroup.map((g) => ({ blockId: `context:${g.list}`, items: g.items })),
      { blockId: "decisions", items: decisionItems },
      { blockId: "actions", items: actionItems },
      { blockId: "risks", items: riskItems },
      { blockId: "opportunities", items: oppItems },
    ],
    [contextItemsByGroup, decisionItems, actionItems, riskItems, oppItems],
  );

  /**
   * Autoavaliação da consultoria sobre a própria reunião — calculada a
   * partir do que a IA extraiu no preview, antes de qualquer aprovação.
   */
  const deliveryClarity = useMemo(
    () =>
      computeDeliveryClarity({
        actions: (analysis?.actions ?? []).map((a) => ({
          owner_name: a.owner_name,
          deadline: a.deadline,
          description: a.description,
        })),
        decisions: (analysis?.decisions ?? []).map((d) => ({
          title: d.title || d.description || "Decisão sem título",
        })),
        contextItems: contextRows.flatMap((g) =>
          g.rows.map((r) => `${CONTEXT_LIST_LABEL[g.list]}: ${r.item.text}`),
        ),
      }),
    [analysis, contextRows],
  );

  /**
   * Quantas das 12 categorias possíveis (8 listas de contexto + decisões,
   * ações, riscos, oportunidades) têm pelo menos um item nesta reunião —
   * visível mesmo quando é zero, pra o consultor nunca confundir "categoria
   * vazia de verdade" com "categoria escondida por bug" (achado real: caso
   * Grupo Erinho, issue #56).
   */
  const blockCategoryCounts = useMemo(() => {
    const categories = [
      ...contextItemsByGroup.map((g) => g.items.length),
      decisionItems.length,
      actionItems.length,
      riskItems.length,
      oppItems.length,
    ];
    return { total: categories.length, withContent: categories.filter((n) => n > 0).length };
  }, [contextItemsByGroup, decisionItems, actionItems, riskItems, oppItems]);

  /* ---------------- relatório de duplicidade (copiável) ---------------- */

  const duplicateReportText = useMemo(() => {
    if (!analysis || !meeting) return "";

    const projectNameOf = (projectId: string | null | undefined): string | null =>
      projectId ? (projectNameById.get(projectId) ?? null) : null;

    const contextCandidates = (
      ranked: { item: ContextItem; cosine: number | null }[],
    ): DuplicateReportCandidate[] =>
      ranked.map((r) => ({
        text: r.item.text,
        projectName: project?.name ?? null,
        meetingId: r.item.source_meeting_id ?? null,
        meetingDate: dateForMeetingId(r.item.source_meeting_id),
        status: null,
        owner: null,
        cosine: r.cosine,
      }));

    const decisionCandidates = (
      ranked: { item: Decision; cosine: number | null }[],
    ): DuplicateReportCandidate[] =>
      ranked.map((r) => ({
        text: r.item.title,
        projectName: projectNameOf(r.item.project_id),
        meetingId: r.item.meeting_id ?? null,
        meetingDate: dateForMeetingId(r.item.meeting_id),
        status: r.item.status ?? null,
        owner: r.item.owner ?? null,
        cosine: r.cosine,
      }));

    const actionCandidates = (
      ranked: { item: ActionItem; cosine: number | null }[],
    ): DuplicateReportCandidate[] =>
      ranked.map((r) => ({
        text: r.item.description,
        projectName: projectNameOf(originForMeetingId(r.item.meeting_id)),
        meetingId: r.item.meeting_id ?? null,
        meetingDate: dateForMeetingId(r.item.meeting_id),
        status: r.item.status ?? null,
        owner: r.item.owner_name ?? null,
        cosine: r.cosine,
      }));

    const riskCandidates = (
      ranked: { item: RiskItem; cosine: number | null }[],
    ): DuplicateReportCandidate[] =>
      ranked.map((r) => ({
        text: r.item.description,
        projectName: projectNameOf(originForMeetingId(r.item.meeting_id)),
        meetingId: r.item.meeting_id ?? null,
        meetingDate: dateForMeetingId(r.item.meeting_id),
        status: r.item.active ? "ativo" : "resolvido",
        owner: null,
        cosine: r.cosine,
      }));

    const oppCandidates = (
      ranked: { item: OpportunityItem; cosine: number | null }[],
    ): DuplicateReportCandidate[] =>
      ranked.map((r) => ({
        text: r.item.description,
        projectName: projectNameOf(originForMeetingId(r.item.meeting_id)),
        meetingId: r.item.meeting_id ?? null,
        meetingDate: dateForMeetingId(r.item.meeting_id),
        status: r.item.status ?? null,
        owner: null,
        cosine: r.cosine,
      }));

    const suggestions: DuplicateReportSuggestion[] = [
      ...contextRows.flatMap((group) =>
        group.rows.map((row) => ({
          category: group.list,
          text: (row.item as { text: string }).text,
          classification: CLASSIFICATION_LABEL[(row.item as { classification?: string }).classification ?? ""] ??
            (row.item as { classification?: string }).classification ??
            null,
          ownerName: null,
          deadline: null,
          verdict: row.resolution.verdict,
          confidence: row.resolution.confidence,
          posterior: row.resolution.chronology === "posterior",
          candidates: contextCandidates(
            rankCandidates(
              group.current,
              (row.item as { text: string }).text,
              (c) => c.text,
              (row.item as { embedding?: number[] | null }).embedding ?? null,
              (c) => c.embedding,
            ),
          ),
        })),
      ),
      ...(analysis.decisions ?? []).map((item, i) => ({
        category: "decisions",
        text: item.title,
        classification: CLASSIFICATION_LABEL[item.classification] ?? item.classification,
        ownerName: item.owner || null,
        deadline: item.due_date || null,
        verdict: decisionRows[i]!.resolution.verdict,
        confidence: decisionRows[i]!.resolution.confidence,
        posterior: decisionRows[i]!.resolution.chronology === "posterior",
        candidates: decisionCandidates(
          rankCandidates(dedupeDecisions, item.title, (d) => d.title, item.embedding ?? null, (d) => d.embedding),
        ),
      })),
      ...(analysis.actions ?? []).map((item, i) => ({
        category: "actions",
        text: item.description,
        classification: CLASSIFICATION_LABEL[item.classification] ?? item.classification,
        ownerName: item.owner_name || null,
        deadline: item.deadline || null,
        verdict: actionRows[i]!.resolution.verdict,
        confidence: actionRows[i]!.resolution.confidence,
        posterior: actionRows[i]!.resolution.chronology === "posterior",
        candidates: actionCandidates(
          rankCandidates(
            dedupeActions,
            item.description,
            (a) => a.description,
            item.embedding ?? null,
            (a) => a.embedding,
          ),
        ),
      })),
      ...(analysis.risks ?? []).map((item, i) => ({
        category: "risks",
        text: item.description,
        classification: CLASSIFICATION_LABEL[item.classification] ?? item.classification,
        ownerName: null,
        deadline: null,
        verdict: riskRows[i]!.resolution.verdict,
        confidence: riskRows[i]!.resolution.confidence,
        posterior: riskRows[i]!.resolution.chronology === "posterior",
        candidates: riskCandidates(
          rankCandidates(
            dedupeRisks,
            item.description,
            (r) => r.description,
            item.embedding ?? null,
            (r) => r.embedding,
          ),
        ),
      })),
      ...(analysis.opportunities ?? []).map((item, i) => ({
        category: "opportunities",
        text: item.description,
        classification: CLASSIFICATION_LABEL[item.classification] ?? item.classification,
        ownerName: null,
        deadline: null,
        verdict: oppRows[i]!.resolution.verdict,
        confidence: oppRows[i]!.resolution.confidence,
        posterior: oppRows[i]!.resolution.chronology === "posterior",
        candidates: oppCandidates(
          rankCandidates(
            dedupeOpportunities,
            item.description,
            (o) => o.description,
            item.embedding ?? null,
            (o) => o.embedding,
          ),
        ),
      })),
    ];

    return formatDuplicateReport({
      clientName: clientName ?? "—",
      projectName: project?.name ?? "—",
      meetingId: meeting.id,
      meetingDate: meeting.meeting_date,
      counts: {
        total: overallCounts.total,
        new: overallCounts.newCount,
        updated: overallCounts.updateCount,
        review: overallCounts.reviewCount,
        ignored: overallCounts.ignoredCount,
      },
      consolidations: (analysis.semantic_consolidation?.groups ?? []).map((g) => ({
        category: g.category ?? "",
        canonicalText: g.canonicalText ?? "",
        mergedTexts: g.mergedTexts ?? [],
      })),
      suggestions,
    });
  }, [
    analysis,
    meeting,
    project,
    clientName,
    contextRows,
    decisionRows,
    actionRows,
    riskRows,
    oppRows,
    dedupeDecisions,
    dedupeActions,
    dedupeRisks,
    dedupeOpportunities,
    overallCounts,
    projectNameById,
    projectIdByMeetingId,
    meetingDateByMeetingId,
  ]);

  const copyDuplicateReport = () => {
    if (!duplicateReportText) {
      toast.error("Nenhuma análise carregada ainda.");
      return;
    }
    void navigator.clipboard
      .writeText(duplicateReportText)
      .then(() => toast.success("Relatório de duplicidade copiado."))
      .catch(() => toast.error("Não foi possível copiar — copie manualmente pelo console."));
  };

  /** Expand/recolher por bloco — o default (aberto se precisa revisão) é fixado uma vez por análise carregada. */
  const [blockOpen, setBlockOpen] = useState<Record<string, boolean>>({});
  /**
   * Alvo pendente de rolagem (botão "Revise N item(ns)") — setado junto com
   * blockOpen; o efeito abaixo rola até a linha depois que o bloco abrir.
   */
  const [pendingReviewScroll, setPendingReviewScroll] = useState<{
    blockId: string;
    key: string | number;
  } | null>(null);
  useEffect(() => {
    if (!pendingReviewScroll) return;
    const el = document.getElementById(
      `review-row-${pendingReviewScroll.blockId}-${pendingReviewScroll.key}`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingReviewScroll(null);
  }, [pendingReviewScroll]);
  /**
   * Clique do botão final quando ainda há itens em revisão: NUNCA aprova —
   * só abre o bloco do primeiro item pendente (mesma ordem da tela) e rola
   * até a linha dele.
   */
  const goToFirstItemNeedingReview = () => {
    const target = firstItemNeedingReview(orderedReviewBlocks);
    if (!target) return;
    setBlockOpen((s) => ({ ...s, [target.blockId]: true }));
    setPendingReviewScroll(target);
  };
  /**
   * GATE 10D — decisão explícita de "Aprovar bloco"/"Ignorar bloco", por
   * bloco. Não é redundante com contextSel/decisionSel/…: aqueles guardam a
   * RESOLUÇÃO de cada item; isto guarda que uma AÇÃO EM LOTE foi tomada e o
   * retrato de modos naquele instante, só para o feedback visual do botão —
   * nunca é lido por applyApprovedAnalysis nem influencia contagem alguma.
   */
  const [blockDecisions, setBlockDecisions] = useState<Record<string, BlockDecisionRecord>>({});
  useEffect(() => {
    if (!analysis) return;
    const next: Record<string, boolean> = {};
    for (const g of contextItemsByGroup) {
      next[`context:${g.list}`] = countReviewBlock(g.items).reviewCount > 0;
    }
    next["decisions"] = countReviewBlock(decisionItems).reviewCount > 0;
    next["actions"] = countReviewBlock(actionItems).reviewCount > 0;
    next["risks"] = countReviewBlock(riskItems).reviewCount > 0;
    next["opportunities"] = countReviewBlock(oppItems).reviewCount > 0;
    setBlockOpen(next);
    setBlockDecisions({});
    // Só reavalia o default de abertura quando uma NOVA análise é carregada —
    // não a cada seleção manual do consultor (senão um bloco resolvido
    // recolheria sozinho debaixo do usuário).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  /**
   * Aplica um patch em lote E registra a decisão (para o feedback visual).
   * O retrato ("snapshot") é o modo de cada item logo após o patch — se o
   * consultor mudar algo manualmente depois, o modo atual deixa de bater com
   * o retrato e o bloco passa a mostrar "Revisado manualmente" em vez de
   * continuar afirmando que está aprovado/ignorado.
   */
  function applyBlockDecision<K extends string | number>(
    blockId: string,
    items: ReviewBlockItem<K>[],
    setSel: Dispatch<SetStateAction<Record<K, ResolutionMode>>>,
    patch: Partial<Record<K, ResolutionMode>>,
    decision: "approved" | "ignored",
  ) {
    mergeSel(setSel, patch);
    setBlockDecisions((s) => ({
      ...s,
      [blockId]: { decision, snapshot: snapshotAfterPatch(items, patch) },
    }));
  }

  /** "Aplicar sugestões seguras" no card do topo — cobre todos os blocos de uma vez. */
  const applyAllSafe = () => {
    for (const g of contextItemsByGroup) {
      applyBlockDecision(`context:${g.list}`, g.items, setContextSel, applySafeResolutions(g.items), "approved");
    }
    applyBlockDecision("decisions", decisionItems, setDecisionSel, applySafeResolutions(decisionItems), "approved");
    applyBlockDecision("actions", actionItems, setActionSel, applySafeResolutions(actionItems), "approved");
    applyBlockDecision("risks", riskItems, setRiskSel, applySafeResolutions(riskItems), "approved");
    applyBlockDecision("opportunities", oppItems, setOppSel, applySafeResolutions(oppItems), "approved");
  };

  /** Status coerente de cada bloco — usado no card do topo (progresso da revisão). */
  const blockStatuses: BlockStatus[] = useMemo(
    () => [
      ...contextItemsByGroup.map((g) => computeBlockStatus(g.items, blockDecisions[`context:${g.list}`])),
      computeBlockStatus(decisionItems, blockDecisions["decisions"]),
      computeBlockStatus(actionItems, blockDecisions["actions"]),
      computeBlockStatus(riskItems, blockDecisions["risks"]),
      computeBlockStatus(oppItems, blockDecisions["opportunities"]),
    ],
    [contextItemsByGroup, decisionItems, actionItems, riskItems, oppItems, blockDecisions],
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

  /* ---------------- análise ---------------- */

  const analyze = useMutation({
    mutationFn: async () => {
      if (!meeting) throw new Error("Reunião não encontrada.");
      if (isApproved) throw new Error("Esta reunião já foi aprovada — não é possível reanalisar.");
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
        rawAiResponse: result.rawAiResponse ?? null,
      });
      return { analysis: result.analysis, agenda: nextAgenda, rawAiResponse: result.rawAiResponse ?? null };
    },
    onSuccess: ({ analysis: a, agenda: g, rawAiResponse: rawResp }) => {
      setErrors([]);
      setAnalysis(a);
      setAgenda(g);
      setRawAiResponseState(rawResp);
      setContextSel({});
      setDecisionSel({});
      setActionSel({});
      setDecisionCompletedSel({});
      setActionCompletedSel({});
      setDecisionEvaluationSel({});
      setRiskSel({});
      setOppSel({});
      setIndicatorEdits({});
      // Gate F: mesma razão dos resets acima — r.key é reatribuído do zero
      // pela nova análise, então uma escolha de responsável antiga aplicaria
      // ao item errado se sobrevivesse à reanálise.
      setDecisionOwnerSel({});
      setActionOwnerSel({});
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
    // Rascunho reaberto direto na revisão, sem etapa de edição do mapa:
    // aplica o speaker_map salvo com a análise (vazio em rascunhos antigos,
    // que então só esvaziam o rótulo genérico, sem trocar por nome nenhum).
    const cleaned = applySpeakerMapToAnalysis(
      parsed.analysis,
      toSpeakerMapEntries(parsed.analysis.speaker_map),
    );
    setAnalysis(cleaned);
    setAgenda(
      buildAgenda({
        suggested: cleaned.agenda_recommendation,
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
      if (isApproved) throw new Error("Esta reunião já foi aprovada — não é possível aprovar de novo.");
      setApproveError(null);

      /**
       * Rascunho (id vazio): só grava a reunião de verdade agora, não antes.
       * Fechar o diálogo sem aprovar nunca deixa linha nenhuma em `meetings`.
       */
      const persistedMeeting = meeting.id ? meeting : await onPersistDraftMeeting?.();
      if (!persistedMeeting) throw new Error("Não foi possível gravar a reunião antes de aprovar.");

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
        satisfactionScore: summarySel ? (analysis.meeting.satisfaction_score ?? null) : null,
        valueScore: summarySel ? (analysis.meeting.value_score ?? null) : null,
        nextAction: summarySel ? analysis.meeting.next_action || null : null,
        mainPriority: summarySel ? analysis.meeting.main_priority || null : null,
        mainPain: summarySel ? analysis.meeting.main_pain || null : null,
        actionOwner: summarySel ? analysis.meeting.action_owner || null : null,
        actionDeadline: summarySel ? analysis.meeting.action_deadline || null : null,
        explicitComplaint: summarySel ? analysis.meeting.explicit_complaint : false,
        continuityDoubt: summarySel ? analysis.meeting.continuity_doubt : false,
        lowClientAdherence: summarySel ? analysis.meeting.low_client_adherence : false,
        missingInternalOwner: summarySel ? analysis.meeting.missing_internal_owner : false,
        // Autoavaliação da consultoria (sem IA) — não depende do checkbox de
        // resumo, que só controla campos vindos da IA.
        deliveryClarityRate: deliveryClarity.actionCompletenessRate.rate,
        commitmentConversionRate: deliveryClarity.commitmentConversionRate.rate,
        contextItems,
        decisions: decisionRows.map((r) => {
          const isEvaluation =
            r.mode === "create"
              ? (decisionEvaluationSel[r.key] ?? r.item.is_evaluation === true)
              : false;
          return {
            title: r.item.title,
            description: r.item.description,
            reason: r.item.reason,
            // Gate F: escolha manual do consultor no seletor sobrepõe a sugestão da IA.
            owner: decisionOwnerSel[r.key] ?? r.item.owner,
            // B18: "Criar novo" grava o prazo final (editado ou sugerido via hint);
            // "Atualizar existente"/"Ignorar" não mexem no prazo — nada muda.
            due_date:
              r.mode === "create"
                ? (decisionDueDateSel[r.key] ??
                  defaultItemDueDate(r.item.due_date, r.item.due_hint, meeting.meeting_date))
                : r.item.due_date,
            resolution: r.resolution,
            embedding: r.item.embedding ?? null,
            // Regra B: só faz sentido pra "Criar novo" — applyApprovedAnalysis só lê nesse ramo.
            completed:
              r.mode === "create"
                ? (decisionCompletedSel[r.key] ??
                  isNewDecisionPreMarkedCompleted(r.item.due_date, todayIso, isEvaluation))
                : false,
            // B1: caixa "Avaliação" — mesma regra, só faz sentido pra "Criar novo".
            is_evaluation: isEvaluation,
          };
        }),
        actions: actionRows.map((r) => ({
          description: r.item.description,
          // Gate F: escolha manual do consultor no seletor sobrepõe a sugestão da IA.
          owner_name: actionOwnerSel[r.key] ?? r.item.owner_name,
          // B18: mesma regra do due_date de decisões — ver comentário acima.
          deadline:
            r.mode === "create"
              ? (actionDeadlineSel[r.key] ??
                defaultItemDueDate(r.item.deadline, r.item.deadline_hint, meeting.meeting_date))
              : r.item.deadline,
          priority: r.item.priority,
          erp_area: r.item.erp_area,
          evidence: "",
          resolution: r.resolution,
          embedding: r.item.embedding ?? null,
          // R02 (18/10/2026): ação NUNCA vem pré-marcada como concluída — só a
          // escolha manual do consultor (actionCompletedSel) vale; sem ela, começa
          // desmarcada mesmo em "Criar novo" com prazo vencido.
          completed: r.mode === "create" ? (actionCompletedSel[r.key] ?? false) : false,
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
        // Indicadores de resultado parte 4, Gate C — já validado contra
        // indicatorBlockingCount antes do botão de aprovar ficar habilitado.
        indicators: approvedIndicatorItems,
        agenda,
      };

      const applied = await applyApprovedAnalysis({
        meeting: persistedMeeting,
        projectId: project.id,
        context,
        selection,
        analysisId: saved.data?.id ?? null,
        evolution: evolutionItems,
      });
      await saveAnalysisDraft({
        meetingId: persistedMeeting.id,
        projectId: project.id,
        clientId: persistedMeeting.client_id,
        transcript,
        analysis,
        agenda,
        status: "aprovada",
        rawAiResponse: rawAiResponseState,
      });
      return applied;
    },
    onSuccess: (r) => {
      submitting.current = false;
      setApproveError(null);
      setApproved(true);
      toast.success(formatApplyResultMessage(r));
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

  /**
   * Uma submissão por vez: o backend já é idempotente, aqui evitamos o
   * retrabalho. Trava extra (defesa em profundidade, além do botão só
   * navegar nesse estado): com item em revisão, nunca aprova nem grava —
   * mesmo se chamada por outro caminho.
   */
  const submitApproval = () => {
    if (
      submitting.current ||
      approve.isPending ||
      approved ||
      overallCounts.reviewCount > 0 ||
      indicatorBlockingCount > 0
    )
      return;
    submitting.current = true;
    approve.mutate();
  };

  const total = overallCounts.total;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b p-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden /> Reunião inteligente
          </DialogTitle>
          <DialogDescription>
            {meeting
              ? `${formatDate(meeting.meeting_date)} · ${meeting.meeting_type ?? "Reunião"}${project?.name ? ` · ${project.name}` : ""} — transcrição, análise, revisão do consultor e próxima pauta.`
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

            {isApproved && !approved && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> Reunião já
                  aprovada — somente leitura
                </p>
                <p className="mt-1 text-muted-foreground">
                  A aprovação é definitiva. Esta análise não pode ser reanalisada nem aprovada de
                  novo.
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
                {(analysis.meeting.executive_summary ||
                  analysis.meeting.main_topic ||
                  analysis.meeting.measurable_result) && (
                  <section className="rounded-lg border p-4">
                    <label className="flex items-start gap-3">
                      <Checkbox
                        checked={summarySel}
                        onCheckedChange={(v) => setSummarySel(v === true)}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">Resumo executivo</span>
                        {analysis.meeting.executive_summary && (
                          <span className="block text-sm text-muted-foreground">
                            {analysis.meeting.executive_summary}
                          </span>
                        )}
                        {analysis.meeting.main_topic && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            <span className="font-medium">Tópico principal:</span>{" "}
                            {analysis.meeting.main_topic}
                          </span>
                        )}
                        {analysis.meeting.measurable_result && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            <span className="font-medium">Resultado mensurável:</span>{" "}
                            {analysis.meeting.measurable_result}
                          </span>
                        )}
                        {meeting?.id && meeting?.executive_summary ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            A reunião já possui resumo — o texto atual é preservado.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </section>
                )}

                {(analysis.meeting.satisfaction_score !== null ||
                  analysis.meeting.value_score !== null ||
                  analysis.meeting.next_action ||
                  analysis.meeting.main_priority ||
                  analysis.meeting.main_pain ||
                  analysis.meeting.action_owner ||
                  analysis.meeting.action_deadline ||
                  analysis.meeting.explicit_complaint ||
                  analysis.meeting.continuity_doubt ||
                  analysis.meeting.low_client_adherence ||
                  analysis.meeting.missing_internal_owner) && (
                  <section className="rounded-lg border p-4">
                    <span className="block text-sm font-semibold">Diagnóstico da reunião</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {summarySel
                        ? 'Será gravado junto com o "Resumo executivo" acima.'
                        : 'Não será gravado — marque "Resumo executivo" acima para incluir.'}
                    </span>
                    <div className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                      <span className="block">
                        <span className="font-medium">Satisfação / Valor:</span>{" "}
                        {analysis.meeting.satisfaction_score !== null
                          ? `${analysis.meeting.satisfaction_score}/10`
                          : "—"}{" "}
                        ·{" "}
                        {analysis.meeting.value_score !== null
                          ? `${analysis.meeting.value_score}/10`
                          : "—"}
                      </span>
                      {analysis.meeting.main_priority && (
                        <span className="block">
                          <span className="font-medium">Prioridade:</span>{" "}
                          {analysis.meeting.main_priority}
                        </span>
                      )}
                      {analysis.meeting.main_pain && (
                        <span className="block">
                          <span className="font-medium">Dor principal:</span>{" "}
                          {analysis.meeting.main_pain}
                        </span>
                      )}
                      {analysis.meeting.next_action && (
                        <span className="block sm:col-span-2">
                          <span className="font-medium">Próxima ação:</span>{" "}
                          {analysis.meeting.next_action}
                        </span>
                      )}
                      {(analysis.meeting.action_owner || analysis.meeting.action_deadline) && (
                        <span className="block sm:col-span-2">
                          <span className="font-medium">Responsável / prazo:</span>{" "}
                          {analysis.meeting.action_owner || "—"}
                          {analysis.meeting.action_deadline
                            ? ` · ${formatDate(analysis.meeting.action_deadline)}`
                            : ""}
                        </span>
                      )}
                    </div>
                    {(analysis.meeting.explicit_complaint ||
                      analysis.meeting.continuity_doubt ||
                      analysis.meeting.low_client_adherence ||
                      analysis.meeting.missing_internal_owner) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {analysis.meeting.explicit_complaint && (
                          <Badge variant="destructive">Reclamação explícita</Badge>
                        )}
                        {analysis.meeting.continuity_doubt && (
                          <Badge variant="destructive">Dúvida de continuidade</Badge>
                        )}
                        {analysis.meeting.low_client_adherence && (
                          <Badge variant="outline">Baixa adesão do cliente</Badge>
                        )}
                        {analysis.meeting.missing_internal_owner && (
                          <Badge variant="outline">Sem responsável interno</Badge>
                        )}
                      </div>
                    )}
                  </section>
                )}

                <section className="rounded-lg border p-4">
                  <span className="block text-sm font-semibold">Clareza da entrega</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Autoavaliação da consultoria sobre esta reunião — não é uma nota do cliente.
                  </span>
                  <div className="mt-3 grid gap-4">
                    <div>
                      <span
                        className="block text-xs font-medium text-muted-foreground"
                        title="Entre as ações que a IA identificou nesta reunião — não cobre tudo que foi discutido."
                      >
                        Taxa de encaminhamento completo
                      </span>
                      <span className="block text-[11px] text-muted-foreground/70">
                        Entre as ações identificadas pela IA nesta reunião
                      </span>
                      <span className="mt-1 block text-lg font-semibold">
                        {deliveryClarity.actionCompletenessRate.rate !== null
                          ? `${deliveryClarity.actionCompletenessRate.rate}%`
                          : "—"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {deliveryClarity.actionCompletenessRate.label}
                      </span>
                    </div>
                  </div>
                </section>

                <ReviewSummaryCard
                  counts={overallCounts}
                  onApplySafe={applyAllSafe}
                  onCopyDuplicateReport={copyDuplicateReport}
                  blocksTotal={blockStatuses.length}
                  blocksReviewed={blockStatuses.filter((s) => s === "approved" || s === "ignored").length}
                  categoriesWithContent={blockCategoryCounts.withContent}
                  categoriesTotal={blockCategoryCounts.total}
                  executionQuality={analysis?.execution_quality}
                  semanticConsolidation={analysis?.semantic_consolidation}
                />

                {contextRows.map((group, gi) => {
                  const blockId = `context:${group.list}`;
                  const items = contextItemsByGroup[gi]?.items ?? [];
                  return (
                    <ReviewBlock
                      key={group.list}
                      id={blockId}
                      title={CONTEXT_LIST_LABEL[group.list]}
                      items={items}
                      status={computeBlockStatus(items, blockDecisions[blockId])}
                      open={blockOpen[blockId] ?? false}
                      onOpenChange={(v) => setBlockOpen((s) => ({ ...s, [blockId]: v }))}
                      onApplySafe={() =>
                        applyBlockDecision(blockId, items, setContextSel, applySafeResolutions(items), "approved")
                      }
                      onIgnoreAll={() =>
                        applyBlockDecision(blockId, items, setContextSel, applyIgnoreBlock(items), "ignored")
                      }
                    >
                      <p className="pb-1 text-xs text-muted-foreground">
                        {group.current.length} atuais
                      </p>
                      <ul className="space-y-2">
                        {group.rows.map((r) => (
                          <ReviewRow
                            key={r.key}
                            rowId={`review-row-${blockId}-${r.key}`}
                            primary={r.item.text}
                            secondary={OPERATION_LABEL[r.item.operation as ChangeOperation] ?? ""}
                            classification={r.item.classification}
                            row={r}
                            onChange={(mode) => setContextSel((s) => ({ ...s, [r.key]: mode }))}
                          />
                        ))}
                      </ul>
                    </ReviewBlock>
                  );
                })}

                <ReviewBlock
                  id="decisions"
                  title="Decisões"
                  items={decisionItems}
                  status={computeBlockStatus(decisionItems, blockDecisions["decisions"])}
                  open={blockOpen["decisions"] ?? false}
                  onOpenChange={(v) => setBlockOpen((s) => ({ ...s, decisions: v }))}
                  onApplySafe={() =>
                    applyBlockDecision(
                      "decisions",
                      decisionItems,
                      setDecisionSel,
                      applySafeResolutions(decisionItems),
                      "approved",
                    )
                  }
                  onIgnoreAll={() =>
                    applyBlockDecision(
                      "decisions",
                      decisionItems,
                      setDecisionSel,
                      applyIgnoreBlock(decisionItems),
                      "ignored",
                    )
                  }
                >
                  <ul className="space-y-2">
                    {decisionRows.map((r) => {
                      const existingDecision = r.match.existing as Decision | null;
                      // B27 (correção): existing pode vir preenchido mesmo com veredito NEW
                      // (candidato de baixa similaridade encontrado, mas type="NEW") — o
                      // painel só faz sentido para um candidato REAL (UPDATE_EXISTING/
                      // EXISTING/POSSIBLE_DUPLICATE), nunca para NEW.
                      const isRealMatch = r.match.type !== "NEW";
                      const comparison: ComparisonPanelData | null =
                        existingDecision && isRealMatch
                          ? {
                              existingMeetingDate: dateForMeetingId(existingDecision.meeting_id),
                              existing: {
                                // B27B: título NUNCA é sobrescrito — o lado existente sempre mostra o título do registro.
                                text: existingDecision.title,
                                responsible: existingDecision.owner,
                                status: existingDecision.status,
                                extra: [
                                  { label: "Descrição", value: existingDecision.description ?? "" },
                                  { label: "Motivo", value: existingDecision.reason ?? "" },
                                ],
                              },
                              ...(r.mode === "update"
                                ? {
                                    rightLabel: "Resultado após atualizar" as const,
                                    updated: {
                                      // Resultado real do patch: título mantido, demais campos só quando presentes.
                                      text: existingDecision.title,
                                      responsible: r.item.owner || existingDecision.owner,
                                      status: existingDecision.status,
                                      extra: [
                                        {
                                          label: "Descrição",
                                          value:
                                            r.item.description ||
                                            existingDecision.description ||
                                            "",
                                        },
                                        {
                                          label: "Motivo",
                                          value: r.item.reason || existingDecision.reason || "",
                                        },
                                      ],
                                    },
                                  }
                                : {
                                    rightLabel: "Novo (desta reunião)" as const,
                                    // Nada será gravado neste modo — mostra o item exatamente como a IA extraiu.
                                    updated: {
                                      text: r.item.title,
                                      responsible: r.item.owner,
                                      status: r.item.status,
                                      extra: [
                                        { label: "Descrição", value: r.item.description },
                                        { label: "Motivo", value: r.item.reason },
                                      ],
                                    },
                                  }),
                            }
                          : null;
                      return (
                        <ReviewRow
                          key={r.key}
                          rowId={`review-row-decisions-${r.key}`}
                          primary={r.item.title}
                          secondary={[r.item.owner, r.item.due_date].filter(Boolean).join(" · ")}
                          details={[
                            { label: "Descrição", value: r.item.description },
                            { label: "Motivo", value: r.item.reason },
                          ].filter((d) => d.value)}
                          classification={r.item.classification}
                          row={r}
                          foreignClientSnippet={decisionForeignFlags[r.key]}
                          comparison={comparison}
                          onChange={(mode) => setDecisionSel((s) => ({ ...s, [r.key]: mode }))}
                          completed={
                            decisionCompletedSel[r.key] ??
                            isNewDecisionPreMarkedCompleted(
                              r.item.due_date,
                              todayIso,
                              decisionEvaluationSel[r.key] ?? r.item.is_evaluation === true,
                            )
                          }
                          onCompletedChange={(v) =>
                            setDecisionCompletedSel((s) => ({ ...s, [r.key]: v }))
                          }
                          isEvaluation={
                            decisionEvaluationSel[r.key] ?? r.item.is_evaluation === true
                          }
                          onIsEvaluationChange={(v) =>
                            setDecisionEvaluationSel((s) => ({ ...s, [r.key]: v }))
                          }
                          dueDate={
                            decisionDueDateSel[r.key] ??
                            defaultItemDueDate(
                              r.item.due_date,
                              r.item.due_hint,
                              meeting?.meeting_date,
                            )
                          }
                          dueDateSuggested={isSuggestedDueDate(
                            r.item.due_date,
                            r.item.due_hint,
                            meeting?.meeting_date,
                            decisionDueDateSel[r.key],
                          )}
                          onDueDateChange={(v) =>
                            setDecisionDueDateSel((s) => ({ ...s, [r.key]: v }))
                          }
                          ownerOptions={
                            people.length
                              ? orderPeopleForItem(
                                  people,
                                  preferredFunctionsForItem("decisao", r.item.title),
                                  decisionOwnerSel[r.key] ?? r.item.owner,
                                )
                              : undefined
                          }
                          ownerValue={
                            people.length ? (decisionOwnerSel[r.key] ?? r.item.owner) : undefined
                          }
                          ownerOverridden={decisionOwnerSel[r.key] !== undefined}
                          onOwnerChange={
                            people.length
                              ? (v) => setDecisionOwnerSel((s) => ({ ...s, [r.key]: v }))
                              : undefined
                          }
                        />
                      );
                    })}
                  </ul>
                </ReviewBlock>

                <ReviewBlock
                  id="actions"
                  title="Ações"
                  items={actionItems}
                  status={computeBlockStatus(actionItems, blockDecisions["actions"])}
                  open={blockOpen["actions"] ?? false}
                  onOpenChange={(v) => setBlockOpen((s) => ({ ...s, actions: v }))}
                  onApplySafe={() =>
                    applyBlockDecision(
                      "actions",
                      actionItems,
                      setActionSel,
                      applySafeResolutions(actionItems),
                      "approved",
                    )
                  }
                  onIgnoreAll={() =>
                    applyBlockDecision("actions", actionItems, setActionSel, applyIgnoreBlock(actionItems), "ignored")
                  }
                >
                  <ul className="space-y-2">
                    {actionRows.map((r) => {
                      const existingAction = r.match.existing as ActionItem | null;
                      // B27 (correção): ver comentário equivalente no bloco de decisões.
                      const isRealMatch = r.match.type !== "NEW";
                      const comparison: ComparisonPanelData | null =
                        existingAction && isRealMatch
                          ? {
                              existingMeetingDate: dateForMeetingId(existingAction.meeting_id),
                              existing: {
                                text: existingAction.description,
                                responsible: existingAction.owner_name,
                                status: existingAction.status,
                                extra: [
                                  { label: "Prioridade", value: existingAction.priority },
                                  { label: "Prazo", value: existingAction.deadline ?? "" },
                                ],
                              },
                              ...(r.mode === "update"
                                ? {
                                    rightLabel: "Resultado após atualizar" as const,
                                    // B27B: a descrição da ação nunca é sobrescrita por "Atualizar
                                    // existente" — o texto novo acumula só no histórico de evidência.
                                    updated: {
                                      text: existingAction.description,
                                      responsible: r.item.owner_name || existingAction.owner_name,
                                      status: existingAction.status,
                                      extra: [
                                        {
                                          label: "Prioridade",
                                          value: r.item.priority || existingAction.priority,
                                        },
                                        {
                                          label: "Prazo",
                                          value: r.item.deadline || existingAction.deadline || "",
                                        },
                                      ],
                                    },
                                    evidenceAddition: r.item.evidence || r.item.description,
                                  }
                                : {
                                    rightLabel: "Novo (desta reunião)" as const,
                                    updated: {
                                      text: r.item.description,
                                      responsible: r.item.owner_name,
                                      status: null,
                                      extra: [
                                        { label: "Prioridade", value: r.item.priority },
                                        { label: "Prazo", value: r.item.deadline },
                                      ],
                                    },
                                  }),
                            }
                          : null;
                      return (
                        <ReviewRow
                          key={r.key}
                          rowId={`review-row-actions-${r.key}`}
                          primary={r.item.description}
                          secondary={[r.item.owner_name, r.item.deadline, r.item.priority]
                            .filter(Boolean)
                            .join(" · ")}
                          details={[{ label: "Área ERP", value: r.item.erp_area }].filter(
                            (d) => d.value,
                          )}
                          classification={r.item.classification}
                          row={r}
                          foreignClientSnippet={actionForeignFlags[r.key]}
                          conditionalActionFlag={actionConditionalFlags[r.key] !== undefined}
                          comparison={comparison}
                          onChange={(mode) => setActionSel((s) => ({ ...s, [r.key]: mode }))}
                          completed={actionCompletedSel[r.key] ?? false}
                          onCompletedChange={(v) =>
                            setActionCompletedSel((s) => ({ ...s, [r.key]: v }))
                          }
                          dueDate={
                            actionDeadlineSel[r.key] ??
                            defaultItemDueDate(
                              r.item.deadline,
                              r.item.deadline_hint,
                              meeting?.meeting_date,
                            )
                          }
                          dueDateSuggested={isSuggestedDueDate(
                            r.item.deadline,
                            r.item.deadline_hint,
                            meeting?.meeting_date,
                            actionDeadlineSel[r.key],
                          )}
                          onDueDateChange={(v) =>
                            setActionDeadlineSel((s) => ({ ...s, [r.key]: v }))
                          }
                          ownerOptions={
                            people.length
                              ? orderPeopleForItem(
                                  people,
                                  preferredFunctionsForItem("acao", r.item.description),
                                  actionOwnerSel[r.key] ?? r.item.owner_name,
                                )
                              : undefined
                          }
                          ownerValue={
                            people.length
                              ? (actionOwnerSel[r.key] ?? r.item.owner_name)
                              : undefined
                          }
                          ownerOverridden={actionOwnerSel[r.key] !== undefined}
                          onOwnerChange={
                            people.length
                              ? (v) => setActionOwnerSel((s) => ({ ...s, [r.key]: v }))
                              : undefined
                          }
                        />
                      );
                    })}
                  </ul>
                </ReviewBlock>

                <ReviewBlock
                  id="risks"
                  title="Riscos"
                  items={riskItems}
                  status={computeBlockStatus(riskItems, blockDecisions["risks"])}
                  open={blockOpen["risks"] ?? false}
                  onOpenChange={(v) => setBlockOpen((s) => ({ ...s, risks: v }))}
                  onApplySafe={() =>
                    applyBlockDecision("risks", riskItems, setRiskSel, applySafeResolutions(riskItems), "approved")
                  }
                  onIgnoreAll={() =>
                    applyBlockDecision("risks", riskItems, setRiskSel, applyIgnoreBlock(riskItems), "ignored")
                  }
                >
                  <ul className="space-y-2">
                    {riskRows.map((r) => {
                      const existingRisk = r.match.existing as RiskItem | null;
                      const newActive =
                        r.match.statusSignal === "resolved"
                          ? "resolvido"
                          : r.match.statusSignal === "reopened"
                            ? "ativo"
                            : existingRisk
                              ? existingRisk.active
                                ? "ativo"
                                : "resolvido"
                              : "";
                      // B27 (correção): ver comentário equivalente no bloco de decisões.
                      const isRealMatch = r.match.type !== "NEW";
                      const comparison: ComparisonPanelData | null =
                        existingRisk && isRealMatch
                          ? {
                              existingMeetingDate: dateForMeetingId(existingRisk.meeting_id),
                              existing: {
                                // B27B: a descrição do risco não é sobrescrita por "Atualizar existente".
                                text: existingRisk.description,
                                responsible: null,
                                status: null,
                                extra: [
                                  { label: "Nível", value: existingRisk.level },
                                  {
                                    label: "Ativo",
                                    value: existingRisk.active ? "ativo" : "resolvido",
                                  },
                                ],
                              },
                              ...(r.mode === "update"
                                ? {
                                    rightLabel: "Resultado após atualizar" as const,
                                    updated: {
                                      text: existingRisk.description,
                                      responsible: null,
                                      status: null,
                                      extra: [
                                        {
                                          label: "Nível",
                                          value: r.item.level || existingRisk.level,
                                        },
                                        { label: "Ativo", value: newActive },
                                      ],
                                    },
                                  }
                                : {
                                    rightLabel: "Novo (desta reunião)" as const,
                                    updated: {
                                      text: r.item.description,
                                      responsible: null,
                                      status: null,
                                      extra: [{ label: "Nível", value: r.item.level }],
                                    },
                                  }),
                            }
                          : null;
                      return (
                        <ReviewRow
                          key={r.key}
                          rowId={`review-row-risks-${r.key}`}
                          primary={r.item.description}
                          secondary={[r.item.level, r.item.impact, r.item.recommendation]
                            .filter(Boolean)
                            .join(" · ")}
                          details={[
                            { label: "Título", value: r.item.title },
                            { label: "Probabilidade", value: r.item.probability },
                            { label: "Evidência", value: r.item.evidence },
                          ].filter((d) => d.value)}
                          classification={r.item.classification}
                          row={r}
                          foreignClientSnippet={riskForeignFlags[r.key]}
                          comparison={comparison}
                          onChange={(mode) => setRiskSel((s) => ({ ...s, [r.key]: mode }))}
                        />
                      );
                    })}
                  </ul>
                </ReviewBlock>

                <ReviewBlock
                  id="opportunities"
                  title="Oportunidades"
                  items={oppItems}
                  status={computeBlockStatus(oppItems, blockDecisions["opportunities"])}
                  open={blockOpen["opportunities"] ?? false}
                  onOpenChange={(v) => setBlockOpen((s) => ({ ...s, opportunities: v }))}
                  onApplySafe={() =>
                    applyBlockDecision(
                      "opportunities",
                      oppItems,
                      setOppSel,
                      applySafeResolutions(oppItems),
                      "approved",
                    )
                  }
                  onIgnoreAll={() =>
                    applyBlockDecision("opportunities", oppItems, setOppSel, applyIgnoreBlock(oppItems), "ignored")
                  }
                >
                  <ul className="space-y-2">
                    {oppRows.map((r) => {
                      const existingOpp = r.match.existing as OpportunityItem | null;
                      // B27 (correção): ver comentário equivalente no bloco de decisões.
                      const isRealMatch = r.match.type !== "NEW";
                      const comparison: ComparisonPanelData | null =
                        existingOpp && isRealMatch
                          ? {
                              existingMeetingDate: dateForMeetingId(existingOpp.meeting_id),
                              existing: {
                                // B27B: a descrição da oportunidade não é sobrescrita por "Atualizar existente".
                                text: existingOpp.description,
                                responsible: null,
                                status: existingOpp.status,
                                extra: [
                                  {
                                    label: "Benefício esperado",
                                    value: existingOpp.expected_benefit ?? "",
                                  },
                                ],
                              },
                              ...(r.mode === "update"
                                ? {
                                    rightLabel: "Resultado após atualizar" as const,
                                    updated: {
                                      text: existingOpp.description,
                                      responsible: null,
                                      status: existingOpp.status,
                                      extra: [
                                        {
                                          label: "Benefício esperado",
                                          value:
                                            r.item.expected_benefit ||
                                            existingOpp.expected_benefit ||
                                            "",
                                        },
                                      ],
                                    },
                                  }
                                : {
                                    rightLabel: "Novo (desta reunião)" as const,
                                    updated: {
                                      text: r.item.description,
                                      responsible: null,
                                      status: null,
                                      extra: [
                                        {
                                          label: "Benefício esperado",
                                          value: r.item.expected_benefit,
                                        },
                                      ],
                                    },
                                  }),
                            }
                          : null;
                      return (
                        <ReviewRow
                          key={r.key}
                          rowId={`review-row-opportunities-${r.key}`}
                          primary={r.item.description}
                          secondary={r.item.expected_benefit}
                          details={[{ label: "Evidência", value: r.item.evidence }].filter(
                            (d) => d.value,
                          )}
                          classification={r.item.classification}
                          row={r}
                          foreignClientSnippet={oppForeignFlags[r.key]}
                          comparison={comparison}
                          onChange={(mode) => setOppSel((s) => ({ ...s, [r.key]: mode }))}
                        />
                      );
                    })}
                  </ul>
                </ReviewBlock>

                <IndicatorSuggestionsBlock
                  suggestions={analysis?.indicators ?? []}
                  plans={indicatorPlans}
                  drafts={indicatorDrafts}
                  existingIndicators={indicators}
                  meetingDate={meeting?.meeting_date ?? ""}
                  disabled={approve.isPending || approved || isApproved}
                  onChange={(i, patch) =>
                    setIndicatorEdits((s) => ({ ...s, [i]: { ...s[i], ...patch } }))
                  }
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
                            {/* B29: o Select abaixo já mostra o rótulo da classificação atual
                                (SelectValue reflete `value={item.classification}`) — um Pill com o
                                mesmo texto ao lado duplicava o rótulo ("Novo Novo", "Avançou Avançou"...). */}
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

                {total > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Será aplicado: {overallCounts.newCount} novo(s) · {overallCounts.updateCount}{" "}
                    atualização(ões) · {overallCounts.ignoredCount} ignorado(s) · {overallCounts.reviewCount}{" "}
                    para revisar
                    {overallCounts.reviewCount > 0 ? (
                      <span className="ml-1 font-medium text-destructive">
                        — revise os itens marcados antes de aprovar.
                      </span>
                    ) : null}
                  </p>
                )}

                {(analysis?.indicators ?? []).length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {formatIndicatorSummary(summarizeIndicatorItems(approvedIndicatorItems))}
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
                disabled={analyze.isPending || !meeting || isApproved}
                onClick={() => analyze.mutate()}
                title={isApproved ? "Reunião já aprovada — não é possível reanalisar." : undefined}
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
                disabled={approve.isPending || approved || isApproved || indicatorBlockingCount > 0}
                className="gap-2"
                onClick={overallCounts.reviewCount > 0 ? goToFirstItemNeedingReview : submitApproval}
                title={
                  isApproved
                    ? "Reunião já aprovada — somente leitura."
                    : overallCounts.reviewCount > 0
                      ? "Clique para ir até o primeiro item que precisa de revisão."
                      : indicatorBlockingCount > 0
                        ? "Resolva os indicadores sugeridos pendentes antes de aprovar."
                        : undefined
                }
              >
                {approve.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {approve.isPending
                  ? "Salvando…"
                  : overallCounts.reviewCount > 0
                    ? `Revise ${overallCounts.reviewCount} ${overallCounts.reviewCount === 1 ? "item" : "itens"} antes de aprovar`
                    : indicatorBlockingCount > 0
                      ? `Resolva ${indicatorBlockingCount} ${indicatorBlockingCount === 1 ? "indicador" : "indicadores"} antes de aprovar`
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
  hasOverride,
  foreignClientSnippet,
  conditionalActionFlag,
  onChange,
}: {
  resolution: ItemResolution;
  mode: ResolutionMode;
  /** false = ainda não há escolha explícita do consultor para este item. */
  hasOverride: boolean;
  /** Ver client-isolation-guard.ts — presente (mesmo vazio) quando o item está marcado. */
  foreignClientSnippet?: string | undefined;
  /** Ver decision-action-flags.ts (E1) — ação condicional do cliente. */
  conditionalActionFlag?: boolean | undefined;
  onChange: (mode: ResolutionMode) => void;
}) {
  const isPosterior = resolution.chronology === "posterior";
  const canUpdate = !!resolution.targetId && !isPosterior;
  // Nenhum botão pode parecer selecionado enquanto o item precisar de revisão
  // (mesmo critério de needsReview — duplicidade, histórico, mudança de
  // estado, dado de outro cliente ou ação condicional) e o consultor ainda
  // não tiver decidido, senão a opção "escolhida" aparece por acidente.
  const unresolved = needsReview({
    verdict: resolution.verdict,
    confidence: resolution.confidence,
    hasOverride,
    foreignClientFlag: foreignClientSnippet !== undefined,
    ...(resolution.historyFlag !== undefined ? { historyFlag: resolution.historyFlag } : {}),
    ...(resolution.statusSignal !== undefined ? { statusSignal: resolution.statusSignal } : {}),
    ...(conditionalActionFlag !== undefined ? { conditionalActionFlag } : {}),
  });
  const options: { value: ResolutionMode; label: string; disabled?: boolean }[] = [
    { value: "create", label: "Criar novo" },
    { value: "update", label: "Atualizar existente", disabled: !canUpdate },
    { value: "skip", label: "Ignorar" },
  ];
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {isPosterior && (
        <p className="text-xs text-attention">
          Item de reunião posterior
          {resolution.candidateMeetingDate ? ` (${formatDate(resolution.candidateMeetingDate)})` : ""} —
          "Atualizar existente" desabilitado.
        </p>
      )}
      {resolution.historyFlag && (
        <p className="text-xs text-muted-foreground">
          {resolution.historyFlag === "recurrence" ? "Já concluído anteriormente" : "Cancelado/descartado anteriormente"}
          {resolution.candidateMeetingDate ? ` (${formatDate(resolution.candidateMeetingDate)})` : ""} — confirme antes de{" "}
          {resolution.historyFlag === "recurrence" ? "reabrir" : "recriar"}.
        </p>
      )}
      {foreignClientSnippet !== undefined && (
        <p className="text-xs text-muted-foreground">
          Possível dado de outro cliente: confira a evidência antes de aprovar.
          {foreignClientSnippet ? ` Trecho: "${foreignClientSnippet}"` : ""}
        </p>
      )}
      {conditionalActionFlag && (
        <p className="text-xs text-muted-foreground">ação condicional: revise.</p>
      )}
      {unresolved && (
        <p className="text-xs font-medium text-destructive">Escolha uma opção antes de aprovar.</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((o) => (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant={!unresolved && mode === o.value ? "default" : "outline"}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
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

/** B27B — um lado do painel de comparação (existente ou novo). */
type ComparisonSide = {
  text: string;
  /** null quando a entidade não tem esse campo (risco, oportunidade) — aí a linha nem aparece. */
  responsible: string | null;
  /** null quando a entidade não tem esse campo, ou quando o item novo não traz valor pra esse lado. */
  status: string | null;
  /** Campos específicos da entidade — ex.: Descrição/Motivo (decisão), Prioridade/Prazo (ação). */
  extra: { label: string; value: string }[];
};

type ComparisonPanelData = {
  existingMeetingDate: string | null;
  existing: ComparisonSide;
  /**
   * B27B (correção): o lado direito muda de sentido conforme `rightLabel`.
   * "Resultado após atualizar" (mode "update") — o que o patch real vai
   * gravar (título/descrição existentes mantidos quando a regra manda,
   * campos novos só quando presentes). "Novo (desta reunião)" (mode
   * "create"/"skip", inclusive pendente) — o item EXATAMENTE como a IA
   * extraiu (r.item.*), sem fallback pro existente: nada será gravado
   * nesse modo, então não faz sentido prever um resultado de atualização.
   */
  updated: ComparisonSide;
  rightLabel: "Resultado após atualizar" | "Novo (desta reunião)";
  /** Só quando rightLabel é "Resultado após atualizar" E a entidade é ação: texto que será ACRESCENTADO ao histórico de evidência — nunca substitui a descrição. */
  evidenceAddition?: string | null;
};

function ComparisonSideFields({ side }: { side: ComparisonSide }) {
  return (
    <dl className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      <div>
        <span className="font-medium">Texto:</span> {side.text || "—"}
      </div>
      {side.responsible !== null && (
        <div>
          <span className="font-medium">Responsável:</span> {side.responsible || "—"}
        </div>
      )}
      {side.status !== null && (
        <div>
          <span className="font-medium">Status:</span> {side.status || "—"}
        </div>
      )}
      {side.extra.map((f) => (
        <div key={f.label}>
          <span className="font-medium">{f.label}:</span> {f.value || "—"}
        </div>
      ))}
    </dl>
  );
}

/**
 * B27B — painel "existente ↔ novo", mostrado SEMPRE que o item tiver um
 * registro existente casado (match.existing), mesmo sem diferença nenhuma —
 * nunca só quando há `changes`. Reaproveita as mesmas classes já usadas em
 * `details`/`changes` do ReviewRow; nenhuma classe nova.
 */
function ComparisonPanel({
  existingMeetingDate,
  existing,
  updated,
  rightLabel,
  changes,
  evidenceAddition,
}: ComparisonPanelData & { changes: FieldChange[] }) {
  const isUpdateResult = rightLabel === "Resultado após atualizar";
  return (
    <div className="mt-2 rounded-md border bg-background p-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground">
            Existente
            {existingMeetingDate ? ` (reunião de ${formatDate(existingMeetingDate)})` : ""}
          </p>
          <ComparisonSideFields side={existing} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground">{rightLabel}</p>
          <ComparisonSideFields side={updated} />
        </div>
      </div>
      {isUpdateResult ? (
        (changes.length > 0 || evidenceAddition) && (
          <div className="mt-2 border-t pt-2">
            <p className="text-xs font-semibold text-muted-foreground">O que será alterado</p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {changes.map((c) => (
                <li key={c.field}>
                  <span className="font-medium">{c.label}:</span> {c.from || "—"} → {c.to || "—"}
                </li>
              ))}
              {evidenceAddition ? (
                <li>
                  <span className="font-medium">Evidência:</span> será adicionado ao histórico de
                  evidência: "{evidenceAddition}"
                </li>
              ) : null}
            </ul>
          </div>
        )
      ) : (
        <div className="mt-2 border-t pt-2">
          <p className="text-xs font-semibold text-muted-foreground">O que será alterado</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Nada será alterado no item existente.
          </p>
        </div>
      )}
    </div>
  );
}

function ReviewRow({
  rowId,
  primary,
  secondary,
  details,
  classification,
  row,
  foreignClientSnippet,
  conditionalActionFlag,
  onChange,
  completed,
  onCompletedChange,
  isEvaluation,
  onIsEvaluationChange,
  dueDate,
  dueDateSuggested,
  onDueDateChange,
  comparison,
  ownerOptions,
  ownerValue,
  ownerOverridden,
  onOwnerChange,
}: {
  /** Ver goToFirstItemNeedingReview — id do DOM pra rolar até esta linha. */
  rowId?: string;
  primary: string;
  secondary: string;
  /**
   * Todo campo não vazio do item que não tem um lugar dedicado em `primary`/
   * `secondary` — ex.: descrição e motivo de uma decisão, evidência de um
   * risco/oportunidade. Sem isso, esse conteúdo existe no dado (sobreviveu ao
   * schema) mas nunca aparece na revisão (achado real: caso Grupo Erinho,
   * 17/06 — issue #56).
   */
  details?: { label: string; value: string }[];
  classification: string;
  row: { match: DedupeMatch<unknown>; mode: ResolutionMode; resolution: ItemResolution; hasOverride: boolean };
  /** Ver client-isolation-guard.ts — repassado direto a ResolutionControls, nunca via `resolution`. */
  foreignClientSnippet?: string | undefined;
  /** Ver decision-action-flags.ts (E1) — repassado direto a ResolutionControls. */
  conditionalActionFlag?: boolean | undefined;
  onChange: (mode: ResolutionMode) => void;
  /**
   * Regra B — caixa "Concluída", só pra ação/decisão (risco e oportunidade
   * não passam esses props, então a caixa nunca aparece neles).
   */
  completed?: boolean;
  onCompletedChange?: (v: boolean) => void;
  /**
   * B1 — caixa "Avaliação", só pra decisão (ação/risco/oportunidade não
   * passam esses props, então a caixa nunca aparece neles).
   */
  isEvaluation?: boolean;
  onIsEvaluationChange?: (v: boolean) => void;
  /**
   * B18 — prazo editável, só pra ação/decisão em modo "Criar novo" (ver
   * resolveRelativeDeadline/defaultItemDueDate). undefined = sem campo
   * (risco/oportunidade, ou modo diferente de "Criar novo").
   */
  dueDate?: string;
  /** true quando `dueDate` é uma sugestão calculada do hint, não uma data explícita nem edição do consultor. */
  dueDateSuggested?: boolean;
  onDueDateChange?: (v: string) => void;
  /**
   * B27B — painel "existente ↔ novo". `undefined`/`null` quando o item não
   * tem `match.existing` (verdict NEW) — nesse caso o painel não aparece.
   */
  comparison?: ComparisonPanelData | null;
  /**
   * Gate F — seletor de responsável, só ação/decisão em modo "Criar novo"
   * ou "Atualizar existente", só quando o cliente tem cadastro de pessoas
   * (`ownerOptions` vem de orderPeopleForItem). `undefined` = sem cadastro
   * — a linha fica exatamente como antes, sem seletor.
   */
  ownerOptions?: string[] | undefined;
  ownerValue?: string | undefined;
  /** true quando eu troquei o valor no seletor — mostra o selo "escolhido por você". */
  ownerOverridden?: boolean;
  onOwnerChange?: ((v: string) => void) | undefined;
}) {
  return (
    <li id={rowId} className="rounded-lg bg-muted/40 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm">{primary}</p>
          {secondary && <p className="text-xs text-muted-foreground">{secondary}</p>}
          {details && details.length > 0 && (
            <dl className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {details.map((d) => (
                <div key={d.label}>
                  <span className="font-medium">{d.label}:</span> {d.value}
                </div>
              ))}
            </dl>
          )}
          {row.resolution.verdict !== "NEW" && (
            <p className="mt-1 text-xs text-muted-foreground">{row.resolution.reason}</p>
          )}
          {comparison ? (
            <ComparisonPanel
              existingMeetingDate={comparison.existingMeetingDate}
              existing={comparison.existing}
              updated={comparison.updated}
              rightLabel={comparison.rightLabel}
              changes={row.resolution.changes}
              evidenceAddition={comparison.evidenceAddition ?? null}
            />
          ) : (
            row.resolution.changes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {row.resolution.changes.map((c) => (
                  <li key={c.field}>
                    <span className="font-medium">{c.label}:</span> {c.from || "—"} → {c.to || "—"}
                  </li>
                ))}
              </ul>
            )
          )}
          <ResolutionControls
            resolution={row.resolution}
            mode={row.mode}
            hasOverride={row.hasOverride}
            foreignClientSnippet={foreignClientSnippet}
            conditionalActionFlag={conditionalActionFlag}
            onChange={onChange}
          />
          {row.mode === "create" && (onCompletedChange || onIsEvaluationChange || onDueDateChange) ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {onCompletedChange ? (
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={completed === true}
                    onCheckedChange={(v) => onCompletedChange(v === true)}
                  />
                  <span className="text-xs text-muted-foreground">Concluída</span>
                </label>
              ) : null}
              {onIsEvaluationChange ? (
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={isEvaluation === true}
                    onCheckedChange={(v) => onIsEvaluationChange(v === true)}
                  />
                  <span className="text-xs text-muted-foreground">Avaliação</span>
                </label>
              ) : null}
              {onDueDateChange ? (
                <label className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Prazo</span>
                  <Input
                    type="date"
                    className="h-8 w-auto"
                    value={dueDate ?? ""}
                    onChange={(e) => onDueDateChange(e.target.value)}
                  />
                  {dueDateSuggested ? (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      sugerido
                    </Badge>
                  ) : null}
                </label>
              ) : null}
            </div>
          ) : null}
          {(row.mode === "create" || row.mode === "update") && onOwnerChange ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Responsável</span>
              <Select
                value={ownerValue || NO_OWNER_VALUE}
                onValueChange={(v) => onOwnerChange(v === NO_OWNER_VALUE ? "" : v)}
              >
                <SelectTrigger className="h-8 w-auto min-w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OWNER_VALUE}>(sem responsável)</SelectItem>
                  {(ownerOptions ?? []).map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {ownerOverridden ? (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  escolhido por você
                </Badge>
              ) : null}
              {!ownerValue ? (
                <span className="text-xs text-muted-foreground">sem responsável</span>
              ) : null}
            </div>
          ) : null}
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <ClassificationBadge value={classification} />
          <VerdictBadge resolution={row.resolution} />
        </span>
      </div>
    </li>
  );
}

/** GATE 10A — card "Revisão da análise", no topo da etapa de revisão. */
function ReviewSummaryCard({
  counts,
  onApplySafe,
  onCopyDuplicateReport,
  blocksTotal,
  blocksReviewed,
  categoriesWithContent,
  categoriesTotal,
  executionQuality,
  semanticConsolidation,
}: {
  counts: ReviewBlockCounts;
  onApplySafe: () => void;
  /** Copia o relatório de duplicidade (markdown puro) pra área de transferência. */
  onCopyDuplicateReport: () => void;
  /** Progresso da REVISÃO por blocos (GATE 10D) — não é classificação do dedupe. */
  blocksTotal: number;
  blocksReviewed: number;
  /** Quantas das `categoriesTotal` categorias possíveis têm conteúdo nesta reunião. */
  categoriesWithContent: number;
  categoriesTotal: number;
  /** GATE 12 — métricas de action-first/consolidação, calculadas no servidor. */
  executionQuality?: ExecutionQuality;
  /** GATE 12B — métricas de consolidação SEMÂNTICA (embeddings), calculadas no servidor. */
  semanticConsolidation?: SemanticConsolidation;
}) {
  const [showConsolidationGroups, setShowConsolidationGroups] = useState(false);
  const categoriesLine = (
    <p className="text-xs text-muted-foreground">
      {categoriesWithContent} de {categoriesTotal} categorias têm conteúdo nesta reunião (decisões, ações,
      riscos, oportunidades e as listas de contexto) — o que estiver vazio aqui é porque a IA não extraiu
      nada para essa categoria, não porque ficou escondido.
    </p>
  );
  const isEmpty = counts.total === 0;
  const stats: { label: string; value: number }[] = [
    { label: "Total de sugestões", value: counts.total },
    { label: "Novas", value: counts.newCount },
    { label: "Atualizações sugeridas", value: counts.updateCount },
    { label: "Requer revisão (possível duplicidade)", value: counts.reviewCount },
    { label: "Ignoradas", value: counts.ignoredCount },
  ];
  return (
    <section className="rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Revisão da análise</h3>
        {!isEmpty && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="gap-2" onClick={onCopyDuplicateReport}>
              <Copy className="size-4" aria-hidden /> Copiar relatório de duplicidade
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-2" onClick={onApplySafe}>
              <ShieldCheck className="size-4" aria-hidden /> Aplicar sugestões seguras
            </Button>
          </div>
        )}
      </div>
      {isEmpty ? (
        <p className="mt-2 text-sm text-muted-foreground">Nenhuma sugestão nova nesta reunião.</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="text-xs text-muted-foreground">{s.label}</dt>
                <dd className="font-semibold">{s.value}</dd>
              </div>
            ))}
          </dl>
          {blocksTotal > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Progresso da revisão por blocos: {blocksReviewed} de {blocksTotal} revisados
            </p>
          ) : null}
        </>
      )}
      <div className="mt-1">{categoriesLine}</div>
      {executionQuality ? (
        <div className="mt-3 border-t pt-3">
          <p className="text-xs font-semibold">Execução</p>
          <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <div>
              <dt
                className="text-muted-foreground"
                title="Ações criadas automaticamente a partir de próximos passos sem ação correspondente — não é o total de ações da reunião."
              >
                Ações criadas de próximos passos
              </dt>
              <dd className="font-semibold">{executionQuality.proposedActions}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Próximos passos convertidos</dt>
              <dd className="font-semibold">{executionQuality.convertedFromNextSteps}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Pendentes de ação</dt>
              <dd className="font-semibold">{executionQuality.pendingWithoutAction}</dd>
            </div>
          </dl>
          {executionQuality.pendingWithoutAction > 0 ? (
            <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              <p className="font-medium">
                {executionQuality.pendingWithoutAction} próximo(s) passo(s) parecem executáveis mas não
                geraram ação automaticamente — revise manualmente:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {executionQuality.pendingNextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {semanticConsolidation && semanticConsolidation.mergedCount > 0 ? (
        <div className="mt-3 border-t pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold">
              Consolidação — {semanticConsolidation.mergedCount} item(ns) repetido(s) consolidado(s)
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => setShowConsolidationGroups((v) => !v)}
            >
              {showConsolidationGroups ? "Ocultar" : "Ver o que foi consolidado"}
            </Button>
          </div>
          {showConsolidationGroups ? (
            <ul className="mt-2 flex flex-col gap-2 text-xs">
              {semanticConsolidation.groups.map((g, i) => (
                <li key={`${g.category}-${i}`} className="rounded-md bg-muted/40 p-2">
                  <p className="font-medium">
                    {g.canonicalText} <span className="text-muted-foreground">({g.category})</span>
                  </p>
                  <p className="mt-0.5 text-muted-foreground">Consolidado com: {g.mergedTexts.join("; ")}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * GATE 10A — bloco recolhível de um grupo de revisão (contexto/decisões/
 * ações/riscos/oportunidades). O cabeçalho mostra contagens e ações em lote;
 * o conteúdo detalhado (ReviewRow por item) só renderiza quando aberto.
 */
function ReviewBlock({
  id,
  title,
  items,
  status,
  open,
  onOpenChange,
  onApplySafe,
  onIgnoreAll,
  children,
}: {
  id: string;
  title: string;
  items: ReviewBlockItem[];
  /** Estado da REVISÃO (GATE 10D) — nunca afeta a classificação/contagem exibida. */
  status: BlockStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplySafe: () => void;
  onIgnoreAll: () => void;
  children: ReactNode;
}) {
  if (items.length === 0) return null;
  const counts = countReviewBlock(items);
  const needsAttention = counts.reviewCount > 0;
  const triggerLabel = open ? "Recolher" : "Revisar itens";

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className={`rounded-lg border ${needsAttention ? "border-destructive/40" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {needsAttention && (
              <Badge variant="destructive" className="shrink-0">
                Requer revisão
              </Badge>
            )}
            {status === "approved" && (
              <Pill tone="healthy" className="shrink-0">
                ✓ Bloco aprovado
              </Pill>
            )}
            {status === "ignored" && (
              <Pill tone="neutral" className="shrink-0">
                ✓ Bloco ignorado
              </Pill>
            )}
            {status === "manual" && (
              <Pill tone="attention" className="shrink-0">
                Revisado manualmente
              </Pill>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{formatBlockSummary(counts)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onApplySafe}
            disabled={status === "approved"}
          >
            {status === "approved" ? "Bloco aprovado" : "Aprovar bloco"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onIgnoreAll}
            disabled={status === "ignored"}
          >
            {status === "ignored" ? "Bloco ignorado" : "Ignorar bloco"}
          </Button>
          <CollapsibleTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="gap-1" aria-label={triggerLabel}>
              {triggerLabel}
              {open ? (
                <ChevronUp className="size-4" aria-hidden />
              ) : (
                <ChevronDown className="size-4" aria-hidden />
              )}
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>
      <CollapsibleContent className="border-t p-3 pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}
