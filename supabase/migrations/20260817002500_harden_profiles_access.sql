-- =============================================================================
-- Harden profiles access and role authority
--
-- Objetivo:
-- 1. Impedir que usuários autenticados leiam colunas sensíveis/legadas de
--    public.profiles, especialmente role, email e created_at.
-- 2. Manter somente os dados necessários para identificar consultores na UI.
-- 3. Impedir INSERT direto em profiles pelo frontend; a criação continua sendo
--    responsabilidade do trigger handle_new_auth_user().
-- 4. Manter user_roles como única fonte de autoridade para papéis de acesso.
--
-- Nenhum dado é alterado ou removido.
-- =============================================================================

BEGIN;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Remove privilégios amplos concedidos anteriormente.
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;

-- A UI precisa apenas identificar responsáveis e saber se estão ativos.
GRANT SELECT (id, full_name, active) ON public.profiles TO authenticated;

-- Edição direta pelo usuário fica limitada ao próprio nome.
-- E-mail é controlado pelo Supabase Auth; role pertence a user_roles.
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

-- Mantém acesso administrativo de backend/automação.
GRANT ALL ON public.profiles TO service_role;

-- As policies continuam definindo quais linhas podem ser lidas/alteradas.
DROP POLICY IF EXISTS "profiles visible" ON public.profiles;
DROP POLICY IF EXISTS "profiles insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles update" ON public.profiles;
DROP POLICY IF EXISTS "profiles delete" ON public.profiles;

CREATE POLICY "profiles visible"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "profiles update"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.is_admin() OR id = auth.uid())
WITH CHECK (public.is_admin() OR id = auth.uid());

-- INSERT e DELETE ficam sem policy para authenticated e, portanto, bloqueados.
-- O trigger de auth é SECURITY DEFINER e continua responsável pela criação.

COMMIT;
