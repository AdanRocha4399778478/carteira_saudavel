# Integridade de escopo da baseline

Esta baseline trata `client_id`, `project_id`, `meeting_id`, `analysis_id` e
`evolution_id` como uma única cadeia de escopo. Quando mais de um identificador
está presente na mesma linha, todos precisam apontar para a mesma carteira.

A proteção tem duas camadas:

1. `enforce_scope_integrity()` rejeita INSERT/UPDATE incoerente antes da escrita;
2. `can_access_scope()` aplica RLS usando a entidade mais específica disponível,
   depois de validar a coerência dos IDs;
3. `can_access_related_scope()` repete a validação em RLS para `analysis_id` e
   `evolution_id`, sem expor os helpers internos de consistência.

## Invariantes por tabela

| Tabela | Invariantes garantidas |
| --- | --- |
| `projects` | `merged_into_project_id`, quando presente, aponta para outro projeto do mesmo cliente e nunca para a própria linha. |
| `meetings` | `project_id`, quando presente, pertence ao mesmo `client_id`. |
| `actions` | `meeting_id`, quando presente, pertence ao mesmo `client_id`. O delete da reunião continua em `CASCADE`. |
| `risks` | `meeting_id`, quando presente, pertence ao mesmo `client_id`. O delete da reunião continua em `CASCADE`. |
| `opportunities` | `meeting_id`, quando presente, pertence ao mesmo `client_id`. O delete da reunião continua em `CASCADE`. |
| `decisions` | Projeto, cliente e reunião formam o mesmo escopo; a decisão substituída pertence ao mesmo projeto. `meeting_id` continua com `SET NULL`. |
| `meeting_analyses` | Cliente e projeto opcionais precisam coincidir com a reunião obrigatória. A exclusão da reunião continua em `CASCADE`. |
| `analysis_applications` | Reunião, projeto e cliente são coerentes; `analysis_id`, quando presente, pertence à mesma reunião. Cascades existentes são preservados. |
| `entity_mentions` | Exige ao menos um escopo direto coerente; análise, reunião, projeto e cliente não podem divergir. A RLS não usa mais autorização por `OR`. |
| `meeting_evolution` | Reunião, projeto e cliente são coerentes; análise e reunião anterior pertencem ao mesmo escopo. `previous_meeting_id` continua com `SET NULL`. |
| `meeting_evolution_items` | O item pertence ao mesmo escopo da evolução pai e da reunião informada. A exclusão da evolução continua em `CASCADE`. |
| `project_context` | `last_meeting_id`, quando presente, pertence ao projeto. A exclusão da reunião continua com `SET NULL`. |
| `project_health_snapshots` | Projeto, reunião, cliente e análise formam o mesmo escopo. Cascades existentes são preservados. |
| `project_dedupe_log` | Exige escopo direto; deriva `client_id` do projeto quando necessário, garante que origem/destino pertencem ao mesmo cliente e valida a análise. A derivação mantém um escopo após os `SET NULL`. |
| `orchestrator_recommendations` | O trigger deriva `client_id` do projeto em INSERT e UPDATE; RLS valida o par cliente/projeto. |

## Idempotência sustentada pelo código

- `entity_mentions`: índice único em entidade, reunião e tipo de menção;
- `meeting_evolution`: uma evolução por reunião;
- `project_health_snapshots`: um snapshot por projeto/reunião.

Essas garantias são verificadas localmente por `tests/supabase-baseline.test.ts`.
