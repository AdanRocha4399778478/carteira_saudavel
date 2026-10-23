-- =============================================================================
-- Seed FICTÍCIO para supabase/tests/rls_regression.sql — SOMENTE DEV.
--
-- NUNCA rode este arquivo em produção. Ele só roda em banco vazio (abaixo há
-- uma guarda que aborta se já existir qualquer usuário ou cliente), mas a
-- proteção real é você conferir que o projeto vinculado é o de dev antes de
-- executar. Passo a passo em docs/dev-environment.md.
--
-- O que cria (tudo numa transação; ou entra tudo, ou nada):
--   - 3 usuários fictícios em auth.users: admin, consultora A e consultor B.
--     Sem senha, e-mail em domínio .invalid: ninguém consegue fazer login.
--   - Papéis em user_roles (o admin vem daqui: is_admin() lê essa tabela).
--   - 2 clientes (A da consultora A; B do consultor B) e 1 projeto por cliente.
--   - 1 time_entries e 1 orchestrator_recommendations por cliente (o teste
--     exige pelo menos 1 linha de cada por cliente).
--
-- Os IDs são os mesmos que rls_regression.sql usa. Os gatilhos de escopo
-- dependem de auth.uid(), por isso as inserções rodam "como" o admin fictício
-- (request.jwt.claims). Para apagar tudo: supabase db reset --linked (dev).
-- =============================================================================
BEGIN;

-- Guarda: só roda em banco vazio (recém-resetado).
DO $$
BEGIN
  IF (SELECT count(*) FROM public.clients) <> 0 OR (SELECT count(*) FROM auth.users) <> 0 THEN
    RAISE EXCEPTION 'Banco nao esta vazio; abortando o seed.';
  END IF;
END $$;

-- 3 usuários fictícios (o gatilho on_auth_user_created cria os profiles como consultant).
INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-00000000a000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin.teste@example.invalid', '{"provider":"email","providers":["email"]}', '{"full_name":"Admin Teste (ficticio)"}', now(), now()),
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'consultora.a.teste@example.invalid', '{"provider":"email","providers":["email"]}', '{"full_name":"Consultora A (ficticia)"}', now(), now()),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'consultor.b.teste@example.invalid', '{"provider":"email","providers":["email"]}', '{"full_name":"Consultor B (ficticio)"}', now(), now());

-- Papéis: o admin é identificado por user_roles (is_admin() lê essa tabela).
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000a000', 'admin'),
  ('00000000-0000-0000-0000-00000000a001', 'consultant'),
  ('00000000-0000-0000-0000-00000000b001', 'consultant')
ON CONFLICT (user_id, role) DO NOTHING;

UPDATE public.profiles SET role = 'admin' WHERE id = '00000000-0000-0000-0000-00000000a000';

-- Os gatilhos de escopo usam auth.uid(): as inserções abaixo rodam "como" o admin fictício.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a000","role":"authenticated"}', true);

-- 2 clientes (A é da consultora A; B é do consultor B).
INSERT INTO public.clients (id, company_name, consultant_id, notes) VALUES
  ('00000000-0000-0000-0000-0000000c0a01', 'Cliente Teste A (ficticio)', '00000000-0000-0000-0000-00000000a001', 'SEED FICTICIO rls_regression'),
  ('00000000-0000-0000-0000-0000000c0b01', 'Cliente Teste B (ficticio)', '00000000-0000-0000-0000-00000000b001', 'SEED FICTICIO rls_regression');

-- 2 projetos, um por cliente.
INSERT INTO public.projects (id, client_id, consultant_id, name) VALUES
  ('00000000-0000-0000-0000-0000000d0a01', '00000000-0000-0000-0000-0000000c0a01', '00000000-0000-0000-0000-00000000a001', 'Projeto Teste A (ficticio)'),
  ('00000000-0000-0000-0000-0000000d0b01', '00000000-0000-0000-0000-0000000c0b01', '00000000-0000-0000-0000-00000000b001', 'Projeto Teste B (ficticio)');

-- 1 time_entries por cliente (encerrado, para não violar "um cronômetro aberto por consultor").
INSERT INTO public.time_entries (client_id, project_id, consultant_id, erp_area, description, started_at, ended_at, duration_seconds, amount_cents) VALUES
  ('00000000-0000-0000-0000-0000000c0a01', '00000000-0000-0000-0000-0000000d0a01', '00000000-0000-0000-0000-00000000a001', 'Financeiro', 'SEED FICTICIO A', now(), now(), 60, 167),
  ('00000000-0000-0000-0000-0000000c0b01', '00000000-0000-0000-0000-0000000d0b01', '00000000-0000-0000-0000-00000000b001', 'Financeiro', 'SEED FICTICIO B', now(), now(), 60, 167);

-- 1 orchestrator_recommendations por cliente (mesmos enums que o próprio teste usa).
INSERT INTO public.orchestrator_recommendations (project_id, client_id, project_stage, recommended_agent, state_hash) VALUES
  ('00000000-0000-0000-0000-0000000d0a01', '00000000-0000-0000-0000-0000000c0a01', 'SEM_DIRECAO', 'DIAGNOSTICO_EXECUTIVO', 'seed-ficticio-a'),
  ('00000000-0000-0000-0000-0000000d0b01', '00000000-0000-0000-0000-0000000c0b01', 'SEM_DIRECAO', 'DIAGNOSTICO_EXECUTIVO', 'seed-ficticio-b');

-- Conferência antes de confirmar.
DO $$
BEGIN
  IF (SELECT count(*) FROM auth.users) <> 3
     OR (SELECT count(*) FROM public.clients) <> 2
     OR (SELECT count(*) FROM public.projects) <> 2
     OR (SELECT count(*) FROM public.time_entries) <> 2
     OR (SELECT count(*) FROM public.orchestrator_recommendations) <> 2 THEN
    RAISE EXCEPTION 'Contagens do seed nao batem; abortando.';
  END IF;
END $$;

COMMIT;
