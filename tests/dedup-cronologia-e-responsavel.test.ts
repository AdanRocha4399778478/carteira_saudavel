import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { excludeLaterMeetings, matchAction } from "../src/lib/deduplication";
import type { ActionItem } from "../src/lib/domain";

/* ------------------------------------------------------------------ *
 * R2 + R3 (22/10/2026, decisões do dono do produto, achados do teste da
 * Bandrone 05/06):
 * R2 — a detecção de duplicidade/atualização só compara com itens de
 *      reuniões com data IGUAL OU ANTERIOR à da reunião processada.
 * R3 — mesmo responsável sozinho nunca conta como duplicidade; só reforça
 *      quando a similaridade de texto (antes do bônus) já é >= 0,70
 *      (DEDUPE_THRESHOLDS.review).
 * ------------------------------------------------------------------ */

const action = (description: string, patch: Partial<ActionItem> = {}): ActionItem => ({
  id: patch.id ?? "a1",
  client_id: "c1",
  meeting_id: patch.meeting_id ?? null,
  description,
  owner_name: patch.owner_name ?? null,
  deadline: patch.deadline ?? null,
  priority: patch.priority ?? "média",
  status: patch.status ?? "não iniciada",
  erp_area: null,
  evidence: null,
  created_at: "",
  updated_at: "",
  embedding: null,
});

describe("R2 — excludeLaterMeetings", () => {
  const dates = new Map([
    ["antiga", "2026-06-01"],
    ["mesma", "2026-06-05"],
    ["futura", "2026-06-20"],
  ]);
  const items = [
    { id: 1, meeting_id: "antiga" },
    { id: 2, meeting_id: "mesma" },
    { id: 3, meeting_id: "futura" },
    { id: 4, meeting_id: "sem-data" },
    { id: 5, meeting_id: null },
  ];

  test("exclui só reunião posterior; igual, anterior e sem data continuam candidatos", () => {
    const kept = excludeLaterMeetings(items, "2026-06-05", dates).map((i) => i.id);
    expect(kept).toEqual([1, 2, 4, 5]);
  });

  test("reunião antiga processada nunca enxerga item de reunião posterior", () => {
    const kept = excludeLaterMeetings(items, "2026-06-01", dates).map((i) => i.id);
    expect(kept).toEqual([1, 4, 5]);
  });

  test("sem data da reunião atual, nada é excluído (ausência de dado não bloqueia)", () => {
    expect(excludeLaterMeetings(items, null, dates)).toHaveLength(5);
  });

  test("item posterior excluído deixa de ser candidato: a ação vira NOVA em vez de casar com ele", () => {
    const text = "Enviar proposta comercial revisada ao cliente";
    const candidates = [action(text, { id: "futuro", meeting_id: "futura" })];
    expect(matchAction({ description: text }, candidates).type).not.toBe("NEW");
    const filtered = excludeLaterMeetings(candidates, "2026-06-05", dates);
    expect(matchAction({ description: text }, filtered).type).toBe("NEW");
  });

  test("estático — o diálogo usa excludeLaterMeetings e as listas filtradas nos matchers", () => {
    const dialog = readFileSync(
      resolve(import.meta.dir, "../src/components/painel/MeetingAnalysisDialog.tsx"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(dialog).toContain("excludeLaterMeetings(items, meeting?.meeting_date, meetingDateByMeetingId)");
    for (const list of [
      "dedupeActionsUpToMeeting",
      "dedupeRisksUpToMeeting",
      "dedupeDecisionsUpToMeeting",
      "dedupeOpportunitiesUpToMeeting",
    ]) {
      expect(dialog).toContain(list);
    }
  });
});

describe("R3 — mesmo responsável sozinho não é duplicidade", () => {
  test("texto pouco parecido (~0,67) + mesmo responsável continua NOVO", () => {
    const match = matchAction(
      { description: "Montar planilha de custos", owner_name: "Ana" },
      [action("Montar plano de contas", { owner_name: "Ana" })],
    );
    expect(match.type).toBe("NEW");
  });

  test("o mesmo par com responsáveis diferentes dá o mesmo veredito (responsável não decide)", () => {
    const withOwner = matchAction(
      { description: "Montar planilha de custos", owner_name: "Ana" },
      [action("Montar plano de contas", { owner_name: "Ana" })],
    );
    const withoutOwner = matchAction(
      { description: "Montar planilha de custos", owner_name: "Bia" },
      [action("Montar plano de contas", { owner_name: "Ana" })],
    );
    expect(withOwner.type).toBe(withoutOwner.type);
    expect(withOwner.confidence).toBe(withoutOwner.confidence);
  });

  test("texto já parecido (>= 0,70) + mesmo responsável ainda reforça a evidência", () => {
    const text = "Enviar proposta comercial ao cliente";
    const same = matchAction({ description: text, owner_name: "Ana" }, [
      action("Enviar proposta comercial revisada ao cliente", { owner_name: "Ana" }),
    ]);
    const other = matchAction({ description: text, owner_name: "Bia" }, [
      action("Enviar proposta comercial revisada ao cliente", { owner_name: "Ana" }),
    ]);
    expect(same.type).not.toBe("NEW");
    expect(same.confidence).toBeGreaterThan(other.confidence);
  });
});
