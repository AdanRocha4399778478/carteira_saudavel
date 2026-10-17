import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Teste estático (sem mock, sem chamar a IA): confirma só que as duas
 * regras novas entraram no texto do SYSTEM_PROMPT, no mesmo padrão de
 * tests/intelligent-meeting-extraction-rules.test.ts. Achado real:
 * preview sem nenhum valor numérico da reunião (caso Bandrone,
 * 13/10/2026) e ações geradas a partir de uma conferência de
 * lançamentos de extrato, não da reunião real.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const source = readFileSync(resolve(root, "src/lib/intelligent-meeting.server.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("SYSTEM_PROMPT (intelligent-meeting.server.ts) — preservação de valores", () => {
  test("exige manter valor monetário, parcelas e total exatamente como ditos, sem arredondar/trocar/omitir", () => {
    expect(source).toContain(
      "devem ser mantidos EXATAMENTE como ditos na descrição da ação ou decisão correspondente, sem arredondar, trocar ou omitir",
    );
  });

  test("exemplo de descrição com valor preservado (parcelas + total)", () => {
    expect(source).toContain('"3 parcelas de R$ 100,00, total R$ 300,00"');
  });

  test("valores divergentes para o mesmo item: mantém os dois e sinaliza a divergência, não escolhe um", () => {
    expect(source).toContain("mantenha os dois e sinalize a divergência na descrição, em vez de escolher um");
  });
});

describe("SYSTEM_PROMPT (intelligent-meeting.server.ts) — conferência de lançamentos não gera ação/decisão", () => {
  test("classificação de lançamentos de extrato um a um não gera ação nem decisão", () => {
    expect(source).toContain(
      'Conferência de lançamentos: trechos em que consultor e cliente só classificam lançamentos de extrato um a um (ex.: "esse Pix é pró-labore", "isso é CMV", "esse favorecido é diária") não geram ação nem decisão.',
    );
  });

  test("compromisso real que surja dessa conferência continua sendo ação", () => {
    expect(source).toContain(
      'Se dali sair um compromisso real (ex.: "me manda a lista até sexta"), ele continua sendo ação.',
    );
  });
});
