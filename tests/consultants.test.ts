import { describe, expect, test } from "bun:test";
import { consultantDisplayName, selectableConsultants } from "../src/lib/consultants";
import type { Profile } from "../src/lib/domain";

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  id: "active",
  full_name: "Ana Souza",
  email: "ana@example.com",
  role: "consultant",
  active: true,
  created_at: "2026-08-14T00:00:00Z",
  ...overrides,
});

describe("consultores", () => {
  test("usa o e-mail quando o perfil antigo não possui nome", () => {
    expect(consultantDisplayName(profile({ full_name: "  " }))).toBe("ana@example.com");
  });

  test("não oferece inativos em novas atribuições", () => {
    const inactive = profile({ id: "inactive", active: false });
    expect(selectableConsultants([profile(), inactive]).map((item) => item.id)).toEqual(["active"]);
  });

  test("mantém o responsável inativo ao editar um vínculo existente", () => {
    const inactive = profile({ id: "inactive", active: false });
    expect(selectableConsultants([inactive], "inactive")).toEqual([inactive]);
  });
});
