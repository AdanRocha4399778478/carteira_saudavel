-- =============================================================================
-- Corrige divergência de RLS encontrada na auditoria do ambiente de dev
-- (2026-09-28): as policies REAIS de produção para as tabelas abaixo eram
-- `USING (true)` em SELECT/INSERT/UPDATE (só DELETE ficava restrito a
-- admin) — bem mais permissivas do que a migration original
-- `20260811120000_rls_scope_carteira.sql` descreve. Sem rastro em nenhuma
-- outra migration nem no histórico do git: foi aplicado direto no banco,
-- fora do fluxo de migration.
--
-- Este arquivo só recria, tabela por tabela, exatamente as policies
-- escopadas que `20260811120000_rls_scope_carteira.sql` já definia — não
-- inventa regra nova. O projeto de dev (`carteira_saudavel-dev`, nascido
-- só das migrations) serviu de gabarito para conferir o texto exato de
-- cada policy antes de escrever este arquivo.
--
-- NÃO TOCA em: `time_entries` (USING (true) ali é design original,
-- commitado desde a criação da tabela — decisão em aberto, registrada à
-- parte, não corrigida aqui) nem em `risk_rules`/`user_roles`/`profiles`/
-- `orchestrator_recommendations`/`profile_directory` (já batem com as
-- migrations em produção hoje).
--
-- Pré-requisitos antes de aplicar em produção (ver relatório da triagem):
--   1. Confirmar que o cadastro aberto (signup) está desligado no dashboard.
--   2. Avisar o consultor: ele passa a ver só a própria carteira (hoje via
--      as policies soltas ele lê a carteira inteira por engano, sem usar
--      isso ativamente — mas a leitura muda, mesmo que a escrita não).
--   3. Ter o snapshot de rollback à mão (rls_snapshot_producao_2026-09-28.sql,
--      fora do repo) e aplicar num horário combinado.
--
-- Este PR NÃO aplica nada em produção — só propõe o arquivo para revisão.
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
