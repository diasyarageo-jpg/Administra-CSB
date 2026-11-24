# Configuração da Edge Function `admin-manage-user`

Este documento descreve a configuração de ambiente necessária para a Edge Function `supabase/functions/admin-manage-user/` (e alias `supabase/functions/admin-create-user/`), responsável pelas operações administrativas de contas de usuário do **Administra Barragens** (CSB / SURH / SEMA-MT).

> **Aviso de segurança:** Nunca registre senhas reais, chaves privadas, tokens ou dados pessoais em arquivos versionados, `.env`, código cliente ou logs.

---

## 1. Secrets obrigatórios no Supabase Dashboard

Configure as variáveis abaixo exclusivamente em **Supabase Dashboard → Edge Functions → Secrets** (nunca no código-fonte, em variáveis `VITE_*` ou em arquivos `.env` enviados ao navegador):

| Secret | Obrigatório | Finalidade |
| --- | --- | --- |
| `SUPABASE_URL` | Sim | URL do projeto Supabase para validação de sessão e chamadas administrativas no servidor. |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | Chave `service_role` restrita ao servidor da Edge Function para criação de contas Auth e atualização controlada de `public.usuarios`. |
| `DEFAULT_TEMP_PASSWORD` | Sim | Senha inicial temporária utilizada exclusivamente no servidor nas ações `create-user` e `reset-password`, em conjunto com `force_password_change = true`. |

### Regras sobre `DEFAULT_TEMP_PASSWORD`

1. Se `DEFAULT_TEMP_PASSWORD` não estiver configurado (ou estiver vazio) nas Secrets do Supabase Dashboard, as ações `create-user` e `reset-password` falham fechado no servidor sem criar nem alterar contas.
2. O valor do secret nunca deve ser enviado pelo navegador, retornado em respostas HTTP, gravado em `public.usuarios` ou exibido em logs.
3. Os usuários criados ou redefinidos por meio deste fluxo são marcados com `force_password_change = true` e têm o acesso às rotas operacionais bloqueado até concluírem a troca obrigatória de senha autenticados.

---

## 2. Contrato de ações suportadas

- `request-access`: bloqueada uniformemente com HTTP `409` antes de ler variáveis de ambiente ou acessar o banco.
- `create-user`: restrita a `Administrador` ativo; cria conta Auth com `DEFAULT_TEMP_PASSWORD`, vincula `public.usuarios` com `auth_user_id` e `force_password_change = true`, previne duplicidade (`email`, `login`, `matricula`, `auth_user_id`) e executa remoção compensatória no Auth (`auth.admin.deleteUser`) em caso de falha na gravação do perfil.
- `reset-password`: restrita a `Administrador` ativo; localiza o alvo exclusivamente por `auth_user_id` / cadastro vinculado (nunca apenas por e-mail), redefine a senha no Auth via `DEFAULT_TEMP_PASSWORD` e marca `force_password_change = true` somente após sucesso no Auth.
- `complete-password-change`: ação do próprio usuário autenticado ativo (`auth.uid()`) após troca de senha bem-sucedida no Supabase Auth, confirmando `force_password_change = false` exclusivamente para o registro vinculado ao seu `auth_user_id`.
- `approve-user`, `reject-user`, `list-access-requests`, `review-access-request`, `approve-access-request`: fluxos administrativos existentes preservados, com bloqueio contra alteração de papel de `Administrador` ativo na aprovação.

---

## 3. Publicação manual

A publicação da Edge Function no Supabase é um passo operacional manual controlado pela equipe responsável, após revisão das secrets configuradas no Supabase Dashboard.
