-- =============================================================================
-- Fix critical security scan findings for profiles/profile_directory
--
-- Objetivos:
-- 1. Fazer profile_directory executar com os privilégios do usuário chamador
--    (security_invoker), para que grants e RLS de profiles sejam respeitados.
-- 2. Impedir que qualquer usuário autenticado leia todas as linhas de profiles.
--    Administradores continuam vendo toda a equipe; consultores veem apenas o
--    próprio perfil. O frontend usa somente id, full_name e active.
--
-- Nenhum dado é alterado ou removido.
-- =============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.profile_directory
WITH (security_invoker = true)
AS
SELECT
  id,
  full_name,
  active
FROM public.profiles;

REVOKE ALL ON public.profile_directory FROM PUBLIC;
REVOKE ALL ON public.profile_directory FROM anon;
REVOKE ALL ON public.profile_directory FROM authenticated;
GRANT SELECT ON public.profile_directory TO authenticated;
GRANT SELECT ON public.profile_directory TO service_role;

DROP POLICY IF EXISTS "profiles visible" ON public.profiles;
CREATE POLICY "profiles visible"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.is_admin() OR id = auth.uid());

COMMIT;
