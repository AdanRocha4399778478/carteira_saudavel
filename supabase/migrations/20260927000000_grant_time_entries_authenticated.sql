-- Corrige lacuna da migration 20260926000000_create_time_entries.sql: a
-- tabela foi criada com RLS policies corretas, mas sem o GRANT de base que
-- o Postgres exige antes mesmo de avaliar RLS (por isso o erro em produção
-- era "permission denied for table time_entries", não um bloqueio de RLS).
-- Replica exatamente o padrão já usado em actions/risks/decisions/opportunities.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO service_role;
