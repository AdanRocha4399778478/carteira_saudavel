-- =============================================================================
-- Teste de regressão de RLS — escopo consultor/admin.
--
-- Roda contra um projeto Supabase (dev, nunca produção) via apply_migration
-- ou psql, usando `SET LOCAL ROLE authenticated` + `request.jwt.claims` para
-- simular cada usuário exatamente como o PostgREST faz. Cada bloco levanta
-- exceção com mensagem clara se a policy não estiver escopada corretamente —
-- se alguma policy voltar a ser `USING (true)`, este teste FALHA.
--
-- Pré-requisito: os 3 usuários fictícios e os 2 clientes/projetos do seed
-- (ver docs/dev-environment.md ou README) precisam existir no projeto.
--
-- Todo o arquivo roda dentro de uma transação com ROLLBACK no final — não
-- deixa nenhum efeito, seguro para rodar quantas vezes quiser.
-- =============================================================================

BEGIN;

-- ---------- helper: troca de identidade simulada ----------
-- (repetido em cada bloco porque SET LOCAL só vale até o fim da transação
--  ou do próximo SET LOCAL — aqui usamos savepoints para isolar cada cenário)

SAVEPOINT antes_consultora_a;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}';

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.clients;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHOU (consultora A / clients): esperado 1, veio %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.clients WHERE id = '00000000-0000-0000-0000-0000000c0b01';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHOU (consultora A / cliente B por id): deveria ser invisível, mas apareceu';
  END IF;

  SELECT count(*) INTO v_count FROM public.actions WHERE client_id = '00000000-0000-0000-0000-0000000c0b01';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHOU (consultora A / ações do cliente B): esperado 0, veio %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.decisions WHERE client_id = '00000000-0000-0000-0000-0000000c0b01';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHOU (consultora A / decisões do cliente B): esperado 0, veio %', v_count;
  END IF;

  -- Tentativa de escrita no cliente do outro consultor não deve afetar nenhuma linha.
  UPDATE public.clients SET notes = 'tentativa indevida' WHERE id = '00000000-0000-0000-0000-0000000c0b01';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHOU (consultora A / UPDATE no cliente B): deveria afetar 0 linhas, afetou %', v_count;
  END IF;

  RAISE NOTICE 'OK: consultora A vê só o próprio cliente, sem leitura nem escrita no cliente B.';
END $$;
ROLLBACK TO SAVEPOINT antes_consultora_a;

-- ---------- consultor B: espelho do teste acima ----------
SAVEPOINT antes_consultor_b;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b001","role":"authenticated"}';

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.clients;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHOU (consultor B / clients): esperado 1, veio %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.clients WHERE id = '00000000-0000-0000-0000-0000000c0a01';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHOU (consultor B / cliente A por id): deveria ser invisível, mas apareceu';
  END IF;

  UPDATE public.clients SET notes = 'tentativa indevida' WHERE id = '00000000-0000-0000-0000-0000000c0a01';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHOU (consultor B / UPDATE no cliente A): deveria afetar 0 linhas, afetou %', v_count;
  END IF;

  RAISE NOTICE 'OK: consultor B vê só o próprio cliente, sem leitura nem escrita no cliente A.';
END $$;
ROLLBACK TO SAVEPOINT antes_consultor_b;

-- ---------- admin: vê tudo ----------
SAVEPOINT antes_admin;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a000","role":"authenticated"}';

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.clients;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FALHOU (admin / clients): esperado 2, veio %', v_count;
  END IF;
  RAISE NOTICE 'OK: admin vê os % clientes.', v_count;
END $$;
ROLLBACK TO SAVEPOINT antes_admin;

-- ---------- anon: não enxerga nada (sem claims válidos) ----------
SAVEPOINT antes_anon;
SET LOCAL ROLE anon;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.clients;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHOU (anon / clients): esperado 0, veio % — nenhuma policy deveria expor dado a anon', v_count;
  END IF;
  RAISE NOTICE 'OK: role anon não vê nenhum cliente.';
END $$;
ROLLBACK TO SAVEPOINT antes_anon;

DO $$ BEGIN RAISE NOTICE '=== Todos os cenários de RLS passaram ==='; END $$;

ROLLBACK;
