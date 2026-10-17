import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getOverdueEvaluations,
  isEvaluationOverdue,
  overdueEvaluationClientIds,
  type EvaluationDecisionRow,
} from "../src/lib/evaluation-overdue";

/* ------------------------------------------------------------------ *
 * Backlog B1 (16/10/2026) — alerta "avaliação vencida". Mesma definição
 * única de "decisão vencida" (isDecisionOverdue, domain.ts), restrita a
 * decisões marcadas is_evaluation. Exemplos neutros, com uma data de
 * referência fixa (2026-06-10) via Date real do sistema não é usada
 * aqui — domain.ts usa o relógio real, então os exemplos usam datas
 * claramente no passado/futuro para não depender do dia de hoje.
 * ------------------------------------------------------------------ */

const PAST = "2000-01-01";
const FAR_FUTURE = "2999-01-01";

function decision(overrides: { due_date: string | null; status: string; is_evaluation: boolean }) {
  return overrides;
}

describe("isEvaluationOverdue", () => {
  test("avaliação com prazo vencido e status pendente: vencida", () => {
    expect(
      isEvaluationOverdue(decision({ due_date: PAST, status: "pendente", is_evaluation: true })),
    ).toBe(true);
  });

  test("avaliação com prazo vencido e status aprovada/em_execucao: vencida também", () => {
    expect(
      isEvaluationOverdue(decision({ due_date: PAST, status: "aprovada", is_evaluation: true })),
    ).toBe(true);
    expect(
      isEvaluationOverdue(decision({ due_date: PAST, status: "em_execucao", is_evaluation: true })),
    ).toBe(true);
  });

  test("prazo no futuro: não alerta, mesmo sendo avaliação", () => {
    expect(
      isEvaluationOverdue(
        decision({ due_date: FAR_FUTURE, status: "pendente", is_evaluation: true }),
      ),
    ).toBe(false);
  });

  test("status 'implementada': não alerta, mesmo com prazo vencido (o alerta some quando o status muda)", () => {
    expect(
      isEvaluationOverdue(
        decision({ due_date: PAST, status: "implementada", is_evaluation: true }),
      ),
    ).toBe(false);
  });

  test("status 'cancelada': não alerta, mesmo com prazo vencido", () => {
    expect(
      isEvaluationOverdue(decision({ due_date: PAST, status: "cancelada", is_evaluation: true })),
    ).toBe(false);
  });

  test("decisão vencida mas NÃO é avaliação: não entra no alerta de avaliação vencida", () => {
    expect(
      isEvaluationOverdue(decision({ due_date: PAST, status: "pendente", is_evaluation: false })),
    ).toBe(false);
  });

  test("prazo igual a hoje: não alerta (hoje não é vencido)", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(
      isEvaluationOverdue(decision({ due_date: today, status: "pendente", is_evaluation: true })),
    ).toBe(false);
  });

  test("sem due_date: nunca vencida", () => {
    expect(
      isEvaluationOverdue(decision({ due_date: null, status: "pendente", is_evaluation: true })),
    ).toBe(false);
  });
});

describe("getOverdueEvaluations", () => {
  test("filtra só as decisões de avaliação vencidas, preservando os objetos originais", () => {
    const a = decision({ due_date: PAST, status: "pendente", is_evaluation: true });
    const b = decision({ due_date: PAST, status: "pendente", is_evaluation: false });
    const c = decision({ due_date: PAST, status: "implementada", is_evaluation: true });
    const d = decision({ due_date: FAR_FUTURE, status: "pendente", is_evaluation: true });
    expect(getOverdueEvaluations([a, b, c, d])).toEqual([a]);
  });

  test("lista vazia devolve lista vazia", () => {
    expect(getOverdueEvaluations([])).toEqual([]);
  });
});

function row(overrides: Partial<EvaluationDecisionRow> & { id: string }): EvaluationDecisionRow {
  return {
    status: "pendente",
    due_date: PAST,
    project_id: "project-1",
    project: { client_id: "client-1" },
    ...overrides,
  };
}

describe("overdueEvaluationClientIds — cliente vem do projeto, nunca de decisions.client_id", () => {
  test("decisão vencida com client_id embutido via project: entra no Set", () => {
    const ids = overdueEvaluationClientIds([row({ id: "d1" })]);
    expect(ids.has("client-1")).toBe(true);
  });

  test("duas decisões vencidas do mesmo cliente: Set não duplica", () => {
    const ids = overdueEvaluationClientIds([
      row({ id: "d1", project: { client_id: "client-1" } }),
      row({ id: "d2", project: { client_id: "client-1" } }),
    ]);
    expect(ids.size).toBe(1);
    expect([...ids]).toEqual(["client-1"]);
  });

  test("decisão não vencida: cliente não entra no Set", () => {
    const ids = overdueEvaluationClientIds([row({ id: "d1", due_date: FAR_FUTURE })]);
    expect(ids.size).toBe(0);
  });

  test("project null (projeto ausente): descartada, sem lançar erro", () => {
    const ids = overdueEvaluationClientIds([row({ id: "d1", project: null })]);
    expect(ids.size).toBe(0);
  });

  test("project.client_id null: descartada (nunca cai pra decisions.client_id, que nem existe nesta linha)", () => {
    const ids = overdueEvaluationClientIds([row({ id: "d1", project: { client_id: null } })]);
    expect(ids.size).toBe(0);
  });

  test("clientes diferentes: cada um entra no Set", () => {
    const ids = overdueEvaluationClientIds([
      row({ id: "d1", project: { client_id: "client-1" } }),
      row({ id: "d2", project: { client_id: "client-2" } }),
    ]);
    expect(ids).toEqual(new Set(["client-1", "client-2"]));
  });
});

describe("GATE B1 — evaluationDecisionsQuery, por inspeção estática (sem Supabase)", () => {
  const source = readFileSync(resolve(import.meta.dir, "../src/lib/evaluation-overdue.ts"), "utf8");

  test("filtra por is_evaluation = true no banco, não no cliente", () => {
    expect(source).toContain('.eq("is_evaluation", true)');
  });

  test("embute o client_id via a relação decisions.project_id -> projects.id, nunca decisions.client_id direto", () => {
    expect(source).toContain(
      '.select("id, status, due_date, project_id, project:projects(client_id)")',
    );
    expect(source).not.toContain('"client_id"');
    expect(source).not.toContain('.select("*")');
  });

  test("não seleciona a tabela projects inteira — só client_id, via embed", () => {
    expect(source).not.toContain("projects(*)");
    expect(source).toContain("project:projects(client_id)");
  });

  test("chave de query estável, para reaproveitamento entre as duas telas", () => {
    expect(source).toContain('queryKey: ["decisions", "evaluation-overdue"]');
  });
});
