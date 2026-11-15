// src/services/carLookupService.ts
/**
 * Serviço cliente para consulta espacial ao CAR/MT, pesquisa de documentos
 * e sincronização da base do Geoportal SEMA-MT.
 */

import { CAR_CAMPOS, extractFirstMatchingField } from '../config/carCampos';
import {
  CarFeatureMapped,
  CarGeoJsonFeature,
  CarLookupApiResponse,
  CarLookupResult,
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
      window.sessionStorage.setItem(
        `${SEMA_LOOKUP_STORAGE_PREFIX}${key}`,
        JSON.stringify(value)
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

  return {
    id: feature?.id ? String(feature.id) : undefined,
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
    propriedadesBrutas: props
  };
}

/**
 * Consulta camadas CAR/ATP do Geoportal SEMA-MT via WFS a partir de coordenadas GMS ou decimais.
 */
export async function consultarCarPorCoordenada(
  latInput: string | number | null | undefined,
  lngInput: string | number | null | undefined
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

    const res = await fetch(`/api/car-lookup?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });

    const data: CarLookupApiResponse = await res.json().catch(() => ({
      encontrado: false,
      feicoes: [],
      consultadoEm: new Date().toISOString(),
      error: `Resposta inválida do servidor (HTTP ${res.status}).`
    }));

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
        consultadoEm: data.consultadoEm || new Date().toISOString(),
        mensagemErro: data.error || `Erro ao consultar Geoportal (HTTP ${res.status}).`
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
    let res: Response;
    const usePost = Boolean(
      cleanDoc || cars.length > 0 || processos.length > 0 || coordenadas.length > 0 || nome
    );

    if (usePost) {
      res = await fetch('/api/sema-documentos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          ...(cleanDoc ? { cpfCnpj: cleanDoc } : {}),
          ...(car ? { car } : {}),
          ...(cars.length > 0 ? { cars } : {}),
          ...(processo ? { processo } : {}),
          ...(processos.length > 0 ? { processos } : {}),
          ...(coordenadas.length > 0 ? { coordenadas } : {}),
          ...(nome ? { nome } : {}),
          ...(useExploratoryName ? { buscaExploratoria: true } : {})
        })
      });
    } else {
      const params = new URLSearchParams();
      if (processo) params.set('processo', processo);
      if (car) params.set('car', car);

      res = await fetch(`/api/sema-documentos?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });
    }

    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) {
      const errMsg = data?.error || `Falha ao consultar a base pública da SEMA-MT (HTTP ${res.status}).`;
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
        camadasConsultadas: []
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

async function sha256Hex(value: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return '';
}

/**
 * Nível 2 SEMA-MT: registra auditoria de consulta persistida sem gravar CPF/CNPJ em claro nem alterar cadastro mestre.
 */
export async function registrarConsultaSemaAuditoria(params: {
  entidadeAlvoTipo?: 'empreendedor' | 'barragem' | 'car';
  entidadeAlvoId?: string;
  criterioTipo: 'car' | 'coordenada' | 'processo' | 'cpf_cnpj_hash' | 'nome_exploratorio';
  criterioValor?: string;
  camada: string;
  featureId: string;
  car?: string;
  atributosRecebidos: Record<string, any>;
}): Promise<string | null> {
  if (!isSupabaseConfigured() || !supabase) return null;
  try {
    let ref = String(params.criterioValor || '').trim();
    if (params.criterioTipo === 'cpf_cnpj_hash' && ref) {
      ref = await sha256Hex(ref.replace(/\D/g, ''));
    }
    const { data, error } = await supabase.rpc('registrar_consulta_sema_auditoria', {
      p_entidade_alvo_tipo: params.entidadeAlvoTipo ?? null,
      p_entidade_alvo_id: params.entidadeAlvoId ?? null,
      p_criterio_tipo: params.criterioTipo,
      p_criterio_referencia: ref || null,
      p_camada: params.camada,
      p_feature_id: params.featureId,
      p_car: params.car ?? null,
      p_atributos_recebidos: params.atributosRecebidos || {}
    });
    if (error) return null;
    return data ? String(data) : null;
  } catch {
    return null;
  }
}

/**
 * Nível 3 SEMA-MT: aplica explicitamente um campo aceito pelo analista no cadastro mestre com histórico e proveniência.
 */
export async function aceitarDadoSemaParaMestre(params: {
  auditoriaId: string;
  entidadeTipo: 'barragem' | 'empreendedor';
  entidadeId: string;
  campoNome: string;
  novoValor: string;
  motivo?: string;
}): Promise<{ success: boolean; error?: string }> {
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
      p_motivo: params.motivo ?? null
    });
    if (error) return { success: false, error: error.message };
    if (data && data.success === false) return { success: false, error: data.error };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao registrar aceite no cadastro mestre.' };
  }
}
