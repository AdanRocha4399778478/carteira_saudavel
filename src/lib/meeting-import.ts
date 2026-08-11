import { z } from "zod";
import {
  computeRisk,
  daysBetween,
  type RiskComputation,
  type RiskRule,
} from "./domain";

/* ------------------------------------------------------------------ *
 * Schema oficial único da importação de reuniões.
 * Qualquer consumidor (importador, prévia, gravação) usa este módulo.
 * ------------------------------------------------------------------ */

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "possui formato inválido (use AAAA-MM-DD)")
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00`).getTime()), "possui data inexistente");

const text = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    const t = typeof v === "string" ? v.trim() : "";
    return t.length ? t : null;
  });

const nota = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : v),
    z.union([
      z
        .number({ invalid_type_error: "deve ser um número entre 0 e 10" })
        .min(0, "deve estar entre 0 e 10")
        .max(10, "deve estar entre 0 e 10"),
      z.null(),
    ]),
  )
  .optional()
  .transform((v) => (typeof v === "number" ? v : null));

const optionalDate = z
  .union([isoDate, z.null()])
  .optional()
  .transform((v) => (typeof v === "string" ? v : null));

const stringList = z
  .union([z.array(z.string()), z.null()])
  .optional()
  .transform((v) => (Array.isArray(v) ? v.map((s) => s.trim()).filter(Boolean) : []));

/** Aceita ["texto"] ou [{ descricao/description/texto: "…" }] — nada é descartado em silêncio. */
const describedList = z.preprocess((v) => {
  if (!Array.isArray(v)) return v;
  return v.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const label = o["descricao"] ?? o["description"] ?? o["texto"] ?? o["risco"] ?? o["oportunidade"];
      return typeof label === "string" ? label : "";
    }
    return "";
  });
}, stringList);

const bool = z
  .union([z.boolean(), z.null()])
  .optional()
  .transform((v) => v === true);


const baseSchema = z.object({
  empresa: z.string({ required_error: "é obrigatório" }).trim().min(1, "é obrigatório"),
  data_reuniao: isoDate,
  participantes: stringList,
  tipo_reuniao: text,
  resumo_executivo: text,
  satisfacao: z
    .object({
      nota: nota,
      classificacao: text,
      tendencia: text,
      justificativa: text,
    })
    .nullish()
    .transform((v) => v ?? { nota: null, classificacao: null, tendencia: null, justificativa: null }),
  valor_gerado: z
    .object({
      nota: nota,
      justificativa: text,
      principal_beneficio: text,
      resultado_mensuravel: text,
      valor_nao_comprovado: text,
    })
    .nullish()
    .transform(
      (v) =>
        v ?? {
          nota: null,
          justificativa: null,
          principal_beneficio: null,
          resultado_mensuravel: null,
          valor_nao_comprovado: null,
        },
    ),
  matriz_satisfacao_valor: z
    .object({ quadrante: text, risco_conta: text, proxima_acao: text })
    .nullish()
    .transform((v) => v ?? { quadrante: null, risco_conta: null, proxima_acao: null }),
  riscos: describedList,
  oportunidades: describedList,
  sinais_risco: z
    .object({
      reclamacao_explicita: bool,
      duvida_continuidade: bool,
      baixa_adesao: bool,
      ausencia_responsavel_interno: bool,
    })
    .nullish()
    .transform(
      (v) =>
        v ?? {
          reclamacao_explicita: false,
          duvida_continuidade: false,
          baixa_adesao: false,
          ausencia_responsavel_interno: false,
        },
    ),
  dores_prioridades_resultados: z
    .object({ principal_dor: text, principal_prioridade: text, principal_resultado: text })
    .nullish()
    .transform(
      (v) => v ?? { principal_dor: null, principal_prioridade: null, principal_resultado: null },
    ),

  plano_acao: z.preprocess(
    (v) => {
      if (!Array.isArray(v)) return v;
      // Aceita { acao } ou { descricao } — nenhuma ação é ignorada.
      return v.map((item) => {
        if (!item || typeof item !== "object") return item;
        const o = { ...(item as Record<string, unknown>) };
        if (o["acao"] === undefined) o["acao"] = o["descricao"] ?? o["description"];
        if (o["responsavel"] === undefined) o["responsavel"] = o["owner"] ?? o["dono"];
        return o;
      });
    },
    z
      .union([
        z.array(
          z.object({
            acao: z.string({ required_error: "é obrigatório" }).trim().min(1, "é obrigatório"),
            responsavel: text,
            prazo: optionalDate,
            prioridade: text,
            status: text,
            area_erp: text,
          }),
        ),
        z.null(),
      ])
      .optional()
      .transform((v) => v ?? []),
  ),

  crm: z
    .object({
      status_conta: text,
      principal_dor: text,
      principal_prioridade: text,
      principal_resultado: text,
      principal_risco: text,
      proxima_acao: text,
      responsavel: text,
      prazo: optionalDate,
      oportunidade_expansao: text,
      intervencao_lideranca: z
        .union([z.boolean(), z.null()])
        .optional()
        .transform((v) => v === true),
    })
    .nullish()
    .transform(
      (v) =>
        v ?? {
          status_conta: null,
          principal_dor: null,
          principal_prioridade: null,
          principal_resultado: null,
          principal_risco: null,
          proxima_acao: null,
          responsavel: null,
          prazo: null,
          oportunidade_expansao: null,
          intervencao_lideranca: false,
        },
    ),
});

/**
 * Normaliza apelidos comuns do JSON da análise antes da validação, para que
 * variações de nome não descartem ações, riscos ou oportunidades.
 */
export const meetingImportSchema = z.preprocess((v) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const o = { ...(v as Record<string, unknown>) };
  if (o["plano_acao"] === undefined) o["plano_acao"] = o["acoes"] ?? o["plano_de_acao"];
  if (o["data_reuniao"] === undefined) o["data_reuniao"] = o["data"];
  if (o["empresa"] === undefined) o["empresa"] = o["cliente"] ?? o["nome_empresa"];
  return o;
}, baseSchema);


export type MeetingImportPayload = z.infer<typeof meetingImportSchema>;

export const IMPORT_TEMPLATE = JSON.stringify(
  {
    empresa: "Empresa Exemplo",
    data_reuniao: "2026-07-20",
    participantes: ["Empresário", "Consultor"],
    tipo_reuniao: "acompanhamento",
    resumo_executivo: "Resumo da reunião",
    satisfacao: {
      nota: 6,
      classificacao: "neutro",
      tendencia: "estável",
      justificativa: "Justificativa",
    },
    valor_gerado: {
      nota: 5,
      justificativa: "Justificativa",
      principal_beneficio: "Maior clareza financeira",
      resultado_mensuravel: null,
      valor_nao_comprovado: "Melhoria efetiva do caixa",
    },
    matriz_satisfacao_valor: {
      quadrante: "Quadrante 4",
      risco_conta: "médio",
      proxima_acao: "Implantar controle financeiro",
    },
    riscos: ["Baixa execução das ações"],
    oportunidades: ["Implantar fluxo de caixa"],
    plano_acao: [
      {
        acao: "Criar fluxo de caixa",
        responsavel: "Cliente",
        prazo: "2026-08-15",
        prioridade: "alta",
        status: "não iniciada",
        area_erp: "Financeiro",
      },
    ],
    crm: {
      status_conta: "atenção",
      principal_dor: "Falta de caixa",
      principal_prioridade: "Controlar retiradas",
      principal_resultado: "Maior clareza financeira",
      principal_risco: "Não executar o plano",
      proxima_acao: "Projetar o caixa",
      responsavel: "Cliente e consultor",
      prazo: "2026-08-15",
      oportunidade_expansao: "Integração entre financeiro e comercial",
      intervencao_lideranca: false,
    },
  },
  null,
  2,
);

/** "plano_acao[1].acao é obrigatório" — caminho exato do campo inválido. */
export function formatIssuePath(path: (string | number)[]): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === "number") return `${acc}[${part}]`;
    return acc ? `${acc}.${part}` : part;
  }, "");
}

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = formatIssuePath(issue.path);
    const message =
      issue.code === "invalid_type" && issue.received === "undefined" ? "é obrigatório" : issue.message;
    return path ? `${path} ${message}` : message;
  });
}

export type ParseResult =
  | { ok: true; payload: MeetingImportPayload }
  | { ok: false; errors: string[] };

export function parseImportJson(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      errors: [`JSON malformado: ${e instanceof Error ? e.message : "estrutura inválida"}`],
    };
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, errors: ["O conteúdo precisa ser um objeto JSON com o formato oficial."] };
  }
  const parsed = meetingImportSchema.safeParse(json);
  if (!parsed.success) return { ok: false, errors: formatZodIssues(parsed.error) };
  return { ok: true, payload: parsed.data };
}

/* ---------------- plano de gravação ---------------- */

export type ImportPlan = {
  meeting: Record<string, unknown>;
  actions: Record<string, unknown>[];
  risks: Record<string, unknown>[];
  opportunities: Record<string, unknown>[];
  risk: RiskComputation;
  importHash: string;
  warnings: string[];
};

/** Hash estável do conteúdo relevante — usado só para detectar reimportação. */
export function importHashOf(payload: MeetingImportPayload): string {
  const canonical = JSON.stringify([
    payload.empresa.trim().toLowerCase(),
    payload.data_reuniao,
    payload.resumo_executivo ?? "",
    payload.satisfacao.nota,
    payload.valor_gerado.nota,
    payload.plano_acao.map((a) => a.acao),
    payload.riscos,
    payload.oportunidades,
  ]);
  let h = 5381;
  for (let i = 0; i < canonical.length; i += 1) h = ((h << 5) + h + canonical.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(16)}${canonical.length.toString(16)}`;
}

export function buildImportPlan(
  payload: MeetingImportPayload,
  ctx: {
    clientId: string;
    riskRules: RiskRule[];
    /** Reuniões anteriores do cliente, mais recente primeiro. */
    previousMeetingDates: string[];
    previousSatisfactions: number[];
    overdueActions: number;
  },
): ImportPlan {
  const warnings: string[] = [];
  const satisfaction = payload.satisfacao.nota;
  const valueScore = payload.valor_gerado.nota;
  if (satisfaction === null) warnings.push("satisfacao.nota não foi informada — será gravada como “Não identificado”.");
  if (valueScore === null) warnings.push("valor_gerado.nota não foi informada — será gravada como “Não identificado”.");

  // Somente resultado_mensuravel conta como resultado mensurável.
  const measurable = payload.valor_gerado.resultado_mensuravel;
  if (!measurable && payload.valor_gerado.principal_beneficio) {
    warnings.push(
      "Há benefício percebido, mas nenhum resultado mensurável — a reunião soma pontos de risco.",
    );
  }

  // Regra dos 45 dias: distância até a reunião imediatamente anterior, não até hoje.
  const previousDate = ctx.previousMeetingDates.find((d) => d < payload.data_reuniao) ?? null;
  const gap = daysBetween(previousDate, payload.data_reuniao);

  const signals = payload.sinais_risco;
  const explicitComplaint =
    signals.reclamacao_explicita ||
    (payload.satisfacao.classificacao ?? "").toLowerCase().includes("insatisf");
  const continuityDoubt =
    signals.duvida_continuidade ||
    (payload.crm.principal_risco ?? "").toLowerCase().includes("cancel");
  const lowAdherence =
    signals.baixa_adesao ||
    `${payload.riscos.join(" ")} ${payload.crm.principal_risco ?? ""}`.toLowerCase().includes("execu");
  const missingInternalOwner =
    signals.ausencia_responsavel_interno ||
    (!payload.crm.responsavel && !payload.plano_acao.some((a) => a.responsavel));

  const risk = computeRisk(
    {
      satisfaction,
      valueScore,
      previousSatisfactions: ctx.previousSatisfactions,
      hasMeasurableResult: !!measurable,
      overdueActions: ctx.overdueActions,
      daysSinceLastMeeting: gap,
      explicitComplaint,
      continuityDoubt,
      lowAdherence,
      missingInternalOwner,
    },
    ctx.riskRules,
  );


  const nextAction = payload.crm.proxima_acao ?? payload.matriz_satisfacao_valor.proxima_acao;

  const meeting: Record<string, unknown> = {
    client_id: ctx.clientId,
    meeting_date: payload.data_reuniao,
    meeting_type: payload.tipo_reuniao ?? "acompanhamento",
    participants: payload.participantes,
    executive_summary: payload.resumo_executivo,
    satisfaction_score: satisfaction,
    satisfaction_classification: payload.satisfacao.classificacao,
    satisfaction_trend: payload.satisfacao.tendencia,
    satisfaction_justification: payload.satisfacao.justificativa,
    value_score: valueScore,
    value_justification: payload.valor_gerado.justificativa,
    measurable_result: measurable,
    has_measurable_result: !!measurable,
    main_pain: payload.crm.principal_dor ?? payload.dores_prioridades_resultados.principal_dor,
    main_priority:
      payload.crm.principal_prioridade ??
      payload.dores_prioridades_resultados.principal_prioridade,
    main_result:
      payload.crm.principal_resultado ??
      payload.dores_prioridades_resultados.principal_resultado ??
      payload.valor_gerado.principal_beneficio,
    next_action: nextAction,
    action_owner: payload.crm.responsavel,
    action_deadline: payload.crm.prazo,
    expansion_opportunity: payload.crm.oportunidade_expansao,
    explicit_complaint: explicitComplaint,
    continuity_doubt: continuityDoubt,
    low_client_adherence: lowAdherence,
    missing_internal_owner: missingInternalOwner,

    calculated_risk_score: risk.score,
    calculated_risk_level: risk.level,
    analysis_risk_level: payload.matriz_satisfacao_valor.risco_conta,
    analysis_quadrant: payload.matriz_satisfacao_valor.quadrante,
    import_hash: importHashOf(payload),
  };

  const actions = payload.plano_acao.map((a) => ({
    description: a.acao,
    owner_name: a.responsavel,
    deadline: a.prazo,
    priority: a.prioridade ?? (risk.level === "baixo" ? "média" : "alta"),
    status: a.status ?? "não iniciada",
    erp_area: a.area_erp,
  }));

  const riskDescriptions = [...payload.riscos];
  if (payload.crm.principal_risco && !riskDescriptions.includes(payload.crm.principal_risco))
    riskDescriptions.push(payload.crm.principal_risco);

  const risks = riskDescriptions.map((description) => ({
    description,
    level: payload.matriz_satisfacao_valor.risco_conta ?? risk.level,
  }));

  const opportunityDescriptions = [...payload.oportunidades];
  if (
    payload.crm.oportunidade_expansao &&
    !opportunityDescriptions.includes(payload.crm.oportunidade_expansao)
  )
    opportunityDescriptions.push(payload.crm.oportunidade_expansao);

  const opportunities = opportunityDescriptions.map((description) => ({
    description,
    expected_benefit: payload.valor_gerado.principal_beneficio,
    status: "aberta",
  }));

  return { meeting, actions, risks, opportunities, risk, importHash: importHashOf(payload), warnings };
}
