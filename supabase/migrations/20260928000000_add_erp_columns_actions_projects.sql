-- =============================================================================
-- Documenta em arquivo duas colunas que já existiam em produção, aplicadas
-- direto pela ferramenta MCP em uma sessão anterior sem gerar migration —
-- achado durante a auditoria de schema de 2026-09-28 (dev vs produção).
-- `ADD COLUMN IF NOT EXISTS` por segurança: em produção o efeito é no-op
-- (as colunas já existem com este mesmo tipo); em um banco novo (dev),
-- cria as colunas de fato.
-- =============================================================================

BEGIN;

ALTER TABLE public.actions
  ADD COLUMN IF NOT EXISTS erp_subarea text;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS erp_area text,
  ADD COLUMN IF NOT EXISTS erp_subarea text;

COMMIT;
