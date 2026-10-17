-- =============================================================================
-- Backlog B1 (16/10/2026): alerta de "avaliação vencida" para decisões de
-- avaliação (ex.: piloto de 60 dias -- "Definir ao final de 60 dias se o
-- papel de apoio comercial será aprovado, ajustado ou encerrado", cliente
-- Chammas). Decisão desse tipo é marcada pelo consultor no preview da
-- Reunião Inteligente, com a IA só sugerindo.
--
-- Campo ortogonal ao status atual: não reaproveita `status`, que continua
-- olhado por isDecisionOverdue (src/lib/domain.ts) e por toda a lógica
-- existente. Booleano estático, sem data/ciclo próprio -- a avaliação usa
-- o mesmo `due_date` já existente.
--
-- Exceção à Regra B (ver src/lib/regra-b.ts): decisão nova com
-- is_evaluation = true nasce SEMPRE "pendente", mesmo com due_date vencido
-- no momento da aprovação -- achado real em produção (16/10): a decisão do
-- Chammas foi criada em 16/10 com due_date 18/09 (já vencido) e entrou
-- "implementada" pela Regra B, escondendo o alerta de avaliação vencida.
--
-- Só marcado manualmente pelo consultor no preview (sugestão não vinculante
-- da IA); nunca gravado automaticamente fora da aprovação de reunião.
-- =============================================================================

ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS is_evaluation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.decisions.is_evaluation IS
  'Decisão de avaliação (ex.: piloto de N dias) -- marcada pelo consultor no preview da Reunião Inteligente, IA só sugere. Nasce sempre "pendente" (exceção à Regra B, ver src/lib/regra-b.ts), mesmo com due_date vencido. Alimenta o alerta "avaliação vencida" (isDecisionOverdue(d) && d.is_evaluation).';
