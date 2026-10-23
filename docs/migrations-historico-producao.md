# Histórico de migrations: reconciliação com a produção

Data da reconciliação: 2026-10-23. Projeto de produção: `oywwzmtqjssiagiizdrc`.

O histórico de migrations do banco de produção diverge do repositório. Este
documento registra o que foi encontrado e como cada item será tratado. Nada
aqui desfaz algo no banco: a reconciliação só acerta o **registro** do
histórico.

## 1. Migration adicionada: `20260927203713_add_project_context_erp_summaries.sql`

Registro de produção sem arquivo no repositório. O arquivo foi criado a partir
do histórico de produção (já aplicado lá) e é idempotente (`ADD COLUMN IF NOT
EXISTS`): adiciona `project_context.erp_summaries` (jsonb, `NOT NULL`, padrão
`'{}'`) e `project_context.erp_summaries_updated_at` (timestamptz).

**Atenção, a coluna existe em produção, mas o código que a usa nunca entrou na
`main`.** Uma busca em todo o repositório (`src`, `supabase`, `tests`, `docs`)
não encontra `erp_summaries` em nenhum arquivo, e `types.ts` também não tem a
coluna. O texto da migration e o código do "resumo por área"
(`src/lib/context-summary.server.ts` e `context-summary.functions.ts`)
existem só no commit `717c9f9`, que guarda arquivos não rastreados do `stash@{0}`
da branch `feat/unified-erp-taxonomy-and-entity-timer` (de 2026-09-28). Enquanto
esse código não for retomado, a coluna fica sem uso na aplicação. Não é erro,
mas é objeto de banco sem leitor.

## 2. Oito registros de produção: correções de dados e testes

Foram aplicados direto em produção. Não são mudanças de schema e não devem
voltar a ser executados. Serão marcados como `reverted` no histórico de
migrations (`supabase migration repair --status reverted`), **sem desfazer
nada no banco**. O estado dos dados que eles deixaram permanece como está.

| Registro de produção | Natureza |
|---|---|
| `fix_erinho_second_meeting_type` | Correção de dados (tipo da segunda reunião do Grupo Erinho) |
| `fix_erinho_third_meeting_type` | Correção de dados (tipo da terceira reunião do Grupo Erinho) |
| `cleanup_qa_audit_test_clients` | Limpeza de clientes de teste de auditoria de QA |
| `backfill_bandrone_orphan_meetings` | Preenchimento de reuniões órfãs (Bandrone) |
| `delete_qa_kit_test_clients` | Exclusão de clientes de teste do kit de QA |
| `delete_grupo_erinho_orphan_meeting` | Exclusão de uma reunião órfã do Grupo Erinho |
| `test_cascade_trigger_disposable` | Teste descartável de trigger em cascata |
| `test_project_cascade_disposable` | Teste descartável de cascata de projeto |

A coluna "Natureza" vem só dos nomes dos registros. O SQL original ainda não
foi anexado, então ela precisa ser confirmada contra o texto.

### SQL original

Para colar aqui quando disponível, um item por vez.

**fix_erinho_second_meeting_type**

```sql
-- SQL original: colar aqui
```

**fix_erinho_third_meeting_type**

```sql
-- SQL original: colar aqui
```

**cleanup_qa_audit_test_clients**

```sql
-- SQL original: colar aqui
```

**backfill_bandrone_orphan_meetings**

```sql
-- SQL original: colar aqui
```

**delete_qa_kit_test_clients**

```sql
-- SQL original: colar aqui
```

**delete_grupo_erinho_orphan_meeting**

```sql
-- SQL original: colar aqui
```

**test_cascade_trigger_disposable**

```sql
-- SQL original: colar aqui
```

**test_project_cascade_disposable**

```sql
-- SQL original: colar aqui
```

## 3. Três registros de produção que duplicam colunas já cobertas

Adicionam colunas que já estão em arquivos do repositório. Não precisam de
arquivo novo.

| Registro de produção | Já coberto por |
|---|---|
| `add_action_erp_subarea` | `20260928000000_add_erp_columns_actions_projects.sql` |
| `add_project_erp_classification` | `20260928000000_add_erp_columns_actions_projects.sql` |
| `add_time_entries_entity_link` | `20261022190000_add_time_entries_entity_columns.sql` |

Observação: o commit `717c9f9` também guarda um arquivo
`20260926172321_add_time_entries_entity_link.sql`. Falta comparar o texto dele
(e o SQL original abaixo) com a `20261022190000` para confirmar que a
cobertura é total.

### SQL original

**add_action_erp_subarea**

```sql
-- SQL original: colar aqui
```

**add_project_erp_classification**

```sql
-- SQL original: colar aqui
```

**add_time_entries_entity_link**

```sql
-- SQL original: colar aqui
```

## 4. Regra daqui para frente

Produção só é alterada por migration registrada. O script local
`scripts/apply-migration.local.ts` e SQL direto não registram histórico e não
devem ser usados em produção. Ver a seção "Banco de dados" do `README.md`.
