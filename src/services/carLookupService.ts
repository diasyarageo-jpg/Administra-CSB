// src/services/carLookupService.ts
/**
 * Serviço cliente para consulta espacial ao CAR/MT, pesquisa de documentos
 * e sincronização da base do Geoportal SEMA-MT.
 */

import {
  CAR_CAMPOS,
  extractFirstMatchingField,
  maskCpfCnpjDisplay,
  sanitizeSemaProperties
} from '../config/carCampos';
import {
  CarFeatureMapped,
  CarGeoJsonFeature,
  CarLookupApiResponse,
  CarLookupResult,
  SemaDocumentoItem,
  SemaDocumentosGroupedResult,
  GeoportalSyncResult
} from '../types/carLookup';
import { parseCoordAdvanced, decimalToGms } from './coordService';
import { getMatoGrossoMunicipios } from './ibgeService';
import { supabase, isSupabaseConfigured } from './supabaseClient';

let mtMunicipiosCache: { id: number; nome: string }[] = [];
getMatoGrossoMunicipios()
  .then(list => {
    mtMunicipiosCache = list;
  })
  .catch(() => {});

const SEMA_LOOKUP_STORAGE_PREFIX = 'administra:sema_consulta:v1:';
const semaLookupMemoryStore = new Map<string, unknown>();

async function getOptionalAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  if (!isSupabaseConfigured() || !supabase) return {};
  try {
    const { data } = await supabase.auth.getSession();
    let session = data?.session;

    const expiresAtMs = session?.expires_at ? Number(session.expires_at) * 1000 : 0;
    const isNearExpiry = Boolean(expiresAtMs && expiresAtMs - Date.now() < 60_000);

    if ((forceRefresh || isNearExpiry || !session?.access_token) && session) {
      const { data: refreshed } = await supabase.auth.refreshSession().catch(() => ({ data: null }));
      if (refreshed?.session) {
        session = refreshed.session;
      }
    }

    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function parseApiJsonOrText<T = any>(
  res: Response
): Promise<{ data: T | null; rawText: string }> {
  const rawText = await res.text().catch(() => '');
  if (!rawText) {
    return { data: null, rawText: '' };
  }
  try {
    return { data: JSON.parse(rawText) as T, rawText };
  } catch {
    return { data: null, rawText };
  }
}

function buildHttpFallbackErrorMessage(status: number, rawText: string, defaultLabel: string): string {
  const trimmed = String(rawText || '').trim();
  if (status === 403) {
    if (/allowedHosts|Blocked request/i.test(trimmed)) {
      return `${defaultLabel} (HTTP 403 — host da requisição bloqueado no servidor).`;
    }
    if (/<html/i.test(trimmed)) {
      return `${defaultLabel} (HTTP 403 — acesso bloqueado por proteção/proxy do servidor).`;
    }
  }
  return `${defaultLabel} (HTTP ${status}).`;
}

function isProxyHtmlBlock(status: number, rawText: string, data: any): boolean {
  if (status === 403 && !data && /<html/i.test(String(rawText || ''))) return true;
  if (status === 403 && !data) return true;
  return false;
}

function mapMappedCarFeatureToSemaItem(
  feat: CarFeatureMapped,
  consultadoEm: string
): SemaDocumentoItem {
  return {
    id: feat.id || feat.car || feat.carFederal || '',
    auditoriaId: feat.auditoriaId,
    auditoriaDisponivel: feat.auditoriaDisponivel,
    tipo: feat.atividade || 'CAR / Imóvel Rural',
    numeroDocumento: feat.car || feat.carFederal || '',
    nomeDocumento: feat.empreendimento || '',
    dataDocumento: '',
    status: feat.situacaoCar,
    razaoSocial: feat.empreendedor,
    municipio: feat.municipio || (feat.municipioCodigo ? `Código IBGE ${feat.municipioCodigo}` : undefined),
    municipioCodigo: feat.municipioCodigo,
    camadaOrigem: feat.camadaOrigem || 'Geoportal:CAR_ATP',
    camadaTitulo: feat.camadaOrigem || 'Geoportal:CAR_ATP',
    carFederal: feat.carFederal,
    areaHa: feat.areaHa ? `${feat.areaHa} ha` : undefined,
    atividade: feat.atividade,
    criterioEspacial: feat.criterioEspacial,
    distanciaMetros: feat.distanciaMetros,
    observacaoEspacial: feat.evidenciaNota,
    camposConfirmadosEsquema: feat.camposConfirmadosEsquema,
    cpfCnpjCompletoDisponivel: feat.cpfCnpjCompletoDisponivel,
    cpfCnpjCampoOrigem: feat.cpfCnpjCampoOrigem,
    cpfCnpjStatus: feat.cpfCnpjStatus,
    consultadoEm,
    propriedadesBrutas: feat.propriedadesBrutas || {}
  };
}

function mapSemaCacheRowToDocumentoItem(row: any, fallbackTimestamp: string): SemaDocumentoItem {
  const areaVal =
    row?.area_ha !== undefined && row?.area_ha !== null && !isNaN(Number(row.area_ha))
      ? `${Number(row.area_ha).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha`
      : undefined;
  const camada = String(row?.camada || 'Geoportal:CAR_ATP');
  const carNum = row?.numero_estadual || row?.car_federal || '';

  return {
    id: String(row?.id || carNum || 'sema_cache'),
    tipo: 'CAR / Imóvel Rural',
    numeroDocumento: String(carNum),
    nomeDocumento: String(row?.nome_propriedade || ''),
    dataDocumento: '',
    numeroProcesso: row?.numero_processo ? String(row.numero_processo) : undefined,
    status: row?.situacao_car ? String(row.situacao_car) : undefined,
    razaoSocial: row?.nome_proprietario ? String(row.nome_proprietario) : undefined,
    municipio: row?.municipio_nome ? String(row.municipio_nome) : undefined,
    camadaOrigem: camada,
    camadaTitulo: `${camada} (Cache sincronizado)`,
    carFederal: row?.car_federal ? String(row.car_federal) : undefined,
    areaHa: areaVal,
    linkDocumento: row?.link_documento ? String(row.link_documento) : undefined,
    cpfCnpjCompletoDisponivel: false,
    cpfCnpjStatus: 'ausente',
    consultadoEm: row?.sincronizado_em ? String(row.sincronizado_em) : fallbackTimestamp,
    propriedadesBrutas: {
      ...(row?.numero_estadual ? { NUMEROESTADUAL: row.numero_estadual } : {}),
      ...(row?.car_federal ? { CAR_FEDERAL: row.car_federal } : {}),
      ...(row?.nome_propriedade ? { NOMEPROPRIEDADE: row.nome_propriedade } : {}),
      ...(row?.nome_proprietario ? { NOMESPROPRIETARIOS: row.nome_proprietario } : {}),
      ...(row?.municipio_nome ? { MUNICIPIO: row.municipio_nome } : {}),
      ...(row?.situacao_car ? { SITUACAO: row.situacao_car } : {}),
      ...(row?.numero_processo ? { PROTOCOLO: row.numero_processo } : {})
    }
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isValidSemaAuditoriaId(val: unknown): boolean {
  return UUID_REGEX.test(String(val || '').trim());
}

const SENSITIVE_STORAGE_KEY_RE =
  /^(cpf|cnpj|cpfcnpj|cpf_cnpj|nr_cpf|nr_cnpj|nr_cpf_cnpj|documento_titular|querydigits|rawquery)$/i;

const NON_DOC_STORAGE_KEY_RE =
  /^(id|featureid|empreendedoridselecionado|codigo|ibge|municipio_codigo|municipiocodigo|municipioibge|cod_ibge|processo|numeroprocesso|numero_processo|protocolo|protocolo_numero|numero_documento|numerodocumento|car|car_federal|carfederal|carestadual|numeroestadual|objectid|gid|fid)$/i;

function scrubSensitiveStringForStorage(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return raw;
  const masked = maskCpfCnpjDisplay(trimmed);
  if (masked && masked !== trimmed) return masked;
  return trimmed
    .replace(/\b(\d{3})\.(\d{3})\.(\d{3})-(\d{2})\b/g, '***.$2.***-$4')
    .replace(/\b(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})-(\d{2})\b/g, '**.$2.***/$4-**')
    .replace(/(?<![\/.\-\d])(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})(?![\/.\-\d])/g, '**.$2.***/$4-**')
    .replace(/(?<![\/.\-\d])(\d{3})(\d{3})(\d{3})(\d{2})(?![\/.\-\d])/g, '***.$2.***-$4');
}

export function sanitizePersistedLookupForStorage<T>(value: T, parentKey = ''): T {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      NON_DOC_STORAGE_KEY_RE.test(parentKey) &&
      (/^\d{11}$/.test(trimmed) || /^\d{14}$/.test(trimmed))
    ) {
      return value;
    }
    if (SENSITIVE_STORAGE_KEY_RE.test(parentKey)) {
      const digits = value.replace(/\D/g, '');
      if (digits.length === 11 || digits.length === 14) {
        return (maskCpfCnpjDisplay(digits) || '***') as unknown as T;
      }
    }
    return scrubSensitiveStringForStorage(value) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizePersistedLookupForStorage(item, parentKey)) as unknown as T;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, any>;
    if (parentKey === 'propriedadesBrutas' || parentKey === 'properties') {
      return sanitizeSemaProperties(obj) as unknown as T;
    }

    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'propriedadesBrutas' || k === 'properties') {
        out[k] = sanitizeSemaProperties(v);
      } else if (k === 'query' && typeof v === 'string') {
        const digits = v.replace(/\D/g, '');
        out[k] =
          digits.length === 11 || digits.length === 14
            ? maskCpfCnpjDisplay(digits) || '***'
            : scrubSensitiveStringForStorage(v);
      } else {
        out[k] = sanitizePersistedLookupForStorage(v, k);
      }
    }
    return out as T;
  }

  return value;
}

export function getPersistedSemaLookup<T>(scopeKey: string): T | null {
  const key = String(scopeKey || '').trim();
  if (!key) return null;

  if (semaLookupMemoryStore.has(key)) {
    return semaLookupMemoryStore.get(key) as T;
  }

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const raw = window.sessionStorage.getItem(`${SEMA_LOOKUP_STORAGE_PREFIX}${key}`);
      if (raw) {
        const parsed = JSON.parse(raw) as T;
        semaLookupMemoryStore.set(key, parsed);
        return parsed;
      }
    } catch {
      // Ignora falhas de acesso ao sessionStorage mantendo uso normal em memória
    }
  }

  return null;
}

export function setPersistedSemaLookup<T>(scopeKey: string, value: T): void {
  const key = String(scopeKey || '').trim();
  if (!key) return;

  semaLookupMemoryStore.set(key, value);

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const safeForStorage = sanitizePersistedLookupForStorage(value);
      window.sessionStorage.setItem(
        `${SEMA_LOOKUP_STORAGE_PREFIX}${key}`,
        JSON.stringify(safeForStorage)
      );
    } catch {
      // Caso exceda cota do sessionStorage, mantém preservado no store em memória sem expirar
    }
  }
}

export function clearPersistedSemaLookup(scopeKey: string): void {
  const key = String(scopeKey || '').trim();
  if (!key) return;

  semaLookupMemoryStore.delete(key);

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(`${SEMA_LOOKUP_STORAGE_PREFIX}${key}`);
    } catch {
      // Ignora falha de remoção no sessionStorage
    }
  }
}

/**
 * Converte as propriedades de uma feição GeoJSON retornada pelo GeoServer
 * em um objeto mapeado com os campos do Administra-CSB.
 * Lê de feature.properties e preserva todas as propriedades brutas intactas.
 */
export function mapPropertiesToCarFeature(feature: CarGeoJsonFeature): CarFeatureMapped {
  const props =
    feature && feature.properties && typeof feature.properties === 'object'
      ? feature.properties
      : {};

  let municipioNome = extractFirstMatchingField(props, CAR_CAMPOS.municipio);
  const municipioCodigo = extractFirstMatchingField(props, CAR_CAMPOS.municipioCodigo);

  if (!municipioNome && municipioCodigo && mtMunicipiosCache.length > 0) {
    const codNum = parseInt(municipioCodigo, 10);
    const found = mtMunicipiosCache.find(m => m.id === codNum);
    if (found) {
      municipioNome = found.nome;
    }
  }

  const schemaMeta = feature?._schemaMeta;
  const spatialMeta = feature?._spatialMeta;

  return {
    id: feature?.id ? String(feature.id) : undefined,
    auditoriaId: feature?.auditoriaId ? String(feature.auditoriaId) : undefined,
    auditoriaDisponivel:
      typeof feature?.auditoriaDisponivel === 'boolean'
        ? feature.auditoriaDisponivel
        : undefined,
    camadaOrigem: feature?.camadaOrigem,
    car: extractFirstMatchingField(props, CAR_CAMPOS.car),
    carFederal: extractFirstMatchingField(props, CAR_CAMPOS.carFederal),
    empreendedor: extractFirstMatchingField(props, CAR_CAMPOS.empreendedor),
    empreendimento: extractFirstMatchingField(props, CAR_CAMPOS.empreendimento),
    municipio: municipioNome,
    municipioCodigo,
    uf: extractFirstMatchingField(props, CAR_CAMPOS.uf),
    situacaoCar: extractFirstMatchingField(props, CAR_CAMPOS.situacaoCar),
    areaHa: extractFirstMatchingField(props, CAR_CAMPOS.areaHa),
    atividade: extractFirstMatchingField(props, CAR_CAMPOS.atividade),
    apfNumero: extractFirstMatchingField(props, CAR_CAMPOS.apfNumero),
    numeroArt: extractFirstMatchingField(props, CAR_CAMPOS.numeroArt),
    modulosFiscais: extractFirstMatchingField(props, CAR_CAMPOS.modulosFiscais),
    criterioEspacial: spatialMeta?.criterioEspacial,
    distanciaMetros: spatialMeta?.distanciaMetros,
    fonteEspacial: spatialMeta?.fonte,
    evidenciaNota: spatialMeta?.evidenciaNota,
    camposConfirmadosEsquema: Array.isArray(schemaMeta?.camposConfirmados)
      ? schemaMeta.camposConfirmados
      : undefined,
    cpfCnpjCompletoDisponivel: schemaMeta?.cpfCnpjCompletoDisponivel,
    cpfCnpjCampoOrigem: schemaMeta?.cpfCnpjCampoOrigem,
    cpfCnpjStatus: schemaMeta?.cpfCnpjStatus,
    propriedadesBrutas: props
  };
}

/**
 * Consulta camadas CAR/ATP do Geoportal SEMA-MT via WFS a partir de coordenadas GMS ou decimais.
 */
export async function consultarCarPorCoordenada(
  latInput: string | number | null | undefined,
  lngInput: string | number | null | undefined,
  targetContext?: {
    entidadeAlvoTipo?: 'barragem' | 'empreendedor' | 'car';
    entidadeAlvoId?: string;
    incluirProximidade?: boolean;
    raioMetros?: number;
  }
): Promise<CarLookupResult> {
  const latRes = parseCoordAdvanced(latInput, false);
  const lngRes = parseCoordAdvanced(lngInput, true);

  if (!latRes.valido || latRes.decimal === null) {
    return {
      sucesso: false,
      encontrado: false,
      feicoes: [],
      feicoesBrutas: [],
      consultadoEm: new Date().toISOString(),
      mensagemErro:
        latRes.mensagem ||
        'Latitude inválida ou incompleta. Informe coordenadas em formato GMS (ex: 15°35\'45,00"S).'
    };
  }

  if (!lngRes.valido || lngRes.decimal === null) {
    return {
      sucesso: false,
      encontrado: false,
      feicoes: [],
      feicoesBrutas: [],
      consultadoEm: new Date().toISOString(),
      mensagemErro:
        lngRes.mensagem ||
        'Longitude inválida ou incompleta. Informe coordenadas em formato GMS (ex: 56°05\'48,00"W).'
    };
  }

  const decLat = latRes.decimal;
  const decLng = lngRes.decimal;

  try {
    const params = new URLSearchParams({
      lat: String(decLat),
      lng: String(decLng)
    });
    if (targetContext?.entidadeAlvoTipo) {
      params.set('entidadeAlvoTipo', targetContext.entidadeAlvoTipo);
    }
    if (targetContext?.entidadeAlvoId) {
      params.set('entidadeAlvoId', targetContext.entidadeAlvoId);
    }
    if (targetContext?.incluirProximidade) {
      params.set('incluirProximidade', 'true');
    }
    if (targetContext?.raioMetros) {
      params.set('raioMetros', String(targetContext.raioMetros));
    }

    const doFetchGet = async (forceRefresh: boolean) => {
      const authHeaders = await getOptionalAuthHeaders(forceRefresh);
      return await fetch(`/api/car-lookup?${params.toString()}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...authHeaders
        }
      });
    };

    const doFetchPost = async (forceRefresh: boolean) => {
      const authHeaders = await getOptionalAuthHeaders(forceRefresh);
      return await fetch('/api/car-lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...authHeaders
        },
        body: JSON.stringify({
          lat: decLat,
          lng: decLng,
          ...(targetContext?.entidadeAlvoTipo
            ? { entidadeAlvoTipo: targetContext.entidadeAlvoTipo }
            : {}),
          ...(targetContext?.entidadeAlvoId
            ? { entidadeAlvoId: targetContext.entidadeAlvoId }
            : {}),
          ...(targetContext?.incluirProximidade ? { incluirProximidade: true } : {}),
          ...(targetContext?.raioMetros ? { raioMetros: targetContext.raioMetros } : {})
        })
      });
    };

    let res = await doFetchPost(false);
    if (res.status === 401 && isSupabaseConfigured()) {
      res = await doFetchPost(true);
    }

    let { data: parsedData, rawText } = await parseApiJsonOrText<CarLookupApiResponse>(res);
    if (isProxyHtmlBlock(res.status, rawText, parsedData) || res.status === 404 || res.status === 405) {
      res = await doFetchGet(false);
      if (res.status === 401 && isSupabaseConfigured()) {
        res = await doFetchGet(true);
      }
      ({ data: parsedData, rawText } = await parseApiJsonOrText<CarLookupApiResponse>(res));
    }

    const data: CarLookupApiResponse = parsedData || {
      encontrado: false,
      feicoes: [],
      consultadoEm: new Date().toISOString(),
      error: buildHttpFallbackErrorMessage(res.status, rawText, 'Erro ao consultar Geoportal SEMA-MT')
    };

    if (!res.ok || data.error) {
      return {
        sucesso: false,
        encontrado: false,
        feicoes: [],
        feicoesBrutas: [],
        coordenadasUtilizadas: {
          lat: decLat,
          lng: decLng,
          latGms: decimalToGms(decLat, false),
          lngGms: decimalToGms(decLng, true)
        },
        camadasConsultadas: Array.isArray(data.camadasConsultadas)
          ? data.camadasConsultadas
          : undefined,
        auditoriaDisponivel:
          typeof data.auditoriaDisponivel === 'boolean' ? data.auditoriaDisponivel : undefined,
        consultadoEm: data.consultadoEm || new Date().toISOString(),
        mensagemErro:
          data.error ||
          buildHttpFallbackErrorMessage(res.status, rawText, 'Erro ao consultar Geoportal SEMA-MT')
      };
    }

    const rawFeatures: CarGeoJsonFeature[] = Array.isArray(data.feicoes) ? data.feicoes : [];
    const feicoesMapeadas: CarFeatureMapped[] = rawFeatures.map(mapPropertiesToCarFeature);

    return {
      sucesso: true,
      encontrado: feicoesMapeadas.length > 0,
      feicoes: feicoesMapeadas,
      feicoesBrutas: rawFeatures,
      coordenadasUtilizadas: {
        lat: decLat,
        lng: decLng,
        latGms: decimalToGms(decLat, false),
        lngGms: decimalToGms(decLng, true)
      },
      camadasConsultadas: Array.isArray(data.camadasConsultadas)
        ? data.camadasConsultadas
        : undefined,
      mensagemStatus: data.mensagemStatus,
      auditoriaDisponivel:
        typeof data.auditoriaDisponivel === 'boolean' ? data.auditoriaDisponivel : undefined,
      consultadoEm: data.consultadoEm || new Date().toISOString()
    };
  } catch (err: any) {
    return {
      sucesso: false,
      encontrado: false,
      feicoes: [],
      feicoesBrutas: [],
      consultadoEm: new Date().toISOString(),
      mensagemErro:
        err?.message || 'Falha de conexão com a API de consulta ao Geoportal SEMA-MT.'
    };
  }
}

export interface ConsultarDocumentosSemaParams {
  cpfCnpj?: string;
  processo?: string;
  processos?: string[];
  nome?: string;
  car?: string;
  cars?: string[];
  coordenadas?: Array<{ lat: number; lng: number; label?: string }>;
  buscaExploratoria?: boolean;
  entidadeAlvoTipo?: 'empreendedor' | 'barragem' | 'car';
  entidadeAlvoId?: string;
}

/**
 * Consulta registros, licenças, notificações e imóveis CAR na base pública da SEMA-MT.
 */
export async function consultarDocumentosSema(
  param: string | ConsultarDocumentosSemaParams,
  processoArg?: string
): Promise<SemaDocumentosGroupedResult> {
  let cleanDoc = '';
  let processo = '';
  let processos: string[] = [];
  let nome = '';
  let car = '';
  let cars: string[] = [];
  let coordenadas: Array<{ lat: number; lng: number; label?: string }> = [];
  let buscaExploratoria = false;
  let entidadeAlvoTipo: 'empreendedor' | 'barragem' | 'car' | undefined;
  let entidadeAlvoId: string | undefined;

  if (typeof param === 'string') {
    cleanDoc = String(param || '').replace(/\D/g, '');
    processo = processoArg || '';
  } else if (param && typeof param === 'object') {
    cleanDoc = String(param.cpfCnpj || '').replace(/\D/g, '');
    processo = String(param.processo || '').trim();
    processos = Array.isArray(param.processos) ? param.processos.filter(Boolean) : [];
    nome = String(param.nome || '').trim();
    car = String(param.car || '').trim();
    cars = Array.isArray(param.cars) ? param.cars.filter(Boolean) : [];
    coordenadas = Array.isArray(param.coordenadas) ? param.coordenadas : [];
    buscaExploratoria = Boolean(param.buscaExploratoria);
    entidadeAlvoTipo = param.entidadeAlvoTipo;
    entidadeAlvoId = param.entidadeAlvoId ? String(param.entidadeAlvoId).trim() : undefined;
  }

  const hasConfirmatory = Boolean(
    cleanDoc || car || cars.length > 0 || processo || processos.length > 0 || coordenadas.length > 0
  );
  const useExploratoryName = Boolean(nome && (buscaExploratoria || !hasConfirmatory));

  if (!hasConfirmatory && !useExploratoryName) {
    return {
      sucesso: false,
      criteriosUtilizados: {
        temCpfCnpj: false,
        buscaExploratoria: false
      },
      carImoveis: [],
      licencas: [],
      notificacoes: [],
      autosInfracao: [],
      termosEmbargo: [],
      outros: [],
      totalRegistros: 0,
      consultadoEm: new Date().toISOString(),
      mensagemStatus:
        'Informe ao menos um critério válido (CPF/CNPJ, Nº do CAR/MT, Processo ou busca por Nome).',
      camadasConsultadas: []
    };
  }

  try {
    const usePost = Boolean(
      cleanDoc || cars.length > 0 || processos.length > 0 || coordenadas.length > 0 || nome
    );

    const doFetchPost = async (forceRefresh: boolean): Promise<Response> => {
      const authHeaders = await getOptionalAuthHeaders(forceRefresh);
      return await fetch('/api/sema-documentos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...authHeaders
        },
        body: JSON.stringify({
          ...(cleanDoc ? { cpfCnpj: cleanDoc } : {}),
          ...(car ? { car } : {}),
          ...(cars.length > 0 ? { cars } : {}),
          ...(processo ? { processo } : {}),
          ...(processos.length > 0 ? { processos } : {}),
          ...(coordenadas.length > 0 ? { coordenadas } : {}),
          ...(nome ? { nome } : {}),
          ...(useExploratoryName ? { buscaExploratoria: true } : {}),
          ...(entidadeAlvoTipo ? { entidadeAlvoTipo } : {}),
          ...(entidadeAlvoId ? { entidadeAlvoId } : {})
        })
      });
    };

    const canUseSafeGet = Boolean(
      car || cars.length > 0 || processo || processos.length > 0 || useExploratoryName
    );

    const doFetchSafeGet = async (forceRefresh: boolean): Promise<Response> => {
      const authHeaders = await getOptionalAuthHeaders(forceRefresh);
      const params = new URLSearchParams();
      if (processo) params.set('processo', processo);
      if (processos.length > 0) params.set('processos', processos.slice(0, 8).join(','));
      if (car) params.set('car', car);
      if (cars.length > 0) params.set('cars', cars.slice(0, 10).join(','));
      if (useExploratoryName && nome) {
        params.set('nome', nome);
        params.set('buscaExploratoria', 'true');
      }
      if (entidadeAlvoTipo) params.set('entidadeAlvoTipo', entidadeAlvoTipo);
      if (entidadeAlvoId) params.set('entidadeAlvoId', entidadeAlvoId);

      return await fetch(`/api/sema-documentos?${params.toString()}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...authHeaders
        }
      });
    };

    let res = usePost ? await doFetchPost(false) : await doFetchSafeGet(false);
    if (res.status === 401 && isSupabaseConfigured()) {
      res = usePost ? await doFetchPost(true) : await doFetchSafeGet(true);
    }

    let { data, rawText } = await parseApiJsonOrText<any>(res);

    // Fallback 1: se POST /api/sema-documentos for bloqueado por proxy/WAF (HTTP 403 HTML ou 405),
    // tenta GET seguro (sem CPF/CNPJ na URL) para CAR/Processo/Nome e /api/car-lookup para coordenadas.
    if (usePost && (isProxyHtmlBlock(res.status, rawText, data) || res.status === 405 || res.status === 404)) {
      if (canUseSafeGet) {
        res = await doFetchSafeGet(false);
        if (res.status === 401 && isSupabaseConfigured()) {
          res = await doFetchSafeGet(true);
        }
        ({ data, rawText } = await parseApiJsonOrText<any>(res));
      }

      if ((!res.ok || !data || data.error) && coordenadas.length > 0) {
        const coordFeatures: SemaDocumentoItem[] = [];
        for (const c of coordenadas.slice(0, 3)) {
          const coordRes = await consultarCarPorCoordenada(c.lat, c.lng, {
            entidadeAlvoTipo,
            entidadeAlvoId
          });
          if (coordRes.sucesso && coordRes.feicoes.length > 0) {
            for (const f of coordRes.feicoes) {
              coordFeatures.push(mapMappedCarFeatureToSemaItem(f, coordRes.consultadoEm));
            }
          }
        }
        if (coordFeatures.length > 0) {
          return {
            sucesso: true,
            criteriosUtilizados: {
              temCpfCnpj: Boolean(cleanDoc),
              car: car || undefined,
              cars: cars.length > 0 ? cars : undefined,
              processo: processo || undefined,
              processos: processos.length > 0 ? processos : undefined,
              coordenadasCount: coordenadas.length,
              nomeExploratorio: useExploratoryName ? nome : undefined,
              buscaExploratoria: useExploratoryName
            },
            carImoveis: coordFeatures,
            licencas: [],
            notificacoes: [],
            autosInfracao: [],
            termosEmbargo: [],
            outros: [],
            totalRegistros: coordFeatures.length,
            consultadoEm: new Date().toISOString(),
            mensagemStatus: `${coordFeatures.length} imóvel(is) CAR localizado(s) por coordenada na SEMA-MT.`,
            camadasConsultadas: []
          };
        }
      }
    }

    // Fallback 2: se /api/sema-documentos continuar bloqueado (403 HTML / 502 / 504),
    // consulta o cache sincronizado no Supabase via RPC autenticada (consultar_cruzamento_sema_integrado).
    if ((!res.ok || !data || data.error) && isSupabaseConfigured() && supabase) {
      const allCarArgs = Array.from(new Set([car, ...cars].map(c => c.trim()).filter(Boolean)));
      if (allCarArgs.length > 0 || cleanDoc) {
        try {
          const { data: rpcData, error: rpcErr } = await supabase.rpc(
            'consultar_cruzamento_sema_integrado',
            {
              p_cars: allCarArgs,
              p_cpf_cnpj: cleanDoc || null
            }
          );
          if (!rpcErr && rpcData) {
            const cacheRows = Array.isArray(rpcData.sema_cache) ? rpcData.sema_cache : [];
            if (cacheRows.length > 0) {
              const nowIso = new Date().toISOString();
              const cacheItems = cacheRows.map((row: any) =>
                mapSemaCacheRowToDocumentoItem(row, nowIso)
              );
              return {
                sucesso: true,
                criteriosUtilizados: {
                  temCpfCnpj: Boolean(cleanDoc),
                  car: car || undefined,
                  cars: cars.length > 0 ? cars : undefined,
                  processo: processo || undefined,
                  processos: processos.length > 0 ? processos : undefined,
                  coordenadasCount: coordenadas.length,
                  nomeExploratorio: useExploratoryName ? nome : undefined,
                  buscaExploratoria: useExploratoryName
                },
                carImoveis: cacheItems,
                licencas: [],
                notificacoes: [],
                autosInfracao: [],
                termosEmbargo: [],
                outros: [],
                totalRegistros: cacheItems.length,
                consultadoEm: nowIso,
                mensagemStatus: `${cacheItems.length} registro(s) recuperado(s) do cache sincronizado da SEMA-MT.`,
                camadasConsultadas: []
              };
            }
          }
        } catch {
          // Segue para retorno do erro original se RPC falhar
        }
      }
    }

    if (!res.ok || !data || data.error) {
      const errMsg =
        data?.error ||
        buildHttpFallbackErrorMessage(
          res.status,
          rawText,
          'Falha ao consultar a base pública da SEMA-MT'
        );
      return {
        sucesso: false,
        criteriosUtilizados: {
          temCpfCnpj: Boolean(cleanDoc),
          car: car || undefined,
          cars: cars.length > 0 ? cars : undefined,
          processo: processo || undefined,
          processos: processos.length > 0 ? processos : undefined,
          coordenadasCount: coordenadas.length,
          nomeExploratorio: useExploratoryName ? nome : undefined,
          buscaExploratoria: useExploratoryName
        },
        carImoveis: [],
        licencas: [],
        notificacoes: [],
        autosInfracao: [],
        termosEmbargo: [],
        outros: [],
        totalRegistros: 0,
        consultadoEm: data?.consultadoEm || new Date().toISOString(),
        mensagemStatus: errMsg,
        erroGeral: errMsg,
        camadasConsultadas: Array.isArray(data?.camadasConsultadas) ? data.camadasConsultadas : []
      };
    }

    return {
      sucesso: Boolean(data.sucesso),
      criteriosUtilizados: data.criteriosUtilizados || {
        temCpfCnpj: Boolean(cleanDoc),
        car: car || undefined,
        cars: cars.length > 0 ? cars : undefined,
        processo: processo || undefined,
        processos: processos.length > 0 ? processos : undefined,
        coordenadasCount: coordenadas.length,
        nomeExploratorio: useExploratoryName ? nome : undefined,
        buscaExploratoria: useExploratoryName
      },
      carImoveis: Array.isArray(data.carImoveis) ? data.carImoveis : [],
      licencas: Array.isArray(data.licencas) ? data.licencas : [],
      notificacoes: Array.isArray(data.notificacoes) ? data.notificacoes : [],
      autosInfracao: Array.isArray(data.autosInfracao) ? data.autosInfracao : [],
      termosEmbargo: Array.isArray(data.termosEmbargo) ? data.termosEmbargo : [],
      outros: Array.isArray(data.outros) ? data.outros : [],
      totalRegistros: Number(data.totalRegistros || 0),
      consultadoEm: data.consultadoEm || new Date().toISOString(),
      mensagemStatus: String(data.mensagemStatus || ''),
      auditoriaDisponivel:
        typeof data.auditoriaDisponivel === 'boolean' ? data.auditoriaDisponivel : undefined,
      camadasConsultadas: Array.isArray(data.camadasConsultadas) ? data.camadasConsultadas : []
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Falha de comunicação ao consultar a base pública da SEMA-MT.';
    return {
      sucesso: false,
      criteriosUtilizados: {
        temCpfCnpj: Boolean(cleanDoc),
        car: car || undefined,
        cars: cars.length > 0 ? cars : undefined,
        processo: processo || undefined,
        processos: processos.length > 0 ? processos : undefined,
        coordenadasCount: coordenadas.length,
        nomeExploratorio: useExploratoryName ? nome : undefined,
        buscaExploratoria: useExploratoryName
      },
      carImoveis: [],
      licencas: [],
      notificacoes: [],
      autosInfracao: [],
      termosEmbargo: [],
      outros: [],
      totalRegistros: 0,
      consultadoEm: new Date().toISOString(),
      mensagemStatus: errMsg,
      erroGeral: errMsg,
      camadasConsultadas: []
    };
  }
}

/**
 * Dispara atualização manual da base de cache do Geoportal SEMA-MT.
 * Envia o token JWT da sessão autenticada do usuário no Supabase para validação no servidor.
 */
export async function dispararSincronizacaoGeoportal(
  authToken?: string
): Promise<GeoportalSyncResult> {
  try {
    let tokenToUse = authToken?.trim() || '';

    if (!tokenToUse && isSupabaseConfigured() && supabase) {
      const { data } = await supabase.auth.getSession();
      tokenToUse = data?.session?.access_token || '';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (tokenToUse) {
      headers['Authorization'] = `Bearer ${tokenToUse}`;
    }

    const res = await fetch('/api/car-sync', {
      method: 'POST',
      headers
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || (!data?.sucesso && data?.status !== 'parcial')) {
      return {
        sucesso: false,
        sincronizadoEm: data?.sincronizadoEm || new Date().toISOString(),
        registrosProcessados: Number(data?.registrosProcessados || 0),
        camadas: Array.isArray(data?.camadas) ? data.camadas : [],
        status: data?.status === 'parcial' ? 'parcial' : 'falha',
        mensagem: data?.mensagem,
        mensagemErro:
          data?.mensagemErro ||
          data?.error ||
          `Falha na sincronização (HTTP ${res.status}).`
      };
    }

    return data;
  } catch (err: any) {
    return {
      sucesso: false,
      sincronizadoEm: new Date().toISOString(),
      registrosProcessados: 0,
      camadas: [],
      status: 'falha',
      mensagemErro: err?.message || 'Erro de comunicação ao disparar sincronização.'
    };
  }
}

/**
 * Consulta status da última sincronização do Geoportal (somente leitura via GET).
 */
export async function obterStatusSincronizacaoGeoportal(): Promise<{
  ultimaSincronizacao?: string;
  status: string;
  registrosSincronizados: number;
}> {
  try {
    const res = await fetch('/api/car-sync', { method: 'GET' });
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return { status: 'ocioso', registrosSincronizados: 0 };
}

const ALLOWED_SEMA_MASTER_FIELDS: Record<'barragem' | 'empreendedor', ReadonlySet<string>> = {
  barragem: new Set([
    'car',
    'empreendimento',
    'municipio',
    'municipio_ibge',
    'processo',
    'empreendedor_id'
  ]),
  empreendedor: new Set([
    'tipo_pessoa',
    'nome',
    'uf',
    'municipio',
    'municipio_ibge'
  ])
};

const BLOCKED_SEMA_BARRAGEM_FIELDS = new Set([
  'latitude',
  'longitude',
  'altura',
  'volume',
  'dano_potencial',
  'danopotencial',
  'dpa',
  'categoria_risco',
  'categoriarisco',
  'cri',
  'situacao',
  'classificada_em',
  'snisb',
  'curso_agua',
  'empreendedor'
]);

export type SemaCriterioVinculo =
  | 'cpf_cnpj_exato'
  | 'confirmacao_manual_analista'
  | 'cadastro_novo_cpf_cnpj';

export function isSemaMasterFieldAllowed(
  entidadeTipo: 'barragem' | 'empreendedor',
  campoNome: string
): boolean {
  const norm = String(campoNome || '').trim().toLowerCase();
  if (!norm || BLOCKED_SEMA_BARRAGEM_FIELDS.has(norm)) return false;
  return ALLOWED_SEMA_MASTER_FIELDS[entidadeTipo].has(norm);
}

/**
 * Nível 3 SEMA-MT: aplica explicitamente um campo aceito pelo analista no cadastro mestre
 * validando auditoria gerada no servidor, histórico de alterações e proveniência.
 */
export async function aceitarDadoSemaParaMestre(params: {
  auditoriaId: string;
  entidadeTipo: 'barragem' | 'empreendedor';
  entidadeId: string;
  campoNome: string;
  novoValor: string;
  motivo?: string;
  criterioVinculo?: SemaCriterioVinculo;
}): Promise<{ success: boolean; error?: string }> {
  if (!isSemaMasterFieldAllowed(params.entidadeTipo, params.campoNome)) {
    return {
      success: false,
      error: `Campo "${params.campoNome}" não é permitido para atualização automática via SEMA-MT.`
    };
  }
  if (!isValidSemaAuditoriaId(params.auditoriaId)) {
    return {
      success: false,
      error: 'Registro de auditoria da consulta SEMA-MT ausente ou inválido. Execute a consulta novamente antes de confirmar.'
    };
  }
  if (!isSupabaseConfigured() || !supabase) {
    return { success: false, error: 'Banco de dados central não configurado.' };
  }
  try {
    const { data, error } = await supabase.rpc('aceitar_dado_sema_para_mestre', {
      p_auditoria_id: params.auditoriaId,
      p_entidade_tipo: params.entidadeTipo,
      p_entidade_id: params.entidadeId,
      p_campo_nome: params.campoNome,
      p_novo_valor: params.novoValor,
      p_motivo: params.motivo ?? null,
      p_criterio_vinculo: params.criterioVinculo ?? null
    });
    if (error) return { success: false, error: error.message };
    if (data && data.success === false) return { success: false, error: data.error };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao registrar aceite no cadastro mestre.' };
  }
}

/**
 * Aplica em lote os campos selecionados e o vínculo de empreendedor de forma 100% atômica no banco
 * com validação server-side da auditoria gerada na consulta, histórico de alterações e proveniência SEMA-MT.
 */
export async function aceitarCamposSemaParaMestre(params: {
  auditoriaId: string;
  entidadeTipo: 'barragem' | 'empreendedor';
  entidadeId: string;
  campos: Record<string, string>;
  motivo?: string;
  criterioVinculo?: SemaCriterioVinculo;
}): Promise<{ success: boolean; error?: string; appliedFields?: string[] }> {
  const entries = Object.entries(params.campos || {}).filter(
    ([k, v]) => String(k || '').trim() !== '' && v !== undefined && v !== null
  );

  for (const [campo] of entries) {
    if (!isSemaMasterFieldAllowed(params.entidadeTipo, campo)) {
      return {
        success: false,
        error: `Campo "${campo}" está protegido e não pode ser sobrescrito por dados da SEMA-MT.`
      };
    }
  }

  if (entries.length === 0) {
    return { success: true, appliedFields: [] };
  }

  if (!isValidSemaAuditoriaId(params.auditoriaId)) {
    return {
      success: false,
      error: 'Registro de auditoria da consulta SEMA-MT ausente ou inválido. Execute a consulta novamente antes de confirmar.'
    };
  }

  if (!isSupabaseConfigured() || !supabase) {
    return { success: false, error: 'Banco de dados central não configurado.' };
  }

  try {
    const camposMap = Object.fromEntries(entries.map(([k, v]) => [k, String(v)]));
    const { data, error } = await supabase.rpc('aceitar_campos_sema_para_mestre', {
      p_auditoria_id: params.auditoriaId,
      p_entidade_tipo: params.entidadeTipo,
      p_entidade_id: params.entidadeId,
      p_campos: camposMap,
      p_motivo: params.motivo ?? null,
      p_criterio_vinculo: params.criterioVinculo ?? null
    });

    if (error) {
      return { success: false, error: error.message || 'Falha ao aplicar campos na base central.' };
    }

    if (data && data.success === false) {
      return { success: false, error: data.error || 'Falha ao aplicar campos no servidor.' };
    }

    return {
      success: true,
      appliedFields: Array.isArray(data?.applied_fields)
        ? data.applied_fields
        : entries.map(([k]) => k)
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Erro ao persistir campos aceitos no cadastro mestre.'
    };
  }
}
