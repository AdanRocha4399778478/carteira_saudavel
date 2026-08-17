-- Carteira Saudável 2.0
-- Endurece alterações de status das recomendações do orquestrador.
-- Nenhum dado existente é alterado.

begin;

-- A leitura e o insert permanecem inalterados. Esta migration restringe somente
-- o UPDATE dos campos já concedidos ao papel authenticated.
drop policy if exists orchestrator_recommendations_update
  on public.orchestrator_recommendations;

create policy orchestrator_recommendations_update
  on public.orchestrator_recommendations
  for update
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.projects p
      join public.clients c on c.id = p.client_id
      where p.id = orchestrator_recommendations.project_id
        and p.client_id = orchestrator_recommendations.client_id
        and c.consultant_id = auth.uid()
    )
  )
  with check (
    (
      public.is_admin()
      or exists (
        select 1
        from public.projects p
        join public.clients c on c.id = p.client_id
        where p.id = orchestrator_recommendations.project_id
          and p.client_id = orchestrator_recommendations.client_id
          and c.consultant_id = auth.uid()
      )
    )
    and (
      (
        status = 'approved'
        and approved_by = auth.uid()
        and approved_at is not null
      )
      or (
        status in ('rejected', 'executed', 'superseded')
        and approved_by is null
        and approved_at is null
      )
    )
  );

commit;
