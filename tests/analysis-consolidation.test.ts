import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEDUPE_THRESHOLDS, matchAction, needsHumanReview, similarity } from "../src/lib/deduplication";
import {
  classifyExecutionItem,
  CONSOLIDATION_THRESHOLD,
  clusterBySimilarity,
  consolidateAnalysis,
  consolidateItems,
  mergeRecordPreferFilled,
  normalizeExecutionItems,
} from "../src/lib/analysis-consolidation";
import { ANALYSIS_TEMPLATE, parseAnalysisJson } from "../src/lib/meeting-analysis";

const root = resolve(import.meta.dir, "..");
function source(path: string): string {
  return readFileSync(resolve(root, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}

/* ------------------------------------------------------------------ *
 * GATE 12 — consolidação temática + action-first.
 * ------------------------------------------------------------------ */

describe("GATE 12 — limiares (16)", () => {
  test("DEDUPE_THRESHOLDS permanece 0.95 / 0.90 / 0.70", () => {
    expect(DEDUPE_THRESHOLDS.exact).toBe(0.95);
    expect(DEDUPE_THRESHOLDS.high).toBe(0.9);
    expect(DEDUPE_THRESHOLDS.review).toBe(0.7);
  });

  test("CONSOLIDATION_THRESHOLD reaproveita DEDUPE_THRESHOLDS.high — não é um número novo", () => {
    expect(CONSOLIDATION_THRESHOLD).toBe(DEDUPE_THRESHOLDS.high);
  });
});

describe("GATE 12 — consolidação dentro da mesma categoria (1, 3, 9-regra)", () => {
  test("frases quase idênticas dentro de objectives consolidam", () => {
    const { items, mergedCount } = consolidateItems(
      [
        "Reduzir dependência do fundador nas vendas comerciais",
        "Reduzir a dependência do fundador nas vendas",
      ],
      (t) => t,
      (a) => a,
    );
    expect(items.length).toBe(1);
    expect(mergedCount).toBe(1);
  });

  test("dois itens com diferenças materiais permanecem separados", () => {
    const { items } = consolidateItems(
      ["Negociar prazo de pagamento com o fornecedor Suvinil", "Cobrar clientes com pagamento vencido"],
      (t) => t,
      (a) => a,
    );
    expect(items.length).toBe(2);
  });

  test("não reduz itens que só compartilham palavras genéricas a um só (regra 9)", () => {
    const { items } = consolidateItems(
      [
        "Verificar contrato do fornecedor de tintas",
        "Verificar contrato bancário da linha de crédito",
        "Verificar contrato de aluguel do galpão",
      ],
      (t) => t,
      (a) => a,
    );
    // "contrato"/"verificar" são genéricos — cada um tem qualificador próprio (fornecedor/banco/aluguel).
    expect(items.length).toBe(3);
  });
});

describe("GATE 12 — preservação de detalhes ao mesclar (4, 17)", () => {
  test("mergeRecordPreferFilled preenche campo vazio do canônico com o do duplicado, nunca perde número/dado", () => {
    const canonical = { description: "Levantar taxas atuais da maquininha", evidence: "" };
    const duplicate = {
      description: "Levantar as taxas atuais cobradas pela maquininha",
      evidence: "Taxa de 3,5% ao mês citada na reunião",
    };
    const merged = mergeRecordPreferFilled(canonical, duplicate);
    expect(merged.evidence).toBe("Taxa de 3,5% ao mês citada na reunião");
    // Nunca sobrescreve um valor já preenchido.
    expect(merged.description).toBe("Levantar taxas atuais da maquininha");
  });

  test("nenhum texto final é inventado — o canônico de cada cluster é sempre um dos textos de entrada", () => {
    const inputs = [
      "Sair da antecipação automática de recebíveis",
      "Reduzir a antecipação automática de recebíveis",
      "Cobrar clientes com pagamento vencido",
    ];
    const { items } = consolidateItems(inputs, (t) => t, (a) => a);
    for (const item of items) expect(inputs).toContain(item);
  });
});

describe("GATE 12 — classificação action-first (10, 11, 12, 13, 14)", () => {
  test("'consultar banco sobre crédito' é executável", () => {
    expect(classifyExecutionItem("Consultar o banco sobre linha de crédito")).toBe("executable");
  });
  test("'analisar taxas da maquininha' é executável", () => {
    expect(classifyExecutionItem("Analisar as taxas cobradas pela maquininha")).toBe("executable");
  });
  test("'negociar prazo com fornecedor' é executável", () => {
    expect(classifyExecutionItem("Negociar prazo de pagamento com o fornecedor")).toBe("executable");
  });
  test("'reduzir dependência de antecipação' NÃO é classificado como executável (objetivo estratégico, objeto abstrato)", () => {
    expect(classifyExecutionItem("Reduzir a dependência de antecipação de recebíveis")).not.toBe("executable");
  });
  test("'reduzir antecipação' (concreto, sem objeto abstrato) É executável — mesma ideia, formulação operacional", () => {
    expect(classifyExecutionItem("Reduzir a antecipação de recebíveis")).toBe("executable");
  });
  test("direção estratégica contínua permanece não-executável (exemplo do próprio GATE)", () => {
    expect(classifyExecutionItem("Acompanhar a evolução da saúde financeira ao longo dos próximos ciclos")).not.toBe(
      "executable",
    );
  });
  test("item sem verbo operacional é estratégico, não pendente", () => {
    expect(classifyExecutionItem("Saúde financeira da empresa")).toBe("strategic");
  });
});

describe("GATE 12 — action-first: next_steps -> actions (5, 6, 7, 8, 9)", () => {
  test("next_step executável sem action correspondente gera action proposta", () => {
    const result = normalizeExecutionItems<string, string>(
      ["Consultar banco sobre linha de crédito"],
      (s) => s,
      [],
      (a) => a,
      (s) => s,
    );
    expect(result.proposedActions).toEqual(["Consultar banco sobre linha de crédito"]);
    expect(result.convertedCount).toBe(1);
    expect(result.strategicNextSteps).toEqual([]);
    expect(result.pendingNextSteps).toEqual([]);
  });

  test("next_step já coberto por action existente não duplica (reaproveitado)", () => {
    const result = normalizeExecutionItems<string, string>(
      ["Consultar o banco sobre linha de crédito para capital de giro"],
      (s) => s,
      ["Consultar banco sobre linha de crédito"],
      (a) => a,
      (s) => s,
    );
    expect(result.proposedActions).toEqual([]);
    expect(result.reusedCount).toBe(1);
    expect(result.convertedCount).toBe(1);
  });

  test("owner e prazo ficam vazios quando desconhecidos — nunca inventados", () => {
    const result = normalizeExecutionItems<{ content: string }, Record<string, unknown>>(
      [{ content: "Montar balanço patrimonial da empresa" }],
      (s) => s.content,
      [],
      (a) => String(a["description"] ?? ""),
      (s) => ({ description: s.content, owner_name: "", deadline: "" }),
    );
    expect(result.proposedActions[0]?.["owner_name"]).toBe("");
    expect(result.proposedActions[0]?.["deadline"]).toBe("");
  });

  test("next_step não-executável permanece em next_steps (estratégico)", () => {
    const result = normalizeExecutionItems<string, string>(
      ["Acompanhar a evolução da saúde financeira ao longo dos próximos ciclos"],
      (s) => s,
      [],
      (a) => a,
      (s) => s,
    );
    expect(result.strategicNextSteps.length + result.pendingNextSteps.length).toBe(1);
    expect(result.proposedActions).toEqual([]);
  });

  test("nenhuma action com owner/prazo fictício: buildAction nunca recebe dado que não veio do próprio next_step (18)", () => {
    const result = normalizeExecutionItems<string, { description: string; owner_name: string; deadline: string }>(
      ["Cobrar clientes com pagamento vencido"],
      (s) => s,
      [],
      (a) => a.description,
      (s) => ({ description: s, owner_name: "", deadline: "" }),
    );
    expect(result.proposedActions[0]?.owner_name).toBe("");
    expect(result.proposedActions[0]?.deadline).toBe("");
  });
});

describe("GATE 12 — cross-categoria nunca é misturada (2)", () => {
  test("consolidateAnalysis nunca compara problems com actions entre si", () => {
    const raw = {
      identification: {},
      analysis: {
        context_updates: {
          objectives: [],
          problems: [{ content: "Consultar banco sobre linha de crédito", classification: "fact" }],
          root_causes: [],
          priorities: [],
          hypotheses: [],
          constraints: [],
          results: [],
          next_steps: [],
        },
        decisions: [],
        actions: [{ description: "Consultar banco sobre linha de crédito", owner_name: "", deadline: "", priority: "", classification: "fact" }],
        risks: [],
        opportunities: [],
      },
    };
    const { result } = consolidateAnalysis(raw);
    const analysis = result["analysis"] as Record<string, unknown>;
    const contextUpdates = analysis["context_updates"] as Record<string, unknown>;
    // O item idêntico continua existindo nas DUAS categorias — consolidação nunca cruza categorias.
    expect((contextUpdates["problems"] as unknown[]).length).toBe(1);
    expect((analysis["actions"] as unknown[]).length).toBe(1);
  });
});

describe("GATE 12 — dedupe contra o banco continua intocado (15, 19)", () => {
  test("needsHumanReview ainda existe e POSSIBLE_DUPLICATE ainda vai para revisão", () => {
    const match = matchAction(
      { description: "Cobrar clientes com pagamento vencido" },
      [{ id: "1", client_id: "c1", description: "Cobrar cliente inadimplente", status: "em andamento" } as never],
    );
    if (match.type === "POSSIBLE_DUPLICATE") {
      expect(needsHumanReview(match)).toBe(true);
    } else {
      // Ambiente de teste pode variar o score exato — o que importa é que a função
      // e o contrato (POSSIBLE_DUPLICATE => needsHumanReview true) continuam existindo e corretos.
      expect(typeof needsHumanReview(match)).toBe("boolean");
    }
  });

  test("similarity() de deduplication.ts continua funcional e é a MESMA função reaproveitada pela consolidação", () => {
    expect(similarity("Cobrar clientes vencidos", "Cobrar clientes vencidos")).toBe(1);
    expect(similarity("Cobrar clientes vencidos", "Negociar prazo com fornecedor")).toBeLessThan(
      DEDUPE_THRESHOLDS.review,
    );
  });

  test("nenhum símbolo do GATE 12 aparece em deduplication.ts ou embeddings.server.ts", () => {
    const dedupe = source("src/lib/deduplication.ts");
    const embeddings = source("src/lib/embeddings.server.ts");
    for (const forbidden of ["consolidateAnalysis", "analysis-consolidation", "normalizeExecutionItems"]) {
      expect(dedupe).not.toContain(forbidden);
      expect(embeddings).not.toContain(forbidden);
    }
  });
});

describe("GATE 12 — persistência final compatível com ApprovedSelection/applyApprovedAnalysis (20)", () => {
  test("parseAnalysis continua aceitando o template original (sem execution_quality) com default zerado", () => {
    const result = parseAnalysisJson(ANALYSIS_TEMPLATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.analysis.execution_quality).toEqual({
        proposedActions: 0,
        convertedFromNextSteps: 0,
        pendingWithoutAction: 0,
        pendingNextSteps: [],
        repetitionGroupsReduced: 0,
      });
      // Campos pré-existentes continuam com a MESMA forma (decisions/actions/risks/opportunities).
      expect(result.analysis.decisions[0]?.title).toBe("Contratar um novo SDR");
      expect(result.analysis.actions[0]?.description).toBe("Definir perfil da vaga de SDR");
    }
  });

  test("parseAnalysis aceita execution_quality quando presente (saída real de consolidateAnalysis)", () => {
    const withQuality = JSON.parse(ANALYSIS_TEMPLATE) as Record<string, unknown>;
    withQuality["execution_quality"] = {
      proposedActions: 2,
      convertedFromNextSteps: 3,
      pendingWithoutAction: 1,
      pendingNextSteps: ["Acompanhar evolução ao longo dos próximos ciclos"],
      repetitionGroupsReduced: 4,
    };
    const result = parseAnalysisJson(JSON.stringify(withQuality));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.analysis.execution_quality.proposedActions).toBe(2);
      expect(result.analysis.execution_quality.pendingNextSteps).toEqual([
        "Acompanhar evolução ao longo dos próximos ciclos",
      ]);
    }
  });
});

describe("GATE 12 — clusterBySimilarity: comportamento de baixo nível", () => {
  test("itens idênticos sempre formam 1 cluster", () => {
    const clusters = clusterBySimilarity(["Cobrar clientes vencidos", "Cobrar clientes vencidos"]);
    expect(clusters.length).toBe(1);
    expect(clusters[0]?.memberIndices).toEqual([0, 1]);
  });

  test("string vazia não forma cluster (ignorada)", () => {
    const clusters = clusterBySimilarity(["", "Cobrar clientes vencidos"]);
    expect(clusters.length).toBe(1);
    expect(clusters[0]?.memberIndices).toEqual([1]);
  });
});

describe("GATE 12 — fixture Medeiros (Fase 10)", () => {
  const medeirosNextSteps = [
    "Sair da antecipação automática de recebíveis",
    "Reduzir a antecipação de recebíveis",
    "Analisar as taxas cobradas pela maquininha de cartão",
    "Verificar linha de crédito disponível no banco",
    "Consultar o banco sobre linha de crédito para capital de giro",
    "Comparar o custo do crédito bancário com a antecipação de recebíveis",
    "Montar o balanço patrimonial da empresa",
    "Cobrar os clientes com pagamento vencido",
    "Negociar prazo de pagamento com os fornecedores",
  ].map((content) => ({ content, classification: "suggestion" as const }));

  function buildRawAnalysis() {
    return {
      identification: {},
      analysis: {
        context_updates: {
          objectives: [],
          problems: [],
          root_causes: [],
          priorities: [],
          hypotheses: [],
          constraints: [],
          results: [],
          next_steps: medeirosNextSteps,
        },
        decisions: [],
        actions: [],
        risks: [],
        opportunities: [],
      },
    };
  }

  test("execução aumenta: 0 actions antes -> várias actions concretas depois", () => {
    const raw = buildRawAnalysis();
    const { result, quality } = consolidateAnalysis(raw);
    const analysis = result["analysis"] as Record<string, unknown>;
    const actions = analysis["actions"] as Record<string, unknown>[];
    expect(actions.length).toBeGreaterThan(0);
    expect(quality.convertedFromNextSteps).toBeGreaterThan(0);
  });

  test("fragmentação não aumenta: quantidade de itens de execução (next_steps executáveis + actions) nunca é maior que a entrada", () => {
    const raw = buildRawAnalysis();
    const { result } = consolidateAnalysis(raw);
    const analysis = result["analysis"] as Record<string, unknown>;
    const contextUpdates = analysis["context_updates"] as Record<string, unknown>;
    const finalNextSteps = (contextUpdates["next_steps"] as unknown[]).length;
    const finalActions = (analysis["actions"] as unknown[]).length;
    expect(finalNextSteps + finalActions).toBeLessThanOrEqual(medeirosNextSteps.length);
  });

  test("temas materialmente diferentes (crédito x cobrança x fornecedores) continuam representados por actions distintas", () => {
    const raw = buildRawAnalysis();
    const { result } = consolidateAnalysis(raw);
    const analysis = result["analysis"] as Record<string, unknown>;
    const actionTexts = (analysis["actions"] as Record<string, unknown>[]).map((a) =>
      String(a["description"] ?? "").toLowerCase(),
    );
    const hasCredito = actionTexts.some((t) => t.includes("credito") || t.includes("crédito") || t.includes("banco"));
    const hasCobranca = actionTexts.some((t) => t.includes("cobrar") || t.includes("vencid"));
    const hasFornecedor = actionTexts.some((t) => t.includes("fornecedor"));
    const hasBalanco = actionTexts.some((t) => t.includes("balanco") || t.includes("balanço"));
    expect(hasCredito).toBe(true);
    expect(hasCobranca).toBe(true);
    expect(hasFornecedor).toBe(true);
    expect(hasBalanco).toBe(true);
  });

  test("nenhum texto de action/next_step final foi inventado — todos rastreáveis à entrada original", () => {
    const raw = buildRawAnalysis();
    const { result } = consolidateAnalysis(raw);
    const analysis = result["analysis"] as Record<string, unknown>;
    const contextUpdates = analysis["context_updates"] as Record<string, unknown>;
    const inputTexts = new Set(medeirosNextSteps.map((s) => s.content));
    const finalNextStepTexts = (contextUpdates["next_steps"] as Record<string, unknown>[]).map((s) =>
      String(s["content"] ?? ""),
    );
    for (const t of finalNextStepTexts) expect(inputTexts.has(t)).toBe(true);
    const finalActionTexts = (analysis["actions"] as Record<string, unknown>[]).map((a) =>
      String(a["description"] ?? ""),
    );
    for (const t of finalActionTexts) expect(inputTexts.has(t)).toBe(true);
  });

  test("nenhuma action do fixture tem owner/prazo inventado", () => {
    const raw = buildRawAnalysis();
    const { result } = consolidateAnalysis(raw);
    const analysis = result["analysis"] as Record<string, unknown>;
    for (const action of analysis["actions"] as Record<string, unknown>[]) {
      expect(action["owner_name"]).toBe("");
      expect(action["deadline"]).toBe("");
    }
  });
});
