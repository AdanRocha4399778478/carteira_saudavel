/* ------------------------------------------------------------------ *
 * ORQUESTRADOR CONSULTIVO V1 — tipos e vocabulário
 *
 * O Orquestrador NÃO executa agentes. Ele lê o estado atual do projeto,
 * recomenda UMA próxima atuação, explica o porquê e aguarda aprovação
 * humana. Toda decisão forte é determinística (ver `rules.ts`).
 * ------------------------------------------------------------------ */

export const ORCHESTRATOR_AGENTS = [
  "CRITERIOS_SUCESSO",
  "DIAGNOSTICO_EXECUTIVO",
  "PARETO_ORDEM_ATAQUE",
  "ENTREGA_CONSULTIVA",
  "IMPLANTACAO_CONSULTIVA",
  "CONTINUIDADE_GERENCIAL",
  "AUDITOR_QUALIDADE",
] as const;
export type OrchestratorAgent = (typeof ORCHESTRATOR_AGENTS)[number];

export const AGENT_LABEL: Record<OrchestratorAgent, string> = {
  CRITERIOS_SUCESSO: "Critérios de sucesso",
  DIAGNOSTICO_EXECUTIVO: "Diagnóstico executivo",
  PARETO_ORDEM_ATAQUE: "Pareto / ordem de ataque",
  ENTREGA_CONSULTIVA: "Entrega consultiva",
  IMPLANTACAO_CONSULTIVA: "Implantação consultiva",
  CONTINUIDADE_GERENCIAL: "Continuidade gerencial",
  AUDITOR_QUALIDADE: "Auditor de qualidade",
};

export const PROJECT_STAGES = [
  "SEM_DIRECAO",
  "EM_DIAGNOSTICO",
  "AGUARDANDO_PRIORIZACAO",
  "SOLUCAO_DEFINIDA",
  "EM_IMPLANTACAO",
  "EM_ACOMPANHAMENTO",
  "TRAVADO",
  "EM_VALIDACAO",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const STAGE_LABEL: Record<ProjectStage, string> = {
  SEM_DIRECAO: "Sem direção definida",
  EM_DIAGNOSTICO: "Em diagnóstico",
  AGUARDANDO_PRIORIZACAO: "Aguardando priorização",
  SOLUCAO_DEFINIDA: "Solução definida",
  EM_IMPLANTACAO: "Em implantação",
  EM_ACOMPANHAMENTO: "Em acompanhamento",
  TRAVADO: "Travado",
  EM_VALIDACAO: "Em validação",
};

export const RECOMMENDATION_STATUSES = [
  "suggested",
  "approved",
  "rejected",
  "executed",
  "superseded",
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const RECOMMENDATION_STATUS_LABEL: Record<RecommendationStatus, string> = {
  suggested: "Sugerida",
  approved: "Aprovada",
  rejected: "Rejeitada",
  executed: "Executada",
  superseded: "Substituída",
};

export type BottleneckType =
  | "SEM_OBJETIVO"
  | "SEM_CAUSA_RAIZ"
  | "SEM_PRIORIZACAO"
  | "SEM_SOLUCAO"
  | "SEM_EXECUCAO"
  | "EXECUCAO_TRAVADA"
  | "SEM_VALIDACAO"
  | "INDEFINIDO";

/** Estado consolidado do projeto — só contadores e textos curtos, nunca transcrição. */
export type OrchestratorState = {
  project: { id: string; name: string; status: string };
  context: {
    hasMainObjective: boolean;
    objectives: number;
    problems: number;
    root_causes: number;
    priorities: number;
    hypotheses: number;
    constraints: number;
    results: number;
    next_steps: number;
    /** Amostra curta para dar contexto à IA (máx. 5 itens por lista). */
    samples: Record<string, string[]>;
  };
  health: {
    score: number;
    status: string;
    priority: string;
    movement: string | null;
    topReasons: string[];
  };
  actions: { total: number; open: number; overdue: number; blocked: number; done: number };
  decisions: {
    total: number;
    pending: number;
    approved: number;
    inProgress: number;
    implemented: number;
    overdue: number;
  };
  risks: { active: number; critical: number; high: number };
  evolution: {
    movement: string | null;
    delayed: number;
    blocked: number;
    regressed: number;
    progressed: number;
    resolved: number;
  } | null;
  latestMeeting: { id: string; date: string; daysSince: number | null } | null;
  mentions: { total: number };
};

export type Recommendation = {
  project_stage: ProjectStage;
  main_bottleneck: { type: BottleneckType; description: string };
  recommended_agent: OrchestratorAgent;
  confidence: number;
  reason: string;
  expected_result: string;
  evidence: string[];
  alternative_agent: OrchestratorAgent | null;
  alternative_reason: string | null;
  erp_classification: { area: string | null; process: string | null };
};

export type StoredRecommendation = Recommendation & {
  id: string;
  project_id: string;
  status: RecommendationStatus;
  state_hash: string;
  source: "rules" | "ai";
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
};
