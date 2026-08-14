-- Carteira Saudável 2.0 - migration canônica do orquestrador.
-- Somente persistência e autorização; esta migration não executa agentes ou IA.

begin;

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
exception when duplicate_object then null;
end $$;

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
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.orchestrator_status as enum (
    'suggested',
    'approved',
    'rejected',
    'executed',
    'superseded'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.orchestrator_recommendations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  project_stage public.orchestrator_stage not null,
  main_bottleneck jsonb not null default '{}'::jsonb,
  recommended_agent public.orchestrator_agent not null,
  confidence numeric(3,2) not null default 0 check (confidence between 0 and 1),
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

create unique index if not exists orchestrator_recommendations_live_state_idx
  on public.orchestrator_recommendations (project_id, state_hash)
  where status in ('suggested', 'approved', 'executed');

create or replace function public.set_orchestrator_recommendation_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  select p.client_id into v_client_id
  from public.projects p
  where p.id = new.project_id;

  if v_client_id is null then
    raise exception 'project not found' using errcode = '23503';
  end if;
  if not public.can_access_project(new.project_id) then
    raise exception 'not authorized for project' using errcode = '42501';
  end if;

  new.client_id := v_client_id;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists orchestrator_recommendations_scope
  on public.orchestrator_recommendations;
create trigger orchestrator_recommendations_scope
before insert or update on public.orchestrator_recommendations
for each row execute function public.set_orchestrator_recommendation_scope();

revoke all on public.orchestrator_recommendations from anon, authenticated;
grant select, insert on public.orchestrator_recommendations to authenticated;
grant update (status, approved_at, approved_by)
  on public.orchestrator_recommendations to authenticated;
grant all on public.orchestrator_recommendations to service_role;

alter table public.orchestrator_recommendations enable row level security;

drop policy if exists orchestrator_recommendations_select
  on public.orchestrator_recommendations;
drop policy if exists orchestrator_recommendations_insert
  on public.orchestrator_recommendations;
drop policy if exists orchestrator_recommendations_update
  on public.orchestrator_recommendations;

create policy orchestrator_recommendations_select
  on public.orchestrator_recommendations for select to authenticated
  using (public.can_access_scope(client_id, project_id, NULL));

create policy orchestrator_recommendations_insert
  on public.orchestrator_recommendations for insert to authenticated
  with check (
    public.can_access_scope(client_id, project_id, NULL)
    and (created_by is null or created_by = auth.uid() or public.is_admin())
  );

create policy orchestrator_recommendations_update
  on public.orchestrator_recommendations for update to authenticated
  using (public.can_access_scope(client_id, project_id, NULL))
  with check (
    public.can_access_scope(client_id, project_id, NULL)
    and (
      (status = 'approved' and approved_by = auth.uid() and approved_at is not null)
      or status in ('rejected', 'executed', 'superseded')
    )
  );

commit;
