import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate D (18/10/2026): GRAVAÇÃO dos
 * indicadores aprovados em applyApprovedAnalysis. applyApprovedAnalysis
 * usa o cliente Supabase do módulo direto (sem injeção) — não há um fake
 * de Supabase reaproveitável para executar a função de ponta a ponta (ver
 * tests/meeting-chronology-guard.test.ts, mesmo padrão pro mesmo arquivo).
 * Teste ESTÁTICO por inspeção do código-fonte.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const source = readFileSync(resolve(root, "src/lib/meeting-analysis.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

function blockBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const indicatorBlock = blockBetween(
  "/* ---------- indicadores de resultado (parte 4, Gate D) ---------- *",
  "/* ---------- reunião: apenas complementa campos vazios ---------- */",
);

const functionStart = source.indexOf("export async function applyApprovedAnalysis(params: {");
const applicationIdIdx = source.indexOf("const applicationId = (reservation.data", functionStart);
const functionHead = source.slice(functionStart, applicationIdIdx);

describe("validação dos indicadores roda ANTES de qualquer gravação e da reserva de idempotência", () => {
  test("indicatorErrorsUpfront é calculado e pode lançar antes da reserva em analysis_applications", () => {
    const upfrontIdx = functionHead.indexOf("const indicatorErrorsUpfront");
    const throwUpfrontIdx = functionHead.indexOf("if (indicatorErrorsUpfront.length > 0)");
    const reservationIdx = functionHead.indexOf(
      'const reservation = await supabase\n    .from("analysis_applications")',
    );
    expect(upfrontIdx).toBeGreaterThan(-1);
    expect(throwUpfrontIdx).toBeGreaterThan(upfrontIdx);
    expect(reservationIdx).toBeGreaterThan(throwUpfrontIdx);
  });

  test("a validação upfront vem antes até da chamada a supabase.auth.getUser() (nenhuma chamada ao banco antes dela)", () => {
    const upfrontIdx = functionHead.indexOf("const indicatorErrorsUpfront");
    const authIdx = functionHead.indexOf("supabase.auth.getUser()");
    expect(upfrontIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeGreaterThan(upfrontIdx);
  });

  test("a validação upfront lança a mesma mensagem usada pelo bloco de gravação (segurança extra, sem repetir lógica nova)", () => {
    expect(functionHead).toContain(
      '`Não foi possível gravar os indicadores desta reunião: ${indicatorErrorsUpfront.join("; ")}.`',
    );
  });

  test("o bloco de gravação em si (mais abaixo) continua existindo como checagem extra, sem custo", () => {
    expect(indicatorBlock).toContain("segunda checagem de segurança");
  });
});

describe("ApprovedSelection / ApplyResult ganham os campos de indicadores", () => {
  test("ApprovedSelection.indicators é opcional (seleção antiga sem o campo continua aplicando)", () => {
    expect(source).toMatch(/indicators\?:\s*ApprovedIndicatorItem\[\]/);
  });

  test("ApplyResult expõe indicatorsCreated, indicatorPointsAdded e indicatorPointsSkipped, zerados por padrão", () => {
    expect(source).toContain("indicatorsCreated: number;");
    expect(source).toContain("indicatorPointsAdded: number;");
    expect(source).toContain("indicatorPointsSkipped: number;");
    expect(source).toContain("indicatorsCreated: 0,");
    expect(source).toContain("indicatorPointsAdded: 0,");
    expect(source).toContain("indicatorPointsSkipped: 0,");
  });
});

describe("buildIdempotencyKey — indicadores só entram no hash quando a lista não é vazia", () => {
  test("o payload acrescenta selection.indicators via spread condicional (length > 0), nunca incondicional", () => {
    const start = source.indexOf("const idempotencyKey = buildIdempotencyKey({");
    const end = source.indexOf("});", start);
    const block = source.slice(start, end);
    expect(block).toContain(
      "...(selection.indicators && selection.indicators.length > 0\n        ? { indicators: selection.indicators }\n        : {}),",
    );
  });
});

describe("bloco de gravação dos indicadores — validação ANTES de qualquer insert", () => {
  test("valida TODOS os itens com validateApprovedIndicator antes do loop que grava", () => {
    const validateIdx = indicatorBlock.indexOf("validateApprovedIndicator");
    const firstInsertIdx = indicatorBlock.indexOf('.from("indicators")');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(firstInsertIdx).toBeGreaterThan(validateIdx);
  });

  test("qualquer erro aborta TODA a gravação de indicadores (throw antes do loop de inserts)", () => {
    const throwIdx = indicatorBlock.indexOf("if (errors.length > 0)");
    const firstInsertIdx = indicatorBlock.indexOf('.from("indicators")');
    expect(throwIdx).toBeGreaterThan(-1);
    expect(throwIdx).toBeLessThan(firstInsertIdx);
    expect(indicatorBlock.slice(throwIdx, throwIdx + 120)).toContain("throw new Error");
  });

  test("item 'skip' nunca insere nada (continue antes de qualquer acesso ao banco)", () => {
    const skipIdx = indicatorBlock.indexOf('if (item.action === "skip") continue;');
    expect(skipIdx).toBeGreaterThan(-1);
  });
});

describe("criar grava indicador e depois o ponto; anexar grava só o ponto", () => {
  test("action 'create' insere em indicators com client_id/project_id do projeto, baseline_at e target_value nulos", () => {
    expect(indicatorBlock).toContain('.from("indicators")\n          .insert({');
    expect(indicatorBlock).toContain("client_id: meeting.client_id,");
    expect(indicatorBlock).toContain("project_id: projectId,");
    expect(indicatorBlock).toContain("baseline_at: null,");
    expect(indicatorBlock).toContain("target_value: null,");
    expect(indicatorBlock).toContain("result.indicatorsCreated += 1;");
  });

  test("action 'attach' usa target_indicator_id direto, sem inserir em indicators", () => {
    const attachIdx = indicatorBlock.indexOf("indicatorId = item.target_indicator_id!;");
    expect(attachIdx).toBeGreaterThan(-1);
  });

  test("o ponto leva source 'reuniao', source_meeting_id da reunião e evidence", () => {
    expect(indicatorBlock).toContain('source: "reuniao",');
    expect(indicatorBlock).toContain("source_meeting_id: meeting.id,");
    expect(indicatorBlock).toContain("evidence: item.evidence || null,");
    expect(indicatorBlock).toContain("result.indicatorPointsAdded += 1;");
  });

  test("measured_at vazio vira a data da reunião (meeting.meeting_date)", () => {
    expect(indicatorBlock).toContain("item.measured_at || meeting.meeting_date");
  });
});

describe("trava contra ponto duplicado e erro de índice único", () => {
  test("antes de inserir o ponto, procura um ponto do mesmo indicador/data/valor/origem 'reuniao'", () => {
    const dupIdx = indicatorBlock.indexOf('.from("indicator_points")\n        .select("id")');
    const insertIdx = indicatorBlock.indexOf('.from("indicator_points").insert({');
    expect(dupIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(dupIdx);
    const dupBlock = indicatorBlock.slice(dupIdx, insertIdx);
    expect(dupBlock).toContain('.eq("indicator_id", indicatorId)');
    expect(dupBlock).toContain('.eq("measured_at", measuredAt)');
    expect(dupBlock).toContain('.eq("value", pointValue)');
    expect(dupBlock).toContain('.eq("source", "reuniao")');
  });

  test("duplicado encontrado conta como indicatorPointsSkipped e NÃO insere o ponto (continue antes do insert)", () => {
    const skipIdx = indicatorBlock.indexOf("result.indicatorPointsSkipped += 1;");
    const continueAfter = indicatorBlock.slice(skipIdx, skipIdx + 60);
    expect(continueAfter).toContain("continue;");
  });

  test("23505 na criação do indicador vira mensagem amigável em português, nunca o erro bruto do banco", () => {
    const start = indicatorBlock.indexOf('indicatorInsert.error.code === "23505"');
    expect(start).toBeGreaterThan(-1);
    const block = indicatorBlock.slice(start, start + 220);
    expect(block).toContain("Já existe um indicador");
    expect(block).toContain("escolha anexar");
  });

  test("qualquer outro erro do banco na criação do indicador usa logDbError, como os demais blocos", () => {
    expect(indicatorBlock).toContain(
      'logDbError("indicators", "insert-analysis", indicatorInsert.error);',
    );
  });
});

describe("seleção antiga (sem indicators) e lista vazia nunca tocam o banco de indicadores", () => {
  test("indicatorItems vem de selection.indicators ?? [] — undefined nunca quebra", () => {
    expect(indicatorBlock).toContain("const indicatorItems = selection.indicators ?? [];");
  });

  test("todo o bloco de gravação fica dentro de 'if (indicatorItems.length > 0)'", () => {
    const guardIdx = indicatorBlock.indexOf("if (indicatorItems.length > 0) {");
    const firstInsertIdx = indicatorBlock.indexOf('.from("indicators")');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(firstInsertIdx).toBeGreaterThan(guardIdx);
  });
});
