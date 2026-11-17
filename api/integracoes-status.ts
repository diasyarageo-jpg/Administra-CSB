// api/integracoes-status.ts
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

interface IntegrationVarSpec {
  nome: string;
  rotulo: string;
  tipo: 'url' | 'secret';
}

interface IntegrationSystemSpec {
  sistema: 'Notifica' | 'Classifica' | 'Fiscaliza';
  descricao: string;
  variaveis: IntegrationVarSpec[];
}

const EXTERNAL_SYSTEM_SPECS: IntegrationSystemSpec[] = [
  {
    sistema: 'Notifica',
    descricao: 'Leitura autenticada de notificações e documentos emitidos pelo sistema Notifica.',
    variaveis: [
      {
        nome: 'NOTIFICA_SUPABASE_URL',
        rotulo: 'URL do projeto Supabase do Notifica',
        tipo: 'url'
      },
      {
        nome: 'NOTIFICA_SUPABASE_SERVICE_ROLE_KEY',
        rotulo: 'Chave server-side (service_role) do Notifica',
        tipo: 'secret'
      }
    ]
  },
  {
    sistema: 'Classifica',
    descricao: 'Leitura autenticada de pareceres de classificação (CRI/DPA) do sistema Classifica.',
    variaveis: [
      {
        nome: 'CLASSIFICA_SUPABASE_URL',
        rotulo: 'URL do projeto Supabase do Classifica',
        tipo: 'url'
      },
      {
        nome: 'CLASSIFICA_SUPABASE_SERVICE_ROLE_KEY',
        rotulo: 'Chave server-side (service_role) do Classifica',
        tipo: 'secret'
      }
    ]
  },
  {
    sistema: 'Fiscaliza',
    descricao: 'Leitura autenticada de vistorias, ofícios e autos do sistema Fiscaliza.',
    variaveis: [
      {
        nome: 'FISCALIZA_SUPABASE_URL',
        rotulo: 'URL do projeto Supabase do Fiscaliza',
        tipo: 'url'
      },
      {
        nome: 'FISCALIZA_SUPABASE_SERVICE_ROLE_KEY',
        rotulo: 'Chave server-side (service_role) do Fiscaliza',
        tipo: 'secret'
      }
    ]
  }
];

function isValidHttpsUrl(rawValue: string): boolean {
  try {
    const parsed = new URL(rawValue);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function sendJson(res: VercelLikeResponse, statusCode: number, data: any): void {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(statusCode);
    res.json(data);
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
    sendJson(res, 405, { error: 'Método não permitido. Utilize GET.' });
    return;
  }

  const auth = await authorizeSemaLookupRequest(req);
  if (auth.configured && !auth.authorized) {
    sendJson(res, auth.httpStatus || 401, {
      error: auth.error || 'Autenticação obrigatória para verificar o status das integrações.'
    });
    return;
  }

  const sistemas = EXTERNAL_SYSTEM_SPECS.map(spec => {
    const variaveis = spec.variaveis.map(v => {
      const rawValue = (process.env[v.nome] || '').trim();
      const preenchida = Boolean(rawValue);
      const formatoValido =
        !preenchida
          ? false
          : v.tipo === 'url'
          ? isValidHttpsUrl(rawValue)
          : rawValue.length >= 20;

      return {
        nome: v.nome,
        rotulo: v.rotulo,
        tipo: v.tipo,
        configurada: preenchida,
        formatoValido
      };
    });

    const configurado = variaveis.every(v => v.configurada && v.formatoValido);

    return {
      sistema: spec.sistema,
      descricao: spec.descricao,
      configurado,
      variaveis
    };
  });

  sendJson(res, 200, {
    verificadoEm: new Date().toISOString(),
    sistemas
  });
}
