import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const migrationsDir = resolve(root, "supabase", "migrations");
const base = readFileSync(resolve(migrationsDir, "20260811000000_initial_schema.sql"), "utf8");
const rls = readFileSync(resolve(migrationsDir, "20260811120000_rls_scope_carteira.sql"), "utf8");
const orchestrator = readFileSync(
  resolve(migrationsDir, "20260813220000_orchestrator_recommendations.sql"),
  "utf8",
);
const allSql = [base, rls, orchestrator].join("\n");

const expectedMigrations = [
  "20260811000000_initial_schema.sql",
  "20260811120000_rls_scope_carteira.sql",
  "20260813220000_orchestrator_recommendations.sql",
];

const guardedTables = [
  "projects",
  "meetings",
  "actions",
  "risks",
  "opportunities",
  "project_context",
  "decisions",
  "meeting_analyses",
  "analysis_applications",
  "entity_mentions",
  "meeting_evolution",
  "meeting_evolution_items",
  "project_health_snapshots",
  "project_dedupe_log",
];

function withoutComments(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

describe("Supabase backend baseline", () => {
  test("keeps one ordered canonical migration chain", () => {
    expect(readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()).toEqual(
      expectedMigrations,
    );
    expect(
      readdirSync(resolve(root, "db", "migrations")).filter((name) => name.endsWith(".sql")),
    ).toEqual([]);
  });

  test("creates every dependency before the migrations that consume it", () => {
    expect(base.indexOf("create table public.clients")).toBeLessThan(
      base.indexOf("create table public.projects"),
    );
    expect(base.indexOf("create table public.projects")).toBeLessThan(
      base.indexOf("create table public.meetings"),
    );
    expect(base).toContain("create or replace function public.can_access_scope(");
    expect(rls).toContain("public.can_access_scope(");
    expect(orchestrator).toContain("references public.projects(id)");
    for (const migration of [base, rls, orchestrator]) {
      expect(migration).toMatch(/\bbegin;[\s\S]*\bcommit;\s*$/i);
    }
  });

  test("guards every denormalized scope before insert and update", () => {
    const discovered = Array.from(
      base.matchAll(/create table public\.([a-z_]+)\s*\(([\s\S]*?)\r?\n\);/g),
    )
      .filter((match) => {
        const identifiers = Array.from(
          match[2]!.matchAll(/^\s{2}([a-z_][a-z0-9_]*_id)\s+/gm),
        ).filter((identifier) =>
          /(?:^|_)(?:client|project|meeting|analysis|evolution)_id$/.test(identifier[1]!),
        );
        return identifiers.length > 1;
      })
      .map((match) => match[1]!)
      .sort();

    expect(discovered).toEqual([...guardedTables].sort());
    for (const table of guardedTables) {
      expect(base).toContain(`create trigger ${table}_scope_integrity`);
      expect(base).toContain(`on public.${table}\nfor each row execute function public.enforce_scope_integrity()`);
    }
    expect(orchestrator).toContain("before insert or update on public.orchestrator_recommendations");
  });

  test("uses one coherent RLS scope instead of permissive identifier ORs", () => {
    expect(rls).not.toMatch(/can_access_(?:client|project|meeting)\([^)]*\)\s+OR\s+public\.can_access_/i);
    expect(rls).toContain("USING (public.can_access_scope(client_id, project_id, meeting_id))");
    expect(rls).toContain(
      "public.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL)",
    );
    expect(rls).toContain(
      "public.can_access_related_scope(client_id, project_id, meeting_id, NULL, evolution_id)",
    );
    expect(orchestrator).toContain("public.can_access_scope(client_id, project_id, NULL)");
  });

  test("keeps the idempotency indexes required by current application code", () => {
    expect(base).toContain("create unique index entity_mentions_identity_uidx");
    expect(base).toContain("create unique index meeting_evolution_meeting_id_uidx");
    expect(base).toContain("create unique index project_health_snapshots_project_meeting_uidx");
  });

  test("contains no destructive data or schema operation", () => {
    const executableSql = withoutComments(allSql);
    const forbidden = [
      /\bdrop\s+table\b/i,
      /\bdrop\s+column\b/i,
      /\bdrop\s+schema\b/i,
      /\btruncate\b/i,
      /\bdelete\s+from\b/i,
      /\bdb\s+reset\b/i,
    ];
    for (const pattern of forbidden) expect(executableSql).not.toMatch(pattern);
  });
});
