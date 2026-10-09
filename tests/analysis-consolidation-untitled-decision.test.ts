import { describe, expect, test } from "bun:test";
import { consolidateAnalysisSemantically } from "../src/lib/analysis-consolidation";

/* ------------------------------------------------------------------ *
 * A consolidação do servidor descartava toda decisão sem título: o texto
 * usado no agrupamento era só o título, e item com texto vazio fica fora
 * dos grupos (e da lista final). Agora a decisão sem título usa a
 * descrição. Sem título e sem descrição, continua descartada.
 * Sem embeddings (null) — nenhuma chamada de rede.
 * ------------------------------------------------------------------ */

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

function decisionsAfter(decisions: Record<string, unknown>[]) {
  const { result } = consolidateAnalysisSemantically({
    identification: {},
    analysis: {
      context_updates: emptyContextUpdates(),
      decisions,
      actions: [],
      risks: [],
      opportunities: [],
    },
  });
  return (result["analysis"] as { decisions: Record<string, unknown>[] }).decisions;
}

describe("consolidação — decisão sem título", () => {
  test("decisão sem título e com descrição sobrevive à consolidação", () => {
    const out = decisionsAfter([
      { title: "", description: "Definir o preço do plano. Depende da revisão dos custos fixos." },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!["description"]).toBe(
      "Definir o preço do plano. Depende da revisão dos custos fixos.",
    );
  });

  test("decisão sem título e sem descrição continua descartada", () => {
    expect(decisionsAfter([{ title: "", description: "" }])).toHaveLength(0);
  });

  test("duas decisões com títulos diferentes continuam separadas", () => {
    const out = decisionsAfter([
      { title: "Reformar a recepção", description: "" },
      { title: "Contratar mais um mecânico", description: "" },
    ]);
    expect(out.map((d) => d["title"])).toEqual([
      "Reformar a recepção",
      "Contratar mais um mecânico",
    ]);
  });
});

function risksAfter(risks: Record<string, unknown>[]) {
  const { result } = consolidateAnalysisSemantically({
    identification: {},
    analysis: {
      context_updates: emptyContextUpdates(),
      decisions: [],
      actions: [],
      risks,
      opportunities: [],
    },
  });
  return (result["analysis"] as { risks: Record<string, unknown>[] }).risks;
}

describe("consolidação — risco sem descrição", () => {
  test("risco só com título sobrevive à consolidação", () => {
    const out = risksAfter([{ title: "Atraso na entrega das peças", description: "" }]);
    expect(out).toHaveLength(1);
    expect(out[0]!["title"]).toBe("Atraso na entrega das peças");
  });

  test("risco com título e descrição vazios continua descartado", () => {
    expect(risksAfter([{ title: "", description: "" }])).toHaveLength(0);
  });

  test("dois riscos com textos diferentes continuam separados", () => {
    const out = risksAfter([
      { title: "", description: "Dependência de um único fornecedor de peças" },
      { title: "Oficina sem seguro contra incêndio", description: "" },
    ]);
    expect(out).toHaveLength(2);
  });
});
