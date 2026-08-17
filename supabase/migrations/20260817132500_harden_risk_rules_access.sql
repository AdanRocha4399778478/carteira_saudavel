-- Carteira Saudável 2.0
-- Restringe os parâmetros internos de pontuação de risco a administradores.
-- Nenhum dado ou regra de cálculo é alterado; apenas a política de leitura.

begin;

alter table public.risk_rules enable row level security;

-- Mantém o acesso técnico do service_role e o acesso via sessão autenticada,
-- mas a RLS agora permite leitura somente para usuários com papel de admin.
grant select, insert, update, delete on public.risk_rules to authenticated;
grant all on public.risk_rules to service_role;

drop policy if exists "risk_rules visible" on public.risk_rules;
create policy "risk_rules visible"
  on public.risk_rules
  for select
  to authenticated
  using (public.is_admin());

-- Reafirma as barreiras de escrita para evitar que uma policy legada permissiva
-- sobreviva em ambientes que receberam versões anteriores da migration base.
drop policy if exists "risk_rules insert" on public.risk_rules;
create policy "risk_rules insert"
  on public.risk_rules
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "risk_rules update" on public.risk_rules;
create policy "risk_rules update"
  on public.risk_rules
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "risk_rules delete" on public.risk_rules;
create policy "risk_rules delete"
  on public.risk_rules
  for delete
  to authenticated
  using (public.is_admin());

commit;
