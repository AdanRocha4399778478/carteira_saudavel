-- =============================================================================
-- Issue #56 (instabilidade de taxonomia dos blocos extraídos pela IA): parte
-- do diagnóstico mostrou que o JSON bruto da resposta da IA nunca é salvo —
-- só o resultado já filtrado pelo schema Zod do cliente e pela consolidação
-- semântica do servidor chega a `meeting_analyses.analysis`. Sem o bruto, um
-- caso como o de 17/06 (Grupo Erinho, ação de classificação de pátios com
-- prazo perdida) não pode ser auditado depois do fato.
--
-- Esta migration só adiciona a coluna. Não muda nenhum comportamento
-- existente: a coluna é opcional (NULL por padrão) e nenhuma leitura da
-- aplicação depende dela — só é preenchida na gravação, para consulta manual
-- futura se um caso parecido aparecer de novo.
-- =============================================================================

ALTER TABLE public.meeting_analyses
  ADD COLUMN IF NOT EXISTS raw_ai_response jsonb;

COMMENT ON COLUMN public.meeting_analyses.raw_ai_response IS
  'JSON bruto da resposta da IA (mesclado por chunk, antes da consolidação semântica e do schema Zod do cliente) — só para auditoria manual, nunca lido de volta pela aplicação.';
