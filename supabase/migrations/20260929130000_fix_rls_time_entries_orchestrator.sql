-- =============================================================================
-- Corrige RLS aberto em 2 tabelas que ficaram fora do escopo do #53
-- (auditoria via pg_policies em produção, 2026-09-29):
--
-- 1. `orchestrator_recommendations` — SELECT e UPDATE tinham `qual = true`
--    em produção. Isso É drift, do mesmo tipo do #53: a migration original
--    (`20260813220000_orchestrator_recommendations.sql`) e o
--    endurecimento posterior (`20260817125000_direct_orchestrator_status_updates.sql`)
--    já escopavam as duas por `can_access_scope`/ownership — produção só
--    não refletia isso. O `with_check` do UPDATE em produção preservava a
--    lógica de transição de status, mas sem a cláusula de ownership/escopo
--    que a migration exige — ou seja, dava para aprovar/rejeitar/marcar
--    como executada uma recomendação de qualquer cliente, mesmo sem
--    permissão sobre ele, desde que a transição final fosse válida. Este
--    arquivo só recria, tal qual, as policies que as migrations acima já
--    definiam — não muda a lógica de transição de status.
--
-- 2. `time_entries` — SELECT/INSERT/UPDATE com `qual`/`with_check = true`
--    são o design ORIGINAL commitado em
--    `20260926000000_create_time_entries.sql`, não drift (dev, que nasce
--    só de migrations, tem exatamente o mesmo `true`). Diferente do caso
--    acima, aqui é a própria migration que precisa mudar — qualquer
--    consultor autenticado lê, cria e altera horas de qualquer cliente,
--    inclusive de outros consultores. Corrigido para o mesmo padrão de
--    escopo por cliente/projeto usado nas 15 tabelas do #53.
--
-- `profile_directory` (leitura ampla) fica de fora deliberadamente — é
-- decisão de produto, não bug, e não é tocado aqui.
-- =============================================================================

BEGIN;

-- ---------- orchestrator_recommendations ----------
-- Restaura exatamente o que 20260817125000_direct_orchestrator_status_updates.sql
-- já definia para UPDATE, e o que 20260813220000_orchestrator_recommendations.sql
-- já definia para SELECT — nenhuma regra nova.
DROP POLICY IF EXISTS orchestrator_recommendations_select ON public.orchestrator_recommendations;
DROP POLICY IF EXISTS orchestrator_recommendations_update ON public.orchestrator_recommendations;

CREATE POLICY orchestrator_recommendations_select
  ON public.orchestrator_recommendations FOR SELECT TO authenticated
  USING (app_private.can_access_scope(client_id, project_id, NULL));

CREATE POLICY orchestrator_recommendations_update
  ON public.orchestrator_recommendations FOR UPDATE TO authenticated
  USING (app_private.is_admin() OR owner_id = auth.uid())
  WITH CHECK (
    (app_private.is_admin() OR owner_id = auth.uid())
    AND app_private.can_access_scope(client_id, project_id, NULL)
    AND (
      (status = 'approved' AND approved_by = auth.uid() AND approved_at IS NOT NULL)
      OR (
        status IN ('rejected', 'executed', 'superseded')
        AND (status = 'executed' OR (approved_by IS NULL AND approved_at IS NULL))
      )
    )
  );

-- ---------- time_entries ----------
-- Sem meeting_id nesta tabela — escopo por cliente/projeto, mesmo padrão
-- das 15 tabelas do #53.
DROP POLICY IF EXISTS "time_entries insert" ON public.time_entries;
DROP POLICY IF EXISTS "time_entries update" ON public.time_entries;
DROP POLICY IF EXISTS "time_entries visible" ON public.time_entries;

CREATE POLICY "time_entries visible" ON public.time_entries FOR SELECT TO authenticated
USING (app_private.can_access_scope(client_id, project_id, NULL));
CREATE POLICY "time_entries insert" ON public.time_entries FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_scope(client_id, project_id, NULL));
CREATE POLICY "time_entries update" ON public.time_entries FOR UPDATE TO authenticated
USING (app_private.can_access_scope(client_id, project_id, NULL))
WITH CHECK (app_private.can_access_scope(client_id, project_id, NULL));

COMMIT;
