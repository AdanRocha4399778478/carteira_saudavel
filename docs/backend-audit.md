# Auditoria do Backend Supabase — Carteira Saudável 2.0

**Data:** 2026-08-11
**Escopo:** auditoria EXCLUSIVAMENTE de leitura do backend existente. Os fatos do backend abaixo são um retrato confirmado em 2026-08-11 e não foram reconfirmados nem alterados durante o hardening local.
**O banco foi alterado? NÃO.** Nenhum `CREATE`, `ALTER`, `INSERT`, `UPDATE`, `DELETE` ou migration foi executado. Todas as verificações usaram leituras HTTP (PostgREST `select ... limit 0`, `/auth/v1/settings`, `/storage/v1/bucket`) e leitura estática de arquivos.

## 1. Fontes utilizadas

| Fonte | O que forneceu |
|---|---|
| Backend real (PostgREST/Auth/Storage do projeto ativo) | Existência das 18 tabelas, conferência coluna a coluna, buckets, provedores de auth, ausência de Edge Functions |
| `src/lib/supabase/types.ts` | Schema tipado (colunas, tipos, enums, assinaturas de RPC) |
| `/tmp/old/supabase/migrations/*.sql` (7 migrations) | RLS, triggers, funções PL/pgSQL, índices únicos |
| `/tmp/old/src` (frontend antigo) | Inventário de consumo: 60+ pontos de acesso, fluxos de IA e importação |
| `/dev-server/src/lib` (frontend novo) | Regras de negócio: saúde, risco, evolução, deduplicação |

## 2. Conformidade schema real × tipos

Todas as 18 tabelas responderam **HTTP 200** e **todas as colunas declaradas em `types.ts` conferem 1:1 com o banco real** (verificação por projeção explícita de colunas; qualquer coluna inexistente retornaria `PGRST204`).

`actions`, `analysis_applications`, `clients`, `decisions`, `entity_mentions`, `meeting_analyses`, `meeting_evolution`, `meeting_evolution_items`, `meetings`, `opportunities`, `profiles`, `project_context`, `project_dedupe_log`, `project_health_snapshots`, `projects`, `risk_rules`, `risks`, `user_roles`.

Contagem visível ao papel `anon` = 0 em todas as tabelas → **RLS ativa e fechada para anônimos** (as políticas são `TO authenticated`). Isso é o comportamento correto e esperado.

## 3. Modelo de dados e relacionamentos

```text
auth.users ──1:1── profiles
     └──1:N── user_roles (app_role: admin | consultant)

clients ──1:N── projects ──1:1── project_context
   │              │  └──1:N── decisions
   │              │  └──1:N── project_health_snapshots
   │              │  └──1:N── project_dedupe_log
   │              └── merged_into_project_id ──▶ projects (auto-referência de merge)
   ├──1:N── meetings ──1:N── actions | risks | opportunities
   │            ├──1:N── meeting_analyses ──1:N── analysis_applications
   │            ├──1:1── meeting_evolution ──1:N── meeting_evolution_items
   │            └──1:N── entity_mentions
   └── indicadores denormalizados: current_risk_score, current_risk_level,
       current_satisfaction, current_value_score, current_quadrant,
       account_status, last_meeting_date, next_meeting_date

risk_rules (tabela de parâmetros, global — sem FK)
```

### Camadas funcionais

1. **Cadastro/carteira:** `clients`, `profiles`, `user_roles`, `risk_rules`.
2. **Registro de reuniões:** `meetings` + `actions`/`risks`/`opportunities`.
3. **Projetos e contexto vivo:** `projects`, `project_context`, `decisions`.
4. **IA:** `meeting_analyses` (transcript + JSON bruto) → `analysis_applications` (idempotência) → entidades de negócio → `entity_mentions` (auditoria de menções).
5. **Evolução e saúde:** `meeting_evolution(+_items)`, `project_health_snapshots`.
6. **Deduplicação:** `normalize_project_name`, `get_or_create_project`, `project_dedupe_log`.

## 4. RLS

Padrão observado nas migrations: RLS habilitada em todas as tabelas de negócio, com 4 políticas (`select`/`insert`/`update`/`delete`) **`TO authenticated`** por tabela. Confirmado para `projects`, `project_context`, `decisions`, `meeting_analyses`, `analysis_applications`, `entity_mentions`, `meeting_evolution`, `meeting_evolution_items`, `project_health_snapshots`, `project_dedupe_log`.

Achados relevantes:

- **Modelo de acesso é "todo usuário autenticado vê tudo"** nas tabelas novas — não há escopo por `consultant_id` nem por `has_role()` nessas políticas. Consultores enxergam a carteira inteira.
- As tabelas base (`clients`, `meetings`, `actions`, `risks`, `opportunities`, `profiles`, `user_roles`, `risk_rules`) **não têm migration no repositório antigo** — foram criadas antes do histórico disponível. Suas políticas exatas não podem ser lidas estaticamente; a verificação HTTP confirma apenas que anônimos não leem nada.
- Nenhuma política `TO anon` foi detectada — não há superfície pública de leitura.

## 5. Functions, RPCs e triggers

| Objeto | Tipo | Papel |
|---|---|---|
| `normalize_project_name(text)` | função | Normalização canônica de nome (base do índice único e do matching). Espelhada no frontend em `projects.ts`. |
| `get_or_create_project(...)` | RPC | Criação idempotente de projeto por cliente + nome normalizado; **o banco é a autoridade final da deduplicação**. |
| `get_or_create_smart_meeting(...)` | RPC | Ponto de entrada do fluxo "reunião inteligente". |
| `import_meeting(p_meeting, p_actions, p_risks, p_opportunities)` | RPC | Importação transacional: grava reunião + itens em uma única transação. Definida fora do histórico de migrations disponível. |
| `merge_context_list(a jsonb, b jsonb)` | função | Merge de listas de contexto sem perder histórico. |
| `has_role(uuid, app_role)` | função | Checagem de papel (security definer) — existe no modelo, mas **não é usada nas políticas das tabelas novas**. |
| `*_touch` | triggers | `updated_at` automático em `projects`, `project_context`, `decisions`, `meeting_analyses`, `meeting_evolution`. |

## 6. Auth

- Provedor **único: e-mail/senha**. Todos os provedores sociais estão desabilitados.
- `disable_signup: false` → **cadastro público está aberto no backend**; o frontend antigo o esconde apenas por feature flag (`VITE_ENABLE_PUBLIC_SIGNUP`). Isso é uma divergência de segurança relevante.
- `mailer_autoconfirm: false` → confirmação de e-mail obrigatória.
- Papéis em tabela separada (`user_roles` + enum `app_role`), padrão correto.
- **ESTADO CONFIRMADO NO CÓDIGO:** o frontend atual implementa recuperação e redefinição de senha em `esqueci-senha.tsx` e `redefinir-senha.tsx`, usando `resetPasswordForEmail` e `updateUser`.
- Não há `onAuthStateChange`; a sessão é checada manualmente na guarda de rota (`getSession` + `getUser`) e o token é anexado às server functions por middleware.

## 7. Storage

**Nenhum bucket existe** (`/storage/v1/bucket` → `[]`) e **nenhum código usa Storage**. PDFs de transcrição são processados em memória no cliente (`transcript-source.ts` com `pdfjs-dist`, limite de 15 MB) e apenas o texto/hash é persistido (`meeting_analyses.transcript`, `meetings.transcript_hash`, `transcript_key`).

## 8. Edge Functions

**Nenhuma.** Não há pasta `supabase/functions` no projeto antigo e as sondagens em `/functions/v1/*` retornam 404. Toda a lógica de servidor vive em **TanStack server functions** (`intelligent-meeting.functions.ts` / `.server.ts`), que é o padrão correto para esta stack e deve ser mantido.

## 9. Fluxo de IA (ponta a ponta)

1. Upload de PDF ou texto colado → `transcript-source.ts` extrai e normaliza.
2. `transcript-fingerprint.ts` gera SHA-256 → `transcript_hash`/`transcript_key` evitam reprocessar o mesmo texto.
3. `transcript-chunking.ts` divide em blocos de até 60 000 caracteres, máx. 6 blocos.
4. `analyzeMeetingWithAI` (server function protegida por `requireSupabaseAuth`) chama a **OpenAI diretamente** (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`), com timeout de 90 s, 3 tentativas e erros tipados (AUTH/RATE_LIMIT/QUOTA/TIMEOUT/PROVIDER). A chave nunca chega ao cliente.
5. Os blocos são consolidados (`consolidate`) e validados por um schema Zod tolerante em `meeting-analysis.ts`.
6. Rascunho persiste em `meeting_analyses` (`status`, `transcript`, `analysis`, `agenda`, `provider`, `created_by`).
7. Aprovação humana → `applyApprovedAnalysis` grava com chave de idempotência em `analysis_applications` (hash FNV-1a do payload aprovado; conflito 23505 = já aplicado) e então em `decisions`, `actions`, `risks`, `opportunities`, `meetings` (apenas campos vazios), `project_context`, `entity_mentions`, `meeting_evolution(+_items)` e, por fim, recalcula `clients`.

## 10. Saúde da carteira

**Duas escalas distintas coexistem** e não devem ser confundidas:

- **Cliente (matriz satisfação × valor):** limiar `>= 7` define os quadrantes 1-4; risco por pontos somados a partir de `risk_rules` (satisfação baixa, queda de satisfação, ações vencidas, reclamação explícita, dúvida de continuidade etc.); nível `<=2 baixo, <=5 médio, <=8 alto, >8 crítico`; status da conta derivado do nível. Persistido nas colunas `current_*` de `clients`.
- **Projeto (health score 0-100):** 6 dimensões ponderadas — execução 25, evolução 20, riscos 20, decisões 15, cadência 10, resultados 10 — com redistribuição de peso quando falta dado. Status: ≥80 saudável, ≥60 atenção, ≥40 risco, senão crítico. Prioridade de intervenção URGENTE/ALTA/MÉDIA/BAIXA por regras explícitas. Persistido em `project_health_snapshots` (`score`, `health_status`, `intervention_priority`, `movement`, `breakdown`, `reasons`).

O `movement` do projeto vem de `evolution.ts`: `regredindo`, `travado`, `atencao`, `avancando`, `estavel`, calculado a partir das classificações dos itens (`NEW`, `PROGRESSED`, `RESOLVED`, `UNCHANGED`, `DELAYED`, `BLOCKED`, `REGRESSED`, `REOPENED`, `SUPERSEDED`).

## 11. Deduplicação

Duas camadas: **frontend sugere, banco garante**.

- Frontend (`deduplication.ts`): similaridade máx(Dice de tokens radicalizados, Jaccard de trigramas) com bônus de contenção; limiares `0.95` = existente, `0.90` = atualizar existente, `0.70` = revisão, abaixo = novo. Regras por entidade (ação: bônus por mesmo responsável, mudança de prazo nunca cria nova; risco: mudança de nível gera alteração; decisão contrária vira `SUPERSEDED`).
- Banco: `normalize_project_name` + índice único + `get_or_create_project`, com trilha em `project_dedupe_log`. Idempotência de aplicação de IA garantida por constraint única em `analysis_applications`.

## 12. Divergências e riscos identificados

| # | Achado | Severidade | Recomendação |
|---|---|---|---|
| 1 | `disable_signup: false` — qualquer pessoa pode criar conta e, autenticada, ler a carteira inteira | **Alta** | Fechar o cadastro público no backend ou introduzir aprovação/convite antes de conceder papel |
| 2 | Políticas RLS são `TO authenticated` sem escopo por consultor/papel | **Alta** | Reescrever para `has_role(auth.uid(),'admin') OR consultant_id = auth.uid()` na reconstrução |
| 3 | Tabelas base sem migration versionada no repositório | Média | Gerar migration de baseline (declarativa, sem recriar dados) na reconstrução |
| 4 | Recuperação de senha implementada no código, mas ainda depende da configuração de redirect/e-mail do Auth | Média | Validar o fluxo ponta a ponta em staging |
| 5 | Regras de risco/normalização duplicadas entre frontend e banco | Média | Definir uma autoridade única por regra (banco para dedupe/importação, frontend para health score) e documentar |
| 6 | Queries "carregar tudo" (`meetings`, `actions`, `risks`, `opportunities`, `decisions`, `meeting_evolution` com join aninhado) alimentam o cockpit de carteira | **Alta (escala)** | Substituir por agregação no banco (view/RPC) ou paginação, como já feito em `meetingsPageQuery` |
| 7 | Saída da IA sem validação de schema no servidor (só `JSON.parse`) | Média | Validar com Zod já no servidor, antes de devolver ao cliente |
| 8 | `entity_mentions`, `analysis_applications` e `project_dedupe_log` crescem sem política de retenção | Baixa | Definir retenção/arquivamento |
| 9 | O quadrante do cliente usa a última reunião **com nota preenchida**, não a mais recente | Informativo | Comportamento intencional (reuniões de IA não trazem notas) — preservar na reconstrução |

## 13. Matriz de mapeamento por módulo

| Módulo | Tabelas | RPC/Functions | Regras de negócio | Estado |
|---|---|---|---|---|
| Autenticação & Papéis | `profiles`, `user_roles` | `has_role` | E-mail/senha, enum `admin`/`consultant` | Reset implementado no código; fechamento do signup continua obrigatório no dashboard |
| Carteira de Clientes | `clients` | — | Matriz satisfação×valor (≥7), risco por pontos, status da conta | Funcional; RLS sem escopo |
| Reuniões | `meetings`, `actions`, `risks`, `opportunities` | `import_meeting`, `get_or_create_smart_meeting` | Importação transacional, `import_hash` anti-duplicidade | Funcional |
| Projetos & Contexto | `projects`, `project_context`, `decisions` | `get_or_create_project`, `normalize_project_name`, `merge_context_list` | Dedupe por nome normalizado, merge de contexto preservando histórico | Funcional |
| IA / Análise | `meeting_analyses`, `analysis_applications`, `entity_mentions` | — (TanStack server fn + OpenAI) | Chunking, consolidação, Zod tolerante, idempotência por hash | Funcional; validar schema no servidor |
| Evolução | `meeting_evolution`, `meeting_evolution_items` | — | 9 classificações determinísticas + fallback IA; `movement` do projeto | Funcional |
| Saúde | `project_health_snapshots` | — | 6 dimensões ponderadas, redistribuição de peso, prioridade de intervenção | Funcional; agregação pesada no cliente |
| Deduplicação | `project_dedupe_log` | `normalize_project_name` | Similaridade textual + regras por entidade | Funcional |
| Configurações | `risk_rules` | — | Pontos de risco parametrizáveis | Funcional |
| Storage | — | — | — | Não utilizado |
| Edge Functions | — | — | — | Não utilizado (correto para esta stack) |

## 14. Próximo módulo recomendado para reconstrução

**Autenticação & Papéis**, seguido imediatamente de **Carteira de Clientes**.

Motivos: é a base de que todos os demais módulos dependem; concentra os dois achados de severidade alta (cadastro público aberto + RLS sem escopo por consultor); e é o menor módulo em superfície, permitindo estabelecer o padrão de RLS, papéis e guardas de rota que os módulos seguintes vão herdar. Reconstruir IA ou Saúde antes disso significaria refazer o trabalho quando o escopo de acesso mudar.

## 15. Checkpoint Prompt 03B — staging e RLS

Em 2026-08-11, staging **não foi identificado** e não havia conexão administrativa/direct DB disponível. Portanto, o inventário real de `pg_policies`, owners e grants não foi reconfirmado; a migration RLS não foi aplicada nem testada; signup não foi alterado; e produção permaneceu intocada.

Confirmação estática atual: `clients.consultant_id → profiles.id`. A identidade final com `auth.uid()` depende da relação 1:1 `profiles.id → auth.users.id`, que deve ser reconfirmada no catálogo de staging. O plano completo está em `docs/rls-staging-validation.md`.
