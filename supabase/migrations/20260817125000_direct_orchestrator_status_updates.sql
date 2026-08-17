-- Carteira Saudável 2.0
-- Fase 2: remove a RPC SECURITY DEFINER do fluxo de status e volta ao
-- modelo nativo de privilégios por coluna + RLS + trigger SECURITY INVOKER.

begin;

-- authenticated pode alterar somente a coluna status. Metadados de aprovação
-- continuam controlados pelo banco e não podem ser escritos diretamente.
revoke update on public.orchestrator_recommendations from authenticated;
grant update (status) on public.orchestrator_recommendations to authenticated;

create or replace function public.validate_orchestrator_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Ownership explícito: somente admin ou o consultor gravado na própria
  -- recomendação pode realizar uma transição.
  if not (public.is_admin() or old.owner_id = auth.uid()) then
    raise exception 'not authorized for recommendation owner' using errcode = '42501';
  end if;

  if not public.can_access_scope(old.client_id, old.project_id, NULL) then
    raise exception 'not authorized for recommendation scope' using errcode = '42501';
  end if;

  if not (
    (old.status = 'suggested' and new.status in ('approved', 'rejected', 'superseded'))
    or (old.status = 'approved' and new.status in ('executed', 'superseded'))
  ) then
    raise exception 'invalid recommendation status transition: % -> %', old.status, new.status
      using errcode = '22023';
  end if;

  -- approval metadata é sempre derivado no banco, nunca enviado pelo cliente.
  if new.status = 'approved' then
    new.approved_at := now();
    new.approved_by := auth.uid();
  elsif new.status in ('rejected', 'superseded') then
    new.approved_at := null;
    new.approved_by := null;
  else
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_orchestrator_status_transition()
  from public, anon, authenticated;

drop trigger if exists orchestrator_recommendations_validate_status
  on public.orchestrator_recommendations;
create trigger orchestrator_recommendations_validate_status
before update of status on public.orchestrator_recommendations
for each row execute function public.validate_orchestrator_status_transition();

-- RLS permanece como segunda barreira. A linha precisa pertencer ao usuário
-- (ou admin) e continuar coerente com o escopo cliente/projeto após o trigger.
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

-- A RPC elevada deixa de fazer parte da superfície autenticada.
revoke all on function public.update_orchestrator_recommendation_status(uuid, public.orchestrator_status)
  from public, anon, authenticated, service_role;
drop function public.update_orchestrator_recommendation_status(uuid, public.orchestrator_status);

commit;
