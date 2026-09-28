-- Decisão de negócio: se o trabalho que gerou um apontamento de hora deixa
-- de existir (ação/decisão/risco/oportunidade apagados, ou o projeto
-- inteiro apagado), o apontamento deixa de ser cobrável e deve sumir junto
-- — não ficar órfão nem sobreviver como genérico.

-- 1. Projeto: troca SET NULL por CASCADE.
ALTER TABLE public.time_entries
  DROP CONSTRAINT time_entries_project_id_fkey,
  ADD CONSTRAINT time_entries_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

-- 2. Ação/decisão/risco/oportunidade: entity_id é polimórfico (aponta pra
-- 4 tabelas diferentes), então não dá pra usar uma FK simples — usa
-- trigger em cada tabela, todas chamando a mesma função.
CREATE OR REPLACE FUNCTION app_private.delete_time_entries_for_deleted_entity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.time_entries
  WHERE entity_type = TG_ARGV[0] AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER time_entries_cleanup_on_action_delete
  AFTER DELETE ON public.actions
  FOR EACH ROW EXECUTE FUNCTION app_private.delete_time_entries_for_deleted_entity('action');

CREATE TRIGGER time_entries_cleanup_on_decision_delete
  AFTER DELETE ON public.decisions
  FOR EACH ROW EXECUTE FUNCTION app_private.delete_time_entries_for_deleted_entity('decision');

CREATE TRIGGER time_entries_cleanup_on_risk_delete
  AFTER DELETE ON public.risks
  FOR EACH ROW EXECUTE FUNCTION app_private.delete_time_entries_for_deleted_entity('risk');

CREATE TRIGGER time_entries_cleanup_on_opportunity_delete
  AFTER DELETE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION app_private.delete_time_entries_for_deleted_entity('opportunity');
