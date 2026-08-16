-- Keep projects.consultant_id aligned with the consultant responsible for the client.
--
-- Business rule:
--   projects.consultant_id must mirror clients.consultant_id for every project
--   linked to that client.
--
-- This migration does two things:
--   1. Repairs any existing mismatches.
--   2. Adds a trigger so future client transfers automatically update projects.

create or replace function public.sync_project_consultant_from_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.consultant_id is distinct from old.consultant_id then
    update public.projects
    set consultant_id = new.consultant_id
    where client_id = new.id
      and consultant_id is distinct from new.consultant_id;
  end if;

  return new;
end;
$$;

comment on function public.sync_project_consultant_from_client() is
  'Synchronizes projects.consultant_id when the responsible consultant of a client changes.';

drop trigger if exists clients_sync_project_consultant on public.clients;

create trigger clients_sync_project_consultant
after update of consultant_id
on public.clients
for each row
when (old.consultant_id is distinct from new.consultant_id)
execute function public.sync_project_consultant_from_client();

-- Backfill existing inconsistencies, including projects created before this trigger.
update public.projects as p
set consultant_id = c.consultant_id
from public.clients as c
where p.client_id = c.id
  and p.consultant_id is distinct from c.consultant_id;
