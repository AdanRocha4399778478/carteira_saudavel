import { describe, expect, test } from "bun:test";
import { stripTactiqSummary } from "@/lib/tactiq-clean";

const WITH_SUMMARY = [
  "Elias - Bandrones 6.",
  "Meeting started: Jun 5, 2026, 2:31:14 PM",
  "Meeting duration: 25 minutes",
  "Meeting participants: Speaker 1, Speaker 2",
  "View original transcript at Tactiq.",
  "General - Summary and Action items",
  "Resumo breve",
  "Um parágrafo qualquer de resumo da reunião, com mais de uma frase.",
  "Itens de ação",
  "Speaker 1",
  "☐ uma tarefa",
  "Transcript",
  "00:00 Speaker 1.: Você é de Bandeirantes mesmo?",
  "00:03 Speaker 2.: Eu sou. É?",
].join("\n");

const HEADER_LINES = [
  "Elias - Bandrones 6.",
  "Meeting started: Jun 5, 2026, 2:31:14 PM",
  "Meeting duration: 25 minutes",
  "Meeting participants: Speaker 1, Speaker 2",
  "View original transcript at Tactiq.",
].join("\n");

const TRANSCRIPT_LINES = [
  "Transcript",
  "00:00 Speaker 1.: Você é de Bandeirantes mesmo?",
  "00:03 Speaker 2.: Eu sou. É?",
].join("\n");

describe("stripTactiqSummary", () => {
  test("remove o resumo e os itens de ação, mantendo cabeçalho e Transcript em diante", () => {
    const result = stripTactiqSummary(WITH_SUMMARY);
    expect(result).not.toContain("Resumo breve");
    expect(result).not.toContain("Itens de ação");
    expect(result).not.toContain("☐ uma tarefa");
    expect(result).not.toContain("General - Summary and Action items");
    expect(result).toContain(HEADER_LINES);
    expect(result).toContain(TRANSCRIPT_LINES);
    expect(result).toBe(`${HEADER_LINES}\n${TRANSCRIPT_LINES}`);
  });

  test("é idempotente", () => {
    const once = stripTactiqSummary(WITH_SUMMARY);
    const twice = stripTactiqSummary(once);
    expect(twice).toBe(once);
  });

  test("sem os marcadores, devolve o texto idêntico", () => {
    const plain = "Fala 1: olá\nFala 2: oi, tudo bem?";
    expect(stripTactiqSummary(plain)).toBe(plain);
  });

  test("com o título do resumo mas sem 'Transcript', devolve o texto idêntico", () => {
    const noTranscriptMarker = [
      "Meeting started: Jun 5, 2026, 2:31:14 PM",
      "General - Summary and Action items",
      "Resumo breve",
      "00:00 Speaker 1.: oi",
    ].join("\n");
    expect(stripTactiqSummary(noTranscriptMarker)).toBe(noTranscriptMarker);
  });
});
