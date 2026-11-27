// src/components/PendenciasView.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { BarragemRecord, EmpreendedorRecord } from '../services/notificaDataService';
import type { UserRole } from '../types/auth';
import { PaginationBar, PageSizeOption, paginateList } from './PaginationBar';
import { BarragemSelectorField } from './BarragemSelectorField';
import { ConferenciaDocumentosPanel } from './ConferenciaDocumentosModal';
import {
  PENDENCIA_CAMPO_LABELS,
  PENDENCIA_HISTORICO_ACAO_LABELS,
  PENDENCIA_REFERENCIA_TIPOS,
  PENDENCIA_SITUACAO_BADGES,
  PENDENCIA_SITUACAO_LABELS,
  PENDENCIA_SITUACOES,
  PENDENCIA_TIPOS,
  PendenciaHistoricoRecord,
  PendenciaRecord,
  PendenciaSituacao,
  PendenciaTab,
  PendenciaUserRefInfo,
  PendenciaUsuarioOption,
  alterarSituacaoPendencia,
  containsCpfOrCnpjFrontend,
  criarPendencia,
  direcionarPendencia,
  editarPendencia,
  listarPendencias,
  obterDetalhePendencia,
  resolverPendencia
} from '../services/pendenciasService';

interface PendenciasViewProps {
  userRole: UserRole;
  empreendedores: EmpreendedorRecord[];
  barragens: BarragemRecord[];
  onNotify: (message: string) => void;
}

type ModalActionMode = 'historico' | 'direcionar' | 'situacao' | 'editar' | 'resolver';

function formatDateTimePtBr(raw?: string | null): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function normalizeSearch(val: unknown): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export const PendenciasView: React.FC<PendenciasViewProps> = ({
  userRole,
  empreendedores,
  barragens,
  onNotify
}) => {
  const isAdmin = userRole === 'Administrador';
  const isReadOnly = userRole === 'Visualizador';

  const [activeTab, setActiveTab] = useState<PendenciaTab>('minhas');
  const [situacaoFiltro, setSituacaoFiltro] = useState<string>('todas');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(20);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pendencias, setPendencias] = useState<PendenciaRecord[]>([]);
  const [counts, setCounts] = useState<{ minhas: number; geral: number; direcionado?: number }>({
    minhas: 0,
    geral: 0
  });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [mutationsEnabled, setMutationsEnabled] = useState<boolean>(false);
  const [usuariosNomes, setUsuariosNomes] = useState<Record<string, PendenciaUserRefInfo>>({});
  const [usuariosDirecionaveis, setUsuariosDirecionaveis] = useState<PendenciaUsuarioOption[]>([]);

  // Modal de criação
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [createSubmitting, setCreateSubmitting] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createTipo, setCreateTipo] = useState<string>(PENDENCIA_TIPOS[0]);
  const [createTitulo, setCreateTitulo] = useState<string>('');
  const [createDescricao, setCreateDescricao] = useState<string>('');
  const [createBarragemId, setCreateBarragemId] = useState<string>('');
  const [createEmpreendedorId, setCreateEmpreendedorId] = useState<string>('');
  const [createTipoRef, setCreateTipoRef] = useState<string>('');
  const [createRefId, setCreateRefId] = useState<string>('');
  const [createOrigemRefId, setCreateOrigemRefId] = useState<string>('');
  const [createResponsavelId, setCreateResponsavelId] = useState<string>('');
  const [createMotivo, setCreateMotivo] = useState<string>('');

  // Modal de detalhe / ações / histórico
  const [selectedPendencia, setSelectedPendencia] = useState<PendenciaRecord | null>(null);
  const [modalActionMode, setModalActionMode] = useState<ModalActionMode>('historico');
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [historico, setHistorico] = useState<PendenciaHistoricoRecord[]>([]);
  const [actionSubmitting, setActionSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Campos das ações no modal de detalhe
  const [targetRespId, setTargetRespId] = useState<string>('');
  const [targetSituacao, setTargetSituacao] = useState<PendenciaSituacao>('em_analise');
  const [actionMotivo, setActionMotivo] = useState<string>('');
  const [editTipo, setEditTipo] = useState<string>('');
  const [editTitulo, setEditTitulo] = useState<string>('');
  const [editDescricao, setEditDescricao] = useState<string>('');
  const [editBarragemId, setEditBarragemId] = useState<string>('');
  const [editEmpreendedorId, setEditEmpreendedorId] = useState<string>('');
  const [editTipoRef, setEditTipoRef] = useState<string>('');
  const [editRefId, setEditRefId] = useState<string>('');
  const [editOrigemRefId, setEditOrigemRefId] = useState<string>('');

  // Garante que não-administradores nunca permaneçam na aba Direcionado
  useEffect(() => {
    if (!isAdmin && activeTab === 'direcionado') {
      setActiveTab('geral');
    }
  }, [isAdmin, activeTab]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, situacaoFiltro, searchTerm]);

  const barragemMap = useMemo(() => {
    const map = new Map<string, BarragemRecord>();
    for (const b of barragens || []) {
      if (b?.id) map.set(String(b.id), b);
    }
    return map;
  }, [barragens]);

  const empreendedorMap = useMemo(() => {
    const map = new Map<string, EmpreendedorRecord>();
    for (const e of empreendedores || []) {
      if (e?.id) map.set(String(e.id), e);
    }
    return map;
  }, [empreendedores]);

  const loadPendencias = useCallback(async () => {
    const effectiveTab: PendenciaTab = !isAdmin && activeTab === 'direcionado' ? 'geral' : activeTab;
    setLoading(true);
    setError(null);

    const res = await listarPendencias({
      tab: effectiveTab,
      situacao: situacaoFiltro
    });

    if (!res.success) {
      setError(res.error || 'Não foi possível carregar as pendências.');
      setPendencias([]);
      setLoading(false);
      return;
    }

    setPendencias(res.pendencias);
    setCounts(res.counts);
    setMutationsEnabled(Boolean(res.mutationsEnabled));
    setUsuariosNomes(res.usuariosNomes || {});
    if (Array.isArray(res.usuariosDirecionaveis)) {
      setUsuariosDirecionaveis(res.usuariosDirecionaveis);
    }

    setCurrentUserId(res.currentUser?.userId ? String(res.currentUser.userId) : null);
    setLoading(false);
  }, [activeTab, isAdmin, situacaoFiltro]);

  useEffect(() => {
    loadPendencias();
  }, [loadPendencias]);

  const resolveUserName = useCallback(
    (userId?: string | null): string => {
      if (!userId) return '—';
      const key = String(userId);
      const info = usuariosNomes[key];
      if (info?.nome) {
        return info.setor ? `${info.nome} (${info.setor})` : info.nome;
      }
      return key;
    },
    [usuariosNomes]
  );

  const canMutateItem = useCallback(
    (item: PendenciaRecord): boolean => {
      if (!mutationsEnabled || isReadOnly) return false;
      if (isAdmin) return true;
      if (!item.responsavel_id) return true;
      return Boolean(
        currentUserId &&
          String(item.responsavel_id).toLowerCase() === currentUserId.toLowerCase()
      );
    },
    [currentUserId, isAdmin, isReadOnly, mutationsEnabled]
  );

  const openDetailModal = async (item: PendenciaRecord, mode: ModalActionMode = 'historico') => {
    setSelectedPendencia(item);
    setModalActionMode(mode);
    setDetailLoading(true);
    setDetailError(null);
    setActionError(null);
    setActionMotivo('');
    setTargetRespId(item.responsavel_id ? String(item.responsavel_id) : '');
    setTargetSituacao(
      item.situacao === 'aberta' || item.situacao === 'direcionada' ? 'em_analise' : item.situacao
    );
    setEditTipo(item.tipo || '');
    setEditTitulo(item.titulo || '');
    setEditDescricao(item.descricao || '');
    setEditBarragemId(item.barragem_id || '');
    setEditEmpreendedorId(item.empreendedor_id || '');
    setEditTipoRef(item.tipo_referencia || '');
    setEditRefId(item.referencia_id || '');
    setEditOrigemRefId(item.origem_ref_id || '');
    setHistorico([]);

    const detail = await obterDetalhePendencia(item.id);
    if (!detail.success) {
      setDetailError(detail.error || 'Erro ao carregar detalhes e histórico.');
      setDetailLoading(false);
      return;
    }

    if (detail.pendencia) {
      setSelectedPendencia(detail.pendencia);
    }
    setHistorico(detail.historico || []);
    if (detail.usuariosNomes) {
      setUsuariosNomes(prev => ({ ...prev, ...detail.usuariosNomes }));
    }
    if (Array.isArray(detail.usuariosDirecionaveis)) {
      setUsuariosDirecionaveis(detail.usuariosDirecionaveis);
    }
    setDetailLoading(false);
  };

  const resetCreateForm = () => {
    setCreateError(null);
    setCreateTipo(PENDENCIA_TIPOS[0]);
    setCreateTitulo('');
    setCreateDescricao('');
    setCreateBarragemId('');
    setCreateEmpreendedorId('');
    setCreateTipoRef('');
    setCreateRefId('');
    setCreateOrigemRefId('');
    setCreateResponsavelId('');
    setCreateMotivo('');
  };

  const handleOpenCreateModal = () => {
    if (isReadOnly) return;
    resetCreateForm();
    setShowCreateModal(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setCreateError(null);

    if (createTitulo.trim().length < 3) {
      setCreateError('Informe um título com pelo menos 3 caracteres.');
      return;
    }

    const sensitiveCheck = [
      createTitulo,
      createDescricao,
      createMotivo,
      createRefId,
      createOrigemRefId
    ].some(v => containsCpfOrCnpjFrontend(v));

    if (sensitiveCheck) {
      setCreateError(
        'Não é permitido gravar CPF/CNPJ em pendências. Selecione o cadastro ou informe apenas IDs.'
      );
      return;
    }

    setCreateSubmitting(true);
    const res = await criarPendencia({
      tipo: createTipo.trim(),
      titulo: createTitulo.trim(),
      descricao: createDescricao.trim() || undefined,
      barragem_id: createBarragemId || undefined,
      empreendedor_id: createEmpreendedorId || undefined,
      tipo_referencia: createTipoRef || undefined,
      referencia_id: createRefId.trim() || undefined,
      origem_ref_id: createOrigemRefId.trim() || undefined,
      motivo: createMotivo.trim() || undefined,
      ...(isAdmin && createResponsavelId ? { responsavelUsuarioId: createResponsavelId } : {})
    });
    setCreateSubmitting(false);

    if (!res.success) {
      setCreateError(res.error || 'Falha ao criar pendência.');
      return;
    }

    setShowCreateModal(false);
    resetCreateForm();
    onNotify('Pendência registrada com histórico auditável.');
    await loadPendencias();
  };

  const handleDirecionarSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPendencia || !isAdmin) return;
    setActionError(null);

    if (!targetRespId) {
      setActionError('Selecione um usuário ativo para direcionar.');
      return;
    }
    if (containsCpfOrCnpjFrontend(actionMotivo)) {
      setActionError('Não é permitido gravar CPF/CNPJ no motivo.');
      return;
    }

    setActionSubmitting(true);
    const res = await direcionarPendencia({
      pendenciaId: selectedPendencia.id,
      responsavelUsuarioId: targetRespId,
      motivo: actionMotivo.trim() || undefined
    });
    setActionSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Falha ao direcionar pendência.');
      return;
    }

    onNotify('Pendência direcionada e registrada no histórico.');
    await loadPendencias();
    await openDetailModal(res.pendencia || selectedPendencia, 'historico');
  };

  const handleSituacaoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPendencia || !canMutateItem(selectedPendencia)) return;
    setActionError(null);

    if (
      (targetSituacao === 'resolvida' || targetSituacao === 'cancelada') &&
      actionMotivo.trim().length < 3
    ) {
      setActionError('Informe o motivo (mínimo 3 caracteres) para resolver ou cancelar.');
      return;
    }
    if (containsCpfOrCnpjFrontend(actionMotivo)) {
      setActionError('Não é permitido gravar CPF/CNPJ no motivo.');
      return;
    }

    setActionSubmitting(true);
    const res = await alterarSituacaoPendencia({
      pendenciaId: selectedPendencia.id,
      situacao: targetSituacao,
      motivo: actionMotivo.trim() || undefined
    });
    setActionSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Falha ao alterar situação.');
      return;
    }

    onNotify('Situação atualizada com registro no histórico.');
    await loadPendencias();
    await openDetailModal(res.pendencia || selectedPendencia, 'historico');
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPendencia || !canMutateItem(selectedPendencia)) return;
    setActionError(null);

    if (editTitulo.trim().length < 3) {
      setActionError('O título deve ter pelo menos 3 caracteres.');
      return;
    }

    if (
      [editTitulo, editDescricao, actionMotivo, editRefId, editOrigemRefId].some(v =>
        containsCpfOrCnpjFrontend(v)
      )
    ) {
      setActionError('Não é permitido gravar CPF/CNPJ em pendências. Utilize apenas IDs.');
      return;
    }

    setActionSubmitting(true);
    const res = await editarPendencia({
      pendenciaId: selectedPendencia.id,
      tipo: editTipo.trim(),
      titulo: editTitulo.trim(),
      descricao: editDescricao.trim(),
      barragem_id: editBarragemId,
      empreendedor_id: editEmpreendedorId,
      tipo_referencia: editTipoRef,
      referencia_id: editRefId.trim(),
      origem_ref_id: editOrigemRefId.trim(),
      motivo: actionMotivo.trim() || undefined
    });
    setActionSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Falha ao salvar edição da pendência.');
      return;
    }

    onNotify('Pendência atualizada com registro das alterações no histórico.');
    await loadPendencias();
    await openDetailModal(res.pendencia || selectedPendencia, 'historico');
  };

  const handleResolverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPendencia || !canMutateItem(selectedPendencia)) return;
    setActionError(null);

    if (actionMotivo.trim().length < 3) {
      setActionError('Informe o motivo / observação da resolução (mínimo 3 caracteres).');
      return;
    }
    if (containsCpfOrCnpjFrontend(actionMotivo)) {
      setActionError('Não é permitido gravar CPF/CNPJ no motivo da resolução.');
      return;
    }

    setActionSubmitting(true);
    const res = await resolverPendencia({
      pendenciaId: selectedPendencia.id,
      motivo: actionMotivo.trim()
    });
    setActionSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Falha ao resolver pendência.');
      return;
    }

    onNotify('Pendência marcada como resolvida e registrada no histórico.');
    await loadPendencias();
    await openDetailModal(res.pendencia || selectedPendencia, 'historico');
  };

  const filteredPendencias = useMemo(() => {
    const q = normalizeSearch(searchTerm);
    if (!q) return pendencias;
    return pendencias.filter(item => {
      const barragem = item.barragem_id ? barragemMap.get(String(item.barragem_id)) : undefined;
      const emp = item.empreendedor_id ? empreendedorMap.get(String(item.empreendedor_id)) : undefined;
      const respNome = item.responsavel_id ? resolveUserName(item.responsavel_id) : '';
      const criadorNome = item.criado_por ? resolveUserName(item.criado_por) : '';
      const haystack = normalizeSearch(
        `${item.titulo} ${item.tipo} ${item.descricao || ''} ${item.origem || ''} ${item.origem_ref_id || ''} ${item.tipo_referencia || ''} ${item.referencia_id || ''} ${barragem?.nome || ''} ${emp?.nome || ''} ${respNome} ${criadorNome}`
      );
      return haystack.includes(q);
    });
  }, [barragemMap, empreendedorMap, pendencias, resolveUserName, searchTerm]);

  const { pagedItems } = useMemo(
    () => paginateList(filteredPendencias, page, pageSize),
    [filteredPendencias, page, pageSize]
  );

  const statsCounts = useMemo(() => {
    let abertas = 0;
    let emAnalise = 0;
    let direcionadas = 0;
    let resolvidas = 0;
    for (const p of pendencias) {
      if (p.situacao === 'aberta') abertas++;
      else if (p.situacao === 'em_analise') emAnalise++;
      else if (p.situacao === 'direcionada') direcionadas++;
      else if (p.situacao === 'resolvida') resolvidas++;
    }
    return { abertas, emAnalise, direcionadas, resolvidas };
  }, [pendencias]);

  const formatHistoricoValue = (campo?: string | null, val?: string | null): string => {
    if (!val) return '—';
    if (campo === 'responsavel_id') return resolveUserName(val);
    if (campo === 'situacao' && val in PENDENCIA_SITUACAO_LABELS) {
      return PENDENCIA_SITUACAO_LABELS[val as PendenciaSituacao];
    }
    if (campo === 'barragem_id') {
      return barragemMap.get(val)?.nome || val;
    }
    if (campo === 'empreendedor_id') {
      return empreendedorMap.get(val)?.nome || val;
    }
    return val;
  };

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Gestão de trabalho · Fluxo institucional</div>
          <h2>Pendências</h2>
          <p>
            Acompanhamento, direcionamento e resolução de pendências com trilha imutável de histórico.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn light" onClick={loadPendencias} disabled={loading}>
            ↻ Atualizar
          </button>
          {!isReadOnly && (
            <button
              type="button"
              className="btn green"
              onClick={handleOpenCreateModal}
              disabled={!mutationsEnabled}
              title={
                mutationsEnabled
                  ? 'Criar nova pendência'
                  : 'Mutações temporariamente desabilitadas (HTTP 409) até existir mecanismo transacional atômico'
              }
            >
              ＋ Nova pendência
            </button>
          )}
        </div>
      </div>

      {!mutationsEnabled && (
        <div className="notice amber" style={{ marginBottom: '14px' }}>
          <b>Modo de leitura segura ativo:</b> criação, direcionamento, edição e resolução de pendências estão desabilitados no servidor (HTTP 409) até existir mecanismo transacional atômico para gravação simultânea com o histórico.
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <div>
            <div className="label">Abertas (aba)</div>
            <div className="value">{statsCounts.abertas}</div>
          </div>
          <div className="stat-ico">⚑</div>
        </div>
        <div className="stat">
          <div>
            <div className="label">Direcionadas</div>
            <div className="value">{statsCounts.direcionadas}</div>
          </div>
          <div className="stat-ico">➜</div>
        </div>
        <div className="stat">
          <div>
            <div className="label">Em análise</div>
            <div className="value">{statsCounts.emAnalise}</div>
          </div>
          <div className="stat-ico">◷</div>
        </div>
        <div className="stat">
          <div>
            <div className="label">Resolvidas</div>
            <div className="value">{statsCounts.resolvidas}</div>
          </div>
          <div className="stat-ico">✓</div>
        </div>
      </div>

      <div className="panel">
        <div className="tabs" role="tablist" aria-label="Abas de pendências">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'minhas'}
            className={`tab ${activeTab === 'minhas' ? 'active' : ''}`}
            onClick={() => setActiveTab('minhas')}
          >
            Minhas pendências ({counts.minhas})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'geral'}
            className={`tab ${activeTab === 'geral' ? 'active' : ''}`}
            onClick={() => setActiveTab('geral')}
          >
            Lista geral ({counts.geral})
          </button>
          {isAdmin && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'direcionado'}
              className={`tab ${activeTab === 'direcionado' ? 'active' : ''}`}
              onClick={() => setActiveTab('direcionado')}
            >
              Direcionado ({counts.direcionado ?? 0})
            </button>
          )}
        </div>

        <div className="toolbar">
          <div className="field-search">
            <span>⌕</span>
            <input
              className="input"
              placeholder="Buscar por título, tipo, descrição, barragem, empreendedor ou responsável..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <select
            className="select filter"
            aria-label="Filtrar por situação"
            value={situacaoFiltro}
            onChange={e => setSituacaoFiltro(e.target.value)}
          >
            <option value="todas">Todas as situações</option>
            {PENDENCIA_SITUACOES.map(sit => (
              <option key={sit} value={sit}>
                {PENDENCIA_SITUACAO_LABELS[sit]}
              </option>
            ))}
          </select>
        </div>

        {loading && (
          <div className="panel-body">
            <div className="notice slate">
              Carregando pendências da base central...
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="panel-body">
            <div className="notice amber" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <strong>Não foi possível carregar as pendências:</strong> {error}
              </div>
              <button type="button" className="btn light small" onClick={loadPendencias}>
                Tentar novamente
              </button>
            </div>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Pendência</th>
                    <th>Tipo</th>
                    <th>Referências</th>
                    <th>Responsável</th>
                    <th>Situação</th>
                    <th>Atualização</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedItems.length > 0 ? (
                    pagedItems.map((item, idx) => {
                      const barragem = item.barragem_id
                        ? barragemMap.get(String(item.barragem_id))
                        : undefined;
                      const empreendedor = item.empreendedor_id
                        ? empreendedorMap.get(String(item.empreendedor_id))
                        : undefined;
                      const isClosed = item.situacao === 'resolvida' || item.situacao === 'cancelada';
                      const canMutate = canMutateItem(item);
                      const sitBadge = PENDENCIA_SITUACAO_BADGES[item.situacao] || 'gray';
                      const sitLabel = PENDENCIA_SITUACAO_LABELS[item.situacao] || item.situacao;

                      return (
                        <tr
                          key={item.id}
                          className={idx % 2 === 0 ? 'row-even' : 'row-odd'}
                        >
                          <td>
                            <div className="td-main">{item.titulo}</div>
                            {item.descricao && (
                              <span className="td-sub">
                                {item.descricao.length > 120
                                  ? `${item.descricao.slice(0, 120)}...`
                                  : item.descricao}
                              </span>
                            )}
                            <span className="td-sub">
                              Origem: {item.origem || 'administra'}
                              {item.criado_por ? ` · Criado por: ${resolveUserName(item.criado_por)}` : ''}
                            </span>
                          </td>
                          <td>{item.tipo || '—'}</td>
                          <td>
                            {barragem ? (
                              <div>
                                <b>Barragem:</b> {barragem.nome}
                              </div>
                            ) : item.barragem_id ? (
                              <div>
                                <b>Barragem ID:</b> {item.barragem_id}
                              </div>
                            ) : null}
                            {empreendedor ? (
                              <div>
                                <b>Empreendedor:</b> {empreendedor.nome}
                              </div>
                            ) : item.empreendedor_id ? (
                              <div>
                                <b>Empreendedor ID:</b> {item.empreendedor_id}
                              </div>
                            ) : null}
                            {(item.tipo_referencia || item.referencia_id) && (
                              <span className="td-sub">
                                {item.tipo_referencia ? `${item.tipo_referencia}: ` : 'Ref.: '}
                                {item.referencia_id || '—'}
                              </span>
                            )}
                            {item.origem_ref_id && (
                              <span className="td-sub">Ref. origem: {item.origem_ref_id}</span>
                            )}
                            {!item.barragem_id &&
                              !item.empreendedor_id &&
                              !item.tipo_referencia &&
                              !item.referencia_id &&
                              !item.origem_ref_id &&
                              '—'}
                          </td>
                          <td>
                            {item.responsavel_id ? (
                              <span>{resolveUserName(item.responsavel_id)}</span>
                            ) : (
                              <span className="badge gray">Sem responsável</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${sitBadge}`}>{sitLabel}</span>
                          </td>
                          <td>
                            <div>{formatDateTimePtBr(item.updated_at || item.created_at)}</div>
                            <span className="td-sub">Criada em {formatDateTimePtBr(item.created_at)}</span>
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="iconbtn"
                                onClick={() => openDetailModal(item, 'historico')}
                              >
                                Detalhes / Histórico
                              </button>
                              {isAdmin && !isClosed && (
                                <button
                                  type="button"
                                  className="iconbtn"
                                  disabled={!mutationsEnabled}
                                  onClick={() => openDetailModal(item, 'direcionar')}
                                >
                                  {item.responsavel_id ? 'Alterar resp.' : 'Direcionar'}
                                </button>
                              )}
                              {canMutate && !isClosed && (
                                <button
                                  type="button"
                                  className="iconbtn"
                                  disabled={!mutationsEnabled}
                                  onClick={() => openDetailModal(item, 'resolver')}
                                >
                                  Resolver
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7}>
                        <div className="empty">
                          <div className="empty-icon">⚑</div>
                          <b>Nenhuma pendência encontrada</b>
                          <p>
                            {activeTab === 'minhas'
                              ? 'Não há pendências atribuídas ao seu usuário com os filtros atuais.'
                              : activeTab === 'direcionado'
                              ? 'Não há pendências direcionadas no momento.'
                              : 'Nenhuma pendência disponível nesta visualização.'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <PaginationBar
              totalItems={filteredPendencias.length}
              currentPage={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </div>

      {/* MODAL CRIAR PENDÊNCIA */}
      {showCreateModal && !isReadOnly && (
        <div
          className="modal-back"
          onClick={e => {
            if (e.target === e.currentTarget && !createSubmitting) setShowCreateModal(false);
          }}
        >
          <form className="modal" onSubmit={handleCreateSubmit}>
            <div className="modal-head">
              <h3>Nova pendência</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => !createSubmitting && setShowCreateModal(false)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {createError && (
                <div className="notice amber" style={{ marginBottom: '14px' }}>
                  {createError}
                </div>
              )}

              <div className="notice slate" style={{ marginBottom: '14px' }}>
                A pendência será registrada com origem <b>administra</b> e autor autenticado da sessão atual. Não informe CPF/CNPJ nos campos de texto; utilize as referências cadastrais.
              </div>

              <div className="form-grid">
                <div className="form-field">
                  <label>Sistema de origem</label>
                  <input className="input" value="administra" disabled readOnly />
                </div>

                <div className="form-field">
                  <label>Tipo da pendência *</label>
                  <select
                    className="select"
                    value={createTipo}
                    onChange={e => setCreateTipo(e.target.value)}
                    required
                  >
                    {PENDENCIA_TIPOS.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field full">
                  <label>Título *</label>
                  <input
                    className="input"
                    required
                    minLength={3}
                    maxLength={200}
                    placeholder="Descreva objetivamente a pendência..."
                    value={createTitulo}
                    onChange={e => setCreateTitulo(e.target.value)}
                  />
                </div>

                <div className="form-field full">
                  <label>Descrição detalhada</label>
                  <textarea
                    className="textarea"
                    maxLength={2000}
                    placeholder="Contexto técnico ou administrativo da pendência (sem CPF/CNPJ)..."
                    value={createDescricao}
                    onChange={e => setCreateDescricao(e.target.value)}
                  />
                </div>

                <div className="form-field full">
                  <BarragemSelectorField
                    label="Barragem referenciada"
                    barragens={barragens || []}
                    empreendedores={empreendedores || []}
                    prioritizeEmpreendedorId={createEmpreendedorId}
                    value={createBarragemId}
                    onChange={id => setCreateBarragemId(id)}
                    emptyOptionLabel="Sem vínculo direto"
                  />
                </div>

                <div className="form-field">
                  <label>Empreendedor referenciado</label>
                  <select
                    className="select"
                    value={createEmpreendedorId}
                    onChange={e => setCreateEmpreendedorId(e.target.value)}
                  >
                    <option value="">Sem vínculo direto</option>
                    {(empreendedores || []).map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.nome || emp.nomeFantasia || emp.id}
                      </option>
                    ))}
                  </select>
                </div>

                {(createBarragemId || createEmpreendedorId) && (
                  <div className="form-field full">
                    <ConferenciaDocumentosPanel
                      compact
                      criteria={{
                        barragemId: createBarragemId || undefined,
                        empreendedorId: createEmpreendedorId || undefined
                      }}
                      commonData={{
                        empreendedores: empreendedores || [],
                        barragens: barragens || [],
                        rts: []
                      }}
                    />
                  </div>
                )}

                <div className="form-field">
                  <label>Tipo de referência adicional</label>
                  <select
                    className="select"
                    value={createTipoRef}
                    onChange={e => setCreateTipoRef(e.target.value)}
                  >
                    {PENDENCIA_REFERENCIA_TIPOS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label>ID da referência adicional</label>
                  <input
                    className="input"
                    maxLength={120}
                    placeholder="Ex.: ID do registro, portaria ou revisão"
                    value={createRefId}
                    onChange={e => setCreateRefId(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>ID referência na origem</label>
                  <input
                    className="input"
                    maxLength={120}
                    placeholder="Identificador na origem (opcional)"
                    value={createOrigemRefId}
                    onChange={e => setCreateOrigemRefId(e.target.value)}
                  />
                </div>

                {isAdmin && (
                  <div className="form-field">
                    <label>Direcionar responsável inicial (Admin)</label>
                    <select
                      className="select"
                      value={createResponsavelId}
                      onChange={e => setCreateResponsavelId(e.target.value)}
                    >
                      <option value="">Deixar em aberto (sem responsável)</option>
                      {usuariosDirecionaveis.map(u => (
                        <option key={u.id} value={u.id}>
                          {u.nome}
                          {u.setor ? ` · ${u.setor}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-field full">
                  <label>Observação / motivo inicial</label>
                  <input
                    className="input"
                    maxLength={500}
                    placeholder="Justificativa ou observação inicial para o histórico..."
                    value={createMotivo}
                    onChange={e => setCreateMotivo(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="modal-foot">
              <button
                type="button"
                className="btn light"
                onClick={() => setShowCreateModal(false)}
                disabled={createSubmitting}
              >
                Cancelar
              </button>
              <button type="submit" className="btn green" disabled={createSubmitting}>
                {createSubmitting ? 'Salvando...' : 'Registrar pendência'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL DETALHES, AÇÕES E HISTÓRICO */}
      {selectedPendencia && (
        <div
          className="modal-back"
          onClick={e => {
            if (e.target === e.currentTarget && !actionSubmitting) setSelectedPendencia(null);
          }}
        >
          <div className="modal" style={{ width: 'min(780px, 100%)' }}>
            <div className="modal-head">
              <div>
                <h3>{selectedPendencia.titulo}</h3>
                <span className="micro muted">
                  ID: {selectedPendencia.id} · Origem: {selectedPendencia.origem || 'administra'}
                </span>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => !actionSubmitting && setSelectedPendencia(null)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {detailLoading && (
                <div className="notice slate" style={{ marginBottom: '12px' }}>
                  Carregando dados atualizados e histórico...
                </div>
              )}
              {detailError && (
                <div className="notice amber" style={{ marginBottom: '12px' }}>
                  {detailError}
                </div>
              )}

              {/* Resumo atual da pendência */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '10px',
                  padding: '12px',
                  borderRadius: '10px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  marginBottom: '14px',
                  fontSize: '11px'
                }}
              >
                <div>
                  <span className="muted">Situação atual:</span>{' '}
                  <div>
                    <span
                      className={`badge ${PENDENCIA_SITUACAO_BADGES[selectedPendencia.situacao] || 'gray'}`}
                    >
                      {PENDENCIA_SITUACAO_LABELS[selectedPendencia.situacao] || selectedPendencia.situacao}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="muted">Tipo:</span>
                  <div>
                    <b>{selectedPendencia.tipo}</b>
                  </div>
                </div>
                <div>
                  <span className="muted">Responsável:</span>
                  <div>
                    <b>
                      {selectedPendencia.responsavel_id
                        ? resolveUserName(selectedPendencia.responsavel_id)
                        : 'Sem responsável'}
                    </b>
                  </div>
                </div>
                <div>
                  <span className="muted">Criada por:</span>
                  <div>
                    <b>{resolveUserName(selectedPendencia.criado_por)}</b>
                    <div className="micro muted">{formatDateTimePtBr(selectedPendencia.created_at)}</div>
                  </div>
                </div>
                {selectedPendencia.barragem_id && (
                  <div>
                    <span className="muted">Barragem:</span>
                    <div>
                      <b>
                        {barragemMap.get(String(selectedPendencia.barragem_id))?.nome ||
                          selectedPendencia.barragem_id}
                      </b>
                    </div>
                  </div>
                )}
                {selectedPendencia.empreendedor_id && (
                  <div>
                    <span className="muted">Empreendedor:</span>
                    <div>
                      <b>
                        {empreendedorMap.get(String(selectedPendencia.empreendedor_id))?.nome ||
                          selectedPendencia.empreendedor_id}
                      </b>
                    </div>
                  </div>
                )}
                {(selectedPendencia.tipo_referencia || selectedPendencia.referencia_id) && (
                  <div>
                    <span className="muted">Referência:</span>
                    <div>
                      <b>
                        {selectedPendencia.tipo_referencia || 'ID'}: {selectedPendencia.referencia_id || '—'}
                      </b>
                    </div>
                  </div>
                )}
                {selectedPendencia.resolvido_por && (
                  <div>
                    <span className="muted">Resolvida por:</span>
                    <div>
                      <b>{resolveUserName(selectedPendencia.resolvido_por)}</b>
                      <div className="micro muted">{formatDateTimePtBr(selectedPendencia.resolvido_em)}</div>
                    </div>
                  </div>
                )}
              </div>

              {selectedPendencia.descricao && (
                <div style={{ marginBottom: '12px', fontSize: '12px', color: '#334155' }}>
                  <b>Descrição:</b> {selectedPendencia.descricao}
                </div>
              )}

              {historico[0]?.motivo && (
                <div className="notice slate" style={{ marginBottom: '14px' }}>
                  <b>Último motivo registrado:</b> {historico[0].motivo}
                </div>
              )}

              {/* Abas de ações disponíveis conforme permissão */}
              {!isReadOnly && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
                  <button
                    type="button"
                    className={`btn ${modalActionMode === 'historico' ? 'soft' : 'light'} small`}
                    onClick={() => {
                      setModalActionMode('historico');
                      setActionError(null);
                    }}
                  >
                    Histórico ({historico.length})
                  </button>
                  {isAdmin &&
                    mutationsEnabled &&
                    selectedPendencia.situacao !== 'resolvida' &&
                    selectedPendencia.situacao !== 'cancelada' && (
                      <button
                        type="button"
                        className={`btn ${modalActionMode === 'direcionar' ? 'soft' : 'light'} small`}
                        onClick={() => {
                          setModalActionMode('direcionar');
                          setActionError(null);
                        }}
                      >
                        {selectedPendencia.responsavel_id ? 'Alterar responsável' : 'Direcionar'}
                      </button>
                    )}
                  {canMutateItem(selectedPendencia) && (
                    <button
                      type="button"
                      className={`btn ${modalActionMode === 'situacao' ? 'soft' : 'light'} small`}
                      onClick={() => {
                        setModalActionMode('situacao');
                        setActionError(null);
                      }}
                    >
                      Mudar situação
                    </button>
                  )}
                  {canMutateItem(selectedPendencia) &&
                    selectedPendencia.situacao !== 'resolvida' &&
                    selectedPendencia.situacao !== 'cancelada' && (
                      <>
                        <button
                          type="button"
                          className={`btn ${modalActionMode === 'editar' ? 'soft' : 'light'} small`}
                          onClick={() => {
                            setModalActionMode('editar');
                            setActionError(null);
                          }}
                        >
                          Editar dados
                        </button>
                        <button
                          type="button"
                          className={`btn ${modalActionMode === 'resolver' ? 'green' : 'light'} small`}
                          onClick={() => {
                            setModalActionMode('resolver');
                            setActionError(null);
                          }}
                        >
                          Resolver
                        </button>
                      </>
                    )}
                </div>
              )}

              {actionError && (
                <div className="notice amber" style={{ marginBottom: '12px' }}>
                  {actionError}
                </div>
              )}

              {/* FORMULÁRIO: DIRECIONAR (ADMIN) */}
              {modalActionMode === 'direcionar' && isAdmin && (
                <form
                  onSubmit={handleDirecionarSubmit}
                  style={{
                    padding: '14px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    marginBottom: '16px'
                  }}
                >
                  <div className="form-grid">
                    <div className="form-field full">
                      <label>Responsável destino *</label>
                      <select
                        className="select"
                        required
                        value={targetRespId}
                        onChange={e => setTargetRespId(e.target.value)}
                      >
                        <option value="">Selecione um usuário ativo...</option>
                        {usuariosDirecionaveis.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.nome}
                            {u.setor ? ` · ${u.setor}` : ''} ({u.papel || 'Usuário'})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field full">
                      <label>Motivo do direcionamento</label>
                      <input
                        className="input"
                        maxLength={500}
                        placeholder="Informe o motivo ou orientação (opcional)..."
                        value={actionMotivo}
                        onChange={e => setActionMotivo(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn light small"
                      onClick={() => setModalActionMode('historico')}
                    >
                      Cancelar
                    </button>
                    <button type="submit" className="btn green small" disabled={actionSubmitting}>
                      {actionSubmitting ? 'Salvando...' : 'Confirmar direcionamento'}
                    </button>
                  </div>
                </form>
              )}

              {/* FORMULÁRIO: ALTERAR SITUAÇÃO */}
              {modalActionMode === 'situacao' && canMutateItem(selectedPendencia) && (
                <form
                  onSubmit={handleSituacaoSubmit}
                  style={{
                    padding: '14px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    marginBottom: '16px'
                  }}
                >
                  <div className="form-grid">
                    <div className="form-field">
                      <label>Nova situação *</label>
                      <select
                        className="select"
                        value={targetSituacao}
                        onChange={e => setTargetSituacao(e.target.value as PendenciaSituacao)}
                      >
                        {PENDENCIA_SITUACOES.filter(
                          s => !(s === 'direcionada' && !selectedPendencia.responsavel_id)
                        ).map(s => (
                          <option key={s} value={s} disabled={s === selectedPendencia.situacao}>
                            {PENDENCIA_SITUACAO_LABELS[s]}
                            {s === selectedPendencia.situacao ? ' (atual)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>
                        Motivo {targetSituacao === 'resolvida' || targetSituacao === 'cancelada' ? '*' : '(opcional)'}
                      </label>
                      <input
                        className="input"
                        maxLength={500}
                        required={targetSituacao === 'resolvida' || targetSituacao === 'cancelada'}
                        placeholder="Justificativa para o histórico..."
                        value={actionMotivo}
                        onChange={e => setActionMotivo(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn light small"
                      onClick={() => setModalActionMode('historico')}
                    >
                      Cancelar
                    </button>
                    <button type="submit" className="btn green small" disabled={actionSubmitting}>
                      {actionSubmitting ? 'Salvando...' : 'Atualizar situação'}
                    </button>
                  </div>
                </form>
              )}

              {/* FORMULÁRIO: EDITAR */}
              {modalActionMode === 'editar' && canMutateItem(selectedPendencia) && (
                <form
                  onSubmit={handleEditSubmit}
                  style={{
                    padding: '14px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    marginBottom: '16px'
                  }}
                >
                  <div className="form-grid">
                    <div className="form-field">
                      <label>Tipo *</label>
                      <select
                        className="select"
                        value={editTipo}
                        onChange={e => setEditTipo(e.target.value)}
                      >
                        {!PENDENCIA_TIPOS.includes(editTipo as any) && editTipo && (
                          <option value={editTipo}>{editTipo}</option>
                        )}
                        {PENDENCIA_TIPOS.map(t => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Título *</label>
                      <input
                        className="input"
                        required
                        minLength={3}
                        maxLength={200}
                        value={editTitulo}
                        onChange={e => setEditTitulo(e.target.value)}
                      />
                    </div>
                    <div className="form-field full">
                      <label>Descrição</label>
                      <textarea
                        className="textarea"
                        maxLength={2000}
                        value={editDescricao}
                        onChange={e => setEditDescricao(e.target.value)}
                      />
                    </div>
                    <div className="form-field full">
                      <BarragemSelectorField
                        label="Barragem referenciada"
                        barragens={barragens || []}
                        empreendedores={empreendedores || []}
                        prioritizeEmpreendedorId={editEmpreendedorId}
                        value={editBarragemId}
                        onChange={id => setEditBarragemId(id)}
                        emptyOptionLabel="Sem vínculo"
                      />
                    </div>
                    <div className="form-field">
                      <label>Empreendedor referenciado</label>
                      <select
                        className="select"
                        value={editEmpreendedorId}
                        onChange={e => setEditEmpreendedorId(e.target.value)}
                      >
                        <option value="">Sem vínculo</option>
                        {(empreendedores || []).map(emp => (
                          <option key={emp.id} value={emp.id}>
                            {emp.nome || emp.nomeFantasia || emp.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Tipo de referência adicional</label>
                      <select
                        className="select"
                        value={editTipoRef}
                        onChange={e => setEditTipoRef(e.target.value)}
                      >
                        {PENDENCIA_REFERENCIA_TIPOS.map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>ID da referência adicional</label>
                      <input
                        className="input"
                        maxLength={120}
                        value={editRefId}
                        onChange={e => setEditRefId(e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label>ID referência na origem</label>
                      <input
                        className="input"
                        maxLength={120}
                        value={editOrigemRefId}
                        onChange={e => setEditOrigemRefId(e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label>Motivo da edição</label>
                      <input
                        className="input"
                        maxLength={500}
                        placeholder="Opcional..."
                        value={actionMotivo}
                        onChange={e => setActionMotivo(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn light small"
                      onClick={() => setModalActionMode('historico')}
                    >
                      Cancelar
                    </button>
                    <button type="submit" className="btn green small" disabled={actionSubmitting}>
                      {actionSubmitting ? 'Salvando...' : 'Salvar alterações'}
                    </button>
                  </div>
                </form>
              )}

              {/* FORMULÁRIO: RESOLVER */}
              {modalActionMode === 'resolver' && canMutateItem(selectedPendencia) && (
                <form
                  onSubmit={handleResolverSubmit}
                  style={{
                    padding: '14px',
                    border: '1px solid #bbf7d0',
                    background: '#f0fdf4',
                    borderRadius: '10px',
                    marginBottom: '16px'
                  }}
                >
                  <div className="form-grid">
                    <div className="form-field full">
                      <label>Motivo / registro da resolução *</label>
                      <textarea
                        className="textarea"
                        required
                        minLength={3}
                        maxLength={500}
                        placeholder="Descreva a providência adotada para resolver a pendência (sem CPF/CNPJ)..."
                        value={actionMotivo}
                        onChange={e => setActionMotivo(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn light small"
                      onClick={() => setModalActionMode('historico')}
                    >
                      Cancelar
                    </button>
                    <button type="submit" className="btn green small" disabled={actionSubmitting}>
                      {actionSubmitting ? 'Confirmando...' : 'Confirmar resolução'}
                    </button>
                  </div>
                </form>
              )}

              {/* HISTÓRICO SOMENTE LEITURA */}
              <div className="section-title" style={{ marginTop: '6px' }}>
                Histórico de ações (somente leitura)
              </div>

              {!detailLoading && historico.length === 0 ? (
                <div className="notice slate">
                  Nenhum registro encontrado no histórico desta pendência.
                </div>
              ) : (
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Data / Hora</th>
                        <th>Usuário</th>
                        <th>Ação</th>
                        <th>Campo</th>
                        <th>Anterior → Novo</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historico.map(h => (
                        <tr key={h.id}>
                          <td>{formatDateTimePtBr(h.created_at)}</td>
                          <td>{resolveUserName(h.usuario_id)}</td>
                          <td>
                            <span className="badge gray">
                              {PENDENCIA_HISTORICO_ACAO_LABELS[h.acao] || h.acao}
                            </span>
                          </td>
                          <td>{(h.campo && PENDENCIA_CAMPO_LABELS[h.campo]) || h.campo || '—'}</td>
                          <td>
                            <span>{formatHistoricoValue(h.campo, h.valor_anterior)}</span>
                            {' → '}
                            <b>{formatHistoricoValue(h.campo, h.valor_novo)}</b>
                          </td>
                          <td>{h.motivo || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="modal-foot">
              <button
                type="button"
                className="btn light"
                onClick={() => setSelectedPendencia(null)}
                disabled={actionSubmitting}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
