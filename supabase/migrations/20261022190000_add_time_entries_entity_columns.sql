-- Alinha o repositório ao banco de produção (22/10/2026): as colunas entity_type e
-- entity_id de time_entries, e o índice time_entries_entity_idx, já existem em
-- PRODUÇÃO (criados fora do histórico de migrações), mas nenhuma migração os criava.
-- As funções/gatilhos de 20260927184059_time_entries_cascade_on_entity_delete.sql já os
-- usam; sem esta migração, um banco montado só pelas migrações (teste, ambiente novo,
-- recuperação) falha ao apagar ação, decisão, risco ou oportunidade.
--
-- Idempotente e sem mudança de dado: em produção não faz nada (IF NOT EXISTS).
-- Tipos conferidos em produção em 22/10/2026:
--   entity_type  text  NULL  sem default
--   entity_id    uuid  NULL  sem default
--   time_entries_entity_idx  btree (entity_type, entity_id) WHERE (entity_id IS NOT NULL)

BEGIN;

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid;

CREATE INDEX IF NOT EXISTS time_entries_entity_idx
  ON public.time_entries USING btree (entity_type, entity_id)
  WHERE (entity_id IS NOT NULL);

COMMIT;
