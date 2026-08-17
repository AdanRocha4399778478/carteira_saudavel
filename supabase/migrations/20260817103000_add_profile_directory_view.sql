BEGIN;

-- Diretório público mínimo para a UI. A tabela profiles permanece protegida e
-- continua sendo a fonte interna; o frontend recebe somente os campos usados
-- para identificação e seleção de consultores.
CREATE OR REPLACE VIEW public.profile_directory AS
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

COMMIT;
