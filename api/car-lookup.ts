// api/car-lookup.ts
import type { IncomingMessage, ServerResponse } from 'http';
import {
  SEMA_FIELD_CANDIDATES,
  resolveConfirmedFields,
  preserveSemaProperties,
  extractConfirmedFieldValue,
  stripOuterQuotesAndBrackets
} from '../src/config/carCampos';
import {
  authorizeSemaLookupRequest,
  parseSemaAuditTargetContext,
  recordSemaServerAudit,
  validateTargetEntityAccess
} from '../src/server/semaAudit';

interface VercelLikeRequest extends IncomingMessage {
  query?: Record<string, string | string[]>;
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

const WFS_URL = 'https://geo.sema.mt.gov.br/geoserver/wfs';
const GEOSERVER_AUTHKEY =
  process.env.SEMA_GEOSERVER_AUTHKEY ||
  process.env.GEOSERVER_AUTHKEY ||
  '541085de-9a2e-454e-bdba-eb3d57a2f492';
const CAR_LAYER = 'Geoportal:CAR_ATP';
const CAR_REQUERIDO_LAYER = 'Geoportal:MVW_REQUERIMENTO_ATP';

const CACHE_TTL_MS = 10 * 60 * 1000;

interface WfsCapabilitiesCache {
  fetchedAt: number;
  layers: Map<string, { name: string; title: string }>;
}

interface LayerSchemaCache {
  fetchedAt: number;
  geomField: string | null;
  fields: Map<string, string>;
}

let capabilitiesCache: WfsCapabilitiesCache | null = null;
const schemaCache = new Map<string, LayerSchemaCache>();

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isTimeoutError(err: any): boolean {
  return Boolean(
    err?.name === 'AbortError' ||
      String(err?.message || '').toLowerCase().includes('abort') ||
      String(err?.message || '').toLowerCase().includes('timeout') ||
      err?.code === 'ETIMEDOUT'
  );
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function getWfsCapabilities(): Promise<{
  ok: boolean;
  layers: Map<string, { name: string; title: string }>;
  isTimeout?: boolean;
  errorMsg?: string;
}> {
  if (capabilitiesCache && Date.now() - capabilitiesCache.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, layers: capabilitiesCache.layers };
  }

  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetCapabilities',
    authkey: GEOSERVER_AUTHKEY
  });

  try {
    const res = await fetchWithTimeout(`${WFS_URL}?${params.toString()}`, 12000);
      if (!res.ok) {
        return {
          ok: false,
          layers: new Map(),
          errorMsg: `Serviço público da SEMA-MT retornou HTTP ${res.status}.`
        };
      }

      const xml = await res.text();
      const layers = new Map<string, { name: string; title: string }>();
      const ftMatches = xml.matchAll(/<FeatureType(?:\s[^>]*)?>([\s\S]*?)<\/FeatureType>/gi);

      for (const match of ftMatches) {
        const block = match[1] || '';
        const nameMatch = block.match(/<(?:[\w-]+:)?Name>([^<]+)<\/(?:[\w-]+:)?Name>/i);
        if (!nameMatch) continue;
        const name = decodeXmlEntities(nameMatch[1]);
        const titleMatch = block.match(/<(?:[\w-]+:)?Title>([^<]*)<\/(?:[\w-]+:)?Title>/i);
        const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : name;
        layers.set(name, { name, title });
      }

      capabilitiesCache = { fetchedAt: Date.now(), layers };
      return { ok: true, layers };
    } catch (err: any) {
      return {
        ok: false,
        layers: new Map(),
        isTimeout: isTimeoutError(err),
        errorMsg: isTimeoutError(err)
          ? 'Tempo limite esgotado ao conectar com o serviço da SEMA-MT.'
          : 'Falha de comunicação ao conectar com o serviço da SEMA-MT.'
      };
    }
}

async function describeLayerSchemaXml(layerName: string): Promise<{
  ok: boolean;
  geomField: string | null;
  fields: Map<string, string>;
  errorMsg?: string;
}> {
  const cached = schemaCache.get(layerName);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, geomField: cached.geomField, fields: cached.fields };
  }

  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'DescribeFeatureType',
    typeNames: layerName,
    authkey: GEOSERVER_AUTHKEY
  });

  try {
    const res = await fetchWithTimeout(`${WFS_URL}?${params.toString()}`, 10000);
    if (!res.ok) {
      return {
        ok: false,
        geomField: null,
        fields: new Map(),
        errorMsg: `Estrutura da base SEMA-MT retornou HTTP ${res.status}.`
      };
    }

    const xml = await res.text();
    if (/ExceptionReport/i.test(xml)) {
      return {
        ok: false,
        geomField: null,
        fields: new Map(),
        errorMsg: 'Serviço da SEMA-MT retornou erro ao verificar campos da base.'
      };
    }

    const fields = new Map<string, string>();
    let geomField: string | null = null;
    const localLayerName = layerName.includes(':') ? layerName.split(':')[1] : layerName;

    const elementTags = xml.matchAll(/<(?:xsd:)?element\b([^>]+)\/?>/gi);
    for (const tagMatch of elementTags) {
      const attrs = tagMatch[1] || '';
      const nameAttr = attrs.match(/\bname\s*=\s*"([^"]+)"/i);
      const typeAttr = attrs.match(/\btype\s*=\s*"([^"]+)"/i);
      if (!nameAttr || !typeAttr) continue;

      const fieldName = nameAttr[1].trim();
      const fieldType = typeAttr[1].trim();

      if (fieldName === localLayerName && /Type$/i.test(fieldType)) {
        continue;
      }

      fields.set(fieldName, fieldType);

      const lowerType = fieldType.toLowerCase();
      if (
        !geomField &&
        (lowerType.startsWith('gml:') ||
          lowerType.includes('geometry') ||
          lowerType.includes('surface') ||
          lowerType.includes('polygon') ||
          lowerType.includes('point') ||
          lowerType.includes('curve') ||
          lowerType.includes('linestring'))
      ) {
        geomField = fieldName;
      }
    }

    if (fields.size === 0) {
      return {
        ok: false,
        geomField: null,
        fields,
        errorMsg: 'Base consultada sem atributos disponíveis no momento.'
      };
    }

    schemaCache.set(layerName, { fetchedAt: Date.now(), geomField, fields });
    return { ok: true, geomField, fields };
  } catch (err: any) {
    return {
      ok: false,
      geomField: null,
      fields: new Map(),
      errorMsg: isTimeoutError(err)
        ? 'Tempo limite esgotado ao verificar campos da base SEMA-MT.'
        : 'Falha de comunicação ao verificar campos da base SEMA-MT.'
    };
  }
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

async function queryLayerSpatial(
  layerName: string,
  layerTitle: string | undefined,
  geomField: string,
  confirmedNonGeomFields: string[],
  confirmedDocFields: string[],
  confirmedOwnerFields: string[],
  lat: number,
  lng: number,
  maxFeatures: number
): Promise<{
  status: CamadaStatus;
  features: any[];
  isTimeout: boolean;
}> {
  const cqlFilter = `INTERSECTS(${geomField},POINT(${lng} ${lat}))`;

  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: layerName,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(maxFeatures),
    cql_filter: cqlFilter,
    authkey: GEOSERVER_AUTHKEY
  });

  const url = `${WFS_URL}?${params.toString()}`;
  let lastHttpStatus = 0;
  let lastTimeout = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      lastTimeout = false;
      const response = await fetchWithTimeout(url, 15000);
      lastHttpStatus = response.status;

      if (response.status >= 500) {
        continue;
      }

      const text = await response.text();

      if (!response.ok || /ExceptionReport/i.test(text)) {
        const isFilterErr =
          response.status === 400 || /filter|cql|property|column|syntax|parse/i.test(text);
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
              : `Falha ao consultar a base da SEMA-MT (HTTP ${response.status}).`
          },
          features: [],
          isTimeout: false
        };
      }

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          status: {
            camada: layerName,
            titulo: layerTitle,
            status: 'erro_comunicacao',
            suportado: true,
            registrosEncontrados: 0,
            camposPesquisados: [geomField],
            mensagem: 'Resposta inesperada retornada pela base da SEMA-MT.'
          },
          features: [],
          isTimeout: false
        };
      }

      const rawFeatures = Array.isArray(parsed?.features)
        ? parsed.features.slice(0, maxFeatures)
        : [];

      const features = rawFeatures.map((f: any) => {
        const rawProps = f.properties && typeof f.properties === 'object' ? f.properties : {};
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
          _auditDocDigits: docDigits,
          _rawProperties: rawProps,
          properties: preserveSemaProperties(rawProps, confirmedDocFields)
        };
      });

      return {
        status: {
          camada: layerName,
          titulo: layerTitle,
          status: features.length > 0 ? 'consultada' : 'sem_resultados',
          suportado: true,
          registrosEncontrados: features.length,
          camposPesquisados: [geomField],
          camposConfirmados: confirmedNonGeomFields,
          mensagem:
            features.length > 0
              ? `${features.length} imóvel(is) localizado(s) para a coordenada.`
              : 'Consulta concluída sem imóveis para esta coordenada.'
        },
        features,
        isTimeout: false
      };
    } catch (err: any) {
      if (isTimeoutError(err)) {
        lastTimeout = true;
      }
    }
  }

  return {
    status: {
      camada: layerName,
      titulo: layerTitle,
      status: 'erro_comunicacao',
      suportado: true,
      registrosEncontrados: 0,
      camposPesquisados: [geomField],
      mensagem: lastTimeout
        ? 'Tempo limite esgotado ao consultar a base da SEMA-MT.'
        : `Falha de comunicação com a base da SEMA-MT${lastHttpStatus ? ` (HTTP ${lastHttpStatus})` : ''}.`
    },
    features: [],
    isTimeout: lastTimeout
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

  if (req.method && req.method !== 'GET') {
    res.status(405)!.json!({ error: 'Método não permitido. Utilize GET.' });
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

  if ((rawLat === undefined || rawLng === undefined || rawTargetTipo === undefined || rawTargetId === undefined) && req.url) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      if (rawLat === undefined) rawLat = parsedUrl.searchParams.get('lat');
      if (rawLng === undefined) rawLng = parsedUrl.searchParams.get('lng');
      if (rawTargetTipo === undefined) rawTargetTipo = parsedUrl.searchParams.get('entidadeAlvoTipo');
      if (rawTargetId === undefined) rawTargetId = parsedUrl.searchParams.get('entidadeAlvoId');
    } catch {}
  }

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

  const capResult = await getWfsCapabilities();
  if (!capResult.ok) {
    res.status(capResult.isTimeout ? 504 : 502)!.json!({
      error: capResult.errorMsg || 'Falha ao conectar com a base pública da SEMA-MT.',
      consultadoEm: new Date().toISOString()
    });
    return;
  }

  const camadasConsultadas: CamadaStatus[] = [];
  const collectedFeatures: any[] = [];
  let primaryFailed = false;
  let anyTimeout = false;

  const targetLayers = [CAR_LAYER, CAR_REQUERIDO_LAYER];

  for (const layerName of targetLayers) {
    const capInfo = capResult.layers.get(layerName);
    if (!capInfo) {
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

    const schemaRes = await describeLayerSchemaXml(layerName);
    if (!schemaRes.ok || !schemaRes.geomField) {
      camadasConsultadas.push({
        camada: layerName,
        titulo: capInfo.title,
        status: schemaRes.ok ? 'nao_suportado' : 'indisponivel',
        suportado: false,
        registrosEncontrados: 0,
        mensagem: schemaRes.ok
          ? 'Base sem referência geográfica para consulta por coordenada.'
          : schemaRes.errorMsg || 'Não foi possível consultar a estrutura desta base.'
      });
      if (layerName === CAR_LAYER) primaryFailed = true;
      continue;
    }

    const remaining = 5 - collectedFeatures.length;
    if (remaining <= 0) break;

    const confirmedNonGeomFields = Array.from(schemaRes.fields.keys()).filter(
      fieldName => fieldName !== schemaRes.geomField
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
      capInfo.title,
      schemaRes.geomField,
      confirmedNonGeomFields,
      confirmedDocFields,
      confirmedOwnerFields,
      lat,
      lng,
      remaining
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

  const consultadoEm = new Date().toISOString();
  const hasAnyValidSuccess = camadasConsultadas.some(
    c => c.status === 'consultada' || c.status === 'sem_resultados'
  );

  // Nunca responder "nenhum imóvel" se a camada principal falhou e nenhum dado válido foi obtido,
  // ou se todas as camadas falharam.
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

  const finalFeatures = await Promise.all(
    collectedFeatures.slice(0, 5).map(async feat => {
      const { _auditDocDigits, _rawProperties, ...publicFeature } = feat;
      const rawProps = _rawProperties || feat.properties || {};
      const schemaFieldMap = schemaCache.get(feat.camadaOrigem)?.fields || new Map<string, string>();
      const carVal =
        extractConfirmedFieldValue(rawProps, schemaFieldMap, SEMA_FIELD_CANDIDATES.carEstadual) ||
        extractConfirmedFieldValue(rawProps, schemaFieldMap, SEMA_FIELD_CANDIDATES.carFederal) ||
        extractConfirmedFieldValue(rawProps, schemaFieldMap, SEMA_FIELD_CANDIDATES.protocolo);
      const titularRaw = extractConfirmedFieldValue(rawProps, schemaFieldMap, SEMA_FIELD_CANDIDATES.titular);
      const titularClean = titularRaw ? stripOuterQuotesAndBrackets(titularRaw) : undefined;
      const auditoriaId = await recordSemaServerAudit(authCtx, targetAccess.resolvedTarget, {
        criterioTipo: 'coordenada',
        criterioValor: `${lat.toFixed(6)},${lng.toFixed(6)}`,
        camada: feat.camadaOrigem || CAR_LAYER,
        featureId: String(feat.id || carVal || 'sema_feature'),
        car: carVal,
        rawProps,
        docStatus: feat._schemaMeta?.cpfCnpjStatus || 'ausente',
        docDigits: _auditDocDigits,
        extraSafeAttrs: {
          ...(titularClean ? { titularNome: titularClean } : {}),
          ...(_auditDocDigits
            ? { tipoPessoa: _auditDocDigits.length === 11 ? 'Pessoa física' : 'Pessoa jurídica' }
            : {})
        }
      });

      return auditoriaId ? { ...publicFeature, auditoriaId } : publicFeature;
    })
  );

  const mensagemStatus =
    finalFeatures.length > 0
      ? `${finalFeatures.length} imóvel(is) encontrado(s) para a coordenada informada.`
      : 'Consulta concluída com sucesso; nenhum imóvel encontrado nesta coordenada nas camadas consultadas.';

  res.status(200)!.json!({
    encontrado: finalFeatures.length > 0,
    feicoes: finalFeatures,
    camadasConsultadas,
    mensagemStatus,
    consultadoEm
  });
}
