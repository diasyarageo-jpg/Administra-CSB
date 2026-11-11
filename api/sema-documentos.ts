// api/sema-documentos.ts
import type { IncomingMessage, ServerResponse } from 'http';

interface VercelLikeRequest extends IncomingMessage {
  query?: Record<string, string | string[]>;
  method?: string;
  url?: string;
}

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (data: any) => VercelLikeResponse;
}

const GEOSERVER_URL = 'https://geo.sema.mt.gov.br/geoserver/wfs';
const GEOSERVER_AUTHKEY = '541085de-9a2e-454e-bdba-eb3d57a2f492';

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

  if (req.method && req.method !== 'GET') {
    res.status(405)!.json!({ error: 'Método não permitido. Utilize GET.' });
    return;
  }

  let rawCpfCnpj: any = req.query?.cpfCnpj;
  let rawProcesso: any = req.query?.processo;

  if (req.url && (!rawCpfCnpj || !rawProcesso)) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      if (!rawCpfCnpj) rawCpfCnpj = parsedUrl.searchParams.get('cpfCnpj');
      if (!rawProcesso) rawProcesso = parsedUrl.searchParams.get('processo');
    } catch {}
  }

  const cleanDoc = String(rawCpfCnpj || '').replace(/\D/g, '');
  const cleanProc = String(rawProcesso || '').trim();

  if (!cleanDoc && !cleanProc) {
    res.status(400)!.json!({
      error: 'Informe um CPF/CNPJ válido ou número de processo para pesquisa de documentos.'
    });
    return;
  }

  // Camadas oficiais SEMA-MT publicadas no GeoServer que contêm campos de documentos e CPF/CNPJ
  const camadasParaConsultar = [
    { nome: 'Geoportal:TDAD_LICENCIAMENTO_LICENCA_DE_OPERACAO', grupo: 'licencas' },
    { nome: 'Geoportal:TDAD_LICENCIAMENTO_LICENCA_DE_INSTALACAO', grupo: 'licencas' },
    { nome: 'Geoportal:TDAD_LICENCIAMENTO_LICENCA_PREVIA', grupo: 'licencas' },
    { nome: 'Geoportal:TDAD_FISCALIZACAO_NOTIFICACAO', grupo: 'notificacoes' },
    { nome: 'Geoportal:TDAD_FISCALIZACAO_AUTO_DE_INFRACAO', grupo: 'autosInfracao' },
    { nome: 'Geoportal:TDAD_FISCALIZACAO_TERMO_DE_EMBARGO', grupo: 'termosEmbargo' }
  ];

  const resultado = {
    licencas: [] as any[],
    notificacoes: [] as any[],
    autosInfracao: [] as any[],
    termosEmbargo: [] as any[],
    outros: [] as any[]
  };

  const camadasConsultadas: string[] = [];

  for (const cam of camadasParaConsultar) {
    try {
      camadasConsultadas.push(cam.nome);

      let cql = '';
      if (cleanDoc) {
        cql = `CPF_CNPJ LIKE '%${cleanDoc}%'`;
      }
      if (cleanProc) {
        const procFilter = `NUMERO_PROCESSO LIKE '%${cleanProc}%'`;
        cql = cql ? `(${cql}) AND (${procFilter})` : procFilter;
      }

      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeNames: cam.nome,
        outputFormat: 'application/json',
        count: '20',
        cql_filter: cql,
        authkey: GEOSERVER_AUTHKEY
      });

      const response = await fetchWithTimeout(`${GEOSERVER_URL}?${params.toString()}`, 8000);
      if (response.ok) {
        const data = await response.json();
        const features = Array.isArray(data?.features) ? data.features : [];

        for (const f of features) {
          const p = f.properties || {};
          const item = {
            id: String(f.id || p.ID || Math.random().toString(36).substring(2, 9)),
            tipo: String(p.TIPO || p.NOME_DOCUMENTO || 'Documento SEMA'),
            numeroDocumento: String(p.NUMERO_DOCUMENTO || '—'),
            nomeDocumento: String(p.NOME_DOCUMENTO || p.TIPO || '—'),
            dataDocumento: String(p.DATA_DOCUMENTO || p.DATA_LANCAMENTO || '—'),
            dataValidade: p.DATA_VALIDADE && p.DATA_VALIDADE !== 'nan' ? String(p.DATA_VALIDADE) : undefined,
            numeroProcesso: p.NUMERO_PROCESSO && p.NUMERO_PROCESSO !== 'nan' ? String(p.NUMERO_PROCESSO) : undefined,
            status: String(p.STATUS || 'Emitido'),
            razaoSocial: p.RAZAO_SOCIAL ? String(p.RAZAO_SOCIAL) : undefined,
            cpfCnpj: p.CPF_CNPJ ? String(p.CPF_CNPJ) : undefined,
            municipio: p.MUNICIPIO ? String(p.MUNICIPIO) : undefined,
            linkDocumento: p.LINK_DOCUMENTO && p.LINK_DOCUMENTO !== 'nan' ? String(p.LINK_DOCUMENTO) : undefined,
            camadaOrigem: cam.nome,
            propriedadesBrutas: p
          };

          if (cam.grupo === 'licencas') resultado.licencas.push(item);
          else if (cam.grupo === 'notificacoes') resultado.notificacoes.push(item);
          else if (cam.grupo === 'autosInfracao') resultado.autosInfracao.push(item);
          else if (cam.grupo === 'termosEmbargo') resultado.termosEmbargo.push(item);
          else resultado.outros.push(item);
        }
      }
    } catch {
      // Prossegue sem interromper a consulta às outras camadas
    }
  }

  const total =
    resultado.licencas.length +
    resultado.notificacoes.length +
    resultado.autosInfracao.length +
    resultado.termosEmbargo.length +
    resultado.outros.length;

  let mensagemStatus = '';
  if (total > 0) {
    mensagemStatus = `${total} registro(s) encontrado(s) nas camadas oficiais da SEMA-MT para este identificador.`;
  } else {
    mensagemStatus =
      'Nenhum registro oficial encontrado nas camadas consultadas da SEMA-MT para o CPF/CNPJ informado. Nota: a camada CAR_ATP não disponibiliza pesquisa por CPF/CNPJ desmascarado.';
  }

  res.status(200)!.json!({
    sucesso: true,
    cpfCnpjConsultado: cleanDoc,
    ...resultado,
    totalRegistros: total,
    consultadoEm: new Date().toISOString(),
    mensagemStatus,
    camadasConsultadas
  });
}
