// api/pendencias.ts
import type { IncomingMessage, ServerResponse } from 'http';
import {
  authorizeSemaLookupRequest,
  scrubSensitiveTextForServerLog,
  type SemaAuthContext
} from '../src/server/semaAudit.js';

export const PENDENCIA_ORIGEM = 'administra' as const;
export const MUTATIONS_ENABLED = false;

export const ALLOWED_PENDENCIA_SITUACOES = [
  'aberta',
  'direcionada',
  'em_analise',
  'resolvida',
  'cancelada'
] as const;

export type PendenciaSituacao = typeof ALLOWED_PENDENCIA_SITUACOES[number];

export const ALLOWED_PENDENCIA_HISTORICO_ACOES = [
  'criacao',
  'direcionamento',
  'mudanca_situacao',
  'edicao',
  'resolucao'
] as const;

export type PendenciaHistoricoAcao = typeof ALLOWED_PENDENCIA_HISTORICO_ACOES[number];

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_SITUACOES_SET = new Set<string>(ALLOWED_PENDENCIA_SITUACOES);
const ALLOWED_ACTIONS = new Set<string>([
  'criar',
  'direcionar',
  'alterar_situacao',
  'editar',
  'resolver'
]);

const FORBIDDEN_PAYLOAD_KEYS = new Set([
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
  'documento_titular',
  'origem',
  'criado_por',
  'criadopor',
  'direcionado_por',
  'direcionadopor',
  'direcionado_em',
  'resolvido_por',
  'resolvidopor',
  'resolvido_em',
  'created_at',
  'updated_at',
  'usuario_id',
  'usuarioid',
  'userid',
  'role',
  'papel',
  'email'
]);

const EDITABLE_TEXT_FIELDS = [
  'tipo',
  'titulo',
  'descricao',
  'origem_ref_id',
  'tipo_referencia',
  'referencia_id',
  'empreendedor_id',
  'barragem_id'
] as const;

export function isValidUuid(val: unknown): boolean {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

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

async function readJsonBody(
  req: IncomingMessage & { body?: any }
): Promise<Record<string, any> | null> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, any>;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
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
        finish(parsed && typeof parsed === 'object' ? parsed : null);
      } catch {
        finish(null);
      }
    });
    (req as any).on('error', () => finish(null));
  });
}

function getQueryParams(
  req: IncomingMessage & { url?: string; query?: Record<string, string | string[] | undefined> }
): URLSearchParams {
  const params = new URLSearchParams();
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
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

export function containsSensitiveCpfOrCnpj(raw: unknown): boolean {
  const text = String(raw || '').trim();
  if (!text) return false;
  if (/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(text)) return true;
  if (/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(text)) return true;
  if (/(?<![\/.\-\da-zA-Z])\d{14}(?![\/.\-\da-zA-Z])/.test(text)) return true;
  if (/(?<![\/.\-\da-zA-Z])\d{11}(?![\/.\-\da-zA-Z])/.test(text)) return true;
  return false;
}

export const PROTECTED_DOCUMENT_PLACEHOLDER = '[documento protegido]' as const;

export const PENDENCIA_RESPONSE_ALLOWLIST = [
  'id',
  'origem',
  'origem_ref_id',
  'tipo',
  'titulo',
  'descricao',
  'situacao',
  'responsavel_id',
  'criado_por',
  'direcionado_por',
  'direcionado_em',
  'resolvido_por',
  'resolvido_em',
  'tipo_referencia',
  'referencia_id',
  'empreendedor_id',
  'barragem_id',
  'created_at',
  'updated_at'
] as const;

export const PENDENCIA_HISTORICO_RESPONSE_ALLOWLIST = [
  'id',
  'pendencia_id',
  'acao',
  'campo',
  'valor_anterior',
  'valor_novo',
  'usuario_id',
  'motivo',
  'created_at'
] as const;

const PRESERVE_TOKEN_REGEX = new RegExp(
  [
    // 1. UUIDs (isolados ou após delimitadores de prefixo, sem casar dentro de sequências alfanuméricas contíguas)
    '(?<![0-9a-zA-Z])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-zA-Z])',
    // 2. Datas e timestamps ISO (ex.: 2026-11-19, 2026-11-19T10:00:00Z, 2026-11-19 10:00:00)
    '(?<![0-9a-zA-Z])\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])(?:[T\\s]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?(?![0-9a-zA-Z])',
    // 3. Datas no formato brasileiro com hora opcional (ex.: 19/11/2026, 19/11/2026 14:30:00)
    '(?<![0-9a-zA-Z])(?:0[1-9]|[12]\\d|3[01])[./-](?:0[1-9]|1[0-2])[./-](?:19|20)\\d{2}(?:[T\\s]\\d{2}:\\d{2}(?::\\d{2})?)?(?![0-9a-zA-Z])'
  ].join('|'),
  'gi'
);

function scrubCpfCnpjSegment(segment: string): string {
  if (!segment) return segment;

  let out = segment;

  // 1. CNPJ com separadores padrão, espaços ou separadores misturados (inclusive após prefixos com -, _, /, .)
  const cnpjPatterns: RegExp[] = [
    /(?<![0-9a-zA-Z])\d{2}[ \t./_-]+\d{3}[ \t./_-]+\d{3}[ \t./_-]+\d{4}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{2}[ \t./_-]+\d{6}[ \t./_-]+\d{4}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{2}[ \t./_-]+\d{3}[ \t./_-]+\d{3}[ \t./_-]+\d{6}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{5}[ \t./_-]+\d{3}[ \t./_-]+\d{4}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{2}[ \t./_-]+\d{6}[ \t./_-]+\d{6}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{8}[ \t./_-]+\d{4}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{8}[ \t./_-]+\d{6}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{12}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g
  ];
  for (const pattern of cnpjPatterns) {
    out = out.replace(pattern, PROTECTED_DOCUMENT_PLACEHOLDER);
  }

  // 2. CPF com separadores padrão, espaços ou separadores misturados (inclusive após prefixos com -, _, /, .)
  const cpfPatterns: RegExp[] = [
    /(?<![0-9a-zA-Z])\d{3}[ \t./_-]+\d{3}[ \t./_-]+\d{3}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{3}[ \t./_-]+\d{3}[ \t./_-]+\d{5}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{3}[ \t./_-]+\d{6}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{6}[ \t./_-]+\d{3}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{6}[ \t./_-]+\d{5}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{9}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g
  ];
  for (const pattern of cpfPatterns) {
    out = out.replace(pattern, PROTECTED_DOCUMENT_PLACEHOLDER);
  }

  // 3. Sequências numéricas contíguas de 14 dígitos (CNPJ) e 11 dígitos (CPF)
  out = out.replace(
    /(?<![0-9a-zA-Z])\d{14}(?![0-9a-zA-Z])/g,
    PROTECTED_DOCUMENT_PLACEHOLDER
  );
  out = out.replace(
    /(?<![0-9a-zA-Z])\d{11}(?![0-9a-zA-Z])/g,
    PROTECTED_DOCUMENT_PLACEHOLDER
  );

  return out;
}

export function sanitizePendenciaTextForResponse(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw);
  if (!text) return '';

  const trimmed = text.trim();
  if (UUID_REGEX.test(trimmed)) {
    return trimmed;
  }

  let result = '';
  let lastIdx = 0;
  for (const match of text.matchAll(PRESERVE_TOKEN_REGEX)) {
    const idx = match.index ?? 0;
    result += scrubCpfCnpjSegment(text.slice(lastIdx, idx));
    result += match[0];
    lastIdx = idx + match[0].length;
  }
  result += scrubCpfCnpjSegment(text.slice(lastIdx));
  return result;
}

function sanitizeAllowedResponseValue(val: unknown): unknown {
  if (val === undefined) return undefined;
  if (val === null) return null;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') {
    const str = String(val);
    const scrubbed = sanitizePendenciaTextForResponse(str);
    return scrubbed !== str ? scrubbed : val;
  }
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val.toISOString();
  }
  if (typeof val === 'string') {
    return sanitizePendenciaTextForResponse(val);
  }
  if (Array.isArray(val)) {
    return val.map(item => sanitizeAllowedResponseValue(item));
  }
  if (typeof val === 'object') {
    const safeObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v === undefined) continue;
      const safeKey = sanitizePendenciaTextForResponse(k) ?? k;
      safeObj[safeKey] = sanitizeAllowedResponseValue(v);
    }
    return safeObj;
  }
  return sanitizePendenciaTextForResponse(String(val));
}

export function sanitizePendenciaRecordForResponse<T extends Record<string, any>>(
  row: T
): Record<string, any> {
  if (!row || typeof row !== 'object') return {};
  const out: Record<string, any> = {};
  for (const key of PENDENCIA_RESPONSE_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined) {
      out[key] = sanitizeAllowedResponseValue(row[key]);
    }
  }
  return out;
}

export function sanitizePendenciaHistoricoForResponse<T extends Record<string, any>>(
  row: T
): Record<string, any> {
  if (!row || typeof row !== 'object') return {};
  const out: Record<string, any> = {};
  for (const key of PENDENCIA_HISTORICO_RESPONSE_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined) {
      out[key] = sanitizeAllowedResponseValue(row[key]);
    }
  }
  return out;
}

function normalizeOptionalString(val: unknown, maxLen: number): string | null {
  if (val === undefined || val === null) return null;
  const trimmed = String(val).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function isSameCanonicalUser(a: unknown, b: unknown): boolean {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  return Boolean(left && right && left === right);
}

const READ_ALLOWED_ROLES = new Set<string>([
  'Administrador',
  'Analista',
  'Usuário',
  'Visualizador'
]);

export function canReadPendenciaRow(
  row: Record<string, any> | null | undefined,
  authCtx: SemaAuthContext
): boolean {
  if (!row) return false;
  if (!authCtx.configured || !authCtx.authorized || !authCtx.userId || !isValidUuid(authCtx.userId)) {
    return false;
  }
  return READ_ALLOWED_ROLES.has(authCtx.role || '');
}

function canMutatePendenciaRow(row: Record<string, any>, authCtx: SemaAuthContext): boolean {
  if (!['Administrador', 'Analista', 'Usuário'].includes(authCtx.role || '')) {
    return false;
  }
  if (authCtx.role === 'Administrador') return true;
  const respId = row.responsavel_id ? String(row.responsavel_id).trim() : '';
  if (!respId) return true;
  return isSameCanonicalUser(respId, authCtx.userId);
}

interface UsuarioRow {
  id: string;
  auth_user_id?: string | null;
  nome?: string | null;
  login?: string | null;
  papel?: string | null;
  setor?: string | null;
  perfil_profissional?: string | null;
  situacao?: string | null;
  status?: string | null;
}

async function fetchUsuariosDirectory(
  supabaseAdmin: NonNullable<SemaAuthContext['supabaseAdmin']>
): Promise<UsuarioRow[]> {
  const primary = await supabaseAdmin
    .from('usuarios')
    .select('id, auth_user_id, nome, login, papel, setor, perfil_profissional, situacao, status');

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

function isUsuarioActive(u: UsuarioRow): boolean {
  const sit = String(u.situacao ?? u.status ?? '')
    .trim()
    .toLowerCase();
  return sit === 'ativo';
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
    const label = formatSafeUsuarioLabel(u, isAdmin);
    map[canonicalId] = {
      id: canonicalId,
      nome: label,
      ...(u.setor ? { setor: sanitizePendenciaTextForResponse(u.setor) || '' } : {}),
      ...(u.papel ? { papel: sanitizePendenciaTextForResponse(u.papel) || '' } : {})
    };
  }
  return map;
}

export function validateBodySafetyAndNoSpoof(body: Record<string, any>): string | null {
  for (const key of Object.keys(body)) {
    const normKey = key.toLowerCase();
    if (FORBIDDEN_PAYLOAD_KEYS.has(normKey)) {
      return `Campo não permitido no corpo da requisição ("${key}"). Utilize somente campos e IDs de referência permitidos.`;
    }
    const val = body[key];
    if (typeof val === 'object' && val !== null) {
      return `Não é permitido enviar objetos ou cópias de payload em "${key}". Utilize somente identificadores de referência.`;
    }
  }

  const textFieldsToScan = ['tipo', 'titulo', 'descricao', 'motivo', 'tipo_referencia'];
  for (const field of textFieldsToScan) {
    if (body[field] !== undefined && body[field] !== null && containsSensitiveCpfOrCnpj(body[field])) {
      return 'Não é permitido gravar CPF/CNPJ em pendências. Utilize apenas os IDs de referência dos cadastros.';
    }
  }

  const refFieldsToScan = ['origem_ref_id', 'referencia_id', 'empreendedor_id', 'barragem_id'];
  for (const field of refFieldsToScan) {
    const val = String(body[field] || '').trim();
    if (!val) continue;
    if (/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(val) || /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(val)) {
      return 'Não é permitido gravar CPF/CNPJ nos campos de referência. Utilize apenas os IDs dos cadastros.';
    }
  }

  return null;
}

export interface HistoricoDraftEntry {
  pendencia_id?: string;
  acao: PendenciaHistoricoAcao;
  campo: string;
  valor_anterior: string | null;
  valor_novo: string | null;
  usuario_id: string;
  motivo: string | null;
  created_at: string;
}

export function buildCreatePendenciaDraft(
  body: Record<string, any>,
  actorUserId: string,
  resolvedRespId: string | null,
  nowIso: string
): { pendencia: Record<string, any>; historico: HistoricoDraftEntry[] } {
  const titulo = normalizeOptionalString(body.titulo, 200)!;
  const tipo = normalizeOptionalString(body.tipo, 100)!;
  const descricao = normalizeOptionalString(body.descricao, 2000);
  const origemRefId = normalizeOptionalString(body.origem_ref_id, 120);
  const tipoReferencia = normalizeOptionalString(body.tipo_referencia, 80);
  const referenciaId = normalizeOptionalString(body.referencia_id, 120);
  const empreendedorId = normalizeOptionalString(body.empreendedor_id, 120);
  const barragemId = normalizeOptionalString(body.barragem_id, 120);
  const motivo = normalizeOptionalString(body.motivo, 500);

  const initialSituacao: PendenciaSituacao = resolvedRespId ? 'direcionada' : 'aberta';
  const pendencia: Record<string, any> = {
    origem: PENDENCIA_ORIGEM,
    origem_ref_id: origemRefId,
    tipo,
    titulo,
    descricao,
    situacao: initialSituacao,
    responsavel_id: resolvedRespId,
    criado_por: actorUserId,
    direcionado_por: resolvedRespId ? actorUserId : null,
    direcionado_em: resolvedRespId ? nowIso : null,
    resolvido_por: null,
    resolvido_em: null,
    tipo_referencia: tipoReferencia,
    referencia_id: referenciaId,
    empreendedor_id: empreendedorId,
    barragem_id: barragemId,
    created_at: nowIso,
    updated_at: nowIso
  };

  const historico: HistoricoDraftEntry[] = [
    {
      acao: 'criacao',
      campo: 'situacao',
      valor_anterior: null,
      valor_novo: initialSituacao,
      usuario_id: actorUserId,
      motivo: motivo ? scrubSensitiveTextForServerLog(motivo) : 'Criação da pendência',
      created_at: nowIso
    }
  ];

  if (resolvedRespId) {
    historico.push({
      acao: 'direcionamento',
      campo: 'responsavel_id',
      valor_anterior: null,
      valor_novo: resolvedRespId,
      usuario_id: actorUserId,
      motivo: motivo ? scrubSensitiveTextForServerLog(motivo) : 'Direcionamento inicial na criação',
      created_at: nowIso
    });
  }

  return { pendencia, historico };
}

export function buildAlterarSituacaoDraft(
  current: Record<string, any>,
  novaSituacao: PendenciaSituacao,
  motivo: string | null,
  actorUserId: string,
  nowIso: string
): { patch: Record<string, any>; historico: HistoricoDraftEntry[] } {
  const currentSituacao = String(current.situacao || 'aberta').toLowerCase();
  const patch: Record<string, any> = {
    situacao: novaSituacao,
    updated_at: nowIso,
    ...(novaSituacao === 'resolvida'
      ? { resolvido_por: actorUserId, resolvido_em: nowIso }
      : { resolvido_por: null, resolvido_em: null })
  };

  const historico: HistoricoDraftEntry[] = [
    {
      pendencia_id: String(current.id),
      acao: novaSituacao === 'resolvida' ? 'resolucao' : 'mudanca_situacao',
      campo: 'situacao',
      valor_anterior: currentSituacao,
      valor_novo: novaSituacao,
      usuario_id: actorUserId,
      motivo: motivo ? scrubSensitiveTextForServerLog(motivo) : `Situação alterada para ${novaSituacao}`,
      created_at: nowIso
    }
  ];

  return { patch, historico };
}

export function buildEditarPendenciaDraft(
  current: Record<string, any>,
  body: Record<string, any>,
  actorUserId: string,
  nowIso: string
): { patch: Record<string, any>; historico: HistoricoDraftEntry[] } {
  const motivo = normalizeOptionalString(body.motivo, 500);
  const patch: Record<string, any> = {};
  const historico: HistoricoDraftEntry[] = [];

  for (const field of EDITABLE_TEXT_FIELDS) {
    if (!(field in body)) continue;
    const maxLen = field === 'descricao' ? 2000 : field === 'titulo' ? 200 : 120;
    const nextVal = normalizeOptionalString(body[field], maxLen);
    const prevVal =
      current[field] !== undefined && current[field] !== null && String(current[field]).trim() !== ''
        ? String(current[field]).trim()
        : null;

    if (nextVal !== prevVal) {
      patch[field] = nextVal;
      historico.push({
        pendencia_id: String(current.id),
        acao: 'edicao',
        campo: field,
        valor_anterior: prevVal,
        valor_novo: nextVal,
        usuario_id: actorUserId,
        motivo: motivo ? scrubSensitiveTextForServerLog(motivo) : `Edição do campo ${field}`,
        created_at: nowIso
      });
    }
  }

  if (historico.length > 0) {
    patch.updated_at = nowIso;
  }

  return { patch, historico };
}

export default async function pendenciasHandler(
  req: IncomingMessage & {
    body?: any;
    method?: string;
    url?: string;
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
      error: 'Método não permitido. Utilize GET ou POST.'
    });
  }

  const authCtx = await authorizeSemaLookupRequest(req);
  if (!authCtx.configured) {
    return sendJson(res, 503, {
      success: false,
      error:
        'Serviço central de pendências indisponível no servidor. Verifique a configuração da base central.'
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
      error:
        'Serviço central de pendências indisponível no servidor. Verifique a configuração da base central.'
    });
  }

  if (!READ_ALLOWED_ROLES.has(authCtx.role || '')) {
    return sendJson(res, 403, {
      success: false,
      error: 'Perfil sem permissão para consultar o módulo de pendências.'
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

  if (method === 'GET') {
    const query = getQueryParams(req);
    const tab = String(query.get('tab') || 'geral').trim().toLowerCase();
    const situacaoFiltro = String(query.get('situacao') || '').trim().toLowerCase();
    const pendenciaId = String(query.get('pendenciaId') || '').trim();

    if (tab !== 'minhas' && tab !== 'geral' && tab !== 'direcionado') {
      return sendJson(res, 400, {
        success: false,
        error: 'Aba solicitada é inválida.'
      });
    }

    if (tab === 'direcionado' && !isAdmin) {
      return sendJson(res, 403, {
        success: false,
        error: 'A aba Direcionado é exclusiva para o perfil Administrador.'
      });
    }

    if (situacaoFiltro && situacaoFiltro !== 'todas' && !VALID_SITUACOES_SET.has(situacaoFiltro)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Situação de filtro inválida.'
      });
    }

    if (pendenciaId && !isValidUuid(pendenciaId)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Identificador da pendência inválido.'
      });
    }

    try {
      const usuarios = await fetchUsuariosDirectory(supabaseAdmin);
      const usuariosNomes = buildUsuariosNomesMap(usuarios, isAdmin);

      if (pendenciaId) {
        const { data: item, error: itemErr } = await supabaseAdmin
          .from('pendencias')
          .select('*')
          .eq('id', pendenciaId)
          .maybeSingle();

        if (itemErr) {
          return sendJson(res, 500, {
            success: false,
            error: scrubSensitiveTextForServerLog(`Erro ao consultar pendência: ${itemErr.message}`)
          });
        }

        if (!item) {
          return sendJson(res, 404, {
            success: false,
            error: 'Pendência não encontrada.'
          });
        }

        if (!canReadPendenciaRow(item, authCtx)) {
          return sendJson(res, 403, {
            success: false,
            error: 'Sem permissão para consultar os detalhes e o histórico desta pendência.'
          });
        }

        const { data: histRows, error: histErr } = await supabaseAdmin
          .from('pendencias_historico')
          .select('id, pendencia_id, acao, campo, valor_anterior, valor_novo, usuario_id, motivo, created_at')
          .eq('pendencia_id', pendenciaId)
          .order('created_at', { ascending: false });

        if (histErr) {
          return sendJson(res, 500, {
            success: false,
            error: scrubSensitiveTextForServerLog(
              `Erro ao consultar histórico da pendência: ${histErr.message}`
            )
          });
        }

        return sendJson(res, 200, {
          success: true,
          mutationsEnabled: MUTATIONS_ENABLED,
          pendencia: sanitizePendenciaRecordForResponse(item),
          historico: (Array.isArray(histRows) ? histRows : []).map(h =>
            sanitizePendenciaHistoricoForResponse(h)
          ),
          usuariosNomes,
          ...(isAdmin
            ? {
                usuariosDirecionaveis: usuarios
                  .filter(u => isUsuarioActive(u) && isValidUuid(u.auth_user_id))
                  .map(u => ({
                    id: String(u.auth_user_id),
                    authUserId: String(u.auth_user_id),
                    nome: formatSafeUsuarioLabel(u, true),
                    login: u.login ? sanitizePendenciaTextForResponse(u.login) || '' : '',
                    setor: u.setor ? sanitizePendenciaTextForResponse(u.setor) || '' : '',
                    papel: u.papel ? sanitizePendenciaTextForResponse(u.papel) || 'Usuário' : 'Usuário'
                  }))
              }
            : {})
        });
      }

      const { data: allRows, error: listErr } = await supabaseAdmin
        .from('pendencias')
        .select('*')
        .order('updated_at', { ascending: false });

      if (listErr) {
        return sendJson(res, 500, {
          success: false,
          error: scrubSensitiveTextForServerLog(`Erro ao carregar pendências: ${listErr.message}`)
        });
      }

      const rows = (Array.isArray(allRows) ? allRows : []).filter(r =>
        canReadPendenciaRow(r, authCtx)
      );
      const minhasRows = rows.filter(r => isSameCanonicalUser(r.responsavel_id, canonicalUserId));
      const geralRows = rows;
      const direcionadoRows = isAdmin ? rows.filter(r => Boolean(r.responsavel_id)) : [];

      let tabRows = tab === 'minhas' ? minhasRows : tab === 'direcionado' ? direcionadoRows : geralRows;
      if (situacaoFiltro && situacaoFiltro !== 'todas') {
        tabRows = tabRows.filter(r => String(r.situacao || '').toLowerCase() === situacaoFiltro);
      }

      return sendJson(res, 200, {
        success: true,
        mutationsEnabled: MUTATIONS_ENABLED,
        tab,
        role: authCtx.role,
        currentUser: {
          userId: canonicalUserId,
          nome: safeCurrentUserName
        },
        counts: {
          minhas: minhasRows.length,
          geral: geralRows.length,
          ...(isAdmin ? { direcionado: direcionadoRows.length } : {})
        },
        pendencias: tabRows.map(r => sanitizePendenciaRecordForResponse(r)),
        usuariosNomes,
        ...(isAdmin
          ? {
              usuariosDirecionaveis: usuarios
                .filter(u => isUsuarioActive(u) && isValidUuid(u.auth_user_id))
                .map(u => ({
                  id: String(u.auth_user_id),
                  authUserId: String(u.auth_user_id),
                  nome: formatSafeUsuarioLabel(u, true),
                  login: u.login ? sanitizePendenciaTextForResponse(u.login) || '' : '',
                  setor: u.setor ? sanitizePendenciaTextForResponse(u.setor) || '' : '',
                  papel: u.papel ? sanitizePendenciaTextForResponse(u.papel) || 'Usuário' : 'Usuário'
                }))
            }
          : {})
      });
    } catch (err: any) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          err?.message || 'Erro interno ao consultar módulo de pendências.'
        )
      });
    }
  }

  // ==================== POST / PATCH: VALIDAÇÕES + BLOQUEIO 409 SEM GRAVAÇÃO PARCIAL ====================
  if (!['Administrador', 'Analista', 'Usuário'].includes(authCtx.role || '')) {
    return sendJson(res, 403, {
      success: false,
      error: 'Perfil Visualizador não possui permissão para criar ou alterar pendências.'
    });
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    return sendJson(res, 400, {
      success: false,
      error: 'Corpo JSON inválido.'
    });
  }

  const safetyErr = validateBodySafetyAndNoSpoof(body);
  if (safetyErr) {
    return sendJson(res, 400, {
      success: false,
      error: safetyErr
    });
  }

  const action = String(body.action || 'criar').trim().toLowerCase();
  if (!ALLOWED_ACTIONS.has(action)) {
    return sendJson(res, 400, {
      success: false,
      error: `Ação "${action}" não reconhecida para pendências.`
    });
  }

  if (action === 'direcionar' && !isAdmin) {
    return sendJson(res, 403, {
      success: false,
      error: 'Apenas Administradores podem direcionar ou alterar o responsável de uma pendência.'
    });
  }

  if (
    (action === 'criar' || action === 'editar') &&
    !isAdmin &&
    (body.responsavel_id !== undefined || body.responsavelUsuarioId !== undefined)
  ) {
    return sendJson(res, 403, {
      success: false,
      error: 'Usuários não administradores não podem escolher nem alterar o responsável.'
    });
  }

  const nowIso = new Date().toISOString();

  if (action === 'criar') {
    const titulo = normalizeOptionalString(body.titulo, 200);
    const tipo = normalizeOptionalString(body.tipo, 100);
    if (!titulo || titulo.length < 3) {
      return sendJson(res, 400, {
        success: false,
        error: 'Informe um título com pelo menos 3 caracteres.'
      });
    }
    if (!tipo) {
      return sendJson(res, 400, {
        success: false,
        error: 'Informe o tipo da pendência.'
      });
    }

    const requestedRespRaw = normalizeOptionalString(
      body.responsavel_id ?? body.responsavelUsuarioId,
      120
    );

    let resolvedRespId: string | null = null;
    if (isAdmin && requestedRespRaw) {
      if (!isValidUuid(requestedRespRaw)) {
        return sendJson(res, 400, {
          success: false,
          error: 'O identificador do usuário responsável deve ser um UUID válido.'
        });
      }
      const usuarios = await fetchUsuariosDirectory(supabaseAdmin);
      const targetUser = usuarios.find(u => isSameCanonicalUser(u.auth_user_id, requestedRespRaw));
      if (!targetUser || !isUsuarioActive(targetUser) || !isValidUuid(targetUser.auth_user_id)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Usuário responsável selecionado não foi encontrado ou está inativo.'
        });
      }
      resolvedRespId = String(targetUser.auth_user_id);
    }

    buildCreatePendenciaDraft(body, canonicalUserId, resolvedRespId, nowIso);
  } else {
    const pendenciaId = normalizeOptionalString(body.pendenciaId ?? body.id, 120);
    if (!pendenciaId || !isValidUuid(pendenciaId)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Identificador da pendência deve ser um UUID válido.'
      });
    }

    if (action === 'direcionar') {
      const targetRaw = normalizeOptionalString(
        body.responsavel_id ?? body.responsavelUsuarioId,
        120
      );
      if (!targetRaw || !isValidUuid(targetRaw)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Informe um UUID válido de usuário ativo para direcionar a pendência.'
        });
      }
      const usuarios = await fetchUsuariosDirectory(supabaseAdmin);
      const targetUser = usuarios.find(u => isSameCanonicalUser(u.auth_user_id, targetRaw));
      if (!targetUser || !isUsuarioActive(targetUser) || !isValidUuid(targetUser.auth_user_id)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Usuário selecionado não encontrado ou inativo.'
        });
      }
    }

    if (action === 'alterar_situacao') {
      const novaSituacao = String(body.situacao || '').trim().toLowerCase();
      const motivo = normalizeOptionalString(body.motivo, 500);
      if (!VALID_SITUACOES_SET.has(novaSituacao)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Situação informada não é permitida.'
        });
      }
      if ((novaSituacao === 'resolvida' || novaSituacao === 'cancelada') && (!motivo || motivo.length < 3)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Informe o motivo (mínimo 3 caracteres) para resolver ou cancelar a pendência.'
        });
      }
    }

    if (action === 'editar') {
      if ('titulo' in body) {
        const titulo = normalizeOptionalString(body.titulo, 200);
        if (!titulo || titulo.length < 3) {
          return sendJson(res, 400, {
            success: false,
            error: 'O título deve ter pelo menos 3 caracteres.'
          });
        }
      }
      if ('tipo' in body) {
        const tipo = normalizeOptionalString(body.tipo, 100);
        if (!tipo) {
          return sendJson(res, 400, {
            success: false,
            error: 'O tipo da pendência é obrigatório.'
          });
        }
      }
    }

    if (action === 'resolver') {
      const motivo = normalizeOptionalString(body.motivo, 500);
      if (!motivo || motivo.length < 3) {
        return sendJson(res, 400, {
          success: false,
          error: 'Informe o motivo / observação da resolução (mínimo 3 caracteres).'
        });
      }
    }

    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('pendencias')
      .select('*')
      .eq('id', pendenciaId)
      .maybeSingle();

    if (fetchErr) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(`Erro ao localizar pendência: ${fetchErr.message}`)
      });
    }

    if (current && !canMutatePendenciaRow(current, authCtx)) {
      return sendJson(res, 403, {
        success: false,
        error:
          'Sem permissão para alterar esta pendência. Pendências atribuídas a outro responsável são geridas pelo responsável designado ou por um Administrador.'
      });
    }
  }

  return sendJson(res, 409, {
    success: false,
    code: 'ATOMIC_TRANSACTION_REQUIRED',
    error:
      'Mutações no módulo de pendências estão desabilitadas (HTTP 409) até existir mecanismo transacional atômico autorizado para gravar pendência e histórico juntos sem gravação parcial.'
  });
}
