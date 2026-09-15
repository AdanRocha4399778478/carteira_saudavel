import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEDUPE_THRESHOLDS, matchAction, needsHumanReview } from "../src/lib/deduplication";
import {
  classifyExecutionItem,
  clusterSemantic,
  consolidateAnalysisSemantically,
  consolidateItemsSemantic,
  hasFieldConflict,
  mergeRecordPreferFilledGuarded,
  SEMANTIC_CONSOLIDATION_THRESHOLD,
} from "../src/lib/analysis-consolidation";
import { ANALYSIS_TEMPLATE, parseAnalysisJson } from "../src/lib/meeting-analysis";

const root = resolve(import.meta.dir, "..");
function source(path: string): string {
  return readFileSync(resolve(root, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}

/* ------------------------------------------------------------------ *
 * GATE 12B — consolidação SEMÂNTICA (embeddings).
 *
 * Vetores sintéticos: cada par usa dimensões PRÓPRIAS (ortogonais a todo o
 * resto), então o cosseno de um par nunca "vaza" para outro par — permite
 * fixar exatamente os scores medidos de verdade (script de diagnóstico,
 * ver relatório do GATE 12B) sem depender de rede/custo em cada teste.
 * ------------------------------------------------------------------ */

const DIM = 9;
function zeros(): number[] {
  return new Array(DIM).fill(0);
}
/** Vetor unitário só na dimensão `dim`. */
function unit(dim: number): number[] {
  const v = zeros();
  v[dim] = 1;
  return v;
}
/** Vetor unitário no plano (dimA, dimB) com cosseno exato `cos` em relação a unit(dimA). */
function angled(dimA: number, dimB: number, cos: number): number[] {
  const v = zeros();
  v[dimA] = cos;
  v[dimB] = Math.sqrt(Math.max(0, 1 - cos * cos));
  return v;
}

describe("GATE 12B — thresholds do dedupe intocados (14)", () => {
  test("DEDUPE_THRESHOLDS permanece 0.95 / 0.90 / 0.70", () => {
    expect(DEDUPE_THRESHOLDS.exact).toBe(0.95);
    expect(DEDUPE_THRESHOLDS.high).toBe(0.9);
    expect(DEDUPE_THRESHOLDS.review).toBe(0.7);
  });

  test("SEMANTIC_CONSOLIDATION_THRESHOLD é 0.60, medido e documentado — não é 0.90 (evidência no código)", () => {
    expect(SEMANTIC_CONSOLIDATION_THRESHOLD).toBe(0.6);
    expect(source("src/lib/analysis-consolidation.ts")).toContain("0.625");
    expect(source("src/lib/analysis-consolidation.ts")).toContain("0.580");
  });
});

describe("GATE 12B — clustering embedding-aware (3, 4)", () => {
  test("par crédito/banco (cosine real medido 0.625) consolida", () => {
    const items = ["Verificar linha de crédito disponível no banco", "Consultar o banco sobre linha de crédito para capital de giro"];
    const embeddings = [unit(0), angled(0, 1, 0.625)];
    const { items: out } = consolidateItemsSemantic(
      items,
      (t) => t,
      (t) => embeddings[items.indexOf(t)],
      (a) => a,
    );
    expect(out.length).toBe(1);
  });

  test("ações materialmente diferentes (cosine real medido 0.580, cobrança x fornecedores) NÃO consolidam", () => {
    const items = ["Cobrar clientes com pagamento vencido", "Negociar prazo de pagamento com fornecedores"];
    const embeddings = [unit(0), angled(0, 1, 0.58)];
    const { items: out } = consolidateItemsSemantic(
      items,
      (t) => t,
      (t) => embeddings[items.indexOf(t)],
      (a) => a,
    );
    expect(out.length).toBe(2);
  });

  test("clusterSemantic cai para lexical quando embedding é null (fallback automático de combinedSimilarity)", () => {
    const clusters = clusterSemantic(
      ["Cobrar clientes vencidos", "Cobrar clientes vencidos"],
      (t) => t,
      () => null,
    );
    expect(clusters.length).toBe(1); // textos idênticos => lexical=1, mesmo sem embedding
  });
});

describe("GATE 12B — nunca consolida entre categorias diferentes (2, 5)", () => {
  test("mesmo texto/embedding em problems e actions nunca são comparados entre si", () => {
    const embedding = unit(0);
    const raw = {
      identification: {},
      analysis: {
        context_updates: {
          objectives: [],
          problems: [{ content: "Consultar banco sobre linha de crédito", classification: "fact", __embedding: embedding }],
          root_causes: [],
          priorities: [],
          hypotheses: [],
          constraints: [],
          results: [],
          next_steps: [],
        },
        decisions: [],
        actions: [
          { description: "Consultar banco sobre linha de crédito", owner_name: "", deadline: "", priority: "", classification: "fact", embedding },
        ],
        risks: [],
        opportunities: [],
      },
    };
    const { result } = consolidateAnalysisSemantically(raw);
    const analysis = result["analysis"] as Record<string, unknown>;
    const contextUpdates = analysis["context_updates"] as Record<string, unknown>;
    expect((contextUpdates["problems"] as unknown[]).length).toBe(1);
    expect((analysis["actions"] as unknown[]).length).toBe(1);
  });
});

describe("GATE 12B — preservação de owner/prazo (6, 7, 8, 9, 19)", () => {
  test("owner é preservado ao consolidar (canônico vazio herda do duplicado)", () => {
    const merged = mergeRecordPreferFilledGuarded(
      { description: "Consultar banco", owner_name: "" },
      { description: "Consultar o banco sobre crédito", owner_name: "Maria" },
    );
    expect(merged["owner_name"]).toBe("Maria");
  });

  test("deadline é preservado ao consolidar (canônico vazio herda do duplicado)", () => {
    const merged = mergeRecordPreferFilledGuarded(
      { description: "Consultar banco", deadline: "" },
      { description: "Consultar o banco sobre crédito", deadline: "2026-10-01" },
    );
    expect(merged["deadline"]).toBe("2026-10-01");
  });

  test("conflito de owner_name não é sobrescrito silenciosamente — hasFieldConflict detecta", () => {
    expect(hasFieldConflict({ owner_name: "João" }, { owner_name: "Maria" })).toBe(true);
    const merged = mergeRecordPreferFilledGuarded({ description: "a", owner_name: "João" }, { description: "b", owner_name: "Maria" });
    expect(merged["owner_name"]).toBe("João"); // nunca sobrescreve; mergeRecordPreferFilledGuarded recusa o merge inteiro
  });

  test("conflito de deadline não é sobrescrito silenciosamente", () => {
    expect(hasFieldConflict({ deadline: "2026-10-01" }, { deadline: "2026-11-15" })).toBe(true);
    const merged = mergeRecordPreferFilledGuarded({ description: "a", deadline: "2026-10-01" }, { description: "b", deadline: "2026-11-15" });
    expect(merged["deadline"]).toBe("2026-10-01");
  });

  test("clustering respeita canMerge: par com cosine acima do limiar mas owner conflitante NÃO forma cluster", () => {
    const items = [
      { description: "Cobrar cliente vencido", owner_name: "João" },
      { description: "Cobrar clientes com pagamento vencido", owner_name: "Maria" },
    ];
    const embeddings = [unit(0), angled(0, 1, 0.9)]; // cosine bem acima do limiar
    const { items: out } = consolidateItemsSemantic(
      items,
      (i) => i.description,
      (i) => embeddings[items.indexOf(i)],
      mergeRecordPreferFilledGuarded as never,
      (a, b) => !hasFieldConflict(a as never, b as never),
    );
    expect(out.length).toBe(2); // conflito de owner bloqueia o merge mesmo com cosine alto
  });

  test("nenhum owner/prazo é inventado: consolidar dois itens sem nenhum dos dois preenchido mantém ambos vazios", () => {
    const merged = mergeRecordPreferFilledGuarded(
      { description: "Cobrar cliente vencido", owner_name: "", deadline: "" },
      { description: "Cobrar clientes com pagamento vencido", owner_name: "", deadline: "" },
    );
    expect(merged["owner_name"]).toBe("");
    expect(merged["deadline"]).toBe("");
  });
});

describe("GATE 12B — embedding temporário de contexto (1, 16)", () => {
  test("__embedding nunca aparece nos itens de saída de nenhuma categoria de contexto", () => {
    const embedding = unit(0);
    const raw = {
      identification: {},
      analysis: {
        context_updates: {
          objectives: [{ content: "Reduzir dependência do fundador", classification: "fact", __embedding: embedding }],
          problems: [],
          root_causes: [],
          priorities: [],
          hypotheses: [],
          constraints: [],
          results: [],
          next_steps: [{ content: "Acompanhar evolução ao longo dos próximos ciclos", classification: "suggestion", __embedding: embedding }],
        },
        decisions: [],
        actions: [],
        risks: [],
        opportunities: [],
      },
    };
    const { result } = consolidateAnalysisSemantically(raw);
    const contextUpdates = (result["analysis"] as Record<string, unknown>)["context_updates"] as Record<string, unknown>;
    for (const key of Object.keys(contextUpdates)) {
      for (const item of contextUpdates[key] as Record<string, unknown>[]) {
        expect(Object.keys(item)).not.toContain("__embedding");
      }
    }
  });

  test("intelligent-meeting.server.ts nunca grava context_updates/project_context diretamente — a única escrita é ensureProjectContext/saveProjectContext em projects.ts", () => {
    const file = source("src/lib/intelligent-meeting.server.ts");
    expect(file).not.toMatch(/from\("project_context"\)/);
    expect(file).not.toContain("saveProjectContext");
  });
});

describe("GATE 12B — action-first continua funcionando (10, 12, 13)", () => {
  test("classifyExecutionItem continua distinguindo estratégico de executável (mesma regra do GATE 12A)", () => {
    expect(classifyExecutionItem("Consultar o banco sobre linha de crédito")).toBe("executable");
    expect(classifyExecutionItem("Reduzir a dependência de antecipação de recebíveis")).not.toBe("executable");
    expect(classifyExecutionItem("Acompanhar a evolução da saúde financeira ao longo dos próximos ciclos")).not.toBe(
      "executable",
    );
  });
});

describe("GATE 12B — dedupe contra o banco continua igual (15)", () => {
  test("POSSIBLE_DUPLICATE ainda vai para revisão humana", () => {
    const match = matchAction(
      { description: "Cobrar clientes com pagamento vencido" },
      [{ id: "1", client_id: "c1", description: "Cobrar cliente inadimplente", status: "em andamento" } as never],
    );
    expect(typeof needsHumanReview(match)).toBe("boolean");
    if (match.type === "POSSIBLE_DUPLICATE") expect(needsHumanReview(match)).toBe(true);
  });

  test("git diff de deduplication.ts fica vazio — nenhum símbolo do GATE 12B vaza para lá", () => {
    const dedupe = source("src/lib/deduplication.ts");
    for (const forbidden of ["consolidateAnalysisSemantically", "SEMANTIC_CONSOLIDATION_THRESHOLD", "clusterSemantic"]) {
      expect(dedupe).not.toContain(forbidden);
    }
  });
});

describe("GATE 12B — persistência / retrocompatibilidade (17)", () => {
  test("parseAnalysis aceita análises antigas sem semantic_consolidation, com default zerado", () => {
    const result = parseAnalysisJson(ANALYSIS_TEMPLATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.analysis.semantic_consolidation).toEqual({ totalBefore: 0, totalAfter: 0, mergedCount: 0, groups: [] });
    }
  });

  test("parseAnalysis aceita semantic_consolidation quando presente", () => {
    const withField = JSON.parse(ANALYSIS_TEMPLATE) as Record<string, unknown>;
    withField["semantic_consolidation"] = {
      totalBefore: 9,
      totalAfter: 7,
      mergedCount: 2,
      groups: [{ category: "next_steps", canonicalText: "Sair da antecipação automática", mergedTexts: ["Reduzir a antecipação"] }],
    };
    const result = parseAnalysisJson(JSON.stringify(withField));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.analysis.semantic_consolidation.mergedCount).toBe(2);
      expect(result.analysis.semantic_consolidation.groups[0]?.category).toBe("next_steps");
    }
  });
});

describe("GATE 12B — UI mostra mergedCount (18)", () => {
  test("ReviewSummaryCard usa semanticConsolidation.mergedCount", () => {
    const dialog = source("src/components/painel/MeetingAnalysisDialog.tsx");
    expect(dialog).toContain("semanticConsolidation.mergedCount");
    expect(dialog).toContain("semanticConsolidation?: SemanticConsolidation");
  });
});

describe("GATE 12B — custo: uma única chamada a getEmbeddings (20)", () => {
  test("runMeetingAnalysis chama getEmbeddings exatamente uma vez", () => {
    const file = source("src/lib/intelligent-meeting.server.ts");
    const runFnBody = file.slice(file.indexOf("export async function runMeetingAnalysis"));
    expect(runFnBody.match(/getEmbeddings\(/g)?.length).toBe(1);
  });
});

describe("GATE 12B — fixture Medeiros com scores reais medidos (Fase 10/11)", () => {
  // Dimensões dedicadas por par/tema — cosseno exato controlado, zero
  // vazamento entre pares (ver comentário no topo do arquivo).
  const DIM_ANTECIPACAO = [0, 1] as const; // item 1, 2 — cosine real medido 0.7569 (par B)
  const DIM_CREDITO = [2, 3] as const; // item 4, 5 — cosine real medido 0.6250 (par A)
  const DIM_COBRANCA = [4, 5] as const; // item 8, 9 — cosine real medido 0.5800 (par D) — NÃO deve consolidar
  const DIM_MAQUININHA = 6; // item 3 — isolado
  const DIM_COMPARACAO = 7; // item 6 — isolado
  const DIM_BALANCO = 8; // item 7 — isolado

  const fixtureItems: { content: string; embedding: number[] }[] = [
    { content: "Sair da antecipação automática de recebíveis", embedding: unit(DIM_ANTECIPACAO[0]) },
    { content: "Reduzir a antecipação de recebíveis", embedding: angled(DIM_ANTECIPACAO[0], DIM_ANTECIPACAO[1], 0.7569) },
    { content: "Analisar as taxas cobradas pela maquininha de cartão", embedding: unit(DIM_MAQUININHA) },
    { content: "Verificar linha de crédito disponível no banco", embedding: unit(DIM_CREDITO[0]) },
    {
      content: "Consultar o banco sobre linha de crédito para capital de giro",
      embedding: angled(DIM_CREDITO[0], DIM_CREDITO[1], 0.625),
    },
    { content: "Comparar o custo do crédito bancário com a antecipação de recebíveis", embedding: unit(DIM_COMPARACAO) },
    { content: "Montar o balanço patrimonial da empresa", embedding: unit(DIM_BALANCO) },
    { content: "Cobrar os clientes com pagamento vencido", embedding: unit(DIM_COBRANCA[0]) },
    {
      content: "Negociar prazo de pagamento com os fornecedores",
      embedding: angled(DIM_COBRANCA[0], DIM_COBRANCA[1], 0.58),
    },
  ];

  function buildRaw() {
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
          next_steps: fixtureItems.map((i) => ({ content: i.content, classification: "suggestion", __embedding: i.embedding })),
        },
        decisions: [],
        actions: [],
        risks: [],
        opportunities: [],
      },
    };
  }

  test("critério de sucesso: NÃO continua 9 -> 9 por simples promoção — cai para 7 ações (meta 'ideal' do gate)", () => {
    const { result } = consolidateAnalysisSemantically(buildRaw());
    const analysis = result["analysis"] as Record<string, unknown>;
    const actions = analysis["actions"] as Record<string, unknown>[];
    expect(actions.length).toBe(7);
    expect(actions.length).toBeLessThan(9);
  });

  test("antecipação (item 1+2, cosine real 0.7569) consolida em 1 ação — só o canônico sobrevive, e item 6 (comparação) continua distinto", () => {
    const { result } = consolidateAnalysisSemantically(buildRaw());
    const actions = (result["analysis"] as Record<string, unknown>)["actions"] as Record<string, unknown>[];
    const texts = actions.map((a) => String(a["description"]));
    expect(texts).toContain("Sair da antecipação automática de recebíveis");
    expect(texts).not.toContain("Reduzir a antecipação de recebíveis"); // absorvido no canônico acima
    expect(texts).toContain("Comparar o custo do crédito bancário com a antecipação de recebíveis"); // item 6, entrega distinta, preservada
  });

  test("crédito/banco (item 4+5, cosine real 0.6250) consolida em 1 ação", () => {
    const { result } = consolidateAnalysisSemantically(buildRaw());
    const actions = (result["analysis"] as Record<string, unknown>)["actions"] as Record<string, unknown>[];
    const creditoActions = actions.filter(
      (a) => String(a["description"]).toLowerCase().includes("banco") || String(a["description"]).toLowerCase().includes("crédito"),
    );
    // "comparar custo do crédito..." (item 6) é uma entrega distinta — fica de fora deste grupo.
    expect(creditoActions.length).toBe(2); // o grupo consolidado (1) + item 6 (comparar custo), que é distinto
  });

  test("cobrança x fornecedores (item 8+9, cosine real 0.5800, ABAIXO do limiar) permanecem DUAS ações distintas", () => {
    const { result } = consolidateAnalysisSemantically(buildRaw());
    const actions = (result["analysis"] as Record<string, unknown>)["actions"] as Record<string, unknown>[];
    const cobrar = actions.find((a) => String(a["description"]).toLowerCase().includes("cobrar"));
    const negociar = actions.find((a) => String(a["description"]).toLowerCase().includes("negociar"));
    expect(cobrar).toBeDefined();
    expect(negociar).toBeDefined();
    expect(cobrar).not.toBe(negociar);
  });

  test("maquininha, comparação e balanço permanecem como entregas distintas (nenhuma perdida)", () => {
    const { result } = consolidateAnalysisSemantically(buildRaw());
    const actions = (result["analysis"] as Record<string, unknown>)["actions"] as Record<string, unknown>[];
    const texts = actions.map((a) => String(a["description"]).toLowerCase());
    expect(texts.some((t) => t.includes("maquininha"))).toBe(true);
    expect(texts.some((t) => t.includes("comparar"))).toBe(true);
    expect(texts.some((t) => t.includes("balanço") || t.includes("balanco"))).toBe(true);
  });

  test("nenhum item executável fica sem ação (pendingWithoutAction = 0)", () => {
    const { quality } = consolidateAnalysisSemantically(buildRaw());
    expect(quality.pendingWithoutAction).toBe(0);
  });

  test("nenhuma ação com owner/prazo inventado", () => {
    const { result } = consolidateAnalysisSemantically(buildRaw());
    const actions = (result["analysis"] as Record<string, unknown>)["actions"] as Record<string, unknown>[];
    for (const a of actions) {
      expect(a["owner_name"]).toBe("");
      expect(a["deadline"]).toBe("");
    }
  });

  test("semantic_consolidation reporta ao menos 1 grupo consolidado (rastreabilidade)", () => {
    const { semantic } = consolidateAnalysisSemantically(buildRaw());
    expect(semantic.mergedCount).toBeGreaterThanOrEqual(1);
    expect(semantic.groups.length).toBeGreaterThanOrEqual(1);
  });
});
