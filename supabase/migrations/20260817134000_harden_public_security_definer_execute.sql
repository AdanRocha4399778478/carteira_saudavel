-- Carteira Saudável 2.0
-- Remove execução direta de funções SECURITY DEFINER que existem apenas para
-- automação interna do banco (triggers/event triggers).
--
-- Não altera a lógica das funções nem dos triggers associados.
-- A migration precisa ser reprodutível: rls_auto_enable() existe no remoto,
-- mas não faz parte do histórico canônico usado pelo db reset local.

begin;

-- Função interna usada para habilitação automática de RLS. Ela existe no
-- ambiente remoto atual, porém pode não existir em ambientes reconstruídos
-- exclusivamente pelas migrations. Endurece somente quando estiver presente.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
    execute 'grant execute on function public.rls_auto_enable() to service_role';
  end if;
end
$$;

-- Função de trigger que mantém projects.consultant_id sincronizado com o
-- consultor responsável pelo cliente. O trigger continua funcionando mesmo
-- sem exposição direta da função ao cliente da API.
revoke all on function public.sync_project_consultant_from_client()
  from public, anon, authenticated;
grant execute on function public.sync_project_consultant_from_client()
  to service_role;

commit;
