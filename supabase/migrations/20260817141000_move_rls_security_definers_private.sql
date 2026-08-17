-- Carteira Saudável 2.0
-- Move helpers SECURITY DEFINER usados por RLS para um schema não exposto
-- pela Data API, preservando compatibilidade com referências public.* por meio
-- de wrappers SECURITY INVOKER.
--
-- Objetivo: manter o bypass de RLS necessário aos helpers sem deixar funções
-- elevadas no schema public, seguindo a recomendação do Supabase.

begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

-- Move os helpers elevados existentes. Dependências armazenadas pelo Postgres
-- (como expressions de policies) acompanham o OID da função automaticamente.
alter function public.has_role(uuid, public.app_role) set schema app_private;
alter function public.is_admin() set schema app_private;
alter function public.can_access_client(uuid) set schema app_private;
alter function public.can_access_project(uuid) set schema app_private;
alter function public.can_access_meeting(uuid) set schema app_private;
alter function public.can_access_scope(uuid, uuid, uuid) set schema app_private;
alter function public.can_access_related_scope(uuid, uuid, uuid, uuid, uuid) set schema app_private;

-- No schema privado, somente usuários autenticados (para avaliação das policies)
-- e service_role podem executar. O schema não é exposto pela Data API.
revoke all on function app_private.has_role(uuid, public.app_role) from public, anon;
revoke all on function app_private.is_admin() from public, anon;
revoke all on function app_private.can_access_client(uuid) from public, anon;
revoke all on function app_private.can_access_project(uuid) from public, anon;
revoke all on function app_private.can_access_meeting(uuid) from public, anon;
revoke all on function app_private.can_access_scope(uuid, uuid, uuid) from public, anon;
revoke all on function app_private.can_access_related_scope(uuid, uuid, uuid, uuid, uuid) from public, anon;

grant execute on function app_private.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function app_private.is_admin() to authenticated, service_role;
grant execute on function app_private.can_access_client(uuid) to authenticated, service_role;
grant execute on function app_private.can_access_project(uuid) to authenticated, service_role;
grant execute on function app_private.can_access_meeting(uuid) to authenticated, service_role;
grant execute on function app_private.can_access_scope(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function app_private.can_access_related_scope(uuid, uuid, uuid, uuid, uuid) to authenticated, service_role;

-- Wrappers public.* mantêm compatibilidade com funções PL/pgSQL/SQL antigas que
-- referenciam os helpers pelo nome textual. Estes wrappers NÃO são definer.
create function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.has_role(_user_id, _role);
$$;

create function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.is_admin();
$$;

create function public.can_access_client(_client_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.can_access_client(_client_id);
$$;

create function public.can_access_project(_project_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.can_access_project(_project_id);
$$;

create function public.can_access_meeting(_meeting_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.can_access_meeting(_meeting_id);
$$;

create function public.can_access_scope(
  p_client_id uuid,
  p_project_id uuid,
  p_meeting_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.can_access_scope(p_client_id, p_project_id, p_meeting_id);
$$;

create function public.can_access_related_scope(
  p_client_id uuid,
  p_project_id uuid,
  p_meeting_id uuid,
  p_analysis_id uuid,
  p_evolution_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.can_access_related_scope(
    p_client_id,
    p_project_id,
    p_meeting_id,
    p_analysis_id,
    p_evolution_id
  );
$$;

-- Funções em public não devem voltar ao EXECUTE implícito de PUBLIC.
revoke all on function public.has_role(uuid, public.app_role) from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.can_access_client(uuid) from public, anon;
revoke all on function public.can_access_project(uuid) from public, anon;
revoke all on function public.can_access_meeting(uuid) from public, anon;
revoke all on function public.can_access_scope(uuid, uuid, uuid) from public, anon;
revoke all on function public.can_access_related_scope(uuid, uuid, uuid, uuid, uuid) from public, anon;

grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.can_access_client(uuid) to authenticated, service_role;
grant execute on function public.can_access_project(uuid) to authenticated, service_role;
grant execute on function public.can_access_meeting(uuid) to authenticated, service_role;
grant execute on function public.can_access_scope(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.can_access_related_scope(uuid, uuid, uuid, uuid, uuid) to authenticated, service_role;

commit;
