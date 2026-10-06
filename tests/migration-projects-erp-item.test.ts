import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
function source(path: string): string {
  return readFileSync(resolve(root, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}

const migration = source(
  "supabase/migrations/20261006010000_projects_erp_item_e_nome_normalizado.sql",
);

describe("migration 20261006010000_projects_erp_item_e_nome_normalizado", () => {
  test("é uma transação (begin;/commit;)", () => {
    expect(migration).toContain("begin;");
    expect(migration).toContain("commit;");
  });

  test("adiciona a coluna erp_item e as duas peças de coerência de nível", () => {
    expect(migration).toContain("erp_item");
    expect(migration).toContain("projects_erp_levels_chk");
    expect(migration).toContain("projects_sync_normalized_name");
  });

  test("não contém operação destrutiva de schema/dados", () => {
    expect(migration.toLowerCase()).not.toContain("drop table");
    expect(migration.toLowerCase()).not.toContain("truncate");
  });
});
