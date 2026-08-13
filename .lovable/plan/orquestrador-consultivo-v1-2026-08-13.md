# Orquestrador Consultivo V1

Recomenda **uma** próxima atuação consultiva por projeto. Não executa nenhum agente — apenas recomenda, explica e aguarda aprovação humana.

## 1. Dados utilizados (nada de transcrição)

Tudo já existe no banco/queries atuais:

| Entrada | Origem |
|---|---|
| `project` | `projects` (`projectQuery`) |
| `project_context` | `project_context` (objetivos, problemas, causas raiz, prioridades, hipóteses, restrições, resultados, próximos passos) |
| `project_health` + `intervention_priority` | `computeProjectHealth()` (motor determinístico atual, sem alteração) |
| `meeting_evolution` | `projectEvolutionQuery` (movimento + itens classificados) |
| `open_actions` / `overdue_actions` | `actions` do cliente filtradas por reuniões do projeto |
| `decisions` | `decisions` do projeto (status, prazo) |
| `active_risks` | `risks` ativos |
| `latest_meeting` | `meetings` do projeto (data mais recente) |
| `recent_entity_mentions` | `entity_mentions` (contagem por entidade, últimas reuniões) |
| `previous_orchestrator_recommendation` | nova tabela `orchestrator_recommendations` |

## 2. Regras determinísticas (prioridade decrescente)

Avaliadas em ordem; a primeira que dispara vence e a IA **não pode** contrariá-la.

1. Sem objetivo claro (`main_objective` vazio e `objectives` vazio) → `CRITERIOS_SUCESSO` (estágio `SEM_DIRECAO`, confiança 0.95)
2. Problemas ativos sem causas raiz (`problems ≥ 1` e `root_causes = 0`) → `DIAGNOSTICO_EXECUTIVO` (`EM_DIAGNOSTICO`, 0.9)
3. Muitos problemas com causas mas sem prioridades (`problems ≥ 3`, `priorities = 0`) → `PARETO_ORDEM_ATAQUE` (`AGUARDANDO_PRIORIZACAO`, 0.9)
4. Prioridade definida sem solução estruturada (sem decisões aprovadas/em execução e sem `next_steps`) → `ENTREGA_CONSULTIVA` (`SOLUCAO_DEFINIDA`, 0.85)
5. Solução definida sem execução (decisões aprovadas e nenhuma ação aberta/criada) → `IMPLANTACAO_CONSULTIVA` (`EM_IMPLANTACAO`, 0.85)
6. Plano com atraso/bloqueio/baixa execução (ações atrasadas > 0, itens `DELAYED`/`BLOCKED`, movimento `travado`/`regredindo`, risco crítico ativo, ou saúde `risco`/`crítico`) → `CONTINUIDADE_GERENCIAL` (`TRAVADO`, 0.9)
7. Entrega/implantação aguardando validação (ações concluídas recentes sem `results` registrados, ou decisões `implementada` sem resultado) → `AUDITOR_QUALIDADE` (`EM_VALIDACAO`, 0.8)

Fallback determinístico quando nada dispara: estágio `EM_ACOMPANHAMENTO` + `CONTINUIDADE_GERENCIAL` com confiança baixa (0.5) — e é exatamente esse o caso que abre espaço para a IA.

Cada regra produz `evidence[]` com fatos contáveis ("4 ações atrasadas", "0 causas raiz para 3 problemas").

## 3. Quando a OpenAI é usada

Somente quando:
- nenhuma regra forte disparou (caso fallback), **ou**
- duas ou mais regras de peso equivalente empataram.

Nesses casos a IA recebe apenas o **estado consolidado** (contadores, listas curtas de texto, saúde, movimento) — nunca transcrição — e devolve: `main_bottleneck.description`, `reason`, `expected_result`, `alternative_agent`, `alternative_reason`, `erp_classification`. O `recommended_agent` da IA é aceito apenas no caso fallback; se uma regra forte existir, a IA só enriquece o texto. Falha da IA → recomendação determinística é mantida (degradação graciosa).

## 4. `state_hash`

SHA-256 (via `crypto.subtle` no servidor) de um JSON canônico e ordenado com só o que muda a decisão:

```
project.status, main_objective, contadores das listas de contexto,
health.score arredondado a múltiplos de 5, health.status, priority,
movimento da última evolução + id da evolução,
nº ações abertas / atrasadas / bloqueadas,
nº decisões por status,
nº riscos ativos por nível,
id + data da última reunião
```

Mesmo hash da última recomendação `suggested`/`approved` → retorna a existente, **sem** chamar IA e **sem** inserir linha. Hash diferente → nova recomendação e a anterior em `suggested` vira `superseded`.

Gatilhos: recálculo acontece ao abrir a Visão Geral do Projeto e ao invalidar as queries do projeto (reunião aprovada, saúde, riscos, ações, decisões, evolução). Nunca a cada render — a query fica com `staleTime` e chave `["orchestrator", projectId]`.

## 5. Migration

`db/migrations/<timestamp>_orchestrator_recommendations.sql`:

- enums `orchestrator_agent` (7 agentes), `orchestrator_stage` (8 estágios), `orchestrator_status` (`suggested`, `approved`, `rejected`, `executed`, `superseded`)
- tabela `public.orchestrator_recommendations` com os campos pedidos (`evidence` JSONB, `main_bottleneck` JSONB, `erp_classification` JSONB, `state_hash text`, `approved_at`, `approved_by`)
- índices: `(project_id, created_at desc)` e único parcial `(project_id, state_hash) where status in ('suggested','approved')`
- `GRANT SELECT, INSERT, UPDATE ON ... TO authenticated` + `GRANT ALL TO service_role`
- RLS habilitada com policies no mesmo escopo de carteira já usado (`can_access_client` via `projects`)

Backend externo (BYO): a migration é entregue em arquivo para execução no SQL Editor, como as anteriores.

## 6. Onde fica o código

- `src/lib/orchestrator/rules.ts` — estado consolidado + motor determinístico puro (testável)
- `src/lib/orchestrator/types.ts` — tipos, agentes, estágios, labels em PT-BR
- `src/lib/orchestrator.server.ts` — chamada OpenAI (server-only, reaproveita a config existente)
- `src/lib/orchestrator.functions.ts` — `getOrCreateRecommendation`, `approveRecommendation`, `rejectRecommendation` (`createServerFn` + `requireSupabaseAuth`)
- `src/lib/orchestrator.ts` — queries/mutations do cliente (TanStack Query)

## 7. Onde entra o card

`src/components/painel/NextActionCard.tsx`, inserido em `src/routes/_authenticated/projetos/$projectId.tsx` logo abaixo do `ProjectHealthCard` na aba de visão geral: agente recomendado, confiança, motivo, resultado esperado, top evidências e os botões **Ver análise** (dialog com estágio, gargalo, todas as evidências, alternativa e motivo), **Aprovar atuação**, **Rejeitar**. Aprovar/rejeitar apenas grava status + `approved_by`/`approved_at`; nenhum agente é disparado.

## 8. Fases

- **Fase 1** — migration + tipos + regras determinísticas + `state_hash` + orchestratorService (sem UI)
- **Fase 2** — persistência, antiduplicidade por hash, `superseded`, histórico por projeto
- **Fase 3** — card na Visão Geral + dialog de análise + aprovação/rejeição com invalidação de cache

Fora de escopo (intocados): Reunião Inteligente, deduplicationService, meeting_evolution, project_health.
