-- Carteira Saudável 2.0
-- Torna explícita a propriedade das recomendações do orquestrador.
-- owner_id sempre deriva do consultor responsável pelo cliente; o frontend
-- não escolhe nem altera esse campo.

begin;

alter table public.orchestrator_recommendations
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

create index if not exists orchestrator_recommendations_owner_idx
  on public.orchestrator_recommendations (owner_id);

-- Backfill: recomendações existentes passam a pertencer ao consultor
-- atualmente responsável pelo cliente.
update public.orchestrator_recommendations r
set owner_id = c.consultant_id
from public.clients c
where c.id = r.client_id
  and r.owner_id is distinct from c.consultant_id;

-- O escopo da recomendação passa a definir também o proprietário.
create or replace function public.set_orchestrator_recommendation_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_client_id uuid;
  v_owner_id uuid;
begin
  select p.client_id, c.consultant_id
    into v_client_id, v_owner_id
  from public.projects p
  join public.clients c on c.id = p.client_id
  where p.id = new.project_id;

  if v_client_id is null then
    raise exception 'project not found' using errcode = '23503';
  end if;

  if not public.can_access_project(new.project_id) then
    raise exception 'not authorized for project' using errcode = '42501';
  end if;

  new.client_id := v_client_id;
  new.owner_id := v_owner_id;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;

-- Quando o cliente troca de consultor, ownership das recomendações acompanha
-- a responsabilidade atual da carteira.
create or replace function public.sync_orchestrator_owner_from_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.consultant_id is distinct from old.consultant_id then
    update public.orchestrator_recommendations
    set owner_id = new.consultant_id
    where client_id = new.id
      and owner_id is distinct from new.consultant_id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_orchestrator_owner_from_client() from public, anon, authenticated;

drop trigger if exists clients_sync_orchestrator_owner on public.clients;
create trigger clients_sync_orchestrator_owner
after update of consultant_id on public.clients
for each row
when (old.consultant_id is distinct from new.consultant_id)
execute function public.sync_orchestrator_owner_from_client();

-- Atualiza a policy de defesa em profundidade para ownership explícito.
drop policy if exists orchestrator_recommendations_update
  on public.orchestrator_recommendations;

create policy orchestrator_recommendations_update
  on public.orchestrator_recommendations
  for update
  to authenticated
  using (
    public.is_admin()
    or owner_id = auth.uid()
  )
  with check (
    (public.is_admin() or owner_id = auth.uid())
    and public.can_access_scope(client_id, project_id, NULL)
    and (
      (status = 'approved' and approved_by = auth.uid() and approved_at is not null)
      or (
        status in ('rejected', 'executed', 'superseded')
        and (
          status = 'executed'
          or (approved_by is null and approved_at is null)
        )
      )
    )
  );

-- RPC: a autorização deixa de ser inferida por JOIN e passa a usar owner_id
-- gravado na própria recomendação. A validação de escopo permanece como
-- segunda barreira contra inconsistências entre projeto e cliente.
create or replace function public.update_orchestrator_recommendation_status(
  p_recommendation_id uuid,
  p_status public.orchestrator_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status public.orchestrator_status;
  v_project_id uuid;
  v_client_id uuid;
  v_owner_id uuid;
  v_approved_at timestamptz;
  v_approved_by uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_status not in ('approved', 'rejected', 'executed', 'superseded') then
    raise exception 'invalid recommendation status transition' using errcode = '22023';
  end if;

  select r.status, r.project_id, r.client_id, r.owner_id, r.approved_at, r.approved_by
    into v_current_status, v_project_id, v_client_id, v_owner_id, v_approved_at, v_approved_by
  from public.orchestrator_recommendations r
  where r.id = p_recommendation_id
  for update;

  if not found then
    raise exception 'recommendation not found' using errcode = 'P0002';
  end if;

  if not (public.is_admin() or v_owner_id = auth.uid()) then
    raise exception 'not authorized for recommendation owner' using errcode = '42501';
  end if;

  if not public.can_access_scope(v_client_id, v_project_id, NULL) then
    raise exception 'not authorized for recommendation scope' using errcode = '42501';
  end if;

  if not (
    (v_current_status = 'suggested' and p_status in ('approved', 'rejected', 'superseded'))
    or (v_current_status = 'approved' and p_status in ('executed', 'superseded'))
  ) then
    raise exception 'invalid recommendation status transition: % -> %', v_current_status, p_status
      using errcode = '22023';
  end if;

  update public.orchestrator_recommendations
  set
    status = p_status,
    approved_at = case
      when p_status = 'approved' then now()
      when p_status in ('rejected', 'superseded') then null
      else v_approved_at
    end,
    approved_by = case
      when p_status = 'approved' then auth.uid()
      when p_status in ('rejected', 'superseded') then null
      else v_approved_by
    end
  where id = p_recommendation_id;
end;
$$;

revoke all on function public.update_orchestrator_recommendation_status(uuid, public.orchestrator_status)
  from public, anon;
grant execute on function public.update_orchestrator_recommendation_status(uuid, public.orchestrator_status)
  to authenticated, service_role;

comment on column public.orchestrator_recommendations.owner_id is
  'Consultant explicitly responsible for this recommendation; synchronized from clients.consultant_id.';

commit;
