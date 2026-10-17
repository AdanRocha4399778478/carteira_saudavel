import { describe, expect, test } from "bun:test";
import { resolveRelativeDeadline } from "../src/lib/prazo-relativo";

/* ------------------------------------------------------------------ *
 * Backlog B18 (17/10/2026) — tabela de conversão de expressão relativa
 * para data absoluta, decidida pelo consultor. Reunião de referência:
 * sexta-feira 2026-10-16 (confirmado: 16/10/2026 cai numa sexta-feira).
 * ------------------------------------------------------------------ */

const MEETING = "2026-10-16"; // sexta-feira

describe("resolveRelativeDeadline — tabela decidida pelo consultor (B18)", () => {
  test("'esta semana ou a próxima' -> sexta da semana seguinte (a mais distante)", () => {
    expect(resolveRelativeDeadline("esta semana ou a próxima", MEETING)).toBe("2026-10-23");
  });

  test("'semana que vem' -> sexta da semana seguinte", () => {
    expect(resolveRelativeDeadline("semana que vem", MEETING)).toBe("2026-10-23");
  });

  test("'próxima semana' -> mesmo resultado de 'semana que vem'", () => {
    expect(resolveRelativeDeadline("próxima semana", MEETING)).toBe("2026-10-23");
  });

  test("'esta semana' -> sexta da própria semana da reunião (a reunião já é sexta)", () => {
    expect(resolveRelativeDeadline("esta semana", MEETING)).toBe("2026-10-16");
  });

  test("'amanhã' -> dia seguinte à reunião", () => {
    expect(resolveRelativeDeadline("amanhã", MEETING)).toBe("2026-10-17");
  });

  test("'hoje' -> a própria data da reunião", () => {
    expect(resolveRelativeDeadline("hoje", MEETING)).toBe("2026-10-16");
  });

  test("'segunda' -> próxima segunda-feira estritamente posterior à reunião", () => {
    expect(resolveRelativeDeadline("segunda", MEETING)).toBe("2026-10-19");
  });

  test("'sexta' -> null (a própria reunião já é sexta-feira)", () => {
    expect(resolveRelativeDeadline("sexta", MEETING)).toBeNull();
  });

  test("'fim do mês' -> último dia do mês da reunião", () => {
    expect(resolveRelativeDeadline("fim do mês", MEETING)).toBe("2026-10-31");
  });

  test("'mês que vem' -> último dia do mês seguinte", () => {
    expect(resolveRelativeDeadline("mês que vem", MEETING)).toBe("2026-11-30");
  });

  test("'em 60 dias' -> soma direta de dias corridos", () => {
    expect(resolveRelativeDeadline("em 60 dias", MEETING)).toBe("2026-12-15");
  });

  test("'daqui a 60 dias' -> mesma regra de 'em N dias'", () => {
    expect(resolveRelativeDeadline("daqui a 60 dias", MEETING)).toBe("2026-12-15");
  });

  test("'dentro de 60 dias' -> mesma regra de 'em N dias'", () => {
    expect(resolveRelativeDeadline("dentro de 60 dias", MEETING)).toBe("2026-12-15");
  });

  test("'ao final de 60 dias' com reunião em 2026-07-20 -> 2026-09-18 (caso real Chammas)", () => {
    expect(resolveRelativeDeadline("ao final de 60 dias", "2026-07-20")).toBe("2026-09-18");
  });

  test("'ao fim de 60 dias' -> mesma regra de 'ao final de N dias'", () => {
    expect(resolveRelativeDeadline("ao fim de 60 dias", "2026-07-20")).toBe("2026-09-18");
  });

  test("'dentro de 2 semanas' com reunião em 2026-10-16 -> 2026-10-30", () => {
    expect(resolveRelativeDeadline("dentro de 2 semanas", MEETING)).toBe("2026-10-30");
  });

  test("'daqui a 2 semanas' -> mesma regra de 'em N semanas'", () => {
    expect(resolveRelativeDeadline("daqui a 2 semanas", MEETING)).toBe("2026-10-30");
  });

  test("'ao final de 2 semanas' -> mesma regra de 'em N semanas'", () => {
    expect(resolveRelativeDeadline("ao final de 2 semanas", MEETING)).toBe("2026-10-30");
  });

  test("'ao fim de 2 semanas' -> mesma regra de 'em N semanas'", () => {
    expect(resolveRelativeDeadline("ao fim de 2 semanas", MEETING)).toBe("2026-10-30");
  });

  test("'em 2 semanas' -> soma 14 dias corridos", () => {
    expect(resolveRelativeDeadline("em 2 semanas", MEETING)).toBe("2026-10-30");
  });

  test("'fim do ano' -> 31/12 do ano da reunião", () => {
    expect(resolveRelativeDeadline("fim do ano", MEETING)).toBe("2026-12-31");
  });

  test("expressão desconhecida -> null (nunca inventa data)", () => {
    expect(resolveRelativeDeadline("depois da lua cheia", MEETING)).toBeNull();
  });

  test("expressão condicional ('depois de receber...') -> null", () => {
    expect(resolveRelativeDeadline("depois de receber o retorno do banco", MEETING)).toBeNull();
  });

  test("hint vazio ou nulo -> null", () => {
    expect(resolveRelativeDeadline("", MEETING)).toBeNull();
    expect(resolveRelativeDeadline(null, MEETING)).toBeNull();
    expect(resolveRelativeDeadline(undefined, MEETING)).toBeNull();
  });

  test("data da reunião ausente ou inválida -> null", () => {
    expect(resolveRelativeDeadline("amanhã", "")).toBeNull();
    expect(resolveRelativeDeadline("amanhã", null)).toBeNull();
    expect(resolveRelativeDeadline("amanhã", "16/10/2026")).toBeNull();
  });
});

describe("resolveRelativeDeadline — virada de mês, de ano e ano bissexto", () => {
  test("virada de mês: 'amanhã' na última reunião de outubro cai em novembro", () => {
    expect(resolveRelativeDeadline("amanhã", "2026-10-31")).toBe("2026-11-01");
  });

  test("virada de ano: 'amanhã' em 31/12 cai no 1º de janeiro do ano seguinte", () => {
    expect(resolveRelativeDeadline("amanhã", "2026-12-31")).toBe("2027-01-01");
  });

  test("virada de ano: 'mês que vem' com reunião em dezembro aponta para janeiro do ano seguinte", () => {
    expect(resolveRelativeDeadline("mês que vem", "2026-12-10")).toBe("2027-01-31");
  });

  test("'fim do mês' com reunião em dezembro é 31/12 (mesmo ano)", () => {
    expect(resolveRelativeDeadline("fim do mês", "2026-12-10")).toBe("2026-12-31");
  });

  test("ano bissexto: 'fim do mês' em fevereiro de 2028 (bissexto) é 29/02", () => {
    expect(resolveRelativeDeadline("fim do mês", "2028-02-10")).toBe("2028-02-29");
  });

  test("ano não bissexto: 'fim do mês' em fevereiro de 2026 é 28/02", () => {
    expect(resolveRelativeDeadline("fim do mês", "2026-02-10")).toBe("2026-02-28");
  });

  test("'em 60 dias' cruzando virada de ano soma corretamente", () => {
    expect(resolveRelativeDeadline("em 60 dias", "2026-12-10")).toBe("2027-02-08");
  });
});
