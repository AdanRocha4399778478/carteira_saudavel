import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Teste estático (sem mock, sem chamar a IA): confirma só que a nova
 * regra de falante único entrou no texto do SYSTEM_PROMPT, no mesmo
 * padrão de tests/intelligent-meeting-extraction-rules.test.ts.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const source = readFileSync(resolve(root, "src/lib/intelligent-meeting.server.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("SYSTEM_PROMPT (intelligent-meeting.server.ts) — regra de falante único", () => {
  test("instrui null em satisfaction_score e value_score quando só o consultor foi captado", () => {
    expect(source).toContain("ÚNICO falante");
    expect(source).toContain("satisfaction_score e value_score");
  });
});
