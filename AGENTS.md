<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

> [!IMPORTANT]
> Mudança de schema (tabela, coluna, índice, policy RLS, função, trigger) só
> entra por arquivo de migration em `supabase/migrations/`, numa branch com
> PR. Nunca aplique `ALTER TABLE`/`CREATE POLICY`/etc. direto na produção
> (`oywwzmtqjssiagiizdrc`) via ferramenta MCP ou qualquer atalho — mesmo para
> "resolver rápido" um teste ou validação. Se aplicar algo pontual num
> projeto de dev/branch descartável para investigar, o arquivo de migration
> ainda assim precisa existir e ser commitado antes de considerar o trabalho
> concluído. Já aconteceu de colunas existirem só em produção, sem arquivo
> nenhum no git — ver `supabase/migrations/20260928000000_add_erp_columns_actions_projects.sql`.
> Já aconteceu também com **policy de RLS**, que é mais grave: a auditoria de
> 2026-09-28 encontrou policies de produção bem mais permissivas do que as
> migrations descrevem — qualquer mudança de RLS precisa do mesmo tratamento,
> nunca aplicada direto pela ferramenta, sob nenhuma justificativa.
