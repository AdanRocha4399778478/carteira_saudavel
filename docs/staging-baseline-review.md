# Revisão da baseline local de staging

**Arquivo original:** `db/baseline/staging-baseline.sql`
**Data:** 2026-08-12
**Estado:** rascunho local, não executado, deliberadamente bloqueado para aplicação.

> Revisão histórica: o rascunho foi convertido na Fase 1 em
> `supabase/migrations/20260811000000_initial_schema.sql`. As lacunas impeditivas
> listadas abaixo descrevem o rascunho anterior, não a migration atual.

## Escopo e fontes

A baseline foi reconstruída exclusivamente de:

- `src/lib/supabase/types.ts`;
- `docs/backend-audit.md`;
- `docs/backend-map.md`;
- `supabase/migrations/20260811120000_rls_scope_carteira.sql`.

Não houve conexão remota, consulta à produção, alteração de staging ou execução de SQL. O arquivo não contém dados, usuários, e-mails de pessoas, clientes, transcrições, tokens ou senhas.

## Inventário representado

| Categoria | Quantidade | Nível de confiança |
| --- | ---: | --- |
| Tabelas | 18 | Alto para nomes/colunas/nulabilidade; parcial para tipos/defaults/constraints |
| Enum | 1 (`app_role`) | Alto |
| Funções/RPCs conhecidas | 8 | 3 com corpo local; 5 apenas com assinatura comentada |
| Triggers conhecidos | 5 | Apenas nome, tabela e evento documentados |
| Policies materializadas | 34 | Derivadas literalmente da migration local não aplicada |
| Índices materializados | 7 | 6 literais da migration; 1 dedupe parcialmente documentado |

### Tabelas

`actions`, `analysis_applications`, `clients`, `decisions`, `entity_mentions`, `meeting_analyses`, `meeting_evolution`, `meeting_evolution_items`, `meetings`, `opportunities`, `profiles`, `project_context`, `project_dedupe_log`, `project_health_snapshots`, `projects`, `risk_rules`, `risks`, `user_roles`.

## Reconstruído com alta confiança

- Os nomes das 18 tabelas e de todas as colunas vêm do tipo gerado.
- Nulabilidade deriva dos tipos `T` versus `T | null` em `Row`.
- Todas as tabelas possuem coluna `id`; ela foi representada como primary key, coerente com o mapa do backend e as relações geradas.
- As FKs expostas em `Relationships` foram representadas com os nomes gerados.
- `clients.consultant_id → profiles.id` e `projects.consultant_id → profiles.id` estão explícitas no tipo.
- O enum `app_role` possui exatamente `admin` e `consultant`.
- As funções `has_role`, `is_admin` e `can_access_client`, seus grants e seu `search_path` foram copiados da migration local.
- As 34 policies materializadas e seis índices de apoio foram copiados da migration local.
- RLS foi marcada como habilitada nas 18 tabelas, conforme a auditoria documentada.

## Reconstruído parcialmente

- Tipos SQL: o gerador TypeScript reduz vários tipos PostgreSQL a `string` ou `number`. A baseline usa `uuid`, `text`, `date`, `timestamptz`, `numeric` e `integer` por semântica, mas isso precisa de confirmação.
- Defaults: `Insert` indica que diversas colunas são opcionais, porém não preserva a expressão de default. Nenhum default desconhecido foi inventado.
- PKs: `id` foi tratado como PK em todas as tabelas, mas nomes e propriedades exatas das constraints precisam de catálogo.
- FKs para `auth.users`: sustentadas pela documentação, mas não aparecem em `Relationships` porque são cross-schema.
- Unicidade: `project_context.project_id` 1:1 e `analysis_applications.idempotency_key` são sustentados pelo tipo/documentação; detalhes exatos devem ser confirmados.
- O índice único de projetos por cliente/nome normalizado é documentado, mas nome, expressão, predicado e collation não estão disponíveis.
- Cinco RPCs têm somente assinaturas; nenhuma implementação fictícia foi criada.
- Cinco triggers têm somente comentários estruturados; a função executada e eventuais condições não são conhecidas.
- Policies das nove tabelas mais novas são mencionadas na auditoria, mas suas definições completas não existem localmente e não foram inventadas.

## Pontos que ainda precisam ser confirmados

1. Tipos PostgreSQL exatos de todas as colunas.
2. Defaults, identities/sequences e geração de UUIDs.
3. Checks, domínios, collations e limites numéricos/textuais.
4. Ações `ON DELETE` e `ON UPDATE` de todas as FKs.
5. PKs, uniques e índices não preservados no tipo gerado.
6. Extensions necessárias, especialmente as usadas na normalização/deduplicação.
7. Corpos, language, volatility, security mode e owners das cinco RPCs incompletas.
8. Função, ordem e cláusulas completas dos cinco triggers.
9. Policies completas das nove tabelas sem definição SQL local.
10. Grants de todas as tabelas/funções e eventuais sequences, além dos owners.
11. Estado real de RLS/force RLS e existência de policies legadas com outros nomes.
12. Valores exatos de defaults e constraints usados pelas rotinas de negócio e importação.

## Bloqueadores para aplicação segura

- Várias colunas `NOT NULL` dependem de defaults desconhecidos; inserts atuais poderiam falhar.
- Cinco RPCs essenciais (`normalize_project_name`, `merge_context_list`, `get_or_create_project`, `get_or_create_smart_meeting`, `import_meeting`) não têm corpo recuperável localmente.
- Os triggers de `updated_at` não podem ser criados sem a função real.
- Policies de nove tabelas estão ausentes; aplicar a baseline como está as deixaria com RLS habilitada e sem acesso autenticado.
- Tipos inferidos podem divergir do backend e quebrar RPCs, comparações, índices ou o cliente tipado.
- A migration RLS local ainda não foi validada contra o catálogo real e pode coexistir com policies permissivas desconhecidas.

## Proteção contra aplicação acidental

O SQL termina com uma exceção explícita dentro da transação e `ROLLBACK`. Essa barreira não substitui revisão: o arquivo deve permanecer fora da cadeia automática de migrations até que todos os pontos acima sejam resolvidos.

## Conclusão

O arquivo é útil como inventário executável parcial e base de comparação, mas **não é seguro para aplicação em staging**. A próxima etapa deve obter definições faltantes por fonte autoritativa de schema ou reconstruí-las individualmente com validação explícita, gerar uma versão final sem o bloqueio e revisá-la antes de qualquer execução.
