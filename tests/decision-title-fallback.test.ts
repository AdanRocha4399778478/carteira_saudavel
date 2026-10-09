import { describe, expect, test } from "bun:test";
import { parseAnalysis, titleFromDescription } from "../src/lib/meeting-analysis";

/* ------------------------------------------------------------------ *
 * Decisão que a IA devolve sem `title`, mas com descrição, não pode
 * sumir: o título passa a ser a primeira frase da descrição (até 100
 * caracteres, cortando em palavra inteira). Sem título e sem descrição,
 * continua descartada. Ações não mudam.
 * ------------------------------------------------------------------ */

function decisionsOf(decisions: unknown[]) {
  const result = parseAnalysis({ decisions });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.analysis.decisions;
}

describe("titleFromDescription", () => {
  test("usa só a primeira frase da descrição", () => {
    expect(
      titleFromDescription("Definir o preço do plano. Depende da revisão dos custos fixos."),
    ).toBe("Definir o preço do plano.");
  });

  test("corta em até 100 caracteres sem partir palavra", () => {
    const longa = `${"palavra ".repeat(20)}fim`;
    const titulo = titleFromDescription(longa);
    expect(titulo.length).toBeLessThanOrEqual(100);
    expect(titulo.endsWith("palavra")).toBe(true);
  });

  test("descrição vazia devolve vazio", () => {
    expect(titleFromDescription("   ")).toBe("");
  });
});

describe("parseAnalysis — decisões sem título", () => {
  test("decisão sem título e com descrição é mantida, com título derivado", () => {
    const decisions = decisionsOf([
      { title: "", description: "Priorizar a reforma da recepção. Revisar no próximo mês." },
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.title).toBe("Priorizar a reforma da recepção.");
    expect(decisions[0]!.description).toBe(
      "Priorizar a reforma da recepção. Revisar no próximo mês.",
    );
  });

  test("decisão com título não muda", () => {
    const decisions = decisionsOf([{ title: "Adotar checklist", description: "Outra frase." }]);
    expect(decisions[0]!.title).toBe("Adotar checklist");
  });

  test("decisão sem título e sem descrição continua descartada", () => {
    expect(decisionsOf([{ title: "", description: "" }])).toHaveLength(0);
  });

  test("ação sem descrição continua descartada", () => {
    const result = parseAnalysis({ actions: [{ description: "", owner_name: "Fulano" }] });
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.analysis.actions).toHaveLength(0);
  });
});
