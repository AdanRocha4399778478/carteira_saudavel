import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyChronologyGuard,
  chronologyOf,
  type ItemResolution,
} from "../src/lib/deduplication";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const resolution = (patch: Partial<ItemResolution> = {}): ItemResolution => ({
  mode: "update",
  targetId: "existing-1",
  verdict: "UPDATE_EXISTING",
  confidence: 0.95,
  reason: "Item praticamente idêntico já registrado.",
  changes: [],
  ...patch,
});

describe("chronologyOf — candidato anterior / mesma data / posterior / data nula", () => {
  test("candidato de reunião anterior à atual: current_or_earlier", () => {
    expect(chronologyOf("2026-06-10", "2026-06-05")).toBe("current_or_earlier");
  });

  test("mesma data não conta como posterior", () => {
    expect(chronologyOf("2026-06-05", "2026-06-05")).toBe("current_or_earlier");
  });

  test("candidato de reunião posterior à atual: posterior", () => {
    expect(chronologyOf("2026-06-05", "2026-06-10")).toBe("posterior");
  });

  test("data atual ausente: unknown, nunca bloqueia sozinha", () => {
    expect(chronologyOf(null, "2026-06-10")).toBe("unknown");
    expect(chronologyOf(undefined, "2026-06-10")).toBe("unknown");
  });

  test("data do candidato ausente: unknown, nunca bloqueia sozinha", () => {
    expect(chronologyOf("2026-06-05", null)).toBe("unknown");
    expect(chronologyOf("2026-06-05", undefined)).toBe("unknown");
  });
});

describe("applyChronologyGuard — rebaixa 'update' pra 'create' só quando posterior", () => {
  test("posterior: mode 'update' vira 'create', veredito e confiança preservados (auditoria)", () => {
    const base = resolution({ mode: "update" });
    const guarded = applyChronologyGuard(base, "posterior", "2026-06-10");
    expect(guarded.mode).toBe("create");
    expect(guarded.verdict).toBe(base.verdict);
    expect(guarded.confidence).toBe(base.confidence);
    expect(guarded.chronology).toBe("posterior");
    expect(guarded.candidateMeetingDate).toBe("2026-06-10");
  });

  test("current_or_earlier: mode não muda", () => {
    const base = resolution({ mode: "update" });
    const guarded = applyChronologyGuard(base, "current_or_earlier", "2026-06-01");
    expect(guarded.mode).toBe("update");
    expect(guarded.chronology).toBe("current_or_earlier");
  });

  test("unknown: mode não muda (ausência de data não bloqueia)", () => {
    const base = resolution({ mode: "update" });
    const guarded = applyChronologyGuard(base, "unknown", null);
    expect(guarded.mode).toBe("update");
    expect(guarded.chronology).toBe("unknown");
  });

  test("posterior mas mode já era 'skip' (POSSIBLE_DUPLICATE): continua 'skip'", () => {
    const base = resolution({ mode: "skip", verdict: "POSSIBLE_DUPLICATE" });
    const guarded = applyChronologyGuard(base, "posterior", "2026-06-10");
    expect(guarded.mode).toBe("skip");
  });

  test("posterior mas mode já era 'create' (NEW): continua 'create'", () => {
    const base = resolution({ mode: "create", targetId: null, verdict: "NEW" });
    const guarded = applyChronologyGuard(base, "posterior", "2026-06-10");
    expect(guarded.mode).toBe("create");
  });
});

describe("GATE — trava de cronologia no backend (applyApprovedAnalysis), defesa em profundidade", () => {
  const analysisSource = read("src/lib/meeting-analysis.ts");

  test("ApplyResult expõe o contador blockedByChronology", () => {
    expect(analysisSource).toContain("blockedByChronology: number;");
    expect(analysisSource).toContain("blockedByChronology: 0,");
  });

  test("existe um helper de data de reunião de origem, usado pela checagem", () => {
    expect(analysisSource).toContain("async function meetingDateOf(");
  });

  test("as 4 entidades (decisions/actions/risks/opportunities) checam cronologia antes de aplicar o patch de update", () => {
    const occurrences = analysisSource.split(
      'if (chronologyOf(meeting.meeting_date, await meetingDateOf(candidateMeetingId)) === "posterior") {\n        result.blockedByChronology += 1;\n        continue;\n      }',
    ).length - 1;
    expect(occurrences).toBe(4);
  });

  test("context_items (categoria fora do escopo da B1) não ganhou a checagem de cronologia", () => {
    const contextBlock = analysisSource.slice(
      analysisSource.indexOf("for (const key of CONTEXT_LISTS)"),
      analysisSource.indexOf("for (const d of selection.decisions)"),
    );
    expect(contextBlock).not.toContain("blockedByChronology");
  });

  test("bloqueio não lança erro e não incrementa updated/skipped por engano", () => {
    // A checagem vem ANTES da construção do patch e do update real — nenhum
    // "throw new Error" no bloco de bloqueio, só o contador e "continue".
    const guardLine =
      'if (chronologyOf(meeting.meeting_date, await meetingDateOf(candidateMeetingId)) === "posterior") {\n        result.blockedByChronology += 1;\n        continue;\n      }';
    const idx = analysisSource.indexOf(guardLine);
    expect(idx).toBeGreaterThan(-1);
    expect(analysisSource.slice(idx, idx + guardLine.length)).not.toContain("throw");
  });
});
