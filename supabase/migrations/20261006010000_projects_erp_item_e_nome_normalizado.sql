-- Terceiro nivel do ERP no projeto + nome normalizado sempre sincronizado com o nome.
--
-- O que faz (aditiva e reversivel):
--   1) projects.erp_item (texto, opcional): item de terceiro nivel do ERP.
--   2) Coerencia entre niveis: subarea exige area; item exige subarea.
--   3) Gatilho: normalized_name passa a ser sempre recalculado a partir de name
--      (hoje so a funcao get_or_create_project o calcula; renomear pela tela
--      deixava o indice unico (client_id, normalized_name) desatualizado).
--   4) Conserto unico dos normalized_name que ja estao desatualizados.
--
-- Valores ANTIGOS de normalized_name que o passo 4 corrige (guardados aqui para registro;
-- sao o unico rastro dos nomes originais dos projetos):
--   nome "Financeira"  : "verdade financeira"                                     -> "financeira"
--   nome "Financeiro"  : "diagnostico financeiro e plano de acao comercial e operacional" -> "financeiro"
--   nome "Financeira"  : "reestruturacao operacional e financeira"                -> "financeira"
--
-- ROLLBACK (se necessario; o passo 4 nao e revertido, os valores antigos estavam errados):
--   drop trigger if exists projects_sync_normalized_name on public.projects;
--   drop function if exists public.projects_sync_normalized_name();
--   alter table public.projects drop constraint if exists projects_erp_levels_chk;
--   alter table public.projects drop column if exists erp_item;

begin;

-- 1) Coluna do terceiro nivel (opcional).
alter table public.projects add column if not exists erp_item text;

-- 2) Coerencia entre os niveis.
alter table public.projects drop constraint if exists projects_erp_levels_chk;
alter table public.projects add constraint projects_erp_levels_chk check (
  (erp_subarea is null or erp_area is not null)
  and (erp_item is null or erp_subarea is not null)
);

-- 3) normalized_name acompanha o name em qualquer insercao ou troca de nome.
create or replace function public.projects_sync_normalized_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.normalized_name := nullif(public.normalize_project_name(new.name), '');
  return new;
end;
$$;

drop trigger if exists projects_sync_normalized_name on public.projects;
create trigger projects_sync_normalized_name
  before insert or update of name on public.projects
  for each row execute function public.projects_sync_normalized_name();

-- 4) Conserto unico: so as linhas cujo normalized_name esta desatualizado.
update public.projects
   set normalized_name = nullif(public.normalize_project_name(name), '')
 where normalized_name is distinct from nullif(public.normalize_project_name(name), '');

commit;
