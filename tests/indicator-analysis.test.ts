import { describe, expect, test } from "bun:test";
import {
  analyzeIndicator,
  formatIndicatorValue,
  type IndicatorForAnalysis,
  type IndicatorPointForAnalysis,
} from "../src/lib/indicator-analysis";

/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 2 (17/10/2026): análise pura
 * (delta, variação, status, progresso) e formatação em pt-BR. Regras
 * decididas pelo dono do produto: resultado só conta ponto "medido";
 * faixa neutra ±2% sobre o MÓDULO da base; sem recomendação nem
 * prioridade automática; valor ausente nunca vira zero (null).
 * ------------------------------------------------------------------ */

function indicator(overrides: Partial<IndicatorForAnalysis> = {}): IndicatorForAnalysis {
  return {
    direction: "maior_melhor",
    baseline_value: null,
    target_value: null,
    ...overrides,
  };
}

function point(
  overrides: Partial<IndicatorPointForAnalysis> & { value: number },
): IndicatorPointForAnalysis {
  return {
    measured_at: "2026-06-01",
    basis: "medido",
    created_at: null,
    ...overrides,
  };
}

describe("analyzeIndicator — direção maior_melhor e menor_melhor", () => {
  test("maior_melhor: valor subiu além de 2% -> melhorou", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 100 }), [
      point({ value: 110, measured_at: "2026-06-01" }),
    ]);
    expect(result.delta).toBe(10);
    expect(result.variationPct).toBe(10);
    expect(result.status).toBe("melhorou");
  });

  test("maior_melhor: valor desceu além de 2% -> piorou", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 100 }), [
      point({ value: 90, measured_at: "2026-06-01" }),
    ]);
    expect(result.status).toBe("piorou");
  });

  test("menor_melhor: valor desceu além de 2% -> melhorou (direção invertida)", () => {
    const result = analyzeIndicator(indicator({ direction: "menor_melhor", baseline_value: 100 }), [
      point({ value: 90, measured_at: "2026-06-01" }),
    ]);
    expect(result.delta).toBe(-10);
    expect(result.variationPct).toBe(-10);
    expect(result.status).toBe("melhorou");
  });

  test("menor_melhor: valor subiu além de 2% -> piorou", () => {
    const result = analyzeIndicator(indicator({ direction: "menor_melhor", baseline_value: 100 }), [
      point({ value: 110, measured_at: "2026-06-01" }),
    ]);
    expect(result.status).toBe("piorou");
  });
});

describe("analyzeIndicator — faixa neutra de exatamente ±2% (borda) e logo acima", () => {
  test("exatamente 2% acima da base -> neutro (borda, inclusive)", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 100 }), [
      point({ value: 102 }),
    ]);
    expect(result.variationPct).toBe(2);
    expect(result.status).toBe("neutro");
  });

  test("exatamente 2% abaixo da base -> neutro (borda, inclusive)", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 100 }), [
      point({ value: 98 }),
    ]);
    expect(result.variationPct).toBe(-2);
    expect(result.status).toBe("neutro");
  });

  test("logo ACIMA de 2% (2,01%) -> já sai do neutro, melhorou em maior_melhor", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 100 }), [
      point({ value: 102.01 }),
    ]);
    expect(result.status).toBe("melhorou");
  });

  test("logo ABAIXO de -2% (-2,01%) -> já sai do neutro, piorou em maior_melhor", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 100 }), [
      point({ value: 97.99 }),
    ]);
    expect(result.status).toBe("piorou");
  });
});

describe("analyzeIndicator — base negativa (módulo da base, nunca inverte a faixa)", () => {
  test("base -50, +1 de delta = 2% do módulo -> neutro (borda)", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: -50 }), [
      point({ value: -49 }),
    ]);
    expect(result.delta).toBe(1);
    expect(result.variationPct).toBe(2);
    expect(result.status).toBe("neutro");
  });

  test("base -50, logo acima de 2% do módulo -> melhorou (maior_melhor)", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: -50 }), [
      point({ value: -48.9 }),
    ]);
    expect(result.status).toBe("melhorou");
  });

  test("base -50, valor desceu (mais negativo) além de 2% do módulo -> piorou (maior_melhor)", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: -50 }), [
      point({ value: -51.5 }),
    ]);
    expect(result.variationPct).toBeLessThan(-2);
    expect(result.status).toBe("piorou");
  });
});

describe("analyzeIndicator — base igual a zero (regra de borda, sem faixa percentual — ver JSDoc de computeStatus)", () => {
  test("base 0, delta positivo -> melhorou em maior_melhor, mesmo delta pequeno (sem faixa neutra percentual)", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 0 }), [
      point({ value: 0.01 }),
    ]);
    expect(result.variationPct).toBeNull();
    expect(result.delta).toBeCloseTo(0.01);
    expect(result.status).toBe("melhorou");
  });

  test("base 0, delta negativo -> piorou em maior_melhor", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 0 }), [
      point({ value: -5 }),
    ]);
    expect(result.status).toBe("piorou");
  });

  test("base 0, delta positivo -> melhorou em menor_melhor é invertido: aqui é piorou", () => {
    const result = analyzeIndicator(indicator({ direction: "menor_melhor", baseline_value: 0 }), [
      point({ value: 5 }),
    ]);
    expect(result.status).toBe("piorou");
  });

  test("base 0, delta exatamente 0 -> neutro", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 0 }), [
      point({ value: 0 }),
    ]);
    expect(result.delta).toBe(0);
    expect(result.status).toBe("neutro");
  });
});

describe("analyzeIndicator — ponto estimado mais recente que o medido", () => {
  test("estimado mais novo aparece em latestEstimated, mas NÃO muda delta nem status (só o medido conta)", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 100 }), [
      point({ value: 110, measured_at: "2026-05-01", basis: "medido" }),
      point({ value: 999, measured_at: "2026-06-01", basis: "estimado" }),
    ]);
    expect(result.currentMeasured).toBe(110);
    expect(result.delta).toBe(10);
    expect(result.status).toBe("melhorou");
    expect(result.latestEstimated).toBe(999);
  });

  test("estimado mais ANTIGO que o medido não aparece em latestEstimated (fica null)", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 100 }), [
      point({ value: 50, measured_at: "2026-01-01", basis: "estimado" }),
      point({ value: 110, measured_at: "2026-06-01", basis: "medido" }),
    ]);
    expect(result.latestEstimated).toBeNull();
  });
});

describe("analyzeIndicator — só pontos estimados (sem nenhum medido)", () => {
  test("currentMeasured e status ficam nulos; latestEstimated mostra o único dado disponível", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 100 }), [
      point({ value: 120, measured_at: "2026-06-01", basis: "estimado" }),
    ]);
    expect(result.currentMeasured).toBeNull();
    expect(result.status).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.variationPct).toBeNull();
    expect(result.latestEstimated).toBe(120);
  });
});

describe("analyzeIndicator — vários pontos fora de ordem cronológica no array", () => {
  test("acha o medido mais recente independente da ordem de entrada", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 100 }), [
      point({ value: 105, measured_at: "2026-03-01" }),
      point({ value: 130, measured_at: "2026-08-01" }), // mais recente, no meio do array
      point({ value: 110, measured_at: "2026-05-01" }),
      point({ value: 108, measured_at: "2026-01-01" }),
    ]);
    expect(result.currentMeasured).toBe(130);
  });

  test("empate em measured_at decide por created_at", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 100 }), [
      point({ value: 105, measured_at: "2026-06-01", created_at: "2026-06-01T08:00:00Z" }),
      point({ value: 111, measured_at: "2026-06-01", created_at: "2026-06-01T20:00:00Z" }),
    ]);
    expect(result.currentMeasured).toBe(111);
  });

  test("empate total (mesmo measured_at e created_at, ou os dois ausentes): ordem estável — o PRIMEIRO do array vence, nunca o de maior value", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 100 }), [
      point({ value: 999, measured_at: "2026-06-01" }), // primeiro no array, sem created_at
      point({ value: 1, measured_at: "2026-06-01" }), // empate total com o de cima — não substitui
    ]);
    // Ordem estável: o primeiro elemento do array (value 999) é o escolhido,
    // não o de maior value por coincidência — aqui os dois batem, então o
    // teste abaixo prova a ordem estável com o caso inverso.
    expect(result.currentMeasured).toBe(999);

    const resultInverted = analyzeIndicator(
      indicator({ direction: "maior_melhor", baseline_value: 100 }),
      [
        point({ value: 1, measured_at: "2026-06-01" }), // primeiro no array agora
        point({ value: 999, measured_at: "2026-06-01" }), // empate total — não substitui o primeiro
      ],
    );
    // Prova que é ORDEM, não "maior value": aqui o primeiro (value 1) vence,
    // mesmo o segundo tendo value maior.
    expect(resultInverted.currentMeasured).toBe(1);
  });
});

describe("analyzeIndicator — progresso acima de 100 e negativo (nunca limitado em progressRaw)", () => {
  test("ultrapassou a meta: progressRaw > 100, progressBar limitado em 100", () => {
    const result = analyzeIndicator(
      indicator({ direction: "maior_melhor", baseline_value: 10, target_value: 20 }),
      [point({ value: 25 })],
    );
    expect(result.progressRaw).toBe(150);
    expect(result.progressBar).toBe(100);
  });

  test("andou pro lado contrário da meta: progressRaw negativo, progressBar limitado em 0", () => {
    const result = analyzeIndicator(
      indicator({ direction: "maior_melhor", baseline_value: 10, target_value: 20 }),
      [point({ value: 5 })],
    );
    expect(result.progressRaw).toBe(-50);
    expect(result.progressBar).toBe(0);
  });

  test("meta igual à base: progressRaw e progressBar ficam null (divisão por zero evitada)", () => {
    const result = analyzeIndicator(
      indicator({ direction: "maior_melhor", baseline_value: 50, target_value: 50 }),
      [point({ value: 60 })],
    );
    expect(result.progressRaw).toBeNull();
    expect(result.progressBar).toBeNull();
  });
});

describe("analyzeIndicator — nada vira zero: dado ausente sempre devolve null", () => {
  test("sem baseline nem target, sem ponto nenhum: tudo null, nada vira 0", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor" }), []);
    expect(result.currentMeasured).toBeNull();
    expect(result.latestEstimated).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.variationPct).toBeNull();
    expect(result.status).toBeNull();
    expect(result.progressRaw).toBeNull();
    expect(result.progressBar).toBeNull();
  });

  test("com pontos medidos mas sem baseline: delta/variationPct/status ficam null, currentMeasured continua preenchido", () => {
    const result = analyzeIndicator(
      indicator({ direction: "maior_melhor", baseline_value: null }),
      [point({ value: 42 })],
    );
    expect(result.currentMeasured).toBe(42);
    expect(result.delta).toBeNull();
    expect(result.variationPct).toBeNull();
    expect(result.status).toBeNull();
  });

  test("com baseline mas sem ponto medido nenhum: delta/variationPct/status ficam null", () => {
    const result = analyzeIndicator(
      indicator({ direction: "maior_melhor", baseline_value: 100 }),
      [],
    );
    expect(result.currentMeasured).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.variationPct).toBeNull();
    expect(result.status).toBeNull();
  });
});

describe("analyzeIndicator — exemplos realistas", () => {
  test("receita de maio 23% acima de abril", () => {
    const abril = 200_000;
    const maio = 246_000; // 23% acima
    const result = analyzeIndicator(
      indicator({ direction: "maior_melhor", baseline_value: abril }),
      [point({ value: maio, measured_at: "2026-05-31" })],
    );
    expect(result.variationPct).toBeCloseTo(23, 5);
    expect(result.status).toBe("melhorou");
  });

  test("margem de 12% para 18% (percentual, maior_melhor)", () => {
    const result = analyzeIndicator(indicator({ direction: "maior_melhor", baseline_value: 12 }), [
      point({ value: 18 }),
    ]);
    expect(result.delta).toBe(6);
    expect(result.variationPct).toBe(50);
    expect(result.status).toBe("melhorou");
  });
});

describe("formatIndicatorValue — formato brasileiro, '—' pra ausente, nunca '0'", () => {
  test("percentual: '12,5%'", () => {
    expect(formatIndicatorValue("percentual", null, 12.5)).toBe("12,5%");
  });

  test("percentual inteiro: '23%' (sem decimais desnecessários)", () => {
    expect(formatIndicatorValue("percentual", null, 23)).toBe("23%");
  });

  test("kind 'valor' usa R$ como moeda mesmo sem unit explícita", () => {
    expect(formatIndicatorValue("valor", null, 143_000)).toBe("R$ 143.000,00");
  });

  test("unit 'R$' também vira moeda, mesmo com outro kind", () => {
    expect(formatIndicatorValue("quantidade", "R$", 143_000)).toBe("R$ 143.000,00");
  });

  test("kind 'valor' COM unidade própria (ex.: 'x', razão) NUNCA vira moeda — número com a unidade ao lado", () => {
    expect(formatIndicatorValue("valor", "x", 1.8)).toBe("1,8 x");
  });

  test("kind 'valor' sem unidade continua virando moeda", () => {
    expect(formatIndicatorValue("valor", null, 1.8)).toBe("R$ 1,80");
    expect(formatIndicatorValue("valor", "", 1.8)).toBe("R$ 1,80");
  });

  test("unit 'R$' com kind 'quantidade' vira moeda (a unidade manda, não o kind)", () => {
    expect(formatIndicatorValue("quantidade", "R$", 1.8)).toBe("R$ 1,80");
  });

  test("tempo com unidade ao lado: '5 dias'", () => {
    expect(formatIndicatorValue("tempo", "dias", 5)).toBe("5 dias");
  });

  test("quantidade sem unidade: só o número formatado", () => {
    expect(formatIndicatorValue("quantidade", null, 42)).toBe("42");
  });

  test("null vira '—', nunca '0'", () => {
    expect(formatIndicatorValue("valor", "R$", null)).toBe("—");
    expect(formatIndicatorValue("quantidade", null, null)).toBe("—");
  });

  test("undefined vira '—', nunca '0' nem 'R$ 0,00'", () => {
    expect(formatIndicatorValue("valor", "R$", undefined)).toBe("—");
  });
});
