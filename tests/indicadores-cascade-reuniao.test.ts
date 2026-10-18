import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — vínculo ponto-reunião em cascata (18/10/2026).
 * Teste estático sobre o arquivo SQL (a migration NÃO é aplicada por este
 * gate — só o dono do produto aplica, à mão, depois, com conferência).
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
function source(path: string): string {
  return readFileSync(resolve(root, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}

const migration = source(
  "supabase/migrations/20261018120000_indicator_points_source_meeting_cascade.sql",
);

/**
 * Código SQL real, sem as linhas de comentário (`--`) — o comentário no
 * topo cita de propósito "DELETE FROM public.meetings" e "ON DELETE SET
 * NULL" como explicação do PROBLEMA que esta migration corrige, então
 * checar "nenhuma operação destrutiva"/"nenhum SET NULL" direto no texto
 * inteiro (prosa incluída) daria falso positivo.
 */
const code = migration
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration 20261018120000 — estrutura geral", () => {
  test("é uma transação (BEGIN;/COMMIT;)", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
    expect(migration.indexOf("BEGIN;")).toBeLessThan(migration.indexOf("COMMIT;"));
  });

  test("o código (fora dos comentários) não contém operação destrutiva de dados", () => {
    const lower = code.toLowerCase();
    expect(lower).not.toContain("drop table");
    expect(lower).not.toContain("truncate table");
    expect(lower).not.toContain("delete from");
  });
});

describe("derruba a chave estrangeira atual por descoberta, não por nome suposto", () => {
  test("descobre o nome real em pg_constraint (conrelid/contype/confrelid/conkey), não assume indicator_points_source_meeting_id_fkey de antemão", () => {
    expect(migration).toContain("FROM pg_constraint con");
    expect(migration).toContain("con.conrelid = 'public.indicator_points'::regclass");
    expect(migration).toContain("con.contype = 'f'");
    expect(migration).toContain("con.confrelid = 'public.meetings'::regclass");
    expect(migration).toContain("con.conkey = ARRAY[v_attnum]");
  });

  test("resolve a coluna source_meeting_id via pg_attribute antes de comparar conkey", () => {
    expect(migration).toContain("FROM pg_attribute");
    expect(migration).toContain("attrelid = 'public.indicator_points'::regclass");
    expect(migration).toContain("attname = 'source_meeting_id'");
  });

  test("levanta exceção explícita se a chave não for encontrada, em vez de seguir em silêncio", () => {
    expect(migration).toContain("IF v_constraint_name IS NULL THEN");
    expect(migration).toContain("RAISE EXCEPTION");
  });

  test("o DROP CONSTRAINT usa o nome descoberto dinamicamente (EXECUTE format com %I), não uma string fixa", () => {
    expect(migration).toContain(
      "EXECUTE format('ALTER TABLE public.indicator_points DROP CONSTRAINT %I', v_constraint_name);",
    );
  });
});

describe("recria a chave com ON DELETE CASCADE — nunca mais SET NULL", () => {
  test("a nova chave referencia meetings(id) com ON DELETE CASCADE", () => {
    expect(migration).toContain(
      "ALTER TABLE public.indicator_points\n  ADD CONSTRAINT indicator_points_source_meeting_id_fkey\n  FOREIGN KEY (source_meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;",
    );
  });

  test("o código (fora dos comentários) não contém mais nenhum ON DELETE SET NULL", () => {
    expect(code).not.toContain("ON DELETE SET NULL");
  });

  test("a chave nova tem nome explícito (não depende de novo da convenção automática do Postgres)", () => {
    expect(migration).toContain("ADD CONSTRAINT indicator_points_source_meeting_id_fkey");
  });
});

describe("escopo mínimo — só a chave estrangeira de source_meeting_id, nada mais", () => {
  test("não cria, altera nem remove nenhuma tabela", () => {
    expect(migration).not.toContain("CREATE TABLE");
    expect(migration).not.toContain("DROP TABLE");
  });

  test("não toca em nenhuma policy de RLS", () => {
    expect(migration.toUpperCase()).not.toContain("CREATE POLICY");
    expect(migration.toUpperCase()).not.toContain("ALTER POLICY");
    expect(migration.toUpperCase()).not.toContain("DROP POLICY");
  });

  test("não concede nem revoga privilégio algum (sem GRANT/REVOKE)", () => {
    expect(migration).not.toMatch(/\bGRANT\b/);
    expect(migration).not.toMatch(/\bREVOKE\b/);
  });

  test("não cria nem altera nenhuma função ou gatilho (admin_undo_meeting só é citado no comentário, nunca modificado)", () => {
    expect(code).not.toContain("admin_undo_meeting");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION");
    expect(migration).not.toContain("CREATE TRIGGER");
  });

  test("não toca em public.indicators, só em public.indicator_points", () => {
    expect(migration).not.toMatch(/ALTER TABLE public\.indicators\b/);
    expect(migration).not.toContain("public.indicators (");
  });

  test("não menciona outras colunas de indicator_points além de source_meeting_id", () => {
    expect(migration).not.toContain("baseline_value");
    expect(migration).not.toContain("target_value");
    expect(migration).not.toContain("basis");
    expect(migration).not.toContain("evidence");
  });
});

describe("comentário no topo explica o motivo e deixa claro que o indicador não é apagado", () => {
  test("cita o problema real (SET NULL original, admin_undo_meeting excluindo a reunião, ponto duplicado ao reprocessar)", () => {
    expect(migration).toContain("ON DELETE SET NULL");
    expect(migration).toContain("admin_undo_meeting");
    expect(migration).toContain("duplicado");
  });

  test("declara explicitamente que o indicador em si nunca é apagado por esta migration", () => {
    expect(migration).toContain(
      "O INDICADOR em\n-- si (public.indicators) NUNCA é apagado por esta migration",
    );
  });

  test("declara explicitamente que pontos manuais não são afetados", () => {
    expect(migration).toContain("Pontos manuais (source = 'manual') nunca são afetados");
  });
});
