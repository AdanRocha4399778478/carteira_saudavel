-- =============================================================================
-- Gate 2 — camada comercial da Carteira Saudável.
-- Cria: products (catálogo), contracts (o que cada cliente contratou),
-- deliveries (entregas com aceite) e clients.cadence (cadência de reunião).
--
-- Regras de negócio confirmadas pelo Adan em 2026-10-23/24:
--   * Pacotes mensais: R$ 300, R$ 1.000, R$ 1.500 e R$ 2.000.
--   * Verdade Financeira fica no pacote de R$ 300 (sem reajuste).
--   * Mapa da Verdade não é vendido à parte: é o primeiro projeto de qualquer pacote.
--   * Cadência por cliente: semanal, quinzenal ou mensal; alerta de atenção a 1,5x
--     e crítico a 2x (decisão de 2026-10-20). O alerta é calculado no app, não aqui.
-- Valores em centavos, como em time_entries.
-- =============================================================================

-- ---------- products ----------
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pacote_mensal', 'projeto', 'hora', 'incluso')),
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('mensal', 'pontual', 'por_hora', 'nenhum')),
  included_hours numeric CHECK (included_hours IS NULL OR included_hours >= 0),
  includes text,
  excludes text,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'em_teste', 'descontinuado')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.products IS 'Catálogo de produtos da Resultados S/A. Preço de tabela; o valor negociado fica em contracts.';
COMMENT ON COLUMN public.products.status IS 'ativo = à venda; em_teste = ideia/primeira venda ainda não validada; descontinuado = não vender.';

CREATE TRIGGER products_touch BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.products FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated, service_role;

CREATE POLICY "products visible" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products insert" ON public.products FOR INSERT TO authenticated WITH CHECK (app_private.is_admin());
CREATE POLICY "products update" ON public.products FOR UPDATE TO authenticated USING (app_private.is_admin()) WITH CHECK (app_private.is_admin());
CREATE POLICY "products delete" ON public.products FOR DELETE TO authenticated USING (app_private.is_admin());

-- ---------- contracts ----------
CREATE TABLE public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('mensal', 'pontual', 'por_hora')),
  start_date date NOT NULL,
  end_date date,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('proposta', 'ativo', 'pausado', 'encerrado')),
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
COMMENT ON TABLE public.contracts IS 'O que cada cliente contratou: produto, valor negociado, ciclo e vigência.';
CREATE INDEX contracts_client_idx ON public.contracts (client_id);
CREATE INDEX contracts_product_idx ON public.contracts (product_id);

CREATE TRIGGER contracts_touch BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contracts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts TO authenticated, service_role;

CREATE POLICY "contracts visible" ON public.contracts FOR SELECT TO authenticated USING (app_private.can_access_client(client_id));
CREATE POLICY "contracts insert" ON public.contracts FOR INSERT TO authenticated WITH CHECK (app_private.can_access_client(client_id));
CREATE POLICY "contracts update" ON public.contracts FOR UPDATE TO authenticated USING (app_private.can_access_client(client_id)) WITH CHECK (app_private.can_access_client(client_id));
CREATE POLICY "contracts delete" ON public.contracts FOR DELETE TO authenticated USING (app_private.is_admin());

-- ---------- deliveries ----------
CREATE TABLE public.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'entregue', 'aceita', 'recusada')),
  delivered_at date,
  accepted_at date,
  accepted_by_name text,
  acceptance_evidence text,
  billable boolean NOT NULL DEFAULT true,
  amount_cents integer CHECK (amount_cents IS NULL OR amount_cents >= 0),
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'aceita' OR (accepted_at IS NOT NULL AND accepted_by_name IS NOT NULL)),
  CHECK (status NOT IN ('entregue', 'aceita', 'recusada') OR delivered_at IS NOT NULL)
);
COMMENT ON TABLE public.deliveries IS 'Entregas ao cliente com aceite. Entrega sem aceite registrado não deve ser considerada encerrada.';
CREATE INDEX deliveries_client_idx ON public.deliveries (client_id);
CREATE INDEX deliveries_contract_idx ON public.deliveries (contract_id);
CREATE INDEX deliveries_project_idx ON public.deliveries (project_id);

CREATE TRIGGER deliveries_touch BEFORE UPDATE ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deliveries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliveries TO authenticated, service_role;

CREATE POLICY "deliveries visible" ON public.deliveries FOR SELECT TO authenticated USING (app_private.can_access_client(client_id));
CREATE POLICY "deliveries insert" ON public.deliveries FOR INSERT TO authenticated WITH CHECK (app_private.can_access_client(client_id));
CREATE POLICY "deliveries update" ON public.deliveries FOR UPDATE TO authenticated USING (app_private.can_access_client(client_id)) WITH CHECK (app_private.can_access_client(client_id));
CREATE POLICY "deliveries delete" ON public.deliveries FOR DELETE TO authenticated USING (app_private.is_admin());

-- ---------- clients.cadence ----------
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS cadence text CHECK (cadence IS NULL OR cadence IN ('semanal', 'quinzenal', 'mensal'));
COMMENT ON COLUMN public.clients.cadence IS 'Cadência de reunião acordada. Sem cadência = "sem dado" (sem alerta). Atenção a 1,5x e crítico a 2x (calculado no app).';

-- ---------- catálogo inicial ----------
INSERT INTO public.products (code, name, kind, price_cents, billing_cycle, included_hours, includes, excludes, status, sort_order) VALUES
  ('mapa_da_verdade', 'Mapa da Verdade', 'incluso', 0, 'nenhum', NULL,
   'Diagnóstico de entrada: maturidade, Pareto e plano 30/60/90. É o primeiro projeto de qualquer pacote.', 'Não é vendido à parte.', 'ativo', 10),
  ('pacote_300', 'Pacote Básico (Plano Start / Verdade Financeira)', 'pacote_mensal', 30000, 'mensal', 4,
   '1 reunião por mês, 1 projeto por vez, onboarding pela Verdade Financeira (DRE e fluxo de caixa).', 'Recrutamento e projetos fora do escopo são cobrados à parte.', 'ativo', 20),
  ('pacote_1000', 'Pacote Intermediário', 'pacote_mensal', 100000, 'mensal', NULL, NULL, NULL, 'ativo', 30),
  ('pacote_1500', 'Pacote Avançado', 'pacote_mensal', 150000, 'mensal', NULL, NULL, NULL, 'ativo', 40),
  ('pacote_2000', 'Pacote Premium', 'pacote_mensal', 200000, 'mensal', NULL, NULL, NULL, 'ativo', 50),
  ('recrutamento', 'Recrutamento e Seleção (TalentoLink)', 'projeto', 60000, 'pontual', 6,
   '2 a 3 candidatos testados, DISC, ranking e dossiê. Referência: cerca de 1/3 do salário da vaga.', 'Anúncio pago (até R$ 100) cobrado à parte.', 'ativo', 60),
  ('hora_tecnica', 'Hora técnica avulsa', 'hora', 10000, 'por_hora', NULL,
   'Ajustes, refresh de dashboard, demandas fora do pacote.', NULL, 'ativo', 70),
  ('planejamento_estrategico', 'Planejamento estratégico anual', 'projeto', 75000, 'pontual', NULL, NULL, NULL, 'em_teste', 80),
  ('estrutura_pessoas', 'Estrutura de Pessoas implantada', 'projeto', 100000, 'pontual', NULL,
   'Recrutamento, onboarding, treinamento, feedback, clima e reconhecimento.', NULL, 'em_teste', 90),
  ('desenvolvimento_gerente', 'Programa de desenvolvimento de gerente (90 dias)', 'projeto', 120000, 'pontual', NULL,
   'Trilha com entregáveis como evidência.', NULL, 'em_teste', 100),
  ('app_mvp', 'App de MVP sob medida', 'projeto', 110000, 'pontual', NULL,
   'App a partir do que foi implantado no cliente. Faixa de R$ 1.100 a R$ 1.500.', NULL, 'em_teste', 110),
  ('pesquisa_clima', 'Pesquisa de clima ou satisfação', 'projeto', 10000, 'pontual', NULL, NULL, NULL, 'em_teste', 120),
  ('trafego_pago', 'Gestão de tráfego pago', 'pacote_mensal', 85000, 'mensal', NULL, NULL, 'Mínimo de 3 meses.', 'em_teste', 130);
