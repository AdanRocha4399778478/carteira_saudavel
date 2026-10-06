import { describe, expect, test } from "bun:test";
import { ERP_TAXONOMY } from "../src/lib/domain";
import { formatErpTaxonomyForPrompt, normalizeProjectProposal } from "../src/lib/project-proposal";

describe("normalizeProjectProposal", () => {
  test("par válido é mantido", () => {
    expect(
      normalizeProjectProposal({
        description: "texto",
        erp_area: "Financeiro",
        erp_subarea: "Contas a Pagar",
      }),
    ).toEqual({
      description: "texto",
      erp_area: "Financeiro",
      erp_subarea: "Contas a Pagar",
    });
  });

  test("área válida com subárea de OUTRA área -> ambos null", () => {
    const result = normalizeProjectProposal({
      erp_area: "Financeiro",
      erp_subarea: "Recrutamento e Seleção",
    });
    expect(result.erp_area).toBeNull();
    expect(result.erp_subarea).toBeNull();
  });

  test("área inválida -> ambos null", () => {
    const result = normalizeProjectProposal({
      erp_area: "Área Inexistente",
      erp_subarea: "Contas a Pagar",
    });
    expect(result.erp_area).toBeNull();
    expect(result.erp_subarea).toBeNull();
  });

  test("campos ausentes -> description vazia e área/subárea null", () => {
    expect(normalizeProjectProposal({})).toEqual({
      description: "",
      erp_area: null,
      erp_subarea: null,
    });
  });

  test("raw nulo -> igual a campos ausentes", () => {
    expect(normalizeProjectProposal(null)).toEqual({
      description: "",
      erp_area: null,
      erp_subarea: null,
    });
    expect(normalizeProjectProposal(undefined)).toEqual({
      description: "",
      erp_area: null,
      erp_subarea: null,
    });
  });

  test("campos nulos e vazios -> description vazia e área/subárea null", () => {
    expect(
      normalizeProjectProposal({ description: null, erp_area: null, erp_subarea: null }),
    ).toEqual({ description: "", erp_area: null, erp_subarea: null });
    expect(normalizeProjectProposal({ description: "", erp_area: "", erp_subarea: "" })).toEqual({
      description: "",
      erp_area: null,
      erp_subarea: null,
    });
  });

  test("espaços são aparados", () => {
    expect(
      normalizeProjectProposal({
        description: "  texto com espaço  ",
        erp_area: "  Financeiro  ",
        erp_subarea: "  Contas a Pagar  ",
      }),
    ).toEqual({
      description: "texto com espaço",
      erp_area: "Financeiro",
      erp_subarea: "Contas a Pagar",
    });
  });
});

describe("formatErpTaxonomyForPrompt", () => {
  const text = formatErpTaxonomyForPrompt();

  test("contém as 14 áreas", () => {
    for (const area of Object.keys(ERP_TAXONOMY)) {
      expect(text).toContain(area);
    }
  });

  test("contém cada uma das 159 subáreas de ERP_TAXONOMY", () => {
    const missing: string[] = [];
    for (const subareas of Object.values(ERP_TAXONOMY)) {
      for (const subarea of subareas) {
        if (!text.includes(subarea)) missing.push(subarea);
      }
    }
    expect(missing).toEqual([]);
  });
});
