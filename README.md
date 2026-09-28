# Carteira Saudável 2.0

Plataforma de gestão de carteira de clientes, projetos, reuniões e ações.

## Stack

- React 19 + TypeScript
- Vite + TanStack Start / TanStack Router / TanStack Query
- Tailwind CSS v4 + shadcn/ui
- Supabase (banco, auth e RLS existentes)

## Configuração

Copie `.env.example` para `.env` e preencha as variáveis:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
OPENAI_API_KEY=
```

## Ambiente de desenvolvimento (Supabase isolado da produção)

Existe um projeto Supabase de **dev** (`carteira_saudavel-dev`), separado da
produção, para rodar localmente e testar mudanças sem tocar em dado real.

1. Crie `.env.development` na raiz (gitignored via `.env.*`) com a URL e a
   chave anon/publishable do projeto de dev — peça ao administrador do
   projeto Supabase (não são as mesmas credenciais da produção). `OPENAI_API_KEY`
   é opcional: sem ela, o caminho de embeddings degrada graciosamente para
   comparação só por texto (ver `src/lib/embeddings.server.ts`).
2. Rode `bun run dev` normalmente. O Vite carrega `.env.development` antes de
   `.env` automaticamente pelo modo (`vite dev` roda em modo `development`) —
   **não precisa de nenhuma flag nem mudança de script**. Para confirmar qual
   banco está ativo, abra o DevTools e rode
   `(await import('/src/lib/supabase/client.ts')).supabase.supabaseUrl`.
3. Depois de qualquer migration nova em `supabase/migrations/`, aplique no
   projeto de dev com `supabase link --project-ref <ref-do-dev> && supabase db push`
   antes de testar — o dev não recebe migrations automaticamente.
4. Teste de regressão de RLS: `supabase/tests/rls_regression.sql` simula os
   3 papéis (admin, dois consultores fictícios) e confirma que cada um só
   lê/escreve o que devia. Rode contra o projeto de dev sempre que mexer em
   policy de RLS — ele falha alto (`RAISE EXCEPTION`) se alguma policy voltar
   a ficar `USING (true)` sem escopo.

## Scripts

```bash
bun install     # instalar dependências
bun run dev     # ambiente de desenvolvimento (http://localhost:8080)
bun run build   # build de produção
bun run preview # pré-visualizar o build
bun run lint    # lint
```
