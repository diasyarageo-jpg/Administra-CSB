/**
 * src/types/carLookup.ts
 *
 * Definições de tipos TypeScript para consulta ao Geoportal SEMA-MT (CAR/ATP),
 * documentos/licenças/fiscalização e sincronização da base local.
 */

export interface CarGeoJsonFeature {
  type: string;
  id?: string;
  geometry?: any;
  geometry_name?: string;
  properties: Record<string, any>;
}

export interface CarFeatureMapped {
  id?: string;
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
  propriedadesBrutas: Record<string, any>;
}

export interface CarLookupApiResponse {
  encontrado: boolean;
  feicoes: CarGeoJsonFeature[];
  consultadoEm: string;
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
  consultadoEm: string;
  mensagemErro?: string;
}

export interface SemaDocumentoItem {
  id: string;
  tipo: string;
  numeroDocumento: string;
  nomeDocumento: string;
  dataDocumento: string;
  dataValidade?: string;
  numeroProcesso?: string;
  status: string;
  razaoSocial?: string;
  cpfCnpj?: string;
  municipio?: string;
  linkDocumento?: string;
  camadaOrigem: string;
  propriedadesBrutas: Record<string, any>;
}

export interface SemaDocumentosGroupedResult {
  sucesso: boolean;
  cpfCnpjConsultado: string;
  licencas: SemaDocumentoItem[];
  notificacoes: SemaDocumentoItem[];
  autosInfracao: SemaDocumentoItem[];
  termosEmbargo: SemaDocumentoItem[];
  outros: SemaDocumentoItem[];
  totalRegistros: number;
  consultadoEm: string;
  mensagemStatus: string;
  camadasConsultadas: string[];
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
  mensagemErro?: string;
}
