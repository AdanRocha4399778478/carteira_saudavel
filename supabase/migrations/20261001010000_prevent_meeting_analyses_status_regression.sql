-- =============================================================================
-- Achado real em produção (auditoria de junho/2026, cliente Maxipar — mesmo
-- padrão do caso Grupo Erinho): a guarda do PR #72 contra reabrir e
-- reanalisar uma reunião já aprovada é só client-side (isApproved e o early
-- return em saveAnalysisDraft vivem em src/lib/meeting-analysis.ts, buildado
-- no bundle JS do navegador, sem sufixo .server.ts). Uma aba aberta antes do
-- deploy do #72 continua servindo o bundle antigo e ignora a guarda por
-- completo — confirmado via logs: 3 reuniões da Maxipar (17/06, 25/06, 30/06)
-- tiveram status rebaixado de "aprovada" para "aguardando_revisao" por um
-- PATCH que teve sucesso (200) bem depois do deploy do #72 já estar READY.
--
-- A política de RLS de UPDATE em meeting_analyses só verifica escopo
-- (app_private.can_access_scope), nunca a transição de status -- não há
-- nenhuma proteção no banco até esta migration.
--
-- Esta trigger fecha a lacuna de verdade: nenhum cliente (bundle antigo,
-- novo, ou um script futuro) consegue mais rebaixar o status de uma linha
-- já aprovada, independente do que o JavaScript do navegador decidir
-- permitir. Uma atualização que NÃO toca o status (ex.: só raw_ai_response)
-- continua funcionando normalmente -- o gatilho só rejeita quando o status
-- de fato muda de "aprovada" para outro valor.
-- =============================================================================

CREATE OR REPLACE FUNCTION app_private.prevent_meeting_analyses_status_regression()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'aprovada' AND NEW.status IS DISTINCT FROM 'aprovada' THEN
    RAISE EXCEPTION
      'meeting_analyses.status não pode regredir de "aprovada" para "%" (id=%) -- aprovação é definitiva.',
      NEW.status, OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER meeting_analyses_prevent_status_regression
  BEFORE UPDATE ON public.meeting_analyses
  FOR EACH ROW
  EXECUTE FUNCTION app_private.prevent_meeting_analyses_status_regression();
