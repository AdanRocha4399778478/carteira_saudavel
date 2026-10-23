# Histórico de migrations: reconciliação com a produção

Data da reconciliação: 2026-10-23. Projeto de produção: `oywwzmtqjssiagiizdrc`.

O histórico de migrations do banco de produção diverge do repositório. Este
documento registra o que foi encontrado e como cada item será tratado. Nada
aqui desfaz algo no banco: a reconciliação só acerta o **registro** do
histórico.

> **Sobre os SQLs abaixo.** O repositório é público. Os textos originais foram
> extraídos de `supabase_migrations.schema_migrations` de produção em
> 2026-10-23 e **anonimizados**: a lógica e a estrutura de cada script foram
> mantidas, mas UUIDs, nomes de clientes, datas, notas e textos de negócio foram
> trocados por marcadores genéricos entre `< >`. O texto completo fica só com o
> administrador do projeto e no próprio histórico de produção. Os nomes dos
> registros foram mantidos porque são os identificadores necessários para
> marcá-los no histórico.

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
voltar a ser executados: os scripts de dados não são reaplicáveis (têm
condições fixas sobre linhas específicas). Serão marcados como `reverted` no
histórico de migrations (`supabase migration repair --status reverted`),
**sem desfazer nada no banco**. O estado dos dados que eles deixaram permanece
como está.

| Versão em produção | Registro | O que o SQL faz (confirmado pelo texto original) |
|---|---|---|
| 20260927184133 | `test_cascade_trigger_disposable` | Teste descartável: cria uma ação e um apontamento de tempo ligado a ela num cliente de teste, apaga a ação e exige que o apontamento tenha sido apagado junto. Falha com exceção se não for. |
| 20260927184143 | `test_project_cascade_disposable` | Teste descartável equivalente para projeto: cria projeto e apontamento, apaga o projeto e exige que o apontamento tenha sumido. |
| 20260927222635 | `fix_erinho_second_meeting_type` | `UPDATE` de dados: muda `meeting_type` de uma reunião específica de um cliente para `acompanhamento`. |
| 20260927222702 | `fix_erinho_third_meeting_type` | `UPDATE` de dados: o mesmo ajuste para a reunião seguinte do mesmo cliente. |
| 20260928161706 | `cleanup_qa_audit_test_clients` | `DELETE` de 2 clientes de teste de QA (identificados por id e pela observação), com conferência de contagem. |
| 20260929120632 | `backfill_bandrone_orphan_meetings` | Dados: atualiza notas e próxima ação de 3 reuniões órfãs de um cliente e insere 3 decisões e 3 ações vinculadas a elas, depois de conferir que não havia nada vinculado. |
| 20260929123013 | `delete_qa_kit_test_clients` | `DELETE` de 2 clientes de teste do kit de QA, depois de conferir que não têm registros em 15 tabelas. |
| 20260929123032 | `delete_grupo_erinho_orphan_meeting` | `DELETE` de 1 reunião órfã de um cliente, com conferência de cliente, data e contagem final de reuniões. |

### SQL original (anonimizado)

**20260927184133 — test_cascade_trigger_disposable**

```sql
DO $$
DECLARE
  v_action_id uuid;
  v_entry_id uuid;
  v_survived integer;
BEGIN
  INSERT INTO public.actions (client_id, description, status)
  VALUES ('<uuid-cliente-de-teste>', 'TESTE DESCARTÁVEL — trigger cascade', 'não iniciada')
  RETURNING id INTO v_action_id;

  INSERT INTO public.time_entries (client_id, consultant_id, erp_area, entity_type, entity_id, started_at, ended_at, duration_seconds, amount_cents)
  VALUES ('<uuid-cliente-de-teste>', '<uuid-consultor>', '<area-erp>', 'action', v_action_id, now(), now(), 60, <valor-em-centavos>)
  RETURNING id INTO v_entry_id;

  DELETE FROM public.actions WHERE id = v_action_id;

  SELECT count(*) INTO v_survived FROM public.time_entries WHERE id = v_entry_id;

  IF v_survived <> 0 THEN
    RAISE EXCEPTION 'FALHOU: apontamento sobreviveu à exclusão da ação (encontrados: %)', v_survived;
  END IF;

  RAISE NOTICE 'OK: apontamento vinculado foi apagado junto com a ação, como esperado.';
END $$;
```

**20260927184143 — test_project_cascade_disposable**

```sql
DO $$
DECLARE
  v_project_id uuid;
  v_entry_id uuid;
  v_survived integer;
BEGIN
  INSERT INTO public.projects (client_id, name)
  VALUES ('<uuid-cliente-de-teste>', 'TESTE DESCARTÁVEL — projeto cascade')
  RETURNING id INTO v_project_id;

  INSERT INTO public.time_entries (client_id, project_id, consultant_id, erp_area, started_at, ended_at, duration_seconds, amount_cents)
  VALUES ('<uuid-cliente-de-teste>', v_project_id, '<uuid-consultor>', '<area-erp>', now(), now(), 60, <valor-em-centavos>)
  RETURNING id INTO v_entry_id;

  DELETE FROM public.projects WHERE id = v_project_id;

  SELECT count(*) INTO v_survived FROM public.time_entries WHERE id = v_entry_id;

  IF v_survived <> 0 THEN
    RAISE EXCEPTION 'FALHOU: apontamento sobreviveu à exclusão do projeto (encontrados: %)', v_survived;
  END IF;

  RAISE NOTICE 'OK: apontamento do projeto foi apagado junto, como esperado.';
END $$;
```

**20260927222635 — fix_erinho_second_meeting_type**

```sql
-- Correção pontual de dado, não migration de schema: a segunda reunião do
-- cliente <cliente> (<data>) foi classificada como "diagnóstico" antes do
-- fix no prompt que distingue diagnóstico (primeira reunião) de
-- acompanhamento (reunião de projeto já em andamento). A primeira reunião
-- (<data>) permanece "diagnóstico" — está correta, era a primeira mesmo.
UPDATE public.meetings
SET meeting_type = 'acompanhamento'
WHERE id = '<uuid-reuniao>'
  AND client_id = '<uuid-cliente>';
```

**20260927222702 — fix_erinho_third_meeting_type**

```sql
UPDATE public.meetings
SET meeting_type = 'acompanhamento'
WHERE id = '<uuid-reuniao>'
  AND client_id = '<uuid-cliente>';
```

**20260928161706 — cleanup_qa_audit_test_clients**

```sql
-- Limpeza de dados de teste da auditoria da Reunião Inteligente (<data>).
-- Não é mudança de schema: remove só as 2 linhas de clients criadas com
-- notes="CLIENTE TESTE QA... Pode ser apagado." Exportadas antes em
-- um arquivo JSON local de exportação. Confirmado sem
-- nenhuma linha dependente em nenhuma das 15 tabelas com FK para clients.
DO $$
DECLARE
  v_before integer;
  v_after integer;
  v_deleted integer;
BEGIN
  SELECT count(*) INTO v_before FROM public.clients;

  DELETE FROM public.clients
  WHERE id IN ('<uuid-cliente-de-teste-1>','<uuid-cliente-de-teste-2>')
    AND notes LIKE 'CLIENTE TESTE QA%Pode ser apagado.%';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  SELECT count(*) INTO v_after FROM public.clients;

  IF v_deleted <> 2 THEN
    RAISE EXCEPTION 'Esperava excluir 2 linhas, excluiu %. Abortando.', v_deleted;
  END IF;
  IF v_before - v_after <> 2 THEN
    RAISE EXCEPTION 'Contagem não bateu: antes=%, depois=%. Abortando.', v_before, v_after;
  END IF;
  IF EXISTS (SELECT 1 FROM public.clients WHERE id IN ('<uuid-cliente-de-teste-1>','<uuid-cliente-de-teste-2>')) THEN
    RAISE EXCEPTION 'Linha órfã sobrou. Abortando.';
  END IF;

  RAISE NOTICE 'OK: % linhas excluídas. clients antes=%, depois=%.', v_deleted, v_before, v_after;
END $$;
```

**20260929120632 — backfill_bandrone_orphan_meetings**

```sql
DO $$
DECLARE
  v_client uuid := '<uuid-cliente>';
  v_project uuid := '<uuid-projeto>';
  v_m1 uuid := '<uuid-reuniao-1>'; -- <data-1>
  v_m2 uuid := '<uuid-reuniao-2>'; -- <data-2>
  v_m3 uuid := '<uuid-reuniao-3>'; -- <data-3>
  v_updated int;
  v_decisions int;
  v_actions int;
BEGIN
  -- Confirma que os 3 IDs ainda são exatamente os 3 órfãos esperados (0 decisões, 0 ações) antes de tocar neles.
  IF (SELECT count(*) FROM public.meetings
      WHERE id IN (v_m1, v_m2, v_m3) AND client_id = v_client) <> 3 THEN
    RAISE EXCEPTION 'esperava exatamente 3 reunioes do cliente com esses IDs, achou outra coisa';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.decisions WHERE meeting_id IN (v_m1, v_m2, v_m3)
    UNION ALL
    SELECT 1 FROM public.actions WHERE meeting_id IN (v_m1, v_m2, v_m3)
  ) THEN
    RAISE EXCEPTION 'ja existem decisoes/acoes vinculadas a uma dessas reunioes -- abortando para nao duplicar';
  END IF;

  UPDATE public.meetings SET
    satisfaction_score = <nota-1>, value_score = <nota-1>,
    next_action = '<texto da proxima acao 1>', action_owner = 'consultoria'
  WHERE id = v_m1;

  UPDATE public.meetings SET
    satisfaction_score = <nota-2>, value_score = <nota-2>,
    next_action = '<texto da proxima acao 2>', action_owner = 'consultoria'
  WHERE id = v_m2;

  UPDATE public.meetings SET
    satisfaction_score = <nota-3>, value_score = <nota-3>,
    next_action = '<texto da proxima acao 3>',
    action_owner = 'consultoria'
  WHERE id = v_m3;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  -- v_updated reflete só o último UPDATE (1) -- checagem real de todas as 3 é feita abaixo por SELECT.
  IF (SELECT count(*) FROM public.meetings WHERE id IN (v_m1, v_m2, v_m3) AND satisfaction_score IS NOT NULL) <> 3 THEN
    RAISE EXCEPTION 'nem todas as 3 reunioes foram atualizadas';
  END IF;

  INSERT INTO public.decisions (client_id, project_id, meeting_id, title, status)
  VALUES
    (v_client, v_project, v_m1, '<titulo da decisao 1>', 'implementada'),
    (v_client, v_project, v_m2, '<titulo da decisao 2>', 'implementada'),
    (v_client, v_project, v_m3, '<titulo da decisao 3>', 'implementada');
  GET DIAGNOSTICS v_decisions = ROW_COUNT;
  IF v_decisions <> 3 THEN
    RAISE EXCEPTION 'esperava inserir 3 decisoes, inseriu %', v_decisions;
  END IF;

  INSERT INTO public.actions (client_id, meeting_id, description, owner_name, priority, status)
  VALUES
    (v_client, v_m1, '<descricao da acao 1>', 'consultoria', 'média', 'concluída'),
    (v_client, v_m2, '<descricao da acao 2>', 'consultoria', 'média', 'concluída'),
    (v_client, v_m3, '<descricao da acao 3>', 'consultoria', 'média', 'não iniciada');
  GET DIAGNOSTICS v_actions = ROW_COUNT;
  IF v_actions <> 3 THEN
    RAISE EXCEPTION 'esperava inserir 3 acoes, inseriu %', v_actions;
  END IF;
END $$;
```

**20260929123013 — delete_qa_kit_test_clients**

```sql
DO $$
DECLARE
  v_c1 uuid := '<uuid-cliente-de-teste-1>'; -- QA Kit Cliente 1
  v_c2 uuid := '<uuid-cliente-de-teste-2>'; -- QA Kit Cliente 2
  v_deleted int;
BEGIN
  -- Re-confirma childless em todas as 15 tabelas com FK pra clients, na mesma transação do delete.
  IF (
    (select count(*) from public.projects where client_id in (v_c1, v_c2)) +
    (select count(*) from public.meetings where client_id in (v_c1, v_c2)) +
    (select count(*) from public.decisions where client_id in (v_c1, v_c2)) +
    (select count(*) from public.actions where client_id in (v_c1, v_c2)) +
    (select count(*) from public.risks where client_id in (v_c1, v_c2)) +
    (select count(*) from public.opportunities where client_id in (v_c1, v_c2)) +
    (select count(*) from public.meeting_analyses where client_id in (v_c1, v_c2)) +
    (select count(*) from public.entity_mentions where client_id in (v_c1, v_c2)) +
    (select count(*) from public.analysis_applications where client_id in (v_c1, v_c2)) +
    (select count(*) from public.meeting_evolution where client_id in (v_c1, v_c2)) +
    (select count(*) from public.meeting_evolution_items where client_id in (v_c1, v_c2)) +
    (select count(*) from public.orchestrator_recommendations where client_id in (v_c1, v_c2)) +
    (select count(*) from public.project_dedupe_log where client_id in (v_c1, v_c2)) +
    (select count(*) from public.project_health_snapshots where client_id in (v_c1, v_c2)) +
    (select count(*) from public.time_entries where client_id in (v_c1, v_c2))
  ) <> 0 THEN
    RAISE EXCEPTION 'QA Kit Cliente 1/2 nao estao mais childless -- abortando delete';
  END IF;

  IF (select count(*) from public.clients where id in (v_c1, v_c2) and company_name in ('QA Kit Cliente 1','QA Kit Cliente 2')) <> 2 THEN
    RAISE EXCEPTION 'os 2 IDs nao correspondem exatamente aos 2 clientes QA Kit esperados';
  END IF;

  DELETE FROM public.clients WHERE id IN (v_c1, v_c2);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 2 THEN
    RAISE EXCEPTION 'esperava apagar exatamente 2 clientes, apagou %', v_deleted;
  END IF;
END $$;
```

**20260929123032 — delete_grupo_erinho_orphan_meeting**

```sql
DO $$
DECLARE
  v_meeting uuid := '<uuid-reuniao-orfa>';
  v_client uuid := '<uuid-cliente>'; -- <cliente>
  v_deleted int;
BEGIN
  IF (select count(*) from public.decisions where meeting_id = v_meeting) +
     (select count(*) from public.actions where meeting_id = v_meeting) <> 0 THEN
    RAISE EXCEPTION 'a reuniao orfa deixou de ser orfa (ja tem decisao/acao vinculada) -- abortando';
  END IF;
  IF (select client_id from public.meetings where id = v_meeting) <> v_client THEN
    RAISE EXCEPTION 'meeting_id nao pertence ao cliente como esperado -- abortando';
  END IF;
  IF (select meeting_date from public.meetings where id = v_meeting) <> '<data-da-reuniao>' THEN
    RAISE EXCEPTION 'data da reuniao diverge do esperado -- abortando';
  END IF;

  DELETE FROM public.meetings WHERE id = v_meeting;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'esperava apagar exatamente 1 reuniao, apagou %', v_deleted;
  END IF;

  IF (select count(*) from public.meetings where client_id = v_client) <> <n> THEN
    RAISE EXCEPTION 'o cliente deveria ficar com exatamente <n> reunioes restantes';
  END IF;
END $$;
```

## 3. Três registros de produção que duplicam colunas já cobertas

Adicionam colunas que já estão em arquivos do repositório. Não precisam de
arquivo novo.

| Versão em produção | Registro | Já coberto por |
|---|---|---|
| 20260926170825 | `add_action_erp_subarea` | `20260928000000_add_erp_columns_actions_projects.sql` |
| 20260926171346 | `add_project_erp_classification` | `20260928000000_add_erp_columns_actions_projects.sql` |
| 20260926172321 | `add_time_entries_entity_link` | `20261022190000_add_time_entries_entity_columns.sql` |

Conferência do último: o SQL original cria `time_entries.entity_type`,
`time_entries.entity_id` e o índice parcial `time_entries_entity_idx` sobre
`(entity_type, entity_id) WHERE entity_id IS NOT NULL`, exatamente as mesmas
colunas e o mesmo índice parcial de `20261022190000`. O arquivo
`20260926172321_add_time_entries_entity_link.sql` também existe no commit
`717c9f9` (stash), mas não está na `main`.

### SQL original

**20260926170825 — add_action_erp_subarea**

```sql
ALTER TABLE public.actions ADD COLUMN IF NOT EXISTS erp_subarea text;
```

**20260926171346 — add_project_erp_classification**

```sql
-- Classificação de área principal do projeto (nullable, aditivo — não
-- substitui o nome livre, complementa). Uma área/subárea por projeto,
-- por decisão de produto: projetos multi-área ficam com a área dominante.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS erp_area text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS erp_subarea text;
```

**20260926172321 — add_time_entries_entity_link**

```sql
-- Vincula um apontamento de tempo a uma entidade específica (ação, decisão,
-- risco, oportunidade) — mesmo padrão já usado em entity_mentions
-- (entity_type + entity_id genéricos), em vez de uma coluna por tipo.
-- Nullable: a maioria dos apontamentos continua genérico (só cliente/projeto),
-- só quando iniciado a partir de um item específico é que fica preenchido.
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS entity_id uuid;

CREATE INDEX IF NOT EXISTS time_entries_entity_idx
  ON public.time_entries (entity_type, entity_id)
  WHERE entity_id IS NOT NULL;
```

## 4. Versões com mesmo nome e timestamp diferente (confirmado em produção)

O número de versão registrado difere entre o arquivo do repositório e o
histórico de produção. Este documento não compara o conteúdo das duas versões;
isso ainda não foi verificado.

| Migration | Versão no repo | Versão registrada em produção |
|---|---|---|
| admin_delete_project | 20260914220000 | 20260915011640 |
| create_time_entries | 20260926000000 | 20260926024947 |
| grant_time_entries_authenticated | 20260927000000 | 20260926051918 |
| fix_rls_scope_drift | 20260928120000 | 20260929131744 |
| fix_rls_time_entries_orchestrator | 20260929130000 | 20260929140233 |
| fix_orchestrator_insert_scope_drift | 20260929190000 | 20260929183414 |
| prevent_meeting_analyses_status_regression | 20261001010000 | 20261001032634 |
| add_is_recurring_to_actions | 20261001050000 | 20261001045158 |

## 5. Regra daqui para frente

Produção só é alterada por migration registrada. O script local
`scripts/apply-migration.local.ts` e SQL direto não registram histórico e não
devem ser usados em produção. Ver a seção "Banco de dados" do `README.md`.
