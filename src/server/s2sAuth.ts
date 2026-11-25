// src/server/s2sAuth.ts
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decodeStrictUtf8,
  parseStrictUtf8JsonObject,
  readRawBodyBuffer,
  JsonBodyReaderError,
  type StreamReadableLike
} from './jsonBodyReader.js';
import {
  getServerSupabaseAdminClient,
  normalizeRoleLabel,
  scrubSensitiveTextForServerLog
} from './semaAudit.js';

export { decodeStrictUtf8, parseStrictUtf8JsonObject };

export const S2S_VERSION = 'S2S-V2' as const;
export const S2S_ALLOWED_SYSTEMS = ['notifica', 'classifica', 'fiscaliza'] as const;
export type S2sSistema = (typeof S2S_ALLOWED_SYSTEMS)[number];

export type S2sMaskingPolicy = 'full' | 'masked';

export const S2S_MAX_CLOCK_SKEW_SECONDS = 300;
export const S2S_NONCE_TTL_SECONDS = 600;
export const S2S_DEFAULT_MAX_BODY_BYTES = 256 * 1024;
export const S2S_DEFAULT_BODY_TIMEOUT_MS = 10_000;

export interface S2sConsumerContext {
  scopeSistema: S2sSistema;
  consumerUserId: string | null;
  consumerRole: string | null;
  consumerRoleValid: boolean;
  verifiedLink: boolean;
  maskingPolicy: S2sMaskingPolicy;
  trustedAdministraSession: false;
}

export interface S2sAuthContext {
  sistema: S2sSistema;
  kid: string;
  escopos: string[];
  jti: string;
  timestamp: number;
  consumer: S2sConsumerContext;
}

export interface S2sCanonicalParts {
  method: string;
  normalizedPath: string;
  canonicalQuery: string;
  contentTypeNormalized: string;
  bodySha256HexLower: string;
  kid: string;
  timestamp: string;
  jti: string;
  consumerUserId: string;
  consumerRole: string;
}

export interface AuthenticateS2sOptions {
  requiredScope: string;
  maxClockSkewSeconds?: number;
  nonceTtlSeconds?: number;
  maxBodyBytes?: number;
  bodyTimeoutMs?: number;
  nowMs?: () => number;
}

export type AuthenticateS2sResult =
  | {
      ok: true;
      context: S2sAuthContext;
      supabaseAdmin: SupabaseClient<any, any, any>;
      rawBody: Buffer;
    }
  | {
      ok: false;
      httpStatus: number;
      code:
        | 'METHOD_INVALID'
        | 'PATH_INVALID'
        | 'QUERY_INVALID'
        | 'CONTENT_TYPE_INVALID'
        | 'RAW_BODY_UNAVAILABLE'
        | 'PAYLOAD_TOO_LARGE'
        | 'HEADERS_INVALID'
        | 'TIMESTAMP_EXPIRED'
        | 'BODY_HASH_MISMATCH'
        | 'CLIENT_INVALID'
        | 'SIGNATURE_INVALID'
        | 'SCOPE_FORBIDDEN'
        | 'JTI_REPLAY'
        | 'DB_UNAVAILABLE';
      error: string;
    };

export interface S2sRequestLike extends StreamReadableLike {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface S2sClientRow {
  sistema?: unknown;
  kid?: unknown;
  public_key_pem?: unknown;
  escopos?: unknown;
  ativo?: unknown;
}

const CONTROL_CHARS_REGEX = /[\u0000-\u001f\u007f]/;
const HEADER_FORBIDDEN_DELIMITER_REGEX = /[\u0000-\u001f\u007f|]/;
const KID_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;
const JTI_REGEX = /^[A-Za-z0-9._:-]{8,128}$/;
const TIMESTAMP_REGEX = /^\d{1,12}$/;
const SHA256_LOWER_HEX_REGEX = /^[0-9a-f]{64}$/;
const MEDIA_TYPE_REGEX = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const SAFE_CONSUMER_USER_ID_REGEX = /^[A-Za-z0-9._:@/-]{1,128}$/;

export function isAllowedS2sSistema(raw: unknown): raw is S2sSistema {
  return (
    typeof raw === 'string' &&
    (S2S_ALLOWED_SYSTEMS as readonly string[]).includes(raw)
  );
}

export function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function getRawHeaderValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): { present: boolean; valid: boolean; value: string } {
  if (!headers || typeof headers !== 'object') {
    return { present: false, valid: true, value: '' };
  }

  const target = name.toLowerCase();
  let raw: string | string[] | undefined;

  if (Object.prototype.hasOwnProperty.call(headers, target)) {
    raw = headers[target];
  } else {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === target) {
        raw = headers[key];
        break;
      }
    }
  }

  if (raw === undefined) {
    return { present: false, valid: true, value: '' };
  }

  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      return { present: false, valid: true, value: '' };
    }
    const trimmed = raw.map(item => String(item ?? '').trim());
    if (new Set(trimmed).size > 1) {
      return { present: true, valid: false, value: '' };
    }
    raw = trimmed[0];
  }

  const value = String(raw).trim();
  if (CONTROL_CHARS_REGEX.test(value)) {
    return { present: true, valid: false, value: '' };
  }
  return { present: value.length > 0, valid: true, value };
}

export function normalizeHttpMethod(rawMethod: unknown): string | null {
  const method = String(rawMethod || '').trim().toUpperCase();
  if (!/^[A-Z]{2,16}$/.test(method)) return null;
  return method;
}

function extractRawRequestTarget(rawUrl: string): { rawPath: string; rawQuery: string } {
  const value = String(rawUrl || '/').trim();
  if (!value || CONTROL_CHARS_REGEX.test(value) || value.includes('\\') || value.includes('#')) {
    throw new Error('PATH_INVALID');
  }

  let pathAndQuery = value;
  if (/^https?:\/\//i.test(value)) {
    const schemeEnd = value.indexOf('://') + 3;
    const firstSlash = value.indexOf('/', schemeEnd);
    const firstQuery = value.indexOf('?', schemeEnd);
    if (firstSlash === -1) {
      pathAndQuery = firstQuery === -1 ? '/' : `/${value.slice(firstQuery)}`;
    } else {
      pathAndQuery = value.slice(firstSlash);
    }
  }

  const qIdx = pathAndQuery.indexOf('?');
  if (qIdx === -1) {
    return { rawPath: pathAndQuery, rawQuery: '' };
  }
  return {
    rawPath: pathAndQuery.slice(0, qIdx),
    rawQuery: pathAndQuery.slice(qIdx + 1)
  };
}

export function normalizePublicPath(rawPath: string): string {
  if (typeof rawPath !== 'string' || !rawPath || rawPath !== rawPath.trim()) {
    throw new Error('PATH_INVALID');
  }
  if (
    !rawPath.startsWith('/') ||
    /\s/.test(rawPath) ||
    CONTROL_CHARS_REGEX.test(rawPath) ||
    rawPath.includes('\\') ||
    rawPath.includes('#') ||
    rawPath.includes('?') ||
    rawPath.includes('//')
  ) {
    throw new Error('PATH_INVALID');
  }

  if (rawPath.length > 1 && rawPath.endsWith('/')) {
    throw new Error('PATH_INVALID');
  }

  if (rawPath === '/') {
    return '/';
  }

  const segments = rawPath.slice(1).split('/');
  const normalizedSegments: string[] = [];

  for (const seg of segments) {
    if (!seg || /%[0-7][0-9a-f]/i.test(seg)) {
      throw new Error('PATH_INVALID');
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      throw new Error('PATH_INVALID');
    }
    if (
      !decoded ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      /\s/.test(decoded) ||
      CONTROL_CHARS_REGEX.test(decoded)
    ) {
      throw new Error('PATH_INVALID');
    }
    const canonical = rfc3986Encode(decoded);
    if (canonical !== seg) {
      throw new Error('PATH_INVALID');
    }
    normalizedSegments.push(canonical);
  }

  return `/${normalizedSegments.join('/')}`;
}

export function canonicalizeQueryString(rawQuery: string): string {
  const q = String(rawQuery || '');
  if (!q) return '';
  if (CONTROL_CHARS_REGEX.test(q) || q.includes('#')) {
    throw new Error('QUERY_INVALID');
  }

  const pairs: Array<[string, string]> = [];
  for (const part of q.split('&')) {
    if (!part) continue;
    const eqIdx = part.indexOf('=');
    const rawKey = eqIdx === -1 ? part : part.slice(0, eqIdx);
    const rawVal = eqIdx === -1 ? '' : part.slice(eqIdx + 1);

    let decodedKey: string;
    let decodedVal: string;
    try {
      decodedKey = decodeURIComponent(rawKey);
      decodedVal = decodeURIComponent(rawVal);
    } catch {
      throw new Error('QUERY_INVALID');
    }

    if (
      !decodedKey ||
      CONTROL_CHARS_REGEX.test(decodedKey) ||
      CONTROL_CHARS_REGEX.test(decodedVal)
    ) {
      throw new Error('QUERY_INVALID');
    }

    pairs.push([rfc3986Encode(decodedKey), rfc3986Encode(decodedVal)]);
  }

  pairs.sort((a, b) => {
    const keyCmp = Buffer.compare(Buffer.from(a[0], 'utf8'), Buffer.from(b[0], 'utf8'));
    if (keyCmp !== 0) return keyCmp;
    return Buffer.compare(Buffer.from(a[1], 'utf8'), Buffer.from(b[1], 'utf8'));
  });

  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

export function normalizeContentType(rawContentType: string): string {
  const raw = String(rawContentType || '').trim();
  if (!raw) return '';
  if (HEADER_FORBIDDEN_DELIMITER_REGEX.test(raw)) {
    throw new Error('CONTENT_TYPE_INVALID');
  }

  const parts = raw
    .split(';')
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';

  const mediaType = parts[0].toLowerCase();
  if (!MEDIA_TYPE_REGEX.test(mediaType)) {
    throw new Error('CONTENT_TYPE_INVALID');
  }

  const params: string[] = [];
  for (const param of parts.slice(1)) {
    const eqIdx = param.indexOf('=');
    if (eqIdx <= 0) {
      throw new Error('CONTENT_TYPE_INVALID');
    }
    const key = param.slice(0, eqIdx).trim().toLowerCase();
    let val = param.slice(eqIdx + 1).trim();
    if (!/^[a-z0-9!#$&^_.+-]+$/i.test(key)) {
      throw new Error('CONTENT_TYPE_INVALID');
    }
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1);
    }
    if (!val || HEADER_FORBIDDEN_DELIMITER_REGEX.test(val)) {
      throw new Error('CONTENT_TYPE_INVALID');
    }
    params.push(`${key}=${val.toLowerCase()}`);
  }

  return [mediaType, ...params].join('; ');
}

export function sha256BodyHexLower(rawBody: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}

export function buildS2sCanonicalMessage(parts: S2sCanonicalParts): string {
  const lines = [
    S2S_VERSION,
    parts.method,
    parts.normalizedPath,
    parts.canonicalQuery,
    parts.contentTypeNormalized,
    parts.bodySha256HexLower,
    parts.kid,
    parts.timestamp,
    parts.jti,
    `${parts.consumerUserId}|${parts.consumerRole}`
  ];
  return lines.join('\n');
}

function decodeEd25519Signature(rawSignature: string): Buffer | null {
  const sig = String(rawSignature || '').trim();
  if (!sig || HEADER_FORBIDDEN_DELIMITER_REGEX.test(sig)) return null;

  let decoded: Buffer;
  if (/^[A-Za-z0-9_-]+={0,2}$/.test(sig)) {
    decoded = Buffer.from(sig, 'base64url');
  } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(sig)) {
    decoded = Buffer.from(sig, 'base64');
  } else {
    return null;
  }

  return decoded.byteLength === 64 ? decoded : null;
}

function parseEd25519PublicKey(publicKeyPem: unknown): crypto.KeyObject | null {
  if (typeof publicKeyPem !== 'string') return null;
  const trimmed = publicKeyPem.trim();
  if (!trimmed) return null;
  try {
    const keyObj = crypto.createPublicKey(trimmed);
    if (keyObj.asymmetricKeyType !== 'ed25519') {
      return null;
    }
    return keyObj;
  } catch {
    return null;
  }
}

export function deriveConsumerMaskingContext(
  sistema: S2sSistema,
  rawConsumerUserId: string,
  rawConsumerRole: string,
  options?: { verifiedActiveLink?: boolean }
): S2sConsumerContext {
  const userIdTrimmed = String(rawConsumerUserId || '').trim();
  const roleTrimmed = String(rawConsumerRole || '').trim();

  const consumerUserId =
    userIdTrimmed && SAFE_CONSUMER_USER_ID_REGEX.test(userIdTrimmed)
      ? userIdTrimmed
      : null;

  const normalizedRole = roleTrimmed ? normalizeRoleLabel(roleTrimmed) : '';
  const consumerRoleValid = Boolean(normalizedRole);
  const verifiedLink = options?.verifiedActiveLink === true;

  // Fail-closed: exige verificacao server-side real de vinculo ativo;
  // cabeçalhos assinados pelo consumidor nunca liberam dados completos por si so.
  const canViewFull =
    verifiedLink &&
    Boolean(consumerUserId) &&
    (normalizedRole === 'Administrador' || normalizedRole === 'Analista');

  return {
    scopeSistema: sistema,
    consumerUserId,
    consumerRole: normalizedRole || null,
    consumerRoleValid,
    verifiedLink,
    maskingPolicy: canViewFull ? 'full' : 'masked',
    trustedAdministraSession: false
  };
}

function safeLogS2sFailure(reason: string, sistema?: string): void {
  const safeReason = scrubSensitiveTextForServerLog(reason).slice(0, 80);
  const safeSistema = isAllowedS2sSistema(sistema) ? sistema : 'unknown';
  console.warn(`[s2s-v2] auth_denied reason=${safeReason} sistema=${safeSistema}`);
}

async function readVerifiedRawBody(
  req: S2sRequestLike,
  method: string,
  maxBodyBytes: number,
  bodyTimeoutMs: number
): Promise<
  | { ok: true; rawBody: Buffer }
  | { ok: false; httpStatus: number; code: 'RAW_BODY_UNAVAILABLE' | 'PAYLOAD_TOO_LARGE'; error: string }
> {
  // Nunca acessar req.body (pode disparar getter ou expor payload pré-parseado sem bytes brutos)
  const hasPreParsedBodyDataProp =
    Object.getOwnPropertyDescriptor(req, 'body')?.value !== undefined;

  if (hasPreParsedBodyDataProp) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'RAW_BODY_UNAVAILABLE',
      error: 'Corpo bruto da requisição indisponível para verificação de integridade.'
    };
  }

  if (typeof req.on !== 'function') {
    const contentLengthHeader = getRawHeaderValue(req.headers, 'content-length');
    const transferEncodingHeader = getRawHeaderValue(req.headers, 'transfer-encoding');
    const hasBodyHeaders =
      (contentLengthHeader.present && contentLengthHeader.value !== '0') ||
      !contentLengthHeader.valid ||
      transferEncodingHeader.present;

    if ((method === 'GET' || method === 'HEAD') && !hasBodyHeaders) {
      return { ok: true, rawBody: Buffer.alloc(0) };
    }

    return {
      ok: false,
      httpStatus: 400,
      code: 'RAW_BODY_UNAVAILABLE',
      error: 'Fluxo de bytes brutos da requisição indisponível para verificação S2S.'
    };
  }

  try {
    const rawBody = await readRawBodyBuffer(req, {
      maxBytes: maxBodyBytes,
      timeoutMs: bodyTimeoutMs,
      payloadTooLargeMessage: 'Corpo da requisição S2S excede o limite permitido.',
      streamUnavailableMessage: 'Fluxo de bytes brutos da requisição indisponível.'
    });

    // Se o runtime já drenou o stream e colocou objeto pré-parseado em req.body sem repassar bytes,
    // falha fechado quando content-length > 0 e rawBody veio vazio.
    const contentLengthHeader = getRawHeaderValue(req.headers, 'content-length');
    const declaredLen =
      contentLengthHeader.present && /^\d+$/.test(contentLengthHeader.value)
        ? Number(contentLengthHeader.value)
        : 0;
    if (declaredLen > 0 && rawBody.byteLength !== declaredLen) {
      return {
        ok: false,
        httpStatus: 400,
        code: 'RAW_BODY_UNAVAILABLE',
        error: 'Corpo bruto da requisição incompleto para verificação S2S.'
      };
    }

    return { ok: true, rawBody };
  } catch (err: any) {
    if (err instanceof JsonBodyReaderError) {
      return {
        ok: false,
        httpStatus: err.statusCode === 413 ? 413 : 400,
        code: err.statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'RAW_BODY_UNAVAILABLE',
        error:
          err.statusCode === 413
            ? 'Corpo da requisição S2S excede o limite permitido.'
            : 'Não foi possível ler os bytes brutos da requisição.'
      };
    }
    return {
      ok: false,
      httpStatus: 400,
      code: 'RAW_BODY_UNAVAILABLE',
      error: 'Não foi possível ler os bytes brutos da requisição.'
    };
  }
}

export async function authenticateS2sRequest(
  req: S2sRequestLike,
  options: AuthenticateS2sOptions
): Promise<AuthenticateS2sResult> {
  const maxClockSkewSeconds = options.maxClockSkewSeconds ?? S2S_MAX_CLOCK_SKEW_SECONDS;
  const nonceTtlSeconds = options.nonceTtlSeconds ?? S2S_NONCE_TTL_SECONDS;
  const maxBodyBytes = options.maxBodyBytes ?? S2S_DEFAULT_MAX_BODY_BYTES;
  const bodyTimeoutMs = options.bodyTimeoutMs ?? S2S_DEFAULT_BODY_TIMEOUT_MS;
  const nowSeconds = Math.floor((options.nowMs ? options.nowMs() : Date.now()) / 1000);

  const method = normalizeHttpMethod(req?.method);
  if (!method) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'METHOD_INVALID',
      error: 'Método HTTP inválido.'
    };
  }

  let normalizedPath = '/';
  let canonicalQuery = '';
  try {
    const targetUrl = String(req?.originalUrl || req?.url || '/');
    const { rawPath, rawQuery } = extractRawRequestTarget(targetUrl);
    normalizedPath = normalizePublicPath(rawPath);
    canonicalQuery = canonicalizeQueryString(rawQuery);
  } catch (err: any) {
    const isQuery = err?.message === 'QUERY_INVALID';
    return {
      ok: false,
      httpStatus: 400,
      code: isQuery ? 'QUERY_INVALID' : 'PATH_INVALID',
      error: isQuery ? 'Parâmetros de consulta inválidos.' : 'Caminho da requisição inválido.'
    };
  }

  const bodyRead = await readVerifiedRawBody(req, method, maxBodyBytes, bodyTimeoutMs);
  if (bodyRead.ok === false) {
    return {
      ok: false,
      httpStatus: bodyRead.httpStatus,
      code: bodyRead.code,
      error: bodyRead.error
    };
  }
  const rawBody = bodyRead.rawBody;

  const kidHdr = getRawHeaderValue(req.headers, 'x-s2s-key-id');
  const tsHdr = getRawHeaderValue(req.headers, 'x-s2s-timestamp');
  const jtiHdr = getRawHeaderValue(req.headers, 'x-s2s-jti');
  const contentTypeHdr = getRawHeaderValue(req.headers, 'content-type');
  const bodyShaHdr = getRawHeaderValue(req.headers, 'x-s2s-body-sha256');
  const sigHdr = getRawHeaderValue(req.headers, 'x-s2s-signature');
  const consumerUserIdHdr = getRawHeaderValue(req.headers, 'x-consumer-user-id');
  const consumerRoleHdr = getRawHeaderValue(req.headers, 'x-consumer-role');

  if (
    !kidHdr.valid ||
    !kidHdr.present ||
    !KID_REGEX.test(kidHdr.value) ||
    HEADER_FORBIDDEN_DELIMITER_REGEX.test(kidHdr.value) ||
    !tsHdr.valid ||
    !tsHdr.present ||
    !TIMESTAMP_REGEX.test(tsHdr.value) ||
    !jtiHdr.valid ||
    !jtiHdr.present ||
    !JTI_REGEX.test(jtiHdr.value) ||
    HEADER_FORBIDDEN_DELIMITER_REGEX.test(jtiHdr.value) ||
    !bodyShaHdr.valid ||
    !bodyShaHdr.present ||
    !SHA256_LOWER_HEX_REGEX.test(bodyShaHdr.value) ||
    !sigHdr.valid ||
    !sigHdr.present ||
    !contentTypeHdr.valid ||
    !consumerUserIdHdr.valid ||
    !consumerRoleHdr.valid ||
    HEADER_FORBIDDEN_DELIMITER_REGEX.test(consumerUserIdHdr.value) ||
    HEADER_FORBIDDEN_DELIMITER_REGEX.test(consumerRoleHdr.value)
  ) {
    safeLogS2sFailure('headers_invalid');
    return {
      ok: false,
      httpStatus: 401,
      code: 'HEADERS_INVALID',
      error: 'Cabeçalhos de autenticação S2S ausentes ou inválidos.'
    };
  }

  let contentTypeNormalized = '';
  if (rawBody.byteLength > 0 && !contentTypeHdr.present) {
    safeLogS2sFailure('content_type_required');
    return {
      ok: false,
      httpStatus: 401,
      code: 'CONTENT_TYPE_INVALID',
      error: 'Cabeçalho Content-Type obrigatório quando há corpo na requisição.'
    };
  }
  if (contentTypeHdr.present) {
    try {
      contentTypeNormalized = normalizeContentType(contentTypeHdr.value);
    } catch {
      safeLogS2sFailure('content_type_invalid');
      return {
        ok: false,
        httpStatus: 400,
        code: 'CONTENT_TYPE_INVALID',
        error: 'Cabeçalho Content-Type inválido.'
      };
    }
  }

  const timestampSec = Number(tsHdr.value);
  if (!Number.isSafeInteger(timestampSec) || Math.abs(nowSeconds - timestampSec) > maxClockSkewSeconds) {
    safeLogS2sFailure('timestamp_expired');
    return {
      ok: false,
      httpStatus: 401,
      code: 'TIMESTAMP_EXPIRED',
      error: 'Timestamp S2S expirado ou fora da janela permitida.'
    };
  }

  const actualBodyShaHex = sha256BodyHexLower(rawBody);
  const expectedHashBuf = Buffer.from(bodyShaHdr.value, 'utf8');
  const actualHashBuf = Buffer.from(actualBodyShaHex, 'utf8');
  if (
    expectedHashBuf.byteLength !== actualHashBuf.byteLength ||
    !crypto.timingSafeEqual(expectedHashBuf, actualHashBuf)
  ) {
    safeLogS2sFailure('body_hash_mismatch');
    return {
      ok: false,
      httpStatus: 401,
      code: 'BODY_HASH_MISMATCH',
      error: 'Hash do corpo da requisição inválido.'
    };
  }

  const signatureBuf = decodeEd25519Signature(sigHdr.value);
  if (!signatureBuf) {
    safeLogS2sFailure('signature_malformed');
    return {
      ok: false,
      httpStatus: 401,
      code: 'SIGNATURE_INVALID',
      error: 'Assinatura S2S inválida.'
    };
  }

  const supabaseAdmin = getServerSupabaseAdminClient();
  if (!supabaseAdmin) {
    return {
      ok: false,
      httpStatus: 503,
      code: 'DB_UNAVAILABLE',
      error: 'Serviço central indisponível.'
    };
  }

  let clientRows: S2sClientRow[] | null = null;
  let clientErr: any = null;
  try {
    const res = await supabaseAdmin
      .from('integracao_clientes_s2s')
      .select('sistema, kid, public_key_pem, escopos, ativo')
      .eq('kid', kidHdr.value)
      .limit(2);

    clientRows = res.data as S2sClientRow[] | null;
    clientErr = res.error;
  } catch {
    return {
      ok: false,
      httpStatus: 503,
      code: 'DB_UNAVAILABLE',
      error: 'Serviço central indisponível.'
    };
  }

  if (clientErr) {
    return {
      ok: false,
      httpStatus: 503,
      code: 'DB_UNAVAILABLE',
      error: 'Serviço central indisponível.'
    };
  }

  if (!clientRows || clientRows.length !== 1) {
    safeLogS2sFailure('client_not_found_or_ambiguous');
    return {
      ok: false,
      httpStatus: 401,
      code: 'CLIENT_INVALID',
      error: 'Cliente S2S inválido ou não autorizado.'
    };
  }

  const clientRow = clientRows[0];
  const clientSistemaRaw =
    typeof clientRow.sistema === 'string' ? clientRow.sistema.trim().toLowerCase() : '';
  if (!isAllowedS2sSistema(clientSistemaRaw) || clientRow.ativo !== true) {
    safeLogS2sFailure('client_inactive_or_disallowed', clientSistemaRaw);
    return {
      ok: false,
      httpStatus: 401,
      code: 'CLIENT_INVALID',
      error: 'Cliente S2S inativo ou não autorizado.'
    };
  }

  const publicKey = parseEd25519PublicKey(clientRow.public_key_pem);
  if (!publicKey) {
    safeLogS2sFailure('client_key_invalid', clientSistemaRaw);
    return {
      ok: false,
      httpStatus: 401,
      code: 'CLIENT_INVALID',
      error: 'Credencial do cliente S2S inválida.'
    };
  }

  const canonicalMessage = buildS2sCanonicalMessage({
    method,
    normalizedPath,
    canonicalQuery,
    contentTypeNormalized,
    bodySha256HexLower: actualBodyShaHex,
    kid: kidHdr.value,
    timestamp: tsHdr.value,
    jti: jtiHdr.value,
    consumerUserId: consumerUserIdHdr.value,
    consumerRole: consumerRoleHdr.value
  });

  let signatureValid = false;
  try {
    signatureValid = crypto.verify(
      null,
      Buffer.from(canonicalMessage, 'utf8'),
      publicKey,
      signatureBuf
    );
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    safeLogS2sFailure('signature_invalid', clientSistemaRaw);
    return {
      ok: false,
      httpStatus: 401,
      code: 'SIGNATURE_INVALID',
      error: 'Assinatura S2S inválida.'
    };
  }

  const escopos = Array.isArray(clientRow.escopos)
    ? clientRow.escopos
        .map(item => String(item ?? '').trim())
        .filter(Boolean)
    : [];

  if (!escopos.includes(options.requiredScope)) {
    safeLogS2sFailure('scope_forbidden', clientSistemaRaw);
    return {
      ok: false,
      httpStatus: 403,
      code: 'SCOPE_FORBIDDEN',
      error: 'Cliente S2S sem escopo necessário para esta operação.'
    };
  }

  const expiresAtIso = new Date((nowSeconds + nonceTtlSeconds) * 1000).toISOString();
  try {
    const { data: reserved, error: nonceErr } = await supabaseAdmin.rpc('reservar_nonce_s2s', {
      p_sistema: clientSistemaRaw,
      p_jti: jtiHdr.value,
      p_expires_at: expiresAtIso
    });

    if (nonceErr) {
      if (String(nonceErr.code || '') === '23505') {
        safeLogS2sFailure('jti_replay', clientSistemaRaw);
        return {
          ok: false,
          httpStatus: 409,
          code: 'JTI_REPLAY',
          error: 'Nonce S2S (jti) já utilizado.'
        };
      }
      return {
        ok: false,
        httpStatus: 503,
        code: 'DB_UNAVAILABLE',
        error: 'Serviço central indisponível.'
      };
    }

    if (reserved !== true) {
      safeLogS2sFailure('jti_replay', clientSistemaRaw);
      return {
        ok: false,
        httpStatus: 409,
        code: 'JTI_REPLAY',
        error: 'Nonce S2S (jti) já utilizado.'
      };
    }
  } catch {
    return {
      ok: false,
      httpStatus: 503,
      code: 'DB_UNAVAILABLE',
      error: 'Serviço central indisponível.'
    };
  }

  const consumer = deriveConsumerMaskingContext(
    clientSistemaRaw,
    consumerUserIdHdr.value,
    consumerRoleHdr.value
  );

  return {
    ok: true,
    context: {
      sistema: clientSistemaRaw,
      kid: kidHdr.value,
      escopos,
      jti: jtiHdr.value,
      timestamp: timestampSec,
      consumer
    },
    supabaseAdmin,
    rawBody
  };
}
