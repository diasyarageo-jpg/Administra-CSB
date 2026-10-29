/**
 * NOTIFICA CSB — SERVIÇO DE AUTENTICAÇÃO E PERFIS DE ACESSO
 * Coordenadoria de Segurança de Barragens — CSB / SURH / SEMA-MT
 */

import { supabase, isSupabaseConfigured } from './supabaseClient';
import { UserRole, AuthUserProfile, CurrentAuthSession, AccessRequestPayload } from '../types/auth';

export interface LoginResult {
  success: boolean;
  error?: string;
  user?: any;
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
  sendInviteEmail?: boolean;
  temporaryPassword?: string;
}

export interface AdminCreateUserResult {
  success: boolean;
  error?: string;
  authUserId?: string;
  usuarioRecord?: any;
}

export const authService = {
  /**
   * Obtém a sessão atual do Supabase Auth
   */
  async getSession(): Promise<{ user: any | null; session: any | null }> {
    if (!isSupabaseConfigured() || !supabase) {
      return { user: null, session: null };
    }
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        return { user: null, session: null };
      }
      return { user: data.session.user, session: data.session };
    } catch {
      return { user: null, session: null };
    }
  },

  /**
   * Obtém o perfil cadastral do usuário autenticado a partir da tabela 'usuarios'
   */
  async getUserProfile(authUserId: string, email?: string): Promise<AuthUserProfile | null> {
    if (!isSupabaseConfigured() || !supabase) {
      return null;
    }

    try {
      // 1. Busca por auth_user_id
      const { data: byAuthId, error: errAuthId } = await supabase
        .from('usuarios')
        .select('*')
        .eq('auth_user_id', authUserId)
        .maybeSingle();

      if (byAuthId && !errAuthId) {
        return this.mapRowToProfile(byAuthId);
      }

      // 2. Se não encontrou por auth_user_id mas temos o e-mail, busca por email
      // e realiza a vinculação segura do auth_user_id
      if (email) {
        const { data: byEmail, error: errEmail } = await supabase
          .from('usuarios')
          .select('*')
          .ilike('email', email.trim())
          .maybeSingle();

        if (byEmail && !errEmail) {
          // Vincula o auth_user_id se ainda estiver nulo
          if (!byEmail.auth_user_id) {
            await supabase
              .from('usuarios')
              .update({ auth_user_id: authUserId, updated_at: new Date().toISOString() })
              .eq('id', byEmail.id);
            byEmail.auth_user_id = authUserId;
          }
          return this.mapRowToProfile(byEmail);
        }
      }

      return null;
    } catch (err) {
      console.warn('[authService] Erro ao carregar perfil do usuário:', err);
      return null;
    }
  },

  mapRowToProfile(row: any): AuthUserProfile {
    let papel: UserRole = 'Visualizador';
    const rawPapel = String(row.papel || '').toLowerCase();
    if (rawPapel === 'administrador' || rawPapel === 'admin') {
      papel = 'Administrador';
    } else if (rawPapel === 'usuário' || rawPapel === 'usuario' || rawPapel === 'analista') {
      papel = 'Usuário';
    } else {
      papel = 'Visualizador';
    }

    return {
      id: String(row.id),
      authUserId: row.auth_user_id || undefined,
      nome: row.nome || '',
      login: row.login || row.email || '',
      email: row.email || '',
      matricula: row.matricula || '',
      perfilProfissional: row.perfil_profissional || row.perfilProfissional || '',
      setor: row.setor || '',
      papel,
      situacao: (
        row.situacao === 'Inativo' ? 'Inativo' :
        row.situacao === 'Pendente' ? 'Pendente' :
        row.situacao === 'Recusado' ? 'Recusado' : 'Ativo'
      ),
      observacoes: row.observacoes || '',
      createdBy: row.created_by || undefined,
      updatedBy: row.updated_by || undefined,
      createdAt: row.created_at || row.createdAt || new Date().toISOString(),
      updatedAt: row.updated_at || row.updatedAt
    };
  },

  /**
   * Efetua login no Supabase Auth por e-mail institucional e senha
   */
  async loginWithPassword(email: string, password: string): Promise<LoginResult> {
    if (!isSupabaseConfigured() || !supabase) {
      return {
        success: false,
        error: 'Supabase não está configurado. Configure as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.'
      };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (error) {
        let msg = error.message;
        if (msg.includes('Invalid login credentials')) {
          msg = 'Credenciais incorretas. Verifique seu e-mail e sua senha.';
        } else if (msg.includes('Email not confirmed')) {
          msg = 'E-mail institucional ainda não confirmado no Supabase.';
        }
        return { success: false, error: msg };
      }

      if (!data.user) {
        return { success: false, error: 'Usuário não encontrado na autenticação.' };
      }

      const profile = await this.getUserProfile(data.user.id, data.user.email);

      // Se o usuário não estiver ativo na tabela de usuários, não autoriza acesso
      if (profile && profile.situacao !== 'Ativo') {
        await supabase.auth.signOut();
        const msg = profile.situacao === 'Pendente'
          ? 'Sua solicitação de acesso está aguardando aprovação da Administração da CSB.'
          : profile.situacao === 'Recusado'
          ? 'Sua solicitação de acesso foi recusada pela administração da CSB.'
          : 'Esta conta de usuário está desativada na CSB. Entre em contato com a administração.';
        return {
          success: false,
          error: msg
        };
      }

      return {
        success: true,
        user: data.user,
        profile
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Falha de comunicação durante o login.'
      };
    }
  },

  /**
   * Envia e-mail de recuperação de senha pelo Supabase Auth
   */
  async sendPasswordReset(email: string): Promise<ResetPasswordResult> {
    if (!isSupabaseConfigured() || !supabase) {
      return { success: false, error: 'Supabase não configurado.' };
    }

    try {
      const redirectUrl = typeof window !== 'undefined' ? window.location.origin : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
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

  /**
   * Atualiza a senha da conta autenticada
   */
  async updatePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured() || !supabase) {
      return { success: false, error: 'Supabase não configurado.' };
    }

    try {
      const { error } = await supabase.auth.updateUser({
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

  /**
   * Encerra a sessão
   */
  async logout(): Promise<void> {
    if (isSupabaseConfigured() && supabase) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn('Erro ao encerrar sessão Supabase:', err);
      }
    }
  },

  /**
   * Solicita novo acesso na página de login (pública).
   * Registra a solicitação como 'Pendente' com senha cifrada (nunca em texto puro).
   * Sem expor service_role no frontend e sem conceder acesso imediato.
   */
  async requestAccess(payload: AccessRequestPayload): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!isSupabaseConfigured() || !supabase) {
      return {
        success: false,
        error: 'Supabase não está configurado. Não é possível enviar solicitações no momento.'
      };
    }

    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: {
          action: 'request-access',
          ...payload
        }
      });

      if (error) {
        return {
          success: false,
          error: `Erro ao enviar solicitação: ${error.message}`
        };
      }

      if (data && !data.success) {
        return {
          success: false,
          error: data.error || 'Não foi possível registrar a solicitação de acesso.'
        };
      }

      return {
        success: true,
        message: data?.message || 'Solicitação registrada com sucesso. Aguarde a avaliação da administração.'
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Falha de comunicação ao registrar solicitação de acesso.'
      };
    }
  },

  /**
   * Administrador aprova uma solicitação de acesso:
   * Define o papel selecionado, provisiona a conta no Supabase Auth e ativa o cadastro.
   */
  async approveUser(usuarioId: string, papel: UserRole): Promise<{ success: boolean; authUserId?: string; error?: string; message?: string }> {
    if (!isSupabaseConfigured() || !supabase) {
      return { success: false, error: 'Supabase não está configurado.' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: {
          action: 'approve-user',
          usuarioId,
          papel
        }
      });

      if (error) {
        return {
          success: false,
          error: `Erro na aprovação: ${error.message}`
        };
      }

      if (data && !data.success) {
        return {
          success: false,
          error: data.error || 'Falha ao aprovar usuário.'
        };
      }

      return {
        success: true,
        authUserId: data?.authUserId,
        message: data?.message || 'Usuário aprovado com sucesso.'
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Erro ao comunicar com a Edge Function de aprovação.'
      };
    }
  },

  /**
   * Administrador recusa uma solicitação de acesso.
   * Marca como 'Recusado' sem conceder acesso ao sistema.
   */
  async rejectUser(usuarioId: string, motivo?: string): Promise<{ success: boolean; error?: string; message?: string }> {
    if (!isSupabaseConfigured() || !supabase) {
      return { success: false, error: 'Supabase não está configurado.' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: {
          action: 'reject-user',
          usuarioId,
          motivo
        }
      });

      if (error) {
        return {
          success: false,
          error: `Erro na recusa: ${error.message}`
        };
      }

      if (data && !data.success) {
        return {
          success: false,
          error: data.error || 'Falha ao recusar solicitação.'
        };
      }

      return {
        success: true,
        message: data?.message || 'Solicitação recusada com sucesso.'
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Erro ao comunicar com a Edge Function de recusa.'
      };
    }
  },

  /**
   * Cria ou convida um novo usuário no Supabase Auth via Edge Function protegida
   * (Sem expor a service_role key no frontend).
   */
  async adminCreateUser(payload: AdminCreateUserPayload): Promise<AdminCreateUserResult> {
    if (!isSupabaseConfigured() || !supabase) {
      return { success: false, error: 'Supabase não está configurado.' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: {
          action: 'create-user',
          ...payload
        }
      });

      if (error) {
        return {
          success: false,
          error: `Edge Function erro: ${error.message}. Verifique se a função 'admin-manage-user' foi implantada no projeto Supabase.`
        };
      }

      if (data && !data.success) {
        return {
          success: false,
          error: data.error || 'Erro retornado pela função administrativa de usuários.'
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
        error: err?.message || 'Falha ao acionar a Edge Function admin-manage-user.'
      };
    }
  }
};
