// Supabase Edge Function: admin-manage-user (pure request handler)
// Coordenadoria de Segurança de Barragens — CSB / SURH / SEMA-MT
// Operações privilegiadas no servidor com service role (nunca exposta no frontend)

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

export interface AdminManageUserDeps {
  envGet: (name: string) => string | undefined;
  createSupabaseClient: (
    supabaseUrl: string,
    serviceRoleKey: string,
    options: {
      auth: {
        autoRefreshToken: boolean;
        persistSession: boolean;
      };
    }
  ) => any;
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

export async function handleAdminManageUserRequest(
  req: Request,
  deps: AdminManageUserDeps
): Promise<Response> {
  // Tratamento de preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const safePayload =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, any>)
        : {};
    const action = String(safePayload.action ?? '').trim() || 'request-access';

    // =========================================================================
    // AÇÃO 1: request-access (Bloqueada uniformemente sem consultar ou alterar public.usuarios)
    // =========================================================================
    if (action.toLowerCase() === 'request-access') {
      return jsonResponse(
        {
          success: false,
          error:
            'Solicitação pública de acesso desativada. Contas institucionais são habilitadas exclusivamente pela Administração da CSB.'
        },
        409
      );
    }

    const supabaseUrl = deps.envGet('SUPABASE_URL');
    const serviceRoleKey = deps.envGet('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        {
          success: false,
          error: 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas no ambiente da Edge Function.'
        },
        500
      );
    }

    const supabaseAdmin = deps.createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // =========================================================================
    // DEMAIS AÇÕES: AUTENTICAÇÃO E VALIDAÇÃO DE ADMINISTRADOR ATIVO
    // =========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Acesso não autorizado: token de autenticação ausente.' }, 401);
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const {
      data: { user: callerUser },
      error: callerError
    } = await supabaseAdmin.auth.getUser(token);

    if (callerError || !callerUser) {
      return jsonResponse({ success: false, error: 'Sessão inválida ou expirada. Efetue login novamente.' }, 401);
    }

    // Valida se o solicitante possui perfil de Administrador ativo na tabela usuarios
    const { data: adminRecord, error: adminErr } = await supabaseAdmin
      .from('usuarios')
      .select('id, papel, situacao')
      .eq('auth_user_id', callerUser.id)
      .maybeSingle();

    if (adminErr || !adminRecord || adminRecord.papel !== 'Administrador' || adminRecord.situacao !== 'Ativo') {
      return jsonResponse(
        {
          success: false,
          error: 'Permissão negada: apenas administradores ativos podem aprovar, recusar ou gerenciar usuários.'
        },
        403
      );
    }

    // =========================================================================
    // AÇÃO 2: approve-user (Aprovação e provisionamento pelo Administrador)
    // =========================================================================
    if (action === 'approve-user') {
      const { usuarioId, papel } = safePayload;
      if (!usuarioId) {
        return jsonResponse({ success: false, error: 'ID do usuário não fornecido.' }, 400);
      }

      // Validação estrita da função permitida (RBAC)
      const allowedRoles = ['Administrador', 'Usuário', 'Visualizador'];
      if (!allowedRoles.includes(papel)) {
        return jsonResponse(
          {
            success: false,
            error: `Papel inválido '${papel}'. As funções permitidas são: ${allowedRoles.join(', ')}.`
          },
          400
        );
      }
      const selectedPapel = papel;

      // Busca dados do usuário a ser aprovado
      const { data: targetUser, error: targetErr } = await supabaseAdmin
        .from('usuarios')
        .select('*')
        .eq('id', usuarioId)
        .single();

      if (targetErr || !targetUser) {
        return jsonResponse({ success: false, error: 'Cadastro de usuário não encontrado.' }, 404);
      }

      const targetEmail = String(targetUser.email).trim().toLowerCase();

      // Procura conta existente no Supabase Auth correspondente ao e-mail
      const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000
      });

      if (listErr) {
        return jsonResponse({ success: false, error: `Falha ao consultar Supabase Auth: ${listErr.message}` }, 500);
      }

      const existingAuth = listData?.users?.find((u: any) => u.email?.toLowerCase() === targetEmail);
      let authUserId: string;

      if (existingAuth) {
        // Conta Auth já existe: vincula após confirmar e-mail SEM ALTERAR a senha existente
        authUserId = existingAuth.id;
        const { error: updAuthErr } = await supabaseAdmin.auth.admin.updateUserById(existingAuth.id, {
          email_confirm: true,
          user_metadata: {
            ...existingAuth.user_metadata,
            nome: targetUser.nome,
            matricula: targetUser.matricula,
            papel: selectedPapel
          }
        });

        if (updAuthErr) {
          return jsonResponse(
            { success: false, error: `Falha ao atualizar metadados da conta Auth: ${updAuthErr.message}` },
            500
          );
        }
      } else {
        // Conta Auth não existe: cria conta por convite oficial de e-mail (Supabase Auth invite)
        const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
          targetEmail,
          {
            data: {
              nome: targetUser.nome,
              matricula: targetUser.matricula,
              papel: selectedPapel
            }
          }
        );

        if (inviteErr) {
          // Se o envio de convite por e-mail falhar (ex.: provedor SMTP não configurado no projeto),
          // cria o usuário confirmado e envia link de recuperação para definição de senha
          const { data: createdAuth, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
            email: targetEmail,
            email_confirm: true,
            user_metadata: {
              nome: targetUser.nome,
              matricula: targetUser.matricula,
              papel: selectedPapel
            }
          });

          if (createAuthErr || !createdAuth.user) {
            return jsonResponse(
              {
                success: false,
                error: `Falha ao criar conta no Supabase Auth: ${createAuthErr?.message || inviteErr.message}`
              },
              500
            );
          }
          authUserId = createdAuth.user.id;
        } else if (inviteData?.user) {
          authUserId = inviteData.user.id;
        } else {
          return jsonResponse({ success: false, error: 'Falha inesperada ao provisionar usuário no Auth.' }, 500);
        }
      }

      // SÓ marca o cadastro como Ativo DEPOIS que a operação no Supabase Auth tiver sucesso
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
        return jsonResponse(
          {
            success: false,
            error: `Conta criada no Auth, mas falhou ao atualizar cadastro: ${updErr.message}`
          },
          500
        );
      }

      return jsonResponse({
        success: true,
        authUserId,
        usuarioRecord: updatedRecord,
        message: `Usuário aprovado com sucesso! Situação alterada para Ativo com papel ${selectedPapel}.`
      });
    }

    // =========================================================================
    // AÇÃO 3: reject-user (Recusa de solicitação pelo Administrador)
    // =========================================================================
    if (action === 'reject-user') {
      const { usuarioId, motivo } = safePayload;
      if (!usuarioId) {
        return jsonResponse({ success: false, error: 'ID do usuário não fornecido.' }, 400);
      }

      const now = new Date().toISOString();
      const noteAppend = motivo ? ` [Recusado em ${new Date().toLocaleDateString('pt-BR')}: ${String(motivo).trim()}]` : '';

      const { data: existingUser } = await supabaseAdmin
        .from('usuarios')
        .select('observacoes')
        .eq('id', usuarioId)
        .single();

      const newObs = ((existingUser?.observacoes || '') + noteAppend).trim();

      const { data: updatedRecord, error: updErr } = await supabaseAdmin
        .from('usuarios')
        .update({
          situacao: 'Recusado',
          status: 'Inativo',
          senha_provisoria_enc: null,
          observacoes: newObs || null,
          updated_by: callerUser.id,
          updated_at: now
        })
        .eq('id', usuarioId)
        .select()
        .single();

      if (updErr) {
        return jsonResponse({ success: false, error: `Erro ao registrar recusa: ${updErr.message}` }, 500);
      }

      return jsonResponse({
        success: true,
        usuarioRecord: updatedRecord,
        message: 'Solicitação de acesso recusada. Nenhum acesso foi concedido.'
      });
    }

    // =========================================================================
    // AÇÃO 4: create-user (Cadastro direto por Administrador)
    // =========================================================================
    if (action === 'create-user') {
      const {
        nome,
        matricula,
        email,
        login,
        perfilProfissional,
        setor,
        papel,
        situacao = 'Ativo',
        observacoes = ''
      } = safePayload;

      if (!email || !nome) {
        return jsonResponse({ success: false, error: 'Campos obrigatórios ausentes: nome e e-mail são necessários.' }, 400);
      }

      const emailClean = String(email).trim().toLowerCase();
      const selectedPapel = ['Administrador', 'Usuário', 'Visualizador'].includes(papel) ? papel : 'Usuário';

      // Cria convite por e-mail no Supabase Auth
      let authUserId: string | null = null;
      const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        emailClean,
        { data: { nome, matricula, papel: selectedPapel } }
      );

      if (!inviteErr && inviteData?.user) {
        authUserId = inviteData.user.id;
      } else {
        const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
        const existing = listData?.users?.find((u: any) => u.email?.toLowerCase() === emailClean);
        if (existing) {
          authUserId = existing.id;
        } else {
          const { data: createdAuth } = await supabaseAdmin.auth.admin.createUser({
            email: emailClean,
            email_confirm: true,
            user_metadata: { nome, matricula, papel: selectedPapel }
          });
          if (createdAuth?.user) {
            authUserId = createdAuth.user.id;
          }
        }
      }

      const now = new Date().toISOString();
      const newId = `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('usuarios')
        .insert({
          id: newId,
          nome: String(nome).trim(),
          matricula: matricula ? String(matricula).trim() : null,
          email: emailClean,
          login: login ? String(login).trim().toLowerCase() : emailClean.split('@')[0],
          perfil_profissional: perfilProfissional || null,
          setor: setor || null,
          papel: selectedPapel,
          situacao: situacao || 'Ativo',
          status: situacao === 'Ativo' ? 'Ativo' : 'Inativo',
          observacoes: observacoes || null,
          auth_user_id: authUserId,
          created_by: callerUser.id,
          updated_by: callerUser.id,
          created_at: now,
          updated_at: now
        })
        .select()
        .single();

      if (insErr) {
        return jsonResponse({ success: false, error: `Erro ao cadastrar usuário: ${insErr.message}` }, 500);
      }

      return jsonResponse({
        success: true,
        authUserId,
        usuarioRecord: inserted,
        message: 'Usuário cadastrado com sucesso.'
      });
    }

    return jsonResponse({ success: false, error: `Ação desconhecida: ${action}` }, 400);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Erro interno no servidor.' }, 500);
  }
}
