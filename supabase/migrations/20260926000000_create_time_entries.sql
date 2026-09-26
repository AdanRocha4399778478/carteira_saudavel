-- =============================================================================
-- Controle de tempo por cliente/projeto — timer manual.
--
-- Contexto de negócio: consultoria cobra R$ 100,00/hora, hoje apontado à mão
-- pela agenda. Esta tabela guarda o apontamento estruturado: cliente,
-- projeto (opcional), consultor, área/subárea ERP (de onde veio o trabalho),
-- início, fim, e o valor gerado — travando a tarifa vigente no momento do
-- apontamento (se o preço por hora mudar no futuro, os registros antigos
-- continuam corretos historicamente).
--
-- Regra de negócio: só um cronômetro rodando por consultor por vez (índice
-- único parcial abaixo) — evita esquecer um timer aberto e come\u00e7ar outro.
-- =============================================================================

BEGIN;

CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  consultant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  erp_area text NOT NULL,
  erp_subarea text,
  description text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  hourly_rate_cents integer NOT NULL DEFAULT 10000, -- R$ 100,00 travado no momento do apontamento
  duration_seconds integer,   -- preenchido só quando o timer é parado
  amount_cents integer,       -- idem — evita recalcular depois se a tarifa mudar
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.time_entries IS
  'Apontamento de horas por cliente/projeto. duration_seconds e amount_cents ficam nulos enquanto o timer está rodando (ended_at is null) e são calculados no momento de parar.';
COMMENT ON COLUMN public.time_entries.hourly_rate_cents IS
  'Tarifa em centavos travada na criação do registro (R$ 100,00 = 10000). Preserva o valor histórico mesmo se a tarifa padrão mudar no futuro.';

-- Só um cronômetro aberto por consultor de cada vez.
CREATE UNIQUE INDEX time_entries_one_running_per_consultant
  ON public.time_entries (consultant_id)
  WHERE ended_at IS NULL;

CREATE INDEX time_entries_client_idx ON public.time_entries (client_id);
CREATE INDEX time_entries_project_idx ON public.time_entries (project_id);

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

-- Mesmo modelo já adotado nas outras tabelas de negócio (ver
-- 20260914120000_simplify_rls_remove_consultant_scope.sql): qualquer
-- autenticado vê e edita; delete restrito a admin.
CREATE POLICY "time_entries visible" ON public.time_entries
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "time_entries insert" ON public.time_entries
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "time_entries update" ON public.time_entries
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "time_entries delete" ON public.time_entries
  FOR DELETE TO authenticated USING (app_private.is_admin());

COMMIT;
