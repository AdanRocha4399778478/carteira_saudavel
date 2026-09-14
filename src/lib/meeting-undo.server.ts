import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logDbError, recalculateClientWithSupabase } from "@/lib/api";
import type { Database } from "@/lib/supabase/types";
import type { RiskRule } from "@/lib/domain";

/* ------------------------------------------------------------------ *
 * DESFAZER REUNIÃO — camada de servidor (GATE 9J)
 *
 * Orquestra, do lado do servidor, o fluxo completo de desfazer uma reunião:
 * chama o RPC `admin_undo_meeting` (transação no Postgres, admin-only,
 * validada pelo próprio banco via RLS/JWT — nada aqui contorna isso) e, só
 * depois de confirmado, recalcula o estado derivado do cliente com o mesmo
 * motor já usado hoje (`recalculateClientWithSupabase`, extraído de
 * src/lib/api.ts).
 *
 * O cliente Supabase usado aqui é sempre o autenticado por request, exposto
 * no context pelo middleware `requireSupabaseAuth`
 * (src/lib/supabase/auth-middleware.ts) — nunca service role. A autorização
 * de admin é responsabilidade do banco (o RPC já rejeita quem não é admin);
 * esta camada não reimplementa nem contorna essa checagem.
 *
 * CONSISTÊNCIA: o RPC de undo é uma transação Postgres — ao retornar,
 * `deleted: true` já é fato consumado e commitado. O recálculo do cliente
 * roda DEPOIS, numa chamada TypeScript separada, fora dessa transação. Não
 * há atomicidade entre as duas etapas: é possível o undo ter sido concluído
 * com sucesso e o recálculo falhar em seguida (rede, RLS, etc.). Essa falha
 * é propagada (nunca engolida) — quem chama esta função sabe que o undo
 * aconteceu mas o recálculo não. `recalculateClientWithSupabase` é
 * idempotente: pode ser chamada de novo depois (retry manual) sem efeito
 * colateral — mas esse retry não é automático nem está implementado em
 * nenhum outro lugar (não acontece sozinho ao reabrir a tela do cliente).
 * Este GATE não implementa retry automático nem fila de compensação —
 * deliberadamente, para não fazer overengineering numa primeira versão.
 * ------------------------------------------------------------------ */

export const undoMeetingInput = z.object({
  meetingId: z.string().uuid("meetingId precisa ser um UUID válido."),
});

export type UndoMeetingInput = z.infer<typeof undoMeetingInput>;

type SupabaseLike = SupabaseClient<Database>;

/** Formato devolvido por `public.admin_undo_meeting` (ver migration 20260914161758). */
type AdminUndoMeetingResult = {
  meeting_id: string;
  client_id: string | null;
  deleted: boolean;
  restored: Record<string, number>;
  deleted_created_items: Record<string, number>;
  context_items: { restored: number; removed: number };
};

export type UndoMeetingResult = {
  meetingId: string;
  clientId: string;
  deleted: true;
  recalculated: true;
  undo: AdminUndoMeetingResult;
};

/**
 * Executa o desfazer completo: RPC de undo -> risk_rules -> recálculo do
 * cliente. Lança em qualquer etapa que falhar; só retorna depois que as três
 * etapas terminaram com sucesso.
 */
export async function undoMeeting(
  supabase: SupabaseLike,
  data: UndoMeetingInput,
): Promise<UndoMeetingResult> {
  const { meetingId } = data;

  const { data: rpcData, error: undoError } = await supabase.rpc("admin_undo_meeting", {
    p_meeting_id: meetingId,
  });

  if (undoError) {
    logDbError("meetings", "admin_undo_meeting", undoError);
    // A mensagem do RPC (`raise exception`) já é pensada para leitura humana
    // (ex.: "Undo bloqueado: ...") — repassamos só ela, nunca code/details/hint.
    throw new Error(`Não foi possível desfazer a reunião: ${undoError.message}`);
  }

  const undo = rpcData as unknown as AdminUndoMeetingResult | null;
  if (!undo || undo.deleted !== true || !undo.client_id) {
    throw new Error(
      "Resposta inesperada de admin_undo_meeting: a reunião não foi confirmada como excluída.",
    );
  }
  const clientId = undo.client_id;

  const rulesRes = await supabase.from("risk_rules").select("*").order("rule_name");
  if (rulesRes.error) {
    logDbError("risk_rules", "select-post-undo", rulesRes.error);
    throw new Error(`Undo concluído, mas falhou ao carregar risk_rules: ${rulesRes.error.message}`);
  }
  const rules = (rulesRes.data as RiskRule[] | null) ?? undefined;

  // Ver nota de consistência no topo do arquivo: a partir daqui o undo já é
  // fato consumado; uma falha neste recálculo é propagada, não silenciada.
  try {
    await recalculateClientWithSupabase(supabase, clientId, rules);
  } catch (recalcError) {
    const reason = recalcError instanceof Error ? recalcError.message : String(recalcError);
    throw new Error(
      `Undo concluído, mas falhou ao recalcular o cliente: ${reason}. A reunião já foi excluída; não repita o undo — corrija a causa do erro e recalcule o cliente manualmente.`,
    );
  }

  return {
    meetingId,
    clientId,
    deleted: true,
    recalculated: true,
    undo,
  };
}
