import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Teste estático (sem mock, sem chamar a IA): confirma só que o campo
 * is_evaluation entrou no SYSTEM_PROMPT (regra de texto + schema de
 * saída), no mesmo padrão de tests/intelligent-meeting-extraction-rules.test.ts.
 * Backlog B1 (16/10/2026).
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const source = readFileSync(resolve(root, "src/lib/intelligent-meeting.server.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("SYSTEM_PROMPT (intelligent-meeting.server.ts) — sugestão de avaliação (B1)", () => {
  test("regra de texto: is_evaluation true só para decisão de avaliar/decidir ao final de um período", () => {
    expect(source).toContain(
      "decisions[].is_evaluation: true SÓ para decisão cujo propósito é avaliar ou decidir ao final de um período definido",
    );
  });

  test("é sugestão não vinculante — o consultor confirma ou corrige no preview", () => {
    expect(source).toContain(
      "É sugestão não vinculante: o consultor confirma ou corrige no preview antes de aprovar.",
    );
  });

  test("schema de saída do prompt inclui is_evaluation com default false", () => {
    expect(source).toContain('"is_evaluation": false');
  });
});
