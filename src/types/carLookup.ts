// src/types/carLookup.ts
/**
 * Definições de tipos TypeScript para consulta ao Geoportal SEMA-MT (WFS/WMS),
 * documentos/licenças/fiscalização e sincronização da base local.
 */

export type CamadaConsultaStatusCode =
  | 'consultada'
  | 'sem_resultados'
  | 'nao_suportado'
  | 'indisponivel'
  | 'filtro_incompativel'
  | 'erro_comunicacao';

export interface CamadaConsultaStatus {
  camada: string;
  titulo?: string;
  grupo?: string;
  status: CamadaConsultaStatusCode;
  suportado: boolean;
  registrosEncontrados: number;
  camposPesquisados?: string[];
  camposConfirmados?: string[];
  mensagem: string;
}

export interface FeatureSchemaMeta {
  camposConfirmados: string[];
  cpfCnpjCompletoDisponivel: boolean;
  cpfCnpjCampoOrigem?: string;
  cpfCnpjStatus: 'completo' | 'mascarado' | 'ausente';
}

export interface SpatialEvidenceMeta {
  criterioEspacial: 'INTERSECTS' | 'BBOX_PROXIMIDADE';
  distanciaMetros: number;
  raioPesquisadoMetros?: number;
  camada?: string;
  fonte?: string;
  consultadoEm?: string;
  evidenciaNota?: string;
}

export interface CarGeoJsonFeature {
  type: string;
  id?: string;
  geometry?: any;
  geometry_name?: string;
  camadaOrigem?: string;
  auditoriaId?: string;
  auditoriaDisponivel?: boolean;
  _schemaMeta?: FeatureSchemaMeta;
  _spatialMeta?: SpatialEvidenceMeta;
  properties: Record<string, any>;
}

export interface CarFeatureMapped {
  id?: string;
  auditoriaId?: string;
  auditoriaDisponivel?: boolean;
  camadaOrigem?: string;
  car: string;
  carFederal: string;
  empreendedor: string;
  empreendimento: string;
  municipio: string;
  municipioCodigo: string;
  uf: string;
  situacaoCar: string;
  areaHa: string;
  atividade: string;
  apfNumero: string;
  numeroArt: string;
  modulosFiscais: string;
  criterioEspacial?: 'INTERSECTS' | 'BBOX_PROXIMIDADE';
  distanciaMetros?: number;
  fonteEspacial?: string;
  evidenciaNota?: string;
  camposConfirmadosEsquema?: string[];
  cpfCnpjCompletoDisponivel?: boolean;
  cpfCnpjCampoOrigem?: string;
  cpfCnpjStatus?: 'completo' | 'mascarado' | 'ausente';
  propriedadesBrutas: Record<string, any>;
}

export interface CarLookupApiResponse {
  encontrado: boolean;
  feicoes: CarGeoJsonFeature[];
  consultadoEm: string;
  camadasConsultadas?: CamadaConsultaStatus[];
  mensagemStatus?: string;
  auditoriaDisponivel?: boolean;
  error?: string;
}

export interface CarLookupResult {
  sucesso: boolean;
  encontrado: boolean;
  feicoes: CarFeatureMapped[];
  feicoesBrutas: CarGeoJsonFeature[];
  coordenadasUtilizadas?: {
    lat: number;
    lng: number;
    latGms?: string;
    lngGms?: string;
  };
  camadasConsultadas?: CamadaConsultaStatus[];
  mensagemStatus?: string;
  consultadoEm: string;
  auditoriaDisponivel?: boolean;
  mensagemErro?: string;
}

export interface SemaDocumentoItem {
  id: string | null;
  tipo: string;
  numeroDocumento: string;
  nomeDocumento: string;
  dataDocumento: string;
  dataValidade?: string;
  numeroProcesso?: string;
  status?: string;
  razaoSocial?: string;
  cpfCnpjMascarado?: string;
  municipio?: string;
  municipioCodigo?: string;
  linkDocumento?: string;
  camadaOrigem: string;
  auditoriaId?: string;
  auditoriaDisponivel?: boolean;
  camadaTitulo?: string;
  carFederal?: string;
  areaHa?: string;
  atividade?: string;
  criterioEspacial?: 'INTERSECTS' | 'BBOX_PROXIMIDADE';
  distanciaMetros?: number;
  observacaoEspacial?: string;
  correspondenciaExploratoria?: boolean;
  camposConfirmadosEsquema?: string[];
  cpfCnpjCompletoDisponivel?: boolean;
  cpfCnpjCampoOrigem?: string;
  cpfCnpjStatus?: 'completo' | 'mascarado' | 'ausente';
  consultadoEm?: string;
  propriedadesBrutas: Record<string, any>;
}

export interface SemaDocumentosGroupedResult {
  sucesso: boolean;
  criteriosUtilizados: {
    temCpfCnpj: boolean;
    car?: string;
    cars?: string[];
    processo?: string;
    processos?: string[];
    coordenadasCount?: number;
    nomeExploratorio?: string;
    buscaExploratoria: boolean;
  };
  wmsCapabilitiesUrlInfo?: string;
  carImoveis: SemaDocumentoItem[];
  licencas: SemaDocumentoItem[];
  notificacoes: SemaDocumentoItem[];
  autosInfracao: SemaDocumentoItem[];
  termosEmbargo: SemaDocumentoItem[];
  outros: SemaDocumentoItem[];
  totalRegistros: number;
  consultadoEm: string;
  mensagemStatus: string;
  camadasConsultadas: CamadaConsultaStatus[];
  auditoriaDisponivel?: boolean;
  erroGeral?: string;
}

export interface GeoportalSyncStatus {
  ultimaSincronizacao?: string;
  status: 'ocioso' | 'em_andamento' | 'sucesso' | 'falha' | 'parcial';
  registrosSincronizados: number;
  mensagem?: string;
  camadasProcessadas: string[];
}

export interface GeoportalSyncResult {
  sucesso: boolean;
  sincronizadoEm: string;
  registrosProcessados: number;
  camadas: string[];
  status: 'sucesso' | 'falha' | 'parcial';
  mensagem?: string;
  mensagemErro?: string;
}
