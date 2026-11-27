// src/services/mesaVirtualService.ts
// Regras de negócio, RBAC, filtros avançados, fluxo de revisões e orquestração
// das caixas e solicitações da Mesa Virtual (sem duplicar anexos nem inferir vínculos por nome/CAR).

import { UserRole } from '../types/auth';
import {
  DocumentoCatalogoItem,
  DocumentoSincronizacaoEstado,
  MesaVirtualSistemaOrigem
} from '../types/documentos';
import {
  criarSolicitacaoVistoria,
  SolicitacaoVistoriaRecord
} from './solicitacoesVistoriaService';
import {
  evaluateDocumentoVinculoStatus,
  maskCpfCnpjSafe,
  normVinculoText,
  VinculoStatusCode
} from '../utils/vinculoStatus';

export const MESA_VIRTUAL_STORAGE_KEY = 'administra_mesa_virtual_v1';

export type MesaVirtualTab = 'meus_documentos' | 'todos_documentos' | 'solicitacoes_caixas';
export type MesaVirtualCaixa = 'GERAL' | 'Pessoal' | 'Enviadas';
export type MesaVirtualAcaoSolicitada =
  | 'solicitar_vistoria'
  | 'solicitar_notificacao'
  | 'solicitar_auto_infracao';

export const AUTO_INFRACAO_ACTION_CONFIG = {
  value: 'solicitar_auto_infracao' as const,
  label: 'Solicitar auto de infração',
  disabled: true,
  badge: 'Em planejamento',
  reason:
    'Ação desabilitada: o fluxo formal de Auto de Infração e sua integração com o Notifica estão em planejamento e não são simulados.'
};

export interface MesaVirtualActor {
  id: string;
  nome: string;
  login?: string;
  email?: string;
  papel: UserRole | string;
}

export interface MesaVirtualPermissions {
  canViewModule: boolean;
  canViewTodosDocumentosCsb: boolean;
  canCreateSolicitacao: boolean;
  canTargetSpecificUser: boolean;
  canRedistributeGeral: boolean;
  canRequestRevisaoDocumento: boolean;
  canRequestRevisaoSolicitacao: boolean;
  canDecideRevisaoAdministrativa: boolean;
  isReadOnly: boolean;
}

export function getMesaVirtualPermissions(
  role: UserRole | string
): MesaVirtualPermissions {
  const isAdmin = role === 'Administrador';
  const isAnalista = role === 'Analista';
  const isUsuario = role === 'Usuário';
  const isVisualizador = role === 'Visualizador' || (!isAdmin && !isAnalista && !isUsuario);

  return {
    canViewModule: true,
    canViewTodosDocumentosCsb: true,
    canCreateSolicitacao: isAdmin || isAnalista || isUsuario,
    canTargetSpecificUser: isAdmin,
    canRedistributeGeral: isAdmin,
    canRequestRevisaoDocumento: isAdmin || isAnalista || isUsuario,
    canRequestRevisaoSolicitacao: isAdmin || isAnalista || isUsuario,
    canDecideRevisaoAdministrativa: isAdmin,
    isReadOnly: isVisualizador
  };
}

export interface MesaVirtualDocumentoItem extends DocumentoCatalogoItem {
  sistemaPanoramico: MesaVirtualSistemaOrigem;
  autorPrincipal: string;
  autorMatchIds: string[];
  vinculoEvaluatedCode: VinculoStatusCode;
  vinculoEvaluatedLabel: string;
  vinculoEvaluatedReason: string;
  empreendedorDocumentoMascarado: string;
  somenteLeitura: boolean;
  editBlockedReason?: string;
}

export interface MesaVirtualFilters {
  busca: string;
  sistema: MesaVirtualSistemaOrigem | 'Todos';
  tipo: string;
  estado: string;
  autor: string;
  periodoInicio: string;
  periodoFim: string;
  processo: string;
  municipio: string;
  barragemId: string;
  empreendedorId: string;
  empreendimentoId: string;
  prazoInicio: string;
  prazoFim: string;
  sincronizacaoEstado: DocumentoSincronizacaoEstado | 'Todos';
  ordenarPor: 'data' | 'titulo' | 'sistema' | 'estado' | 'prazo';
  direcao: 'asc' | 'desc';
}

export const EMPTY_MESA_VIRTUAL_FILTERS: MesaVirtualFilters = {
  busca: '',
  sistema: 'Todos',
  tipo: 'Todos',
  estado: 'Todos',
  autor: '',
  periodoInicio: '',
  periodoFim: '',
  processo: '',
  municipio: '',
  barragemId: 'Todas',
  empreendedorId: 'Todos',
  empreendimentoId: 'Todos',
  prazoInicio: '',
  prazoFim: '',
  sincronizacaoEstado: 'Todos',
  ordenarPor: 'data',
  direcao: 'desc'
};

export interface MesaVirtualSummary {
  total: number;
  porSistema: Record<string, number>;
  porTipo: Record<string, number>;
  porEstado: Record<string, number>;
  porVinculo: Record<VinculoStatusCode, number>;
}

export interface MesaVirtualSolicitacaoEntidade {
  barragemId: string;
  barragemNome: string;
  empreendedorId?: string;
  empreendedorNome?: string;
  empreendimentoId?: string;
  empreendimentoNome?: string;
  municipio?: string;
  car?: string;
  processo?: string;
  vinculoStatus: VinculoStatusCode;
}

export interface MesaVirtualSolicitacaoHistorico {
  id: string;
  dataHora: string;
  acao:
    | 'criada'
    | 'redistribuida'
    | 'revisao_solicitada'
    | 'revisao_aceita'
    | 'revisao_recusada'
    | 'retorno_integracao';
  usuarioId: string;
  usuarioNome: string;
  caixaOrigem?: MesaVirtualCaixa;
  caixaDestino?: MesaVirtualCaixa;
  destinatarioAnteriorId?: string;
  destinatarioNovoId?: string;
  destinatarioNovoNome?: string;
  justificativa: string;
}

export interface MesaVirtualSolicitacaoItem {
  id: string;
  clientRequestKey: string;
  caixaAtual: 'GERAL' | 'Pessoal';
  destinatarioTipo: 'GERAL' | 'USUARIO';
  destinatarioUsuarioId?: string;
  destinatarioUsuarioNome?: string;
  remetenteId: string;
  remetenteNome: string;
  remetentePerfil: string;
  acaoSolicitada: 'solicitar_vistoria' | 'solicitar_notificacao';
  entidades: MesaVirtualSolicitacaoEntidade[];
  justificativaGeral: string;
  justificativasPorDestino: Record<string, string>;
  statusFluxo:
    | 'Enviada'
    | 'Aguardando integração'
    | 'Redistribuída'
    | 'Em revisão administrativa'
    | 'Aceita'
    | 'Recusada'
    | 'Falha controlada';
  statusSincronizacao: 'Sincronizado' | 'Pendente de integração' | 'Falha controlada';
  vistoriaRetornos: Array<{
    barragemId: string;
    barragemNome: string;
    vistoriaId?: string;
    status?: string;
    sincronizado: boolean;
    mensagem: string;
  }>;
  revisaoAdministrativa?: {
    solicitadaPorId: string;
    solicitadaPorNome: string;
    solicitadaEm: string;
    motivoSolicitacao: string;
    decisao?: 'aceita' | 'recusada';
    decididaPorId?: string;
    decididaPorNome?: string;
    decididaEm?: string;
    justificativaDecisao?: string;
  };
  historico: MesaVirtualSolicitacaoHistorico[];
  createdAt: string;
  updatedAt: string;
}

export interface MesaVirtualRevisaoDocumentoItem {
  id: string;
  documentoId: string;
  origemSistema: MesaVirtualSistemaOrigem;
  documentoTitulo: string;
  documentoNumero?: string;
  barragemId?: string;
  empreendedorId?: string;
  processo?: string;
  solicitanteId: string;
  solicitanteNome: string;
  solicitantePerfil: string;
  tipoSolicitacao: 'revisao' | 'retificacao';
  justificativa: string;
  status: 'Pendente de análise administrativa' | 'Aceita' | 'Recusada';
  decididaPorId?: string;
  decididaPorNome?: string;
  decididaEm?: string;
  justificativaDecisao?: string;
  createdAt: string;
}

export interface MesaVirtualWorkflowStore {
  solicitacoes: MesaVirtualSolicitacaoItem[];
  revisoesDocumentos: MesaVirtualRevisaoDocumentoItem[];
}

const COMPLETED_DOCUMENT_STATES = new Set([
  'emitido',
  'vigente',
  'publicada',
  'cancelado',
  'arquivado',
  'concluida',
  'concluido'
]);

export function canEditOrDeleteMesaVirtualDocumento(
  doc: Pick<MesaVirtualDocumentoItem, 'autorId' | 'autorMatchIds' | 'situacao' | 'origemSistema'>,
  actor: MesaVirtualActor
): { allowed: boolean; reason: string } {
  const actorIds = [actor.id, actor.login, actor.email]
    .map(v => normVinculoText(v))
    .filter(Boolean);
  const docAuthorIds = [doc.autorId, ...(doc.autorMatchIds || [])]
    .map(v => normVinculoText(v))
    .filter(Boolean);

  const isOwnDoc =
    actorIds.length > 0 && docAuthorIds.some(id => actorIds.includes(id));
  const isCompleted = COMPLETED_DOCUMENT_STATES.has(normVinculoText(doc.situacao));

  if (!isOwnDoc) {
    return {
      allowed: false,
      reason:
        'Documento gerado por outro usuário ou sistema de origem. Visualização permitida em modo somente leitura; alterações exigem fluxo auditável de revisão/retificação.'
    };
  }

  if (isCompleted) {
    return {
      allowed: false,
      reason:
        'Documento concluído/emitido não admite edição ou exclusão silenciosa. Utilize a solicitação de revisão/retificação auditável.'
    };
  }

  return {
    allowed: false,
    reason:
      'A Mesa Virtual exibe referências de documentos somente para consulta; edições devem ocorrer no fluxo auditável de revisão ou no sistema de origem.'
  };
}

export function isDocumentoDoUsuarioAtual(
  doc: MesaVirtualDocumentoItem,
  actor: MesaVirtualActor | null | undefined
): boolean {
  if (!actor) return false;
  const actorTokens = [actor.id, actor.nome, actor.login, actor.email]
    .map(v => normVinculoText(v))
    .filter(Boolean);
  if (actorTokens.length === 0) return false;

  const docTokens = [
    doc.autorId,
    doc.autorPrincipal,
    ...(doc.autorMatchIds || []),
    ...(doc.analistasElaboradores || [])
  ]
    .map(v => normVinculoText(v))
    .filter(Boolean);

  return docTokens.some(t => actorTokens.includes(t));
}

/**
 * Consolida metadados panorâmicos da Mesa Virtual (Classifica, Notifica, Fiscaliza e Administra)
 * sem copiar anexos binários e preservando separação estrita de vínculos por ID vs sugestão.
 */
export function buildMesaVirtualDocumentos(params: {
  catalogoDocs: DocumentoCatalogoItem[];
  barragens: any[];
  empreendedores: any[];
  portarias?: any[];
  solicitacoesVistoria?: SolicitacaoVistoriaRecord[];
}): MesaVirtualDocumentoItem[] {
  const safeDams = Array.isArray(params.barragens) ? params.barragens : [];
  const safeEmps = Array.isArray(params.empreendedores) ? params.empreendedores : [];
  const damById = new Map<string, any>(safeDams.filter(b => b?.id).map(b => [String(b.id), b]));
  const empById = new Map<string, any>(safeEmps.filter(e => e?.id).map(e => [String(e.id), e]));

  const items: MesaVirtualDocumentoItem[] = [];

  for (const doc of params.catalogoDocs || []) {
    const dam = doc.barragemId ? damById.get(String(doc.barragemId)) : undefined;
    const emp = doc.empreendedorId ? empById.get(String(doc.empreendedorId)) : undefined;
    const vinculo = evaluateDocumentoVinculoStatus(doc, safeDams, safeEmps);
    const autorPrincipal = doc.analistasElaboradores?.[0] || doc.responsavelTecnicoNome || 'Não informado';

    items.push({
      ...doc,
      sistemaPanoramico: doc.origemSistema,
      municipio: doc.municipio || dam?.municipio || undefined,
      empreendimentoNome: doc.empreendimentoNome || dam?.empreendimento || undefined,
      empreendedorNome: emp?.nome || doc.empreendedorNome,
      empreendedorCpfCnpj: undefined, // nunca expor documento pessoal completo na Mesa Virtual
      empreendedorDocumentoMascarado: maskCpfCnpjSafe(emp?.cpfCnpj || doc.empreendedorCpfCnpj),
      autorPrincipal,
      autorMatchIds: [doc.autorId, autorPrincipal, ...(doc.analistasElaboradores || [])]
        .filter(Boolean)
        .map(String),
      vinculoEvaluatedCode: vinculo.code,
      vinculoEvaluatedLabel: vinculo.label,
      vinculoEvaluatedReason: vinculo.reason,
      sincronizacaoEstado:
        doc.sincronizacaoEstado ||
        (doc.situacao === 'Indisponível na origem'
          ? 'Indisponível'
          : doc.referenciaSeguraOrigem
          ? 'Sincronizado'
          : 'Pendente'),
      somenteLeitura: true,
      editBlockedReason:
        'Consulta panorâmica somente leitura; alterações em documentos exigem revisão/retificação auditável.'
    });
  }

  // Referências leves do próprio Administra (Portarias) usando apenas processo/IDs já existentes
  for (const p of params.portarias || []) {
    if (!p?.id) continue;
    const procStr = String(p.processNumber || '').trim();
    const damLinkedByProc = procStr
      ? safeDams.find(b => b?.processo && normVinculoText(b.processo) === normVinculoText(procStr))
      : undefined;
    const empId = damLinkedByProc
      ? String(damLinkedByProc.empreendedorId || damLinkedByProc.empreendedor || '').trim()
      : '';
    const empLinked = empId ? empById.get(empId) : undefined;
    const vinculo = evaluateDocumentoVinculoStatus(
      {
        barragemId: damLinkedByProc ? String(damLinkedByProc.id) : undefined,
        empreendedorId: empLinked ? String(empLinked.id) : undefined,
        processo: procStr,
        vinculoStatus: damLinkedByProc ? 'oficial' : procStr ? 'pendente_revisao' : 'nao_vinculado'
      },
      safeDams,
      safeEmps
    );
    const situacao = p.orderPublished
      ? 'Emitido'
      : p.extractPublished || p.secretarySigned
      ? 'Em análise'
      : p.draft
      ? 'Em análise'
      : 'Emitido';

    items.push({
      id: `adm_portaria_${p.id}`,
      origemSistema: 'Classifica', // placeholder type compatível no catálogo; sistemaPanoramico identifica Administra
      sistemaPanoramico: 'Administra',
      origemDocumentoId: String(p.id),
      tipoCodigo: 'PORTARIA',
      tipoNome: 'Portaria',
      titulo: p.draft ? `Minuta de Portaria ${p.orderNumber || ''}`.trim() : `Portaria nº ${p.orderNumber || p.id}`,
      numero: p.orderNumber || undefined,
      dataEmissao: String(p.finalDate || p.sentDate || p.createdAt || '').slice(0, 10),
      prazo: p.finalDate ? String(p.finalDate).slice(0, 10) : undefined,
      analistasElaboradores: p.createdBy ? [String(p.createdBy)] : ['Equipe Administra'],
      autorId: p.createdBy ? String(p.createdBy) : undefined,
      autorPrincipal: p.createdBy ? String(p.createdBy) : 'Administra CSB',
      autorMatchIds: p.createdBy ? [String(p.createdBy)] : [],
      barragemId: damLinkedByProc ? String(damLinkedByProc.id) : undefined,
      barragemNome: damLinkedByProc?.nome || undefined,
      empreendedorId: empLinked ? String(empLinked.id) : undefined,
      empreendedorNome: empLinked?.nome || undefined,
      empreendedorDocumentoMascarado: maskCpfCnpjSafe(empLinked?.cpfCnpj),
      empreendimentoNome: damLinkedByProc?.empreendimento || undefined,
      municipio: damLinkedByProc?.municipio || undefined,
      processo: procStr || undefined,
      vinculoStatus: vinculo.code,
      vinculoObservacao: vinculo.reason,
      vinculoEvaluatedCode: vinculo.code,
      vinculoEvaluatedLabel: vinculo.label,
      vinculoEvaluatedReason: vinculo.reason,
      referenciaSeguraOrigem: `administra://portarias/${p.id}`,
      suportaDownload: false,
      situacao: situacao as any,
      sincronizacaoEstado: 'Sincronizado',
      criadoEm: p.createdAt || new Date().toISOString(),
      sincronizadoEm: p.updatedAt || p.createdAt || new Date().toISOString(),
      somenteLeitura: true,
      editBlockedReason: 'Portaria gerida no módulo Portarias; na Mesa Virtual é somente leitura.'
    });
  }

  return items;
}

export function filterMesaVirtualDocuments(
  docs: MesaVirtualDocumentoItem[],
  filters: MesaVirtualFilters,
  options: { tab?: MesaVirtualTab; actor?: MesaVirtualActor | null } = {}
): MesaVirtualDocumentoItem[] {
  const busca = normVinculoText(filters.busca);
  const autor = normVinculoText(filters.autor);
  const processo = normVinculoText(filters.processo);
  const municipio = normVinculoText(filters.municipio);

  const filtered = (docs || []).filter(doc => {
    if (options.tab === 'meus_documentos' && !isDocumentoDoUsuarioAtual(doc, options.actor)) {
      return false;
    }

    if (filters.sistema !== 'Todos' && doc.sistemaPanoramico !== filters.sistema) {
      return false;
    }

    if (
      filters.tipo !== 'Todos' &&
      normVinculoText(doc.tipoCodigo) !== normVinculoText(filters.tipo) &&
      normVinculoText(doc.tipoNome) !== normVinculoText(filters.tipo)
    ) {
      return false;
    }

    if (filters.estado !== 'Todos' && normVinculoText(doc.situacao) !== normVinculoText(filters.estado)) {
      return false;
    }

    if (
      filters.sincronizacaoEstado !== 'Todos' &&
      doc.sincronizacaoEstado !== filters.sincronizacaoEstado
    ) {
      return false;
    }

    if (autor) {
      const autorMatch =
        normVinculoText(doc.autorPrincipal).includes(autor) ||
        (doc.analistasElaboradores || []).some(a => normVinculoText(a).includes(autor)) ||
        normVinculoText(doc.autorId).includes(autor);
      if (!autorMatch) return false;
    }

    const docDate = String(doc.dataEmissao || '').slice(0, 10);
    if (filters.periodoInicio && (!docDate || docDate < filters.periodoInicio)) {
      return false;
    }
    if (filters.periodoFim && (!docDate || docDate > filters.periodoFim)) {
      return false;
    }

    const docPrazo = String(doc.prazo || '').slice(0, 10);
    if (filters.prazoInicio && (!docPrazo || docPrazo < filters.prazoInicio)) {
      return false;
    }
    if (filters.prazoFim && (!docPrazo || docPrazo > filters.prazoFim)) {
      return false;
    }

    if (processo && !normVinculoText(doc.processo).includes(processo)) {
      return false;
    }

    if (municipio && !normVinculoText(doc.municipio).includes(municipio)) {
      return false;
    }

    if (
      filters.barragemId &&
      filters.barragemId !== 'Todas' &&
      String(doc.barragemId || '') !== String(filters.barragemId)
    ) {
      return false;
    }

    if (
      filters.empreendedorId &&
      filters.empreendedorId !== 'Todos' &&
      String(doc.empreendedorId || '') !== String(filters.empreendedorId)
    ) {
      return false;
    }

    if (
      filters.empreendimentoId &&
      filters.empreendimentoId !== 'Todos' &&
      String(doc.empreendimentoId || '') !== String(filters.empreendimentoId) &&
      normVinculoText(doc.empreendimentoNome) !== normVinculoText(filters.empreendimentoId)
    ) {
      return false;
    }

    if (busca) {
      const hay = normVinculoText(
        [
          doc.titulo,
          doc.numero,
          doc.tipoNome,
          doc.sistemaPanoramico,
          doc.autorPrincipal,
          doc.processo,
          doc.municipio,
          doc.barragemNome,
          doc.empreendedorNome,
          doc.empreendimentoNome,
          doc.carMt
        ]
          .filter(Boolean)
          .join(' ')
      );
      if (!hay.includes(busca)) return false;
    }

    return true;
  });

  const factor = filters.direcao === 'asc' ? 1 : -1;
  return filtered.slice().sort((a, b) => {
    let cmp = 0;
    switch (filters.ordenarPor) {
      case 'titulo':
        cmp = String(a.titulo || '').localeCompare(String(b.titulo || ''), 'pt-BR', { sensitivity: 'base' });
        break;
      case 'sistema':
        cmp = String(a.sistemaPanoramico || '').localeCompare(String(b.sistemaPanoramico || ''), 'pt-BR', { sensitivity: 'base' });
        break;
      case 'estado':
        cmp = String(a.situacao || '').localeCompare(String(b.situacao || ''), 'pt-BR', { sensitivity: 'base' });
        break;
      case 'prazo':
        cmp = String(a.prazo || '9999-12-31').localeCompare(String(b.prazo || '9999-12-31'));
        break;
      case 'data':
      default:
        cmp = String(a.dataEmissao || '').localeCompare(String(b.dataEmissao || ''));
        break;
    }
    return cmp * factor;
  });
}

export function computeMesaVirtualSummary(docs: MesaVirtualDocumentoItem[]): MesaVirtualSummary {
  const porSistema: Record<string, number> = {};
  const porTipo: Record<string, number> = {};
  const porEstado: Record<string, number> = {};
  const porVinculo: Record<VinculoStatusCode, number> = {
    oficial: 0,
    pendente_revisao: 0,
    nao_vinculado: 0
  };

  for (const doc of docs || []) {
    const sys = doc.sistemaPanoramico || doc.origemSistema || 'Administra';
    porSistema[sys] = (porSistema[sys] || 0) + 1;

    const tipo = doc.tipoNome || doc.tipoCodigo || 'Outros';
    porTipo[tipo] = (porTipo[tipo] || 0) + 1;

    const estado = doc.situacao || 'Emitido';
    porEstado[estado] = (porEstado[estado] || 0) + 1;

    porVinculo[doc.vinculoEvaluatedCode] = (porVinculo[doc.vinculoEvaluatedCode] || 0) + 1;
  }

  return {
    total: (docs || []).length,
    porSistema,
    porTipo,
    porEstado,
    porVinculo
  };
}

export function loadMesaVirtualStore(): MesaVirtualWorkflowStore {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { solicitacoes: [], revisoesDocumentos: [] };
  }
  try {
    const raw = window.localStorage.getItem(MESA_VIRTUAL_STORAGE_KEY);
    if (!raw) return { solicitacoes: [], revisoesDocumentos: [] };
    const parsed = JSON.parse(raw);
    return {
      solicitacoes: Array.isArray(parsed?.solicitacoes) ? parsed.solicitacoes : [],
      revisoesDocumentos: Array.isArray(parsed?.revisoesDocumentos) ? parsed.revisoesDocumentos : []
    };
  } catch {
    return { solicitacoes: [], revisoesDocumentos: [] };
  }
}

export function saveMesaVirtualStore(store: MesaVirtualWorkflowStore): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(MESA_VIRTUAL_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Armazenamento indisponível não interrompe execução
  }
}

export interface CreateSolicitacaoInput {
  clientRequestKey: string;
  acaoSolicitada: MesaVirtualAcaoSolicitada;
  destinatarioTipo: 'GERAL' | 'USUARIO';
  destinatarioUsuarioId?: string;
  destinatarioUsuarioNome?: string;
  entidades: MesaVirtualSolicitacaoEntidade[];
  justificativaGeral: string;
  justificativasPorDestino?: Record<string, string>;
  actor: MesaVirtualActor;
  dispatchVistoriaFn?: typeof criarSolicitacaoVistoria;
}

export interface CreateSolicitacaoResult {
  ok: boolean;
  duplicated?: boolean;
  item?: MesaVirtualSolicitacaoItem;
  nextStore: MesaVirtualWorkflowStore;
  error?: string;
}

export async function dispatchMesaVirtualSolicitacao(
  store: MesaVirtualWorkflowStore,
  input: CreateSolicitacaoInput
): Promise<CreateSolicitacaoResult> {
  const perms = getMesaVirtualPermissions(input.actor.papel);
  if (!perms.canCreateSolicitacao) {
    return {
      ok: false,
      nextStore: store,
      error: 'Perfil somente leitura não possui permissão para registrar solicitações.'
    };
  }

  if (input.acaoSolicitada === 'solicitar_auto_infracao') {
    return {
      ok: false,
      nextStore: store,
      error: AUTO_INFRACAO_ACTION_CONFIG.reason
    };
  }

  if (input.destinatarioTipo === 'USUARIO') {
    if (!perms.canTargetSpecificUser) {
      return {
        ok: false,
        nextStore: store,
        error: 'Apenas Administradores podem direcionar diretamente para um usuário específico; utilize a caixa GERAL.'
      };
    }
    if (!String(input.destinatarioUsuarioId || '').trim()) {
      return {
        ok: false,
        nextStore: store,
        error: 'Selecione um usuário ativo de destino ou escolha a caixa GERAL.'
      };
    }
  }

  if (!Array.isArray(input.entidades) || input.entidades.length === 0) {
    return {
      ok: false,
      nextStore: store,
      error: 'Selecione ao menos uma barragem/entidade para enviar a solicitação.'
    };
  }

  const justificativa = String(input.justificativaGeral || '').trim();
  if (justificativa.length < 5) {
    return {
      ok: false,
      nextStore: store,
      error: 'Informe uma justificativa geral com pelo menos 5 caracteres.'
    };
  }

  const key = String(input.clientRequestKey || '').trim();
  if (!key) {
    return {
      ok: false,
      nextStore: store,
      error: 'Chave de idempotência obrigatória ausente.'
    };
  }

  // Idempotência: evita duplicação pelo mesmo clientRequestKey
  const existingByKey = store.solicitacoes.find(s => s.clientRequestKey === key);
  if (existingByKey) {
    return {
      ok: true,
      duplicated: true,
      item: existingByKey,
      nextStore: store
    };
  }

  const nowIso = new Date().toISOString();
  const vistoriaFn = input.dispatchVistoriaFn || criarSolicitacaoVistoria;
  const vistoriaRetornos: MesaVirtualSolicitacaoItem['vistoriaRetornos'] = [];

  let statusFluxo: MesaVirtualSolicitacaoItem['statusFluxo'] = 'Enviada';
  let statusSincronizacao: MesaVirtualSolicitacaoItem['statusSincronizacao'] = 'Pendente de integração';

  if (input.acaoSolicitada === 'solicitar_vistoria') {
    let anySynced = false;
    let anyFailed = false;

    for (const ent of input.entidades) {
      const destJust = String(input.justificativasPorDestino?.[ent.barragemId] || '').trim();
      const relatoComposto = destJust
        ? `${justificativa} | Observação específica (${ent.barragemNome}): ${destJust}`
        : justificativa;

      const res = await vistoriaFn({
        barragem_id: ent.barragemId || undefined,
        empreendedor_id: ent.empreendedorId || undefined,
        processo_referencia: ent.processo || undefined,
        origem_ref_id: `${key}:${ent.barragemId}`,
        relato: relatoComposto.slice(0, 1000),
        motivo: `Mesa Virtual (${input.destinatarioTipo === 'GERAL' ? 'GERAL' : input.destinatarioUsuarioNome || input.destinatarioUsuarioId})`,
        dados_pre_preenchidos: {
          nome_barragem: ent.barragemNome,
          municipio: ent.municipio || undefined,
          nome_empreendedor: ent.empreendedorNome || undefined
        }
      });

      if (res.success && res.solicitacao?.id) {
        anySynced = true;
        vistoriaRetornos.push({
          barragemId: ent.barragemId,
          barragemNome: ent.barragemNome,
          vistoriaId: res.solicitacao.id,
          status: res.solicitacao.status || 'solicitada',
          sincronizado: true,
          mensagem: `Solicitação registrada no fluxo oficial de vistorias (${res.solicitacao.status || 'solicitada'}).`
        });
      } else {
        anyFailed = true;
        vistoriaRetornos.push({
          barragemId: ent.barragemId,
          barragemNome: ent.barragemNome,
          sincronizado: false,
          mensagem:
            res.error ||
            'Não foi possível confirmar a entrega no endpoint de Solicitações de Vistoria.'
        });
      }
    }

    if (anySynced && !anyFailed) {
      statusFluxo = 'Enviada';
      statusSincronizacao = 'Sincronizado';
    } else if (anyFailed && !anySynced) {
      statusFluxo = 'Falha controlada';
      statusSincronizacao = 'Falha controlada';
    } else {
      statusFluxo = 'Aguardando integração';
      statusSincronizacao = 'Pendente de integração';
    }
  } else {
    // Solicitar notificação: contrato externo com Notifica não está provisionado nesta base
    statusFluxo = 'Aguardando integração';
    statusSincronizacao = 'Pendente de integração';
    for (const ent of input.entidades) {
      vistoriaRetornos.push({
        barragemId: ent.barragemId,
        barragemNome: ent.barragemNome,
        sincronizado: false,
        mensagem:
          'Contrato de gravação externa no sistema Notifica ainda não provisionado; solicitação registrada localmente na Mesa Virtual sem confirmar entrega ao Notifica.'
      });
    }
  }

  const caixaAtual: 'GERAL' | 'Pessoal' =
    input.destinatarioTipo === 'USUARIO' ? 'Pessoal' : 'GERAL';

  const newItem: MesaVirtualSolicitacaoItem = {
    id: `mv_sol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    clientRequestKey: key,
    caixaAtual,
    destinatarioTipo: input.destinatarioTipo,
    destinatarioUsuarioId: input.destinatarioUsuarioId,
    destinatarioUsuarioNome: input.destinatarioUsuarioNome,
    remetenteId: input.actor.id,
    remetenteNome: input.actor.nome,
    remetentePerfil: String(input.actor.papel),
    acaoSolicitada: input.acaoSolicitada,
    entidades: input.entidades,
    justificativaGeral: justificativa,
    justificativasPorDestino: input.justificativasPorDestino || {},
    statusFluxo,
    statusSincronizacao,
    vistoriaRetornos,
    historico: [
      {
        id: `hist_${Date.now()}`,
        dataHora: nowIso,
        acao: 'criada',
        usuarioId: input.actor.id,
        usuarioNome: input.actor.nome,
        caixaDestino: caixaAtual,
        destinatarioNovoId: input.destinatarioUsuarioId,
        destinatarioNovoNome: input.destinatarioUsuarioNome || 'GERAL',
        justificativa
      }
    ],
    createdAt: nowIso,
    updatedAt: nowIso
  };

  const nextStore: MesaVirtualWorkflowStore = {
    ...store,
    solicitacoes: [newItem, ...store.solicitacoes]
  };
  saveMesaVirtualStore(nextStore);
  return { ok: true, item: newItem, nextStore };
}

export function redistribuirSolicitacaoGeral(
  store: MesaVirtualWorkflowStore,
  params: {
    solicitacaoId: string;
    destinatarioUsuarioId: string;
    destinatarioUsuarioNome: string;
    justificativa: string;
    actor: MesaVirtualActor;
  }
): { ok: boolean; error?: string; nextStore: MesaVirtualWorkflowStore; item?: MesaVirtualSolicitacaoItem } {
  const perms = getMesaVirtualPermissions(params.actor.papel);
  if (!perms.canRedistributeGeral) {
    return {
      ok: false,
      nextStore: store,
      error: 'Apenas Administradores podem redistribuir solicitações da caixa GERAL.'
    };
  }

  const justificativa = String(params.justificativa || '').trim();
  if (justificativa.length < 3) {
    return {
      ok: false,
      nextStore: store,
      error: 'Informe uma justificativa para registrar a redistribuição.'
    };
  }

  if (!String(params.destinatarioUsuarioId || '').trim()) {
    return {
      ok: false,
      nextStore: store,
      error: 'Selecione o servidor destinatário para redistribuir a solicitação.'
    };
  }

  const idx = store.solicitacoes.findIndex(s => s.id === params.solicitacaoId);
  if (idx < 0) {
    return { ok: false, nextStore: store, error: 'Solicitação não encontrada.' };
  }

  const current = store.solicitacoes[idx];
  const nowIso = new Date().toISOString();
  const updated: MesaVirtualSolicitacaoItem = {
    ...current,
    caixaAtual: 'Pessoal',
    destinatarioTipo: 'USUARIO',
    destinatarioUsuarioId: params.destinatarioUsuarioId,
    destinatarioUsuarioNome: params.destinatarioUsuarioNome,
    statusFluxo: 'Redistribuída',
    updatedAt: nowIso,
    historico: [
      ...current.historico,
      {
        id: `hist_red_${Date.now()}`,
        dataHora: nowIso,
        acao: 'redistribuida',
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        caixaOrigem: current.caixaAtual,
        caixaDestino: 'Pessoal',
        destinatarioAnteriorId: current.destinatarioUsuarioId,
        destinatarioNovoId: params.destinatarioUsuarioId,
        destinatarioNovoNome: params.destinatarioUsuarioNome,
        justificativa
      }
    ]
  };

  const nextSolicitacoes = store.solicitacoes.slice();
  nextSolicitacoes[idx] = updated;
  const nextStore = { ...store, solicitacoes: nextSolicitacoes };
  saveMesaVirtualStore(nextStore);
  return { ok: true, item: updated, nextStore };
}

export function solicitarRevisaoAdministrativaSolicitacao(
  store: MesaVirtualWorkflowStore,
  params: {
    solicitacaoId: string;
    motivo: string;
    actor: MesaVirtualActor;
  }
): { ok: boolean; error?: string; nextStore: MesaVirtualWorkflowStore; item?: MesaVirtualSolicitacaoItem } {
  const perms = getMesaVirtualPermissions(params.actor.papel);
  if (!perms.canRequestRevisaoSolicitacao) {
    return {
      ok: false,
      nextStore: store,
      error: 'Perfil somente leitura não pode solicitar revisão administrativa.'
    };
  }

  const motivo = String(params.motivo || '').trim();
  if (motivo.length < 5) {
    return {
      ok: false,
      nextStore: store,
      error: 'Informe o motivo da revisão administrativa (mínimo 5 caracteres).'
    };
  }

  const idx = store.solicitacoes.findIndex(s => s.id === params.solicitacaoId);
  if (idx < 0) {
    return { ok: false, nextStore: store, error: 'Solicitação não encontrada.' };
  }

  const current = store.solicitacoes[idx];
  const nowIso = new Date().toISOString();
  const updated: MesaVirtualSolicitacaoItem = {
    ...current,
    statusFluxo: 'Em revisão administrativa',
    updatedAt: nowIso,
    revisaoAdministrativa: {
      solicitadaPorId: params.actor.id,
      solicitadaPorNome: params.actor.nome,
      solicitadaEm: nowIso,
      motivoSolicitacao: motivo
    },
    historico: [
      ...current.historico,
      {
        id: `hist_rev_${Date.now()}`,
        dataHora: nowIso,
        acao: 'revisao_solicitada',
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        caixaOrigem: current.caixaAtual,
        caixaDestino: current.caixaAtual,
        justificativa: motivo
      }
    ]
  };

  const nextSolicitacoes = store.solicitacoes.slice();
  nextSolicitacoes[idx] = updated;
  const nextStore = { ...store, solicitacoes: nextSolicitacoes };
  saveMesaVirtualStore(nextStore);
  return { ok: true, item: updated, nextStore };
}

export function decidirRevisaoAdministrativaSolicitacao(
  store: MesaVirtualWorkflowStore,
  params: {
    solicitacaoId: string;
    decisao: 'aceita' | 'recusada';
    justificativa: string;
    actor: MesaVirtualActor;
  }
): { ok: boolean; error?: string; nextStore: MesaVirtualWorkflowStore; item?: MesaVirtualSolicitacaoItem } {
  const perms = getMesaVirtualPermissions(params.actor.papel);
  if (!perms.canDecideRevisaoAdministrativa) {
    return {
      ok: false,
      nextStore: store,
      error: 'Somente Administradores autorizados podem aceitar ou recusar revisões administrativas.'
    };
  }

  const justificativa = String(params.justificativa || '').trim();
  if (justificativa.length < 5) {
    return {
      ok: false,
      nextStore: store,
      error: 'Justificativa obrigatória (mínimo 5 caracteres) para aceitar ou recusar a revisão.'
    };
  }

  const idx = store.solicitacoes.findIndex(s => s.id === params.solicitacaoId);
  if (idx < 0) {
    return { ok: false, nextStore: store, error: 'Solicitação não encontrada.' };
  }

  const current = store.solicitacoes[idx];
  const nowIso = new Date().toISOString();
  const updated: MesaVirtualSolicitacaoItem = {
    ...current,
    statusFluxo: params.decisao === 'aceita' ? 'Aceita' : 'Recusada',
    updatedAt: nowIso,
    revisaoAdministrativa: {
      solicitadaPorId: current.revisaoAdministrativa?.solicitadaPorId || current.remetenteId,
      solicitadaPorNome: current.revisaoAdministrativa?.solicitadaPorNome || current.remetenteNome,
      solicitadaEm: current.revisaoAdministrativa?.solicitadaEm || current.createdAt,
      motivoSolicitacao:
        current.revisaoAdministrativa?.motivoSolicitacao || 'Revisão administrativa acionada',
      decisao: params.decisao,
      decididaPorId: params.actor.id,
      decididaPorNome: params.actor.nome,
      decididaEm: nowIso,
      justificativaDecisao: justificativa
    },
    historico: [
      ...current.historico,
      {
        id: `hist_dec_${Date.now()}`,
        dataHora: nowIso,
        acao: params.decisao === 'aceita' ? 'revisao_aceita' : 'revisao_recusada',
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        caixaOrigem: current.caixaAtual,
        caixaDestino: current.caixaAtual,
        justificativa
      }
    ]
  };

  const nextSolicitacoes = store.solicitacoes.slice();
  nextSolicitacoes[idx] = updated;
  const nextStore = { ...store, solicitacoes: nextSolicitacoes };
  saveMesaVirtualStore(nextStore);
  return { ok: true, item: updated, nextStore };
}

export function registrarSolicitacaoRevisaoDocumento(
  store: MesaVirtualWorkflowStore,
  params: {
    documento: MesaVirtualDocumentoItem;
    tipoSolicitacao: 'revisao' | 'retificacao';
    justificativa: string;
    actor: MesaVirtualActor;
  }
): { ok: boolean; error?: string; nextStore: MesaVirtualWorkflowStore; item?: MesaVirtualRevisaoDocumentoItem } {
  const perms = getMesaVirtualPermissions(params.actor.papel);
  if (!perms.canRequestRevisaoDocumento) {
    return {
      ok: false,
      nextStore: store,
      error: 'Perfil somente leitura não pode registrar solicitações de revisão/retificação.'
    };
  }

  const justificativa = String(params.justificativa || '').trim();
  if (justificativa.length < 5) {
    return {
      ok: false,
      nextStore: store,
      error: 'Descreva o motivo da revisão ou retificação (mínimo 5 caracteres).'
    };
  }

  const newItem: MesaVirtualRevisaoDocumentoItem = {
    id: `mv_docrev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    documentoId: params.documento.id,
    origemSistema: params.documento.sistemaPanoramico,
    documentoTitulo: params.documento.titulo,
    documentoNumero: params.documento.numero,
    barragemId: params.documento.barragemId,
    empreendedorId: params.documento.empreendedorId,
    processo: params.documento.processo,
    solicitanteId: params.actor.id,
    solicitanteNome: params.actor.nome,
    solicitantePerfil: String(params.actor.papel),
    tipoSolicitacao: params.tipoSolicitacao,
    justificativa,
    status: 'Pendente de análise administrativa',
    createdAt: new Date().toISOString()
  };

  const nextStore: MesaVirtualWorkflowStore = {
    ...store,
    revisoesDocumentos: [newItem, ...store.revisoesDocumentos]
  };
  saveMesaVirtualStore(nextStore);
  return { ok: true, item: newItem, nextStore };
}

export function decidirSolicitacaoRevisaoDocumento(
  store: MesaVirtualWorkflowStore,
  params: {
    revisaoId: string;
    decisao: 'aceita' | 'recusada';
    justificativa: string;
    actor: MesaVirtualActor;
  }
): { ok: boolean; error?: string; nextStore: MesaVirtualWorkflowStore } {
  const perms = getMesaVirtualPermissions(params.actor.papel);
  if (!perms.canDecideRevisaoAdministrativa) {
    return {
      ok: false,
      nextStore: store,
      error: 'Somente Administradores podem aceitar ou recusar revisões de documentos.'
    };
  }

  const justificativa = String(params.justificativa || '').trim();
  if (justificativa.length < 5) {
    return {
      ok: false,
      nextStore: store,
      error: 'Informe a justificativa da decisão administrativa (mínimo 5 caracteres).'
    };
  }

  const idx = store.revisoesDocumentos.findIndex(r => r.id === params.revisaoId);
  if (idx < 0) {
    return { ok: false, nextStore: store, error: 'Solicitação de revisão não encontrada.' };
  }

  const next = store.revisoesDocumentos.slice();
  next[idx] = {
    ...next[idx],
    status: params.decisao === 'aceita' ? 'Aceita' : 'Recusada',
    decididaPorId: params.actor.id,
    decididaPorNome: params.actor.nome,
    decididaEm: new Date().toISOString(),
    justificativaDecisao: justificativa
  };

  const nextStore = { ...store, revisoesDocumentos: next };
  saveMesaVirtualStore(nextStore);
  return { ok: true, nextStore };
}
