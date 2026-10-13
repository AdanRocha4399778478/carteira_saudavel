import { describe, expect, test } from "bun:test";
import { similarity } from "../src/lib/deduplication";
import {
  findRepeatedActionForDecision,
  isConditionalClientAction,
  REPEATED_ACTION_THRESHOLD,
} from "../src/lib/decision-action-flags";
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

describe("E2 — findRepeatedActionForDecision", () => {
  test("positivo: decisão repete o conteúdo de uma ação da mesma análise", () => {
    const result = findRepeatedActionForDecision("Lançar compras no contas a pagar no ato", null, [
      "Cliente deve lançar compras no contas a pagar no ato da compra",
    ]);
    expect(result).toBe("Cliente deve lançar compras no contas a pagar no ato da compra");
  });

  test("negativo: pendência condicionada (Decidir se...) nunca é sinalizada, mesmo com ação parecida", () => {
    expect(
      findRepeatedActionForDecision("Decidir se aprova o orçamento", null, [
        "Iniciar o levantamento",
      ]),
    ).toBeNull();
  });

  test("negativo: pendência condicionada (Definir...) nunca é sinalizada", () => {
    expect(
      findRepeatedActionForDecision("Definir o preço do plano", null, [
        "Cliente revisa os custos fixos",
      ]),
    ).toBeNull();
  });

  test("negativo: decisão de agenda sem relação com nenhuma ação", () => {
    expect(
      findRepeatedActionForDecision("Reunião de alinhamento na quinta às 9h", null, [
        "Cliente envia o catálogo de produtos até sexta",
        "Consultor prepara a proposta",
      ]),
    ).toBeNull();
  });

  test("nunca altera nem remove o texto de nenhum item — só devolve o texto da ação para exibição", () => {
    const actions = ["Cliente deve lançar compras no contas a pagar no ato da compra"];
    const before = [...actions];
    findRepeatedActionForDecision("Lançar compras no contas a pagar no ato", null, actions);
    expect(actions).toEqual(before);
  });

  /**
   * Estrutura calibrada com casos reais (decisão com título + descrição mais
   * longa, repetindo com palavras parcialmente diferentes uma ação do
   * cliente) — ver REPEATED_ACTION_THRESHOLD em decision-action-flags.ts.
   * Exemplos neutros, sem nenhuma fala de transcrição real.
   */
  test("limiar REPEATED_ACTION_THRESHOLD (0,30) com estrutura de caso real neutro", () => {
    const decisionTitle = "Lançar entradas no estoque no recebimento";
    const decisionDescription =
      "Registrar toda entrada no estoque assim que a mercadoria chegar, não apenas quando a nota for conferida.";
    const repeatedAction =
      "Cliente deve lançar as entradas de mercadoria no estoque no momento do recebimento, usando a nota como referência.";
    const unrelatedActionA = "Consultor prepara o relatório de indicadores do próximo trimestre.";
    const unrelatedActionB = "Cliente deve confirmar o endereço para a próxima visita presencial.";

    const decisionText = `${decisionTitle} ${decisionDescription}`;
    const positiveScore = similarity(decisionText, repeatedAction);
    const negativeScoreA = similarity(decisionText, unrelatedActionA);
    const negativeScoreB = similarity(decisionText, unrelatedActionB);

    // eslint-disable-next-line no-console
    console.log("[E2 limiar] positivo:", positiveScore, "negativo A:", negativeScoreA, "negativo B:", negativeScoreB);

    expect(positiveScore).toBeGreaterThan(REPEATED_ACTION_THRESHOLD);
    expect(negativeScoreA).toBeLessThan(REPEATED_ACTION_THRESHOLD);
    expect(negativeScoreB).toBeLessThan(REPEATED_ACTION_THRESHOLD);

    expect(
      findRepeatedActionForDecision(decisionTitle, decisionDescription, [repeatedAction]),
    ).toBe(repeatedAction);
    expect(
      findRepeatedActionForDecision(decisionTitle, decisionDescription, [
        unrelatedActionA,
        unrelatedActionB,
      ]),
    ).toBeNull();
  });
});
