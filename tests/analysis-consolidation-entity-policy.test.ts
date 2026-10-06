import { describe, expect, test } from "bun:test";
import {
  consolidateAnalysisSemantically,
  meetsConsolidationPolicy,
  semanticConsolidationPolicy,
} from "../src/lib/analysis-consolidation";

/* ------------------------------------------------------------------ *
 * Consolidação SEMÂNTICA DESLIGADA para actions/decisions/risks/
 * opportunities — decisão do dono após medição real (ver Gate 3): o
 * índice lexical entre tarefas DIFERENTES do mesmo responsável vai de
 * 0.11 a 0.42, no mesmo intervalo das duplicatas reais — não existe piso
 * lexical seguro para separar as duas coisas nestas 4 categorias. Só
 * texto IDÊNTICO se funde (etapa `consolidate()`, inalterada).
 *
 * Embeddings sintéticos — sem chamada de rede/IA. `unit(0)` reaproveitado
 * para TODOS os itens de um teste quando o objetivo é simular cosseno
 * máximo (1.0, o maior valor possível) entre eles: se nem cosseno=1 funde
 * para estas categorias, nenhum cosseno funde.
 * ------------------------------------------------------------------ */

const DIM = 4;
function unit(dim: number): number[] {
  const v = new Array(DIM).fill(0);
  v[dim] = 1;
  return v;
}

function emptyContextUpdates() {
  return {
    objectives: [],
    problems: [],
    root_causes: [],
    priorities: [],
    hypotheses: [],
    constraints: [],
    results: [],
    next_steps: [],
  };
}

/* Frases REAIS do incidente (mesmo responsável, tarefas diferentes). */
const A =
  "Elias deve levantar e detalhar os ativos circulantes e passivos não circulantes, incluindo valores e datas de aquisição.";
const B1 = "Elias deve enviar os extratos dos meses 6 e 7 para análise e validação da DRE";
const B2 =
  "Elias deve organizar e enviar informações detalhadas sobre despesas no cartão para melhor categorização";
const B3 =
  "Elias deve enviar documentos e informações sobre contratos de financiamento e parcelas restantes";
const C =
  "Adan Rocha fará análise e ajuste da classificação das despesas fixas e variáveis com base nas informações enviadas.";
const D = "Adan Rocha enviará planilha para Elias detalhar os ativos para cálculo da depreciação";
const INCIDENT_TEXTS = [A, B1, B2, B3, C, D];

describe("ENTITY_POLICY — política nunca funde (meetsConsolidationPolicy)", () => {
  test("actions/decisions/risks/opportunities: mesmo com lexical=1 e combined=1 (o máximo possível), nunca funde", () => {
    for (const cat of ["actions", "decisions", "risks", "opportunities"]) {
      const policy = semanticConsolidationPolicy(cat);
      expect(meetsConsolidationPolicy(1, 1, policy)).toBe(false);
    }
  });

  test("next_steps continua semantic-only (EXECUTION_POLICY, pré-promoção)", () => {
    expect(semanticConsolidationPolicy("next_steps").allowSemanticOnly).toBe(true);
    expect(meetsConsolidationPolicy(0.01, 0.65, semanticConsolidationPolicy("next_steps"))).toBe(
      true,
    );
  });

  test("priorities (STRATEGIC_POLICY) continua com lexicalFloor 0.2, inalterada", () => {
    const policy = semanticConsolidationPolicy("priorities");
    expect(policy.allowSemanticOnly).toBe(false);
    expect(policy.lexicalFloor).toBe(0.2);
  });
});

describe("ENTITY_POLICY — reprodução do incidente com frases reais: nenhuma fusão, mesmo com cosseno máximo", () => {
  function buildEntityRaw(
    category: "actions" | "decisions" | "risks" | "opportunities",
    texts: string[],
  ) {
    const items = texts.map((text) => {
      const embedding = unit(0); // cosseno = 1 entre todos os itens: o maior valor possível
      if (category === "decisions")
        return {
          title: text,
          reason: "",
          owner: "",
          due_date: "",
          classification: "fact",
          embedding,
        };
      return { description: text, classification: "fact", embedding };
    });
    return {
      identification: {},
      analysis: {
        context_updates: emptyContextUpdates(),
        decisions: category === "decisions" ? items : [],
        actions: category === "actions" ? items : [],
        risks: category === "risks" ? items : [],
        opportunities: category === "opportunities" ? items : [],
      },
    };
  }

  test("actions: as 6 frases do incidente permanecem 6 (nenhuma fusão)", () => {
    const { result } = consolidateAnalysisSemantically(buildEntityRaw("actions", INCIDENT_TEXTS));
    const actions = (result["analysis"] as Record<string, unknown>)["actions"] as unknown[];
    expect(actions.length).toBe(6);
  });

  test("decisions: duas decisions quase idênticas (texto real de crédito/banco) NÃO fundem mais, mesmo com cosseno=1", () => {
    const raw = buildEntityRaw("decisions", [
      "Verificar quais linhas de crédito estão disponíveis no banco",
      "Verificar a linha de crédito disponível no banco",
    ]);
    const { result } = consolidateAnalysisSemantically(raw);
    const decisions = (result["analysis"] as Record<string, unknown>)["decisions"] as unknown[];
    expect(decisions.length).toBe(2);
  });

  test("risks: duas risks quase idênticas NÃO fundem mais, mesmo com cosseno=1", () => {
    const raw = buildEntityRaw("risks", [
      "Verificar quais linhas de crédito estão disponíveis no banco",
      "Verificar a linha de crédito disponível no banco",
    ]);
    const { result } = consolidateAnalysisSemantically(raw);
    const risks = (result["analysis"] as Record<string, unknown>)["risks"] as unknown[];
    expect(risks.length).toBe(2);
  });

  test("opportunities: duas opportunities quase idênticas NÃO fundem mais, mesmo com cosseno=1", () => {
    const raw = buildEntityRaw("opportunities", [
      "Verificar quais linhas de crédito estão disponíveis no banco",
      "Verificar a linha de crédito disponível no banco",
    ]);
    const { result } = consolidateAnalysisSemantically(raw);
    const opportunities = (result["analysis"] as Record<string, unknown>)[
      "opportunities"
    ] as unknown[];
    expect(opportunities.length).toBe(2);
  });
});

describe("ENTITY_POLICY — next_steps (pré-promoção) continua fundindo por cosseno alto, sem overlap (comportamento antigo)", () => {
  test("dois next_steps sem overlap lexical, cosseno alto, consolidam em 1 antes da promoção -> 1 action", () => {
    const embA = unit(0);
    const embB = unit(0); // mesma direção => cosseno = 1, bem acima do limiar 0.6
    const raw = {
      identification: {},
      analysis: {
        context_updates: {
          ...emptyContextUpdates(),
          next_steps: [
            { content: B1, classification: "suggestion", __embedding: embA },
            { content: B3, classification: "suggestion", __embedding: embB },
          ],
        },
        decisions: [],
        actions: [],
        risks: [],
        opportunities: [],
      },
    };
    const { result } = consolidateAnalysisSemantically(raw);
    const actions = (result["analysis"] as Record<string, unknown>)["actions"] as unknown[];
    expect(actions.length).toBe(1);
  });
});

describe("ENTITY_POLICY — nenhum grupo reportado para actions/decisions/risks/opportunities", () => {
  test("semantic.groups nunca traz category actions/decisions/risks/opportunities, mesmo com itens quase idênticos", () => {
    const embedding = unit(0);
    const raw = {
      identification: {},
      analysis: {
        context_updates: emptyContextUpdates(),
        decisions: [
          {
            title: "Verificar linha de crédito no banco",
            reason: "",
            owner: "",
            due_date: "",
            classification: "fact",
            embedding,
          },
          {
            title: "Verificar a linha de crédito no banco",
            reason: "",
            owner: "",
            due_date: "",
            classification: "fact",
            embedding,
          },
        ],
        actions: [
          { description: "Cobrar clientes vencidos", classification: "fact", embedding },
          { description: "Cobrar clientes vencidos", classification: "fact", embedding },
        ],
        risks: [
          { description: "Risco de inadimplência", classification: "fact", embedding },
          { description: "Risco de inadimplência", classification: "fact", embedding },
        ],
        opportunities: [
          { description: "Oportunidade de crédito", classification: "fact", embedding },
          { description: "Oportunidade de crédito", classification: "fact", embedding },
        ],
      },
    };
    const { semantic } = consolidateAnalysisSemantically(raw);
    const entityGroups = semantic.groups.filter((g) =>
      ["actions", "decisions", "risks", "opportunities"].includes(g.category),
    );
    expect(entityGroups).toEqual([]);
  });
});
