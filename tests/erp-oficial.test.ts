import { describe, expect, test } from "bun:test";
import { ERP_OFICIAL } from "../src/lib/erp-oficial";
import { isValidErpPair } from "../src/lib/project-name";

const AREAS_NA_ORDEM = [
  "Pessoas",
  "Comercial",
  "Operações",
  "Marketing",
  "Financeiro",
  "Estratégia",
  "Inovação e Pesquisas",
  "Jurídica",
  "Logística e Suprimentos",
  "Projetos",
  "Qualidade",
  "Sustentabilidade",
  "Tecnologia da Informação",
  "Administrativo",
];

/** Aproximação em JS de `normalize_project_name` (banco) — ver tests/project-name.test.ts. */
function normalizeNameApprox(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

describe("ERP_OFICIAL — estrutura", () => {
  test("14 áreas, na ordem do documento", () => {
    expect(ERP_OFICIAL.map((a) => a.area)).toEqual(AREAS_NA_ORDEM);
  });

  test("183 subáreas e 441 itens no total", () => {
    let subareas = 0;
    let itens = 0;
    for (const area of ERP_OFICIAL) {
      subareas += area.subareas.length;
      for (const subarea of area.subareas) itens += subarea.itens.length;
    }
    expect(subareas).toBe(183);
    expect(itens).toBe(441);
  });

  test("toda área termina com a subárea 'Outros'", () => {
    for (const area of ERP_OFICIAL) {
      const last = area.subareas[area.subareas.length - 1];
      expect(last?.nome).toBe("Outros");
    }
  });

  test("'Outros' nunca tem itens", () => {
    for (const area of ERP_OFICIAL) {
      const outros = area.subareas.find((s) => s.nome === "Outros");
      expect(outros?.itens).toEqual([]);
    }
  });

  test("só Marketing, Financeiro e Projetos têm descricao", () => {
    const comDescricao: string[] = [];
    for (const area of ERP_OFICIAL) {
      for (const subarea of area.subareas) {
        if (subarea.descricao) comDescricao.push(area.area);
      }
    }
    expect(comDescricao.sort()).toEqual(["Financeiro", "Marketing", "Projetos"].sort());
  });

  test("nenhum item repetido dentro de uma subárea", () => {
    const repetidos: { area: string; subarea: string; item: string }[] = [];
    for (const area of ERP_OFICIAL) {
      for (const subarea of area.subareas) {
        const seen = new Set<string>();
        for (const item of subarea.itens) {
          if (seen.has(item)) repetidos.push({ area: area.area, subarea: subarea.nome, item });
          seen.add(item);
        }
      }
    }
    expect(repetidos).toEqual([]);
  });

  test("os 3 itens de rede são itens de 'Gestão de Redes e Conectividade' (TI), não subáreas", () => {
    const ti = ERP_OFICIAL.find((a) => a.area === "Tecnologia da Informação");
    expect(ti).toBeDefined();

    const nomesDeSubarea = ti!.subareas.map((s) => s.nome);
    const itensDeRede = [
      "Redes LAN, WAN e Wi-Fi",
      "Monitoramento de tráfego e otimização de banda",
      "Prioridade de tráfego e QoS",
    ];
    for (const item of itensDeRede) {
      expect(nomesDeSubarea).not.toContain(item);
    }

    const redes = ti!.subareas.find((s) => s.nome === "Gestão de Redes e Conectividade");
    expect(redes).toBeDefined();
    for (const item of itensDeRede) {
      expect(redes!.itens).toContain(item);
    }
  });
});

describe("ERP_OFICIAL — pares antigos continuam válidos", () => {
  test.each([
    ["Pessoas", "Treinamento e Desenvolvimento"],
    ["Financeiro", "Análise Financeira"],
    ["Financeiro", "Contas a Pagar"],
    ["Comercial", "Prospecção de Clientes"],
  ])("isValidErpPair(%s, %s) é verdadeiro", (area, subarea) => {
    expect(isValidErpPair(area, subarea)).toBe(true);
  });
});

describe("ERP_OFICIAL — colisão de nomes nos três níveis", () => {
  test("624 nomes distintos ('Área - Subárea' e 'Área - Subárea - Item'), zero colisões", () => {
    const names: string[] = [];
    for (const area of ERP_OFICIAL) {
      for (const subarea of area.subareas) {
        names.push(`${area.area} - ${subarea.nome}`);
        for (const item of subarea.itens) {
          names.push(`${area.area} - ${subarea.nome} - ${item}`);
        }
      }
    }
    expect(names.length).toBe(624);

    const seen = new Map<string, string>();
    const collisions: { normalized: string; a: string; b: string }[] = [];
    for (const name of names) {
      const normalized = normalizeNameApprox(name);
      const existing = seen.get(normalized);
      if (existing && existing !== name) {
        collisions.push({ normalized, a: existing, b: name });
      } else {
        seen.set(normalized, name);
      }
    }
    expect(collisions).toEqual([]);
    expect(seen.size).toBe(624);
  });
});
