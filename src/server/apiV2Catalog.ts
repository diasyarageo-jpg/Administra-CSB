// src/server/apiV2Catalog.ts
import type { ServerResponse } from 'http';
import { maskCpfCnpjDisplay } from '../config/carCampos.js';
import { decodeStrictUtf8 } from './jsonBodyReader.js';
import { sanitizePendenciaTextForResponse } from './pendenciaSanitizer.js';
import type { S2sRequestLike } from './s2sAuth.js';

export type V2CatalogResource = 'barragens' | 'empreendedores';

export interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (data: any) => VercelLikeResponse;
}

export const V2_DEFAULT_LIMIT = 100;
export const V2_MAX_LIMIT = 500;

export const BARRAGENS_SELECT_COLUMNS = [
  'id',
  'nome',
  'car',
  'uf',
  'municipio',
  'municipio_ibge',
  'empreendedor_id',
  'empreendimento',
  'processo',
  'snisb',
  'curso_agua',
  'latitude',
  'longitude',
  'altura',
  'volume',
  'dano_potencial',
  'categoria_risco',
  'classificada_em',
  'situacao',
  'created_at',
  'updated_at'
] as const;

export const EMPREENDEDORES_SELECT_COLUMNS = [
  'id',
  'tipo_pessoa',
  'nome',
  'cpf_cnpj',
  'nome_fantasia',
  'email',
  'telefone',
  'uf',
  'municipio',
  'municipio_ibge',
  'empreendimentos',
  'situacao',
  'created_at',
  'updated_at'
] as const;

export interface BarragemV2Dto {
  id: string;
  nome: string;
  car: string | null;
  uf: string | null;
  municipio: string | null;
  municipioIbge: string | null;
  empreendedorId: string | null;
  empreendimento: string | null;
  processo: string | null;
  snisb: string | null;
  cursoAgua: string | null;
  latitude: string | null;
  longitude: string | null;
  altura: number | null;
  volume: number | null;
  danoPotencial: string | null;
  categoriaRisco: string | null;
  classificadaEm: string | null;
  situacao: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface EmpreendimentoV2Dto {
  id: string | null;
  nome: string | null;
  tipo: string | null;
  car: string | null;
  uf: string | null;
  municipio: string | null;
  municipioIbge: string | null;
  barragemId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface EmpreendedorV2Dto {
  id: string;
  tipoPessoa: string | null;
  nome: string;
  cpfCnpj: string | null;
  nomeFantasia: string | null;
  email: string | null;
  telefone: string | null;
  uf: string | null;
  municipio: string | null;
  municipioIbge: string | null;
  empreendimentos: EmpreendimentoV2Dto[];
  situacao: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type ParsePaginationResult =
  | { ok: true; limit: number; cursorLastId: string | null }
  | { ok: false; error: string };

const SAFE_RECORD_ID_REGEX = /^[A-Za-z0-9._:-]{1,200}$/;
const STRICT_BASE64URL_REGEX = /^[A-Za-z0-9_-]{1,512}$/;
const CONTROL_CHARS_REGEX = /[\u0000-\u001f\u007f]/;
const EMBEDDED_EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PRESERVE_SAFE_TOKENS_REGEX = new RegExp(
  [
    '(?<![0-9a-zA-Z])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-zA-Z])',
    '(?<![0-9a-zA-Z])\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])(?:[T\\s]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?(?![0-9a-zA-Z])',
    '(?<![0-9a-zA-Z])(?:0[1-9]|[12]\\d|3[01])[./-](?:0[1-9]|1[0-2])[./-](?:19|20)\\d{2}(?:[T\\s]\\d{2}:\\d{2}(?::\\d{2})?)?(?![0-9a-zA-Z])'
  ].join('|'),
  'gi'
);
const BRAZILIAN_PHONE_IN_TEXT_REGEX = new RegExp(
  [
    '(?<![0-9a-zA-Z/-])(?:\\+?55[\\s.-]?)?\\(0?[1-9][1-9]\\)[\\s.-]?(?:9[\\s.-]?)?(?:9\\d{3}|[2-9]\\d{3})[\\s.-]?\\d{4}(?![0-9a-zA-Z/-])',
    '(?<![0-9a-zA-Z/-])(?:\\+?55[\\s.-]?)?0?[1-9][1-9][\\s.-]+(?:9[\\s.-]?\\d{4}|[2-9]\\d{3})[\\s.-]?\\d{4}(?![0-9a-zA-Z/-])',
    '(?<![0-9a-zA-Z/-])\\+?55[1-9][1-9](?:9\\d{8}|[2-9]\\d{7})(?![0-9a-zA-Z/-])',
    '(?<![0-9a-zA-Z/-])[1-9][1-9][2-9]\\d{7}(?![0-9a-zA-Z/-])',
    '(?<![0-9a-zA-Z/-])(?:9\\d{4}|(?!(?:19|20)\\d{2})[2-5]\\d{3})[\\s.-]\\d{4}(?![0-9a-zA-Z/-])'
  ].join('|'),
  'g'
);

export function sendV2Json(
  res: VercelLikeResponse,
  statusCode: number,
  data: Record<string, any>
): void {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(statusCode);
    res.json(data);
    return;
  }

  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

export function sendV2Unavailable(res: VercelLikeResponse): void {
  sendV2Json(res, 503, {
    success: false,
    status: 'unavailable',
    retryable: true
  });
}

export function encodeV2Cursor(resource: V2CatalogResource, lastId: string): string {
  const cleanId = String(lastId || '').trim();
  if (!SAFE_RECORD_ID_REGEX.test(cleanId)) {
    throw new Error('INVALID_RECORD_ID_FOR_CURSOR');
  }
  const payload = JSON.stringify({
    v: 1,
    resource,
    lastId: cleanId
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeV2Cursor(
  token: string,
  expectedResource: V2CatalogResource
): string | null {
  if (typeof token !== 'string' || !STRICT_BASE64URL_REGEX.test(token)) {
    return null;
  }

  let decodedBytes: Buffer;
  try {
    decodedBytes = Buffer.from(token, 'base64url');
  } catch {
    return null;
  }

  if (decodedBytes.byteLength === 0 || decodedBytes.toString('base64url') !== token) {
    return null;
  }

  let jsonText: string;
  try {
    jsonText = decodeStrictUtf8(decodedBytes);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const keys = Object.keys(parsed);
  if (keys.length !== 3) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  if (
    obj.v !== 1 ||
    obj.resource !== expectedResource ||
    typeof obj.lastId !== 'string'
  ) {
    return null;
  }

  if (!SAFE_RECORD_ID_REGEX.test(obj.lastId)) {
    return null;
  }

  return obj.lastId;
}

export function parseV2PaginationParams(
  req: S2sRequestLike,
  expectedResource: V2CatalogResource
): ParsePaginationResult {
  const rawUrl = String(req?.originalUrl || req?.url || '/').trim();
  if (!rawUrl || CONTROL_CHARS_REGEX.test(rawUrl) || rawUrl.includes('#')) {
    return { ok: false, error: 'Parâmetros de consulta inválidos.' };
  }

  let pathAndQuery = rawUrl;
  if (/^https?:\/\//i.test(rawUrl)) {
    const schemeEnd = rawUrl.indexOf('://') + 3;
    const firstSlash = rawUrl.indexOf('/', schemeEnd);
    const firstQuery = rawUrl.indexOf('?', schemeEnd);
    if (firstSlash === -1) {
      pathAndQuery = firstQuery === -1 ? '/' : `/${rawUrl.slice(firstQuery)}`;
    } else {
      pathAndQuery = rawUrl.slice(firstSlash);
    }
  }

  const qIdx = pathAndQuery.indexOf('?');
  if (qIdx === -1) {
    return { ok: true, limit: V2_DEFAULT_LIMIT, cursorLastId: null };
  }

  const rawQuery = pathAndQuery.slice(qIdx + 1);
  if (!rawQuery) {
    return { ok: true, limit: V2_DEFAULT_LIMIT, cursorLastId: null };
  }

  let limit = V2_DEFAULT_LIMIT;
  let hasLimit = false;
  let cursorLastId: string | null = null;
  let hasCursor = false;

  for (const part of rawQuery.split('&')) {
    if (!part) {
      return { ok: false, error: 'Parâmetros de consulta inválidos.' };
    }

    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) {
      return { ok: false, error: 'Parâmetros de consulta inválidos.' };
    }

    let key: string;
    let val: string;
    try {
      key = decodeURIComponent(part.slice(0, eqIdx));
      val = decodeURIComponent(part.slice(eqIdx + 1));
    } catch {
      return { ok: false, error: 'Parâmetros de consulta inválidos.' };
    }

    if (CONTROL_CHARS_REGEX.test(key) || CONTROL_CHARS_REGEX.test(val)) {
      return { ok: false, error: 'Parâmetros de consulta inválidos.' };
    }

    if (key === 'limit') {
      if (hasLimit) {
        return { ok: false, error: 'Parâmetro limit duplicado.' };
      }
      if (!/^\d+$/.test(val)) {
        return { ok: false, error: 'Parâmetro limit inválido.' };
      }
      const parsedLimit = Number(val);
      if (
        !Number.isSafeInteger(parsedLimit) ||
        parsedLimit < 1 ||
        parsedLimit > V2_MAX_LIMIT
      ) {
        return { ok: false, error: 'Parâmetro limit fora do intervalo permitido (1 a 500).' };
      }
      hasLimit = true;
      limit = parsedLimit;
      continue;
    }

    if (key === 'cursor') {
      if (hasCursor) {
        return { ok: false, error: 'Parâmetro cursor duplicado.' };
      }
      if (!val) {
        return { ok: false, error: 'Parâmetro cursor inválido.' };
      }
      const decodedId = decodeV2Cursor(val, expectedResource);
      if (!decodedId) {
        return { ok: false, error: 'Parâmetro cursor inválido.' };
      }
      hasCursor = true;
      cursorLastId = decodedId;
      continue;
    }

    return { ok: false, error: 'Parâmetro de consulta não suportado.' };
  }

  return { ok: true, limit, cursorLastId };
}

function normalizeNullableString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  return trimmed ? trimmed : null;
}

function normalizeNullableNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  const str = String(raw).trim();
  if (!str) return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

export function maskEmailStrict(raw: unknown): string | null {
  const trimmed = normalizeNullableString(raw);
  if (!trimmed) return null;

  const atIdx = trimmed.indexOf('@');
  if (atIdx > 0 && atIdx < trimmed.length - 1) {
    const local = trimmed.slice(0, atIdx);
    const prefix = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1) || '*';
    return `${prefix}***@***`;
  }

  return '***';
}

export function maskTelefoneStrict(raw: unknown): string | null {
  const trimmed = normalizeNullableString(raw);
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) *****-**${digits.slice(-2)}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ****-**${digits.slice(-2)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) *****-**${digits.slice(-2)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ****-**${digits.slice(-2)}`;
  }
  if (digits.length === 9) {
    return `*****-**${digits.slice(-2)}`;
  }
  if (digits.length === 8) {
    return `****-**${digits.slice(-2)}`;
  }
  if (digits.length >= 4) {
    return `***-${digits.slice(-2)}`;
  }

  return '***';
}

export function maskCpfCnpjStrict(raw: unknown): string | null {
  const trimmed = normalizeNullableString(raw);
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 || digits.length === 14) {
    const masked = maskCpfCnpjDisplay(digits);
    if (masked && masked !== digits) {
      return masked;
    }
  }

  if (/[*]/.test(trimmed) && !/\d{6,}/.test(trimmed)) {
    return trimmed;
  }

  return '***';
}

function maskEmbeddedBrazilianPhones(text: string): string {
  if (!text) return text;
  let result = '';
  let lastIdx = 0;

  for (const match of text.matchAll(PRESERVE_SAFE_TOKENS_REGEX)) {
    const idx = match.index ?? 0;
    result += text
      .slice(lastIdx, idx)
      .replace(BRAZILIAN_PHONE_IN_TEXT_REGEX, phone => maskTelefoneStrict(phone) || '***');
    result += match[0];
    lastIdx = idx + match[0].length;
  }

  result += text
    .slice(lastIdx)
    .replace(BRAZILIAN_PHONE_IN_TEXT_REGEX, phone => maskTelefoneStrict(phone) || '***');
  return result;
}

function sanitizeDisplayText(raw: unknown): string | null {
  const trimmed = normalizeNullableString(raw);
  if (!trimmed) return null;

  const docScrubbed = sanitizePendenciaTextForResponse(trimmed);
  if (docScrubbed === null) return null;

  const emailScrubbed = docScrubbed.replace(
    EMBEDDED_EMAIL_REGEX,
    match => maskEmailStrict(match) || '***'
  );
  return maskEmbeddedBrazilianPhones(emailScrubbed);
}

export function mapBarragemRowToV2Dto(row: Record<string, any>): BarragemV2Dto {
  const id = normalizeNullableString(row?.id) || '';
  return {
    id,
    nome: sanitizeDisplayText(row?.nome) ?? '',
    car: normalizeNullableString(row?.car),
    uf: normalizeNullableString(row?.uf),
    municipio: normalizeNullableString(row?.municipio),
    municipioIbge: normalizeNullableString(row?.municipio_ibge),
    empreendedorId: normalizeNullableString(row?.empreendedor_id),
    empreendimento: sanitizeDisplayText(row?.empreendimento),
    processo: normalizeNullableString(row?.processo),
    snisb: normalizeNullableString(row?.snisb),
    cursoAgua: normalizeNullableString(row?.curso_agua),
    latitude: normalizeNullableString(row?.latitude),
    longitude: normalizeNullableString(row?.longitude),
    altura: normalizeNullableNumber(row?.altura),
    volume: normalizeNullableNumber(row?.volume),
    danoPotencial: normalizeNullableString(row?.dano_potencial),
    categoriaRisco: normalizeNullableString(row?.categoria_risco),
    classificadaEm: normalizeNullableString(row?.classificada_em),
    situacao: normalizeNullableString(row?.situacao),
    createdAt: normalizeNullableString(row?.created_at),
    updatedAt: normalizeNullableString(row?.updated_at)
  };
}

function sanitizeEmpreendimentosList(raw: unknown): EmpreendimentoV2Dto[] {
  if (!Array.isArray(raw)) return [];

  const result: EmpreendimentoV2Dto[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    result.push({
      id: normalizeNullableString(item.id),
      nome: sanitizeDisplayText(item.nome),
      tipo: normalizeNullableString(item.tipo),
      car: normalizeNullableString(item.car),
      uf: normalizeNullableString(item.uf),
      municipio: normalizeNullableString(item.municipio),
      municipioIbge: normalizeNullableString(item.municipioIbge ?? item.municipio_ibge),
      barragemId: normalizeNullableString(item.barragemId ?? item.barragem_id),
      createdAt: normalizeNullableString(item.createdAt ?? item.created_at),
      updatedAt: normalizeNullableString(item.updatedAt ?? item.updated_at)
    });
  }
  return result;
}

export function mapEmpreendedorRowToV2Dto(row: Record<string, any>): EmpreendedorV2Dto {
  const id = normalizeNullableString(row?.id) || '';
  return {
    id,
    tipoPessoa: normalizeNullableString(row?.tipo_pessoa),
    nome: sanitizeDisplayText(row?.nome) ?? '',
    cpfCnpj: maskCpfCnpjStrict(row?.cpf_cnpj),
    nomeFantasia: sanitizeDisplayText(row?.nome_fantasia),
    email: maskEmailStrict(row?.email),
    telefone: maskTelefoneStrict(row?.telefone),
    uf: normalizeNullableString(row?.uf),
    municipio: normalizeNullableString(row?.municipio),
    municipioIbge: normalizeNullableString(row?.municipio_ibge),
    empreendimentos: sanitizeEmpreendimentosList(row?.empreendimentos),
    situacao: normalizeNullableString(row?.situacao),
    createdAt: normalizeNullableString(row?.created_at),
    updatedAt: normalizeNullableString(row?.updated_at)
  };
}
