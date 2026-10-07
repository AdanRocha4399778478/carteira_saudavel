import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Teste estático (sem mock, sem chamar a IA): confirma só que a nova
 * regra de data da reunião entrou no texto do SYSTEM_PROMPT e no
 * cabeçalho do prompt do usuário, no mesmo padrão de
 * tests/intelligent-meeting-extraction-rules.test.ts.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const source = readFileSync(resolve(root, "src/lib/intelligent-meeting.server.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("SYSTEM_PROMPT / cabeçalho (intelligent-meeting.server.ts) — data da reunião", () => {
  test("o cabeçalho do prompt do usuário inclui a linha 'Data da reunião (do cabeçalho da transcrição)'", () => {
    expect(source).toContain("Data da reunião (do cabeçalho da transcrição)");
  });

  test("o SYSTEM_PROMPT instrui que a 'Data de hoje' NUNCA serve de referência para prazos", () => {
    expect(source).toContain("A 'Data de hoje' NUNCA serve de referência para prazos");
  });
});
