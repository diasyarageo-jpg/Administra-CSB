// src/server/semaAudit.ts
import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { sanitizeSemaProperties, stripOuterQuotesAndBrackets } from '../config/carCampos';

export type ServerAuthErrorCode =
  | 'AUTH_NOT_CONFIGURED'
  | 'SESSION_REQUIRED'
  | 'SESSION_INVALID'
  | 'PROFILE_MISSING'
  | 'PROFILE_INACTIVE'
  | 'PROFILE_PENDING'
  | 'PROFILE_REJECTED'
  | 'ROLE_INVALID'
  | 'SERVER_ERROR';

export interface SemaAuthContext {
  configured: boolean;
  authorized: boolean;
  httpStatus?: number;
  error?: string;
  authErrorCode?: ServerAuthErrorCode;
  userId: string | null;
  usuarioId?: string | null;
  role: string | null;
  situacao?: string | null;
  login?: string | null;
  userName?: string | null;
  matricula?: string | null;
  perfilProfissional?: string | null;
  setor?: string | null;
  supabaseAdmin: SupabaseClient<any, any, any> | null;
}

export function canViewFullSemaPersonalData(auth: SemaAuthContext | null | undefined): boolean {
  return Boolean(
    auth &&
      auth.configured &&
      auth.authorized &&
      (auth.role === 'Administrador' || auth.role === 'Analista')
  );
}

export interface SemaAuditTargetContext {
  entidadeAlvoTipo?: 'empreendedor' | 'barragem' | 'car';
  entidadeAlvoId?: string;
}

export interface ServerAuditItemInput {
  criterioTipo: 'car' | 'coordenada' | 'processo' | 'cpf_cnpj_hash' | 'nome_exploratorio';
  criterioValor?: string;
  camada: string;
  featureId: string;
  car?: string;
  rawProps: Record<string, any>;
  docStatus: 'completo' | 'mascarado' | 'ausente';
  docDigits?: string;
  camposConsultados?: string[];
  consultadoEm?: string;
  extraSafeAttrs?: Record<string, any>;
}

export interface RecordSemaAuditResult {
  ok: boolean;
  available: boolean;
  auditoriaId?: string;
  error?: string;
}

let testSupabaseAdminOverride: SupabaseClient<any, any, any> | null = null;

export function setTestSupabaseAdminForSemaAudit(
  client: SupabaseClient<any, any, any> | null
): void {
  testSupabaseAdminOverride = client;
}

function getServerSupabaseAdminClient(): SupabaseClient<any, any, any> | null {
  if (testSupabaseAdminOverride) return testSupabaseAdminOverride;
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function sha256HexServer(value: string): string {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export function scrubSensitiveTextForServerLog(raw: string): string {
  return String(raw || '')
    .replace(/\b(\d{3})\.(\d{3})\.(\d{3})-(\d{2})\b/g, '***.$2.***-$4')
    .replace(/\b(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})-(\d{2})\b/g, '**.$2.***/$4-**')
    .replace(/(?<![\/.\-\d])(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})(?![\/.\-\d])/g, '**.$2.***/$4-**')
    .replace(/(?<![\/.\-\d])(\d{3})(\d{3})(\d{3})(\d{2})(?![\/.\-\d])/g, '***.$2.***-$4')
    .trim();
}

export function parseSemaAuditTargetContext(raw: {
  entidadeAlvoTipo?: unknown;
  entidadeAlvoId?: unknown;
}): SemaAuditTargetContext {
  const tipoRaw = String(raw.entidadeAlvoTipo || '').trim().toLowerCase();
  const idRaw = String(raw.entidadeAlvoId || '').trim();
  if (tipoRaw !== 'barragem' && tipoRaw !== 'empreendedor' && tipoRaw !== 'car') {
    return {};
  }
  if (!idRaw || idRaw.length > 120) {
    return { entidadeAlvoTipo: tipoRaw };
  }
  return {
    entidadeAlvoTipo: tipoRaw,
    entidadeAlvoId: idRaw
  };
}

export const SERVER_ALLOWED_ROLES = [
  'Administrador',
  'Analista',
  'Usuário',
  'Visualizador'
] as const;

export function normalizeRoleLabel(rawRole: unknown): string {
  const norm = String(rawRole || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (norm === 'administrador') return 'Administrador';
  if (norm === 'analista') return 'Analista';
  if (norm === 'usuario') return 'Usuário';
  if (norm === 'visualizador') return 'Visualizador';
  return '';
}

function normalizeSituacaoLabel(rawSituacao: unknown): string {
  const norm = String(rawSituacao || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (norm === 'ativo') return 'Ativo';
  if (norm === 'inativo') return 'Inativo';
  if (norm === 'pendente') return 'Pendente';
  if (norm === 'recusado') return 'Recusado';
  return '';
}

export async function authorizeSemaLookupRequest(
  req: IncomingMessage & { headers?: Record<string, string | string[] | undefined> }
): Promise<SemaAuthContext> {
  const supabaseAdmin = getServerSupabaseAdminClient();
  if (!supabaseAdmin) {
    return {
      configured: false,
      authorized: true,
      authErrorCode: 'AUTH_NOT_CONFIGURED',
      userId: null,
      usuarioId: null,
      role: null,
      situacao: null,
      login: null,
      userName: null,
      supabaseAdmin: null
    };
  }

  const rawAuth = req.headers?.['authorization'];
  const authHeader = Array.isArray(rawAuth) ? String(rawAuth[0] || '') : String(rawAuth || '');
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const jwt = bearerMatch ? bearerMatch[1].trim() : '';

  if (!jwt) {
    return {
      configured: true,
      authorized: false,
      httpStatus: 401,
      authErrorCode: 'SESSION_REQUIRED',
      error: 'Autenticação obrigatória para acessar o sistema.',
      userId: null,
      usuarioId: null,
      role: null,
      situacao: null,
      login: null,
      userName: null,
      supabaseAdmin: null
    };
  }

  try {
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
    if (userErr || !userData?.user?.id) {
      return {
        configured: true,
        authorized: false,
        httpStatus: 401,
        authErrorCode: 'SESSION_INVALID',
        error: 'Sessão inválida ou expirada. Faça login novamente.',
        userId: null,
        usuarioId: null,
        role: null,
        situacao: null,
        login: null,
        userName: null,
        supabaseAdmin: null
      };
    }

    let profile: any = null;
    let profErr: any = null;

    // Vinculo estrito por auth_user_id = auth.uid() (sem fallback por e-mail nem user_metadata)
    const primaryRes = await supabaseAdmin
      .from('usuarios')
      .select('id, papel, situacao, status, auth_user_id, login, nome, matricula, perfil_profissional, setor')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();

    profile = primaryRes.data;
    profErr = primaryRes.error;

    if (profErr) {
      const fallbackColRes = await supabaseAdmin
        .from('usuarios')
        .select('id, papel, situacao, auth_user_id')
        .eq('auth_user_id', userData.user.id)
        .maybeSingle();
      profile = fallbackColRes.data;
      profErr = fallbackColRes.error;
    }

    if (profErr) {
      return {
        configured: true,
        authorized: false,
        httpStatus: 500,
        authErrorCode: 'SERVER_ERROR',
        error: 'Não foi possível consultar o cadastro institucional no servidor.',
        userId: null,
        usuarioId: null,
        role: null,
        situacao: null,
        login: null,
        userName: null,
        supabaseAdmin: null
      };
    }

    if (!profile || String(profile.auth_user_id || '').trim() !== String(userData.user.id).trim()) {
      return {
        configured: true,
        authorized: false,
        httpStatus: 403,
        authErrorCode: 'PROFILE_MISSING',
        error: 'Conta autenticada sem cadastro institucional vinculado na tabela de usuários.',
        userId: null,
        usuarioId: null,
        role: null,
        situacao: null,
        login: null,
        userName: null,
        supabaseAdmin: null
      };
    }

    const normalizedSituacao = normalizeSituacaoLabel(profile.situacao ?? profile.status);
    if (normalizedSituacao !== 'Ativo') {
      const code: ServerAuthErrorCode =
        normalizedSituacao === 'Pendente'
          ? 'PROFILE_PENDING'
          : normalizedSituacao === 'Recusado'
          ? 'PROFILE_REJECTED'
          : 'PROFILE_INACTIVE';
      const msg =
        code === 'PROFILE_PENDING'
          ? 'Cadastro institucional pendente de aprovação pela Administração.'
          : code === 'PROFILE_REJECTED'
          ? 'Cadastro institucional recusado pela Administração.'
          : 'Cadastro institucional inativo ou bloqueado. Contate a Administração.';
      return {
        configured: true,
        authorized: false,
        httpStatus: 403,
        authErrorCode: code,
        error: msg,
        userId: null,
        usuarioId: null,
        role: null,
        situacao: normalizedSituacao || null,
        login: null,
        userName: null,
        supabaseAdmin: null
      };
    }

    const role = normalizeRoleLabel(profile.papel);
    if (!role || !(SERVER_ALLOWED_ROLES as readonly string[]).includes(role)) {
      return {
        configured: true,
        authorized: false,
        httpStatus: 403,
        authErrorCode: 'ROLE_INVALID',
        error: 'Cadastro institucional sem perfil de acesso válido configurado.',
        userId: null,
        usuarioId: null,
        role: null,
        situacao: normalizedSituacao,
        login: null,
        userName: null,
        supabaseAdmin: null
      };
    }

    const resolvedLogin = profile.login
      ? String(profile.login).trim()
      : profile.id
      ? String(profile.id).trim()
      : null;

    return {
      configured: true,
      authorized: true,
      userId: String(userData.user.id),
      usuarioId: profile.id ? String(profile.id) : null,
      role,
      situacao: normalizedSituacao,
      login: resolvedLogin,
      userName: profile.nome ? String(profile.nome).trim() : null,
      matricula: profile.matricula ? String(profile.matricula).trim() : null,
      perfilProfissional: profile.perfil_profissional
        ? String(profile.perfil_profissional).trim()
        : null,
      setor: profile.setor ? String(profile.setor).trim() : null,
      supabaseAdmin
    };
  } catch {
    return {
      configured: true,
      authorized: false,
      httpStatus: 500,
      authErrorCode: 'SERVER_ERROR',
      error: 'Não foi possível validar a sessão institucional no servidor.',
      userId: null,
      usuarioId: null,
      role: null,
      situacao: null,
      login: null,
      userName: null,
      supabaseAdmin: null
    };
  }
}

export async function validateTargetEntityAccess(
  auth: SemaAuthContext,
  target: SemaAuditTargetContext
): Promise<{ ok: boolean; httpStatus?: number; error?: string; resolvedTarget: SemaAuditTargetContext }> {
  if (!auth.configured || !auth.supabaseAdmin) {
    return { ok: true, resolvedTarget: target };
  }

  if (!target.entidadeAlvoTipo || !target.entidadeAlvoId) {
    return { ok: true, resolvedTarget: target };
  }

  if (target.entidadeAlvoTipo === 'car') {
    return { ok: true, resolvedTarget: target };
  }

  const tableName = target.entidadeAlvoTipo === 'barragem' ? 'barragens' : 'empreendedores';
  const { data: row, error } = await auth.supabaseAdmin
    .from(tableName)
    .select('id, created_by')
    .eq('id', target.entidadeAlvoId)
    .maybeSingle();

  if (error || !row) {
    return {
      ok: false,
      httpStatus: 404,
      error: 'Registro alvo da consulta não encontrado na base central.',
      resolvedTarget: {}
    };
  }

  if (auth.role === 'Usuário' && row.created_by && String(row.created_by) !== String(auth.userId)) {
    return {
      ok: false,
      httpStatus: 403,
      error: 'Sem permissão para vincular auditoria a registro de outro usuário.',
      resolvedTarget: {}
    };
  }

  return { ok: true, resolvedTarget: target };
}

function buildSanitizedAuditAttributes(
  input: ServerAuditItemInput,
  auth?: SemaAuthContext
): Record<string, any> {
  const sanitizedRaw = sanitizeSemaProperties(input.rawProps || {});
  const merged: Record<string, any> = {
    ...sanitizedRaw,
    ...(input.extraSafeAttrs ? sanitizeSemaProperties(input.extraSafeAttrs) : {})
  };

  // Remove chaves de documento se ainda existirem e preserva apenas metadados seguros
  const cleanOut: Record<string, any> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) continue;
    if (/^(cpf|cnpj|cpf_cnpj|cpfcnpj|nr_cpf|nr_cnpj|nr_cpf_cnpj|documento_titular)$/i.test(k)) {
      continue;
    }
    if (typeof v === 'string') {
      const stripped = stripOuterQuotesAndBrackets(v).replace(/"/g, '').trim();
      cleanOut[k] = scrubSensitiveTextForServerLog(stripped);
    } else {
      cleanOut[k] = v;
    }
  }

  const camposConsultados = Array.from(
    new Set(
      (Array.isArray(input.camposConsultados) && input.camposConsultados.length > 0
        ? input.camposConsultados
        : Object.keys(input.rawProps || {})
      )
        .map(c => String(c || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 80);

  cleanOut.doc_status = input.docStatus;
  cleanOut.visualizacao_dado_completo = Boolean(
    input.docStatus === 'completo' && auth && canViewFullSemaPersonalData(auth)
  );
  cleanOut.campos_consultados = camposConsultados;
  cleanOut.consultado_em_iso = input.consultadoEm || new Date().toISOString();
  if (auth?.login) {
    cleanOut.consultado_por_login = scrubSensitiveTextForServerLog(auth.login).slice(0, 120);
  }
  if (input.docStatus === 'completo' && input.docDigits) {
    cleanOut.doc_sha256 = sha256HexServer(input.docDigits);
  }
  return cleanOut;
}

export async function recordSemaServerAuditDetailed(
  auth: SemaAuthContext,
  target: SemaAuditTargetContext,
  input: ServerAuditItemInput
): Promise<RecordSemaAuditResult> {
  if (!auth.configured || !auth.supabaseAdmin) {
    return {
      ok: false,
      available: false,
      error: 'Serviço central de auditoria indisponível.'
    };
  }

  if (!auth.authorized || !auth.userId) {
    return {
      ok: false,
      available: false,
      error: 'Sessão não autenticada para registrar auditoria.'
    };
  }

  // Visualizador não visualiza dados pessoais completos nem grava na auditoria de alteração
  if (auth.role === 'Visualizador') {
    return {
      ok: false,
      available: true,
      error: 'Perfil Visualizador em modo somente leitura.'
    };
  }

  let criterioRef: string | null = null;
  if (input.criterioValor && String(input.criterioValor).trim()) {
    const rawRef = String(input.criterioValor).trim();
    if (input.criterioTipo === 'cpf_cnpj_hash') {
      const digits = rawRef.replace(/\D/g, '');
      criterioRef = digits ? sha256HexServer(digits) : null;
    } else {
      criterioRef = scrubSensitiveTextForServerLog(rawRef).slice(0, 160) || null;
    }
  }

  const docSha256 =
    input.docStatus === 'completo' && input.docDigits
      ? sha256HexServer(input.docDigits)
      : null;

  const safeAttrs = buildSanitizedAuditAttributes(input, auth);

  try {
    const { data, error } = await auth.supabaseAdmin.rpc('registrar_consulta_sema_auditoria', {
      p_entidade_alvo_tipo: target.entidadeAlvoTipo ?? null,
      p_entidade_alvo_id: target.entidadeAlvoId ?? null,
      p_criterio_tipo: input.criterioTipo,
      p_criterio_referencia: criterioRef,
      p_camada: input.camada,
      p_feature_id: input.featureId,
      p_car: input.car ? scrubSensitiveTextForServerLog(input.car).slice(0, 120) : null,
      p_atributos_recebidos: safeAttrs,
      p_consultado_por: auth.userId,
      p_doc_status: input.docStatus,
      p_doc_sha256: docSha256
    });

    if (error || !data) {
      return {
        ok: false,
        available: false,
        error: error?.message || 'Falha ao gravar registro de auditoria no servidor.'
      };
    }

    return {
      ok: true,
      available: true,
      auditoriaId: String(data)
    };
  } catch (err: any) {
    return {
      ok: false,
      available: false,
      error: err?.message || 'Serviço de auditoria indisponível no momento.'
    };
  }
}

export async function recordSemaServerAudit(
  auth: SemaAuthContext,
  target: SemaAuditTargetContext,
  input: ServerAuditItemInput
): Promise<string | undefined> {
  const res = await recordSemaServerAuditDetailed(auth, target, input);
  return res.auditoriaId;
}
