import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRelativeDeadline } from "../src/lib/prazo-relativo";

/* ------------------------------------------------------------------ *
 * Backlog B18 (17/10/2026) — prazo sugerido a partir de expressão
 * relativa, editável no preview antes de aprovar. A IA nunca calcula
 * data: só registra a expressão literal (due_hint/deadline_hint); só
 * resolveRelativeDeadline (src/lib/prazo-relativo.ts, testado em
 * tests/prazo-relativo.test.ts) calcula. Este arquivo cobre, por
 * inspeção estática do código-fonte: o schema com os campos de hint, a
 * regra trocada do SYSTEM_PROMPT, o campo editável no preview, o rótulo
 * "sugerido", o override do consultor sempre vencendo, e a garantia de
 * que o hint nunca é gravado no banco (nunca sai do preview).
 * ------------------------------------------------------------------ */

function read(path: string): string {
  return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("GATE — schema da análise ganhou os campos de hint (B18)", () => {
  const source = read("../src/lib/meeting-analysis.ts");

  test("decisions[] tem due_hint, actions[] tem deadline_hint, ambos como texto livre (txt)", () => {
    expect(source).toContain("due_date: txt");
    expect(source).toContain("due_hint: txt");
    expect(source).toContain("deadline: txt");
    expect(source).toContain("deadline_hint: txt");
  });

  test("ApprovedSelection NUNCA carrega due_hint/deadline_hint — o hint não sobrevive ao preview", () => {
    const start = source.indexOf("export type ApprovedSelection");
    const end = source.indexOf("export type ApplyResult");
    const approvedSelectionBlock = source.slice(start, end);
    expect(approvedSelectionBlock).not.toContain("due_hint");
    expect(approvedSelectionBlock).not.toContain("deadline_hint");
  });

  test("applyApprovedAnalysis nunca referencia due_hint/deadline_hint — nada do hint chega ao banco", () => {
    const start = source.indexOf("export async function applyApprovedAnalysis");
    expect(start).toBeGreaterThan(-1);
    const applyBlock = source.slice(start, start + 20000);
    expect(applyBlock).not.toContain("due_hint");
    expect(applyBlock).not.toContain("deadline_hint");
  });
});

describe("GATE — SYSTEM_PROMPT: regra 137 trocada, IA nunca calcula data (B18)", () => {
  const source = read("../src/lib/intelligent-meeting.server.ts");

  test("referência vaga ou relativa (inclusive dia da semana) copia a expressão literal no hint, sem calcular data", () => {
    expect(source).toContain(
      "copie a EXPRESSÃO LITERAL exatamente como foi dita em decisions[].due_hint / actions[].deadline_hint",
    );
    expect(source).toContain(
      "Você NUNCA calcula nem inventa a data a partir dessa expressão, mesmo quando pareceria fácil (ex.: um dia da semana) — o sistema calcula depois",
    );
  });

  test("rotina/frequência continua sem prazo e também sem hint (não é um prazo)", () => {
    expect(source).toContain(
      "NÃO preencha due_hint/deadline_hint (não é um prazo, não deve virar um)",
    );
  });

  test("regra de due_date/deadline exige data EXPLÍCITA — dia da semana nunca é calculado pela IA", () => {
    expect(source).toContain(
      "só são preenchidos quando a própria conversa citar uma data EXPLÍCITA para aquele item",
    );
    expect(source).toContain(
      'Referência relativa (dia da semana como "próxima terça", "amanhã", "semana que vem" etc.) NUNCA é calculada por você, mesmo sendo possível deduzir a data',
    );
    // "próxima terça" não é mais citada como exemplo de prazo explícito (contradição corrigida).
    expect(source).not.toContain('"dia 25", "próxima terça"');
  });

  test("template JSON de saída inclui due_hint e deadline_hint", () => {
    expect(source).toContain('"due_date": "", "due_hint": ""');
    expect(source).toContain('"deadline": "", "deadline_hint": ""');
  });
});

describe("GATE — preview: campo de prazo editável, rótulo 'sugerido', override sempre vence (B18)", () => {
  const source = read("../src/components/painel/MeetingAnalysisDialog.tsx");

  test("resolveRelativeDeadline é importado e usado só dentro do diálogo de preview", () => {
    expect(source).toContain('import { resolveRelativeDeadline } from "@/lib/prazo-relativo";');
  });

  test("ReviewRow ganhou um Input type=date, só no bloco 'Criar novo'", () => {
    expect(source).toContain(
      'row.mode === "create" && (onCompletedChange || onIsEvaluationChange || onDueDateChange)',
    );
    expect(source).toContain('<Input\n                    type="date"');
  });

  test("badge discreto 'sugerido' aparece só quando o valor não foi editado manualmente", () => {
    expect(source).toContain("sugerido");
    expect(source).toContain("dueDateSuggested");
  });

  test("isSuggestedDueDate só é true sem edição manual (override === undefined) e sem data explícita da IA", () => {
    expect(source).toContain(
      "override === undefined && !explicit && resolveRelativeDeadline(hint, meetingDateIso) !== null",
    );
  });

  test("estado de override por item (decisionDueDateSel/actionDeadlineSel), no padrão de decisionCompletedSel", () => {
    expect(source).toContain(
      "const [decisionDueDateSel, setDecisionDueDateSel] = useState<Record<number, string>>({});",
    );
    expect(source).toContain(
      "const [actionDeadlineSel, setActionDeadlineSel] = useState<Record<number, string>>({});",
    );
  });

  test("o valor final gravado lê o override primeiro (?? vence) e só recai no padrão calculado se o consultor nunca editou", () => {
    expect(source).toContain(
      "decisionDueDateSel[r.key] ??\n                  defaultItemDueDate(r.item.due_date, r.item.due_hint, meeting.meeting_date)",
    );
    expect(source).toContain(
      "actionDeadlineSel[r.key] ??\n                defaultItemDueDate(r.item.deadline, r.item.deadline_hint, meeting.meeting_date)",
    );
  });

  test("'Atualizar existente' nunca usa o override — due_date/deadline do item existente não mudam", () => {
    expect(source).toContain(
      'r.mode === "create"\n                ? (decisionDueDateSel[r.key] ??\n                  defaultItemDueDate(r.item.due_date, r.item.due_hint, meeting.meeting_date))\n                : r.item.due_date,',
    );
    expect(source).toContain(
      'r.mode === "create"\n              ? (actionDeadlineSel[r.key] ??\n                defaultItemDueDate(r.item.deadline, r.item.deadline_hint, meeting.meeting_date))\n              : r.item.deadline,',
    );
  });
});

describe("GATE — B28: hint real (fala coloquial) chega até o campo de prazo do ReviewRow", () => {
  /**
   * `defaultItemDueDate` (MeetingAnalysisDialog.tsx) não é exportada, mas o
   * corpo dela é só `explicit || (resolveRelativeDeadline(hint, meetingDateIso) ?? "")`
   * — ver o teste estático acima. Reproduzindo esse corpo aqui com um hint
   * REAL (frase da reunião da Medeiros, 16/10/2026) prova que a correção do
   * B28 em prazo-relativo.ts chega ao mesmo valor que o campo de prazo do
   * ReviewRow mostraria como sugestão, sem precisar montar o componente.
   */
  function defaultItemDueDate(explicit: string, hint: string, meetingDateIso: string): string {
    return explicit || (resolveRelativeDeadline(hint, meetingDateIso) ?? "");
  }

  test("due_hint real ('ao longo dessa semana ou da próxima') sem data explícita vira a sugestão calculada", () => {
    expect(defaultItemDueDate("", "ao longo dessa semana ou da próxima", "2026-10-16")).toBe(
      "2026-10-23",
    );
  });

  test("data explícita da IA sempre vence o hint, mesmo quando o hint também seria resolvível", () => {
    expect(defaultItemDueDate("2026-11-01", "dessa semana", "2026-10-16")).toBe("2026-11-01");
  });
});
