import { describe, expect, test } from "bun:test";
import {
  combinedSimilarity,
  DEDUPE_THRESHOLDS,
  defaultResolution,
  matchAction,
  matchDecision,
  needsHumanReview,
} from "../src/lib/deduplication";
import type { ActionItem } from "../src/lib/domain";
import type { Decision } from "../src/lib/projects";

const action = (description: string, patch: Partial<ActionItem> = {}): ActionItem => ({
  id: patch.id ?? "a1",
  client_id: patch.client_id ?? "c1",
  meeting_id: patch.meeting_id ?? null,
  description,
  owner_name: patch.owner_name ?? null,
  deadline: patch.deadline ?? null,
  priority: patch.priority ?? "média",
  status: patch.status ?? "em andamento",
  erp_area: patch.erp_area ?? null,
  evidence: patch.evidence ?? null,
  created_at: patch.created_at ?? "",
  updated_at: patch.updated_at ?? "",
  embedding: patch.embedding ?? null,
});

const decision = (title: string, patch: Partial<Decision> = {}): Decision => ({
  id: patch.id ?? "d1",
  project_id: patch.project_id ?? "p1",
  meeting_id: patch.meeting_id ?? null,
  client_id: patch.client_id ?? "c1",
  title,
  description: patch.description ?? null,
  reason: patch.reason ?? null,
  status: patch.status ?? "pendente",
  owner: patch.owner ?? null,
  due_date: patch.due_date ?? null,
  created_by: patch.created_by ?? null,
  created_at: patch.created_at ?? "",
  updated_at: patch.updated_at ?? "",
  embedding: patch.embedding ?? null,
});

const vec = (x: number, y: number): number[] => [x, y, 0, 0];

describe("GATE 12C — dedupe semântico contra histórico", () => {
  test("balanço patrimonial reformulado não vira NEW mesmo sem embedding histórico", () => {
    const match = matchDecision(
      { title: "Montar balanço patrimonial detalhado", embedding: null },
      [decision("Elaboração do balanço patrimonial", { embedding: null })],
    );
    expect(match.type).toBe("UPDATE_EXISTING");
    expect(match.confidence).toBeGreaterThanOrEqual(DEDUPE_THRESHOLDS.high);
  });

  test("balanço patrimonial e fluxo de caixa continuam entregas diferentes", () => {
    expect(
      matchDecision({ title: "Analisar fluxo de caixa" }, [decision("Montar balanço patrimonial")]).type,
    ).toBe("NEW");
  });

  test("consultar crédito e comparar custo do crédito continuam etapas diferentes", () => {
    expect(
      matchAction(
        { description: "Comparar custo do crédito com antecipação" },
        [action("Consultar linha de crédito")],
      ).type,
    ).toBe("NEW");
  });

  test("cobrar clientes e negociar fornecedores continuam entregas diferentes", () => {
    expect(
      matchAction(
        { description: "Negociar prazo com fornecedores" },
        [action("Cobrar clientes vencidos")],
      ).type,
    ).toBe("NEW");
  });

  test("a mesma action reformulada vira UPDATE_EXISTING", () => {
    const match = matchAction(
      { description: "Montar balanço patrimonial detalhado" },
      [action("Elaboração do balanço patrimonial")],
    );
    expect(match.type).toBe("UPDATE_EXISTING");
  });

  test("action equivalente com owner preenchido e conflitante exige revisão", () => {
    const match = matchAction(
      { description: "Montar balanço patrimonial detalhado", owner_name: "Maria" },
      [action("Elaboração do balanço patrimonial", { owner_name: "João" })],
    );
    expect(match.type).toBe("POSSIBLE_DUPLICATE");
    expect(needsHumanReview(match)).toBe(true);
  });

  test("action equivalente com prazo preenchido e conflitante exige revisão", () => {
    const match = matchAction(
      { description: "Montar balanço patrimonial detalhado", deadline: "2026-10-15" },
      [action("Elaboração do balanço patrimonial", { deadline: "2026-09-30" })],
    );
    expect(match.type).toBe("POSSIBLE_DUPLICATE");
  });

  test("action equivalente com prioridade preenchida e conflitante exige revisão", () => {
    const match = matchAction(
      { description: "Montar balanço patrimonial detalhado", priority: "alta" },
      [action("Elaboração do balanço patrimonial", { priority: "baixa" })],
    );
    expect(match.type).toBe("POSSIBLE_DUPLICATE");
  });

  test("action equivalente já encerrada exige revisão sem inventar novo status", () => {
    const match = matchAction(
      { description: "Montar balanço patrimonial detalhado" },
      [action("Elaboração do balanço patrimonial", { status: "concluída" })],
    );
    expect(match.type).toBe("POSSIBLE_DUPLICATE");
    expect(match.changes.some((change) => change.field === "status")).toBe(false);
  });

  test("decision equivalente com mais detalhe vira UPDATE_EXISTING", () => {
    expect(
      matchDecision(
        { title: "Montar balanço patrimonial detalhado" },
        [decision("Elaboração do balanço patrimonial")],
      ).type,
    ).toBe("UPDATE_EXISTING");
  });

  test("decision equivalente com metadado conflitante exige revisão", () => {
    const match = matchDecision(
      {
        title: "Montar balanço patrimonial detalhado",
        owner: "Maria",
        due_date: "2026-10-15",
        status: "aprovada",
      },
      [
        decision("Elaboração do balanço patrimonial", {
          owner: "João",
          due_date: "2026-09-30",
          status: "pendente",
        }),
      ],
    );
    expect(match.type).toBe("POSSIBLE_DUPLICATE");
    expect(match.changes.map((change) => change.field)).toEqual(["owner", "due_date", "status"]);
  });

  test("decision com mesmo título e escopo textual materialmente conflitante exige revisão", () => {
    const match = matchDecision(
      {
        title: "Montar balanço patrimonial",
        description: "Projetar cenários futuros de receitas e despesas",
      },
      [
        decision("Montar balanço patrimonial", {
          description: "Consolidar ativos imobilizados e passivos exigíveis",
        }),
      ],
    );
    expect(match.type).toBe("POSSIBLE_DUPLICATE");
    expect(match.reason).toContain("escopo textual");
  });

  test("decisions relacionadas mas materialmente diferentes continuam NEW", () => {
    expect(
      matchDecision(
        { title: "Comparar custo do crédito com antecipação" },
        [decision("Consultar linha de crédito")],
      ).type,
    ).toBe("NEW");
  });

  test("histórico sem embedding conserva fallback lexical", () => {
    const match = matchAction(
      { description: "Enviar proposta comercial atualizada", embedding: null },
      [action("Enviar proposta comercial atualizada", { embedding: null })],
    );
    expect(match.type).toBe("EXISTING");
    expect(match.confidence).toBe(1);
  });

  test("histórico com embedding usa combinedSimilarity", () => {
    const semantic = vec(0.8, 0.6);
    expect(combinedSimilarity("Zebra roxa", "Oceano verde", semantic, vec(1, 0))).toBeCloseTo(0.8, 10);
    expect(
      matchDecision(
        { title: "Zebra roxa", embedding: semantic },
        [decision("Oceano verde", { embedding: vec(1, 0) })],
      ).type,
    ).toBe("POSSIBLE_DUPLICATE");
  });

  test("POSSIBLE_DUPLICATE continua retido para revisão", () => {
    const match = matchDecision(
      { title: "Zebra roxa", embedding: vec(0.8, 0.6) },
      [decision("Oceano verde", { embedding: vec(1, 0) })],
    );
    expect(needsHumanReview(match)).toBe(true);
    expect(defaultResolution(match).mode).toBe("skip");
  });

  test("NEW continua possível", () => {
    expect(matchDecision({ title: "Fluxo de caixa" }, [decision("Balanço patrimonial")]).type).toBe("NEW");
  });

  test("thresholds globais permanecem 0.95/0.90/0.70", () => {
    expect(DEDUPE_THRESHOLDS).toEqual({ exact: 0.95, high: 0.9, review: 0.7 });
  });

  test("fixture Medeiros preserva a entrega e não funde a etapa de crédito", () => {
    const historicalDecision = decision("Elaboração do balanço patrimonial");
    const historicalActions = [
      action("Montar balanço patrimonial", { id: "balanco" }),
      action("Consultar banco sobre linha de crédito", { id: "credito" }),
    ];

    expect(matchDecision({ title: "Montar balanço patrimonial detalhado" }, [historicalDecision]).type).not.toBe("NEW");
    expect(matchAction({ description: "Elaborar balanço patrimonial detalhado" }, historicalActions).type).not.toBe("NEW");
    expect(
      matchAction(
        { description: "Comparar custo do crédito bancário com antecipação" },
        historicalActions,
      ).type,
    ).toBe("NEW");
  });

  test("matching puro não inventa owner nem prazo quando ausentes", () => {
    const match = matchAction(
      { description: "Montar balanço patrimonial detalhado" },
      [action("Elaboração do balanço patrimonial", { owner_name: null, deadline: null })],
    );
    expect(match.changes.some((change) => change.field === "owner_name")).toBe(false);
    expect(match.changes.some((change) => change.field === "deadline")).toBe(false);
  });

  describe("materialConflict não reclassifica matches fracos (< threshold de revisão)", () => {
    test("action genuinamente não relacionada com owner conflitante continua NEW", () => {
      const match = matchAction(
        { description: "Consultar linha de crédito de capital de giro", owner_name: "Maria" },
        [action("Avaliar taxas de aplicação financeira do caixa", { owner_name: "João", status: "concluída" })],
      );
      expect(match.confidence).toBeLessThan(DEDUPE_THRESHOLDS.review);
      expect(match.type).toBe("NEW");
    });

    test("decision genuinamente não relacionada com status conflitante continua NEW", () => {
      const match = matchDecision(
        { title: "Consultar linha de crédito de capital de giro", status: "aprovada" },
        [decision("Avaliar taxas de aplicação financeira do caixa", { status: "pendente" })],
      );
      expect(match.confidence).toBeLessThan(DEDUPE_THRESHOLDS.review);
      expect(match.type).toBe("NEW");
    });

    test("materialConflict continua exigindo revisão quando o match já era plausível (>= 0.70)", () => {
      const match = matchAction(
        { description: "Montar balanço patrimonial detalhado", owner_name: "Maria" },
        [action("Elaboração do balanço patrimonial", { owner_name: "João" })],
      );
      expect(match.confidence).toBeGreaterThanOrEqual(DEDUPE_THRESHOLDS.review);
      expect(match.type).toBe("POSSIBLE_DUPLICATE");
    });
  });
});
