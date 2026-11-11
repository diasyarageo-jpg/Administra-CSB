/**
 * src/services/carLookupService.ts
 *
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

// Cache de municípios de MT para resolução de MUNICIPIO_CODIGO
let mtMunicipiosCache: { id: number; nome: string }[] = [];
getMatoGrossoMunicipios().then(list => {
  mtMunicipiosCache = list;
}).catch(() => {});

/**
 * Converte as propriedades de uma feição GeoJSON retornada pelo GeoServer
 * em um objeto mapeado com os campos do Administra-CSB.
 * Regra estrita: lê de feature.properties e preserva properties brutas intactas.
 */
export function mapPropertiesToCarFeature(
  feature: CarGeoJsonFeature
): CarFeatureMapped {
  const props = (feature && feature.properties && typeof feature.properties === 'object')
    ? feature.properties
    : {};

  let municipioNome = extractFirstMatchingField(props, CAR_CAMPOS.municipio);
  const municipioCodigo = extractFirstMatchingField(props, CAR_CAMPOS.municipioCodigo);

  // Se o nome do município não veio explícito, mas veio MUNICIPIO_CODIGO (IBGE MT)
  if (!municipioNome && municipioCodigo && mtMunicipiosCache.length > 0) {
    const codNum = parseInt(municipioCodigo, 10);
    const found = mtMunicipiosCache.find(m => m.id === codNum);
    if (found) {
      municipioNome = found.nome;
    }
  }

  return {
    id: feature?.id ? String(feature.id) : undefined,
    car: extractFirstMatchingField(props, CAR_CAMPOS.car),
    carFederal: extractFirstMatchingField(props, CAR_CAMPOS.carFederal),
    empreendedor: extractFirstMatchingField(props, CAR_CAMPOS.empreendedor),
    empreendimento: extractFirstMatchingField(props, CAR_CAMPOS.empreendimento),
    municipio: municipioNome,
    municipioCodigo,
    uf: extractFirstMatchingField(props, CAR_CAMPOS.uf), // Não preencher com "MT" se não fornecido
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
 * Consulta a camada Geoportal:CAR_ATP da SEMA-MT a partir de coordenadas em formato GMS ou decimal.
 * Converte coordenadas GMS válidas para graus decimais antes de chamar a API.
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
      mensagemErro: latRes.mensagem || 'Latitude inválida ou incompleta. Informe coordenadas em formato GMS (ex: 15°35\'45,00"S).'
    };
  }

  if (!lngRes.valido || lngRes.decimal === null) {
    return {
      sucesso: false,
      encontrado: false,
      feicoes: [],
      feicoesBrutas: [],
      consultadoEm: new Date().toISOString(),
      mensagemErro: lngRes.mensagem || 'Longitude inválida ou incompleta. Informe coordenadas em formato GMS (ex: 56°05\'48,00"W).'
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
      consultadoEm: data.consultadoEm || new Date().toISOString()
    };
  } catch (err: any) {
    return {
      sucesso: false,
      encontrado: false,
      feicoes: [],
      feicoesBrutas: [],
      consultadoEm: new Date().toISOString(),
      mensagemErro: err?.message || 'Falha de conexão com a API de consulta ao Geoportal SEMA-MT.'
    };
  }
}

/**
 * Consulta registros, licenças e notificações no Geoportal da SEMA-MT para um CPF/CNPJ exato.
 */
export async function consultarDocumentosSema(
  cpfCnpj: string,
  processo?: string
): Promise<SemaDocumentosGroupedResult> {
  const cleanDoc = String(cpfCnpj || '').replace(/\D/g, '');

  if (!cleanDoc) {
    return {
      sucesso: false,
      cpfCnpjConsultado: '',
      licencas: [],
      notificacoes: [],
      autosInfracao: [],
      termosEmbargo: [],
      outros: [],
      totalRegistros: 0,
      consultadoEm: new Date().toISOString(),
      mensagemStatus: 'Informe um CPF ou CNPJ válido com dígitos numéricos.',
      camadasConsultadas: []
    };
  }

  try {
    const params = new URLSearchParams({ cpfCnpj: cleanDoc });
    if (processo && processo.trim()) {
      params.set('processo', processo.trim());
    }

    const res = await fetch(`/api/sema-documentos?${params.toString()}`);
    const data = await res.json();
    return data;
  } catch (err: any) {
    return {
      sucesso: false,
      cpfCnpjConsultado: cleanDoc,
      licencas: [],
      notificacoes: [],
      autosInfracao: [],
      termosEmbargo: [],
      outros: [],
      totalRegistros: 0,
      consultadoEm: new Date().toISOString(),
      mensagemStatus: err?.message || 'Falha ao consultar documentos no Geoportal SEMA-MT.',
      camadasConsultadas: []
    };
  }
}

/**
 * Dispara atualização manual da base de consulta do Geoportal SEMA-MT.
 */
export async function dispararSincronizacaoGeoportal(
  authToken?: string
): Promise<GeoportalSyncResult> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch('/api/car-sync', {
      method: 'POST',
      headers
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        sucesso: false,
        sincronizadoEm: new Date().toISOString(),
        registrosProcessados: 0,
        camadas: [],
        status: 'falha',
        mensagemErro: data?.error || `Falha na sincronização (HTTP ${res.status}).`
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
 * Consulta status da última sincronização do Geoportal.
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
