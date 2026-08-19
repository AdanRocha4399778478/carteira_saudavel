begin;

drop policy if exists orchestrator_recommendations_insert
  on public.orchestrator_recommendations;

create policy orchestrator_recommendations_insert
  on public.orchestrator_recommendations
  for insert
  to authenticated
  with check (
    app_private.can_access_scope(client_id, project_id, null)
    and (
      app_private.is_admin()
      or owner_id = auth.uid()
    )
    and created_by = auth.uid()
    and status = 'suggested'
    and approved_at is null
    and approved_by is null
  );

commit;