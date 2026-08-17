-- Carteira Saudável 2.0
-- Remove execução direta de funções SECURITY DEFINER que existem apenas para
-- automação interna do banco (triggers/event triggers).
--
-- Não altera a lógica das funções nem dos triggers associados.

begin;

-- Função interna usada para habilitação automática de RLS. Não deve ficar
-- invocável pela API pública, usuários anônimos ou usuários autenticados.
revoke all on function public.rls_auto_enable()
  from public, anon, authenticated;
grant execute on function public.rls_auto_enable()
  to service_role;

-- Função de trigger que mantém projects.consultant_id sincronizado com o
-- consultor responsável pelo cliente. O trigger continua funcionando mesmo
-- sem exposição direta da função ao cliente da API.
revoke all on function public.sync_project_consultant_from_client()
  from public, anon, authenticated;
grant execute on function public.sync_project_consultant_from_client()
  to service_role;

commit;
