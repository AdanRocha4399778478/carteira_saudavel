-- =============================================================================
-- Carteira Saudável 2.0 — migration-base canônica do schema conhecido
-- =============================================================================
-- FONTES LOCAIS DE RECONSTRUCAO:
--   src/lib/supabase/types.ts
--   docs/backend-audit.md
--   docs/backend-map.md
--   supabase/migrations/20260811120000_rls_scope_carteira.sql
--
-- STATUS: preparada localmente para revisão; NÃO EXECUTADA.
-- Cria somente schema, funções e permissões. Não inclui dados, usuários,
-- arquivos, buckets ou configurações de Auth.
-- =============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Extensões usadas para UUIDs e normalização consistente de projetos.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'app_role'
  ) then
    create type public.app_role as enum ('admin', 'consultant');
  end if;
end
$$;

-- Tipos adotados a partir do contrato TypeScript e do uso no código:
-- IDs/FKs = uuid; Json = jsonb; timestamps = timestamptz; datas = date;
-- number = numeric (integer apenas onde a semântica local é inequívoca).

create table public.profiles (
  id uuid primary key,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  email text,
  full_name text not null default '',
  role public.app_role not null default 'consultant',
  constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  constraint user_roles_user_role_key unique (user_id, role),
  constraint user_roles_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  account_status text not null default 'saudável',
  active boolean not null default true,
  company_name text not null,
  consultant_id uuid,
  created_at timestamptz not null default now(),
  current_quadrant text,
  current_risk_level text not null default 'baixo',
  current_risk_score numeric not null default 0,
  current_satisfaction numeric,
  current_value_score numeric,
  last_meeting_date date,
  next_meeting_date date,
  notes text,
  segment text,
  start_date date,
  updated_at timestamptz not null default now(),
  constraint clients_consultant_id_fkey foreign key (consultant_id) references public.profiles(id) on delete set null
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  consultant_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  description text,
  merged_into_project_id uuid,
  name text not null,
  normalized_name text,
  start_date date,
  status text not null default 'planejamento',
  target_end_date date,
  updated_at timestamptz not null default now(),
  constraint projects_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint projects_consultant_id_fkey foreign key (consultant_id) references public.profiles(id) on delete set null,
  constraint projects_merged_into_project_id_fkey foreign key (merged_into_project_id) references public.projects(id) on delete set null
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  action_deadline date,
  action_owner text,
  analysis_quadrant text,
  analysis_risk_level text,
  calculated_risk_level text not null default 'baixo',
  calculated_risk_score numeric not null default 0,
  client_id uuid not null,
  continuity_doubt boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  executive_summary text,
  expansion_opportunity text,
  explicit_complaint boolean not null default false,
  has_measurable_result boolean not null default false,
  import_hash text,
  low_client_adherence boolean not null default false,
  main_pain text,
  main_priority text,
  main_result text,
  measurable_result text,
  meeting_date date not null,
  meeting_type text,
  missing_internal_owner boolean not null default false,
  next_action text,
  participants text[] not null default '{}'::text[],
  project_id uuid,
  satisfaction_classification text,
  satisfaction_justification text,
  satisfaction_score numeric,
  satisfaction_trend text,
  transcript_hash text,
  transcript_key text,
  value_justification text,
  value_score numeric,
  constraint meetings_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint meetings_project_id_fkey foreign key (project_id) references public.projects(id) on delete set null
);

-- Exclusão de reunião:
-- CASCADE: actions, risks, opportunities, meeting_analyses,
-- analysis_applications, entity_mentions, meeting_evolution,
-- meeting_evolution_items e project_health_snapshots.
-- SET NULL: project_context.last_meeting_id, decisions.meeting_id e
-- meeting_evolution.previous_meeting_id.
-- RESTRICT: nunca remove client ou project por efeito indireto.

create table public.actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  created_at timestamptz not null default now(),
  deadline date,
  description text not null,
  erp_area text,
  evidence text,
  meeting_id uuid,
  owner_name text,
  priority text not null default 'média',
  status text not null default 'não iniciada',
  updated_at timestamptz not null default now(),
  constraint actions_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint actions_meeting_id_fkey foreign key (meeting_id) references public.meetings(id) on delete cascade
);

create table public.risks (
  id uuid primary key default gen_random_uuid(),
  active boolean not null default true,
  client_id uuid not null,
  created_at timestamptz not null default now(),
  description text not null,
  level text not null default 'médio',
  meeting_id uuid,
  constraint risks_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint risks_meeting_id_fkey foreign key (meeting_id) references public.meetings(id) on delete cascade
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  created_at timestamptz not null default now(),
  description text not null,
  expected_benefit text,
  meeting_id uuid,
  status text not null default 'aberta',
  constraint opportunities_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint opportunities_meeting_id_fkey foreign key (meeting_id) references public.meetings(id) on delete cascade
);

create table public.risk_rules (
  id uuid primary key default gen_random_uuid(),
  active boolean not null default true,
  description text,
  points integer not null default 0,
  rule_key text not null,
  rule_name text not null,
  updated_at timestamptz not null default now(),
  constraint risk_rules_rule_key_key unique (rule_key)
);

create table public.project_context (
  id uuid primary key default gen_random_uuid(),
  constraints jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  current_scenario text,
  executive_summary text,
  hypotheses jsonb not null default '[]'::jsonb,
  last_meeting_id uuid,
  main_objective text,
  next_steps jsonb not null default '[]'::jsonb,
  objectives jsonb not null default '[]'::jsonb,
  priorities jsonb not null default '[]'::jsonb,
  problems jsonb not null default '[]'::jsonb,
  project_id uuid not null,
  results jsonb not null default '[]'::jsonb,
  root_causes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint project_context_project_id_key unique (project_id),
  constraint project_context_last_meeting_id_fkey foreign key (last_meeting_id) references public.meetings(id) on delete set null,
  constraint project_context_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  description text,
  due_date date,
  meeting_id uuid,
  owner text,
  project_id uuid not null,
  reason text,
  status text not null default 'pendente',
  supersedes_decision_id uuid,
  title text not null,
  updated_at timestamptz not null default now(),
  constraint decisions_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint decisions_meeting_id_fkey foreign key (meeting_id) references public.meetings(id) on delete set null,
  constraint decisions_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade,
  constraint decisions_supersedes_decision_id_fkey foreign key (supersedes_decision_id) references public.decisions(id) on delete set null
);

create table public.meeting_analyses (
  id uuid primary key default gen_random_uuid(),
  agenda jsonb not null default '{}'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  approved_by uuid,
  client_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  error_message text,
  meeting_id uuid not null,
  project_id uuid,
  provider text not null default 'manual',
  status text not null default 'rascunho',
  transcript text,
  updated_at timestamptz not null default now(),
  constraint meeting_analyses_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint meeting_analyses_meeting_id_fkey foreign key (meeting_id) references public.meetings(id) on delete cascade,
  constraint meeting_analyses_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade
);

create table public.analysis_applications (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid,
  applied_by uuid,
  client_id uuid,
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  meeting_id uuid not null,
  project_id uuid,
  result jsonb not null default '{}'::jsonb,
  constraint analysis_applications_idempotency_key_key unique (idempotency_key),
  constraint analysis_applications_analysis_id_fkey foreign key (analysis_id) references public.meeting_analyses(id) on delete cascade,
  constraint analysis_applications_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint analysis_applications_meeting_id_fkey foreign key (meeting_id) references public.meetings(id) on delete cascade,
  constraint analysis_applications_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade
);

create table public.entity_mentions (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid,
  client_id uuid,
  confidence numeric,
  created_at timestamptz not null default now(),
  created_by uuid,
  entity_id uuid not null,
  entity_type text not null,
  meeting_id uuid,
  mention_type text not null default 'mentioned',
  new_value jsonb,
  previous_value jsonb,
  project_id uuid,
  reason text,
  constraint entity_mentions_analysis_id_fkey foreign key (analysis_id) references public.meeting_analyses(id) on delete cascade,
  constraint entity_mentions_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint entity_mentions_meeting_id_fkey foreign key (meeting_id) references public.meetings(id) on delete cascade,
  constraint entity_mentions_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade
);

create table public.meeting_evolution (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid,
  client_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  meeting_id uuid not null,
  movement text not null default 'estavel',
  previous_meeting_id uuid,
  project_id uuid not null,
  summary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint meeting_evolution_analysis_id_fkey foreign key (analysis_id) references public.meeting_analyses(id) on delete cascade,
  constraint meeting_evolution_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint meeting_evolution_meeting_id_fkey foreign key (meeting_id) references public.meetings(id) on delete cascade,
  constraint meeting_evolution_previous_meeting_id_fkey foreign key (previous_meeting_id) references public.meetings(id) on delete set null,
  constraint meeting_evolution_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade
);

create table public.meeting_evolution_items (
  id uuid primary key default gen_random_uuid(),
  classification text not null,
  client_id uuid,
  confidence numeric,
  created_at timestamptz not null default now(),
  current_state text,
  entity_id uuid,
  entity_type text not null,
  evidence text,
  evolution_id uuid not null,
  label text not null,
  meeting_id uuid,
  previous_state text,
  project_id uuid not null,
  source text not null default 'analysis',
  constraint meeting_evolution_items_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint meeting_evolution_items_evolution_id_fkey foreign key (evolution_id) references public.meeting_evolution(id) on delete cascade,
  constraint meeting_evolution_items_meeting_id_fkey foreign key (meeting_id) references public.meetings(id) on delete cascade,
  constraint meeting_evolution_items_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade
);

create table public.project_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid,
  breakdown jsonb not null default '{}'::jsonb,
  client_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  health_status text not null,
  intervention_priority text not null,
  meeting_id uuid,
  movement text,
  project_id uuid not null,
  reasons jsonb not null default '[]'::jsonb,
  score numeric not null,
  constraint project_health_snapshots_analysis_id_fkey foreign key (analysis_id) references public.meeting_analyses(id) on delete cascade,
  constraint project_health_snapshots_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint project_health_snapshots_meeting_id_fkey foreign key (meeting_id) references public.meetings(id) on delete cascade,
  constraint project_health_snapshots_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade
);

create table public.project_dedupe_log (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid,
  client_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  event text not null,
  merged_from_project_id uuid,
  project_id uuid,
  reason text,
  constraint project_dedupe_log_analysis_id_fkey foreign key (analysis_id) references public.meeting_analyses(id) on delete set null,
  constraint project_dedupe_log_client_id_fkey foreign key (client_id) references public.clients(id) on delete restrict,
  constraint project_dedupe_log_merged_from_project_id_fkey foreign key (merged_from_project_id) references public.projects(id) on delete set null,
  constraint project_dedupe_log_project_id_fkey foreign key (project_id) references public.projects(id) on delete set null
);

-- Índices sustentados pela migration RLS existente.
create index clients_consultant_id_idx on public.clients (consultant_id);
create index meetings_client_id_idx on public.meetings (client_id);
create index meetings_project_id_idx on public.meetings (project_id);
create index actions_client_id_idx on public.actions (client_id);
create index risks_client_id_idx on public.risks (client_id);
create index opportunities_client_id_idx on public.opportunities (client_id);
create index user_roles_user_id_idx on public.user_roles (user_id);
create index meeting_analyses_meeting_id_idx on public.meeting_analyses (meeting_id);
create index meeting_analyses_project_id_idx on public.meeting_analyses (project_id);
create index decisions_project_id_idx on public.decisions (project_id);
create index meeting_evolution_project_id_idx on public.meeting_evolution (project_id);
create index project_health_snapshots_project_id_idx on public.project_health_snapshots (project_id);

-- Deduplicação viva por cliente e nome normalizado.
create unique index projects_client_normalized_name_uidx
  on public.projects (client_id, normalized_name)
  where merged_into_project_id is null and normalized_name is not null;

create unique index meetings_client_transcript_key_uidx
  on public.meetings (client_id, transcript_key)
  where transcript_key is not null;

-- Funções cujo corpo está integralmente sustentado pela migration local.
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'admin'::public.app_role);
$$;

create or replace function public.can_access_client(_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _client_id is not null and (
    public.is_admin()
    or exists (
      select 1 from public.clients c
      where c.id = _client_id and c.consultant_id = auth.uid()
    )
  );
$$;

revoke all on function public.has_role(uuid, public.app_role) from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.can_access_client(uuid) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.can_access_client(uuid) to authenticated, service_role;

-- RPCs exigidas diretamente pelo código atual.
create or replace function public.normalize_project_name(p_name text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select trim(
    regexp_replace(
      extensions.unaccent(lower(coalesce(p_name, ''))),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.merge_context_list(a jsonb, b jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  with source_items as (
    select value as item, ordinality::bigint as position
    from jsonb_array_elements(
      case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end
    ) with ordinality
    union all
    select value as item, 1000000 + ordinality::bigint as position
    from jsonb_array_elements(
      case when jsonb_typeof(b) = 'array' then b else '[]'::jsonb end
    ) with ordinality
  ), deduplicated as (
    select item, min(position) as first_position
    from source_items
    group by item
  )
  select coalesce(jsonb_agg(item order by first_position), '[]'::jsonb)
  from deduplicated;
$$;

create or replace function public.get_or_create_project(
  p_client_id uuid,
  p_name text,
  p_description text default null,
  p_analysis_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_normalized text := public.normalize_project_name(p_name);
  v_project_id uuid;
  v_consultant_id uuid;
begin
  if auth.uid() is null or not public.can_access_client(p_client_id) then
    raise exception 'not authorized for client' using errcode = '42501';
  end if;
  if v_normalized = '' then
    raise exception 'project name is required' using errcode = '22023';
  end if;

  select p.id into v_project_id
  from public.projects p
  where p.client_id = p_client_id
    and p.normalized_name = v_normalized
    and p.merged_into_project_id is null
  limit 1;

  if v_project_id is not null then
    return jsonb_build_object(
      'project_id', v_project_id,
      'reused', true,
      'reason', 'existing normalized project'
    );
  end if;

  select c.consultant_id into v_consultant_id
  from public.clients c
  where c.id = p_client_id;

  begin
    insert into public.projects (
      client_id, consultant_id, created_by, name, normalized_name, description
    ) values (
      p_client_id, v_consultant_id, auth.uid(), trim(p_name), v_normalized, p_description
    ) returning id into v_project_id;
  exception when unique_violation then
    select p.id into v_project_id
    from public.projects p
    where p.client_id = p_client_id
      and p.normalized_name = v_normalized
      and p.merged_into_project_id is null
    limit 1;
    return jsonb_build_object(
      'project_id', v_project_id,
      'reused', true,
      'reason', 'concurrent normalized project'
    );
  end;

  if p_analysis_id is not null then
    insert into public.project_dedupe_log (
      project_id, client_id, analysis_id, event, reason, created_by
    ) values (
      v_project_id, p_client_id, p_analysis_id, 'PROJECT_CREATED',
      'Created by get_or_create_project', auth.uid()
    );
  end if;

  return jsonb_build_object(
    'project_id', v_project_id,
    'reused', false,
    'reason', 'new normalized project'
  );
end;
$$;

create or replace function public.get_or_create_smart_meeting(
  p_client_id uuid,
  p_project_id uuid,
  p_transcript_hash text,
  p_transcript_key text,
  p_meeting_date date,
  p_executive_summary text default null,
  p_meeting_type text default null,
  p_participants text[] default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_meeting_id uuid;
begin
  if auth.uid() is null or not public.can_access_client(p_client_id) then
    raise exception 'not authorized for client' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.client_id = p_client_id
  ) then
    raise exception 'project does not belong to client' using errcode = '23503';
  end if;

  select m.id into v_meeting_id
  from public.meetings m
  where m.client_id = p_client_id and m.transcript_key = p_transcript_key
  limit 1;

  if v_meeting_id is not null then
    return jsonb_build_object('meeting_id', v_meeting_id, 'reused', true);
  end if;

  begin
    insert into public.meetings (
      client_id, project_id, meeting_date, meeting_type, participants,
      executive_summary, transcript_hash, transcript_key, created_by
    ) values (
      p_client_id, p_project_id, p_meeting_date, nullif(p_meeting_type, ''),
      coalesce(p_participants, '{}'::text[]), nullif(p_executive_summary, ''),
      p_transcript_hash, p_transcript_key, auth.uid()
    ) returning id into v_meeting_id;
  exception when unique_violation then
    select m.id into v_meeting_id
    from public.meetings m
    where m.client_id = p_client_id and m.transcript_key = p_transcript_key
    limit 1;
    return jsonb_build_object('meeting_id', v_meeting_id, 'reused', true);
  end;

  return jsonb_build_object('meeting_id', v_meeting_id, 'reused', false);
end;
$$;

create or replace function public.import_meeting(
  p_meeting jsonb,
  p_actions jsonb default '[]'::jsonb,
  p_risks jsonb default '[]'::jsonb,
  p_opportunities jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_client_id uuid := nullif(p_meeting ->> 'client_id', '')::uuid;
  v_project_id uuid := nullif(p_meeting ->> 'project_id', '')::uuid;
  v_meeting_id uuid;
  v_actions integer := 0;
  v_risks integer := 0;
  v_opportunities integer := 0;
begin
  if auth.uid() is null or not public.can_access_client(v_client_id) then
    raise exception 'not authorized for client' using errcode = '42501';
  end if;
  if v_project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = v_project_id and p.client_id = v_client_id
  ) then
    raise exception 'project does not belong to client' using errcode = '23503';
  end if;

  insert into public.meetings (
    client_id, project_id, meeting_date, meeting_type, participants,
    executive_summary, satisfaction_score, satisfaction_classification,
    satisfaction_trend, satisfaction_justification, value_score,
    value_justification, measurable_result, has_measurable_result,
    main_pain, main_priority, main_result, next_action, action_owner,
    action_deadline, expansion_opportunity, explicit_complaint,
    continuity_doubt, low_client_adherence, missing_internal_owner,
    calculated_risk_score, calculated_risk_level, analysis_risk_level,
    analysis_quadrant, import_hash, created_by
  ) values (
    v_client_id,
    v_project_id,
    (p_meeting ->> 'meeting_date')::date,
    nullif(p_meeting ->> 'meeting_type', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_meeting -> 'participants', '[]'::jsonb))), '{}'::text[]),
    nullif(p_meeting ->> 'executive_summary', ''),
    nullif(p_meeting ->> 'satisfaction_score', '')::numeric,
    nullif(p_meeting ->> 'satisfaction_classification', ''),
    nullif(p_meeting ->> 'satisfaction_trend', ''),
    nullif(p_meeting ->> 'satisfaction_justification', ''),
    nullif(p_meeting ->> 'value_score', '')::numeric,
    nullif(p_meeting ->> 'value_justification', ''),
    nullif(p_meeting ->> 'measurable_result', ''),
    coalesce((p_meeting ->> 'has_measurable_result')::boolean, false),
    nullif(p_meeting ->> 'main_pain', ''),
    nullif(p_meeting ->> 'main_priority', ''),
    nullif(p_meeting ->> 'main_result', ''),
    nullif(p_meeting ->> 'next_action', ''),
    nullif(p_meeting ->> 'action_owner', ''),
    nullif(p_meeting ->> 'action_deadline', '')::date,
    nullif(p_meeting ->> 'expansion_opportunity', ''),
    coalesce((p_meeting ->> 'explicit_complaint')::boolean, false),
    coalesce((p_meeting ->> 'continuity_doubt')::boolean, false),
    coalesce((p_meeting ->> 'low_client_adherence')::boolean, false),
    coalesce((p_meeting ->> 'missing_internal_owner')::boolean, false),
    coalesce(nullif(p_meeting ->> 'calculated_risk_score', '')::numeric, 0),
    coalesce(nullif(p_meeting ->> 'calculated_risk_level', ''), 'baixo'),
    nullif(p_meeting ->> 'analysis_risk_level', ''),
    nullif(p_meeting ->> 'analysis_quadrant', ''),
    nullif(p_meeting ->> 'import_hash', ''),
    auth.uid()
  ) returning id into v_meeting_id;

  insert into public.actions (
    client_id, meeting_id, description, owner_name, deadline,
    priority, status, erp_area, evidence
  )
  select v_client_id, v_meeting_id, x.description, x.owner_name, x.deadline,
         coalesce(x.priority, 'média'), coalesce(x.status, 'não iniciada'),
         x.erp_area, x.evidence
  from jsonb_to_recordset(
    case when jsonb_typeof(p_actions) = 'array' then p_actions else '[]'::jsonb end
  ) as x(description text, owner_name text, deadline date, priority text,
         status text, erp_area text, evidence text);
  get diagnostics v_actions = row_count;

  insert into public.risks (client_id, meeting_id, description, level, active)
  select v_client_id, v_meeting_id, x.description, coalesce(x.level, 'médio'),
         coalesce(x.active, true)
  from jsonb_to_recordset(
    case when jsonb_typeof(p_risks) = 'array' then p_risks else '[]'::jsonb end
  ) as x(description text, level text, active boolean);
  get diagnostics v_risks = row_count;

  insert into public.opportunities (
    client_id, meeting_id, description, expected_benefit, status
  )
  select v_client_id, v_meeting_id, x.description, x.expected_benefit,
         coalesce(x.status, 'aberta')
  from jsonb_to_recordset(
    case when jsonb_typeof(p_opportunities) = 'array' then p_opportunities else '[]'::jsonb end
  ) as x(description text, expected_benefit text, status text);
  get diagnostics v_opportunities = row_count;

  return jsonb_build_object(
    'meeting_id', v_meeting_id,
    'actions', v_actions,
    'risks', v_risks,
    'opportunities', v_opportunities
  );
end;
$$;

revoke all on function public.get_or_create_project(uuid, text, text, uuid) from public, anon;
revoke all on function public.get_or_create_smart_meeting(uuid, uuid, text, text, date, text, text, text[]) from public, anon;
revoke all on function public.import_meeting(jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.get_or_create_project(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.get_or_create_smart_meeting(uuid, uuid, text, text, date, text, text, text[]) to authenticated, service_role;
grant execute on function public.import_meeting(jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
revoke all on function public.normalize_project_name(text) from public, anon;
revoke all on function public.merge_context_list(jsonb, jsonb) from public, anon;
grant execute on function public.normalize_project_name(text) to authenticated, service_role;
grant execute on function public.merge_context_list(jsonb, jsonb) to authenticated, service_role;

-- Triggers de updated_at documentados e colunas equivalentes do schema.
--   decisions_touch          BEFORE UPDATE ON public.decisions
--   project_context_touch    BEFORE UPDATE ON public.project_context
--   projects_touch           BEFORE UPDATE ON public.projects
--   meeting_analyses_touch   BEFORE UPDATE ON public.meeting_analyses
--   meeting_evolution_touch  BEFORE UPDATE ON public.meeting_evolution

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), ''),
    'consultant'::public.app_role,
    true
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = case
        when public.profiles.full_name = '' then excluded.full_name
        else public.profiles.full_name
      end;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create trigger clients_touch before update on public.clients
for each row execute function public.touch_updated_at();
create trigger projects_touch before update on public.projects
for each row execute function public.touch_updated_at();
create trigger actions_touch before update on public.actions
for each row execute function public.touch_updated_at();
create trigger risk_rules_touch before update on public.risk_rules
for each row execute function public.touch_updated_at();
create trigger project_context_touch before update on public.project_context
for each row execute function public.touch_updated_at();
create trigger decisions_touch before update on public.decisions
for each row execute function public.touch_updated_at();
create trigger meeting_analyses_touch before update on public.meeting_analyses
for each row execute function public.touch_updated_at();
create trigger meeting_evolution_touch before update on public.meeting_evolution
for each row execute function public.touch_updated_at();

-- RLS é habilitada aqui; a matriz de acesso é criada na migration seguinte.
alter table public.actions enable row level security;
alter table public.analysis_applications enable row level security;
alter table public.clients enable row level security;
alter table public.decisions enable row level security;
alter table public.entity_mentions enable row level security;
alter table public.meeting_analyses enable row level security;
alter table public.meeting_evolution enable row level security;
alter table public.meeting_evolution_items enable row level security;
alter table public.meetings enable row level security;
alter table public.opportunities enable row level security;
alter table public.profiles enable row level security;
alter table public.project_context enable row level security;
alter table public.project_dedupe_log enable row level security;
alter table public.project_health_snapshots enable row level security;
alter table public.projects enable row level security;
alter table public.risk_rules enable row level security;
alter table public.risks enable row level security;
alter table public.user_roles enable row level security;

-- Grants e policies são aplicados pela migration de RLS imediatamente seguinte.
commit;
