# Backend Map — referência rápida

Complemento de `docs/backend-audit.md`. Somente leitura; **o banco não foi alterado**.

## Tabelas (18)

| Tabela | Chaves externas | Papel |
|---|---|---|
| `profiles` | `id → auth.users` | Dados do usuário (nome, e-mail, role textual, active) |
| `user_roles` | `user_id → auth.users` | Papel efetivo (`app_role`: admin, consultant) |
| `clients` | `consultant_id → auth.users` | Cliente + indicadores denormalizados `current_*` |
| `projects` | `client_id`, `consultant_id`, `created_by`, `merged_into_project_id → projects` | Projeto, com `normalized_name` para dedupe |
| `project_context` | `project_id`, `last_meeting_id` | Contexto vivo (objetivos, problemas, hipóteses, próximos passos) |
| `decisions` | `project_id`, `meeting_id`, `client_id`, `supersedes_decision_id` | Decisões com encadeamento de substituição |
| `meetings` | `client_id`, `project_id`, `created_by` | Reunião + notas, quadrante, risco calculado, hashes |
| `actions` | `client_id`, `meeting_id` | Plano de ação (responsável, prazo, status, prioridade) |
| `risks` | `client_id`, `meeting_id` | Riscos ativos/inativos por nível |
| `opportunities` | `client_id`, `meeting_id` | Oportunidades de expansão |
| `risk_rules` | — | Parâmetros de pontuação de risco |
| `meeting_analyses` | `meeting_id`, `project_id`, `client_id` | Transcript + JSON bruto da IA + pauta |
| `analysis_applications` | `analysis_id`, `meeting_id`, `project_id`, `client_id` | Idempotência da aplicação da análise |
| `entity_mentions` | `entity_id`, `meeting_id`, `analysis_id` | Auditoria de menções por entidade |
| `meeting_evolution` | `project_id`, `meeting_id`, `analysis_id`, `previous_meeting_id` | Resumo de evolução por reunião |
| `meeting_evolution_items` | `evolution_id`, `entity_id` | Item a item, com classificação e evidência |
| `project_health_snapshots` | `project_id`, `meeting_id`, `analysis_id` | Histórico de score/status/prioridade |
| `project_dedupe_log` | `project_id`, `merged_from_project_id` | Trilha de merges e decisões de dedupe |

## Enums

- `app_role`: `admin`, `consultant`
- Nível de risco: `baixo`, `médio`, `alto`, `crítico`
- Status de saúde: `saudavel`, `atencao`, `risco`, `critico`
- Prioridade de intervenção: `URGENTE`, `ALTA`, `MEDIA`, `BAIXA`
- Movimento: `avancando`, `estavel`, `atencao`, `travado`, `regredindo`
- Classificação de evolução: `NEW`, `PROGRESSED`, `UNCHANGED`, `DELAYED`, `BLOCKED`, `RESOLVED`, `REGRESSED`, `REOPENED`, `SUPERSEDED`

## RPCs

| RPC | Uso |
|---|---|
| `import_meeting(p_meeting, p_actions, p_risks, p_opportunities)` | Importação transacional de reunião |
| `get_or_create_project(...)` | Projeto idempotente por cliente + nome normalizado |
| `get_or_create_smart_meeting(...)` | Entrada do fluxo de reunião inteligente |
| `normalize_project_name(text)` | Normalização canônica de nome |
| `merge_context_list(jsonb, jsonb)` | Merge de listas de contexto |
| `has_role(uuid, app_role)` | Checagem de papel (security definer) |

## Triggers

`decisions_touch`, `project_context_touch`, `projects_touch`, `meeting_analyses_touch`, `meeting_evolution_touch` — todos `BEFORE UPDATE`, mantendo `updated_at`.

## RLS resumida

Todas as tabelas: RLS ativa, políticas `TO authenticated` para SELECT/INSERT/UPDATE/DELETE. Sem políticas `TO anon`. Sem escopo por consultor ou papel nas tabelas auditáveis — qualquer usuário autenticado enxerga toda a base.

## Auth

E-mail/senha apenas. No retrato de backend confirmado em 2026-08-11, o cadastro público estava **habilitado** e a confirmação de e-mail era obrigatória. Sem provedores sociais ou passkeys. **ESTADO CONFIRMADO NO CÓDIGO:** recuperação e redefinição de senha estão implementadas; o fluxo ainda deve ser validado ponta a ponta em staging.

## Storage

Nenhum bucket. Transcrições processadas em memória; apenas texto e hash são persistidos.

## Edge Functions

Nenhuma. Lógica de servidor em TanStack server functions; integração com OpenAI feita server-side com `OPENAI_API_KEY`.

## Fórmulas-chave

```text
Quadrante do cliente (limiar 7):
  s>=7 && v>=7 → Q1 | s>=7 → Q2 | v>=7 → Q3 | senão Q4

Nível de risco: <=2 baixo | <=5 médio | <=8 alto | >8 crítico

Health score (0-100), pesos: execução 25, evolução 20, riscos 20,
  decisões 15, cadência 10, resultados 10 (redistribuídos se faltar dado)
  execução  = 100*(0.45*conclusão + 0.55*(1-atrasadas)) - 15*bloqueadas - 10*paradas
  evolução  = 0.6*score(movimento) + 0.4*(50 + 50*(pos-neg)/total)
  riscos    = 100 - (crítico*30 + alto*18 + médio*8 + baixo*3)
  decisões  = 100*(0.5*implementadas + 0.5*decididas) - 12*atrasadas
  cadência  = ratio<=1 ? 100 : 100 - 55*(ratio-1)
  resultados= 0 resultados ? 25 : 40 + 20*n

Status: >=80 saudável | >=60 atenção | >=40 risco | senão crítico

Dedupe: >=0.95 existente | >=0.90 atualizar | >=0.70 revisar | senão novo
```

## Próximo módulo

Autenticação & Papéis → Carteira de Clientes.

## Checkpoint Prompt 03B — 2026-08-11

- Staging: não identificado.
- Policies reais: não inventariadas nesta etapa por ausência de acesso administrativo/direct DB.
- `clients.consultant_id`: FK para `profiles.id` no schema tipado.
- Migration RLS: preparada, revisada estaticamente e **não aplicada**.
- Signup e recuperação de senha: não testados em staging.
- Produção: não alterada.

Ver `docs/rls-staging-validation.md` para consultas de inventário, matriz-alvo, testes negativos e rollback.
