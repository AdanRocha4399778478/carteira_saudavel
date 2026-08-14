# Validação de RLS em staging — Prompt 03B

**Data do checkpoint:** 2026-08-11
**Produção alterada:** NÃO
**Migration aplicada:** NÃO
**Motivo:** nenhum projeto Supabase separado de staging foi identificado no repositório ou nas variáveis locais disponíveis.

## 1. Estado do ambiente

| Item | Resultado | Evidência |
| --- | --- | --- |
| Projeto de staging | **NÃO IDENTIFICADO** | Há somente um conjunto de `SUPABASE_URL`/chaves públicas; não há variável, arquivo ou configuração com sufixo de staging. |
| URL de staging | Desconhecida | Nenhum valor foi exibido ou alterado. |
| Acesso administrativo/direct DB | Indisponível | Não há `DATABASE_URL`, service-role key, management token ou CLI vinculada no checkout. |
| Schema de staging | Não verificado | Requer conexão administrativa ao projeto separado. |
| Auth/policies/dados de teste | Não verificados | Requer staging e usuários de teste autorizados. |
| Produção | Intocada | Nenhuma migration, policy, configuração Auth ou dado foi modificado. |

O único backend configurado localmente **não foi tratado como staging**, pois não existe evidência que permita distingui-lo com segurança de produção.

## 2. O que é necessário para criar ou conectar staging

Não provisionar automaticamente. Após aprovação explícita:

1. Criar um projeto Supabase separado, com organização, região e plano aprovados.
2. Registrar URL e chaves próprias em um arquivo local não versionado, com nomes explícitos de staging.
3. Disponibilizar uma conexão administrativa temporária/direct DB ou acesso ao Dashboard para inventário de catálogo.
4. Reproduzir o schema por migrations/baseline revisadas; não copiar dados pessoais de produção.
5. Criar apenas dados sintéticos e três usuários: admin, consultor A e consultor B.
6. Configurar redirects de Auth para a URL de staging.
7. Desabilitar signup público somente no projeto de staging.
8. Executar o inventário abaixo antes de aplicar qualquer migration.

Credenciais e senhas nunca devem ser hardcoded, versionadas ou registradas neste documento.

## 3. Confirmações estáticas

### `consultant_id`

`src/lib/supabase/types.ts` declara a FK `clients_consultant_id_fkey`:

```text
clients.consultant_id → profiles.id
```

Também declara `projects.consultant_id → profiles.id`. O modelo documentado estabelece `profiles.id → auth.users.id` em relação 1:1. Assim, a comparação proposta `clients.consultant_id = auth.uid()` é coerente **no modelo**, mas a FK até `auth.users` deve ser reconfirmada no catálogo real de staging antes da aplicação.

### `has_role`

A migration preparada define:

```text
has_role(_user_id uuid, _role public.app_role) → boolean
LANGUAGE sql, STABLE, SECURITY DEFINER, search_path = public
```

Ela consulta `public.user_roles` e tem `EXECUTE` revogado de `PUBLIC`/`anon`, mas concedido a `authenticated` e `service_role`.

Riscos a validar antes de produção:

- o owner efetivo da função precisa ser uma role controlada e sem login cotidiano;
- qualquer autenticado pode consultar o papel de outro UUID conhecido, pois `_user_id` é arbitrário; isso é divulgação de autorização, embora não conceda papel;
- a função ignora RLS de `user_roles` por ser `SECURITY DEFINER`, comportamento necessário para evitar recursão, mas que aumenta a importância do owner, grants e `search_path`;
- `profiles.role` é legado e editável pela policy proposta do próprio perfil; ele não pode ser autoridade de backend nem fallback de autorização privilegiada.

## 4. Inventário real obrigatório — antes da migration

Executar com conexão administrativa **somente em staging** e guardar o resultado como evidência do teste:

```sql
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select
  p.oid::regprocedure as signature,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_userbyid(p.proowner) as owner,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('has_role', 'is_admin', 'can_access_client');

select
  con.conname,
  con.conrelid::regclass as source_table,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
where con.contype = 'f'
  and con.conrelid in ('public.clients'::regclass, 'public.projects'::regclass);
```

Tabelas mínimas do inventário: `clients`, `projects`, `meetings`, `actions`, `decisions`, `risks`, `opportunities`, `meeting_analyses`, `analysis_applications`, `entity_mentions`, `project_context`, `meeting_evolution`, `meeting_evolution_items`, `project_health_snapshots`, `project_dedupe_log`, `profiles`, `user_roles` e `risk_rules`.

## 5. Diferenças já identificadas na revisão estática

1. A migration remove policies somente por nomes conhecidos. Policies permissivas antigas com outros nomes continuariam combinadas por OR e poderiam manter acesso amplo.
2. Ela altera apenas as tabelas base e `project_dedupe_log`; o isolamento das demais depende de policies preexistentes que ainda não foram inventariadas no catálogo real.
3. `project_dedupe_log` recebe policies, mas a migration não executa explicitamente `ENABLE ROW LEVEL SECURITY` nem refaz seus grants.
4. O rollback do cabeçalho recria acesso permissivo; isso não restaura fielmente o estado anterior e representa regressão de segurança.
5. `profiles` permite ao usuário atualizar a linha inteira do próprio perfil, incluindo campos legados como `role` e `active`. Mesmo sem poder de backend, isso pode adulterar a apresentação/fallback do frontend.
6. A sintaxe é plausível para PostgreSQL/Supabase, mas não foi executada nem validada contra objetos reais. Dependências, owners, grants e nomes de policies permanecem pendentes.

Conclusão: **a migration atual não está aprovada para produção**. Antes do teste, ela deve ser ajustada com base no inventário real, especialmente para policies desconhecidas, `project_dedupe_log`, colunas editáveis de `profiles` e rollback fiel.

## 6. Matriz-alvo a validar — não confirmada no backend

Esta matriz representa o comportamento proposto pela migration/documentação, não resultado de teste real:

| Recurso | Admin read | Admin write | Consultor read | Consultor write |
| --- | --- | --- | --- | --- |
| `clients` | Todos | Todos | Próprios | Próprios; sem transferir ownership |
| `projects` | Todos | Todos | Dos próprios clientes | Dos próprios clientes |
| `meetings` | Todos | Todos | Dos próprios clientes | Criar/editar próprios; delete somente admin |
| `actions` | Todos | Todos | Dos próprios clientes | Dos próprios clientes |
| `decisions` | Todos | Todos | Dos próprios clientes | Conforme policy preexistente a inventariar |
| `risks` | Todos | Todos | Dos próprios clientes | Dos próprios clientes |
| `opportunities` | Todos | Todos | Dos próprios clientes | Dos próprios clientes |
| `meeting_analyses` e dependentes | Todos | Todos | Dos próprios clientes | Conforme policies preexistentes a inventariar |
| `profiles` | Todos | Todos | Todos para exibição da equipe | Próprio perfil, com restrição de colunas ainda pendente |
| `user_roles` | Todos | Todos | Próprias roles | Nenhuma |
| `risk_rules` | Todos | Todos | Todos | Nenhuma |

## 7. Execução do teste em staging

### Policies antes

**NÃO COLETADAS — staging não identificado.** Preencher com o resultado integral de `pg_policies` antes da migration.

### Migration aplicada

**NÃO.** Não houve autorização nem ambiente de staging identificável.

### Policies depois

**NÃO COLETADAS.** Comparar por tabela, comando, roles, `USING` e `WITH CHECK` após a aplicação transacional em staging.

### Usuários de teste

**NÃO CRIADOS.** Usar admin, consultor A e consultor B, com dados sintéticos e carteiras distintas.

### Testes positivos e negativos

Para cada usuário, testar pela API Supabase e pela aplicação:

- admin lê e escreve todas as entidades previstas;
- consultor A lê e escreve recursos permitidos de sua carteira;
- consultor A não lê cliente/projeto/reunião/ação/decisão/risco/análise/menção do consultor B, mesmo com ID conhecido e URL direta;
- consultor A não atualiza nem exclui recursos da carteira B;
- consultor não insere/atualiza/deleta `user_roles` e não transfere `consultant_id`;
- usuário sem role mantém privilégio mínimo e não ganha poder pelo `profiles.role`;
- anon não lê dados de negócio.

Registrar status HTTP/PostgREST, contagem retornada e IDs sintéticos, sem registrar tokens ou senhas.

### Auth em staging

Após desabilitar **Authentication → Providers → Email → Allow new users to sign up**:

1. novo `signUp` público deve ser rejeitado;
2. usuários existentes devem continuar autenticando;
3. `resetPasswordForEmail` deve enviar o link;
4. `onAuthStateChange` deve reconhecer o evento de recuperação;
5. `updateUser` deve trocar a senha;
6. nova autenticação deve funcionar com a senha alterada.

## 8. Rollback

Durante o primeiro teste, aplicar a migration dentro de transação e executar `ROLLBACK` diante de qualquer falha. Para rollback pós-commit, gerar **antes da mudança** uma reverse migration baseada no inventário real, contendo:

- definição exata de todas as policies anteriores;
- owners, grants e definições anteriores das três funções;
- estado anterior de RLS/force RLS por tabela;
- remoção apenas dos índices comprovadamente criados pela migration.

Não usar como rollback normal a policy genérica `USING (true) WITH CHECK (true)` descrita no cabeçalho atual: ela reabre a carteira e não restaura o estado anterior.

## 9. Recomendação para produção

**NÃO APROVAR AINDA.** O próximo checkpoint é fornecer ou aprovar a criação de staging separado e acesso administrativo temporário. Só considerar produção após inventário real, migration corrigida, testes com três usuários, isolamento negativo, escrita cruzada bloqueada, signup fechado, recuperação de senha validada e reverse migration testada.
