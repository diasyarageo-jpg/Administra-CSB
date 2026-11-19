// api/car-lookup.ts
import type { IncomingMessage, ServerResponse } from 'http';
import {
  SEMA_FIELD_CANDIDATES,
  resolveConfirmedFields,
  preserveSemaProperties,
  sanitizeSemaProperties,
  extractConfirmedFieldValue,
  stripOuterQuotesAndBrackets
} from '../src/config/carCampos';
import {
  authorizeSemaLookupRequest,
  canViewFullSemaPersonalData,
  parseSemaAuditTargetContext,
  recordSemaServerAuditDetailed,
  scrubSensitiveTextForServerLog,
  sha256HexServer,
  validateTargetEntityAccess
} from '../src/server/semaAudit';
import {
  describeSemaLayerXml,
  executeSemaGetFeature,
  getCachedLayerSchema,
  getSemaCapabilities
} from '../src/server/semaGeoserver';

interface VercelLikeRequest extends IncomingMessage {
  query?: Record<string, string | string[]>;
  body?: any;
  method?: string;
  url?: string;
}

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (data: any) => VercelLikeResponse;
}

type CamadaStatusCode =
  | 'consultada'
  | 'sem_resultados'
  | 'nao_suportado'
  | 'indisponivel'
  | 'filtro_incompativel'
  | 'erro_comunicacao';

interface CamadaStatus {
  camada: string;
  titulo?: string;
  status: CamadaStatusCode;
  suportado: boolean;
  registrosEncontrados: number;
  camposPesquisados?: string[];
  camposConfirmados?: string[];
  mensagem: string;
}

const CAR_LAYER = 'Geoportal:CAR_ATP';
const CAR_REQUERIDO_LAYER = 'Geoportal:MVW_REQUERIMENTO_ATP';

async function readJsonBody(req: VercelLikeRequest): Promise<Record<string, any>> {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body);
  }
  return await new Promise<Record<string, any>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const MAX_BYTES = 16 * 1024;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BYTES) {
        reject(new Error('Requisição excede o tamanho máximo permitido.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Dados de consulta inválidos.'));
      }
    });
    req.on('error', err => reject(err));
  });
}

function inspectConfirmedCpfCnpj(
  rawProps: Record<string, any>,
  confirmedDocFields: string[],
  confirmedOwnerFields: string[]
): {
  cpfCnpjCompletoDisponivel: boolean;
  cpfCnpjCampoOrigem?: string;
  cpfCnpjStatus: 'completo' | 'mascarado' | 'ausente';
  docDigits?: string;
} {
  let sawMasked = false;
  for (const field of confirmedDocFields) {
    const val = rawProps[field];
    if (val === undefined || val === null) continue;
    const str = String(val).trim();
    if (!str) continue;
    if (/[x*]/i.test(str)) {
      sawMasked = true;
      continue;
    }
    const digits = str.replace(/\D/g, '');
    if (digits.length === 11 || digits.length === 14) {
      return {
        cpfCnpjCompletoDisponivel: true,
        cpfCnpjCampoOrigem: field,
        cpfCnpjStatus: 'completo',
        docDigits: digits
      };
    }
  }
  for (const field of confirmedOwnerFields) {
    const val = rawProps[field];
    if (val === undefined || val === null) continue;
    const str = String(val).trim();
    if (!str) continue;
    const fullMatch =
      str.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/) ||
      str.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/) ||
      str.match(/(?<![\d/.\-xX*])(\d{14}|\d{11})(?![\d/.\-xX*])/);
    if (fullMatch?.[0]) {
      const digits = fullMatch[0].replace(/\D/g, '');
      return {
        cpfCnpjCompletoDisponivel: true,
        cpfCnpjCampoOrigem: field,
        cpfCnpjStatus: 'completo',
        docDigits: digits
      };
    }
    if (/x{2,}\d+x{2,}|\*{2,}/i.test(str)) {
      sawMasked = true;
    }
  }
  return {
    cpfCnpjCompletoDisponivel: false,
    cpfCnpjStatus: sawMasked ? 'mascarado' : 'ausente'
  };
}

function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function collectGeometryVertices(geom: any, acc: Array<[number, number]>): void {
  if (!geom || !geom.coordinates) return;
  const pushPair = (coord: any) => {
    if (Array.isArray(coord) && coord.length >= 2) {
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        acc.push([lng, lat]);
      }
    }
  };
  const walk = (node: any) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      pushPair(node);
      return;
    }
    for (const child of node) {
      walk(child);
    }
  };
  walk(geom.coordinates);
}

export function estimateGeometryDistanceMeters(
  geom: any,
  lat: number,
  lng: number
): number | null {
  if (!geom || typeof geom !== 'object') return null;
  const pts: Array<[number, number]> = [];
  collectGeometryVertices(geom, pts);
  if (pts.length === 0) return null;

  let minDist = Infinity;
  let sumLat = 0;
  let sumLng = 0;
  for (const [vLng, vLat] of pts) {
    sumLat += vLat;
    sumLng += vLng;
    const d = haversineDistanceMeters(lat, lng, vLat, vLng);
    if (d < minDist) minDist = d;
  }
  const centroidDist = haversineDistanceMeters(lat, lng, sumLat / pts.length, sumLng / pts.length);
  const best = Math.min(minDist, centroidDist);
  return Number.isFinite(best) ? Math.round(best) : null;
}

function buildProximityBboxCql(
  geomField: string,
  lat: number,
  lng: number,
  raioMetros: number
): string {
  const safeLat = Math.max(-85, Math.min(85, lat));
  const deltaLat = raioMetros / 111320;
  const cosLat = Math.max(0.2, Math.cos((safeLat * Math.PI) / 180));
  const deltaLng = raioMetros / (111320 * cosLat);
  const minLng = (lng - deltaLng).toFixed(6);
  const minLat = (lat - deltaLat).toFixed(6);
  const maxLng = (lng + deltaLng).toFixed(6);
  const maxLat = (lat + deltaLat).toFixed(6);
  return `BBOX(${geomField},${minLng},${minLat},${maxLng},${maxLat},'EPSG:4326')`;
}

async function queryLayerSpatial(
  layerName: string,
  layerTitle: string | undefined,
  geomField: string,
  confirmedNonGeomFields: string[],
  confirmedDocFields: string[],
  confirmedOwnerFields: string[],
  lat: number,
  lng: number,
  maxFeatures: number,
  options?: {
    incluirProximidade?: boolean;
    raioMetros?: number;
  }
): Promise<{
  status: CamadaStatus;
  features: any[];
  isTimeout: boolean;
}> {
  const cqlFilter = `INTERSECTS(${geomField},POINT(${lng} ${lat}))`;

  let criterioUsado: 'INTERSECTS' | 'BBOX_PROXIMIDADE' = 'INTERSECTS';
  let res = await executeSemaGetFeature({
    layerName,
    cqlFilter,
    propertyNames: [],
    includeSrs4326: true,
    maxFeatures,
    spatialGeomField: geomField,
    spatialPoints: [{ lat, lng }]
  });

  if (!res.ok) {
    const isFilterErr = Boolean(res.isFilterIncompatible);
    const httpSuffix = res.httpStatus ? ` (HTTP ${res.httpStatus})` : '';
    return {
      status: {
        camada: layerName,
        titulo: layerTitle,
        status: isFilterErr ? 'filtro_incompativel' : 'erro_comunicacao',
        suportado: !isFilterErr,
        registrosEncontrados: 0,
        camposPesquisados: [geomField],
        mensagem: isFilterErr
          ? 'Filtro de localização não compatível com esta base.'
          : res.isTimeout
          ? 'Tempo limite esgotado ao consultar a base da SEMA-MT.'
          : `Falha ao consultar a base da SEMA-MT${httpSuffix}.`
      },
      features: [],
      isTimeout: Boolean(res.isTimeout)
    };
  }

  let rawFeatures = res.features;
  const raioMetros = Math.min(5000, Math.max(250, Number(options?.raioMetros || 1500)));
  if (
    rawFeatures.length === 0 &&
    options?.incluirProximidade &&
    layerName === CAR_LAYER
  ) {
    const bboxCql = buildProximityBboxCql(geomField, lat, lng, raioMetros);
    const proxRes = await executeSemaGetFeature({
      layerName,
      cqlFilter: bboxCql,
      propertyNames: [],
      includeSrs4326: true,
      maxFeatures
    });
    if (proxRes.ok && proxRes.features.length > 0) {
      criterioUsado = 'BBOX_PROXIMIDADE';
      rawFeatures = proxRes.features;
    }
  }

  const consultadoEm = new Date().toISOString();
  const pickBboxPublicProps = (rawProps: Record<string, any>, distMetros: number): Record<string, any> => {
    const allowedMap = new Map<string, string>();
    for (const [k, v] of Object.entries(rawProps || {})) {
      const upper = k.toUpperCase();
      if (
        upper === 'NUMEROESTADUAL' ||
        upper === 'CAR_ESTADUAL' ||
        upper === 'CAR_FEDERAL' ||
        upper === 'CODIGO_CAR_FEDERAL' ||
        upper === 'PROTOCOLO' ||
        upper === 'PROTOCOLO_NUMERO' ||
        upper === 'NOMEPROPRIEDADE' ||
        upper === 'NOME_PROPRIEDADE'
      ) {
        allowedMap.set(k, v !== undefined && v !== null ? String(v) : '');
      }
    }
    const out: Record<string, any> = {};
    for (const [k, v] of allowedMap.entries()) {
      out[k] = typeof v === 'string' ? stripOuterQuotesAndBrackets(v).replace(/"/g, '').trim() : v;
    }
    out.DISTANCIA_ESTIMADA_METROS = distMetros;
    return out;
  };

  const mappedFeatures = rawFeatures.slice(0, maxFeatures).map((f: any) => {
    const rawProps = f.properties && typeof f.properties === 'object' ? f.properties : {};
    const distMetros =
      criterioUsado === 'INTERSECTS'
        ? 0
        : estimateGeometryDistanceMeters(f.geometry, lat, lng) ?? raioMetros;

    if (criterioUsado === 'BBOX_PROXIMIDADE') {
      const bboxProps = pickBboxPublicProps(rawProps, distMetros);
      return {
        type: f.type || 'Feature',
        id: f.id,
        geometry: f.geometry,
        geometry_name: f.geometry_name,
        camadaOrigem: layerName,
        _schemaMeta: {
          camposConfirmados: Object.keys(bboxProps),
          cpfCnpjCompletoDisponivel: false,
          cpfCnpjStatus: 'ausente' as const
        },
        _spatialMeta: {
          criterioEspacial: criterioUsado,
          distanciaMetros: distMetros,
          raioPesquisadoMetros: raioMetros,
          camada: layerName,
          fonte: 'SEMA-MT Geoportal (WFS Público)',
          consultadoEm,
          evidenciaNota:
            'Evidência espacial por proximidade (BBOX) — retorna apenas CAR, nome da propriedade e distância estimada, sem dados pessoais.'
        },
        _auditDocDigits: undefined,
        _rawProperties: bboxProps,
        properties: bboxProps
      };
    }

    const docInspection = inspectConfirmedCpfCnpj(rawProps, confirmedDocFields, confirmedOwnerFields);
    const { docDigits, ...publicDocInspection } = docInspection;
    return {
      type: f.type || 'Feature',
      id: f.id,
      geometry: f.geometry,
      geometry_name: f.geometry_name,
      camadaOrigem: layerName,
      _schemaMeta: {
        camposConfirmados: confirmedNonGeomFields,
        ...publicDocInspection
      },
      _spatialMeta: {
        criterioEspacial: criterioUsado,
        distanciaMetros: distMetros,
        camada: layerName,
        fonte: 'SEMA-MT Geoportal (WFS Público)',
        consultadoEm,
        evidenciaNota:
          'Evidência espacial apenas — a coordenada pode representar sede, vertedouro ou outra área do processo e não confirma vínculo automaticamente.'
      },
      _auditDocDigits: docDigits,
      _rawProperties: rawProps,
      properties: preserveSemaProperties(rawProps, confirmedDocFields)
    };
  });

  if (criterioUsado === 'BBOX_PROXIMIDADE') {
    mappedFeatures.sort(
      (a, b) => (a._spatialMeta?.distanciaMetros ?? 999999) - (b._spatialMeta?.distanciaMetros ?? 999999)
    );
  }

  return {
    status: {
      camada: layerName,
      titulo: layerTitle,
      status: mappedFeatures.length > 0 ? 'consultada' : 'sem_resultados',
      suportado: true,
      registrosEncontrados: mappedFeatures.length,
      camposPesquisados: [geomField],
      camposConfirmados: confirmedNonGeomFields,
      mensagem:
        mappedFeatures.length > 0
          ? criterioUsado === 'BBOX_PROXIMIDADE'
            ? `${mappedFeatures.length} imóvel(is) próximo(s) localizado(s) por BBOX (raio ~${raioMetros}m) para análise de evidência.`
            : `${mappedFeatures.length} imóvel(is) localizado(s) por interseção direta para a coordenada.`
          : 'Consulta concluída sem imóveis para esta coordenada.'
    },
    features: mappedFeatures,
    isTimeout: false
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

  const method = (req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.status(204)!.end();
    return;
  }

  if (method !== 'GET' && method !== 'POST') {
    res.status(405)!.json!({ error: 'Método não permitido. Utilize GET ou POST.' });
    return;
  }

  const authCtx = await authorizeSemaLookupRequest(req as any);
  if (!authCtx.authorized) {
    res.status(authCtx.httpStatus || 401)!.json!({
      error: authCtx.error || 'Autenticação obrigatória.'
    });
    return;
  }

  let rawLat: any = req.query?.lat;
  let rawLng: any = req.query?.lng;
  let rawTargetTipo: any = req.query?.entidadeAlvoTipo;
  let rawTargetId: any = req.query?.entidadeAlvoId;
  let rawIncluirProximidade: any = req.query?.incluirProximidade;
  let rawRaioMetros: any = req.query?.raioMetros;

  if (method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (body.lat !== undefined) rawLat = body.lat;
      if (body.lng !== undefined) rawLng = body.lng;
      if (body.entidadeAlvoTipo !== undefined) rawTargetTipo = body.entidadeAlvoTipo;
      if (body.entidadeAlvoId !== undefined) rawTargetId = body.entidadeAlvoId;
      if (body.incluirProximidade !== undefined) rawIncluirProximidade = body.incluirProximidade;
      if (body.raioMetros !== undefined) rawRaioMetros = body.raioMetros;
    } catch (err: any) {
      res.status(400)!.json!({
        error: err?.message || 'Dados inválidos na requisição.'
      });
      return;
    }
  } else if (
    (rawLat === undefined ||
      rawLng === undefined ||
      rawTargetTipo === undefined ||
      rawTargetId === undefined ||
      rawIncluirProximidade === undefined) &&
    req.url
  ) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      if (rawLat === undefined) rawLat = parsedUrl.searchParams.get('lat');
      if (rawLng === undefined) rawLng = parsedUrl.searchParams.get('lng');
      if (rawTargetTipo === undefined) rawTargetTipo = parsedUrl.searchParams.get('entidadeAlvoTipo');
      if (rawTargetId === undefined) rawTargetId = parsedUrl.searchParams.get('entidadeAlvoId');
      if (rawIncluirProximidade === undefined) {
        rawIncluirProximidade = parsedUrl.searchParams.get('incluirProximidade');
      }
      if (rawRaioMetros === undefined) rawRaioMetros = parsedUrl.searchParams.get('raioMetros');
    } catch {}
  }

  const incluirProximidade =
    rawIncluirProximidade === true ||
    rawIncluirProximidade === 'true' ||
    rawIncluirProximidade === '1';
  const raioMetrosParsed = Number(rawRaioMetros);
  const raioMetros =
    Number.isFinite(raioMetrosParsed) && raioMetrosParsed > 0 ? raioMetrosParsed : 1500;

  const targetCtx = parseSemaAuditTargetContext({
    entidadeAlvoTipo: rawTargetTipo,
    entidadeAlvoId: rawTargetId
  });
  const targetAccess = await validateTargetEntityAccess(authCtx, targetCtx);
  if (!targetAccess.ok) {
    res.status(targetAccess.httpStatus || 403)!.json!({
      error: targetAccess.error || 'Sem permissão para o registro alvo informado.'
    });
    return;
  }

  if (rawLat === undefined || rawLat === null || rawLng === undefined || rawLng === null) {
    res.status(400)!.json!({
      error: 'Parâmetros "lat" e "lng" são obrigatórios em graus decimais (EPSG:4326).'
    });
    return;
  }

  const strLat = String(rawLat).trim();
  const strLng = String(rawLng).trim();

  const strictDecimalRegex = /^[-+]?\d+(?:\.\d+)?$/;
  if (!strictDecimalRegex.test(strLat) || !strictDecimalRegex.test(strLng)) {
    res.status(400)!.json!({
      error:
        'Coordenadas inválidas. A API aceita apenas números decimais em graus (EPSG:4326), rejeitando GMS direto.'
    });
    return;
  }

  const lat = parseFloat(strLat);
  const lng = parseFloat(strLng);

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400)!.json!({
      error: 'Coordenadas fora dos limites geográficos (lat entre -90 e 90, lng entre -180 e 180).'
    });
    return;
  }

  const capResult = await getSemaCapabilities();
  const hasConfirmedCatalog = capResult.ok && capResult.wfsLayers.size > 0;
  const camadasConsultadas: CamadaStatus[] = [];
  const collectedFeatures: any[] = [];
  let primaryFailed = false;
  let anyTimeout = Boolean(capResult.isTimeout);

  const targetLayers = [CAR_LAYER, CAR_REQUERIDO_LAYER];

  if (hasConfirmedCatalog || !capResult.isTimeout) {
    for (const layerName of targetLayers) {
      const capInfo = capResult.wfsLayers.get(layerName);
      if (hasConfirmedCatalog && !capInfo) {
        camadasConsultadas.push({
          camada: layerName,
          status: 'indisponivel',
          suportado: false,
          registrosEncontrados: 0,
          mensagem: 'Base não disponível no momento.'
        });
        if (layerName === CAR_LAYER) primaryFailed = true;
        continue;
      }

      const schemaRes = await describeSemaLayerXml(layerName);
      const primaryGeomField = Array.from(schemaRes.geomFields)[0] || null;
      if (!schemaRes.ok || !primaryGeomField) {
        camadasConsultadas.push({
          camada: layerName,
          titulo: capInfo?.title || layerName,
          status: schemaRes.ok ? 'nao_suportado' : 'indisponivel',
          suportado: false,
          registrosEncontrados: 0,
          mensagem: schemaRes.ok
            ? 'Base sem referência geográfica para consulta por coordenada.'
            : schemaRes.errorMsg || 'Não foi possível consultar a estrutura desta base.'
        });
        if (schemaRes.isTimeout) anyTimeout = true;
        if (layerName === CAR_LAYER) primaryFailed = true;
        continue;
      }

      const remaining = 5 - collectedFeatures.length;
      if (remaining <= 0) break;

      const confirmedNonGeomFields = Array.from(schemaRes.fields.keys()).filter(
        fieldName => !schemaRes.geomFields.has(fieldName)
      );
      const confirmedDocFields = resolveConfirmedFields(
        schemaRes.fields,
        SEMA_FIELD_CANDIDATES.documento
      );
      const confirmedOwnerFields = resolveConfirmedFields(
        schemaRes.fields,
        SEMA_FIELD_CANDIDATES.titular
      );

      const queryRes = await queryLayerSpatial(
        layerName,
        capInfo?.title || layerName,
        primaryGeomField,
        confirmedNonGeomFields,
        confirmedDocFields,
        confirmedOwnerFields,
        lat,
        lng,
        remaining,
        {
          incluirProximidade,
          raioMetros
        }
      );

      camadasConsultadas.push(queryRes.status);
      if (queryRes.isTimeout) anyTimeout = true;

      if (
        layerName === CAR_LAYER &&
        (queryRes.status.status === 'erro_comunicacao' ||
          queryRes.status.status === 'filtro_incompativel' ||
          queryRes.status.status === 'indisponivel')
      ) {
        primaryFailed = true;
      }

      if (queryRes.features.length > 0) {
        collectedFeatures.push(...queryRes.features);
      }
    }
  } else {
    primaryFailed = true;
    for (const layerName of targetLayers) {
      camadasConsultadas.push({
        camada: layerName,
        titulo: layerName,
        status: 'erro_comunicacao',
        suportado: false,
        registrosEncontrados: 0,
        mensagem: capResult.errorMsg || 'Tempo limite esgotado ao conectar com a base pública da SEMA-MT.'
      });
    }
  }

  const consultadoEm = new Date().toISOString();
  const hasAnyValidSuccess = camadasConsultadas.some(
    c => c.status === 'consultada' || c.status === 'sem_resultados'
  );

  if ((!hasAnyValidSuccess || primaryFailed) && collectedFeatures.length === 0) {
    const firstErr = camadasConsultadas.find(
      c =>
        c.status === 'erro_comunicacao' ||
        c.status === 'filtro_incompativel' ||
        c.status === 'indisponivel'
    );
    res.status(anyTimeout ? 504 : 502)!.json!({
      error:
        firstErr?.mensagem ||
        'Não foi possível concluir a consulta espacial no Geoportal SEMA-MT.',
      camadasConsultadas,
      consultadoEm
    });
    return;
  }

  const canViewFullPii = canViewFullSemaPersonalData(authCtx);
  const coordAuditHash = `sha256:${sha256HexServer(`${lat.toFixed(6)},${lng.toFixed(6)}`).slice(0, 24)}`;

  const finalFeatures = await Promise.all(
    collectedFeatures.slice(0, 5).map(async feat => {
      const { _auditDocDigits, _rawProperties, ...publicFeature } = feat;
      const rawProps = _rawProperties || feat.properties || {};
      const schemaFieldMap =
        getCachedLayerSchema(feat.camadaOrigem)?.fields || new Map<string, string>();
      const carVal =
        extractConfirmedFieldValue(rawProps, schemaFieldMap, SEMA_FIELD_CANDIDATES.carEstadual) ||
        extractConfirmedFieldValue(rawProps, schemaFieldMap, SEMA_FIELD_CANDIDATES.carFederal) ||
        extractConfirmedFieldValue(rawProps, schemaFieldMap, SEMA_FIELD_CANDIDATES.protocolo);
      const isBbox = feat._spatialMeta?.criterioEspacial === 'BBOX_PROXIMIDADE';
      const titularRaw = isBbox
        ? undefined
        : extractConfirmedFieldValue(rawProps, schemaFieldMap, SEMA_FIELD_CANDIDATES.titular);
      const titularClean = titularRaw
        ? scrubSensitiveTextForServerLog(stripOuterQuotesAndBrackets(titularRaw))
        : undefined;
      const camposConsultados = Object.keys(feat.properties || {});

      const auditRes = await recordSemaServerAuditDetailed(authCtx, targetAccess.resolvedTarget, {
        criterioTipo: 'coordenada',
        criterioValor: coordAuditHash,
        camada: feat.camadaOrigem || CAR_LAYER,
        featureId: String(feat.id || carVal || 'sema_feature'),
        car: carVal,
        rawProps,
        docStatus: feat._schemaMeta?.cpfCnpjStatus || 'ausente',
        docDigits: isBbox ? undefined : _auditDocDigits,
        camposConsultados,
        consultadoEm,
        extraSafeAttrs: {
          criterioEspacial: feat._spatialMeta?.criterioEspacial || 'INTERSECTS',
          ...(titularClean ? { titularNome: titularClean } : {}),
          ...(!isBbox && _auditDocDigits
            ? { tipoPessoa: _auditDocDigits.length === 11 ? 'Pessoa física' : 'Pessoa jurídica' }
            : {})
        }
      });

      const auditOk = Boolean(auditRes.ok && auditRes.auditoriaId);
      const allowFullPersonalData = !isBbox && canViewFullPii && auditOk;

      let outProperties = publicFeature.properties;
      let outSchemaMeta = publicFeature._schemaMeta
        ? { ...publicFeature._schemaMeta }
        : undefined;

      if (!isBbox && !allowFullPersonalData) {
        const hadDoc = Boolean(
          _auditDocDigits ||
            outSchemaMeta?.cpfCnpjStatus === 'completo' ||
            outSchemaMeta?.cpfCnpjStatus === 'mascarado'
        );
        outProperties = sanitizeSemaProperties(outProperties || {}, []);
        if (outSchemaMeta) {
          outSchemaMeta.cpfCnpjCompletoDisponivel = false;
          outSchemaMeta.cpfCnpjStatus = hadDoc ? 'mascarado' : 'ausente';
          delete outSchemaMeta.cpfCnpjCampoOrigem;
        }
      }

      return {
        ...publicFeature,
        properties: outProperties,
        ...(outSchemaMeta ? { _schemaMeta: outSchemaMeta } : {}),
        auditoriaDisponivel: auditOk,
        ...(auditOk ? { auditoriaId: auditRes.auditoriaId } : {})
      };
    })
  );

  const auditoriaDisponivel =
    finalFeatures.length > 0
      ? finalFeatures.every(f => f.auditoriaDisponivel === true)
      : Boolean(authCtx.configured && authCtx.authorized && authCtx.role !== 'Visualizador');

  const mensagemStatus =
    finalFeatures.length > 0
      ? `${finalFeatures.length} imóvel(is) encontrado(s) para a coordenada informada.`
      : 'Consulta concluída com sucesso; nenhum imóvel encontrado nesta coordenada nas camadas consultadas.';

  res.status(200)!.json!({
    encontrado: finalFeatures.length > 0,
    feicoes: finalFeatures,
    camadasConsultadas,
    mensagemStatus,
    auditoriaDisponivel,
    consultadoEm
  });
}
