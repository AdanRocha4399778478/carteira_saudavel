import { describe, expect, test } from "bun:test";
import {
  annotateOrigin,
  defaultResolution,
  matchAction,
  matchOpportunity,
  matchRisk,
} from "../src/lib/deduplication";
import type { ActionItem, OpportunityItem, RiskItem } from "../src/lib/domain";

const action = (description: string, patch: Partial<ActionItem> = {}): ActionItem => ({
  id: patch.id ?? "a1",
  client_id: patch.client_id ?? "c1",
  meeting_id: patch.meeting_id ?? null,
  description,
  owner_name: patch.owner_name ?? null,
  deadline: patch.deadline ?? null,
  priority: patch.priority ?? "média",
  status: patch.status ?? "não iniciada",
  erp_area: patch.erp_area ?? null,
  evidence: patch.evidence ?? null,
  created_at: patch.created_at ?? "",
  updated_at: patch.updated_at ?? "",
  embedding: patch.embedding ?? null,
});

const risk = (description: string, patch: Partial<RiskItem> = {}): RiskItem => ({
  id: patch.id ?? "r1",
  client_id: patch.client_id ?? "c1",
  meeting_id: patch.meeting_id ?? null,
  description,
  level: patch.level ?? "médio",
  active: patch.active ?? true,
  created_at: patch.created_at ?? "",
  embedding: patch.embedding ?? null,
});

const opportunity = (description: string, patch: Partial<OpportunityItem> = {}): OpportunityItem => ({
  id: patch.id ?? "o1",
  client_id: patch.client_id ?? "c1",
  meeting_id: patch.meeting_id ?? null,
  description,
  expected_benefit: patch.expected_benefit ?? null,
  status: patch.status ?? "aberta",
  created_at: patch.created_at ?? "",
  embedding: patch.embedding ?? null,
});

/** Vetor 2D normalizado cujo cosine contra (1,0) é exatamente `cos`. */
const vecWithCosine = (cos: number): number[] => [cos, Math.sqrt(1 - cos * cos)];
const REF_VEC = [1, 0];

describe("Frente 1 — ranking status-aware (ações/riscos/oportunidades)", () => {
  test("ação aberta com score menor vence concluída com score maior DENTRO da margem (0,05)", () => {
    const match = matchAction(
      { description: "Revisar contrato de fornecimento", embedding: REF_VEC },
      [
        action("Assunto totalmente não relacionado ao texto novo", {
          id: "done-1",
          status: "concluída",
          embedding: vecWithCosine(0.83),
        }),
        action("Outro assunto sem relação nenhuma com a entrada", {
          id: "open-1",
          status: "não iniciada",
          embedding: vecWithCosine(0.8),
        }),
      ],
    );
    // Concluída pontuou 0,03 acima (dentro da margem de 0,05) — o aberto vence.
    expect(match.existing_id).toBe("open-1");
    expect(match.existingStatusClass).toBe("open");
    expect(match.historyFlag).toBeNull();
  });

  test("ação concluída vence quando o score está FORA da margem", () => {
    const match = matchAction(
      { description: "Revisar contrato de fornecimento", embedding: REF_VEC },
      [
        action("Assunto totalmente não relacionado ao texto novo", {
          id: "done-1",
          status: "concluída",
          embedding: vecWithCosine(0.94),
        }),
        action("Outro assunto sem relação nenhuma com a entrada", {
          id: "open-1",
          status: "não iniciada",
          embedding: vecWithCosine(0.5),
        }),
      ],
    );
    expect(match.existing_id).toBe("done-1");
    expect(match.existingStatusClass).toBe("done");
    expect(match.historyFlag).toBe("recurrence");
  });

  test("ação cancelada gera historyFlag 'previously_discarded'", () => {
    const match = matchAction(
      { description: "Revisar contrato de fornecimento", embedding: REF_VEC },
      [action("Assunto sem relação nenhuma", { id: "cancel-1", status: "cancelada", embedding: vecWithCosine(0.8) })],
    );
    expect(match.existingStatusClass).toBe("dismissed");
    expect(match.historyFlag).toBe("previously_discarded");
  });

  test("risco inativo é tratado como 'done' (sem estado 'dismissed' distinto)", () => {
    const match = matchRisk(
      { description: "Atraso na entrega dos relatórios financeiros" },
      [risk("Atraso na entrega dos relatórios financeiros", { id: "inactive-1", active: false })],
    );
    expect(match.existingStatusClass).toBe("done");
    expect(match.historyFlag).toBe("recurrence");
  });

  test("oportunidade fechada → 'recurrence'; descartada → 'previously_discarded'", () => {
    const closed = matchOpportunity(
      { description: "Expandir contrato para novo módulo financeiro" },
      [opportunity("Expandir contrato para novo módulo financeiro", { id: "closed-1", status: "fechada" })],
    );
    expect(closed.historyFlag).toBe("recurrence");

    const discarded = matchOpportunity(
      { description: "Expandir contrato para novo módulo financeiro" },
      [opportunity("Expandir contrato para novo módulo financeiro", { id: "discarded-1", status: "descartada" })],
    );
    expect(discarded.historyFlag).toBe("previously_discarded");
  });

  // matchAction tem uma escalada própria para POSSIBLE_DUPLICATE quando o
  // vencedor já está concluído/cancelado (conflito material de "status"),
  // então já não caía em "update" silencioso mesmo antes desta Frente — mas
  // matchOpportunity não tem esse mecanismo, e é onde a lacuna era real.
  test("historyFlag 'recurrence' nunca decide 'update' sozinho — defaultResolution cai para 'skip'", () => {
    const match = matchOpportunity(
      { description: "Expandir contrato para novo módulo financeiro", embedding: REF_VEC },
      [opportunity("Assunto sem relação nenhuma com a entrada", { id: "done-1", status: "fechada", embedding: vecWithCosine(0.92) })],
    );
    expect(match.type).toBe("UPDATE_EXISTING");
    expect(match.historyFlag).toBe("recurrence");
    // Sem a trava, o default seria "update" (reabrir uma oportunidade já fechada em silêncio).
    expect(defaultResolution(match).mode).toBe("skip");
  });

  test("historyFlag 'previously_discarded' também força 'skip', mesmo em verdict UPDATE_EXISTING", () => {
    const match = matchOpportunity(
      { description: "Expandir contrato para novo módulo financeiro", embedding: REF_VEC },
      [opportunity("Assunto sem relação nenhuma", { id: "discard-1", status: "descartada", embedding: vecWithCosine(0.92) })],
    );
    expect(match.type).toBe("UPDATE_EXISTING");
    expect(match.historyFlag).toBe("previously_discarded");
    expect(defaultResolution(match).mode).toBe("skip");
  });

  test("sem historyFlag (item aberto), UPDATE_EXISTING continua com default 'update' — sem regressão", () => {
    const match = matchOpportunity(
      { description: "Expandir contrato para novo módulo financeiro", embedding: REF_VEC },
      [opportunity("Assunto sem relação nenhuma", { id: "open-1", status: "aberta", embedding: vecWithCosine(0.92) })],
    );
    expect(match.historyFlag).toBeNull();
    expect(defaultResolution(match).mode).toBe("update");
  });

  test("item em outro projeto do mesmo cliente: matchedProjectId aponta para a origem", () => {
    const match = matchAction({ description: "Revisar contrato de fornecimento" }, [
      action("Revisar contrato de fornecimento", { id: "a-other-project" }),
    ]);
    const annotated = annotateOrigin(match, "project-b", "project-a", new Map([["project-b", "Financeiro"]]));
    expect(annotated.matchedProjectId).toBe("project-b");
    expect(annotated.reason).toContain("Financeiro");
  });

  test("mesmo projeto: matchedProjectId preenchido, sem texto de origem anexado", () => {
    const match = matchAction({ description: "Revisar contrato de fornecimento" }, [
      action("Revisar contrato de fornecimento", { id: "a-same-project" }),
    ]);
    const annotated = annotateOrigin(match, "project-a", "project-a", new Map());
    expect(annotated.matchedProjectId).toBe("project-a");
    expect(annotated.reason).toBe(match.reason);
  });
});

describe("Frente 1 — regressão: sem competição de status, veredito idêntico ao atual", () => {
  test("cosine real 0,658 (Revisar Conta Azul vs. categorização de lançamentos) — único candidato aberto", () => {
    const match = matchAction(
      { description: "Revisar e categorizar corretamente os lançamentos do extrato", embedding: vecWithCosine(0.658) },
      [action("Revisar dados do sistema financeiro para avaliação do fluxo de caixa", { embedding: REF_VEC })],
    );
    expect(match.type).toBe("NEW");
    expect(match.existingStatusClass).toBeNull();
    expect(match.historyFlag).toBeNull();
  });

  test("cosine real 0,612 (modelo de remuneração vs. meritocracia) — único candidato aberto", () => {
    const match = matchAction(
      { description: "Implementação do modelo de pagamento baseado em meritocracia", embedding: vecWithCosine(0.612) },
      [action("Aguardar mais meses de dados para finalizar modelo de remuneração", { embedding: REF_VEC })],
    );
    expect(match.type).toBe("NEW");
  });

  test("candidato aberto com score baixo (0,553) e texto sem núcleo comum — único candidato, sem concorrência de status", () => {
    // Nota: o cosine real 0,553 da consolidação de carteira assinada (ver
    // docs/requisito-*) não serve de fixture aqui — aquele par tem o MESMO
    // núcleo lexical ("assinar carteira... colaborador"), então
    // deliverableRelation o classifica como "same" e o score é elevado ao
    // piso de DEDUPE_THRESHOLDS.high (0,90) independentemente do cosine cru
    // (verificado: vira UPDATE_EXISTING a 90%, não reflete 0,553). Usar um
    // par sem núcleo comum para isolar de fato o efeito do cosine puro.
    const match = matchAction(
      { description: "Renegociar prazo de entrega do fornecedor externo", embedding: REF_VEC },
      [action("Organizar arquivo físico do escritório antigo", { embedding: vecWithCosine(0.553) })],
    );
    expect(match.type).toBe("NEW");
    expect(match.existingStatusClass).toBeNull();
    expect(match.historyFlag).toBeNull();
  });
});
