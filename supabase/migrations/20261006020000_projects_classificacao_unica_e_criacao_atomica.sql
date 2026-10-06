-- Um projeto por classificacao do ERP por cliente + criacao atomica de projeto classificado.
--
-- O que faz (aditiva e reversivel):
--   1) Indice unico: no maximo UM projeto vivo por (cliente, area, subarea, item) do ERP.
--      Projetos sem classificacao (erp_area nula) ficam fora da regra.
--   2) Funcao get_or_create_project_erp: cria o projeto JA classificado em um unico passo
--      (antes: criar pelo nome e gravar area/subarea depois, em dois passos, o que podia deixar
--      um projeto sem classificacao). Procura primeiro por classificacao, depois por nome
--      normalizado, e so entao cria. A funcao antiga get_or_create_project NAO e alterada.
--
-- ROLLBACK (se necessario):
--   drop function if exists public.get_or_create_project_erp(uuid, text, text, text, text, text, uuid);
--   drop index if exists public.projects_client_erp_classification_uidx;

begin;

-- 1) Trava de classificacao.
create unique index if not exists projects_client_erp_classification_uidx
  on public.projects (client_id, erp_area, coalesce(erp_subarea, ''), coalesce(erp_item, ''))
  where merged_into_project_id is null and erp_area is not null;

-- 2) Criacao atomica de projeto classificado.
create or replace function public.get_or_create_project_erp(
  p_client_id uuid,
  p_name text,
  p_erp_area text,
  p_erp_subarea text,
  p_erp_item text default null,
  p_description text default null,
  p_analysis_id uuid default null
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_normalized text := public.normalize_project_name(p_name);
  v_area text := nullif(trim(p_erp_area), '');
  v_subarea text := nullif(trim(p_erp_subarea), '');
  v_item text := nullif(trim(p_erp_item), '');
  v_project_id uuid;
  v_consultant_id uuid;
begin
  if auth.uid() is null or not public.can_access_client(p_client_id) then
    raise exception 'not authorized for client' using errcode = '42501';
  end if;
  if v_normalized = '' then
    raise exception 'project name is required' using errcode = '22023';
  end if;
  if v_area is null or v_subarea is null then
    raise exception 'erp area and subarea are required' using errcode = '22023';
  end if;

  -- 1) Ja existe projeto vivo com esta classificacao neste cliente?
  select p.id into v_project_id
  from public.projects p
  where p.client_id = p_client_id
    and p.merged_into_project_id is null
    and p.erp_area = v_area
    and coalesce(p.erp_subarea, '') = v_subarea
    and coalesce(p.erp_item, '') = coalesce(v_item, '')
  limit 1;

  if v_project_id is not null then
    return jsonb_build_object(
      'project_id', v_project_id,
      'reused', true,
      'reason', 'existing erp classification'
    );
  end if;

  -- 2) Ja existe projeto vivo (sem classificacao) com o mesmo nome normalizado?
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
      client_id, consultant_id, created_by, name, normalized_name, description,
      erp_area, erp_subarea, erp_item
    ) values (
      p_client_id, v_consultant_id, auth.uid(), trim(p_name), v_normalized, p_description,
      v_area, v_subarea, v_item
    ) returning id into v_project_id;
  exception when unique_violation then
    select p.id into v_project_id
    from public.projects p
    where p.client_id = p_client_id
      and p.merged_into_project_id is null
      and (
        (p.erp_area = v_area
          and coalesce(p.erp_subarea, '') = v_subarea
          and coalesce(p.erp_item, '') = coalesce(v_item, ''))
        or p.normalized_name = v_normalized
      )
    limit 1;
    return jsonb_build_object(
      'project_id', v_project_id,
      'reused', true,
      'reason', 'concurrent project'
    );
  end;

  if p_analysis_id is not null then
    insert into public.project_dedupe_log (
      project_id, client_id, analysis_id, event, reason, created_by
    ) values (
      v_project_id, p_client_id, p_analysis_id, 'PROJECT_CREATED',
      'Created by get_or_create_project_erp', auth.uid()
    );
  end if;

  return jsonb_build_object(
    'project_id', v_project_id,
    'reused', false,
    'reason', 'new erp project'
  );
end;
$function$;

revoke all on function public.get_or_create_project_erp(uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.get_or_create_project_erp(uuid, text, text, text, text, text, uuid) to authenticated;

commit;
