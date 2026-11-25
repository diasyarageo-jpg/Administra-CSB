// api/v2/health.ts
import type { ServerResponse } from 'http';
import {
  authenticateS2sRequest,
  type S2sRequestLike
} from '../../src/server/s2sAuth.js';

export const config = {
  api: {
    bodyParser: false
  }
};

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (data: any) => VercelLikeResponse;
}

const S2S_HEALTH_REQUIRED_SCOPE = 'health:read';

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

function sendUnavailable(res: VercelLikeResponse): void {
  sendJson(res, 503, {
    success: false,
    status: 'unavailable',
    retryable: true
  });
}

export default async function handler(
  req: S2sRequestLike,
  res: VercelLikeResponse
): Promise<void> {
  const method = String(req?.method || 'GET').trim().toUpperCase();

  if (method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, {
      success: false,
      error: 'Método não permitido. Utilize GET.'
    });
    return;
  }

  const auth = await authenticateS2sRequest(req, {
    requiredScope: S2S_HEALTH_REQUIRED_SCOPE
  });

  if (auth.ok === false) {
    if (auth.httpStatus === 503) {
      sendUnavailable(res);
      return;
    }
    sendJson(res, auth.httpStatus, {
      success: false,
      error: auth.error
    });
    return;
  }

  try {
    const { error: dbErr } = await auth.supabaseAdmin
      .from('barragens')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    if (dbErr) {
      sendUnavailable(res);
      return;
    }

    sendJson(res, 200, {
      success: true,
      status: 'ok',
      database: 'ok',
      checkedAt: new Date().toISOString(),
      apiVersion: '2.0'
    });
  } catch {
    sendUnavailable(res);
  }
}
