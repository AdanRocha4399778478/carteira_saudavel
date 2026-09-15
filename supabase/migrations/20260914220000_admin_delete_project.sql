-- GATE 11B — exclusão administrativa segura de projeto órfão/residual.
--
-- Mesmo padrão de admin_undo_meeting (20260914161758): wrapper público
-- SECURITY INVOKER fino chamando uma função privilegiada em app_private que
-- valida o papel admin pelo JWT (auth.uid()) e usa search_path vazio.
-- Nenhuma tabela/coluna arbitrária é aceita — os dois RPCs só operam sobre
-- public.projects, identificado pelo próprio p_project_id.
--
-- admin_delete_project NUNCA apaga meetings/actions/risks/decisions/
-- opportunities diretamente: apaga só a linha de public.projects e deixa
-- as FKs do schema já existentes agirem (a maioria ON DELETE CASCADE; ver
-- comentário do schema inicial). O bloqueio de segurança acontece ANTES do
-- DELETE, checando que não sobra nenhuma dependência operacional.

begin;

create or replace function app_private.admin_delete_project_preview(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_client_name text;
  v_meetings_count integer;
  v_actions_count integer;
  v_risks_count integer;
  v_decisions_count integer;
  v_opportunities_count integer;
  v_analysis_applications_count integer;
  v_orchestrator_recommendations_count integer;
  v_context public.project_context%rowtype;
  v_has_context boolean := false;
  v_context_is_empty boolean := true;
  v_can_delete boolean := false;
  v_blocking_reason text := null;
begin
  if not coalesce(app_private.is_admin(), false) then
    raise exception 'Apenas administradores podem visualizar o impacto de excluir um projeto.'
      using errcode = '42501';
  end if;

  select *
    into v_project
  from public.projects
  where id = p_project_id;

  if not found then
    raise exception 'Projeto % não encontrado.', p_project_id
      using errcode = 'P0002';
  end if;

  select company_name into v_client_name from public.clients where id = v_project.client_id;

  select count(*) into v_meetings_count
  from public.meetings m
  where m.project_id = p_project_id;

  -- actions/risks/opportunities não têm project_id próprio — só chegam a um
  -- projeto por meio da reunião que os criou (ver src/lib/meeting-analysis.ts).
  select count(*) into v_actions_count
  from public.actions a
  join public.meetings m on m.id = a.meeting_id
  where m.project_id = p_project_id;

  select count(*) into v_risks_count
  from public.risks r
  join public.meetings m on m.id = r.meeting_id
  where m.project_id = p_project_id;

  select count(*) into v_opportunities_count
  from public.opportunities o
  join public.meetings m on m.id = o.meeting_id
  where m.project_id = p_project_id;

  select count(*) into v_decisions_count
  from public.decisions d
  where d.project_id = p_project_id;

  select count(*) into v_analysis_applications_count
  from public.analysis_applications aa
  where aa.project_id = p_project_id;

  -- Informativo apenas: gerada automaticamente pelo orquestrador (ver
  -- src/lib/orchestrator.ts), FK ON DELETE CASCADE — nunca bloqueia.
  select count(*) into v_orchestrator_recommendations_count
  from public.orchestrator_recommendations orr
  where orr.project_id = p_project_id;

  select * into v_context from public.project_context where project_id = p_project_id;
  v_has_context := found;
  if v_has_context then
    v_context_is_empty :=
      coalesce(jsonb_array_length(v_context.objectives), 0) = 0
      and coalesce(jsonb_array_length(v_context.problems), 0) = 0
      and coalesce(jsonb_array_length(v_context.root_causes), 0) = 0
      and coalesce(jsonb_array_length(v_context.priorities), 0) = 0
      and coalesce(jsonb_array_length(v_context.hypotheses), 0) = 0
      and coalesce(jsonb_array_length(v_context.constraints), 0) = 0
      and coalesce(jsonb_array_length(v_context.results), 0) = 0
      and coalesce(jsonb_array_length(v_context.next_steps), 0) = 0
      and coalesce(nullif(trim(v_context.executive_summary), ''), '') = ''
      and coalesce(nullif(trim(v_context.current_scenario), ''), '') = ''
      and coalesce(nullif(trim(v_context.main_objective), ''), '') = '';
  end if;

  -- Ordem determinística: primeira condição violada vira o motivo mostrado ao admin.
  if v_project.merged_into_project_id is not null then
    v_blocking_reason := 'Este projeto foi mesclado em outro projeto e não pode ser excluído por este fluxo.';
  elsif v_meetings_count > 0 then
    v_blocking_reason := format('Existe(m) %s reunião(ões) vinculada(s) a este projeto.', v_meetings_count);
  elsif v_actions_count > 0 then
    v_blocking_reason := format('Existe(m) %s ação(ões) vinculada(s) a este projeto.', v_actions_count);
  elsif v_risks_count > 0 then
    v_blocking_reason := format('Existe(m) %s risco(s) vinculado(s) a este projeto.', v_risks_count);
  elsif v_decisions_count > 0 then
    v_blocking_reason := format('Existe(m) %s decisão(ões) vinculada(s) a este projeto.', v_decisions_count);
  elsif v_opportunities_count > 0 then
    v_blocking_reason := format('Existe(m) %s oportunidade(s) vinculada(s) a este projeto.', v_opportunities_count);
  elsif v_analysis_applications_count > 0 then
    v_blocking_reason := format(
      'Existe(m) %s aplicação(ões) de análise vinculada(s) a este projeto.', v_analysis_applications_count
    );
  elsif not v_context_is_empty then
    v_blocking_reason := 'O contexto do projeto ainda contém conteúdo preenchido.';
  else
    v_can_delete := true;
  end if;

  return jsonb_build_object(
    'project_id', v_project.id,
    'project_name', v_project.name,
    'client_id', v_project.client_id,
    'client_name', v_client_name,
    'can_delete', v_can_delete,
    'blocking_reason', v_blocking_reason,
    'counts', jsonb_build_object(
      'meetings', v_meetings_count,
      'actions', v_actions_count,
      'risks', v_risks_count,
      'decisions', v_decisions_count,
      'opportunities', v_opportunities_count,
      'analysis_applications', v_analysis_applications_count,
      'orchestrator_recommendations', v_orchestrator_recommendations_count
    ),
    'has_project_context', v_has_context,
    'project_context_is_empty', v_context_is_empty
  );
end;
$$;

create or replace function app_private.admin_delete_project(p_project_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_preview jsonb;
  v_row_count integer := 0;
begin
  if not coalesce(app_private.is_admin(), false) then
    raise exception 'Apenas administradores podem excluir um projeto.'
      using errcode = '42501';
  end if;

  -- Trava a linha para serializar duas chamadas concorrentes sobre o MESMO
  -- projeto; em seguida a checagem é refeita do zero (não confia no preview
  -- do cliente) contra o estado já commitado nas demais tabelas.
  perform 1 from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'Projeto % não encontrado.', p_project_id
      using errcode = 'P0002';
  end if;

  v_preview := app_private.admin_delete_project_preview(p_project_id);

  if not coalesce((v_preview ->> 'can_delete')::boolean, false) then
    raise exception 'Exclusão bloqueada: %', coalesce(v_preview ->> 'blocking_reason', 'motivo desconhecido')
      using errcode = 'P0001';
  end if;

  -- Único DELETE: só a linha do projeto. Tudo o mais é efeito das FKs já
  -- existentes no schema (a maioria ON DELETE CASCADE; meetings.project_id é
  -- SET NULL, mas a checagem acima já garante meetings_count = 0 aqui).
  delete from public.projects where id = p_project_id;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception 'O projeto % não pôde ser excluído.', p_project_id
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'project_id', v_preview ->> 'project_id',
    'project_name', v_preview ->> 'project_name',
    'client_id', v_preview ->> 'client_id',
    'client_name', v_preview ->> 'client_name',
    'deleted', true
  );
end;
$$;

create or replace function public.admin_delete_project_preview(p_project_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.admin_delete_project_preview(p_project_id);
$$;

create or replace function public.admin_delete_project(p_project_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.admin_delete_project(p_project_id);
$$;

revoke all on function app_private.admin_delete_project_preview(uuid) from public, anon, service_role;
revoke all on function app_private.admin_delete_project(uuid) from public, anon, service_role;
revoke all on function public.admin_delete_project_preview(uuid) from public, anon, service_role;
revoke all on function public.admin_delete_project(uuid) from public, anon, service_role;

grant execute on function app_private.admin_delete_project_preview(uuid) to authenticated;
grant execute on function app_private.admin_delete_project(uuid) to authenticated;
grant execute on function public.admin_delete_project_preview(uuid) to authenticated;
grant execute on function public.admin_delete_project(uuid) to authenticated;

comment on function public.admin_delete_project_preview(uuid) is
  'Admin-only: calcula se um projeto pode ser excluído com segurança, sem mutação.';
comment on function public.admin_delete_project(uuid) is
  'Admin-only: revalida as condições de segurança e exclui o projeto em uma única transação.';

commit;
