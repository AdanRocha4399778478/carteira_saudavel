import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * SYSTEM_PROMPT interpola MEETING_TYPES (mesmo padrão já usado para a
 * taxonomia ERP, via formatErpTaxonomyForPrompt()) em vez de listar os
 * valores à mão — por isso o teste estático confirma a interpolação em
 * si (import + MEETING_TYPES.join dentro do bloco do prompt), não os
 * valores literais, que só existem depois de avaliado em runtime.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const source = readFileSync(resolve(root, "src/lib/intelligent-meeting.server.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("SYSTEM_PROMPT (intelligent-meeting.server.ts) cita MEETING_TYPES", () => {
  test("importa MEETING_TYPES de @/lib/domain", () => {
    expect(source).toContain('import { MEETING_TYPES } from "@/lib/domain";');
  });

  test("o bloco do SYSTEM_PROMPT interpola MEETING_TYPES.join(...) para o campo meeting_type", () => {
    const promptStart = source.indexOf("const SYSTEM_PROMPT = `");
    const promptEnd = source.indexOf("`;", promptStart);
    expect(promptStart).toBeGreaterThan(-1);
    expect(promptEnd).toBeGreaterThan(promptStart);
    const prompt = source.slice(promptStart, promptEnd);
    expect(prompt).toContain("meeting_type");
    expect(prompt).toContain("MEETING_TYPES.join(");
  });
});
