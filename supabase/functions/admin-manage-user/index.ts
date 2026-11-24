// Supabase Edge Function: admin-manage-user
// Coordenadoria de Segurança de Barragens — CSB / SURH / SEMA-MT
// Operações privilegiadas no servidor com service role (nunca exposta no frontend)
// Secrets esperados no Supabase Dashboard: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEFAULT_TEMP_PASSWORD
//
// Ações disponíveis:
// 1. request-access: bloqueada com HTTP 409 uniforme sem consultar/alterar public.usuarios
// 2. approve-user: restrita a Administrador ativo; valida papel, protege Administrador ativo, cria/vincula no Auth e só ativa após sucesso
// 3. reject-user: restrita a Administrador ativo; registra recusa sem conceder acesso
// 4. create-user: criação direta por Administrador ativo usando DEFAULT_TEMP_PASSWORD e force_password_change = true (com rollback em falha)
// 5. reset-password: redefinição administrativa por auth_user_id usando DEFAULT_TEMP_PASSWORD e force_password_change = true
// 6. complete-password-change: confirmação pelo próprio usuário autenticado ativo (via auth.uid()) após troca de senha no Auth
// 7. list-access-requests / review-access-request / approve-access-request: revisão administrativa segura de solicitações

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { handleAdminManageUserRequest } from './handler.ts';

serve((req: Request) =>
  handleAdminManageUserRequest(req, {
    envGet: (name: string) => Deno.env.get(name),
    createSupabaseClient: createClient
  })
);
