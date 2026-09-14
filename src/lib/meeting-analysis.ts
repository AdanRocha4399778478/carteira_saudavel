import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { logDbError, recalculateClient } from "./api";
import { analyzeMeetingWithAI } from "./intelligent-meeting.functions";
import {
  buildIdempotencyKey,
  matchContextItem,
  type ItemResolution,
} from "./deduplication";
import { recordMentions, type MentionInput } from "./entity-mentions";
import { saveEvolution, type EvolutionItem } from "./evolution";
import type { ActionItem, Meeting, OpportunityItem, RiskItem, RiskRule } from "./domain";
import {
  CONTEXT_LISTS,
  newContextItem,
  type ContextItem,
  type ContextListKey,
  type Decision,
  type Project,
  type ProjectContext,
} from "./projects";

/* ------------------------------------------------------------------ *
 * REUNIÃO INTELIGENTE
 * transcrição → análise → JSON validado → comparação com o contexto →
 * preview → aprovação → atualização do projeto → próxima pauta.
 *
 * Este módulo concentra CONTRATO + VALIDAÇÃO + SERVIÇO. Nenhum
 * componente conhece o provedor da análise (hoje JSON manual, amanhã
 * um agente de IA) — todos falam apenas com `meetingAnalysisService`.
 * ------------------------------------------------------------------ */

/* ---------------- status da análise ---------------- */

export const ANALYSIS_STATUSES = [
  "nao_analisada",
  "em_analise",
  "aguardando_revisao",
  "aprovada",
  "erro",
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const ANALYSIS_STATUS_LABEL: Record<string, string> = {
  nao_analisada: "Não analisada",
  em_analise: "Em análise",
  aguardando_revisao: "Aguardando revisão",
  aprovada: "Aprovada",
  erro: "Erro",
};

/* ---------------- contrato JSON ---------------- */

const txt = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined ? "" : String(v).trim()));

const classification = z
  .union([z.enum(["fact", "inference", "suggestion"]), z.null()])
  .optional()
  .transform((v) => v ?? "inference");


/**
 * Normalização tolerante das listas de contexto (next_steps, objectives, …).
 * A flexibilidade vive aqui; o schema final continua rígido.
 * Aceita: null/undefined, string única, objeto único, arrays aninhados e
 * arrays de objetos textuais. Qualquer item sem texto é descartado.
 */
export function normalizeContextList(value: unknown): { content: string; classification: string }[] {
  const flatten = (v: unknown, depth = 0): unknown[] =>
    Array.isArray(v) && depth < 4 ? v.flatMap((i) => flatten(i, depth + 1)) : [v];

  const out: { content: string; classification: string }[] = [];
  const seen = new Set<string>();

  for (const raw of flatten(value)) {
    if (raw === null || raw === undefined) continue;
    let content = "";
    let cls: unknown = undefined;
    if (typeof raw === "string" || typeof raw === "number") {
      content = String(raw);
    } else if (typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      cls = o["classification"];
      for (const k of ["content", "text", "description", "title", "action", "step", "titulo", "acao", "descricao"]) {
        const candidate = o[k];
        if (typeof candidate === "string" || typeof candidate === "number") {
          const s = String(candidate).trim();
          if (s) {
            content = s;
            break;
          }
        }
      }
    }
    content = content.trim();
    if (!content) continue;
    const key = content.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const classificationValue =
      cls === "fact" || cls === "inference" || cls === "suggestion" ? cls : "inference";
    out.push({ content, classification: classificationValue });
  }
  return out;
}

const contentList = z
  .unknown()
  .optional()
  .transform((v) => normalizeContextList(v))
  .pipe(z.array(z.object({ content: z.string().min(1), classification })));


const stringList = z
  .union([z.array(z.union([z.string(), z.number()])), z.null()])
  .optional()
  .transform((v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []));

const analysisSchema = z.object({
  meeting: z
    .object({
      executive_summary: txt,
      main_topic: txt,
      measurable_result: txt,
    })
    .nullish()
    .transform((v) => v ?? { executive_summary: "", main_topic: "", measurable_result: "" }),

  context_updates: z
    .object(
      CONTEXT_LISTS.reduce(
        (acc, key) => ({ ...acc, [key]: contentList }),
        {} as Record<ContextListKey, typeof contentList>,
      ),
    )
    .partial()
    .nullish()
    .transform((v) => v ?? {}),

  decisions: z
    .union([
      z.array(
        z.preprocess(
          (v) => (typeof v === "string" ? { title: v } : v),
          z.object({
            title: txt,
            description: txt,
            reason: txt,
            owner: txt,
            due_date: txt,
            status: txt,
            classification,
            embedding: z.array(z.number()).nullish(),
          }),
        ),
      ),
      z.null(),
    ])
    .optional()
    .transform((v) => (Array.isArray(v) ? v.filter((d) => d.title.length > 0) : [])),

  actions: z
    .union([
      z.array(
        z.preprocess(
          (v) => {
            if (typeof v === "string") return { description: v };
            if (v && typeof v === "object") {
              const o = v as Record<string, unknown>;
              return {
                ...o,
                description: o["description"] ?? o["acao"] ?? o["action"] ?? o["descricao"],
                owner_name: o["owner_name"] ?? o["owner"] ?? o["responsavel"],
                deadline: o["deadline"] ?? o["prazo"],
                priority: o["priority"] ?? o["prioridade"],
              };
            }
            return v;
          },
          z.object({
            description: txt,
            owner_name: txt,
            deadline: txt,
            priority: txt,
            erp_area: txt,
            classification,
            embedding: z.array(z.number()).nullish(),
          }),
        ),
      ),
      z.null(),
    ])
    .optional()
    .transform((v) => (Array.isArray(v) ? v.filter((a) => a.description.length > 0) : [])),

  risks: z
    .union([
      z.array(
        z.preprocess(
          (v) => {
            if (typeof v === "string") return { description: v };
            if (v && typeof v === "object") {
              const o = v as Record<string, unknown>;
              return {
                ...o,
                description: o["description"] ?? o["descricao"] ?? o["risco"] ?? o["title"],
                level: o["level"] ?? o["criticidade"] ?? o["nivel"],
              };
            }
            return v;
          },
          z.object({
            title: txt,
            description: txt,
            level: txt,
            impact: txt,
            probability: txt,
            evidence: txt,
            recommendation: txt,
            classification,
            embedding: z.array(z.number()).nullish(),
          }),
        ),
      ),
      z.null(),
    ])
    .optional()
    .transform((v) => (Array.isArray(v) ? v.filter((r) => r.description.length > 0) : [])),

  opportunities: z
    .union([
      z.array(
        z.preprocess(
          (v) => {
            if (typeof v === "string") return { description: v };
            if (v && typeof v === "object") {
              const o = v as Record<string, unknown>;
              return {
                ...o,
                description: o["description"] ?? o["descricao"] ?? o["oportunidade"],
                expected_benefit: o["expected_benefit"] ?? o["beneficio"],
              };
            }
            return v;
          },
          z.object({
            description: txt,
            expected_benefit: txt,
            evidence: txt,
            classification,
            embedding: z.array(z.number()).nullish(),
          }),
        ),
      ),
      z.null(),
    ])
    .optional()
    .transform((v) => (Array.isArray(v) ? v.filter((o) => o.description.length > 0) : [])),

  agenda_recommendation: z
    .object({
      objective: txt,
      topics: stringList,
      pending_decisions: stringList,
      overdue_actions: stringList,
      critical_risks: stringList,
      recommended_questions: stringList,
    })
    .nullish()
    .transform(
      (v) =>
        v ?? {
          objective: "",
          topics: [],
          pending_decisions: [],
          overdue_actions: [],
          critical_risks: [],
          recommended_questions: [],
        },
    ),
});

export type MeetingAnalysis = z.infer<typeof analysisSchema>;
export type AnalysisAgenda = MeetingAnalysis["agenda_recommendation"];
export type ItemClassification = "fact" | "inference" | "suggestion";

export const CLASSIFICATION_LABEL: Record<string, string> = {
  fact: "Fato",
  inference: "Inferência",
  suggestion: "Sugestão",
};

export type AnalysisParseResult =
  | { ok: true; analysis: MeetingAnalysis }
  | { ok: false; errors: string[] };

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const path = i.path.join(".");
    if (path.startsWith("context_updates")) {
      // Detalhe técnico fica só no log; o usuário recebe mensagem legível.
      console.warn("[analise] contexto inválido", { path, message: i.message });
      return "Não foi possível interpretar uma parte da atualização de contexto. A transcrição foi preservada.";
    }
    return path ? `${path}: ${i.message}` : i.message;
  });
}


export function parseAnalysis(value: unknown): AnalysisParseResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["A análise precisa ser um objeto JSON no formato do contrato."] };
  }
  const parsed = analysisSchema.safeParse(value);
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error) };
  return { ok: true, analysis: parsed.data };
}

export function parseAnalysisJson(raw: string): AnalysisParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      errors: [`JSON malformado: ${e instanceof Error ? e.message : "estrutura inválida"}`],
    };
  }
  return parseAnalysis(json);
}

export const ANALYSIS_TEMPLATE = JSON.stringify(
  {
    meeting: {
      executive_summary: "Resumo do que aconteceu na reunião.",
      main_topic: "Ritual comercial",
      measurable_result: "",
    },
    context_updates: {
      objectives: [
        { content: "Reduzir dependência do fundador nas vendas", classification: "fact" },
      ],
      problems: [{ content: "Gestores não realizam follow-up semanal", classification: "fact" }],
      root_causes: [],
      priorities: [{ content: "Implantar ritual comercial semanal", classification: "suggestion" }],
      constraints: [],
      results: [],
      next_steps: [{ content: "Definir indicadores do funil", classification: "suggestion" }],
      hypotheses: [],
    },
    decisions: [
      {
        title: "Contratar um novo SDR",
        description: "Ampliar a geração de reuniões qualificadas.",
        reason: "Pipeline insuficiente para a meta do trimestre.",
        owner: "Sócio comercial",
        due_date: "",
        classification: "fact",
      },
    ],
    actions: [
      {
        description: "Definir perfil da vaga de SDR",
        owner_name: "Sócio comercial",
        deadline: "",
        priority: "alta",
        classification: "fact",
      },
    ],
    risks: [
      {
        title: "Meta comercial em risco",
        description: "Funil sem cobertura para a meta do trimestre",
        level: "alto",
        impact: "Receita abaixo do planejado",
        probability: "média",
        evidence: "Fala do sócio sobre o pipeline atual",
        recommendation: "Revisar metas semanais com os gestores",
        classification: "inference",
      },
    ],
    opportunities: [],
    agenda_recommendation: {
      objective: "Validar a implantação do ritual comercial semanal",
      topics: ["Revisão dos compromissos anteriores"],
      pending_decisions: [],
      overdue_actions: [],
      critical_risks: [],
      recommended_questions: ["Qual avanço ocorreu nesta prioridade desde a última reunião?"],
    },
  },
  null,
  2,
);

/* ------------------------------------------------------------------ *
 * Camada de serviço — desacoplada do provedor
 * ------------------------------------------------------------------ */

export type AnalysisInput = {
  project: Project | null;
  project_context: ProjectContext | null;
  meeting: Meeting;
  transcription: string;
  open_actions: ActionItem[];
  overdue_actions?: ActionItem[];
  pending_decisions: Decision[];
  active_risks: RiskItem[];
  clients?: { id: string; name: string }[];
  projects?: { id: string; client_id: string; name: string; status: string }[];
  source?: { type: "pdf" | "manual"; file_name: string | null };
  /** JSON colado manualmente — ferramenta avançada/debug. */
  manual_json?: string;
};

export type AnalysisProvider = {
  id: string;
  label: string;
  available: boolean;
  analyze: (input: AnalysisInput) => Promise<AnalysisParseResult>;
};

/** Resumo textual do contexto atual enviado à IA (somente o necessário). */
function contextSummary(context: ProjectContext | null): string {
  if (!context) return "";
  const parts = CONTEXT_LISTS.map((key) => {
    const items = (context[key] ?? []) as ContextItem[];
    if (!items.length) return "";
    return `${key}: ${items.map((i) => i.text).join(" | ")}`;
  }).filter(Boolean);
  return parts.join("\n");
}

/** Provedor padrão: agente de IA no servidor (nenhuma chave no navegador). */
const aiProvider: AnalysisProvider = {
  id: "ia",
  label: "Agente de IA",
  available: true,
  analyze: async (input) => {
    const transcript = input.transcription.trim();
    if (transcript.length < 30) {
      return { ok: false, errors: ["Adicione a transcrição da reunião antes de analisar."] };
    }
    const result = await analyzeMeetingWithAI({
      data: {
        transcript,
        clients: input.clients ?? [],
        projects: input.projects ?? [],
        projectContext: contextSummary(input.project_context),
        openActions: input.open_actions.map((a) => a.description),
        overdueActions: (input.overdue_actions ?? []).map((a) => a.description),
        pendingDecisions: input.pending_decisions.map((d) => d.title),
        activeRisks: input.active_risks.map((r) => r.description),
        ...(input.source ? { source: input.source } : {}),
      },
    });
    let payload: unknown;
    try {
      payload = JSON.parse(result.json);
    } catch {
      return { ok: false, errors: ["A IA devolveu um resultado inválido. Tente novamente."] };
    }
    return parseAnalysis((payload as Record<string, unknown>)["analysis"] ?? payload);
  },
};

/** Ferramenta avançada: o consultor cola o JSON gerado externamente. */
const manualProvider: AnalysisProvider = {
  id: "manual",
  label: "JSON manual/importado",
  available: true,
  analyze: async (input) => {
    const raw = (input.manual_json ?? "").trim();
    if (!raw) {
      return {
        ok: false,
        errors: ["Cole o JSON da análise na aba “JSON da análise” ou use a análise por IA."],
      };
    }
    return parseAnalysisJson(raw);
  },
};

const providers: AnalysisProvider[] = [aiProvider, manualProvider];

export const meetingAnalysisService = {
  providers: () => providers.filter((p) => p.available),
  /** Ponto único de entrada — trocar de provedor não altera a experiência. */
  analyze: async (input: AnalysisInput, providerId = "ia"): Promise<AnalysisParseResult> => {
    const provider = providers.find((p) => p.id === providerId && p.available) ?? aiProvider;
    try {
      return await provider.analyze(input);
    } catch (e) {
      console.error("[analise] falha do provedor", e);
      return {
        ok: false,
        errors: [
          e instanceof Error && e.message
            ? e.message
            : "Não foi possível gerar a análise. Tente novamente.",
        ],
      };
    }
  },
  /** Payload que o agente recebe — mesmo shape do serviço. */
  buildRequest: (input: AnalysisInput) => ({
    project: input.project,
    project_context: input.project_context,
    meeting: input.meeting,
    transcription: input.transcription,
    open_actions: input.open_actions,
    pending_decisions: input.pending_decisions,
    active_risks: input.active_risks,
  }),
};

/* ------------------------------------------------------------------ *
 * Comparação com o contexto atual
 * ------------------------------------------------------------------ */

export type ChangeOperation = "adicionar" | "atualizar" | "manter" | "resolver" | "remover";

export const OPERATION_LABEL: Record<ChangeOperation, string> = {
  adicionar: "Adicionar",
  atualizar: "Atualizar",
  manter: "Manter",
  resolver: "Resolver",
  remover: "Remover",
};

export type ContextDiffItem = {
  key: string;
  list: ContextListKey;
  text: string;
  operation: ChangeOperation;
  classification: ItemClassification;
  duplicate: boolean;
};

export type ContextDiffGroup = {
  list: ContextListKey;
  current: ContextItem[];
  proposed: ContextDiffItem[];
};

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildContextDiff(
  context: ProjectContext | null,
  analysis: MeetingAnalysis,
): ContextDiffGroup[] {
  return CONTEXT_LISTS.map((list) => {
    const current = context?.[list] ?? [];
    const existing = new Set(current.map((i) => normalizeText(i.text)));
    const proposed = (analysis.context_updates[list] ?? []).map((item, index) => {
      const duplicate = existing.has(normalizeText(item.content));
      return {
        key: `${list}-${index}`,
        list,
        text: item.content,
        operation: (duplicate ? "manter" : "adicionar") as ChangeOperation,
        classification: item.classification as ItemClassification,
        duplicate,
      };
    });
    return { list, current, proposed };
  }).filter((g) => g.proposed.length > 0 || g.current.length > 0);
}

export function findSimilar<T>(items: T[], text: string, get: (item: T) => string): T | null {
  const target = normalizeText(text);
  if (!target) return null;
  return (
    items.find((item) => {
      const value = normalizeText(get(item));
      return value === target || value.includes(target) || target.includes(value);
    }) ?? null
  );
}

/* ------------------------------------------------------------------ *
 * Próxima pauta
 * ------------------------------------------------------------------ */

export function buildAgenda(params: {
  suggested: AnalysisAgenda;
  context: ProjectContext | null;
  openActions: ActionItem[];
  overdueActions: ActionItem[];
  pendingDecisions: Decision[];
  criticalRisks: RiskItem[];
}): AnalysisAgenda {
  const uniq = (list: string[]) => Array.from(new Set(list.filter(Boolean)));
  const priorities = (params.context?.priorities ?? []).map((i) => i.text);
  const nextSteps = (params.context?.next_steps ?? []).map((i) => i.text);

  return {
    objective:
      params.suggested.objective ||
      (priorities[0]
        ? `Avançar na prioridade: ${priorities[0]}`
        : "Revisar compromissos e destravar as pendências do projeto"),
    topics: uniq([
      ...params.suggested.topics,
      "Revisão dos compromissos anteriores",
      ...(params.openActions.length ? ["Indicadores e resultados relevantes"] : []),
      ...priorities.slice(0, 3),
      ...nextSteps.slice(0, 3),
    ]),
    pending_decisions: uniq([
      ...params.suggested.pending_decisions,
      ...params.pendingDecisions.map((d) => d.title),
    ]),
    overdue_actions: uniq([
      ...params.suggested.overdue_actions,
      ...params.overdueActions.map((a) => a.description),
    ]),
    critical_risks: uniq([
      ...params.suggested.critical_risks,
      ...params.criticalRisks.map((r) => r.description),
    ]),
    recommended_questions: uniq([
      ...params.suggested.recommended_questions,
      ...priorities.slice(0, 2).map((p) => `Qual avanço ocorreu em “${p}” desde a última reunião?`),
      ...params.overdueActions
        .slice(0, 2)
        .map((a) => `O que está impedindo a conclusão de “${a.description}”?`),
      ...params.pendingDecisions.slice(0, 2).map((d) => `A decisão “${d.title}” ainda é válida?`),
      ...params.criticalRisks
        .slice(0, 1)
        .map((r) => `Qual evidência temos de que “${r.description}” está sob controle?`),
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * Persistência da análise (rascunho antes da aprovação)
 * ------------------------------------------------------------------ */

export type MeetingAnalysisRow = {
  id: string;
  meeting_id: string;
  project_id: string | null;
  client_id: string | null;
  status: string;
  transcript: string | null;
  analysis: MeetingAnalysis | Record<string, unknown>;
  agenda: AnalysisAgenda | Record<string, unknown>;
  error_message: string | null;
  provider: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export const meetingAnalysisQuery = (meetingId: string) =>
  queryOptions({
    queryKey: ["meeting_analyses", meetingId],
    enabled: !!meetingId,
    queryFn: async (): Promise<MeetingAnalysisRow | null> => {
      const res = await supabase
        .from("meeting_analyses")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (res.error) {
        logDbError("meeting_analyses", "select", res.error);
        throw new Error(res.error.message);
      }
      return (res.data as unknown as MeetingAnalysisRow | null) ?? null;
    },
  });

export const projectAnalysesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["meeting_analyses", "project", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<MeetingAnalysisRow[]> => {
      const res = await supabase
        .from("meeting_analyses")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (res.error) {
        logDbError("meeting_analyses", "select-project", res.error);
        throw new Error(res.error.message);
      }
      return (res.data ?? []) as unknown as MeetingAnalysisRow[];
    },
  });

export async function saveAnalysisDraft(params: {
  meetingId: string;
  projectId: string | null;
  clientId: string | null;
  transcript: string;
  analysis: MeetingAnalysis | null;
  agenda: AnalysisAgenda | null;
  status: AnalysisStatus;
  provider?: string;
  errorMessage?: string | null;
}): Promise<MeetingAnalysisRow> {
  const { data: auth } = await supabase.auth.getUser();
  const existing = await supabase
    .from("meeting_analyses")
    .select("id")
    .eq("meeting_id", params.meetingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const payload = {
    meeting_id: params.meetingId,
    project_id: params.projectId,
    client_id: params.clientId,
    transcript: params.transcript || null,
    analysis: (params.analysis ?? {}) as never,
    agenda: (params.agenda ?? {}) as never,
    status: params.status,
    provider: params.provider ?? "manual",
    error_message: params.errorMessage ?? null,
    created_by: auth.user?.id ?? null,
    ...(params.status === "aprovada"
      ? { approved_by: auth.user?.id ?? null, approved_at: new Date().toISOString() }
      : {}),
  };

  const res = existing.data
    ? await supabase
        .from("meeting_analyses")
        .update(payload)
        .eq("id", (existing.data as { id: string }).id)
        .select("*")
        .single()
    : await supabase.from("meeting_analyses").insert(payload).select("*").single();

  if (res.error) {
    logDbError("meeting_analyses", existing.data ? "update" : "insert", res.error);
    throw new Error(res.error.message);
  }
  return res.data as unknown as MeetingAnalysisRow;
}

/* ------------------------------------------------------------------ *
 * Aplicação da análise aprovada
 * ------------------------------------------------------------------ */

export type ApprovedSelection = {
  meetingSummary: string | null;
  measurableResult: string | null;
  contextItems: {
    list: ContextListKey;
    text: string;
    operation: ChangeOperation;
    resolution?: ItemResolution;
  }[];
  decisions: {
    title: string;
    description: string;
    reason: string;
    owner: string;
    due_date: string;
    resolution?: ItemResolution;
    embedding?: number[] | null;
  }[];
  actions: {
    description: string;
    owner_name: string;
    deadline: string;
    priority: string;
    erp_area: string;
    evidence: string;
    resolution?: ItemResolution;
    embedding?: number[] | null;
  }[];
  risks: { description: string; level: string; resolution?: ItemResolution; embedding?: number[] | null }[];
  opportunities: {
    description: string;
    expected_benefit: string;
    resolution?: ItemResolution;
    embedding?: number[] | null;
  }[];
  agenda: AnalysisAgenda;
};

export type ApplyResult = {
  context: number;
  decisions: number;
  actions: number;
  risks: number;
  opportunities: number;
  /** Registros existentes atualizados em vez de duplicados. */
  updated: number;
  /** Itens ignorados por já existirem. */
  skipped: number;
  /** true quando esta mesma análise já havia sido aplicada. */
  alreadyApplied: boolean;
};

const emptyApplyResult = (): ApplyResult => ({
  context: 0,
  decisions: 0,
  actions: 0,
  risks: 0,
  opportunities: 0,
  updated: 0,
  skipped: 0,
  alreadyApplied: false,
});

/** Resolução efetiva: o que o consultor escolheu, ou "criar" por omissão. */
function resolutionOf(item: { resolution?: ItemResolution }): ItemResolution {
  return (
    item.resolution ?? {
      mode: "create",
      targetId: null,
      verdict: "NEW",
      confidence: 0,
      reason: "",
      changes: [],
    }
  );
}

/**
 * Grava apenas o que o consultor aprovou, e nunca duplica:
 *
 * - a aplicação inteira é protegida por uma chave de idempotência
 *   (clicar duas vezes em "Aprovar" grava uma única vez);
 * - cada item respeita a resolução escolhida (criar / atualizar / ignorar);
 * - toda menção — inclusive as ignoradas — vira histórico em
 *   `entity_mentions`, então nada se perde.
 *
 * A reunião original nunca é substituída.
 */
export async function applyApprovedAnalysis(params: {
  meeting: Meeting;
  projectId: string;
  context: ProjectContext | null;
  selection: ApprovedSelection;
  analysisId?: string | null;
  /** Evolução revisada no preview — gravada junto com a aprovação. */
  evolution?: EvolutionItem[];
  previousMeetingId?: string | null;
}): Promise<ApplyResult> {
  const { meeting, projectId, selection } = params;
  const analysisId = params.analysisId ?? null;
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  const result = emptyApplyResult();
  const mentions: MentionInput[] = [];

  /* ---------- idempotência: reserva a aplicação antes de gravar ---------- */
  const idempotencyKey = buildIdempotencyKey({
    analysisId,
    meetingId: meeting.id,
    payload: {
      context: selection.contextItems,
      decisions: selection.decisions,
      actions: selection.actions,
      risks: selection.risks,
      opportunities: selection.opportunities,
      summary: selection.meetingSummary,
      measurable: selection.measurableResult,
    },
  });

  const reservation = await supabase
    .from("analysis_applications")
    .insert({
      analysis_id: analysisId,
      meeting_id: meeting.id,
      project_id: projectId,
      client_id: meeting.client_id,
      idempotency_key: idempotencyKey,
      applied_by: userId,
    })
    .select("id")
    .single();

  if (reservation.error) {
    // 23505 = chave única: esta análise já foi aplicada com este conteúdo.
    if (reservation.error.code === "23505") {
      const previous = await supabase
        .from("analysis_applications")
        .select("result")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      const stored = (previous.data?.result ?? {}) as Partial<ApplyResult>;
      return { ...emptyApplyResult(), ...stored, alreadyApplied: true };
    }
    logDbError("analysis_applications", "insert", reservation.error);
    throw new Error(reservation.error.message);
  }
  const applicationId = (reservation.data as { id: string }).id;

  /* ---------- contexto ---------- */
  if (selection.contextItems.length > 0) {
    const { ensureProjectContext, saveProjectContext } = await import("./projects");
    const current = params.context ?? (await ensureProjectContext(projectId));
    const patch: Partial<Record<ContextListKey, ContextItem[]>> = {};

    for (const key of CONTEXT_LISTS) {
      const incoming = selection.contextItems.filter(
        (i) => i.list === key && i.operation !== "manter" && i.operation !== "remover",
      );
      if (incoming.length === 0) continue;

      let list = [...current[key]];
      let changed = false;

      for (const entry of incoming) {
        const res = resolutionOf(entry);
        if (res.mode === "skip") {
          result.skipped += 1;
          continue;
        }
        if (res.mode === "update" && res.targetId) {
          // Atualiza a redação preservando o item (e o histórico em mentions).
          const index = list.findIndex((i) => i.id === res.targetId);
          if (index >= 0) {
            const previousText = list[index]!.text;
            list[index] = { ...list[index]!, text: entry.text, source_meeting_id: meeting.id };
            changed = true;
            result.updated += 1;
            mentions.push({
              entity_type: "context_item",
              entity_id: res.targetId,
              meeting_id: meeting.id,
              analysis_id: analysisId,
              client_id: meeting.client_id,
              project_id: projectId,
              mention_type: "updated",
              confidence: res.confidence,
              reason: res.reason,
              previous_value: { text: previousText, list: key },
              new_value: { text: entry.text, list: key },
            });
            continue;
          }
        }
        // Barreira final: mesmo sem resolução, texto já presente não duplica.
        const match = matchContextItem(entry.text, list);
        if (match.type === "EXISTING" && match.existing_id) {
          result.skipped += 1;
          mentions.push({
            entity_type: "context_item",
            entity_id: match.existing_id,
            meeting_id: meeting.id,
            analysis_id: analysisId,
            client_id: meeting.client_id,
            project_id: projectId,
            mention_type: "confirmed",
            confidence: match.confidence,
            reason: match.reason,
          });
          continue;
        }
        const created = { ...newContextItem(entry.text, "ia"), source_meeting_id: meeting.id };
        list = [...list, created];
        changed = true;
        result.context += 1;
        mentions.push({
          entity_type: "context_item",
          entity_id: created.id,
          meeting_id: meeting.id,
          analysis_id: analysisId,
          client_id: meeting.client_id,
          project_id: projectId,
          mention_type: "created",
        });
      }

      if (changed) patch[key] = list;
    }

    if (Object.keys(patch).length > 0) {
      await saveProjectContext(projectId, patch as never);
    }
  }

  /* ---------- decisões ---------- */
  for (const d of selection.decisions) {
    const res = resolutionOf(d);
    if (res.mode === "skip") {
      result.skipped += 1;
      // Item retido por ambiguidade não vira menção — nada foi decidido.
      if (res.targetId && res.verdict !== "POSSIBLE_DUPLICATE")
        mentions.push({
          entity_type: "decision",
          entity_id: res.targetId,
          meeting_id: meeting.id,
          analysis_id: analysisId,
          client_id: meeting.client_id,
          project_id: projectId,
          mention_type: "confirmed",
          confidence: res.confidence,
          reason: res.reason,
        });
      continue;
    }

    if (res.mode === "update" && res.targetId) {
      const previous = await supabase
        .from("decisions")
        .select("*")
        .eq("id", res.targetId)
        .maybeSingle();
      const patch: Record<string, unknown> = { title: d.title };
      if (d.description) patch["description"] = d.description;
      if (d.reason) patch["reason"] = d.reason;
      if (d.owner) patch["owner"] = d.owner;
      if (d.due_date) patch["due_date"] = d.due_date;
      if (d.embedding) patch["embedding"] = d.embedding;
      const { error } = await supabase.from("decisions").update(patch as never).eq("id", res.targetId);
      if (error) {
        logDbError("decisions", "update-analysis", error);
        throw new Error(error.message);
      }
      result.updated += 1;
      mentions.push({
        entity_type: "decision",
        entity_id: res.targetId,
        meeting_id: meeting.id,
        analysis_id: analysisId,
        client_id: meeting.client_id,
        project_id: projectId,
        mention_type: "updated",
        confidence: res.confidence,
        reason: res.reason,
        previous_value: previous.data ?? null,
        new_value: patch,
      });
      continue;
    }

    // create — pode substituir uma decisão anterior sem apagá-la
    const supersedesId = res.mode === "create" && res.verdict === "UPDATE_EXISTING" ? res.targetId : null;
    const insert = await supabase
      .from("decisions")
      .insert({
        project_id: projectId,
        meeting_id: meeting.id,
        client_id: meeting.client_id,
        title: d.title,
        description: d.description || null,
        reason: d.reason || null,
        owner: d.owner || null,
        due_date: d.due_date || null,
        status: "pendente",
        created_by: userId,
        supersedes_decision_id: supersedesId,
        embedding: d.embedding ?? null,
      })
      .select("id")
      .single();
    if (insert.error) {
      logDbError("decisions", "insert-analysis", insert.error);
      throw new Error(insert.error.message);
    }
    result.decisions += 1;
    const newId = (insert.data as { id: string }).id;
    mentions.push({
      entity_type: "decision",
      entity_id: newId,
      meeting_id: meeting.id,
      analysis_id: analysisId,
      client_id: meeting.client_id,
      project_id: projectId,
      mention_type: "created",
    });
    if (supersedesId) {
      mentions.push({
        entity_type: "decision",
        entity_id: supersedesId,
        meeting_id: meeting.id,
        analysis_id: analysisId,
        client_id: meeting.client_id,
        project_id: projectId,
        mention_type: "superseded",
        confidence: res.confidence,
        reason: res.reason,
        new_value: { superseded_by: newId, title: d.title },
      });
    }
  }

  /* ---------- ações ---------- */
  for (const a of selection.actions) {
    const res = resolutionOf(a);
    if (res.mode === "skip") {
      result.skipped += 1;
      // Item retido por ambiguidade não vira menção — nada foi decidido.
      if (res.targetId && res.verdict !== "POSSIBLE_DUPLICATE")
        mentions.push({
          entity_type: "action",
          entity_id: res.targetId,
          meeting_id: meeting.id,
          analysis_id: analysisId,
          client_id: meeting.client_id,
          project_id: projectId,
          mention_type: "confirmed",
          confidence: res.confidence,
          reason: res.reason,
        });
      continue;
    }

    if (res.mode === "update" && res.targetId) {
      const previous = await supabase
        .from("actions")
        .select("*")
        .eq("id", res.targetId)
        .maybeSingle();
      const patch: Record<string, unknown> = {};
      // Conclusão/retomada muda o estado da MESMA ação — nunca cria outra.
      if (res.statusSignal === "resolved") patch["status"] = "concluída";
      if (res.statusSignal === "reopened") patch["status"] = "em andamento";
      if (a.deadline) patch["deadline"] = a.deadline;
      if (a.owner_name) patch["owner_name"] = a.owner_name;
      if (a.priority) patch["priority"] = a.priority;
      if (a.erp_area) patch["erp_area"] = a.erp_area;
      if (a.embedding) patch["embedding"] = a.embedding;
      // Evidência acumula — a menção mais recente não apaga a anterior.
      const previousEvidence = (previous.data as { evidence?: string | null } | null)?.evidence;
      const note = a.evidence || a.description;
      patch["evidence"] = [previousEvidence, note].filter(Boolean).join("\n");
      const { error } = await supabase.from("actions").update(patch as never).eq("id", res.targetId);
      if (error) {
        logDbError("actions", "update-analysis", error);
        throw new Error(error.message);
      }
      result.updated += 1;
      mentions.push({
        entity_type: "action",
        entity_id: res.targetId,
        meeting_id: meeting.id,
        analysis_id: analysisId,
        client_id: meeting.client_id,
        project_id: projectId,
        mention_type:
          res.statusSignal === "resolved"
            ? "resolved"
            : res.statusSignal === "reopened"
              ? "reopened"
              : "updated",
        confidence: res.confidence,
        reason: res.reason,
        previous_value: previous.data ?? null,
        new_value: patch,
      });
      continue;
    }

    const insert = await supabase
      .from("actions")
      .insert({
        client_id: meeting.client_id,
        meeting_id: meeting.id,
        description: a.description,
        owner_name: a.owner_name || null,
        deadline: a.deadline || null,
        priority: a.priority || "média",
        status: "não iniciada",
        erp_area: a.erp_area || null,
        embedding: a.embedding ?? null,
        evidence: a.evidence || null,
      })
      .select("id")
      .single();
    if (insert.error) {
      logDbError("actions", "insert-analysis", insert.error);
      throw new Error(insert.error.message);
    }
    result.actions += 1;
    mentions.push({
      entity_type: "action",
      entity_id: (insert.data as { id: string }).id,
      meeting_id: meeting.id,
      analysis_id: analysisId,
      client_id: meeting.client_id,
      project_id: projectId,
      mention_type: "created",
    });
  }

  /* ---------- riscos ---------- */
  for (const r of selection.risks) {
    const res = resolutionOf(r);
    if (res.mode === "skip") {
      result.skipped += 1;
      // Item retido por ambiguidade não vira menção — nada foi decidido.
      if (res.targetId && res.verdict !== "POSSIBLE_DUPLICATE")
        mentions.push({
          entity_type: "risk",
          entity_id: res.targetId,
          meeting_id: meeting.id,
          analysis_id: analysisId,
          client_id: meeting.client_id,
          project_id: projectId,
          mention_type: "confirmed",
          confidence: res.confidence,
          reason: res.reason,
        });
      continue;
    }

    if (res.mode === "update" && res.targetId) {
      const previous = await supabase.from("risks").select("*").eq("id", res.targetId).maybeSingle();
      // Risco resolvido apenas muda de estado; reaparecimento reativa o MESMO risco.
      const patch: Record<string, unknown> = { active: res.statusSignal !== "resolved" };
      if (r.level) patch["level"] = r.level;
      if (r.embedding) patch["embedding"] = r.embedding;
      const { error } = await supabase.from("risks").update(patch as never).eq("id", res.targetId);
      if (error) {
        logDbError("risks", "update-analysis", error);
        throw new Error(error.message);
      }
      result.updated += 1;
      mentions.push({
        entity_type: "risk",
        entity_id: res.targetId,
        meeting_id: meeting.id,
        analysis_id: analysisId,
        client_id: meeting.client_id,
        project_id: projectId,
        mention_type:
          res.statusSignal === "resolved"
            ? "resolved"
            : res.statusSignal === "reopened"
              ? "reopened"
              : "updated",
        confidence: res.confidence,
        reason: res.reason,
        previous_value: previous.data ?? null,
        new_value: { ...patch, evidence: r.description },
      });
      continue;
    }

    const insert = await supabase
      .from("risks")
      .insert({
        client_id: meeting.client_id,
        meeting_id: meeting.id,
        description: r.description,
        level: r.level || "médio",
        active: true,
        embedding: r.embedding ?? null,
      })
      .select("id")
      .single();
    if (insert.error) {
      logDbError("risks", "insert-analysis", insert.error);
      throw new Error(insert.error.message);
    }
    result.risks += 1;
    mentions.push({
      entity_type: "risk",
      entity_id: (insert.data as { id: string }).id,
      meeting_id: meeting.id,
      analysis_id: analysisId,
      client_id: meeting.client_id,
      project_id: projectId,
      mention_type: "created",
    });
  }

  /* ---------- oportunidades ---------- */
  for (const o of selection.opportunities) {
    const res = resolutionOf(o);
    if (res.mode === "skip") {
      result.skipped += 1;
      // Item retido por ambiguidade não vira menção — nada foi decidido.
      if (res.targetId && res.verdict !== "POSSIBLE_DUPLICATE")
        mentions.push({
          entity_type: "opportunity",
          entity_id: res.targetId,
          meeting_id: meeting.id,
          analysis_id: analysisId,
          client_id: meeting.client_id,
          project_id: projectId,
          mention_type: "confirmed",
          confidence: res.confidence,
          reason: res.reason,
        });
      continue;
    }

    if (res.mode === "update" && res.targetId) {
      const previous = await supabase
        .from("opportunities")
        .select("*")
        .eq("id", res.targetId)
        .maybeSingle();
      const patch: Record<string, unknown> = {};
      if (o.expected_benefit) patch["expected_benefit"] = o.expected_benefit;
      if (o.embedding) patch["embedding"] = o.embedding;
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("opportunities").update(patch as never).eq("id", res.targetId);
        if (error) {
          logDbError("opportunities", "update-analysis", error);
          throw new Error(error.message);
        }
      }
      result.updated += 1;
      mentions.push({
        entity_type: "opportunity",
        entity_id: res.targetId,
        meeting_id: meeting.id,
        analysis_id: analysisId,
        client_id: meeting.client_id,
        project_id: projectId,
        mention_type: "updated",
        confidence: res.confidence,
        reason: res.reason,
        previous_value: previous.data ?? null,
        new_value: { ...patch, evidence: o.description },
      });
      continue;
    }

    const insert = await supabase
      .from("opportunities")
      .insert({
        client_id: meeting.client_id,
        meeting_id: meeting.id,
        description: o.description,
        expected_benefit: o.expected_benefit || null,
        status: "aberta",
        embedding: o.embedding ?? null,
      })
      .select("id")
      .single();
    if (insert.error) {
      logDbError("opportunities", "insert-analysis", insert.error);
      throw new Error(insert.error.message);
    }
    result.opportunities += 1;
    mentions.push({
      entity_type: "opportunity",
      entity_id: (insert.data as { id: string }).id,
      meeting_id: meeting.id,
      analysis_id: analysisId,
      client_id: meeting.client_id,
      project_id: projectId,
      mention_type: "created",
    });
  }

  /* ---------- reunião: apenas complementa campos vazios ---------- */
  const meetingPatch: {
    executive_summary?: string;
    measurable_result?: string;
    has_measurable_result?: boolean;
  } = {};
  if (selection.meetingSummary && !meeting.executive_summary)
    meetingPatch.executive_summary = selection.meetingSummary;
  if (selection.measurableResult && !meeting.measurable_result) {
    meetingPatch.measurable_result = selection.measurableResult;
    meetingPatch.has_measurable_result = true;
  }
  if (Object.keys(meetingPatch).length > 0) {
    const { error } = await supabase.from("meetings").update(meetingPatch).eq("id", meeting.id);
    if (error) {
      logDbError("meetings", "update-analysis", error);
      throw new Error(error.message);
    }
  }

  await recordMentions(mentions, userId);

  /**
   * Evolução entre reuniões: gravada depois das entidades, porque só faz
   * sentido registrar "o que mudou" sobre mudanças que realmente ocorreram.
   */
  if (params.evolution && params.evolution.length > 0) {
    await saveEvolution(
      {
        projectId,
        clientId: meeting.client_id,
        meetingId: meeting.id,
        analysisId,
        previousMeetingId: params.previousMeetingId ?? null,
        items: params.evolution,
      },
      userId,
    );
  }

  /**
   * Saúde do cliente: ações, riscos e a própria reunião acabaram de mudar,
   * então os indicadores atuais (risco, quadrante, status da conta, data da
   * última reunião) precisam ser recalculados aqui — caso contrário a Visão
   * Geral continuaria lendo a foto anterior da tabela de clientes.
   */
  const rules = await supabase.from("risk_rules").select("*");
  if (rules.error) logDbError("risk_rules", "select-analysis", rules.error);
  await recalculateClient(meeting.client_id, (rules.data as RiskRule[] | null) ?? undefined);

  // Guarda o resultado para que uma reaplicação devolva o mesmo resumo.
  await supabase
    .from("analysis_applications")
    .update({ result: result as never })
    .eq("id", applicationId);

  return result;
}

export type ExistingForDedupe = {
  actions: ActionItem[];
  risks: RiskItem[];
  opportunities: OpportunityItem[];
  decisions: Decision[];
};

