-- =============================================================================
-- Migration canônica: escopo de carteira (RLS) + endurecimento
--            das funções de papel.
--
-- STATUS 2026-08-11: NÃO APLICADA E NÃO TESTADA EM STAGING.
-- NÃO EXECUTAR enquanto o inventário integral de pg_policies, grants, owners,
-- FKs e estado de RLS não tiver sido coletado em staging. Policies permissivas
-- com nomes diferentes dos DROP POLICY abaixo podem sobreviver e manter acesso.
-- Ver docs/rls-staging-validation.md.
--
-- Objetivo
--   As tabelas criadas nas migrations de 2026-08-08/09 (projects, decisions,
--   project_context, meeting_analyses, entity_mentions, analysis_applications,
--   meeting_evolution, meeting_evolution_items, project_health_snapshots) já
--   usam o padrão `is_admin() OR clients.consultant_id = auth.uid()`.
--   As tabelas BASE (clients, meetings, actions, risks, opportunities,
--   profiles, user_roles, risk_rules) e project_dedupe_log foram criadas antes
--   do histórico versionado e não têm escopo por consultor — qualquer usuário
--   autenticado enxerga a carteira inteira. Esta migration aplica o MESMO
--   padrão a elas.
--
-- Princípios
--   * Nenhum dado é alterado. Nenhuma tabela/coluna é criada, renomeada ou
--     removida. Somente policies, grants, índices e funções de apoio.
--   * ADMIN  = public.has_role(auth.uid(), 'admin') via public.is_admin().
--   * CONSULTOR = clients.consultant_id = auth.uid()
--     (clients.consultant_id e projects.consultant_id referenciam profiles.id,
--      que é 1:1 com auth.users.id — confirmado nas FKs de types.ts).
--   * DELETE de projeto permanece restrito a admin.
--   * DELETE de reunião é permitido ao admin ou consultor responsável; as
--     dependências seguem as regras CASCADE/SET NULL da migration-base.
--
-- Rollback legado (NÃO É restauração fiel do estado anterior)
--   Para voltar ao comportamento anterior (todo autenticado vê tudo), execute
--   para cada tabela abaixo:
--     DROP POLICY IF EXISTS "<tabela> visible"  ON public.<tabela>;
--     DROP POLICY IF EXISTS "<tabela> insert"   ON public.<tabela>;
--     DROP POLICY IF EXISTS "<tabela> update"   ON public.<tabela>;
--     DROP POLICY IF EXISTS "<tabela> delete"   ON public.<tabela>;
--     CREATE POLICY "<tabela> all" ON public.<tabela>
--       FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   (não recomendado — reabre a carteira inteira para qualquer usuário).
-- O rollback seguro deve ser uma reverse migration gerada a partir do snapshot
-- real anterior, conforme docs/rls-staging-validation.md.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Funções de papel: SECURITY DEFINER com search_path fixo e execução
--    restrita a usuários autenticados (evita sondagem por anônimos).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin'::public.app_role);
$$;

-- Helper de escopo: o usuário atual pode operar sobre este cliente?
CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _client_id IS NOT NULL AND (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = _client_id AND c.consultant_id = auth.uid()
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_project(_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _project_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = _project_id
      AND public.can_access_client(p.client_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_meeting(_meeting_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _meeting_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.meetings m
    WHERE m.id = _meeting_id
      AND public.can_access_client(m.client_id)
  );
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_client(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_project(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_meeting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_client(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_project(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_meeting(uuid) TO authenticated, service_role;

-- Índices de apoio ao escopo. Justificativa: toda policy de entidade dependente
-- resolve o cliente por (id, consultant_id); sem eles cada verificação de linha
-- degenera em sequential scan de clients/meetings.
CREATE INDEX IF NOT EXISTS clients_consultant_id_idx ON public.clients (consultant_id);
CREATE INDEX IF NOT EXISTS meetings_client_id_idx ON public.meetings (client_id);
CREATE INDEX IF NOT EXISTS actions_client_id_idx ON public.actions (client_id);
CREATE INDEX IF NOT EXISTS risks_client_id_idx ON public.risks (client_id);
CREATE INDEX IF NOT EXISTS opportunities_client_id_idx ON public.opportunities (client_id);
CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON public.user_roles (user_id);

-- A staging baseline deve ter um conjunto fechado de policies. Remove qualquer
-- policy permissiva herdada com nome desconhecido antes de recriar a matriz.
DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'profiles', 'user_roles', 'clients', 'projects', 'project_context',
        'decisions', 'meetings', 'actions', 'risks', 'opportunities',
        'risk_rules', 'meeting_analyses', 'analysis_applications',
        'entity_mentions', 'meeting_evolution', 'meeting_evolution_items',
        'project_health_snapshots', 'project_dedupe_log'
      ])
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. CLIENTS — a raiz do escopo de carteira.
-- -----------------------------------------------------------------------------
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;

DROP POLICY IF EXISTS "clients visible" ON public.clients;
DROP POLICY IF EXISTS "clients insert" ON public.clients;
DROP POLICY IF EXISTS "clients update" ON public.clients;
DROP POLICY IF EXISTS "clients delete" ON public.clients;

CREATE POLICY "clients visible" ON public.clients FOR SELECT TO authenticated
USING (public.is_admin() OR consultant_id = auth.uid());

-- Consultor só cria cliente já atribuído a si mesmo; admin atribui a quem quiser.
CREATE POLICY "clients insert" ON public.clients FOR INSERT TO authenticated
WITH CHECK (public.is_admin() OR consultant_id = auth.uid());

-- WITH CHECK repete a regra para impedir que um consultor transfira o cliente.
CREATE POLICY "clients update" ON public.clients FOR UPDATE TO authenticated
USING (public.is_admin() OR consultant_id = auth.uid())
WITH CHECK (public.is_admin() OR consultant_id = auth.uid());

CREATE POLICY "clients delete" ON public.clients FOR DELETE TO authenticated
USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- 3. MEETINGS / ACTIONS / RISKS / OPPORTUNITIES — escopo via client_id.
-- -----------------------------------------------------------------------------
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT ALL ON public.meetings TO service_role;
DROP POLICY IF EXISTS "meetings visible" ON public.meetings;
DROP POLICY IF EXISTS "meetings insert" ON public.meetings;
DROP POLICY IF EXISTS "meetings update" ON public.meetings;
DROP POLICY IF EXISTS "meetings delete" ON public.meetings;
CREATE POLICY "meetings visible" ON public.meetings FOR SELECT TO authenticated
USING (public.can_access_client(client_id));
CREATE POLICY "meetings insert" ON public.meetings FOR INSERT TO authenticated
WITH CHECK (
  public.can_access_client(client_id)
  AND (
    meetings.project_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = meetings.project_id AND p.client_id = meetings.client_id
    )
  )
);
CREATE POLICY "meetings update" ON public.meetings FOR UPDATE TO authenticated
USING (public.can_access_client(client_id))
WITH CHECK (
  public.can_access_client(client_id)
  AND (
    meetings.project_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = meetings.project_id AND p.client_id = meetings.client_id
    )
  )
);
CREATE POLICY "meetings delete" ON public.meetings FOR DELETE TO authenticated
USING (public.can_access_client(client_id));

ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.actions TO authenticated;
GRANT ALL ON public.actions TO service_role;
DROP POLICY IF EXISTS "actions visible" ON public.actions;
DROP POLICY IF EXISTS "actions insert" ON public.actions;
DROP POLICY IF EXISTS "actions update" ON public.actions;
DROP POLICY IF EXISTS "actions delete" ON public.actions;
CREATE POLICY "actions visible" ON public.actions FOR SELECT TO authenticated
USING (public.can_access_client(client_id));
CREATE POLICY "actions insert" ON public.actions FOR INSERT TO authenticated
WITH CHECK (public.can_access_client(client_id));
CREATE POLICY "actions update" ON public.actions FOR UPDATE TO authenticated
USING (public.can_access_client(client_id))
WITH CHECK (public.can_access_client(client_id));
CREATE POLICY "actions delete" ON public.actions FOR DELETE TO authenticated
USING (public.can_access_client(client_id));

ALTER TABLE public.risks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risks TO authenticated;
GRANT ALL ON public.risks TO service_role;
DROP POLICY IF EXISTS "risks visible" ON public.risks;
DROP POLICY IF EXISTS "risks insert" ON public.risks;
DROP POLICY IF EXISTS "risks update" ON public.risks;
DROP POLICY IF EXISTS "risks delete" ON public.risks;
CREATE POLICY "risks visible" ON public.risks FOR SELECT TO authenticated
USING (public.can_access_client(client_id));
CREATE POLICY "risks insert" ON public.risks FOR INSERT TO authenticated
WITH CHECK (public.can_access_client(client_id));
CREATE POLICY "risks update" ON public.risks FOR UPDATE TO authenticated
USING (public.can_access_client(client_id))
WITH CHECK (public.can_access_client(client_id));
CREATE POLICY "risks delete" ON public.risks FOR DELETE TO authenticated
USING (public.can_access_client(client_id));

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated;
GRANT ALL ON public.opportunities TO service_role;
DROP POLICY IF EXISTS "opportunities visible" ON public.opportunities;
DROP POLICY IF EXISTS "opportunities insert" ON public.opportunities;
DROP POLICY IF EXISTS "opportunities update" ON public.opportunities;
DROP POLICY IF EXISTS "opportunities delete" ON public.opportunities;
CREATE POLICY "opportunities visible" ON public.opportunities FOR SELECT TO authenticated
USING (public.can_access_client(client_id));
CREATE POLICY "opportunities insert" ON public.opportunities FOR INSERT TO authenticated
WITH CHECK (public.can_access_client(client_id));
CREATE POLICY "opportunities update" ON public.opportunities FOR UPDATE TO authenticated
USING (public.can_access_client(client_id))
WITH CHECK (public.can_access_client(client_id));
CREATE POLICY "opportunities delete" ON public.opportunities FOR DELETE TO authenticated
USING (public.can_access_client(client_id));

-- -----------------------------------------------------------------------------
-- 4. PROFILES — a leitura da equipe segue necessária para exibir responsáveis;
--    a escrita é restrita ao próprio perfil (ou admin). O campo `role` em
--    profiles é legado/descritivo: a autoridade de papel é public.user_roles.
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT SELECT, INSERT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, email) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
DROP POLICY IF EXISTS "profiles visible" ON public.profiles;
DROP POLICY IF EXISTS "profiles insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles update" ON public.profiles;
DROP POLICY IF EXISTS "profiles delete" ON public.profiles;
CREATE POLICY "profiles visible" ON public.profiles FOR SELECT TO authenticated
USING (true);
CREATE POLICY "profiles insert" ON public.profiles FOR INSERT TO authenticated
WITH CHECK (public.is_admin() OR (id = auth.uid() AND role = 'consultant'));
CREATE POLICY "profiles update" ON public.profiles FOR UPDATE TO authenticated
USING (public.is_admin() OR id = auth.uid())
WITH CHECK (public.is_admin() OR id = auth.uid());
CREATE POLICY "profiles delete" ON public.profiles FOR DELETE TO authenticated
USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- 5. USER_ROLES — o usuário lê os próprios papéis; somente admin concede/revoga.
--    Sem isso, um consultor poderia inserir a si mesmo como admin.
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
DROP POLICY IF EXISTS "user_roles visible" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles insert" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles update" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles delete" ON public.user_roles;
CREATE POLICY "user_roles visible" ON public.user_roles FOR SELECT TO authenticated
USING (public.is_admin() OR user_id = auth.uid());
CREATE POLICY "user_roles insert" ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (public.is_admin());
CREATE POLICY "user_roles update" ON public.user_roles FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "user_roles delete" ON public.user_roles FOR DELETE TO authenticated
USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- 6. RISK_RULES — parâmetros globais do cálculo de risco.
--    Todos leem (o cálculo roda para qualquer consultor); só admin altera.
-- -----------------------------------------------------------------------------
ALTER TABLE public.risk_rules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_rules TO authenticated;
GRANT ALL ON public.risk_rules TO service_role;
DROP POLICY IF EXISTS "risk_rules visible" ON public.risk_rules;
DROP POLICY IF EXISTS "risk_rules insert" ON public.risk_rules;
DROP POLICY IF EXISTS "risk_rules update" ON public.risk_rules;
DROP POLICY IF EXISTS "risk_rules delete" ON public.risk_rules;
CREATE POLICY "risk_rules visible" ON public.risk_rules FOR SELECT TO authenticated
USING (true);
CREATE POLICY "risk_rules insert" ON public.risk_rules FOR INSERT TO authenticated
WITH CHECK (public.is_admin());
CREATE POLICY "risk_rules update" ON public.risk_rules FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "risk_rules delete" ON public.risk_rules FOR DELETE TO authenticated
USING (public.is_admin());

-- Projects and project-scoped entities.
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
CREATE POLICY "projects visible" ON public.projects FOR SELECT TO authenticated
USING (public.can_access_client(client_id));
CREATE POLICY "projects insert" ON public.projects FOR INSERT TO authenticated
WITH CHECK (public.can_access_client(client_id));
CREATE POLICY "projects update" ON public.projects FOR UPDATE TO authenticated
USING (public.can_access_client(client_id))
WITH CHECK (public.can_access_client(client_id));
CREATE POLICY "projects delete" ON public.projects FOR DELETE TO authenticated
USING (public.is_admin());

ALTER TABLE public.project_context ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_context TO authenticated;
GRANT ALL ON public.project_context TO service_role;
CREATE POLICY "project_context visible" ON public.project_context FOR SELECT TO authenticated
USING (public.can_access_project(project_id));
CREATE POLICY "project_context insert" ON public.project_context FOR INSERT TO authenticated
WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "project_context update" ON public.project_context FOR UPDATE TO authenticated
USING (public.can_access_project(project_id))
WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "project_context delete" ON public.project_context FOR DELETE TO authenticated
USING (public.can_access_project(project_id));

ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.decisions TO authenticated;
GRANT ALL ON public.decisions TO service_role;
CREATE POLICY "decisions visible" ON public.decisions FOR SELECT TO authenticated
USING (public.can_access_project(project_id));
CREATE POLICY "decisions insert" ON public.decisions FOR INSERT TO authenticated
WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "decisions update" ON public.decisions FOR UPDATE TO authenticated
USING (public.can_access_project(project_id))
WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "decisions delete" ON public.decisions FOR DELETE TO authenticated
USING (public.can_access_project(project_id));

-- Analysis, evolution and health entities.
ALTER TABLE public.meeting_analyses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_analyses TO authenticated;
GRANT ALL ON public.meeting_analyses TO service_role;
CREATE POLICY "meeting_analyses visible" ON public.meeting_analyses FOR SELECT TO authenticated
USING (public.can_access_meeting(meeting_id));
CREATE POLICY "meeting_analyses insert" ON public.meeting_analyses FOR INSERT TO authenticated
WITH CHECK (public.can_access_meeting(meeting_id));
CREATE POLICY "meeting_analyses update" ON public.meeting_analyses FOR UPDATE TO authenticated
USING (public.can_access_meeting(meeting_id))
WITH CHECK (public.can_access_meeting(meeting_id));
CREATE POLICY "meeting_analyses delete" ON public.meeting_analyses FOR DELETE TO authenticated
USING (public.can_access_meeting(meeting_id));

ALTER TABLE public.analysis_applications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_applications TO authenticated;
GRANT ALL ON public.analysis_applications TO service_role;
CREATE POLICY "analysis_applications visible" ON public.analysis_applications FOR SELECT TO authenticated
USING (public.can_access_meeting(meeting_id));
CREATE POLICY "analysis_applications insert" ON public.analysis_applications FOR INSERT TO authenticated
WITH CHECK (public.can_access_meeting(meeting_id));
CREATE POLICY "analysis_applications update" ON public.analysis_applications FOR UPDATE TO authenticated
USING (public.can_access_meeting(meeting_id))
WITH CHECK (public.can_access_meeting(meeting_id));
CREATE POLICY "analysis_applications delete" ON public.analysis_applications FOR DELETE TO authenticated
USING (public.can_access_meeting(meeting_id));

ALTER TABLE public.entity_mentions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entity_mentions TO authenticated;
GRANT ALL ON public.entity_mentions TO service_role;
CREATE POLICY "entity_mentions visible" ON public.entity_mentions FOR SELECT TO authenticated
USING (public.can_access_meeting(meeting_id) OR public.can_access_project(project_id) OR public.can_access_client(client_id));
CREATE POLICY "entity_mentions insert" ON public.entity_mentions FOR INSERT TO authenticated
WITH CHECK (public.can_access_meeting(meeting_id) OR public.can_access_project(project_id) OR public.can_access_client(client_id));
CREATE POLICY "entity_mentions update" ON public.entity_mentions FOR UPDATE TO authenticated
USING (public.can_access_meeting(meeting_id) OR public.can_access_project(project_id) OR public.can_access_client(client_id))
WITH CHECK (public.can_access_meeting(meeting_id) OR public.can_access_project(project_id) OR public.can_access_client(client_id));
CREATE POLICY "entity_mentions delete" ON public.entity_mentions FOR DELETE TO authenticated
USING (public.can_access_meeting(meeting_id) OR public.can_access_project(project_id) OR public.can_access_client(client_id));

ALTER TABLE public.meeting_evolution ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_evolution TO authenticated;
GRANT ALL ON public.meeting_evolution TO service_role;
CREATE POLICY "meeting_evolution visible" ON public.meeting_evolution FOR SELECT TO authenticated
USING (public.can_access_project(project_id));
CREATE POLICY "meeting_evolution insert" ON public.meeting_evolution FOR INSERT TO authenticated
WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "meeting_evolution update" ON public.meeting_evolution FOR UPDATE TO authenticated
USING (public.can_access_project(project_id))
WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "meeting_evolution delete" ON public.meeting_evolution FOR DELETE TO authenticated
USING (public.can_access_project(project_id));

ALTER TABLE public.meeting_evolution_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_evolution_items TO authenticated;
GRANT ALL ON public.meeting_evolution_items TO service_role;
CREATE POLICY "meeting_evolution_items visible" ON public.meeting_evolution_items FOR SELECT TO authenticated
USING (public.can_access_project(project_id));
CREATE POLICY "meeting_evolution_items insert" ON public.meeting_evolution_items FOR INSERT TO authenticated
WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "meeting_evolution_items update" ON public.meeting_evolution_items FOR UPDATE TO authenticated
USING (public.can_access_project(project_id))
WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "meeting_evolution_items delete" ON public.meeting_evolution_items FOR DELETE TO authenticated
USING (public.can_access_project(project_id));

ALTER TABLE public.project_health_snapshots ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_health_snapshots TO authenticated;
GRANT ALL ON public.project_health_snapshots TO service_role;
CREATE POLICY "project_health_snapshots visible" ON public.project_health_snapshots FOR SELECT TO authenticated
USING (public.can_access_project(project_id));
CREATE POLICY "project_health_snapshots insert" ON public.project_health_snapshots FOR INSERT TO authenticated
WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "project_health_snapshots update" ON public.project_health_snapshots FOR UPDATE TO authenticated
USING (public.can_access_project(project_id))
WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "project_health_snapshots delete" ON public.project_health_snapshots FOR DELETE TO authenticated
USING (public.can_access_project(project_id));

-- -----------------------------------------------------------------------------
-- 7. PROJECT_DEDUPE_LOG — trilha criada com USING (true); passa a respeitar
--    o mesmo escopo de carteira.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "dedupe log readable by authenticated" ON public.project_dedupe_log;
DROP POLICY IF EXISTS "dedupe log insert by authenticated" ON public.project_dedupe_log;
DROP POLICY IF EXISTS "project_dedupe_log visible" ON public.project_dedupe_log;
DROP POLICY IF EXISTS "project_dedupe_log insert" ON public.project_dedupe_log;
ALTER TABLE public.project_dedupe_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.project_dedupe_log TO authenticated;
GRANT ALL ON public.project_dedupe_log TO service_role;
CREATE POLICY "project_dedupe_log visible" ON public.project_dedupe_log FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR public.can_access_client(client_id)
  OR public.can_access_project(project_id)
);
CREATE POLICY "project_dedupe_log insert" ON public.project_dedupe_log FOR INSERT TO authenticated
WITH CHECK (
  public.is_admin()
  OR public.can_access_client(client_id)
  OR public.can_access_project(project_id)
);

COMMIT;
