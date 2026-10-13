import { describe, expect, test } from "bun:test";
import { checkForeignClientText, flagForeignClientItems } from "../src/lib/client-isolation-guard";

describe("checkForeignClientText", () => {
  test("a) padrão fixo 'no cliente X' com X = outro cliente cadastrado marca", () => {
    const snippet = checkForeignClientText(
      "no cliente B a gente cortou o prazo de entrega de 10 para 5 dias",
      "Decorart",
      ["Cliente B"],
    );
    expect(snippet).not.toBeNull();
  });

  test("b) mesmo padrão com X = cliente da reunião não marca", () => {
    const snippet = checkForeignClientText(
      "no cliente Decorart a gente cortou o prazo de entrega",
      "Decorart",
      ["Grupo Erinho"],
    );
    expect(snippet).toBeNull();
  });

  test("c) nome de outro cliente cadastrado sem nenhum dos padrões fixos marca", () => {
    const snippet = checkForeignClientText(
      "o caso Grupo Erinho já tinha esse mesmo problema em outra reunião",
      "Decorart",
      ["Grupo Erinho"],
    );
    expect(snippet).toBe("Grupo Erinho");
  });

  test("d) variação de acento e caixa marca", () => {
    const snippet = checkForeignClientText("LÁ NO grupo erinho deu certo", "Decorart", ["Grupo Erinho"]);
    expect(snippet).not.toBeNull();
  });

  test("e) texto limpo, sem padrão nem nome de outro cliente, não marca", () => {
    const snippet = checkForeignClientText(
      "vamos revisar o prazo de entrega na próxima reunião",
      "Decorart",
      ["Grupo Erinho"],
    );
    expect(snippet).toBeNull();
  });

  test("f) nome do cliente atual contendo 'cliente'/'grupo' no próprio nome não marca", () => {
    // Cliente atual é "Grupo Erinho" — o padrão captura só "erinho" (um
    // token), mas a comparação é por palavra do nome completo, não só pela
    // string inteira, então ainda reconhece que é o próprio cliente.
    const snippet = checkForeignClientText("no grupo Erinho a gente fechou o contrato", "Grupo Erinho", []);
    expect(snippet).toBeNull();

    // Cliente atual é "Cliente Fictício B" — mesma lógica para "cliente".
    const snippet2 = checkForeignClientText(
      "no cliente Fictício fizemos esse ajuste",
      "Cliente Fictício B",
      [],
    );
    expect(snippet2).toBeNull();
  });

  test("g) campos vazios ou só espaços não quebram e não marcam", () => {
    expect(checkForeignClientText("", "Decorart", ["Grupo Erinho"])).toBeNull();
    expect(checkForeignClientText("   ", "Decorart", ["Grupo Erinho"])).toBeNull();
    expect(checkForeignClientText("texto qualquer", "", [])).toBeNull();
  });
});

describe("checkForeignClientText — correção de falso positivo (palavra comum em minúscula)", () => {
  test.each([
    ["E lá no final a gente tem a última linha"],
    ["quando o pintor vem na loja ou ele está na obra"],
    ["o cara me chamou lá no passado, eu fui"],
    ["registrar atendimentos e aprendizados no grupo de WhatsApp todos os dias"],
    ["dois dias você veio aqui na loja e você pediu o orçamento"],
  ])("não marca: %s", (text) => {
    expect(checkForeignClientText(text, "Decorart", ["Grupo Erinho"])).toBeNull();
  });

  test("marca: 'Lá no Duo' (X com inicial maiúscula)", () => {
    expect(
      checkForeignClientText(
        "Lá no Duo, a gente implementou o programa de 3% para cada vendedor",
        "Decorart",
        [],
      ),
    ).not.toBeNull();
  });

  test("marca: 'no cliente B' (X é uma letra maiúscula)", () => {
    expect(
      checkForeignClientText(
        "no cliente B a gente cortou o prazo de entrega de 10 para 5 dias",
        "Decorart",
        [],
      ),
    ).not.toBeNull();
  });

  test("marca: nome de outro cliente mesmo com padrão de palavra comum ao redor", () => {
    expect(checkForeignClientText("lá no grupo erinho deu certo", "Decorart", ["Grupo Erinho"])).not.toBeNull();
    expect(
      checkForeignClientText("o caso Grupo Erinho já tinha esse problema", "Decorart", ["Grupo Erinho"]),
    ).not.toBeNull();
  });

  test("nome de outro cliente com menos de 3 caracteres nunca marca", () => {
    expect(checkForeignClientText("duas tentativas de follow-up", "Decorart", ["Du"])).toBeNull();
  });
});

describe("flagForeignClientItems", () => {
  test("devolve só os índices marcados, com o trecho que bateu", () => {
    const items = [
      { evidence: "no cliente B a gente cortou o prazo" },
      { evidence: "aqui na Decorart mesmo, sem menção a outro cliente" },
      { evidence: "" },
    ];
    const flags = flagForeignClientItems(items, (i) => [i.evidence], "Decorart", ["Cliente B"]);
    expect(Object.keys(flags)).toEqual(["0"]);
    expect(flags[0]).toBeTruthy();
  });
});
