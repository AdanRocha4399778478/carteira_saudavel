import { describe, expect, test } from "bun:test";
import { parseAnalysis } from "../src/lib/meeting-analysis";

/* ------------------------------------------------------------------ *
 * Validação dos riscos: a descrição é o primeiro texto não vazio entre
 * description, descricao, risco e title. Antes, description "" vencia
 * (o "??" só cobre campo ausente) e o risco que só tinha título era
 * descartado antes do preview.
 * ------------------------------------------------------------------ */

function risksOf(risks: unknown[]) {
  const result = parseAnalysis({ risks });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.analysis.risks;
}

describe("parseAnalysis — descrição dos riscos", () => {
  test("risco só com title entra com description igual ao title", () => {
    const risks = risksOf([{ title: "Atraso na entrega das peças", description: "" }]);
    expect(risks).toHaveLength(1);
    expect(risks[0]!.description).toBe("Atraso na entrega das peças");
  });

  test("risco com description e title mantém a description", () => {
    const risks = risksOf([
      { title: "Fornecedor único", description: "Dependência de um único fornecedor de peças" },
    ]);
    expect(risks[0]!.description).toBe("Dependência de um único fornecedor de peças");
  });

  test("risco com description e title vazios é descartado", () => {
    expect(risksOf([{ title: "  ", description: "" }])).toHaveLength(0);
  });

  test("risco em texto simples continua funcionando", () => {
    const risks = risksOf(["Oficina sem seguro contra incêndio"]);
    expect(risks[0]!.description).toBe("Oficina sem seguro contra incêndio");
  });

  test('risco com a chave "risco" continua funcionando', () => {
    const risks = risksOf([{ risco: "Queda de movimento no inverno" }]);
    expect(risks[0]!.description).toBe("Queda de movimento no inverno");
  });
});
