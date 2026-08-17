-- Carteira Saudável 2.0
-- Remove UPDATE direto de authenticated em orchestrator_recommendations e
-- concentra as transições de status em uma RPC com validação explícita.

begin;

revoke update (status, approved_at, approved_by)
  on public.orchestrator_recommendations
  from authenticated;

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
  v_approved_at timestamptz;
  v_approved_by uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_status not in ('approved', 'rejected', 'executed', 'superseded') then
    raise exception 'invalid recommendation status transition' using errcode = '22023';
  end if;

  select r.status, r.project_id, r.client_id, r.approved_at, r.approved_by
    into v_current_status, v_project_id, v_client_id, v_approved_at, v_approved_by
  from public.orchestrator_recommendations r
  where r.id = p_recommendation_id
  for update;

  if not found then
    raise exception 'recommendation not found' using errcode = 'P0002';
  end if;

  if not (
    public.is_admin()
    or exists (
      select 1
      from public.projects p
      join public.clients c on c.id = p.client_id
      where p.id = v_project_id
        and p.client_id = v_client_id
        and c.consultant_id = auth.uid()
    )
  ) then
    raise exception 'not authorized for recommendation' using errcode = '42501';
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

-- Mantém a policy de UPDATE como defesa adicional caso privilégios de tabela
-- sejam concedidos novamente no futuro. O fluxo normal do frontend usa a RPC.

commit;
