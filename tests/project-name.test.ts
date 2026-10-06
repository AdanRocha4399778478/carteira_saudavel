import { describe, expect, test } from "bun:test";
import { ERP_TAXONOMY } from "../src/lib/domain";
import { buildProjectName, isValidErpPair } from "../src/lib/project-name";

/** Aproximação em JS de `normalize_project_name` (banco): trim(regexp_replace(unaccent(lower(nome)), '[^a-z0-9]+', ' ', 'g')).
 *  `unaccent` do Postgres não é idêntico a `normalize("NFD") + remoção de diacríticos` do JS em todos os casos
 *  (ex.: alguns caracteres compostos/ligaduras), então esta é uma aproximação — suficiente para detectar
 *  colisão de nome entre todas as combinações de área/subárea, não uma reimplementação exata do unaccent. */
function normalizeProjectNameApprox(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

describe("buildProjectName", () => {
  test("gera o formato esperado 'Área - Subárea'", () => {
    expect(buildProjectName("Financeiro", "Contas a Pagar")).toBe("Financeiro - Contas a Pagar");
  });
});

describe("isValidErpPair", () => {
  test("par válido (área e subárea da mesma área)", () => {
    expect(isValidErpPair("Financeiro", "Contas a Pagar")).toBe(true);
  });

  test("área válida com subárea de OUTRA área = falso", () => {
    expect(isValidErpPair("Financeiro", "Recrutamento e Seleção")).toBe(false);
  });

  test("área inválida = falso", () => {
    expect(isValidErpPair("Área Inexistente", "Contas a Pagar")).toBe(false);
  });

  test("nulos e vazios = falso", () => {
    expect(isValidErpPair(null, "Contas a Pagar")).toBe(false);
    expect(isValidErpPair("Financeiro", null)).toBe(false);
    expect(isValidErpPair(undefined, undefined)).toBe(false);
    expect(isValidErpPair("", "")).toBe(false);
  });
});

describe("colisão de nome gerado entre todas as combinações de ERP_TAXONOMY", () => {
  test("nenhum par (área, subárea) gera o mesmo normalized_name que outro", () => {
    const seen = new Map<string, string>();
    const collisions: { normalized: string; a: string; b: string }[] = [];

    for (const area of Object.keys(ERP_TAXONOMY)) {
      for (const subarea of ERP_TAXONOMY[area] ?? []) {
        const name = buildProjectName(area, subarea);
        const normalized = normalizeProjectNameApprox(name);
        const existing = seen.get(normalized);
        if (existing && existing !== name) {
          collisions.push({ normalized, a: existing, b: name });
        } else {
          seen.set(normalized, name);
        }
      }
    }

    expect(collisions).toEqual([]);
  });
});

describe("subárea 'Outros' em todas as áreas", () => {
  test("toda área de ERP_TAXONOMY tem 'Outros' como ÚLTIMA subárea", () => {
    for (const [area, subareas] of Object.entries(ERP_TAXONOMY)) {
      expect(subareas[subareas.length - 1]).toBe("Outros");
    }
  });

  test("o total de subáreas é 183", () => {
    const total = Object.values(ERP_TAXONOMY).reduce((sum, subareas) => sum + subareas.length, 0);
    expect(total).toBe(183);
  });

  test("contagem de subáreas por área", () => {
    const expected: Record<string, number> = {
      Pessoas: 11,
      Comercial: 11,
      Operações: 11,
      Marketing: 10,
      Financeiro: 11,
      Estratégia: 16,
      "Inovação e Pesquisas": 14,
      Jurídica: 16,
      "Logística e Suprimentos": 16,
      Projetos: 9,
      Qualidade: 15,
      Sustentabilidade: 16,
      "Tecnologia da Informação": 17,
      Administrativo: 10,
    };
    const mismatches: { area: string; expected: number; actual: number }[] = [];
    for (const [area, count] of Object.entries(expected)) {
      const actual = ERP_TAXONOMY[area]?.length ?? 0;
      if (actual !== count) {
        mismatches.push({ area, expected: count, actual });
      }
    }
    expect(mismatches).toEqual([]);
  });

  test("'Outros' é válido em qualquer área", () => {
    expect(isValidErpPair("Tecnologia da Informação", "Outros")).toBe(true);
    expect(isValidErpPair("Financeiro", "Outros")).toBe(true);
  });
});
