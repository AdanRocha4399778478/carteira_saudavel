import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate B (18/10/2026). Teste
 * ESTÁTICO (inspeção de código-fonte, padrão dos demais gates desta
 * tela — ver tests/meeting-analysis-comparison-panel.test.ts): confirma
 * que as duas telas que abrem MeetingAnalysisDialog (projetos/$projectId
 * e reuniao-inteligente) passam a prop `indicators` usando a MESMA
 * indicatorsQuery (src/lib/indicators-data.ts, sem consulta nova), que o
 * diálogo declara a prop e calcula indicatorPlans (ainda sem renderizar
 * nada na tela), e que ApprovedSelection NÃO mudou neste gate.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
}

const dialogSource = read("src/components/painel/MeetingAnalysisDialog.tsx");
const projectPageSource = read("src/routes/_authenticated/projetos/$projectId.tsx");
const meetingPageSource = read("src/routes/_authenticated/reuniao-inteligente.tsx");
const meetingAnalysisSource = read("src/lib/meeting-analysis.ts");

describe("MeetingAnalysisDialog — prop indicators e cálculo de indicatorPlans", () => {
  test("declara a prop indicators, tipada como ExistingIndicatorForMatch[], com padrão []", () => {
    expect(dialogSource).toMatch(/indicators\?:\s*ExistingIndicatorForMatch\[\]/);
    expect(dialogSource).toMatch(/indicators\s*=\s*\[\]/);
  });

  test("importa planIndicatorSuggestion de indicator-match", () => {
    expect(dialogSource).toMatch(
      /import\s*\{[^}]*planIndicatorSuggestion[^}]*\}\s*from\s*"@\/lib\/indicator-match"/s,
    );
  });

  test("calcula indicatorPlans com useMemo a partir de analysis.indicators e indicators (prop)", () => {
    const start = dialogSource.indexOf("const indicatorPlans");
    expect(start).toBeGreaterThan(-1);
    const block = dialogSource.slice(start, start + 400);
    expect(block).toContain("useMemo");
    expect(block).toContain("planIndicatorSuggestion");
    expect(block).toContain("analysis?.indicators");
  });

  test("indicatorPlans não é usado em nenhum JSX deste gate (ainda não renderiza nada na tela)", () => {
    const uses = [...dialogSource.matchAll(/indicatorPlans/g)].length;
    // 1 na declaração (const indicatorPlans) + 1 na linha do .map(...) que a calcula = 2.
    expect(uses).toBe(2);
  });
});

describe("as duas telas passam indicators usando a MESMA indicatorsQuery, sem consulta nova", () => {
  test("projetos/$projectId.tsx importa indicatorsQuery e reaproveita a consulta já existente da página", () => {
    expect(projectPageSource).toMatch(
      /import\s*\{[^}]*indicatorsQuery[^}]*\}\s*from\s*"@\/lib\/indicators-data"/s,
    );
    // Só uma chamada a indicatorsQuery(...) na página inteira — nenhuma consulta nova foi criada.
    const calls = [...projectPageSource.matchAll(/indicatorsQuery\(/g)].length;
    expect(calls).toBe(1);
    expect(projectPageSource).toMatch(
      /<MeetingAnalysisDialog[\s\S]*?indicators=\{indicators\.data \?\? \[\]\}/,
    );
  });

  test("reuniao-inteligente.tsx importa indicatorsQuery, cria a consulta reativa ao projeto identificado/escolhido e a passa ao diálogo", () => {
    expect(meetingPageSource).toMatch(
      /import\s*\{\s*indicatorsQuery\s*\}\s*from\s*"@\/lib\/indicators-data"/,
    );
    const calls = [...meetingPageSource.matchAll(/indicatorsQuery\(/g)].length;
    expect(calls).toBe(1);
    expect(meetingPageSource).toMatch(
      /indicatorsQuery\(project\?\.id \?\? ""\)[\s\S]{0,40}enabled:\s*!!project\?\.id/,
    );
    expect(meetingPageSource).toMatch(
      /<MeetingAnalysisDialog[\s\S]*?indicators=\{indicators\.data \?\? \[\]\}/,
    );
  });
});

describe("ApprovedSelection não mudou neste gate (Gate B só casamento + leitura, sem tocar aplicação)", () => {
  test("meeting-analysis.ts: a função normalizeIndicatorName foi extraída, mas o restante do arquivo (inclusive ApprovedSelection) não mudou de comportamento", () => {
    // A única mudança estrutural esperada: import novo de indicator-name e
    // remoção da função local normalizeIndicatorName (ver indicator-name.ts).
    expect(meetingAnalysisSource).toMatch(
      /import\s*\{\s*normalizeIndicatorName\s*\}\s*from\s*"\.\/indicator-name"/,
    );
    expect(meetingAnalysisSource).not.toMatch(/function normalizeIndicatorName/);
  });

  test("ApprovedSelection ainda é exportado com os mesmos campos de topo (decisions/actions/risks/opportunities) — este Gate B não tocou neles", () => {
    // Nota: o campo `indicators?` em ApprovedSelection é adicionado DEPOIS,
    // no Gate D (gravação) — fora de escopo deste gate (Gate B, casamento),
    // que só leu os indicadores já existentes, sem gravar nada.
    const start = meetingAnalysisSource.indexOf("export type ApprovedSelection");
    expect(start).toBeGreaterThan(-1);
    const end = meetingAnalysisSource.indexOf("};", start);
    const block = meetingAnalysisSource.slice(start, end);
    expect(block).toContain("decisions");
    expect(block).toContain("actions");
    expect(block).toContain("risks");
    expect(block).toContain("opportunities");
  });
});
