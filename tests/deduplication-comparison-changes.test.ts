import { describe, expect, test } from "bun:test";
import { matchDecision, matchOpportunity } from "../src/lib/deduplication";
import type { OpportunityItem } from "../src/lib/domain";
import type { Decision } from "../src/lib/projects";

/* ------------------------------------------------------------------ *
 * Backlog B27B (18/10/2026) — painel de comparação no preview: `changes`
 * (src/lib/deduplication.ts) ganhou entradas por ENTIDADE, só acrescentando
 * — nunca removendo nem alterando o que já existia. Decisão: título NUNCA
 * entra (ver regra do consultor, 18/10/2026 — "Atualizar existente" mantém
 * o título); descrição e motivo entram quando mudam. Oportunidade:
 * `changes` deixou de ser sempre `[]` — benefício esperado entra quando
 * muda.
 * ------------------------------------------------------------------ */

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

const opportunity = (
  description: string,
  patch: Partial<OpportunityItem> = {},
): OpportunityItem => ({
  id: patch.id ?? "o1",
  client_id: patch.client_id ?? "c1",
  meeting_id: patch.meeting_id ?? null,
  description,
  expected_benefit: patch.expected_benefit ?? null,
  status: patch.status ?? "aberta",
  created_at: patch.created_at ?? "",
  embedding: patch.embedding ?? null,
});

describe("matchDecision — changes ganhou description/reason, título NUNCA entra", () => {
  test("descrição e motivo diferentes entram em changes, na ordem description, reason, owner, due_date, status", () => {
    const match = matchDecision(
      {
        title: "Montar balanço patrimonial detalhado",
        description: "Levantar todos os ativos e passivos do último trimestre.",
        reason: "Cliente precisa apresentar ao banco.",
        owner: "Maria",
        due_date: "2026-10-15",
        status: "aprovada",
      },
      [
        decision("Elaboração do balanço patrimonial", {
          description: "Levantar ativos.",
          reason: "Rotina mensal.",
          owner: "João",
          due_date: "2026-09-30",
          status: "pendente",
        }),
      ],
    );
    expect(match.changes.map((c) => c.field)).toEqual([
      "description",
      "reason",
      "owner",
      "due_date",
      "status",
    ]);
  });

  test("título nunca aparece em changes, mesmo quando o título proposto é bem diferente do existente", () => {
    const match = matchDecision({ title: "Título totalmente novo e diferente", owner: "Maria" }, [
      decision("Elaboração do balanço patrimonial", { owner: "João" }),
    ]);
    expect(match.changes.some((c) => c.field === "title")).toBe(false);
  });

  test("descrição/motivo iguais (normalizado) não entram em changes", () => {
    const match = matchDecision(
      {
        title: "Montar balanço patrimonial detalhado",
        description: "Levantar ativos.",
        reason: "Rotina mensal.",
        owner: "Maria",
      },
      [
        decision("Elaboração do balanço patrimonial", {
          description: "Levantar ativos.",
          reason: "Rotina mensal.",
          owner: "João",
        }),
      ],
    );
    expect(match.changes.some((c) => c.field === "description")).toBe(false);
    expect(match.changes.some((c) => c.field === "reason")).toBe(false);
  });

  test("descrição/motivo ausentes no existente: from vira '—'", () => {
    const match = matchDecision(
      {
        title: "Montar balanço patrimonial detalhado",
        description: "Levantar ativos.",
        reason: "Rotina mensal.",
      },
      [decision("Elaboração do balanço patrimonial")],
    );
    const descChange = match.changes.find((c) => c.field === "description");
    expect(descChange).toEqual({
      field: "description",
      label: "Descrição",
      from: "—",
      to: "Levantar ativos.",
    });
  });
});

describe("matchOpportunity — changes deixou de ser sempre [], ganhou expected_benefit", () => {
  test("benefício esperado diferente entra em changes", () => {
    const match = matchOpportunity(
      {
        description: "Upsell de consultoria financeira",
        expected_benefit: "Contrato de R$ 5.000/mês",
      },
      [
        opportunity("Upsell de consultoria financeira", {
          expected_benefit: "Contrato de R$ 3.000/mês",
        }),
      ],
    );
    expect(match.changes).toEqual([
      {
        field: "expected_benefit",
        label: "Benefício esperado",
        from: "Contrato de R$ 3.000/mês",
        to: "Contrato de R$ 5.000/mês",
      },
    ]);
  });

  test("benefício esperado igual (normalizado) não entra em changes — continua []", () => {
    const match = matchOpportunity(
      { description: "Upsell de consultoria financeira", expected_benefit: "Contrato mensal" },
      [opportunity("Upsell de consultoria financeira", { expected_benefit: "Contrato mensal" })],
    );
    expect(match.changes).toEqual([]);
  });

  test("sem match (NEW): changes continua []", () => {
    const match = matchOpportunity({ description: "Oportunidade totalmente nova e inédita" }, []);
    expect(match.type).toBe("NEW");
    expect(match.changes).toEqual([]);
  });

  test("benefício esperado ausente no existente: from vira '—'", () => {
    const match = matchOpportunity(
      { description: "Upsell de consultoria financeira", expected_benefit: "Contrato mensal" },
      [opportunity("Upsell de consultoria financeira")],
    );
    expect(match.changes).toEqual([
      { field: "expected_benefit", label: "Benefício esperado", from: "—", to: "Contrato mensal" },
    ]);
  });
});
