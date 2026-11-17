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

  const res = await executeSemaGetFeature({
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

  const features = res.features.slice(0, maxFeatures).map((f: any) => {
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

  if (method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (body.lat !== undefined) rawLat = body.lat;
      if (body.lng !== undefined) rawLng = body.lng;
      if (body.entidadeAlvoTipo !== undefined) rawTargetTipo = body.entidadeAlvoTipo;
      if (body.entidadeAlvoId !== undefined) rawTargetId = body.entidadeAlvoId;
    } catch (err: any) {
      res.status(400)!.json!({
        error: err?.message || 'Dados inválidos na requisição.'
      });
      return;
    }
  } else if (
    (rawLat === undefined || rawLng === undefined || rawTargetTipo === undefined || rawTargetId === undefined) &&
    req.url
  ) {
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
