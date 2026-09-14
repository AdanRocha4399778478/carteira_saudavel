import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  undoMeeting,
  undoMeetingInput,
  previewMeetingUndo,
  parsePreviewAdminUndoMeetingResult,
  isPostUndoFailure,
} from "../src/lib/meeting-undo.server";
import { canConfirmMeetingUndo, UNDO_CONFIRM_WORD } from "../src/components/painel/MeetingUndoDialog";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const functionsSource = read("src/lib/meeting-undo.functions.ts");
const serverSource = read("src/lib/meeting-undo.server.ts");
const sharedSource = read("src/lib/meeting-undo.shared.ts");
const apiSource = read("src/lib/api.ts");
const dialogSource = read("src/components/painel/MeetingUndoDialog.tsx");
const reunioesSource = read("src/routes/_authenticated/reunioes/index.tsx");

/* ------------------------------------------------------------------ *
 * Fake Supabase mínimo, só com o que undoMeeting/recalculateClientWithSupabase
 * de fato usam: rpc(), from(table).select/eq/order/update. Cada `from()`
 * resolve para uma resposta canned por tabela; `.update()` marca a chain
 * para resolver com a resposta de update em vez da de select, já que
 * `recalculateClientWithSupabase` faz um select E um update em "clients".
 * ------------------------------------------------------------------ */

type Resp = { data: unknown; error: { message: string; code?: string } | null };

function fakeSupabase(config: {
  rpc: Resp;
  select?: Record<string, Resp>;
  update?: Record<string, Resp>;
}) {
  const calls: { type: string; table?: string; name?: string; args?: unknown }[] = [];

  function builder(table: string) {
    let isUpdate = false;
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      update: (payload: unknown) => {
        isUpdate = true;
        calls.push({ type: "update", table, args: payload });
        return chain;
      },
      then: (resolve: (r: Resp) => void) => {
        if (!isUpdate) calls.push({ type: "select", table });
        const resp = isUpdate
          ? (config.update?.[table] ?? { data: null, error: null })
          : (config.select?.[table] ?? { data: [], error: null });
        resolve(resp);
      },
    };
    return chain;
  }

  const client = {
    rpc: (name: string, args: unknown) => {
      calls.push({ type: "rpc", name, args });
      return Promise.resolve(config.rpc);
    },
    from: (table: string) => builder(table),
  };

  return { client, calls };
}

const CLIENT_ROW = {
  id: "22222222-2222-2222-2222-222222222222",
  account_status: "ativo",
};

const OK_UNDO_RESULT = {
  meeting_id: "11111111-1111-1111-1111-111111111111",
  client_id: CLIENT_ROW.id,
  deleted: true,
  restored: { actions: 1, risks: 0, opportunities: 0, decisions: 0 },
  deleted_created_items: { actions: 0, risks: 0, opportunities: 0, decisions: 0 },
  context_items: { restored: 0, removed: 0 },
};

function buildOkSupabase() {
  return fakeSupabase({
    rpc: { data: OK_UNDO_RESULT, error: null },
    select: {
      risk_rules: { data: [], error: null },
      meetings: { data: [], error: null },
      actions: { data: [], error: null },
      clients: { data: [CLIENT_ROW], error: null },
    },
    update: {
      clients: { data: null, error: null },
    },
  });
}

describe("GATE 9J — desfazer reunião (servidor)", () => {
  test("meetingId é validado como UUID", () => {
    expect(() => undoMeetingInput.parse({ meetingId: "não-é-uuid" })).toThrow();
    expect(
      undoMeetingInput.parse({ meetingId: "11111111-1111-1111-1111-111111111111" }),
    ).toEqual({ meetingId: "11111111-1111-1111-1111-111111111111" });
  });

  test("exige autenticação via requireSupabaseAuth na camada de servidor", () => {
    expect(functionsSource).toContain('import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware"');
    expect(functionsSource).toContain(".middleware([requireSupabaseAuth])");
    expect(functionsSource).toContain("createServerFn({ method: \"POST\" })");
    expect(functionsSource).toContain(".inputValidator((data) => undoMeetingInput.parse(data))");
    // A camada fina passa o supabase do context adiante — não cria outro cliente.
    expect(functionsSource).toContain("undoMeeting(context.supabase, data)");
  });

  test("nunca usa service role nem cria bypass de RLS", () => {
    // Checa identificadores de uso operacional de service role — não o texto
    // explicativo nos comentários (que legitimamente diz "nunca service role").
    for (const src of [functionsSource, serverSource]) {
      expect(src).not.toContain("supabaseAdmin");
      expect(src).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(src).not.toContain("service_role");
    }
    // O único cliente Supabase usado é o injetado (context.supabase / parâmetro).
    expect(serverSource).not.toMatch(/createClient/);
  });

  test("nunca faz DELETE direto em meetings — depende só do RPC admin_undo_meeting", () => {
    expect(serverSource).not.toMatch(/from\(\s*["']meetings["']\s*\)\s*\.\s*delete/);
    expect(serverSource).toContain('supabase.rpc("admin_undo_meeting"');
  });

  test("recalculateClient existente continua delegando para a versão parametrizada", () => {
    expect(apiSource).toContain(
      "export async function recalculateClient(clientId: string, rules?: RiskRule[]) {\n  return recalculateClientWithSupabase(supabase, clientId, rules);\n}",
    );
    expect(apiSource).toContain("export async function recalculateClientWithSupabase(");
  });

  test("fluxo feliz: chama o RPC, usa o client_id retornado, busca risk_rules e recalcula", async () => {
    const { client, calls } = buildOkSupabase();

    const result = await undoMeeting(client as never, {
      meetingId: "11111111-1111-1111-1111-111111111111",
    });

    expect(result.deleted).toBe(true);
    expect(result.recalculated).toBe(true);
    expect(result.clientId).toBe(CLIENT_ROW.id);
    expect(result.undo).toEqual(OK_UNDO_RESULT);

    // Ordem: rpc -> risk_rules -> (meetings/actions/clients do recálculo).
    const rpcIdx = calls.findIndex((c) => c.type === "rpc");
    const rulesIdx = calls.findIndex((c) => c.table === "risk_rules");
    const clientsUpdateIdx = calls.findIndex((c) => c.type === "update" && c.table === "clients");

    expect(rpcIdx).toBe(0);
    expect(rulesIdx).toBeGreaterThan(rpcIdx);
    expect(clientsUpdateIdx).toBeGreaterThan(rulesIdx);

    const rpcCall = calls[rpcIdx]!;
    expect(rpcCall.name).toBe("admin_undo_meeting");
    expect(rpcCall.args).toEqual({ p_meeting_id: "11111111-1111-1111-1111-111111111111" });

    // O recálculo de fato rodou sobre o client_id devolvido pelo RPC.
    expect(calls.some((c) => c.type === "update" && c.table === "clients")).toBe(true);
  });

  test("erro do RPC de undo impede o recálculo (nada de risk_rules/clients depois)", async () => {
    const { client, calls } = fakeSupabase({
      rpc: { data: null, error: { message: "Undo bloqueado: existe uma aplicação posterior." } },
    });

    await expect(
      undoMeeting(client as never, { meetingId: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toThrow(/Não foi possível desfazer a reunião/);

    expect(calls.some((c) => c.table === "risk_rules")).toBe(false);
    expect(calls.some((c) => c.table === "clients")).toBe(false);
  });

  test("resposta do RPC sem deleted=true ou sem client_id é tratada como falha, sem recalcular", async () => {
    const { client, calls } = fakeSupabase({
      rpc: { data: { ...OK_UNDO_RESULT, deleted: false }, error: null },
    });

    await expect(
      undoMeeting(client as never, { meetingId: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toThrow();

    expect(calls.some((c) => c.table === "risk_rules")).toBe(false);
  });

  test("erro ao buscar risk_rules depois do undo não é silenciado — propaga e não recalcula", async () => {
    const { client, calls } = fakeSupabase({
      rpc: { data: OK_UNDO_RESULT, error: null },
      select: {
        risk_rules: { data: null, error: { message: "conexão perdida" } },
      },
    });

    await expect(
      undoMeeting(client as never, { meetingId: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toThrow(/risk_rules/);

    expect(calls.some((c) => c.type === "update" && c.table === "clients")).toBe(false);
  });

  test("falha no recálculo pós-undo é propagada com mensagem inequívoca e sem repetir o RPC", async () => {
    const { client, calls } = fakeSupabase({
      rpc: { data: OK_UNDO_RESULT, error: null },
      select: {
        risk_rules: { data: [], error: null },
        meetings: { data: [], error: null },
        actions: { data: [], error: null },
        clients: { data: [CLIENT_ROW], error: null },
      },
      update: {
        clients: { data: null, error: { message: "conexão perdida" } },
      },
    });

    await expect(
      undoMeeting(client as never, { meetingId: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toThrow(/Undo concluído, mas falhou ao recalcular o cliente.*não repita o undo/);

    // O RPC de undo foi chamado uma única vez — nada tenta desfazer de novo.
    expect(calls.filter((c) => c.type === "rpc").length).toBe(1);
  });

  test("documenta explicitamente a falta de atomicidade entre o RPC e o recálculo", () => {
    expect(serverSource).toContain(
      "Não\n * há atomicidade entre as duas etapas: é possível o undo ter sido concluído",
    );
    expect(serverSource).toContain("é propagada (nunca engolida)");
    expect(serverSource).toContain("idempotente: pode ser chamada de novo depois");
    // O retry é manual — o comentário não pode mais afirmar que reabrir a
    // tela do cliente executa o recálculo sozinho (isso não é implementado).
    expect(serverSource).toContain("não acontece sozinho ao reabrir a tela do cliente");
    expect(serverSource).toContain("Este GATE não implementa retry automático nem fila de compensação");
  });
});

const OK_PREVIEW_RESULT = {
  meeting_id: "11111111-1111-1111-1111-111111111111",
  project_id: "33333333-3333-3333-3333-333333333333",
  client_id: CLIENT_ROW.id,
  applied: true,
  allowed: true,
  blocking_reason: null,
  entities: {
    actions: { created: 2, updated: 0 },
    risks: { created: 0, updated: 1 },
    opportunities: { created: 0, updated: 0 },
    decisions: { created: 1, updated: 0 },
  },
  context_items_affected: 3,
  has_later_application: false,
  has_multiple_applications: false,
  entity_changed_after: false,
  context_changed_after: false,
};

describe("GATE 9K — prévia e UI de desfazer reunião", () => {
  test("previewAdminUndoMeeting é uma server function autenticada, separada do undo", () => {
    expect(functionsSource).toContain(
      'import { undoMeetingInput, undoMeeting, previewMeetingUndo } from "@/lib/meeting-undo.server"',
    );
    expect(functionsSource).toContain("export const previewAdminUndoMeeting = createServerFn");
    // Usa o mesmo middleware e o mesmo schema de input que o undo real.
    const previewBlock = functionsSource.slice(functionsSource.indexOf("previewAdminUndoMeeting"));
    expect(previewBlock).toContain(".middleware([requireSupabaseAuth])");
    expect(previewBlock).toContain(".inputValidator((data) => undoMeetingInput.parse(data))");
    expect(previewBlock).toContain("previewMeetingUndo(context.supabase, data)");
  });

  test("preview chama preview_admin_undo_meeting (nunca admin_undo_meeting) e nunca escreve nada", async () => {
    const { client, calls } = fakeSupabase({ rpc: { data: OK_PREVIEW_RESULT, error: null } });

    const result = await previewMeetingUndo(client as never, {
      meetingId: "11111111-1111-1111-1111-111111111111",
    });

    expect(result.allowed).toBe(true);
    expect(result.entities.actions).toEqual({ created: 2, updated: 0 });
    expect(calls).toEqual([
      {
        type: "rpc",
        name: "preview_admin_undo_meeting",
        args: { p_meeting_id: "11111111-1111-1111-1111-111111111111" },
      },
    ]);
    // Nenhuma chamada de update/select em nenhuma tabela — só o RPC de leitura.
    expect(calls.some((c) => c.type === "update" || c.type === "select")).toBe(false);
  });

  test("erro do RPC de preview é propagado com mensagem clara", async () => {
    const { client } = fakeSupabase({
      rpc: { data: null, error: { message: "função indisponível" } },
    });

    await expect(
      previewMeetingUndo(client as never, { meetingId: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toThrow(/Não foi possível carregar a prévia do desfazer/);
  });

  test("valida o formato do RPC de preview — rejeita respostas malformadas", () => {
    expect(() => parsePreviewAdminUndoMeetingResult(null)).toThrow();
    expect(() => parsePreviewAdminUndoMeetingResult({})).toThrow();
    expect(() =>
      parsePreviewAdminUndoMeetingResult({ ...OK_PREVIEW_RESULT, allowed: "sim" }),
    ).toThrow();
    expect(() =>
      parsePreviewAdminUndoMeetingResult({
        ...OK_PREVIEW_RESULT,
        entities: { ...OK_PREVIEW_RESULT.entities, actions: { created: "2" } },
      }),
    ).toThrow();

    const parsed = parsePreviewAdminUndoMeetingResult(OK_PREVIEW_RESULT);
    expect(parsed).toEqual(OK_PREVIEW_RESULT);
  });

  test("preview bloqueado (allowed=false) nunca habilita a confirmação, mesmo com EXCLUIR digitado", () => {
    expect(
      canConfirmMeetingUndo({
        blockedAfterUndo: false,
        allowed: false,
        confirmText: UNDO_CONFIRM_WORD,
        isPending: false,
      }),
    ).toBe(false);
  });

  test("confirmação exige o texto EXCLUIR exato — qualquer outra coisa mantém desabilitado", () => {
    const base = { blockedAfterUndo: false, allowed: true, isPending: false };
    expect(canConfirmMeetingUndo({ ...base, confirmText: "" })).toBe(false);
    expect(canConfirmMeetingUndo({ ...base, confirmText: "excluir" })).toBe(false);
    expect(canConfirmMeetingUndo({ ...base, confirmText: "EXCLUIR " })).toBe(false);
    expect(canConfirmMeetingUndo({ ...base, confirmText: "EXCLUIR" })).toBe(true);
  });

  test("undo em andamento (isPending) desabilita nova confirmação", () => {
    expect(
      canConfirmMeetingUndo({
        blockedAfterUndo: false,
        allowed: true,
        confirmText: UNDO_CONFIRM_WORD,
        isPending: true,
      }),
    ).toBe(false);
  });

  test("erro pós-undo/recálculo (isPostUndoFailure) nunca permite confirmar de novo", () => {
    // A mesma mensagem que o servidor lança quando o undo já ocorreu e só o
    // recálculo falhou é a que o diálogo usa para bloquear novo confirm.
    expect(isPostUndoFailure("Undo concluído, mas falhou ao recalcular o cliente: X")).toBe(true);
    expect(isPostUndoFailure("Não foi possível desfazer a reunião: bloqueado")).toBe(false);

    expect(
      canConfirmMeetingUndo({
        blockedAfterUndo: true,
        allowed: true,
        confirmText: UNDO_CONFIRM_WORD,
        isPending: false,
      }),
    ).toBe(false);
  });

  test("diálogo nunca faz DELETE direto nem usa service role", () => {
    expect(dialogSource).not.toMatch(/\.delete\s*\(/);
    expect(dialogSource).not.toContain("supabaseAdmin");
    expect(dialogSource).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(dialogSource).not.toContain("service_role");
    // O diálogo não importa o cliente Supabase do frontend — só as server
    // functions, que já usam o cliente autenticado por request.
    expect(dialogSource).not.toMatch(/from ["']@\/lib\/supabase\/client["']/);
  });

  test("undo só é chamado a partir do clique de confirmação, nunca no carregamento do preview", () => {
    // O undo vive dentro do useMutation (disparado só por undo.mutate() no
    // onClick do botão destrutivo); o preview vive num useQuery separado.
    expect(dialogSource).toContain("mutationFn: async () => undoFn({ data: { meetingId: meeting.id } })");
    expect(dialogSource).toContain("onClick={() => undo.mutate()}");
    expect(dialogSource).toContain("queryFn: async (): Promise<PreviewAdminUndoMeetingResult> =>");
    // O preview roda automaticamente ao abrir (enabled: open); o undo não tem enabled automático.
    expect(dialogSource).toContain("enabled: open,");
  });

  test("sucesso do undo invalida meetings, clients, actions, risks e opportunities", () => {
    expect(dialogSource).toContain(
      'export const MEETING_UNDO_INVALIDATED_QUERY_KEYS = [\n  ["meetings"],\n  ["clients"],\n  ["actions"],\n  ["risks"],\n  ["opportunities"],\n] as const;',
    );
    expect(dialogSource).toContain("for (const key of MEETING_UNDO_INVALIDATED_QUERY_KEYS)");
    expect(dialogSource).toContain("queryClient.invalidateQueries({ queryKey: key })");
  });

  test("botão de desfazer só é renderizado (e o diálogo só é montado) quando isAdmin", () => {
    expect(reunioesSource).toContain('import { useAccess } from "@/lib/auth/access"');
    expect(reunioesSource).toContain("const { isAdmin } = useAccess();");
    // O gatilho do botão e o próprio <MeetingUndoDialog> ficam atrás de isAdmin.
    const cardBody = reunioesSource.slice(reunioesSource.indexOf("function MeetingCard"));
    expect(cardBody).toContain("{isAdmin ? (\n            <Button");
    expect(cardBody).toContain("{isAdmin ? (\n        <MeetingUndoDialog");
  });

  test("botão icon-only de desfazer tem aria-label além do title", () => {
    const cardBody = reunioesSource.slice(reunioesSource.indexOf("function MeetingCard"));
    const buttonBlock = cardBody.slice(cardBody.indexOf("<Button"), cardBody.indexOf("</Button>"));
    expect(buttonBlock).toContain('title="Desfazer reunião"');
    expect(buttonBlock).toContain('aria-label="Desfazer reunião"');
  });

  test("meeting-undo.shared.ts é client-safe — sem Supabase, zod ou api.ts", () => {
    expect(sharedSource).not.toMatch(/from ["']@supabase\/supabase-js["']/);
    expect(sharedSource).not.toMatch(/from ["']zod["']/);
    expect(sharedSource).not.toMatch(/from ["']@\/lib\/api["']/);
    expect(sharedSource).not.toContain("supabase.rpc");
    expect(sharedSource).toContain("export const POST_UNDO_FAILURE_PREFIX");
    expect(sharedSource).toContain("export function isPostUndoFailure(");
  });

  test("meeting-undo.server.ts reexporta (não redefine) o prefixo/checagem compartilhados", () => {
    expect(serverSource).toContain(
      'import { POST_UNDO_FAILURE_PREFIX, isPostUndoFailure } from "@/lib/meeting-undo.shared"',
    );
    expect(serverSource).toContain("export { POST_UNDO_FAILURE_PREFIX, isPostUndoFailure };");
    // A definição de fato só existe uma vez, no módulo compartilhado.
    expect(serverSource).not.toContain('export const POST_UNDO_FAILURE_PREFIX = "Undo concluído, mas"');
  });

  test("o diálogo (componente cliente) não tem import runtime de meeting-undo.server.ts — só import type", () => {
    expect(dialogSource).toContain('import { isPostUndoFailure } from "@/lib/meeting-undo.shared"');
    expect(dialogSource).toContain(
      'import type { PreviewAdminUndoMeetingResult } from "@/lib/meeting-undo.server"',
    );
    // Nenhuma outra linha de import referencia meeting-undo.server.ts fora do "import type" acima.
    const serverImportLines = dialogSource
      .split("\n")
      .filter((line) => line.includes('"@/lib/meeting-undo.server"'));
    expect(serverImportLines).toEqual([
      'import type { PreviewAdminUndoMeetingResult } from "@/lib/meeting-undo.server";',
    ]);
  });

  test("o diálogo mostra o nome do projeto (nunca o UUID), reaproveitando projectQuery existente", () => {
    expect(dialogSource).toContain('import { projectQuery } from "@/lib/projects"');
    expect(dialogSource).toContain("...projectQuery(impact?.project_id ?? \"\")");
    expect(dialogSource).toContain('<Row label="Projeto" value={projectLabel} />');
    // Nunca interpola o project_id cru na tela — só o nome resolvido ou um rótulo textual.
    expect(dialogSource).not.toMatch(/value=\{impact\.project_id\}/);
    expect(dialogSource).not.toMatch(/\{impact\?\.project_id\}/);
  });
});
