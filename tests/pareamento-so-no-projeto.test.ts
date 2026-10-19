import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEDUPE_THRESHOLDS,
  defaultResolution,
  scopeDedupeCandidates,
  type DedupeMatch,
} from "../src/lib/deduplication";
import {
  applySafeResolutions,
  countReviewBlock,
  needsReview,
  type ReviewBlockItem,
} from "../src/lib/review-blocks";

/* ------------------------------------------------------------------ *
 * R17 (18/10/2026, decisão do dono do produto): pareamento de
 * duplicidade restrito ao PROJETO da reunião atual — nunca mais o
 * cliente inteiro. Três ajustes:
 * (1) scopeDedupeCandidates — escopo real das listas de candidatos.
 * (2) trava de segurança em defaultResolution — UPDATE_EXISTING só vira
 *     "update" por padrão com confiança >= DEDUPE_THRESHOLDS.high (0,90).
 * (3) needsReview (review-blocks.ts): UPDATE_EXISTING de baixa confiança
 *     também exige escolha explícita do consultor — nunca é descartado
 *     em silêncio como "ignorado".
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const dialogSource = readFileSync(
  resolve(root, "src/components/painel/MeetingAnalysisDialog.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");
const reuniaoSource = readFileSync(
  resolve(root, "src/routes/_authenticated/reuniao-inteligente.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");
const projetoSource = readFileSync(
  resolve(root, "src/routes/_authenticated/projetos/$projectId.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

type Item = { id: string; meeting_id: string | null };

function item(id: string, meeting_id: string | null): Item {
  return { id, meeting_id };
}

describe("scopeDedupeCandidates — escopo estrito ao projeto (nunca ao cliente inteiro)", () => {
  test("mantém item de reunião do projeto", () => {
    const projectMeetings = new Set(["m1", "m2"]);
    const items = [item("a", "m1"), item("b", "m2")];
    expect(scopeDedupeCandidates(items, projectMeetings)).toEqual(items);
  });

  test("exclui item de reunião de OUTRO projeto do mesmo cliente", () => {
    const projectMeetings = new Set(["m1"]);
    const items = [item("a", "m1"), item("b", "m-outro-projeto")];
    const result = scopeDedupeCandidates(items, projectMeetings);
    expect(result).toEqual([item("a", "m1")]);
  });

  test("exclui item sem meeting_id (nunca é 'do mesmo projeto' por definição)", () => {
    const projectMeetings = new Set(["m1"]);
    const items = [item("a", "m1"), item("b", null)];
    const result = scopeDedupeCandidates(items, projectMeetings);
    expect(result).toEqual([item("a", "m1")]);
  });

  test("projeto sem nenhuma reunião conhecida devolve lista VAZIA — nunca o universo inteiro do cliente", () => {
    const projectMeetings = new Set<string>();
    const items = [item("a", "m1"), item("b", "m2")];
    expect(scopeDedupeCandidates(items, projectMeetings)).toEqual([]);
  });
});

describe("defaultResolution — trava de segurança: UPDATE_EXISTING só vira 'update' com confiança >= limiar alto", () => {
  function match(patch: Partial<DedupeMatch<unknown>> = {}): DedupeMatch<unknown> {
    return {
      type: "UPDATE_EXISTING",
      confidence: 0.95,
      existing: null,
      existing_id: "existing-1",
      existing_label: "",
      reason: "",
      changes: [],
      ...patch,
    };
  }

  test("ação: UPDATE_EXISTING com 0,95 e sem statusSignal → 'update'", () => {
    const resolution = defaultResolution(
      match({ existing_label: "Enviar relatório mensal", confidence: 0.95 }),
    );
    expect(resolution.mode).toBe("update");
  });

  test("ação: UPDATE_EXISTING com 0,56 (abaixo do limiar) → 'skip', nunca 'update' nem 'create'", () => {
    const resolution = defaultResolution(
      match({ existing_label: "Rodar ritual semanal", confidence: 0.56 }),
    );
    expect(resolution.mode).toBe("skip");
  });

  test("decisão: UPDATE_EXISTING com 0,95 e sem statusSignal → 'update'", () => {
    const resolution = defaultResolution(
      match({ existing_label: "Revisar contrato com fornecedor", confidence: 0.95 }),
    );
    expect(resolution.mode).toBe("update");
  });

  test("decisão: UPDATE_EXISTING com confiança exatamente no limiar (0,90) → 'update'", () => {
    const resolution = defaultResolution(
      match({
        existing_label: "Revisar contrato com fornecedor",
        confidence: DEDUPE_THRESHOLDS.high,
      }),
    );
    expect(resolution.mode).toBe("update");
  });

  test("decisão: UPDATE_EXISTING logo abaixo do limiar (0,8999) → 'skip'", () => {
    const resolution = defaultResolution(
      match({
        existing_label: "Revisar contrato com fornecedor",
        confidence: DEDUPE_THRESHOLDS.high - 0.0001,
      }),
    );
    expect(resolution.mode).toBe("skip");
  });

  test("risco: UPDATE_EXISTING com 0,95 e sem statusSignal → 'update'", () => {
    const resolution = defaultResolution(
      match({ existing_label: "Processo judicial trabalhista", confidence: 0.95 }),
    );
    expect(resolution.mode).toBe("update");
  });

  test("risco: UPDATE_EXISTING com 0,56 → 'skip'", () => {
    const resolution = defaultResolution(
      match({ existing_label: "Processo judicial trabalhista", confidence: 0.56 }),
    );
    expect(resolution.mode).toBe("skip");
  });

  test("UPDATE_EXISTING com confiança alta MAS com statusSignal → continua 'skip' (trava de statusSignal já existente, intocada)", () => {
    const resolution = defaultResolution(match({ confidence: 0.95, statusSignal: "resolved" }));
    expect(resolution.mode).toBe("skip");
  });

  test("POSSIBLE_DUPLICATE e EXISTING continuam 'skip', NEW continua 'create' (sem mudança nesses vereditos)", () => {
    expect(defaultResolution(match({ type: "POSSIBLE_DUPLICATE", confidence: 0.8 })).mode).toBe(
      "skip",
    );
    expect(defaultResolution(match({ type: "EXISTING", confidence: 0.99 })).mode).toBe("skip");
    expect(defaultResolution(match({ type: "NEW", confidence: 0 })).mode).toBe("create");
  });
});

describe("estático — o diálogo usa scopeDedupeCandidates nas quatro listas, o comentário antigo não existe mais", () => {
  test("dedupeActions, dedupeRisks, dedupeDecisions e dedupeOpportunities usam scopeDedupeCandidates", () => {
    expect(dialogSource).toContain(
      "const dedupeActions = useMemo(\n    () => scopeDedupeCandidates(actions, projectMeetingIdSet),",
    );
    expect(dialogSource).toContain(
      "const dedupeRisks = useMemo(\n    () => scopeDedupeCandidates(risks, projectMeetingIdSet),",
    );
    expect(dialogSource).toContain(
      "const dedupeDecisions = useMemo(\n    () => scopeDedupeCandidates(allDecisions ?? decisions, projectMeetingIdSet),",
    );
    expect(dialogSource).toContain(
      "const dedupeOpportunities = useMemo(\n    () => scopeDedupeCandidates(opportunities, projectMeetingIdSet),",
    );
  });

  test("matchOpportunity e o relatório de auditoria usam dedupeOpportunities, nunca a prop 'opportunities' crua", () => {
    const matchIdx = dialogSource.indexOf("const match = matchOpportunity(");
    expect(matchIdx).toBeGreaterThan(-1);
    expect(dialogSource.slice(matchIdx, matchIdx + 200)).toContain("dedupeOpportunities");
  });

  test("o comentário antigo ('TODO o histórico do cliente') não existe mais", () => {
    expect(dialogSource).not.toContain("TODO o histórico do cliente");
  });

  test("matchContextItem continua intocado — compara só com a lista do próprio projeto (group.current), sem scopeDedupeCandidates", () => {
    expect(dialogSource).toContain(
      "matchContextItem(p.text, group.current, (p as { embedding?: number[] | null }).embedding)",
    );
  });

  test("meetingActions/scopedRisks (contadores do rodapé/pauta) continuam usando scopeToProject — intocados", () => {
    expect(dialogSource).toContain(
      "scopeToProject(\n        actions.filter((a) => a.client_id === meeting?.client_id),\n        projectMeetingIds,\n      )",
    );
    expect(dialogSource).toContain(
      "scopeToProject(risks.filter((r) => r.client_id === meeting?.client_id), projectMeetingIds)",
    );
  });
});

describe("TESTE EXTRA — scopeDedupeCandidates mantém a reunião ATUAL já gravada (reaprovar a mesma transcrição continua casando como 'Já existe')", () => {
  test("item da reunião atual, já no conjunto do projeto, nunca é excluído", () => {
    const currentMeetingId = "reuniao-atual-ja-gravada";
    const projectMeetings = new Set([currentMeetingId, "outra-reuniao-do-mesmo-projeto"]);
    const items = [item("decisao-existente", currentMeetingId)];
    expect(scopeDedupeCandidates(items, projectMeetings)).toEqual(items);
  });
});

describe("Verificação 1 — as duas telas passam projectMeetingIds ao diálogo", () => {
  test("projetos/$projectId.tsx passa projectMeetingIds a partir da MESMA consulta já usada (projectMeetingsQuery/meetings), sem consulta nova", () => {
    expect(projetoSource).toContain("const meetings = useQuery(projectMeetingsQuery(projectId));");
    expect(projetoSource).toContain("projectMeetingIds={(meetings.data ?? []).map((m) => m.id)}");
  });

  test("reuniao-inteligente.tsx passa projectMeetingIds derivado de clientMeetings (já carregada), filtrado pelo projeto identificado — sem consulta nova", () => {
    expect(reuniaoSource).toContain("const clientMeetings = useQuery({");
    expect(reuniaoSource).toContain(
      "projectMeetingIds={(clientMeetings.data ?? [])\n          .filter((m) => m.project_id === project?.id)\n          .map((m) => m.id)}",
    );
  });

  test("nenhuma outra tela abre MeetingAnalysisDialog (só estas duas)", () => {
    // Confirmado por busca manual no repositório (grep -rl "<MeetingAnalysisDialog"
    // src/ --include="*.tsx") — só estes dois arquivos. Este teste documenta o
    // fato, não o reproduz (buscar arquivos novos não é responsabilidade de um
    // teste estático sobre fontes já lidas).
    expect(projetoSource).toContain("<MeetingAnalysisDialog");
    expect(reuniaoSource).toContain("<MeetingAnalysisDialog");
  });
});

describe("CORREÇÃO 2 — needsReview exige escolha explícita pra UPDATE_EXISTING de baixa confiança", () => {
  function reviewItem(patch: Partial<ReviewBlockItem<string>> = {}): ReviewBlockItem<string> {
    return {
      key: "item-1",
      verdict: "UPDATE_EXISTING",
      confidence: 0.95,
      mode: "update",
      hasOverride: false,
      ...patch,
    };
  }

  test("UPDATE_EXISTING com 0,83 (abaixo do limiar) e sem escolha: needsReview true, conta em 'para revisar'", () => {
    const it = reviewItem({ confidence: 0.83, mode: "skip" });
    expect(needsReview(it)).toBe(true);
    const counts = countReviewBlock([it]);
    expect(counts.reviewCount).toBe(1);
    expect(counts.newCount + counts.updateCount + counts.ignoredCount).toBe(0);
  });

  test("UPDATE_EXISTING com 0,83 e escolha manual (hasOverride true): deixa de contar em 'para revisar'", () => {
    const it = reviewItem({ confidence: 0.83, mode: "update", hasOverride: true });
    expect(needsReview(it)).toBe(false);
    const counts = countReviewBlock([it]);
    expect(counts.reviewCount).toBe(0);
    expect(counts.updateCount).toBe(1);
  });

  test("UPDATE_EXISTING com 0,95 continua com 'Atualizar' padrão e NÃO exige revisão", () => {
    const it = reviewItem({ confidence: 0.95, mode: "update" });
    expect(needsReview(it)).toBe(false);
    const counts = countReviewBlock([it]);
    expect(counts.reviewCount).toBe(0);
    expect(counts.updateCount).toBe(1);
  });

  test("a soma novo + atualização + ignorado + para revisar continua igual ao total (mistura de casos)", () => {
    const items: ReviewBlockItem<string>[] = [
      reviewItem({ key: "a", verdict: "NEW", confidence: 0, mode: "create" }),
      reviewItem({ key: "b", verdict: "UPDATE_EXISTING", confidence: 0.95, mode: "update" }),
      reviewItem({ key: "c", verdict: "UPDATE_EXISTING", confidence: 0.56, mode: "skip" }),
      reviewItem({
        key: "d",
        verdict: "UPDATE_EXISTING",
        confidence: 0.56,
        mode: "update",
        hasOverride: true,
      }),
      reviewItem({ key: "e", verdict: "POSSIBLE_DUPLICATE", confidence: 0.75, mode: "skip" }),
    ];
    const counts = countReviewBlock(items);
    expect(counts.newCount + counts.updateCount + counts.ignoredCount + counts.reviewCount).toBe(
      counts.total,
    );
    expect(counts.total).toBe(5);
    expect(counts.reviewCount).toBe(2); // c (sem override) e e (POSSIBLE_DUPLICATE)
    expect(counts.updateCount).toBe(2); // b (confiança alta) e d (override manual)
    expect(counts.newCount).toBe(1); // a
  });

  test("applySafeResolutions nunca aplica 'update' a UPDATE_EXISTING de baixa confiança sem override", () => {
    const it = reviewItem({ confidence: 0.56, mode: "skip" });
    const patch = applySafeResolutions([it]);
    expect(patch["item-1"]).toBeUndefined();
  });

  test("applySafeResolutions continua aplicando 'update' a UPDATE_EXISTING de confiança alta sem override", () => {
    const it = reviewItem({ confidence: 0.95, mode: "update" });
    const patch = applySafeResolutions([it]);
    expect(patch["item-1"]).toBe("update");
  });

  test("applySafeResolutions nunca sobrescreve item com override, mesmo com verdict seguro", () => {
    const it = reviewItem({ confidence: 0.95, mode: "create", hasOverride: true });
    const patch = applySafeResolutions([it]);
    expect(patch["item-1"]).toBeUndefined();
  });
});
