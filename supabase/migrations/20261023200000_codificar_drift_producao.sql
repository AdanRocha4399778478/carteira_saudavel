-- =============================================================================
-- Codifica no repositório 3 ajustes que já estão ativos em PRODUÇÃO e nunca
-- viraram migration (encontrados na comparação dev × produção de 2026-10-23,
-- Gate 2a, passo 6). Em produção esta migration é NO-OP: o banco já está assim.
-- No dev (e em qualquer ambiente recriado do zero) ela alinha com produção.
--
-- 1. get_or_create_project_erp com a regra R01 (classifica projeto existente
--    sem classificação ERP em vez de só reutilizar).
-- 2. Grants: retira do anon SELECT/INSERT/UPDATE/DELETE nas tabelas do public
--    e remove grants extras em views/email_events/project_dedupe_log;
--    ajusta default privileges do role postgres como em produção.
-- 3. DELETE em actions, risks e opportunities: só admin (regra vigente em
--    produção, mantida por decisão do Adan em 2026-10-23).
-- =============================================================================

-- ---------- 1. get_or_create_project_erp (versão de produção, com R01) ----------
CREATE OR REPLACE FUNCTION public.get_or_create_project_erp(p_client_id uuid, p_name text, p_erp_area text, p_erp_subarea text, p_erp_item text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_analysis_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    -- R01: classifica agora se ainda estiver sem classificacao; nunca
    -- sobrescreve quem ja tem (o ramo 1, rodado na mesma chamada, ja
    -- garantiu que esta classificacao nao colide com outro projeto vivo).
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

-- ---------- 2. Grants (estado de produção) ----------
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;

REVOKE INSERT, UPDATE, DELETE ON public.cockpit_project_risk_counts FROM authenticated, service_role;
REVOKE SELECT ON public.cockpit_project_risk_counts FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON public.latest_project_evolution FROM authenticated, service_role;
REVOKE SELECT ON public.latest_project_evolution FROM service_role;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.email_events FROM authenticated;
REVOKE DELETE ON public.email_events FROM service_role;
REVOKE UPDATE, DELETE ON public.project_dedupe_log FROM authenticated;

-- Default privileges do role postgres no schema public, como em produção:
-- tabelas novas não ganham leitura/escrita automática; cada migration
-- concede explicitamente o que precisa (padrão já seguido no repositório).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;

-- ---------- 3. DELETE só para admin em actions, risks, opportunities ----------
DROP POLICY IF EXISTS "actions delete" ON public.actions;
CREATE POLICY "actions delete" ON public.actions FOR DELETE TO authenticated
USING (app_private.is_admin());

DROP POLICY IF EXISTS "risks delete" ON public.risks;
CREATE POLICY "risks delete" ON public.risks FOR DELETE TO authenticated
USING (app_private.is_admin());

DROP POLICY IF EXISTS "opportunities delete" ON public.opportunities;
CREATE POLICY "opportunities delete" ON public.opportunities FOR DELETE TO authenticated
USING (app_private.is_admin());
