import { describe, expect, test } from "bun:test";
import { stripTactiqBoilerplate, stripTactiqSummary } from "@/lib/tactiq-clean";

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

  test("variante sem o prefixo 'General - ' (ex.: export da Chammas Corretora)", () => {
    const CHAMMAS_HEADER_LINES = [
      "Chammas Corretora",
      "Meeting started: Jun 5, 2026, 2:31:14 PM",
      "Meeting duration: 61 minutes",
      "Meeting participants: Adan Rocha",
      "View original transcript at Tactiq.",
    ].join("\n");
    const CHAMMAS_TRANSCRIPT_LINES = [
      "Transcript",
      "00:00 Adan R.: Bom dia, pessoal.",
      "00:03 Adan R.: Vamos começar.",
    ].join("\n");
    const chammasWithSummary = [
      CHAMMAS_HEADER_LINES,
      "Summary and Action items",
      "Quick summary",
      "Um parágrafo qualquer de resumo da reunião.",
      "Action items for Adan Rocha",
      "☑ item concluído",
      "☐ item pendente",
      CHAMMAS_TRANSCRIPT_LINES,
    ].join("\n");

    const result = stripTactiqSummary(chammasWithSummary);
    expect(result).not.toContain("Quick summary");
    expect(result).not.toContain("Action items for Adan Rocha");
    expect(result).not.toContain("☑ item concluído");
    expect(result).not.toContain("☐ item pendente");
    expect(result).not.toContain("Summary and Action items");
    expect(result).toContain(CHAMMAS_HEADER_LINES);
    expect(result).toContain(CHAMMAS_TRANSCRIPT_LINES);
    expect(result).toBe(`${CHAMMAS_HEADER_LINES}\n${CHAMMAS_TRANSCRIPT_LINES}`);

    const twice = stripTactiqSummary(result);
    expect(twice).toBe(result);
  });

  test("título sem prefixo mas sem 'Transcript', devolve o texto idêntico", () => {
    const noTranscriptMarker = [
      "Meeting started: Jun 5, 2026, 2:31:14 PM",
      "Summary and Action items",
      "Quick summary",
      "00:00 Adan R.: oi",
    ].join("\n");
    expect(stripTactiqSummary(noTranscriptMarker)).toBe(noTranscriptMarker);
  });

  test("título presente e 'Transcript' presente, mas não seguido de horário, devolve o texto idêntico", () => {
    const transcriptNotFollowedByTime = [
      "Meeting started: Jun 5, 2026, 2:31:14 PM",
      "Summary and Action items",
      "Quick summary",
      "Transcript",
      "sem horário aqui",
    ].join("\n");
    expect(stripTactiqSummary(transcriptNotFollowedByTime)).toBe(transcriptNotFollowedByTime);
  });
});

describe("stripTactiqSummary — texto de uma linha (como o pdf.js entrega a página)", () => {
  test("variante 'Summary and Action items' + 'Quick summary' + 'Action items for <nome>'", () => {
    const oneLine =
      "Chammas Corretora Meeting started: Apr 6, 2026, 3:55:23 PM Meeting duration: 61 minutes Meeting participants: Adan Rocha View original transcript at Tactiq. Summary and Action items Quick summary Um resumo. Action items for Adan Rocha ☑ item ☐ item\n\nTranscript 00:00 Adan R.: Bom dia";
    const result = stripTactiqSummary(oneLine);
    expect(result).toContain("Meeting participants: Adan Rocha");
    expect(result).toContain("Transcript 00:00 Adan R.: Bom dia");
    expect(result).not.toContain("Quick summary");
    expect(result).not.toContain("Action items for");
    expect(result).not.toContain("Um resumo.");
  });

  test("variante 'General - Summary and Action items' + 'Resumo breve' + 'Itens de ação'", () => {
    const oneLine =
      "Elias - Bandrones 6. Meeting started: Jun 5, 2026, 2:31:14 PM Meeting participants: Adan Rocha View original transcript at Tactiq. General - Summary and Action items Resumo breve Um resumo qualquer. Itens de ação ☐ item\n\nTranscript 00:00 Adan R.: Bom dia";
    const result = stripTactiqSummary(oneLine);
    expect(result).toContain("Meeting participants: Adan Rocha");
    expect(result).toContain("Transcript 00:00 Adan R.: Bom dia");
    expect(result).not.toContain("Resumo breve");
    expect(result).not.toContain("Itens de ação");
  });

  test("variante 'Summary and Action items' + 'Resumo' + 'Action items' (sem 'for <nome>')", () => {
    const oneLine =
      "Chammas 08.05.2026 Meeting started: May 8, 2026, 11:42:57 PM Meeting participants: Adan Rocha View original transcript at Tactiq. Summary and Action items Resumo um resumo qualquer. Action items ☐ item\n\nTranscript 00:00 Adan R.: Bom dia";
    const result = stripTactiqSummary(oneLine);
    expect(result).toContain("Meeting participants: Adan Rocha");
    expect(result).toContain("Transcript 00:00 Adan R.: Bom dia");
    expect(result).not.toContain("Resumo um resumo qualquer.");
    expect(result).not.toContain("Action items");
  });

  test("variante 'Short summary' + 'Resumo da reunião' (sem lista de ações)", () => {
    const oneLine =
      "Chammas 15.06.2026 Meeting started: Jun 15, 2026, 2:07:00 PM Meeting participants: Adan Rocha View original transcript at Tactiq. Short summary Resumo da reunião: um resumo qualquer.\n\nTranscript 00:00 Adan R.: Bom dia";
    const result = stripTactiqSummary(oneLine);
    expect(result).toContain("Meeting participants: Adan Rocha");
    expect(result).toContain("Transcript 00:00 Adan R.: Bom dia");
    expect(result).not.toContain("Resumo da reunião");
    expect(result).not.toContain("Short summary");
  });

  test("controle: texto de uma linha SEM título, com 'Transcript 00:00', sai idêntico", () => {
    const oneLine =
      "Chammas Corretora Meeting started: Apr 6, 2026, 3:55:23 PM Meeting participants: Adan Rocha View original transcript at Tactiq.\n\nTranscript 00:00 Adan R.: Bom dia";
    expect(stripTactiqSummary(oneLine)).toBe(oneLine);
  });

  test("controle: 'Short summary' dentro de uma fala, DEPOIS do 'Transcript <horário>', não é cortado", () => {
    const oneLine =
      "Chammas Corretora Meeting participants: Adan Rocha View original transcript at Tactiq.\n\nTranscript 00:00 Adan R.: Hoje eu quero falar sobre o Short summary que vi num curso.";
    expect(stripTactiqSummary(oneLine)).toBe(oneLine);
  });

  test("título presente mas sem 'Transcript <horário>', sai idêntico", () => {
    const oneLine =
      "Chammas Corretora Meeting participants: Adan Rocha View original transcript at Tactiq. Summary and Action items Quick summary Um resumo.";
    expect(stripTactiqSummary(oneLine)).toBe(oneLine);
  });

  test("'Transcript' seguido de texto que não é horário, sai idêntico", () => {
    const oneLine =
      "Chammas Corretora Meeting participants: Adan Rocha. Summary and Action items Quick summary Um resumo. Transcript sem horário aqui";
    expect(stripTactiqSummary(oneLine)).toBe(oneLine);
  });

  test("idempotente na variante de uma linha", () => {
    const oneLine =
      "Chammas Corretora Meeting started: Apr 6, 2026, 3:55:23 PM Meeting participants: Adan Rocha View original transcript at Tactiq. Summary and Action items Quick summary Um resumo. Action items for Adan Rocha ☑ item ☐ item\n\nTranscript 00:00 Adan R.: Bom dia";
    const once = stripTactiqSummary(oneLine);
    const twice = stripTactiqSummary(once);
    expect(twice).toBe(once);
  });
});

describe("stripTactiqBoilerplate", () => {
  const PHRASE_PT =
    "Olá, estou transcrevendo esta chamada com minha extensão Tactiq AI. https://tactiq.io/r/transcribing";

  test("remove a frase uma vez, apagando o espaço que sobra", () => {
    const text = `00:05 Speaker 1.: ${PHRASE_PT} oi pessoal`;
    expect(stripTactiqBoilerplate(text)).toBe("00:05 Speaker 1.: oi pessoal");
  });

  test("remove a frase repetida duas vezes na mesma linha", () => {
    const text = `00:05 Speaker 1.: ${PHRASE_PT} ${PHRASE_PT} oi pessoal`;
    expect(stripTactiqBoilerplate(text)).toBe("00:05 Speaker 1.: oi pessoal");
  });

  test("deixa uma fala sem a frase intacta", () => {
    const text = "00:00 Speaker 1.: Você é de Bandeirantes mesmo?";
    expect(stripTactiqBoilerplate(text)).toBe(text);
  });

  test("texto vazio sai vazio", () => {
    expect(stripTactiqBoilerplate("")).toBe("");
  });
});

describe("stripTactiqBoilerplate + stripTactiqSummary encadeados", () => {
  test("devolve o cabeçalho e as falas sem o resumo e sem a frase de propaganda", () => {
    const PHRASE_PT =
      "Olá, estou transcrevendo esta chamada com minha extensão Tactiq AI. https://tactiq.io/r/transcribing";
    const HEADER = [
      "Chammas Corretora",
      "Meeting started: Jun 5, 2026, 2:31:14 PM",
      "Meeting duration: 61 minutes",
      "Meeting participants: Adan Rocha",
      "View original transcript at Tactiq.",
    ].join("\n");
    const rawTranscript = [
      "Transcript",
      `00:00 Adan R.: ${PHRASE_PT} Bom dia, pessoal.`,
      "00:03 Adan R.: Vamos começar.",
    ].join("\n");
    const expectedTranscript = [
      "Transcript",
      "00:00 Adan R.: Bom dia, pessoal.",
      "00:03 Adan R.: Vamos começar.",
    ].join("\n");
    const input = [
      HEADER,
      "Summary and Action items",
      "Quick summary",
      "Um resumo qualquer.",
      "Action items for Adan Rocha",
      "☐ item pendente",
      rawTranscript,
    ].join("\n");

    const result = stripTactiqBoilerplate(stripTactiqSummary(input));
    expect(result).not.toContain("Quick summary");
    expect(result).not.toContain(PHRASE_PT);
    expect(result).toBe(`${HEADER}\n${expectedTranscript}`);
  });
});
