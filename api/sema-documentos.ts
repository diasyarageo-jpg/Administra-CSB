// api/sema-documentos.ts
import type { IncomingMessage, ServerResponse } from 'http';
import {
  SEMA_FIELD_CANDIDATES,
  resolveConfirmedFields,
  extractConfirmedFieldValue,
  extractCarSearchTokens,
  deduplicateCarImoveisByCar,
  formatCpfCnpjReadable,
  preserveSemaProperties,
  stripOuterQuotesAndBrackets
} from '../src/config/carCampos';

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
  grupo: string;
  status: CamadaStatusCode;
  suportado: boolean;
  registrosEncontrados: number;
  camposPesquisados?: string[];
  mensagem: string;
}

interface CoordPoint {
  lat: number;
  lng: number;
  label?: string;
}

const WFS_URL = 'https://geo.sema.mt.gov.br/geoserver/wfs';
const WMS_OWS_URL = 'https://geo.sema.mt.gov.br/geoserver/ows';
const GEOSERVER_AUTHKEY = '541085de-9a2e-454e-bdba-eb3d57a2f492';

const CACHE_TTL_MS = 10 * 60 * 1000;

const TARGET_LAYERS = [
  { name: 'Geoportal:CAR_ATP', grupo: 'carImoveis' },
  { name: 'Geoportal:MVW_REQUERIMENTO_ATP', grupo: 'carImoveis' },
  { name: 'Geoportal:TDAD_LICENCIAMENTO_LICENCA_PREVIA', grupo: 'licencas' },
  { name: 'Geoportal:TDAD_LICENCIAMENTO_LICENCA_DE_INSTALACAO', grupo: 'licencas' },
  { name: 'Geoportal:TDAD_LICENCIAMENTO_LICENCA_DE_OPERACAO', grupo: 'licencas' },
  { name: 'Geoportal:SIMLAMGEO_LP', grupo: 'licencas' },
  { name: 'Geoportal:SIMLAMGEO_LI', grupo: 'licencas' },
  { name: 'Geoportal:SIMLAMGEO_LO', grupo: 'licencas' },
  { name: 'Geoportal:SIMLAMGEO_LOP', grupo: 'licencas' },
  { name: 'Geoportal:TDAD_FISCALIZACAO_NOTIFICACAO', grupo: 'notificacoes' },
  { name: 'Geoportal:TDAD_FISCALIZACAO_AUTO_DE_INFRACAO', grupo: 'autosInfracao' },
  { name: 'Geoportal:TDAD_FISCALIZACAO_TERMO_DE_EMBARGO', grupo: 'termosEmbargo' }
] as const;

interface CapabilitiesCache {
  fetchedAt: number;
  wfsLayers: Map<string, { name: string; title: string }>;
  wmsLayers: Map<string, { name: string; title: string }>;
}

interface SchemaCacheEntry {
  fetchedAt: number;
  fields: Map<string, string>;
  geomFields: Set<string>;
}

let capabilitiesCache: CapabilitiesCache | null = null;
const schemaCache = new Map<string, SchemaCacheEntry>();

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

function cleanTextValue(val: any): string | undefined {
  if (val === undefined || val === null) return undefined;
  const s = String(val).trim();
  if (!s || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') {
    return undefined;
  }
  return s;
}

function sanitizeSearchInput(val: string, maxLen: number): string {
  return val
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[%_;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function escapeCqlLiteral(val: string): string {
  return val.replace(/'/g, "''");
}

function normalizeForCompare(val: string): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatCpfCnpjMask(digits: string): string {
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return digits;
}

function sanitizeHttpUrl(raw: any): string | undefined {
  const s = cleanTextValue(raw);
  if (!s) return undefined;
  if (/^https?:\/\/\S+$/i.test(s)) {
    return s;
  }
  return undefined;
}

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
    const MAX_BYTES = 64 * 1024;
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

async function getCapabilities(): Promise<{
  ok: boolean;
  wfsLayers: Map<string, { name: string; title: string }>;
  wmsLayers: Map<string, { name: string; title: string }>;
  isTimeout?: boolean;
  errorMsg?: string;
}> {
  if (capabilitiesCache && Date.now() - capabilitiesCache.fetchedAt < CACHE_TTL_MS) {
    return {
      ok: true,
      wfsLayers: capabilitiesCache.wfsLayers,
      wmsLayers: capabilitiesCache.wmsLayers
    };
  }

  const wfsParams = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetCapabilities',
    authkey: GEOSERVER_AUTHKEY
  });

  const wmsParams = new URLSearchParams({
    service: 'wms',
    version: '1.3.0',
    request: 'GetCapabilities',
    authkey: GEOSERVER_AUTHKEY
  });

  try {
    const [wfsRes, wmsRes] = await Promise.all([
      fetchWithTimeout(`${WFS_URL}?${wfsParams.toString()}`, 12000),
      fetchWithTimeout(`${WMS_OWS_URL}?${wmsParams.toString()}`, 12000).catch(() => null)
    ]);

    if (!wfsRes.ok) {
      return {
        ok: false,
        wfsLayers: new Map(),
        wmsLayers: new Map(),
        errorMsg: `Serviço público da SEMA-MT retornou HTTP ${wfsRes.status}.`
      };
    }

    const wfsXml = await wfsRes.text();
    const wfsLayers = new Map<string, { name: string; title: string }>();

    const ftMatches = wfsXml.matchAll(/<FeatureType(?:\s[^>]*)?>([\s\S]*?)<\/FeatureType>/gi);
    for (const match of ftMatches) {
      const block = match[1] || '';
      const nameMatch = block.match(/<(?:[\w-]+:)?Name>([^<]+)<\/(?:[\w-]+:)?Name>/i);
      if (!nameMatch) continue;
      const name = decodeXmlEntities(nameMatch[1]);
      const titleMatch = block.match(/<(?:[\w-]+:)?Title>([^<]*)<\/(?:[\w-]+:)?Title>/i);
      const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : name;
      wfsLayers.set(name, { name, title });
    }

    const wmsLayers = new Map<string, { name: string; title: string }>();
    if (wmsRes && wmsRes.ok) {
      const wmsXml = await wmsRes.text();
      const layerMatches = wmsXml.matchAll(/<Layer(?:\s[^>]*)?>\s*<Name>([^<]+)<\/Name>\s*(?:<Title>([^<]*)<\/Title>)?/gi);
      for (const m of layerMatches) {
        const name = decodeXmlEntities(m[1]);
        const title = m[2] ? decodeXmlEntities(m[2]) : name;
        wmsLayers.set(name, { name, title });
      }
    }

    capabilitiesCache = {
      fetchedAt: Date.now(),
      wfsLayers,
      wmsLayers
    };

    return { ok: true, wfsLayers, wmsLayers };
  } catch (err: any) {
    return {
      ok: false,
      wfsLayers: new Map(),
      wmsLayers: new Map(),
      isTimeout: isTimeoutError(err),
      errorMsg: isTimeoutError(err)
        ? 'Tempo limite esgotado ao conectar com a base pública da SEMA-MT.'
        : 'Falha de comunicação ao conectar com a base pública da SEMA-MT.'
    };
  }
}

async function describeLayerFieldsXml(layerName: string): Promise<{
  ok: boolean;
  fields: Map<string, string>;
  geomFields: Set<string>;
  errorMsg?: string;
}> {
  const cached = schemaCache.get(layerName);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, fields: cached.fields, geomFields: cached.geomFields };
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
        fields: new Map(),
        geomFields: new Set(),
        errorMsg: `Estrutura da base retornou HTTP ${res.status}.`
      };
    }

    const xml = await res.text();
    if (/ExceptionReport/i.test(xml)) {
      return {
        ok: false,
        fields: new Map(),
        geomFields: new Set(),
        errorMsg: 'Base pública da SEMA-MT temporariamente indisponível para leitura de campos.'
      };
    }

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

    if (fields.size === 0) {
      return {
        ok: false,
        fields,
        geomFields,
        errorMsg: 'Base consultada sem atributos disponíveis no momento.'
      };
    }

    schemaCache.set(layerName, { fetchedAt: Date.now(), fields, geomFields });
    return { ok: true, fields, geomFields };
  } catch (err: any) {
    return {
      ok: false,
      fields: new Map(),
      geomFields: new Set(),
      errorMsg: isTimeoutError(err)
        ? 'Tempo limite esgotado ao verificar campos da base SEMA-MT.'
        : 'Falha de comunicação ao verificar campos da base SEMA-MT.'
    };
  }
}

interface FilterBuildResult {
  supported: boolean;
  attrCqlFilter: string;
  spatialCqlFilter: string;
  fieldsUsed: string[];
  confirmedDocFields: string[];
  ownerTextFields: string[];
  carFields: string[];
  procFields: string[];
  nameFields: string[];
  unsupportedReason?: string;
}

function buildSchemaFilterForLayer(
  fields: Map<string, string>,
  geomFields: Set<string>,
  grupo: string,
  criteria: {
    cleanDoc: string;
    carTokens: string[];
    procList: string[];
    coordenadas: CoordPoint[];
    cleanNome: string;
    buscaExploratoria: boolean;
  }
): FilterBuildResult {
  const orAttrClauses: string[] = [];
  const fieldsUsed: string[] = [];
  const seenFields = new Set<string>();
  const addFieldUsed = (f: string) => {
    if (f && !seenFields.has(f)) {
      seenFields.add(f);
      fieldsUsed.push(f);
    }
  };

  const confirmedDocFields = resolveConfirmedFields(fields, SEMA_FIELD_CANDIDATES.filtroDocumento);
  const ownerTextFields = resolveConfirmedFields(fields, ['NOMESPROPRIETARIOS', 'PROPRIETARIOS', 'RAZAO_SOCIAL']);
  const carFields = resolveConfirmedFields(fields, SEMA_FIELD_CANDIDATES.filtroCar);
  const procFields = resolveConfirmedFields(fields, SEMA_FIELD_CANDIDATES.filtroProcesso);
  const nameFields = resolveConfirmedFields(fields, SEMA_FIELD_CANDIDATES.filtroNome);

  // 1. CPF / CNPJ:
  //    a) Campo dedicado de documento -> igualdade exata (com ou sem máscara)
  //    b) Campo nominal de proprietários (ex.: CAR_ATP.NOMESPROPRIETARIOS = "XXX544001XX - NOME; 24148375000161 - EMPRESA")
  if (criteria.cleanDoc) {
    if (confirmedDocFields.length > 0) {
      const formatted = formatCpfCnpjMask(criteria.cleanDoc);
      const escClean = escapeCqlLiteral(criteria.cleanDoc);
      const escFmt = escapeCqlLiteral(formatted);
      for (const field of confirmedDocFields) {
        if (escFmt !== escClean) {
          orAttrClauses.push(`(${field} = '${escClean}' OR ${field} = '${escFmt}')`);
        } else {
          orAttrClauses.push(`${field} = '${escClean}'`);
        }
        addFieldUsed(field);
      }
    }

    if (ownerTextFields.length > 0) {
      const escClean = escapeCqlLiteral(criteria.cleanDoc);
      const escFmt = escapeCqlLiteral(formatCpfCnpjMask(criteria.cleanDoc));
      for (const field of ownerTextFields) {
        if (criteria.cleanDoc.length === 14) {
          orAttrClauses.push(`${field} ILIKE '%${escClean}%'`);
          if (escFmt !== escClean) {
            orAttrClauses.push(`${field} ILIKE '%${escFmt}%'`);
          }
          addFieldUsed(field);
        } else if (criteria.cleanDoc.length === 11) {
          const mid6 = criteria.cleanDoc.slice(3, 9);
          orAttrClauses.push(`${field} ILIKE '%XXX${mid6}XX%'`);
          orAttrClauses.push(`${field} ILIKE '%${escClean}%'`);
          if (escFmt !== escClean) {
            orAttrClauses.push(`${field} ILIKE '%${escFmt}%'`);
          }
          addFieldUsed(field);
        }
      }
    }
  }

  // 2. Número(s) do CAR / MT / Protocolo vinculados
  if (criteria.carTokens.length > 0 && carFields.length > 0) {
    for (const tok of criteria.carTokens) {
      const escTok = escapeCqlLiteral(tok);
      for (const f of carFields) {
        orAttrClauses.push(`${f} ILIKE '%${escTok}%'`);
        addFieldUsed(f);
      }
    }
  }

  // 3. Número(s) de Processo / Protocolo
  if (criteria.procList.length > 0 && procFields.length > 0) {
    for (const proc of criteria.procList) {
      const escProc = escapeCqlLiteral(proc);
      for (const f of procFields) {
        orAttrClauses.push(`${f} ILIKE '%${escProc}%'`);
        addFieldUsed(f);
      }
    }
  }

  // 4. Busca textual exploratória por Nome
  if (criteria.buscaExploratoria && criteria.cleanNome && nameFields.length > 0) {
    const escNome = escapeCqlLiteral(criteria.cleanNome);
    for (const f of nameFields) {
      orAttrClauses.push(`${f} ILIKE '%${escNome}%'`);
      addFieldUsed(f);
    }
  }

  // 5. Cruzamento geográfico por coordenadas das barragens vinculadas (para imóveis CAR)
  let spatialCqlFilter = '';
  const primaryGeomField = Array.from(geomFields)[0];
  if (grupo === 'carImoveis' && primaryGeomField && criteria.coordenadas.length > 0) {
    const spatialParts = criteria.coordenadas.map(
      c => `INTERSECTS(${primaryGeomField},POINT(${c.lng} ${c.lat}))`
    );
    spatialCqlFilter = spatialParts.join(' OR ');
    addFieldUsed(primaryGeomField);
  }

  const attrCqlFilter = orAttrClauses.join(' OR ');

  if (!attrCqlFilter && !spatialCqlFilter) {
    return {
      supported: false,
      attrCqlFilter: '',
      spatialCqlFilter: '',
      fieldsUsed: [],
      confirmedDocFields,
      ownerTextFields,
      carFields,
      procFields,
      nameFields,
      unsupportedReason: 'Esta base não disponibiliza pesquisa direta pelos critérios informados.'
    };
  }

  return {
    supported: true,
    attrCqlFilter,
    spatialCqlFilter,
    fieldsUsed,
    confirmedDocFields,
    ownerTextFields,
    carFields,
    procFields,
    nameFields
  };
}

const NAME_STOPWORDS = new Set([
  'das',
  'dos',
  'com',
  'para',
  'ltda',
  'eireli',
  'epp',
  's/a',
  'agro',
  'fazenda',
  'agropecuaria',
  'empreendimentos'
]);

function hasSignificantNameOverlap(ownerText: string, expectedName: string): boolean {
  const normOwner = normalizeForCompare(ownerText);
  const normExpected = normalizeForCompare(expectedName);
  if (!normExpected || normExpected.length < 3) return true;

  const words = normExpected
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !NAME_STOPWORDS.has(w));

  if (words.length === 0) return true;
  return words.some(w => normOwner.includes(w));
}

function evaluateFeatureMatch(
  rawProps: Record<string, any>,
  isSpatialHit: boolean,
  filterBuild: FilterBuildResult,
  criteria: {
    cleanDoc: string;
    carTokens: string[];
    procList: string[];
    cleanNome: string;
    buscaExploratoria: boolean;
  }
): { matches: boolean; confirmatory: boolean } {
  if (isSpatialHit) {
    return { matches: true, confirmatory: true };
  }

  // 1. Correspondência exata em campo de documento
  if (criteria.cleanDoc && filterBuild.confirmedDocFields.length > 0) {
    for (const field of filterBuild.confirmedDocFields) {
      const raw = rawProps[field];
      if (raw === undefined || raw === null) continue;
      const digits = String(raw).replace(/\D/g, '');
      if (digits === criteria.cleanDoc) {
        return { matches: true, confirmatory: true };
      }
    }
  }

  // 2. Correspondência em campo composto de proprietários (ex.: NOMESPROPRIETARIOS)
  if (criteria.cleanDoc && filterBuild.ownerTextFields.length > 0) {
    for (const field of filterBuild.ownerTextFields) {
      const raw = rawProps[field];
      if (raw === undefined || raw === null) continue;
      const text = String(raw);
      if (criteria.cleanDoc.length === 14) {
        const formatted = formatCpfCnpjMask(criteria.cleanDoc);
        if (text.includes(criteria.cleanDoc) || text.includes(formatted)) {
          return { matches: true, confirmatory: true };
        }
      } else if (criteria.cleanDoc.length === 11) {
        const mid6 = criteria.cleanDoc.slice(3, 9);
        const formatted = formatCpfCnpjMask(criteria.cleanDoc);
        const hasFullCpf = text.includes(criteria.cleanDoc) || text.includes(formatted);
        const hasMaskedCpf = new RegExp(`xxx${mid6}xx`, 'i').test(text);
        if (hasFullCpf) {
          return { matches: true, confirmatory: true };
        }
        if (hasMaskedCpf) {
          if (!criteria.cleanNome || hasSignificantNameOverlap(text, criteria.cleanNome)) {
            return { matches: true, confirmatory: true };
          }
        }
      }
    }
  }

  // 3. Correspondência por CAR/MT ou SICAR
  if (criteria.carTokens.length > 0 && filterBuild.carFields.length > 0) {
    for (const field of filterBuild.carFields) {
      const raw = rawProps[field];
      if (raw === undefined || raw === null) continue;
      const valNorm = String(raw).toUpperCase().replace(/[^A-Z0-9/]/g, '');
      for (const tok of criteria.carTokens) {
        const tokNorm = tok.toUpperCase().replace(/[^A-Z0-9/]/g, '');
        if (tokNorm && valNorm.includes(tokNorm)) {
          return { matches: true, confirmatory: true };
        }
      }
    }
  }

  // 4. Correspondência por Processo
  if (criteria.procList.length > 0 && filterBuild.procFields.length > 0) {
    for (const field of filterBuild.procFields) {
      const raw = rawProps[field];
      if (raw === undefined || raw === null) continue;
      const valNorm = normalizeForCompare(String(raw));
      for (const proc of criteria.procList) {
        if (valNorm.includes(normalizeForCompare(proc))) {
          return { matches: true, confirmatory: true };
        }
      }
    }
  }

  // 5. Busca exploratória por nome
  if (criteria.buscaExploratoria && criteria.cleanNome && filterBuild.nameFields.length > 0) {
    const normQuery = normalizeForCompare(criteria.cleanNome);
    for (const field of filterBuild.nameFields) {
      const raw = rawProps[field];
      if (raw === undefined || raw === null) continue;
      if (normalizeForCompare(String(raw)).includes(normQuery)) {
        return { matches: true, confirmatory: false };
      }
    }
  }

  return { matches: false, confirmatory: false };
}

function mapFeatureToDocumentItem(
  f: any,
  layerName: string,
  layerTitle: string,
  grupo: string,
  schemaFields: Map<string, string>,
  confirmedDocFields: string[],
  correspondenciaExploratoria: boolean
) {
  const rawProps = f.properties && typeof f.properties === 'object' ? f.properties : {};

  const confirmedIdProp = extractConfirmedFieldValue(
    rawProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.featureId
  );
  const stableId =
    f.id !== undefined && f.id !== null && String(f.id).trim() !== ''
      ? String(f.id).trim()
      : confirmedIdProp
      ? `${layerName}.${confirmedIdProp}`
      : null;

  const preservedProps = preserveSemaProperties(rawProps, confirmedDocFields);

  const rawDocVal = extractConfirmedFieldValue(
    rawProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.documento
  );

  const carEstadual = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.carEstadual
  );
  const carFederal = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.carFederal
  );
  const protocolo = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.protocolo
  );
  const nomePropriedadeRaw = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.nomePropriedade
  );
  const nomePropriedade = nomePropriedadeRaw ? stripOuterQuotesAndBrackets(nomePropriedadeRaw) : undefined;

  const titularRaw = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.titular
  );
  const titular = titularRaw ? stripOuterQuotesAndBrackets(titularRaw) : undefined;

  let cpfCnpjReadable = formatCpfCnpjReadable(rawDocVal);
  if (!cpfCnpjReadable && titular) {
    const docMatch =
      titular.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/) ||
      titular.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/) ||
      titular.match(/(?<![\d/.\-])(\d{14}|\d{11})(?![\d/.\-])/) ;
    if (docMatch?.[0]) {
      cpfCnpjReadable = formatCpfCnpjReadable(docMatch[0]);
    }
  }

  const situacaoRaw = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.situacaoCar
  );
  const situacaoLimpa = situacaoRaw ? stripOuterQuotesAndBrackets(situacaoRaw) : undefined;
  const atividadeRaw = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.atividade
  );
  const atividadeLimpa = atividadeRaw ? stripOuterQuotesAndBrackets(atividadeRaw) : undefined;
  const munCod = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.municipioCodigo
  );
  const munNome = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.municipioNome
  );
  const areaRaw = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.areaHa
  );
  const areaNum =
    areaRaw && !isNaN(Number(areaRaw))
      ? `${Number(areaRaw).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha`
      : undefined;
  const linkDoc = sanitizeHttpUrl(
    extractConfirmedFieldValue(preservedProps, schemaFields, SEMA_FIELD_CANDIDATES.linkDocumento)
  );
  const numProcesso = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.numeroProcesso
  );
  const dataDoc = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.dataDocumento
  );
  const dataVal = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.dataValidade
  );

  if (grupo === 'carImoveis') {
    return {
      id: stableId,
      tipo: atividadeLimpa || layerTitle,
      numeroDocumento: carEstadual || carFederal || protocolo || '',
      nomeDocumento: nomePropriedade || '',
      dataDocumento: dataDoc || '',
      status: situacaoLimpa,
      razaoSocial: titular,
      cpfCnpjMascarado: cpfCnpjReadable,
      municipio: munNome || (munCod ? `Código IBGE ${munCod}` : undefined),
      municipioCodigo: munCod,
      camadaOrigem: layerName,
      camadaTitulo: layerTitle,
      carFederal,
      areaHa: areaNum,
      atividade: atividadeLimpa,
      linkDocumento: linkDoc,
      correspondenciaExploratoria,
      propriedadesBrutas: preservedProps
    };
  }

  const tipoDoc = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.tipoDocumento
  );
  const numDoc = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.numeroDocumento
  );
  const nomeDoc = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.nomeDocumento
  );
  const statusDoc = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.statusDocumento
  );

  return {
    id: stableId,
    tipo: tipoDoc || layerTitle,
    numeroDocumento: numDoc || '',
    nomeDocumento: nomeDoc || '',
    dataDocumento: dataDoc || '',
    dataValidade: dataVal,
    numeroProcesso: numProcesso,
    status: statusDoc,
    razaoSocial: titular,
    cpfCnpjMascarado: cpfCnpjReadable,
    municipio: munNome,
    municipioCodigo: munCod,
    linkDocumento: linkDoc,
    camadaOrigem: layerName,
    camadaTitulo: layerTitle,
    atividade: atividadeLimpa,
    correspondenciaExploratoria,
    propriedadesBrutas: preservedProps
  };
}

async function executeGetFeatureRequest(
  layerName: string,
  cqlFilter: string,
  propertyNames: string[],
  includeSrs4326: boolean
): Promise<{
  ok: boolean;
  features: any[];
  isTimeout?: boolean;
  isFilterIncompatible?: boolean;
  httpStatus?: number;
}> {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: layerName,
    outputFormat: 'application/json',
    count: '25',
    cql_filter: cqlFilter,
    authkey: GEOSERVER_AUTHKEY
  });

  if (includeSrs4326) {
    params.set('srsName', 'EPSG:4326');
  }
  if (propertyNames.length > 0) {
    params.set('propertyName', propertyNames.join(','));
  }

  try {
    const resp = await fetchWithTimeout(`${WFS_URL}?${params.toString()}`, 14000);
    const text = await resp.text();

    if (!resp.ok || /ExceptionReport/i.test(text)) {
      const isFilterIncompatible =
        resp.status === 400 || /cql|filter|property|column|syntax|parse/i.test(text);
      return {
        ok: false,
        features: [],
        isFilterIncompatible,
        httpStatus: resp.status
      };
    }

    const data = JSON.parse(text);
    const features = Array.isArray(data?.features) ? data.features : [];
    return { ok: true, features };
  } catch (err: any) {
    return {
      ok: false,
      features: [],
      isTimeout: isTimeoutError(err)
    };
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

  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.status(405)!.json!({
      error: 'Método não permitido.'
    });
    return;
  }

  let rawCpfCnpj: any;
  let rawProcesso: any;
  let rawProcessos: any[] = [];
  let rawNome: any;
  let rawCar: any;
  let rawCars: any[] = [];
  let rawCoords: any[] = [];
  let rawExploratorio: any;

  if (method === 'GET') {
    let queryCpfCnpj = req.query?.cpfCnpj;
    rawProcesso = req.query?.processo;
    rawNome = req.query?.nome;
    rawCar = req.query?.car;
    rawExploratorio = req.query?.buscaExploratoria;
    const qCars = req.query?.cars;
    const qProcs = req.query?.processos;

    if (req.url) {
      try {
        const parsedUrl = new URL(req.url, 'http://localhost');
        if (queryCpfCnpj === undefined) queryCpfCnpj = parsedUrl.searchParams.get('cpfCnpj') ?? undefined;
        if (rawProcesso === undefined) rawProcesso = parsedUrl.searchParams.get('processo');
        if (rawNome === undefined) rawNome = parsedUrl.searchParams.get('nome');
        if (rawCar === undefined) rawCar = parsedUrl.searchParams.get('car');
        if (rawExploratorio === undefined) rawExploratorio = parsedUrl.searchParams.get('buscaExploratoria');
        const carsParam = qCars ?? parsedUrl.searchParams.get('cars');
        if (carsParam) rawCars = String(carsParam).split(/[,;]/);
        const procsParam = qProcs ?? parsedUrl.searchParams.get('processos');
        if (procsParam) rawProcessos = String(procsParam).split(/[,;]/);
      } catch {}
    }

    if (queryCpfCnpj !== undefined && String(queryCpfCnpj).trim() !== '') {
      res.status(400)!.json!({
        error: 'Por segurança, a consulta por CPF/CNPJ deve ser enviada via requisição segura (POST).'
      });
      return;
    }
  } else {
    try {
      const body = await readJsonBody(req);
      rawCpfCnpj = body.cpfCnpj;
      rawProcesso = body.processo;
      rawProcessos = Array.isArray(body.processos) ? body.processos : [];
      rawNome = body.nome;
      rawCar = body.car;
      rawCars = Array.isArray(body.cars) ? body.cars : [];
      rawCoords = Array.isArray(body.coordenadas) ? body.coordenadas : [];
      rawExploratorio = body.buscaExploratoria;
    } catch (err: any) {
      res.status(400)!.json!({
        error: err?.message || 'Dados inválidos na requisição.'
      });
      return;
    }
  }

  const rawDocStr = String(rawCpfCnpj || '').trim();
  const cleanDoc = rawDocStr.replace(/\D/g, '');

  if (rawDocStr && cleanDoc.length !== 11 && cleanDoc.length !== 14) {
    res.status(400)!.json!({
      error: 'CPF/CNPJ inválido. Informe 11 dígitos (CPF) ou 14 dígitos (CNPJ).'
    });
    return;
  }

  const rawCarStr = sanitizeSearchInput(String(rawCar || ''), 160);
  const allCarInputs = [rawCarStr, ...rawCars.map(c => sanitizeSearchInput(String(c || ''), 120))].filter(Boolean);
  const carTokenSet = new Set<string>();
  for (const carStr of allCarInputs) {
    for (const tok of extractCarSearchTokens(carStr)) {
      carTokenSet.add(tok);
    }
  }
  const carTokens = Array.from(carTokenSet).slice(0, 12);

  const procSet = new Set<string>();
  const rawProcList = [
    ...String(rawProcesso || '').split(/[,;]/),
    ...rawProcessos.map(p => String(p || ''))
  ];
  for (const p of rawProcList) {
    const cleanP = sanitizeSearchInput(p, 60);
    if (cleanP.length >= 3) {
      procSet.add(cleanP);
    }
  }
  const procList = Array.from(procSet).slice(0, 8);

  const coordList: CoordPoint[] = [];
  const coordSeen = new Set<string>();
  for (const c of rawCoords) {
    if (!c || typeof c !== 'object') continue;
    const lat = Number(c.lat);
    const lng = Number(c.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      continue;
    }
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (!coordSeen.has(key)) {
      coordSeen.add(key);
      coordList.push({ lat, lng, label: c.label ? String(c.label).slice(0, 80) : undefined });
    }
    if (coordList.length >= 5) break;
  }

  const cleanNome = sanitizeSearchInput(String(rawNome || ''), 100);
  const hasConfirmatoryCriteria = Boolean(
    cleanDoc || carTokens.length > 0 || procList.length > 0 || coordList.length > 0
  );
  const explicitExploratory = rawExploratorio === true || rawExploratorio === 'true' || rawExploratorio === '1';
  const buscaExploratoria = Boolean(cleanNome && (explicitExploratory || !hasConfirmatoryCriteria));

  if (!hasConfirmatoryCriteria && !buscaExploratoria) {
    res.status(400)!.json!({
      error: 'Informe CPF/CNPJ, Número do CAR/MT, Processo ou um termo para busca por nome (mín. 3 caracteres).'
    });
    return;
  }

  if (buscaExploratoria && cleanNome.length < 3) {
    res.status(400)!.json!({
      error: 'Para busca por nome, informe ao menos 3 caracteres.'
    });
    return;
  }

  const capResult = await getCapabilities();
  if (!capResult.ok) {
    res.status(capResult.isTimeout ? 504 : 502)!.json!({
      error: capResult.errorMsg || 'Falha ao consultar a base pública da SEMA-MT.',
      consultadoEm: new Date().toISOString()
    });
    return;
  }

  const resultado = {
    carImoveis: [] as any[],
    licencas: [] as any[],
    notificacoes: [] as any[],
    autosInfracao: [] as any[],
    termosEmbargo: [] as any[],
    outros: [] as any[]
  };

  const layerResults = await Promise.all(
    TARGET_LAYERS.map(async target => {
      const capWfs = capResult.wfsLayers.get(target.name);
      const capWms = capResult.wmsLayers.get(target.name);
      const layerTitle = capWfs?.title || capWms?.title || target.name;

      if (!capWfs) {
        return {
          status: {
            camada: target.name,
            titulo: layerTitle,
            grupo: target.grupo,
            status: 'indisponivel' as CamadaStatusCode,
            suportado: false,
            registrosEncontrados: 0,
            mensagem: 'Base não disponível no momento.'
          },
          items: [] as any[]
        };
      }

      const schemaRes = await describeLayerFieldsXml(target.name);
      if (!schemaRes.ok) {
        return {
          status: {
            camada: target.name,
            titulo: layerTitle,
            grupo: target.grupo,
            status: 'indisponivel' as CamadaStatusCode,
            suportado: false,
            registrosEncontrados: 0,
            mensagem: schemaRes.errorMsg || 'Não foi possível consultar esta base no momento.'
          },
          items: [] as any[]
        };
      }

      const filterBuild = buildSchemaFilterForLayer(schemaRes.fields, schemaRes.geomFields, target.grupo, {
        cleanDoc,
        carTokens,
        procList,
        coordenadas: coordList,
        cleanNome,
        buscaExploratoria
      });

      if (!filterBuild.supported) {
        return {
          status: {
            camada: target.name,
            titulo: layerTitle,
            grupo: target.grupo,
            status: 'nao_suportado' as CamadaStatusCode,
            suportado: false,
            registrosEncontrados: 0,
            mensagem: filterBuild.unsupportedReason || 'Critério não aplicável a esta base.'
          },
          items: [] as any[]
        };
      }

      const propertyNames = Array.from(schemaRes.fields.keys()).filter(
        fieldName => !schemaRes.geomFields.has(fieldName)
      );

      const queryTasks: Array<Promise<{ isSpatial: boolean; res: Awaited<ReturnType<typeof executeGetFeatureRequest>> }>> = [];

      if (filterBuild.attrCqlFilter) {
        queryTasks.push(
          executeGetFeatureRequest(target.name, filterBuild.attrCqlFilter, propertyNames, false).then(res => ({
            isSpatial: false,
            res
          }))
        );
      }

      if (filterBuild.spatialCqlFilter) {
        queryTasks.push(
          executeGetFeatureRequest(target.name, filterBuild.spatialCqlFilter, propertyNames, true).then(res => ({
            isSpatial: true,
            res
          }))
        );
      }

      const responses = await Promise.all(queryTasks);
      const anyOk = responses.some(r => r.res.ok);

      if (!anyOk) {
        const firstErr = responses[0]?.res;
        const isFilterIncompatible = Boolean(firstErr?.isFilterIncompatible);
        const isTimeout = Boolean(firstErr?.isTimeout);
        return {
          status: {
            camada: target.name,
            titulo: layerTitle,
            grupo: target.grupo,
            status: (isFilterIncompatible ? 'filtro_incompativel' : 'erro_comunicacao') as CamadaStatusCode,
            suportado: !isFilterIncompatible,
            registrosEncontrados: 0,
            camposPesquisados: filterBuild.fieldsUsed,
            mensagem: isFilterIncompatible
              ? 'Critério de busca não compatível com esta base.'
              : isTimeout
              ? 'Tempo limite esgotado ao consultar esta base.'
              : 'Falha de comunicação ao consultar esta base.'
          },
          items: [] as any[]
        };
      }

      const seenIds = new Set<string>();
      const items: any[] = [];

      for (const { isSpatial, res: qRes } of responses) {
        if (!qRes.ok) continue;
        for (const f of qRes.features) {
          const rawProps = f?.properties && typeof f.properties === 'object' ? f.properties : {};
          const matchEval = evaluateFeatureMatch(rawProps, isSpatial, filterBuild, {
            cleanDoc,
            carTokens,
            procList,
            cleanNome,
            buscaExploratoria
          });

          if (!matchEval.matches) continue;

          const item = mapFeatureToDocumentItem(
            f,
            target.name,
            layerTitle,
            target.grupo,
            schemaRes.fields,
            filterBuild.confirmedDocFields,
            !matchEval.confirmatory
          );

          if (item.id) {
            if (seenIds.has(item.id)) continue;
            seenIds.add(item.id);
          }
          items.push(item);
        }
      }

      return {
        status: {
          camada: target.name,
          titulo: layerTitle,
          grupo: target.grupo,
          status: (items.length > 0 ? 'consultada' : 'sem_resultados') as CamadaStatusCode,
          suportado: true,
          registrosEncontrados: items.length,
          camposPesquisados: filterBuild.fieldsUsed,
          mensagem:
            items.length > 0
              ? `${items.length} registro(s) encontrado(s).`
              : 'Nenhum registro encontrado para os critérios informados.'
        },
        items
      };
    })
  );

  const camadasConsultadas: CamadaStatus[] = [];

  for (const r of layerResults) {
    camadasConsultadas.push(r.status);
    if (r.status.grupo === 'carImoveis') resultado.carImoveis.push(...r.items);
    else if (r.status.grupo === 'licencas') resultado.licencas.push(...r.items);
    else if (r.status.grupo === 'notificacoes') resultado.notificacoes.push(...r.items);
    else if (r.status.grupo === 'autosInfracao') resultado.autosInfracao.push(...r.items);
    else if (r.status.grupo === 'termosEmbargo') resultado.termosEmbargo.push(...r.items);
    else resultado.outros.push(...r.items);
  }

  resultado.carImoveis = deduplicateCarImoveisByCar(resultado.carImoveis);

  const totalRegistros =
    resultado.carImoveis.length +
    resultado.licencas.length +
    resultado.notificacoes.length +
    resultado.autosInfracao.length +
    resultado.termosEmbargo.length +
    resultado.outros.length;

  const consultadasCount = camadasConsultadas.filter(
    c => c.status === 'consultada' || c.status === 'sem_resultados'
  ).length;
  const naoSuportadasCount = camadasConsultadas.filter(c => c.status === 'nao_suportado').length;
  const falhasCount = camadasConsultadas.filter(
    c =>
      c.status === 'erro_comunicacao' ||
      c.status === 'indisponivel' ||
      c.status === 'filtro_incompativel'
  ).length;

  let mensagemStatus = '';
  if (totalRegistros > 0) {
    mensagemStatus = `${totalRegistros} registro(s) encontrado(s) na base pública da SEMA-MT.`;
    if (buscaExploratoria && !hasConfirmatoryCriteria) {
      mensagemStatus += ' Resultados obtidos por correspondência textual de nome.';
    }
  } else if (consultadasCount === 0 && falhasCount > 0) {
    mensagemStatus = 'Não foi possível concluir a consulta na base pública da SEMA-MT no momento.';
  } else if (consultadasCount === 0 && naoSuportadasCount > 0) {
    mensagemStatus = 'Os critérios informados não retornaram correspondência direta nas bases disponíveis.';
  } else {
    mensagemStatus = 'Consulta concluída sem registros correspondentes na base pública da SEMA-MT.';
  }

  res.status(200)!.json!({
    sucesso: consultadasCount > 0 || (naoSuportadasCount > 0 && falhasCount === 0),
    criteriosUtilizados: {
      temCpfCnpj: Boolean(cleanDoc),
      car: rawCarStr || undefined,
      cars: carTokens.length > 0 ? carTokens : undefined,
      processo: procList[0] || undefined,
      processos: procList.length > 0 ? procList : undefined,
      coordenadasCount: coordList.length,
      nomeExploratorio: buscaExploratoria ? cleanNome : undefined,
      buscaExploratoria
    },
    ...resultado,
    totalRegistros,
    consultadoEm: new Date().toISOString(),
    mensagemStatus,
    camadasConsultadas
  });
}
