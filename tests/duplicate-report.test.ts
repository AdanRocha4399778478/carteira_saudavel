import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatDuplicateReport,
  rankCandidates,
  type DuplicateReportInput,
} from "../src/lib/deduplication";

const dialogSource = readFileSync(
  resolve(import.meta.dir, "..", "src/components/painel/MeetingAnalysisDialog.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

/* Vetores sintéticos com dimensões dedicadas, mesmo padrão já usado nos
 * testes de GATE 12B/12B.1 — cosine exato e previsível, sem chamada real. */
const DIM = 6;
const unit = (dim: number): number[] => {
  const v = new Array(DIM).fill(0);
  v[dim] = 1;
  return v;
};
const angled = (dimA: number, dimB: number, cos: number): number[] => {
  const v = new Array(DIM).fill(0);
  v[dimA] = cos;
  v[dimB] = Math.sqrt(1 - cos * cos);
  return v;
};

type Item = { id: string; text: string; embedding: number[] | null };
const item = (id: string, text: string, embedding: number[] | null = null): Item => ({
  id,
  text,
  embedding,
});

describe("rankCandidates — top-N por score, com cosine isolado", () => {
  test("ordena por score decrescente e respeita o limite", () => {
    const candidates = [
      item("a", "Financeiro balanço", angled(0, 1, 0.5)),
      item("b", "Financeiro balanço patrimonial completo", unit(0)),
      item("c", "Assunto totalmente diferente", unit(2)),
      item("d", "Outro assunto qualquer", unit(3)),
    ];
    const ranked = rankCandidates(
      candidates,
      "Financeiro balanço patrimonial",
      (i) => i.text,
      unit(0),
      (i) => i.embedding,
      2,
    );
    expect(ranked.length).toBe(2);
    expect(ranked[0]!.item.id).toBe("b");
    expect(ranked[0]!.cosine).toBeCloseTo(1, 10);
  });

  test("cosine é null quando falta embedding de qualquer um dos lados", () => {
    const candidates = [item("a", "Texto qualquer", null)];
    const ranked = rankCandidates(candidates, "Texto qualquer", (i) => i.text, unit(0), (i) => i.embedding, 3);
    expect(ranked[0]!.cosine).toBeNull();
  });

  test("sem getEmbedding: cai pro score lexical, cosine sempre null", () => {
    const candidates = [item("a", "Cobrar clientes vencidos")];
    const ranked = rankCandidates(candidates, "Cobrar clientes vencidos", (i) => i.text);
    expect(ranked[0]!.cosine).toBeNull();
    expect(ranked[0]!.score).toBeGreaterThan(0);
  });

  test("limit 0 retorna lista vazia", () => {
    const candidates = [item("a", "x"), item("b", "y")];
    expect(rankCandidates(candidates, "x", (i) => i.text, null, undefined, 0)).toEqual([]);
  });

  test("lista de candidatos vazia retorna vazio", () => {
    expect(rankCandidates([], "qualquer coisa", (i: Item) => i.text)).toEqual([]);
  });
});

const baseInput = (patch: Partial<DuplicateReportInput> = {}): DuplicateReportInput => ({
  clientName: "Grupo Erinho",
  projectName: "Operações",
  meetingId: "739c7d61-4446-4ad0-bdbc-5a084e58581e",
  meetingDate: "2026-06-05",
  counts: { total: 10, new: 6, updated: 2, review: 1, ignored: 1 },
  consolidations: [],
  suggestions: [],
  ...patch,
});

describe("formatDuplicateReport — markdown puro, sem embeddings", () => {
  test("cabeçalho traz cliente, projeto, reunião (id+data) e contadores", () => {
    const report = formatDuplicateReport(baseInput());
    expect(report).toContain("Grupo Erinho");
    expect(report).toContain("Operações");
    expect(report).toContain("2026-06-05");
    expect(report).toContain("739c7d61-4446-4ad0-bdbc-5a084e58581e");
    expect(report).toContain("10 total");
    expect(report).toContain("6 novo(s)");
    expect(report).toContain("2 atualização(ões)");
    expect(report).toContain("1 para revisar");
    expect(report).toContain("1 ignorado(s)");
  });

  test("consolidações aparecem só quando a lista não é vazia", () => {
    const semConsolidacao = formatDuplicateReport(baseInput());
    expect(semConsolidacao).not.toContain("Consolidações internas");

    const comConsolidacao = formatDuplicateReport(
      baseInput({
        consolidations: [
          { category: "actions", canonicalText: "Montar balanço patrimonial", mergedTexts: ["Elaborar balanço"] },
        ],
      }),
    );
    expect(comConsolidacao).toContain("Consolidações internas");
    expect(comConsolidacao).toContain('"Montar balanço patrimonial" ← "Elaborar balanço"');
  });

  test("cada sugestão traz categoria, texto, veredito, confiança, classificação, responsável e prazo", () => {
    const report = formatDuplicateReport(
      baseInput({
        suggestions: [
          {
            category: "actions",
            text: "Consultar linha de crédito",
            classification: "Fato",
            ownerName: "Maria",
            deadline: "2026-06-10",
            verdict: "POSSIBLE_DUPLICATE",
            confidence: 0.62,
            posterior: false,
            candidates: [],
          },
        ],
      }),
    );
    expect(report).toContain("[actions] Consultar linha de crédito");
    expect(report).toContain("Possível duplicidade (62%)");
    expect(report).toContain("Classificação: Fato");
    expect(report).toContain("Responsável proposto: Maria");
    expect(report).toContain("Prazo proposto: 2026-06-10");
  });

  test("flag 'posterior' aparece quando o candidato encontrado é de reunião posterior", () => {
    const report = formatDuplicateReport(
      baseInput({
        suggestions: [
          {
            category: "decisions",
            text: "Algo",
            ownerName: null,
            deadline: null,
            verdict: "UPDATE_EXISTING",
            confidence: 0.9,
            posterior: true,
            candidates: [],
          },
        ],
      }),
    );
    expect(report).toContain("reunião posterior");
  });

  test("suportado o veredito NEW também — inclui os melhores candidatos mesmo sem match", () => {
    const report = formatDuplicateReport(
      baseInput({
        suggestions: [
          {
            category: "actions",
            text: "Item genuinamente novo",
            ownerName: null,
            deadline: null,
            verdict: "NEW",
            confidence: 0,
            posterior: false,
            candidates: [
              {
                text: "Candidato mais próximo, mas não bateu",
                projectName: "Financeiro",
                meetingId: "m1",
                meetingDate: "2026-05-20",
                status: "não iniciada",
                owner: "João",
                cosine: 0.55,
              },
            ],
          },
        ],
      }),
    );
    expect(report).toContain("Novo (0%)");
    expect(report).toContain("Candidato mais próximo, mas não bateu");
    expect(report).toContain("projeto: Financeiro");
    expect(report).toContain("cosine: 0.550");
  });

  test("sem candidatos: mostra aviso explícito em vez de lista vazia", () => {
    const report = formatDuplicateReport(
      baseInput({
        suggestions: [
          {
            category: "risks",
            text: "Risco qualquer",
            ownerName: null,
            deadline: null,
            verdict: "NEW",
            confidence: 0,
            posterior: false,
            candidates: [],
          },
        ],
      }),
    );
    expect(report).toContain("Nenhum candidato no histórico do cliente.");
  });

  test("cosine ausente aparece como travessão, não como número inventado", () => {
    const report = formatDuplicateReport(
      baseInput({
        suggestions: [
          {
            category: "opportunities",
            text: "Oportunidade X",
            ownerName: null,
            deadline: null,
            verdict: "NEW",
            confidence: 0,
            posterior: false,
            candidates: [
              {
                text: "Candidato sem embedding",
                projectName: null,
                meetingId: null,
                meetingDate: null,
                status: null,
                owner: null,
                cosine: null,
              },
            ],
          },
        ],
      }),
    );
    expect(report).toContain("cosine: —");
    expect(report).toContain("projeto: —");
    expect(report).toContain("reunião: —");
  });

  test("saída é texto puro em markdown — nenhum array de números (embedding) aparece", () => {
    const report = formatDuplicateReport(
      baseInput({
        suggestions: [
          {
            category: "actions",
            text: "Item qualquer",
            ownerName: null,
            deadline: null,
            verdict: "NEW",
            confidence: 0,
            posterior: false,
            candidates: [
              {
                text: "Candidato",
                projectName: "P",
                meetingId: "m",
                meetingDate: "2026-01-01",
                status: "aberto",
                owner: null,
                cosine: 0.4,
              },
            ],
          },
        ],
      }),
    );
    expect(report).not.toMatch(/\[-?\d+\.\d+,\s*-?\d+\.\d+/);
  });
});

describe("GATE — o relatório cobre TODOS os blocos, não só as 4 entidades (regressão real: 05/06 do Grupo Erinho)", () => {
  test("a montagem de sugestões inclui contextRows (objetivos/problemas/prioridades/...), não só decisions/actions/risks/opportunities", () => {
    const start = dialogSource.indexOf("const suggestions: DuplicateReportSuggestion[] = [");
    const end = dialogSource.indexOf("\n    ];", start);
    const suggestionsBlock = dialogSource.slice(start, end);
    expect(suggestionsBlock).toContain("contextRows.flatMap");
    expect(suggestionsBlock).toContain("analysis.decisions ?? []");
    expect(suggestionsBlock).toContain("analysis.actions ?? []");
    expect(suggestionsBlock).toContain("analysis.risks ?? []");
    expect(suggestionsBlock).toContain("analysis.opportunities ?? []");
  });

  test("candidatos de contexto usam rankCandidates contra group.current (mesmo projeto — escopo de contexto não muda)", () => {
    expect(dialogSource).toContain("contextCandidates(\n            rankCandidates(\n              group.current,");
  });
});
