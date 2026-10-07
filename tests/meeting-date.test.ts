import { describe, expect, test } from "bun:test";
import { extractMeetingDateFromHeader } from "@/lib/meeting-date";

describe("extractMeetingDateFromHeader", () => {
  test("'Meeting started: May 8, 2026, 11:42:57 PM' => 2026-05-08, sexta-feira", () => {
    expect(extractMeetingDateFromHeader("Meeting started: May 8, 2026, 11:42:57 PM")).toEqual({
      iso: "2026-05-08",
      weekday: "sexta-feira",
    });
  });

  test("'Meeting started: Jun 5, 2026' => 2026-06-05, sexta-feira", () => {
    expect(extractMeetingDateFromHeader("Meeting started: Jun 5, 2026")).toEqual({
      iso: "2026-06-05",
      weekday: "sexta-feira",
    });
  });

  test("'Meeting started: Jul 28, 2026' => 2026-07-28, terça-feira", () => {
    expect(extractMeetingDateFromHeader("Meeting started: Jul 28, 2026")).toEqual({
      iso: "2026-07-28",
      weekday: "terça-feira",
    });
  });

  test("'Meeting started: Apr 6, 2026' => 2026-04-06, segunda-feira", () => {
    expect(extractMeetingDateFromHeader("Meeting started: Apr 6, 2026")).toEqual({
      iso: "2026-04-06",
      weekday: "segunda-feira",
    });
  });

  test("mesmo texto numa linha única no meio de outro texto (como o pdf.js entrega a página)", () => {
    const oneLine =
      "Chammas - Devolutiva de Equipe Meeting started: May 8, 2026, 11:42:57 PM Meeting duration: 44 minutes Meeting participants: Speaker 1, Speaker 2";
    expect(extractMeetingDateFromHeader(oneLine)).toEqual({
      iso: "2026-05-08",
      weekday: "sexta-feira",
    });
  });

  test("texto sem 'Meeting started' devolve null", () => {
    expect(extractMeetingDateFromHeader("Transcript 00:00 Speaker 1.: Oi, tudo bem?")).toBeNull();
  });

  test("mês inválido ('Foo') devolve null", () => {
    expect(extractMeetingDateFromHeader("Meeting started: Foo 8, 2026")).toBeNull();
  });

  test("dia inválido para o mês ('Feb 30' não existe em nenhum ano) devolve null", () => {
    expect(extractMeetingDateFromHeader("Meeting started: Feb 30, 2026")).toBeNull();
  });
});
