import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Backlog B26 (18/10/2026) — a IA acrescentou um qualificador que não
 * foi dito ("seguro de vida", quando a transcrição só dizia "seguro").
 * SYSTEM_PROMPT (intelligent-meeting.server.ts) ganhou uma regra
 * explícita: nunca completar um termo genérico com tipo, marca, valor
 * ou nome que a fala não deu. Teste estático por inspeção do prompt.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const source = readFileSync(resolve(root, "src/lib/intelligent-meeting.server.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);
const promptStart = source.indexOf("const SYSTEM_PROMPT = `");
const promptEnd = source.indexOf("`;", promptStart);
const prompt = source.slice(promptStart, promptEnd);

describe("SYSTEM_PROMPT — B26: nunca acrescentar qualificador não dito a um termo genérico", () => {
  test("a regra existe dentro do bloco do prompt", () => {
    expect(promptStart).toBeGreaterThan(-1);
    expect(promptEnd).toBeGreaterThan(promptStart);
    expect(prompt).toContain(
      "Nunca acrescente qualificador, tipo, marca, valor ou nome que a transcrição não disse a um termo genérico",
    );
  });

  test('usa o exemplo real do achado ("seguro" não pode virar "seguro de vida")', () => {
    expect(prompt).toContain(
      'se o cliente diz só "seguro", registre "seguro", nunca "seguro de vida"',
    );
  });

  test("instrui usar exatamente o termo genérico falado quando algo não foi especificado", () => {
    expect(prompt).toContain(
      "Quando algo não foi especificado na fala, use exatamente o termo genérico falado, sem completar o sentido por conta própria.",
    );
  });
});
