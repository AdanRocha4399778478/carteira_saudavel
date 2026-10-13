import { describe, expect, test } from "bun:test";
import { shouldShowProjectMatchWarning } from "../src/lib/projects";

describe("shouldShowProjectMatchWarning", () => {
  test("mesmo id do preview atual: não mostra (aviso enganoso, é o mesmo projeto já usado)", () => {
    expect(shouldShowProjectMatchWarning("EXACT_MATCH", "proj-1", "proj-1")).toBe(false);
  });

  test("id diferente do preview atual: mostra (duplicidade real, projeto pré-existente diferente)", () => {
    expect(shouldShowProjectMatchWarning("EXACT_MATCH", "proj-2", "proj-1")).toBe(true);
  });

  test("sem projeto do preview ainda (null): mostra como hoje", () => {
    expect(shouldShowProjectMatchWarning("EXACT_MATCH", "proj-2", null)).toBe(true);
  });

  test("sem projeto do preview ainda (undefined): mostra como hoje", () => {
    expect(shouldShowProjectMatchWarning("EXACT_MATCH", "proj-2", undefined)).toBe(true);
  });

  test("PROBABLE_MATCH com id diferente também mostra", () => {
    expect(shouldShowProjectMatchWarning("PROBABLE_MATCH", "proj-2", "proj-1")).toBe(true);
  });

  test("PROBABLE_MATCH com o mesmo id do preview atual não mostra", () => {
    expect(shouldShowProjectMatchWarning("PROBABLE_MATCH", "proj-1", "proj-1")).toBe(false);
  });

  test("NEW_PROJECT nunca mostra, independente dos ids", () => {
    expect(shouldShowProjectMatchWarning("NEW_PROJECT", null, "proj-1")).toBe(false);
    expect(shouldShowProjectMatchWarning("NEW_PROJECT", "proj-2", null)).toBe(false);
  });

  test("existingId vazio/undefined com previewProjectId presente: mostra (nada para comparar)", () => {
    expect(shouldShowProjectMatchWarning("EXACT_MATCH", undefined, "proj-1")).toBe(true);
    expect(shouldShowProjectMatchWarning("EXACT_MATCH", null, "proj-1")).toBe(true);
  });
});
