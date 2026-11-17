// src/server/semaAudit.ts
import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { sanitizeSemaProperties, stripOuterQuotesAndBrackets } from '../config/carCampos';

export interface SemaAuthContext {
  configured: boolean;
  authorized: boolean;
  httpStatus?: number;
  error?: string;
  userId: string | null;
  role: string | null;
  supabaseAdmin: SupabaseClient<any, any, any> | null;
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
  extraSafeAttrs?: Record<string, any>;
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

function normalizeRoleLabel(rawRole: unknown): string {
  const norm = String(rawRole || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (norm === 'administrador' || norm === 'admin') return 'Administrador';
  if (norm === 'analista') return 'Analista';
  if (norm === 'usuario') return 'Usuário';
  if (norm === 'visualizador') return 'Visualizador';
  return String(rawRole || '').trim();
}

export async function authorizeSemaLookupRequest(
  req: IncomingMessage & { headers?: Record<string, string | string[] | undefined> }
): Promise<SemaAuthContext> {
  const supabaseAdmin = getServerSupabaseAdminClient();
  if (!supabaseAdmin) {
    return {
      configured: false,
      authorized: true,
      userId: null,
      role: null,
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
      error: 'Autenticação obrigatória para consultar e auditar dados da SEMA-MT.',
      userId: null,
      role: null,
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
        error: 'Sessão inválida ou expirada. Faça login novamente.',
        userId: null,
        role: null,
        supabaseAdmin: null
      };
    }

    let profile: any = null;
    let profErr: any = null;

    const primaryRes = await supabaseAdmin
      .from('usuarios')
      .select('id, papel, situacao, status, auth_user_id')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();

    profile = primaryRes.data;
    profErr = primaryRes.error;

    // Compatibilidade com bases onde a coluna `status` ainda não foi criada
    if (profErr) {
      const fallbackColRes = await supabaseAdmin
        .from('usuarios')
        .select('id, papel, situacao, auth_user_id')
        .eq('auth_user_id', userData.user.id)
        .maybeSingle();
      profile = fallbackColRes.data;
      profErr = fallbackColRes.error;
    }

    // Fallback por e-mail institucional quando auth_user_id ainda estiver nulo no cadastro
    if (!profile && !profErr && userData.user.email) {
      const cleanEmail = String(userData.user.email).trim();
      if (cleanEmail) {
        const emailQuery = supabaseAdmin
          .from('usuarios')
          .select('id, papel, situacao, auth_user_id');
        if (typeof (emailQuery as any).ilike === 'function') {
          const byEmailRes = await (emailQuery as any).ilike('email', cleanEmail).maybeSingle();
          if (byEmailRes?.data && !byEmailRes?.error) {
            profile = byEmailRes.data;
            if (!profile.auth_user_id && profile.id) {
              try {
                await supabaseAdmin
                  .from('usuarios')
                  .update({ auth_user_id: userData.user.id, updated_at: new Date().toISOString() })
                  .eq('id', profile.id);
              } catch {
                // Vinculação automática é melhor-esforço
              }
            }
          }
        }
      }
    }

    if (profErr || !profile) {
      return {
        configured: true,
        authorized: false,
        httpStatus: 403,
        error: 'Usuário não habilitado na base institucional.',
        userId: null,
        role: null,
        supabaseAdmin: null
      };
    }

    const rawSituacao = String(profile.situacao ?? profile.status ?? '')
      .trim()
      .toLowerCase();
    const isActive = rawSituacao === 'ativo';
    const role = normalizeRoleLabel(profile.papel);
    const allowedRoles = ['Administrador', 'Analista', 'Usuário', 'Visualizador'];

    if (!isActive || !allowedRoles.includes(role)) {
      return {
        configured: true,
        authorized: false,
        httpStatus: 403,
        error: 'Perfil sem autorização para consultas SEMA-MT.',
        userId: null,
        role: null,
        supabaseAdmin: null
      };
    }

    return {
      configured: true,
      authorized: true,
      userId: String(userData.user.id),
      role,
      supabaseAdmin
    };
  } catch {
    return {
      configured: true,
      authorized: false,
      httpStatus: 500,
      error: 'Não foi possível validar a sessão institucional no servidor.',
      userId: null,
      role: null,
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

function buildSanitizedAuditAttributes(input: ServerAuditItemInput): Record<string, any> {
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

  cleanOut.doc_status = input.docStatus;
  if (input.docStatus === 'completo' && input.docDigits) {
    cleanOut.doc_sha256 = sha256HexServer(input.docDigits);
  }
  return cleanOut;
}

export async function recordSemaServerAudit(
  auth: SemaAuthContext,
  target: SemaAuditTargetContext,
  input: ServerAuditItemInput
): Promise<string | undefined> {
  if (!auth.configured || !auth.supabaseAdmin) {
    return undefined;
  }

  // Visualizador é somente leitura e não grava auditoria de alteração
  if (auth.role === 'Visualizador') {
    return undefined;
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

  const safeAttrs = buildSanitizedAuditAttributes(input);

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
    return undefined;
  }
  return String(data);
}
