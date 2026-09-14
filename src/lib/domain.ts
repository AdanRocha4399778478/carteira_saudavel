export type RiskLevel = "baixo" | "médio" | "alto" | "crítico";
export type AccountStatus = "saudável" | "atenção" | "risco" | "crítico" | "encerrado";
export type ActionStatus =
  | "não iniciada"
  | "em andamento"
  | "concluída"
  | "aguardando cliente"
  | "aguardando consultoria"
  | "bloqueada";

export const RISK_LEVELS: RiskLevel[] = ["baixo", "médio", "alto", "crítico"];
export const ACCOUNT_STATUSES: AccountStatus[] = [
  "saudável",
  "atenção",
  "risco",
  "crítico",
  "encerrado",
];
export const ACTION_STATUSES: ActionStatus[] = [
  "não iniciada",
  "em andamento",
  "concluída",
  "aguardando cliente",
  "aguardando consultoria",
  "bloqueada",
];
export const PRIORITIES = ["alta", "média", "baixa"] as const;
export const ERP_AREAS = [
  "Financeiro",
  "Comercial",
  "Estoque",
  "Produção",
  "Fiscal",
  "Gestão",
  "RH",
] as const;
export const MEETING_TYPES = [
  "diagnóstico",
  "acompanhamento",
  "revisão de plano",
  "alinhamento de liderança",
  "encerramento de ciclo",
] as const;

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  role: "admin" | "consultant";
  active: boolean;
  created_at: string;
};

export type Client = {
  id: string;
  company_name: string;
  segment: string | null;
  consultant_id: string | null;
  start_date: string | null;
  account_status: string;
  current_satisfaction: number | null;
  current_value_score: number | null;
  current_risk_score: number;
  current_risk_level: string;
  current_quadrant: string | null;
  last_meeting_date: string | null;
  next_meeting_date: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Meeting = {
  id: string;
  client_id: string;
  meeting_date: string;
  meeting_type: string | null;
  participants: string[];
  executive_summary: string | null;
  satisfaction_score: number | null;
  satisfaction_classification: string | null;
  satisfaction_trend: string | null;
  satisfaction_justification: string | null;
  value_score: number | null;
  value_justification: string | null;
  measurable_result: string | null;
  has_measurable_result: boolean;
  main_pain: string | null;
  main_priority: string | null;
  main_result: string | null;
  next_action: string | null;
  action_owner: string | null;
  action_deadline: string | null;
  expansion_opportunity: string | null;
  explicit_complaint: boolean;
  continuity_doubt: boolean;
  low_client_adherence: boolean;
  missing_internal_owner: boolean;
  calculated_risk_score: number;
  calculated_risk_level: string;
  /** Risco informado pela análise (auditoria) — não substitui o risco calculado. */
  analysis_risk_level: string | null;
  analysis_quadrant: string | null;
  import_hash: string | null;
  created_by: string | null;
  created_at: string;
};


export type ActionItem = {
  id: string;
  client_id: string;
  meeting_id: string | null;
  description: string;
  owner_name: string | null;
  deadline: string | null;
  priority: string;
  status: string;
  erp_area: string | null;
  evidence: string | null;
  created_at: string;
  updated_at: string;
  /** Vetor semântico da descrição — usado para reconhecer continuidade entre reuniões. */
  embedding?: number[] | null;
};

export type RiskItem = {
  id: string;
  client_id: string;
  meeting_id: string | null;
  description: string;
  level: string;
  active: boolean;
  created_at: string;
  embedding?: number[] | null;
};

export type OpportunityItem = {
  id: string;
  client_id: string;
  meeting_id: string | null;
  description: string;
  expected_benefit: string | null;
  status: string;
  created_at: string;
  embedding?: number[] | null;
};

export type RiskRule = {
  id: string;
  rule_key: string;
  rule_name: string;
  points: number;
  active: boolean;
  description: string | null;
  updated_at: string;
};

/* ---------- helpers ---------- */

export const HIGH_THRESHOLD = 7;

export function isOverdue(action: Pick<ActionItem, "deadline" | "status">): boolean {
  if (!action.deadline) return false;
  if (action.status === "concluída") return false;
  return new Date(action.deadline) < startOfToday();
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  return !Number.isNaN(d.getTime());
}

/** Dias entre a data atual e a data informada. */
export function daysSince(date: string | null): number | null {
  if (!isValidDateString(date)) return null;
  const diff = startOfToday().getTime() - new Date(`${date.slice(0, 10)}T00:00:00`).getTime();
  return Math.floor(diff / 86_400_000);
}

/**
 * Dias entre duas datas (from → to). Usado para a regra "sem reunião há mais de
 * 45 dias" no momento do registro: compara a nova reunião com a anterior,
 * nunca a nova reunião com ela mesma.
 */
export function daysBetween(from: string | null, to: string | null): number | null {
  if (!isValidDateString(from) || !isValidDateString(to)) return null;
  const a = new Date(`${from.slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${to.slice(0, 10)}T00:00:00`).getTime();
  return Math.floor((b - a) / 86_400_000);
}

/** Registros legados podem ter participants null ou tipos inesperados. */
export function safeParticipants(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length ? value : null;
}

/**
 * Normaliza uma linha de `meetings` vinda do banco. Registros antigos ou
 * incompletos passam a ser renderizáveis sem quebrar a tela — nenhum dado
 * ausente é inventado.
 */
export function normalizeMeeting(row: Record<string, unknown>): Meeting {
  const rawDate = row["meeting_date"];
  return {
    id: String(row["id"] ?? ""),
    client_id: String(row["client_id"] ?? ""),
    meeting_date: isValidDateString(rawDate) ? String(rawDate).slice(0, 10) : "",
    meeting_type: safeText(row["meeting_type"]),
    participants: safeParticipants(row["participants"]),
    executive_summary: safeText(row["executive_summary"]),
    satisfaction_score: safeNumber(row["satisfaction_score"]),
    satisfaction_classification: safeText(row["satisfaction_classification"]),
    satisfaction_trend: safeText(row["satisfaction_trend"]),
    satisfaction_justification: safeText(row["satisfaction_justification"]),
    value_score: safeNumber(row["value_score"]),
    value_justification: safeText(row["value_justification"]),
    measurable_result: safeText(row["measurable_result"]),
    has_measurable_result: row["has_measurable_result"] === true,
    main_pain: safeText(row["main_pain"]),
    main_priority: safeText(row["main_priority"]),
    main_result: safeText(row["main_result"]),
    next_action: safeText(row["next_action"]),
    action_owner: safeText(row["action_owner"]),
    action_deadline: isValidDateString(row["action_deadline"])
      ? String(row["action_deadline"]).slice(0, 10)
      : null,
    expansion_opportunity: safeText(row["expansion_opportunity"]),
    explicit_complaint: row["explicit_complaint"] === true,
    continuity_doubt: row["continuity_doubt"] === true,
    low_client_adherence: row["low_client_adherence"] === true,
    missing_internal_owner: row["missing_internal_owner"] === true,
    calculated_risk_score: safeNumber(row["calculated_risk_score"]) ?? 0,
    calculated_risk_level: safeText(row["calculated_risk_level"]) ?? "baixo",
    analysis_risk_level: safeText(row["analysis_risk_level"]),
    analysis_quadrant: safeText(row["analysis_quadrant"]),
    import_hash: safeText(row["import_hash"]),
    created_by: safeText(row["created_by"]),
    created_at: typeof row["created_at"] === "string" ? row["created_at"] : "",
  };
}

/** Ordena por data (mais recente primeiro) tolerando datas ausentes. */
export function byMeetingDateDesc(a: { meeting_date: string }, b: { meeting_date: string }): number {
  return (b.meeting_date || "").localeCompare(a.meeting_date || "");
}


export function riskLevelFromScore(score: number): RiskLevel {
  if (score <= 2) return "baixo";
  if (score <= 5) return "médio";
  if (score <= 8) return "alto";
  return "crítico";
}

export function quadrantOf(satisfaction: number | null, value: number | null): string {
  const s = satisfaction ?? 0;
  const v = value ?? 0;
  if (s >= HIGH_THRESHOLD && v >= HIGH_THRESHOLD) return "Quadrante 1";
  if (s >= HIGH_THRESHOLD) return "Quadrante 2";
  if (v >= HIGH_THRESHOLD) return "Quadrante 3";
  return "Quadrante 4";
}

export const QUADRANT_INFO: Record<
  string,
  { title: string; readings: string[]; tone: "healthy" | "attention" | "highrisk" | "critical" }
> = {
  "Quadrante 1": {
    title: "Alta satisfação e alto valor",
    readings: ["Conta saudável", "Potencial de expansão", "Oportunidade de caso de sucesso"],
    tone: "healthy",
  },
  "Quadrante 2": {
    title: "Alta satisfação e baixo valor",
    readings: [
      "Relacionamento positivo",
      "Resultados ainda pouco comprovados",
      "Necessidade de mensuração",
    ],
    tone: "attention",
  },
  "Quadrante 3": {
    title: "Baixa satisfação e alto valor",
    readings: [
      "Entregas existentes",
      "Cliente não reconhece os resultados",
      "Necessidade de comunicação e alinhamento",
    ],
    tone: "highrisk",
  },
  "Quadrante 4": {
    title: "Baixa satisfação e baixo valor",
    readings: ["Conta em risco", "Baixa percepção de benefício", "Necessidade de intervenção"],
    tone: "critical",
  },
};

export type RiskReason = { label: string; points: number };
export type RiskComputation = { score: number; level: RiskLevel; reasons: RiskReason[] };

export type RiskSignals = {
  satisfaction: number | null;
  valueScore: number | null;
  previousSatisfactions?: number[]; // mais recente primeiro (reuniões anteriores)
  hasMeasurableResult: boolean;
  overdueActions: number;
  daysSinceLastMeeting: number | null;
  explicitComplaint: boolean;
  continuityDoubt: boolean;
  lowAdherence: boolean;
  missingInternalOwner: boolean;
};

export function pointsOf(rules: RiskRule[] | undefined, key: string, fallback: number): number {
  const rule = rules?.find((r) => r.rule_key === key);
  if (!rule) return fallback;
  return rule.active ? rule.points : 0;
}

export function computeRisk(signals: RiskSignals, rules?: RiskRule[]): RiskComputation {
  const reasons: RiskReason[] = [];
  const add = (label: string, points: number) => {
    if (points > 0) reasons.push({ label, points });
  };
  const s = signals.satisfaction;
  if (s !== null && s < 5) add("Satisfação abaixo de 5", pointsOf(rules, "satisfaction_below_5", 3));
  else if (s !== null && s <= 6) add("Satisfação entre 5 e 6", pointsOf(rules, "satisfaction_5_6", 1));

  if (signals.valueScore !== null && signals.valueScore < 5)
    add("Valor gerado abaixo de 5", pointsOf(rules, "value_below_5", 2));

  const prev = signals.previousSatisfactions ?? [];
  if (s !== null && prev.length >= 2 && s < prev[0]! && prev[0]! < prev[1]!)
    add("Queda de satisfação em duas reuniões consecutivas", pointsOf(rules, "satisfaction_drop", 2));

  if (!signals.hasMeasurableResult)
    add("Ausência de resultado mensurável", pointsOf(rules, "no_measurable_result", 1));

  if (signals.overdueActions > 0) {
    const perAction = pointsOf(rules, "overdue_action", 1);
    const total = Math.min(3, signals.overdueActions * perAction);
    add(
      `${signals.overdueActions} ${signals.overdueActions === 1 ? "ação vencida" : "ações vencidas"}`,
      total,
    );
  }

  if (signals.daysSinceLastMeeting !== null && signals.daysSinceLastMeeting > 45)
    add("Sem reunião há mais de 45 dias", pointsOf(rules, "no_recent_meeting", 2));

  if (signals.explicitComplaint) add("Reclamação explícita", pointsOf(rules, "explicit_complaint", 3));
  if (signals.continuityDoubt) add("Dúvida sobre continuidade", pointsOf(rules, "continuity_doubt", 4));
  if (signals.lowAdherence) add("Baixa adesão do cliente", pointsOf(rules, "low_adherence", 2));
  if (signals.missingInternalOwner)
    add("Ausência de responsável interno", pointsOf(rules, "missing_owner", 1));

  const score = reasons.reduce((acc, r) => acc + r.points, 0);
  return { score, level: riskLevelFromScore(score), reasons };
}

export function accountStatusFromRisk(level: RiskLevel): AccountStatus {
  if (level === "baixo") return "saudável";
  if (level === "médio") return "atenção";
  if (level === "alto") return "risco";
  return "crítico";
}

export function scoreBand(score: number | null): "0 a 4" | "5 a 6" | "7 a 8" | "9 a 10" | null {
  if (score === null) return null;
  if (score < 5) return "0 a 4";
  if (score < 7) return "5 a 6";
  if (score < 9) return "7 a 8";
  return "9 a 10";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
