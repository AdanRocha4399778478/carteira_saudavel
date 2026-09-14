import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { logDbError } from "./api";
import { normalizeMeeting, type Meeting } from "./domain";
import { DEDUPE_THRESHOLDS, matchProject } from "./deduplication";

/* ------------------------------------------------------------------ *
 * Modelo consultivo: CLIENTE → PROJETO → CONTEXTO → REUNIÕES →
 * DECISÕES → AÇÕES → RISCOS → RESULTADOS → PRÓXIMA PAUTA
 *
 * O contexto representa o ESTADO ATUAL do projeto; as reuniões
 * permanecem como HISTÓRICO imutável. Nada é apagado ao atualizar
 * o contexto — por isso as listas do contexto são JSONB versionável
 * e cada item guarda a reunião de origem (`source_meeting_id`).
 * ------------------------------------------------------------------ */

export const PROJECT_STATUSES = [
  "planejamento",
  "ativo",
  "pausado",
  "concluido",
  "cancelado",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  planejamento: "Planejamento",
  ativo: "Ativo",
  pausado: "Pausado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

export const DECISION_STATUSES = [
  "pendente",
  "aprovada",
  "em_execucao",
  "implementada",
  "cancelada",
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const DECISION_STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  aprovada: "Aprovada",
  em_execucao: "Em execução",
  implementada: "Implementada",
  cancelada: "Cancelada",
};

export type Project = {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  status: string;
  start_date: string | null;
  target_end_date: string | null;
  consultant_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Gerado pelo banco — nunca calculado no cliente. */
  normalized_name?: string | null;
  /** Preenchido quando o projeto foi consolidado em outro. */
  merged_into_project_id?: string | null;
};


export type Decision = {
  id: string;
  project_id: string;
  meeting_id: string | null;
  client_id: string | null;
  title: string;
  description: string | null;
  reason: string | null;
  status: string;
  owner: string | null;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Vetor semântico do título/descrição — usado para reconhecer continuidade entre reuniões. */
  embedding?: number[] | null;
};

/**
 * Item de contexto. O formato é propositalmente simples e estável para que
 * futuros agentes de IA possam ler/propor alterações sem migração de schema.
 */
export type ContextItem = {
  id: string;
  text: string;
  /** Reunião em que o item surgiu — mantém a rastreabilidade do histórico. */
  source_meeting_id?: string | null;
  /** Origem da informação: consultor ou agente. */
  origin?: "consultor" | "ia";
  created_at?: string;
  /** Vetor semântico do texto — usado para reconhecer continuidade entre reuniões. */
  embedding?: number[] | null;
};

export const CONTEXT_LISTS = [
  "objectives",
  "problems",
  "root_causes",
  "priorities",
  "hypotheses",
  "constraints",
  "results",
  "next_steps",
] as const;
export type ContextListKey = (typeof CONTEXT_LISTS)[number];

export const CONTEXT_LIST_LABEL: Record<ContextListKey, string> = {
  objectives: "Objetivos",
  problems: "Problemas ativos",
  root_causes: "Causas raiz",
  priorities: "Prioridades",
  hypotheses: "Hipóteses",
  constraints: "Restrições",
  results: "Resultados alcançados",
  next_steps: "Próximos passos",
};

export type ProjectContext = {
  id: string;
  project_id: string;
  executive_summary: string | null;
  current_scenario: string | null;
  main_objective: string | null;
  last_meeting_id: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
} & Record<ContextListKey, ContextItem[]>;

export function emptyContextLists(): Record<ContextListKey, ContextItem[]> {
  return CONTEXT_LISTS.reduce(
    (acc, key) => ({ ...acc, [key]: [] }),
    {} as Record<ContextListKey, ContextItem[]>,
  );
}

/** Aceita string simples ou objeto — tolerante a payloads gerados por IA. */
export function normalizeContextItems(value: unknown): ContextItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw, index): ContextItem | null => {
      if (typeof raw === "string") {
        const text = raw.trim();
        return text ? { id: `${index}-${text.slice(0, 12)}`, text, origin: "consultor" } : null;
      }
      if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        const text = String(obj["text"] ?? obj["description"] ?? obj["title"] ?? "").trim();
        if (!text) return null;
        const createdAt = obj["created_at"];
        return {
          id: String(obj["id"] ?? `${index}-${text.slice(0, 12)}`),
          text,
          source_meeting_id: (obj["source_meeting_id"] as string | null) ?? null,
          origin: obj["origin"] === "ia" ? "ia" : "consultor",
          ...(typeof createdAt === "string" ? { created_at: createdAt } : {}),
        };
      }
      return null;
    })
    .filter((item): item is ContextItem => item !== null);
}

export function normalizeContext(row: Record<string, unknown>): ProjectContext {
  const lists = CONTEXT_LISTS.reduce(
    (acc, key) => ({ ...acc, [key]: normalizeContextItems(row[key]) }),
    {} as Record<ContextListKey, ContextItem[]>,
  );
  return {
    id: String(row["id"] ?? ""),
    project_id: String(row["project_id"] ?? ""),
    executive_summary: (row["executive_summary"] as string | null) ?? null,
    current_scenario: (row["current_scenario"] as string | null) ?? null,
    main_objective: (row["main_objective"] as string | null) ?? null,
    last_meeting_id: (row["last_meeting_id"] as string | null) ?? null,
    updated_by: (row["updated_by"] as string | null) ?? null,
    created_at: String(row["created_at"] ?? ""),
    updated_at: String(row["updated_at"] ?? ""),
    ...lists,
  };
}

export function newContextItem(text: string, origin: "consultor" | "ia" = "consultor"): ContextItem {
  return {
    id: crypto.randomUUID(),
    text: text.trim(),
    origin,
    source_meeting_id: null,
    created_at: new Date().toISOString(),
  };
}

/* ---------------- queries ---------------- */

function unwrap<T>(table: string, res: { data: unknown; error: unknown }): T {
  const error = res.error as { message: string } | null;
  if (error) {
    logDbError(table, "select", error as never);
    throw new Error(error.message);
  }
  return (res.data ?? []) as T;
}

/** Lista apenas projetos canônicos — os consolidados (`merged`) ficam fora. */
export const projectsQuery = () =>
  queryOptions({
    queryKey: ["projects"],
    queryFn: async () =>
      unwrap<Project[]>(
        "projects",
        await supabase
          .from("projects")
          .select("*")
          .is("merged_into_project_id", null)
          .order("created_at", { ascending: false }),
      ),
  });


export const projectQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["projects", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
      if (res.error) {
        logDbError("projects", "select-one", res.error);
        throw new Error(res.error.message);
      }
      return (res.data as Project | null) ?? null;
    },
  });

export const projectContextQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["project_context", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectContext | null> => {
      const res = await supabase
        .from("project_context")
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle();
      if (res.error) {
        logDbError("project_context", "select", res.error);
        throw new Error(res.error.message);
      }
      return res.data ? normalizeContext(res.data as Record<string, unknown>) : null;
    },
  });

export const decisionsQuery = (projectId?: string) =>
  queryOptions({
    queryKey: projectId ? ["decisions", projectId] : ["decisions"],
    queryFn: async () => {
      let q = supabase.from("decisions").select("*").order("created_at", { ascending: false });
      if (projectId) q = q.eq("project_id", projectId);
      return unwrap<Decision[]>("decisions", await q);
    },
  });

/** Reuniões do projeto (histórico) — nunca é sobrescrito pelo contexto. */
export const projectMeetingsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["meetings", "project", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<Meeting[]> =>
      unwrap<Record<string, unknown>[]>(
        "meetings",
        await supabase
          .from("meetings")
          .select("*")
          .eq("project_id", projectId)
          .order("meeting_date", { ascending: false }),
      ).map(normalizeMeeting),
  });

/* ---------------- mutations ---------------- */

/** Garante que exista uma linha de contexto para o projeto. */
export async function ensureProjectContext(projectId: string): Promise<ProjectContext> {
  const existing = await supabase
    .from("project_context")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return normalizeContext(existing.data as Record<string, unknown>);

  const created = await supabase
    .from("project_context")
    .insert({ project_id: projectId })
    .select("*")
    .single();
  if (created.error) {
    logDbError("project_context", "insert", created.error);
    throw new Error(created.error.message);
  }
  return normalizeContext(created.data as Record<string, unknown>);
}

export async function saveProjectContext(
  projectId: string,
  patch: Partial<Omit<ProjectContext, "id" | "project_id" | "created_at" | "updated_at">>,
) {
  await ensureProjectContext(projectId);
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("project_context")
    .update({ ...(patch as Record<string, unknown>), updated_by: auth.user?.id ?? null })
    .eq("project_id", projectId);
  if (error) {
    logDbError("project_context", "update", error);
    throw new Error(error.message);
  }
}

/** Vincula (ou desvincula) uma reunião existente a um projeto — histórico preservado. */
export async function setMeetingProject(meetingId: string, projectId: string | null) {
  const { error } = await supabase
    .from("meetings")
    .update({ project_id: projectId })
    .eq("id", meetingId);
  if (error) {
    logDbError("meetings", "update-project", error);
    throw new Error(error.message);
  }
}

/* ------------------------------------------------------------------ *
 * Contrato de importação consultiva (preparação para agentes de IA).
 *
 * A importação JSON atual (meeting-import.ts + RPC `import_meeting`)
 * continua sendo a base. Este tipo descreve o envelope estendido que
 * futuros agentes enviarão: além da reunião, ele traz atualizações do
 * contexto e decisões. Nenhuma integração é executada nesta etapa —
 * o modelo de dados já suporta todos os campos abaixo.
 * ------------------------------------------------------------------ */

export type ConsultingImportPayload = {
  project_id: string;
  meeting: Record<string, unknown>;
  context_updates?: Partial<Record<ContextListKey, (string | ContextItem)[]>> & {
    executive_summary?: string;
    current_scenario?: string;
    main_objective?: string;
  };
  decisions?: Partial<Decision>[];
  actions?: Record<string, unknown>[];
  risks?: Record<string, unknown>[];
  opportunities?: Record<string, unknown>[];
};

/**
 * Mescla atualizações de contexto sem apagar histórico: itens novos são
 * anexados, itens repetidos são ignorados. Reuniões nunca são alteradas.
 */
export function mergeContextUpdates(
  current: Record<ContextListKey, ContextItem[]>,
  updates: Partial<Record<ContextListKey, (string | ContextItem)[]>>,
  sourceMeetingId: string | null = null,
): Record<ContextListKey, ContextItem[]> {
  const next = { ...current };
  for (const key of CONTEXT_LISTS) {
    const incoming = normalizeContextItems(updates[key] ?? []);
    if (incoming.length === 0) continue;
    const seen = new Set(next[key].map((i) => i.text.toLowerCase()));
    const added = incoming
      .filter((i) => !seen.has(i.text.toLowerCase()))
      .map((i) => ({ ...i, origin: "ia" as const, source_meeting_id: sourceMeetingId }));
    next[key] = [...next[key], ...added];
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * Antiduplicidade de projetos
 *
 * A normalização abaixo espelha `public.normalize_project_name` no
 * banco — a UI usa para avisar o consultor, mas quem decide é o banco
 * (índice único parcial + RPC `get_or_create_project`).
 * ------------------------------------------------------------------ */

export function normalizeProjectName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type ProjectMatchKind = "EXACT_MATCH" | "PROBABLE_MATCH" | "NEW_PROJECT";

export type ProjectMatchResult = {
  kind: ProjectMatchKind;
  existing: Project | null;
  confidence: number;
  reason: string;
};

/** EXACT_MATCH bloqueia criação; PROBABLE_MATCH exige confirmação explícita. */
export function classifyProjectMatch(name: string, candidates: Project[]): ProjectMatchResult {
  const norm = normalizeProjectName(name);
  if (!norm) return { kind: "NEW_PROJECT", existing: null, confidence: 0, reason: "" };

  const exact = candidates.find((p) => normalizeProjectName(p.name) === norm);
  if (exact)
    return {
      kind: "EXACT_MATCH",
      existing: exact,
      confidence: 1,
      reason: "Já existe um projeto com este nome neste cliente.",
    };

  const match = matchProject({ name }, candidates);
  if (match.existing && match.confidence >= DEDUPE_THRESHOLDS.review)
    return {
      kind: "PROBABLE_MATCH",
      existing: match.existing,
      confidence: match.confidence,
      reason: match.reason,
    };

  return { kind: "NEW_PROJECT", existing: null, confidence: match.confidence, reason: "" };
}

export type GetOrCreateProjectResult = { project_id: string; reused: boolean; reason: string };

/**
 * Criação idempotente: nunca faz INSERT direto. O banco reaproveita o projeto
 * equivalente do cliente e devolve o mesmo projeto quando a mesma análise é
 * aprovada novamente (protege contra clique duplo e reenvio).
 */
export async function getOrCreateProject(params: {
  clientId: string;
  name: string;
  description?: string | null;
  analysisId?: string | null;
}): Promise<{ project: Project; reused: boolean; reason: string }> {
  const { data, error } = await supabase.rpc("get_or_create_project", {
    p_client_id: params.clientId,
    p_name: params.name,
    ...(params.description ? { p_description: params.description } : {}),
    ...(params.analysisId ? { p_analysis_id: params.analysisId } : {}),
  });

  if (error) {
    logDbError("get_or_create_project", "rpc", error);
    throw new Error(error.message);
  }
  const result = data as unknown as GetOrCreateProjectResult;
  const res = await supabase.from("projects").select("*").eq("id", result.project_id).single();
  if (res.error) {
    logDbError("projects", "select-one", res.error);
    throw new Error(res.error.message);
  }
  return { project: res.data as unknown as Project, reused: result.reused, reason: result.reason };
}
