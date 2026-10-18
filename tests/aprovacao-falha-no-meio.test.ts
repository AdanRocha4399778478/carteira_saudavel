import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatPartialApplyMessage } from "../src/lib/meeting-analysis";
import type { ApplyResult } from "../src/lib/meeting-analysis";

/* ------------------------------------------------------------------ *
 * B30 (18/10/2026): a reserva de idempotência em analysis_applications
 * nascia com result vazio e só recebia o resultado real num UPDATE no
 * FIM de applyApprovedAnalysis — qualquer erro no meio deixava a reserva
 * presa (23505 numa nova tentativa, devolvendo alreadyApplied com tudo
 * zerado, mesmo com gravação parcial). Regra do dono do produto: se a
 * aprovação falhar no meio, LIBERAR a reserva (marcá-la como "failed",
 * já que DELETE nessa tabela é restrito a admin — ver
 * 20260816235103_restrict_structural_deletes.sql) e mostrar um erro
 * claro com o que já foi gravado.
 *
 * applyApprovedAnalysis usa o cliente Supabase do módulo direto (sem
 * injeção) — sem fake reaproveitável pra executar de ponta a ponta (ver
 * tests/meeting-chronology-guard.test.ts, mesmo padrão pro mesmo
 * arquivo). formatPartialApplyMessage é pura e testada de verdade; o
 * try/catch e o tratamento do 23505 são testados por inspeção estática.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const source = readFileSync(resolve(root, "src/lib/meeting-analysis.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

function emptyResult(patch: Partial<ApplyResult> = {}): ApplyResult {
  return {
    context: 0,
    decisions: 0,
    actions: 0,
    risks: 0,
    opportunities: 0,
    updated: 0,
    skipped: 0,
    alreadyApplied: false,
    blockedByChronology: 0,
    indicatorsCreated: 0,
    indicatorPointsAdded: 0,
    indicatorPointsSkipped: 0,
    ...patch,
  };
}

describe("formatPartialApplyMessage — função pura", () => {
  test("com contadores de várias categorias, lista todas (plural correto) e une com 'e'", () => {
    const msg = formatPartialApplyMessage(
      emptyResult({
        decisions: 2,
        actions: 3,
        opportunities: 1,
        indicatorsCreated: 1,
        indicatorPointsAdded: 2,
      }),
      "conexão perdida",
    );
    expect(msg).toContain("A aprovação falhou: conexão perdida.");
    expect(msg).toContain(
      "Já gravado antes da falha: 2 decisões, 3 ações, 1 oportunidade, 1 indicador criado e 2 pontos.",
    );
    expect(msg).toContain(
      "Reabra o preview: o que já entrou aparece como existente; escolha Ignorar nesses itens.",
    );
  });

  test("categorias zeradas nunca aparecem na lista", () => {
    const msg = formatPartialApplyMessage(
      emptyResult({ decisions: 1, risks: 0, opportunities: 0 }),
      "erro x",
    );
    expect(msg).not.toContain("risco");
    expect(msg).not.toContain("oportunidade");
    expect(msg).toContain("1 decisão");
  });

  test("sem nada gravado, diz 'Nada foi gravado.' em vez de uma lista vazia", () => {
    const msg = formatPartialApplyMessage(emptyResult(), "erro antes de qualquer insert");
    expect(msg).toContain("Nada foi gravado.");
    expect(msg).not.toContain("Já gravado antes da falha");
  });

  test("só indicadores (criado + ponto) — sem decisões/ações/riscos/oportunidades", () => {
    const msg = formatPartialApplyMessage(
      emptyResult({ indicatorsCreated: 1, indicatorPointsAdded: 1 }),
      "nome duplicado",
    );
    expect(msg).toContain("Já gravado antes da falha: 1 indicador criado e 1 ponto.");
  });

  test("singular correto com contador 1 em cada categoria", () => {
    const msg = formatPartialApplyMessage(
      emptyResult({ decisions: 1, actions: 1, risks: 1, opportunities: 1 }),
      "erro",
    );
    expect(msg).toContain("1 decisão, 1 ação, 1 risco e 1 oportunidade.");
  });
});

describe("applyApprovedAnalysis — try/catch envolve tudo que vem depois da reserva", () => {
  test("o corpo de gravação roda dentro de um try, chamado logo após a reserva ser resolvida", () => {
    const applyIdx = source.indexOf("export async function applyApprovedAnalysis(params: {");
    const tryIdx = source.indexOf(
      "try {\n    return await writeApprovedAnalysis(params, {",
      applyIdx,
    );
    expect(tryIdx).toBeGreaterThan(applyIdx);
  });

  test("o catch marca a reserva como failed (nunca a deixa presa) e relança formatPartialApplyMessage", () => {
    const catchIdx = source.indexOf("} catch (err) {");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = source.slice(catchIdx, catchIdx + 400);
    expect(catchBlock).toContain("failed: true");
    expect(catchBlock).toContain(
      ".update({ result: { ...result, failed: true, message: motivo } as never })",
    );
    expect(catchBlock).toContain("throw new Error(formatPartialApplyMessage(result, motivo));");
  });

  test("a gravação em si foi extraída pra writeApprovedAnalysis — nada dela ficou direto dentro do try/catch", () => {
    expect(source).toContain("async function writeApprovedAnalysis(");
  });
});

describe("23505 na reserva — retoma se failed, continua alreadyApplied se não", () => {
  test("stored.failed true: retoma a reserva (UPDATE resetando result) e NÃO devolve alreadyApplied", () => {
    const idx = source.indexOf('if (reservation.error.code === "23505") {');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 1200);
    expect(block).toContain("if (stored.failed) {");
    const retakeIdx = block.indexOf("if (stored.failed) {");
    const retakeBlock = block.slice(retakeIdx, retakeIdx + 700);
    expect(retakeBlock).toContain(".update({ result: {} as never, applied_by: userId })");
    expect(retakeBlock).toContain("applicationId = (retaken.data as { id: string }).id;");
    expect(retakeBlock).not.toContain("alreadyApplied: true");
  });

  test("stored.failed ausente/false: comportamento de idempotência intacto — devolve alreadyApplied true", () => {
    const idx = source.indexOf('if (reservation.error.code === "23505") {');
    const block = source.slice(idx, idx + 1200);
    const elseIdx = block.indexOf(
      "} else {\n        return { ...emptyApplyResult(), ...stored, alreadyApplied: true };",
    );
    expect(elseIdx).toBeGreaterThan(-1);
  });

  test("a leitura de 'stored' tipa failed como opcional — seleção/aplicação antiga (sem o campo) nunca quebra", () => {
    expect(source).toContain(
      "const stored = (previous.data?.result ?? {}) as Partial<ApplyResult> & { failed?: boolean };",
    );
  });
});

describe("seleção sem falha continua igual (nenhuma mudança de comportamento no caminho feliz)", () => {
  test("o INSERT de reserva continua o mesmo (mesmas colunas, sem campo novo)", () => {
    const insertIdx = source.indexOf(
      'const reservation = await supabase\n    .from("analysis_applications")',
    );
    expect(insertIdx).toBeGreaterThan(-1);
    const insertBlock = source.slice(insertIdx, insertIdx + 400);
    expect(insertBlock).toContain("analysis_id: analysisId,");
    expect(insertBlock).toContain("meeting_id: meeting.id,");
    expect(insertBlock).toContain("idempotency_key: idempotencyKey,");
    expect(insertBlock).toContain("applied_by: userId,");
  });

  test("o UPDATE final que grava o resultado de sucesso não mudou (mesma coluna, sem failed)", () => {
    const idx = source.indexOf(
      "// Guarda o resultado para que uma reaplicação devolva o mesmo resumo.",
    );
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 200);
    expect(block).toContain(".update({ result: result as never })");
    expect(block).not.toContain("failed");
  });
});
