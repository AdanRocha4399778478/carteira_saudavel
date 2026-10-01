-- =============================================================================
-- "Clareza da Entrega" (PR #67): autoavaliação da consultoria sobre a própria
-- reunião, calculada no preview a partir de decisions/actions/context_items já
-- extraídos (sem IA) -- taxa de encaminhamento completo (% de ações com
-- responsável e prazo) e taxa de conversão em compromisso ((decisões + ações)
-- / itens de contexto). Até agora essas duas taxas só existiam na tela de
-- revisão, descartadas ao fechar o diálogo -- não dava pra ver a evolução
-- reunião a reunião no histórico do cliente, que era o objetivo original.
--
-- Esta migration só adiciona as colunas. Não muda nenhum comportamento
-- existente: ambas são opcionais (NULL por padrão), e nenhuma leitura atual
-- depende delas -- passam a ser preenchidas na aprovação, mesmo padrão dos
-- 11 campos de diagnóstico do PR #66.
-- =============================================================================

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS delivery_clarity_rate numeric,
  ADD COLUMN IF NOT EXISTS commitment_conversion_rate numeric;

COMMENT ON COLUMN public.meetings.delivery_clarity_rate IS
  'Taxa de encaminhamento completo (0-100): % das ações desta reunião com responsável e prazo preenchidos. Calculada no preview, sem IA -- ver computeDeliveryClarity em src/lib/domain.ts.';

COMMENT ON COLUMN public.meetings.commitment_conversion_rate IS
  'Taxa de conversão em compromisso (0-100): (decisões + ações) / itens de contexto desta reunião. Calculada no preview, sem IA -- ver computeDeliveryClarity em src/lib/domain.ts.';
