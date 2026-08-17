-- Carteira Saudável 2.0
-- Fecha bypass de workflow no INSERT de recomendações.
-- authenticated só pode fornecer os campos de conteúdo; campos de controle
-- são definidos pelo banco/trigger.

begin;

revoke insert on public.orchestrator_recommendations from authenticated;

grant insert (
  project_id,
  project_stage,
  main_bottleneck,
  recommended_agent,
  confidence,
  reason,
  expected_result,
  evidence,
  alternative_agent,
  alternative_reason,
  erp_classification,
  source,
  state_hash
) on public.orchestrator_recommendations to authenticated;

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

  -- Escopo e autoria sempre vêm do banco.
  new.client_id := v_client_id;
  new.owner_id := v_owner_id;

  if tg_op = 'INSERT' then
    new.id := coalesce(new.id, gen_random_uuid());
    new.status := 'suggested';
    new.created_by := auth.uid();
    new.created_at := coalesce(new.created_at, now());
    new.approved_at := null;
    new.approved_by := null;
  else
    -- UPDATEs comuns não podem trocar identidade/autoria da recomendação.
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  return new;
end;
$$;

-- Policy de INSERT fica explícita sobre o estado inicial controlado pelo banco.
drop policy if exists orchestrator_recommendations_insert
  on public.orchestrator_recommendations;

create policy orchestrator_recommendations_insert
  on public.orchestrator_recommendations
  for insert
  to authenticated
  with check (
    public.can_access_scope(client_id, project_id, NULL)
    and owner_id = auth.uid()
    and created_by = auth.uid()
    and status = 'suggested'
    and approved_at is null
    and approved_by is null
  );

commit;
