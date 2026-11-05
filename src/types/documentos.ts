/**
 * ============================================================================
 * ADMINISTRA-CSB — TIPOS DO MÓDULO DE DOCUMENTOS (CATÁLOGO CENTRAL)
 * Coordenadoria de Segurança de Barragens — CSB / SURH / SEMA-MT
 * ============================================================================
 */

export type DocumentoOrigem = 'Classifica' | 'Notifica' | 'Fiscaliza';

export type DocumentoSituacao =
  | 'Emitido'
  | 'Vigente'
  | 'Em análise'
  | 'Cancelado'
  | 'Arquivado'
  | 'Indisponível na origem';

export interface DocumentoTipoConfig {
  codigo: string;
  nome: string;
  origensPermitidas?: DocumentoOrigem[];
  ativo: boolean;
}

export const DOCUMENTO_TIPOS_PADRAO: DocumentoTipoConfig[] = [
  { codigo: 'PARECER_CLASSIFICACAO', nome: 'Parecer de Classificação', origensPermitidas: ['Classifica'], ativo: true },
  { codigo: 'OFICIO', nome: 'Ofício', origensPermitidas: ['Classifica', 'Notifica', 'Fiscaliza'], ativo: true },
  { codigo: 'NOTIFICACAO', nome: 'Notificação', origensPermitidas: ['Notifica'], ativo: true },
  { codigo: 'RELATORIO_VISTORIA', nome: 'Relatório ou Termo de Vistoria', origensPermitidas: ['Fiscaliza'], ativo: true },
  { codigo: 'RELATORIO_TECNICO', nome: 'Relatório Técnico', origensPermitidas: ['Classifica', 'Notifica', 'Fiscaliza'], ativo: true },
  { codigo: 'OUTRO', nome: 'Outros Documentos', origensPermitidas: ['Classifica', 'Notifica', 'Fiscaliza'], ativo: true }
];

export interface DocumentoCatalogoItem {
  /** ID interno do catálogo no Administra */
  id: string;
  /** Sistema de origem (Classifica, Notifica ou Fiscaliza) */
  origemSistema: DocumentoOrigem;
  /** Identificador estável do documento no sistema de origem */
  origemDocumentoId: string;
  /** Código ou nome do tipo de documento (configurável) */
  tipoCodigo: string;
  tipoNome: string;
  /** Título e número oficial do documento */
  titulo: string;
  numero?: string;
  /** Data de emissão ou geração (ISO YYYY-MM-DD ou timestamptz) */
  dataEmissao: string;
  /** Analista(s), elaborador(es) e responsável técnico, quando aplicável */
  analistasElaboradores: string[];
  responsavelTecnicoNome?: string;
  responsavelTecnicoId?: string;
  /** Empreendedor e CPF/CNPJ (resolvidos ou referenciados do Administra) */
  empreendedorId?: string;
  empreendedorNome?: string;
  empreendedorCpfCnpj?: string;
  /** Processo, barragem e CAR/MT relacionados */
  processo?: string;
  barragemId?: string;
  barragemNome?: string;
  carMt?: string;
  /** Referência opaca/segura para localizar o original na origem (nunca URL pública direta) */
  referenciaSeguraOrigem?: string;
  /** Indica se o sistema de origem suporta download direto além da visualização */
  suportaDownload?: boolean;
  /** Situação do documento no catálogo */
  situacao: DocumentoSituacao;
  /** Metadados de auditoria e sincronização */
  criadoEm: string;
  sincronizadoEm: string;
}

export interface OrigemSyncStatus {
  origem: DocumentoOrigem;
  conectado: boolean;
  configurado: boolean;
  totalDocumentos: number;
  ultimaSincronizacao?: string;
  erro?: string;
}

export interface DocumentoAcessoResult {
  sucesso: boolean;
  /** URL assinada de curta duração ou blob URL gerada após validação de permissão */
  urlTemporaria?: string;
  nomeArquivo?: string;
  indisponivelNaOrigem?: boolean;
  mensagemErro?: string;
}

export interface DocumentoOriginAdapter {
  readonly origem: DocumentoOrigem;
  readonly configurado: boolean;
  readonly descricaoConfiguracaoPendente?: string;
  fetchMetadados(): Promise<DocumentoCatalogoItem[]>;
  abrirOriginal(doc: DocumentoCatalogoItem): Promise<DocumentoAcessoResult>;
  baixarOriginal(doc: DocumentoCatalogoItem): Promise<DocumentoAcessoResult>;
}
