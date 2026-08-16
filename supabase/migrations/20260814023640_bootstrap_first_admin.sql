-- Historical migration.
-- The original production execution granted the admin role to an existing
-- Supabase Auth user. User provisioning is environment-specific and must not
-- be reproduced as part of the database schema migration chain.
--
-- Intentionally left as a no-op to preserve migration history consistency.
select 1;
