# Ambiente de desenvolvimento: recriar o dev e rodar o teste de RLS

Este documento é o que o cabeçalho de `supabase/tests/rls_regression.sql`
cita. Ele descreve o fluxo completo, em ordem:

1. `supabase db reset --linked` no projeto de **dev**;
2. seed fictício (`supabase/tests/seed_rls_dev.sql`);
3. teste de RLS (`supabase/tests/rls_regression.sql`).

Para o resto do ambiente de dev (arquivo `.env.development`, `bun run dev`,
`supabase db push` depois de uma migration nova), ver a seção "Ambiente de
desenvolvimento" do `README.md`.

> **Nunca rode nada disto na produção** (`oywwzmtqjssiagiizdrc`). O reset apaga
> o banco inteiro. O dev é o projeto `carteira_saudavel-dev`, ref
> `ukenqwltqbmeylkxpkhd`. A produção só é alterada por migration registrada
> (ver `README.md`, seção "Banco de dados", e
> `docs/migrations-historico-producao.md`).

## Pré-requisitos

- Supabase CLI instalada (`bunx supabase ...` serve) e logada na conta do
  projeto.
- Senha do banco do dev, se o CLI pedir.
- Repositório na `main` atualizada, com as migrations em `supabase/migrations/`.

## 0. Conferir que o projeto vinculado é o dev (faça sempre)

O `db reset --linked` age no projeto **vinculado**. Confirme três vezes antes
de continuar:

```bash
cat supabase/.temp/project-ref
```

Deve imprimir exatamente `ukenqwltqbmeylkxpkhd`.

```bash
cat supabase/.temp/linked-project.json
```

Deve mostrar `"name":"carteira_saudavel-dev"`.

```bash
bunx supabase projects list
```

No JSON, `ukenqwltqbmeylkxpkhd` deve ter `"linked":true` e
`oywwzmtqjssiagiizdrc` deve ter `"linked":false`.

Se qualquer um dos três não bater, **pare**. Para (re)vincular o dev:

```bash
bunx supabase link --project-ref ukenqwltqbmeylkxpkhd
```

## 1. Recriar o schema do dev

```bash
bunx supabase db reset --linked
```

Apaga o banco do dev e reaplica todas as migrations de `supabase/migrations/`.
Para conferir o resultado:

```bash
bunx supabase migration list --linked
```

Cada migration do repositório deve aparecer também no dev, sem sobras de nenhum
dos lados.

Depois do reset o banco fica **vazio** (o seed está desligado em
`supabase/config.toml`). Por isso o teste de RLS ainda não roda: ele precisa dos
dados do passo 2.

## 2. Seed fictício

```bash
bunx supabase db query --linked -f supabase/tests/seed_rls_dev.sql
```

O que o arquivo cria (tudo fictício, numa transação única):

- 3 usuários em `auth.users` (admin, consultora A e consultor B), sem senha e com
  e-mail `.invalid`: não há login possível;
- os papéis em `user_roles`;
- 2 clientes (A da consultora A, B do consultor B) e 1 projeto por cliente;
- 1 `time_entries` e 1 `orchestrator_recommendations` por cliente.

Ele só roda em banco **vazio**: se já houver usuário ou cliente, aborta com
"Banco nao esta vazio". Os registros levam a marca "SEED FICTICIO".

## 3. Teste de RLS

```bash
bunx supabase db query --linked -f supabase/tests/rls_regression.sql
```

O arquivo roda numa transação com `ROLLBACK` no fim, então não deixa efeito e
pode ser repetido. Simula consultora A, consultor B, admin e `anon`:

- consultora A e consultor B só enxergam e só escrevem no próprio cliente
  (inclusive em `time_entries` e `orchestrator_recommendations`);
- admin enxerga os 2 clientes;
- `anon` fica sem acesso: 0 linhas **ou** permission denied
  (`insufficient_privilege`) contam como "sem acesso".

**Como ler o resultado.** O teste levanta `RAISE EXCEPTION` na primeira policy
que falhar. Terminar **sem erro** significa que passou. O `db query` não mostra as
mensagens `RAISE NOTICE` ("OK: ..." e "Todos os cenários de RLS passaram"), então
a evidência é a ausência de erro. Se rodar por `psql`, os avisos aparecem.

## Quando rodar

Sempre que mexer em policy de RLS, em grants ou em função usada por policy
(`app_private.can_access_*`, `is_admin`). Depois de uma migration nova, aplique
no dev (`bunx supabase db push --linked`) e rode só o passo 3: o seed continua
valendo, não precisa resetar.

## Limpar o seed

Um novo `supabase db reset --linked` apaga tudo. Para voltar a rodar o teste,
repita os passos 2 e 3.

## Problemas comuns

- **"Banco nao esta vazio; abortando o seed."** O seed já foi aplicado, ou o dev
  tem dados. Rode o passo 1 de novo se quiser recomeçar.
- **`permission denied` em outro cenário que não o `anon`.** Pode ser regressão
  de grants ou de policy: investigue antes de ajustar o teste.
- **Falha de gatilho de escopo ao inserir o seed.** As inserções dependem de
  `auth.uid()` (o seed define `request.jwt.claims` como o admin fictício). Se uma
  migration nova mudou o gatilho, o seed precisa acompanhar.
- **O teste citou um cliente ou usuário que não existe.** Os IDs do teste e do
  seed são os mesmos (`00000000-0000-0000-0000-0000000c0a01` etc.); se mudar um,
  mude o outro.
