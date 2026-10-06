import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Teste estático (sem mock, sem chamar a IA): confirma só que as novas
 * regras de extração entraram no texto do SYSTEM_PROMPT, no mesmo
 * padrão de tests/intelligent-meeting-system-prompt.test.ts.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const source = readFileSync(resolve(root, "src/lib/intelligent-meeting.server.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("SYSTEM_PROMPT (intelligent-meeting.server.ts) — novas regras de extração", () => {
  test("registra acordos explícitos como DECISÃO mesmo em tom de conversa", () => {
    expect(source).toContain("todo acordo explícito");
  });

  test("inclui a nova regra COMPROMISSOS DOS DOIS LADOS (ações do consultor, não só do cliente)", () => {
    expect(source).toContain("COMPROMISSOS DOS DOIS LADOS");
  });

  test("riscos passam a cobrir dívidas, processos judiciais, caixa apertado etc.", () => {
    expect(source).toContain("processos judiciais");
  });

  test("oportunidades passam a cobrir CONVERSÃO de teste/avaliação em contratação", () => {
    expect(source).toContain("CONVERSÃO");
  });

  test("a regra de não fragmentar itens quase idênticos deixa explícito que entregas diferentes são itens separados", () => {
    expect(source).toContain("tarefas com entregas diferentes");
  });
});
