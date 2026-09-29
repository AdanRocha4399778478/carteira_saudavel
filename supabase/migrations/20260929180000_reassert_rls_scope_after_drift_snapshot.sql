-- =============================================================================
-- Corrige uma armadilha de ORDEM DE REPLAY entre duas migrations já
-- mergeadas: `20260928235900_document_production_rls_drift_asis.sql` (#59)
-- tem timestamp DEPOIS de `20260928120000_fix_rls_scope_drift.sql` (#53),
-- mas o conteúdo de #59 é justamente o snapshot do estado INSEGURO
-- (`USING (true)`/`WITH CHECK (true)`) que existia ANTES de #53 corrigir —
-- ele foi escrito só como documentação/rollback de referência, nunca para
-- rodar depois da correção.
--
-- Em produção isso nunca foi um problema: #59 foi aplicado primeiro (no-op,
-- já batia com o estado real) e #53 depois (a correção de verdade), na
-- ordem certa, manualmente. Mas qualquer replay em ORDEM DE ARQUIVO — banco
-- de dev reconstruído do zero, ou um Preview novo criado a partir do
-- repositório — aplicaria #53 e, na sequência, #59 por cima dele,
-- reabrindo as 15 tabelas com `USING (true)` silenciosamente. #60 (dia
-- seguinte) só corrige 2 tabelas diferentes (`time_entries`,
-- `orchestrator_recommendations`) — não cobre esta lacuna.
--
-- Correção (fix forward, sem editar #53/#59 — mesmo padrão do #60): este
-- arquivo reaplica, tal qual, as MESMAS 15 policies escopadas de #53.
-- Timestamp depois de tudo que já existe (#51 a #61), garantindo que a
-- ÚLTIMA migration a tocar estas 15 tabelas, em qualquer replay por ordem
-- de arquivo, seja sempre a versão segura — independente de #53 vir antes
-- ou depois de #59 no calendário.
-- =============================================================================

BEGIN;

-- ---------- actions ----------
DROP POLICY IF EXISTS "actions insert" ON public.actions;
DROP POLICY IF EXISTS "actions update" ON public.actions;
DROP POLICY IF EXISTS "actions visible" ON public.actions;
CREATE POLICY "actions visible" ON public.actions FOR SELECT TO authenticated
USING (app_private.can_access_scope(client_id, NULL, meeting_id));
CREATE POLICY "actions insert" ON public.actions FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_scope(client_id, NULL, meeting_id));
CREATE POLICY "actions update" ON public.actions FOR UPDATE TO authenticated
USING (app_private.can_access_scope(client_id, NULL, meeting_id))
WITH CHECK (app_private.can_access_scope(client_id, NULL, meeting_id));

-- ---------- analysis_applications ----------
DROP POLICY IF EXISTS "analysis_applications insert" ON public.analysis_applications;
DROP POLICY IF EXISTS "analysis_applications update" ON public.analysis_applications;
DROP POLICY IF EXISTS "analysis_applications visible" ON public.analysis_applications;
CREATE POLICY "analysis_applications visible" ON public.analysis_applications FOR SELECT TO authenticated
USING (app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL));
CREATE POLICY "analysis_applications insert" ON public.analysis_applications FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL));
CREATE POLICY "analysis_applications update" ON public.analysis_applications FOR UPDATE TO authenticated
USING (app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL))
WITH CHECK (app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL));

-- ---------- clients ----------
DROP POLICY IF EXISTS "clients insert" ON public.clients;
DROP POLICY IF EXISTS "clients update" ON public.clients;
DROP POLICY IF EXISTS "clients visible" ON public.clients;
CREATE POLICY "clients visible" ON public.clients FOR SELECT TO authenticated
USING (app_private.is_admin() OR consultant_id = auth.uid());
CREATE POLICY "clients insert" ON public.clients FOR INSERT TO authenticated
WITH CHECK (app_private.is_admin() OR consultant_id = auth.uid());
CREATE POLICY "clients update" ON public.clients FOR UPDATE TO authenticated
USING (app_private.is_admin() OR consultant_id = auth.uid())
WITH CHECK (app_private.is_admin() OR consultant_id = auth.uid());

-- ---------- decisions ----------
DROP POLICY IF EXISTS "decisions insert" ON public.decisions;
DROP POLICY IF EXISTS "decisions update" ON public.decisions;
DROP POLICY IF EXISTS "decisions visible" ON public.decisions;
CREATE POLICY "decisions visible" ON public.decisions FOR SELECT TO authenticated
USING (app_private.can_access_scope(client_id, project_id, meeting_id));
CREATE POLICY "decisions insert" ON public.decisions FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_scope(client_id, project_id, meeting_id));
CREATE POLICY "decisions update" ON public.decisions FOR UPDATE TO authenticated
USING (app_private.can_access_scope(client_id, project_id, meeting_id))
WITH CHECK (app_private.can_access_scope(client_id, project_id, meeting_id));

-- ---------- entity_mentions ----------
DROP POLICY IF EXISTS "entity_mentions insert" ON public.entity_mentions;
DROP POLICY IF EXISTS "entity_mentions update" ON public.entity_mentions;
DROP POLICY IF EXISTS "entity_mentions visible" ON public.entity_mentions;
CREATE POLICY "entity_mentions visible" ON public.entity_mentions FOR SELECT TO authenticated
USING (app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL));
CREATE POLICY "entity_mentions insert" ON public.entity_mentions FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL));
CREATE POLICY "entity_mentions update" ON public.entity_mentions FOR UPDATE TO authenticated
USING (app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL))
WITH CHECK (app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL));

-- ---------- meeting_analyses ----------
DROP POLICY IF EXISTS "meeting_analyses insert" ON public.meeting_analyses;
DROP POLICY IF EXISTS "meeting_analyses update" ON public.meeting_analyses;
DROP POLICY IF EXISTS "meeting_analyses visible" ON public.meeting_analyses;
CREATE POLICY "meeting_analyses visible" ON public.meeting_analyses FOR SELECT TO authenticated
USING (app_private.can_access_scope(client_id, project_id, meeting_id));
CREATE POLICY "meeting_analyses insert" ON public.meeting_analyses FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_scope(client_id, project_id, meeting_id));
CREATE POLICY "meeting_analyses update" ON public.meeting_analyses FOR UPDATE TO authenticated
USING (app_private.can_access_scope(client_id, project_id, meeting_id))
WITH CHECK (app_private.can_access_scope(client_id, project_id, meeting_id));

-- ---------- meeting_evolution ----------
DROP POLICY IF EXISTS "meeting_evolution insert" ON public.meeting_evolution;
DROP POLICY IF EXISTS "meeting_evolution update" ON public.meeting_evolution;
DROP POLICY IF EXISTS "meeting_evolution visible" ON public.meeting_evolution;
CREATE POLICY "meeting_evolution visible" ON public.meeting_evolution FOR SELECT TO authenticated
USING (
  app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL)
  AND (previous_meeting_id IS NULL OR app_private.can_access_scope(client_id, project_id, previous_meeting_id))
);
CREATE POLICY "meeting_evolution insert" ON public.meeting_evolution FOR INSERT TO authenticated
WITH CHECK (
  app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL)
  AND (previous_meeting_id IS NULL OR app_private.can_access_scope(client_id, project_id, previous_meeting_id))
);
CREATE POLICY "meeting_evolution update" ON public.meeting_evolution FOR UPDATE TO authenticated
USING (
  app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL)
  AND (previous_meeting_id IS NULL OR app_private.can_access_scope(client_id, project_id, previous_meeting_id))
)
WITH CHECK (
  app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL)
  AND (previous_meeting_id IS NULL OR app_private.can_access_scope(client_id, project_id, previous_meeting_id))
);

-- ---------- meeting_evolution_items ----------
DROP POLICY IF EXISTS "meeting_evolution_items insert" ON public.meeting_evolution_items;
DROP POLICY IF EXISTS "meeting_evolution_items update" ON public.meeting_evolution_items;
DROP POLICY IF EXISTS "meeting_evolution_items visible" ON public.meeting_evolution_items;
CREATE POLICY "meeting_evolution_items visible" ON public.meeting_evolution_items FOR SELECT TO authenticated
USING (app_private.can_access_related_scope(client_id, project_id, meeting_id, NULL, evolution_id));
CREATE POLICY "meeting_evolution_items insert" ON public.meeting_evolution_items FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_related_scope(client_id, project_id, meeting_id, NULL, evolution_id));
CREATE POLICY "meeting_evolution_items update" ON public.meeting_evolution_items FOR UPDATE TO authenticated
USING (app_private.can_access_related_scope(client_id, project_id, meeting_id, NULL, evolution_id))
WITH CHECK (app_private.can_access_related_scope(client_id, project_id, meeting_id, NULL, evolution_id));

-- ---------- meetings ----------
DROP POLICY IF EXISTS "meetings insert" ON public.meetings;
DROP POLICY IF EXISTS "meetings update" ON public.meetings;
DROP POLICY IF EXISTS "meetings visible" ON public.meetings;
CREATE POLICY "meetings visible" ON public.meetings FOR SELECT TO authenticated
USING (app_private.can_access_scope(client_id, project_id, NULL));
CREATE POLICY "meetings insert" ON public.meetings FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_scope(client_id, project_id, NULL));
CREATE POLICY "meetings update" ON public.meetings FOR UPDATE TO authenticated
USING (app_private.can_access_scope(client_id, project_id, NULL))
WITH CHECK (app_private.can_access_scope(client_id, project_id, NULL));

-- ---------- opportunities ----------
DROP POLICY IF EXISTS "opportunities insert" ON public.opportunities;
DROP POLICY IF EXISTS "opportunities update" ON public.opportunities;
DROP POLICY IF EXISTS "opportunities visible" ON public.opportunities;
CREATE POLICY "opportunities visible" ON public.opportunities FOR SELECT TO authenticated
USING (app_private.can_access_scope(client_id, NULL, meeting_id));
CREATE POLICY "opportunities insert" ON public.opportunities FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_scope(client_id, NULL, meeting_id));
CREATE POLICY "opportunities update" ON public.opportunities FOR UPDATE TO authenticated
USING (app_private.can_access_scope(client_id, NULL, meeting_id))
WITH CHECK (app_private.can_access_scope(client_id, NULL, meeting_id));

-- ---------- project_context ----------
DROP POLICY IF EXISTS "project_context insert" ON public.project_context;
DROP POLICY IF EXISTS "project_context update" ON public.project_context;
DROP POLICY IF EXISTS "project_context visible" ON public.project_context;
CREATE POLICY "project_context visible" ON public.project_context FOR SELECT TO authenticated
USING (app_private.can_access_scope(NULL, project_id, last_meeting_id));
CREATE POLICY "project_context insert" ON public.project_context FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_scope(NULL, project_id, last_meeting_id));
CREATE POLICY "project_context update" ON public.project_context FOR UPDATE TO authenticated
USING (app_private.can_access_scope(NULL, project_id, last_meeting_id))
WITH CHECK (app_private.can_access_scope(NULL, project_id, last_meeting_id));

-- ---------- project_dedupe_log ----------
DROP POLICY IF EXISTS "project_dedupe_log insert" ON public.project_dedupe_log;
DROP POLICY IF EXISTS "project_dedupe_log visible" ON public.project_dedupe_log;
CREATE POLICY "project_dedupe_log visible" ON public.project_dedupe_log FOR SELECT TO authenticated
USING (
  app_private.can_access_related_scope(
    client_id, COALESCE(project_id, merged_from_project_id), NULL, analysis_id, NULL
  )
);
CREATE POLICY "project_dedupe_log insert" ON public.project_dedupe_log FOR INSERT TO authenticated
WITH CHECK (
  app_private.can_access_related_scope(
    client_id, COALESCE(project_id, merged_from_project_id), NULL, analysis_id, NULL
  )
);

-- ---------- project_health_snapshots ----------
DROP POLICY IF EXISTS "project_health_snapshots insert" ON public.project_health_snapshots;
DROP POLICY IF EXISTS "project_health_snapshots update" ON public.project_health_snapshots;
DROP POLICY IF EXISTS "project_health_snapshots visible" ON public.project_health_snapshots;
CREATE POLICY "project_health_snapshots visible" ON public.project_health_snapshots FOR SELECT TO authenticated
USING (app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL));
CREATE POLICY "project_health_snapshots insert" ON public.project_health_snapshots FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL));
CREATE POLICY "project_health_snapshots update" ON public.project_health_snapshots FOR UPDATE TO authenticated
USING (app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL))
WITH CHECK (app_private.can_access_related_scope(client_id, project_id, meeting_id, analysis_id, NULL));

-- ---------- projects ----------
DROP POLICY IF EXISTS "projects insert" ON public.projects;
DROP POLICY IF EXISTS "projects update" ON public.projects;
DROP POLICY IF EXISTS "projects visible" ON public.projects;
CREATE POLICY "projects visible" ON public.projects FOR SELECT TO authenticated
USING (app_private.can_access_scope(client_id, merged_into_project_id, NULL));
CREATE POLICY "projects insert" ON public.projects FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_scope(client_id, merged_into_project_id, NULL));
CREATE POLICY "projects update" ON public.projects FOR UPDATE TO authenticated
USING (app_private.can_access_scope(client_id, merged_into_project_id, NULL))
WITH CHECK (app_private.can_access_scope(client_id, merged_into_project_id, NULL));

-- ---------- risks ----------
DROP POLICY IF EXISTS "risks insert" ON public.risks;
DROP POLICY IF EXISTS "risks update" ON public.risks;
DROP POLICY IF EXISTS "risks visible" ON public.risks;
CREATE POLICY "risks visible" ON public.risks FOR SELECT TO authenticated
USING (app_private.can_access_scope(client_id, NULL, meeting_id));
CREATE POLICY "risks insert" ON public.risks FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_scope(client_id, NULL, meeting_id));
CREATE POLICY "risks update" ON public.risks FOR UPDATE TO authenticated
USING (app_private.can_access_scope(client_id, NULL, meeting_id))
WITH CHECK (app_private.can_access_scope(client_id, NULL, meeting_id));

COMMIT;
