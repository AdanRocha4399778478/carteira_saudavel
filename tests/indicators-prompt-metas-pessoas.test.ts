import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { limitEvidenceWords, parseAnalysis } from "../src/lib/meeting-analysis";

/* ------------------------------------------------------------------ *
 * R31 + R32 (18/10/2026): meta/projeção/faixa NÃO são indicator[], hedges
 * ampliados viram "estimado", indicador sem evidência é descartado,
 * evidência longa é cortada em 15 palavras — e R32: nunca registrar
 * remuneração/avaliação de pessoa identificável nem indicador de venda
 * POR pessoa, em nenhum bloco. SEM tela, SEM gravação, SEM
 * applyApprovedAnalysis — só prompt (intelligent-meeting.server.ts) e
 * schema (meeting-analysis.ts).
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

function indicator(patch: Record<string, unknown> = {}) {
  return {
    name: "Receita",
    kind: "valor",
    unit: "",
    direction: "maior_melhor",
    value: 100,
    baseline_value: null,
    basis: "medido",
    measured_at: "",
    evidence: "a receita foi de 100 mil no mês passado",
    classification: "fact",
    ...patch,
  };
}

describe("PROMPT — regra de meta, projeção e faixa fora de indicators[]", () => {
  test("a regra existe, com os exemplos do backlog", () => {
    expect(prompt).toContain("META, PROJEÇÃO e FAIXA não são o indicador");
    expect(prompt).toContain('"vamos chegar a 20 por dia"');
    expect(prompt).toContain('"a meta é 100 por semana"');
    expect(prompt).toContain('"queremos 400 por mês"');
    expect(prompt).toContain('"pretendo"');
    expect(prompt).toContain('"projeção"');
    expect(prompt).toContain('faixa ("entre 5% e 10%")');
  });

  test("declara que vira value null, o que descarta o item", () => {
    const idx = prompt.indexOf("META, PROJEÇÃO e FAIXA não são o indicador");
    const line = prompt.slice(idx, prompt.indexOf("\n", idx));
    expect(line).toContain("value null");
    expect(line).toContain("descarta o item");
  });
});

describe("PROMPT — lista de aproximação ('estimado') ampliada com os hedges do backlog", () => {
  for (const hedge of [
    "acho que",
    "creio",
    "se não me engano",
    "de cabeça",
    "se não me falha a memória",
    "em torno de",
  ]) {
    test(`contém o hedge "${hedge}"`, () => {
      expect(prompt).toContain(`"${hedge}"`);
    });
  }

  test("hedges antigos (uns, mais ou menos, quase, cerca de, aproximadamente, por volta de) continuam na lista", () => {
    const idx = prompt.indexOf('"estimado" quando a fala usar aproximação (');
    expect(idx).toBeGreaterThan(-1);
    const line = prompt.slice(idx, prompt.indexOf(")", idx) + 1);
    const oldHedges = [
      "uns",
      "mais ou menos",
      "quase",
      "cerca de",
      "aproximadamente",
      "por volta de",
    ];
    for (const hedge of oldHedges) {
      expect(line).toContain(`"${hedge}"`);
    }
  });

  test("número fechado dito com segurança continua 'medido'", () => {
    expect(prompt).toContain('"medido" quando o número for fechado e dito com segurança');
  });
});

describe("PROMPT — R32: proíbe VALORES e OPINIÃO sobre pessoa identificável, com exceção pra regras de papel/meta/comissionamento", () => {
  test("a regra cita todos os blocos (evidence, decisions, risks, opportunities, contexto, resumos)", () => {
    const idx = prompt.indexOf("Remuneração e avaliação de pessoa identificável");
    expect(idx).toBeGreaterThan(-1);
    const line = prompt.slice(idx, prompt.indexOf("\n", idx));
    expect(line).toContain("evidence");
    expect(line).toContain("decisions[]");
    expect(line).toContain("risks[]");
    expect(line).toContain("opportunities[]");
    expect(line).toContain("contexto");
    expect(line).toContain("resumos");
  });

  test("proíbe VALORES de remuneração/salário/comissão/pagamento de pessoa identificável", () => {
    expect(prompt).toContain("VALORES em dinheiro ou percentuais de remuneração");
    expect(prompt).toContain("salário, comissão ou pagamento de uma pessoa identificável");
  });

  test("proíbe OPINIÃO/julgamento/avaliação subjetiva sobre pessoa identificável", () => {
    expect(prompt).toContain(
      "OPINIÃO, JULGAMENTO ou AVALIAÇÃO SUBJETIVA sobre uma pessoa identificável",
    );
    expect(prompt).toContain("qualidades, defeitos, elogio ou crítica pessoal");
  });

  test("proíbe indicador de venda/resultado POR pessoa identificável, pede descrição agregada", () => {
    expect(prompt).toContain(
      "NÃO sugira indicators[] de venda ou resultado POR pessoa identificável",
    );
    expect(prompt).toContain('"vendas do vendedor X"');
    expect(prompt).toContain("descreva de forma agregada, sem nome");
    expect(prompt).toContain('"a equipe comercial"');
  });

  test("exceção explícita: regra de papel/meta/critério de avaliação/comissionamento sem valores nem opinião continua permitida", () => {
    expect(prompt).toContain("EXCEÇÃO:");
    expect(prompt).toContain(
      "o papel, as metas, os critérios de avaliação e a estrutura de comissionamento",
    );
    expect(prompt).toContain("SEM valores e SEM opinião");
  });

  test("exceção traz os três exemplos do piloto (Chammas)", () => {
    expect(prompt).toContain('"o Vitor será avaliado só por geração de leads"');
    expect(prompt).toContain('"a comissão só será paga depois de validar a margem"');
    expect(prompt).toContain('"o vendedor passa a ter meta semanal de contatos"');
  });

  test("política de remuneração da EMPRESA (sem valor de pessoa identificável) pode entrar", () => {
    expect(prompt).toContain("a política de remuneração da EMPRESA como assunto");
  });

  test("exceção inclui responsáveis de tarefa e participantes", () => {
    const idx = prompt.indexOf("EXCEÇÃO:");
    expect(idx).toBeGreaterThan(-1);
    const line = prompt.slice(idx, prompt.indexOf("\n", idx));
    expect(line).toContain("decisions[].owner");
    expect(line).toContain("actions[].owner_name");
    expect(line).toContain("participantes");
  });
});

describe("limitEvidenceWords — função pura", () => {
  test("texto vazio devolve vazio", () => {
    expect(limitEvidenceWords("", 15)).toBe("");
  });

  test("exatamente 15 palavras: intacto, sem '…'", () => {
    const text = Array.from({ length: 15 }, (_, i) => `p${i + 1}`).join(" ");
    expect(limitEvidenceWords(text, 15)).toBe(text);
  });

  test("16 palavras: corta pra 15 e acrescenta '…'", () => {
    const text = Array.from({ length: 16 }, (_, i) => `p${i + 1}`).join(" ");
    const expected = Array.from({ length: 15 }, (_, i) => `p${i + 1}`).join(" ") + "…";
    expect(limitEvidenceWords(text, 15)).toBe(expected);
    expect(limitEvidenceWords(text, 15).split(/\s+/).length).toBe(15);
  });

  test("espaços duplicados nunca inflam a contagem de palavras", () => {
    const text = "um  dois   três    quatro";
    expect(limitEvidenceWords(text, 3)).toBe("um dois três…");
  });

  test("texto com menos que max palavras fica intacto (só aparado nas pontas)", () => {
    expect(limitEvidenceWords("  duas palavras  ", 15)).toBe("duas palavras");
  });
});

describe("transform de indicators[] — descarta sem evidência, corta evidência longa", () => {
  test("item sem evidência (string vazia) é descartado", () => {
    expect(indicatorsOf([indicator({ evidence: "" })])).toEqual([]);
  });

  test("item com evidência só espaços é descartado (trim antes de checar)", () => {
    expect(indicatorsOf([indicator({ evidence: "    " })])).toEqual([]);
  });

  test("evidência de 18 palavras vira 15 palavras + '…' (nunca fica com 18)", () => {
    const evidence18 = Array.from({ length: 18 }, (_, i) => `palavra${i + 1}`).join(" ");
    const [out] = indicatorsOf([indicator({ evidence: evidence18 })]);
    expect(out!.evidence.replace("…", "").trim().split(/\s+/).length).toBe(15);
    expect(out!.evidence.endsWith("…")).toBe(true);
    expect(out!.evidence).not.toBe(evidence18);
  });

  test("evidência de até 15 palavras fica intacta, sem '…'", () => {
    const evidence10 = Array.from({ length: 10 }, (_, i) => `palavra${i + 1}`).join(" ");
    const [out] = indicatorsOf([indicator({ evidence: evidence10 })]);
    expect(out!.evidence).toBe(evidence10);
  });
});

describe("os testes antigos do schema (Gate A) continuam passando", () => {
  test("indicador válido completo (sem as regras novas em jogo) ainda sobrevive ao transform", () => {
    const [out] = indicatorsOf([indicator()]);
    expect(out!.name).toBe("Receita");
    expect(out!.value).toBe(100);
  });

  test("sem nome, sem kind válido ou sem valor continuam descartando o item", () => {
    expect(indicatorsOf([indicator({ name: "" })])).toEqual([]);
    expect(indicatorsOf([indicator({ kind: "invalido" })])).toEqual([]);
    expect(indicatorsOf([indicator({ value: null })])).toEqual([]);
  });

  test("duplicado (mesmo nome normalizado + kind) continua removido, mantendo o primeiro", () => {
    const out = indicatorsOf([indicator({ value: 1 }), indicator({ value: 2 })]);
    expect(out.length).toBe(1);
    expect(out[0]!.value).toBe(1);
  });
});
