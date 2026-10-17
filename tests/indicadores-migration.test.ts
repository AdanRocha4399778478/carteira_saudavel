import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 1 (migration), 17/10/2026. Teste
 * estático sobre o arquivo SQL (a migration NÃO é aplicada por este
 * gate — só o dono do produto aplica, à mão, depois). Modelagem B:
 * indicators (definição, com baseline_value/target_value como colunas) +
 * indicator_points (histórico), decidida pelo dono do produto.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
function source(path: string): string {
  return readFileSync(resolve(root, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}

const migration = source("supabase/migrations/20261017120000_create_indicators.sql");

describe("migration 20261017120000_create_indicators — estrutura geral", () => {
  test("é uma transação (BEGIN;/COMMIT;)", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
  });

  test("não contém operação destrutiva de schema/dados", () => {
    const lower = migration.toLowerCase();
    expect(lower).not.toContain("drop table");
    // "truncate" sozinho aparece em comentário (privilégio de ACL revogado
    // explicitamente) — a operação destrutiva de verdade seria "truncate table".
    expect(lower).not.toContain("truncate table");
    expect(lower).not.toContain("delete from");
  });

  test("as duas tabelas existem", () => {
    expect(migration).toContain("CREATE TABLE public.indicators (");
    expect(migration).toContain("CREATE TABLE public.indicator_points (");
  });
});

describe("RLS — ligada nas duas, sem USING (true) em lugar nenhum", () => {
  test("ENABLE ROW LEVEL SECURITY nas duas tabelas", () => {
    expect(migration).toContain("ALTER TABLE public.indicators ENABLE ROW LEVEL SECURITY;");
    expect(migration).toContain("ALTER TABLE public.indicator_points ENABLE ROW LEVEL SECURITY;");
  });

  test("nenhuma policy usa USING (true) ou WITH CHECK (true)", () => {
    expect(migration).not.toContain("USING (true)");
    expect(migration).not.toContain("WITH CHECK (true)");
  });

  test("policies de select/insert/update das duas tabelas usam app_private.can_access_scope", () => {
    const scopeCalls = migration.match(/app_private\.can_access_scope\(/g) ?? [];
    // 3 policies (visible/insert/update) x 2 tabelas = 6 chamadas de escopo
    // (update usa USING e WITH CHECK, mas são a mesma expressão reaproveitada).
    expect(scopeCalls.length).toBeGreaterThanOrEqual(6);
    expect(migration).toContain(
      'CREATE POLICY "indicators visible" ON public.indicators FOR SELECT TO authenticated\nUSING (app_private.can_access_scope(client_id, project_id, NULL));',
    );
    expect(migration).toContain(
      'CREATE POLICY "indicator_points visible" ON public.indicator_points FOR SELECT TO authenticated\nUSING (app_private.can_access_scope(client_id, project_id, NULL));',
    );
  });

  test("delete só para admin (app_private.is_admin()), mesmo padrão de decisions", () => {
    expect(migration).toContain(
      'CREATE POLICY "indicators delete" ON public.indicators FOR DELETE TO authenticated\nUSING (app_private.is_admin());',
    );
    expect(migration).toContain(
      'CREATE POLICY "indicator_points delete" ON public.indicator_points FOR DELETE TO authenticated\nUSING (app_private.is_admin());',
    );
  });
});

describe("Grants — nenhum privilégio para anon, PUBLIC ou authenticated além do necessário", () => {
  test("REVOKE ALL explícito de PUBLIC, anon E authenticated nas duas tabelas (ACL padrão do schema dava TRUNCATE/REFERENCES/TRIGGER/MAINTAIN de graça)", () => {
    expect(migration).toContain(
      "REVOKE ALL ON public.indicators FROM PUBLIC, anon, authenticated;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON public.indicator_points FROM PUBLIC, anon, authenticated;",
    );
  });

  test("o REVOKE de authenticated vem ANTES dos GRANTs de SELECT/INSERT/UPDATE/DELETE a authenticated", () => {
    const revokeIndicatorsIdx = migration.indexOf(
      "REVOKE ALL ON public.indicators FROM PUBLIC, anon, authenticated;",
    );
    const revokePointsIdx = migration.indexOf(
      "REVOKE ALL ON public.indicator_points FROM PUBLIC, anon, authenticated;",
    );
    const grantIndicatorsIdx = migration.indexOf(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.indicators TO authenticated;",
    );
    const grantPointsIdx = migration.indexOf(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.indicator_points TO authenticated;",
    );
    expect(revokeIndicatorsIdx).toBeGreaterThan(-1);
    expect(revokePointsIdx).toBeGreaterThan(-1);
    expect(revokeIndicatorsIdx).toBeLessThan(grantIndicatorsIdx);
    expect(revokePointsIdx).toBeLessThan(grantPointsIdx);
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
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.indicators TO authenticated;",
    );
    expect(migration).toContain("GRANT ALL ON public.indicators TO service_role;");
    expect(migration).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.indicator_points TO authenticated;",
    );
    expect(migration).toContain("GRANT ALL ON public.indicator_points TO service_role;");
  });
});

describe("Gatilho touch_updated_at nas duas tabelas", () => {
  test("indicators_touch e indicator_points_touch, executando public.touch_updated_at()", () => {
    expect(migration).toContain(
      "CREATE TRIGGER indicators_touch\n  BEFORE UPDATE ON public.indicators\n  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();",
    );
    expect(migration).toContain(
      "CREATE TRIGGER indicator_points_touch\n  BEFORE UPDATE ON public.indicator_points\n  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();",
    );
  });
});

describe("Checks de domínio — kind, direction, basis, source", () => {
  test("indicators.kind restrito a percentual|valor|tempo|quantidade", () => {
    expect(migration).toContain(
      "kind text NOT NULL CHECK (kind IN ('percentual', 'valor', 'tempo', 'quantidade')),",
    );
  });

  test("indicators.direction restrito a maior_melhor|menor_melhor (direção por indicador)", () => {
    expect(migration).toContain(
      "direction text NOT NULL CHECK (direction IN ('maior_melhor', 'menor_melhor')),",
    );
  });

  test("indicators.frequency é só rótulo informativo (semanal|mensal), nullable", () => {
    expect(migration).toContain("frequency text CHECK (frequency IN ('semanal', 'mensal')),");
  });

  test("indicator_points.basis restrito a medido|estimado (marca em todo ponto)", () => {
    expect(migration).toContain("basis text NOT NULL CHECK (basis IN ('medido', 'estimado')),");
  });

  test("indicator_points.source restrito a manual|reuniao", () => {
    expect(migration).toContain(
      "source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'reuniao')),",
    );
  });
});

describe("Valor de ponto nunca vira zero", () => {
  test("indicator_points.value é NOT NULL sem DEFAULT nenhum", () => {
    expect(migration).toContain("value numeric NOT NULL,");
    // Garante que não existe um DEFAULT escondido na mesma declaração.
    expect(migration).not.toMatch(/value numeric NOT NULL DEFAULT/);
  });
});

describe("Índice único em (project_id, lower(name), kind)", () => {
  test("indicators_project_name_kind_key cobre exatamente esses três campos", () => {
    expect(migration).toContain(
      "CREATE UNIQUE INDEX indicators_project_name_kind_key\n  ON public.indicators (project_id, lower(name), kind);",
    );
  });

  test("índices auxiliares por project_id e client_id em indicators", () => {
    expect(migration).toContain(
      "CREATE INDEX indicators_project_idx ON public.indicators (project_id);",
    );
    expect(migration).toContain(
      "CREATE INDEX indicators_client_idx ON public.indicators (client_id);",
    );
  });

  test("índice de indicator_points por (indicator_id, measured_at)", () => {
    expect(migration).toContain(
      "CREATE INDEX indicator_points_indicator_measured_idx\n  ON public.indicator_points (indicator_id, measured_at);",
    );
  });
});

describe("Modelagem B — linha de base e meta são colunas, não pontos especiais", () => {
  test("baseline_value/baseline_at/target_value existem como colunas de indicators", () => {
    expect(migration).toContain("baseline_value numeric,");
    expect(migration).toContain("baseline_at date,");
    expect(migration).toContain("target_value numeric,");
  });

  test("indicator_points não tem nenhuma coluna de flag 'é linha de base' (não é modelagem A)", () => {
    expect(migration).not.toContain("is_baseline");
    expect(migration).not.toContain("is_target");
  });
});

describe("indicator_points denormaliza client_id/project_id do pai, com gatilho de sincronia", () => {
  test("client_id e project_id existem em indicator_points (não é subconsulta ao pai na policy)", () => {
    expect(migration).toContain(
      "client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,",
    );
    expect(migration).toContain(
      "project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,",
    );
  });

  test("gatilho indicator_points_sync_scope garante consistência com o indicador pai", () => {
    expect(migration).toContain("CREATE TRIGGER indicator_points_sync_scope");
    expect(migration).toContain("sync_indicator_point_scope");
  });
});

describe("Funções de gatilho em SECURITY INVOKER, nunca SECURITY DEFINER", () => {
  test("sync_indicator_point_scope é SECURITY INVOKER", () => {
    const start = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.sync_indicator_point_scope()",
    );
    const end = migration.indexOf("$$;", start);
    const body = migration.slice(start, end);
    expect(body).toContain("SECURITY INVOKER");
    expect(body).not.toContain("SECURITY DEFINER");
  });

  test("guard_indicators_scope é SECURITY INVOKER", () => {
    const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.guard_indicators_scope()");
    const end = migration.indexOf("$$;", start);
    const body = migration.slice(start, end);
    expect(body).toContain("SECURITY INVOKER");
    expect(body).not.toContain("SECURITY DEFINER");
  });

  test("nenhuma das duas funções tem GRANT EXECUTE (gatilho não precisa)", () => {
    expect(migration).not.toContain(
      "GRANT EXECUTE ON FUNCTION public.sync_indicator_point_scope()",
    );
    expect(migration).not.toContain("GRANT EXECUTE ON FUNCTION public.guard_indicators_scope()");
  });
});

describe("Gatilho indicators_scope_guard — client_id sempre do projeto, nunca trocável depois", () => {
  test("o gatilho existe, BEFORE INSERT OR UPDATE em public.indicators", () => {
    expect(migration).toContain(
      "CREATE TRIGGER indicators_scope_guard\n  BEFORE INSERT OR UPDATE ON public.indicators\n  FOR EACH ROW EXECUTE FUNCTION public.guard_indicators_scope();",
    );
  });

  test("valida client_id contra projects.client_id do project_id informado, com ERRCODE 23514", () => {
    const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.guard_indicators_scope()");
    const end = migration.indexOf("CREATE TRIGGER indicators_scope_guard", start);
    const body = migration.slice(start, end);
    expect(body).toContain("FROM public.projects");
    expect(body).toContain("NEW.client_id IS DISTINCT FROM v_project_client_id");
    expect(body).toContain("USING ERRCODE = '23514'");
  });

  test("cobre INSERT (TG_OP) e UPDATE: proíbe trocar client_id e project_id só no UPDATE", () => {
    const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.guard_indicators_scope()");
    const end = migration.indexOf("CREATE TRIGGER indicators_scope_guard", start);
    const body = migration.slice(start, end);
    expect(body).toContain("IF TG_OP = 'UPDATE' THEN");
    expect(body).toContain("NEW.client_id IS DISTINCT FROM OLD.client_id");
    expect(body).toContain("NEW.project_id IS DISTINCT FROM OLD.project_id");
  });

  test("mensagens de erro em português", () => {
    const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.guard_indicators_scope()");
    const end = migration.indexOf("CREATE TRIGGER indicators_scope_guard", start);
    const body = migration.slice(start, end);
    expect(body).toContain("não é permitido alterar client_id de um indicador já criado");
    expect(body).toContain("não é permitido alterar project_id de um indicador já criado");
  });
});

describe("Sem acesso do cliente nesta versão", () => {
  test("nenhuma policy ou grant menciona um papel de cliente/portal", () => {
    expect(migration.toLowerCase()).not.toContain("client_portal");
    expect(migration.toLowerCase()).not.toContain(" to client");
  });
});
