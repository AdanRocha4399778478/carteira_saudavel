import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  accountStatusFromRisk,
  buildRiskSignalsFromMeetings,
  computeRisk,
  type Meeting,
} from "../src/lib/domain";
import { recalculateClientWithSupabase } from "../src/lib/api";

/* ------------------------------------------------------------------ *
 * Backlog "risco sem dado" (17/10/2026) — nota de satisfação/valor
 * vazia é "sem dado" e não pontua risco; buildRiskSignalsFromMeetings
 * extrai a semântica já existente de recalculateClientWithSupabase sem
 * mudar o resultado. Exemplos neutros.
 * ------------------------------------------------------------------ */

function meeting(overrides: Partial<Meeting> & { id: string; meeting_date: string }): Meeting {
  return {
    client_id: "client-1",
    project_id: null,
    meeting_type: null,
    participants: [],
    executive_summary: null,
    satisfaction_score: null,
    satisfaction_classification: null,
    satisfaction_trend: null,
    satisfaction_justification: null,
    value_score: null,
    value_justification: null,
    measurable_result: null,
    has_measurable_result: false,
    main_pain: null,
    main_priority: null,
    main_result: null,
    next_action: null,
    action_owner: null,
    action_deadline: null,
    expansion_opportunity: null,
    explicit_complaint: false,
    continuity_doubt: false,
    low_client_adherence: false,
    missing_internal_owner: false,
    calculated_risk_score: 0,
    calculated_risk_level: "baixo",
    analysis_risk_level: null,
    analysis_quadrant: null,
    import_hash: null,
    created_by: null,
    created_at: "2000-01-01T00:00:00Z",
    delivery_clarity_rate: null,
    commitment_conversion_rate: null,
    ...overrides,
  };
}

/** Data "N dias atrás" em "AAAA-MM-DD", hora local — mesma convenção de daysSince. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

describe("buildRiskSignalsFromMeetings — nota nula não pontua (a)", () => {
  test("todas as notas nulas: satisfaction/valueScore nulos e os demais sinais falsos — nenhum ponto de nota", () => {
    const meetings = [
      meeting({ id: "m1", meeting_date: daysAgo(10) }),
      meeting({ id: "m2", meeting_date: daysAgo(40) }),
    ];
    const signals = buildRiskSignalsFromMeetings(meetings, 0);
    expect(signals.satisfaction).toBeNull();
    expect(signals.valueScore).toBeNull();
    expect(signals.explicitComplaint).toBe(false);
    expect(signals.continuityDoubt).toBe(false);
    expect(signals.lowAdherence).toBe(false);
    expect(signals.missingInternalOwner).toBe(false);

    const risk = computeRisk(signals);
    expect(risk.reasons.find((r) => r.label.includes("Satisfação"))).toBeUndefined();
    expect(risk.reasons.find((r) => r.label.includes("Valor gerado"))).toBeUndefined();
  });
});

describe("buildRiskSignalsFromMeetings — latestScored escolhe a reunião mais recente com nota (c)", () => {
  test("reunião mais recente sem nota, uma anterior com nota: usa a anterior, não null", () => {
    const meetings = [
      meeting({ id: "m-recent-no-score", meeting_date: daysAgo(5) }),
      meeting({
        id: "m-older-scored",
        meeting_date: daysAgo(20),
        satisfaction_score: 7,
        value_score: 8,
      }),
    ];
    const signals = buildRiskSignalsFromMeetings(meetings, 0);
    expect(signals.satisfaction).toBe(7);
    expect(signals.valueScore).toBe(8);
  });

  test("reunião mais recente já tem nota: usa ela mesma", () => {
    const meetings = [
      meeting({ id: "m1", meeting_date: daysAgo(5), satisfaction_score: 9, value_score: 9 }),
      meeting({ id: "m2", meeting_date: daysAgo(20), satisfaction_score: 2, value_score: 2 }),
    ];
    const signals = buildRiskSignalsFromMeetings(meetings, 0);
    expect(signals.satisfaction).toBe(9);
    expect(signals.valueScore).toBe(9);
  });

  test("daysSinceLastMeeting vem da reunião mais recente de QUALQUER tipo, mesmo sem nota", () => {
    const meetings = [
      meeting({ id: "m-recent-no-score", meeting_date: daysAgo(3) }),
      meeting({
        id: "m-older-scored",
        meeting_date: daysAgo(50),
        satisfaction_score: 7,
        value_score: 8,
      }),
    ];
    const signals = buildRiskSignalsFromMeetings(meetings, 0);
    expect(signals.daysSinceLastMeeting).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * Fake Supabase mínimo — mesmo padrão de
 * tests/compute-risk-evaluation-overdue.test.ts.
 * ------------------------------------------------------------------ */

type Resp = { data: unknown; error: { message: string; code?: string } | null };

function fakeSupabase(config: { select?: Record<string, Resp>; update?: Record<string, Resp> }) {
  function builder(table: string) {
    let isUpdate = false;
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      update: (payload: unknown) => {
        isUpdate = true;
        void payload;
        return chain;
      },
      then: (resolve: (r: Resp) => void) => {
        const resp = isUpdate
          ? (config.update?.[table] ?? { data: null, error: null })
          : (config.select?.[table] ?? { data: [], error: null });
        resolve(resp);
      },
    };
    return chain;
  }
  return { client: { from: (table: string) => builder(table) } };
}

const CLIENT_ROW = { id: "client-1", account_status: "ativo" };

describe("recalculateClientWithSupabase — caso Chammas: painel e gravado precisam bater (b)", () => {
  test("reuniões sem nota, última há 47 dias, uma avaliação vencida: score 3, nível 'médio'", async () => {
    const { client } = fakeSupabase({
      select: {
        meetings: {
          data: [
            {
              id: "m1",
              client_id: CLIENT_ROW.id,
              meeting_date: daysAgo(47),
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
          data: [
            { status: "pendente", due_date: "2000-01-01", project: { client_id: CLIENT_ROW.id } },
          ],
          error: null,
        },
      },
      update: { clients: { data: null, error: null } },
    });

    const risk = await recalculateClientWithSupabase(client as never, CLIENT_ROW.id);
    // Sem reunião há mais de 45 dias (+2) + avaliação vencida (+1) = 3.
    // has_measurable_result: true — a reunião registrou resultado mensurável
    // (campo independente de satisfação/valor), então "ausência de resultado
    // mensurável" não entra aqui.
    expect(risk.score).toBe(3);
    expect(risk.level).toBe("médio");
    expect(risk.reasons.map((r) => r.label)).not.toContain("Satisfação abaixo de 5");
    expect(risk.reasons.map((r) => r.label)).not.toContain("Valor gerado abaixo de 5");
    expect(risk.reasons.map((r) => r.label)).toContain("Avaliação vencida");

    // O MESMO cenário, pela MESMA função pura, dá o MESMO resultado que o painel usaria.
    const { buildRiskSignalsFromMeetings: build } = await import("../src/lib/domain");
    const panelSignals = build(
      [
        meeting({
          id: "m1",
          meeting_date: daysAgo(47),
          satisfaction_score: null,
          value_score: null,
          has_measurable_result: true,
        }),
      ],
      0,
    );
    const panelRisk = computeRisk(panelSignals, undefined, true);
    expect(panelRisk.score).toBe(risk.score);
    expect(panelRisk.level).toBe(risk.level);
    expect(accountStatusFromRisk(panelRisk.level)).toBe("atenção");
  });
});

describe("regressão — recalculateClientWithSupabase não muda para os cenários já cobertos (d)", () => {
  test("cliente com satisfação/valor baixos continua pontuando igual (comportamento preservado)", async () => {
    const { client } = fakeSupabase({
      select: {
        meetings: {
          data: [
            {
              id: "m1",
              client_id: CLIENT_ROW.id,
              meeting_date: daysAgo(2),
              satisfaction_score: 3,
              value_score: 3,
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
        decisions: { data: [], error: null },
      },
      update: { clients: { data: null, error: null } },
    });

    const risk = await recalculateClientWithSupabase(client as never, CLIENT_ROW.id);
    // satisfação < 5 (+3) + valor < 5 (+2) = 5
    expect(risk.score).toBe(5);
    expect(risk.level).toBe("médio");
  });
});

describe("GATE — painel não usa Number() sobre satisfaction_score/value_score, por inspeção estática (e)", () => {
  const source = readFileSync(
    resolve(import.meta.dir, "../src/routes/_authenticated/clientes/$clientId.tsx"),
    "utf8",
  );

  test("não existe mais Number(latest.satisfaction_score) nem Number(latest.value_score)", () => {
    expect(source).not.toContain("Number(latest.satisfaction_score)");
    expect(source).not.toContain("Number(latest.value_score)");
  });

  test("currentRisk usa buildRiskSignalsFromMeetings + computeRisk com hasOverdueEvaluation", () => {
    expect(source).toContain("buildRiskSignalsFromMeetings(clientMeetings, overdue.length)");
    expect(source).toContain("computeRisk(currentRiskSignals, riskRules, hasOverdueEvaluation)");
  });

  test("linha discreta de 'sem dado' quando satisfação/valor são nulos", () => {
    expect(source).toContain(
      "currentRiskSignals.satisfaction === null || currentRiskSignals.valueScore === null",
    );
    expect(source).toContain("Sem dado de satisfação/valor — não pontua risco");
    expect(source).toContain("text-muted-foreground");
  });
});
