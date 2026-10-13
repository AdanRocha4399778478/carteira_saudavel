import { describe, expect, test } from "bun:test";
import {
  applySpeakerMapEdit,
  applySpeakerMapToAnalysis,
  fillActionOwnerByRole,
  nextParticipantsValue,
  participantsFromSpeakerMap,
  rewriteOwnerText,
  speakerLabelsNeedingName,
  type SpeakerMapEntry,
} from "@/lib/speaker-map";
import { parseAnalysis } from "@/lib/meeting-analysis";

function entry(overrides: Partial<SpeakerMapEntry> = {}): SpeakerMapEntry {
  return {
    label: "Speaker 2",
    name: "",
    role: "",
    confidence: "baixa",
    evidence: "",
    confirmed: false,
    ...overrides,
  };
}

describe("applySpeakerMapEdit", () => {
  test("nome novo numa linha de confiança baixa e sem nome vira alta e confirmado", () => {
    const result = applySpeakerMapEdit(entry(), { name: "Adan Rocha" });
    expect(result.name).toBe("Adan Rocha");
    expect(result.confidence).toBe("alta");
    expect(result.confirmed).toBe(true);
  });

  test("nome apagado numa linha confirmada vira baixa e não confirmado", () => {
    const confirmed = entry({ name: "Adan Rocha", confidence: "alta", confirmed: true });
    const result = applySpeakerMapEdit(confirmed, { name: "" });
    expect(result.confidence).toBe("baixa");
    expect(result.confirmed).toBe(false);
  });

  test("nome só de espaços conta como apagado: vira baixa e não confirmado", () => {
    const confirmed = entry({ name: "Adan Rocha", confidence: "alta", confirmed: true });
    const result = applySpeakerMapEdit(confirmed, { name: "   " });
    expect(result.confidence).toBe("baixa");
    expect(result.confirmed).toBe(false);
  });

  test("só o papel preserva confidence e confirmed (média/não confirmado)", () => {
    const media = entry({ confidence: "média", confirmed: false });
    const result = applySpeakerMapEdit(media, { role: "cliente" });
    expect(result.role).toBe("cliente");
    expect(result.confidence).toBe("média");
    expect(result.confirmed).toBe(false);
  });

  test("só o papel preserva confidence e confirmed (alta/confirmado)", () => {
    const alta = entry({ name: "Adan Rocha", confidence: "alta", confirmed: true });
    const result = applySpeakerMapEdit(alta, { role: "consultor" });
    expect(result.role).toBe("consultor");
    expect(result.confidence).toBe("alta");
    expect(result.confirmed).toBe(true);
  });

  test("não muta a entrada recebida", () => {
    const original = entry({ name: "Ana", confidence: "média" });
    const snapshot = JSON.stringify(original);
    applySpeakerMapEdit(original, { name: "Outro nome" });
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("rewriteOwnerText", () => {
  test("rótulo isolado com confiança alta troca pelo nome mapeado", () => {
    const map = [entry({ name: "Adan Rocha", confidence: "alta" })];
    expect(rewriteOwnerText("Speaker 2", map)).toBe("Adan Rocha");
  });

  test("rótulo isolado com confiança baixa esvazia", () => {
    const map = [entry({ name: "Adan Rocha", confidence: "baixa" })];
    expect(rewriteOwnerText("Speaker 2", map)).toBe("");
  });

  test("rótulo composto sem mapeamento remove o conectivo solto", () => {
    expect(rewriteOwnerText("Cliente e Speaker 2", [])).toBe("Cliente");
  });

  test("rótulo composto com mapeamento troca e preserva o conectivo", () => {
    const map = [entry({ name: "Adan Rocha", confidence: "alta" })];
    expect(rewriteOwnerText("Cliente e Speaker 2", map)).toBe("Cliente e Adan Rocha");
  });

  test("nome real nunca é alterado", () => {
    expect(rewriteOwnerText("Adan Rocha", [])).toBe("Adan Rocha");
    expect(rewriteOwnerText("Adan e Elias", [])).toBe("Adan e Elias");
  });

  test("mapa vazio esvazia qualquer rótulo genérico", () => {
    expect(rewriteOwnerText("Speaker 1", [])).toBe("");
    expect(rewriteOwnerText("Falante 2", [])).toBe("");
  });

  test("não diferencia maiúsculas/minúsculas", () => {
    const map = [entry({ label: "speaker 2", name: "Ana", confidence: "média" })];
    expect(rewriteOwnerText("SPEAKER 2", map)).toBe("Ana");
  });
});

describe("applySpeakerMapToAnalysis", () => {
  function baseAnalysis() {
    const parsed = parseAnalysis({
      meeting: { action_owner: "Speaker 1" },
      decisions: [{ title: "Decisão", owner: "Speaker 2" }],
      actions: [{ description: "Ação", owner_name: "Cliente e Speaker 2" }],
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    return parsed.analysis;
  }

  test("troca os 3 campos de responsável de uma vez", () => {
    const analysis = baseAnalysis();
    const map = [
      entry({ label: "Speaker 1", name: "Adan Rocha", confidence: "alta" }),
      entry({ label: "Speaker 2", name: "Ana", confidence: "alta" }),
    ];
    const result = applySpeakerMapToAnalysis(analysis, map);
    expect(result.meeting.action_owner).toBe("Adan Rocha");
    expect(result.decisions[0]!.owner).toBe("Ana");
    expect(result.actions[0]!.owner_name).toBe("Cliente e Ana");
  });

  test("não muta o objeto recebido", () => {
    const analysis = baseAnalysis();
    const snapshot = JSON.parse(JSON.stringify(analysis));
    applySpeakerMapToAnalysis(analysis, [entry({ name: "Ana", confidence: "alta" })]);
    expect(analysis).toEqual(snapshot);
  });

  test("sem mapa, esvazia os rótulos genéricos nos 3 campos", () => {
    const analysis = baseAnalysis();
    const result = applySpeakerMapToAnalysis(analysis, []);
    expect(result.meeting.action_owner).toBe("");
    expect(result.decisions[0]!.owner).toBe("");
    expect(result.actions[0]!.owner_name).toBe("Cliente");
  });
});

describe("participantsFromSpeakerMap", () => {
  test("lista nomes com confiança alta ou média, sem duplicata, na ordem do mapa", () => {
    const map = [
      entry({ label: "Speaker 1", name: "Adan Rocha", confidence: "alta" }),
      entry({ label: "Speaker 2", name: "Ana", confidence: "média" }),
      entry({ label: "Speaker 3", name: "Adan Rocha", confidence: "alta" }),
    ];
    expect(participantsFromSpeakerMap(map)).toBe("Adan Rocha, Ana");
  });

  test("ignora entradas com confiança baixa", () => {
    const map = [
      entry({ label: "Speaker 1", name: "Ana", confidence: "baixa" }),
      entry({ label: "Speaker 2", name: "Adan Rocha", confidence: "alta" }),
    ];
    expect(participantsFromSpeakerMap(map)).toBe("Adan Rocha");
  });

  test("linha do consultor sem nome usa o fallback de consultantName", () => {
    const map = [entry({ label: "Speaker 1", role: "consultor", name: "", confidence: "alta" })];
    expect(participantsFromSpeakerMap(map, "Adan Rocha")).toBe("Adan Rocha");
  });
});

describe("B1 — rewriteOwnerText mantém o rótulo quando papel é conhecido e nome está vazio", () => {
  test("confiança alta/média + papel conhecido + nome vazio: mantém o rótulo (não esvazia)", () => {
    const map = [entry({ label: "Speaker 2", role: "cliente", name: "", confidence: "alta" })];
    expect(rewriteOwnerText("Speaker 2", map)).toBe("Speaker 2");
  });

  test("confiança média também mantém o rótulo", () => {
    const map = [entry({ label: "Speaker 2", role: "consultor", name: "", confidence: "média" })];
    expect(rewriteOwnerText("Speaker 2", map)).toBe("Speaker 2");
  });

  test("confiança baixa continua esvaziando, mesmo com papel conhecido", () => {
    const map = [entry({ label: "Speaker 2", role: "cliente", name: "", confidence: "baixa" })];
    expect(rewriteOwnerText("Speaker 2", map)).toBe("");
  });

  test("papel desconhecido continua esvaziando, mesmo com confiança alta", () => {
    const map = [entry({ label: "Speaker 2", role: "", name: "", confidence: "alta" })];
    expect(rewriteOwnerText("Speaker 2", map)).toBe("");
  });

  test("rótulo composto mantém a parte sem nome e troca a outra", () => {
    const map = [
      entry({ label: "Speaker 1", role: "cliente", name: "Ana", confidence: "alta" }),
      entry({ label: "Speaker 2", role: "consultor", name: "", confidence: "alta" }),
    ];
    expect(rewriteOwnerText("Speaker 1 e Speaker 2", map)).toBe("Ana e Speaker 2");
  });
});

describe("B1 — speakerLabelsNeedingName", () => {
  test("lista rótulos com papel conhecido e nome vazio (confiança alta/média)", () => {
    const map = [
      entry({ label: "Speaker 1", role: "cliente", name: "", confidence: "alta" }),
      entry({ label: "Speaker 2", role: "consultor", name: "Adan Rocha", confidence: "alta" }),
      entry({ label: "Speaker 3", role: "", name: "", confidence: "alta" }),
      entry({ label: "Speaker 4", role: "cliente", name: "", confidence: "baixa" }),
    ];
    expect(speakerLabelsNeedingName(map)).toEqual(["Speaker 1"]);
  });

  test("sem nenhum falante pendente, devolve lista vazia", () => {
    const map = [entry({ label: "Speaker 1", role: "cliente", name: "Ana", confidence: "alta" })];
    expect(speakerLabelsNeedingName(map)).toEqual([]);
  });
});

describe("B2 — fillActionOwnerByRole", () => {
  function action(overrides: { description: string; owner_name?: string }) {
    return { description: overrides.description, owner_name: overrides.owner_name ?? "" };
  }

  test("owner vazio + 'Cliente deve...' + uma entrada de papel cliente: preenche com o nome", () => {
    const map = [entry({ label: "Speaker 1", role: "cliente", name: "Ana", confidence: "alta" })];
    const result = fillActionOwnerByRole(
      [action({ description: "Cliente deve enviar o catálogo até sexta" })],
      map,
    );
    expect(result[0]!.owner_name).toBe("Ana");
  });

  test("sem acento/maiúscula e com 'Consultor deve...': preenche com o nome do consultor", () => {
    const map = [
      entry({ label: "Speaker 2", role: "consultor", name: "Adan Rocha", confidence: "alta" }),
    ];
    const result = fillActionOwnerByRole(
      [action({ description: "CONSULTOR DEVE PREPARAR a proposta" })],
      map,
    );
    expect(result[0]!.owner_name).toBe("Adan Rocha");
  });

  test("duas entradas de papel cliente: deixa vazio (ambíguo)", () => {
    const map = [
      entry({ label: "Speaker 1", role: "cliente", name: "Ana", confidence: "alta" }),
      entry({ label: "Speaker 3", role: "cliente", name: "Beto", confidence: "média" }),
    ];
    const result = fillActionOwnerByRole(
      [action({ description: "Cliente deve enviar o catálogo até sexta" })],
      map,
    );
    expect(result[0]!.owner_name).toBe("");
  });

  test("owner já preenchido pela IA nunca é sobrescrito", () => {
    const map = [entry({ label: "Speaker 1", role: "cliente", name: "Ana", confidence: "alta" })];
    const result = fillActionOwnerByRole(
      [
        action({
          description: "Cliente deve enviar o catálogo até sexta",
          owner_name: "Outro Nome",
        }),
      ],
      map,
    );
    expect(result[0]!.owner_name).toBe("Outro Nome");
  });

  test("entrada única do papel com nome vazio (confiança alta/média): usa o rótulo", () => {
    const map = [entry({ label: "Speaker 2", role: "cliente", name: "", confidence: "média" })];
    const result = fillActionOwnerByRole(
      [action({ description: "Cliente deve enviar o catálogo até sexta" })],
      map,
    );
    expect(result[0]!.owner_name).toBe("Speaker 2");
  });

  test("'Consultor irá...' não é tocado (fora do escopo de B2, só 'deve')", () => {
    const map = [
      entry({ label: "Speaker 2", role: "consultor", name: "Adan Rocha", confidence: "alta" }),
    ];
    const result = fillActionOwnerByRole(
      [action({ description: "Consultor irá preparar a proposta" })],
      map,
    );
    expect(result[0]!.owner_name).toBe("");
  });

  test("nunca altera o texto da descrição, só o owner_name", () => {
    const map = [entry({ label: "Speaker 1", role: "cliente", name: "Ana", confidence: "alta" })];
    const result = fillActionOwnerByRole(
      [action({ description: "Cliente deve enviar o catálogo até sexta" })],
      map,
    );
    expect(result[0]!.description).toBe("Cliente deve enviar o catálogo até sexta");
  });

  test("entrada única de cliente com nome preenchido e confiança baixa: owner continua vazio (na dúvida fica vazio)", () => {
    const map = [entry({ label: "Speaker 1", role: "cliente", name: "Ana", confidence: "baixa" })];
    const result = fillActionOwnerByRole(
      [action({ description: "Cliente deve enviar o catálogo até sexta" })],
      map,
    );
    expect(result[0]!.owner_name).toBe("");
  });

  test("entrada única de cliente com nome vazio e confiança baixa: owner continua vazio", () => {
    const map = [entry({ label: "Speaker 1", role: "cliente", name: "", confidence: "baixa" })];
    const result = fillActionOwnerByRole(
      [action({ description: "Cliente deve enviar o catálogo até sexta" })],
      map,
    );
    expect(result[0]!.owner_name).toBe("");
  });

  test("entrada única de cliente com nome preenchido e confiança média: recebe o nome", () => {
    const map = [entry({ label: "Speaker 1", role: "cliente", name: "Ana", confidence: "média" })];
    const result = fillActionOwnerByRole(
      [action({ description: "Cliente deve enviar o catálogo até sexta" })],
      map,
    );
    expect(result[0]!.owner_name).toBe("Ana");
  });

  // Limitação conhecida, documentada sem alterar a regex (CLIENT_DEVE_PREFIX
  // exige o início exato "cliente deve" — "O cliente deve"/"A cliente deve"
  // têm uma palavra antes de "cliente" e por isso NÃO casam hoje).
  test("'O cliente deve...' e 'A cliente deve...' não são reconhecidos (limitação conhecida, owner continua vazio)", () => {
    const map = [entry({ label: "Speaker 1", role: "cliente", name: "Ana", confidence: "alta" })];
    const resultO = fillActionOwnerByRole(
      [action({ description: "O cliente deve enviar o catálogo até sexta" })],
      map,
    );
    const resultA = fillActionOwnerByRole(
      [action({ description: "A cliente deve enviar o catálogo até sexta" })],
      map,
    );
    expect(resultO[0]!.owner_name).toBe("");
    expect(resultA[0]!.owner_name).toBe("");
  });
});

describe("B2 — integrado em applySpeakerMapToAnalysis (roda antes da reescrita de rótulo)", () => {
  function baseAnalysisWithEmptyOwner() {
    const parsed = parseAnalysis({
      actions: [{ description: "Cliente deve enviar o catálogo até sexta", owner_name: "" }],
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    return parsed.analysis;
  }

  test("preenche o owner por papel e sobrevive à reescrita de rótulo (nome real)", () => {
    const analysis = baseAnalysisWithEmptyOwner();
    const map = [entry({ label: "Speaker 1", role: "cliente", name: "Ana", confidence: "alta" })];
    const result = applySpeakerMapToAnalysis(analysis, map);
    expect(result.actions[0]!.owner_name).toBe("Ana");
  });

  test("entrada única sem nome: owner final é o rótulo mantido (B1 + B2 compostos)", () => {
    const analysis = baseAnalysisWithEmptyOwner();
    const map = [entry({ label: "Speaker 1", role: "cliente", name: "", confidence: "alta" })];
    const result = applySpeakerMapToAnalysis(analysis, map);
    expect(result.actions[0]!.owner_name).toBe("Speaker 1");
  });
});

describe("B3 — nextParticipantsValue", () => {
  test("edição manual: nunca sobrescreve, mesmo com mapa novo", () => {
    const map = [entry({ label: "Speaker 1", name: "Ana", confidence: "alta" })];
    expect(nextParticipantsValue(map, undefined, "Valor manual", true)).toBe("Valor manual");
  });

  test("sem edição manual: recalcula a partir do mapa atual", () => {
    const map = [entry({ label: "Speaker 1", name: "Ana", confidence: "alta" })];
    expect(nextParticipantsValue(map, undefined, "Valor antigo", false)).toBe("Ana");
  });

  test("mapa sem nome usável: mantém o valor atual em vez de esvaziar", () => {
    const map = [entry({ label: "Speaker 1", name: "", confidence: "baixa" })];
    expect(nextParticipantsValue(map, undefined, "Valor antigo", false)).toBe("Valor antigo");
  });

  test("participantsFromSpeakerMap nunca inclui rótulo genérico, mesmo quando B1 o mantém para owner", () => {
    const map = [entry({ label: "Speaker 2", role: "cliente", name: "", confidence: "alta" })];
    expect(participantsFromSpeakerMap(map)).toBe("");
    expect(nextParticipantsValue(map, undefined, "Valor antigo", false)).toBe("Valor antigo");
  });
});

describe("analysisSchema — speaker_map", () => {
  test("análise sem speaker_map continua parseando e speaker_map vira []", () => {
    const result = parseAnalysis({ decisions: [{ title: "Decisão" }] });
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.analysis.speaker_map).toEqual([]);
  });

  test("role e confidence fora da lista esperada caem no fallback, sem quebrar o parse", () => {
    const result = parseAnalysis({
      speaker_map: [{ label: "Speaker 1", name: "Ana", role: "amigo", confidence: "certeza total" }],
    });
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.analysis.speaker_map).toEqual([
      { label: "Speaker 1", name: "Ana", role: "", confidence: "baixa", evidence: "" },
    ]);
  });
});
