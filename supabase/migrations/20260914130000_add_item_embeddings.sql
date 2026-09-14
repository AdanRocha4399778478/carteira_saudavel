-- =============================================================================
-- Adiciona coluna de embedding para reconhecimento semântico de continuidade
-- entre reuniões (ações, riscos, decisões, oportunidades).
--
-- Objetivo: o motor de deduplicação (src/lib/deduplication.ts) hoje só compara
-- texto por sobreposição de palavras. Isso faz itens que mudam de redação
-- entre reuniões (ex.: "atraso na entrega dos relatórios" -> "cliente
-- reclamando de reports atrasados") não serem reconhecidos como o mesmo
-- assunto, e virarem itens NOVOS em vez de continuação. Guardar um vetor
-- semântico por item permite comparar por significado, não só por palavra.
--
-- Design:
--   - Coluna nullable: nada quebra para linhas existentes (fallback automático
--     para o método por palavras, que continua funcionando como está).
--   - jsonb (array de números), não pgvector: o volume por cliente/projeto é
--     pequeno (dezenas de itens abertos), então comparar em JavaScript no
--     navegador é suficiente e evita habilitar extensão nova no banco.
--   - Sem RLS extra: segue as mesmas policies que já existem em cada tabela.
-- =============================================================================

BEGIN;

ALTER TABLE public.actions
  ADD COLUMN IF NOT EXISTS embedding jsonb;

ALTER TABLE public.risks
  ADD COLUMN IF NOT EXISTS embedding jsonb;

ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS embedding jsonb;

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS embedding jsonb;

COMMENT ON COLUMN public.actions.embedding IS
  'Vetor semântico (OpenAI text-embedding-3-small) da descrição, calculado no servidor durante a análise de reunião. Usado para reconhecer continuidade entre reuniões mesmo com redação diferente. Nulo = ainda não calculado, sistema usa fallback por similaridade de texto.';
COMMENT ON COLUMN public.risks.embedding IS
  'Vetor semântico da descrição do risco. Mesmo propósito de public.actions.embedding.';
COMMENT ON COLUMN public.decisions.embedding IS
  'Vetor semântico do título/descrição da decisão. Mesmo propósito de public.actions.embedding.';
COMMENT ON COLUMN public.opportunities.embedding IS
  'Vetor semântico da descrição da oportunidade. Mesmo propósito de public.actions.embedding.';

COMMIT;
