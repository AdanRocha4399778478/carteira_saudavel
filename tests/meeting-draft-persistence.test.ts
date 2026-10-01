import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const routeSource = read("src/routes/_authenticated/reuniao-inteligente.tsx");
const dialogSource = read("src/components/painel/MeetingAnalysisDialog.tsx");
const analysisLibSource = read("src/lib/meeting-analysis.ts");

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

/* ------------------------------------------------------------------ *
 * Regressão real de produção pós-#57: "Analisar reunião" (passo 2) chama
 * saveAnalysisDraft com `meeting.id` do rascunho em memória — que é "" até
 * a aprovação persistir a reunião de verdade. A leitura de `meeting_analyses`
 * (useQuery `saved`) já era guardada (teste acima), mas a ESCRITA dentro de
 * saveAnalysisDraft não era: `.eq("meeting_id", "")` quebrava no Postgres com
 * "invalid input syntax for type uuid" em qualquer reunião nova, bloqueando
 * o preview para todo cliente. Corrigido com um early return antes de
 * qualquer chamada ao Supabase.
 * ------------------------------------------------------------------ */
describe("saveAnalysisDraft não consulta nem grava meeting_analyses sem meeting_id real", () => {
  test("early return antes do primeiro .from(\"meeting_analyses\") quando meetingId está vazio", () => {
    const fnStart = analysisLibSource.indexOf("export async function saveAnalysisDraft(params: {");
    const guardIndex = analysisLibSource.indexOf("if (!params.meetingId) return null;", fnStart);
    const firstQueryIndex = analysisLibSource.indexOf('.from("meeting_analyses")', fnStart);

    expect(fnStart).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(fnStart);
    expect(firstQueryIndex).toBeGreaterThan(guardIndex);
  });

  test("os dois pontos de chamada (análise em preview e aprovação) continuam passando meetingId sem guarda própria — dependem só da guarda dentro da função", () => {
    expect(dialogSource).toContain("meetingId: meeting.id,");
    expect(dialogSource).toContain("meetingId: persistedMeeting.id,");
  });
});

/* ------------------------------------------------------------------ *
 * Regressão real de produção (Grupo Erinho): reunião aprovada → reabrir o
 * diálogo → clicar "Analisar reunião" de novo (sem reaprovar) → o
 * UPDATE de saveAnalysisDraft gravava status: "aguardando_revisao" sem
 * approved_at/approved_by no payload (só entram quando status === "aprovada")
 * — o Supabase deixa colunas ausentes do payload intactas, então
 * approved_at/approved_by antigos sobreviviam enquanto o status regredia.
 * Resultado real encontrado no banco: meeting_analyses com
 * status="aguardando_revisao" e approved_at preenchido.
 *
 * Corrigido em duas camadas: (1) saveAnalysisDraft nunca rebaixa o status de
 * uma linha já aprovada — é um no-op; (2) o diálogo trava "Analisar reunião"
 * e "Aprovar e atualizar projeto" assim que `saved.data?.status === "aprovada"`,
 * independente do estado local da sessão — reunião aprovada abre em modo
 * leitura mesmo depois de fechar e reabrir.
 * ------------------------------------------------------------------ */
describe("Aprovação é definitiva — reanalisar depois nunca rebaixa status nem reabre para edição", () => {
  test("saveAnalysisDraft: no-op (early return) antes de montar o payload quando a linha já está aprovada e o novo status não é 'aprovada'", () => {
    const fnStart = analysisLibSource.indexOf("export async function saveAnalysisDraft(params: {");
    const guardIndex = analysisLibSource.indexOf(
      'if (existingRow?.status === "aprovada" && params.status !== "aprovada") return null;',
      fnStart,
    );
    const payloadIndex = analysisLibSource.indexOf("const payload = {", fnStart);

    expect(fnStart).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(fnStart);
    expect(payloadIndex).toBeGreaterThan(guardIndex);

    // A guarda só funciona se o SELECT que a alimenta já buscar o status.
    const selectIndex = analysisLibSource.indexOf('.select("id, status")', fnStart);
    expect(selectIndex).toBeGreaterThan(fnStart);
    expect(guardIndex).toBeGreaterThan(selectIndex);
  });

  test("MeetingAnalysisDialog: isApproved vem de saved.data?.status, não do estado local da sessão", () => {
    expect(dialogSource).toContain('const isApproved = saved.data?.status === "aprovada";');
  });

  test("análise de novo numa reunião aprovada é bloqueada tanto na mutation quanto no botão", () => {
    const analyzeStart = dialogSource.indexOf("const analyze = useMutation({");
    const analyzeGuard = dialogSource.indexOf(
      'if (isApproved) throw new Error("Esta reunião já foi aprovada — não é possível reanalisar.");',
      analyzeStart,
    );
    expect(analyzeStart).toBeGreaterThan(-1);
    expect(analyzeGuard).toBeGreaterThan(analyzeStart);

    expect(dialogSource).toContain("disabled={analyze.isPending || !meeting || isApproved}");
  });

  test("aprovar de novo uma reunião já aprovada é bloqueado tanto na mutation quanto no botão", () => {
    const approveStart = dialogSource.indexOf("const approve = useMutation({");
    const approveGuard = dialogSource.indexOf(
      'if (isApproved) throw new Error("Esta reunião já foi aprovada — não é possível aprovar de novo.");',
      approveStart,
    );
    expect(approveStart).toBeGreaterThan(-1);
    expect(approveGuard).toBeGreaterThan(approveStart);

    expect(dialogSource).toContain(
      "disabled={approve.isPending || approved || isApproved || overallCounts.reviewCount > 0}",
    );
  });
});
