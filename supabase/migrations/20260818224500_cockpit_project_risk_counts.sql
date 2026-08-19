begin;

create index if not exists risks_active_meeting_id_idx
  on public.risks (meeting_id)
  where active = true and meeting_id is not null;

create index if not exists risks_active_client_no_meeting_idx
  on public.risks (client_id)
  where active = true and meeting_id is null;

create or replace view public.cockpit_project_risk_counts
with (security_invoker = true)
as
select
  p.id as project_id,
  count(*) filter (where scoped.level = 'crítico')::integer as critical_count,
  count(*) filter (where scoped.level = 'alto')::integer as high_count,
  count(*) filter (where scoped.level = 'médio')::integer as medium_count,
  count(*) filter (where scoped.level = 'baixo')::integer as low_count
from public.projects p
left join lateral (
  select r.level
  from public.risks r
  where r.active = true
    and (
      (r.meeting_id is null and r.client_id = p.client_id)
      or exists (
        select 1
        from public.meetings m
        where m.id = r.meeting_id
          and m.project_id = p.id
      )
    )
) scoped on true
where p.merged_into_project_id is null
group by p.id;

revoke all on public.cockpit_project_risk_counts from public, anon;
grant select on public.cockpit_project_risk_counts to authenticated;

commit;
