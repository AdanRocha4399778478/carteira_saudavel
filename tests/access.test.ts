import { describe, expect, test } from "bun:test";
import { canFor, type AccessState } from "../src/lib/auth/access";

const state = (overrides: Partial<AccessState> = {}): AccessState => ({
  userId: "user-1",
  email: "user@example.com",
  profile: null,
  roles: [],
  isAdmin: false,
  isConsultant: false,
  ...overrides,
});

describe("autorização da UI", () => {
  test("falha de forma segura quando o usuário não possui papel", () => {
    expect(canFor(state(), "clients", "read")).toBe(false);
    expect(canFor(state(), "profiles", "read")).toBe(false);
  });

  test("mantém permissões de consultor quando user_roles concede consultant", () => {
    const consultant = state({ roles: ["consultant"], isConsultant: true });
    expect(canFor(consultant, "clients", "read")).toBe(true);
    expect(canFor(consultant, "clients", "delete")).toBe(false);
  });

  test("administrador continua com acesso total na matriz da UI", () => {
    const admin = state({ roles: ["admin"], isAdmin: true });
    expect(canFor(admin, "clients", "delete")).toBe(true);
    expect(canFor(admin, "roles", "update")).toBe(true);
  });
});
