// api/car-lookup.ts
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

// Configuração confirmada no GetCapabilities da SEMA-MT (executada exclusivamente no servidor)
const GEOSERVER_URL = 'https://geo.sema.mt.gov.br/geoserver/wfs';
const GEOSERVER_AUTHKEY = '541085de-9a2e-454e-bdba-eb3d57a2f492';
const CAR_LAYER = 'Geoportal:CAR_ATP';

// Cache em memória para o nome do campo geométrico descoberto por DescribeFeatureType
let cachedGeomField: string | null = null;

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
 * Descobre o nome do campo geométrico da camada Geoportal:CAR_ATP via DescribeFeatureType.
 * Utiliza fallback seguro ('GEOMETRY', confirmado no DescribeFeatureType do GeoServer da SEMA-MT).
 */
async function discoverGeometryField(): Promise<string> {
  if (cachedGeomField) {
    return cachedGeomField;
  }

  try {
    const describeParams = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'DescribeFeatureType',
      typeNames: CAR_LAYER,
      outputFormat: 'application/json',
      authkey: GEOSERVER_AUTHKEY
    });

    const res = await fetchWithTimeout(`${GEOSERVER_URL}?${describeParams.toString()}`, 5000);
    if (res.ok) {
      const data = await res.json();
      const properties = data?.featureTypes?.[0]?.properties;
      if (Array.isArray(properties)) {
        const geomProp = properties.find((p: any) => {
          const typeStr = String(p?.type || '').toLowerCase();
          return (
            typeStr.startsWith('gml:') ||
            typeStr.includes('geometry') ||
            typeStr.includes('polygon') ||
            typeStr.includes('point') ||
            typeStr.includes('surface')
          );
        });

        if (geomProp?.name) {
          cachedGeomField = geomProp.name;
          return geomProp.name;
        }
      }
    }
  } catch {
    // Prossegue com fallback seguro confirmado
  }

  cachedGeomField = 'GEOMETRY';
  return cachedGeomField;
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  // Polyfill de compatibilidade uniforme (Vercel, Connect / Vite dev)
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

  // Extração dos parâmetros lat e lng
  let rawLat: any = req.query?.lat;
  let rawLng: any = req.query?.lng;

  if ((rawLat === undefined || rawLng === undefined) && req.url) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      rawLat = parsedUrl.searchParams.get('lat');
      rawLng = parsedUrl.searchParams.get('lng');
    } catch {}
  }

  if (rawLat === undefined || rawLat === null || rawLng === undefined || rawLng === null) {
    res.status(400)!.json!({
      error: 'Parâmetros "lat" e "lng" são obrigatórios (graus decimais geográficos, EPSG:4326).'
    });
    return;
  }

  const strLat = String(rawLat).trim();
  const strLng = String(rawLng).trim();

  // Validação estrita: rejeita valores incompletos ou strings com letras/símbolos não numéricos
  const strictDecimalRegex = /^[-+]?\d+(\.\d+)?$/;
  if (!strictDecimalRegex.test(strLat) || !strictDecimalRegex.test(strLng)) {
    res.status(400)!.json!({
      error: 'Coordenadas devem ser números decimais completos em graus (EPSG:4326).'
    });
    return;
  }

  const lat = parseFloat(strLat);
  const lng = parseFloat(strLng);

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400)!.json!({
      error: 'Coordenadas fora dos limites geográficos terrestres (lat entre -90 e 90, lng entre -180 e 180).'
    });
    return;
  }

  const geomField = await discoverGeometryField();

  // WKT em EPSG:4326 no GeoServer: POINT(lng lat) com ordem X Y
  const cqlFilter = `INTERSECTS(${geomField},POINT(${lng} ${lat}))`;

  const getFeatureParams = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: CAR_LAYER,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: '5',
    cql_filter: cqlFilter,
    authkey: GEOSERVER_AUTHKEY
  });

  const wfsUrl = `${GEOSERVER_URL}?${getFeatureParams.toString()}`;

  let responseData: any = null;
  let isTimeout = false;
  let lastHttpStatus = 0;

  // Execução com timeout máximo de 15 segundos e no máximo uma repetição em falha transitória
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      isTimeout = false;
      const response = await fetchWithTimeout(wfsUrl, 15000);
      lastHttpStatus = response.status;

      if (response.status >= 500) {
        continue;
      }

      if (!response.ok) {
        res.status(502)!.json!({
          error: `Falha na consulta ao Geoportal SEMA-MT (HTTP ${response.status}).`
        });
        return;
      }

      const text = await response.text();
      try {
        responseData = JSON.parse(text);
      } catch {
        res.status(502)!.json!({
          error: 'Resposta inválida recebida do Geoportal SEMA-MT.'
        });
        return;
      }
      break;
    } catch (err: any) {
      if (
        err?.name === 'AbortError' ||
        err?.message?.includes('aborted') ||
        err?.message?.includes('timeout') ||
        err?.code === 'ETIMEDOUT'
      ) {
        isTimeout = true;
      }
    }
  }

  if (!responseData) {
    if (isTimeout) {
      res.status(504)!.json!({
        error: 'Tempo limite esgotado ao consultar o Geoportal SEMA-MT (15 segundos).'
      });
      return;
    }
    res.status(502)!.json!({
      error: `Falha na comunicação com o Geoportal SEMA-MT${lastHttpStatus ? ` (HTTP ${lastHttpStatus})` : ''}. Tente novamente.`
    });
    return;
  }

  const rawFeatures = Array.isArray(responseData?.features)
    ? responseData.features.slice(0, 5)
    : [];

  // Preserva cada feição GeoJSON com seu objeto properties intacto
  const feicoes = rawFeatures.map((f: any) => ({
    type: f.type || 'Feature',
    id: f.id,
    geometry: f.geometry,
    geometry_name: f.geometry_name,
    properties: (f.properties && typeof f.properties === 'object') ? f.properties : {}
  }));

  res.status(200)!.json!({
    encontrado: feicoes.length > 0,
    feicoes,
    consultadoEm: new Date().toISOString()
  });
}
