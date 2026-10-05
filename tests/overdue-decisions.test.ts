import { describe, expect, test } from "bun:test";
import { getOverdueDecisions, type OverdueDecisionProjectRow } from "../src/lib/overdue-decisions";
import type { Decision } from "../src/lib/projects";

function makeDecision(overrides: Partial<Decision> & { id: string; project_id: string }): Decision {
  return {
    meeting_id: null,
    client_id: null,
    title: "Decisão",
    description: null,
    reason: null,
    status: "pendente",
    owner: null,
    due_date: "2000-01-01",
    created_by: null,
    created_at: "2000-01-01T00:00:00Z",
    updated_at: "2000-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeProject(
  overrides: Partial<OverdueDecisionProjectRow> & { projectId: string },
): OverdueDecisionProjectRow {
  return {
    projectName: "Projeto",
    clientId: "client-1",
    clientName: "Cliente",
    status: "ativo",
    ...overrides,
  };
}

const PAST = "2000-01-01";
const FUTURE = "2999-01-01";

function localDay(offsetDays: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("getOverdueDecisions", () => {
  test("decisão atrasada com projeto válido e cliente filtrado entra na lista", () => {
    const decisions = [makeDecision({ id: "d1", project_id: "p1", due_date: PAST })];
    const projects = [makeProject({ projectId: "p1", clientId: "c1", clientName: "Acme" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.total).toBe(1);
    expect(result.linhas).toHaveLength(1);
    expect(result.linhas[0]!.decisionId).toBe("d1");
    expect(result.descartadas).toBe(0);
    expect(result.excluidasPorProjetoEncerrado).toBe(0);
  });

  test("decisão não atrasada (sem due_date) não entra e não é contada em nenhum contador", () => {
    const decisions = [makeDecision({ id: "d1", project_id: "p1", due_date: null })];
    const projects = [makeProject({ projectId: "p1", clientId: "c1" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.total).toBe(0);
    expect(result.descartadas).toBe(0);
    expect(result.excluidasPorProjetoEncerrado).toBe(0);
  });

  test("decisão com status que não conta como vencida (ex.: implementada) não entra", () => {
    const decisions = [
      makeDecision({ id: "d1", project_id: "p1", due_date: PAST, status: "implementada" }),
    ];
    const projects = [makeProject({ projectId: "p1", clientId: "c1" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.total).toBe(0);
  });

  test("projeto ausente nos dados carregados vai para descartadas, não para excluidasPorProjetoEncerrado", () => {
    const decisions = [
      makeDecision({ id: "d1", project_id: "projeto-inexistente", due_date: PAST }),
    ];
    const result = getOverdueDecisions(decisions, [], new Set(["c1"]));
    expect(result.total).toBe(0);
    expect(result.linhas).toHaveLength(0);
    expect(result.descartadas).toBe(1);
    expect(result.excluidasPorProjetoEncerrado).toBe(0);
  });

  test("projeto concluido é excluído e contado em excluidasPorProjetoEncerrado", () => {
    const decisions = [makeDecision({ id: "d1", project_id: "p1", due_date: PAST })];
    const projects = [makeProject({ projectId: "p1", clientId: "c1", status: "concluido" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.total).toBe(0);
    expect(result.linhas).toHaveLength(0);
    expect(result.descartadas).toBe(0);
    expect(result.excluidasPorProjetoEncerrado).toBe(1);
  });

  test("projeto cancelado é excluído e contado em excluidasPorProjetoEncerrado", () => {
    const decisions = [makeDecision({ id: "d1", project_id: "p1", due_date: PAST })];
    const projects = [makeProject({ projectId: "p1", clientId: "c1", status: "cancelado" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.total).toBe(0);
    expect(result.excluidasPorProjetoEncerrado).toBe(1);
  });

  test("projetos planejamento, ativo e pausado entram normalmente", () => {
    const decisions = [
      makeDecision({ id: "d1", project_id: "p1", due_date: PAST }),
      makeDecision({ id: "d2", project_id: "p2", due_date: PAST }),
      makeDecision({ id: "d3", project_id: "p3", due_date: PAST }),
    ];
    const projects = [
      makeProject({ projectId: "p1", clientId: "c1", status: "planejamento" }),
      makeProject({ projectId: "p2", clientId: "c1", status: "ativo" }),
      makeProject({ projectId: "p3", clientId: "c1", status: "pausado" }),
    ];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.total).toBe(3);
    expect(result.excluidasPorProjetoEncerrado).toBe(0);
    expect(result.descartadas).toBe(0);
  });

  test("decisão cujo cliente do projeto não está em filteredIds não entra e não é contada", () => {
    const decisions = [makeDecision({ id: "d1", project_id: "p1", due_date: PAST })];
    const projects = [makeProject({ projectId: "p1", clientId: "c-fora-do-filtro" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.total).toBe(0);
    expect(result.descartadas).toBe(0);
    expect(result.excluidasPorProjetoEncerrado).toBe(0);
  });

  test("responsável vazio ou nulo vira 'Sem responsável'", () => {
    const decisions = [
      makeDecision({ id: "d1", project_id: "p1", due_date: PAST, owner: null }),
      makeDecision({ id: "d2", project_id: "p1", due_date: PAST, owner: "   " }),
    ];
    const projects = [makeProject({ projectId: "p1", clientId: "c1" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    const owners = result.linhas.map((l) => l.owner);
    expect(owners).toEqual(["Sem responsável", "Sem responsável"]);
  });

  test("ordena por maior atraso primeiro", () => {
    const decisions = [
      makeDecision({ id: "d-pouco-atraso", project_id: "p1", due_date: "2024-06-20" }),
      makeDecision({ id: "d-muito-atraso", project_id: "p1", due_date: "2000-01-01" }),
    ];
    const projects = [makeProject({ projectId: "p1", clientId: "c1" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.linhas.map((l) => l.decisionId)).toEqual(["d-muito-atraso", "d-pouco-atraso"]);
  });

  test("desempate por nome do cliente, depois por título", () => {
    const decisions = [
      makeDecision({ id: "d1", project_id: "p-b", due_date: PAST, title: "Zebra" }),
      makeDecision({ id: "d2", project_id: "p-a", due_date: PAST, title: "Banana" }),
      makeDecision({ id: "d3", project_id: "p-a", due_date: PAST, title: "Abacaxi" }),
    ];
    const projects = [
      makeProject({ projectId: "p-a", clientId: "c1", clientName: "Acme" }),
      makeProject({ projectId: "p-b", clientId: "c2", clientName: "Beta" }),
    ];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1", "c2"]));
    expect(result.linhas.map((l) => l.decisionId)).toEqual(["d3", "d2", "d1"]);
  });

  test("limita a 10 linhas, mas total reflete o número real de decisões atrasadas válidas", () => {
    const decisions = Array.from({ length: 14 }, (_, i) =>
      makeDecision({ id: `d${i}`, project_id: "p1", due_date: PAST, title: `Decisão ${i}` }),
    );
    const projects = [makeProject({ projectId: "p1", clientId: "c1" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.total).toBe(14);
    expect(result.linhas).toHaveLength(10);
  });

  test("data futura não é atrasada", () => {
    const decisions = [makeDecision({ id: "d1", project_id: "p1", due_date: FUTURE })];
    const projects = [makeProject({ projectId: "p1", clientId: "c1" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.total).toBe(0);
  });

  test("decisão com prazo de hoje não entra", () => {
    const decisions = [makeDecision({ id: "d1", project_id: "p1", due_date: localDay(0) })];
    const projects = [makeProject({ projectId: "p1", clientId: "c1" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.total).toBe(0);
    expect(result.descartadas).toBe(0);
    expect(result.excluidasPorProjetoEncerrado).toBe(0);
  });

  test("decisão com prazo de ontem entra com daysOverdue igual a 1", () => {
    const decisions = [makeDecision({ id: "d1", project_id: "p1", due_date: localDay(-1) })];
    const projects = [makeProject({ projectId: "p1", clientId: "c1" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.total).toBe(1);
    expect(result.linhas[0]!.daysOverdue).toBe(1);
  });

  test("dueDate da linha é igual ao due_date da decisão", () => {
    const dueDate = localDay(-3);
    const decisions = [makeDecision({ id: "d1", project_id: "p1", due_date: dueDate })];
    const projects = [makeProject({ projectId: "p1", clientId: "c1" })];
    const result = getOverdueDecisions(decisions, projects, new Set(["c1"]));
    expect(result.linhas[0]!.dueDate).toBe(dueDate);
  });
});
