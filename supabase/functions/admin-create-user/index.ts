// Supabase Edge Function: admin-create-user
// Executa com privilégios de service_role de forma segura no servidor Deno do Supabase.
// Permite que apenas Administradores autenticados criem ou convidem novos usuários no Supabase Auth.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req: Request) => {
  // Trata requisições OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Configuração do servidor incompleta: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes.'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Valida o token de autorização do solicitante (Bearer token)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Acesso não autorizado: cabeçalho Authorization ausente.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // 2. Obtém o usuário solicitante a partir do token
    const { data: { user: callerUser }, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerUser) {
      return new Response(
        JSON.stringify({ success: false, error: 'Sessão inválida ou expirada. Faça login novamente.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Verifica se o solicitante possui papel 'Administrador' e está 'Ativo' em public.usuarios
    const { data: adminRecord, error: adminCheckError } = await supabaseAdmin
      .from('usuarios')
      .select('id, papel, situacao')
      .eq('auth_user_id', callerUser.id)
      .maybeSingle();

    if (adminCheckError || !adminRecord || adminRecord.papel !== 'Administrador' || adminRecord.situacao !== 'Ativo') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Permissão negada: apenas Administradores ativos podem cadastrar ou convidar novos usuários.'
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Lê os dados enviados no corpo da requisição
    const payload = await req.json();
    const {
      nome,
      matricula,
      email,
      login,
      perfilProfissional,
      setor,
      papel,
      situacao = 'Ativo',
      observacoes = '',
      sendInviteEmail = true,
      temporaryPassword
    } = payload;

    if (!email || !nome) {
      return new Response(
        JSON.stringify({ success: false, error: 'Campos obrigatórios ausentes: nome e e-mail são necessários.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Cria ou convida a conta no Supabase Auth
    let authUserId: string | null = null;
    let authErrorMsg: string | null = null;

    if (temporaryPassword && temporaryPassword.trim().length >= 6) {
      // Cria o usuário diretamente com senha temporária
      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim(),
        password: temporaryPassword.trim(),
        email_confirm: true,
        user_metadata: {
          nome,
          matricula,
          papel
        }
      });

      if (createError) {
        authErrorMsg = createError.message;
      } else if (createData.user) {
        authUserId = createData.user.id;
      }
    } else {
      // Envia convite oficial do Supabase Auth por e-mail institucional
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        email.trim(),
        {
          data: {
            nome,
            matricula,
            papel
          }
        }
      );

      if (inviteError) {
        authErrorMsg = inviteError.message;
      } else if (inviteData.user) {
        authUserId = inviteData.user.id;
      }
    }

    // Se houve erro porque o usuário já existe no Auth, busca o ID existente para vincular
    if (authErrorMsg && authErrorMsg.includes('already registered')) {
      const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
      const existing = listData?.users?.find(u => u.email?.toLowerCase() === email.trim().toLowerCase());
      if (existing) {
        authUserId = existing.id;
        authErrorMsg = null;
      }
    }

    if (authErrorMsg && !authUserId) {
      return new Response(
        JSON.stringify({ success: false, error: `Falha no Supabase Auth: ${authErrorMsg}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Registra ou atualiza o perfil em public.usuarios
    const now = new Date().toISOString();
    const usuarioPayload = {
      nome: String(nome).trim(),
      matricula: matricula ? String(matricula).trim() : null,
      email: String(email).trim().toLowerCase(),
      login: login ? String(login).trim() : String(email).trim().toLowerCase(),
      perfil_profissional: perfilProfissional || null,
      setor: setor || null,
      papel: papel || 'Usuário',
      situacao: situacao || 'Ativo',
      status: situacao || 'Ativo',
      observacoes: observacoes || null,
      auth_user_id: authUserId,
      created_by: callerUser.id,
      updated_by: callerUser.id,
      updated_at: now
    };

    // Verifica se já existe registro com este e-mail na tabela usuarios
    const { data: existingUser } = await supabaseAdmin
      .from('usuarios')
      .select('id')
      .ilike('email', email.trim())
      .maybeSingle();

    let usuarioRecord: any = null;
    if (existingUser) {
      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('usuarios')
        .update(usuarioPayload)
        .eq('id', existingUser.id)
        .select()
        .single();

      if (updateErr) {
        throw new Error(`Erro ao atualizar tabela usuarios: ${updateErr.message}`);
      }
      usuarioRecord = updated;
    } else {
      const newId = crypto.randomUUID();
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('usuarios')
        .insert({
          id: newId,
          ...usuarioPayload,
          created_at: now
        })
        .select()
        .single();

      if (insertErr) {
        throw new Error(`Erro ao inserir na tabela usuarios: ${insertErr.message}`);
      }
      usuarioRecord = inserted;
    }

    return new Response(
      JSON.stringify({
        success: true,
        authUserId,
        usuarioRecord,
        message: temporaryPassword
          ? 'Usuário e credenciais criados com sucesso.'
          : 'Convite enviado com sucesso para o e-mail institucional do usuário.'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Erro interno no processamento.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
