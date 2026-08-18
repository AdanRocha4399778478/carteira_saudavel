-- Cockpit: expose only the most recent evolution per project while preserving RLS.
-- security_invoker makes the view execute with the caller's permissions, so the
-- underlying meeting_evolution policies remain authoritative.

create index if not exists meeting_evolution_project_created_idx
  on public.meeting_evolution (project_id, created_at desc, id desc);

create or replace view public.latest_project_evolution
with (security_invoker = true)
as
select distinct on (project_id)
  project_id,
  movement,
  summary,
  created_at
from public.meeting_evolution
order by project_id, created_at desc, id desc;

revoke all on public.latest_project_evolution from public, anon;
grant select on public.latest_project_evolution to authenticated;
