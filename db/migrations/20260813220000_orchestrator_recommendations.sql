-- =====================================================================
-- ORQUESTRADOR CONSULTIVO V1
-- Recomendação de próxima atuação consultiva por projeto.
-- Somente registro: nenhum agente é executado pelo banco.
-- Executar no SQL Editor do Supabase (backend externo / BYO).
-- =====================================================================

-- ---------------------------------------------------------------- enums
do $$ begin
  create type public.orchestrator_agent as enum (
    'CRITERIOS_SUCESSO',
    'DIAGNOSTICO_EXECUTIVO',
    'PARETO_ORDEM_ATAQUE',
    'ENTREGA_CONSULTIVA',
    'IMPLANTACAO_CONSULTIVA',
    'CONTINUIDADE_GERENCIAL',
    'AUDITOR_QUALIDADE'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.orchestrator_stage as enum (
    'SEM_DIRECAO',
    'EM_DIAGNOSTICO',
    'AGUARDANDO_PRIORIZACAO',
    'SOLUCAO_DEFINIDA',
    'EM_IMPLANTACAO',
    'EM_ACOMPANHAMENTO',
    'TRAVADO',
    'EM_VALIDACAO'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.orchestrator_status as enum (
    'suggested',
    'approved',
    'rejected',
    'executed',
    'superseded'
  );
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------- tabela
create table if not exists public.orchestrator_recommendations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  project_stage public.orchestrator_stage not null,
  main_bottleneck jsonb not null default '{}'::jsonb,
  recommended_agent public.orchestrator_agent not null,
  confidence numeric(3,2) not null default 0 check (confidence >= 0 and confidence <= 1),
  reason text not null default '',
  expected_result text not null default '',
  evidence jsonb not null default '[]'::jsonb,
  alternative_agent public.orchestrator_agent,
  alternative_reason text,
  erp_classification jsonb not null default '{}'::jsonb,
  source text not null default 'rules' check (source in ('rules', 'ai')),
  status public.orchestrator_status not null default 'suggested',
  state_hash text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null
);

create index if not exists orchestrator_recommendations_project_created_idx
  on public.orchestrator_recommendations (project_id, created_at desc);

-- Antiduplicidade: um estado só gera uma recomendação viva.
create unique index if not exists orchestrator_recommendations_live_state_idx
  on public.orchestrator_recommendations (project_id, state_hash)
  where status in ('suggested', 'approved');

-- ---------------------------------------------------------------- grants
grant select, insert, update on public.orchestrator_recommendations to authenticated;
grant all on public.orchestrator_recommendations to service_role;

-- ------------------------------------------------------------------ rls
alter table public.orchestrator_recommendations enable row level security;

drop policy if exists orchestrator_recommendations_select on public.orchestrator_recommendations;
create policy orchestrator_recommendations_select
  on public.orchestrator_recommendations for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = orchestrator_recommendations.project_id
        and public.can_access_client(p.client_id)
    )
  );

drop policy if exists orchestrator_recommendations_insert on public.orchestrator_recommendations;
create policy orchestrator_recommendations_insert
  on public.orchestrator_recommendations for insert to authenticated
  with check (
    exists (
      select 1 from public.projects p
      where p.id = orchestrator_recommendations.project_id
        and public.can_access_client(p.client_id)
    )
  );

drop policy if exists orchestrator_recommendations_update on public.orchestrator_recommendations;
create policy orchestrator_recommendations_update
  on public.orchestrator_recommendations for update to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = orchestrator_recommendations.project_id
        and public.can_access_client(p.client_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = orchestrator_recommendations.project_id
        and public.can_access_client(p.client_id)
    )
  );
