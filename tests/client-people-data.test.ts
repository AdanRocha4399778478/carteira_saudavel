import { describe, expect, test } from "bun:test";
import { translateClientPersonError } from "../src/lib/client-people-data";

/* ------------------------------------------------------------------ *
 * Cadastro de pessoas e apelidos por cliente — Gate C/D (19/10/2026).
 * Tradução dos dois erros de domínio do gatilho da migration
 * 20261019140000 (guard_client_people_unique_names): 23505 (nome/apelido
 * repetido no mesmo cliente) e 23514 (sem letras ou números).
 * ------------------------------------------------------------------ */

describe("translateClientPersonError — 23505 (nome/apelido repetido)", () => {
  test("usa a mensagem do banco quando ela já traz o nome do dono do conflito", () => {
    const message = translateClientPersonError({
      code: "23505",
      message: "nome ou apelido já usado por José Eduardo neste cliente",
    });
    expect(message).toBe("Nome ou apelido já usado por José Eduardo neste cliente.");
  });

  test("cai no texto genérico quando a mensagem do banco não traz o nome", () => {
    const message = translateClientPersonError({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });
    expect(message).toBe("Este nome ou apelido já é usado por outra pessoa deste cliente.");
  });
});

describe("translateClientPersonError — 23514 (sem letras ou números)", () => {
  test("vira a mensagem fixa em português", () => {
    const message = translateClientPersonError({
      code: "23514",
      message: "nome ou apelido precisa ter letras ou números",
    });
    expect(message).toBe("Nome ou apelido precisa ter letras ou números.");
  });
});

describe("translateClientPersonError — outros códigos", () => {
  test("repassa a mensagem original sem tradução", () => {
    const message = translateClientPersonError({
      code: "42501",
      message: "permission denied for table client_people",
    });
    expect(message).toBe("permission denied for table client_people");
  });

  test("sem código, repassa a mensagem original", () => {
    const message = translateClientPersonError({ message: "erro inesperado" });
    expect(message).toBe("erro inesperado");
  });
});
