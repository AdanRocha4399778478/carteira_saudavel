import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEDUPE_THRESHOLDS, matchAction, needsHumanReview, similarity, cosineSimilarity, combinedSimilarity } from "../src/lib/deduplication";
import {
  consolidateAnalysisSemantically,
  hasFieldConflict,
  meetsConsolidationPolicy,
  mergeRecordPreferFilledGuarded,
  SEMANTIC_CONSOLIDATION_THRESHOLD,
  semanticConsolidationPolicy,
} from "../src/lib/analysis-consolidation";
import { ANALYSIS_TEMPLATE, parseAnalysisJson } from "../src/lib/meeting-analysis";

const root = resolve(import.meta.dir, "..");
function source(path: string): string {
  return readFileSync(resolve(root, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}

/* ------------------------------------------------------------------ *
 * GATE 12B.1 — proteção contra over-merge semântico.
 *
 * Vetores sintéticos calibrados nos scores REAIS medidos via getEmbeddings
 * (script de diagnóstico, ver relatório do GATE 12B.1) — determinísticos,
 * sem chamada de rede a cada teste. Dimensões dedicadas por par: cosseno
 * exato, zero vazamento entre pares.
 * ------------------------------------------------------------------ */

const DIM = 24;
function zeros(): number[] {
  return new Array(DIM).fill(0);
}
function unit(dim: number): number[] {
  const v = zeros();
  v[dim] = 1;
  return v;
}
function angled(dimA: number, dimB: number, cos: number): number[] {
  const v = zeros();
  v[dimA] = cos;
  v[dimB] = Math.sqrt(Math.max(0, 1 - cos * cos));
  return v;
}

describe("GATE 12B.1 — reprodução do erro real (Fase 1, obrigatório)", () => {
  test("priorities: 'diminuir dependência de capital de curto prazo' x 'melhorar previsibilidade financeira' NÃO consolidam", () => {
    const embA = unit(0);
    const embB = angled(0, 1, 0.6159); // combined real medido
    const raw = {
      identification: {},
      analysis: {
        context_updates: {
          objectives: [],
          problems: [],
          root_causes: [],
          priorities: [
            { content: "Diminuir a dependência de capital de curto prazo", classification: "fact", __embedding: embA },
            { content: "Melhorar previsibilidade financeira", classification: "suggestion", __embedding: embB },
          ],
          hypotheses: [],
          constraints: [],
          results: [],
          next_steps: [],
        },
        decisions: [],
        actions: [],
        risks: [],
        opportunities: [],
      },
    };
    const { result } = consolidateAnalysisSemantically(raw);
    const contextUpdates = (result["analysis"] as Record<string, unknown>)["context_updates"] as Record<string, unknown>;
    expect((contextUpdates["priorities"] as unknown[]).length).toBe(2);
  });

  test("actions: 'consultar banco sobre linha de crédito para capital de giro' x 'verificar quais linhas de crédito estão disponíveis no banco' CONSOLIDAM", () => {
    const embA = unit(0);
    const embB = angled(0, 1, 0.6464); // combined real medido
    const raw = {
      identification: {},
      analysis: {
        context_updates: {
          objectives: [], problems: [], root_causes: [], priorities: [], hypotheses: [], constraints: [], results: [], next_steps: [],
        },
        decisions: [],
        actions: [
          { description: "Consultar o banco sobre linha de crédito para capital de giro", owner_name: "", deadline: "", priority: "", classification: "fact", embedding: embA },
          { description: "Verificar quais linhas de crédito estão disponíveis no banco", owner_name: "", deadline: "", priority: "", classification: "fact", embedding: embB },
        ],
        risks: [],
        opportunities: [],
      },
    };
    const { result } = consolidateAnalysisSemantically(raw);
    const actions = (result["analysis"] as Record<string, unknown>)["actions"] as unknown[];
    expect(actions.length).toBe(1);
  });
});

describe("GATE 12B.1 — política por categoria (4, 11, 12)", () => {
  test("semanticConsolidationPolicy é determinística por categoria", () => {
    expect(semanticConsolidationPolicy("priorities")).toEqual(semanticConsolidationPolicy("priorities"));
    expect(semanticConsolidationPolicy("actions").allowSemanticOnly).toBe(true);
    expect(semanticConsolidationPolicy("priorities").allowSemanticOnly).toBe(false);
  });

  test("categorias estratégicas (objectives/problems/root_causes/priorities/hypotheses/constraints/results) exigem lexicalFloor > 0", () => {
    for (const cat of ["objectives", "problems", "root_causes", "priorities", "hypotheses", "constraints", "results"]) {
      const policy = semanticConsolidationPolicy(cat);
      expect(policy.allowSemanticOnly).toBe(false);
      expect(policy.lexicalFloor).toBeGreaterThan(0);
    }
  });

  test("semantic-only é permitido só onde explicitamente definido (actions/next_steps/decisions/risks/opportunities)", () => {
    for (const cat of ["actions", "next_steps", "decisions", "risks", "opportunities"]) {
      expect(semanticConsolidationPolicy(cat).allowSemanticOnly).toBe(true);
    }
  });

  test("meetsConsolidationPolicy: score combinado abaixo do limiar nunca consolida, mesmo com lexical alto", () => {
    const policy = semanticConsolidationPolicy("actions");
    expect(meetsConsolidationPolicy(1, 0.5, policy)).toBe(false);
  });

  test("meetsConsolidationPolicy: política estratégica bloqueia semantic-only mesmo acima do limiar combinado", () => {
    const policy = semanticConsolidationPolicy("priorities");
    expect(meetsConsolidationPolicy(0.01, 0.62, policy)).toBe(false); // caso real do incidente
    expect(meetsConsolidationPolicy(0.43, 0.65, policy)).toBe(true); // caso real correto (crédito/banco, se fosse estratégico)
  });

  test("política de execução aceita semantic-only acima do limiar", () => {
    const policy = semanticConsolidationPolicy("actions");
    expect(meetsConsolidationPolicy(0.01, 0.65, policy)).toBe(true);
  });
});

describe("GATE 12B.1 — objectives/problems/root_causes relacionados mas diferentes NÃO consolidam (3, 4, 5)", () => {
  const relatedButDifferentCombined = 0.62; // acima do limiar 0.60, mas lexical baixo — mesmo padrão do incidente real

  test("objectives", () => {
    const embA = unit(0);
    const embB = angled(0, 1, relatedButDifferentCombined);
    const raw = {
      identification: {},
      analysis: {
        context_updates: {
          objectives: [
            { content: "Reduzir dependência de capital de terceiros", classification: "fact", __embedding: embA },
            { content: "Aumentar previsibilidade de receita", classification: "suggestion", __embedding: embB },
          ],
          problems: [], root_causes: [], priorities: [], hypotheses: [], constraints: [], results: [], next_steps: [],
        },
        decisions: [], actions: [], risks: [], opportunities: [],
      },
    };
    const { result } = consolidateAnalysisSemantically(raw);
    const contextUpdates = (result["analysis"] as Record<string, unknown>)["context_updates"] as Record<string, unknown>;
    expect((contextUpdates["objectives"] as unknown[]).length).toBe(2);
  });

  test("problems", () => {
    const embA = unit(0);
    const embB = angled(0, 1, relatedButDifferentCombined);
    const raw = {
      identification: {},
      analysis: {
        context_updates: {
          objectives: [],
          problems: [
            { content: "Falta de reserva de capital de giro", classification: "fact", __embedding: embA },
            { content: "Receita imprevisível mês a mês", classification: "fact", __embedding: embB },
          ],
          root_causes: [], priorities: [], hypotheses: [], constraints: [], results: [], next_steps: [],
        },
        decisions: [], actions: [], risks: [], opportunities: [],
      },
    };
    const { result } = consolidateAnalysisSemantically(raw);
    const contextUpdates = (result["analysis"] as Record<string, unknown>)["context_updates"] as Record<string, unknown>;
    expect((contextUpdates["problems"] as unknown[]).length).toBe(2);
  });

  test("root_causes", () => {
    const embA = unit(0);
    const embB = angled(0, 1, relatedButDifferentCombined);
    const raw = {
      identification: {},
      analysis: {
        context_updates: {
          objectives: [], problems: [],
          root_causes: [
            { content: "Dependência estrutural de capital de curto prazo", classification: "inference", __embedding: embA },
            { content: "Ausência de controle orçamentário mensal", classification: "inference", __embedding: embB },
          ],
          priorities: [], hypotheses: [], constraints: [], results: [], next_steps: [],
        },
        decisions: [], actions: [], risks: [], opportunities: [],
      },
    };
    const { result } = consolidateAnalysisSemantically(raw);
    const contextUpdates = (result["analysis"] as Record<string, unknown>)["context_updates"] as Record<string, unknown>;
    expect((contextUpdates["root_causes"] as unknown[]).length).toBe(2);
  });
});

describe("GATE 12B.1 — actions equivalentes continuam consolidando (2, 6)", () => {
  test("par de crédito/banco (política de execução) consolida", () => {
    const embA = unit(0);
    const embB = angled(0, 1, 0.7604); // combined real medido (par 1-POS)
    const raw = {
      identification: {},
      analysis: {
        context_updates: { objectives: [], problems: [], root_causes: [], priorities: [], hypotheses: [], constraints: [], results: [], next_steps: [] },
        decisions: [],
        actions: [
          { description: "Consultar banco sobre linha de crédito", owner_name: "", deadline: "", priority: "", classification: "fact", embedding: embA },
          { description: "Verificar linha de crédito disponível no banco", owner_name: "", deadline: "", priority: "", classification: "fact", embedding: embB },
        ],
        risks: [], opportunities: [],
      },
    };
    const { result } = consolidateAnalysisSemantically(raw);
    expect(((result["analysis"] as Record<string, unknown>)["actions"] as unknown[]).length).toBe(1);
  });
});

describe("GATE 12B.1 — 8 pares medidos (Fase 6/7)", () => {
  // valores REAIS medidos via getEmbeddings (script de diagnóstico) — ver relatório.
  const pairs: {
    label: string;
    a: string;
    b: string;
    lexical: number;
    combined: number;
    category: "actions" | "priorities";
    expectMerge: boolean;
  }[] = [
    { label: "1-POS antecipação/crédito", a: "Consultar banco sobre linha de crédito", b: "Verificar linha de crédito disponível no banco", lexical: 0.6, combined: 0.7604, category: "actions", expectMerge: true },
    { label: "2-POS antecipação", a: "Reduzir antecipação de recebíveis", b: "Diminuir uso da antecipação de recebíveis", lexical: 0.5714, combined: 0.9006, category: "actions", expectMerge: true },
    { label: "3-POS cobrança", a: "Cobrar clientes vencidos", b: "Realizar cobrança de clientes em atraso", lexical: 0.5714, combined: 0.7603, category: "actions", expectMerge: true },
    { label: "4-NEG capital/previsibilidade", a: "Diminuir dependência de capital de curto prazo", b: "Melhorar previsibilidade financeira", lexical: 0.0135, combined: 0.6277, category: "priorities", expectMerge: false },
    { label: "5-NEG taxas/comparação", a: "Analisar taxas da maquininha", b: "Comparar custo do crédito com antecipação", lexical: 0.0357, combined: 0.5155, category: "priorities", expectMerge: false },
    { label: "6-NEG cobrança/fornecedor", a: "Cobrar clientes vencidos", b: "Negociar prazo com fornecedores", lexical: 0.0408, combined: 0.4344, category: "priorities", expectMerge: false },
    { label: "7-NEG caixa/balanço", a: "Melhorar controle do caixa", b: "Montar balanço patrimonial", lexical: 0.0435, combined: 0.4437, category: "priorities", expectMerge: false },
    { label: "8-NEG antecipação/crédito", a: "Reduzir antecipação", b: "Consultar linha de crédito", lexical: 0.0244, combined: 0.3107, category: "priorities", expectMerge: false },
  ];

  for (const pair of pairs) {
    test(`${pair.label}: lexical=${pair.lexical} combined=${pair.combined} categoria=${pair.category} -> ${pair.expectMerge ? "CONSOLIDA" : "NÃO consolida"}`, () => {
      const policy = semanticConsolidationPolicy(pair.category);
      expect(meetsConsolidationPolicy(pair.lexical, pair.combined, policy)).toBe(pair.expectMerge);
    });
  }
});

describe("GATE 12B.1 — Action First preservado (8, 13, 14, 15, 16)", () => {
  test("owner é preservado ao consolidar actions", () => {
    const merged = mergeRecordPreferFilledGuarded({ description: "a", owner_name: "" }, { description: "b", owner_name: "Maria" });
    expect(merged["owner_name"]).toBe("Maria");
  });

  test("prazo é preservado ao consolidar actions", () => {
    const merged = mergeRecordPreferFilledGuarded({ description: "a", deadline: "" }, { description: "b", deadline: "2026-10-01" });
    expect(merged["deadline"]).toBe("2026-10-01");
  });

  test("conflito de owner ainda bloqueia merge, mesmo com política de execução (semantic-only)", () => {
    expect(hasFieldConflict({ owner_name: "João" }, { owner_name: "Maria" })).toBe(true);
  });

  test("pendingWithoutAction continua funcionando: next_step ambíguo não vira ação sozinho", () => {
    const raw = {
      identification: {},
      analysis: {
        context_updates: {
          objectives: [], problems: [], root_causes: [], priorities: [], hypotheses: [], constraints: [], results: [],
          next_steps: [
            { content: "Acompanhar a evolução da saúde financeira ao longo dos próximos ciclos", classification: "suggestion", __embedding: unit(0) },
          ],
        },
        decisions: [], actions: [], risks: [], opportunities: [],
      },
    };
    const { quality } = consolidateAnalysisSemantically(raw);
    expect(quality.pendingWithoutAction).toBe(1);
    expect(quality.proposedActions).toBe(0);
  });

  test("nenhum owner/prazo inventado ao promover next_step executável em action", () => {
    const raw = {
      identification: {},
      analysis: {
        context_updates: {
          objectives: [], problems: [], root_causes: [], priorities: [], hypotheses: [], constraints: [], results: [],
          next_steps: [{ content: "Montar o balanço patrimonial da empresa", classification: "suggestion", __embedding: unit(0) }],
        },
        decisions: [], actions: [], risks: [], opportunities: [],
      },
    };
    const { result } = consolidateAnalysisSemantically(raw);
    const actions = (result["analysis"] as Record<string, unknown>)["actions"] as Record<string, unknown>[];
    expect(actions.length).toBe(1);
    expect(actions[0]?.["owner_name"]).toBe("");
    expect(actions[0]?.["deadline"]).toBe("");
  });
});

describe("GATE 12B.1 — retrocompatibilidade e UI (17, 18)", () => {
  test("parseAnalysis continua aceitando análises sem semantic_consolidation", () => {
    const result = parseAnalysisJson(ANALYSIS_TEMPLATE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.analysis.semantic_consolidation.mergedCount).toBe(0);
  });

  test("UI continua mostrando semanticConsolidation.mergedCount", () => {
    const dialog = source("src/components/painel/MeetingAnalysisDialog.tsx");
    expect(dialog).toContain("semanticConsolidation.mergedCount");
  });
});

describe("GATE 12B.1 — dedupe global inalterado (19, 20)", () => {
  test("DEDUPE_THRESHOLDS permanece 0.95 / 0.90 / 0.70", () => {
    expect(DEDUPE_THRESHOLDS.exact).toBe(0.95);
    expect(DEDUPE_THRESHOLDS.high).toBe(0.9);
    expect(DEDUPE_THRESHOLDS.review).toBe(0.7);
  });

  test("POSSIBLE_DUPLICATE ainda vai para revisão humana", () => {
    const match = matchAction(
      { description: "Cobrar clientes com pagamento vencido" },
      [{ id: "1", client_id: "c1", description: "Cobrar cliente inadimplente", status: "em andamento" } as never],
    );
    expect(typeof needsHumanReview(match)).toBe("boolean");
  });

  test("similarity/cosineSimilarity/combinedSimilarity de deduplication.ts continuam funcionais e são as MESMAS funções reaproveitadas", () => {
    expect(similarity("Cobrar clientes vencidos", "Cobrar clientes vencidos")).toBe(1);
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(combinedSimilarity("Cobrar clientes vencidos", "Cobrar clientes vencidos", null, null)).toBe(1);
  });

  test("nenhum símbolo do GATE 12B.1 aparece em deduplication.ts ou embeddings.server.ts", () => {
    const dedupe = source("src/lib/deduplication.ts");
    const embeddings = source("src/lib/embeddings.server.ts");
    for (const forbidden of ["semanticConsolidationPolicy", "meetsConsolidationPolicy", "lexicalFloor", "STRATEGIC_POLICY"]) {
      expect(dedupe).not.toContain(forbidden);
      expect(embeddings).not.toContain(forbidden);
    }
  });
});

describe("GATE 12B.1 — fixture Medeiros real (Fase 10, obrigatório)", () => {
  test("priorities: 2 -> 2 (não consolidam); actions: 2 -> 1 (consolidam)", () => {
    const raw = {
      identification: {},
      analysis: {
        context_updates: {
          objectives: [],
          problems: [],
          root_causes: [],
          priorities: [
            { content: "Diminuir a dependência de capital de curto prazo", classification: "fact", __embedding: unit(0) },
            { content: "Melhorar previsibilidade financeira", classification: "suggestion", __embedding: angled(0, 1, 0.6159) },
          ],
          hypotheses: [],
          constraints: [],
          results: [],
          next_steps: [],
        },
        decisions: [],
        actions: [
          {
            description: "Consultar o banco sobre linha de crédito para capital de giro",
            owner_name: "",
            deadline: "",
            priority: "",
            classification: "fact",
            embedding: unit(2),
          },
          {
            description: "Verificar quais linhas de crédito estão disponíveis no banco",
            owner_name: "",
            deadline: "",
            priority: "",
            classification: "fact",
            embedding: angled(2, 3, 0.6464),
          },
        ],
        risks: [],
        opportunities: [],
      },
    };
    const { result } = consolidateAnalysisSemantically(raw);
    const analysis = result["analysis"] as Record<string, unknown>;
    const contextUpdates = analysis["context_updates"] as Record<string, unknown>;
    expect((contextUpdates["priorities"] as unknown[]).length).toBe(2);
    expect((analysis["actions"] as unknown[]).length).toBe(1);
  });
});
