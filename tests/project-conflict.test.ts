import { describe, expect, test } from "bun:test";
import {
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
