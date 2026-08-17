BEGIN;

-- Remove o diretório como view sobre profiles para que o frontend deixe de
-- depender de qualquer SELECT na tabela que contém email/role/created_at.
DROP VIEW IF EXISTS public.profile_directory;

CREATE TABLE public.profile_directory (
  id uuid PRIMARY KEY,
  full_name text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true
);

-- Backfill dos registros atuais sem copiar nenhum campo sensível.
INSERT INTO public.profile_directory (id, full_name, active)
SELECT id, full_name, active
FROM public.profiles
ON CONFLICT (id) DO UPDATE
SET full_name = EXCLUDED.full_name,
    active = EXCLUDED.active;

ALTER TABLE public.profile_directory ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.profile_directory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profile_directory TO authenticated;
GRANT ALL ON public.profile_directory TO service_role;

DROP POLICY IF EXISTS "profile directory visible" ON public.profile_directory;
CREATE POLICY "profile directory visible"
ON public.profile_directory
FOR SELECT
TO authenticated
USING (true);

-- O frontend não deve consultar profiles diretamente.
REVOKE SELECT ON public.profiles FROM authenticated;
DROP POLICY IF EXISTS "profiles visible" ON public.profiles;

-- Mantém apenas a possibilidade já existente de alterar o próprio nome.
-- A policy de UPDATE em profiles continua limitando ao próprio usuário/admin.
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

-- Sincronização interna do diretório. A função não é chamável por usuários;
-- ela roda apenas como trigger da tabela profiles.
CREATE OR REPLACE FUNCTION public.sync_profile_directory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.profile_directory WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.profile_directory (id, full_name, active)
  VALUES (NEW.id, NEW.full_name, NEW.active)
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      active = EXCLUDED.active;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_directory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_profile_directory() TO service_role;

DROP TRIGGER IF EXISTS profiles_sync_directory ON public.profiles;
CREATE TRIGGER profiles_sync_directory
AFTER INSERT OR UPDATE OF full_name, active OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_directory();

COMMIT;
