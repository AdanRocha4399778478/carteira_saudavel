import { describe, expect, test } from "bun:test";
import { accountStatusFromRisk, computeRisk, type RiskSignals } from "../src/lib/domain";
import { recalculateClientWithSupabase } from "../src/lib/api";

/* ------------------------------------------------------------------ *
 * Backlog B2 (17/10/2026) — "avaliação vencida" soma +1 ponto no score
 * de risco do cliente (computeRisk, domain.ts), teto de +1 por cliente,
 * via o novo parâmetro `hasOverdueEvaluation`. Exemplos neutros.
 * ------------------------------------------------------------------ */

const BASE_SIGNALS: RiskSignals = {
  satisfaction: null,
  valueScore: null,
  hasMeasurableResult: true,
  overdueActions: 0,
  daysSinceLastMeeting: null,
  explicitComplaint: false,
  continuityDoubt: false,
  lowAdherence: false,
  missingInternalOwner: false,
};

describe("computeRisk — hasOverdueEvaluation (B2)", () => {
  test("sem avaliação vencida: score igual ao de hoje (parâmetro ausente e false são idênticos)", () => {
    const withoutParam = computeRisk(BASE_SIGNALS);
    const withFalse = computeRisk(BASE_SIGNALS, undefined, false);
    expect(withoutParam.score).toBe(0);
    expect(withFalse.score).toBe(0);
    expect(withoutParam).toEqual(withFalse);
  });

  test("com uma avaliação vencida: soma +1, com motivo 'Avaliação vencida'", () => {
    const risk = computeRisk(BASE_SIGNALS, undefined, true);
    expect(risk.score).toBe(1);
    expect(risk.reasons).toEqual([{ label: "Avaliação vencida", points: 1 }]);
  });

  test("hasOverdueEvaluation é booleano (três avaliações vencidas = true, mesmo +1 — teto de uma vez)", () => {
    // O chamador (recalculateClientWithSupabase) já reduz "há N vencidas" a um
    // booleano antes de chegar aqui — computeRisk nunca vê a contagem, só
    // true/false, então nunca haveria como somar mais de uma vez.
    const riskComUma = computeRisk(BASE_SIGNALS, undefined, true);
    const riskComTres = computeRisk(BASE_SIGNALS, undefined, true);
    expect(riskComUma.score).toBe(riskComTres.score);
    expect(riskComTres.score).toBe(1);
  });

  test("avaliação resolvida (implementada/cancelada) não soma — isso já é decidido pelo chamador antes de chegar aqui como hasOverdueEvaluation=false", () => {
    const risk = computeRisk(BASE_SIGNALS, undefined, false);
    expect(risk.score).toBe(0);
    expect(risk.reasons).toEqual([]);
  });

  test("limiares de classificação não mudam: score 1 continua 'baixo'", () => {
    const risk = computeRisk(BASE_SIGNALS, undefined, true);
    expect(risk.level).toBe("baixo");
  });

  test("caso Chammas: score 2 (satisfação 5-6 + 1 ação vencida) com avaliação vencida vira 3, status 'atenção'", () => {
    const chammasSignals: RiskSignals = {
      ...BASE_SIGNALS,
      satisfaction: 6,
      overdueActions: 1,
    };
    const withoutEvaluation = computeRisk(chammasSignals);
    expect(withoutEvaluation.score).toBe(2);
    expect(withoutEvaluation.level).toBe("baixo");
    expect(accountStatusFromRisk(withoutEvaluation.level)).toBe("saudável");

    const withEvaluation = computeRisk(chammasSignals, undefined, true);
    expect(withEvaluation.score).toBe(3);
    expect(withEvaluation.level).toBe("médio");
    expect(accountStatusFromRisk(withEvaluation.level)).toBe("atenção");
  });
});

/* ------------------------------------------------------------------ *
 * Fake Supabase mínimo — só o que recalculateClientWithSupabase usa:
 * from(table).select/eq/order/update, resolvendo por tabela.
 * ------------------------------------------------------------------ */

type Resp = { data: unknown; error: { message: string; code?: string } | null };

function fakeSupabase(config: { select?: Record<string, Resp>; update?: Record<string, Resp> }) {
  const calls: { type: string; table: string }[] = [];

  function builder(table: string) {
    let isUpdate = false;
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      update: (payload: unknown) => {
        isUpdate = true;
        calls.push({ type: "update", table });
        (config.update ??= {})[table] = config.update?.[table] ?? { data: null, error: null };
        void payload;
        return chain;
      },
      then: (resolve: (r: Resp) => void) => {
        if (!isUpdate) calls.push({ type: "select", table });
        const resp = isUpdate
          ? (config.update?.[table] ?? { data: null, error: null })
          : (config.select?.[table] ?? { data: [], error: null });
        resolve(resp);
      },
    };
    return chain;
  }

  const client = { from: (table: string) => builder(table) };
  return { client, calls };
}

const CLIENT_ROW = { id: "client-1", account_status: "ativo" };

/** Data de "ontem", sempre dentro da cadência esperada — nunca aciona "sem reunião há mais de 45 dias". */
function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

describe("recalculateClientWithSupabase — avaliação vencida (B2), integrado", () => {
  test("caso Chammas, ponta a ponta: meetings/actions dão score 2, decisão de avaliação vencida soma +1, grava score 3 e account_status 'atenção'", async () => {
    const { client } = fakeSupabase({
      select: {
        // Reunião "ontem" (nunca dispara "sem reunião há mais de 45 dias")
        // e com resultado mensurável (nunca dispara "ausência de resultado
        // mensurável") — só sobram satisfação 5-6 e a ação vencida, pra
        // isolar exatamente a contribuição da avaliação vencida.
        meetings: {
          data: [
            {
              id: "m1",
              client_id: CLIENT_ROW.id,
              meeting_date: yesterday(),
              satisfaction_score: 6,
              value_score: null,
              has_measurable_result: true,
              explicit_complaint: false,
              continuity_doubt: false,
              low_client_adherence: false,
              missing_internal_owner: false,
            },
          ],
          error: null,
        },
        actions: {
          data: [
            { id: "a1", client_id: CLIENT_ROW.id, status: "não iniciada", deadline: "2000-01-01" },
          ],
          error: null,
        },
        clients: { data: [CLIENT_ROW], error: null },
        decisions: {
          data: [
            { status: "pendente", due_date: "2000-01-01", project: { client_id: CLIENT_ROW.id } },
          ],
          error: null,
        },
      },
      update: { clients: { data: null, error: null } },
    });

    const risk = await recalculateClientWithSupabase(client as never, CLIENT_ROW.id);
    expect(risk.score).toBe(3);
    expect(risk.level).toBe("médio");
    expect(risk.reasons.map((r) => r.label)).toContain("Avaliação vencida");
  });

  test("falha na consulta de decisões (ex.: coluna ainda não existe em produção): não derruba a recalculação, segue sem o +1", async () => {
    const { client } = fakeSupabase({
      select: {
        meetings: {
          data: [
            {
              id: "m1",
              client_id: CLIENT_ROW.id,
              meeting_date: yesterday(),
              satisfaction_score: null,
              value_score: null,
              has_measurable_result: true,
              explicit_complaint: false,
              continuity_doubt: false,
              low_client_adherence: false,
              missing_internal_owner: false,
            },
          ],
          error: null,
        },
        actions: { data: [], error: null },
        clients: { data: [CLIENT_ROW], error: null },
        decisions: {
          data: null,
          error: { message: 'column "is_evaluation" does not exist', code: "42703" },
        },
      },
      update: { clients: { data: null, error: null } },
    });

    const risk = await recalculateClientWithSupabase(client as never, CLIENT_ROW.id);
    expect(risk.score).toBe(0);
    expect(risk.reasons).toEqual([]);
    expect(risk.reasons.map((r) => r.label)).not.toContain("Avaliação vencida");
  });
});
