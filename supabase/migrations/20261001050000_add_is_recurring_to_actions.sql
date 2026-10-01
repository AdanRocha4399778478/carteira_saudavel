-- =============================================================================
-- Achado real em produção (auditoria de ações "não iniciada", 01/10/2026): pelo
-- menos 3 ações da Maxipar são de natureza contínua/recorrente (ex.: "Manter o
-- acompanhamento semanal dos relatórios operacionais"), sem um prazo real de
-- "entrega única" -- mas contam como "vencidas" no cálculo de risco
-- (isOverdue, src/lib/domain.ts) assim que a data preenchida pela IA passa,
-- inflando o número de ações vencidas sem que isso reflita um compromisso
-- de fato descumprido.
--
-- Campo ortogonal ao status atual (não iniciada/em andamento/concluída/
-- cancelada): não reaproveita nem adiciona valor a `status` para não afetar
-- actionStatusClass (dedupe), ActionStatusBadge nem evolution.ts, que
-- continuam olhando só essa coluna. Booleano estático, sem ciclo/próximo
-- prazo -- uma ação marcada recorrente simplesmente nunca conta como
-- vencida; se um dia for necessário recalcular por ciclo, isso é PR futuro.
--
-- Nunca inferido pela IA -- só toggle manual do consultor (ver ActionDialog.tsx).
-- =============================================================================

ALTER TABLE public.actions
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.actions.is_recurring IS
  'Ação contínua/recorrente, sem prazo de entrega única -- excluída do cálculo de "vencida" (isOverdue, src/lib/domain.ts). Booleano estático, sem ciclo. Só marcado manualmente pelo consultor, nunca inferido pela IA.';
