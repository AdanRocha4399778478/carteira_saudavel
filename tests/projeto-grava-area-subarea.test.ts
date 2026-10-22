import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * R01 (19/10/2026): get_or_create_project_erp, ramo 2 (reaproveita
 * projeto existente SEM classificação pelo nome normalizado), devolvia o
 * projeto sem nunca gravar a Área/Subárea/Item escolhidos na
 * Identificação. Teste estático sobre o arquivo SQL — a migration NÃO é
 * aplicada por este gate; só o dono do produto aplica, à mão, depois,
 * com conferência.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
function source(path: string): string {
  return readFileSync(resolve(root, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}

const migration = source(
  "supabase/migrations/20261019120000_get_or_create_project_erp_classifica_ao_reaproveitar.sql",
);

/** Código SQL real, sem as linhas de comentário (`--`). */
const code = migration
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration 20261019120000 — estrutura geral", () => {
  test("é uma transação (begin;/commit;)", () => {
    expect(migration).toContain("begin;");
    expect(migration).toContain("commit;");
    expect(migration.indexOf("begin;")).toBeLessThan(migration.indexOf("commit;"));
  });

  test("usa CREATE OR REPLACE FUNCTION — não dropa nem recria o índice único de classificação", () => {
    expect(code.toLowerCase()).toContain(
      "create or replace function public.get_or_create_project_erp",
    );
    expect(code.toLowerCase()).not.toContain("drop function");
    expect(code.toLowerCase()).not.toContain("create unique index");
    expect(code.toLowerCase()).not.toContain("drop index");
  });

  test("o código (fora dos comentários) não contém operação destrutiva de dados", () => {
    const lower = code.toLowerCase();
    expect(lower).not.toContain("drop table");
    expect(lower).not.toContain("truncate table");
    expect(lower).not.toContain("delete from");
  });

  test("mesma assinatura da função (7 parâmetros, mesmos nomes e defaults)", () => {
    expect(migration).toContain(
      "create or replace function public.get_or_create_project_erp(\n  p_client_id uuid,\n  p_name text,\n  p_erp_area text,\n  p_erp_subarea text,\n  p_erp_item text default null,\n  p_description text default null,\n  p_analysis_id uuid default null\n)",
    );
    expect(migration).toContain("returns jsonb");
    expect(migration).toContain("language plpgsql");
    expect(migration).toContain("set search_path to 'public'");
  });

  test("mesmo revoke/grant da versão atual, sem GRANT novo nem mudança de papel", () => {
    expect(migration).toContain(
      "revoke all on function public.get_or_create_project_erp(uuid, text, text, text, text, text, uuid) from public, anon;",
    );
    expect(migration).toContain(
      "grant execute on function public.get_or_create_project_erp(uuid, text, text, text, text, text, uuid) to authenticated;",
    );
  });
});

describe("ramo 1 (classificação já existe) — intocado", () => {
  test("continua retornando 'existing erp classification' sem nenhum UPDATE", () => {
    const start = migration.indexOf("-- 1) Ja existe projeto vivo com esta classificacao");
    const end = migration.indexOf("-- 2) Ja existe projeto vivo (sem classificacao)");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = migration.slice(start, end);
    expect(block).not.toContain("update public.projects");
    expect(block).toContain("'reason', 'existing erp classification'");
  });
});

describe("ramo 2 (reaproveita por nome) — classifica só quando ainda está sem classificação", () => {
  const start = migration.indexOf("-- 2) Ja existe projeto vivo (sem classificacao)");
  const end = migration.indexOf("select c.consultant_id into v_consultant_id");
  const block = migration.slice(start, end);

  test("o UPDATE grava erp_area/erp_subarea/erp_item já normalizados (v_area/v_subarea/v_item)", () => {
    expect(block).toContain("update public.projects");
    expect(block).toContain("set erp_area = v_area, erp_subarea = v_subarea, erp_item = v_item");
  });

  test("o UPDATE só afeta o projeto reaproveitado e só quando ele ainda está sem classificação", () => {
    expect(block).toContain(
      "where id = v_project_id\n      and (erp_area is null or erp_area = '')",
    );
  });

  test("projeto que já tem classificação não é tocado (FOUND falso) e mantém o reason antigo", () => {
    expect(block).toContain("if found then");
    expect(block).toContain("'reason', 'existing normalized project (classified)'");
    expect(block).toContain("'reason', 'existing normalized project'");
    // O reason antigo (sem sufixo) só pode vir DEPOIS do bloco "if found",
    // ou seja, no ramo em que o UPDATE não afetou nenhuma linha.
    const foundIdx = block.indexOf("if found then");
    const classifiedReasonIdx = block.indexOf("(classified)");
    const oldReasonIdx = block.lastIndexOf("'existing normalized project'");
    expect(classifiedReasonIdx).toBeGreaterThan(foundIdx);
    expect(oldReasonIdx).toBeGreaterThan(classifiedReasonIdx);
  });

  test("nenhum risco de colidir com o índice único: comentário documenta que o ramo 1 já garantiu isso na mesma chamada", () => {
    expect(migration).toContain(
      "o ramo 1, rodado segundos antes na mesma\n    -- chamada, ja garantiu que esta classificacao não colide com outro\n    -- projeto vivo deste cliente",
    );
  });
});

describe("demais ramos (criação nova, concorrência, log de dedupe) — intocados", () => {
  test("INSERT de criação continua gravando erp_area/erp_subarea/erp_item (sem mudança)", () => {
    expect(migration).toContain(
      "insert into public.projects (\n      client_id, consultant_id, created_by, name, normalized_name, description,\n      erp_area, erp_subarea, erp_item\n    ) values (\n      p_client_id, v_consultant_id, auth.uid(), trim(p_name), v_normalized, p_description,\n      v_area, v_subarea, v_item\n    ) returning id into v_project_id;",
    );
  });

  test("tratamento de unique_violation (concorrência) continua igual, reason 'concurrent project'", () => {
    expect(migration).toContain("exception when unique_violation then");
    expect(migration).toContain("'reason', 'concurrent project'");
  });

  test("project_dedupe_log continua só no ramo de criação nova (p_analysis_id)", () => {
    expect(migration).toContain("if p_analysis_id is not null then");
    expect(migration).toContain("insert into public.project_dedupe_log");
  });
});
