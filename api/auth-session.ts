// api/auth-session.ts
import type { IncomingMessage, ServerResponse } from 'http';
import { authorizeSemaLookupRequest } from '../src/server/semaAudit';

interface VercelLikeRequest extends IncomingMessage {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (data: any) => VercelLikeResponse;
}

function sendJson(res: VercelLikeResponse, statusCode: number, data: any): void {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const statusFn = res.status.bind(res);
    const jsonFn = res.json.bind(res);
    statusFn(statusCode);
    jsonFn(data);
    return;
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method !== 'GET') {
    sendJson(res, 405, {
      authenticated: false,
      error: 'Método não permitido. Utilize GET.'
    });
    return;
  }

  // Validação estritamente server-side via Bearer JWT + public.usuarios.auth_user_id
  // Ignora qualquer cabeçalho, query ou payload enviado pelo navegador tentando informar papel ou usuário.
  const auth = await authorizeSemaLookupRequest(req);

  if (!auth.configured) {
    sendJson(res, 503, {
      authenticated: false,
      code: 'AUTH_NOT_CONFIGURED',
      error: 'Serviço de validação de sessão indisponível no servidor.'
    });
    return;
  }

  if (!auth.authorized || !auth.userId || !auth.usuarioId || !auth.role) {
    sendJson(res, auth.httpStatus || 401, {
      authenticated: false,
      code: auth.authErrorCode || 'SESSION_INVALID',
      error: auth.error || 'Sessão institucional ausente ou inválida.'
    });
    return;
  }

  sendJson(res, 200, {
    authenticated: true,
    profile: {
      id: auth.usuarioId,
      authUserId: auth.userId,
      nome: auth.userName || '',
      login: auth.login || '',
      matricula: auth.matricula || '',
      perfilProfissional: auth.perfilProfissional || '',
      setor: auth.setor || '',
      papel: auth.role,
      situacao: auth.situacao || 'Ativo'
    }
  });
}
