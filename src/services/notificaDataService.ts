/**
 * ============================================================================
 * NOTIFICA CSB — CAMADA DE DADOS E ADAPTADOR LOCAL
 * Coordenadoria de Segurança de Barragens — CSB / SURH / SEMA-MT
 * ============================================================================
 * 
 * ATENÇÃO / AVISO ARQUITETURAL:
 * - O sistema foi desvinculado de qualquer projeto Supabase anterior.
 * - Nenhum banco remoto está conectado nesta etapa.
 * - Não declare este sistema seguro ou pronto para produção.
 * - Esta camada é temporária e utiliza armazenamento local no navegador (localStorage).
 * - Os cadastros iniciam vazios por padrão (sem registros fictícios ou pré-carregados).
 * - A lógica de dados está desacoplada das telas para permitir que um novo projeto
 *   Supabase seja plugado futuramente implementando os métodos assíncronos correspondentes,
 *   sem necessidade de reescrever formulários ou componentes de interface.
 * ============================================================================
 */

export const NOTIFICA_STORAGE_KEY = 'notifica_csb_local_v1';
const LEGACY_STORAGE_KEY = 'administra_csb_local_v1';

export interface EmpreendimentoRecord {
  id: string;
  nome: string;
  tipo: 'Rural' | 'Urbano';
  car?: string;
  escritura?: string;
  uf?: string;
  municipio?: string;
  municipioIbge?: string;
  observacoes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EmpreendedorRecord {
  id: string;
  tipoPessoa?: string;
  nome: string;
  cpfCnpj: string;
  nomeFantasia?: string;
  email?: string;
  telefone?: string;
  uf?: string;
  municipio?: string;
  municipioIbge?: string;
  observacoes?: string;
  empreendimentos?: EmpreendimentoRecord[];
  situacao?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BarragemRecord {
  id: string;
  nome: string;
  car?: string;
  uf?: string;
  municipio?: string;
  municipioIbge?: string;
  empreendedor?: string;
  empreendimento?: string;
  processo?: string;
  snisb?: string;
  cursoAgua?: string;
  latitude?: string;
  longitude?: string;
  situacao?: string;
  observacoes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResponsavelTecnicoRecord {
  id: string;
  nome: string;
  cpf?: string;
  conselho?: string;
  ufConselho?: string;
  registro?: string;
  especialidades?: string;
  art?: string;
  artRrt?: string;
  barragemVinculada?: string;
  barragensVinculadas?: string[];
  validade?: string;
  telefone?: string;
  email?: string;
  situacao?: string;
  observacoes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RevisaoConciliacaoRecord {
  id: string;
  tipo: string;
  identificador: string;
  origemA: string;
  origemB: string;
  divergencias?: string;
  situacao: 'Pendente' | 'Conciliado' | 'Rejeitado';
  decisao?: string;
  responsavel?: string;
  updatedAt: string;
}

export interface UsuarioRecord {
  id: string;
  nome: string;
  email: string;
  papel: string;
  setor?: string;
  status: 'Ativo' | 'Inativo';
  createdAt: string;
}

export interface PortariaRecord {
  id: string;
  processNumber: string;
  orderNumber: string;
  sentDate: string;
  finalDate?: string;
  secretarySigned: boolean;
  extractPublished: boolean;
  orderPublished: boolean;
  draft: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProdutividadeRecord {
  id: string;
  kind: 'scored' | 'unscored' | 'extra';
  date: string;
  serverName: string;
  unit?: string;
  productCode?: string;
  unitPoints?: number;
  quantity?: number;
  unscoredType?: string;
  unscoredDescription?: string;
  sourceType: 'manual' | 'system';
  sourceName?: string;
  processRef?: string;
  documentRef?: string;
  requestedPoints?: number;
  extraOrder?: string;
  extraApproval?: string;
  extraStatus?: 'Aguardando validação' | 'Aprovada' | 'Não aprovada';
  approvedPoints?: number;
  coordinator?: string;
  reviewedAt?: string;
  inOfficialSheet?: boolean;
  officialSheetAt?: string;
  description?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificaDatabase {
  empreendedores: any[];
  barragens: any[];
  rts: any[];
  revisoes: any[];
  usuarios: any[];
  portarias: any[];
  produtividades: any[];
  municipios: any[];
  [key: string]: any[];
}

export const emptyDatabase: NotificaDatabase = {
  empreendedores: [],
  barragens: [],
  rts: [],
  revisoes: [],
  usuarios: [],
  portarias: [],
  produtividades: [],
  municipios: []
};

/**
 * Carrega os dados locais do Notifica CSB a partir do localStorage.
 * Se houver dados prévios do ambiente local original, são preservados de forma transparente.
 */
export function loadNotificaDatabase(): NotificaDatabase {
  if (typeof window === 'undefined') {
    return { ...emptyDatabase };
  }

  try {
    const raw = localStorage.getItem(NOTIFICA_STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return { ...emptyDatabase };
    }
    const parsed = JSON.parse(raw);
    return {
      empreendedores: Array.isArray(parsed.empreendedores) ? parsed.empreendedores : [],
      barragens: Array.isArray(parsed.barragens) ? parsed.barragens : [],
      rts: Array.isArray(parsed.rts) ? parsed.rts : [],
      revisoes: Array.isArray(parsed.revisoes) ? parsed.revisoes : [],
      usuarios: Array.isArray(parsed.usuarios) ? parsed.usuarios : [],
      portarias: Array.isArray(parsed.portarias) ? parsed.portarias : [],
      produtividades: Array.isArray(parsed.produtividades) ? parsed.produtividades : [],
      municipios: Array.isArray(parsed.municipios) ? parsed.municipios : []
    };
  } catch (err) {
    console.warn('[Notifica CSB] Erro ao carregar dados do armazenamento local:', err);
    return { ...emptyDatabase };
  }
}

/**
 * Salva o banco de dados no localStorage do navegador sob a chave do Notifica CSB.
 */
export function saveNotificaDatabase(db: NotificaDatabase): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(NOTIFICA_STORAGE_KEY, JSON.stringify(db));
  } catch (err) {
    console.error('[Notifica CSB] Erro ao persistir dados no armazenamento local:', err);
  }
}

/**
 * Estrutura de serviço de dados desacoplada.
 * Fornece métodos padronizados que facilitam a substituição futura por um cliente Supabase.
 */
export const notificaDataService = {
  /**
   * Obtém todos os dados atuais.
   */
  getDatabase(): NotificaDatabase {
    return loadNotificaDatabase();
  },

  /**
   * Atualiza a base de dados inteira.
   */
  setDatabase(db: NotificaDatabase): void {
    saveNotificaDatabase(db);
  },

  /**
   * Salva ou atualiza um registro em uma coleção específica.
   */
  saveRecord<K extends keyof NotificaDatabase>(
    currentDb: NotificaDatabase,
    collectionKey: K,
    record: any,
    index: number | 'new' | null
  ): NotificaDatabase {
    const list = [...(currentDb[collectionKey] as any[])];
    const timestamp = new Date().toISOString();
    const id = record.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);

    const recordWithTimestamps = {
      ...record,
      id,
      updatedAt: timestamp,
      createdAt: record.createdAt || timestamp
    };

    if (index === 'new' || index === null || typeof index === 'undefined') {
      list.unshift(recordWithTimestamps);
    } else {
      list[index] = recordWithTimestamps;
    }

    const updatedDb: NotificaDatabase = {
      ...currentDb,
      [collectionKey]: list
    };

    saveNotificaDatabase(updatedDb);
    return updatedDb;
  },

  /**
   * Exclui um registro por índice em uma coleção.
   */
  deleteRecord<K extends keyof NotificaDatabase>(
    currentDb: NotificaDatabase,
    collectionKey: K,
    index: number
  ): NotificaDatabase {
    const list = [...(currentDb[collectionKey] as any[])];
    list.splice(index, 1);

    const updatedDb: NotificaDatabase = {
      ...currentDb,
      [collectionKey]: list
    };

    saveNotificaDatabase(updatedDb);
    return updatedDb;
  }

  // =========================================================================
  // GANCHOS PREPARATÓRIOS PARA FUTURA INTEGRAÇÃO COM SUPABASE:
  // Quando uma nova instância do Supabase for configurada, crie os métodos abaixo
  // usando `supabase.from('empreendedores').select('*')` etc.
  // 
  // Exemplo de assinatura futura:
  // async fetchRemoteEmpreendedores(): Promise<EmpreendedorRecord[]> {
  //   // const { data, error } = await supabase.from('empreendedores').select('*');
  //   // if (error) throw error;
  //   // return data;
  // }
  // =========================================================================
};
