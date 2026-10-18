-- ============================================================================
-- Indicadores de resultado por projeto — parte 1: tabelas (17/10/2026).
--
-- Duas tabelas: `public.indicators` (definição do indicador — nome, tipo,
-- unidade, direção, linha de base, meta) e `public.indicator_points`
-- (histórico de valores ao longo do tempo, cada ponto marcado "medido" ou
-- "estimado"). Modelagem B, decisão do dono do produto (17/10/2026): linha
-- de base e meta são colunas explícitas em `indicators`, nunca um "ponto
-- especial" dentro de `indicator_points` — evita que toda leitura precise
-- filtrar/achar o ponto certo, e deixa corrigir a linha de base/meta como
-- um UPDATE simples, sem mexer no histórico de observações.
--
-- Decisões de regra de negócio do dono do produto que valem para este
-- desenho: direção é por indicador; frequência é só rótulo informativo
-- (sem validação de cadência); todo ponto leva a marca medido/estimado;
-- valor de ponto NUNCA tem default (ausência de dado nunca vira zero —
-- por isso `value numeric NOT NULL` sem `DEFAULT`, forçando quem grava a
-- decidir o valor, nunca um zero silencioso); sem acesso do cliente nesta
-- versão (só `authenticated`, igual ao resto do app).
--
-- `indicator_points` denormaliza client_id/project_id do indicador pai —
-- mesmo padrão já usado por `meeting_evolution_items` (que denormaliza
-- client_id/project_id/meeting_id do pai `meeting_evolution` em vez de
-- fazer subconsulta na policy, ver `20260811000000_initial_schema.sql` e
-- as policies atuais em `20260929180000_reassert_rls_scope_after_drift_snapshot.sql`).
-- Justificativa da escolha: subconsulta ao pai dentro de toda policy de
-- RLS (SELECT/INSERT/UPDATE/DELETE) é mais cara de avaliar a cada linha e
-- mais fácil de errar na hora de escrever/revisar a policy; coluna
-- denormalizada permite usar `app_private.can_access_scope` direto nas
-- colunas da própria linha, sem join, igual a toda outra tabela filha já
-- escopada no repositório. O gatilho `indicator_points_sync_scope` abaixo
-- garante que as colunas denormalizadas nunca divergem do indicador pai.
--
-- Revisão de segurança (17/10/2026): o REVOKE de `indicators`/
-- `indicator_points` inclui `authenticated` explicitamente — o ACL padrão
-- do schema `public` neste banco concede TRUNCATE/REFERENCES/TRIGGER/
-- MAINTAIN a `authenticated` em toda tabela nova, e isso nunca deveria
-- sobrar numa tabela nova sem decisão explícita. As funções de gatilho
-- (`sync_indicator_point_scope`, `guard_indicators_scope`) são
-- `SECURITY INVOKER`: rodam com o privilégio/RLS de quem está fazendo o
-- INSERT/UPDATE, não bypassam nada — e um gatilho nunca precisa de GRANT
-- EXECUTE porque o gerenciador de triggers do Postgres o chama como parte
-- da própria operação de DML, não como uma chamada SQL de um papel.
-- `guard_indicators_scope` garante que `indicators.client_id` é sempre o
-- cliente dono do `project_id` informado, e que nem client_id nem
-- project_id podem ser trocados depois que o indicador já existe.
--
-- Esta migration só cria o schema — NÃO é aplicada automaticamente; o
-- dono do produto aplica manualmente depois de revisar.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- indicators
-- ---------------------------------------------------------------------------

CREATE TABLE public.indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('percentual', 'valor', 'tempo', 'quantidade')),
  unit text,
  direction text NOT NULL CHECK (direction IN ('maior_melhor', 'menor_melhor')),
  -- Só rótulo informativo (decisão do dono do produto) — nunca validado contra measured_at.
  frequency text CHECK (frequency IN ('semanal', 'mensal')),
  baseline_value numeric,
  baseline_at date,
  target_value numeric,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX indicators_project_name_kind_key
  ON public.indicators (project_id, lower(name), kind);
CREATE INDEX indicators_project_idx ON public.indicators (project_id);
CREATE INDEX indicators_client_idx ON public.indicators (client_id);

-- Trava de integridade: client_id de um indicador tem que ser o mesmo
-- cliente do project_id informado (nunca um client_id de outro cliente
-- colado por engano), e depois de criado o indicador não pode trocar de
-- cliente nem de projeto por UPDATE — só delete (admin) e recriação.
CREATE OR REPLACE FUNCTION public.guard_indicators_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_project_client_id uuid;
BEGIN
  SELECT client_id INTO v_project_client_id
  FROM public.projects
  WHERE id = NEW.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project_id % não existe', NEW.project_id USING ERRCODE = '23514';
  END IF;

  IF NEW.client_id IS DISTINCT FROM v_project_client_id THEN
    RAISE EXCEPTION 'indicators.client_id deve ser o mesmo cliente do projeto informado (project_id %)', NEW.project_id
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'não é permitido alterar client_id de um indicador já criado' USING ERRCODE = '23514';
    END IF;
    IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      RAISE EXCEPTION 'não é permitido alterar project_id de um indicador já criado' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER indicators_scope_guard
  BEFORE INSERT OR UPDATE ON public.indicators
  FOR EACH ROW EXECUTE FUNCTION public.guard_indicators_scope();

-- ---------------------------------------------------------------------------
-- indicator_points
-- ---------------------------------------------------------------------------

CREATE TABLE public.indicator_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_id uuid NOT NULL REFERENCES public.indicators(id) ON DELETE CASCADE,
  -- Denormalizado do indicador pai (ver comentário no topo do arquivo),
  -- mantido em sincronia pelo gatilho indicator_points_sync_scope abaixo.
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Sem DEFAULT de propósito: valor ausente nunca vira zero.
  value numeric NOT NULL,
  measured_at date NOT NULL,
  basis text NOT NULL CHECK (basis IN ('medido', 'estimado')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'reuniao')),
  source_meeting_id uuid REFERENCES public.meetings(id) ON DELETE SET NULL,
  -- Frase da fala que sustenta o valor (quando source = 'reuniao').
  evidence text,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX indicator_points_indicator_measured_idx
  ON public.indicator_points (indicator_id, measured_at);

-- Garante que client_id/project_id denormalizados nunca divergem do
-- indicador pai, nem que indicator_id aponte pra um indicador inexistente
-- com NEW.client_id/project_id soltos (o FK já cobre "inexistente" para
-- indicator_id, este gatilho cobre "existe mas os campos não batem").
CREATE OR REPLACE FUNCTION public.sync_indicator_point_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
  v_project_id uuid;
BEGIN
  SELECT client_id, project_id INTO v_client_id, v_project_id
  FROM public.indicators
  WHERE id = NEW.indicator_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'indicator_id % não existe' , NEW.indicator_id USING ERRCODE = '23503';
  END IF;

  IF NEW.client_id IS DISTINCT FROM v_client_id OR NEW.project_id IS DISTINCT FROM v_project_id THEN
    RAISE EXCEPTION 'indicator_points.client_id/project_id deve bater com o indicador pai (indicator_id %)', NEW.indicator_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Sem GRANT/REVOKE de EXECUTE aqui: um gatilho é chamado pelo gerenciador
-- de triggers do Postgres como parte do próprio INSERT/UPDATE, nunca por
-- uma chamada SQL direta de um papel — o privilégio de EXECUTE da função
-- não entra na checagem desse caminho. GRANT/REVOKE só importariam se
-- alguém pudesse chamar a função diretamente (ex.: "SELECT
-- public.sync_indicator_point_scope()"), o que não é um uso previsto aqui.

CREATE TRIGGER indicator_points_sync_scope
  BEFORE INSERT OR UPDATE ON public.indicator_points
  FOR EACH ROW EXECUTE FUNCTION public.sync_indicator_point_scope();

-- ---------------------------------------------------------------------------
-- updated_at — gatilho compartilhado touch_updated_at, que as migrations
-- recentes (email_events, time_entries) esqueceram de ligar.
-- ---------------------------------------------------------------------------

CREATE TRIGGER indicators_touch
  BEFORE UPDATE ON public.indicators
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER indicator_points_touch
  BEFORE UPDATE ON public.indicator_points
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS e grants
-- ---------------------------------------------------------------------------

ALTER TABLE public.indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indicator_points ENABLE ROW LEVEL SECURITY;

-- anon e PUBLIC sem nenhum privilégio — revogado explicitamente, mesmo
-- sem GRANT nenhum ter sido dado a eles ainda (defesa explícita, mesmo
-- padrão de profile_directory). authenticated TAMBÉM entra no REVOKE: o
-- ACL padrão do schema public neste banco já concede TRUNCATE, REFERENCES,
-- TRIGGER e MAINTAIN a authenticated em toda tabela nova — sem este REVOKE
-- explícito, a tabela nasceria com privilégios que ela nunca deveria ter.
-- Os GRANTs abaixo, logo em seguida, devolvem só o que authenticated
-- realmente precisa (SELECT, INSERT, UPDATE, DELETE).
REVOKE ALL ON public.indicators FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.indicator_points FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.indicators TO authenticated;
GRANT ALL ON public.indicators TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.indicator_points TO authenticated;
GRANT ALL ON public.indicator_points TO service_role;

CREATE POLICY "indicators visible" ON public.indicators FOR SELECT TO authenticated
USING (app_private.can_access_scope(client_id, project_id, NULL));
CREATE POLICY "indicators insert" ON public.indicators FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_scope(client_id, project_id, NULL));
CREATE POLICY "indicators update" ON public.indicators FOR UPDATE TO authenticated
USING (app_private.can_access_scope(client_id, project_id, NULL))
WITH CHECK (app_private.can_access_scope(client_id, project_id, NULL));
-- Delete só para admin, mesmo padrão de decisions (restrict_structural_deletes).
CREATE POLICY "indicators delete" ON public.indicators FOR DELETE TO authenticated
USING (app_private.is_admin());

CREATE POLICY "indicator_points visible" ON public.indicator_points FOR SELECT TO authenticated
USING (app_private.can_access_scope(client_id, project_id, NULL));
CREATE POLICY "indicator_points insert" ON public.indicator_points FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_scope(client_id, project_id, NULL));
CREATE POLICY "indicator_points update" ON public.indicator_points FOR UPDATE TO authenticated
USING (app_private.can_access_scope(client_id, project_id, NULL))
WITH CHECK (app_private.can_access_scope(client_id, project_id, NULL));
CREATE POLICY "indicator_points delete" ON public.indicator_points FOR DELETE TO authenticated
USING (app_private.is_admin());

COMMIT;
