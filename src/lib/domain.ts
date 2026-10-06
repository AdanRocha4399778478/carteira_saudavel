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

/**
 * Taxonomia ERP completa (macro-área + subárea), extraída do mapeamento de
 * processos da consultoria. Usada pelo controle de horas (time_entries) para
 * classificar onde o tempo do consultor foi alocado — separada de ERP_AREAS
 * acima, que continua sendo a classificação simples usada em Ações/Reuniões.
 * As duas podem ser unificadas depois, se fizer sentido.
 */
export const ERP_TAXONOMY: Record<string, readonly string[]> = {
  "Pessoas": ["Recrutamento e Seleção", "Integração (Onboarding)", "Gestão de Benefícios", "Folha de Pagamento e Controle de Frequência", "Treinamento e Desenvolvimento", "Desenvolvimento Organizacional", "Gestão de Conflitos", "Cultura Organizacional", "Estrutura de Cargos e Planos de Carreira", "Retenção de Talentos", "Outros"],
  "Comercial": ["Gestão de Pipeline", "Planejamento Estratégico de Vendas", "Prospecção de Clientes", "Atendimento ao Cliente", "Negociação e Fechamento", "Gestão de Carteira de Clientes", "Treinamento de Vendas e Gestão de Equipe", "Gestão de Relacionamento com o Cliente (CRM)", "Gestão de Preços e Propostas", "Análise de Desempenho", "Outros"],
  "Operações": ["Planejamento Operacional", "Gestão de Produção", "Gestão de Estoque", "Gestão de Fornecedores", "Manutenção de Equipamentos", "Gestão de Processos", "Entrega de Produtos e Serviços", "Controle de Custos", "Gestão de Segurança e Meio Ambiente", "Controle de Qualidade, Capacidade e Inovação Operacional", "Outros"],
  "Marketing": ["Planejamento de Estratégia", "Criação de Conteúdo", "Marketing Digital", "Gestão da Marca (Branding)", "Pesquisa de Mercado", "Marketing Offline", "Publicidade e Promoções", "Gestão de Orçamentos", "Gestão de Parcerias", "Outros"],
  "Financeiro": ["Fluxo de Caixa", "Contas a Pagar", "Contas a Receber", "Conciliação Bancária", "Orçamento", "Análise Financeira", "Investimentos", "Tributos e Obrigações Fiscais", "Contabilidade Gerencial", "Dívidas e Financiamentos", "Outros"],
  "Estratégia": ["Gestão de Implementação", "Análise de Mercado e Concorrência", "Planejamento Estratégico", "Análise Financeira", "Expansão e Novos Mercados", "Gestão de Iniciativas e Portfólio", "Propostas de Valor", "Cultura Organizacional Alinhada", "Análise de Desempenho", "Gestão de Riscos", "Inovação de Estratégia e Pensamento Disruptivo", "Outros"],
  "Inovação e Pesquisas": ["Parcerias com Instituições de Pesquisa", "Gestão de Propriedade Intelectual", "Captação de Recursos para Inovação", "Monitoramento e Avaliação de Resultados", "Sustentabilidade e Inovação Social", "Implementação de Tecnologias Disruptivas", "Análise de Viabilidade e Retorno sobre Investimento", "Inovação de Modelos de Negócio", "Outros"],
  "Jurídica": ["Assessoria e Consultoria", "Gestão de Contratos", "Gestão de Contencioso e Processos Judiciais", "Compliance e Conformidade Legal", "Gestão de Riscos Legais", "Direito Trabalhista e Relações com Colaboradores", "Direito Tributário e Fiscal", "Direito Ambiental", "Elaboração e Revisão de Políticas Internas", "Mediação e Arbitragem", "Licitação e Contratos Públicos", "Proteção de Dados e Privacidade", "Treinamento e Capacitação Jurídica", "Outros"],
  "Logística e Suprimentos": ["Automatização e Sistemas de Gestão", "Gestão de Riscos Logísticos", "Análise e Otimização de Processos Logísticos", "Compliance e Normas Regulatórias", "Parcerias Logísticas", "Sustentabilidade e Responsabilidade Ambiental", "Coordenação entre Setores", "Monitoramento e Gestão de Desempenho", "Outros"],
  "Projetos": ["Planejamento de Projetos", "Gerenciamento de Recursos", "Execução e Acompanhamento", "Gestão de Riscos", "Controle de Qualidade", "Gestão de Escopo e Mudanças", "Ferramentas e Metodologias de Gerenciamento", "Gerenciamento de Stakeholders", "Outros"],
  "Qualidade": ["Implementação de Sistemas de Gestão da Qualidade", "Controle de Qualidade de Produtos e Serviços", "Gestão de Melhoria Contínua", "Treinamento e Capacitação", "Gestão de Reclamações e Satisfação do Cliente", "Padronização e Documentação", "Auditorias de Qualidade", "Sustentabilidade e Qualidade", "Análise de Custo da Qualidade", "Segurança e Qualidade no Trabalho", "Inovação e Qualidade", "Outros"],
  "Sustentabilidade": ["Sustentabilidade nos Suprimentos", "Inovação e Eficiência Energética", "Compliance e Conformidade Ambiental", "Gestão de Impactos Ambientais", "Desenvolvimento de Políticas Sustentáveis", "Relatório de Sustentabilidade", "Economia Circular", "Educação e Conscientização Ambiental", "Sustentabilidade Financeira", "Engajamento com Clientes", "Inovação Sustentável", "Atuação em Redes e Certificações", "Outros"],
  "Tecnologia da Informação": ["Gestão de Software e Aplicações", "Segurança da Informação", "Gestão de Infraestrutura de TI", "Suporte Técnico e Help Desk", "Automação de Processos", "Gestão de Sistemas em Nuvem", "Desenvolvimento e Manutenção de Sites", "Gestão de Redes e Conectividade", "Compliance e Normas de TI", "Gestão de Telecomunicações", "Planejamento e Gestão de Projetos de TI", "Suporte e Inovação Tecnológica", "Gestão de Orçamentos de TI", "Gestão de Contratos e Fornecedores de TI", "Gestão de Comunicação Interna", "Monitoramento e Análise de Desempenho de Sistemas", "Outros"],
  "Administrativo": ["Documentos e Arquivos", "Gestão de Contratos e Fornecedores", "Gestão de Infraestrutura e Patrimônio", "Gestão de Compras de Materiais", "Comunicação Interna", "Compliance Administrativo", "Controle de Ativos e Inventário", "Controle de Serviços Terceirizados", "Relatórios Administrativos", "Outros"],
} as const;

export const ERP_MACRO_AREAS = Object.keys(ERP_TAXONOMY) as (keyof typeof ERP_TAXONOMY)[];

export const DEFAULT_HOURLY_RATE_CENTS = 10_000; // R$ 100,00

export type TimeEntry = {
  id: string;
  client_id: string;
  project_id: string | null;
  consultant_id: string;
  erp_area: string;
  erp_subarea: string | null;
  description: string | null;
  started_at: string;
  ended_at: string | null;
  hourly_rate_cents: number;
  duration_seconds: number | null;
  amount_cents: number | null;
  created_at: string;
  updated_at: string;
};
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
  /** Projeto ao qual esta reunião está vinculada — null quando ainda não associada. */
  project_id: string | null;
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
  /** Autoavaliação da consultoria (sem IA) — ver computeDeliveryClarity. 0-100, null quando não calculável (sem ações/contexto). */
  delivery_clarity_rate: number | null;
  commitment_conversion_rate: number | null;
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
  /** Ação contínua/recorrente, sem prazo de entrega única — ver isOverdue. Só manual, nunca inferido pela IA. */
  is_recurring: boolean;
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

export function isOverdue(
  action: Pick<ActionItem, "deadline" | "status"> & Partial<Pick<ActionItem, "is_recurring">>,
): boolean {
  if (!action.deadline) return false;
  if (action.status === "concluída") return false;
  if (action.is_recurring) return false;
  return new Date(action.deadline) < startOfToday();
}

const OVERDUE_DECISION_STATUSES = ["pendente", "aprovada", "em_execucao"];

/** due_date é `date` no banco: compara só o dia, sem new Date(due_date), que o leria como UTC. */
export function isDecisionOverdue(decision: { due_date: string | null; status: string }): boolean {
  if (!decision.due_date) return false;
  if (!OVERDUE_DECISION_STATUSES.includes(decision.status)) return false;
  const day = decision.due_date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const today = startOfToday();
  const pad = (n: number) => String(n).padStart(2, "0");
  return day < `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
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
    project_id: safeText(row["project_id"]),
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
    delivery_clarity_rate: safeNumber(row["delivery_clarity_rate"]),
    commitment_conversion_rate: safeNumber(row["commitment_conversion_rate"]),
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

export type DeliveryClarityMetric = {
  /** 0-100 arredondado; null quando o denominador é zero (nada para medir ainda). */
  rate: number | null;
  numerator: number;
  denominator: number;
  label: string;
};

/** Mesma métrica, mas com os itens de verdade por trás do numerador/denominador — para o consultor auditar, não só confiar no percentual. */
export type AuditableDeliveryClarityMetric = DeliveryClarityMetric & {
  numeratorItems: string[];
  denominatorItems: string[];
};

export type DeliveryClarity = {
  actionCompletenessRate: DeliveryClarityMetric;
  commitmentConversionRate: AuditableDeliveryClarityMetric;
};

/**
 * Autoavaliação da consultoria sobre a própria reunião (não do cliente):
 * o quanto o que foi discutido virou encaminhamento claro, com responsável
 * e prazo. Pura e sem IA — calculada a partir das decisões/ações/itens de
 * contexto já extraídos, antes ou depois da aprovação.
 */
export function computeDeliveryClarity(input: {
  actions: { owner_name: string | null; deadline: string | null; description: string }[];
  decisions: { title: string }[];
  contextItems: string[];
}): DeliveryClarity {
  const totalActions = input.actions.length;
  const completeActions = input.actions.filter(
    (a) => !!a.owner_name?.trim() && !!a.deadline,
  ).length;
  const completionPct = totalActions === 0 ? null : Math.round((completeActions / totalActions) * 100);
  const actionCompletenessRate: DeliveryClarityMetric = {
    rate: completionPct,
    numerator: completeActions,
    denominator: totalActions,
    label:
      totalActions === 0
        ? "Nenhuma ação extraída nesta reunião."
        : `${completeActions} de ${totalActions} ${totalActions === 1 ? "ação" : "ações"} com responsável e prazo — ${completionPct}%`,
  };

  const numeratorItems = [
    ...input.decisions.map((d) => d.title),
    ...input.actions.map((a) => a.description),
  ];
  const commitments = numeratorItems.length;
  const context = input.contextItems.length;
  const conversionPct = context === 0 ? null : Math.round((commitments / context) * 100);
  const commitmentConversionRate: AuditableDeliveryClarityMetric = {
    rate: conversionPct,
    numerator: commitments,
    denominator: context,
    label:
      context === 0
        ? "Nenhum item de contexto registrado nesta reunião."
        : `${commitments} ${commitments === 1 ? "compromisso" : "compromissos"} para ${context} ${context === 1 ? "ponto discutido" : "pontos discutidos"} — ${conversionPct}%`,
    numeratorItems,
    denominatorItems: input.contextItems,
  };

  return { actionCompletenessRate, commitmentConversionRate };
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
