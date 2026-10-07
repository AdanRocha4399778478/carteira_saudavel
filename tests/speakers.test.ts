import { describe, expect, test } from "bun:test";
import {
  applySingleSpeakerGuard,
  countDistinctSpeakers,
  isSingleSpeakerTranscript,
} from "@/lib/speakers";

describe("countDistinctSpeakers / isSingleSpeakerTranscript", () => {
  test("(a) formato da Chammas: um só falante, várias falas, mais cabeçalho com 'Meeting participants'", () => {
    const text = [
      "Meeting participants: Adan Rocha",
      "Transcript",
      "00:00 Adan R.: Bom dia, pessoal.",
      "00:05 Adan R.: Vamos começar pela DRE.",
      "00:10 Adan R.: O fluxo de caixa está organizado.",
      "00:15 Adan R.: Próximo ponto é a margem.",
      "00:20 Adan R.: Vamos fechar por aqui.",
    ].join("\n");

    expect(countDistinctSpeakers(text)).toBe(1);
    expect(isSingleSpeakerTranscript(text)).toBe(true);
  });

  test("(b) duas pessoas, 6 falas no total", () => {
    const text = [
      "00:00 Speaker 1.: Oi, tudo bem?",
      "00:03 Speaker 2.: Tudo, e você?",
      "00:06 Speaker 1.: Bem também.",
      "00:09 Speaker 2.: Vamos começar?",
      "00:12 Speaker 1.: Vamos.",
      "00:15 Speaker 2.: Ok.",
    ].join("\n");

    expect(countDistinctSpeakers(text)).toBe(2);
    expect(isSingleSpeakerTranscript(text)).toBe(false);
  });

  test("(c) formato da reunião interna: três rótulos distintos", () => {
    const text = [
      "00:00 Adan R.: Bom dia.",
      "00:05 Pedro N.: Bom dia.",
      "00:10 Joao H.: Bom dia.",
      "00:15 Adan R.: Vamos começar.",
      "00:20 Pedro N.: Pode ser.",
    ].join("\n");

    expect(countDistinctSpeakers(text)).toBe(3);
  });

  test("(d) sem rótulos no formato esperado: count 0 e single false", () => {
    const text = "fala solta sem horário, sem rótulo de falante";
    expect(countDistinctSpeakers(text)).toBe(0);
    expect(isSingleSpeakerTranscript(text)).toBe(false);
  });

  test("(e) um único falante, mas só 3 falas: single false (poucos dados)", () => {
    const text = [
      "00:00 Adan R.: Bom dia.",
      "00:05 Adan R.: Vamos começar.",
      "00:10 Adan R.: Só isso por hoje.",
    ].join("\n");

    expect(countDistinctSpeakers(text)).toBe(1);
    expect(isSingleSpeakerTranscript(text)).toBe(false);
  });

  test("(f) texto de uma linha só (como o pdf.js entrega a página), um único falante, várias falas", () => {
    const oneLine =
      "Chammas Corretora Meeting participants: Adan Rocha View original transcript at Tactiq. Transcript 00:00 Adan R.: Bom dia, pessoal. 00:05 Adan R.: Vamos começar. 00:10 Adan R.: Segue o fluxo. 00:15 Adan R.: Mais um ponto. 00:20 Adan R.: Encerrando aqui.";

    expect(countDistinctSpeakers(oneLine)).toBe(1);
    expect(isSingleSpeakerTranscript(oneLine)).toBe(true);
  });

  test("(g) horário no meio de uma frase comum não cria rótulo de falante", () => {
    const text = "00:00 Adan R.: às 14:30 vamos fazer assim: ok, combinado.";
    // só o rótulo real ("Adan R.") deve ser contado; "14:30 vamos fazer
    // assim:" não casa porque falta o "." antes dos dois-pontos.
    expect(countDistinctSpeakers(text)).toBe(1);
  });
});

describe("applySingleSpeakerGuard", () => {
  const buildResult = (overrides: Record<string, unknown> = {}) => ({
    identification: { client_name: "Cliente X" },
    analysis: {
      meeting: {
        executive_summary: "Resumo qualquer.",
        satisfaction_score: 8,
        value_score: 8,
        ...overrides,
      },
      decisions: [{ title: "Decisão qualquer" }],
    },
  });

  const SINGLE_SPEAKER_TRANSCRIPT = [
    "00:00 Adan R.: Bom dia.",
    "00:05 Adan R.: Vamos começar.",
    "00:10 Adan R.: Segue o fluxo.",
    "00:15 Adan R.: Mais um ponto.",
    "00:20 Adan R.: Encerrando aqui.",
  ].join("\n");

  const TWO_SPEAKERS_TRANSCRIPT = [
    "00:00 Speaker 1.: Oi, tudo bem?",
    "00:03 Speaker 2.: Tudo, e você?",
    "00:06 Speaker 1.: Bem também.",
    "00:09 Speaker 2.: Vamos começar?",
    "00:12 Speaker 1.: Vamos.",
  ].join("\n");

  test("com falante único, zera as duas notas e preserva o resto do objeto", () => {
    const result = buildResult();
    const guarded = applySingleSpeakerGuard(result, SINGLE_SPEAKER_TRANSCRIPT);

    const meeting = (guarded["analysis"] as Record<string, unknown>)["meeting"] as Record<
      string,
      unknown
    >;
    expect(meeting["satisfaction_score"]).toBeNull();
    expect(meeting["value_score"]).toBeNull();
    expect(meeting["executive_summary"]).toBe("Resumo qualquer.");
    expect(guarded["identification"]).toEqual({ client_name: "Cliente X" });
    expect((guarded["analysis"] as Record<string, unknown>)["decisions"]).toEqual([
      { title: "Decisão qualquer" },
    ]);
  });

  test("com dois falantes, não altera nada", () => {
    const result = buildResult();
    const guarded = applySingleSpeakerGuard(result, TWO_SPEAKERS_TRANSCRIPT);

    expect(guarded).toBe(result);
    const meeting = (guarded["analysis"] as Record<string, unknown>)["meeting"] as Record<
      string,
      unknown
    >;
    expect(meeting["satisfaction_score"]).toBe(8);
    expect(meeting["value_score"]).toBe(8);
  });

  test("sem 'analysis' no resultado, devolve o objeto igual, sem erro", () => {
    const result = { identification: { client_name: "Cliente X" } };
    const guarded = applySingleSpeakerGuard(result, SINGLE_SPEAKER_TRANSCRIPT);
    expect(guarded).toBe(result);
  });

  test("sem 'meeting' dentro de 'analysis', devolve o objeto igual, sem erro", () => {
    const result = { analysis: { decisions: [] } };
    const guarded = applySingleSpeakerGuard(result, SINGLE_SPEAKER_TRANSCRIPT);
    expect(guarded).toBe(result);
  });
});
