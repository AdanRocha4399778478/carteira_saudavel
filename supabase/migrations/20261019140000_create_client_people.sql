-- ============================================================================
-- Cadastro de pessoas e apelidos por cliente (19/10/2026).
--
-- Resolve o achado da bancada Maxipar (18/10 e 19/10): nomes conhecidos hoje
-- vêm só de `meetings.participants`/`decisions.owner`/`actions.owner_name`
-- já gravados (ver `clientKnownNamesQuery`) mais um seed fixo no código
-- (`OWNER_ALIAS_SEED`, só 2 clientes). Quem não fala na reunião (ex.: um
-- executor citado de passagem) nunca entra nessa lista, e apelidos variados
-- da mesma pessoa (Du, Dudu, Edu, Vedo) não convergem — `normalizeOwner`
-- só tira acento/caixa e pega o primeiro token, não casa foneticamente.
--
-- Esta migration cria só a tabela (Gate A: migration + tipos + testes). Uso
-- no prompt da IA, no preview e a tela de gerenciamento ficam para gates
-- seguintes.
--
-- Decisão do dono do produto (19/10/2026): cada pessoa tem FUNÇÕES PADRÃO,
-- porque nem sempre é o cliente que executa, monitora ou acompanha — as
-- quatro funções possíveis são "executa", "monitora", "acompanha" e
-- "decide" (coluna `functions text[]`, trava por CHECK contra essa lista
-- fechada).
--
-- Desenho (confirmado no diagnóstico de 19/10/2026):
--   - side: "cliente", "consultoria" ou "terceiro" (quem não é nem cliente
--     nem equipe de consultoria, ex.: fornecedor citado na reunião).
--   - nome canônico único por cliente, comparado normalizado (sem acento,
--     caixa ou pontuação) — reaproveita `public.normalize_project_name`,
--     já usado para o mesmo tipo de comparação em `projects.name`.
--   - apelidos (aliases) não podem repetir o nome canônico nem um apelido
--     de OUTRA pessoa do mesmo cliente — um índice único não cobre uma
--     comparação cruzada contra um array de outra linha, por isso o
--     gatilho `guard_client_people_unique_names` abaixo.
--   - RLS com os mesmos helpers de escopo das demais tabelas do cliente:
--     `app_private.can_access_client` (SELECT/INSERT/UPDATE — tabela não
--     tem project_id, por isso não é `can_access_scope`) e
--     `app_private.is_admin()` só para DELETE, mesmo padrão de
--     `indicators`/`indicator_points` (20261017120000).
--   - REVOKE ALL de PUBLIC/anon/authenticated antes dos GRANTs — o ACL
--     padrão do schema `public` concede TRUNCATE/REFERENCES/TRIGGER/
--     MAINTAIN a `authenticated` em toda tabela nova (mesma observação já
--     registrada na migration de indicators); sem o REVOKE explícito, a
--     tabela nasceria com privilégios que nunca deveria ter.
--
-- Esta migration só cria o schema — NÃO é aplicada automaticamente; o
-- dono do produto aplica manualmente depois de revisar.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- client_people
-- ---------------------------------------------------------------------------

CREATE TABLE public.client_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  side text NOT NULL CHECK (side IN ('cliente', 'consultoria', 'terceiro')),
  role text,
  -- Lista fechada de funções padrão (decisão do dono do produto, 19/10/2026).
  functions text[] NOT NULL DEFAULT '{}'
    CHECK (functions <@ ARRAY['executa', 'monitora', 'acompanha', 'decide']::text[]),
  active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Nome canônico único por cliente, comparado normalizado (sem acento, caixa
-- ou pontuação) — reaproveita a mesma função já usada para `projects.name`.
CREATE UNIQUE INDEX client_people_client_name_key
  ON public.client_people (client_id, public.normalize_project_name(name));
CREATE INDEX client_people_client_idx ON public.client_people (client_id);

-- Apelido não pode repetir o nome canônico nem um apelido de OUTRA pessoa do
-- mesmo cliente (nome canônico de uma pessoa também não pode repetir um
-- apelido de outra). Comparação cruzada contra array de outra linha não cabe
-- num índice único — por isso o gatilho, não uma CONSTRAINT declarativa.
CREATE OR REPLACE FUNCTION public.guard_client_people_unique_names()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_new_tokens text[];
  v_conflict_name text;
BEGIN
  SELECT array_agg(DISTINCT public.normalize_project_name(token))
  INTO v_new_tokens
  FROM unnest(array_append(NEW.aliases, NEW.name)) AS token;

  -- Nome e cada apelido precisam ter ao menos uma letra ou número — um token
  -- que normaliza para string vazia (".", "-", só espaço) não identifica
  -- ninguém.
  IF '' = ANY (v_new_tokens) THEN
    RAISE EXCEPTION 'nome ou apelido precisa ter letras ou números'
      USING ERRCODE = '23514';
  END IF;

  SELECT p.name INTO v_conflict_name
  FROM public.client_people p
  WHERE p.client_id = NEW.client_id
    AND p.id <> NEW.id
    AND EXISTS (
      SELECT 1
      FROM unnest(array_append(p.aliases, p.name)) AS existing_token
      WHERE public.normalize_project_name(existing_token) = ANY (v_new_tokens)
    )
  LIMIT 1;

  IF v_conflict_name IS NOT NULL THEN
    RAISE EXCEPTION 'nome ou apelido já usado por % neste cliente', v_conflict_name
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER client_people_unique_names_guard
  BEFORE INSERT OR UPDATE ON public.client_people
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_people_unique_names();

CREATE TRIGGER client_people_touch
  BEFORE UPDATE ON public.client_people
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS e grants
-- ---------------------------------------------------------------------------

ALTER TABLE public.client_people ENABLE ROW LEVEL SECURITY;

-- anon e PUBLIC sem nenhum privilégio — revogado explicitamente, mesmo sem
-- GRANT nenhum ter sido dado a eles ainda (defesa explícita, mesmo padrão de
-- indicators/indicator_points). authenticated TAMBÉM entra no REVOKE pelo
-- mesmo motivo: o ACL padrão do schema já concede TRUNCATE, REFERENCES,
-- TRIGGER e MAINTAIN a authenticated em toda tabela nova.
REVOKE ALL ON public.client_people FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_people TO authenticated;
GRANT ALL ON public.client_people TO service_role;

-- Tabela não tem project_id (pessoa é do cliente, não de um projeto
-- específico) — por isso `can_access_client`, não `can_access_scope`.
CREATE POLICY "client_people visible" ON public.client_people FOR SELECT TO authenticated
USING (app_private.can_access_client(client_id));
CREATE POLICY "client_people insert" ON public.client_people FOR INSERT TO authenticated
WITH CHECK (app_private.can_access_client(client_id));
CREATE POLICY "client_people update" ON public.client_people FOR UPDATE TO authenticated
USING (app_private.can_access_client(client_id))
WITH CHECK (app_private.can_access_client(client_id));
-- Delete só para admin, mesmo padrão de indicators/decisions.
CREATE POLICY "client_people delete" ON public.client_people FOR DELETE TO authenticated
USING (app_private.is_admin());

COMMIT;
