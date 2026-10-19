import { describe, expect, test } from "bun:test";
import {
  hasOwnerConflict,
  matchAction,
  matchDecision,
  normalizeOwnerSet,
} from "../src/lib/deduplication";
import { canonicalOwnerName, type ClientPerson } from "../src/lib/client-people";
import type { ActionItem } from "../src/lib/domain";
import type { Decision } from "../src/lib/projects";

/**
 * Gate "remove OWNER_ALIAS_SEED" (19/10/2026): a lista fixa de apelidos por
 * cliente (ex.: Grupo Erinho, "Ada" = "Adam") foi removida —
 * normalizeOwnerSet/hasOwnerConflict não conhecem mais clientId nenhum. Quem
 * unifica grafias divergentes agora é o cadastro de pessoas
 * (canonicalOwnerName), ANTES de qualquer comparação de duplicidade — ver
 * canonicalizeAnalysisOwners em MeetingAnalysisDialog.tsx (Gate F). Os
 * testes abaixo que dependiam do alias fixo do Erinho foram reescritos para
 * simular esse mesmo cadastro.
 */
const ERINHO_CLIENT_ID = "9943b0f4-5220-4297-9f17-7fee64280da5";

function erinhoPerson(overrides: Partial<ClientPerson> = {}): ClientPerson {
  return {
    id: "p1",
    client_id: ERINHO_CLIENT_ID,
    name: "Adam",
    aliases: ["Ada"],
    side: "cliente",
    role: null,
    functions: [],
    active: true,
    created_by: null,
    created_at: "2026-10-19T00:00:00Z",
    updated_at: "2026-10-19T00:00:00Z",
    ...overrides,
  };
}

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

describe("normalizeOwnerSet — valores reais da reunião de 05/06 do Grupo Erinho", () => {
  test('"Speaker 1" é rótulo genérico — conjunto vazio (desconhecido)', () => {
    expect(normalizeOwnerSet("Speaker 1")).toEqual(new Set());
  });

  test('"Speaker 2" também — conjunto vazio', () => {
    expect(normalizeOwnerSet("Speaker 2")).toEqual(new Set());
  });

  test('"Ada" sem alias de cliente: nome próprio isolado', () => {
    expect(normalizeOwnerSet("Ada")).toEqual(new Set(["ada"]));
  });

  test('"Adam" sem alias de cliente: nome próprio isolado', () => {
    expect(normalizeOwnerSet("Adam")).toEqual(new Set(["adam"]));
  });

  test('"Ada" canonizado pelo cadastro (equivalente ao antigo alias do Erinho): normalizeOwnerSet já recebe "Adam"', () => {
    const canonical = canonicalOwnerName("Ada", [erinhoPerson()]);
    expect(canonical).toBe("Adam");
    expect(normalizeOwnerSet(canonical)).toEqual(new Set(["adam"]));
  });

  test('"Erinho" isolado', () => {
    expect(normalizeOwnerSet("Erinho")).toEqual(new Set(["erinho"]));
  });

  test('"Equipe operacional/Erinho": "equipe" descartado (genérico), "erinho" fica', () => {
    expect(normalizeOwnerSet("Equipe operacional/Erinho")).toEqual(new Set(["erinho"]));
  });

  test('"Adam (consultor) e Erinho": parênteses removidos, dois nomes', () => {
    expect(normalizeOwnerSet("Adam (consultor) e Erinho")).toEqual(new Set(["adam", "erinho"]));
  });

  test('"Adam e Erinho": mesmo resultado sem o qualificador', () => {
    expect(normalizeOwnerSet("Adam e Erinho")).toEqual(new Set(["adam", "erinho"]));
  });

  test("valor ausente: conjunto vazio", () => {
    expect(normalizeOwnerSet(null)).toEqual(new Set());
    expect(normalizeOwnerSet(undefined)).toEqual(new Set());
    expect(normalizeOwnerSet("")).toEqual(new Set());
  });
});

describe("hasOwnerConflict — só conflita quando os dois lados têm nome conhecido e são disjuntos", () => {
  test('"Speaker 1" vs "Speaker 2": os dois desconhecidos, sem conflito', () => {
    expect(hasOwnerConflict("Speaker 1", "Speaker 2")).toBe(false);
  });

  test('"Ada" vs "Adam" SEM alias: conflito real (não sabemos que são a mesma pessoa)', () => {
    expect(hasOwnerConflict("Ada", "Adam")).toBe(true);
  });

  test('"Ada" vs "Adam": sem conflito quando os dois já chegam canonizados pelo cadastro (equivalente ao antigo alias do Erinho)', () => {
    const people = [erinhoPerson()];
    const incoming = canonicalOwnerName("Ada", people);
    const existing = canonicalOwnerName("Adam", people);
    expect(hasOwnerConflict(incoming, existing)).toBe(false);
  });

  test('"Erinho" vs "Equipe operacional/Erinho": interseção não vazia, sem conflito', () => {
    expect(hasOwnerConflict("Erinho", "Equipe operacional/Erinho")).toBe(false);
  });

  test('"Adam (consultor) e Erinho" vs "Erinho": interseção não vazia, sem conflito', () => {
    expect(hasOwnerConflict("Adam (consultor) e Erinho", "Erinho")).toBe(false);
  });

  test("nomes reais e distintos continuam gerando conflito (comportamento não regrediu)", () => {
    expect(hasOwnerConflict("Maria", "João")).toBe(true);
  });

  test("um lado desconhecido (rótulo genérico) e o outro nome real: sem conflito", () => {
    expect(hasOwnerConflict("Speaker 1", "Maria")).toBe(false);
  });

  test("um lado ausente: sem conflito", () => {
    expect(hasOwnerConflict(null, "Maria")).toBe(false);
    expect(hasOwnerConflict("Maria", null)).toBe(false);
  });
});

describe("Integração — reproduz o caso real que motivou a B3 (Grupo Erinho, 05/06)", () => {
  test('"Erinho" não gera mais conflito falso contra "Equipe operacional/Erinho" (mesma entrega)', () => {
    const match = matchAction(
      { description: "Organizar o pátio removendo carros desnecessários", owner_name: "Erinho" },
      [
        action("Organizar o pátio removendo carros desnecessários para melhorar fluxo", {
          owner_name: "Equipe operacional/Erinho",
          client_id: ERINHO_CLIENT_ID,
        }),
      ],
    );
    // O texto ainda muda (informativo — "changes" é diff bruto, não conflito material).
    expect(match.changes.some((c) => c.field === "owner_name")).toBe(true);
    // Mas não há conflito MATERIAL de responsável — a frase de conflito não aparece.
    expect(match.reason).not.toContain("conflito material");
    // Sem conflito de responsável, o texto quase idêntico deve virar atualização, não revisão forçada.
    expect(match.type).not.toBe("POSSIBLE_DUPLICATE");
  });

  test('"Ada" e "Adam" não geram conflito falso quando os dois já chegam canonizados pelo cadastro (ver canonicalizeAnalysisOwners, Gate F)', () => {
    const people = [erinhoPerson()];
    const match = matchDecision(
      {
        title: "Comunicar oficialmente a nova forma de remuneração",
        owner: canonicalOwnerName("Ada", people),
      },
      [
        decision("Comunicar oficialmente a nova forma de remuneração baseada em comissão", {
          owner: canonicalOwnerName("Adam", people),
          client_id: ERINHO_CLIENT_ID,
        }),
      ],
    );
    expect(match.type).not.toBe("POSSIBLE_DUPLICATE");
  });

  test('"Speaker 1" vs "Speaker 2" (dois desconhecidos) não bloqueia a atualização por conflito de responsável', () => {
    const match = matchAction(
      { description: "Consultar quando houver dúvida sobre categorias da planilha", owner_name: "Speaker 1" },
      [
        action("Consultar quando houver dúvida sobre categorias e preenchimento da planilha", {
          owner_name: "Speaker 2",
        }),
      ],
    );
    expect(match.changes.some((c) => c.field === "owner_name")).toBe(false);
  });
});
