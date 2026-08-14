# Hardening de segurança e confiabilidade — Prompt 03A

**Data:** 2026-08-11
**Escopo:** alterações locais no repositório. Nenhuma configuração remota, migration, policy, dado ou estrutura do Supabase foi alterada.

## Estados usados neste documento

- **ESTADO CONFIRMADO NO CÓDIGO:** verificado no checkout local.
- **ESTADO CONFIRMADO NO BACKEND:** evidência da auditoria somente leitura de 2026-08-11; não reconfirmada neste hardening.
- **MIGRATION PREPARADA MAS NÃO APLICADA:** SQL versionado, sem execução.
- **AÇÃO MANUAL NECESSÁRIA:** atividade obrigatória fora do repositório.

## Hardening concluído no código

- `.env` removido do tracking e mantido apenas local; `.env`, `.env.*` e variantes locais são ignorados, preservando `.env.example`.
- `.gitattributes` define LF para código, configuração, documentação e SQL. O lint funcional foi separado da formatação legada; `bun run format` permanece disponível.
- Metadados e instruções residuais da Lovable foram removidos (`.lovable/project.json` e `AGENTS.md`). Não há dependência funcional da Lovable.
- `typecheck` e `test` foram formalizados em `package.json`.
- CI mínimo criado em `.github/workflows/ci.yml`, sem secrets e sem deploy: install congelado, typecheck, lint, testes e build.
- Entrada e saída da análise de IA possuem contratos Zod estritos no servidor.
- Limites explícitos rejeitam payloads excessivos sem truncamento silencioso: transcrição 360.000 caracteres, contexto individual 50.000 e payload total 500.000.
- Rate limit básico por usuário: 5 análises a cada 5 minutos. É intencionalmente local à instância e não substitui Redis/gateway em ambiente distribuído.
- A resposta do provedor é validada antes de alcançar o cliente; JSON incompleto ou fora do contrato vira erro controlado.
- `OPENAI_API_KEY` continua lida apenas em módulo `*.server.ts`; não há fallback para variável `VITE_*` nem logging do segredo.

## Dependências

Antes do hardening, `bun audit` reportava 5 vulnerabilidades altas, sendo 2 no conjunto de produção. Patches seguros foram fixados no lockfile para `js-yaml` e `nanoid`. Também foram removidas quatro dependências diretas sem uso (`@eslint/eslintrc`, `minimatch`, `postcss`, `xmlbuilder2`).

Depois do hardening:

- `bun audit --production`: 0 vulnerabilidades.
- `bun audit`: 3 altas, todas em `brace-expansion@1.1.16`, transitivo exclusivo do toolchain ESLint.
- O lockfile também contém `brace-expansion@5`; por isso um override global para `1.1.17` não é seguro. O Bun suporta overrides somente no nível superior e não oferece override transitivo por caminho. A correção definitiva depende de uma release compatível do ESLint e deve ser acompanhada, sem atualização major cega.

## Signup — ação obrigatória antes de produção

**AÇÃO MANUAL NECESSÁRIA — BLOQUEADOR DE PRODUÇÃO.** Ocultar cadastro no frontend não fecha o endpoint do Supabase Auth.

1. No Supabase Dashboard, abra **Authentication → Providers → Email**.
2. Desative **Allow new users to sign up**.
3. Salve a configuração.
4. Em staging, confirme que uma chamada nova de `signUp` é recusada.
5. Confirme que login de usuários existentes continua funcionando.
6. Confirme o fluxo completo de “Esqueci minha senha”, incluindo redirects permitidos e troca efetiva da senha.

O retrato de backend de 2026-08-11 registrou `disable_signup: false`. Isso não foi alterado neste trabalho.

## Revisão estática da migration de RLS

**MIGRATION PREPARADA MAS NÃO APLICADA:** `supabase/migrations/20260811120000_rls_scope_carteira.sql`.

A proposta é transacional e não contém mutação de dados, mas cria/recria funções, índices, grants e policies. Ela depende de:

- enum `public.app_role` e tabelas/colunas citadas existirem com os tipos esperados;
- FKs e ownership efetivos coincidirem com `src/lib/supabase/types.ts`;
- ownership seguro das funções `SECURITY DEFINER` e `search_path` fixo;
- RLS e grants atuais serem inventariados, inclusive em `project_dedupe_log`.

Risco crítico da revisão: os `DROP POLICY IF EXISTS` removem apenas nomes conhecidos. No PostgreSQL, policies permissivas aplicáveis são combinadas por OR; portanto, qualquer policy antiga com outro nome pode manter acesso amplo mesmo após a migration.

### Plano obrigatório de staging

1. Criar snapshot/backup recuperável e registrar schema, funções, grants e `pg_policies` antes da mudança.
2. Comparar o inventário real de policies com todos os nomes removidos/criados pelo SQL.
3. Ajustar a migration para tratar explicitamente qualquer policy legada desconhecida; não fazer remoção genérica em produção.
4. Executar a migration em uma transação de staging e revisar warnings/erros.
5. Testar anon, usuário sem role, consultant A, consultant B, admin e service role para SELECT/INSERT/UPDATE/DELETE.
6. Verificar especialmente autoelevação em `user_roles`, transferência de `consultant_id`, acesso cruzado e deletes reservados ao admin.
7. Rodar `EXPLAIN (ANALYZE, BUFFERS)` nas consultas críticas para avaliar o custo das funções usadas por linha.
8. Testar o rollback em staging. O rollback permissivo documentado reabre acesso amplo e serve apenas para emergência controlada.
9. Somente depois aprovar uma janela separada de produção, com monitoramento e plano de reversão.

## Privacidade da IA

Transcrições podem conter dados pessoais ou comerciais e são enviadas ao provedor configurado. Antes de produção, confirmar base legal, aviso ao usuário, política de retenção, contrato do provedor, região/processamento e restrição de logs. O rate limit local reduz abuso acidental, mas não é controle distribuído nem quota financeira definitiva.

## Checklist pré-produção

- [x] `.env` fora do tracking e arquivos locais ignorados.
- [x] Chave de IA restrita ao servidor no código.
- [x] Payload e resposta de IA validados com Zod.
- [x] Rate limit básico e testes automatizados.
- [x] Typecheck, lint, testes e build no CI.
- [x] Zero vulnerabilidades de produção no audit atual.
- [ ] Signup público desativado no dashboard.
- [ ] Recuperação de senha validada ponta a ponta em staging.
- [ ] Policies reais inventariadas e migration RLS validada em staging.
- [ ] Rate limit distribuído/quota financeira definidos para múltiplas instâncias.
- [ ] Política de privacidade e retenção de transcrições aprovada.

## Checkpoint de staging/RLS — Prompt 03B

Em 2026-08-11, nenhum projeto Supabase separado de staging foi identificado. O checkout possui somente um conjunto de URL/chaves públicas e nenhum acesso administrativo/direct DB. Por segurança, o backend configurado não foi sondado como staging, a migration não foi aplicada, usuários não foram criados e produção permaneceu intocada.

A revisão estática encontrou quatro bloqueadores adicionais: policies desconhecidas podem sobreviver aos `DROP POLICY` nominais; `project_dedupe_log` não recebe `ENABLE RLS` explícito; a policy de `profiles` permite alterar colunas legadas sensíveis à apresentação; e o rollback permissivo não restaura o estado anterior. Consulte `docs/rls-staging-validation.md` antes de qualquer aplicação.
