// Supabase Edge Function: admin-manage-user
// Operações privilegiadas no servidor Deno do Supabase sem expor service_role no frontend:
// 1. request-access (Pública/Anon): Registra solicitação pendente com senha cifrada (nunca em texto puro)
// 2. approve-user (Admin): Valida permissão do administrador, define papel, provisiona no Supabase Auth e ativa o usuário
// 3. reject-user (Admin): Registra recusa da solicitação sem conceder acesso
// 4. create-user (Admin): Cadastro direto por administrador com convite ou senha inicial

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function getCryptoKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const rawKey = enc.encode(secret);
  const hash = await crypto.subtle.digest('SHA-256', rawKey);
  return await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptText(text: string, secret: string): Promise<string> {
  const key = await getCryptoKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptText(encryptedBase64: string, secret: string): Promise<string> {
  const key = await getCryptoKey(secret);
  const binary = atob(encryptedBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const iv = bytes.slice(0, 12);
  const data = bytes.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

serve(async (req: Request) => {
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

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const payload = await req.json().catch(() => ({}));
    const action = payload.action || 'create-user';

    // -------------------------------------------------------------------------
    // AÇÃO 1: request-access (PÚBLICA / SEM AUTENTICAÇÃO PRÉVIA)
    // -------------------------------------------------------------------------
    if (action === 'request-access') {
      const { nome, matricula, email, login, perfilProfissional, setor, senha } = payload;

      if (!nome || !matricula || !email) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Campos obrigatórios ausentes: nome, matrícula e e-mail institucional são necessários.'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const emailClean = String(email).trim().toLowerCase();

      // Verifica se já existe um usuário ativo com este e-mail
      const { data: existingUser, error: checkErr } = await supabaseAdmin
        .from('usuarios')
        .select('id, email, situacao, status')
        .ilike('email', emailClean)
        .maybeSingle();

      if (!checkErr && existingUser) {
        if (existingUser.situacao === 'Ativo' || existingUser.status === 'Ativo') {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Já existe um cadastro ativo com este e-mail institucional. Utilize a opção de recuperação de senha ou contate a administração.'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Senha: se não fornecida ou menor que 6 caracteres, adota @12345
      const effectivePassword = (senha && String(senha).trim().length >= 6)
        ? String(senha).trim()
        : '@12345';

      // Criptografa a senha com AES-GCM (nunca armazena em texto puro)
      const senhaEnc = await encryptText(effectivePassword, serviceRoleKey);

      const now = new Date().toISOString();
      const loginClean = login ? String(login).trim().toLowerCase() : emailClean.split('@')[0];

      const recordPayload = {
        nome: String(nome).trim(),
        matricula: String(matricula).trim(),
        email: emailClean,
        login: loginClean,
        perfil_profissional: perfilProfissional || null,
        setor: setor || null,
        papel: 'Usuário', // Provisório: o administrador definirá a função na aprovação
        situacao: 'Pendente',
        status: 'Inativo',
        auth_user_id: null,
        senha_provisoria_enc: senhaEnc,
        updated_at: now
      };

      if (existingUser) {
        const { error: updErr } = await supabaseAdmin
          .from('usuarios')
          .update(recordPayload)
          .eq('id', existingUser.id);

        if (updErr) {
          throw new Error(`Erro ao atualizar solicitação: ${updErr.message}`);
        }
      } else {
        const newId = crypto.randomUUID();
        const { error: insErr } = await supabaseAdmin
          .from('usuarios')
          .insert({
            id: newId,
            ...recordPayload,
            created_at: now
          });

        if (insErr) {
          throw new Error(`Erro ao registrar solicitação: ${insErr.message}`);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Solicitação de acesso enviada com sucesso. Seu cadastro está pendente de aprovação pela Administração da CSB.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // PARA AS DEMAIS AÇÕES: EXIGE AUTORIZAÇÃO DE ADMINISTRADOR ATIVO
    // -------------------------------------------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Acesso não autorizado: token ausente.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user: callerUser }, error: callerError } = await supabaseAdmin.auth.getUser(token);

    if (callerError || !callerUser) {
      return new Response(
        JSON.stringify({ success: false, error: 'Sessão inválida ou expirada. Faça login novamente.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Valida se o solicitante é Administrador ativo na tabela usuarios
    const { data: adminRecord, error: adminErr } = await supabaseAdmin
      .from('usuarios')
      .select('id, papel, situacao')
      .eq('auth_user_id', callerUser.id)
      .maybeSingle();

    if (adminErr || !adminRecord || adminRecord.papel !== 'Administrador' || adminRecord.situacao !== 'Ativo') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Permissão negada: apenas Administradores ativos podem executar esta operação.'
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // AÇÃO 2: approve-user (Aprovação de solicitação pelo Administrador)
    // -------------------------------------------------------------------------
    if (action === 'approve-user') {
      const { usuarioId, papel } = payload;
      if (!usuarioId) {
        return new Response(
          JSON.stringify({ success: false, error: 'ID do usuário não fornecido.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const selectedPapel = ['Administrador', 'Usuário', 'Visualizador'].includes(papel)
        ? papel
        : 'Usuário';

      // Busca dados do usuário
      const { data: targetUser, error: targetErr } = await supabaseAdmin
        .from('usuarios')
        .select('*')
        .eq('id', usuarioId)
        .single();

      if (targetErr || !targetUser) {
        return new Response(
          JSON.stringify({ success: false, error: 'Registro de usuário não encontrado.' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Recupera e decifra a senha provisória se existir
      let passwordToSet = '@12345';
      if (targetUser.senha_provisoria_enc) {
        try {
          passwordToSet = await decryptText(targetUser.senha_provisoria_enc, serviceRoleKey);
        } catch {
          passwordToSet = '@12345';
        }
      }

      // Cria ou vincula a conta no Supabase Auth
      let authUserId = targetUser.auth_user_id;

      if (!authUserId) {
        const { data: createdAuth, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
          email: targetUser.email.trim(),
          password: passwordToSet,
          email_confirm: true,
          user_metadata: {
            nome: targetUser.nome,
            matricula: targetUser.matricula,
            papel: selectedPapel,
            must_change_password: true
          }
        });

        if (createAuthErr) {
          // Se já existe no Auth, busca pelo e-mail
          if (createAuthErr.message.includes('already registered')) {
            const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
            const existing = listData?.users?.find(
              u => u.email?.toLowerCase() === targetUser.email.trim().toLowerCase()
            );
            if (existing) {
              authUserId = existing.id;
              // Atualiza a senha no Auth existente
              await supabaseAdmin.auth.admin.updateUserById(existing.id, {
                password: passwordToSet,
                user_metadata: {
                  nome: targetUser.nome,
                  matricula: targetUser.matricula,
                  papel: selectedPapel
                }
              });
            } else {
              return new Response(
                JSON.stringify({ success: false, error: createAuthErr.message }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
          } else {
            return new Response(
              JSON.stringify({ success: false, error: `Falha no Supabase Auth: ${createAuthErr.message}` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } else if (createdAuth.user) {
          authUserId = createdAuth.user.id;
        }
      }

      // Atualiza public.usuarios ativando e limpando a senha cifrada
      const now = new Date().toISOString();
      const { data: updatedRecord, error: updErr } = await supabaseAdmin
        .from('usuarios')
        .update({
          papel: selectedPapel,
          situacao: 'Ativo',
          status: 'Ativo',
          auth_user_id: authUserId,
          senha_provisoria_enc: null,
          updated_by: callerUser.id,
          updated_at: now
        })
        .eq('id', usuarioId)
        .select()
        .single();

      if (updErr) {
        throw new Error(`Erro ao atualizar cadastro: ${updErr.message}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          authUserId,
          usuarioRecord: updatedRecord,
          message: `Usuário aprovado com sucesso com a função ${selectedPapel}.`
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // AÇÃO 3: reject-user (Recusa de solicitação pelo Administrador)
    // -------------------------------------------------------------------------
    if (action === 'reject-user') {
      const { usuarioId, motivo } = payload;
      if (!usuarioId) {
        return new Response(
          JSON.stringify({ success: false, error: 'ID do usuário não fornecido.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const now = new Date().toISOString();
      const noteAppend = motivo ? ` [Recusa em ${new Date().toLocaleDateString('pt-BR')}: ${motivo}]` : '';

      const { data: existingUser } = await supabaseAdmin
        .from('usuarios')
        .select('observacoes')
        .eq('id', usuarioId)
        .single();

      const newObs = (existingUser?.observacoes || '') + noteAppend;

      const { data: updatedRecord, error: updErr } = await supabaseAdmin
        .from('usuarios')
        .update({
          situacao: 'Recusado',
          status: 'Inativo',
          senha_provisoria_enc: null,
          observacoes: newObs.trim() || null,
          updated_by: callerUser.id,
          updated_at: now
        })
        .eq('id', usuarioId)
        .select()
        .single();

      if (updErr) {
        throw new Error(`Erro ao recusar usuário: ${updErr.message}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          usuarioRecord: updatedRecord,
          message: 'Solicitação de acesso recusada.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // AÇÃO 4: create-user (Criação direta por Administrador)
    // -------------------------------------------------------------------------
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

    let authUserId: string | null = null;
    let authErrorMsg: string | null = null;

    if (temporaryPassword && temporaryPassword.trim().length >= 6) {
      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim(),
        password: temporaryPassword.trim(),
        email_confirm: true,
        user_metadata: { nome, matricula, papel }
      });

      if (createError) {
        authErrorMsg = createError.message;
      } else if (createData.user) {
        authUserId = createData.user.id;
      }
    } else {
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        email.trim(),
        { data: { nome, matricula, papel } }
      );

      if (inviteError) {
        authErrorMsg = inviteError.message;
      } else if (inviteData.user) {
        authUserId = inviteData.user.id;
      }
    }

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
      status: (situacao === 'Inativo' || situacao === 'Recusado') ? 'Inativo' : 'Ativo',
      observacoes: observacoes || null,
      auth_user_id: authUserId,
      created_by: callerUser.id,
      updated_by: callerUser.id,
      updated_at: now
    };

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

      if (updateErr) throw new Error(updateErr.message);
      usuarioRecord = updated;
    } else {
      const newId = crypto.randomUUID();
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('usuarios')
        .insert({ id: newId, ...usuarioPayload, created_at: now })
        .select()
        .single();

      if (insertErr) throw new Error(insertErr.message);
      usuarioRecord = inserted;
    }

    return new Response(
      JSON.stringify({
        success: true,
        authUserId,
        usuarioRecord,
        message: 'Usuário processado com sucesso.'
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
