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

## Scripts

```bash
bun install     # instalar dependências
bun run dev     # ambiente de desenvolvimento (http://localhost:8080)
bun run build   # build de produção
bun run preview # pré-visualizar o build
bun run lint    # lint
```
