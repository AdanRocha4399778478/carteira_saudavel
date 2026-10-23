import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Gate "remove OWNER_ALIAS_SEED" (19/10/2026) — escopo: só
 * src/lib/deduplication.ts e os testes que dependiam da lista fixa. Sem
 * migration, sem consulta nova, sem tocar na IA, no preview nem em
 * src/integrations/*.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

function changedOrNewPaths(): string {
  let out = "";
  try {
    out += execSync("git diff --name-only origin/main", { cwd: root }).toString();
  } catch {
    /* sem origin/main alcançável neste ambiente — segue só com status */
  }
  try {
    out += execSync("git status --porcelain", { cwd: root }).toString();
  } catch {
    /* ambiente sem git — nada a somar */
  }
  return out;
}

describe("OWNER_ALIAS_SEED removido, sem deixar rastro", () => {
  const dedupSource = read("src/lib/deduplication.ts");

  test("a constante OWNER_ALIAS_SEED e a função resolveOwnerAlias não existem mais (só sobra a menção ao nome do gate, em comentário)", () => {
    expect(dedupSource).not.toContain("const OWNER_ALIAS_SEED");
    expect(dedupSource).not.toContain("function resolveOwnerAlias");
    expect(dedupSource).not.toContain("resolveOwnerAlias(");
  });

  test("normalizeOwnerSet e hasOwnerConflict não recebem mais clientId", () => {
    expect(dedupSource).toContain(
      "export function normalizeOwnerSet(value: string | null | undefined): Set<string> {",
    );
    expect(dedupSource).toContain(
      "export function hasOwnerConflict(\n  incoming: string | null | undefined,\n  existing: string | null | undefined,\n): boolean {",
    );
  });

  test("os dois pontos de chamada de hasOwnerConflict (matchAction/matchDecision) não passam mais client_id", () => {
    expect(dedupSource).toContain(
      'hasOwnerConflict(item.owner_name, best.item.owner_name) ? "responsável" : null,',
    );
    expect(dedupSource).toContain(
      'hasOwnerConflict(item.owner, best.item.owner) ? "responsável" : null,',
    );
  });
});

describe("Escopo do gate — nada fora do combinado foi tocado", () => {
  test("nenhuma migration nova nesta branch", () => {
    // Exceção explícita: migration reconciliada com a produção (já aplicada lá).
    // Qualquer OUTRA migration nova continua proibida.
    const ALLOWED_MIGRATIONS = [
      "supabase/migrations/20260927203713_add_project_context_erp_summaries.sql",
    "supabase/migrations/20261023200000_codificar_drift_producao.sql",
    "supabase/migrations/20261024120000_catalogo_contratos_entregas_cadencia.sql",
    ];
    const changed = ALLOWED_MIGRATIONS.reduce(
      (acc, file) => acc.split(file).join(""),
      changedOrNewPaths(),
    );
    expect(changed).not.toMatch(/supabase\/migrations\//);
  });

  test("nenhuma consulta nova (sem novo arquivo de dados em src/lib)", () => {
    const changed = changedOrNewPaths();
    expect(changed).not.toMatch(/src\/lib\/[a-z-]+-data\.ts/);
  });

  // intelligent-meeting.server.ts (prompt da IA) era fora do escopo deste gate —
  // passou a ser tocado de propósito pelo gate "valores ditos e conferência de
  // extrato" (22/10/2026, substitui o PR #115), que tem sua própria checagem em
  // intelligent-meeting-values-and-reconciliation.test.ts.

  // MeetingAnalysisDialog.tsx era fora do escopo original deste gate —
  // passou a ser tocado de propósito pela VERIFICAÇÃO (19/10/2026, mesmo
  // gate): a reanálise dentro do diálogo não canonizava pelo cadastro (ver
  // describe "Verificação — reanálise canoniza..." em
  // client-people-owner-selector-wiring.test.ts). reuniao-inteligente.tsx e
  // projetos/$projectId.tsx continuam intocados.
  test("reuniao-inteligente.tsx e projetos/$projectId.tsx não foram tocados neste gate", () => {
    const changed = changedOrNewPaths();
    expect(changed).not.toContain("reuniao-inteligente.tsx");
    expect(changed).not.toContain("$projectId.tsx");
  });

  test("src/integrations/* não foi tocado neste gate", () => {
    expect(changedOrNewPaths()).not.toMatch(/src\/integrations\//);
  });
});
