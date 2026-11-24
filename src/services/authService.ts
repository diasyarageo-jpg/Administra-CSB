/**
 * ADMINISTRA-CSB — SERVIÇO DE AUTENTICAÇÃO E PERFIS DE ACESSO
 * Coordenadoria de Segurança de Barragens — CSB / SURH / SEMA-MT
 */

import { supabase, isSupabaseConfigured, ensureSupabaseInitialized } from './supabaseClient';
import {
  ALLOWED_USER_ROLES,
  AuthErrorCode,
  AuthUserProfile,
  UserRole,
  AccessRequestPayload
} from '../types/auth';

export const MIN_PASSWORD_LENGTH = 8;

export interface LoginResult {
  success: boolean;
  code?: AuthErrorCode;
  error?: string;
  user?: any;
  profile?: AuthUserProfile | null;
}

export interface VerifiedProfileResolution {
  profile: AuthUserProfile | null;
  code?: AuthErrorCode;
  error?: string;
}

export interface SessionRestoreResult {
  status: 'authenticated' | 'unauthenticated' | 'unconfigured' | 'blocked' | 'expired';
  code?: AuthErrorCode;
  error?: string;
  user?: any;
  session?: any;
  profile?: AuthUserProfile | null;
}

export interface ResetPasswordResult {
  success: boolean;
  error?: string;
}

export interface AdminCreateUserPayload {
  nome: string;
  matricula: string;
  email: string;
  login?: string;
  perfilProfissional: string;
  setor: string;
  papel: UserRole;
  situacao?: string;
  observacoes?: string;
}

export interface AdminCreateUserResult {
  success: boolean;
  error?: string;
  authUserId?: string;
  usuarioRecord?: any;
}

export interface AdminResetPasswordResult {
  success: boolean;
  error?: string;
  message?: string;
}

export interface CompletePasswordChangeResult {
  success: boolean;
  error?: string;
  profile?: AuthUserProfile | null;
  passwordUpdatedInAuth?: boolean;
}

export interface ChangeOwnPasswordResult {
  success: boolean;
  error?: string;
  profile?: AuthUserProfile | null;
}

export interface ResetOwnPasswordResult {
  success: boolean;
  error?: string;
  message?: string;
}

export function hasRecoveryTokenInHash(rawHash?: string): boolean {
  const hashStr =
    rawHash !== undefined
      ? String(rawHash || '')
      : typeof window !== 'undefined'
        ? String(window.location.hash || '')
        : '';
  const cleaned = hashStr.replace(/^#/, '').trim();
  if (!cleaned) return false;
  try {
    const params = new URLSearchParams(cleaned);
    return String(params.get('type') || '').trim().toLowerCase() === 'recovery';
  } catch {
    return /(?:^|&)type=recovery(?:&|$)/i.test(cleaned);
  }
}

export function clearAuthHashFromUrl(): void {
  if (typeof window === 'undefined' || !window.location?.hash) return;
  try {
    if (window.history && typeof window.history.replaceState === 'function') {
      const nextUrl = `${window.location.pathname || '/'}${window.location.search || ''}`;
      window.history.replaceState(window.history.state, '', nextUrl);
      return;
    }
    window.location.hash = '';
  } catch {
    // Ignora restrição de histórico em ambientes restritos
  }
}

export function normalizeStrictUserRole(rawRole: unknown): UserRole | null {
  const norm = String(rawRole || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (norm === 'administrador') return 'Administrador';
  if (norm === 'analista') return 'Analista';
  if (norm === 'usuario') return 'Usuário';
  if (norm === 'visualizador') return 'Visualizador';
  return null;
}

export function normalizeStrictSituacao(
  rawSituacao: unknown
): 'Ativo' | 'Inativo' | 'Pendente' | 'Recusado' | null {
  const norm = String(rawSituacao || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (norm === 'ativo') return 'Ativo';
  if (norm === 'inativo') return 'Inativo';
  if (norm === 'pendente') return 'Pendente';
  if (norm === 'recusado') return 'Recusado';
  return null;
}

/**
 * Valida estritamente (fail-closed) uma linha retornada de public.usuarios
 * ou de /api/auth-session. Nunca confia em metadados do Auth ou padrão permissivo.
 */
export function validateInstitutionalProfile(
  row: any,
  expectedAuthUserId?: string
): VerifiedProfileResolution {
  if (!row || typeof row !== 'object') {
    return {
      profile: null,
      code: 'PROFILE_MISSING',
      error:
        'Sua conta está autenticada, mas não possui cadastro institucional vinculado em usuários.'
    };
  }

  const rowAuthId = String(row.auth_user_id ?? row.authUserId ?? '').trim();
  if (!rowAuthId || (expectedAuthUserId && rowAuthId !== String(expectedAuthUserId).trim())) {
    return {
      profile: null,
      code: 'PROFILE_MISSING',
      error:
        'Cadastro institucional incompatível ou não vinculado ao identificador desta conta autenticada.'
    };
  }

  const rowId = String(row.id ?? '').trim();
  if (!rowId) {
    return {
      profile: null,
      code: 'PROFILE_MISSING',
      error: 'Cadastro institucional sem identificador interno válido.'
    };
  }

  const situacao = normalizeStrictSituacao(row.situacao || row.status);
  if (situacao !== 'Ativo') {
    if (situacao === 'Pendente') {
      return {
        profile: null,
        code: 'PROFILE_PENDING',
        error: 'Sua solicitação de acesso está aguardando aprovação da Administração da CSB.'
      };
    }
    if (situacao === 'Recusado') {
      return {
        profile: null,
        code: 'PROFILE_REJECTED',
        error: 'Sua solicitação de acesso foi recusada pela Administração da CSB.'
      };
    }
    return {
      profile: null,
      code: 'PROFILE_INACTIVE',
      error: 'Esta conta de usuário está inativa ou bloqueada na CSB. Entre em contato com a administração.'
    };
  }

  const papel = normalizeStrictUserRole(row.papel);
  if (!papel || !(ALLOWED_USER_ROLES as readonly string[]).includes(papel)) {
    return {
      profile: null,
      code: 'ROLE_INVALID',
      error:
        'Seu cadastro institucional não possui um perfil de acesso válido configurado. Contate a administração.'
    };
  }

  return {
    profile: {
      id: rowId,
      authUserId: rowAuthId,
      nome: String(row.nome || '').trim(),
      login: String(row.login || rowId).trim(),
      email: String(row.email || '').trim(),
      matricula: row.matricula ? String(row.matricula).trim() : '',
      perfilProfissional: String(row.perfil_profissional || row.perfilProfissional || '').trim(),
      setor: String(row.setor || '').trim(),
      papel,
      situacao: 'Ativo',
      forcePasswordChange: Boolean(row.force_password_change ?? row.forcePasswordChange ?? false),
      observacoes: row.observacoes ? String(row.observacoes) : '',
      createdBy: row.created_by || undefined,
      updatedBy: row.updated_by || undefined,
      createdAt: row.created_at || row.createdAt || new Date().toISOString(),
      updatedAt: row.updated_at || row.updatedAt
    }
  };
}

function isNetworkOrTransportError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound')
  );
}

export interface AuthServiceDeps {
  client: any | null;
  configured: boolean;
  fetchFn?: typeof fetch;
}

export function createAuthService(getDeps?: () => AuthServiceDeps) {
  const resolveDeps = (): AuthServiceDeps => {
    if (getDeps) return getDeps();
    return {
      client: supabase,
      configured: isSupabaseConfigured(),
      fetchFn: typeof fetch === 'function' ? fetch : undefined
    };
  };

  return {
    async getSession(): Promise<{ user: any | null; session: any | null }> {
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return { user: null, session: null };
      }
      try {
        const { data, error } = await client.auth.getSession();
        if (error || !data?.session) {
          return { user: null, session: null };
        }
        return { user: data.session.user, session: data.session };
      } catch {
        return { user: null, session: null };
      }
    },

    /**
     * Resolve e valida estritamente o perfil institucional em public.usuarios
     * usando apenas auth_user_id = auth.uid(). Nunca usa e-mail, localStorage ou user_metadata.
     */
    async resolveVerifiedProfile(
      authUserId: string,
      accessToken?: string
    ): Promise<VerifiedProfileResolution> {
      const { client, configured, fetchFn } = resolveDeps();
      if (!configured || !client) {
        return {
          profile: null,
          code: 'AUTH_NOT_CONFIGURED',
          error: 'Serviço de autenticação não configurado no ambiente.'
        };
      }

      const cleanUid = String(authUserId || '').trim();
      if (!cleanUid) {
        return {
          profile: null,
          code: 'SESSION_EXPIRED',
          error: 'Identificador de sessão inválido. Faça login novamente.'
        };
      }

      // 1. Verificação autoritativa no servidor (/api/auth-session), quando disponível
      if (accessToken && fetchFn) {
        try {
          const resp = await fetchFn('/api/auth-session', {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${accessToken}`
            }
          });
          const contentType = String(resp.headers?.get?.('content-type') || '').toLowerCase();
          if (contentType.includes('application/json')) {
            const payload = await resp.json().catch(() => null);
            if (resp.ok && payload?.authenticated && payload?.profile) {
              return validateInstitutionalProfile(payload.profile, cleanUid);
            }
            if (resp.status === 401 || resp.status === 403) {
              const mappedCode: AuthErrorCode =
                payload?.code === 'PROFILE_MISSING' ||
                payload?.code === 'PROFILE_PENDING' ||
                payload?.code === 'PROFILE_REJECTED' ||
                payload?.code === 'PROFILE_INACTIVE' ||
                payload?.code === 'ROLE_INVALID'
                  ? payload.code
                  : resp.status === 401
                  ? 'SESSION_EXPIRED'
                  : 'PROFILE_INACTIVE';
              return {
                profile: null,
                code: mappedCode,
                error: payload?.error || 'Acesso bloqueado na validação institucional.'
              };
            }
            if (resp.status === 503) {
              // Se o endpoint server-side não tiver service_role configurado localmente,
              // continua para validação direta via RLS autenticada no Supabase abaixo.
            }
          }
        } catch {
          // Ambiente offline/sem handler local segue para consulta RLS direta por auth_user_id
        }
      }

      // 2. Consulta direta protegida por RLS estritamente por auth_user_id (sem fallback por e-mail)
      try {
        let { data: row, error: queryErr } = await client
          .from('usuarios')
          .select(
            'id, auth_user_id, nome, login, matricula, perfil_profissional, setor, papel, situacao, status, force_password_change, observacoes, created_by, updated_by, created_at, updated_at'
          )
          .eq('auth_user_id', cleanUid)
          .maybeSingle();

        if (queryErr && !isNetworkOrTransportError(queryErr)) {
          const fallbackRes = await client
            .from('usuarios')
            .select('*')
            .eq('auth_user_id', cleanUid)
            .maybeSingle();
          row = fallbackRes.data;
          queryErr = fallbackRes.error;
        }

        if (queryErr) {
          if (isNetworkOrTransportError(queryErr)) {
            return {
              profile: null,
              code: 'NETWORK_ERROR',
              error: 'Falha temporária de rede ao verificar o cadastro institucional. Tente novamente.'
            };
          }
          return {
            profile: null,
            code: 'PROFILE_MISSING',
            error: 'Não foi possível validar seu cadastro institucional neste momento.'
          };
        }

        return validateInstitutionalProfile(row, cleanUid);
      } catch (err: any) {
        return {
          profile: null,
          code: isNetworkOrTransportError(err) ? 'NETWORK_ERROR' : 'PROFILE_MISSING',
          error: isNetworkOrTransportError(err)
            ? 'Erro temporário de comunicação ao verificar o perfil institucional.'
            : 'Falha ao consultar o cadastro institucional.'
        };
      }
    },

    async getUserProfile(
      authUserId: string,
      _unusedEmail?: string,
      accessToken?: string
    ): Promise<AuthUserProfile | null> {
      const res = await this.resolveVerifiedProfile(authUserId, accessToken);
      return res.profile;
    },

    /**
     * Restaura sessão existente e valida no Auth + public.usuarios antes de liberar UI.
     */
    async restoreVerifiedSession(): Promise<SessionRestoreResult> {
      if (!getDeps) {
        await ensureSupabaseInitialized();
      }
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return {
          status: 'unconfigured',
          code: 'AUTH_NOT_CONFIGURED',
          error:
            'Serviço de autenticação não configurado no ambiente. Acesso bloqueado por segurança.'
        };
      }

      try {
        const { data, error } = await client.auth.getSession();
        if (error) {
          return {
            status: 'blocked',
            code: isNetworkOrTransportError(error) ? 'NETWORK_ERROR' : 'SESSION_EXPIRED',
            error: isNetworkOrTransportError(error)
              ? 'Erro temporário de conexão ao validar a sessão. Tente novamente.'
              : 'Sessão inválida ou expirada. Faça login novamente.'
          };
        }

        const session = data?.session;
        if (!session?.user?.id || !session?.access_token) {
          return { status: 'unauthenticated' };
        }

        // Confirma validade do token no Supabase Auth quando getUser estiver disponível
        let verifiedUser = session.user;
        if (typeof client.auth.getUser === 'function') {
          const { data: userCheck, error: userErr } = await client.auth.getUser(session.access_token);
          if (userErr || !userCheck?.user?.id) {
            if (isNetworkOrTransportError(userErr)) {
              return {
                status: 'blocked',
                code: 'NETWORK_ERROR',
                error: 'Não foi possível validar a sessão por falha temporária de rede.'
              };
            }
            await client.auth.signOut().catch(() => {});
            return {
              status: 'expired',
              code: 'SESSION_EXPIRED',
              error: 'Sua sessão expirou. Faça login novamente.'
            };
          }
          verifiedUser = userCheck.user;
        }

        const profileRes = await this.resolveVerifiedProfile(verifiedUser.id, session.access_token);
        if (!profileRes.profile) {
          if (profileRes.code !== 'NETWORK_ERROR') {
            await client.auth.signOut().catch(() => {});
          }
          return {
            status: 'blocked',
            code: profileRes.code || 'PROFILE_MISSING',
            error:
              profileRes.error ||
              'Acesso bloqueado: cadastro institucional ausente ou não habilitado.'
          };
        }

        return {
          status: 'authenticated',
          user: verifiedUser,
          session,
          profile: profileRes.profile
        };
      } catch (err: any) {
        return {
          status: 'blocked',
          code: 'NETWORK_ERROR',
          error: isNetworkOrTransportError(err)
            ? 'Erro temporário de comunicação ao restaurar sessão.'
            : 'Não foi possível validar a sessão institucional.'
        };
      }
    },

    /**
     * Efetua login no Supabase Auth por e-mail institucional e senha
     * e falha fechado se não houver perfil ativo com papel válido em public.usuarios.
     */
    async loginWithPassword(email: string, password: string): Promise<LoginResult> {
      if (!getDeps) {
        await ensureSupabaseInitialized();
      }
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return {
          success: false,
          code: 'AUTH_NOT_CONFIGURED',
          error:
            'Sistema de autenticação não configurado no ambiente. Contate o suporte técnico.'
        };
      }

      const cleanEmail = String(email || '').trim();
      if (!cleanEmail || !password) {
        return {
          success: false,
          code: 'INVALID_CREDENTIALS',
          error: 'Informe o e-mail institucional e a senha.'
        };
      }

      try {
        const { data, error } = await client.auth.signInWithPassword({
          email: cleanEmail,
          password
        });

        if (error) {
          const rawMsg = String(error.message || '');
          if (isNetworkOrTransportError(error)) {
            return {
              success: false,
              code: 'NETWORK_ERROR',
              error: 'Falha temporária de comunicação com o serviço de autenticação.'
            };
          }
          if (rawMsg.toLowerCase().includes('email not confirmed')) {
            return {
              success: false,
              code: 'EMAIL_NOT_CONFIRMED',
              error: 'E-mail institucional ainda não confirmado.'
            };
          }
          return {
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Credenciais inválidas. Verifique seu e-mail e sua senha.'
          };
        }

        if (!data?.user?.id) {
          return {
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Usuário não encontrado na autenticação.'
          };
        }

        const profileRes = await this.resolveVerifiedProfile(
          data.user.id,
          data.session?.access_token
        );

        if (!profileRes.profile) {
          await client.auth.signOut().catch(() => {});
          return {
            success: false,
            code: profileRes.code || 'PROFILE_MISSING',
            error:
              profileRes.error ||
              'Conta autenticada sem perfil institucional ativo autorizado.'
          };
        }

        return {
          success: true,
          user: data.user,
          profile: profileRes.profile
        };
      } catch (err: any) {
        return {
          success: false,
          code: 'NETWORK_ERROR',
          error: isNetworkOrTransportError(err)
            ? 'Falha temporária de comunicação durante o login.'
            : 'Erro inesperado durante a autenticação.'
        };
      }
    },

    async sendPasswordReset(email: string): Promise<ResetPasswordResult> {
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return { success: false, error: 'Sistema de autenticação não configurado.' };
      }

      try {
        const redirectUrl = typeof window !== 'undefined' ? window.location.origin : undefined;
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: redirectUrl
        });

        if (error) {
          return { success: false, error: error.message };
        }

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || 'Erro ao solicitar redefinição de senha.' };
      }
    },

    async updatePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return { success: false, error: 'Sistema de autenticação não configurado.' };
      }

      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
        return {
          success: false,
          error: `A nova senha deve atender à política mínima de segurança (ao menos ${MIN_PASSWORD_LENGTH} caracteres).`
        };
      }

      try {
        const { error } = await client.auth.updateUser({
          password: newPassword
        });

        if (error) {
          return { success: false, error: error.message };
        }

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || 'Erro ao atualizar senha.' };
      }
    },

    async completeFirstAccessPasswordChange(
      newPassword: string,
      confirmPassword?: string
    ): Promise<CompletePasswordChangeResult> {
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return { success: false, error: 'Sistema de autenticação não configurado.' };
      }

      if (!newPassword || typeof newPassword !== 'string') {
        return { success: false, error: 'Informe a nova senha.' };
      }

      if (confirmPassword !== undefined && newPassword !== confirmPassword) {
        return { success: false, error: 'A confirmação da nova senha não confere.' };
      }

      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return {
          success: false,
          error: `A nova senha deve atender à política mínima de segurança (ao menos ${MIN_PASSWORD_LENGTH} caracteres).`
        };
      }

      try {
        const { data: sessionData } = await client.auth.getSession();
        const currentUid = String(sessionData?.session?.user?.id || '').trim();
        if (!currentUid) {
          return { success: false, error: 'Sessão inválida ou expirada. Faça login novamente.' };
        }

        const { error: authErr } = await client.auth.updateUser({
          password: newPassword
        });

        if (authErr) {
          return {
            success: false,
            error: authErr.message || 'A nova senha não atende aos requisitos da política de segurança configurada.'
          };
        }

        const { data: fnData, error: fnErr } = await client.functions.invoke('admin-manage-user', {
          body: {
            action: 'complete-password-change'
          }
        });

        if (fnErr || !fnData?.success) {
          return {
            success: false,
            passwordUpdatedInAuth: true,
            error:
              fnData?.error ||
              'Senha alterada na autenticação, mas não foi possível confirmar a liberação no servidor.'
          };
        }

        const { data: refreshedSession } = await client.auth.getSession();
        const accessToken =
          refreshedSession?.session?.access_token || sessionData?.session?.access_token;
        const verifiedRes = await this.resolveVerifiedProfile(currentUid, accessToken);

        if (!verifiedRes.profile || verifiedRes.profile.forcePasswordChange) {
          return {
            success: false,
            passwordUpdatedInAuth: true,
            error:
              verifiedRes.error ||
              'Não foi possível confirmar a atualização do perfil após a troca de senha.'
          };
        }

      return {
        success: true,
        profile: verifiedRes.profile
      };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || 'Erro ao concluir a alteração obrigatória de senha.'
        };
      }
    },

    async changeOwnPassword(
      currentPassword: string,
      newPassword: string,
      confirmPassword: string,
      options?: { forcePasswordChange?: boolean }
    ): Promise<ChangeOwnPasswordResult> {
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return { success: false, error: 'Sistema de autenticação não configurado.' };
      }

      if (!currentPassword || typeof currentPassword !== 'string') {
        return { success: false, error: 'Informe a senha atual.' };
      }

      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
        return {
          success: false,
          error: `A nova senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`
        };
      }

      if (newPassword === currentPassword) {
        return {
          success: false,
          error: 'A nova senha deve ser diferente da senha atual.'
        };
      }

      if (newPassword !== confirmPassword) {
        return {
          success: false,
          error: 'A confirmação da nova senha não confere.'
        };
      }

      try {
        const { data: sessionData, error: sessionErr } = await client.auth.getSession();
        const sessionUser = sessionData?.session?.user;
        const sessionEmail = String(sessionUser?.email || '').trim().toLowerCase();
        const sessionUid = String(sessionUser?.id || '').trim();

        if (sessionErr || !sessionUid || !sessionEmail) {
          return { success: false, error: 'Sessão inválida ou expirada. Faça login novamente.' };
        }

        const { data: reauthData, error: reauthErr } = await client.auth.signInWithPassword({
          email: sessionEmail,
          password: currentPassword
        });

        if (reauthErr || !reauthData?.user?.id || String(reauthData.user.id) !== sessionUid) {
          return { success: false, error: 'Senha atual incorreta' };
        }

        const { error: updErr } = await client.auth.updateUser({
          password: newPassword
        });

        if (updErr) {
          return {
            success: false,
            error: 'Não foi possível atualizar a senha. Verifique os requisitos de segurança e tente novamente.'
          };
        }

        let requiresForceClear = options?.forcePasswordChange;
        if (requiresForceClear === undefined) {
          const currentProfileRes = await this.resolveVerifiedProfile(
            sessionUid,
            reauthData.session?.access_token || sessionData?.session?.access_token
          );
          requiresForceClear = Boolean(currentProfileRes.profile?.forcePasswordChange);
        }

        let updatedProfile: AuthUserProfile | null = null;
        if (requiresForceClear) {
          const { data: fnData, error: fnErr } = await client.functions.invoke('admin-manage-user', {
            body: {
              action: 'complete-password-change'
            }
          });

          if (fnErr || !fnData?.success) {
            return {
              success: false,
              error: 'Senha alterada na autenticação, mas não foi possível confirmar a liberação no servidor.'
            };
          }

          const { data: refreshedSession } = await client.auth.getSession();
          const verifiedRes = await this.resolveVerifiedProfile(
            sessionUid,
            refreshedSession?.session?.access_token || reauthData.session?.access_token
          );
          updatedProfile = verifiedRes.profile;
        } else {
          const { data: refreshedSession } = await client.auth.getSession();
          const verifiedRes = await this.resolveVerifiedProfile(
            sessionUid,
            refreshedSession?.session?.access_token || reauthData.session?.access_token
          );
          updatedProfile = verifiedRes.profile;
        }

        return {
          success: true,
          profile: updatedProfile
        };
      } catch {
        return {
          success: false,
          error: 'Não foi possível concluir a alteração de senha.'
        };
      }
    },

    async completeRecoveryPasswordChange(
      newPassword: string,
      confirmPassword: string,
      options?: { forcePasswordChange?: boolean }
    ): Promise<CompletePasswordChangeResult> {
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return { success: false, error: 'Sistema de autenticação não configurado.' };
      }

      if (!newPassword || typeof newPassword !== 'string') {
        return { success: false, error: 'Informe a nova senha.' };
      }

      if (newPassword !== confirmPassword) {
        return { success: false, error: 'A confirmação da nova senha não confere.' };
      }

      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return {
          success: false,
          error: `A nova senha deve atender à política mínima de segurança (ao menos ${MIN_PASSWORD_LENGTH} caracteres).`
        };
      }

      try {
        const { error: authErr } = await client.auth.updateUser({
          password: newPassword
        });

        if (authErr) {
          return {
            success: false,
            error: authErr.message || 'Não foi possível definir a nova senha de recuperação.'
          };
        }

        const { data: sessionData } = await client.auth.getSession();
        const currentUid = String(sessionData?.session?.user?.id || '').trim();
        let accessToken = sessionData?.session?.access_token;

        if (currentUid) {
          let needsForceClear = options?.forcePasswordChange;
          if (needsForceClear === undefined) {
            const profCheck = await this.resolveVerifiedProfile(currentUid, accessToken);
            needsForceClear = Boolean(profCheck.profile?.forcePasswordChange);
          }
          if (needsForceClear) {
            await client.functions
              .invoke('admin-manage-user', {
                body: { action: 'complete-password-change' }
              })
              .catch(() => undefined);
          }
          const finalProf = await this.resolveVerifiedProfile(currentUid, accessToken);
          return {
            success: true,
            profile: finalProf.profile
          };
        }

        return { success: true, profile: null };
      } catch {
        return {
          success: false,
          error: 'Erro ao concluir a redefinição de senha.'
        };
      }
    },

    async resetOwnPasswordToDefault(): Promise<ResetOwnPasswordResult> {
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return { success: false, error: 'Sistema de autenticação não configurado.' };
      }

      try {
        const { data, error } = await client.functions.invoke('admin-manage-user', {
          body: {
            action: 'reset-own-password'
          }
        });

        if (error || !data?.success) {
          return {
            success: false,
            error: data?.error || 'Não foi possível redefinir a senha para a senha padrão.'
          };
        }

        await this.logout();

        return {
          success: true,
          message:
            data.message ||
            'Senha redefinida. Entre com a senha padrão e crie uma nova.'
        };
      } catch {
        return {
          success: false,
          error: 'Não foi possível redefinir a senha para a senha padrão.'
        };
      }
    },

    async logout(): Promise<void> {
      const { client, configured } = resolveDeps();
      if (configured && client) {
        try {
          await client.auth.signOut();
        } catch {
          // Ignora falha transitória ao limpar sessão local
        }
      }
    },

    /**
     * Autocadastro público desativado por segurança.
     * Contas devem ser provisionadas exclusivamente por Administradores ativos.
     */
    async requestAccess(_payload: AccessRequestPayload): Promise<{
      success: boolean;
      message?: string;
      error?: string;
    }> {
      return {
        success: false,
        error:
          'Cadastro público desativado. Contas institucionais são habilitadas exclusivamente pela Administração da CSB.'
      };
    },

    async approveUser(
      usuarioId: string,
      papel: UserRole
    ): Promise<{ success: boolean; authUserId?: string; error?: string; message?: string }> {
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return { success: false, error: 'Sistema de autenticação não configurado.' };
      }

      const selectedPapel = normalizeStrictUserRole(papel);
      if (!selectedPapel) {
        return { success: false, error: 'Papel de acesso inválido para aprovação.' };
      }

      try {
        const { data, error } = await client.functions.invoke('admin-manage-user', {
          body: {
            action: 'approve-user',
            usuarioId,
            papel: selectedPapel
          }
        });

        if (error) {
          return {
            success: false,
            error: `Falha no serviço de aprovação: ${error.message}.`
          };
        }

        if (!data?.success) {
          return {
            success: false,
            error: data?.error || 'A aprovação não pôde ser concluída pelo servidor.'
          };
        }

        return {
          success: true,
          authUserId: data.authUserId,
          message:
            data.message ||
            `Usuário aprovado com sucesso! Situação alterada para Ativo com papel ${selectedPapel}.`
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || 'Falha ao acionar a aprovação de usuário no servidor.'
        };
      }
    },

    async rejectUser(
      usuarioId: string,
      motivo?: string
    ): Promise<{ success: boolean; error?: string; message?: string }> {
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return { success: false, error: 'Sistema de autenticação não configurado.' };
      }

      try {
        const { data, error } = await client.functions.invoke('admin-manage-user', {
          body: {
            action: 'reject-user',
            usuarioId,
            motivo: motivo?.trim() || undefined
          }
        });

        if (!error && data?.success) {
          return {
            success: true,
            message: data.message || 'Solicitação de acesso recusada.'
          };
        }

        const { error: updErr } = await client
          .from('usuarios')
          .update({
            situacao: 'Recusado',
            status: 'Inativo',
            observacoes: motivo ? `[Recusado: ${motivo.trim()}]` : undefined,
            updated_at: new Date().toISOString()
          })
          .eq('id', usuarioId);

        if (updErr) {
          return {
            success: false,
            error: `Falha ao registrar recusa: ${updErr.message}`
          };
        }

        return {
          success: true,
          message: 'Solicitação de acesso recusada com sucesso.'
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || 'Erro ao registrar recusa de usuário.'
        };
      }
    },

    async adminResetUserPassword(
      usuarioId: string,
      authUserId?: string
    ): Promise<AdminResetPasswordResult> {
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return { success: false, error: 'Sistema de autenticação não configurado.' };
      }

      if (!String(usuarioId || '').trim() && !String(authUserId || '').trim()) {
        return { success: false, error: 'Identificador de usuário inválido para redefinição.' };
      }

      try {
        const { data, error } = await client.functions.invoke('admin-manage-user', {
          body: {
            action: 'reset-password',
            usuarioId: String(usuarioId || '').trim() || undefined,
            authUserId: String(authUserId || '').trim() || undefined
          }
        });

        if (error) {
          return {
            success: false,
            error: `Falha ao redefinir senha no servidor: ${error.message}.`
          };
        }

        if (!data?.success) {
          return {
            success: false,
            error: data?.error || 'Não foi possível concluir a redefinição de senha.'
          };
        }

        return {
          success: true,
          message:
            data.message ||
            'Senha redefinida para a senha temporária institucional. Troca obrigatória no próximo acesso.'
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || 'Erro ao acionar redefinição de senha no servidor.'
        };
      }
    },

    async adminCreateUser(payload: AdminCreateUserPayload): Promise<AdminCreateUserResult> {
      const { client, configured } = resolveDeps();
      if (!configured || !client) {
        return { success: false, error: 'Sistema de autenticação não configurado.' };
      }

      const validRole = normalizeStrictUserRole(payload.papel);
      if (!validRole) {
        return { success: false, error: 'Papel institucional inválido.' };
      }

      try {
        const { data, error } = await client.functions.invoke('admin-manage-user', {
          body: {
            action: 'create-user',
            nome: payload.nome,
            matricula: payload.matricula,
            email: payload.email,
            login: payload.login,
            perfilProfissional: payload.perfilProfissional,
            setor: payload.setor,
            papel: validRole,
            situacao: payload.situacao,
            observacoes: payload.observacoes
          }
        });

        if (error) {
          return {
            success: false,
            error: `Falha ao criar usuário no servidor: ${error.message}`
          };
        }

        if (!data?.success) {
          return {
            success: false,
            error: data?.error || 'Não foi possível concluir o cadastro do usuário.'
          };
        }

        return {
          success: true,
          authUserId: data?.authUserId,
          usuarioRecord: data?.usuarioRecord
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || 'Falha ao cadastrar usuário no servidor.'
        };
      }
    }
  };
}

export const authService = createAuthService();
