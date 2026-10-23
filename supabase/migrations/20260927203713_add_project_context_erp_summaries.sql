-- Resumo condensado do contexto do projeto, por área do ERP — gerado sob
-- demanda (botão), não automaticamente a cada reunião, pra controlar custo
-- de IA. Guarda o resultado pra não recalcular toda vez que a tela abre.
-- Arquivo reconciliado em 2026-10-23 a partir do histórico de produção (já aplicado lá).
ALTER TABLE public.project_context
  ADD COLUMN IF NOT EXISTS erp_summaries jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.project_context
  ADD COLUMN IF NOT EXISTS erp_summaries_updated_at timestamptz;
