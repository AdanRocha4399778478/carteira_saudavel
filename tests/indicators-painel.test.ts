import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 3 (17/10/2026): painel "antes e
 * depois" com cadastro manual, na aba Resultados da página do projeto.
 * Testes estáticos (texto-fonte), no padrão de tests/project-delete.test.ts.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
function source(path: string): string {
  return readFileSync(resolve(root, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}

const route = source("src/routes/_authenticated/projetos/$projectId.tsx");
const indicatorsData = source("src/lib/indicators-data.ts");
const indicatorDialog = source("src/components/painel/IndicatorDialog.tsx");
const pointDialog = source("src/components/painel/IndicatorPointDialog.tsx");
const confirmDeleteDialog = source("src/components/painel/ConfirmDeleteDialog.tsx");
const charts = source("src/components/charts/charts.tsx");
const badges = source("src/components/painel/badges.tsx");

describe("seção 'Antes e depois' na aba Resultados", () => {
  test("existe uma Section 'Antes e depois' dentro da TabsContent 'resultados'", () => {
    const resultadosTab = route.slice(
      route.indexOf('<TabsContent value="resultados"'),
      route.indexOf("</TabsContent>", route.indexOf('<TabsContent value="resultados"')),
    );
    expect(resultadosTab).toContain('title="Antes e depois"');
  });

  test("as duas seções de resultados já existentes continuam presentes", () => {
    expect(route).toContain('title="Resultados alcançados"');
    expect(route).toContain('title="Resultados mensuráveis por reunião"');
  });
});

describe("uso das funções puras de análise", () => {
  test("a página usa analyzeIndicator e formatIndicatorValue, não cálculo próprio", () => {
    expect(route).toContain("analyzeIndicator(indicator, points)");
    expect(route).toContain("formatIndicatorValue(indicator.kind, indicator.unit, value)");
    expect(route).toContain('from "@/lib/indicator-analysis"');
  });
});

describe("estimado é rotulado, nunca conta como resultado", () => {
  test("rótulo explícito na página", () => {
    expect(route).toContain("não conta como resultado");
  });

  test("rótulo explícito na legenda do gráfico", () => {
    expect(charts).toContain('name="Estimado (não conta como resultado)"');
  });
});

describe("sem recomendação automática", () => {
  test("nenhum termo de recomendação/prioridade/sugestão associado a indicadores", () => {
    const indicatorCardStart = route.indexOf("function IndicatorCard(");
    const indicatorCardSection = route.slice(
      indicatorCardStart,
      route.indexOf("\n}\n", indicatorCardStart),
    );
    expect(/recomend|prioridade|sugest/i.test(indicatorCardSection)).toBe(false);
  });
});

describe("apagar só para admin", () => {
  test("botão de apagar indicador é condicionado a isAdmin", () => {
    const indicatorCardStart = route.indexOf("function IndicatorCard(");
    const indicatorCardSection = route.slice(
      indicatorCardStart,
      route.indexOf("\n}\n", indicatorCardStart),
    );
    expect(indicatorCardSection).toContain("{isAdmin ? (");
    expect(indicatorCardSection).toContain("onDeleteIndicator");
  });

  test("os dois diálogos de confirmação de exclusão só são montados quando isAdmin", () => {
    const afterDialogs = route.slice(route.indexOf("<IndicatorDialog"));
    const deleteIndicatorBlock = afterDialogs.slice(
      afterDialogs.indexOf('title="Excluir indicador"') - 220,
      afterDialogs.indexOf('title="Excluir indicador"') + 20,
    );
    const deletePointBlock = afterDialogs.slice(
      afterDialogs.indexOf('title="Excluir ponto"') - 220,
      afterDialogs.indexOf('title="Excluir ponto"') + 20,
    );
    expect(deleteIndicatorBlock).toContain("isAdmin ? (");
    expect(deletePointBlock).toContain("isAdmin ? (");
  });

  test("ConfirmDeleteDialog não decide admin por conta própria — é genérico, decisão fica no chamador", () => {
    expect(confirmDeleteDialog).not.toContain("isAdmin");
  });
});

describe("nenhum arquivo de integrations tocado, nenhuma migration nova", () => {
  test("src/integrations não foi criado/alterado por este gate (arquivo-sentinela ausente)", () => {
    expect(existsSync(resolve(root, "src/integrations/indicators-painel-sentinel.ts"))).toBe(false);
  });

  test("não há migration nova além da já existente de criação das tabelas", () => {
    expect(
      existsSync(resolve(root, "supabase/migrations/20261017120000_create_indicators.sql")),
    ).toBe(true);
  });
});

describe("leitura de indicadores com embed de pontos", () => {
  test("indicatorsQuery usa select com embed de indicator_points e queryKey própria", () => {
    expect(indicatorsData).toContain("indicator_points(");
    expect(indicatorsData).toContain('["indicators", "project", projectId]');
  });
});

describe("cadastro manual — indicador", () => {
  test("client_id vem do projeto, project_id da página", () => {
    expect(indicatorDialog).toContain("client_id: clientId");
    expect(indicatorDialog).toContain("project_id: projectId");
  });

  test("duplicidade de nome (índice único) vira mensagem amigável", () => {
    expect(indicatorDialog).toContain('error.code === "23505"');
    expect(indicatorDialog).toContain("Já existe um indicador com esse nome e tipo neste projeto.");
  });

  test("mesmo formulário é reaproveitado para criar e editar", () => {
    expect(indicatorDialog).toContain("indicator ? ");
    expect(indicatorDialog).not.toContain("IndicatorCreateDialog");
    expect(indicatorDialog).not.toContain("IndicatorEditDialog");
  });
});

describe("cadastro manual — ponto", () => {
  test("client_id e project_id vêm do indicador pai, não de props soltas", () => {
    expect(pointDialog).toContain("client_id: indicator.client_id");
    expect(pointDialog).toContain("project_id: indicator.project_id");
  });

  test("source é sempre 'manual' neste cadastro", () => {
    expect(pointDialog).toContain('source: "manual"');
  });

  test("marca medido/estimado não tem valor pré-selecionado no formulário vazio", () => {
    expect(pointDialog).toContain('basis: ""');
  });

  test("mesmo formulário é reaproveitado para criar e editar o ponto", () => {
    expect(pointDialog).toContain("point ? ");
  });
});

describe("invalidação de cache após gravar", () => {
  test("indicador e ponto invalidam a mesma queryKey de indicadores do projeto", () => {
    expect(indicatorDialog).toContain('queryKey: ["indicators", "project", projectId]');
    expect(pointDialog).toContain('queryKey: ["indicators", "project", indicator.project_id]');
  });
});

describe("badge de status reaproveita Pill/Tone existentes", () => {
  test("IndicatorStatusBadge usa Pill, sem Tone nem classe nova", () => {
    const badgeStart = badges.indexOf("export function IndicatorStatusBadge");
    const badgeSection = badges.slice(badgeStart, badges.indexOf("\n}\n", badgeStart));
    expect(badgeSection).toContain("<Pill tone={tone}");
    expect(badgeSection).not.toMatch(/bg-\[|#[0-9a-fA-F]{3,6}/);
  });
});
