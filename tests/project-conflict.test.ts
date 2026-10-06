import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classificationLoaded,
  classificationState,
  detectUniqueConflict,
  findConflictingProject,
} from "../src/lib/project-conflict";
import type { Project } from "../src/lib/projects";

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: "proj-default",
    client_id: "client-a",
    name: "Projeto padrão",
    description: null,
    status: "ativo",
    start_date: null,
    target_end_date: null,
    consultant_id: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    normalized_name: null,
    merged_into_project_id: null,
    erp_area: null,
    erp_subarea: null,
    erp_item: null,
    ...overrides,
  };
}

describe("classificationState", () => {
  test("os três vazios = vazia", () => {
    expect(classificationState("", "", "")).toBe("vazia");
    expect(classificationState(null, null, null)).toBe("vazia");
  });

  test("área e subárea válidas, item vazio = completa", () => {
    expect(classificationState("Comercial", "Prospecção de Clientes", "")).toBe("completa");
  });

  test("área e subárea válidas, item válido da mesma subárea = completa", () => {
    expect(
      classificationState(
        "Comercial",
        "Prospecção de Clientes",
        "Uso de scripts e cadências de contato",
      ),
    ).toBe("completa");
  });

  test("só área, sem subárea = parcial", () => {
    expect(classificationState("Comercial", "", "")).toBe("parcial");
  });

  test("item de outra subárea = parcial", () => {
    expect(
      classificationState("Comercial", "Prospecção de Clientes", "Redes LAN, WAN e Wi-Fi"),
    ).toBe("parcial");
  });
});

describe("detectUniqueConflict", () => {
  test("23505 com texto do índice de classificação = classificacao", () => {
    expect(
      detectUniqueConflict({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "projects_client_erp_classification_uidx"',
        details: null,
      }),
    ).toBe("classificacao");
  });

  test("23505 com texto do índice de nome = nome", () => {
    expect(
      detectUniqueConflict({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "projects_client_normalized_name_uidx"',
        details: null,
      }),
    ).toBe("nome");
  });

  test("23505 sem nenhum dos dois textos = outro", () => {
    expect(
      detectUniqueConflict({
        code: "23505",
        message: 'duplicate key value violates unique constraint "outro_indice_qualquer"',
        details: null,
      }),
    ).toBe("outro");
  });

  test("código diferente de 23505 = null", () => {
    expect(
      detectUniqueConflict({
        code: "23503",
        message: "violates foreign key constraint",
        details: null,
      }),
    ).toBeNull();
  });

  test("entradas nulas = null", () => {
    expect(detectUniqueConflict({ code: null, message: null, details: null })).toBeNull();
    expect(detectUniqueConflict({})).toBeNull();
  });

  test("texto do índice só em details também é detectado", () => {
    expect(
      detectUniqueConflict({
        code: "23505",
        message: "duplicate key value violates unique constraint",
        details: 'Key (client_id, normalized_name) ... "projects_client_normalized_name_uidx"',
      }),
    ).toBe("nome");
  });
});

describe("findConflictingProject", () => {
  const classificado = makeProject({
    id: "proj-classificado",
    client_id: "client-a",
    name: "Comercial - Prospecção de Clientes",
    erp_area: "Comercial",
    erp_subarea: "Prospecção de Clientes",
    erp_item: null,
  });
  const nomeado = makeProject({
    id: "proj-nomeado",
    client_id: "client-a",
    name: "Reestruturação Comercial 2026",
  });
  const outroCliente = makeProject({
    id: "proj-outro-cliente",
    client_id: "client-b",
    name: "Comercial - Prospecção de Clientes",
    erp_area: "Comercial",
    erp_subarea: "Prospecção de Clientes",
    erp_item: null,
  });
  const mesclado = makeProject({
    id: "proj-mesclado",
    client_id: "client-a",
    name: "Comercial - Prospecção de Clientes",
    erp_area: "Comercial",
    erp_subarea: "Prospecção de Clientes",
    erp_item: null,
    merged_into_project_id: "proj-classificado",
  });
  const projects = [classificado, nomeado, outroCliente, mesclado];

  test("mesma classificação (item null tratado como vazio) acha o projeto", () => {
    const result = findConflictingProject(projects, "classificacao", {
      clientId: "client-a",
      excludeId: "proj-em-edicao",
      area: "Comercial",
      subarea: "Prospecção de Clientes",
      item: "",
    });
    expect(result?.id).toBe("proj-classificado");
  });

  test("item vazio e item null são equivalentes na comparação de classificação", () => {
    const comItemVazio = makeProject({
      id: "proj-item-vazio",
      client_id: "client-a",
      erp_area: "Comercial",
      erp_subarea: "Prospecção de Clientes",
      erp_item: "",
    });
    const result = findConflictingProject([comItemVazio], "classificacao", {
      clientId: "client-a",
      excludeId: "proj-em-edicao",
      area: "Comercial",
      subarea: "Prospecção de Clientes",
      item: null,
    });
    expect(result?.id).toBe("proj-item-vazio");
  });

  test("mesmo nome normalizado acha o projeto", () => {
    const result = findConflictingProject(projects, "nome", {
      clientId: "client-a",
      excludeId: "proj-em-edicao",
      name: "reestruturacao   comercial 2026",
    });
    expect(result?.id).toBe("proj-nomeado");
  });

  test("ignora o próprio projeto (excludeId)", () => {
    const result = findConflictingProject(projects, "classificacao", {
      clientId: "client-a",
      excludeId: "proj-classificado",
      area: "Comercial",
      subarea: "Prospecção de Clientes",
      item: "",
    });
    expect(result).toBeNull();
  });

  test("ignora projeto de outro cliente", () => {
    const result = findConflictingProject(projects, "classificacao", {
      clientId: "client-does-not-exist",
      excludeId: "proj-em-edicao",
      area: "Comercial",
      subarea: "Prospecção de Clientes",
      item: "",
    });
    expect(result).toBeNull();
  });

  test("ignora projeto mesclado (merged_into_project_id preenchido)", () => {
    const soMesclado = [mesclado];
    const result = findConflictingProject(soMesclado, "classificacao", {
      clientId: "client-a",
      excludeId: "proj-em-edicao",
      area: "Comercial",
      subarea: "Prospecção de Clientes",
      item: "",
    });
    expect(result).toBeNull();
  });

  test("sem conflito devolve null", () => {
    const result = findConflictingProject(projects, "nome", {
      clientId: "client-a",
      excludeId: "proj-em-edicao",
      name: "Nome que não existe em nenhum projeto",
    });
    expect(result).toBeNull();
  });
});

describe("classificationLoaded", () => {
  test("os três campos presentes (mesmo com valor) = carregado", () => {
    expect(
      classificationLoaded({ erp_area: "Comercial", erp_subarea: "Prospecção", erp_item: "X" }),
    ).toBe(true);
  });

  test("os três nulos conta como carregado", () => {
    expect(classificationLoaded({ erp_area: null, erp_subarea: null, erp_item: null })).toBe(true);
  });

  test("um campo undefined = não carregado", () => {
    expect(
      classificationLoaded({
        erp_area: "Comercial",
        erp_subarea: "Prospecção",
        erp_item: undefined,
      }),
    ).toBe(false);
    expect(classificationLoaded({ erp_area: undefined, erp_subarea: null, erp_item: null })).toBe(
      false,
    );
  });

  test("objeto sem os campos = não carregado", () => {
    expect(classificationLoaded({})).toBe(false);
  });
});

const root = resolve(import.meta.dir, "..");
function source(path: string): string {
  return readFileSync(resolve(root, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}

describe("projectDetailQuery seleciona as colunas de classificação do ERP", () => {
  const projectDetail = source("src/lib/project-detail.ts");

  test("o select do detalhe do projeto cita erp_area, erp_subarea e erp_item", () => {
    expect(projectDetail).toContain("erp_area");
    expect(projectDetail).toContain("erp_subarea");
    expect(projectDetail).toContain("erp_item");
  });
});
