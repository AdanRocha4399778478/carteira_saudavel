import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const routeSource = read("src/routes/_authenticated/reuniao-inteligente.tsx");
const dialogSource = read("src/components/painel/MeetingAnalysisDialog.tsx");

/* ------------------------------------------------------------------ *
 * Bug real de produção (cliente Bandrone, 3 reuniões órfãs — 0 decisões,
 * 0 ações, satisfação/valor/próxima ação vazios): "Gerar preview de
 * aprovação" gravava a reunião via `get_or_create_smart_meeting` de
 * imediato. Se a aprovação nunca era concluída (consultor fechava o
 * diálogo, ou a chamada de aprovação falhava), a linha ficava para trás —
 * e reprocessar a mesma transcrição caía em "já processada" contra o
 * próprio registro incompleto.
 *
 * Correção: nada é gravado em `meetings`/`decisions`/`actions` enquanto o
 * consultor só gera o preview — a gravação real acontece uma única vez,
 * dentro da aprovação, chamada por `onPersistDraftMeeting`.
 * ------------------------------------------------------------------ */

describe("Persistência adiada da Reunião Inteligente (caso Bandrone)", () => {
  test("createAndReview (Gerar preview) nunca chama get_or_create_smart_meeting — só monta o rascunho em memória", () => {
    const start = routeSource.indexOf("const createAndReview = useMutation({");
    const end = routeSource.indexOf("\n  /**\n   * Chamada pelo diálogo no início da aprovação");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const createAndReviewBody = routeSource.slice(start, end);

    expect(createAndReviewBody).not.toContain("get_or_create_smart_meeting");
    expect(createAndReviewBody).not.toContain('.from("meetings")');
    expect(createAndReviewBody).not.toContain("recalculateClient");

    // Continua idempotente (hash + chave calculados aqui), só que sem gravar.
    expect(createAndReviewBody).toContain("const hash = await transcriptHash(transcript);");
    expect(createAndReviewBody).toContain("transcriptKey: transcriptKey(hash, force),");

    // O que abre o preview é só estado local — nenhum setter grava no banco.
    expect(createAndReviewBody).toContain("setDraftInfo(info);");
    expect(createAndReviewBody).toContain("setMeeting(\n        normalizeMeeting({");
    expect(createAndReviewBody).toContain("setReviewOpen(true);");
  });

  test("get_or_create_smart_meeting só é chamada dentro de persistDraftMeeting, chamada pela aprovação", () => {
    const occurrences = routeSource.split('supabase.rpc("get_or_create_smart_meeting"').length - 1;
    expect(occurrences).toBe(1);
    expect(routeSource).toContain("async function persistDraftMeeting(): Promise<Meeting> {");

    const start = routeSource.indexOf("async function persistDraftMeeting(): Promise<Meeting> {");
    expect(start).toBeGreaterThan(-1);
    const persistBody = routeSource.slice(start, start + 1500);
    expect(persistBody).toContain('supabase.rpc("get_or_create_smart_meeting"');
    // Só aqui a reunião de fato existe no banco — nenhum recalculateClient
    // precoce: `applyApprovedAnalysis` já recalcula ao final da aprovação.
    expect(persistBody).not.toContain("recalculateClient");
  });

  test("recalculateClient não é mais importado nem chamado na rota — só applyApprovedAnalysis chama, ao final da aprovação", () => {
    expect(routeSource).not.toContain("recalculateClient");
  });

  test("onPersistDraftMeeting é passado ao diálogo, ligado a persistDraftMeeting", () => {
    expect(routeSource).toContain("onPersistDraftMeeting={persistDraftMeeting}");
  });

  test("MeetingAnalysisDialog: aprovação grava o rascunho ANTES de aplicar a análise, nunca antes disso", () => {
    expect(dialogSource).toContain(
      "const persistedMeeting = meeting.id ? meeting : await onPersistDraftMeeting?.();",
    );
    expect(dialogSource).toContain(
      'if (!persistedMeeting) throw new Error("Não foi possível gravar a reunião antes de aprovar.");',
    );

    const persistIndex = dialogSource.indexOf(
      "const persistedMeeting = meeting.id ? meeting : await onPersistDraftMeeting?.();",
    );
    const applyIndex = dialogSource.indexOf("const applied = await applyApprovedAnalysis({");
    expect(persistIndex).toBeGreaterThan(-1);
    expect(applyIndex).toBeGreaterThan(persistIndex);

    // applyApprovedAnalysis e saveAnalysisDraft usam a reunião JÁ gravada, não o rascunho.
    expect(dialogSource).toContain("meeting: persistedMeeting,");
    expect(dialogSource).toContain("meetingId: persistedMeeting.id,");
    expect(dialogSource).toContain("clientId: persistedMeeting.client_id,");
  });

  test("onPersistDraftMeeting é opcional — o fluxo antigo (reunião já existente, de $projectId.tsx) continua funcionando sem ele", () => {
    expect(dialogSource).toContain("onPersistDraftMeeting?: () => Promise<Meeting>;");
    // meeting.id verdadeiro (reunião real) nunca chama onPersistDraftMeeting.
    expect(dialogSource).toContain("meeting.id ? meeting :");
  });

  test("saved (meeting_analyses) não é mais consultado com um rascunho sem id — enabled exige meeting?.id real", () => {
    expect(dialogSource).toContain(
      'const saved = useQuery({ ...meetingAnalysisQuery(meeting?.id ?? ""), enabled: open && !!meeting?.id });',
    );
  });
});
