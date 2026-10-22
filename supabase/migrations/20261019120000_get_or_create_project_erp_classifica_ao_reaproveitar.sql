-- R01 (19/10/2026): get_or_create_project_erp, ramo 2 (reaproveita projeto
-- existente SEM classificacao pelo nome normalizado), devolvia o projeto
-- sem nunca gravar nele a Area/Subarea/Item escolhidos na Identificacao —
-- a classificacao se perdia silenciosamente. Area/Subarea ja chegam
-- normalizadas (v_area/v_subarea/v_item) nesse ponto da funcao; so faltava
-- gravar.
--
-- O que muda (so o ramo 2, resto da funcao idêntico):
--   Antes de devolver o projeto reaproveitado por nome, se ele ainda
--   estiver SEM classificacao (erp_area nulo ou vazio), grava nele
--   erp_area/erp_subarea/erp_item com um UPDATE guardado por
--   "WHERE ... AND (erp_area IS NULL OR erp_area = '')" — nunca sobrescreve
--   um projeto que ja tem classificacao (ela fica como esta, reason
--   continua "existing normalized project"). Sem risco de colidir com o
--   indice unico de classificacao (projects_client_erp_classification_uidx,
--   da migration 20261006020000): o ramo 1 da MESMA chamada ja confirmou,
--   segundos antes, que NENHUM projeto deste cliente tem essa classificacao
--   — se tivesse, a funcao já teria retornado ali.
--
-- ROLLBACK (se necessario): reaplicar a versao anterior da funcao, de
-- supabase/migrations/20261006020000_projects_classificacao_unica_e_criacao_atomica.sql
-- (CREATE OR REPLACE FUNCTION com o corpo de la).

begin;

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
    -- R01: classifica agora se ainda estiver sem classificacao — nunca
    -- sobrescreve quem ja tem (o ramo 1, rodado segundos antes na mesma
    -- chamada, ja garantiu que esta classificacao não colide com outro
    -- projeto vivo deste cliente).
    update public.projects
    set erp_area = v_area, erp_subarea = v_subarea, erp_item = v_item
    where id = v_project_id
      and (erp_area is null or erp_area = '');

    if found then
      return jsonb_build_object(
        'project_id', v_project_id,
        'reused', true,
        'reason', 'existing normalized project (classified)'
      );
    end if;

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
