# Autenticação, Papéis e Controle de Acesso — Carteira Saudável 2.0

Documento de referência do módulo de acesso. Descreve o estado mapeado antes
das alterações, o modelo alvo, a matriz de permissões e como validar.

---

## 1. Mapeamento realizado (estado ANTES)

### 1.1 `auth.users` ↔ `public.profiles`

- `profiles.id` é PK **e** FK para `auth.users.id` (relação 1:1).
- Campos relevantes: `id`, `full_name`, `email`, `role` (texto legado), `created_at`.
- `profiles.role` existe por herança do frontend antigo e **não é** a fonte de
  autoridade — é apenas descritivo/legado. A autoridade é `public.user_roles`.

### 1.2 `public.user_roles`

- Colunas: `id`, `user_id` (FK → `auth.users.id`), `role` (enum `app_role`).
- Valores reais do enum `app_role`: **`admin`** e **`consultant`**.
- Tabela separada de `profiles` — padrão correto, evita escalonamento de
  privilégio por auto-update do próprio perfil.

### 1.3 Funções de papel

| Função | Assinatura | Uso |
| --- | --- | --- |
| `public.has_role` | `(_user_id uuid, _role app_role) → boolean` | Verificação genérica |
| `public.is_admin` | `() → boolean` | Atalho para `has_role(auth.uid(),'admin')` |

Ambas são `SECURITY DEFINER` com `search_path = public` (necessário para evitar
recursão de RLS ao consultar `user_roles` dentro de policies de `user_roles`).

### 1.4 Relacionamentos de propriedade (ownership)

```text
auth.users.id
   └─ 1:1 ─ profiles.id
                ├── clients.consultant_id      (FK → profiles.id)
                └── projects.consultant_id     (FK → profiles.id)

clients.id
   ├── projects.client_id
   ├── meetings.client_id
   ├── actions.client_id
   ├── risks.client_id
   ├── opportunities.client_id
   └── project_dedupe_log.client_id

meetings.id
   ├── meeting_analyses.meeting_id
   ├── decisions.meeting_id
   └── entity_mentions.meeting_id
```

Consequência prática: **`clients.consultant_id` é a raiz do escopo de
carteira**. Toda entidade dependente resolve o dono subindo até `clients`.
Como `profiles.id = auth.users.id`, a comparação `consultant_id = auth.uid()`
é direta, sem join adicional.

`actions` possui `owner`/responsável como texto descritivo (nome do
responsável no cliente), **não** como FK de usuário — portanto o escopo de
`actions` é o cliente, não o responsável.

### 1.5 Policies existentes ANTES

| Grupo | Tabelas | Situação |
| --- | --- | --- |
| Escopadas (OK) | `projects`, `decisions`, `project_context`, `meeting_analyses`, `entity_mentions`, `analysis_applications`, `meeting_evolution`, `meeting_evolution_items`, `project_health_snapshots` | `is_admin() OR clients.consultant_id = auth.uid()`; DELETE só admin |
| **Sem escopo (risco)** | `clients`, `meetings`, `actions`, `risks`, `opportunities`, `profiles`, `user_roles`, `risk_rules` | acesso total a qualquer usuário autenticado |
| Permissiva | `project_dedupe_log` | `USING (true)` |

Risco central identificado: **um consultor autenticado enxergava e editava a
carteira inteira**, incluindo poder inserir a si mesmo em `user_roles` como
`admin`.

---

## 2. Modelo alvo

Ordem de aplicação da segurança (da mais forte para a mais fraca):

1. **Supabase Auth** — sessão válida obrigatória; cadastro público desativado
   no frontend por padrão (`VITE_ENABLE_PUBLIC_SIGNUP`).
2. **RLS** — habilitada em todas as tabelas de negócio.
3. **Roles** — `user_roles` + `has_role()`/`is_admin()` (`SECURITY DEFINER`).
4. **Ownership** — `clients.consultant_id = auth.uid()`, propagado às
   dependentes por `public.can_access_client(client_id)`.
5. **Frontend** — `useAccess()` apenas oculta/desabilita controles. Nunca é
   barreira de segurança.

### Papéis

| Papel | Escopo |
| --- | --- |
| `admin` | Toda a carteira: lê, cria, edita e exclui; administra papéis e parâmetros de risco. |
| `consultant` | Somente clientes em que `consultant_id = auth.uid()` e tudo que pende deles. |

Usuário sem linha em `user_roles` é tratado como `consultant` (fallback
mínimo-privilégio; o `profiles.role` legado só é lido nesse caso).

---

## 3. Matriz de permissões

`own` = restrito à carteira do consultor (imposto pela RLS).

| Recurso | admin | consultant (read) | insert | update | delete |
| --- | --- | --- | --- | --- | --- |
| `clients` | total | own | own (auto-atribuído) | own | — (só admin) |
| `projects` | total | own | own | own | — (só admin) |
| `meetings` | total | own | own | own | — (só admin) |
| `actions` | total | own | own | own | own |
| `risks` | total | own | own | own | own |
| `opportunities` | total | own | own | own | own |
| `decisions` / análises / menções | total | own | own | own | — (só admin) |
| `profiles` | total | todos (leitura, para exibir equipe) | — | próprio | — |
| `user_roles` | total | próprios papéis | — | — | — |
| `risk_rules` | total | leitura | — | — | — |

Regra anti-escalonamento: consultor **não** pode escrever em `user_roles` nem
transferir um cliente para outro consultor (o `WITH CHECK` das policies de
`clients` repete a condição do `USING`).

---

## 4. Alterações aplicadas

### Banco (SQL preparado, **não executado**)

`db/migrations/20260811120000_rls_scope_carteira.sql` — idempotente,
transacional, sem alterar dados ou estrutura de tabelas:

- `has_role`, `is_admin` recriadas como `SECURITY DEFINER` + `search_path`
  fixo; `EXECUTE` revogado de `PUBLIC`/`anon`.
- Nova função de escopo `public.can_access_client(uuid)`.
- Policies de escopo de carteira para `clients`, `meetings`, `actions`,
  `risks`, `opportunities`, `profiles`, `user_roles`, `risk_rules` e
  `project_dedupe_log`.
- `GRANT`s explícitos para `authenticated` e `service_role`.
- Índices em `clients(consultant_id)` e nos `client_id` das dependentes
  (a RLS avalia esses predicados por linha).
- Rollback documentado no cabeçalho do arquivo.

> **Este projeto usa Supabase externo (BYO)**: as ferramentas de migration do
> Lovable Cloud não estão habilitadas aqui, então o SQL não pôde ser aplicado
> pelo agente. Aplique com `supabase db push`, `psql`, ou pelo SQL Editor do
> dashboard. Até lá, as tabelas base seguem sem escopo por consultor.

### Frontend

| Arquivo | Mudança |
| --- | --- |
| `src/lib/auth/access.ts` | `accessQuery()` + `useAccess()`: carrega usuário, perfil e papéis **uma vez por sessão** (cache 5 min) e expõe `isAdmin`, `roles`, `can(recurso, ação)`. |
| `src/lib/auth/messages.ts` | Tradução de erros do Auth para PT-BR, sem revelar existência de conta. |
| `src/components/auth/AuthShell.tsx` | Moldura compartilhada das telas públicas de autenticação. |
| `src/routes/auth.tsx` | Passa a usar `AuthShell` (corrige a estrutura duplicada que gerava erro de hidratação), mensagens de erro claras, link “Esqueci minha senha”, limpeza do cache de autorização no login. |
| `src/routes/esqueci-senha.tsx` | Envio do link de redefinição (`redirectTo` → `/redefinir-senha`), resposta idêntica exista ou não a conta. |
| `src/routes/redefinir-senha.tsx` | Detecta a sessão de recuperação, valida a nova senha, atualiza e força novo login. |
| `src/components/painel/AppSidebar.tsx` | Papel exibido vem de `user_roles`; logout com higiene (cancelar queries → limpar cache → signOut → navegar com `replace`). |
| `src/routes/_authenticated/configuracoes.tsx` | Bloco “Minha conta”; critérios de risco somente-leitura para consultores (salvar só aparece para admin). |

`src/routes/_authenticated/route.tsx` foi mantido: já valida sessão com
`getUser()`, distingue falha de rede de sessão inválida e redireciona para
`/auth`.

---

## 5. Como validar

Banco (após aplicar a migration), autenticado como consultor:

```sql
-- deve retornar apenas os clientes do próprio consultor
select id, name, consultant_id from public.clients;

-- deve falhar (escalonamento de privilégio bloqueado)
insert into public.user_roles(user_id, role) values (auth.uid(), 'admin');

-- deve falhar (transferência de cliente)
update public.clients set consultant_id = '<outro-uuid>' where id = '<meu-cliente>';
```

Aplicação:

1. Login com credenciais erradas → mensagem “E-mail ou senha incorretos.”.
2. “Esqueci minha senha” → e-mail recebido → `/redefinir-senha` → nova senha →
   login com a nova senha.
3. Consultor: `/configuracoes` mostra os critérios de risco desabilitados e
   sem botão “Salvar critérios”.
4. Admin: os mesmos campos editáveis e o botão presente.
5. Logout → botão “Voltar” do navegador não restaura o painel.

---

## 6. Pendências conhecidas

- **Aplicar a migration** — enquanto isso não ocorre, o isolamento por
  carteira existe apenas nas tabelas já escopadas.
- **Cadastro público no backend** — o Supabase ainda aceita `signUp`. O
  frontend esconde a aba, mas o endpoint continua aberto: desative
  “Allow new users to sign up” no dashboard (Auth → Providers → Email).
- **Proteção contra senha vazada (HIBP)** — ativar em Auth → Providers → Email.
- **Convite de usuários por admin** — hoje depende do dashboard; uma tela de
  convite exigiria uma server function com service role.
