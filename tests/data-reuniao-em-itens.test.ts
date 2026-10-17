import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatDate } from "../src/lib/domain";
import { getOverdueDecisions, type OverdueDecisionProjectRow } from "../src/lib/overdue-decisions";
import type { Decision } from "../src/lib/projects";

/* ------------------------------------------------------------------ *
 * Backlog B21 (17/10/2026) — data da reunião de origem em ações e
 * decisões, por embed no select das consultas já existentes
 * (meeting:meetings(meeting_date)), nas 4 telas: lista de Ações, aba
 * Ações do cliente, abas Ações/Decisões do projeto e painel "Decisões
 * atrasadas" da Visão Geral. Sem ordenação nova, sem consulta nova.
 * ------------------------------------------------------------------ */

function source(path: string): string {
  return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("formatDate — fallback reaproveitado para item sem reunião (B21)", () => {
  test("null/undefined vira '—', nunca 'Invalid Date' nem vazio", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
});

describe("GATE — lista global de Ações mostra a data da reunião (B21)", () => {
  const actionsPage = source("../src/routes/_authenticated/acoes/index.tsx");
  const api = source("../src/lib/api.ts");

  test("coluna 'Reunião' na tabela e leitura de a.meeting?.meeting_date", () => {
    expect(actionsPage).toContain("<TableHead>Reunião</TableHead>");
    expect(actionsPage).toContain("formatDate(a.meeting?.meeting_date)");
  });

  test("actionsQuery faz embed de meetings no select existente, mesma queryKey (sem consulta nova)", () => {
    expect(api).toContain('queryKey: ["actions"]');
    expect(api).toContain('.select("*, meeting:meetings(meeting_date)")');
  });

  test("ordenação por deadline não foi alterada", () => {
    expect(api).toContain('.order("deadline", { ascending: true })');
  });
});

describe("GATE — aba Ações do cliente mostra a data da reunião reaproveitando dados em memória (B21)", () => {
  const clientPage = source("../src/routes/_authenticated/clientes/$clientId.tsx");

  test("coluna 'Reunião' e lookup via meetings já carregado (sem select novo)", () => {
    expect(clientPage).toContain("<TableHead>Reunião</TableHead>");
    expect(clientPage).toContain("meetingDateById");
    expect(clientPage).toContain("new Map(meetings.map((m) => [m.id, m.meeting_date]))");
  });
});

describe("GATE — abas Ações e Decisões do projeto mostram a data da reunião reaproveitando dados em memória (B21)", () => {
  const projectPage = source("../src/routes/_authenticated/projetos/$projectId.tsx");

  test("lookup meetingDateById construído a partir de meetings.data já carregado", () => {
    expect(projectPage).toContain(
      "new Map((meetings.data ?? []).map((m) => [m.id, m.meeting_date]))",
    );
  });

  test("ação e decisão exibem 'reunião' com o lookup, sem nova consulta", () => {
    const occurrences = projectPage.match(/reunião\{" "\}/g) ?? [];
    expect(occurrences.length).toBe(2);
    expect(projectPage).toContain(
      "formatDate(a.meeting_id ? meetingDateById.get(a.meeting_id) : null)",
    );
    expect(projectPage).toContain(
      "formatDate(d.meeting_id ? meetingDateById.get(d.meeting_id) : null)",
    );
  });
});

describe("GATE — painel 'Decisões atrasadas' da Visão Geral mostra a data da reunião (B21)", () => {
  const overview = source("../src/routes/_authenticated/visao-geral.tsx");
  const healthPortfolio = source("../src/lib/health-portfolio.ts");

  test("linha do painel inclui 'Reunião' formatada", () => {
    expect(overview).toContain("Reunião {formatDate(d.meetingDate)}");
  });

  test("COCKPIT_DECISION_COLUMNS ganhou meeting_id e embed de meeting_date, sem query nova", () => {
    expect(healthPortfolio).toContain(
      '"id, project_id, title, status, due_date, owner, meeting_id, meeting:meetings(meeting_date)"',
    );
  });
});

describe("getOverdueDecisions — meetingDate repassado da decisão para a linha do painel (B21)", () => {
  const project: OverdueDecisionProjectRow = {
    projectId: "p1",
    projectName: "Projeto X",
    clientId: "c1",
    clientName: "Cliente X",
    status: "ativo",
  };

  function decision(overrides: Partial<Decision>): Decision {
    return {
      id: "d1",
      project_id: "p1",
      meeting_id: null,
      client_id: null,
      title: "Decisão",
      description: null,
      reason: null,
      status: "pendente",
      owner: "Fulano",
      due_date: "2000-01-01",
      created_by: null,
      created_at: "2000-01-01T00:00:00Z",
      updated_at: "2000-01-01T00:00:00Z",
      is_evaluation: false,
      ...overrides,
    };
  }

  test("com embed de meeting presente: meetingDate vem de decision.meeting.meeting_date", () => {
    const result = getOverdueDecisions(
      [decision({ meeting_id: "m1", meeting: { meeting_date: "2026-10-16" } })],
      [project],
      new Set(["c1"]),
    );
    expect(result.linhas[0]?.meetingDate).toBe("2026-10-16");
  });

  test("sem reunião vinculada: meetingDate é null (tela trata como '—')", () => {
    const result = getOverdueDecisions(
      [decision({ meeting_id: null, meeting: null })],
      [project],
      new Set(["c1"]),
    );
    expect(result.linhas[0]?.meetingDate).toBeNull();
    expect(formatDate(result.linhas[0]?.meetingDate)).toBe("—");
  });

  test("ordenação por dias de atraso e nome não foi alterada pela adição de meetingDate", () => {
    const result = getOverdueDecisions(
      [
        decision({ id: "d-less", title: "B", due_date: "2026-10-10" }),
        decision({ id: "d-more", title: "A", due_date: "2026-09-01" }),
      ],
      [project],
      new Set(["c1"]),
    );
    expect(result.linhas.map((l) => l.decisionId)).toEqual(["d-more", "d-less"]);
  });
});
