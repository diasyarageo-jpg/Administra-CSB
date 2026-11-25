// api/v2/s2s-nonces-cleanup.ts
import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { getServerSupabaseAdminClient } from '../../src/server/semaAudit.js';

export const config = {
  api: {
    bodyParser: false
  }
};

interface VercelLikeRequest extends IncomingMessage {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (data: any) => VercelLikeResponse;
}

const DEFAULT_BATCH_LIMIT = 5000;
const MAX_BATCH_LIMIT = 50000;
const MAX_BATCHES_PER_RUN = 10;

function cleanServerSecret(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

function getConfiguredCronSecret(): string {
  return cleanServerSecret(process.env.CRON_SECRET);
}

function getHeaderSingle(
  headers: Record<string, string | string[] | undefined> | undefined,
  targetName: string
): string {
  if (!headers || typeof headers !== 'object') return '';
  const lower = targetName.toLowerCase();
  let raw: string | string[] | undefined;
  if (Object.prototype.hasOwnProperty.call(headers, lower)) {
    raw = headers[lower];
  } else {
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === lower) {
        raw = headers[k];
        break;
      }
    }
  }
  if (Array.isArray(raw)) {
    return raw.length === 1 ? String(raw[0] || '') : '';
  }
  return typeof raw === 'string' ? raw : '';
}

function timingSafeBearerEquals(authHeader: string, expectedSecret: string): boolean {
  if (!expectedSecret || !authHeader) return false;
  const expected = Buffer.from(`Bearer ${expectedSecret}`, 'utf8');
  const actual = Buffer.from(authHeader.trim(), 'utf8');
  if (actual.byteLength !== expected.byteLength) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function parseBatchLimit(rawUrl: string | undefined): { valid: boolean; limit: number } {
  if (!rawUrl || !rawUrl.includes('?')) {
    return { valid: true, limit: DEFAULT_BATCH_LIMIT };
  }
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const rawLimit = parsed.searchParams.get('limit');
    if (rawLimit === null || rawLimit.trim() === '') {
      return { valid: true, limit: DEFAULT_BATCH_LIMIT };
    }
    if (!/^\d+$/.test(rawLimit.trim())) {
      return { valid: false, limit: DEFAULT_BATCH_LIMIT };
    }
    const num = Number(rawLimit.trim());
    if (!Number.isSafeInteger(num) || num < 1 || num > MAX_BATCH_LIMIT) {
      return { valid: false, limit: DEFAULT_BATCH_LIMIT };
    }
    return { valid: true, limit: num };
  } catch {
    return { valid: false, limit: DEFAULT_BATCH_LIMIT };
  }
}

function sendJson(res: VercelLikeResponse, statusCode: number, data: Record<string, any>): void {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(statusCode);
    res.json(data);
    return;
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

type CleanupRunStatus = 'success' | 'failure';
type CleanupRunErrorCode = 'supabase_unavailable' | 'cleanup_rpc_failed' | 'unexpected_error';

interface CleanupRunAuditRecord {
  started_at: string;
  finished_at: string;
  status: CleanupRunStatus;
  deleted_count: number;
  batches_executed: number;
  batch_limit: number;
  duration_ms: number;
  error_code: CleanupRunErrorCode | null;
}

async function recordCleanupRunAudit(
  supabaseAdmin: NonNullable<ReturnType<typeof getServerSupabaseAdminClient>>,
  record: CleanupRunAuditRecord
): Promise<void> {
  try {
    const result = await supabaseAdmin.from('s2s_nonce_cleanup_runs').insert(record);
    void result?.error;
  } catch {
    // Registro de auditoria é best-effort e nunca deve alterar ou mascarar a resposta da limpeza.
  }
}

export async function handleNoncesCleanup(
  req: VercelLikeRequest,
  res: VercelLikeResponse,
  getAdminClient: typeof getServerSupabaseAdminClient = getServerSupabaseAdminClient
): Promise<void> {
  const method = String(req?.method || 'GET').trim().toUpperCase();

  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, {
      success: false,
      error: 'Método não permitido. Utilize GET ou POST.'
    });
    return;
  }

  const cronSecret = getConfiguredCronSecret();
  const authHeader = getHeaderSingle(req?.headers, 'authorization');

  if (!cronSecret || !timingSafeBearerEquals(authHeader, cronSecret)) {
    sendJson(res, 401, {
      success: false,
      error: 'Não autorizado para executar a limpeza de nonces.'
    });
    return;
  }

  const limitCheck = parseBatchLimit(req?.url);
  if (!limitCheck.valid) {
    sendJson(res, 400, {
      success: false,
      error: 'Parâmetro limit inválido.'
    });
    return;
  }

  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();

  let supabaseAdmin: ReturnType<typeof getServerSupabaseAdminClient> = null;
  try {
    supabaseAdmin = getAdminClient();
  } catch {
    supabaseAdmin = null;
  }

  if (!supabaseAdmin) {
    sendJson(res, 503, {
      success: false,
      status: 'unavailable',
      retryable: true
    });
    return;
  }

  let totalDeleted = 0;
  let batchesExecuted = 0;
  let runStatus: CleanupRunStatus = 'success';
  let errorCode: CleanupRunErrorCode | null = null;

  try {
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const { data, error } = await supabaseAdmin.rpc('limpar_nonces_s2s_expirados', {
        p_limit: limitCheck.limit
      });

      if (error) {
        runStatus = 'failure';
        errorCode = 'cleanup_rpc_failed';
        break;
      }

      const deletedInBatch =
        typeof data === 'number' && Number.isFinite(data) && data >= 0 ? Math.floor(data) : 0;

      batchesExecuted += 1;
      totalDeleted += deletedInBatch;

      if (deletedInBatch < limitCheck.limit) {
        break;
      }
    }
  } catch {
    runStatus = 'failure';
    errorCode = 'unexpected_error';
  }

  const finishedAtMs = Math.max(startedAtMs, Date.now());
  const finishedAtIso = new Date(finishedAtMs).toISOString();
  const durationMs = Math.max(0, Math.trunc(finishedAtMs - startedAtMs));

  await recordCleanupRunAudit(supabaseAdmin, {
    started_at: startedAtIso,
    finished_at: finishedAtIso,
    status: runStatus,
    deleted_count: totalDeleted,
    batches_executed: batchesExecuted,
    batch_limit: limitCheck.limit,
    duration_ms: durationMs,
    error_code: runStatus === 'success' ? null : errorCode ?? 'unexpected_error'
  });

  if (runStatus === 'success') {
    sendJson(res, 200, {
      success: true,
      deletedCount: totalDeleted,
      batchesExecuted,
      batchLimit: limitCheck.limit,
      executedAt: finishedAtIso
    });
    return;
  }

  sendJson(res, 503, {
    success: false,
    status: 'unavailable',
    retryable: true
  });
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  return handleNoncesCleanup(req, res);
}
