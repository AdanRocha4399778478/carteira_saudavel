import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAnalysis } from "../src/lib/meeting-analysis";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate A (18/10/2026): a IA sugere
 * indicadores e valores ditos na fala. SEM tela, SEM gravação — só o
 * campo "indicators" no prompt (intelligent-meeting.server.ts) e no
 * schema Zod (meeting-analysis.ts). ApprovedSelection, applyApprovedAnalysis
 * e o preview são gates futuros, intocados aqui.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
function source(path: string): string {
  return readFileSync(resolve(root, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}

const prompt = source("src/lib/intelligent-meeting.server.ts");

function indicatorsOf(indicators: unknown[]) {
  const result = parseAnalysis({ indicators });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.analysis.indicators;
}

describe("PROMPT — template JSON ganhou indicators[], depois de opportunities", () => {
  test("o template de saída tem o campo indicators", () => {
    expect(prompt).toContain('"indicators": [{ "name": "",');
  });

  test("classification do exemplo é 'fact' (número dito explicitamente é fato; a incerteza fica em basis)", () => {
    expect(prompt).toContain('"evidence": "", "classification": "fact" }],');
  });

  test("indicators vem depois de opportunities no template", () => {
    const oppIdx = prompt.indexOf('"opportunities": [{');
    const indIdx = prompt.indexOf('"indicators": [{');
    expect(oppIdx).toBeGreaterThan(-1);
    expect(indIdx).toBeGreaterThan(oppIdx);
  });

  test("o template lista os campos exigidos (name, kind, unit, direction, value, baseline_value, basis, measured_at, evidence, classification)", () => {
    const line = prompt.slice(
      prompt.indexOf('"indicators": [{'),
      prompt.indexOf("\n", prompt.indexOf('"indicators": [{')),
    );
    for (const field of [
      "name",
      "kind",
      "unit",
      "direction",
      "value",
      "baseline_value",
      "basis",
      "measured_at",
      "evidence",
      "classification",
    ]) {
      expect(line).toContain(`"${field}"`);
    }
  });
});

describe("PROMPT — regras de indicators[]", () => {
  test("valor e base são sempre número puro, com exemplos de conversão", () => {
    expect(prompt).toContain(
      "indicators[].value e indicators[].baseline_value são SEMPRE número puro",
    );
    expect(prompt).toContain('"143 mil" = 143000');
    expect(prompt).toContain('"23%" = 23 (kind "percentual", unit "")');
    expect(prompt).toContain('"meio milhão" = 500000');
    expect(prompt).toContain('"uns R$ 4 mil por mês" = 4000');
  });

  test("conversão ambígua vira null, nunca arredonda nem escolhe por conta própria", () => {
    expect(prompt).toContain('"uns 100 e tantos mil", dúvida entre mil e milhão');
    expect(prompt).toContain("indicators[].value fica null");
    expect(prompt).toContain("nunca arredonde nem escolha um número aproximado por conta própria");
  });

  test("variação percentual dita NÃO vira o nível da métrica — vira indicador próprio", () => {
    expect(prompt).toContain("NÃO vira o nível da métrica");
    expect(prompt).toContain('"Variação da receita sobre o mês anterior"');
  });

  test("só métrica acompanhável ao longo do tempo; exclui preço/empréstimo/cotação/exemplo de outro cliente", () => {
    expect(prompt).toContain(
      "só registre uma métrica que faça sentido ACOMPANHAR ao longo do tempo",
    );
    expect(prompt).toContain("preço de uma compra ou venda isolada");
    expect(prompt).toContain("valor de empréstimo ou parcela");
    expect(prompt).toContain("cotação");
    expect(prompt).toContain("número de OUTRO cliente ou citado só como exemplo");
  });

  test("marca estimado para aproximação, medido para número fechado", () => {
    expect(prompt).toContain(
      '"estimado" quando a fala usar aproximação ("uns", "mais ou menos", "quase", "cerca de", "aproximadamente", "por volta de")',
    );
    expect(prompt).toContain('"medido" quando o número for fechado');
  });

  test("base só quando a fala disser o valor anterior explicitamente", () => {
    expect(prompt).toContain(
      'indicators[].baseline_value SÓ quando a fala disser explicitamente o valor ANTERIOR ("era 12%, agora 18%")',
    );
  });

  test("máximo de 8 indicadores por reunião; na dúvida, não sugere", () => {
    expect(prompt).toContain("Máximo de 8 indicadores por reunião");
    expect(prompt).toContain(
      "na dúvida sobre se algo é ou não um indicador acompanhável, não sugira",
    );
  });

  test("regra contra qualificador/unidade/nome inventado, citada também aqui", () => {
    expect(prompt).toContain("nunca acrescente tipo, unidade ou nome que a fala não disse");
  });
});

describe("SCHEMA — parse funcional de indicators[]", () => {
  test("value numérico puro (143000) é aceito", () => {
    const [i] = indicatorsOf([{ name: "Receita", kind: "valor", value: 143000 }]);
    expect(i!.value).toBe(143000);
  });

  test("value em texto pt-BR ('143.000') é convertido para 143000", () => {
    const [i] = indicatorsOf([{ name: "Receita", kind: "valor", value: "143.000" }]);
    expect(i!.value).toBe(143000);
  });

  test("value '12.5' (formato americano, não é milhar válido) vira null — item é descartado", () => {
    const result = indicatorsOf([{ name: "Receita", kind: "valor", value: "12.5" }]);
    expect(result.length).toBe(0);
  });

  test("value null descarta o item", () => {
    const result = indicatorsOf([{ name: "Receita", kind: "valor", value: null }]);
    expect(result.length).toBe(0);
  });

  test("value ausente (undefined) descarta o item — nunca vira 0 silencioso", () => {
    const result = indicatorsOf([{ name: "Receita", kind: "valor" }]);
    expect(result.length).toBe(0);
  });

  test("value 0 explícito é aceito — 0 é diferente de ausente", () => {
    const [i] = indicatorsOf([{ name: "Risco", kind: "quantidade", value: 0 }]);
    expect(i!.value).toBe(0);
  });

  test("kind desconhecido descarta o item", () => {
    const result = indicatorsOf([{ name: "Receita", kind: "moeda", value: 100 }]);
    expect(result.length).toBe(0);
  });

  test("item sem nome é descartado, mesmo com kind e value válidos", () => {
    const result = indicatorsOf([{ name: "", kind: "valor", value: 100 }]);
    expect(result.length).toBe(0);
  });

  test("direction fora do domínio vira '' (não descarta o item)", () => {
    const [i] = indicatorsOf([
      { name: "Receita", kind: "valor", value: 100, direction: "pra cima" },
    ]);
    expect(i).toBeDefined();
    expect(i!.direction).toBe("");
  });

  test("direction válida é preservada", () => {
    const [i] = indicatorsOf([
      { name: "Receita", kind: "valor", value: 100, direction: "maior_melhor" },
    ]);
    expect(i!.direction).toBe("maior_melhor");
  });

  test("basis fora do domínio vira '' (não descarta o item)", () => {
    const [i] = indicatorsOf([{ name: "Receita", kind: "valor", value: 100, basis: "chute" }]);
    expect(i).toBeDefined();
    expect(i!.basis).toBe("");
  });

  test("basis válida ('estimado') é preservada", () => {
    const [i] = indicatorsOf([{ name: "Receita", kind: "valor", value: 100, basis: "estimado" }]);
    expect(i!.basis).toBe("estimado");
  });

  test("duplicado pela mesma chave (nome normalizado + kind) é removido, mantendo o primeiro", () => {
    const result = indicatorsOf([
      { name: "Receita Mensal", kind: "valor", value: 100 },
      { name: "  RECEITA   mensal  ", kind: "valor", value: 999 },
    ]);
    expect(result.length).toBe(1);
    expect(result[0]!.value).toBe(100);
  });

  test("mesmo nome mas kind diferente NÃO é duplicado", () => {
    const result = indicatorsOf([
      { name: "Receita", kind: "valor", value: 100 },
      { name: "Receita", kind: "percentual", value: 23 },
    ]);
    expect(result.length).toBe(2);
  });

  test("análise sem o campo indicators produz lista vazia (compatibilidade com rascunho antigo)", () => {
    const result = parseAnalysis({ decisions: [] });
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.analysis.indicators).toEqual([]);
  });

  test("baseline_value só é preenchido quando presente — ausente fica null", () => {
    const [i] = indicatorsOf([{ name: "Receita", kind: "valor", value: 100 }]);
    expect(i!.baseline_value).toBeNull();
  });

  test("baseline_value presente é convertido como value (pt-BR estrito)", () => {
    const [i] = indicatorsOf([
      { name: "Receita", kind: "valor", value: 100, baseline_value: "1.234,5" },
    ]);
    expect(i!.baseline_value).toBe(1234.5);
  });

  test("evidência é preservada literalmente", () => {
    const [i] = indicatorsOf([
      {
        name: "Receita",
        kind: "valor",
        value: 143000,
        evidence: "patrimônio líquido de uns R$ 143 mil",
      },
    ]);
    expect(i!.evidence).toBe("patrimônio líquido de uns R$ 143 mil");
  });
});

describe("SCHEMA — measured_at só sobrevive como data ISO real (nunca derruba a gravação em coluna date)", () => {
  test("'2026-10-16' (data real, válida) é mantida", () => {
    const [i] = indicatorsOf([
      { name: "Receita", kind: "valor", value: 100, measured_at: "2026-10-16" },
    ]);
    expect(i!.measured_at).toBe("2026-10-16");
  });

  test("'2026-02-31' (formato certo, dia inexistente) vira ''", () => {
    const [i] = indicatorsOf([
      { name: "Receita", kind: "valor", value: 100, measured_at: "2026-02-31" },
    ]);
    expect(i!.measured_at).toBe("");
  });

  test("'2026-13-01' (mês inexistente) vira ''", () => {
    const [i] = indicatorsOf([
      { name: "Receita", kind: "valor", value: 100, measured_at: "2026-13-01" },
    ]);
    expect(i!.measured_at).toBe("");
  });

  test("'maio de 2026' (não é AAAA-MM-DD) vira ''", () => {
    const [i] = indicatorsOf([
      { name: "Receita", kind: "valor", value: 100, measured_at: "maio de 2026" },
    ]);
    expect(i!.measured_at).toBe("");
  });

  test("'0026-10-17' (ano fora de 1990-2100, provável erro de digitação) vira ''", () => {
    const [i] = indicatorsOf([
      { name: "Receita", kind: "valor", value: 100, measured_at: "0026-10-17" },
    ]);
    expect(i!.measured_at).toBe("");
  });

  test("vazio continua ''", () => {
    const [i] = indicatorsOf([{ name: "Receita", kind: "valor", value: 100, measured_at: "" }]);
    expect(i!.measured_at).toBe("");
  });

  test("ausente (undefined) também continua '' — não descarta o item (só value/name/kind descartam)", () => {
    const [i] = indicatorsOf([{ name: "Receita", kind: "valor", value: 100 }]);
    expect(i).toBeDefined();
    expect(i!.measured_at).toBe("");
  });
});
