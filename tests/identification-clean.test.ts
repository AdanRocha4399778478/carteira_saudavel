import { describe, expect, test } from "bun:test";
import { cleanParticipants, normalizeMeetingType } from "@/lib/identification-clean";
import { MEETING_TYPES } from "@/lib/domain";

describe("normalizeMeetingType", () => {
  test("aceita valores válidos com caixa e acento diferentes", () => {
    expect(normalizeMeetingType("Diagnóstico")).toBe("diagnóstico");
    expect(normalizeMeetingType("DIAGNOSTICO")).toBe("diagnóstico");
    expect(normalizeMeetingType("revisao de plano")).toBe("revisão de plano");
    expect(normalizeMeetingType("Alinhamento De Liderança")).toBe("alinhamento de liderança");
  });

  test("todos os MEETING_TYPES se normalizam para si mesmos", () => {
    for (const t of MEETING_TYPES) {
      expect(normalizeMeetingType(t.toUpperCase())).toBe(t);
    }
  });

  test("valor inválido vira ''", () => {
    expect(normalizeMeetingType("reunião informal")).toBe("");
  });

  test("nulo/indefinido/vazio vira ''", () => {
    expect(normalizeMeetingType(null)).toBe("");
    expect(normalizeMeetingType(undefined)).toBe("");
    expect(normalizeMeetingType("")).toBe("");
  });
});

describe("cleanParticipants", () => {
  test("remove rótulos genéricos de falante", () => {
    expect(cleanParticipants("Speaker 1, Speaker 2")).toBe("");
  });

  test("mantém o nome real e remove o rótulo genérico", () => {
    expect(cleanParticipants("Adan, Speaker 2")).toBe("Adan");
  });

  test('"Adan e Elias" permanece intacto', () => {
    expect(cleanParticipants("Adan e Elias")).toBe("Adan e Elias");
  });

  test('"Speaker 1." com ponto final também é reconhecido como genérico', () => {
    expect(cleanParticipants("Speaker 1.")).toBe("");
  });

  test("lista vazia", () => {
    expect(cleanParticipants("")).toBe("");
  });

  test("Falante N, Participante N e Unknown também são genéricos", () => {
    expect(cleanParticipants("Falante 1, Participante 2, Unknown")).toBe("");
  });

  test("'e' só separa quando um dos lados é genérico", () => {
    expect(cleanParticipants("Adan e Speaker 2")).toBe("Adan");
  });
});
