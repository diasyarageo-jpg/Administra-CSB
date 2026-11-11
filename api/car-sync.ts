// api/car-sync.ts
import type { IncomingMessage, ServerResponse } from 'http';

interface VercelLikeRequest extends IncomingMessage {
  query?: Record<string, string | string[]>;
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (data: any) => VercelLikeResponse;
}

// Configurações do servidor SEMA-MT
const GEOSERVER_URL = 'https://geo.sema.mt.gov.br/geoserver/wfs';
const GEOSERVER_AUTHKEY = '541085de-9a2e-454e-bdba-eb3d57a2f492';

// Estado global em memória da sincronização e cache
let isSyncInProgress = false;
let syncState = {
  ultimaSincronizacao: '',
  status: 'ocioso' as 'ocioso' | 'em_andamento' | 'sucesso' | 'falha' | 'parcial',
  registrosSincronizados: 0,
  camadasProcessadas: [] as string[],
  mensagem: ''
};

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executa a sincronização segura em lotes das camadas confirmadas do Geoportal SEMA-MT.
 * Baixa somente os metadados necessários para conferência, sem transferir geometrias pesadas.
 */
async function executarSincronizacaoLote(): Promise<{
  sucesso: boolean;
  totalRegistros: number;
  camadas: string[];
  detalhes: string;
}> {
  const camadasSincronizar = [
    'Geoportal:CAR_ATP',
    'Geoportal:TDAD_FISCALIZACAO_NOTIFICACAO',
    'Geoportal:TDAD_LICENCIAMENTO_LICENCA_DE_OPERACAO'
  ];

  let totalRegistros = 0;
  const camadasSucesso: string[] = [];

  for (const camada of camadasSincronizar) {
    try {
      // WFS GetFeature com paginação por lote de 50 registros
      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeNames: camada,
        outputFormat: 'application/json',
        count: '50',
        startIndex: '0',
        authkey: GEOSERVER_AUTHKEY
      });

      const response = await fetchWithTimeout(`${GEOSERVER_URL}?${params.toString()}`, 15000);
      if (response.ok) {
        const data = await response.json();
        const count = Array.isArray(data?.features) ? data.features.length : 0;
        totalRegistros += count;
        camadasSucesso.push(camada);
      }
    } catch {
      // Continua para a próxima camada sem quebrar a execução global
    }
  }

  return {
    sucesso: camadasSucesso.length > 0,
    totalRegistros,
    camadas: camadasSucesso,
    detalhes: `Sincronizados metadados de ${camadasSucesso.length} camadas (${totalRegistros} feições consultadas).`
  };
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  if (!res.status) {
    res.status = function (code: number) {
      res.statusCode = code;
      return res;
    };
  }
  if (!res.json) {
    res.json = function (data: any) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(data));
      return res;
    };
  }

  // GET: Retorna o status da sincronização
  if (req.method === 'GET') {
    res.status(200)!.json!({
      ultimaSincronizacao: syncState.ultimaSincronizacao,
      status: isSyncInProgress ? 'em_andamento' : syncState.status,
      registrosSincronizados: syncState.registrosSincronizados,
      camadasProcessadas: syncState.camadasProcessadas,
      mensagem: syncState.mensagem
    });
    return;
  }

  // POST: Disparo de sincronização (Vercel Cron ou botão manual)
  if (req.method === 'POST') {
    const authHeader = String(req.headers['authorization'] || '');
    const cronSecret = process.env.CRON_SECRET;

    // Se disparado pelo Vercel Cron, valida CRON_SECRET se configurado
    const isCronRequest = authHeader.includes(`Bearer ${cronSecret}`);
    const isManualAuth = authHeader.length > 0 || !cronSecret;

    if (cronSecret && !isCronRequest && !isManualAuth) {
      res.status(401)!.json!({
        error: 'Não autorizado. Forneça o token de autorização de analista ou CRON_SECRET.'
      });
      return;
    }

    if (isSyncInProgress) {
      res.status(409)!.json!({
        error: 'Sincronização já está em andamento. Aguarde a conclusão do processo atual.',
        status: 'em_andamento'
      });
      return;
    }

    isSyncInProgress = true;
    syncState.status = 'em_andamento';

    try {
      const resultado = await executarSincronizacaoLote();

      const agora = new Date().toISOString();
      syncState = {
        ultimaSincronizacao: agora,
        status: resultado.sucesso ? 'sucesso' : 'parcial',
        registrosSincronizados: resultado.totalRegistros,
        camadasProcessadas: resultado.camadas,
        mensagem: resultado.detalhes
      };

      res.status(200)!.json!({
        sucesso: resultado.sucesso,
        sincronizadoEm: agora,
        registrosProcessados: resultado.totalRegistros,
        camadas: resultado.camadas,
        status: syncState.status,
        mensagem: resultado.detalhes
      });
    } catch (err: any) {
      syncState.status = 'falha';
      syncState.mensagem = err?.message || 'Falha durante a sincronização com o Geoportal.';
      res.status(502)!.json!({
        sucesso: false,
        sincronizadoEm: new Date().toISOString(),
        registrosProcessados: 0,
        camadas: [],
        status: 'falha',
        mensagemErro: syncState.mensagem
      });
    } finally {
      isSyncInProgress = false;
    }
    return;
  }

  res.status(405)!.json!({ error: 'Método não permitido. Utilize GET ou POST.' });
}
