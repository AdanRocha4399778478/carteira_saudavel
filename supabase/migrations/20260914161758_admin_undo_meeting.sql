-- Fundação backend para desfazer uma reunião com segurança.
--
-- As funções públicas são wrappers SECURITY INVOKER. O trabalho privilegiado
-- fica em app_private, valida o papel admin pelo JWT e usa search_path vazio.
-- Qualquer exceção aborta toda a chamada, inclusive restaurações já iniciadas.

begin;

create or replace function app_private.admin_undo_entity_exists(
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  case p_entity_type
    when 'action' then
      return exists (select 1 from public.actions where id = p_entity_id);
    when 'risk' then
      return exists (select 1 from public.risks where id = p_entity_id);
    when 'opportunity' then
      return exists (select 1 from public.opportunities where id = p_entity_id);
    when 'decision' then
      return exists (select 1 from public.decisions where id = p_entity_id);
    else
      return false;
  end case;
end;
$$;

create or replace function app_private.admin_undo_snapshot_is_sufficient(
  p_entity_type text,
  p_entity_id uuid,
  p_previous jsonb,
  p_new jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_previous is null
    or jsonb_typeof(p_previous) <> 'object'
    or p_previous ->> 'id' is distinct from p_entity_id::text
  then
    return false;
  end if;

  p_new := coalesce(p_new, '{}'::jsonb);

  case p_entity_type
    when 'action' then
      return
        (not (p_new ? 'status') or p_previous ? 'status')
        and (not (p_new ? 'deadline') or p_previous ? 'deadline')
        and (not (p_new ? 'owner_name') or p_previous ? 'owner_name')
        and (not (p_new ? 'priority') or p_previous ? 'priority')
        and (not (p_new ? 'erp_area') or p_previous ? 'erp_area')
        and (not (p_new ? 'embedding') or p_previous ? 'embedding')
        and (not (p_new ? 'evidence') or p_previous ? 'evidence');
    when 'risk' then
      return
        (not (p_new ? 'active') or p_previous ? 'active')
        and (not (p_new ? 'level') or p_previous ? 'level')
        and (not (p_new ? 'embedding') or p_previous ? 'embedding');
    when 'opportunity' then
      return
        (not (p_new ? 'expected_benefit') or p_previous ? 'expected_benefit')
        and (not (p_new ? 'embedding') or p_previous ? 'embedding');
    when 'decision' then
      return
        (not (p_new ? 'title') or p_previous ? 'title')
        and (not (p_new ? 'description') or p_previous ? 'description')
        and (not (p_new ? 'reason') or p_previous ? 'reason')
        and (not (p_new ? 'owner') or p_previous ? 'owner')
        and (not (p_new ? 'due_date') or p_previous ? 'due_date')
        and (not (p_new ? 'status') or p_previous ? 'status')
        and (not (p_new ? 'supersedes_decision_id') or p_previous ? 'supersedes_decision_id')
        and (not (p_new ? 'embedding') or p_previous ? 'embedding');
    else
      return false;
  end case;
end;
$$;

create or replace function app_private.admin_undo_context_snapshot_is_sufficient(
  p_entity_id uuid,
  p_previous jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    jsonb_typeof(p_previous) = 'object'
    and p_previous ->> 'list' = any (array[
      'objectives', 'problems', 'root_causes', 'priorities',
      'hypotheses', 'constraints', 'results', 'next_steps'
    ])
    and jsonb_typeof(p_previous -> 'item') = 'object'
    and p_previous -> 'item' ->> 'id' = p_entity_id::text
    and nullif(btrim(p_previous -> 'item' ->> 'text'), '') is not null;
$$;

-- GATE 9D.1 (bloqueador 1): detecta se a entidade foi alterada DEPOIS que a
-- reunião a atualizou. Compara, campo a campo, apenas as chaves presentes em
-- `new_value` (o que a reunião de fato escreveu) contra o estado ATUAL da
-- linha. Se qualquer uma divergir, algo mudou por fora da reunião desde
-- então — desfazer sobrescreveria essa alteração posterior, o que nunca deve
-- acontecer.
create or replace function app_private.admin_undo_current_state_matches(
  p_entity_type text,
  p_entity_id uuid,
  p_new_value jsonb
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_current jsonb;
  v_key text;
begin
  if p_new_value is null or jsonb_typeof(p_new_value) <> 'object' then
    return true; -- nada foi registrado como escrito: não há o que comparar.
  end if;

  case p_entity_type
    when 'action' then
      select to_jsonb(a) into v_current from public.actions a where a.id = p_entity_id;
    when 'risk' then
      select to_jsonb(r) into v_current from public.risks r where r.id = p_entity_id;
    when 'opportunity' then
      select to_jsonb(o) into v_current from public.opportunities o where o.id = p_entity_id;
    when 'decision' then
      select to_jsonb(d) into v_current from public.decisions d where d.id = p_entity_id;
    else
      return false;
  end case;

  if v_current is null then
    -- Entidade não existe mais (já coberto por admin_undo_entity_exists,
    -- mas tratamos como divergente aqui também por segurança).
    return false;
  end if;

  for v_key in select jsonb_object_keys(p_new_value)
  loop
    if not (v_current -> v_key is not distinct from p_new_value -> v_key) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- Mesma ideia para ContextItem: compara o item ATUAL (localizado pela lista +
-- id dentro de project_context) contra `new_value.item`, o que a reunião
-- escreveu.
create or replace function app_private.admin_undo_context_current_matches(
  p_project_id uuid,
  p_list text,
  p_entity_id uuid,
  p_new_item jsonb
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_current_item jsonb;
begin
  if p_new_item is null or jsonb_typeof(p_new_item) <> 'object' then
    return true;
  end if;

  select item
    into v_current_item
  from public.project_context pc
  cross join lateral jsonb_array_elements(
    coalesce(
      case p_list
        when 'objectives' then pc.objectives
        when 'problems' then pc.problems
        when 'root_causes' then pc.root_causes
        when 'priorities' then pc.priorities
        when 'hypotheses' then pc.hypotheses
        when 'constraints' then pc.constraints
        when 'results' then pc.results
        when 'next_steps' then pc.next_steps
        else '[]'::jsonb
      end,
      '[]'::jsonb
    )
  ) as item
  where pc.project_id = p_project_id
    and item ->> 'id' = p_entity_id::text
  limit 1;

  if v_current_item is null then
    return false; -- item sumiu do project_context: não é seguro comparar.
  end if;

  return v_current_item is not distinct from p_new_item;
end;
$$;

create or replace function app_private.preview_admin_undo_meeting(p_meeting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings%rowtype;
  v_applied boolean := false;
  v_has_later_application boolean := false;
  v_multiple_applications boolean := false;
  v_unsafe_entity_history boolean := false;
  v_entity_changed_after boolean := false;
  v_legacy_context boolean := false;
  v_context_changed_after boolean := false;
  v_allowed boolean := false;
  v_blocking_reason text := null;
  v_target_application public.analysis_applications%rowtype;
  v_entity_counts jsonb;
  v_context_items_affected integer := 0;
begin
  if not coalesce(app_private.is_admin(), false) then
    raise exception 'Apenas administradores podem visualizar o impacto de desfazer uma reunião.'
      using errcode = '42501';
  end if;

  select *
    into v_meeting
  from public.meetings
  where id = p_meeting_id;

  if not found then
    raise exception 'Reunião % não encontrada.', p_meeting_id
      using errcode = 'P0002';
  end if;

  select exists (
    select 1
    from public.analysis_applications
    where meeting_id = p_meeting_id
  ) into v_applied;

  if v_applied then
    -- GATE 9D.1 (bloqueador 2): a fronteira do rollback é a PRIMEIRA
    -- aplicação desta reunião — o undo desfaz TODOS os efeitos da reunião,
    -- então o "perigo" de algo ter acontecido depois começa aí, não na
    -- aplicação mais recente.
    select *
      into v_target_application
    from public.analysis_applications
    where meeting_id = p_meeting_id
    order by created_at asc, id asc
    limit 1;

    -- Múltiplas aplicações da MESMA reunião tornam o rollback ambíguo (não
    -- há como saber qual delas representa o estado "antes" canônico) —
    -- bloqueia explicitamente, independente de haver aplicação de outra
    -- reunião intercalada ou não.
    select count(*) > 1
      into v_multiple_applications
    from public.analysis_applications
    where meeting_id = p_meeting_id;

    if v_meeting.project_id is not null then
      select exists (
        select 1
        from public.analysis_applications later
        where later.project_id = v_meeting.project_id
          and later.meeting_id <> p_meeting_id
          and (later.created_at, later.id) >
              (v_target_application.created_at, v_target_application.id)
      ) into v_has_later_application;
    end if;

    select exists (
      select 1
      from public.entity_mentions em
      where em.meeting_id = p_meeting_id
        and em.entity_type in ('action', 'risk', 'opportunity', 'decision')
        and em.mention_type in ('updated', 'resolved', 'reopened', 'superseded')
        -- `superseded` atualmente é apenas informativo. Ele só representa
        -- estado persistido quando há snapshot anterior explícito.
        and (em.mention_type <> 'superseded' or em.previous_value is not null)
        and (
          not app_private.admin_undo_snapshot_is_sufficient(
            em.entity_type,
            em.entity_id,
            em.previous_value,
            em.new_value
          )
          or not app_private.admin_undo_entity_exists(em.entity_type, em.entity_id)
        )
    ) into v_unsafe_entity_history;

    -- GATE 9D.1 (bloqueador 1, entidades): mesmo com snapshot suficiente,
    -- se o estado ATUAL divergir do que a reunião escreveu (`new_value`),
    -- algo mexeu na entidade depois — desfazer sobrescreveria essa mudança.
    select exists (
      select 1
      from public.entity_mentions em
      where em.meeting_id = p_meeting_id
        and em.entity_type in ('action', 'risk', 'opportunity', 'decision')
        and em.mention_type in ('updated', 'resolved', 'reopened', 'superseded')
        and (em.mention_type <> 'superseded' or em.previous_value is not null)
        and app_private.admin_undo_entity_exists(em.entity_type, em.entity_id)
        and not app_private.admin_undo_current_state_matches(
          em.entity_type,
          em.entity_id,
          em.new_value
        )
    ) into v_entity_changed_after;

    select exists (
      select 1
      from public.entity_mentions em
      left join public.project_context pc
        on pc.project_id = v_meeting.project_id
      where em.meeting_id = p_meeting_id
        and em.entity_type = 'context_item'
        and em.mention_type in ('updated', 'resolved', 'reopened')
        and (
          not app_private.admin_undo_context_snapshot_is_sufficient(
            em.entity_id,
            em.previous_value
          )
          or pc.id is null
          or not exists (
            select 1
            from jsonb_array_elements(
              coalesce(to_jsonb(pc) -> (em.previous_value ->> 'list'), '[]'::jsonb)
            ) item
            where item ->> 'id' = em.entity_id::text
          )
        )
    ) into v_legacy_context;

    -- GATE 9D.1 (bloqueador 1, contexto): mesma verificação para ContextItem
    -- — compara o item atual contra `new_value.item`.
    select exists (
      select 1
      from public.entity_mentions em
      where em.meeting_id = p_meeting_id
        and em.entity_type = 'context_item'
        and em.mention_type in ('updated', 'resolved', 'reopened')
        and not app_private.admin_undo_context_current_matches(
          v_meeting.project_id,
          em.previous_value ->> 'list',
          em.entity_id,
          em.new_value -> 'item'
        )
    ) into v_context_changed_after;
  end if;

  select jsonb_build_object(
    'actions', jsonb_build_object(
      'created', count(*) filter (where entity_type = 'action' and mention_type = 'created'),
      'updated', count(*) filter (
        where entity_type = 'action'
          and mention_type in ('updated', 'resolved', 'reopened')
      )
    ),
    'risks', jsonb_build_object(
      'created', count(*) filter (where entity_type = 'risk' and mention_type = 'created'),
      'updated', count(*) filter (
        where entity_type = 'risk'
          and mention_type in ('updated', 'resolved', 'reopened')
      )
    ),
    'opportunities', jsonb_build_object(
      'created', count(*) filter (where entity_type = 'opportunity' and mention_type = 'created'),
      'updated', count(*) filter (
        where entity_type = 'opportunity'
          and mention_type in ('updated', 'resolved', 'reopened')
      )
    ),
    'decisions', jsonb_build_object(
      'created', count(*) filter (where entity_type = 'decision' and mention_type = 'created'),
      'updated', count(*) filter (
        where entity_type = 'decision'
          and (
            mention_type in ('updated', 'resolved', 'reopened')
            or (mention_type = 'superseded' and previous_value is not null)
          )
      )
    )
  )
    into v_entity_counts
  from public.entity_mentions
  where meeting_id = p_meeting_id;

  if v_meeting.project_id is not null then
    select count(distinct affected.item_id)::integer
      into v_context_items_affected
    from (
      select em.entity_id::text as item_id
      from public.entity_mentions em
      where em.meeting_id = p_meeting_id
        and em.entity_type = 'context_item'
        and em.mention_type in ('created', 'updated', 'resolved', 'reopened')
      union
      select item ->> 'id'
      from public.project_context pc
      cross join lateral (
        select value as item from jsonb_array_elements(coalesce(pc.objectives, '[]'::jsonb))
        union all select value from jsonb_array_elements(coalesce(pc.problems, '[]'::jsonb))
        union all select value from jsonb_array_elements(coalesce(pc.root_causes, '[]'::jsonb))
        union all select value from jsonb_array_elements(coalesce(pc.priorities, '[]'::jsonb))
        union all select value from jsonb_array_elements(coalesce(pc.hypotheses, '[]'::jsonb))
        union all select value from jsonb_array_elements(coalesce(pc.constraints, '[]'::jsonb))
        union all select value from jsonb_array_elements(coalesce(pc.results, '[]'::jsonb))
        union all select value from jsonb_array_elements(coalesce(pc.next_steps, '[]'::jsonb))
      ) items
      where pc.project_id = v_meeting.project_id
        and item ->> 'source_meeting_id' = p_meeting_id::text
    ) affected;
  end if;

  if not v_applied then
    v_allowed := true;
  elsif v_meeting.project_id is null then
    v_blocking_reason := 'A reunião aplicada não possui project_id; não é possível ordenar o rollback com segurança.';
  elsif v_multiple_applications then
    v_blocking_reason := 'Esta reunião foi aplicada mais de uma vez; o rollback ficaria ambíguo.';
  elsif v_has_later_application then
    v_blocking_reason := 'Existe uma aplicação posterior neste projeto.';
  elsif v_unsafe_entity_history then
    v_blocking_reason := 'O histórico de entidades não contém snapshot suficiente para rollback seguro.';
  elsif v_entity_changed_after then
    v_blocking_reason := 'Uma ou mais entidades atualizadas por esta reunião foram alteradas depois; desfazer sobrescreveria essa alteração posterior.';
  elsif v_legacy_context then
    v_blocking_reason := 'O contexto legado não contém o ContextItem anterior completo para rollback seguro.';
  elsif v_context_changed_after then
    v_blocking_reason := 'Um ou mais itens de contexto atualizados por esta reunião foram alterados depois; desfazer sobrescreveria essa alteração posterior.';
  else
    v_allowed := true;
  end if;

  return jsonb_build_object(
    'meeting_id', v_meeting.id,
    'project_id', v_meeting.project_id,
    'client_id', v_meeting.client_id,
    'applied', v_applied,
    'allowed', v_allowed,
    'blocking_reason', v_blocking_reason,
    'entities', v_entity_counts,
    'context_items_affected', v_context_items_affected,
    'has_later_application', v_has_later_application,
    'has_multiple_applications', v_multiple_applications,
    'entity_changed_after', v_entity_changed_after,
    'context_changed_after', v_context_changed_after
  );
end;
$$;

create or replace function app_private.admin_undo_meeting(p_meeting_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings%rowtype;
  v_preview jsonb;
  v_mention public.entity_mentions%rowtype;
  v_applied boolean;
  v_row_count integer := 0;
  v_restored jsonb := jsonb_build_object(
    'actions', 0, 'risks', 0, 'opportunities', 0, 'decisions', 0
  );
  v_deleted_created jsonb := jsonb_build_object(
    'actions', 0, 'risks', 0, 'opportunities', 0, 'decisions', 0
  );
  v_context_restored integer := 0;
  v_context_removed integer := 0;
  v_list text;
  v_items jsonb;
  v_next_items jsonb;
  v_item jsonb;
  v_previous_item jsonb;
  v_remove_item boolean;
  v_previous_meeting_id uuid;
begin
  if not coalesce(app_private.is_admin(), false) then
    raise exception 'Apenas administradores podem desfazer uma reunião.'
      using errcode = '42501';
  end if;

  select *
    into v_meeting
  from public.meetings
  where id = p_meeting_id
  for update;

  if not found then
    raise exception 'Reunião % não encontrada.', p_meeting_id
      using errcode = 'P0002';
  end if;

  -- Impede que uma nova aplicação seja inserida entre a validação e o DELETE.
  lock table public.analysis_applications in share row exclusive mode;

  v_preview := app_private.preview_admin_undo_meeting(p_meeting_id);
  if not coalesce((v_preview ->> 'allowed')::boolean, false) then
    raise exception 'Undo bloqueado: %', coalesce(v_preview ->> 'blocking_reason', 'motivo desconhecido')
      using errcode = 'P0001';
  end if;

  v_applied := coalesce((v_preview ->> 'applied')::boolean, false);

  if v_applied then
    -- Entidades existentes são restauradas na ordem inversa do histórico.
    for v_mention in
      select *
      from public.entity_mentions
      where meeting_id = p_meeting_id
        and entity_type in ('action', 'risk', 'opportunity', 'decision')
        and mention_type in ('updated', 'resolved', 'reopened', 'superseded')
        and (mention_type <> 'superseded' or previous_value is not null)
      order by created_at desc, id desc
    loop
      v_row_count := 0;

      case v_mention.entity_type
        when 'action' then
          update public.actions
          set
            status = case when v_mention.new_value ? 'status'
              then v_mention.previous_value ->> 'status' else status end,
            deadline = case when v_mention.new_value ? 'deadline'
              then (v_mention.previous_value ->> 'deadline')::date else deadline end,
            owner_name = case when v_mention.new_value ? 'owner_name'
              then v_mention.previous_value ->> 'owner_name' else owner_name end,
            priority = case when v_mention.new_value ? 'priority'
              then v_mention.previous_value ->> 'priority' else priority end,
            erp_area = case when v_mention.new_value ? 'erp_area'
              then v_mention.previous_value ->> 'erp_area' else erp_area end,
            evidence = case when v_mention.new_value ? 'evidence'
              then v_mention.previous_value ->> 'evidence' else evidence end,
            embedding = case when v_mention.new_value ? 'embedding' then
              case when v_mention.previous_value -> 'embedding' = 'null'::jsonb
                then null else v_mention.previous_value -> 'embedding' end
              else embedding end
          where id = v_mention.entity_id;
        when 'risk' then
          update public.risks
          set
            active = case when v_mention.new_value ? 'active'
              then (v_mention.previous_value ->> 'active')::boolean else active end,
            level = case when v_mention.new_value ? 'level'
              then v_mention.previous_value ->> 'level' else level end,
            embedding = case when v_mention.new_value ? 'embedding' then
              case when v_mention.previous_value -> 'embedding' = 'null'::jsonb
                then null else v_mention.previous_value -> 'embedding' end
              else embedding end
          where id = v_mention.entity_id;
        when 'opportunity' then
          update public.opportunities
          set
            expected_benefit = case when v_mention.new_value ? 'expected_benefit'
              then v_mention.previous_value ->> 'expected_benefit' else expected_benefit end,
            embedding = case when v_mention.new_value ? 'embedding' then
              case when v_mention.previous_value -> 'embedding' = 'null'::jsonb
                then null else v_mention.previous_value -> 'embedding' end
              else embedding end
          where id = v_mention.entity_id;
        when 'decision' then
          update public.decisions
          set
            title = case when v_mention.new_value ? 'title'
              then v_mention.previous_value ->> 'title' else title end,
            description = case when v_mention.new_value ? 'description'
              then v_mention.previous_value ->> 'description' else description end,
            reason = case when v_mention.new_value ? 'reason'
              then v_mention.previous_value ->> 'reason' else reason end,
            owner = case when v_mention.new_value ? 'owner'
              then v_mention.previous_value ->> 'owner' else owner end,
            due_date = case when v_mention.new_value ? 'due_date'
              then (v_mention.previous_value ->> 'due_date')::date else due_date end,
            status = case when v_mention.new_value ? 'status'
              then v_mention.previous_value ->> 'status' else status end,
            supersedes_decision_id = case when v_mention.new_value ? 'supersedes_decision_id'
              then (v_mention.previous_value ->> 'supersedes_decision_id')::uuid
              else supersedes_decision_id end,
            embedding = case when v_mention.new_value ? 'embedding' then
              case when v_mention.previous_value -> 'embedding' = 'null'::jsonb
                then null else v_mention.previous_value -> 'embedding' end
              else embedding end
          where id = v_mention.entity_id;
      end case;

      get diagnostics v_row_count = row_count;
      v_restored := jsonb_set(
        v_restored,
        array[case v_mention.entity_type
          when 'action' then 'actions'
          when 'risk' then 'risks'
          when 'opportunity' then 'opportunities'
          when 'decision' then 'decisions'
        end],
        to_jsonb(
          coalesce(
            (v_restored ->> case v_mention.entity_type
              when 'action' then 'actions'
              when 'risk' then 'risks'
              when 'opportunity' then 'opportunities'
              when 'decision' then 'decisions'
            end)::integer,
            0
          ) + v_row_count
        )
      );
    end loop;

    -- ContextItem atualizado: substitui no mesmo índice pelo objeto anterior.
    for v_mention in
      select *
      from public.entity_mentions
      where meeting_id = p_meeting_id
        and entity_type = 'context_item'
        and mention_type in ('updated', 'resolved', 'reopened')
      order by created_at desc, id desc
    loop
      v_list := v_mention.previous_value ->> 'list';
      v_previous_item := v_mention.previous_value -> 'item';

      execute format(
        'select coalesce(%I, ''[]''::jsonb) from public.project_context where project_id = $1 for update',
        v_list
      ) into v_items using v_meeting.project_id;

      select coalesce(
        jsonb_agg(
          case when item ->> 'id' = v_mention.entity_id::text
            then v_previous_item else item end
          order by ordinal
        ),
        '[]'::jsonb
      )
        into v_next_items
      from jsonb_array_elements(v_items) with ordinality as current_items(item, ordinal);

      execute format(
        'update public.project_context set %I = $1 where project_id = $2',
        v_list
      ) using v_next_items, v_meeting.project_id;
      v_context_restored := v_context_restored + 1;
    end loop;

    -- Itens criados são comprovados por uma menção `created` ou pela origem.
    -- Um item `updated` não é removido só porque a aplicação atualizou sua origem.
    foreach v_list in array array[
      'objectives', 'problems', 'root_causes', 'priorities',
      'hypotheses', 'constraints', 'results', 'next_steps'
    ]
    loop
      execute format(
        'select coalesce(%I, ''[]''::jsonb) from public.project_context where project_id = $1 for update',
        v_list
      ) into v_items using v_meeting.project_id;

      if v_items is null then
        continue;
      end if;

      v_next_items := '[]'::jsonb;
      for v_item in select value from jsonb_array_elements(v_items)
      loop
        select
          exists (
            select 1
            from public.entity_mentions em
            where em.meeting_id = p_meeting_id
              and em.entity_type = 'context_item'
              and em.entity_id::text = v_item ->> 'id'
              and em.mention_type = 'created'
          )
          or (
            v_item ->> 'source_meeting_id' = p_meeting_id::text
            and not exists (
              select 1
              from public.entity_mentions em
              where em.meeting_id = p_meeting_id
                and em.entity_type = 'context_item'
                and em.entity_id::text = v_item ->> 'id'
                and em.mention_type in ('updated', 'resolved', 'reopened')
            )
          ) into v_remove_item;

        if v_remove_item then
          v_context_removed := v_context_removed + 1;
        else
          v_next_items := v_next_items || jsonb_build_array(v_item);
        end if;
      end loop;

      execute format(
        'update public.project_context set %I = $1 where project_id = $2',
        v_list
      ) using v_next_items, v_meeting.project_id;
    end loop;

    -- Remove explicitamente inclusive decisions, cujo FK usa ON DELETE SET NULL.
    delete from public.actions a
    using public.entity_mentions em
    where em.meeting_id = p_meeting_id
      and em.entity_type = 'action'
      and em.mention_type = 'created'
      and a.id = em.entity_id;
    get diagnostics v_row_count = row_count;
    v_deleted_created := jsonb_set(v_deleted_created, '{actions}', to_jsonb(v_row_count));

    delete from public.risks r
    using public.entity_mentions em
    where em.meeting_id = p_meeting_id
      and em.entity_type = 'risk'
      and em.mention_type = 'created'
      and r.id = em.entity_id;
    get diagnostics v_row_count = row_count;
    v_deleted_created := jsonb_set(v_deleted_created, '{risks}', to_jsonb(v_row_count));

    delete from public.opportunities o
    using public.entity_mentions em
    where em.meeting_id = p_meeting_id
      and em.entity_type = 'opportunity'
      and em.mention_type = 'created'
      and o.id = em.entity_id;
    get diagnostics v_row_count = row_count;
    v_deleted_created := jsonb_set(v_deleted_created, '{opportunities}', to_jsonb(v_row_count));

    -- GATE 9D.1 (bloqueador 3): além da menção `created`, apaga também
    -- qualquer decision cujo meeting_id seja esta reunião — a coluna só é
    -- gravada na criação (o UPDATE de uma decisão existente nunca reatribui
    -- meeting_id, ver src/lib/meeting-analysis.ts), então isso nunca alcança
    -- uma decisão antiga apenas ATUALIZADA por esta reunião, só cobre casos
    -- em que a linha existe sem a entity_mention correspondente.
    delete from public.decisions d
    where d.meeting_id = p_meeting_id
       or exists (
         select 1
         from public.entity_mentions em
         where em.meeting_id = p_meeting_id
           and em.entity_type = 'decision'
           and em.mention_type = 'created'
           and em.entity_id = d.id
       );
    get diagnostics v_row_count = row_count;
    v_deleted_created := jsonb_set(v_deleted_created, '{decisions}', to_jsonb(v_row_count));
  end if;

  if v_meeting.project_id is not null then
    select m.id
      into v_previous_meeting_id
    from public.meetings m
    where m.project_id = v_meeting.project_id
      and m.id <> p_meeting_id
    order by m.meeting_date desc, m.created_at desc, m.id desc
    limit 1;

    update public.project_context
    set last_meeting_id = v_previous_meeting_id
    where project_id = v_meeting.project_id;
  end if;

  delete from public.meetings where id = p_meeting_id;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception 'A reunião % não pôde ser excluída.', p_meeting_id
      using errcode = 'P0001';
  end if;

  -- GATE 9D.1 (bloqueador 4): esta função NÃO recalcula o estado derivado do
  -- cliente (public.clients: current_risk_score, current_satisfaction etc.).
  -- Esse recálculo hoje só existe como a função TypeScript
  -- recalculateClient() em src/lib/api.ts — não há RPC SQL equivalente, e
  -- portar essa lógica para PL/pgSQL aqui seria uma refatoração grande fora
  -- do escopo deste GATE. `client_id` é devolvido explicitamente para que o
  -- chamador (quando a rota/action que invoca admin_undo_meeting for
  -- construída) chame `recalculateClient(client_id, rules)` logo em seguida,
  -- no mesmo padrão já usado após aplicar uma análise de reunião
  -- (src/lib/meeting-analysis.ts:1422). Até essa integração existir, o
  -- estado agregado do cliente pode ficar desatualizado após um undo.
  return jsonb_build_object(
    'meeting_id', p_meeting_id,
    'client_id', v_meeting.client_id,
    'deleted', true,
    'restored', v_restored,
    'deleted_created_items', v_deleted_created,
    'context_items', jsonb_build_object(
      'restored', v_context_restored,
      'removed', v_context_removed
    )
  );
end;
$$;

create or replace function public.preview_admin_undo_meeting(p_meeting_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.preview_admin_undo_meeting(p_meeting_id);
$$;

create or replace function public.admin_undo_meeting(p_meeting_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.admin_undo_meeting(p_meeting_id);
$$;

revoke all on function app_private.admin_undo_entity_exists(text, uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.admin_undo_snapshot_is_sufficient(text, uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function app_private.admin_undo_context_snapshot_is_sufficient(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function app_private.preview_admin_undo_meeting(uuid) from public, anon, service_role;
revoke all on function app_private.admin_undo_meeting(uuid) from public, anon, service_role;

grant execute on function app_private.preview_admin_undo_meeting(uuid) to authenticated;
grant execute on function app_private.admin_undo_meeting(uuid) to authenticated;

revoke all on function public.preview_admin_undo_meeting(uuid) from public, anon, service_role;
revoke all on function public.admin_undo_meeting(uuid) from public, anon, service_role;
grant execute on function public.preview_admin_undo_meeting(uuid) to authenticated;
grant execute on function public.admin_undo_meeting(uuid) to authenticated;

comment on function public.preview_admin_undo_meeting(uuid) is
  'Admin-only: simula o impacto e bloqueios para desfazer uma reunião, sem mutação.';
comment on function public.admin_undo_meeting(uuid) is
  'Admin-only: restaura o estado anterior e exclui a reunião em uma única transação.';

commit;
