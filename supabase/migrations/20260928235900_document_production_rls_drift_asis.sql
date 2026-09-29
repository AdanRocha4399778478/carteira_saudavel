-- =============================================================================
-- Documenta, sem corrigir, o estado REAL das policies de RLS em produção
-- para as mesmas 15 tabelas cobertas por
-- `20260928120000_fix_rls_scope_drift.sql` (PR #53, ainda não aplicado).
--
-- Motivo deste arquivo: produção tinha essas policies soltas (`USING (true)`
-- / `WITH CHECK (true)` em SELECT/INSERT/UPDATE) aplicadas diretamente no
-- banco, fora de qualquer migration versionada — o repositório descrevia
-- só a intenção original (`20260811120000_rls_scope_carteira.sql`), nunca
-- a realidade. Antes de aplicar a correção do PR #53, este arquivo faz o
-- repositório passar a contar a verdade: reproduz, tabela por tabela,
-- exatamente o texto de cada policy hoje ativa em produção (conferido via
-- `pg_policies` em 2026-09-28), incluindo a falha de segurança. Nada aqui
-- é uma escolha de design — é a ausência de rastro sendo corrigida antes
-- da própria falha ser corrigida.
--
-- DELETE não é tocado em nenhuma das 15 tabelas: já bate com a migration
-- original (`app_private.is_admin()`) tanto em produção quanto no repo —
-- só INSERT/SELECT/UPDATE divergiam.
--
-- `project_dedupe_log` não tem policy de UPDATE em produção (nunca teve —
-- é uma tabela de log, só INSERT/SELECT) e sua policy de DELETE nem existe
-- (mesma tabela cujas 4 colunas fixas nunca precisaram de DELETE) — por
-- isso não aparece na seção correspondente abaixo além de INSERT/SELECT.
--
-- Este arquivo NÃO aplica nada de novo: as policies recriadas aqui são
-- idênticas, char a char, às que já rodam em produção agora. O PR #53,
-- separado, é quem de fato estreita o acesso.
-- =============================================================================

BEGIN;

-- ---------- actions ----------
DROP POLICY IF EXISTS "actions insert" ON public.actions;
DROP POLICY IF EXISTS "actions update" ON public.actions;
DROP POLICY IF EXISTS "actions visible" ON public.actions;
CREATE POLICY "actions visible" ON public.actions FOR SELECT TO authenticated
USING (true);
CREATE POLICY "actions insert" ON public.actions FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "actions update" ON public.actions FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- analysis_applications ----------
DROP POLICY IF EXISTS "analysis_applications insert" ON public.analysis_applications;
DROP POLICY IF EXISTS "analysis_applications update" ON public.analysis_applications;
DROP POLICY IF EXISTS "analysis_applications visible" ON public.analysis_applications;
CREATE POLICY "analysis_applications visible" ON public.analysis_applications FOR SELECT TO authenticated
USING (true);
CREATE POLICY "analysis_applications insert" ON public.analysis_applications FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "analysis_applications update" ON public.analysis_applications FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- clients ----------
DROP POLICY IF EXISTS "clients insert" ON public.clients;
DROP POLICY IF EXISTS "clients update" ON public.clients;
DROP POLICY IF EXISTS "clients visible" ON public.clients;
CREATE POLICY "clients visible" ON public.clients FOR SELECT TO authenticated
USING (true);
CREATE POLICY "clients insert" ON public.clients FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "clients update" ON public.clients FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- decisions ----------
DROP POLICY IF EXISTS "decisions insert" ON public.decisions;
DROP POLICY IF EXISTS "decisions update" ON public.decisions;
DROP POLICY IF EXISTS "decisions visible" ON public.decisions;
CREATE POLICY "decisions visible" ON public.decisions FOR SELECT TO authenticated
USING (true);
CREATE POLICY "decisions insert" ON public.decisions FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "decisions update" ON public.decisions FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- entity_mentions ----------
DROP POLICY IF EXISTS "entity_mentions insert" ON public.entity_mentions;
DROP POLICY IF EXISTS "entity_mentions update" ON public.entity_mentions;
DROP POLICY IF EXISTS "entity_mentions visible" ON public.entity_mentions;
CREATE POLICY "entity_mentions visible" ON public.entity_mentions FOR SELECT TO authenticated
USING (true);
CREATE POLICY "entity_mentions insert" ON public.entity_mentions FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "entity_mentions update" ON public.entity_mentions FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- meeting_analyses ----------
DROP POLICY IF EXISTS "meeting_analyses insert" ON public.meeting_analyses;
DROP POLICY IF EXISTS "meeting_analyses update" ON public.meeting_analyses;
DROP POLICY IF EXISTS "meeting_analyses visible" ON public.meeting_analyses;
CREATE POLICY "meeting_analyses visible" ON public.meeting_analyses FOR SELECT TO authenticated
USING (true);
CREATE POLICY "meeting_analyses insert" ON public.meeting_analyses FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "meeting_analyses update" ON public.meeting_analyses FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- meeting_evolution ----------
DROP POLICY IF EXISTS "meeting_evolution insert" ON public.meeting_evolution;
DROP POLICY IF EXISTS "meeting_evolution update" ON public.meeting_evolution;
DROP POLICY IF EXISTS "meeting_evolution visible" ON public.meeting_evolution;
CREATE POLICY "meeting_evolution visible" ON public.meeting_evolution FOR SELECT TO authenticated
USING (true);
CREATE POLICY "meeting_evolution insert" ON public.meeting_evolution FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "meeting_evolution update" ON public.meeting_evolution FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- meeting_evolution_items ----------
DROP POLICY IF EXISTS "meeting_evolution_items insert" ON public.meeting_evolution_items;
DROP POLICY IF EXISTS "meeting_evolution_items update" ON public.meeting_evolution_items;
DROP POLICY IF EXISTS "meeting_evolution_items visible" ON public.meeting_evolution_items;
CREATE POLICY "meeting_evolution_items visible" ON public.meeting_evolution_items FOR SELECT TO authenticated
USING (true);
CREATE POLICY "meeting_evolution_items insert" ON public.meeting_evolution_items FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "meeting_evolution_items update" ON public.meeting_evolution_items FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- meetings ----------
DROP POLICY IF EXISTS "meetings insert" ON public.meetings;
DROP POLICY IF EXISTS "meetings update" ON public.meetings;
DROP POLICY IF EXISTS "meetings visible" ON public.meetings;
CREATE POLICY "meetings visible" ON public.meetings FOR SELECT TO authenticated
USING (true);
CREATE POLICY "meetings insert" ON public.meetings FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "meetings update" ON public.meetings FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- opportunities ----------
DROP POLICY IF EXISTS "opportunities insert" ON public.opportunities;
DROP POLICY IF EXISTS "opportunities update" ON public.opportunities;
DROP POLICY IF EXISTS "opportunities visible" ON public.opportunities;
CREATE POLICY "opportunities visible" ON public.opportunities FOR SELECT TO authenticated
USING (true);
CREATE POLICY "opportunities insert" ON public.opportunities FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "opportunities update" ON public.opportunities FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- project_context ----------
DROP POLICY IF EXISTS "project_context insert" ON public.project_context;
DROP POLICY IF EXISTS "project_context update" ON public.project_context;
DROP POLICY IF EXISTS "project_context visible" ON public.project_context;
CREATE POLICY "project_context visible" ON public.project_context FOR SELECT TO authenticated
USING (true);
CREATE POLICY "project_context insert" ON public.project_context FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "project_context update" ON public.project_context FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- project_dedupe_log ----------
-- Só INSERT/SELECT existem para esta tabela em produção (log só-inserção,
-- sem policy de UPDATE nem DELETE, hoje ou na migration original).
DROP POLICY IF EXISTS "project_dedupe_log insert" ON public.project_dedupe_log;
DROP POLICY IF EXISTS "project_dedupe_log visible" ON public.project_dedupe_log;
CREATE POLICY "project_dedupe_log visible" ON public.project_dedupe_log FOR SELECT TO authenticated
USING (true);
CREATE POLICY "project_dedupe_log insert" ON public.project_dedupe_log FOR INSERT TO authenticated
WITH CHECK (true);

-- ---------- project_health_snapshots ----------
DROP POLICY IF EXISTS "project_health_snapshots insert" ON public.project_health_snapshots;
DROP POLICY IF EXISTS "project_health_snapshots update" ON public.project_health_snapshots;
DROP POLICY IF EXISTS "project_health_snapshots visible" ON public.project_health_snapshots;
CREATE POLICY "project_health_snapshots visible" ON public.project_health_snapshots FOR SELECT TO authenticated
USING (true);
CREATE POLICY "project_health_snapshots insert" ON public.project_health_snapshots FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "project_health_snapshots update" ON public.project_health_snapshots FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- projects ----------
DROP POLICY IF EXISTS "projects insert" ON public.projects;
DROP POLICY IF EXISTS "projects update" ON public.projects;
DROP POLICY IF EXISTS "projects visible" ON public.projects;
CREATE POLICY "projects visible" ON public.projects FOR SELECT TO authenticated
USING (true);
CREATE POLICY "projects insert" ON public.projects FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "projects update" ON public.projects FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- ---------- risks ----------
DROP POLICY IF EXISTS "risks insert" ON public.risks;
DROP POLICY IF EXISTS "risks update" ON public.risks;
DROP POLICY IF EXISTS "risks visible" ON public.risks;
CREATE POLICY "risks visible" ON public.risks FOR SELECT TO authenticated
USING (true);
CREATE POLICY "risks insert" ON public.risks FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "risks update" ON public.risks FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

COMMIT;
