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

## Banco de dados

Toda mudança de schema (tabela, coluna, índice, policy, função, trigger) entra
**só por arquivo de migration em `supabase/migrations/`, versionado numa branch
com PR** — nunca aplicada direto no banco pela ferramenta MCP do Supabase ou
por qualquer outro atalho manual. Uma migration aplicada só na produção, sem
arquivo correspondente, não pode ser reproduzida num ambiente novo (dev,
recuperação de desastre, ou uma segunda pessoa no time) e só é descoberta por
auditoria manual depois. Isso já aconteceu neste projeto (colunas
`actions.erp_subarea` e `projects.erp_area`/`erp_subarea`, corrigidas em
`supabase/migrations/20260928000000_add_erp_columns_actions_projects.sql`).

## Scripts

```bash
bun install     # instalar dependências
bun run dev     # ambiente de desenvolvimento (http://localhost:8080)
bun run build   # build de produção
bun run preview # pré-visualizar o build
bun run lint    # lint
```
