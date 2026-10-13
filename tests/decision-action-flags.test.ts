import { describe, expect, test } from "bun:test";
import { isConditionalClientAction } from "../src/lib/decision-action-flags";
import type { SpeakerMapEntry } from "../src/lib/speaker-map";

function speakerMap(overrides: Partial<SpeakerMapEntry>[]): SpeakerMapEntry[] {
  return overrides.map((o) => ({
    label: o.label ?? "",
    name: o.name ?? "",
    role: o.role ?? "",
    confidence: o.confidence ?? "alta",
    evidence: o.evidence ?? "",
    confirmed: o.confirmed ?? true,
  }));
}

describe("E1 — isConditionalClientAction", () => {
  test("positivos: ação do cliente com texto condicional", () => {
    expect(
      isConditionalClientAction(
        "Cliente pode antecipar o envio do catálogo caso queira",
        "Cliente",
        [],
      ),
    ).toBe(true);
    expect(
      isConditionalClientAction("A cliente pode enviar as fotos se preferir", "A cliente", []),
    ).toBe(true);
  });

  test("negativos: tarefa firme do cliente, sem condicional", () => {
    expect(
      isConditionalClientAction("Cliente deve enviar o catálogo até sexta", "Cliente", []),
    ).toBe(false);
  });

  test("negativos: consultor nunca é sinalizado por este critério, mesmo com texto condicional", () => {
    expect(
      isConditionalClientAction(
        "Consultor pode enviar a proposta caso o cliente queira",
        "Consultor",
        [],
      ),
    ).toBe(false);
  });

  test("negativo: 'pode' sem verbo de entrega não casa", () => {
    expect(isConditionalClientAction("Cliente: o prazo pode ser ajustado", "Cliente", [])).toBe(
      false,
    );
  });

  test("acentos e maiúsculas não importam", () => {
    expect(
      isConditionalClientAction("CLIENTE PODE ANTECIPAR O ENVIO CASO QUEIRA", "Cliente", []),
    ).toBe(true);
    expect(
      isConditionalClientAction("O cliente envia se preferir o catálogo", "O cliente", []),
    ).toBe(true);
  });

  test("owner resolvido para o papel cliente no speaker_map também sinaliza, mesmo sem o texto começar por 'Cliente'", () => {
    const map = speakerMap([{ name: "Ana", role: "cliente" }]);
    expect(isConditionalClientAction("Ana pode adiantar o envio se quiser", "Ana", map)).toBe(true);
  });

  test("owner resolvido para o papel consultor nunca sinaliza, mesmo com texto condicional", () => {
    const map = speakerMap([{ name: "João", role: "consultor" }]);
    expect(isConditionalClientAction("João pode enviar o material se preferir", "João", map)).toBe(
      false,
    );
  });
});
