-- =============================================================================
-- Restrict structural and historical deletes
--
-- Objetivo:
-- Alinhar as policies RLS de DELETE com a matriz de autorização da aplicação.
--
-- Consultores continuam podendo operar registros de sua própria carteira,
-- porém exclusões de entidades estruturais/históricas ficam restritas a admin.
--
-- Nenhum dado é alterado.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- MEETINGS
-- Reuniões fazem parte do histórico do relacionamento com o cliente.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "meetings delete" ON public.meetings;

CREATE POLICY "meetings delete"
ON public.meetings
FOR DELETE
TO authenticated
USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- DECISIONS
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "decisions delete" ON public.decisions;

CREATE POLICY "decisions delete"
ON public.decisions
FOR DELETE
TO authenticated
USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- MEETING ANALYSES
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "meeting_analyses delete" ON public.meeting_analyses;

CREATE POLICY "meeting_analyses delete"
ON public.meeting_analyses
FOR DELETE
TO authenticated
USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- ANALYSIS APPLICATIONS
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "analysis_applications delete"
ON public.analysis_applications;

CREATE POLICY "analysis_applications delete"
ON public.analysis_applications
FOR DELETE
TO authenticated
USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- ENTITY MENTIONS
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "entity_mentions delete"
ON public.entity_mentions;

CREATE POLICY "entity_mentions delete"
ON public.entity_mentions
FOR DELETE
TO authenticated
USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- MEETING EVOLUTION
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "meeting_evolution delete"
ON public.meeting_evolution;

CREATE POLICY "meeting_evolution delete"
ON public.meeting_evolution
FOR DELETE
TO authenticated
USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- MEETING EVOLUTION ITEMS
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "meeting_evolution_items delete"
ON public.meeting_evolution_items;

CREATE POLICY "meeting_evolution_items delete"
ON public.meeting_evolution_items
FOR DELETE
TO authenticated
USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- PROJECT HEALTH SNAPSHOTS
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "project_health_snapshots delete"
ON public.project_health_snapshots;

CREATE POLICY "project_health_snapshots delete"
ON public.project_health_snapshots
FOR DELETE
TO authenticated
USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- PROJECT CONTEXT
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "project_context delete"
ON public.project_context;

CREATE POLICY "project_context delete"
ON public.project_context
FOR DELETE
TO authenticated
USING (public.is_admin());

COMMIT;
