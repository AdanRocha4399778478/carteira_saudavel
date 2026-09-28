import { describe, expect, test } from "bun:test";
import { isSafeVerdict, needsReview } from "../src/lib/review-blocks";
import { matchDecision } from "../src/lib/deduplication";
import type { Decision } from "../src/lib/projects";

/* ------------------------------------------------------------------ *
 * Mitigação mínima e isolada (antes do PR de comparação campo a campo):
 * um título quase idêntico ("Reajuste da tabela de preços") não pode
 * esconder um valor numérico diferente atrás de um veredito seguro.
 *
 * Achado original: com o mesmo título e a mesma data, só o percentual
 * divergindo (5% × 8%), `matchDecision` classificava como UPDATE_EXISTING
 * com confidence 1.0 e changes: [] — nenhum campo estruturado captura
 * percentual. Isso passava por DOIS portões: não é POSSIBLE_DUPLICATE
 * (o gate de aprovação do consultor não segura) e é isSafeVerdict
 * (é aplicado em lote por "Aplicar sugestões seguras", sem o consultor
 * nunca abrir o item). Resultado: perda de dado por padrão do sistema,
 * não por erro de uso.
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

describe("mitigação — número divergente em decisão nunca é UPDATE_EXISTING seguro", () => {
  const existing = decision("Reajuste da tabela de preços", {
    description: "Tabela será reajustada em 5% a partir de 1º de novembro.",
    reason: "Atualizar preços após mais de um ano de desatualização para melhorar previsibilidade de vendas.",
    owner: "Marcos",
    due_date: "2026-11-01",
  });

  test("mesmo título, mesma data, só o percentual diferente: vira POSSIBLE_DUPLICATE, não passa mais por isSafeVerdict", () => {
    const match = matchDecision(
      {
        title: "Reajuste da tabela de preços",
        description: "Tabela será reajustada em 8% a partir de 1º de novembro.",
        due_date: "2026-11-01",
        owner: "Marcos",
      },
      [existing],
    );
    expect(match.type).toBe("POSSIBLE_DUPLICATE");
    expect(match.reason).toContain("valor numérico");
    expect(isSafeVerdict(match.type)).toBe(false);
    expect(needsReview({ verdict: match.type, hasOverride: false })).toBe(true);
  });

  test("caso real do kit de teste (C7): datas TAMBÉM divergem (01/11 × 01/12) — já era pego pelo prazo antes desta mitigação, continua POSSIBLE_DUPLICATE", () => {
    const match = matchDecision(
      {
        title: "Reajuste da tabela de preços",
        description: "Tabela de preços será reajustada em 8% a partir de 1º de dezembro",
        due_date: "2026-12-01",
        owner: "Marcos",
      },
      [existing],
    );
    expect(match.type).toBe("POSSIBLE_DUPLICATE");
    expect(match.reason).toContain("prazo");
    expect(match.reason).toContain("valor numérico");
  });

  test("controle — mesmo título e mesmo número em ambos os lados não é tratado como conflito de valor", () => {
    const match = matchDecision(
      {
        title: "Reajuste da tabela de preços",
        description: "Tabela será reajustada em 5% a partir de 1º de novembro, conforme combinado.",
        due_date: "2026-11-01",
        owner: "Marcos",
      },
      [existing],
    );
    expect(match.type).toBe("UPDATE_EXISTING");
    expect(match.reason).not.toContain("valor numérico");
  });

  test("controle — nenhum dos dois lados tem número: não aciona a checagem (evita falso positivo por ausência de dado)", () => {
    const noNumberExisting = decision("Revisar processo de onboarding", {
      description: "Vamos revisar o processo de onboarding dos novos clientes.",
      due_date: "2026-11-01",
    });
    const match = matchDecision(
      {
        title: "Revisar processo de onboarding",
        description: "Vamos revisar o processo de onboarding dos novos clientes, com mais detalhe.",
        due_date: "2026-11-01",
      },
      [noNumberExisting],
    );
    expect(match.reason).not.toContain("valor numérico");
  });
});
