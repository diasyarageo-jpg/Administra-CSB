// Supabase Edge Function: admin-manage-user (pure request handler)
// Coordenadoria de Segurança de Barragens — CSB / SURH / SEMA-MT
// Operações privilegiadas no servidor com service role (nunca exposta no frontend)

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

export const MIN_PASSWORD_LENGTH = 8;

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
  now?: () => number;
  rateLimitStore?: Map<string, number[]>;
  onAuditEvent?: (event: {
    event: string;
    usuarioId: string;
    authUserId: string;
    timestamp: string;
  }) => void | Promise<void>;
}

export const ALLOWED_ROLES = ['Administrador', 'Analista', 'Usuário', 'Visualizador'];
export const SOLICITACAO_ALLOWED_STATUSES = ['pendente', 'aguardando_correcao', 'aprovada', 'recusada'] as const;
export const SOLICITACAO_REVIEW_MUTABLE_STATUSES = ['aguardando_correcao', 'recusada'] as const;
export const SOLICITACAO_FINALIZED_STATUSES = ['aprovada', 'recusada'] as const;
const SOLICITACAO_REVIEW_COLUMNS =
  'id, nome, matricula, email, usuario_id, status, observacoes_admin, revisado_por, revisado_em, criado_em, atualizado_em';
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_SITUACOES = ['Ativo', 'Inativo', 'Pendente', 'Recusado'] as const;
const MAX_ADMIN_OBSERVACAO_LENGTH = 1000;
const DEFAULT_SOLICITACAO_LIST_LIMIT = 50;
const MAX_SOLICITACAO_LIST_LIMIT = 100;
const UNIFORM_USER_CONFLICT_ERROR = 'Não foi possível concluir o cadastro com os dados informados.';
const UNIFORM_RESET_TARGET_ERROR = 'Não foi possível redefinir a senha para este cadastro.';
const RESET_OWN_MAX_PER_HOUR = 3;
const RESET_OWN_WINDOW_MS = 60 * 60 * 1000;

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value.trim());
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeMatricula(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function getDefaultTempPassword(deps: AdminManageUserDeps): string | null {
  const raw = deps.envGet('DEFAULT_TEMP_PASSWORD');
  if (typeof raw !== 'string' || !raw.trim() || raw.length < MIN_PASSWORD_LENGTH) {
    return null;
  }
  return raw;
}

export function buildDefaultOwnResetPassword(matriculaRaw: unknown, nomeRaw: unknown): string | null {
  const matricula = typeof matriculaRaw === 'string' ? matriculaRaw.trim() : '';
  const nome = typeof nomeRaw === 'string' ? nomeRaw.trim() : '';
  if (!matricula || !nome) {
    return null;
  }

  const firstToken = nome.split(/\s+/)[0] || '';
  const asciiFirst = firstToken
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '');

  if (!asciiFirst) {
    return null;
  }

  const primeiroNome = asciiFirst.charAt(0).toUpperCase() + asciiFirst.slice(1).toLowerCase();
  const generated = `Csb@${matricula}${primeiroNome}`;
  if (generated.length < MIN_PASSWORD_LENGTH) {
    return null;
  }
  return generated;
}

async function recordSelfPasswordEventAuditSafe(
  supabaseAdmin: any,
  deps: AdminManageUserDeps,
  event: 'reset-own-password' | 'complete-password-change',
  payload: {
    usuarioId: string;
    authUserId: string;
    usuarioLogin: string | null;
    usuarioNome: string | null;
    timestamp: string;
  }
): Promise<void> {
  try {
    if (typeof deps.onAuditEvent === 'function') {
      await deps.onAuditEvent({
        event,
        usuarioId: payload.usuarioId,
        authUserId: payload.authUserId,
        timestamp: payload.timestamp
      });
    }
  } catch {
    // Falha no hook de auditoria nunca deve expor credenciais
  }

  try {
    const query = supabaseAdmin?.from?.('historico_alteracoes_dados');
    if (query && typeof query.insert === 'function') {
      await query.insert({
        tabela_nome: 'usuarios',
        registro_id: payload.usuarioId,
        operacao: 'UPDATE',
        usuario_id: payload.usuarioId,
        usuario_login: payload.usuarioLogin,
        usuario_nome: payload.usuarioNome,
        auth_user_id: payload.authUserId,
        sistema_origem: 'Administra-CSB',
        alterado_em: payload.timestamp,
        campos_alterados: ['force_password_change'],
        motivo: event,
        dados_anteriores: null,
        dados_novos: null
      });
    }
  } catch {
    // Registro de auditoria em tabela auxiliar é best-effort e nunca grava senha
  }
}

async function recordResetOwnPasswordAuditSafe(
  supabaseAdmin: any,
  deps: AdminManageUserDeps,
  payload: {
    usuarioId: string;
    authUserId: string;
    usuarioLogin: string | null;
    usuarioNome: string | null;
    timestamp: string;
  }
): Promise<void> {
  return recordSelfPasswordEventAuditSafe(supabaseAdmin, deps, 'reset-own-password', payload);
}

async function deleteAuthUserSafe(supabaseAdmin: any, authUserId: string): Promise<void> {
  if (!authUserId || typeof supabaseAdmin?.auth?.admin?.deleteUser !== 'function') {
    return;
  }
  try {
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
  } catch {
    // Falha na compensação nunca deve expor credenciais ou dados internos
  }
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
    usuario_id: row.usuario_id ?? null,
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

    // Valida perfil institucional vinculado estritamente a auth_user_id = callerUser.id
    let callerProfileRes = await supabaseAdmin
      .from('usuarios')
      .select('id, auth_user_id, nome, matricula, login, papel, situacao, status, force_password_change')
      .eq('auth_user_id', callerUser.id)
      .maybeSingle();

    if (callerProfileRes.error && isMissingColumnError(callerProfileRes.error)) {
      callerProfileRes = await supabaseAdmin
        .from('usuarios')
        .select('id, papel, situacao')
        .eq('auth_user_id', callerUser.id)
        .maybeSingle();
    }

    const callerProfile = callerProfileRes.data;
    const callerProfileErr = callerProfileRes.error;
    const callerLinkedMatches =
      callerProfile &&
      (callerProfile.auth_user_id === undefined ||
        String(callerProfile.auth_user_id || '').trim() === String(callerUser.id).trim());

    // =========================================================================
    // AÇÃO SELF-SERVICE: complete-password-change (Troca e liberação no servidor)
    // Restrita exclusivamente ao próprio usuário autenticado ativo via auth.uid().
    // Confirma currentPassword no Supabase Auth, atualiza newPassword para auth.uid()
    // e só então limpa force_password_change = false.
    // =========================================================================
    if (action === 'complete-password-change') {
      const callerSituacao = String(callerProfile?.situacao || callerProfile?.status || '').trim();
      const callerPapel = String(callerProfile?.papel || '').trim();
      if (
        callerProfileErr ||
        !callerProfile ||
        !callerProfile.id ||
        !callerLinkedMatches ||
        callerSituacao !== 'Ativo' ||
        !ALLOWED_ROLES.includes(callerPapel)
      ) {
        return jsonResponse(
          {
            success: false,
            error: 'Permissão negada: conta sem perfil institucional ativo vinculado.'
          },
          403
        );
      }

      const currentPassword =
        typeof safePayload.currentPassword === 'string' ? safePayload.currentPassword : '';
      const newPassword =
        typeof safePayload.newPassword === 'string' ? safePayload.newPassword : '';

      if (!currentPassword || !newPassword) {
        return jsonResponse(
          {
            success: false,
            error: 'Informe a senha atual e a nova senha.'
          },
          400
        );
      }

      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return jsonResponse(
          {
            success: false,
            error: `A nova senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`
          },
          400
        );
      }

      if (newPassword === currentPassword) {
        return jsonResponse(
          {
            success: false,
            error: 'A nova senha deve ser diferente da senha atual.'
          },
          400
        );
      }

      let authoritativeAuthUser: any = callerUser;
      if (
        (!normalizeEmail(authoritativeAuthUser?.email) || !authoritativeAuthUser?.app_metadata) &&
        typeof supabaseAdmin?.auth?.admin?.getUserById === 'function'
      ) {
        const { data: authLookup, error: authLookupErr } = await supabaseAdmin.auth.admin.getUserById(
          callerUser.id
        );
        if (!authLookupErr && authLookup?.user && String(authLookup.user.id || '').trim() === String(callerUser.id).trim()) {
          authoritativeAuthUser = authLookup.user;
        }
      }

      const callerEmail = normalizeEmail(authoritativeAuthUser?.email);
      if (!callerEmail) {
        return jsonResponse(
          {
            success: false,
            error: 'Não foi possível validar a conta autenticada.'
          },
          403
        );
      }

      const authVerifyKey = deps.envGet('SUPABASE_ANON_KEY') || serviceRoleKey;
      const authVerifyClient = deps.createSupabaseClient(supabaseUrl, authVerifyKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });

      const { data: verifyData, error: verifyErr } = await authVerifyClient.auth.signInWithPassword({
        email: callerEmail,
        password: currentPassword
      });
      const verifiedUid = String(verifyData?.user?.id || '').trim();
      const currentPasswordVerified =
        !verifyErr && verifiedUid !== '' && verifiedUid === String(callerUser.id).trim();

      const callerAppMeta =
        authoritativeAuthUser?.app_metadata && typeof authoritativeAuthUser.app_metadata === 'object'
          ? authoritativeAuthUser.app_metadata
          : {};
      const hasPendingFlagClear = Boolean(callerAppMeta.pending_force_password_clear_at);

      let retryAlreadyUpdatedInAuth = false;
      if (!currentPasswordVerified && Boolean(callerProfile.force_password_change) && hasPendingFlagClear) {
        const { data: retryData, error: retryErr } = await authVerifyClient.auth.signInWithPassword({
          email: callerEmail,
          password: newPassword
        });
        const retryUid = String(retryData?.user?.id || '').trim();
        retryAlreadyUpdatedInAuth =
          !retryErr && retryUid !== '' && retryUid === String(callerUser.id).trim();
      }

      if (!currentPasswordVerified && !retryAlreadyUpdatedInAuth) {
        return jsonResponse(
          {
            success: false,
            error: 'Senha atual incorreta.'
          },
          403
        );
      }

      const now = new Date().toISOString();
      if (currentPasswordVerified) {
        const { error: updAuthErr } = await supabaseAdmin.auth.admin.updateUserById(callerUser.id, {
          password: newPassword,
          app_metadata: {
            ...callerAppMeta,
            pending_force_password_clear_at: now
          }
        });

        if (updAuthErr) {
          return jsonResponse(
            {
              success: false,
              error: 'Não foi possível atualizar a senha. Verifique os requisitos de segurança e tente novamente.'
            },
            400
          );
        }
      }

      const { data: updatedOwn, error: updOwnErr } = await supabaseAdmin
        .from('usuarios')
        .update({
          force_password_change: false,
          updated_by: callerUser.id,
          updated_at: now
        })
        .eq('id', callerProfile.id)
        .eq('auth_user_id', callerUser.id)
        .select('id, force_password_change')
        .maybeSingle();

      if (updOwnErr || !updatedOwn || updatedOwn.force_password_change !== false) {
        return jsonResponse(
          {
            success: false,
            error: 'Não foi possível confirmar a conclusão da alteração de senha.'
          },
          500
        );
      }

      try {
        await supabaseAdmin.auth.admin.updateUserById(callerUser.id, {
          app_metadata: {
            ...callerAppMeta,
            pending_force_password_clear_at: null
          }
        });
      } catch {
        // Limpeza do marcador transitório de app_metadata é best-effort
      }

      await recordSelfPasswordEventAuditSafe(supabaseAdmin, deps, 'complete-password-change', {
        usuarioId: String(callerProfile.id),
        authUserId: String(callerUser.id),
        usuarioLogin: callerProfile.login ? String(callerProfile.login) : null,
        usuarioNome: callerProfile.nome ? String(callerProfile.nome) : null,
        timestamp: now
      });

      return jsonResponse({
        success: true,
        forcePasswordChange: false,
        message: 'Alteração de senha confirmada com sucesso.'
      });
    }

    // =========================================================================
    // AÇÃO SELF-SERVICE: reset-own-password (Volta para a senha padrão institucional)
    // Restrita exclusivamente ao próprio usuário autenticado ativo via auth.uid()
    // Ignora qualquer id, e-mail ou senha enviado pelo cliente.
    // =========================================================================
    if (action === 'reset-own-password') {
      const hasClientPassword = [
        'password',
        'newPassword',
        'new_password',
        'temporaryPassword',
        'temporary_password',
        'senha',
        'novaSenha',
        'nova_senha',
        'senhaPadrao',
        'senha_padrao'
      ].some(
        key => safePayload[key] !== undefined && safePayload[key] !== null && String(safePayload[key]).trim() !== ''
      );
      if (hasClientPassword) {
        return jsonResponse(
          {
            success: false,
            error: 'Não é permitido informar senha pelo cliente.'
          },
          400
        );
      }

      const callerSituacao = String(callerProfile?.situacao || callerProfile?.status || '').trim();
      const callerPapel = String(callerProfile?.papel || '').trim();
      const generatedPassword = buildDefaultOwnResetPassword(callerProfile?.matricula, callerProfile?.nome);
      if (
        callerProfileErr ||
        !callerProfile ||
        !callerProfile.id ||
        !callerLinkedMatches ||
        callerSituacao !== 'Ativo' ||
        !ALLOWED_ROLES.includes(callerPapel) ||
        !generatedPassword
      ) {
        return jsonResponse(
          {
            success: false,
            error: 'Não foi possível redefinir a senha.'
          },
          403
        );
      }

      const nowMs = typeof deps.now === 'function' ? deps.now() : Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const rateKey = String(callerUser.id);
      const allowTestRateLimitStore = Boolean(deps.rateLimitStore) && !deps.envGet('DENO_DEPLOYMENT_ID');

      if (allowTestRateLimitStore && deps.rateLimitStore) {
        const recentStoreCalls = (deps.rateLimitStore.get(rateKey) || []).filter(
          (ts: number) => ts > nowMs - RESET_OWN_WINDOW_MS
        );
        if (recentStoreCalls.length >= RESET_OWN_MAX_PER_HOUR) {
          deps.rateLimitStore.set(rateKey, recentStoreCalls);
          return jsonResponse(
            {
              success: false,
              error: 'Limite de solicitações excedido. Tente novamente mais tarde.'
            },
            429
          );
        }
        recentStoreCalls.push(nowMs);
        deps.rateLimitStore.set(rateKey, recentStoreCalls);
      } else {
        const rpcParams: Record<string, any> = {
          p_auth_user_id: rateKey,
          p_usuario_id: String(callerProfile.id),
          p_action: 'reset-own-password',
          p_window_minutes: 60,
          p_max_attempts: RESET_OWN_MAX_PER_HOUR
        };
        if (typeof deps.now === 'function') {
          rpcParams.p_now = nowIso;
        }

        const { data: rpcData, error: rateRpcErr } = await supabaseAdmin.rpc(
          'reserve_password_reset_rate_limit',
          rpcParams
        );

        const reservation = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        if (rateRpcErr || !reservation || typeof reservation.allowed !== 'boolean') {
          return jsonResponse(
            {
              success: false,
              error: 'Não foi possível redefinir a senha.'
            },
            500
          );
        }

        if (!reservation.allowed) {
          return jsonResponse(
            {
              success: false,
              error: 'Limite de solicitações excedido. Tente novamente mais tarde.'
            },
            429
          );
        }
      }

      const { error: updAuthErr } = await supabaseAdmin.auth.admin.updateUserById(callerUser.id, {
        password: generatedPassword
      });

      if (updAuthErr) {
        return jsonResponse(
          {
            success: false,
            error: 'Não foi possível redefinir a senha.'
          },
          500
        );
      }

      const { data: updatedOwn, error: updOwnErr } = await supabaseAdmin
        .from('usuarios')
        .update({
          force_password_change: true,
          updated_by: callerUser.id,
          updated_at: nowIso
        })
        .eq('id', callerProfile.id)
        .eq('auth_user_id', callerUser.id)
        .select('id, force_password_change')
        .maybeSingle();

      if (updOwnErr || !updatedOwn) {
        return jsonResponse(
          {
            success: false,
            error: 'Não foi possível concluir a redefinição de senha.'
          },
          500
        );
      }

      await recordResetOwnPasswordAuditSafe(supabaseAdmin, deps, {
        usuarioId: String(callerProfile.id),
        authUserId: String(callerUser.id),
        usuarioLogin: callerProfile.login ? String(callerProfile.login) : null,
        usuarioNome: callerProfile.nome ? String(callerProfile.nome) : null,
        timestamp: nowIso
      });

      return jsonResponse({
        success: true,
        forcePasswordChange: true,
        message: 'Senha redefinida. Entre com a senha padrão e crie uma nova.'
      });
    }

    // Valida se o solicitante possui perfil de Administrador ativo na tabela usuarios
    const adminRecord = callerProfile;
    if (
      callerProfileErr ||
      !adminRecord ||
      !adminRecord.id ||
      !callerLinkedMatches ||
      adminRecord.papel !== 'Administrador' ||
      adminRecord.situacao !== 'Ativo'
    ) {
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

      if (targetUser.papel === 'Administrador' && targetUser.situacao === 'Ativo') {
        return jsonResponse(
          {
            success: false,
            error: 'Não é permitido alterar o papel de um Administrador ativo por meio desta aprovação.'
          },
          409
        );
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
    // AÇÃO 4: create-user (Cadastro direto por Administrador com DEFAULT_TEMP_PASSWORD)
    // =========================================================================
    if (action === 'create-user') {
      const hasClientPassword = ['temporaryPassword', 'temporary_password', 'password', 'senha', 'senhaProvisoria', 'senha_provisoria'].some(
        key => safePayload[key] !== undefined && safePayload[key] !== null && String(safePayload[key]).trim() !== ''
      );
      if (hasClientPassword) {
        return jsonResponse(
          { success: false, error: 'Não é permitido informar senha temporária pelo cliente.' },
          400
        );
      }

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

      const nomeClean = typeof nome === 'string' ? nome.trim() : '';
      const emailClean = normalizeEmail(email);

      if (!nomeClean || !emailClean || !EMAIL_PATTERN.test(emailClean)) {
        return jsonResponse(
          { success: false, error: 'Campos obrigatórios ausentes ou inválidos: nome e e-mail válido são necessários.' },
          400
        );
      }

      if (papel !== undefined && papel !== null && papel !== '' && !ALLOWED_ROLES.includes(papel)) {
        return jsonResponse(
          {
            success: false,
            error: `Papel inválido. As funções permitidas são: ${ALLOWED_ROLES.join(', ')}.`
          },
          400
        );
      }
      const selectedPapel = ALLOWED_ROLES.includes(papel) ? papel : 'Usuário';

      const selectedSituacao =
        situacao !== undefined && situacao !== null && String(situacao).trim() !== ''
          ? String(situacao).trim()
          : 'Ativo';
      if (!(ALLOWED_SITUACOES as readonly string[]).includes(selectedSituacao)) {
        return jsonResponse({ success: false, error: 'Situação funcional inválida.' }, 400);
      }

      const matriculaClean =
        matricula !== undefined && matricula !== null && String(matricula).trim() !== ''
          ? String(matricula).trim()
          : null;
      const loginClean =
        login !== undefined && login !== null && String(login).trim() !== ''
          ? String(login).trim().toLowerCase()
          : emailClean.split('@')[0];

      if (!loginClean) {
        return jsonResponse({ success: false, error: 'Identificação de login inválida.' }, 400);
      }

      const defaultTempPassword = getDefaultTempPassword(deps);
      if (!defaultTempPassword) {
        return jsonResponse(
          {
            success: false,
            error: 'Configuração de senha inicial indisponível no ambiente do servidor.'
          },
          500
        );
      }

      // Verificação de duplicidade em public.usuarios (mensagem uniforme para evitar enumeração)
      const duplicateChecks: Array<{ col: 'email' | 'login' | 'matricula'; val: string }> = [
        { col: 'email', val: emailClean },
        { col: 'login', val: loginClean }
      ];
      if (matriculaClean) {
        duplicateChecks.push({ col: 'matricula', val: matriculaClean });
      }

      for (const check of duplicateChecks) {
        const { data: dupRow, error: dupErr } = await supabaseAdmin
          .from('usuarios')
          .select('id')
          .eq(check.col, check.val)
          .maybeSingle();

        if (dupErr && dupErr.code !== 'PGRST116') {
          return jsonResponse({ success: false, error: 'Falha ao validar dados do cadastro.' }, 500);
        }
        if (dupRow || dupErr?.code === 'PGRST116') {
          return jsonResponse({ success: false, error: UNIFORM_USER_CONFLICT_ERROR }, 409);
        }
      }

      // Verifica existência prévia no Supabase Auth sem revelar detalhes nem sobrescrever contas existentes
      const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000
      });
      if (listErr) {
        return jsonResponse({ success: false, error: 'Falha ao consultar serviço de autenticação.' }, 500);
      }

      const existingAuth = listData?.users?.find((u: any) => normalizeEmail(u.email) === emailClean);
      if (existingAuth) {
        return jsonResponse({ success: false, error: UNIFORM_USER_CONFLICT_ERROR }, 409);
      }

      const { data: createdAuth, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
        email: emailClean,
        password: defaultTempPassword,
        email_confirm: true,
        user_metadata: {
          nome: nomeClean,
          matricula: matriculaClean,
          papel: selectedPapel
        }
      });

      if (createAuthErr || !createdAuth?.user?.id) {
        const msg = String(createAuthErr?.message || '');
        if (/already|exists|registered|duplicate/i.test(msg)) {
          return jsonResponse({ success: false, error: UNIFORM_USER_CONFLICT_ERROR }, 409);
        }
        return jsonResponse(
          { success: false, error: 'Não foi possível provisionar a conta no serviço de autenticação.' },
          500
        );
      }

      const authUserId = String(createdAuth.user.id);

      // Garante unicidade de auth_user_id antes da inserção
      const { data: existingByAuth, error: existingByAuthErr } = await supabaseAdmin
        .from('usuarios')
        .select('id')
        .eq('auth_user_id', authUserId)
        .maybeSingle();

      if (existingByAuthErr && existingByAuthErr.code !== 'PGRST116') {
        await deleteAuthUserSafe(supabaseAdmin, authUserId);
        return jsonResponse({ success: false, error: 'Falha ao validar vínculo de autenticação.' }, 500);
      }
      if (existingByAuth || existingByAuthErr?.code === 'PGRST116') {
        await deleteAuthUserSafe(supabaseAdmin, authUserId);
        return jsonResponse({ success: false, error: UNIFORM_USER_CONFLICT_ERROR }, 409);
      }

      const now = new Date().toISOString();
      const newId = `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('usuarios')
        .insert({
          id: newId,
          nome: nomeClean,
          matricula: matriculaClean,
          email: emailClean,
          login: loginClean,
          perfil_profissional: perfilProfissional ? String(perfilProfissional).trim() : null,
          setor: setor ? String(setor).trim() : null,
          papel: selectedPapel,
          situacao: selectedSituacao,
          status: selectedSituacao === 'Ativo' ? 'Ativo' : 'Inativo',
          force_password_change: true,
          observacoes: observacoes ? String(observacoes).trim() : null,
          auth_user_id: authUserId,
          created_by: callerUser.id,
          updated_by: callerUser.id,
          created_at: now,
          updated_at: now
        })
        .select()
        .single();

      if (insErr || !inserted) {
        await deleteAuthUserSafe(supabaseAdmin, authUserId);
        if (insErr?.code === '23505') {
          return jsonResponse({ success: false, error: UNIFORM_USER_CONFLICT_ERROR }, 409);
        }
        return jsonResponse({ success: false, error: 'Não foi possível concluir o cadastro do usuário.' }, 500);
      }

      return jsonResponse({
        success: true,
        authUserId,
        usuarioRecord: inserted,
        message: 'Usuário cadastrado com sucesso. Troca de senha obrigatória habilitada para o primeiro acesso.'
      });
    }

    // =========================================================================
    // AÇÃO 4B: reset-password (Redefinição administrativa por auth_user_id)
    // =========================================================================
    if (action === 'reset-password') {
      const rawUsuarioId = safePayload.usuarioId;
      const rawAuthUserId = safePayload.authUserId ?? safePayload.auth_user_id;

      const hasUsuarioId = rawUsuarioId !== undefined && rawUsuarioId !== null && String(rawUsuarioId).trim() !== '';
      const hasAuthUserId = rawAuthUserId !== undefined && rawAuthUserId !== null && String(rawAuthUserId).trim() !== '';

      if (!hasUsuarioId && !hasAuthUserId) {
        return jsonResponse({ success: false, error: 'Identificador de usuário ausente ou inválido.' }, 400);
      }
      if (hasUsuarioId && !isSafeId(rawUsuarioId)) {
        return jsonResponse({ success: false, error: 'Identificador de usuário ausente ou inválido.' }, 400);
      }
      if (hasAuthUserId && !isUuid(rawAuthUserId)) {
        return jsonResponse({ success: false, error: 'Identificador de usuário ausente ou inválido.' }, 400);
      }

      const defaultTempPassword = getDefaultTempPassword(deps);
      if (!defaultTempPassword) {
        return jsonResponse(
          {
            success: false,
            error: 'Configuração de senha inicial indisponível no ambiente do servidor.'
          },
          500
        );
      }

      const targetUsuarioId = hasUsuarioId ? String(rawUsuarioId).trim() : '';
      const requestedAuthUserId = hasAuthUserId ? String(rawAuthUserId).trim() : '';

      let targetQuery = supabaseAdmin
        .from('usuarios')
        .select('id, auth_user_id, papel, situacao, status');

      if (targetUsuarioId) {
        targetQuery = targetQuery.eq('id', targetUsuarioId);
      } else {
        targetQuery = targetQuery.eq('auth_user_id', requestedAuthUserId);
      }

      const { data: targetUser, error: targetErr } = await targetQuery.maybeSingle();
      if (targetErr) {
        return jsonResponse({ success: false, error: 'Falha ao consultar cadastro de usuário.' }, 500);
      }

      const targetAuthUserId = targetUser?.auth_user_id ? String(targetUser.auth_user_id).trim() : '';
      const targetSituacao = String(targetUser?.situacao || targetUser?.status || '').trim();

      if (
        !targetUser ||
        !targetAuthUserId ||
        !isUuid(targetAuthUserId) ||
        (requestedAuthUserId && targetAuthUserId !== requestedAuthUserId) ||
        targetSituacao !== 'Ativo'
      ) {
        return jsonResponse({ success: false, error: UNIFORM_RESET_TARGET_ERROR }, 409);
      }

      if (typeof supabaseAdmin.auth?.admin?.getUserById === 'function') {
        const { data: authByIdData, error: authByIdErr } = await supabaseAdmin.auth.admin.getUserById(
          targetAuthUserId
        );
        if (authByIdErr) {
          const msg = String(authByIdErr.message || '');
          const notFound = authByIdErr.status === 404 || /not\s*found/i.test(msg);
          return jsonResponse(
            {
              success: false,
              error: notFound
                ? UNIFORM_RESET_TARGET_ERROR
                : 'Não foi possível validar a conta no serviço de autenticação.'
            },
            notFound ? 409 : 500
          );
        }
        if (!authByIdData?.user || String(authByIdData.user.id) !== targetAuthUserId) {
          return jsonResponse({ success: false, error: UNIFORM_RESET_TARGET_ERROR }, 409);
        }
      }

      const { error: updAuthErr } = await supabaseAdmin.auth.admin.updateUserById(targetAuthUserId, {
        password: defaultTempPassword
      });

      if (updAuthErr) {
        return jsonResponse(
          { success: false, error: 'Não foi possível redefinir a senha no serviço de autenticação.' },
          500
        );
      }

      const now = new Date().toISOString();
      const { data: updatedUser, error: updUserErr } = await supabaseAdmin
        .from('usuarios')
        .update({
          force_password_change: true,
          updated_by: callerUser.id,
          updated_at: now
        })
        .eq('id', targetUser.id)
        .eq('auth_user_id', targetAuthUserId)
        .select('id, force_password_change')
        .maybeSingle();

      if (updUserErr || !updatedUser) {
        return jsonResponse(
          {
            success: false,
            error: 'Senha redefinida na autenticação, mas não foi possível atualizar o estado do cadastro.'
          },
          500
        );
      }

      return jsonResponse({
        success: true,
        message: 'Senha redefinida para a senha temporária institucional. O usuário deverá definir nova senha no próximo acesso.'
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
      const updatePayload: Record<string, any> = {
        status: nextStatus,
        revisado_por: adminRecord.id,
        revisado_em: now,
        observacoes_admin: obsParsed.value,
        atualizado_em: now
      };
      if (currentResult.data.usuario_id !== undefined && currentResult.data.usuario_id !== null) {
        updatePayload.usuario_id = null;
      }

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

      const initialUsuarioId = solicitacao.usuario_id ? String(solicitacao.usuario_id).trim() : null;
      if (initialUsuarioId && initialUsuarioId !== usuarioId) {
        return jsonResponse(
          {
            success: false,
            error: 'Esta solicitação já está vinculada a outro cadastro em public.usuarios.'
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

      // 4. Validação prévia (somente leitura) de auth_user_id existente ou vínculo prévio de Auth
      const assignedRole = 'Usuário';
      const existingTargetAuthId = targetUser.auth_user_id ? String(targetUser.auth_user_id).trim() : '';
      let preValidatedAuthUser: any = null;

      const checkAuthIdLinkedElsewhere = async (
        candidateAuthId: string
      ): Promise<{ ok: true } | { ok: false; status: number; error: string }> => {
        const { data: linkedRows, error: linkedErr } = await supabaseAdmin
          .from('usuarios')
          .select('id')
          .eq('auth_user_id', candidateAuthId);

        if (linkedErr) {
          return { ok: false, status: 500, error: 'Falha ao verificar vínculo de autenticação existente.' };
        }

        const otherLinked = Array.isArray(linkedRows)
          ? linkedRows.find((row: any) => String(row.id) !== usuarioId)
          : null;

        if (otherLinked) {
          return {
            ok: false,
            status: 409,
            error: 'A conta de autenticação já está vinculada a outro cadastro em public.usuarios.'
          };
        }
        return { ok: true };
      };

      const findAuthUserByCanonicalEmail = async (): Promise<
        { ok: true; user: any | null } | { ok: false; status: number; error: string }
      > => {
        const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1000
        });
        if (listErr) {
          return { ok: false, status: 500, error: 'Falha ao consultar serviço de autenticação.' };
        }
        const found = listData?.users?.find((u: any) => normalizeEmail(u.email) === canonicalEmail) ?? null;
        return { ok: true, user: found };
      };

      if (existingTargetAuthId) {
        const uniquenessCheck = await checkAuthIdLinkedElsewhere(existingTargetAuthId);
        if (!uniquenessCheck.ok) {
          return jsonResponse({ success: false, error: uniquenessCheck.error }, uniquenessCheck.status);
        }

        if (typeof supabaseAdmin.auth?.admin?.getUserById === 'function') {
          const { data: authByIdData, error: authByIdErr } = await supabaseAdmin.auth.admin.getUserById(
            existingTargetAuthId
          );
          if (authByIdErr) {
            const msg = String(authByIdErr.message || '');
            const notFound = authByIdErr.status === 404 || /not\s*found/i.test(msg);
            return jsonResponse(
              {
                success: false,
                error: notFound
                  ? 'A conta de autenticação vinculada ao cadastro (auth_user_id) não existe no serviço de autenticação.'
                  : 'Falha ao validar conta de autenticação vinculada.'
              },
              notFound ? 409 : 500
            );
          }
          preValidatedAuthUser = authByIdData?.user ?? null;
        } else {
          const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
            page: 1,
            perPage: 1000
          });
          if (listErr) {
            return jsonResponse({ success: false, error: 'Falha ao validar conta de autenticação vinculada.' }, 500);
          }
          preValidatedAuthUser =
            listData?.users?.find((u: any) => String(u.id) === existingTargetAuthId) ?? null;
        }

        if (!preValidatedAuthUser || String(preValidatedAuthUser.id) !== existingTargetAuthId) {
          return jsonResponse(
            {
              success: false,
              error: 'A conta de autenticação vinculada ao cadastro (auth_user_id) não existe no serviço de autenticação.'
            },
            409
          );
        }

        if (normalizeEmail(preValidatedAuthUser.email) !== canonicalEmail) {
          return jsonResponse(
            {
              success: false,
              error:
                'Divergência entre o e-mail da conta de autenticação vinculada (auth_user_id) e o e-mail do cadastro canônico.'
            },
            409
          );
        }
      } else {
        const foundRes = await findAuthUserByCanonicalEmail();
        if (!foundRes.ok) {
          return jsonResponse({ success: false, error: foundRes.error }, foundRes.status);
        }
        if (foundRes.user) {
          const uniquenessCheck = await checkAuthIdLinkedElsewhere(String(foundRes.user.id));
          if (!uniquenessCheck.ok) {
            return jsonResponse({ success: false, error: uniquenessCheck.error }, uniquenessCheck.status);
          }
          preValidatedAuthUser = foundRes.user;
        }
      }

      // 5. Reserva atômica da solicitação para este usuarioId antes de criar/alterar Auth ou ativar usuarios
      // Impede aprovações concorrentes da mesma solicitação (inclusive para cadastros diferentes)
      const claimNow = new Date().toISOString();
      let claimQuery = supabaseAdmin
        .from('admin_solicitacoes_acesso')
        .update({
          usuario_id: usuarioId,
          atualizado_em: claimNow
        })
        .eq('id', solicitacaoId)
        .in('status', ['pendente', 'aguardando_correcao']);

      if (initialUsuarioId) {
        claimQuery = claimQuery.eq('usuario_id', usuarioId);
        if (solicitacao.atualizado_em) {
          claimQuery = claimQuery.eq('atualizado_em', solicitacao.atualizado_em);
        } else {
          claimQuery = claimQuery.is('atualizado_em', null);
        }
      } else {
        claimQuery = claimQuery.is('usuario_id', null);
      }

      const { data: claimedSolicitacao, error: claimErr } = await claimQuery
        .select('id, status, usuario_id')
        .maybeSingle();

      if (claimErr) {
        return jsonResponse(
          { success: false, error: 'Falha ao reservar solicitação de acesso para aprovação.' },
          500
        );
      }

      if (!claimedSolicitacao) {
        return jsonResponse(
          {
            success: false,
            error: 'Solicitação já finalizada ou reservada por outra operação concorrente.'
          },
          409
        );
      }

      const releaseClaim = async () => {
        await supabaseAdmin
          .from('admin_solicitacoes_acesso')
          .update({
            usuario_id: initialUsuarioId,
            atualizado_em: new Date().toISOString()
          })
          .eq('id', solicitacaoId)
          .in('status', ['pendente', 'aguardando_correcao'])
          .eq('usuario_id', usuarioId)
          .select('id')
          .maybeSingle();
      };

      // 6. Provisiona/sincroniza conta no Supabase Auth usando exclusivamente os dados canônicos
      let authUserId = '';

      if (preValidatedAuthUser) {
        authUserId = String(preValidatedAuthUser.id);
        const { error: updAuthErr } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
          email_confirm: true,
          user_metadata: {
            ...(preValidatedAuthUser.user_metadata || {}),
            nome: targetUser.nome,
            matricula: targetUser.matricula,
            papel: assignedRole
          }
        });

        if (updAuthErr) {
          await releaseClaim().catch(() => undefined);
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

        if (!inviteErr && inviteData?.user) {
          authUserId = String(inviteData.user.id);
        } else {
          // Reconsulta Auth caso outra chamada concorrente tenha acabado de registrar o mesmo e-mail
          const retryLookup = await findAuthUserByCanonicalEmail();
          if (retryLookup.ok && retryLookup.user) {
            const uniquenessCheck = await checkAuthIdLinkedElsewhere(String(retryLookup.user.id));
            if (!uniquenessCheck.ok) {
              await releaseClaim().catch(() => undefined);
              return jsonResponse({ success: false, error: uniquenessCheck.error }, uniquenessCheck.status);
            }
            authUserId = String(retryLookup.user.id);
            const { error: updRetryAuthErr } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
              email_confirm: true,
              user_metadata: {
                ...(retryLookup.user.user_metadata || {}),
                nome: targetUser.nome,
                matricula: targetUser.matricula,
                papel: assignedRole
              }
            });
            if (updRetryAuthErr) {
              await releaseClaim().catch(() => undefined);
              return jsonResponse({ success: false, error: 'Falha ao atualizar conta no serviço de autenticação.' }, 500);
            }
          } else {
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
              await releaseClaim().catch(() => undefined);
              return jsonResponse({ success: false, error: 'Falha ao criar conta no serviço de autenticação.' }, 500);
            }
            authUserId = String(createdAuth.user.id);
          }
        }
      }

      // 7. Aprova atomicamente a solicitação ANTES de ativar public.usuarios
      // Impede deixar public.usuarios Ativo enquanto a solicitação permanecer pendente e bloqueia corrida dupla
      const now = new Date().toISOString();
      const solicitacaoUpdatePayload: Record<string, any> = {
        status: 'aprovada',
        usuario_id: usuarioId,
        revisado_por: adminRecord.id,
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
          .eq('usuario_id', usuarioId)
          .select(columns)
          .maybeSingle();

      let updSolicitacaoRes = await executeApproveUpdate(SOLICITACAO_REVIEW_COLUMNS);
      if (updSolicitacaoRes.error && isMissingColumnError(updSolicitacaoRes.error)) {
        updSolicitacaoRes = await executeApproveUpdate('*');
      }

      if (updSolicitacaoRes.error) {
        await releaseClaim().catch(() => undefined);
        return jsonResponse(
          {
            success: false,
            error: 'Falha ao registrar aprovação da solicitação; o cadastro de usuário não foi ativado.'
          },
          500
        );
      }

      if (!updSolicitacaoRes.data) {
        return jsonResponse(
          {
            success: false,
            error: 'Solicitação já foi finalizada ou alterada por outra operação.'
          },
          409
        );
      }

      // 8. Ativa o cadastro canônico em public.usuarios com papel padrão Usuário;
      // se falhar, reverte a aprovação da solicitação para não manter estado divergente
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
        const rollbackPayload: Record<string, any> = {
          status: solicitacao.status,
          usuario_id: initialUsuarioId,
          revisado_por: solicitacao.revisado_por ?? null,
          revisado_em: solicitacao.revisado_em ?? null,
          observacoes_admin: solicitacao.observacoes_admin ?? null,
          atualizado_em: new Date().toISOString()
        };
        const rollbackRes = await supabaseAdmin
          .from('admin_solicitacoes_acesso')
          .update(rollbackPayload)
          .eq('id', solicitacaoId)
          .eq('status', 'aprovada')
          .eq('usuario_id', usuarioId)
          .select('id')
          .maybeSingle();

        return jsonResponse(
          {
            success: false,
            error: rollbackRes?.error
              ? 'Falha ao ativar o cadastro de usuário e ao reverter o status da solicitação.'
              : 'Falha ao ativar o cadastro de usuário; aprovação da solicitação revertida.'
          },
          500
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
