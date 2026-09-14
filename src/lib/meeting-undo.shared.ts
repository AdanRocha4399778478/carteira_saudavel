/**
 * Constantes e funções puras do fluxo de desfazer reunião que precisam ser
 * lidas tanto pelo servidor (`meeting-undo.server.ts`) quanto por
 * componentes cliente (`MeetingUndoDialog.tsx`). Client-safe por
 * construção: nenhum import de Supabase, zod ou de `src/lib/api.ts` — só
 * isso evita que um componente cliente precise importar `meeting-undo.server.ts`
 * (que carrega esse runtime de servidor) só para checar uma mensagem de erro.
 */

/**
 * Prefixo usado em todo erro de `undoMeeting` lançado depois que o RPC de
 * undo já foi confirmado (falha ao carregar risk_rules ou ao recalcular).
 * A UI usa isso para nunca oferecer "tentar de novo" nesses casos — a
 * reunião já foi excluída, repetir chamaria admin_undo_meeting sobre um
 * registro que não existe mais.
 */
export const POST_UNDO_FAILURE_PREFIX = "Undo concluído, mas";

export function isPostUndoFailure(message: string): boolean {
  return message.startsWith(POST_UNDO_FAILURE_PREFIX);
}
