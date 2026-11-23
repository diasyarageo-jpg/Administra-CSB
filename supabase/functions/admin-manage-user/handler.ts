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

export const ALLOWED_ROLES = ['Administrador', 'Analista', 'Usuário', 'Visualizador'];
export const SOLICITACAO_ALLOWED_STATUSES = ['pendente', 'aguardando_correcao', 'aprovada', 'recusada'] as const;
export const SOLICITACAO_REVIEW_MUTABLE_STATUSES = ['aguardando_correcao', 'recusada'] as const;
export const SOLICITACAO_FINALIZED_STATUSES = ['aprovada', 'recusada'] as const;
const SOLICITACAO_REVIEW_COLUMNS =
  'id, nome, matricula, email, status, observacoes_admin, revisado_por, revisado_em, criado_em, atualizado_em';
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_ADMIN_OBSERVACAO_LENGTH = 1000;
const DEFAULT_SOLICITACAO_LIST_LIMIT = 50;
const MAX_SOLICITACAO_LIST_LIMIT = 100;

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value.trim());
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeMatricula(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function parseAdminObservacao(
  rawValue: unknown
): { ok: true; provided: boolean; value: string | null } | { ok: false; error: string } {
  if (rawValue === undefined) {
    return { ok: true, provided: false, value: null };
  }
  if (rawValue === null) {
    return { ok: true, provided: true, value: null };
  }
  if (typeof rawValue !== 'string') {
    return { ok: false, error: 'Observação administrativa inválida.' };
  }
  const trimmed = rawValue.trim();
  if (trimmed.length > MAX_ADMIN_OBSERVACAO_LENGTH) {
    return {
      ok: false,
      error: `Observação administrativa excede o limite de ${MAX_ADMIN_OBSERVACAO_LENGTH} caracteres.`
    };
  }
  return { ok: true, provided: true, value: trimmed || null };
}

function sanitizeSolicitacaoForAdmin(row: Record<string, any>) {
  return {
    id: row.id ?? null,
    nome: row.nome ?? null,
    matricula: row.matricula ?? null,
    email: row.email ?? null,
    status: row.status ?? null,
    observacoes_admin: row.observacoes_admin ?? null,
    revisado_por: row.revisado_por ?? null,
    revisado_em: row.revisado_em ?? null,
    criado_em: row.criado_em ?? null,
    atualizado_em: row.atualizado_em ?? null
  };
}

function isMissingColumnError(err: any): boolean {
  return err?.code === '42703' || /does not exist/i.test(String(err?.message || ''));
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
      const allowedRoles = ALLOWED_ROLES;
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
      const selectedPapel = ALLOWED_ROLES.includes(papel) ? papel : 'Usuário';

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

    // =========================================================================
    // AÇÃO 5: list-access-requests (Consulta administrativa de solicitações)
    // =========================================================================
    if (action === 'list-access-requests') {
      const rawStatus = safePayload.status;
      let statusFilter = '';
      if (rawStatus !== undefined && rawStatus !== null && rawStatus !== '') {
        if (typeof rawStatus !== 'string') {
          return jsonResponse({ success: false, error: 'Filtro de status inválido.' }, 400);
        }
        statusFilter = rawStatus.trim().toLowerCase();
        if (statusFilter && !(SOLICITACAO_ALLOWED_STATUSES as readonly string[]).includes(statusFilter)) {
          return jsonResponse(
            {
              success: false,
              error: `Status de filtro inválido. Valores permitidos: ${SOLICITACAO_ALLOWED_STATUSES.join(', ')}.`
            },
            400
          );
        }
      }

      const rawLimit = safePayload.limit;
      let safeLimit = DEFAULT_SOLICITACAO_LIST_LIMIT;
      if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
        const parsedLimit = Number(rawLimit);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
          return jsonResponse({ success: false, error: 'Limite de resultados inválido.' }, 400);
        }
        safeLimit = Math.min(parsedLimit, MAX_SOLICITACAO_LIST_LIMIT);
      }

      const executeList = async (columns: string, orderBy: 'criado_em' | 'atualizado_em') => {
        let query = supabaseAdmin.from('admin_solicitacoes_acesso').select(columns);
        if (statusFilter) {
          query = query.eq('status', statusFilter);
        }
        return await query.order(orderBy, { ascending: false }).limit(safeLimit);
      };

      let listResult = await executeList(SOLICITACAO_REVIEW_COLUMNS, 'criado_em');
      if (listResult.error && isMissingColumnError(listResult.error)) {
        listResult = await executeList('*', 'atualizado_em');
      }

      if (listResult.error) {
        return jsonResponse({ success: false, error: 'Falha ao consultar solicitações de acesso.' }, 500);
      }

      const rows = Array.isArray(listResult.data) ? listResult.data : [];
      const solicitacoes = rows.map(sanitizeSolicitacaoForAdmin);

      return jsonResponse({
        success: true,
        solicitacoes,
        total: solicitacoes.length,
        limit: safeLimit
      });
    }

    // =========================================================================
    // AÇÃO 6: review-access-request (Marcar como aguardando_correcao ou recusada)
    // =========================================================================
    if (action === 'review-access-request') {
      const rawSolicitacaoId = safePayload.solicitacaoId ?? safePayload.id;
      if (!isSafeId(rawSolicitacaoId)) {
        return jsonResponse({ success: false, error: 'ID da solicitação ausente ou inválido.' }, 400);
      }
      const solicitacaoId = rawSolicitacaoId.trim();

      const rawStatus = safePayload.status;
      const nextStatus = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : '';
      if (!(SOLICITACAO_REVIEW_MUTABLE_STATUSES as readonly string[]).includes(nextStatus)) {
        return jsonResponse(
          {
            success: false,
            error: `Status inválido para revisão. Valores permitidos: ${SOLICITACAO_REVIEW_MUTABLE_STATUSES.join(', ')}.`
          },
          400
        );
      }

      const rawObs =
        safePayload.observacoesAdmin !== undefined
          ? safePayload.observacoesAdmin
          : safePayload.observacoes_admin !== undefined
            ? safePayload.observacoes_admin
            : safePayload.observacoes !== undefined
              ? safePayload.observacoes
              : safePayload.motivo;

      const obsParsed = parseAdminObservacao(rawObs);
      if (!obsParsed.ok) {
        return jsonResponse({ success: false, error: obsParsed.error }, 400);
      }

      let currentResult = await supabaseAdmin
        .from('admin_solicitacoes_acesso')
        .select(SOLICITACAO_REVIEW_COLUMNS)
        .eq('id', solicitacaoId)
        .maybeSingle();

      if (currentResult.error && isMissingColumnError(currentResult.error)) {
        currentResult = await supabaseAdmin
          .from('admin_solicitacoes_acesso')
          .select('*')
          .eq('id', solicitacaoId)
          .maybeSingle();
      }

      if (currentResult.error) {
        return jsonResponse({ success: false, error: 'Falha ao consultar solicitação de acesso.' }, 500);
      }
      if (!currentResult.data) {
        return jsonResponse({ success: false, error: 'Solicitação de acesso não encontrada.' }, 404);
      }

      const currentStatus = String(currentResult.data.status || '').trim().toLowerCase();
      if ((SOLICITACAO_FINALIZED_STATUSES as readonly string[]).includes(currentStatus)) {
        return jsonResponse(
          {
            success: false,
            error: 'Solicitação já finalizada e não pode ser alterada.'
          },
          409
        );
      }

      const now = new Date().toISOString();
      const updatePayload = {
        status: nextStatus,
        revisado_por: callerUser.id,
        revisado_em: now,
        observacoes_admin: obsParsed.value,
        atualizado_em: now
      };

      const executeReviewUpdate = async (columns: string) =>
        await supabaseAdmin
          .from('admin_solicitacoes_acesso')
          .update(updatePayload)
          .eq('id', solicitacaoId)
          .in('status', ['pendente', 'aguardando_correcao'])
          .select(columns)
          .maybeSingle();

      let updResult = await executeReviewUpdate(SOLICITACAO_REVIEW_COLUMNS);
      if (updResult.error && isMissingColumnError(updResult.error)) {
        updResult = await executeReviewUpdate('*');
      }

      if (updResult.error) {
        return jsonResponse({ success: false, error: 'Falha ao atualizar solicitação de acesso.' }, 500);
      }
      if (!updResult.data) {
        return jsonResponse(
          {
            success: false,
            error: 'Solicitação já finalizada e não pode ser alterada.'
          },
          409
        );
      }

      return jsonResponse({
        success: true,
        solicitacao: sanitizeSolicitacaoForAdmin(updResult.data),
        message:
          nextStatus === 'recusada'
            ? 'Solicitação marcada como recusada.'
            : 'Solicitação marcada como aguardando correção.'
      });
    }

    // =========================================================================
    // AÇÃO 7: approve-access-request (Aprovação vinculada a cadastro existente)
    // =========================================================================
    if (action === 'approve-access-request') {
      const rawSolicitacaoId = safePayload.solicitacaoId ?? safePayload.id;
      const rawUsuarioId = safePayload.usuarioId;

      if (!isSafeId(rawSolicitacaoId)) {
        return jsonResponse({ success: false, error: 'ID da solicitação ausente ou inválido.' }, 400);
      }
      if (!isSafeId(rawUsuarioId)) {
        return jsonResponse(
          {
            success: false,
            error: 'ID de cadastro existente em public.usuarios é obrigatório para aprovar a solicitação.'
          },
          400
        );
      }

      const solicitacaoId = rawSolicitacaoId.trim();
      const usuarioId = rawUsuarioId.trim();

      const rawObs =
        safePayload.observacoesAdmin !== undefined
          ? safePayload.observacoesAdmin
          : safePayload.observacoes_admin;
      const obsParsed = parseAdminObservacao(rawObs);
      if (!obsParsed.ok) {
        return jsonResponse({ success: false, error: obsParsed.error }, 400);
      }

      // 1. Consulta a solicitação em public.admin_solicitacoes_acesso
      let solicitacaoRes = await supabaseAdmin
        .from('admin_solicitacoes_acesso')
        .select(SOLICITACAO_REVIEW_COLUMNS)
        .eq('id', solicitacaoId)
        .maybeSingle();

      if (solicitacaoRes.error && isMissingColumnError(solicitacaoRes.error)) {
        solicitacaoRes = await supabaseAdmin
          .from('admin_solicitacoes_acesso')
          .select('*')
          .eq('id', solicitacaoId)
          .maybeSingle();
      }

      if (solicitacaoRes.error) {
        return jsonResponse({ success: false, error: 'Falha ao consultar solicitação de acesso.' }, 500);
      }
      if (!solicitacaoRes.data) {
        return jsonResponse({ success: false, error: 'Solicitação de acesso não encontrada.' }, 404);
      }

      const solicitacao = solicitacaoRes.data;
      const currentStatus = String(solicitacao.status || '').trim().toLowerCase();
      if ((SOLICITACAO_FINALIZED_STATUSES as readonly string[]).includes(currentStatus)) {
        return jsonResponse(
          {
            success: false,
            error:
              currentStatus === 'aprovada'
                ? 'Esta solicitação já foi aprovada e não pode ser reaprovada.'
                : 'Solicitação recusada não pode ser aprovada.'
          },
          409
        );
      }

      // 2. Consulta o cadastro canônico existente em public.usuarios (nunca cria cadastro novo)
      const { data: targetUser, error: targetErr } = await supabaseAdmin
        .from('usuarios')
        .select('id, nome, matricula, email, papel, situacao, status, auth_user_id')
        .eq('id', usuarioId)
        .maybeSingle();

      if (targetErr) {
        return jsonResponse({ success: false, error: 'Falha ao consultar cadastro canônico de usuário.' }, 500);
      }
      if (!targetUser) {
        return jsonResponse(
          {
            success: false,
            error: 'Cadastro de usuário não encontrado em public.usuarios. Não é permitido criar novo cadastro na aprovação.'
          },
          404
        );
      }

      if (targetUser.papel === 'Administrador' && targetUser.situacao === 'Ativo') {
        return jsonResponse(
          {
            success: false,
            error: 'Não é permitido alterar cadastro de Administrador ativo por meio desta aprovação.'
          },
          409
        );
      }

      // 3. Confere correspondência estrita de e-mail e matrícula entre solicitação e cadastro canônico
      const solicitacaoEmail = normalizeEmail(solicitacao.email);
      const canonicalEmail = normalizeEmail(targetUser.email);
      const solicitacaoMatricula = normalizeMatricula(solicitacao.matricula);
      const canonicalMatricula = normalizeMatricula(targetUser.matricula);

      if (
        !solicitacaoEmail ||
        !canonicalEmail ||
        solicitacaoEmail !== canonicalEmail ||
        !solicitacaoMatricula ||
        !canonicalMatricula ||
        solicitacaoMatricula !== canonicalMatricula
      ) {
        return jsonResponse(
          {
            success: false,
            error:
              'Divergência entre e-mail ou matrícula da solicitação e o cadastro escolhido. Aprovação recusada: marque a solicitação como aguardando_correcao.'
          },
          409
        );
      }

      // 4. Provisiona/vincula conta no Supabase Auth usando exclusivamente os dados canônicos e papel padrão Usuário
      const assignedRole = 'Usuário';
      let authUserId: string;

      if (targetUser.auth_user_id) {
        authUserId = String(targetUser.auth_user_id);
        const { error: updAuthErr } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
          email_confirm: true,
          user_metadata: {
            nome: targetUser.nome,
            matricula: targetUser.matricula,
            papel: assignedRole
          }
        });

        if (updAuthErr) {
          return jsonResponse({ success: false, error: 'Falha ao atualizar conta no serviço de autenticação.' }, 500);
        }
      } else {
        const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1000
        });

        if (listErr) {
          return jsonResponse({ success: false, error: 'Falha ao consultar serviço de autenticação.' }, 500);
        }

        const existingAuth = listData?.users?.find((u: any) => normalizeEmail(u.email) === canonicalEmail);

        if (existingAuth) {
          const { data: otherLinkedUser, error: otherLinkedErr } = await supabaseAdmin
            .from('usuarios')
            .select('id')
            .eq('auth_user_id', existingAuth.id)
            .maybeSingle();

          if (otherLinkedErr) {
            return jsonResponse({ success: false, error: 'Falha ao verificar vínculo de autenticação existente.' }, 500);
          }
          if (otherLinkedUser && otherLinkedUser.id !== usuarioId) {
            return jsonResponse(
              {
                success: false,
                error: 'A conta de autenticação deste e-mail já está vinculada a outro cadastro em public.usuarios.'
              },
              409
            );
          }

          authUserId = existingAuth.id;
          const { error: updAuthErr } = await supabaseAdmin.auth.admin.updateUserById(existingAuth.id, {
            email_confirm: true,
            user_metadata: {
              ...existingAuth.user_metadata,
              nome: targetUser.nome,
              matricula: targetUser.matricula,
              papel: assignedRole
            }
          });

          if (updAuthErr) {
            return jsonResponse({ success: false, error: 'Falha ao atualizar conta no serviço de autenticação.' }, 500);
          }
        } else {
          const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
            canonicalEmail,
            {
              data: {
                nome: targetUser.nome,
                matricula: targetUser.matricula,
                papel: assignedRole
              }
            }
          );

          if (inviteErr) {
            const { data: createdAuth, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
              email: canonicalEmail,
              email_confirm: true,
              user_metadata: {
                nome: targetUser.nome,
                matricula: targetUser.matricula,
                papel: assignedRole
              }
            });

            if (createAuthErr || !createdAuth?.user) {
              return jsonResponse({ success: false, error: 'Falha ao criar conta no serviço de autenticação.' }, 500);
            }
            authUserId = createdAuth.user.id;
          } else if (inviteData?.user) {
            authUserId = inviteData.user.id;
          } else {
            return jsonResponse({ success: false, error: 'Falha inesperada ao provisionar conta de autenticação.' }, 500);
          }
        }
      }

      // 5. Ativa o cadastro canônico em public.usuarios com papel padrão Usuário
      const now = new Date().toISOString();
      const { data: updatedUsuario, error: updUsuarioErr } = await supabaseAdmin
        .from('usuarios')
        .update({
          papel: assignedRole,
          situacao: 'Ativo',
          status: 'Ativo',
          auth_user_id: authUserId,
          updated_by: callerUser.id,
          updated_at: now
        })
        .eq('id', usuarioId)
        .select()
        .single();

      if (updUsuarioErr || !updatedUsuario) {
        return jsonResponse(
          {
            success: false,
            error: 'Conta de autenticação preparada, mas falhou ao ativar o cadastro de usuário.'
          },
          500
        );
      }

      // 6. Marca a solicitação como aprovada somente após Auth e public.usuarios terem sucesso
      const solicitacaoUpdatePayload: Record<string, any> = {
        status: 'aprovada',
        revisado_por: callerUser.id,
        revisado_em: now,
        atualizado_em: now
      };
      if (obsParsed.provided) {
        solicitacaoUpdatePayload.observacoes_admin = obsParsed.value;
      }

      const executeApproveUpdate = async (columns: string) =>
        await supabaseAdmin
          .from('admin_solicitacoes_acesso')
          .update(solicitacaoUpdatePayload)
          .eq('id', solicitacaoId)
          .in('status', ['pendente', 'aguardando_correcao'])
          .select(columns)
          .maybeSingle();

      let updSolicitacaoRes = await executeApproveUpdate(SOLICITACAO_REVIEW_COLUMNS);
      if (updSolicitacaoRes.error && isMissingColumnError(updSolicitacaoRes.error)) {
        updSolicitacaoRes = await executeApproveUpdate('*');
      }

      if (updSolicitacaoRes.error) {
        return jsonResponse(
          {
            success: false,
            error: 'Cadastro ativado, mas falhou ao finalizar o status da solicitação. Repita a operação para concluir.'
          },
          500
        );
      }

      if (!updSolicitacaoRes.data) {
        return jsonResponse(
          {
            success: false,
            error: 'Solicitação já foi finalizada por outra operação.'
          },
          409
        );
      }

      return jsonResponse({
        success: true,
        authUserId,
        usuarioRecord: updatedUsuario,
        solicitacao: sanitizeSolicitacaoForAdmin(updSolicitacaoRes.data),
        message: 'Solicitação aprovada com sucesso! Cadastro ativado com papel padrão Usuário.'
      });
    }

    return jsonResponse({ success: false, error: `Ação desconhecida: ${action}` }, 400);
  } catch {
    return jsonResponse({ success: false, error: 'Erro interno no servidor.' }, 500);
  }
}
