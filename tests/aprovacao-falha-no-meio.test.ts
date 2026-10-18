import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatPartialApplyMessage, sumWriteCounters } from "../src/lib/meeting-analysis";
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
 * Correção do mesmo dia: só é seguro RETOMAR a reserva falha quando NADA
 * foi gravado nela (sumWriteCounters zero) — com gravação parcial,
 * retomar e repetir a mesma seleção duplicaria o que já entrou, então o
 * tratamento do 23505 lança um erro novo em vez de retomar ou devolver
 * alreadyApplied. formatPartialApplyMessage passou a contar também
 * `context` e `updated`, usando sumWriteCounters para decidir "Nada foi
 * gravado." E a marcação de falha no catch ganhou try/catch próprio: o
 * erro original (formatPartialApplyMessage) sempre é relançado, mesmo se
 * a própria marcação falhar.
 *
 * applyApprovedAnalysis usa o cliente Supabase do módulo direto (sem
 * injeção) — sem fake reaproveitável pra executar de ponta a ponta (ver
 * tests/meeting-chronology-guard.test.ts, mesmo padrão pro mesmo
 * arquivo). sumWriteCounters e formatPartialApplyMessage são puras e
 * testadas de verdade; o try/catch e o tratamento do 23505 são testados
 * por inspeção estática.
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

describe("sumWriteCounters — só soma contadores de ESCRITA", () => {
  test("tudo zero soma zero", () => {
    expect(sumWriteCounters(emptyResult())).toBe(0);
  });

  test("cada contador de escrita isolado conta (context, decisions, actions, risks, opportunities, updated, indicatorsCreated, indicatorPointsAdded)", () => {
    expect(sumWriteCounters(emptyResult({ context: 1 }))).toBe(1);
    expect(sumWriteCounters(emptyResult({ decisions: 1 }))).toBe(1);
    expect(sumWriteCounters(emptyResult({ actions: 1 }))).toBe(1);
    expect(sumWriteCounters(emptyResult({ risks: 1 }))).toBe(1);
    expect(sumWriteCounters(emptyResult({ opportunities: 1 }))).toBe(1);
    expect(sumWriteCounters(emptyResult({ updated: 1 }))).toBe(1);
    expect(sumWriteCounters(emptyResult({ indicatorsCreated: 1 }))).toBe(1);
    expect(sumWriteCounters(emptyResult({ indicatorPointsAdded: 1 }))).toBe(1);
  });

  test("skipped, indicatorPointsSkipped, blockedByChronology e alreadyApplied NUNCA contam (não gravam nada novo)", () => {
    expect(
      sumWriteCounters(
        emptyResult({
          skipped: 5,
          indicatorPointsSkipped: 5,
          blockedByChronology: 5,
          alreadyApplied: true,
        }),
      ),
    ).toBe(0);
  });

  test("soma várias categorias ao mesmo tempo", () => {
    expect(sumWriteCounters(emptyResult({ context: 1, decisions: 2, updated: 3 }))).toBe(6);
  });

  test("aceita um result PARCIAL (campos ausentes contam como zero) — aplicação antiga guardada sem todos os campos", () => {
    expect(sumWriteCounters({ decisions: 2 })).toBe(2);
    expect(sumWriteCounters({})).toBe(0);
  });
});

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

  test("sem nada gravado (sumWriteCounters zero), diz 'Nada foi gravado.' em vez de uma lista vazia", () => {
    const msg = formatPartialApplyMessage(emptyResult(), "erro antes de qualquer insert");
    expect(msg).toContain("Nada foi gravado.");
    expect(msg).not.toContain("Já gravado antes da falha");
  });

  test("skipped/indicatorPointsSkipped sozinhos NUNCA tiram a mensagem de 'Nada foi gravado' (não são escrita)", () => {
    const msg = formatPartialApplyMessage(
      emptyResult({ skipped: 3, indicatorPointsSkipped: 2 }),
      "erro",
    );
    expect(msg).toContain("Nada foi gravado.");
  });

  test("só indicadores (criado + ponto) — sem decisões/ações/riscos/oportunidades", () => {
    const msg = formatPartialApplyMessage(
      emptyResult({ indicatorsCreated: 1, indicatorPointsAdded: 1 }),
      "nome duplicado",
    );
    expect(msg).toContain("Já gravado antes da falha: 1 indicador criado e 1 ponto.");
  });

  test("só itens de contexto (context) — nunca diz 'Nada foi gravado'", () => {
    const msg = formatPartialApplyMessage(emptyResult({ context: 2 }), "erro");
    expect(msg).toContain("Já gravado antes da falha: 2 itens de contexto.");
    expect(msg).not.toContain("Nada foi gravado");
  });

  test("só itens atualizados (updated) — nunca diz 'Nada foi gravado'", () => {
    const msg = formatPartialApplyMessage(emptyResult({ updated: 1 }), "erro");
    expect(msg).toContain("Já gravado antes da falha: 1 item atualizado.");
    expect(msg).not.toContain("Nada foi gravado");
  });

  test("singular correto com contador 1 em cada categoria (incluindo context e updated)", () => {
    const msg = formatPartialApplyMessage(
      emptyResult({ context: 1, decisions: 1, actions: 1, risks: 1, opportunities: 1, updated: 1 }),
      "erro",
    );
    expect(msg).toContain(
      "1 item de contexto, 1 decisão, 1 ação, 1 risco, 1 oportunidade e 1 item atualizado.",
    );
  });

  test("aceita um result PARCIAL (ex.: guardado em analysis_applications de uma aplicação mais antiga)", () => {
    const msg = formatPartialApplyMessage({ decisions: 1 }, "erro");
    expect(msg).toContain("Já gravado antes da falha: 1 decisão.");
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

  test("a gravação em si foi extraída pra writeApprovedAnalysis — nada dela ficou direto dentro do try/catch", () => {
    expect(source).toContain("async function writeApprovedAnalysis(");
  });
});

describe("catch — a marcação de falha nunca pode impedir o erro original de ser relançado", () => {
  test("a marcação de falha roda dentro de um try/catch próprio, aninhado no catch externo", () => {
    const catchIdx = source.indexOf("} catch (err) {");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = source.slice(catchIdx, catchIdx + 900);
    expect(catchBlock).toContain("failed: true");
    expect(catchBlock).toContain(
      ".update({ result: { ...result, failed: true, message: motivo } as never })",
    );
    const innerTryIdx = catchBlock.indexOf("try {");
    const innerCatchIdx = catchBlock.indexOf("} catch (markError) {");
    expect(innerTryIdx).toBeGreaterThan(-1);
    expect(innerCatchIdx).toBeGreaterThan(innerTryIdx);
  });

  test("erro do UPDATE de marcação (markFailed.error) usa logDbError, nunca interrompe o fluxo", () => {
    const catchIdx = source.indexOf("} catch (err) {");
    const catchBlock = source.slice(catchIdx, catchIdx + 900);
    expect(catchBlock).toContain(
      'logDbError("analysis_applications", "mark-failed-reservation", markFailed.error);',
    );
  });

  test("o throw com formatPartialApplyMessage vem DEPOIS do try/catch interno, sempre executado", () => {
    const catchIdx = source.indexOf("} catch (err) {");
    const catchBlock = source.slice(catchIdx, catchIdx + 900);
    const innerCatchEndIdx = catchBlock.indexOf("} catch (markError) {");
    const throwIdx = catchBlock.indexOf(
      "throw new Error(formatPartialApplyMessage(result, motivo));",
    );
    expect(throwIdx).toBeGreaterThan(innerCatchEndIdx);
  });
});

describe("23505 na reserva — retoma só quando nada foi gravado; com gravação parcial, lança erro novo; sucesso continua alreadyApplied", () => {
  test("stored.failed true e sumWriteCounters zero: retoma a reserva (UPDATE resetando result) e NÃO devolve alreadyApplied", () => {
    const idx = source.indexOf('if (reservation.error.code === "23505") {');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 2000);
    expect(block).toContain("if (stored.failed && sumWriteCounters(stored) === 0) {");
    const retakeIdx = block.indexOf("if (stored.failed && sumWriteCounters(stored) === 0) {");
    const retakeBlock = block.slice(retakeIdx, retakeIdx + 800);
    expect(retakeBlock).toContain(".update({ result: {} as never, applied_by: userId })");
    expect(retakeBlock).toContain("applicationId = (retaken.data as { id: string }).id;");
    expect(retakeBlock).not.toContain("alreadyApplied: true");
  });

  test("stored.failed true e sumWriteCounters maior que zero: NÃO retoma, NÃO insere/atualiza nada, lança erro novo", () => {
    const idx = source.indexOf('if (reservation.error.code === "23505") {');
    const block = source.slice(idx, idx + 2000);
    const branchIdx = block.indexOf("} else if (stored.failed) {");
    expect(branchIdx).toBeGreaterThan(-1);
    const nextElseIdx = block.indexOf("} else {", branchIdx);
    expect(nextElseIdx).toBeGreaterThan(branchIdx);
    const branchBlock = block.slice(branchIdx, nextElseIdx);
    expect(branchBlock).not.toContain(".update(");
    expect(branchBlock).not.toContain("return { ...emptyApplyResult()");
    expect(branchBlock).toContain(
      "Esta aprovação já falhou antes com este mesmo conteúdo e gravou parte dos itens. Reabra o preview, escolha Ignorar nos itens que já entraram e aprove de novo.",
    );
    expect(branchBlock).toContain("formatPartialApplyMessage(stored, stored.message");
  });

  test("stored.failed ausente/false: comportamento de idempotência intacto — devolve alreadyApplied true", () => {
    const idx = source.indexOf('if (reservation.error.code === "23505") {');
    const block = source.slice(idx, idx + 2000);
    const elseIdx = block.indexOf(
      "} else {\n        return { ...emptyApplyResult(), ...stored, alreadyApplied: true };",
    );
    expect(elseIdx).toBeGreaterThan(-1);
  });

  test("a leitura de 'stored' tipa failed e message como opcionais — seleção/aplicação antiga (sem os campos) nunca quebra", () => {
    expect(source).toContain("failed?: boolean;");
    expect(source).toContain("message?: string;");
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
