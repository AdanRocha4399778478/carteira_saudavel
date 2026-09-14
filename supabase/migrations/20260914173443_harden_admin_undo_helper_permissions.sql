begin;

revoke all on function app_private.admin_undo_current_state_matches(text, uuid, jsonb)
from public, anon, authenticated, service_role;

revoke all on function app_private.admin_undo_context_current_matches(uuid, text, uuid, jsonb)
from public, anon, authenticated, service_role;

commit;
