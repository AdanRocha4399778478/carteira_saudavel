-- =============================================================================
-- Achado 1 (auditoria de replay completo do dev, 2026-09-29, depois de
-- aplicar #53/#59/#60/#61/#62 em sequência): a policy de INSERT de
-- `orchestrator_recommendations` em PRODUÇÃO está sem as cláusulas de
-- escopo (`can_access_scope`) e ownership (`is_admin() OR owner_id`) que a
-- própria migration `20260819032900_fix_orchestrator_admin_insert.sql` já
-- definia — e que o projeto de dev (nascido só das migrations) já tinha
-- corretamente. Isso nunca foi tocado por #53 nem #60, que só corrigiram
-- SELECT/UPDATE desta tabela.
--
-- Efeito real em produção antes desta correção: qualquer consultor
-- autenticado podia inserir uma recomendação do orquestrador vinculada a um
-- cliente/projeto que não é dele, bastando `created_by = auth.uid()`,
-- `status = 'suggested'` e os campos de aprovação nulos — sem checagem
-- nenhuma de que ele tem acesso àquele cliente/projeto.
--
-- Correção (fix forward, mesmo padrão do #60/#62): reaplica, tal qual, o
-- with_check completo que `20260819032900_fix_orchestrator_admin_insert.sql`
-- já definia.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS orchestrator_recommendations_insert
  ON public.orchestrator_recommendations;

CREATE POLICY orchestrator_recommendations_insert
  ON public.orchestrator_recommendations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    app_private.can_access_scope(client_id, project_id, NULL)
    AND (
      app_private.is_admin()
      OR owner_id = auth.uid()
    )
    AND created_by = auth.uid()
    AND status = 'suggested'
    AND approved_at IS NULL
    AND approved_by IS NULL
  );

COMMIT;
