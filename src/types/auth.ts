/**
 * NOTIFICA CSB — TIPOS DE AUTENTICAÇÃO E CONTROLE DE ACESSO (RBAC)
 * Coordenadoria de Segurança de Barragens — CSB / SURH / SEMA-MT
 */

export const ALLOWED_USER_ROLES = [
  'Administrador',
  'Analista',
  'Usuário',
  'Visualizador'
] as const;

export type UserRole = typeof ALLOWED_USER_ROLES[number];

export type AuthErrorCode =
  | 'AUTH_NOT_CONFIGURED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_CONFIRMED'
  | 'PROFILE_MISSING'
  | 'PROFILE_INACTIVE'
  | 'PROFILE_PENDING'
  | 'PROFILE_REJECTED'
  | 'ROLE_INVALID'
  | 'SESSION_EXPIRED'
  | 'NETWORK_ERROR';

export const PERFIS_PROFISSIONAIS = [
  'Analista de Meio Ambiente',
  'Analista de Desenvolvimento Econômico e Social',
  'Técnico de Meio Ambiente',
  'Residente Técnico',
  'Estagiário de Nível Superior',
  'Estagiário de Nível Médio'
] as const;

export type PerfilProfissional = typeof PERFIS_PROFISSIONAIS[number];

export const SETORES = [
  'Setor de Classificação',
  'Setor de Fiscalização',
  'Setor de Administrativo'
] as const;

export type SetorLotacao = typeof SETORES[number];

export interface AuthUserProfile {
  id: string; // ID da tabela usuarios
  authUserId?: string; // UUID em auth.users
  nome: string;
  login: string;
  email: string;
  matricula?: string;
  perfilProfissional?: PerfilProfissional | string;
  setor?: SetorLotacao | string;
  papel: UserRole;
  situacao: 'Ativo' | 'Inativo' | 'Pendente' | 'Recusado';
  forcePasswordChange?: boolean;
  observacoes?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AccessRequestPayload {
  nome: string;
  matricula: string;
  email: string;
  login?: string;
  perfilProfissional: string;
  setor: string;
  senha?: string;
}

export interface CurrentAuthSession {
  isAuthenticated: boolean;
  user: {
    id: string;
    email: string;
  } | null;
  profile: AuthUserProfile | null;
  role: UserRole;
  isDevBypass?: boolean;
}
