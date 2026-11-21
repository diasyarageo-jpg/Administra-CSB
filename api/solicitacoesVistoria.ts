// api/solicitacoesVistoria.ts
import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  authorizeSemaLookupRequest,
  scrubSensitiveTextForServerLog,
  type SemaAuthContext
} from '../src/server/semaAudit.js';
import {
  isValidUuid,
  sanitizePendenciaTextForResponse
} from './pendencias.js';

/**
 * Variáveis de ambiente utilizadas exclusivamente no servidor:
 * - SUPABASE_URL (ou VITE_SUPABASE_URL como URL pública da base central)
 * - SUPABASE_SERVICE_ROLE_KEY (chave service_role usada apenas no servidor)
 * - SOLICITACOES_SERVICE_TOKEN (segredo compartilhado entre os servidores de
 *   Classifica, Notifica e Fiscaliza e o servidor do Administra, comparado em
 *   tempo constante via SHA-256 + crypto.timingSafeEqual)
 */
export const SOLICITACAO_ORIGENS = ['classifica', 'notifica', 'administra'] as const;
export type SolicitacaoSistemaOrigem = typeof SOLICITACAO_ORIGENS[number];
export type ChamadorSistema = SolicitacaoSistemaOrigem | 'fiscaliza';

export const SOLICITACAO_STATUS_LIST = [
  'solicitada',
  'em_planejamento',
  'realizada',
  'cancelada'
] as const;
export type SolicitacaoVistoriaStatus = typeof SOLICITACAO_STATUS_LIST[number];

export const SOLICITACAO_HISTORICO_ACOES = [
  'criacao',
  'atualizacao',
  'cancelamento',
  'conclusao',
  'edicao_observacao'
] as const;

export const ALLOWED_PRE_PREENCHIDO_KEYS = [
  'nome_barragem',
  'municipio',
  'curso_agua',
  'coordenadas',
  'uso',
  'classificacao',
  'nome_empreendedor'
] as const;

export const SOLICITACAO_RESPONSE_ALLOWLIST = [
  'id',
  'sistema_origem',
  'origem_ref_id',
  'solicitante_id',
  'solicitante_nome',
  'solicitante_perfil',
  'relato',
  'empreendedor_id',
  'barragem_id',
  'processo_referencia',
  'dados_pre_preenchidos',
  'status',
  'vistoria_id',
  'data_realizacao',
  'equipe',
  'observacao_campo',
  'observacao_atualizada_em',
  'observacao_atualizada_por',
  'created_at',
  'updated_at'
] as const;

export const SOLICITACAO_HISTORICO_RESPONSE_ALLOWLIST = [
  'id',
  'solicitacao_id',
  'acao',
  'campo',
  'valor_anterior',
  'valor_novo',
  'usuario_id',
  'motivo',
  'created_at'
] as const;

const VALID_STATUS_SET = new Set<string>(SOLICITACAO_STATUS_LIST);
const VALID_ORIGEM_SET = new Set<string>(SOLICITACAO_ORIGENS);
const VALID_PRE_PREENCHIDO_SET = new Set<string>(ALLOWED_PRE_PREENCHIDO_KEYS);
const READ_ALLOWED_ROLES = new Set<string>(['Administrador', 'Analista', 'Usuário', 'Visualizador']);
const CREATE_EDIT_ALLOWED_ROLES = new Set<string>(['Administrador', 'Analista', 'Usuário']);
const CONCLUIR_ALLOWED_ROLES = new Set<string>(['Administrador', 'Analista']);

const FORBIDDEN_DOCUMENT_AND_PAYLOAD_KEYS = new Set([
  'payload',
  'rawpayload',
  'raw',
  'propriedadesbrutas',
  'properties',
  'cpf',
  'cnpj',
  'cpfcnpj',
  'cpf_cnpj',
  'nr_cpf',
  'nr_cnpj',
  'nr_cpf_cnpj',
  'documento',
  'documento_titular',
  'sistema_origem',
  'sistemaorigem',
  'solicitante_id',
  'solicitanteid',
  'solicitante_nome',
  'solicitante_perfil',
  'usuario_id',
  'usuarioid',
  'userid',
  'role',
  'papel',
  'created_at',
  'updated_at',
  'observacao_atualizada_em',
  'observacao_atualizada_por'
]);

const CREATE_ALLOWED_BODY_KEYS = new Set([
  'action',
  'relato',
  'origem_ref_id',
  'empreendedor_id',
  'barragem_id',
  'processo_referencia',
  'dados_pre_preenchidos',
  'motivo'
]);

const EDIT_ALLOWED_BODY_KEYS = new Set([
  'action',
  'id',
  'solicitacaoId',
  'relato',
  'origem_ref_id',
  'empreendedor_id',
  'barragem_id',
  'processo_referencia',
  'dados_pre_preenchidos',
  'status',
  'motivo'
]);

const CONCLUIR_ALLOWED_BODY_KEYS = new Set([
  'id',
  'solicitacaoId',
  'vistoria_id',
  'data_realizacao',
  'equipe',
  'observacao_campo'
]);

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const UUID_EXACT_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sendJson(
  res: ServerResponse & { status?: any; json?: any },
  status: number,
  payload: unknown
) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(payload);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function getHeaderValue(
  req: IncomingMessage & { headers?: Record<string, string | string[] | undefined> },
  name: string
): string {
  const headers = req.headers || {};
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      return Array.isArray(v) ? String(v[0] || '').trim() : String(v || '').trim();
    }
  }
  return '';
}

async function readJsonBody(
  req: IncomingMessage & { body?: any }
): Promise<Record<string, any> | null> {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body as Record<string, any>;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      const parsed = JSON.parse(req.body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof (req as any).on !== 'function') {
    return null;
  }

  return new Promise(resolve => {
    let raw = '';
    let settled = false;
    const finish = (val: Record<string, any> | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    (req as any).on('data', (chunk: Buffer | string) => {
      raw += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (raw.length > 131_072) {
        finish(null);
      }
    });
    (req as any).on('end', () => {
      if (!raw.trim()) {
        finish({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        finish(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null);
      } catch {
        finish(null);
      }
    });
    (req as any).on('error', () => finish(null));
  });
}

function getQueryParams(
  req: IncomingMessage & {
    url?: string;
    originalUrl?: string;
    query?: Record<string, string | string[] | undefined>;
  }
): URLSearchParams {
  const params = new URLSearchParams();
  const rawUrl = req.originalUrl || req.url;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl, 'http://localhost');
      parsed.searchParams.forEach((v, k) => params.set(k, v));
    } catch {
      // Ignora URL malformada
    }
  }
  if (req.query && typeof req.query === 'object') {
    for (const [k, v] of Object.entries(req.query)) {
      if (v === undefined) continue;
      params.set(k, Array.isArray(v) ? String(v[0] || '') : String(v));
    }
  }
  return params;
}

type ParsedRoute =
  | { kind: 'collection'; pathId: null }
  | { kind: 'item'; pathId: string }
  | { kind: 'concluir'; pathId: string | null }
  | { kind: 'observacao'; pathId: string | null }
  | { kind: 'cancelar'; pathId: string | null }
  | { kind: 'unknown'; pathId: null };

function parseSolicitacoesRoute(
  req: IncomingMessage & {
    url?: string;
    originalUrl?: string;
    query?: Record<string, string | string[] | undefined>;
  }
): ParsedRoute {
  const rawUrl = String(req.originalUrl || req.url || '/api/solicitacoes-vistoria');
  let pathname = rawUrl.split('?')[0] || '/';
  try {
    if (/^https?:\/\//i.test(pathname)) {
      pathname = new URL(pathname).pathname;
    }
  } catch {
    // Mantém pathname original
  }

  pathname = pathname.replace(/^\/api\/(?:solicitacoes-vistoria|solicitacoesVistoria)\/?/i, '');
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    const query = getQueryParams(req);
    const action = String(query.get('action') || '').trim().toLowerCase();
    if (action === 'concluir') return { kind: 'concluir', pathId: null };
    if (action === 'observacao') return { kind: 'observacao', pathId: null };
    if (action === 'cancelar') return { kind: 'cancelar', pathId: null };
    return { kind: 'collection', pathId: null };
  }
  if (segments.length === 1) {
    const seg = segments[0].toLowerCase();
    if (seg === 'concluir') return { kind: 'concluir', pathId: null };
    if (seg === 'observacao') return { kind: 'observacao', pathId: null };
    if (seg === 'cancelar') return { kind: 'cancelar', pathId: null };
    return { kind: 'item', pathId: segments[0] };
  }
  if (segments.length === 2) {
    const idSeg = segments[0];
    const actionSeg = segments[1].toLowerCase();
    if (actionSeg === 'concluir') return { kind: 'concluir', pathId: idSeg };
    if (actionSeg === 'observacao') return { kind: 'observacao', pathId: idSeg };
    if (actionSeg === 'cancelar') return { kind: 'cancelar', pathId: idSeg };
  }
  return { kind: 'unknown', pathId: null };
}

export function constantTimeTokenEquals(expected: string, provided: string): boolean {
  if (!expected || !provided) return false;
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  const providedDigest = crypto.createHash('sha256').update(provided, 'utf8').digest();
  return crypto.timingSafeEqual(expectedDigest, providedDigest);
}

interface CallingSystemContext {
  ok: boolean;
  httpStatus?: number;
  error?: string;
  sistema: ChamadorSistema;
  serviceAuthenticated: boolean;
}

function resolveCallingSystemContext(
  req: IncomingMessage & { headers?: Record<string, string | string[] | undefined> }
): CallingSystemContext {
  const providedToken =
    getHeaderValue(req, 'x-solicitacoes-service-token') ||
    getHeaderValue(req, 'x-service-token');
  const rawOrigemHeader = getHeaderValue(req, 'x-sistema-origem').toLowerCase();
  const configuredToken = String(process.env.SOLICITACOES_SERVICE_TOKEN || '').trim();

  if (providedToken) {
    if (!configuredToken || !constantTimeTokenEquals(configuredToken, providedToken)) {
      return {
        ok: false,
        httpStatus: 401,
        error: 'Segredo de serviço (SOLICITACOES_SERVICE_TOKEN) inválido ou não configurado.',
        sistema: 'administra',
        serviceAuthenticated: false
      };
    }

    if (!rawOrigemHeader || rawOrigemHeader === 'administra') {
      return { ok: true, sistema: 'administra', serviceAuthenticated: true };
    }
    if (
      rawOrigemHeader === 'classifica' ||
      rawOrigemHeader === 'notifica' ||
      rawOrigemHeader === 'fiscaliza'
    ) {
      return {
        ok: true,
        sistema: rawOrigemHeader,
        serviceAuthenticated: true
      };
    }
    return {
      ok: false,
      httpStatus: 400,
      error: 'Cabeçalho x-sistema-origem inválido.',
      sistema: 'administra',
      serviceAuthenticated: false
    };
  }

  if (rawOrigemHeader && rawOrigemHeader !== 'administra') {
    return {
      ok: false,
      httpStatus: 403,
      error:
        'Chamadas entre sistemas exigem o segredo de serviço (SOLICITACOES_SERVICE_TOKEN) autenticado pelo servidor.',
      sistema: 'administra',
      serviceAuthenticated: false
    };
  }

  return { ok: true, sistema: 'administra', serviceAuthenticated: false };
}

export function hasSensitiveCpfOrCnpj(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false;
  const text = String(raw);
  if (!text.trim()) return false;
  if (UUID_EXACT_REGEX.test(text.trim())) return false;
  const sanitized = sanitizePendenciaTextForResponse(text);
  return sanitized !== text;
}

function maskEmailForNonAdmin(text: string, isAdmin: boolean): string {
  if (!text || isAdmin) return text;
  return text.replace(EMAIL_PATTERN, match => {
    const atIdx = match.indexOf('@');
    const local = atIdx > 0 ? match.slice(0, atIdx) : '';
    const prefix = local.slice(0, 2) || 'u';
    return `${prefix}***`;
  });
}

function sanitizeTextOutput(raw: unknown, isAdmin: boolean): string | null {
  if (raw === undefined || raw === null) return null;
  const scrubbed = sanitizePendenciaTextForResponse(String(raw));
  if (scrubbed === null) return null;
  return maskEmailForNonAdmin(scrubbed, isAdmin);
}

function sanitizeDadosPrePreenchidosOutput(
  raw: unknown,
  isAdmin: boolean
): Record<string, string | number | boolean | null> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const key of ALLOWED_PRE_PREENCHIDO_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const val = (raw as Record<string, unknown>)[key];
    if (val === undefined) continue;
    if (val === null) {
      out[key] = null;
    } else if (typeof val === 'boolean') {
      out[key] = val;
    } else if (typeof val === 'number') {
      const str = String(val);
      const safe = sanitizeTextOutput(str, isAdmin);
      out[key] = safe !== str ? safe : val;
    } else if (typeof val === 'string') {
      out[key] = sanitizeTextOutput(val, isAdmin);
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeEquipeOutput(
  raw: unknown,
  isAdmin: boolean
): Array<{ id: string; nome: string }> | null {
  if (!Array.isArray(raw)) return null;
  const list: Array<{ id: string; nome: string }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const rawId = obj.id !== undefined && obj.id !== null ? String(obj.id).trim() : '';
    const rawNome = obj.nome !== undefined && obj.nome !== null ? String(obj.nome).trim() : '';
    if (!rawId && !rawNome) continue;
    const safeId = sanitizeTextOutput(rawId, isAdmin) || '';
    const safeNome = sanitizeTextOutput(rawNome, isAdmin) || 'Integrante';
    list.push({ id: safeId, nome: safeNome });
  }
  return list;
}

export function sanitizeSolicitacaoRecordForResponse<T extends Record<string, any>>(
  row: T,
  isAdmin = false
): Record<string, any> {
  if (!row || typeof row !== 'object') return {};
  const out: Record<string, any> = {};
  for (const key of SOLICITACAO_RESPONSE_ALLOWLIST) {
    if (!Object.prototype.hasOwnProperty.call(row, key) || row[key] === undefined) {
      continue;
    }
    const val = row[key];
    if (key === 'dados_pre_preenchidos') {
      out[key] = sanitizeDadosPrePreenchidosOutput(val, isAdmin);
    } else if (key === 'equipe') {
      out[key] = sanitizeEquipeOutput(val, isAdmin);
    } else if (val === null) {
      out[key] = null;
    } else if (val instanceof Date) {
      out[key] = Number.isNaN(val.getTime()) ? null : val.toISOString();
    } else {
      out[key] = sanitizeTextOutput(val, isAdmin);
    }
  }
  return out;
}

export function sanitizeSolicitacaoHistoricoForResponse<T extends Record<string, any>>(
  row: T,
  isAdmin = false
): Record<string, any> {
  if (!row || typeof row !== 'object') return {};
  const out: Record<string, any> = {};
  for (const key of SOLICITACAO_HISTORICO_RESPONSE_ALLOWLIST) {
    if (!Object.prototype.hasOwnProperty.call(row, key) || row[key] === undefined) {
      continue;
    }
    const val = row[key];
    if (val === null) {
      out[key] = null;
    } else if (val instanceof Date) {
      out[key] = Number.isNaN(val.getTime()) ? null : val.toISOString();
    } else {
      out[key] = sanitizeTextOutput(val, isAdmin);
    }
  }
  return out;
}

function isSameCanonicalUser(a: unknown, b: unknown): boolean {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  return Boolean(left && right && left === right);
}

interface UsuarioRow {
  id: string;
  auth_user_id?: string | null;
  nome?: string | null;
  login?: string | null;
  email?: string | null;
  papel?: string | null;
  setor?: string | null;
  situacao?: string | null;
  status?: string | null;
}

async function fetchUsuariosDirectory(
  supabaseAdmin: NonNullable<SemaAuthContext['supabaseAdmin']>
): Promise<UsuarioRow[]> {
  const primary = await supabaseAdmin
    .from('usuarios')
    .select('id, auth_user_id, nome, login, email, papel, setor, situacao, status');

  if (!primary.error && Array.isArray(primary.data)) {
    return primary.data as UsuarioRow[];
  }

  const fallback = await supabaseAdmin
    .from('usuarios')
    .select('id, auth_user_id, nome, login, papel, situacao');

  if (!fallback.error && Array.isArray(fallback.data)) {
    return fallback.data as UsuarioRow[];
  }

  return [];
}

function formatSafeUsuarioLabel(u: UsuarioRow, isAdmin: boolean): string {
  const nome = String(u.nome || '').trim();
  if (nome && (isAdmin || !nome.includes('@'))) {
    return sanitizePendenciaTextForResponse(nome) || 'Usuário cadastrado';
  }
  const login = String(u.login || '').trim();
  if (login && (isAdmin || !login.includes('@'))) {
    return sanitizePendenciaTextForResponse(login) || 'Usuário cadastrado';
  }
  return 'Usuário cadastrado';
}

function buildUsuariosNomesMap(
  usuarios: UsuarioRow[],
  isAdmin: boolean
): Record<string, { id: string; nome: string; setor?: string; papel?: string }> {
  const map: Record<string, { id: string; nome: string; setor?: string; papel?: string }> = {};
  for (const u of usuarios) {
    if (!u.auth_user_id || !isValidUuid(u.auth_user_id)) continue;
    const canonicalId = String(u.auth_user_id);
    map[canonicalId] = {
      id: canonicalId,
      nome: formatSafeUsuarioLabel(u, isAdmin),
      ...(u.setor ? { setor: sanitizePendenciaTextForResponse(u.setor) || '' } : {}),
      ...(u.papel ? { papel: sanitizePendenciaTextForResponse(u.papel) || '' } : {})
    };
  }
  return map;
}

export function isUserInEquipe(
  equipe: unknown,
  authCtx: SemaAuthContext,
  usuarios: UsuarioRow[] = []
): boolean {
  if (!Array.isArray(equipe) || equipe.length === 0) return false;
  const userIds = new Set<string>();
  const userEmailsOrLogins = new Set<string>();

  if (authCtx.userId) userIds.add(String(authCtx.userId).trim().toLowerCase());
  if (authCtx.login) {
    const normLogin = String(authCtx.login).trim().toLowerCase();
    userEmailsOrLogins.add(normLogin);
  }

  const dirUser = usuarios.find(u => isSameCanonicalUser(u.auth_user_id, authCtx.userId));
  if (dirUser) {
    if (dirUser.id) userIds.add(String(dirUser.id).trim().toLowerCase());
    if (dirUser.auth_user_id) userIds.add(String(dirUser.auth_user_id).trim().toLowerCase());
    if (dirUser.email) userEmailsOrLogins.add(String(dirUser.email).trim().toLowerCase());
    if (dirUser.login) userEmailsOrLogins.add(String(dirUser.login).trim().toLowerCase());
  }

  for (const member of equipe) {
    if (!member) continue;
    if (typeof member === 'string') {
      const mNorm = member.trim().toLowerCase();
      if (userIds.has(mNorm) || userEmailsOrLogins.has(mNorm)) return true;
      continue;
    }
    if (typeof member === 'object' && !Array.isArray(member)) {
      const obj = member as Record<string, unknown>;
      for (const candidateKey of ['id', 'auth_user_id', 'usuario_id', 'email', 'login']) {
        const val = obj[candidateKey];
        if (typeof val !== 'string' || !val.trim()) continue;
        const norm = val.trim().toLowerCase();
        if (userIds.has(norm) || userEmailsOrLogins.has(norm)) {
          return true;
        }
      }
    }
  }
  return false;
}

function validateAndSanitizeDadosPrePreenchidos(
  raw: unknown
): { ok: true; value: Record<string, string | number | boolean | null> | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error: 'dados_pre_preenchidos deve ser um objeto JSON apenas com os campos cadastrais permitidos.'
    };
  }

  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_PRE_PREENCHIDO_SET.has(key)) {
      return {
        ok: false,
        error: `Campo "${key}" não é permitido em dados_pre_preenchidos (nunca envie documentos pessoais).`
      };
    }
    if (val !== null && typeof val === 'object') {
      return {
        ok: false,
        error: `Não é permitido enviar objetos aninhados em dados_pre_preenchidos.${key}.`
      };
    }
    if (val === undefined) continue;
    if (val === null) {
      out[key] = null;
      continue;
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (hasSensitiveCpfOrCnpj(trimmed)) {
        return {
          ok: false,
          error: 'Não é permitido enviar CPF/CNPJ nos dados pré-preenchidos.'
        };
      }
      if (trimmed.length > 300) {
        return {
          ok: false,
          error: `Campo dados_pre_preenchidos.${key} excede o limite de 300 caracteres.`
        };
      }
      out[key] = trimmed || null;
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      if (hasSensitiveCpfOrCnpj(String(val))) {
        return {
          ok: false,
          error: 'Não é permitido enviar CPF/CNPJ nos dados pré-preenchidos.'
        };
      }
      out[key] = val;
    } else {
      return {
        ok: false,
        error: `Tipo inválido em dados_pre_preenchidos.${key}.`
      };
    }
  }

  return { ok: true, value: Object.keys(out).length > 0 ? out : null };
}

function validateBodyAllowlistAndSafety(
  body: Record<string, any>,
  allowedKeys: Set<string>,
  objectFieldsAllowed: Set<string> = new Set()
): string | null {
  for (const key of Object.keys(body)) {
    const norm = key.toLowerCase();
    if (FORBIDDEN_DOCUMENT_AND_PAYLOAD_KEYS.has(norm) && !allowedKeys.has(key)) {
      return `Campo não permitido no corpo da requisição ("${key}").`;
    }
    if (!allowedKeys.has(key)) {
      return `Campo não permitido no corpo da requisição ("${key}").`;
    }
    const val = body[key];
    if (val !== null && typeof val === 'object' && !objectFieldsAllowed.has(key)) {
      return `Não é permitido enviar payloads ou objetos JSON copiados em "${key}".`;
    }
  }
  return null;
}

export function isMissingDatabaseFunctionError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || err.details || err.hint || '').toLowerCase();
  if (code === '42883' || code === 'PGRST202' || code === 'PGRST204') return true;
  if (
    msg.includes('could not find the function') ||
    (msg.includes('function') && msg.includes('does not exist')) ||
    (msg.includes('função') && msg.includes('não existe')) ||
    msg.includes('inexistente') ||
    msg.includes('schema cache')
  ) {
    return true;
  }
  return false;
}

export function isMissingDatabaseTableError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || err.details || err.hint || '').toLowerCase();
  if (code === '42P01' || code === 'PGRST205') return true;
  if (
    msg.includes('could not find the table') ||
    (msg.includes('relation') && msg.includes('does not exist')) ||
    (msg.includes('tabela') && msg.includes('não existe'))
  ) {
    return true;
  }
  return false;
}

async function invokeTransactionalRpc(
  supabaseAdmin: NonNullable<SemaAuthContext['supabaseAdmin']>,
  fnName: string,
  params: Record<string, any>,
  isAdmin: boolean
): Promise<{ status: number; body: Record<string, any> }> {
  if (typeof (supabaseAdmin as any).rpc !== 'function') {
    return {
      status: 409,
      body: {
        success: false,
        code: 'DB_FUNCTION_NOT_AVAILABLE',
        error:
          `Mutações em solicitações de vistoria estão bloqueadas (HTTP 409) porque a função "${fnName}" ainda não existe no banco de dados. Nenhuma alteração foi gravada.`
      }
    };
  }

  const { data, error } = await (supabaseAdmin as any).rpc(fnName, params);
  if (error) {
    if (isMissingDatabaseFunctionError(error)) {
      return {
        status: 409,
        body: {
          success: false,
          code: 'DB_FUNCTION_NOT_AVAILABLE',
          error:
            `Mutações em solicitações de vistoria estão bloqueadas (HTTP 409) enquanto a função "${fnName}" não existir no banco de dados. Nenhuma alteração foi gravada.`
        }
      };
    }
    return {
      status: 400,
      body: {
        success: false,
        error: scrubSensitiveTextForServerLog(
          error.message || `Falha ao executar ${fnName}.`
        )
      }
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: fnName === 'criar_solicitacao_vistoria' ? 201 : 200,
    body: {
      success: true,
      solicitacao: row ? sanitizeSolicitacaoRecordForResponse(row, isAdmin) : null
    }
  };
}

function normalizeOptionalRef(val: unknown, maxLen: number): string | null {
  if (val === undefined || val === null) return null;
  const trimmed = String(val).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

export default async function solicitacoesVistoriaHandler(
  req: IncomingMessage & {
    body?: any;
    method?: string;
    url?: string;
    originalUrl?: string;
    query?: Record<string, string | string[] | undefined>;
    headers?: Record<string, string | string[] | undefined>;
  },
  res: ServerResponse & { status?: any; json?: any }
) {
  try {
    return await solicitacoesVistoriaHandlerInner(req, res);
  } catch (err: any) {
    if (!res.headersSent) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          err?.message || 'Erro interno no servidor de solicitações de vistoria.'
        )
      });
    }
  }
}

async function solicitacoesVistoriaHandlerInner(
  req: IncomingMessage & {
    body?: any;
    method?: string;
    url?: string;
    originalUrl?: string;
    query?: Record<string, string | string[] | undefined>;
    headers?: Record<string, string | string[] | undefined>;
  },
  res: ServerResponse & { status?: any; json?: any }
) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') {
    return sendJson(res, 405, {
      success: false,
      error: 'Método não permitido. Utilize GET, POST ou PATCH.'
    });
  }

  const route = parseSolicitacoesRoute(req);
  if (route.kind === 'unknown') {
    return sendJson(res, 404, {
      success: false,
      error: 'Rota de solicitações de vistoria não encontrada.'
    });
  }

  if (route.pathId && !isValidUuid(route.pathId)) {
    return sendJson(res, 400, {
      success: false,
      error: 'Identificador da solicitação deve ser um UUID válido.'
    });
  }

  const authCtx = await authorizeSemaLookupRequest(req);
  if (!authCtx.configured) {
    return sendJson(res, 503, {
      success: false,
      error: 'Serviço central indisponível no servidor.'
    });
  }

  if (!authCtx.authorized || !authCtx.userId || !isValidUuid(authCtx.userId)) {
    return sendJson(res, authCtx.httpStatus || 401, {
      success: false,
      error: authCtx.error || 'Sessão institucional ausente ou inválida.'
    });
  }

  if (!authCtx.supabaseAdmin) {
    return sendJson(res, 503, {
      success: false,
      error: 'Serviço central indisponível no servidor.'
    });
  }

  const callingSystem = resolveCallingSystemContext(req);
  if (!callingSystem.ok) {
    return sendJson(res, callingSystem.httpStatus || 403, {
      success: false,
      error: callingSystem.error || 'Acesso entre sistemas não autorizado.'
    });
  }

  if (!READ_ALLOWED_ROLES.has(authCtx.role || '')) {
    return sendJson(res, 403, {
      success: false,
      error: 'Perfil sem permissão para acessar solicitações de vistoria.'
    });
  }

  const supabaseAdmin = authCtx.supabaseAdmin;
  const canonicalUserId = String(authCtx.userId);
  const isAdmin = authCtx.role === 'Administrador';

  const safeCurrentUserName = (() => {
    if (authCtx.userName && (isAdmin || !authCtx.userName.includes('@'))) {
      return sanitizePendenciaTextForResponse(authCtx.userName) || 'Usuário autenticado';
    }
    if (authCtx.login && (isAdmin || !authCtx.login.includes('@'))) {
      return sanitizePendenciaTextForResponse(authCtx.login) || 'Usuário autenticado';
    }
    return 'Usuário autenticado';
  })();

  // ==================== GET /api/solicitacoes-vistoria ====================
  if (method === 'GET') {
    if (route.kind !== 'collection' && route.kind !== 'item') {
      return sendJson(res, 405, {
        success: false,
        error: 'Método GET não suportado para esta sub-rota.'
      });
    }

    const query = getQueryParams(req);
    const statusFiltro = String(query.get('status') || '').trim().toLowerCase();
    const origemFiltro = String(query.get('sistema_origem') || '').trim().toLowerCase();
    const solicitacaoId = route.pathId || String(query.get('solicitacaoId') || query.get('id') || '').trim();

    if (statusFiltro && statusFiltro !== 'todos' && !VALID_STATUS_SET.has(statusFiltro)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Status de filtro inválido.'
      });
    }

    if (origemFiltro && origemFiltro !== 'todos' && !VALID_ORIGEM_SET.has(origemFiltro)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Sistema de origem de filtro inválido.'
      });
    }

    if (solicitacaoId && !isValidUuid(solicitacaoId)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Identificador da solicitação inválido.'
      });
    }

    try {
      const usuarios = await fetchUsuariosDirectory(supabaseAdmin);
      const usuariosNomes = buildUsuariosNomesMap(usuarios, isAdmin);

      if (solicitacaoId) {
        const { data: item, error: itemErr } = await supabaseAdmin
          .from('solicitacoes_vistoria')
          .select('*')
          .eq('id', solicitacaoId)
          .maybeSingle();

        if (itemErr) {
          if (isMissingDatabaseTableError(itemErr)) {
            return sendJson(res, 503, {
              success: false,
              code: 'DB_TABLE_NOT_AVAILABLE',
              error:
                'Módulo de solicitações de vistoria aguardando criação das tabelas no banco de dados.'
            });
          }
          return sendJson(res, 500, {
            success: false,
            error: scrubSensitiveTextForServerLog(
              `Erro ao consultar solicitação de vistoria: ${itemErr.message}`
            )
          });
        }

        if (!item) {
          return sendJson(res, 404, {
            success: false,
            error: 'Solicitação de vistoria não encontrada.'
          });
        }

        const { data: histRows, error: histErr } = await supabaseAdmin
          .from('solicitacoes_vistoria_historico')
          .select('id, solicitacao_id, acao, campo, valor_anterior, valor_novo, usuario_id, motivo, created_at')
          .eq('solicitacao_id', solicitacaoId)
          .order('created_at', { ascending: false });

        if (histErr) {
          if (isMissingDatabaseTableError(histErr)) {
            return sendJson(res, 503, {
              success: false,
              code: 'DB_TABLE_NOT_AVAILABLE',
              error:
                'Tabela de histórico de solicitações ainda não foi criada no banco de dados.'
            });
          }
          return sendJson(res, 500, {
            success: false,
            error: scrubSensitiveTextForServerLog(
              `Erro ao consultar histórico da solicitação: ${histErr.message}`
            )
          });
        }

        return sendJson(res, 200, {
          success: true,
          solicitacao: sanitizeSolicitacaoRecordForResponse(item, isAdmin),
          historico: (Array.isArray(histRows) ? histRows : []).map(h =>
            sanitizeSolicitacaoHistoricoForResponse(h, isAdmin)
          ),
          usuariosNomes
        });
      }

      const { data: allRows, error: listErr } = await supabaseAdmin
        .from('solicitacoes_vistoria')
        .select('*')
        .order('updated_at', { ascending: false });

      if (listErr) {
        if (isMissingDatabaseTableError(listErr)) {
          return sendJson(res, 503, {
            success: false,
            code: 'DB_TABLE_NOT_AVAILABLE',
            error:
              'Módulo de solicitações de vistoria aguardando criação das tabelas no banco de dados.'
          });
        }
        return sendJson(res, 500, {
          success: false,
          error: scrubSensitiveTextForServerLog(
            `Erro ao carregar solicitações de vistoria: ${listErr.message}`
          )
        });
      }

      const rows = Array.isArray(allRows) ? allRows : [];
      const filteredRows = rows.filter(r => {
        if (statusFiltro && statusFiltro !== 'todos') {
          if (String(r.status || '').toLowerCase() !== statusFiltro) return false;
        }
        if (origemFiltro && origemFiltro !== 'todos') {
          if (String(r.sistema_origem || '').toLowerCase() !== origemFiltro) return false;
        }
        return true;
      });

      const currentUserObj = usuarios.find(u => isSameCanonicalUser(u.auth_user_id, canonicalUserId));

      return sendJson(res, 200, {
        success: true,
        role: authCtx.role,
        currentUser: {
          userId: canonicalUserId,
          nome: safeCurrentUserName,
          ...(isAdmin && (currentUserObj?.email || authCtx.login)
            ? { email: currentUserObj?.email || authCtx.login }
            : {})
        },
        counts: {
          total: rows.length,
          solicitada: rows.filter(r => r.status === 'solicitada').length,
          em_planejamento: rows.filter(r => r.status === 'em_planejamento').length,
          realizada: rows.filter(r => r.status === 'realizada').length,
          cancelada: rows.filter(r => r.status === 'cancelada').length
        },
        solicitacoes: filteredRows.map(r => sanitizeSolicitacaoRecordForResponse(r, isAdmin)),
        usuariosNomes
      });
    } catch (err: any) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          err?.message || 'Erro interno ao consultar solicitações de vistoria.'
        )
      });
    }
  }

  // ==================== LEITURA DO CORPO PARA POST / PATCH ====================
  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    return sendJson(res, 400, {
      success: false,
      error: 'Corpo JSON inválido.'
    });
  }

  const query = getQueryParams(req);
  const resolvedId =
    route.pathId ||
    normalizeOptionalRef(body.id ?? body.solicitacaoId ?? query.get('id') ?? query.get('solicitacaoId'), 120);

  // ==================== SUB-ROTA: PATCH .../observacao ====================
  if (route.kind === 'observacao') {
    if (method !== 'PATCH') {
      return sendJson(res, 405, {
        success: false,
        error: 'Utilize PATCH para editar a observação de campo.'
      });
    }

    if (authCtx.role === 'Visualizador') {
      return sendJson(res, 403, {
        success: false,
        error: 'Perfil Visualizador não possui permissão para alterar observações.'
      });
    }

    if (!resolvedId || !isValidUuid(resolvedId)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Identificador da solicitação deve ser um UUID válido.'
      });
    }

    // Rejeita qualquer campo diferente de `observacao_campo`
    const bodyKeys = Object.keys(body);
    if (bodyKeys.length === 0 || bodyKeys.some(k => k !== 'observacao_campo')) {
      return sendJson(res, 400, {
        success: false,
        error: 'Esta rota aceita exclusivamente o campo "observacao_campo".'
      });
    }

    if (typeof body.observacao_campo !== 'string') {
      return sendJson(res, 400, {
        success: false,
        error: 'O campo "observacao_campo" deve ser textual.'
      });
    }

    const texto = body.observacao_campo.trim();
    if (!texto || texto.length > 1000) {
      return sendJson(res, 400, {
        success: false,
        error: 'A observação de campo deve ter entre 1 e 1000 caracteres.'
      });
    }

    if (hasSensitiveCpfOrCnpj(texto)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Não é permitido gravar CPF/CNPJ na observação de campo.'
      });
    }

    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('solicitacoes_vistoria')
      .select('*')
      .eq('id', resolvedId)
      .maybeSingle();

    if (fetchErr) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Erro ao localizar solicitação de vistoria: ${fetchErr.message}`
        )
      });
    }

    if (!current) {
      return sendJson(res, 404, {
        success: false,
        error: 'Solicitação de vistoria não encontrada.'
      });
    }

    if (current.status === 'cancelada') {
      return sendJson(res, 400, {
        success: false,
        error: 'Não é possível editar observação de uma solicitação cancelada.'
      });
    }

    const usuarios = await fetchUsuariosDirectory(supabaseAdmin);
    const isTeamMember = isUserInEquipe(current.equipe, authCtx, usuarios);
    if (!isAdmin && !isTeamMember) {
      return sendJson(res, 403, {
        success: false,
        error:
          'Apenas integrantes da equipe da vistoria ou Administradores podem editar a observação de campo.'
      });
    }

    const rpcResult = await invokeTransactionalRpc(
      supabaseAdmin,
      'editar_observacao_campo',
      {
        p_id: resolvedId,
        p_texto: texto,
        p_usuario_id: canonicalUserId
      },
      isAdmin
    );
    return sendJson(res, rpcResult.status, rpcResult.body);
  }

  // ==================== SUB-ROTA: POST .../concluir ====================
  if (route.kind === 'concluir') {
    if (method !== 'POST') {
      return sendJson(res, 405, {
        success: false,
        error: 'Utilize POST para concluir a solicitação de vistoria.'
      });
    }

    if (!CONCLUIR_ALLOWED_ROLES.has(authCtx.role || '')) {
      return sendJson(res, 403, {
        success: false,
        error: 'Apenas Administrador ou Analista podem concluir solicitações de vistoria.'
      });
    }

    if (!resolvedId || !isValidUuid(resolvedId)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Identificador da solicitação deve ser um UUID válido.'
      });
    }

    const safetyErr = validateBodyAllowlistAndSafety(
      body,
      CONCLUIR_ALLOWED_BODY_KEYS,
      new Set(['equipe'])
    );
    if (safetyErr) {
      return sendJson(res, 400, { success: false, error: safetyErr });
    }

    const vistoriaId = normalizeOptionalRef(body.vistoria_id, 120);
    if (!vistoriaId || hasSensitiveCpfOrCnpj(vistoriaId)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Informe um vistoria_id válido e sem CPF/CNPJ.'
      });
    }

    const dataRealizacaoRaw = String(body.data_realizacao || '').trim();
    const parsedDate = dataRealizacaoRaw ? new Date(dataRealizacaoRaw) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
      return sendJson(res, 400, {
        success: false,
        error: 'Informe uma data_realizacao válida em formato ISO.'
      });
    }

    if (!Array.isArray(body.equipe) || body.equipe.length === 0) {
      return sendJson(res, 400, {
        success: false,
        error: 'Informe a equipe como lista não vazia de integrantes {id, nome}.'
      });
    }

    const cleanEquipe: Array<{ id: string; nome: string }> = [];
    for (const member of body.equipe) {
      if (!member || typeof member !== 'object' || Array.isArray(member)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Cada integrante da equipe deve ser um objeto {id, nome}.'
        });
      }
      const memberKeys = Object.keys(member);
      if (memberKeys.some(k => k !== 'id' && k !== 'nome')) {
        return sendJson(res, 400, {
          success: false,
          error: 'Cada integrante da equipe deve conter apenas id e nome.'
        });
      }
      const mId = String(member.id || '').trim();
      const mNome = String(member.nome || '').trim();
      if (!mId || !mNome) {
        return sendJson(res, 400, {
          success: false,
          error: 'Cada integrante da equipe deve conter id e nome válidos.'
        });
      }
      if (hasSensitiveCpfOrCnpj(mId) || hasSensitiveCpfOrCnpj(mNome)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Não é permitido informar CPF/CNPJ nos integrantes da equipe.'
        });
      }
      cleanEquipe.push({ id: mId.slice(0, 120), nome: mNome.slice(0, 200) });
    }

    let observacaoCampo: string | null = null;
    if (body.observacao_campo !== undefined && body.observacao_campo !== null) {
      if (typeof body.observacao_campo !== 'string') {
        return sendJson(res, 400, {
          success: false,
          error: 'observacao_campo deve ser textual.'
        });
      }
      const obsTrimmed = body.observacao_campo.trim();
      if (obsTrimmed.length > 1000) {
        return sendJson(res, 400, {
          success: false,
          error: 'A observação de campo não pode ultrapassar 1000 caracteres.'
        });
      }
      if (hasSensitiveCpfOrCnpj(obsTrimmed)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Não é permitido gravar CPF/CNPJ na observação de campo.'
        });
      }
      observacaoCampo = obsTrimmed || null;
    }

    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('solicitacoes_vistoria')
      .select('*')
      .eq('id', resolvedId)
      .maybeSingle();

    if (fetchErr) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Erro ao localizar solicitação de vistoria: ${fetchErr.message}`
        )
      });
    }

    if (!current) {
      return sendJson(res, 404, {
        success: false,
        error: 'Solicitação de vistoria não encontrada.'
      });
    }

    if (current.status === 'cancelada') {
      return sendJson(res, 400, {
        success: false,
        error: 'Não é possível concluir uma solicitação cancelada.'
      });
    }

    const rpcResult = await invokeTransactionalRpc(
      supabaseAdmin,
      'concluir_solicitacao_vistoria',
      {
        p_id: resolvedId,
        p_vistoria_id: vistoriaId,
        p_data_realizacao: parsedDate.toISOString(),
        p_equipe: cleanEquipe,
        p_observacao_campo: observacaoCampo,
        p_usuario_id: canonicalUserId
      },
      isAdmin
    );
    return sendJson(res, rpcResult.status, rpcResult.body);
  }

  // ==================== CRIAÇÃO, EDIÇÃO E CANCELAMENTO ====================
  if (!CREATE_EDIT_ALLOWED_ROLES.has(authCtx.role || '')) {
    return sendJson(res, 403, {
      success: false,
      error: 'Perfil Visualizador não possui permissão para criar ou alterar solicitações de vistoria.'
    });
  }

  const bodyAction = String(body.action || '').trim().toLowerCase();
  const isCancelRequest =
    route.kind === 'cancelar' || bodyAction === 'cancelar';
  const isCreateRequest =
    method === 'POST' && route.kind === 'collection' && !isCancelRequest;

  if (isCreateRequest) {
    if (callingSystem.sistema === 'fiscaliza') {
      return sendJson(res, 403, {
        success: false,
        error: 'Sistema chamador não autorizado a abrir novas solicitações nesta origem.'
      });
    }

    const safetyErr = validateBodyAllowlistAndSafety(
      body,
      CREATE_ALLOWED_BODY_KEYS,
      new Set(['dados_pre_preenchidos'])
    );
    if (safetyErr) {
      return sendJson(res, 400, { success: false, error: safetyErr });
    }

    if (typeof body.relato !== 'string') {
      return sendJson(res, 400, {
        success: false,
        error: 'O campo "relato" é obrigatório e deve ser textual.'
      });
    }

    const relato = body.relato.trim();
    if (relato.length < 3 || relato.length > 1000) {
      return sendJson(res, 400, {
        success: false,
        error: 'O relato deve ter entre 3 e 1000 caracteres.'
      });
    }

    const origemRefId = normalizeOptionalRef(body.origem_ref_id, 120);
    const empreendedorId = normalizeOptionalRef(body.empreendedor_id, 120);
    const barragemId = normalizeOptionalRef(body.barragem_id, 120);
    const processoRef = normalizeOptionalRef(body.processo_referencia, 120);
    const motivo = normalizeOptionalRef(body.motivo, 500);

    for (const val of [relato, origemRefId, empreendedorId, barragemId, processoRef, motivo]) {
      if (val && hasSensitiveCpfOrCnpj(val)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Não é permitido gravar CPF/CNPJ em solicitações de vistoria. Utilize apenas IDs.'
        });
      }
    }

    const dadosCheck = validateAndSanitizeDadosPrePreenchidos(body.dados_pre_preenchidos);
    if (!dadosCheck.ok) {
      return sendJson(res, 400, { success: false, error: dadosCheck.error });
    }

    const rpcResult = await invokeTransactionalRpc(
      supabaseAdmin,
      'criar_solicitacao_vistoria',
      {
        p_sistema_origem: callingSystem.sistema,
        p_origem_ref_id: origemRefId,
        p_solicitante_id: canonicalUserId,
        p_solicitante_nome: safeCurrentUserName,
        p_solicitante_perfil: authCtx.role,
        p_relato: relato,
        p_empreendedor_id: empreendedorId,
        p_barragem_id: barragemId,
        p_processo_referencia: processoRef,
        p_dados_pre_preenchidos: dadosCheck.value,
        p_motivo: motivo
      },
      isAdmin
    );
    return sendJson(res, rpcResult.status, rpcResult.body);
  }

  // Cancelamento ou Edição (PATCH / POST cancelar)
  if (!resolvedId || !isValidUuid(resolvedId)) {
    return sendJson(res, 400, {
      success: false,
      error: 'Identificador da solicitação deve ser um UUID válido.'
    });
  }

  if (isCancelRequest) {
    const cancelKeys = new Set(['action', 'id', 'solicitacaoId', 'motivo']);
    const safetyErr = validateBodyAllowlistAndSafety(body, cancelKeys);
    if (safetyErr) {
      return sendJson(res, 400, { success: false, error: safetyErr });
    }

    const motivo = normalizeOptionalRef(body.motivo, 500);
    if (!motivo || motivo.length < 3) {
      return sendJson(res, 400, {
        success: false,
        error: 'Informe o motivo do cancelamento (mínimo 3 caracteres).'
      });
    }
    if (hasSensitiveCpfOrCnpj(motivo)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Não é permitido gravar CPF/CNPJ no motivo do cancelamento.'
      });
    }

    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('solicitacoes_vistoria')
      .select('*')
      .eq('id', resolvedId)
      .maybeSingle();

    if (fetchErr) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Erro ao localizar solicitação de vistoria: ${fetchErr.message}`
        )
      });
    }

    if (!current) {
      return sendJson(res, 404, {
        success: false,
        error: 'Solicitação de vistoria não encontrada.'
      });
    }

    if (!isAdmin && !isSameCanonicalUser(current.solicitante_id, canonicalUserId)) {
      return sendJson(res, 403, {
        success: false,
        error: 'Apenas o solicitante autor ou um Administrador pode cancelar esta solicitação.'
      });
    }

    if (current.status === 'realizada' || current.status === 'cancelada') {
      return sendJson(res, 400, {
        success: false,
        error: `Não é possível cancelar solicitação com status "${current.status}".`
      });
    }

    const rpcResult = await invokeTransactionalRpc(
      supabaseAdmin,
      'cancelar_solicitacao_vistoria',
      {
        p_id: resolvedId,
        p_usuario_id: canonicalUserId,
        p_motivo: motivo
      },
      isAdmin
    );
    return sendJson(res, rpcResult.status, rpcResult.body);
  }

  // Edição via PATCH
  if (method !== 'PATCH') {
    return sendJson(res, 405, {
      success: false,
      error: 'Utilize PATCH para editar a solicitação de vistoria.'
    });
  }

  const safetyErr = validateBodyAllowlistAndSafety(
    body,
    EDIT_ALLOWED_BODY_KEYS,
    new Set(['dados_pre_preenchidos'])
  );
  if (safetyErr) {
    return sendJson(res, 400, { success: false, error: safetyErr });
  }

  const camposPermitidos: Record<string, any> = {};

  if ('relato' in body) {
    if (typeof body.relato !== 'string') {
      return sendJson(res, 400, { success: false, error: 'O campo "relato" deve ser textual.' });
    }
    const relato = body.relato.trim();
    if (relato.length < 3 || relato.length > 1000) {
      return sendJson(res, 400, {
        success: false,
        error: 'O relato deve ter entre 3 e 1000 caracteres.'
      });
    }
    if (hasSensitiveCpfOrCnpj(relato)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Não é permitido gravar CPF/CNPJ no relato.'
      });
    }
    camposPermitidos.relato = relato;
  }

  for (const refKey of [
    'empreendedor_id',
    'barragem_id',
    'processo_referencia',
    'origem_ref_id'
  ] as const) {
    if (!(refKey in body)) continue;
    const refVal = normalizeOptionalRef(body[refKey], 120);
    if (refVal && hasSensitiveCpfOrCnpj(refVal)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Não é permitido gravar CPF/CNPJ nas referências.'
      });
    }
    camposPermitidos[refKey] = refVal;
  }

  if ('dados_pre_preenchidos' in body) {
    const dadosCheck = validateAndSanitizeDadosPrePreenchidos(body.dados_pre_preenchidos);
    if (!dadosCheck.ok) {
      return sendJson(res, 400, { success: false, error: dadosCheck.error });
    }
    camposPermitidos.dados_pre_preenchidos = dadosCheck.value;
  }

  if ('status' in body) {
    const nextStatus = String(body.status || '').trim().toLowerCase();
    if (nextStatus !== 'solicitada' && nextStatus !== 'em_planejamento') {
      return sendJson(res, 400, {
        success: false,
        error: 'Nesta rota o status só pode ser alterado para "solicitada" ou "em_planejamento".'
      });
    }
    camposPermitidos.status = nextStatus;
  }

  const motivo = normalizeOptionalRef(body.motivo, 500);
  if (motivo && hasSensitiveCpfOrCnpj(motivo)) {
    return sendJson(res, 400, {
      success: false,
      error: 'Não é permitido gravar CPF/CNPJ no motivo.'
    });
  }

  if (Object.keys(camposPermitidos).length === 0) {
    return sendJson(res, 400, {
      success: false,
      error: 'Informe ao menos um campo permitido para atualização.'
    });
  }

  const { data: current, error: fetchErr } = await supabaseAdmin
    .from('solicitacoes_vistoria')
    .select('*')
    .eq('id', resolvedId)
    .maybeSingle();

  if (fetchErr) {
    return sendJson(res, 500, {
      success: false,
      error: scrubSensitiveTextForServerLog(
        `Erro ao localizar solicitação de vistoria: ${fetchErr.message}`
      )
    });
  }

  if (!current) {
    return sendJson(res, 404, {
      success: false,
      error: 'Solicitação de vistoria não encontrada.'
    });
  }

  if (!isAdmin && !isSameCanonicalUser(current.solicitante_id, canonicalUserId)) {
    return sendJson(res, 403, {
      success: false,
      error: 'Apenas o solicitante autor ou um Administrador pode editar esta solicitação.'
    });
  }

  if (current.status === 'realizada' || current.status === 'cancelada') {
    return sendJson(res, 400, {
      success: false,
      error: `Não é possível editar solicitação com status "${current.status}".`
    });
  }

  const rpcResult = await invokeTransactionalRpc(
    supabaseAdmin,
    'atualizar_solicitacao_vistoria',
    {
      p_id: resolvedId,
      p_campos: camposPermitidos,
      p_usuario_id: canonicalUserId,
      p_motivo: motivo
    },
    isAdmin
  );
  return sendJson(res, rpcResult.status, rpcResult.body);
}
