import type {
  BottleneckType,
  OrchestratorAgent,
  OrchestratorState,
  ProjectStage,
  Recommendation,
} from "./types";

/* ------------------------------------------------------------------ *
 * MOTOR DETERMINÍSTICO
 *
 * As regras são avaliadas em ordem de prioridade: a primeira que dispara
 * vence e a IA NUNCA pode contrariá-la — ela apenas enriquece o texto.
 * Só quando nenhuma regra forte dispara (fallback) a IA pode escolher o
 * agente.
 * ------------------------------------------------------------------ */

export type RuleOutcome = {
  stage: ProjectStage;
  bottleneck: { type: BottleneckType; description: string };
  agent: OrchestratorAgent;
  confidence: number;
  reason: string;
  expected_result: string;
  evidence: string[];
  alternative_agent: OrchestratorAgent | null;
  alternative_reason: string | null;
  /** Regra forte: a IA não pode trocar o agente. */
  strong: boolean;
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function evaluateRules(state: OrchestratorState): RuleOutcome {
  const c = state.context;
  const a = state.actions;
  const d = state.decisions;
  const r = state.risks;
  const e = state.evolution;

  const evidenceBase = [
    `Saúde ${state.health.score}/100 (${state.health.status}), prioridade ${state.health.priority}`,
    `${plural(a.open, "ação aberta", "ações abertas")}, ${plural(a.overdue, "atrasada", "atrasadas")}`,
    `${plural(r.active, "risco ativo", "riscos ativos")}${r.critical ? ` — ${r.critical} crítico(s)` : ""}`,
  ];

  /* 1 — sem objetivo claro */
  if (!c.hasMainObjective && c.objectives === 0) {
    return {
      stage: "SEM_DIRECAO",
      bottleneck: {
        type: "SEM_OBJETIVO",
        description: "O projeto não tem objetivo principal nem critérios de sucesso registrados.",
      },
      agent: "CRITERIOS_SUCESSO",
      confidence: 0.95,
      reason:
        "Sem objetivo e sem critérios de sucesso, qualquer diagnóstico ou plano fica sem referência de resultado.",
      expected_result:
        "Objetivo principal e critérios de sucesso mensuráveis acordados com o cliente.",
      evidence: ["Nenhum objetivo registrado no contexto do projeto", ...evidenceBase],
      alternative_agent: c.problems > 0 ? "DIAGNOSTICO_EXECUTIVO" : null,
      alternative_reason:
        c.problems > 0
          ? `Há ${c.problems} problema(s) ativo(s) que já poderiam ser aprofundados em paralelo.`
          : null,
      strong: true,
    };
  }

  /* 2 — problemas ativos sem causas raiz */
  if (c.problems >= 1 && c.root_causes === 0) {
    return {
      stage: "EM_DIAGNOSTICO",
      bottleneck: {
        type: "SEM_CAUSA_RAIZ",
        description: `Existem ${c.problems} problema(s) ativo(s) sem causa raiz identificada.`,
      },
      agent: "DIAGNOSTICO_EXECUTIVO",
      confidence: 0.9,
      reason:
        "Atacar problemas sem causa raiz mapeada produz solução de sintoma e retrabalho na implantação.",
      expected_result: "Causas raiz documentadas e validadas para os problemas ativos.",
      evidence: [
        `${plural(c.problems, "problema ativo", "problemas ativos")} sem causa raiz registrada`,
        ...evidenceBase,
      ],
      alternative_agent: c.problems >= 3 ? "PARETO_ORDEM_ATAQUE" : null,
      alternative_reason:
        c.problems >= 3
          ? "Volume alto de problemas: priorizar antes pode reduzir o esforço de diagnóstico."
          : null,
      strong: true,
    };
  }

  /* 3 — muitos problemas sem priorização */
  if (c.problems >= 3 && c.priorities === 0) {
    return {
      stage: "AGUARDANDO_PRIORIZACAO",
      bottleneck: {
        type: "SEM_PRIORIZACAO",
        description: `${c.problems} problemas mapeados e nenhuma prioridade definida.`,
      },
      agent: "PARETO_ORDEM_ATAQUE",
      confidence: 0.9,
      reason:
        "Com muitos problemas e nenhuma ordem de ataque, o time dispersa esforço e nenhum resultado fecha.",
      expected_result: "Ordem de ataque priorizada pelos poucos problemas de maior impacto.",
      evidence: [
        `${c.problems} problemas ativos e 0 prioridades definidas`,
        `${c.root_causes} causa(s) raiz mapeada(s)`,
        ...evidenceBase,
      ],
      alternative_agent: "DIAGNOSTICO_EXECUTIVO",
      alternative_reason: "Aprofundar o diagnóstico caso as causas mapeadas ainda sejam frágeis.",
      strong: true,
    };
  }

  /* 4 — prioridade definida sem solução estruturada */
  const hasSolution = d.approved + d.inProgress + d.implemented > 0 || c.next_steps > 0;
  if (c.priorities > 0 && !hasSolution) {
    return {
      stage: "SOLUCAO_DEFINIDA",
      bottleneck: {
        type: "SEM_SOLUCAO",
        description: "Prioridades definidas, mas sem solução consultiva estruturada.",
      },
      agent: "ENTREGA_CONSULTIVA",
      confidence: 0.85,
      reason:
        "As prioridades já estão claras; falta transformar a prioridade em entrega consultiva com escopo e desenho de solução.",
      expected_result: "Solução estruturada e aceita para a prioridade número um.",
      evidence: [
        `${plural(c.priorities, "prioridade definida", "prioridades definidas")}`,
        "Nenhuma decisão aprovada e nenhum próximo passo registrado",
        ...evidenceBase,
      ],
      alternative_agent: "PARETO_ORDEM_ATAQUE",
      alternative_reason: "Revalidar a ordem de ataque se as prioridades estiverem desatualizadas.",
      strong: true,
    };
  }

  /* 5 — solução definida sem execução */
  if (d.approved + d.inProgress > 0 && a.open === 0 && a.total === 0) {
    return {
      stage: "EM_IMPLANTACAO",
      bottleneck: {
        type: "SEM_EXECUCAO",
        description: "Decisões aprovadas sem nenhum plano de ação em execução.",
      },
      agent: "IMPLANTACAO_CONSULTIVA",
      confidence: 0.85,
      reason:
        "Decisão aprovada sem plano de ação não vira resultado; é preciso desdobrar em responsáveis e prazos.",
      expected_result: "Plano de implantação com responsáveis, prazos e marcos acordados.",
      evidence: [
        `${d.approved + d.inProgress} decisão(ões) aprovada(s) ou em execução`,
        "Nenhuma ação registrada no projeto",
        ...evidenceBase,
      ],
      alternative_agent: "ENTREGA_CONSULTIVA",
      alternative_reason: "Refinar a solução caso a decisão ainda não tenha escopo suficiente.",
      strong: true,
    };
  }

  /* 6 — plano existente travado */
  const stuckSignals: string[] = [];
  if (a.overdue > 0) stuckSignals.push(`${plural(a.overdue, "ação atrasada", "ações atrasadas")}`);
  if (a.blocked > 0) stuckSignals.push(`${plural(a.blocked, "ação bloqueada", "ações bloqueadas")}`);
  if (e?.blocked) stuckSignals.push(`${e.blocked} item(ns) bloqueado(s) na última evolução`);
  if (e?.delayed) stuckSignals.push(`${e.delayed} item(ns) atrasado(s) na última evolução`);
  if (e?.regressed) stuckSignals.push(`${e.regressed} item(ns) em regressão`);
  if (e?.movement === "travado" || e?.movement === "regredindo")
    stuckSignals.push(`Movimento do projeto: ${e.movement}`);
  if (r.critical > 0) stuckSignals.push(`${plural(r.critical, "risco crítico", "riscos críticos")} ativo(s)`);
  if (state.health.status === "risco" || state.health.status === "crítico")
    stuckSignals.push(`Saúde consultiva em ${state.health.status}`);

  if (stuckSignals.length > 0) {
    return {
      stage: "TRAVADO",
      bottleneck: {
        type: "EXECUCAO_TRAVADA",
        description: "O plano existe, mas a execução está atrasada, bloqueada ou em regressão.",
      },
      agent: "CONTINUIDADE_GERENCIAL",
      confidence: 0.9,
      reason:
        "Os sinais de execução mostram atraso, bloqueio ou perda de ritmo — a atuação agora é destravar e retomar a cadência.",
      expected_result: "Bloqueios removidos, prazos repactuados e cadência de acompanhamento retomada.",
      evidence: [...stuckSignals, ...state.health.topReasons.slice(0, 2)],
      alternative_agent: r.critical > 0 ? "DIAGNOSTICO_EXECUTIVO" : "IMPLANTACAO_CONSULTIVA",
      alternative_reason:
        r.critical > 0
          ? "Riscos críticos ativos podem exigir um novo diagnóstico focado."
          : "Se o bloqueio for de escopo, reestruturar a implantação pode ser mais eficaz.",
      strong: true,
    };
  }

  /* 7 — aguardando validação */
  const awaitingValidation =
    (d.implemented > 0 || (a.total > 0 && a.open === 0)) && c.results === 0;
  if (awaitingValidation) {
    return {
      stage: "EM_VALIDACAO",
      bottleneck: {
        type: "SEM_VALIDACAO",
        description: "Entregas concluídas sem resultado validado e registrado.",
      },
      agent: "AUDITOR_QUALIDADE",
      confidence: 0.8,
      reason:
        "A execução terminou, mas nenhum resultado foi validado — sem auditoria não há prova de valor entregue.",
      expected_result: "Resultados auditados, evidenciados e aceitos formalmente pelo cliente.",
      evidence: [
        d.implemented > 0
          ? `${plural(d.implemented, "decisão implementada", "decisões implementadas")}`
          : "Todas as ações do projeto concluídas",
        "Nenhum resultado alcançado registrado no contexto",
        ...evidenceBase,
      ],
      alternative_agent: "CONTINUIDADE_GERENCIAL",
      alternative_reason: "Manter a cadência gerencial enquanto os resultados não são medidos.",
      strong: true,
    };
  }

  /* fallback — nenhuma regra forte: espaço para a IA */
  return {
    stage: "EM_ACOMPANHAMENTO",
    bottleneck: {
      type: "INDEFINIDO",
      description: "Nenhum gargalo estrutural evidente; o projeto está em acompanhamento regular.",
    },
    agent: "CONTINUIDADE_GERENCIAL",
    confidence: 0.5,
    reason:
      "O projeto segue em ritmo normal, sem gargalo determinístico dominante. A atuação padrão é sustentar a cadência.",
    expected_result: "Cadência mantida e próximos passos confirmados com o cliente.",
    evidence: evidenceBase,
    alternative_agent: c.results > 0 ? "AUDITOR_QUALIDADE" : null,
    alternative_reason:
      c.results > 0 ? "Há resultados registrados que podem ser auditados e formalizados." : null,
    strong: false,
  };
}

export function toRecommendation(outcome: RuleOutcome): Recommendation {
  return {
    project_stage: outcome.stage,
    main_bottleneck: outcome.bottleneck,
    recommended_agent: outcome.agent,
    confidence: outcome.confidence,
    reason: outcome.reason,
    expected_result: outcome.expected_result,
    evidence: outcome.evidence.filter(Boolean),
    alternative_agent: outcome.alternative_agent,
    alternative_reason: outcome.alternative_reason,
    erp_classification: { area: null, process: null },
  };
}
