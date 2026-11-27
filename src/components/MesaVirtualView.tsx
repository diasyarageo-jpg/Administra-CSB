// src/components/MesaVirtualView.tsx
// Mesa Virtual: visão panorâmica somente leitura de documentos CSB, conferência contextual,
// caixas GERAL / Pessoal / Enviadas, redistribuição (Admin) e revisão administrativa auditável.

import React, { useEffect, useMemo, useState } from 'react';
import { UserRole } from '../types/auth';
import {
  DocumentoCatalogoItem,
  DocumentoSincronizacaoEstado,
  MesaVirtualSistemaOrigem
} from '../types/documentos';
import {
  abrirDocumentoOriginal,
  AdministraCommonData,
  baixarDocumentoOriginal,
  carregarCatalogoDocumentos
} from '../services/documentosService';
import {
  AUTO_INFRACAO_ACTION_CONFIG,
  buildMesaVirtualDocumentos,
  computeMesaVirtualSummary,
  decidirRevisaoAdministrativaSolicitacao,
  decidirSolicitacaoRevisaoDocumento,
  dispatchMesaVirtualSolicitacao,
  EMPTY_MESA_VIRTUAL_FILTERS,
  filterMesaVirtualDocuments,
  getMesaVirtualPermissions,
  loadMesaVirtualStore,
  MesaVirtualAcaoSolicitada,
  MesaVirtualActor,
  MesaVirtualCaixa,
  MesaVirtualDocumentoItem,
  MesaVirtualFilters,
  MesaVirtualSolicitacaoEntidade,
  MesaVirtualSolicitacaoItem,
  MesaVirtualTab,
  MesaVirtualWorkflowStore,
  redistribuirSolicitacaoGeral,
  registrarSolicitacaoRevisaoDocumento,
  solicitarRevisaoAdministrativaSolicitacao
} from '../services/mesaVirtualService';
import { SolicitacaoVistoriaRecord } from '../services/solicitacoesVistoriaService';
import {
  evaluateBarragemVinculoStatus,
  normVinculoText,
  VinculoStatusCode
} from '../utils/vinculoStatus';
import { BarragemSelectorField } from './BarragemSelectorField';
import { ConferenciaDocumentosPanel } from './ConferenciaDocumentosModal';
import { PaginationBar, PageSizeOption, paginateList } from './PaginationBar';
import {
  AdvancedFilterDrawer,
  AdvancedFilterField,
  AdvancedFilterToggleButton
} from './AdvancedFilterPanel';

export interface MesaVirtualViewProps {
  userRole: UserRole;
  currentActor: MesaVirtualActor;
  commonData: AdministraCommonData;
  portarias?: any[];
  usuarios?: any[];
  solicitacoesVistoria?: SolicitacaoVistoriaRecord[];
  onNotify?: (msg: string) => void;
}

const SISTEMA_BADGE: Record<MesaVirtualSistemaOrigem, string> = {
  Classifica: 'blue',
  Notifica: 'amber',
  Fiscaliza: 'green',
  Administra: 'gray'
};

const VINCULO_BADGE: Record<VinculoStatusCode, string> = {
  oficial: 'green',
  pendente_revisao: 'amber',
  nao_vinculado: 'gray'
};

function formatDateBr(iso?: string): string {
  if (!iso) return '—';
  const clean = String(iso).slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatDateTimeBr(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `mv_${crypto.randomUUID()}`;
  }
  return `mv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const MesaVirtualView: React.FC<MesaVirtualViewProps> = ({
  userRole,
  currentActor,
  commonData,
  portarias = [],
  usuarios = [],
  solicitacoesVistoria = [],
  onNotify
}) => {
  const perms = useMemo(() => getMesaVirtualPermissions(userRole), [userRole]);

  const [activeTab, setActiveTab] = useState<MesaVirtualTab>('meus_documentos');
  const [activeCaixa, setActiveCaixa] = useState<MesaVirtualCaixa | 'Revisoes'>('GERAL');

  // Catálogo panorâmico (metadados leves; sem cópia de anexos)
  const [catalogoDocs, setCatalogoDocs] = useState<DocumentoCatalogoItem[]>([]);
  const [loadingCatalogo, setLoadingCatalogo] = useState(false);
  const [catalogoStatusAviso, setCatalogoStatusAviso] = useState<string | null>(null);
  const [filters, setFilters] = useState<MesaVirtualFilters>(EMPTY_MESA_VIRTUAL_FILTERS);
  const [showAdvFilters, setShowAdvFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(20);

  // Store de solicitações e revisões auditáveis
  const [workflowStore, setWorkflowStore] = useState<MesaVirtualWorkflowStore>(() =>
    loadMesaVirtualStore()
  );

  // Modal de documento somente leitura + solicitação de revisão/retificação
  const [selectedDoc, setSelectedDoc] = useState<MesaVirtualDocumentoItem | null>(null);
  const [docActionMsg, setDocActionMsg] = useState<string | null>(null);
  const [showDocRevisionForm, setShowDocRevisionForm] = useState(false);
  const [docRevType, setDocRevType] = useState<'revisao' | 'retificacao'>('revisao');
  const [docRevReason, setDocRevReason] = useState('');

  // Modal de nova solicitação (multi-entidade + pré-visualização + idempotência)
  const [showComposerModal, setShowComposerModal] = useState(false);
  const [composerStep, setComposerStep] = useState<'form' | 'preview'>('form');
  const [composerKey, setComposerKey] = useState<string>(generateIdempotencyKey);
  const [composerDamIds, setComposerDamIds] = useState<string[]>([]);
  const [composerAction, setComposerAction] =
    useState<MesaVirtualAcaoSolicitada>('solicitar_vistoria');
  const [composerDestType, setComposerDestType] = useState<'GERAL' | 'USUARIO'>('GERAL');
  const [composerDestUserId, setComposerDestUserId] = useState<string>('');
  const [composerJustificativaGeral, setComposerJustificativaGeral] = useState('');
  const [composerJustificativasDest, setComposerJustificativasDest] = useState<
    Record<string, string>
  >({});
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composerSubmitting, setComposerSubmitting] = useState(false);

  // Modal de detalhes / redistribuição / revisão administrativa de solicitação
  const [selectedSolicitacao, setSelectedSolicitacao] =
    useState<MesaVirtualSolicitacaoItem | null>(null);
  const [solActionMode, setSolActionMode] = useState<
    'historico' | 'redistribuir' | 'pedir_revisao' | 'decidir_revisao'
  >('historico');
  const [redistTargetUserId, setRedistTargetUserId] = useState('');
  const [redistReason, setRedistReason] = useState('');
  const [revSolicitarReason, setRevSolicitarReason] = useState('');
  const [revDecisao, setRevDecisao] = useState<'aceita' | 'recusada'>('aceita');
  const [revDecisaoReason, setRevDecisaoReason] = useState('');
  const [solActionError, setSolActionError] = useState<string | null>(null);

  // Decisão de revisão de documento (Admin)
  const [decidingDocRevId, setDecidingDocRevId] = useState<string | null>(null);
  const [decidingDocRevChoice, setDecidingDocRevChoice] = useState<'aceita' | 'recusada'>('aceita');
  const [decidingDocRevReason, setDecidingDocRevReason] = useState('');

  const sincronizarCatalogo = async () => {
    setLoadingCatalogo(true);
    setCatalogoStatusAviso(null);
    try {
      const res = await carregarCatalogoDocumentos(commonData);
      setCatalogoDocs(res.documentos || []);
      const pendentes = (res.origensStatus || []).filter(s => !s.configurado);
      if (pendentes.length > 0) {
        setCatalogoStatusAviso(
          `Origens externas (${pendentes.map(p => p.origem).join(', ')}) sem endpoint de leitura direta configurado no servidor; exibindo referências da base central.`
        );
      }
    } catch (err: any) {
      setCatalogoStatusAviso(
        err?.message || 'Não foi possível atualizar o catálogo externo no momento.'
      );
    } finally {
      setLoadingCatalogo(false);
    }
  };

  useEffect(() => {
    sincronizarCatalogo();
  }, [commonData.barragens.length, commonData.empreendedores.length, commonData.rts.length]);

  const activeUsers = useMemo(() => {
    return (usuarios || []).filter(
      u => u?.id && (!u.situacao || u.situacao === 'Ativo') && u.status !== 'Inativo'
    );
  }, [usuarios]);

  const panoramicDocs = useMemo(
    () =>
      buildMesaVirtualDocumentos({
        catalogoDocs,
        barragens: commonData.barragens,
        empreendedores: commonData.empreendedores,
        portarias,
        solicitacoesVistoria
      }),
    [catalogoDocs, commonData.barragens, commonData.empreendedores, portarias, solicitacoesVistoria]
  );

  const filteredDocs = useMemo(() => {
    if (activeTab === 'solicitacoes_caixas') return [];
    return filterMesaVirtualDocuments(panoramicDocs, filters, {
      tab: activeTab,
      actor: currentActor
    });
  }, [panoramicDocs, filters, activeTab, currentActor]);

  const summary = useMemo(() => computeMesaVirtualSummary(filteredDocs), [filteredDocs]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, filters]);

  const { pagedItems: pagedDocs, safePage } = useMemo(
    () => paginateList(filteredDocs, page, pageSize),
    [filteredDocs, page, pageSize]
  );

  const distinctTypes = useMemo(() => {
    const set = new Set<string>();
    for (const d of panoramicDocs) {
      if (d.tipoNome) set.add(d.tipoNome);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [panoramicDocs]);

  const distinctStates = useMemo(() => {
    const set = new Set<string>(['Emitido', 'Vigente', 'Em análise', 'Cancelado', 'Arquivado']);
    for (const d of panoramicDocs) {
      if (d.situacao) set.add(d.situacao);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [panoramicDocs]);

  const distinctEmpreendimentos = useMemo(() => {
    const set = new Set<string>();
    for (const b of commonData.barragens || []) {
      if (b?.empreendimento) set.add(String(b.empreendimento).trim());
    }
    for (const d of panoramicDocs) {
      if (d.empreendimentoNome) set.add(String(d.empreendimentoNome).trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [commonData.barragens, panoramicDocs]);

  const advCount = useMemo(() => {
    return [
      filters.autor.trim(),
      filters.periodoInicio,
      filters.periodoFim,
      filters.processo.trim(),
      filters.municipio.trim(),
      filters.barragemId !== 'Todas' ? filters.barragemId : '',
      filters.empreendedorId !== 'Todos' ? filters.empreendedorId : '',
      filters.empreendimentoId !== 'Todos' ? filters.empreendimentoId : '',
      filters.prazoInicio,
      filters.prazoFim,
      filters.sincronizacaoEstado !== 'Todos' ? filters.sincronizacaoEstado : ''
    ].filter(Boolean).length;
  }, [filters]);

  const hasAnyFilter =
    Boolean(filters.busca.trim()) ||
    filters.sistema !== 'Todos' ||
    filters.tipo !== 'Todos' ||
    filters.estado !== 'Todos' ||
    advCount > 0;

  // Caixas de solicitações
  const caixaItems = useMemo(() => {
    const all = workflowStore.solicitacoes || [];
    if (activeCaixa === 'GERAL') {
      return all.filter(s => s.caixaAtual === 'GERAL');
    }
    if (activeCaixa === 'Pessoal') {
      return all.filter(
        s =>
          s.caixaAtual === 'Pessoal' &&
          (normVinculoText(s.destinatarioUsuarioId) === normVinculoText(currentActor.id) ||
            userRole === 'Administrador')
      );
    }
    if (activeCaixa === 'Enviadas') {
      return all.filter(
        s =>
          normVinculoText(s.remetenteId) === normVinculoText(currentActor.id) ||
          userRole === 'Administrador'
      );
    }
    return [];
  }, [workflowStore.solicitacoes, activeCaixa, currentActor.id, userRole]);

  const composerEntidades = useMemo<MesaVirtualSolicitacaoEntidade[]>(() => {
    return composerDamIds
      .map(id => {
        const dam = (commonData.barragens || []).find(b => String(b?.id || '').trim() === id);
        if (!dam) return null;
        const vinc = evaluateBarragemVinculoStatus(dam, commonData.empreendedores);
        return {
          barragemId: id,
          barragemNome: String(dam.nome || dam.name || id),
          empreendedorId: vinc.officialEmpreendedorId,
          empreendedorNome: vinc.officialEmpreendedorNome,
          empreendimentoNome: dam.empreendimento || undefined,
          municipio: dam.municipio || undefined,
          car: dam.car || undefined,
          processo: dam.processo || undefined,
          vinculoStatus: vinc.code
        } as MesaVirtualSolicitacaoEntidade;
      })
      .filter((item): item is MesaVirtualSolicitacaoEntidade => item !== null);
  }, [composerDamIds, commonData.barragens, commonData.empreendedores]);

  const openComposer = () => {
    setComposerKey(generateIdempotencyKey());
    setComposerStep('form');
    setComposerDamIds([]);
    setComposerAction('solicitar_vistoria');
    setComposerDestType('GERAL');
    setComposerDestUserId('');
    setComposerJustificativaGeral('');
    setComposerJustificativasDest({});
    setComposerError(null);
    setShowComposerModal(true);
  };

  const handlePreviewComposer = () => {
    setComposerError(null);
    if (composerAction === 'solicitar_auto_infracao') {
      setComposerError(AUTO_INFRACAO_ACTION_CONFIG.reason);
      return;
    }
    if (composerEntidades.length === 0) {
      setComposerError('Selecione ao menos uma barragem para prosseguir.');
      return;
    }
    if (composerJustificativaGeral.trim().length < 5) {
      setComposerError('Informe a justificativa geral (mínimo 5 caracteres).');
      return;
    }
    if (composerDestType === 'USUARIO' && !composerDestUserId.trim()) {
      setComposerError('Selecione o usuário de destino.');
      return;
    }
    setComposerStep('preview');
  };

  const handleDispatchSolicitacao = async () => {
    setComposerSubmitting(true);
    setComposerError(null);
    try {
      const destUser = activeUsers.find(u => String(u.id) === String(composerDestUserId));
      const res = await dispatchMesaVirtualSolicitacao(workflowStore, {
        clientRequestKey: composerKey,
        acaoSolicitada: composerAction,
        destinatarioTipo: composerDestType,
        destinatarioUsuarioId: composerDestType === 'USUARIO' ? composerDestUserId : undefined,
        destinatarioUsuarioNome: destUser?.nome,
        entidades: composerEntidades,
        justificativaGeral: composerJustificativaGeral,
        justificativasPorDestino: composerJustificativasDest,
        actor: currentActor
      });
      if (!res.ok) {
        setComposerError(res.error || 'Falha ao enviar solicitação.');
        return;
      }
      setWorkflowStore(res.nextStore);
      setShowComposerModal(false);
      setActiveTab('solicitacoes_caixas');
      setActiveCaixa('Enviadas');
      if (res.item) setSelectedSolicitacao(res.item);
      onNotify?.(
        res.duplicated
          ? 'Solicitação idempotente já registrada anteriormente.'
          : 'Solicitação registrada na Mesa Virtual.'
      );
    } finally {
      setComposerSubmitting(false);
    }
  };

  const handleOpenOrigin = async (doc: MesaVirtualDocumentoItem) => {
    setDocActionMsg(null);
    if (doc.sistemaPanoramico === 'Administra') {
      setDocActionMsg(
        'Registro do próprio Administra (Portarias). Consulte e gerencie no módulo Portarias conforme permissões.'
      );
      return;
    }
    const res = await abrirDocumentoOriginal(doc);
    if (res.sucesso && res.urlTemporaria) {
      window.open(res.urlTemporaria, '_blank', 'noopener,noreferrer');
    } else {
      setDocActionMsg(res.mensagemErro || 'Documento indisponível na origem no momento.');
    }
  };

  const handleDownloadOrigin = async (doc: MesaVirtualDocumentoItem) => {
    setDocActionMsg(null);
    if (doc.sistemaPanoramico === 'Administra') {
      setDocActionMsg('Download direto indisponível para referências internas de Portaria.');
      return;
    }
    const res = await baixarDocumentoOriginal(doc);
    if (res.sucesso && res.urlTemporaria) {
      const a = document.createElement('a');
      a.href = res.urlTemporaria;
      a.download = res.nomeArquivo || `${doc.titulo}.pdf`;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      setDocActionMsg(res.mensagemErro || 'Download indisponível na origem no momento.');
    }
  };

  const handleSubmitDocRevision = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoc) return;
    const res = registrarSolicitacaoRevisaoDocumento(workflowStore, {
      documento: selectedDoc,
      tipoSolicitacao: docRevType,
      justificativa: docRevReason,
      actor: currentActor
    });
    if (!res.ok) {
      setDocActionMsg(res.error || 'Não foi possível registrar a solicitação.');
      return;
    }
    setWorkflowStore(res.nextStore);
    setShowDocRevisionForm(false);
    setDocRevReason('');
    setDocActionMsg('Solicitação de revisão/retificação registrada para análise administrativa.');
    onNotify?.('Solicitação de revisão/retificação registrada.');
  };

  const handleRedistribuir = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSolicitacao) return;
    const targetUser = activeUsers.find(u => String(u.id) === String(redistTargetUserId));
    const res = redistribuirSolicitacaoGeral(workflowStore, {
      solicitacaoId: selectedSolicitacao.id,
      destinatarioUsuarioId: redistTargetUserId,
      destinatarioUsuarioNome: targetUser?.nome || redistTargetUserId,
      justificativa: redistReason,
      actor: currentActor
    });
    if (!res.ok) {
      setSolActionError(res.error || 'Falha ao redistribuir.');
      return;
    }
    setWorkflowStore(res.nextStore);
    if (res.item) setSelectedSolicitacao(res.item);
    setSolActionMode('historico');
    setRedistReason('');
    setSolActionError(null);
    onNotify?.('Solicitação redistribuída da caixa GERAL.');
  };

  const handleSolicitarRevisaoAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSolicitacao) return;
    const res = solicitarRevisaoAdministrativaSolicitacao(workflowStore, {
      solicitacaoId: selectedSolicitacao.id,
      motivo: revSolicitarReason,
      actor: currentActor
    });
    if (!res.ok) {
      setSolActionError(res.error || 'Falha ao solicitar revisão.');
      return;
    }
    setWorkflowStore(res.nextStore);
    if (res.item) setSelectedSolicitacao(res.item);
    setSolActionMode('historico');
    setRevSolicitarReason('');
    setSolActionError(null);
    onNotify?.('Revisão administrativa solicitada.');
  };

  const handleDecidirRevisaoAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSolicitacao) return;
    const res = decidirRevisaoAdministrativaSolicitacao(workflowStore, {
      solicitacaoId: selectedSolicitacao.id,
      decisao: revDecisao,
      justificativa: revDecisaoReason,
      actor: currentActor
    });
    if (!res.ok) {
      setSolActionError(res.error || 'Falha ao registrar decisão.');
      return;
    }
    setWorkflowStore(res.nextStore);
    if (res.item) setSelectedSolicitacao(res.item);
    setSolActionMode('historico');
    setRevDecisaoReason('');
    setSolActionError(null);
    onNotify?.(
      revDecisao === 'aceita'
        ? 'Revisão administrativa aceita.'
        : 'Revisão administrativa recusada.'
    );
  };

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Governança Operacional · CSB / SEMA-MT</div>
          <h2>Mesa Virtual</h2>
          <p>
            Visão panorâmica de documentos do ecossistema CSB (somente leitura para registros de
            terceiros ou concluídos), conferência contextual e caixas de solicitações auditáveis.
          </p>
        </div>
        <div className="actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn light"
            onClick={sincronizarCatalogo}
            disabled={loadingCatalogo}
          >
            {loadingCatalogo ? 'Atualizando...' : 'Atualizar referências'}
          </button>
          {perms.canCreateSolicitacao && (
            <button type="button" className="btn green" onClick={openComposer}>
              + Nova solicitação
            </button>
          )}
        </div>
      </div>

      {catalogoStatusAviso && (
        <div className="notice slate" style={{ marginBottom: '12px' }}>
          {catalogoStatusAviso}
        </div>
      )}

      {/* Abas principais da Mesa Virtual */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          marginBottom: '16px',
          borderBottom: '1px solid var(--line)',
          paddingBottom: '10px'
        }}
      >
        <button
          type="button"
          className={`btn ${activeTab === 'meus_documentos' ? 'green' : 'light'} small`}
          style={{ whiteSpace: 'nowrap' }}
          onClick={() => setActiveTab('meus_documentos')}
        >
          Meus documentos
        </button>
        <button
          type="button"
          className={`btn ${activeTab === 'todos_documentos' ? 'green' : 'light'} small`}
          style={{ whiteSpace: 'nowrap' }}
          onClick={() => setActiveTab('todos_documentos')}
        >
          Todos documentos CSB
        </button>
        <button
          type="button"
          className={`btn ${activeTab === 'solicitacoes_caixas' ? 'green' : 'light'} small`}
          style={{ whiteSpace: 'nowrap' }}
          onClick={() => setActiveTab('solicitacoes_caixas')}
        >
          Solicitações e Caixas ({workflowStore.solicitacoes.length})
        </button>
      </div>

      {activeTab !== 'solicitacoes_caixas' ? (
        <>
          {/* Cards de resumo sincronizados com filtros e permissões */}
          <div className="stats" style={{ marginBottom: '16px' }}>
            <div className="stat">
              <span>Total filtrado</span>
              <b>{summary.total}</b>
              <small>Metadados sem cópia de anexos</small>
            </div>
            <div className="stat">
              <span>Por sistema</span>
              <b>{Object.keys(summary.porSistema).length}</b>
              <small>
                {Object.entries(summary.porSistema)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ') || 'Nenhum'}
              </small>
            </div>
            <div className="stat">
              <span>Por tipo</span>
              <b>{Object.keys(summary.porTipo).length}</b>
              <small>
                {Object.entries(summary.porTipo)
                  .slice(0, 3)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ') || 'Nenhum'}
              </small>
            </div>
            <div className="stat">
              <span>Por estado e vínculo</span>
              <b>{summary.porVinculo.oficial}</b>
              <small>
                Oficiais: {summary.porVinculo.oficial} · Pend.:{' '}
                {summary.porVinculo.pendente_revisao} · Sem vínc.: {summary.porVinculo.nao_vinculado}
              </small>
            </div>
          </div>

          <div className="panel">
            <div className="toolbar" style={{ flexWrap: 'wrap', gap: '8px' }}>
              <input
                type="text"
                className="input"
                style={{ minWidth: '220px', flex: '1 1 220px' }}
                placeholder="Buscar por título, número, processo, barragem, empreendedor..."
                value={filters.busca}
                onChange={e => setFilters(prev => ({ ...prev, busca: e.target.value }))}
              />

              <select
                className="select"
                style={{ width: 'auto' }}
                value={filters.sistema}
                onChange={e =>
                  setFilters(prev => ({ ...prev, sistema: e.target.value as any }))
                }
              >
                <option value="Todos">Sistema (Todos)</option>
                <option value="Administra">Administra</option>
                <option value="Classifica">Classifica</option>
                <option value="Notifica">Notifica</option>
                <option value="Fiscaliza">Fiscaliza</option>
              </select>

              <select
                className="select"
                style={{ width: 'auto' }}
                value={filters.tipo}
                onChange={e => setFilters(prev => ({ ...prev, tipo: e.target.value }))}
              >
                <option value="Todos">Tipo (Todos)</option>
                {distinctTypes.map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              <select
                className="select"
                style={{ width: 'auto' }}
                value={filters.estado}
                onChange={e => setFilters(prev => ({ ...prev, estado: e.target.value }))}
              >
                <option value="Todos">Estado (Todos)</option>
                {distinctStates.map(st => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>

              <AdvancedFilterToggleButton
                isOpen={showAdvFilters}
                activeCount={advCount}
                onToggle={() => setShowAdvFilters(prev => !prev)}
              />

              {hasAnyFilter && (
                <button
                  type="button"
                  className="btn light small"
                  onClick={() => setFilters(EMPTY_MESA_VIRTUAL_FILTERS)}
                >
                  Limpar filtros
                </button>
              )}
            </div>

            {showAdvFilters && (
              <AdvancedFilterDrawer
                title="Filtros avançados · Mesa Virtual"
                subtitle="Combine filtros por autor, período, processo, município, entidades vinculadas, prazo e sincronização"
                activeCount={advCount}
                onClear={() =>
                  setFilters(prev => ({
                    ...EMPTY_MESA_VIRTUAL_FILTERS,
                    busca: prev.busca,
                    sistema: prev.sistema,
                    tipo: prev.tipo,
                    estado: prev.estado
                  }))
                }
                onClose={() => setShowAdvFilters(false)}
              >
                <AdvancedFilterField label="Autor / Analista">
                  <input
                    className="input"
                    placeholder="Nome ou identificador..."
                    value={filters.autor}
                    onChange={e => setFilters(prev => ({ ...prev, autor: e.target.value }))}
                  />
                </AdvancedFilterField>

                <AdvancedFilterField label="Processo">
                  <input
                    className="input"
                    placeholder="Número do processo..."
                    value={filters.processo}
                    onChange={e => setFilters(prev => ({ ...prev, processo: e.target.value }))}
                  />
                </AdvancedFilterField>

                <AdvancedFilterField label="Município">
                  <input
                    className="input"
                    placeholder="Município..."
                    value={filters.municipio}
                    onChange={e => setFilters(prev => ({ ...prev, municipio: e.target.value }))}
                  />
                </AdvancedFilterField>

                <AdvancedFilterField label="Barragem (ID estável)">
                  <select
                    className="select"
                    value={filters.barragemId}
                    onChange={e => setFilters(prev => ({ ...prev, barragemId: e.target.value }))}
                  >
                    <option value="Todas">Todas</option>
                    {(commonData.barragens || []).map(b => (
                      <option key={b.id} value={b.id}>
                        {b.nome || b.id}
                      </option>
                    ))}
                  </select>
                </AdvancedFilterField>

                <AdvancedFilterField label="Empreendedor (ID estável)">
                  <select
                    className="select"
                    value={filters.empreendedorId}
                    onChange={e =>
                      setFilters(prev => ({ ...prev, empreendedorId: e.target.value }))
                    }
                  >
                    <option value="Todos">Todos</option>
                    {(commonData.empreendedores || []).map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.nome || emp.id}
                      </option>
                    ))}
                  </select>
                </AdvancedFilterField>

                <AdvancedFilterField label="Empreendimento">
                  <select
                    className="select"
                    value={filters.empreendimentoId}
                    onChange={e =>
                      setFilters(prev => ({ ...prev, empreendimentoId: e.target.value }))
                    }
                  >
                    <option value="Todos">Todos</option>
                    {distinctEmpreendimentos.map(name => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </AdvancedFilterField>

                <AdvancedFilterField label="Período de emissão (de / até)">
                  <div className="adv-filter-range">
                    <input
                      type="date"
                      className="input"
                      value={filters.periodoInicio}
                      onChange={e =>
                        setFilters(prev => ({ ...prev, periodoInicio: e.target.value }))
                      }
                    />
                    <input
                      type="date"
                      className="input"
                      value={filters.periodoFim}
                      onChange={e =>
                        setFilters(prev => ({ ...prev, periodoFim: e.target.value }))
                      }
                    />
                  </div>
                </AdvancedFilterField>

                <AdvancedFilterField label="Prazo (de / até)">
                  <div className="adv-filter-range">
                    <input
                      type="date"
                      className="input"
                      value={filters.prazoInicio}
                      onChange={e =>
                        setFilters(prev => ({ ...prev, prazoInicio: e.target.value }))
                      }
                    />
                    <input
                      type="date"
                      className="input"
                      value={filters.prazoFim}
                      onChange={e =>
                        setFilters(prev => ({ ...prev, prazoFim: e.target.value }))
                      }
                    />
                  </div>
                </AdvancedFilterField>

                <AdvancedFilterField label="Estado de sincronização">
                  <select
                    className="select"
                    value={filters.sincronizacaoEstado}
                    onChange={e =>
                      setFilters(prev => ({
                        ...prev,
                        sincronizacaoEstado: e.target.value as DocumentoSincronizacaoEstado | 'Todos'
                      }))
                    }
                  >
                    <option value="Todos">Todos</option>
                    <option value="Sincronizado">Sincronizado</option>
                    <option value="Pendente">Pendente</option>
                    <option value="Local / Provisório">Local / Provisório</option>
                    <option value="Indisponível">Indisponível</option>
                  </select>
                </AdvancedFilterField>

                <AdvancedFilterField label="Ordenação">
                  <div className="adv-filter-range">
                    <select
                      className="select"
                      value={filters.ordenarPor}
                      onChange={e =>
                        setFilters(prev => ({ ...prev, ordenarPor: e.target.value as any }))
                      }
                    >
                      <option value="data">Data de emissão</option>
                      <option value="prazo">Prazo</option>
                      <option value="titulo">Título</option>
                      <option value="sistema">Sistema</option>
                      <option value="estado">Estado</option>
                    </select>
                    <select
                      className="select"
                      value={filters.direcao}
                      onChange={e =>
                        setFilters(prev => ({
                          ...prev,
                          direcao: e.target.value === 'asc' ? 'asc' : 'desc'
                        }))
                      }
                    >
                      <option value="desc">Mais recente / Z-A</option>
                      <option value="asc">Mais antigo / A-Z</option>
                    </select>
                  </div>
                </AdvancedFilterField>
              </AdvancedFilterDrawer>
            )}

            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Sistema / Tipo</th>
                    <th>Documento</th>
                    <th>Autor</th>
                    <th>Barragem / Empreendedor</th>
                    <th>Vínculo</th>
                    <th>Emissão / Prazo</th>
                    <th>Estado / Sync</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDocs.length > 0 ? (
                    pagedDocs.map(doc => (
                      <tr key={doc.id}>
                        <td>
                          <span className={`badge ${SISTEMA_BADGE[doc.sistemaPanoramico]}`}>
                            {doc.sistemaPanoramico}
                          </span>
                          <div className="micro muted" style={{ marginTop: '4px' }}>
                            {doc.tipoNome}
                          </div>
                        </td>
                        <td>
                          <b>{doc.titulo}</b>
                          <div className="micro muted">
                            {doc.numero ? `Nº ${doc.numero} · ` : ''}
                            {doc.processo ? `Proc.: ${doc.processo}` : 'Sem processo'}
                          </div>
                        </td>
                        <td>{doc.autorPrincipal}</td>
                        <td>
                          <div>{doc.barragemNome || '—'}</div>
                          <div className="micro muted">
                            {doc.empreendedorNome || '—'}
                            {doc.municipio ? ` · ${doc.municipio}` : ''}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge ${VINCULO_BADGE[doc.vinculoEvaluatedCode]}`}
                            title={doc.vinculoEvaluatedReason}
                          >
                            {doc.vinculoEvaluatedCode === 'oficial'
                              ? 'Vínculo oficial'
                              : doc.vinculoEvaluatedCode === 'pendente_revisao'
                              ? 'Pendente de revisão'
                              : 'Não vinculada'}
                          </span>
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          <div>{formatDateBr(doc.dataEmissao)}</div>
                          {doc.prazo && (
                            <div className="micro muted">Prazo: {formatDateBr(doc.prazo)}</div>
                          )}
                        </td>
                        <td>
                          <span className="badge gray">{doc.situacao}</span>
                          <div className="micro muted" style={{ marginTop: '3px' }}>
                            {doc.sincronizacaoEstado || 'Sincronizado'}
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="iconbtn"
                            onClick={() => {
                              setSelectedDoc(doc);
                              setDocActionMsg(null);
                              setShowDocRevisionForm(false);
                              setDocRevReason('');
                            }}
                          >
                            Abrir (leitura)
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8}>
                        <div className="empty">
                          <b>
                            {activeTab === 'meus_documentos'
                              ? 'Nenhum documento atribuído ao seu usuário'
                              : 'Nenhum documento encontrado para os filtros atuais'}
                          </b>
                          <p>
                            {activeTab === 'meus_documentos'
                              ? 'Alternar para "Todos documentos CSB" exibe as referências panorâmicas disponíveis ao seu perfil.'
                              : 'Ajuste os filtros ou clique em "Atualizar referências" para consultar o catálogo.'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <PaginationBar
              totalItems={filteredDocs.length}
              currentPage={safePage}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        </>
      ) : (
        /* ABA SOLICITAÇÕES E CAIXAS */
        <div className="panel">
          <div className="panel-head" style={{ flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn ${activeCaixa === 'GERAL' ? 'green' : 'light'} small`}
                onClick={() => setActiveCaixa('GERAL')}
              >
                Caixa GERAL (
                {workflowStore.solicitacoes.filter(s => s.caixaAtual === 'GERAL').length})
              </button>
              <button
                type="button"
                className={`btn ${activeCaixa === 'Pessoal' ? 'green' : 'light'} small`}
                onClick={() => setActiveCaixa('Pessoal')}
              >
                Caixa pessoal (
                {
                  workflowStore.solicitacoes.filter(
                    s =>
                      s.caixaAtual === 'Pessoal' &&
                      (normVinculoText(s.destinatarioUsuarioId) === normVinculoText(currentActor.id) ||
                        userRole === 'Administrador')
                  ).length
                }
                )
              </button>
              <button
                type="button"
                className={`btn ${activeCaixa === 'Enviadas' ? 'green' : 'light'} small`}
                onClick={() => setActiveCaixa('Enviadas')}
              >
                Solicitações enviadas
              </button>
              <button
                type="button"
                className={`btn ${activeCaixa === 'Revisoes' ? 'green' : 'light'} small`}
                onClick={() => setActiveCaixa('Revisoes')}
              >
                Revisões de documentos ({workflowStore.revisoesDocumentos.length})
              </button>
            </div>
          </div>

          <div className="panel-body">
            <div className="notice slate" style={{ marginBottom: '12px' }}>
              Solicitações de vistoria são gravadas via <code>/api/solicitacoesVistoria</code>.
              Solicitações ao sistema Notifica ficam marcadas como “Aguardando integração” até a
              provisão do contrato externo; a redistribuição da caixa GERAL e a decisão sobre
              revisões administrativas são exclusivas de Administradores.
            </div>

            {activeCaixa === 'Revisoes' ? (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Documento / Origem</th>
                      <th>Solicitante</th>
                      <th>Tipo / Justificativa</th>
                      <th>Status</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workflowStore.revisoesDocumentos.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="empty">
                            <b>Nenhuma solicitação de revisão ou retificação de documento</b>
                            <p>
                              Abra qualquer documento na Mesa Virtual e clique em “Solicitar revisão
                              / retificação”.
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      workflowStore.revisoesDocumentos.map(rev => (
                        <tr key={rev.id}>
                          <td>
                            <b>{rev.documentoTitulo}</b>
                            <div className="micro muted">
                              {rev.origemSistema}
                              {rev.documentoNumero ? ` · Nº ${rev.documentoNumero}` : ''}
                            </div>
                          </td>
                          <td>
                            {rev.solicitanteNome}
                            <div className="micro muted">{formatDateTimeBr(rev.createdAt)}</div>
                          </td>
                          <td>
                            <span className="badge gray">{rev.tipoSolicitacao}</span>
                            <div style={{ fontSize: '11.5px', marginTop: '4px' }}>
                              {rev.justificativa}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                rev.status === 'Aceita'
                                  ? 'green'
                                  : rev.status === 'Recusada'
                                  ? 'amber'
                                  : 'blue'
                              }`}
                            >
                              {rev.status}
                            </span>
                            {rev.justificativaDecisao && (
                              <div className="micro muted" style={{ marginTop: '4px' }}>
                                {rev.decididaPorNome}: {rev.justificativaDecisao}
                              </div>
                            )}
                          </td>
                          <td>
                            {perms.canDecideRevisaoAdministrativa &&
                            rev.status === 'Pendente de análise administrativa' ? (
                              <button
                                type="button"
                                className="btn soft small"
                                onClick={() => {
                                  setDecidingDocRevId(rev.id);
                                  setDecidingDocRevChoice('aceita');
                                  setDecidingDocRevReason('');
                                }}
                              >
                                Decidir (Admin)
                              </button>
                            ) : (
                              <span className="micro muted">Somente leitura</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Data / Remetente</th>
                      <th>Ação / Destino</th>
                      <th>Entidades selecionadas</th>
                      <th>Status / Sincronização</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caixaItems.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="empty">
                            <b>Nenhuma solicitação nesta caixa</b>
                            <p>Utilize “+ Nova solicitação” para preparar e enviar.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      caixaItems.map(item => (
                        <tr key={item.id}>
                          <td>
                            <div>{formatDateTimeBr(item.createdAt)}</div>
                            <div className="micro muted">Por: {item.remetenteNome}</div>
                          </td>
                          <td>
                            <b>
                              {item.acaoSolicitada === 'solicitar_vistoria'
                                ? 'Solicitar vistoria'
                                : 'Solicitar notificação'}
                            </b>
                            <div className="micro muted">
                              Destino:{' '}
                              {item.destinatarioTipo === 'GERAL'
                                ? 'Caixa GERAL'
                                : item.destinatarioUsuarioNome || item.destinatarioUsuarioId}
                            </div>
                          </td>
                          <td>
                            <b>{item.entidades.length} barragem(ns)</b>
                            <div className="micro muted">
                              {item.entidades
                                .slice(0, 2)
                                .map(e => e.barragemNome)
                                .join(', ')}
                              {item.entidades.length > 2
                                ? ` (+${item.entidades.length - 2})`
                                : ''}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                item.statusSincronizacao === 'Sincronizado'
                                  ? 'green'
                                  : item.statusSincronizacao === 'Falha controlada'
                                  ? 'amber'
                                  : 'gray'
                              }`}
                            >
                              {item.statusFluxo}
                            </span>
                            <div className="micro muted" style={{ marginTop: '3px' }}>
                              Sync: {item.statusSincronizacao}
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="iconbtn"
                              onClick={() => {
                                setSelectedSolicitacao(item);
                                setSolActionMode('historico');
                                setSolActionError(null);
                              }}
                            >
                              Detalhes / Trâmite
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DETALHES DO DOCUMENTO (SOMENTE LEITURA + REVISÃO AUDITÁVEL) */}
      {selectedDoc && (
        <div
          className="modal-back"
          onClick={e => {
            if (e.target === e.currentTarget) setSelectedDoc(null);
          }}
        >
          <div className="modal" style={{ width: 'min(760px, 100%)' }}>
            <div className="modal-head">
              <div>
                <h3>{selectedDoc.titulo}</h3>
                <span className="micro muted">
                  Origem: {selectedDoc.sistemaPanoramico} · ID Origem: {selectedDoc.origemDocumentoId}
                </span>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSelectedDoc(null)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="notice slate" style={{ marginBottom: '12px' }}>
                {selectedDoc.editBlockedReason ||
                  'Documento em modo somente leitura. Alterações ou retificações devem seguir o fluxo auditável abaixo.'}
              </div>

              {docActionMsg && (
                <div className="notice amber" style={{ marginBottom: '12px' }}>
                  {docActionMsg}
                </div>
              )}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                  gap: '10px',
                  padding: '12px',
                  borderRadius: '10px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  marginBottom: '12px',
                  fontSize: '11.5px'
                }}
              >
                <div>
                  <span className="muted">Tipo / Situação:</span>
                  <div>
                    <b>{selectedDoc.tipoNome}</b> · {selectedDoc.situacao}
                  </div>
                </div>
                <div>
                  <span className="muted">Autor / Elaborador:</span>
                  <div>
                    <b>{selectedDoc.autorPrincipal}</b>
                  </div>
                </div>
                <div>
                  <span className="muted">Barragem / Município:</span>
                  <div>
                    <b>{selectedDoc.barragemNome || '—'}</b>
                    {selectedDoc.municipio ? ` (${selectedDoc.municipio})` : ''}
                  </div>
                </div>
                <div>
                  <span className="muted">Empreendedor (mascarado):</span>
                  <div>
                    <b>{selectedDoc.empreendedorNome || '—'}</b>
                    <div className="micro muted">{selectedDoc.empreendedorDocumentoMascarado}</div>
                  </div>
                </div>
                <div>
                  <span className="muted">Estado de vínculo:</span>
                  <div>
                    <span className={`badge ${VINCULO_BADGE[selectedDoc.vinculoEvaluatedCode]}`}>
                      {selectedDoc.vinculoEvaluatedLabel}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="muted">Processo / Emissão:</span>
                  <div>
                    <b>{selectedDoc.processo || '—'}</b> · {formatDateBr(selectedDoc.dataEmissao)}
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <ConferenciaDocumentosPanel
                  compact
                  titulo="Conferência contextual de documentos relacionados"
                  criteria={{
                    barragemId: selectedDoc.barragemId,
                    empreendedorId: selectedDoc.empreendedorId,
                    empreendimentoId: selectedDoc.empreendimentoId,
                    processo: selectedDoc.processo,
                    carMt: selectedDoc.carMt
                  }}
                  commonData={commonData}
                  documentosPreCarregados={catalogoDocs}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <button
                  type="button"
                  className="btn light small"
                  onClick={() => handleOpenOrigin(selectedDoc)}
                >
                  Abrir na origem ↗
                </button>
                <button
                  type="button"
                  className="btn light small"
                  onClick={() => handleDownloadOrigin(selectedDoc)}
                >
                  Baixar na origem
                </button>
                {perms.canRequestRevisaoDocumento && (
                  <button
                    type="button"
                    className="btn soft small"
                    onClick={() => setShowDocRevisionForm(prev => !prev)}
                  >
                    Solicitar revisão / retificação
                  </button>
                )}
              </div>

              {showDocRevisionForm && perms.canRequestRevisaoDocumento && (
                <form
                  onSubmit={handleSubmitDocRevision}
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc'
                  }}
                >
                  <div className="form-grid">
                    <div className="form-field">
                      <label>Tipo de solicitação</label>
                      <select
                        className="select"
                        value={docRevType}
                        onChange={e =>
                          setDocRevType(
                            e.target.value === 'retificacao' ? 'retificacao' : 'revisao'
                          )
                        }
                      >
                        <option value="revisao">Revisão técnica</option>
                        <option value="retificacao">Retificação de documento concluído</option>
                      </select>
                    </div>
                    <div className="form-field full">
                      <label>Justificativa auditável *</label>
                      <textarea
                        className="textarea"
                        required
                        minLength={5}
                        maxLength={800}
                        placeholder="Descreva os pontos a revisar ou retificar (sem CPF/CNPJ)..."
                        value={docRevReason}
                        onChange={e => setDocRevReason(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                    <button
                      type="button"
                      className="btn light small"
                      onClick={() => setShowDocRevisionForm(false)}
                    >
                      Cancelar
                    </button>
                    <button type="submit" className="btn green small">
                      Registrar solicitação auditável
                    </button>
                  </div>
                </form>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn light" onClick={() => setSelectedDoc(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL COMPOSITOR DE SOLICITAÇÃO COM MULTI-SELEÇÃO E PRÉ-VISUALIZAÇÃO */}
      {showComposerModal && perms.canCreateSolicitacao && (
        <div
          className="modal-back"
          onClick={e => {
            if (e.target === e.currentTarget && !composerSubmitting) {
              setShowComposerModal(false);
            }
          }}
        >
          <div className="modal" style={{ width: 'min(800px, 100%)' }}>
            <div className="modal-head">
              <div>
                <h3>
                  {composerStep === 'form'
                    ? 'Nova solicitação · Mesa Virtual'
                    : 'Pré-visualização antes do envio'}
                </h3>
                <span className="micro muted">Chave de idempotência: {composerKey}</span>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => !composerSubmitting && setShowComposerModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {composerError && (
                <div className="notice amber" style={{ marginBottom: '12px' }}>
                  {composerError}
                </div>
              )}

              {composerStep === 'form' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                      Ação desejada *
                    </label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className={`btn ${
                          composerAction === 'solicitar_vistoria' ? 'green' : 'light'
                        } small`}
                        onClick={() => setComposerAction('solicitar_vistoria')}
                      >
                        Solicitar vistoria
                      </button>
                      <button
                        type="button"
                        className={`btn ${
                          composerAction === 'solicitar_notificacao' ? 'green' : 'light'
                        } small`}
                        onClick={() => setComposerAction('solicitar_notificacao')}
                      >
                        Solicitar notificação (Notifica)
                      </button>
                      <button
                        type="button"
                        className="btn light small"
                        disabled
                        title={AUTO_INFRACAO_ACTION_CONFIG.reason}
                        style={{ opacity: 0.65, cursor: 'not-allowed' }}
                      >
                        {AUTO_INFRACAO_ACTION_CONFIG.label}{' '}
                        <span className="badge gray" style={{ marginLeft: '4px' }}>
                          {AUTO_INFRACAO_ACTION_CONFIG.badge}
                        </span>
                      </button>
                    </div>
                  </div>

                  {composerAction === 'solicitar_notificacao' && (
                    <div className="notice slate">
                      O contrato de envio direto ao sistema Notifica ainda aguarda definição no
                      servidor. A solicitação será registrada como “Aguardando integração”, nunca
                      marcada como entregue.
                    </div>
                  )}

                  <BarragemSelectorField
                    multiple
                    required
                    label="Entidades / barragens selecionadas (seleção múltipla paginada)"
                    barragens={commonData.barragens}
                    empreendedores={commonData.empreendedores}
                    selectedIds={composerDamIds}
                    onChangeMultiple={ids => setComposerDamIds(ids)}
                  />

                  {composerEntidades[0] && (
                    <ConferenciaDocumentosPanel
                      compact
                      titulo={`Conferência prévia · ${composerEntidades[0].barragemNome}`}
                      criteria={{
                        barragemId: composerEntidades[0].barragemId,
                        empreendedorId: composerEntidades[0].empreendedorId,
                        processo: composerEntidades[0].processo,
                        carMt: composerEntidades[0].car
                      }}
                      commonData={commonData}
                      documentosPreCarregados={catalogoDocs}
                    />
                  )}

                  <div className="form-grid">
                    <div className="form-field">
                      <label>Caixa de destino *</label>
                      <select
                        className="select"
                        value={composerDestType}
                        onChange={e =>
                          setComposerDestType(e.target.value === 'USUARIO' ? 'USUARIO' : 'GERAL')
                        }
                      >
                        <option value="GERAL">GERAL (fila para distribuição)</option>
                        {perms.canTargetSpecificUser && (
                          <option value="USUARIO">Usuário específico (Admin)</option>
                        )}
                      </select>
                    </div>

                    {composerDestType === 'USUARIO' && perms.canTargetSpecificUser && (
                      <div className="form-field">
                        <label>Servidor destinatário *</label>
                        <select
                          className="select"
                          value={composerDestUserId}
                          onChange={e => setComposerDestUserId(e.target.value)}
                        >
                          <option value="">Selecione um usuário ativo...</option>
                          {activeUsers.map(u => (
                            <option key={u.id} value={u.id}>
                              {u.nome}
                              {u.setor ? ` · ${u.setor}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="form-field full">
                      <label>Justificativa geral * (sem CPF/CNPJ)</label>
                      <textarea
                        className="textarea"
                        required
                        minLength={5}
                        maxLength={900}
                        placeholder="Informe o fundamento técnico da solicitação..."
                        value={composerJustificativaGeral}
                        onChange={e => setComposerJustificativaGeral(e.target.value)}
                      />
                    </div>
                  </div>

                  {composerEntidades.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <strong style={{ fontSize: '11.5px', color: '#334155' }}>
                        Justificativa específica por barragem / destino (opcional)
                      </strong>
                      {composerEntidades.map(ent => (
                        <div key={ent.barragemId} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ minWidth: '170px', fontSize: '11.5px', fontWeight: 600 }}>
                            {ent.barragemNome}:
                          </span>
                          <input
                            className="input"
                            placeholder="Observação específica opcional..."
                            value={composerJustificativasDest[ent.barragemId] || ''}
                            onChange={e =>
                              setComposerJustificativasDest(prev => ({
                                ...prev,
                                [ent.barragemId]: e.target.value
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* ETAPA DE PRÉ-VISUALIZAÇÃO */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="notice slate">
                    Confira os dados abaixo antes de confirmar o envio. Nenhuma alteração foi
                    persistida ainda.
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      fontSize: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}
                  >
                    <div>
                      <b>Ação:</b>{' '}
                      {composerAction === 'solicitar_vistoria'
                        ? 'Solicitar vistoria (envio real para Solicitações de Vistoria)'
                        : 'Solicitar notificação (Aguardando integração Notifica)'}
                    </div>
                    <div>
                      <b>Destino:</b>{' '}
                      {composerDestType === 'GERAL'
                        ? 'Caixa GERAL'
                        : activeUsers.find(u => u.id === composerDestUserId)?.nome ||
                          composerDestUserId}
                    </div>
                    <div>
                      <b>Justificativa geral:</b> {composerJustificativaGeral}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <strong style={{ fontSize: '12px' }}>
                      Entidades incluídas ({composerEntidades.length})
                    </strong>
                    {composerEntidades.map(ent => (
                      <div
                        key={ent.barragemId}
                        style={{
                          padding: '8px 10px',
                          border: '1px solid #e2e8f0',
                          borderRadius: '8px',
                          fontSize: '11.5px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                          <b>{ent.barragemNome}</b>
                          <span className={`badge ${VINCULO_BADGE[ent.vinculoStatus]}`}>
                            {ent.vinculoStatus === 'oficial'
                              ? 'Vínculo oficial'
                              : ent.vinculoStatus === 'pendente_revisao'
                              ? 'Vínculo pendente de revisão'
                              : 'Não vinculada'}
                          </span>
                        </div>
                        <div className="micro muted">
                          Empreendedor: {ent.empreendedorNome || 'Não vinculado'} · Município:{' '}
                          {ent.municipio || '—'}
                        </div>
                        {composerJustificativasDest[ent.barragemId] && (
                          <div style={{ marginTop: '4px', color: '#334155' }}>
                            Justificativa específica: {composerJustificativasDest[ent.barragemId]}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-foot">
              {composerStep === 'form' ? (
                <>
                  <button
                    type="button"
                    className="btn light"
                    onClick={() => setShowComposerModal(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn green"
                    onClick={handlePreviewComposer}
                  >
                    Pré-visualizar antes do envio
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn light"
                    disabled={composerSubmitting}
                    onClick={() => setComposerStep('form')}
                  >
                    Voltar e ajustar
                  </button>
                  <button
                    type="button"
                    className="btn green"
                    disabled={composerSubmitting}
                    onClick={handleDispatchSolicitacao}
                  >
                    {composerSubmitting ? 'Enviando...' : 'Confirmar e enviar solicitação'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DETALHES / TRÂMITE / REDISTRIBUIÇÃO / REVISÃO DA SOLICITAÇÃO */}
      {selectedSolicitacao && (
        <div
          className="modal-back"
          onClick={e => {
            if (e.target === e.currentTarget) setSelectedSolicitacao(null);
          }}
        >
          <div className="modal" style={{ width: 'min(780px, 100%)' }}>
            <div className="modal-head">
              <div>
                <h3>Trâmite da Solicitação · Mesa Virtual</h3>
                <span className="micro muted">
                  ID: {selectedSolicitacao.id} · Caixa atual: {selectedSolicitacao.caixaAtual}
                </span>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSelectedSolicitacao(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {solActionError && (
                <div className="notice amber" style={{ marginBottom: '12px' }}>
                  {solActionError}
                </div>
              )}

              <div
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  marginBottom: '12px',
                  fontSize: '12px'
                }}
              >
                <div>
                  <b>Status do fluxo:</b> {selectedSolicitacao.statusFluxo} ·{' '}
                  <b>Sincronização:</b> {selectedSolicitacao.statusSincronizacao}
                </div>
                <div style={{ marginTop: '4px' }}>
                  <b>Justificativa geral:</b> {selectedSolicitacao.justificativaGeral}
                </div>
              </div>

              {/* Retornos por entidade */}
              <div style={{ marginBottom: '12px' }}>
                <strong style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Retorno de integração / destino por barragem
                </strong>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {selectedSolicitacao.vistoriaRetornos.map((ret, idx) => (
                    <div
                      key={`${ret.barragemId}-${idx}`}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                        fontSize: '11.5px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '8px',
                        flexWrap: 'wrap'
                      }}
                    >
                      <div>
                        <b>{ret.barragemNome}</b>
                        <div className="micro muted">{ret.mensagem}</div>
                        {ret.vistoriaId && (
                          <div className="micro muted">ID Vistoria: {ret.vistoriaId}</div>
                        )}
                      </div>
                      <span className={`badge ${ret.sincronizado ? 'green' : 'amber'}`}>
                        {ret.sincronizado ? ret.status || 'Sincronizado' : 'Pendente / Não enviado'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ações conforme papel */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <button
                  type="button"
                  className={`btn ${solActionMode === 'historico' ? 'soft' : 'light'} small`}
                  onClick={() => setSolActionMode('historico')}
                >
                  Histórico ({selectedSolicitacao.historico.length})
                </button>
                {perms.canRedistributeGeral && selectedSolicitacao.caixaAtual === 'GERAL' && (
                  <button
                    type="button"
                    className={`btn ${solActionMode === 'redistribuir' ? 'green' : 'light'} small`}
                    onClick={() => setSolActionMode('redistribuir')}
                  >
                    Redistribuir da GERAL (Admin)
                  </button>
                )}
                {perms.canRequestRevisaoSolicitacao && (
                  <button
                    type="button"
                    className={`btn ${solActionMode === 'pedir_revisao' ? 'soft' : 'light'} small`}
                    onClick={() => setSolActionMode('pedir_revisao')}
                  >
                    Solicitar revisão administrativa
                  </button>
                )}
                {perms.canDecideRevisaoAdministrativa &&
                  selectedSolicitacao.statusFluxo === 'Em revisão administrativa' && (
                    <button
                      type="button"
                      className={`btn ${solActionMode === 'decidir_revisao' ? 'green' : 'light'} small`}
                      onClick={() => setSolActionMode('decidir_revisao')}
                    >
                      Decidir revisão (Admin)
                    </button>
                  )}
              </div>

              {solActionMode === 'redistribuir' && perms.canRedistributeGeral && (
                <form
                  onSubmit={handleRedistribuir}
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    marginBottom: '12px'
                  }}
                >
                  <div className="form-grid">
                    <div className="form-field full">
                      <label>Servidor destinatário *</label>
                      <select
                        className="select"
                        required
                        value={redistTargetUserId}
                        onChange={e => setRedistTargetUserId(e.target.value)}
                      >
                        <option value="">Selecione um servidor ativo...</option>
                        {activeUsers.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.nome}
                            {u.setor ? ` · ${u.setor}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field full">
                      <label>Justificativa da redistribuição *</label>
                      <textarea
                        className="textarea"
                        required
                        minLength={3}
                        value={redistReason}
                        onChange={e => setRedistReason(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                    <button type="submit" className="btn green small">
                      Confirmar redistribuição
                    </button>
                  </div>
                </form>
              )}

              {solActionMode === 'pedir_revisao' && perms.canRequestRevisaoSolicitacao && (
                <form
                  onSubmit={handleSolicitarRevisaoAdmin}
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    marginBottom: '12px'
                  }}
                >
                  <div className="form-field full">
                    <label>Motivo da revisão administrativa *</label>
                    <textarea
                      className="textarea"
                      required
                      minLength={5}
                      value={revSolicitarReason}
                      onChange={e => setRevSolicitarReason(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                    <button type="submit" className="btn green small">
                      Enviar para revisão administrativa
                    </button>
                  </div>
                </form>
              )}

              {solActionMode === 'decidir_revisao' && perms.canDecideRevisaoAdministrativa && (
                <form
                  onSubmit={handleDecidirRevisaoAdmin}
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    border: '1px solid #bbf7d0',
                    background: '#f0fdf4',
                    marginBottom: '12px'
                  }}
                >
                  <div className="form-grid">
                    <div className="form-field">
                      <label>Decisão administrativa *</label>
                      <select
                        className="select"
                        value={revDecisao}
                        onChange={e =>
                          setRevDecisao(e.target.value === 'recusada' ? 'recusada' : 'aceita')
                        }
                      >
                        <option value="aceita">Aceitar revisão</option>
                        <option value="recusada">Recusar revisão</option>
                      </select>
                    </div>
                    <div className="form-field full">
                      <label>Motivo / justificativa obrigatória *</label>
                      <textarea
                        className="textarea"
                        required
                        minLength={5}
                        value={revDecisaoReason}
                        onChange={e => setRevDecisaoReason(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                    <button type="submit" className="btn green small">
                      Registrar decisão auditável
                    </button>
                  </div>
                </form>
              )}

              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Data / Hora</th>
                      <th>Autor</th>
                      <th>Ação</th>
                      <th>Trâmite</th>
                      <th>Justificativa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSolicitacao.historico.map(h => (
                      <tr key={h.id}>
                        <td>{formatDateTimeBr(h.dataHora)}</td>
                        <td>{h.usuarioNome}</td>
                        <td>
                          <span className="badge gray">{h.acao}</span>
                        </td>
                        <td>
                          {h.caixaOrigem ? `${h.caixaOrigem} → ` : ''}
                          {h.destinatarioNovoNome || h.caixaDestino || '—'}
                        </td>
                        <td>{h.justificativa}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="modal-foot">
              <button
                type="button"
                className="btn light"
                onClick={() => setSelectedSolicitacao(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DECISÃO DE REVISÃO DE DOCUMENTO (SOMENTE ADMIN) */}
      {decidingDocRevId && perms.canDecideRevisaoAdministrativa && (
        <div
          className="modal-back"
          onClick={e => {
            if (e.target === e.currentTarget) setDecidingDocRevId(null);
          }}
        >
          <form
            className="modal"
            style={{ width: 'min(520px, 100%)' }}
            onSubmit={e => {
              e.preventDefault();
              const res = decidirSolicitacaoRevisaoDocumento(workflowStore, {
                revisaoId: decidingDocRevId,
                decisao: decidingDocRevChoice,
                justificativa: decidingDocRevReason,
                actor: currentActor
              });
              if (res.ok) {
                setWorkflowStore(res.nextStore);
                setDecidingDocRevId(null);
                onNotify?.('Decisão registrada na revisão de documento.');
              } else {
                onNotify?.(res.error || 'Erro ao registrar decisão.');
              }
            }}
          >
            <div className="modal-head">
              <h3>Decisão administrativa · Revisão de documento</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setDecidingDocRevId(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-field full">
                  <label>Decisão *</label>
                  <select
                    className="select"
                    value={decidingDocRevChoice}
                    onChange={e =>
                      setDecidingDocRevChoice(
                        e.target.value === 'recusada' ? 'recusada' : 'aceita'
                      )
                    }
                  >
                    <option value="aceita">Aceitar revisão / retificação</option>
                    <option value="recusada">Recusar solicitação</option>
                  </select>
                </div>
                <div className="form-field full">
                  <label>Motivo / justificativa obrigatória *</label>
                  <textarea
                    className="textarea"
                    required
                    minLength={5}
                    value={decidingDocRevReason}
                    onChange={e => setDecidingDocRevReason(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn light"
                onClick={() => setDecidingDocRevId(null)}
              >
                Cancelar
              </button>
              <button type="submit" className="btn green">
                Confirmar decisão
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
