import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Cadastro de pessoas e apelidos por cliente — Gate A (migration),
 * 19/10/2026. Teste estático sobre o arquivo SQL (a migration NÃO é
 * aplicada por este gate — só o dono do produto aplica, à mão, depois).
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
function source(path: string): string {
  return readFileSync(resolve(root, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}

const migration = source("supabase/migrations/20261019140000_create_client_people.sql");

describe("migration 20261019140000_create_client_people — estrutura geral", () => {
  test("é uma transação (BEGIN;/COMMIT;)", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
  });

  test("não contém operação destrutiva de schema/dados", () => {
    const lower = migration.toLowerCase();
    expect(lower).not.toContain("drop table");
    expect(lower).not.toContain("truncate table");
    expect(lower).not.toContain("delete from");
  });

  test("a tabela existe", () => {
    expect(migration).toContain("CREATE TABLE public.client_people (");
  });
});

describe("Colunas — side, role, functions, active", () => {
  test("side restrito a cliente|consultoria|terceiro", () => {
    expect(migration).toContain(
      "side text NOT NULL CHECK (side IN ('cliente', 'consultoria', 'terceiro')),",
    );
  });

  test("role é texto livre e opcional (sem NOT NULL)", () => {
    expect(migration).toContain("role text,");
  });

  test("functions é text[] com default lista vazia", () => {
    expect(migration).toContain("functions text[] NOT NULL DEFAULT '{}'");
  });

  test("CHECK de functions cobre exatamente executa|monitora|acompanha|decide, nenhuma outra", () => {
    expect(migration).toContain(
      "CHECK (functions <@ ARRAY['executa', 'monitora', 'acompanha', 'decide']::text[]),",
    );
  });

  test("active é boolean, default true", () => {
    expect(migration).toContain("active boolean NOT NULL DEFAULT true,");
  });

  test("aliases é text[] com default lista vazia", () => {
    expect(migration).toContain("aliases text[] NOT NULL DEFAULT '{}',");
  });
});

describe("Unicidade de nome canônico por cliente (normalizado)", () => {
  test("índice único em (client_id, normalize_project_name(name))", () => {
    expect(migration).toContain(
      "CREATE UNIQUE INDEX client_people_client_name_key\n  ON public.client_people (client_id, public.normalize_project_name(name));",
    );
  });

  test("índice auxiliar por client_id", () => {
    expect(migration).toContain(
      "CREATE INDEX client_people_client_idx ON public.client_people (client_id);",
    );
  });
});

describe("Apelidos não repetem entre pessoas do mesmo cliente (gatilho cruzado)", () => {
  test("gatilho client_people_unique_names_guard existe, BEFORE INSERT OR UPDATE", () => {
    expect(migration).toContain(
      "CREATE TRIGGER client_people_unique_names_guard\n  BEFORE INSERT OR UPDATE ON public.client_people\n  FOR EACH ROW EXECUTE FUNCTION public.guard_client_people_unique_names();",
    );
  });

  test("a função compara nome+apelidos normalizados contra as demais pessoas do mesmo cliente, excluindo a própria linha", () => {
    const start = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.guard_client_people_unique_names()",
    );
    const end = migration.indexOf("CREATE TRIGGER client_people_unique_names_guard", start);
    const body = migration.slice(start, end);
    expect(body).toContain("p.client_id = NEW.client_id");
    expect(body).toContain("p.id <> NEW.id");
    expect(body).toContain("array_append(NEW.aliases, NEW.name)");
    expect(body).toContain("array_append(p.aliases, p.name)");
    expect(body).toContain("USING ERRCODE = '23505'");
  });

  test("recusa nome ou apelido sem nenhuma letra ou número (token normalizado vazio), com ERRCODE 23514", () => {
    const start = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.guard_client_people_unique_names()",
    );
    const end = migration.indexOf("CREATE TRIGGER client_people_unique_names_guard", start);
    const body = migration.slice(start, end);
    expect(body).toContain("'' = ANY (v_new_tokens)");
    expect(body).toContain("nome ou apelido precisa ter letras ou números");
    expect(body).toContain("USING ERRCODE = '23514'");
    // A recusa de token vazio vem ANTES da checagem de duplicidade (23505).
    const emptyCheckIdx = body.indexOf("'' = ANY (v_new_tokens)");
    const duplicateCheckIdx = body.indexOf("v_conflict_name IS NOT NULL");
    expect(emptyCheckIdx).toBeGreaterThan(-1);
    expect(duplicateCheckIdx).toBeGreaterThan(-1);
    expect(emptyCheckIdx).toBeLessThan(duplicateCheckIdx);
  });

  test("função de gatilho é SECURITY INVOKER, nunca SECURITY DEFINER, e sem GRANT EXECUTE", () => {
    const start = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.guard_client_people_unique_names()",
    );
    const end = migration.indexOf("$$;", start);
    const body = migration.slice(start, end);
    expect(body).toContain("SECURITY INVOKER");
    expect(body).not.toContain("SECURITY DEFINER");
    expect(migration).not.toContain(
      "GRANT EXECUTE ON FUNCTION public.guard_client_people_unique_names()",
    );
  });
});

describe("Gatilho touch_updated_at", () => {
  test("client_people_touch, executando public.touch_updated_at()", () => {
    expect(migration).toContain(
      "CREATE TRIGGER client_people_touch\n  BEFORE UPDATE ON public.client_people\n  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();",
    );
  });
});

describe("RLS — ligada, sem USING (true) em lugar nenhum", () => {
  test("ENABLE ROW LEVEL SECURITY", () => {
    expect(migration).toContain("ALTER TABLE public.client_people ENABLE ROW LEVEL SECURITY;");
  });

  test("nenhuma policy usa USING (true) ou WITH CHECK (true)", () => {
    expect(migration).not.toContain("USING (true)");
    expect(migration).not.toContain("WITH CHECK (true)");
  });

  test("policies de select/insert/update usam app_private.can_access_client (tabela sem project_id)", () => {
    const scopeCalls = migration.match(/app_private\.can_access_client\(/g) ?? [];
    // 3 policies (visible/insert/update); update usa USING e WITH CHECK (mesma expressão).
    expect(scopeCalls.length).toBeGreaterThanOrEqual(4);
    // can_access_scope só aparece em comentário explicando a escolha (tabela
    // sem project_id) — nenhuma linha de CREATE POLICY pode usá-la.
    const policyLines = migration
      .split("\n")
      .filter((l) => /^(CREATE POLICY|USING|WITH CHECK)/.test(l));
    for (const line of policyLines) {
      expect(line).not.toContain("can_access_scope");
    }
    expect(migration).toContain(
      'CREATE POLICY "client_people visible" ON public.client_people FOR SELECT TO authenticated\nUSING (app_private.can_access_client(client_id));',
    );
  });

  test("delete só para admin (app_private.is_admin())", () => {
    expect(migration).toContain(
      'CREATE POLICY "client_people delete" ON public.client_people FOR DELETE TO authenticated\nUSING (app_private.is_admin());',
    );
  });
});

describe("Grants — nenhum privilégio para anon, PUBLIC ou authenticated além do necessário", () => {
  test("REVOKE ALL explícito de PUBLIC, anon E authenticated", () => {
    expect(migration).toContain(
      "REVOKE ALL ON public.client_people FROM PUBLIC, anon, authenticated;",
    );
  });

  test("o REVOKE vem ANTES dos GRANTs de SELECT/INSERT/UPDATE/DELETE a authenticated", () => {
    const revokeIdx = migration.indexOf(
      "REVOKE ALL ON public.client_people FROM PUBLIC, anon, authenticated;",
    );
    const grantIdx = migration.indexOf(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_people TO authenticated;",
    );
    expect(revokeIdx).toBeGreaterThan(-1);
    expect(revokeIdx).toBeLessThan(grantIdx);
  });

  test("nenhuma linha de GRANT cita anon ou PUBLIC", () => {
    const grantLines = migration.split("\n").filter((l) => /^\s*GRANT\s/.test(l));
    expect(grantLines.length).toBeGreaterThan(0);
    for (const line of grantLines) {
      expect(line).not.toMatch(/\banon\b/);
      expect(line).not.toMatch(/\bPUBLIC\b/);
    }
  });

  test("authenticated e service_role recebem os grants esperados", () => {
    expect(migration).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_people TO authenticated;",
    );
    expect(migration).toContain("GRANT ALL ON public.client_people TO service_role;");
  });
});
