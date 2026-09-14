import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { undoMeeting, undoMeetingInput } from "../src/lib/meeting-undo.server";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const functionsSource = read("src/lib/meeting-undo.functions.ts");
const serverSource = read("src/lib/meeting-undo.server.ts");
const apiSource = read("src/lib/api.ts");

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
