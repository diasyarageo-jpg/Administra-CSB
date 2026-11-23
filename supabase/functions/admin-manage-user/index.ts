// Supabase Edge Function: admin-manage-user
// Coordenadoria de Segurança de Barragens — CSB / SURH / SEMA-MT
// Operações privilegiadas no servidor com service role (nunca exposta no frontend)
//
// Ações disponíveis:
// 1. request-access: bloqueada com HTTP 409 uniforme sem consultar/alterar public.usuarios
// 2. approve-user: restrita a Administrador ativo; valida papel, cria/vincula no Auth (sem alterar senha existente) e só ativa após sucesso
// 3. reject-user: restrita a Administrador ativo; registra recusa sem conceder acesso
// 4. create-user: criação direta por Administrador ativo

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { handleAdminManageUserRequest } from './handler.ts';

serve((req: Request) =>
  handleAdminManageUserRequest(req, {
    envGet: (name: string) => Deno.env.get(name),
    createSupabaseClient: createClient
  })
);
