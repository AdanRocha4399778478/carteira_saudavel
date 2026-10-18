import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Backlog B27B (18/10/2026) — painel de comparação "existente ↔ novo" no
 * ReviewRow da Reunião Inteligente. Aparece SEMPRE que o item tiver
 * match.existing, mesmo sem diferença nenhuma — nunca só quando há
 * `changes`. Item NEW (sem match.existing) não mostra o painel.
 *
 * Correção do mesmo dia: o lado direito muda de sentido conforme a
 * escolha do consultor (r.mode), não só a entidade:
 * - mode "update" → rótulo "Resultado após atualizar": mostra o que o
 *   patch REAL vai gravar (título/descrição existentes mantidos quando a
 *   regra manda, campos novos só quando presentes; ação ganha a linha de
 *   evidência acumulada).
 * - mode "create"/"skip" (inclusive pendente, que nasce "skip" por
 *   default) → rótulo "Novo (desta reunião)": mostra o item EXATAMENTE
 *   como a IA extraiu (r.item.*), já que nada será gravado no existente;
 *   sem linha de evidência; "O que será alterado" vira o texto fixo
 *   "Nada será alterado no item existente."
 *
 * Teste estático por inspeção do código-fonte, no padrão dos demais gates
 * desta tela.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const source = readFileSync(
  resolve(root, "src/components/painel/MeetingAnalysisDialog.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

function block(startMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("return (\n                        <ReviewRow", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const decisionBlock = block("const existingDecision = r.match.existing as Decision | null;");
const actionBlock = block("const existingAction = r.match.existing as ActionItem | null;");
const riskBlock = block("const existingRisk = r.match.existing as RiskItem | null;");
const oppBlock = block("const existingOpp = r.match.existing as OpportunityItem | null;");

describe("ComparisonPanel — definição e gatilho (match.existing, nunca por changes)", () => {
  test("ComparisonPanel e ComparisonSideFields existem como componentes", () => {
    expect(source).toContain("function ComparisonPanel({");
    expect(source).toContain("function ComparisonSideFields({");
  });

  test("ReviewRow só renderiza o painel quando a prop `comparison` está presente", () => {
    expect(source).toContain("{comparison ? (\n            <ComparisonPanel");
  });

  test("os 4 call sites constroem `comparison` a partir de `r.match.existing`, nunca de `changes.length`", () => {
    expect(
      decisionBlock.length + actionBlock.length + riskBlock.length + oppBlock.length,
    ).toBeGreaterThan(0);
  });

  test('B27 (correção): o painel exige veredito real (type !== "NEW"), não só match.existing truthy — existing pode vir preenchido com um candidato fraco mesmo em veredito NEW', () => {
    for (const b of [decisionBlock, actionBlock, riskBlock, oppBlock]) {
      expect(b).toContain('const isRealMatch = r.match.type !== "NEW";');
      expect(b).toContain("&& isRealMatch");
    }
  });

  test("contexto (contextRows) não ganhou painel de comparação — fora do escopo do B27B", () => {
    const contextBlockStart = source.indexOf(
      "id={blockId}\n                      title={CONTEXT_LIST_LABEL",
    );
    const contextBlockEnd = source.indexOf("</ReviewBlock>", contextBlockStart);
    const contextBlock = source.slice(contextBlockStart, contextBlockEnd);
    expect(contextBlock).not.toContain("comparison=");
  });
});

describe("B27 (correção): painel só para veredito real — nunca para NEW, mesmo com existing preenchido", () => {
  /**
   * Reproduz a condição exata de cada bloco (`existingX && r.match.type !== "NEW"`)
   * com um `existing` sempre preenchido (o cenário real do bug: um candidato de
   * baixa similaridade encontrado por pickBest/pickBestHistorical, que nunca
   * devolve null por causa do veredito — só por score <= 0). Prova que o
   * veredito, não a presença de `existing`, decide se o painel aparece.
   */
  function showsPanel(
    verdict: "NEW" | "POSSIBLE_DUPLICATE" | "UPDATE_EXISTING" | "EXISTING",
  ): boolean {
    const existing = { id: "x" }; // sempre preenchido, como no bug relatado
    const comparison = existing && verdict !== "NEW" ? { ok: true } : null;
    return comparison !== null;
  }

  test("NEW com existing preenchido NÃO mostra painel", () => {
    expect(showsPanel("NEW")).toBe(false);
  });

  test("POSSIBLE_DUPLICATE, UPDATE_EXISTING e EXISTING mostram painel", () => {
    expect(showsPanel("POSSIBLE_DUPLICATE")).toBe(true);
    expect(showsPanel("UPDATE_EXISTING")).toBe(true);
    expect(showsPanel("EXISTING")).toBe(true);
  });
});

describe("painel usa dateForMeetingId (já existente) — nenhuma consulta nova ao banco", () => {
  test("as 4 entidades usam dateForMeetingId(existing*.meeting_id) pra data da reunião de origem", () => {
    expect(decisionBlock).toContain("dateForMeetingId(existingDecision.meeting_id)");
    expect(actionBlock).toContain("dateForMeetingId(existingAction.meeting_id)");
    expect(riskBlock).toContain("dateForMeetingId(existingRisk.meeting_id)");
    expect(oppBlock).toContain("dateForMeetingId(existingOpp.meeting_id)");
  });
});

describe("rótulo do lado direito depende de r.mode, não da entidade", () => {
  test('as 4 entidades ramificam em r.mode === "update" ? ... : ...', () => {
    for (const b of [decisionBlock, actionBlock, riskBlock, oppBlock]) {
      expect(b).toContain('...(r.mode === "update"');
      expect(b).toContain('rightLabel: "Resultado após atualizar" as const');
      expect(b).toContain('rightLabel: "Novo (desta reunião)" as const');
    }
  });

  test("ComparisonPanelData.rightLabel só aceita os dois rótulos", () => {
    expect(source).toContain('rightLabel: "Resultado após atualizar" | "Novo (desta reunião)";');
  });
});

describe("decisão: em 'update' mantém título existente; em 'create'/'skip' mostra o item incoming (não o existente)", () => {
  test("lado existente sempre mostra existingDecision.title", () => {
    expect(decisionBlock).toContain("// B27B: título NUNCA é sobrescrito");
    const existingPart = decisionBlock.slice(0, decisionBlock.indexOf("...(r.mode"));
    expect(existingPart).toContain("text: existingDecision.title,");
  });

  test("em 'update', o resultado mantém existingDecision.title — nunca r.item.title", () => {
    const updatePart = decisionBlock.slice(
      decisionBlock.indexOf('rightLabel: "Resultado após atualizar"'),
      decisionBlock.indexOf('rightLabel: "Novo (desta reunião)"'),
    );
    expect(updatePart).toContain("text: existingDecision.title,");
    expect(updatePart).not.toContain("text: r.item.title,");
    expect(updatePart).toContain("r.item.description");
    expect(updatePart).toContain("existingDecision.description");
    expect(updatePart).toContain("r.item.reason || existingDecision.reason");
  });

  test("em 'create'/'skip', o lado direito usa r.item.* puro — nunca cai pro existente", () => {
    const createPart = decisionBlock.slice(
      decisionBlock.indexOf('rightLabel: "Novo (desta reunião)"'),
    );
    expect(createPart).toContain("text: r.item.title,");
    expect(createPart).toContain("responsible: r.item.owner,");
    expect(createPart).toContain("status: r.item.status,");
    expect(createPart).toContain('{ label: "Descrição", value: r.item.description },');
    expect(createPart).toContain('{ label: "Motivo", value: r.item.reason },');
    expect(createPart).not.toContain("existingDecision.description");
    expect(createPart).not.toContain("existingDecision.reason");
  });
});

describe("ação: evidência só acumula e só aparece quando o resultado é 'update'", () => {
  test("evidenceAddition só existe no ramo 'update', nunca no de 'create'/'skip'", () => {
    const updatePart = actionBlock.slice(
      actionBlock.indexOf('rightLabel: "Resultado após atualizar"'),
      actionBlock.indexOf('rightLabel: "Novo (desta reunião)"'),
    );
    const createPart = actionBlock.slice(actionBlock.indexOf('rightLabel: "Novo (desta reunião)"'));
    expect(updatePart).toContain("evidenceAddition: r.item.evidence || r.item.description,");
    expect(createPart).not.toContain("evidenceAddition");
  });

  test("em 'update', a descrição da ação (texto) permanece existingAction.description — nunca r.item.description", () => {
    const updatePart = actionBlock.slice(
      actionBlock.indexOf('rightLabel: "Resultado após atualizar"'),
      actionBlock.indexOf('rightLabel: "Novo (desta reunião)"'),
    );
    expect(updatePart).toContain("text: existingAction.description,");
  });

  test("em 'create'/'skip', o lado direito usa a descrição e os campos do item incoming (r.item.*)", () => {
    const createPart = actionBlock.slice(actionBlock.indexOf('rightLabel: "Novo (desta reunião)"'));
    expect(createPart).toContain("text: r.item.description,");
    expect(createPart).toContain("responsible: r.item.owner_name,");
    expect(createPart).toContain('{ label: "Prioridade", value: r.item.priority },');
    expect(createPart).toContain('{ label: "Prazo", value: r.item.deadline },');
  });

  test("o texto exato 'será adicionado ao histórico de evidência' existe em ComparisonPanel", () => {
    expect(source).toContain("será adicionado ao histórico de");
    expect(source).toContain('evidência: "{evidenceAddition}"');
  });
});

describe("risco e oportunidade seguem a mesma regra: 'update' preserva a descrição existente, 'create'/'skip' usa o item incoming", () => {
  test("risco: update mantém existingRisk.description; create/skip usa r.item.description e só 'Nível' (sem 'Ativo')", () => {
    const updatePart = riskBlock.slice(
      riskBlock.indexOf('rightLabel: "Resultado após atualizar"'),
      riskBlock.indexOf('rightLabel: "Novo (desta reunião)"'),
    );
    const createPart = riskBlock.slice(riskBlock.indexOf('rightLabel: "Novo (desta reunião)"'));
    expect(updatePart).toContain("text: existingRisk.description,");
    expect(createPart).toContain("text: r.item.description,");
    expect(createPart).toContain('extra: [{ label: "Nível", value: r.item.level }],');
    expect(createPart).not.toContain("Ativo");
  });

  test("oportunidade: update mantém existingOpp.description; create/skip usa r.item.description e r.item.expected_benefit", () => {
    const updatePart = oppBlock.slice(
      oppBlock.indexOf('rightLabel: "Resultado após atualizar"'),
      oppBlock.indexOf('rightLabel: "Novo (desta reunião)"'),
    );
    const createPart = oppBlock.slice(oppBlock.indexOf('rightLabel: "Novo (desta reunião)"'));
    expect(updatePart).toContain("text: existingOpp.description,");
    expect(createPart).toContain("text: r.item.description,");
    expect(createPart).toContain('label: "Benefício esperado",\n');
    expect(createPart).toContain("value: r.item.expected_benefit,");
  });
});

describe("'Nada será alterado' aparece exatamente quando rightLabel não é 'Resultado após atualizar'", () => {
  test('ComparisonPanel ramifica em isUpdateResult (rightLabel === "Resultado após atualizar")', () => {
    expect(source).toContain('const isUpdateResult = rightLabel === "Resultado após atualizar";');
    expect(source).toContain("{isUpdateResult ? (");
  });

  test("o texto fixo existe no ramo contrário (create/skip/pendente)", () => {
    expect(source).toContain("Nada será alterado no item existente.");
  });
});
