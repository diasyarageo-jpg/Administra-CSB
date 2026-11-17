// src/server/semaGeoserver.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SEMA_FIELD_CANDIDATES,
  extractConfirmedFieldValue,
  formatCpfCnpjReadable,
  sanitizeSemaProperties,
  stripOuterQuotesAndBrackets
} from '../config/carCampos';

export interface SemaCoordPoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface SemaAttrFilterClause {
  type: 'eq' | 'ilike';
  field: string;
  value: string;
}

export interface SemaLayerSchema {
  ok: boolean;
  fields: Map<string, string>;
  geomFields: Set<string>;
  httpStatus?: number;
  isTimeout?: boolean;
  errorMsg?: string;
}

export interface SemaCapabilitiesResult {
  ok: boolean;
  degraded: boolean;
  wfsLayers: Map<string, { name: string; title: string }>;
  wmsLayers: Map<string, { name: string; title: string }>;
  httpStatus?: number;
  isTimeout?: boolean;
  errorMsg?: string;
}

export interface SemaGetFeatureResult {
  ok: boolean;
  features: any[];
  isTimeout?: boolean;
  isFilterIncompatible?: boolean;
  httpStatus?: number;
  endpointUsed?: string;
}

const DEFAULT_WFS_ENDPOINTS = [
  'https://geo.sema.mt.gov.br/geoserver/wfs',
  'https://geo.sema.mt.gov.br/geoserver/ows',
  'https://geo.sema.mt.gov.br/geoserver/Geoportal/wfs',
  'https://geo.sema.mt.gov.br/geoserver/Geoportal/ows'
];

const DEFAULT_WMS_ENDPOINTS = [
  'https://geo.sema.mt.gov.br/geoserver/ows',
  'https://geo.sema.mt.gov.br/geoserver/wms'
];

export const SEMA_GEOSERVER_AUTHKEY =
  (process.env.SEMA_GEOSERVER_AUTHKEY || process.env.GEOSERVER_AUTHKEY || '').trim() ||
  '541085de-9a2e-454e-bdba-eb3d57a2f492';

export const SEMA_BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, application/xml, text/xml;q=0.9, */*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://geo.sema.mt.gov.br/geoportal/',
  Origin: 'https://geo.sema.mt.gov.br',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache'
};

const CACHE_TTL_MS = 10 * 60 * 1000;

interface CapabilitiesCacheEntry {
  fetchedAt: number;
  wfsLayers: Map<string, { name: string; title: string }>;
  wmsLayers: Map<string, { name: string; title: string }>;
}

interface SchemaCacheEntry {
  fetchedAt: number;
  fields: Map<string, string>;
  geomFields: Set<string>;
}

let capabilitiesCache: CapabilitiesCacheEntry | null = null;
const schemaCache = new Map<string, SchemaCacheEntry>();

export function resetSemaGeoserverCachesForTest(): void {
  capabilitiesCache = null;
  schemaCache.clear();
}

export function getCachedLayerSchema(layerName: string): SemaLayerSchema | null {
  const entry = schemaCache.get(layerName);
  if (!entry || Date.now() - entry.fetchedAt >= CACHE_TTL_MS) {
    return null;
  }
  return {
    ok: true,
    fields: entry.fields,
    geomFields: entry.geomFields
  };
}

export function getSemaWfsEndpoints(): string[] {
  const custom = (process.env.SEMA_WFS_URL || '').trim();
  const list = custom ? [custom, ...DEFAULT_WFS_ENDPOINTS] : DEFAULT_WFS_ENDPOINTS;
  return Array.from(new Set(list.filter(Boolean)));
}

export function getSemaWmsEndpoints(): string[] {
  const custom = (process.env.SEMA_WMS_URL || '').trim();
  const list = custom ? [custom, ...DEFAULT_WMS_ENDPOINTS] : DEFAULT_WMS_ENDPOINTS;
  return Array.from(new Set(list.filter(Boolean)));
}

export function isSemaTimeoutError(err: any): boolean {
  return Boolean(
    err?.name === 'AbortError' ||
      String(err?.message || '').toLowerCase().includes('abort') ||
      String(err?.message || '').toLowerCase().includes('timeout') ||
      err?.code === 'ETIMEDOUT' ||
      err?.code === 'UND_ERR_CONNECT_TIMEOUT'
  );
}

export function sanitizeSemaServerText(raw: string): string {
  let out = String(raw || '');
  if (SEMA_GEOSERVER_AUTHKEY) {
    out = out.replace(new RegExp(SEMA_GEOSERVER_AUTHKEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[REDACTED]');
  }
  return out.trim();
}

export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function escapeXml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function escapeCqlLiteral(val: string): string {
  return String(val || '').replace(/'/g, "''");
}

export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const mergedHeaders: Record<string, string> = {
      ...SEMA_BROWSER_HEADERS,
      ...(init.headers && typeof init.headers === 'object' && !Array.isArray(init.headers)
        ? (init.headers as Record<string, string>)
        : {})
    };
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: mergedHeaders
    });
  } finally {
    clearTimeout(timer);
  }
}

function getAuthKeyCandidates(): string[] {
  return SEMA_GEOSERVER_AUTHKEY ? [SEMA_GEOSERVER_AUTHKEY, ''] : [''];
}

export async function getSemaCapabilities(): Promise<SemaCapabilitiesResult> {
  if (capabilitiesCache && Date.now() - capabilitiesCache.fetchedAt < CACHE_TTL_MS) {
    return {
      ok: true,
      degraded: false,
      wfsLayers: capabilitiesCache.wfsLayers,
      wmsLayers: capabilitiesCache.wmsLayers
    };
  }

  const wfsEndpoints = getSemaWfsEndpoints();
  const wmsEndpoints = getSemaWmsEndpoints();
  const authKeys = getAuthKeyCandidates();

  let lastStatus: number | undefined;
  let lastTimeout = false;
  let wfsLayers = new Map<string, { name: string; title: string }>();
  let wfsOk = false;

  outerWfs: for (const baseUrl of wfsEndpoints) {
    for (const authKey of authKeys) {
      for (const version of ['2.0.0', '1.1.0']) {
        const params = new URLSearchParams({
          service: 'WFS',
          version,
          request: 'GetCapabilities'
        });
        if (authKey) params.set('authkey', authKey);

        try {
          const res = await fetchWithTimeout(`${baseUrl}?${params.toString()}`, 10000);
          lastStatus = res.status;

          if (!res.ok) {
            // 401/403 pode ser bloqueio por authkey inválido ou WAF no endpoint; tenta sem authkey / próximo endpoint
            if (res.status === 401 || res.status === 403) {
              break; // pula versão 1.1.0 com o mesmo authKey e tenta próximo authKey/endpoint
            }
            continue;
          }

          const wfsXml = await res.text();
          if (/ExceptionReport/i.test(wfsXml) && !/<FeatureType/i.test(wfsXml)) {
            continue;
          }

          const parsed = new Map<string, { name: string; title: string }>();
          const ftMatches = wfsXml.matchAll(/<FeatureType(?:\s[^>]*)?>([\s\S]*?)<\/FeatureType>/gi);
          for (const match of ftMatches) {
            const block = match[1] || '';
            const nameMatch = block.match(/<(?:[\w-]+:)?Name>([^<]+)<\/(?:[\w-]+:)?Name>/i);
            if (!nameMatch) continue;
            const name = decodeXmlEntities(nameMatch[1]);
            const titleMatch = block.match(/<(?:[\w-]+:)?Title>([^<]*)<\/(?:[\w-]+:)?Title>/i);
            const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : name;
            parsed.set(name, { name, title });
          }

          if (parsed.size > 0) {
            wfsLayers = parsed;
            wfsOk = true;
            break outerWfs;
          }
        } catch (err: any) {
          if (isSemaTimeoutError(err)) {
            lastTimeout = true;
            break; // não insiste no mesmo host/endpoint após timeout
          }
        }
      }
      if (lastTimeout) break;
    }
  }

  const wmsLayers = new Map<string, { name: string; title: string }>();
  if (wfsOk) {
    for (const wmsBase of wmsEndpoints) {
      const wmsParams = new URLSearchParams({
        service: 'wms',
        version: '1.3.0',
        request: 'GetCapabilities'
      });
      if (SEMA_GEOSERVER_AUTHKEY) {
        wmsParams.set('authkey', SEMA_GEOSERVER_AUTHKEY);
      }
      try {
        const wmsRes = await fetchWithTimeout(`${wmsBase}?${wmsParams.toString()}`, 8000);
        if (wmsRes.ok) {
          const wmsXml = await wmsRes.text();
          const layerMatches = wmsXml.matchAll(
            /<Layer(?:\s[^>]*)?>\s*<Name>([^<]+)<\/Name>\s*(?:<Title>([^<]*)<\/Title>)?/gi
          );
          for (const m of layerMatches) {
            const name = decodeXmlEntities(m[1]);
            const title = m[2] ? decodeXmlEntities(m[2]) : name;
            wmsLayers.set(name, { name, title });
          }
          break;
        }
      } catch {
        // Melhor-esforço apenas para títulos das camadas
      }
    }

    capabilitiesCache = {
      fetchedAt: Date.now(),
      wfsLayers,
      wmsLayers
    };

    return {
      ok: true,
      degraded: false,
      wfsLayers,
      wmsLayers
    };
  }

  return {
    ok: false,
    degraded: true,
    wfsLayers,
    wmsLayers,
    httpStatus: lastStatus,
    isTimeout: lastTimeout,
    errorMsg: lastTimeout
      ? 'Tempo limite esgotado ao conectar com a base pública da SEMA-MT.'
      : lastStatus
      ? `Serviço público da SEMA-MT retornou HTTP ${lastStatus}.`
      : 'Falha de comunicação ao conectar com a base pública da SEMA-MT.'
  };
}

export function parseDescribeFeatureTypeXml(
  xml: string,
  layerName: string
): { fields: Map<string, string>; geomFields: Set<string> } {
  const fields = new Map<string, string>();
  const geomFields = new Set<string>();
  const localName = layerName.includes(':') ? layerName.split(':')[1] : layerName;
  const elementTags = xml.matchAll(/<(?:xsd:)?element\b([^>]+)\/?>/gi);

  for (const tagMatch of elementTags) {
    const attrs = tagMatch[1] || '';
    const nameAttr = attrs.match(/\bname\s*=\s*"([^"]+)"/i);
    const typeAttr = attrs.match(/\btype\s*=\s*"([^"]+)"/i);
    if (!nameAttr || !typeAttr) continue;

    const fieldName = nameAttr[1].trim();
    const fieldType = typeAttr[1].trim();

    if (fieldName === localName && /Type$/i.test(fieldType)) {
      continue;
    }

    fields.set(fieldName, fieldType);

    const lowerType = fieldType.toLowerCase();
    if (
      lowerType.startsWith('gml:') ||
      lowerType.includes('geometry') ||
      lowerType.includes('surface') ||
      lowerType.includes('polygon') ||
      lowerType.includes('point') ||
      lowerType.includes('curve') ||
      lowerType.includes('linestring')
    ) {
      geomFields.add(fieldName);
    }
  }

  return { fields, geomFields };
}

export async function describeSemaLayerXml(layerName: string): Promise<SemaLayerSchema> {
  const cached = schemaCache.get(layerName);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, fields: cached.fields, geomFields: cached.geomFields };
  }

  const endpoints = getSemaWfsEndpoints();
  const authKeys = getAuthKeyCandidates();
  let lastStatus: number | undefined;
  let lastTimeout = false;

  for (const baseUrl of endpoints) {
    for (const authKey of authKeys) {
      for (const spec of [
        { version: '2.0.0', typeParam: 'typeNames' },
        { version: '1.1.0', typeParam: 'typeName' }
      ]) {
        const params = new URLSearchParams({
          service: 'WFS',
          version: spec.version,
          request: 'DescribeFeatureType',
          [spec.typeParam]: layerName
        });
        if (authKey) params.set('authkey', authKey);

        try {
          const res = await fetchWithTimeout(`${baseUrl}?${params.toString()}`, 9000);
          lastStatus = res.status;

          if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
              break;
            }
            continue;
          }

          const xml = await res.text();
          if (/ExceptionReport/i.test(xml)) {
            continue;
          }

          const { fields, geomFields } = parseDescribeFeatureTypeXml(xml, layerName);
          if (fields.size > 0) {
            schemaCache.set(layerName, { fetchedAt: Date.now(), fields, geomFields });
            return { ok: true, fields, geomFields };
          }
        } catch (err: any) {
          if (isSemaTimeoutError(err)) {
            lastTimeout = true;
            break;
          }
        }
      }
      if (lastTimeout) break;
    }
  }

  return {
    ok: false,
    fields: new Map(),
    geomFields: new Set(),
    httpStatus: lastStatus,
    isTimeout: lastTimeout,
    errorMsg: lastTimeout
      ? 'Tempo limite esgotado ao verificar campos da base SEMA-MT.'
      : lastStatus
      ? `Estrutura da base retornou HTTP ${lastStatus}.`
      : 'Falha de comunicação ao verificar campos da base SEMA-MT.'
  };
}

function buildOgcXmlGetFeatureBody(options: {
  layerName: string;
  maxFeatures: number;
  propertyNames?: string[];
  attrClauses?: SemaAttrFilterClause[];
  spatialGeomField?: string;
  spatialPoints?: SemaCoordPoint[];
  includeSrs4326?: boolean;
}): string {
  const {
    layerName,
    maxFeatures,
    propertyNames = [],
    attrClauses = [],
    spatialGeomField,
    spatialPoints = [],
    includeSrs4326
  } = options;

  const propXml = propertyNames
    .filter(Boolean)
    .map(p => `<wfs:PropertyName>${escapeXml(p)}</wfs:PropertyName>`)
    .join('');

  const filterFragments: string[] = [];

  for (const clause of attrClauses) {
    if (clause.type === 'eq') {
      filterFragments.push(
        `<ogc:PropertyIsEqualTo matchCase="true"><ogc:PropertyName>${escapeXml(
          clause.field
        )}</ogc:PropertyName><ogc:Literal>${escapeXml(clause.value)}</ogc:Literal></ogc:PropertyIsEqualTo>`
      );
    } else {
      filterFragments.push(
        `<ogc:PropertyIsLike wildCard="*" singleChar="?" escapeChar="\\" matchCase="false"><ogc:PropertyName>${escapeXml(
          clause.field
        )}</ogc:PropertyName><ogc:Literal>*${escapeXml(clause.value)}*</ogc:Literal></ogc:PropertyIsLike>`
      );
    }
  }

  if (spatialGeomField && spatialPoints.length > 0) {
    for (const pt of spatialPoints) {
      filterFragments.push(
        `<ogc:Intersects><ogc:PropertyName>${escapeXml(
          spatialGeomField
        )}</ogc:PropertyName><gml:Point srsName="EPSG:4326"><gml:pos>${pt.lng} ${pt.lat}</gml:pos></gml:Point></ogc:Intersects>`
      );
    }
  }

  let filterXml = '';
  if (filterFragments.length === 1) {
    filterXml = `<ogc:Filter>${filterFragments[0]}</ogc:Filter>`;
  } else if (filterFragments.length > 1) {
    filterXml = `<ogc:Filter><ogc:Or>${filterFragments.join('')}</ogc:Or></ogc:Filter>`;
  }

  const srsAttr = includeSrs4326 ? ' srsName="EPSG:4326"' : '';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<wfs:GetFeature service="WFS" version="1.1.0" outputFormat="application/json" maxFeatures="${maxFeatures}"` +
    ` xmlns:wfs="http://www.opengis.net/wfs"` +
    ` xmlns:ogc="http://www.opengis.net/ogc"` +
    ` xmlns:gml="http://www.opengis.net/gml">` +
    `<wfs:Query typeName="${escapeXml(layerName)}"${srsAttr}>` +
    propXml +
    filterXml +
    `</wfs:Query>` +
    `</wfs:GetFeature>`
  );
}

export async function executeSemaGetFeature(options: {
  layerName: string;
  cqlFilter: string;
  propertyNames?: string[];
  includeSrs4326?: boolean;
  maxFeatures?: number;
  attrClauses?: SemaAttrFilterClause[];
  spatialGeomField?: string;
  spatialPoints?: SemaCoordPoint[];
}): Promise<SemaGetFeatureResult> {
  const {
    layerName,
    cqlFilter,
    propertyNames = [],
    includeSrs4326 = false,
    maxFeatures = 25,
    attrClauses = [],
    spatialGeomField,
    spatialPoints = []
  } = options;

  const endpoints = getSemaWfsEndpoints();
  const authKeys = getAuthKeyCandidates();
  const canBuildXml = attrClauses.length > 0 || Boolean(spatialGeomField && spatialPoints.length > 0);

  let lastHttpStatus: number | undefined;
  let lastTimeout = false;
  let sawFilterError = false;

  for (const baseUrl of endpoints) {
    let endpointTimedOut = false;

    for (const authKey of authKeys) {
      // Estratégia 1: GET WFS 2.0.0 (preserva compatibilidade padrão OGC e mocks)
      const getParams = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeNames: layerName,
        outputFormat: 'application/json',
        count: String(maxFeatures),
        cql_filter: cqlFilter
      });
      if (includeSrs4326) getParams.set('srsName', 'EPSG:4326');
      if (propertyNames.length > 0) getParams.set('propertyName', propertyNames.join(','));
      if (authKey) getParams.set('authkey', authKey);

      const strategies: Array<{
        label: string;
        url: string;
        init: RequestInit;
      }> = [
        {
          label: 'get-2.0',
          url: `${baseUrl}?${getParams.toString()}`,
          init: { method: 'GET' }
        }
      ];

      // Estratégia 2: POST form-urlencoded (evita bloqueios WAF/proxy sobre cql_filter na querystring)
      const postQuery = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature'
      });
      if (authKey) postQuery.set('authkey', authKey);

      const postForm = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeNames: layerName,
        outputFormat: 'application/json',
        count: String(maxFeatures),
        cql_filter: cqlFilter
      });
      if (includeSrs4326) postForm.set('srsName', 'EPSG:4326');
      if (propertyNames.length > 0) postForm.set('propertyName', propertyNames.join(','));

      strategies.push({
        label: 'post-form-2.0',
        url: `${baseUrl}?${postQuery.toString()}`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: postForm.toString()
        }
      });

      // Estratégia 3: POST XML OGC Filter WFS 1.1.0 (elimina cql_filter quando WAF bloqueia CQL)
      if (canBuildXml) {
        const xmlQuery = new URLSearchParams({
          service: 'WFS',
          version: '1.1.0',
          request: 'GetFeature'
        });
        if (authKey) xmlQuery.set('authkey', authKey);
        const xmlBody = buildOgcXmlGetFeatureBody({
          layerName,
          maxFeatures,
          propertyNames,
          attrClauses,
          spatialGeomField,
          spatialPoints,
          includeSrs4326
        });

        strategies.push({
          label: 'post-xml-1.1',
          url: `${baseUrl}?${xmlQuery.toString()}`,
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/xml; charset=UTF-8' },
            body: xmlBody
          }
        });
      }

      for (const strategy of strategies) {
        try {
          const resp = await fetchWithTimeout(strategy.url, 12000, strategy.init);
          lastHttpStatus = resp.status;
          const text = await resp.text();

          if (!resp.ok || /ExceptionReport/i.test(text)) {
            if (resp.status === 400 || /cql|filter|property|column|syntax|parse/i.test(text)) {
              sawFilterError = true;
            }
            // Se 404 com POST-form/XML em endpoint mockado ou estrito, tenta próxima estratégia
            continue;
          }

          const parsed = JSON.parse(text);
          const features = Array.isArray(parsed?.features) ? parsed.features.slice(0, maxFeatures) : [];
          return {
            ok: true,
            features,
            endpointUsed: `${baseUrl} (${strategy.label})`
          };
        } catch (err: any) {
          if (isSemaTimeoutError(err)) {
            lastTimeout = true;
            endpointTimedOut = true;
            break;
          }
        }
      }

      if (endpointTimedOut) break;
    }
  }

  return {
    ok: false,
    features: [],
    isTimeout: lastTimeout,
    isFilterIncompatible: sawFilterError && lastHttpStatus !== 403,
    httpStatus: lastHttpStatus
  };
}

export async function executeSemaPagedGetFeature(options: {
  layerName: string;
  pageSize: number;
  startIndex: number;
  sortField?: string;
  propertyNames?: string[];
}): Promise<{ ok: boolean; features: any[]; httpStatus?: number; errorMsg?: string }> {
  const { layerName, pageSize, startIndex, sortField, propertyNames = [] } = options;
  const endpoints = getSemaWfsEndpoints();
  const authKeys = getAuthKeyCandidates();

  let lastStatus: number | undefined;
  let lastErr = '';

  for (const baseUrl of endpoints) {
    for (const authKey of authKeys) {
      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeNames: layerName,
        outputFormat: 'application/json',
        count: String(pageSize),
        startIndex: String(startIndex)
      });
      if (sortField) params.set('sortBy', `${sortField} ASC`);
      if (propertyNames.length > 0) params.set('propertyName', propertyNames.join(','));
      if (authKey) params.set('authkey', authKey);

      try {
        const res = await fetchWithTimeout(`${baseUrl}?${params.toString()}`, 14000);
        lastStatus = res.status;
        const text = await res.text();
        if (!res.ok || /ExceptionReport/i.test(text)) {
          lastErr = `GeoServer retornou HTTP ${res.status} em startIndex=${startIndex}.`;
          if (res.status === 401 || res.status === 403) continue;
          continue;
        }
        const parsed = JSON.parse(text);
        return {
          ok: true,
          features: Array.isArray(parsed?.features) ? parsed.features : []
        };
      } catch (err: any) {
        if (isSemaTimeoutError(err)) {
          lastErr = `Timeout ao paginar GeoServer em startIndex=${startIndex}.`;
          break;
        }
        lastErr = err?.message || 'Erro de comunicação ao paginar GeoServer.';
      }
    }
  }

  return {
    ok: false,
    features: [],
    httpStatus: lastStatus,
    errorMsg: lastErr || `GeoServer indisponível (HTTP ${lastStatus || 502}) em startIndex=${startIndex}.`
  };
}

function cleanPostgrestFilterTerm(raw: string): string {
  return String(raw || '')
    .replace(/[,().*%_;\\'"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function classifyLayerGroup(camada: string):
  | 'carImoveis'
  | 'licencas'
  | 'notificacoes'
  | 'autosInfracao'
  | 'termosEmbargo'
  | 'outros' {
  const upper = String(camada || '').toUpperCase();
  if (upper.includes('CAR_ATP') || upper.includes('REQUERIMENTO_ATP')) return 'carImoveis';
  if (upper.includes('LICENCIAMENTO') || upper.includes('SIMLAMGEO')) return 'licencas';
  if (upper.includes('NOTIFICACAO')) return 'notificacoes';
  if (upper.includes('AUTO_DE_INFRACAO')) return 'autosInfracao';
  if (upper.includes('TERMO_DE_EMBARGO')) return 'termosEmbargo';
  return 'outros';
}

export async function queryGeoportalCacheFallback(
  supabaseAdmin: SupabaseClient<any, any, any> | null,
  criteria: {
    cleanDoc: string;
    carTokens: string[];
    procList: string[];
    cleanNome: string;
    buscaExploratoria: boolean;
  },
  consultadoEm: string
): Promise<{
  used: boolean;
  itemsByGroup: {
    carImoveis: any[];
    licencas: any[];
    notificacoes: any[];
    autosInfracao: any[];
    termosEmbargo: any[];
    outros: any[];
  };
  totalCount: number;
}> {
  const empty = {
    carImoveis: [] as any[],
    licencas: [] as any[],
    notificacoes: [] as any[],
    autosInfracao: [] as any[],
    termosEmbargo: [] as any[],
    outros: [] as any[]
  };

  if (!supabaseAdmin) {
    return { used: false, itemsByGroup: empty, totalCount: 0 };
  }

  const orTerms: string[] = [];

  for (const tok of criteria.carTokens.slice(0, 6)) {
    const clean = cleanPostgrestFilterTerm(tok);
    if (clean.length < 3) continue;
    orTerms.push(`numero_estadual.ilike.%${clean}%`);
    orTerms.push(`car_federal.ilike.%${clean}%`);
    orTerms.push(`protocolo.ilike.%${clean}%`);
  }

  for (const proc of criteria.procList.slice(0, 6)) {
    const clean = cleanPostgrestFilterTerm(proc);
    if (clean.length < 3) continue;
    orTerms.push(`numero_processo.ilike.%${clean}%`);
    orTerms.push(`numero_documento.ilike.%${clean}%`);
  }

  if (criteria.cleanDoc) {
    if (criteria.cleanDoc.length === 14) {
      const fmt = formatCpfCnpjReadable(criteria.cleanDoc);
      orTerms.push(`nome_proprietario.ilike.%${criteria.cleanDoc}%`);
      if (fmt && fmt !== criteria.cleanDoc) {
        orTerms.push(`nome_proprietario.ilike.%${fmt}%`);
      }
    } else if (criteria.cleanDoc.length === 11) {
      const mid6 = criteria.cleanDoc.slice(3, 9);
      orTerms.push(`nome_proprietario.ilike.%XXX${mid6}XX%`);
    }
  }

  if (criteria.buscaExploratoria && criteria.cleanNome.length >= 3) {
    const cleanName = cleanPostgrestFilterTerm(criteria.cleanNome);
    if (cleanName.length >= 3) {
      orTerms.push(`nome_proprietario.ilike.%${cleanName}%`);
      orTerms.push(`nome_propriedade.ilike.%${cleanName}%`);
    }
  }

  if (orTerms.length === 0) {
    return { used: false, itemsByGroup: empty, totalCount: 0 };
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('geoportal_sync_cache')
      .select(
        'id, camada, feature_id, numero_estadual, car_federal, protocolo, nome_propriedade, nome_proprietario, municipio_codigo, municipio_nome, situacao_car, area_ha, numero_processo, tipo_documento, numero_documento, status_documento, link_documento, raw_properties, sincronizado_em'
      )
      .or(orTerms.join(','))
      .order('sincronizado_em', { ascending: false })
      .limit(50);

    if (error || !Array.isArray(data) || data.length === 0) {
      return { used: true, itemsByGroup: empty, totalCount: 0 };
    }

    const itemsByGroup = {
      carImoveis: [] as any[],
      licencas: [] as any[],
      notificacoes: [] as any[],
      autosInfracao: [] as any[],
      termosEmbargo: [] as any[],
      outros: [] as any[]
    };

    for (const row of data) {
      const rawProps =
        row.raw_properties && typeof row.raw_properties === 'object'
          ? sanitizeSemaProperties(row.raw_properties)
          : {};
      const grupo = classifyLayerGroup(row.camada);
      const schemaFieldKeys = Array.from(
        new Set(
          Object.keys(rawProps).filter(Boolean)
        )
      );
      const areaFormatted =
        row.area_ha !== null && row.area_ha !== undefined && !isNaN(Number(row.area_ha))
          ? `${Number(row.area_ha).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha`
          : undefined;

      const titularClean = row.nome_proprietario
        ? stripOuterQuotesAndBrackets(String(row.nome_proprietario))
        : extractConfirmedFieldValue(
            rawProps,
            new Map(schemaFieldKeys.map(k => [k, 'xsd:string'])),
            SEMA_FIELD_CANDIDATES.titular
          );

      const propNomeClean = row.nome_propriedade
        ? stripOuterQuotesAndBrackets(String(row.nome_propriedade))
        : undefined;

      const sawMaskedDoc = Boolean(
        titularClean && /x{2,}\d+x{2,}|\*{2,}/i.test(titularClean)
      );

      const item = {
        id: String(row.feature_id || row.id || ''),
        tipo:
          grupo === 'carImoveis'
            ? row.tipo_documento || 'CAR / Imóvel Rural'
            : row.tipo_documento || row.camada,
        numeroDocumento:
          grupo === 'carImoveis'
            ? row.numero_estadual || row.car_federal || row.protocolo || ''
            : row.numero_documento || row.numero_estadual || '',
        nomeDocumento: propNomeClean || '',
        dataDocumento: '',
        numeroProcesso: row.numero_processo || undefined,
        status:
          grupo === 'carImoveis'
            ? row.situacao_car || undefined
            : row.status_documento || undefined,
        razaoSocial: titularClean || undefined,
        municipio:
          row.municipio_nome ||
          (row.municipio_codigo ? `Código IBGE ${row.municipio_codigo}` : undefined),
        municipioCodigo: row.municipio_codigo ? String(row.municipio_codigo) : undefined,
        camadaOrigem: row.camada,
        camadaTitulo: `${row.camada} (Cache local sincronizado)`,
        carFederal: row.car_federal || undefined,
        areaHa: areaFormatted,
        linkDocumento: row.link_documento || undefined,
        correspondenciaExploratoria: criteria.buscaExploratoria,
        camposConfirmadosEsquema: schemaFieldKeys,
        cpfCnpjCompletoDisponivel: false,
        cpfCnpjStatus: sawMaskedDoc ? ('mascarado' as const) : ('ausente' as const),
        consultadoEm: row.sincronizado_em || consultadoEm,
        propriedadesBrutas: rawProps,
        _auditRawProps: rawProps,
        _auditCar: row.numero_estadual || row.car_federal || row.protocolo || undefined
      };

      itemsByGroup[grupo].push(item);
    }

    const totalCount =
      itemsByGroup.carImoveis.length +
      itemsByGroup.licencas.length +
      itemsByGroup.notificacoes.length +
      itemsByGroup.autosInfracao.length +
      itemsByGroup.termosEmbargo.length +
      itemsByGroup.outros.length;

    return { used: true, itemsByGroup, totalCount };
  } catch {
    return { used: false, itemsByGroup: empty, totalCount: 0 };
  }
}
