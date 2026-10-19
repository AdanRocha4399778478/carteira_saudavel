import { describe, expect, test } from "bun:test";
import { PERSON_FUNCTIONS, type PersonFunction } from "../src/lib/client-people";

describe("PERSON_FUNCTIONS — mesma lista fechada do CHECK da migration", () => {
  test("tem exatamente as quatro funções, em ordem estável", () => {
    expect(PERSON_FUNCTIONS).toEqual(["executa", "monitora", "acompanha", "decide"]);
  });

  test("tipo PersonFunction aceita só esses quatro valores", () => {
    const value: PersonFunction = "decide";
    expect(PERSON_FUNCTIONS).toContain(value);
  });
});
