-- ============================================================================
-- Indicadores de resultado — vínculo ponto-reunião em cascata (18/10/2026).
--
-- indicator_points.source_meeting_id referenciava meetings(id) ON DELETE SET
-- NULL (ver supabase/migrations/20261017120000_create_indicators.sql:140).
-- admin_undo_meeting (supabase/migrations/20260914161758_admin_undo_meeting.sql)
-- termina excluindo a reunião de fato (DELETE FROM public.meetings) — com SET
-- NULL, o ponto sugerido por aquela reunião sobrevivia sem vínculo nenhum, e
-- reprocessar a MESMA reunião depois do desfazer gravava um ponto NOVO
-- duplicado, porque nada ficava registrado para detectar que aquele valor,
-- naquela data, para o mesmo indicador, já tinha sido gravado antes. Já
-- analysis_applications.meeting_id usa ON DELETE CASCADE
-- (supabase/migrations/20260811000000_initial_schema.sql) — a reserva de
-- idempotência da aplicação já some junto com a reunião no desfazer; esta
-- migration só alinha indicator_points ao mesmo comportamento.
--
-- Troca ON DELETE SET NULL por ON DELETE CASCADE: ao excluir ou desfazer uma
-- reunião, o PONTO sugerido por ela é apagado junto com ela. O INDICADOR em
-- si (public.indicators) NUNCA é apagado por esta migration — indicators não
-- tem (e continua sem ter) nenhuma chave estrangeira para meetings; um
-- indicador criado só por aquela reunião fica sem nenhum ponto depois do
-- desfazer, mas continua existindo (apagá-lo, se for o caso, é uma decisão
-- manual do admin, pelo painel "Antes e depois" já existente — exclusão de
-- indicador já é restrita a admin desde a migration de criação).
--
-- Pontos manuais (source = 'manual') nunca são afetados por este CASCADE:
-- source_meeting_id é sempre nulo nesses pontos (nunca gravado por
-- src/lib/indicator-form.ts/IndicatorPointDialog.tsx), então a condição do
-- DELETE em cascata — que só alcança linhas cujo source_meeting_id aponta
-- para a reunião excluída — nunca os atinge.
--
-- A chave estrangeira original foi declarada inline, sem nome explícito
-- (supabase/migrations/20261017120000_create_indicators.sql:140), então o
-- Postgres gerou o nome padrão (indicator_points_source_meeting_id_fkey).
-- Em vez de supor esse nome, o bloco abaixo descobre o nome real em
-- pg_constraint antes de derrubar a chave, e a chave nova é recriada com
-- nome explícito — não depende de novo da convenção automática.
--
-- Nenhuma outra coluna, tabela, policy, grant ou função é alterada por esta
-- migration — nada muda em public.indicators nem em admin_undo_meeting.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_constraint_name text;
  v_attnum smallint;
BEGIN
  SELECT attnum
    INTO v_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.indicator_points'::regclass
    AND attname = 'source_meeting_id';

  SELECT con.conname
    INTO v_constraint_name
  FROM pg_constraint con
  WHERE con.conrelid = 'public.indicator_points'::regclass
    AND con.contype = 'f'
    AND con.confrelid = 'public.meetings'::regclass
    AND con.conkey = ARRAY[v_attnum];

  IF v_constraint_name IS NULL THEN
    RAISE EXCEPTION
      'Não encontrei a chave estrangeira de indicator_points.source_meeting_id para meetings(id).';
  END IF;

  EXECUTE format('ALTER TABLE public.indicator_points DROP CONSTRAINT %I', v_constraint_name);
END;
$$;

ALTER TABLE public.indicator_points
  ADD CONSTRAINT indicator_points_source_meeting_id_fkey
  FOREIGN KEY (source_meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;

COMMIT;
