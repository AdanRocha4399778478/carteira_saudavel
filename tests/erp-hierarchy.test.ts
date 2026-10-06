import { describe, expect, test } from "bun:test";
import { erpCode, getErpItems, isValidErpTriple } from "../src/lib/erp-hierarchy";
import { buildProjectName } from "../src/lib/project-name";

describe("erpCode", () => {
  test("área sozinha: Comercial = 2", () => {
    expect(erpCode("Comercial")).toBe("2");
  });

  test("área + subárea: Pessoas/Treinamento e Desenvolvimento = 1.5", () => {
    expect(erpCode("Pessoas", "Treinamento e Desenvolvimento")).toBe("1.5");
  });

  test("área + subárea + item: Comercial/Prospecção de Clientes/Uso de scripts... = 2.3.3", () => {
    expect(
      erpCode("Comercial", "Prospecção de Clientes", "Uso de scripts e cadências de contato"),
    ).toBe("2.3.3");
  });

  test("TI/Gestão de Redes e Conectividade = 13.8", () => {
    expect(erpCode("Tecnologia da Informação", "Gestão de Redes e Conectividade")).toBe("13.8");
  });

  test("item 'Redes LAN, WAN e Wi-Fi' de Gestão de Redes e Conectividade = 13.8.1", () => {
    expect(
      erpCode(
        "Tecnologia da Informação",
        "Gestão de Redes e Conectividade",
        "Redes LAN, WAN e Wi-Fi",
      ),
    ).toBe("13.8.1");
  });

  test("TI/Compliance e Normas de TI = 13.9", () => {
    expect(erpCode("Tecnologia da Informação", "Compliance e Normas de TI")).toBe("13.9");
  });

  test("entrada inexistente devolve null", () => {
    expect(erpCode("Área Inexistente")).toBeNull();
    expect(erpCode("Comercial", "Subárea Inexistente")).toBeNull();
    expect(erpCode("Comercial", "Prospecção de Clientes", "Item Inexistente")).toBeNull();
  });
});

describe("isValidErpTriple", () => {
  test("par e item válidos = verdadeiro", () => {
    expect(
      isValidErpTriple(
        "Comercial",
        "Prospecção de Clientes",
        "Uso de scripts e cadências de contato",
      ),
    ).toBe(true);
  });

  test("item de OUTRA subárea = falso", () => {
    expect(isValidErpTriple("Comercial", "Prospecção de Clientes", "Redes LAN, WAN e Wi-Fi")).toBe(
      false,
    );
  });

  test("item vazio = verdadeiro (item é opcional)", () => {
    expect(isValidErpTriple("Comercial", "Prospecção de Clientes", "")).toBe(true);
    expect(isValidErpTriple("Comercial", "Prospecção de Clientes", null)).toBe(true);
  });

  test("par área/subárea inválido = falso, mesmo com item vazio", () => {
    expect(isValidErpTriple("Área Inexistente", "Qualquer", "")).toBe(false);
  });
});

describe("getErpItems", () => {
  test("devolve os itens da subárea", () => {
    expect(getErpItems("Comercial", "Prospecção de Clientes")).toContain(
      "Uso de scripts e cadências de contato",
    );
  });

  test("devolve [] para área/subárea inexistente", () => {
    expect(getErpItems("Área Inexistente", "Qualquer")).toEqual([]);
  });
});

describe("buildProjectName com e sem item", () => {
  test("sem item: 'Área - Subárea'", () => {
    expect(buildProjectName("Financeiro", "Contas a Pagar")).toBe("Financeiro - Contas a Pagar");
  });

  test("item vazio/nulo: igual a sem item", () => {
    expect(buildProjectName("Financeiro", "Contas a Pagar", "")).toBe(
      "Financeiro - Contas a Pagar",
    );
    expect(buildProjectName("Financeiro", "Contas a Pagar", null)).toBe(
      "Financeiro - Contas a Pagar",
    );
  });

  test("com item: 'Área - Subárea - Item'", () => {
    expect(
      buildProjectName(
        "Comercial",
        "Prospecção de Clientes",
        "Uso de scripts e cadências de contato",
      ),
    ).toBe("Comercial - Prospecção de Clientes - Uso de scripts e cadências de contato");
  });
});
