/* ------------------------------------------------------------------ *
 * GATE 11B — exclusão administrativa de projeto: constantes/regras
 * client-safe (sem import de Supabase/zod), mesmo padrão de
 * meeting-undo.shared.ts. Mantém a UI livre de importar runtime de
 * project-delete.server.ts.
 * ------------------------------------------------------------------ */

export const PROJECT_DELETE_CONFIRM_WORD = "EXCLUIR";

/**
 * Regra pura de habilitação do botão destrutivo — nunca habilita se o
 * preview bloqueou (`canDelete` não é `true`), se o texto de confirmação
 * não é exatamente "EXCLUIR", ou enquanto a exclusão está em andamento.
 */
export function canConfirmProjectDelete(params: {
  canDelete: boolean | undefined;
  confirmText: string;
  isPending: boolean;
}): boolean {
  return (
    params.canDelete === true &&
    params.confirmText === PROJECT_DELETE_CONFIRM_WORD &&
    !params.isPending
  );
}
