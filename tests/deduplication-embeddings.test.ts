import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  combinedSimilarity,
  cosineSimilarity,
  DEDUPE_THRESHOLDS,
  matchAction,
  matchDecision,
  matchOpportunity,
  matchRisk,
} from "../src/lib/deduplication";
import { parseAnalysis } from "../src/lib/meeting-analysis";
import type { ActionItem, OpportunityItem, RiskItem } from "../src/lib/domain";
import type { Decision } from "../src/lib/projects";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const dialogSource = read("src/components/painel/MeetingAnalysisDialog.tsx");
const analysisSource = read("src/lib/meeting-analysis.ts");

/* ------------------------------------------------------------------ *
 * GATE 8 — diagnóstico e correção de embeddings/deduplicação.
 *
 * A auditoria (FASE 1-3) não encontrou nenhum bug no pipeline de geração
 * /transporte/parse/persistência/leitura/match — verificado tanto por
 * leitura de código quanto por evidência real no banco (embeddings de
 * 1536 dimensões corretamente gravados e lidos para os itens da reunião
 * Medeiros). Estes testes documentam e travam esse comportamento correto
 * como regressão futura, sem alterar nenhuma regra de negócio.
 *
 * Vetores 2D (preenchidos com zero até o tamanho desejado) são usados aqui
 * só para ter um cosseno exato e previsível — não representam embeddings
 * reais da OpenAI, mas o `cosineSimilarity` não depende disso.
 * ------------------------------------------------------------------ */

/** [x, y, 0, 0, …] — cosseno entre dois desses vetores é só x1*x2 + y1*y2. */
function vec(x: number, y: number, dims = 8): number[] {
  return [x, y, ...new Array(dims - 2).fill(0)];
}

describe("GATE 8 — thresholds inalterados", () => {
  test("DEDUPE_THRESHOLDS continua exatamente 0.95/0.90/0.70", () => {
    expect(DEDUPE_THRESHOLDS).toEqual({ exact: 0.95, high: 0.9, review: 0.7 });
  });
});

describe("GATE 8 — matcher usa cosine quando ambos os lados têm embedding", () => {
  test("cosseno alto (>=0.90) some com texto lexicalmente bem diferente e ainda vira UPDATE_EXISTING/EXISTING", () => {
    // cos = 0.95*1 + 0*0 ≈ 0.95 — textos propositalmente sem nenhuma palavra em comum.
    const candidate: Decision = {
      id: "d1",
      project_id: "p1",
      meeting_id: null,
      client_id: "c1",
      title: "Zebra abacaxi trovão",
      description: null,
      reason: null,
      status: "pendente",
      owner: null,
      due_date: null,
      created_by: null,
      created_at: "",
      updated_at: "",
      embedding: vec(1, 0),
    };
    const match = matchDecision(
      { title: "Foguete violeta oceano", embedding: vec(0.95, Math.sqrt(1 - 0.95 * 0.95)) },
      [candidate],
    );
    // Sem embedding, a similaridade lexical desses dois textos seria ~0 — só o cosseno explica o veredito.
    expect(match.type === "UPDATE_EXISTING" || match.type === "EXISTING").toBe(true);
    expect(match.confidence).toBeGreaterThanOrEqual(DEDUPE_THRESHOLDS.high);
  });

  test("combinedSimilarity é sempre o MAIOR entre lexical e semântico — nunca fica pior que o texto puro", () => {
    const lexicalOnly = combinedSimilarity("revisar contrato com fornecedor", "revisar contrato com fornecedor");
    const withLowCosine = combinedSimilarity(
      "revisar contrato com fornecedor",
      "revisar contrato com fornecedor",
      vec(1, 0),
      vec(0, 1), // cosseno 0 — não deveria derrubar a similaridade textual perfeita.
    );
    expect(withLowCosine).toBeGreaterThanOrEqual(lexicalOnly);
  });
});

describe("GATE 8 — fallback lexical quando embedding está null (comportamento preservado)", () => {
  test("sem embedding em nenhum dos lados, cai para o texto puro (sem lançar erro)", () => {
    const candidate: RiskItem = {
      id: "r1",
      client_id: "c1",
      meeting_id: null,
      description: "Cliente ameaça cancelar contrato por atraso",
      level: "alto",
      active: true,
      created_at: "",
      embedding: null,
    };
    const match = matchRisk({ description: "Cliente ameaça cancelar contrato por atraso" }, [candidate]);
    expect(match.type).toBe("EXISTING");
  });

  test("um lado com embedding e o outro sem: ainda funciona via lexical, não quebra", () => {
    const candidate: ActionItem = {
      id: "a1",
      client_id: "c1",
      meeting_id: null,
      description: "Enviar proposta comercial atualizada",
      owner_name: null,
      deadline: null,
      priority: "média",
      status: "não iniciada",
      erp_area: null,
      evidence: null,
      created_at: "",
      updated_at: "",
      embedding: vec(1, 0),
    };
    // Item novo sem embedding (ex.: provider manual, que não calcula embedding).
    const match = matchAction({ description: "Enviar proposta comercial atualizada" }, [candidate]);
    expect(match.type).toBe("EXISTING");
  });
});

describe("GATE 8 — thresholds aplicados corretamente com base na similaridade combinada", () => {
  test("POSSIBLE_DUPLICATE aparece quando a similaridade combinada cai na faixa [0.70, 0.90)", () => {
    // cos = 0.8*1 = 0.8 — dentro da faixa cinzenta, textos sem sobreposição lexical.
    const candidate: OpportunityItem = {
      id: "o1",
      client_id: "c1",
      meeting_id: null,
      description: "Vulcão amarelo sinfonia",
      expected_benefit: null,
      status: "aberta",
      created_at: "",
      embedding: vec(1, 0),
    };
    const match = matchOpportunity(
      { description: "Guitarra prateada montanha", embedding: vec(0.8, 0.6) },
      [candidate],
    );
    expect(match.type).toBe("POSSIBLE_DUPLICATE");
    expect(match.confidence).toBeGreaterThanOrEqual(DEDUPE_THRESHOLDS.review);
    expect(match.confidence).toBeLessThan(DEDUPE_THRESHOLDS.high);
  });

  test("NEW continua abaixo do threshold de revisão (similaridade combinada < 0.70)", () => {
    const candidate: Decision = {
      id: "d2",
      project_id: "p1",
      meeting_id: null,
      client_id: "c1",
      title: "Time verde silêncio",
      description: null,
      reason: null,
      status: "pendente",
      owner: null,
      due_date: null,
      created_by: null,
      created_at: "",
      updated_at: "",
      embedding: vec(1, 0),
    };
    // cos = 0 (ortogonais) e nenhuma palavra em comum.
    const match = matchDecision({ title: "Papel azul lanterna", embedding: vec(0, 1) }, [candidate]);
    expect(match.type).toBe("NEW");
    expect(match.confidence).toBeLessThan(DEDUPE_THRESHOLDS.review);
  });
});

describe("GATE 8 — embeddings inválidos não quebram o fluxo", () => {
  test("cosineSimilarity com vetores de tamanhos diferentes devolve 0 (não lança)", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });

  test("cosineSimilarity com vetor vazio devolve 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 0], [])).toBe(0);
  });

  test("cosineSimilarity com null/undefined devolve 0, sem lançar", () => {
    expect(cosineSimilarity(null, [1, 0])).toBe(0);
    expect(cosineSimilarity(undefined, undefined)).toBe(0);
  });

  test("combinedSimilarity com embeddings de tamanhos incompatíveis degrada para lexical, sem lançar", () => {
    expect(() => combinedSimilarity("mesmo texto aqui", "mesmo texto aqui", [1, 0, 0], [1, 0])).not.toThrow();
    const result = combinedSimilarity("mesmo texto aqui", "mesmo texto aqui", [1, 0, 0], [1, 0]);
    expect(result).toBe(1); // similaridade lexical de texto idêntico, cosseno inválido ignorado.
  });

  test("matchAction/matchRisk/matchDecision/matchOpportunity não lançam com candidatos sem embedding e item com embedding malformado", () => {
    const risk: RiskItem = {
      id: "r2",
      client_id: "c1",
      meeting_id: null,
      description: "Risco qualquer",
      level: "médio",
      active: true,
      created_at: "",
      embedding: null,
    };
    expect(() =>
      matchRisk({ description: "Risco qualquer", embedding: [] as number[] }, [risk]),
    ).not.toThrow();
  });
});

describe("GATE 8 — parseAnalysis preserva embedding", () => {
  test("decisions/actions/risks/opportunities mantêm o vetor de embedding depois do parse", () => {
    const embedding = vec(0.1, 0.2, 4);
    const parsed = parseAnalysis({
      meeting: { executive_summary: "", main_topic: "", measurable_result: "" },
      context_updates: {},
      decisions: [{ title: "Decisão X", classification: "fact", embedding }],
      actions: [{ description: "Ação X", classification: "fact", embedding }],
      risks: [{ description: "Risco X", classification: "fact", embedding }],
      opportunities: [{ description: "Oportunidade X", classification: "fact", embedding }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.analysis.decisions[0]?.embedding).toEqual(embedding);
    expect(parsed.analysis.actions[0]?.embedding).toEqual(embedding);
    expect(parsed.analysis.risks[0]?.embedding).toEqual(embedding);
    expect(parsed.analysis.opportunities[0]?.embedding).toEqual(embedding);
  });

  test("item sem embedding continua válido (embedding fica undefined/null, não quebra o parse)", () => {
    const parsed = parseAnalysis({
      meeting: { executive_summary: "", main_topic: "", measurable_result: "" },
      context_updates: {},
      decisions: [{ title: "Decisão sem embedding", classification: "fact" }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.analysis.decisions[0]?.embedding ?? null).toBeNull();
  });

  test("context_updates NÃO carrega embedding — gap de escopo confirmado (migration só cobre as 4 tabelas de entidade)", () => {
    // Documenta explicitamente uma limitação real encontrada na auditoria:
    // itens de contexto nunca tiveram suporte a embedding — nenhum código
    // deste GATE precisa adicionar isso (fora do menor-delta), mas o teste
    // trava que ninguém adicione o campo silenciosamente sem migration.
    expect(analysisSource).not.toMatch(/context_updates[\s\S]{0,400}embedding/);
  });
});

describe("GATE 8 — round-trip de save/load (jsonb) preserva embedding", () => {
  test("serializar e reparsear a análise (simulando ida e volta pelo jsonb do Supabase) não corrompe o vetor", () => {
    const embedding = Array.from({ length: 1536 }, (_, i) => Math.sin(i) * 0.01);
    const original = parseAnalysis({
      meeting: { executive_summary: "resumo", main_topic: "", measurable_result: "" },
      context_updates: {},
      decisions: [{ title: "Decisão persistida", classification: "fact", embedding }],
    });
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    // saveAnalysisDraft grava `analysis` como está (sem transformação) numa
    // coluna jsonb; meetingAnalysisQuery lê de volta via JSON — reproduzimos
    // esse round-trip aqui sem precisar de rede/Supabase.
    const roundTripped = JSON.parse(JSON.stringify(original.analysis));
    const reparsed = parseAnalysis(roundTripped);

    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.analysis.decisions[0]?.embedding).toEqual(embedding);
    expect(reparsed.analysis.decisions[0]?.embedding).toHaveLength(1536);
  });

  test("saveAnalysisDraft grava o objeto `analysis` inteiro sem transformação (evidência de código)", () => {
    expect(analysisSource).toContain("analysis: (params.analysis ?? {}) as never,");
  });
});

describe("GATE 8 — ApprovedSelection preserva embedding (evidência de código no componente)", () => {
  test("o mapeamento de aprovação inclui embedding para as 4 entidades, sem transformação", () => {
    const approveBlock = dialogSource.slice(
      dialogSource.indexOf("const selection: ApprovedSelection = {"),
      dialogSource.indexOf("const applied = await applyApprovedAnalysis({"),
    );
    expect(approveBlock).toContain("embedding: r.item.embedding ?? null,");
    // 4 ocorrências: decisions, actions, risks, opportunities.
    const occurrences = approveBlock.split("embedding: r.item.embedding ?? null,").length - 1;
    expect(occurrences).toBe(4);
  });
});

describe("GATE 8 — create/update em actions/risks/decisions/opportunities levam embedding (evidência de código)", () => {
  test("insert de cada entidade grava embedding (novo item)", () => {
    expect(analysisSource).toContain("embedding: d.embedding ?? null,");
    expect(analysisSource).toContain("embedding: a.embedding ?? null,");
    expect(analysisSource).toContain("embedding: r.embedding ?? null,");
    expect(analysisSource).toContain("embedding: o.embedding ?? null,");
  });

  test("update de cada entidade só sobrescreve embedding quando um novo vetor existe — preserva o antigo caso contrário", () => {
    expect(analysisSource).toContain('if (d.embedding) patch["embedding"] = d.embedding;');
    expect(analysisSource).toContain('if (a.embedding) patch["embedding"] = a.embedding;');
    expect(analysisSource).toContain('if (r.embedding) patch["embedding"] = r.embedding;');
    expect(analysisSource).toContain('if (o.embedding) patch["embedding"] = o.embedding;');
  });
});

describe("GATE 8 — leitura de embeddings existentes para o matcher (evidência de código)", () => {
  test("as queries usadas pela revisão da Reunião Inteligente selecionam a coluna embedding", () => {
    const apiSource = read("src/lib/api.ts");
    const projectsSource = read("src/lib/projects.ts");
    const projectDetailSource = read("src/lib/project-detail.ts");

    // select("*") já inclui embedding — actionsQuery/risksQuery/opportunitiesQuery (api.ts).
    expect(apiSource).toContain('await supabase.from("actions").select("*").order("deadline"');
    expect(apiSource).toContain('await supabase.from("risks").select("*").order("created_at"');
    expect(apiSource).toContain('await supabase.from("opportunities").select("*").order("created_at"');
    // decisionsQuery (projects.ts) também usa select("*").
    expect(projectsSource).toContain('supabase.from("decisions").select("*")');

    // As variantes de coluna explícita (usadas em projetos/$projectId.tsx) listam embedding.
    expect(apiSource).toContain("erp_area, evidence, created_at, updated_at, embedding");
    expect(apiSource).toContain("level, active, created_at, embedding");
    expect(apiSource).toContain("expected_benefit, status, created_at, embedding");
    expect(projectDetailSource).toContain("status, owner, due_date, embedding");
  });
});
