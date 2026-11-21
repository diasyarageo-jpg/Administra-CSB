// src/components/SolicitacoesVistoriaView.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { BarragemRecord, EmpreendedorRecord } from '../services/notificaDataService';
import type { UserRole } from '../types/auth';
import { PaginationBar, PageSizeOption, paginateList } from './PaginationBar';
import {
  DadosPrePreenchidos,
  SOLICITACAO_CAMPO_LABELS,
  SOLICITACAO_HISTORICO_ACAO_LABELS,
  SOLICITACAO_ORIGENS,
  SOLICITACAO_ORIGEM_LABELS,
  SOLICITACAO_STATUS_BADGES,
  SOLICITACAO_STATUS_LABELS,
  SOLICITACAO_STATUS_LIST,
  SolicitacaoCreatePreFillDraft,
  SolicitacaoUserRefInfo,
  SolicitacaoVistoriaHistoricoRecord,
  SolicitacaoVistoriaRecord,
  buildBarragemSolicitacaoDraft,
  canCreateSolicitacaoVistoriaRole,
  cancelarSolicitacaoVistoria,
  containsCpfOrCnpjFrontend,
  criarSolicitacaoVistoria,
  editarObservacaoCampoSolicitacao,
  editarSolicitacaoVistoria,
  listarSolicitacoesVistoria,
  obterDetalheSolicitacaoVistoria
} from '../services/solicitacoesVistoriaService';

export interface SolicitacoesVistoriaViewProps {
  userRole: UserRole;
  currentAuthUserId?: string | null;
  currentAuthEmail?: string | null;
  currentAuthLogin?: string | null;
  empreendedores: EmpreendedorRecord[];
  barragens: BarragemRecord[];
  onNotify: (message: string) => void;
  initialCreateDraft?: SolicitacaoCreatePreFillDraft | null;
  onConsumeInitialDraft?: () => void;
  initialLoading?: boolean;
  initialError?: string | null;
  initialSolicitacoes?: SolicitacaoVistoriaRecord[];
}

type ModalActionMode = 'historico' | 'editar' | 'cancelar' | 'observacao';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class SolicitacoesVistoriaErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(_error: Error, _info: React.ErrorInfo): void {
    // Falha capturada para impedir tela em branco sem expor dados sensíveis na UI.
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div>
          <div className="pagehead">
            <div>
              <div className="eyebrow">Gestão de trabalho · Programação e campo</div>
              <h2>Solicitações de Vistoria</h2>
              <p>
                Registro central de solicitações de vistoria, acompanhamento de realização, equipe designada e observações de campo.
              </p>
            </div>
          </div>
          <div className="panel">
            <div className="panel-body">
              <div
                className="notice amber"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap'
                }}
              >
                <div>
                  <strong>Não foi possível exibir o módulo de Solicitações de Vistoria.</strong>{' '}
                  Ocorreu uma falha inesperada na renderização desta tela.
                </div>
                <button
                  type="button"
                  className="btn light small"
                  onClick={() => {
                    this.setState({ hasError: false });
                    this.props.onRetry?.();
                  }}
                >
                  Tentar novamente
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

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

const SolicitacoesVistoriaContent: React.FC<SolicitacoesVistoriaViewProps> = ({
  userRole,
  currentAuthUserId,
  currentAuthEmail,
  currentAuthLogin,
  empreendedores,
  barragens,
  onNotify,
  initialCreateDraft,
  onConsumeInitialDraft,
  initialLoading,
  initialError,
  initialSolicitacoes
}) => {
  const isAdmin = userRole === 'Administrador';
  const isReadOnly = userRole === 'Visualizador';

  const [statusFiltro, setStatusFiltro] = useState<string>('todos');
  const [origemFiltro, setOrigemFiltro] = useState<string>('todos');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(20);

  const hasInitialStateOverride =
    initialLoading !== undefined ||
    initialError !== undefined ||
    initialSolicitacoes !== undefined;

  const [loading, setLoading] = useState<boolean>(
    initialLoading !== undefined ? initialLoading : !hasInitialStateOverride
  );
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoVistoriaRecord[]>(
    () => (Array.isArray(initialSolicitacoes) ? initialSolicitacoes : [])
  );
  const [counts, setCounts] = useState({
    total: Array.isArray(initialSolicitacoes) ? initialSolicitacoes.length : 0,
    solicitada: 0,
    em_planejamento: 0,
    realizada: 0,
    cancelada: 0
  });
  const [serverUserId, setServerUserId] = useState<string | null>(null);
  const [serverUserEmail, setServerUserEmail] = useState<string | null>(null);
  const [usuariosNomes, setUsuariosNomes] = useState<Record<string, SolicitacaoUserRefInfo>>({});

  const canPreFillFromShortcut = !isReadOnly && canCreateSolicitacaoVistoriaRole(userRole);
  const initialPre = canPreFillFromShortcut ? initialCreateDraft?.dados_pre_preenchidos : undefined;

  // Modal Nova Solicitação
  const [showCreateModal, setShowCreateModal] = useState<boolean>(
    Boolean(initialCreateDraft && canPreFillFromShortcut)
  );
  const [createSubmitting, setCreateSubmitting] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createRelato, setCreateRelato] = useState<string>('');
  const [createBarragemId, setCreateBarragemId] = useState<string>(
    canPreFillFromShortcut ? initialCreateDraft?.barragem_id || '' : ''
  );
  const [createEmpreendedorId, setCreateEmpreendedorId] = useState<string>(
    canPreFillFromShortcut ? initialCreateDraft?.empreendedor_id || '' : ''
  );
  const [createProcessoRef, setCreateProcessoRef] = useState<string>(
    canPreFillFromShortcut ? initialCreateDraft?.processo_referencia || '' : ''
  );
  const [createOrigemRefId, setCreateOrigemRefId] = useState<string>('');
  const [createMotivo, setCreateMotivo] = useState<string>('');
  const [createNomeBarragem, setCreateNomeBarragem] = useState<string>(
    initialPre?.nome_barragem || ''
  );
  const [createMunicipio, setCreateMunicipio] = useState<string>(initialPre?.municipio || '');
  const [createCursoAgua, setCreateCursoAgua] = useState<string>(initialPre?.curso_agua || '');
  const [createCoordenadas, setCreateCoordenadas] = useState<string>(
    initialPre?.coordenadas || ''
  );
  const [createUso, setCreateUso] = useState<string>(initialPre?.uso || '');
  const [createClassificacao, setCreateClassificacao] = useState<string>(
    initialPre?.classificacao || ''
  );
  const [createNomeEmp, setCreateNomeEmp] = useState<string>(
    initialPre?.nome_empreendedor || ''
  );

  // Modal Detalhe / Edição / Cancelamento / Observação de Campo
  const [selectedItem, setSelectedItem] = useState<SolicitacaoVistoriaRecord | null>(null);
  const [modalMode, setModalMode] = useState<ModalActionMode>('historico');
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [historico, setHistorico] = useState<SolicitacaoVistoriaHistoricoRecord[]>([]);
  const [actionSubmitting, setActionSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editRelato, setEditRelato] = useState<string>('');
  const [editStatus, setEditStatus] = useState<'solicitada' | 'em_planejamento'>('solicitada');
  const [editBarragemId, setEditBarragemId] = useState<string>('');
  const [editEmpreendedorId, setEditEmpreendedorId] = useState<string>('');
  const [editProcessoRef, setEditProcessoRef] = useState<string>('');
  const [editOrigemRefId, setEditOrigemRefId] = useState<string>('');
  const [editMotivo, setEditMotivo] = useState<string>('');
  const [cancelMotivo, setCancelMotivo] = useState<string>('');
  const [obsTexto, setObsTexto] = useState<string>('');

  useEffect(() => {
    setPage(1);
  }, [statusFiltro, origemFiltro, searchTerm]);

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

  const loadSolicitacoes = useCallback(async () => {
    setLoading(true);
    setError(null);

    const res = await listarSolicitacoesVistoria({
      status: statusFiltro,
      sistema_origem: origemFiltro
    });

    if (!res.success) {
      setError(res.error || 'Não foi possível carregar as solicitações de vistoria.');
      setSolicitacoes([]);
      setLoading(false);
      return;
    }

    setSolicitacoes(res.solicitacoes);
    setCounts(res.counts);
    setUsuariosNomes(res.usuariosNomes || {});
    setServerUserId(res.currentUser?.userId ? String(res.currentUser.userId) : null);
    setServerUserEmail(res.currentUser?.email ? String(res.currentUser.email) : null);
    setLoading(false);
  }, [origemFiltro, statusFiltro]);

  useEffect(() => {
    loadSolicitacoes();
  }, [loadSolicitacoes]);

  const effectiveUserId = serverUserId || currentAuthUserId || null;

  const userIdentityTokens = useMemo(() => {
    const tokens = new Set<string>();
    for (const raw of [effectiveUserId, serverUserEmail, currentAuthEmail, currentAuthLogin]) {
      const val = String(raw || '').trim().toLowerCase();
      if (val) tokens.add(val);
    }
    return tokens;
  }, [currentAuthEmail, currentAuthLogin, effectiveUserId, serverUserEmail]);

  const resolveUserName = useCallback(
    (userId?: string | null, fallbackName?: string | null): string => {
      if (fallbackName && String(fallbackName).trim()) {
        return String(fallbackName).trim();
      }
      if (!userId) return '—';
      const info = usuariosNomes[String(userId)];
      if (info?.nome) {
        return info.setor ? `${info.nome} (${info.setor})` : info.nome;
      }
      return String(userId);
    },
    [usuariosNomes]
  );

  const canEditOrCancel = useCallback(
    (item: SolicitacaoVistoriaRecord): boolean => {
      if (isReadOnly) return false;
      if (item.status === 'realizada' || item.status === 'cancelada') return false;
      if (isAdmin) return true;
      return Boolean(
        effectiveUserId &&
          String(item.solicitante_id || '').trim().toLowerCase() ===
            effectiveUserId.trim().toLowerCase()
      );
    },
    [effectiveUserId, isAdmin, isReadOnly]
  );

  const canEditObservacao = useCallback(
    (item: SolicitacaoVistoriaRecord): boolean => {
      if (isReadOnly) return false;
      if (item.status === 'cancelada') return false;
      if (isAdmin) return true;
      if (!Array.isArray(item.equipe) || item.equipe.length === 0) return false;
      return item.equipe.some(member => {
        const mId = String(member?.id || '').trim().toLowerCase();
        return Boolean(mId && userIdentityTokens.has(mId));
      });
    },
    [isAdmin, isReadOnly, userIdentityTokens]
  );

  const applyCreateDraft = useCallback(
    (draft: SolicitacaoCreatePreFillDraft) => {
      if (isReadOnly || !canCreateSolicitacaoVistoriaRole(userRole)) return;
      const pre = draft?.dados_pre_preenchidos || {};
      setCreateError(null);
      setCreateRelato('');
      setCreateBarragemId(draft?.barragem_id || '');
      setCreateEmpreendedorId(draft?.empreendedor_id || '');
      setCreateProcessoRef(draft?.processo_referencia || '');
      setCreateOrigemRefId('');
      setCreateMotivo('');
      setCreateNomeBarragem(pre.nome_barragem || '');
      setCreateMunicipio(pre.municipio || '');
      setCreateCursoAgua(pre.curso_agua || '');
      setCreateCoordenadas(pre.coordenadas || '');
      setCreateUso(pre.uso || '');
      setCreateClassificacao(pre.classificacao || '');
      setCreateNomeEmp(pre.nome_empreendedor || '');
      setShowCreateModal(true);
    },
    [isReadOnly, userRole]
  );

  useEffect(() => {
    if (!initialCreateDraft) return;
    applyCreateDraft(initialCreateDraft);
    onConsumeInitialDraft?.();
  }, [applyCreateDraft, initialCreateDraft, onConsumeInitialDraft]);

  const handleOpenCreateModal = () => {
    if (isReadOnly) return;
    setCreateError(null);
    setCreateRelato('');
    setCreateBarragemId('');
    setCreateEmpreendedorId('');
    setCreateProcessoRef('');
    setCreateOrigemRefId('');
    setCreateMotivo('');
    setCreateNomeBarragem('');
    setCreateMunicipio('');
    setCreateCursoAgua('');
    setCreateCoordenadas('');
    setCreateUso('');
    setCreateClassificacao('');
    setCreateNomeEmp('');
    setShowCreateModal(true);
  };

  const handleBarragemSelectChange = (barragemId: string) => {
    setCreateBarragemId(barragemId);
    const bar = barragemMap.get(barragemId);
    if (!bar) {
      setCreateEmpreendedorId('');
      setCreateProcessoRef('');
      setCreateNomeBarragem('');
      setCreateMunicipio('');
      setCreateCursoAgua('');
      setCreateCoordenadas('');
      setCreateUso('');
      setCreateClassificacao('');
      setCreateNomeEmp('');
      return;
    }
    const draft = buildBarragemSolicitacaoDraft(bar, empreendedores);
    const pre = draft.dados_pre_preenchidos || {};
    setCreateEmpreendedorId(draft.empreendedor_id || '');
    setCreateProcessoRef(draft.processo_referencia || '');
    setCreateNomeBarragem(pre.nome_barragem || '');
    setCreateMunicipio(pre.municipio || '');
    setCreateCursoAgua(pre.curso_agua || '');
    setCreateCoordenadas(pre.coordenadas || '');
    setCreateUso(pre.uso || '');
    setCreateClassificacao(pre.classificacao || '');
    setCreateNomeEmp(pre.nome_empreendedor || '');
  };

  const handleEmpreendedorSelectChange = (empId: string) => {
    setCreateEmpreendedorId(empId);
    const emp = empreendedorMap.get(empId);
    if (!emp) {
      setCreateNomeEmp('');
      return;
    }
    const rawName = String(emp.nome || emp.nomeFantasia || '').trim();
    setCreateNomeEmp(rawName && !containsCpfOrCnpjFrontend(rawName) ? rawName : '');
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setCreateError(null);

    const relato = createRelato.trim();
    if (relato.length < 3 || relato.length > 1000) {
      setCreateError('O relato deve ter entre 3 e 1000 caracteres.');
      return;
    }

    const camposTexto = [
      relato,
      createProcessoRef,
      createOrigemRefId,
      createMotivo,
      createNomeBarragem,
      createMunicipio,
      createCursoAgua,
      createCoordenadas,
      createUso,
      createClassificacao,
      createNomeEmp
    ];
    if (camposTexto.some(v => containsCpfOrCnpjFrontend(v))) {
      setCreateError(
        'Não é permitido informar CPF/CNPJ nos campos da solicitação. Utilize apenas os IDs cadastrais.'
      );
      return;
    }

    const dadosPre: DadosPrePreenchidos = {};
    if (createNomeBarragem.trim()) dadosPre.nome_barragem = createNomeBarragem.trim();
    if (createMunicipio.trim()) dadosPre.municipio = createMunicipio.trim();
    if (createCursoAgua.trim()) dadosPre.curso_agua = createCursoAgua.trim();
    if (createCoordenadas.trim()) dadosPre.coordenadas = createCoordenadas.trim();
    if (createUso.trim()) dadosPre.uso = createUso.trim();
    if (createClassificacao.trim()) dadosPre.classificacao = createClassificacao.trim();
    if (createNomeEmp.trim()) dadosPre.nome_empreendedor = createNomeEmp.trim();

    setCreateSubmitting(true);
    const res = await criarSolicitacaoVistoria({
      relato,
      barragem_id: createBarragemId || undefined,
      empreendedor_id: createEmpreendedorId || undefined,
      processo_referencia: createProcessoRef.trim() || undefined,
      origem_ref_id: createOrigemRefId.trim() || undefined,
      motivo: createMotivo.trim() || undefined,
      dados_pre_preenchidos: Object.keys(dadosPre).length > 0 ? dadosPre : undefined
    });
    setCreateSubmitting(false);

    if (!res.success) {
      setCreateError(res.error || 'Falha ao registrar solicitação de vistoria.');
      return;
    }

    setShowCreateModal(false);
    onNotify('Solicitação de vistoria registrada.');
    await loadSolicitacoes();
  };

  const openDetailModal = async (
    item: SolicitacaoVistoriaRecord,
    mode: ModalActionMode = 'historico'
  ) => {
    setSelectedItem(item);
    setModalMode(mode);
    setDetailLoading(true);
    setDetailError(null);
    setActionError(null);
    setEditRelato(item.relato || '');
    setEditStatus(item.status === 'em_planejamento' ? 'em_planejamento' : 'solicitada');
    setEditBarragemId(item.barragem_id || '');
    setEditEmpreendedorId(item.empreendedor_id || '');
    setEditProcessoRef(item.processo_referencia || '');
    setEditOrigemRefId(item.origem_ref_id || '');
    setEditMotivo('');
    setCancelMotivo('');
    setObsTexto(item.observacao_campo || '');
    setHistorico([]);

    const detail = await obterDetalheSolicitacaoVistoria(item.id);
    if (!detail.success) {
      setDetailError(detail.error || 'Erro ao carregar detalhes e histórico.');
      setDetailLoading(false);
      return;
    }

    if (detail.solicitacao) {
      setSelectedItem(detail.solicitacao);
      setEditRelato(detail.solicitacao.relato || '');
      setObsTexto(detail.solicitacao.observacao_campo || '');
    }
    setHistorico(detail.historico || []);
    if (detail.usuariosNomes) {
      setUsuariosNomes(prev => ({ ...prev, ...detail.usuariosNomes }));
    }
    setDetailLoading(false);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !canEditOrCancel(selectedItem)) return;
    setActionError(null);

    const relato = editRelato.trim();
    if (relato.length < 3 || relato.length > 1000) {
      setActionError('O relato deve ter entre 3 e 1000 caracteres.');
      return;
    }

    if (
      [relato, editProcessoRef, editOrigemRefId, editMotivo].some(v =>
        containsCpfOrCnpjFrontend(v)
      )
    ) {
      setActionError('Não é permitido gravar CPF/CNPJ. Utilize apenas referências por ID.');
      return;
    }

    setActionSubmitting(true);
    const res = await editarSolicitacaoVistoria(selectedItem.id, {
      relato,
      status: editStatus,
      barragem_id: editBarragemId || null,
      empreendedor_id: editEmpreendedorId || null,
      processo_referencia: editProcessoRef.trim() || null,
      origem_ref_id: editOrigemRefId.trim() || null,
      motivo: editMotivo.trim() || undefined
    });
    setActionSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Falha ao salvar alterações.');
      return;
    }

    onNotify('Solicitação de vistoria atualizada.');
    await loadSolicitacoes();
    await openDetailModal(res.solicitacao || selectedItem, 'historico');
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !canEditOrCancel(selectedItem)) return;
    setActionError(null);

    const motivo = cancelMotivo.trim();
    if (motivo.length < 3) {
      setActionError('Informe o motivo do cancelamento (mínimo 3 caracteres).');
      return;
    }
    if (containsCpfOrCnpjFrontend(motivo)) {
      setActionError('Não é permitido gravar CPF/CNPJ no motivo.');
      return;
    }

    setActionSubmitting(true);
    const res = await cancelarSolicitacaoVistoria(selectedItem.id, motivo);
    setActionSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Falha ao cancelar solicitação.');
      return;
    }

    onNotify('Solicitação de vistoria cancelada.');
    await loadSolicitacoes();
    await openDetailModal(res.solicitacao || selectedItem, 'historico');
  };

  const handleObservacaoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !canEditObservacao(selectedItem)) return;
    setActionError(null);

    const texto = obsTexto.trim();
    if (!texto || texto.length > 1000) {
      setActionError('A observação de campo deve ter entre 1 e 1000 caracteres.');
      return;
    }
    if (containsCpfOrCnpjFrontend(texto)) {
      setActionError('Não é permitido gravar CPF/CNPJ na observação de campo.');
      return;
    }

    setActionSubmitting(true);
    const res = await editarObservacaoCampoSolicitacao(selectedItem.id, texto);
    setActionSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Falha ao atualizar observação de campo.');
      return;
    }

    onNotify('Observação de campo atualizada.');
    await loadSolicitacoes();
    await openDetailModal(res.solicitacao || selectedItem, 'historico');
  };

  const filteredSolicitacoes = useMemo(() => {
    const lista = Array.isArray(solicitacoes) ? solicitacoes : [];
    const q = normalizeSearch(searchTerm);
    if (!q) return lista;
    return lista.filter(item => {
      const barragem = item?.barragem_id ? barragemMap.get(String(item.barragem_id)) : undefined;
      const emp = item?.empreendedor_id ? empreendedorMap.get(String(item.empreendedor_id)) : undefined;
      const equipeStr = Array.isArray(item?.equipe)
        ? item.equipe.map(m => String(m?.nome || '')).join(' ')
        : '';
      const haystack = normalizeSearch(
        `${item?.sistema_origem || ''} ${item?.solicitante_nome || ''} ${item?.solicitante_perfil || ''} ${item?.relato || ''} ${item?.processo_referencia || ''} ${item?.observacao_campo || ''} ${item?.vistoria_id || ''} ${equipeStr} ${barragem?.nome || ''} ${emp?.nome || ''}`
      );
      return haystack.includes(q);
    });
  }, [barragemMap, empreendedorMap, searchTerm, solicitacoes]);

  const { pagedItems } = useMemo(
    () => paginateList(filteredSolicitacoes, page, pageSize),
    [filteredSolicitacoes, page, pageSize]
  );

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Gestão de trabalho · Programação e campo</div>
          <h2>Solicitações de Vistoria</h2>
          <p>
            Registro central de solicitações de vistoria, acompanhamento de realização, equipe designada e observações de campo.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn light" onClick={loadSolicitacoes} disabled={loading}>
            ↻ Atualizar
          </button>
          {!isReadOnly && (
            <button type="button" className="btn green" onClick={handleOpenCreateModal}>
              ＋ Nova solicitação
            </button>
          )}
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div>
            <div className="label">Total</div>
            <div className="value">{counts.total}</div>
          </div>
          <div className="stat-ico">▤</div>
        </div>
        <div className="stat">
          <div>
            <div className="label">Solicitadas</div>
            <div className="value">{counts.solicitada}</div>
          </div>
          <div className="stat-ico">⚑</div>
        </div>
        <div className="stat">
          <div>
            <div className="label">Em planejamento</div>
            <div className="value">{counts.em_planejamento}</div>
          </div>
          <div className="stat-ico">◷</div>
        </div>
        <div className="stat">
          <div>
            <div className="label">Realizadas</div>
            <div className="value">{counts.realizada}</div>
          </div>
          <div className="stat-ico">✓</div>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <div className="field-search">
            <span>⌕</span>
            <input
              className="input"
              placeholder="Buscar por relato, solicitante, equipe, processo, barragem ou observação..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <select
            className="select filter"
            aria-label="Filtrar por status"
            value={statusFiltro}
            onChange={e => setStatusFiltro(e.target.value)}
          >
            <option value="todos">Todos os status</option>
            {SOLICITACAO_STATUS_LIST.map(st => (
              <option key={st} value={st}>
                {SOLICITACAO_STATUS_LABELS[st]}
              </option>
            ))}
          </select>
          <select
            className="select filter"
            aria-label="Filtrar por sistema de origem"
            value={origemFiltro}
            onChange={e => setOrigemFiltro(e.target.value)}
          >
            <option value="todos">Todas as origens</option>
            {SOLICITACAO_ORIGENS.map(orig => (
              <option key={orig} value={orig}>
                {SOLICITACAO_ORIGEM_LABELS[orig]}
              </option>
            ))}
          </select>
        </div>

        {loading && (
          <div className="panel-body">
            <div className="notice slate">Carregando solicitações de vistoria...</div>
          </div>
        )}

        {!loading && error && (
          <div className="panel-body">
            <div
              className="notice amber"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap'
              }}
            >
              <div>
                <strong>Não foi possível carregar as solicitações:</strong> {error}
              </div>
              <button type="button" className="btn light small" onClick={loadSolicitacoes}>
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
                    <th>Sistema de origem</th>
                    <th>Quem enviou</th>
                    <th>Relato</th>
                    <th>Status</th>
                    <th>Data e equipe da realização</th>
                    <th>Observações de campo</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedItems.length > 0 ? (
                    pagedItems.map((item, idx) => {
                      const barragem = item?.barragem_id
                        ? barragemMap.get(String(item.barragem_id))
                        : undefined;
                      const empreendedor = item?.empreendedor_id
                        ? empreendedorMap.get(String(item.empreendedor_id))
                        : undefined;
                      const stBadge = SOLICITACAO_STATUS_BADGES[item.status] || 'gray';
                      const stLabel = SOLICITACAO_STATUS_LABELS[item.status] || item.status || 'Solicitada';
                      const relatoTexto = String(item?.relato || '');
                      const obsCampoTexto = String(item?.observacao_campo || '');
                      const equipeLista = Array.isArray(item?.equipe) ? item.equipe : [];
                      const allowEdit = canEditOrCancel(item);
                      const allowObs = canEditObservacao(item);

                      return (
                        <tr key={item.id || idx} className={idx % 2 === 0 ? 'row-even' : 'row-odd'}>
                          <td>
                            <div className="td-main">{item.sistema_origem || 'administra'}</div>
                            {item.origem_ref_id && (
                              <span className="td-sub">Ref.: {item.origem_ref_id}</span>
                            )}
                            {item.processo_referencia && (
                              <span className="td-sub">Proc.: {item.processo_referencia}</span>
                            )}
                          </td>
                          <td>
                            <div className="td-main">
                              {resolveUserName(item.solicitante_id, item.solicitante_nome)}
                            </div>
                            <span className="td-sub">
                              {item.solicitante_perfil || '—'} · {formatDateTimePtBr(item.created_at)}
                            </span>
                          </td>
                          <td>
                            <div>
                              {relatoTexto.length > 140
                                ? `${relatoTexto.slice(0, 140)}...`
                                : relatoTexto || '—'}
                            </div>
                            {(barragem || item.dados_pre_preenchidos?.nome_barragem) && (
                              <span className="td-sub">
                                Barragem:{' '}
                                {barragem?.nome || item.dados_pre_preenchidos?.nome_barragem}
                              </span>
                            )}
                            {(empreendedor || item.dados_pre_preenchidos?.nome_empreendedor) && (
                              <span className="td-sub">
                                Empreendedor:{' '}
                                {empreendedor?.nome || item.dados_pre_preenchidos?.nome_empreendedor}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${stBadge}`}>{stLabel}</span>
                          </td>
                          <td>
                            {item.data_realizacao ? (
                              <div>{formatDateTimePtBr(item.data_realizacao)}</div>
                            ) : (
                              <span className="muted">Não realizada</span>
                            )}
                            {equipeLista.length > 0 && (
                              <span className="td-sub">
                                Equipe:{' '}
                                {equipeLista
                                  .map(m => String(m?.nome || ''))
                                  .filter(Boolean)
                                  .join(', ')}
                              </span>
                            )}
                            {item.vistoria_id && (
                              <span className="td-sub">Registro: {item.vistoria_id}</span>
                            )}
                          </td>
                          <td>
                            {obsCampoTexto ? (
                              <>
                                <div>
                                  {obsCampoTexto.length > 120
                                    ? `${obsCampoTexto.slice(0, 120)}...`
                                    : obsCampoTexto}
                                </div>
                                {item.observacao_atualizada_em && (
                                  <span className="td-sub">
                                    Atualizada em {formatDateTimePtBr(item.observacao_atualizada_em)}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="iconbtn"
                                onClick={() => openDetailModal(item, 'historico')}
                              >
                                Detalhes
                              </button>
                              {allowEdit && (
                                <button
                                  type="button"
                                  className="iconbtn"
                                  onClick={() => openDetailModal(item, 'editar')}
                                >
                                  Editar
                                </button>
                              )}
                              {allowEdit && (
                                <button
                                  type="button"
                                  className="iconbtn"
                                  onClick={() => openDetailModal(item, 'cancelar')}
                                >
                                  Cancelar
                                </button>
                              )}
                              {allowObs && (
                                <button
                                  type="button"
                                  className="iconbtn"
                                  onClick={() => openDetailModal(item, 'observacao')}
                                >
                                  Obs. campo
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
                          <div className="empty-icon">▤</div>
                          <b>Nenhuma solicitação de vistoria encontrada</b>
                          <p>
                            Não há solicitações registradas para os filtros aplicados no momento.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <PaginationBar
              totalItems={filteredSolicitacoes.length}
              currentPage={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </div>

      {/* MODAL NOVA SOLICITAÇÃO */}
      {showCreateModal && !isReadOnly && (
        <div
          className="modal-back"
          onClick={e => {
            if (e.target === e.currentTarget && !createSubmitting) setShowCreateModal(false);
          }}
        >
          <form className="modal" style={{ width: 'min(740px, 100%)' }} onSubmit={handleCreateSubmit}>
            <div className="modal-head">
              <h3>Nova solicitação de vistoria</h3>
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
                A autoria e a origem da solicitação são atribuídas automaticamente pela sessão autenticada. Não informe CPF/CNPJ em nenhum campo.
              </div>

              <div className="form-grid">
                <div className="form-field full">
                  <label>Relato / Justificativa da vistoria * ({createRelato.length}/1000)</label>
                  <textarea
                    className="textarea"
                    required
                    minLength={3}
                    maxLength={1000}
                    placeholder="Descreva o motivo técnico, anomalias observadas ou necessidade de vistoria..."
                    value={createRelato}
                    onChange={e => setCreateRelato(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Barragem cadastrada</label>
                  <select
                    className="select"
                    value={createBarragemId}
                    onChange={e => handleBarragemSelectChange(e.target.value)}
                  >
                    <option value="">Sem vínculo direto</option>
                    {(barragens || []).map(b => (
                      <option key={b.id} value={b.id}>
                        {b.nome || b.id}
                        {b.municipio ? ` · ${b.municipio}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label>Empreendedor cadastrado</label>
                  <select
                    className="select"
                    value={createEmpreendedorId}
                    onChange={e => handleEmpreendedorSelectChange(e.target.value)}
                  >
                    <option value="">Sem vínculo direto</option>
                    {(empreendedores || []).map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.nome || emp.nomeFantasia || emp.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label>Processo de referência</label>
                  <input
                    className="input"
                    maxLength={120}
                    placeholder="Ex.: PROC-2026/0012"
                    value={createProcessoRef}
                    onChange={e => setCreateProcessoRef(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Referência na origem</label>
                  <input
                    className="input"
                    maxLength={120}
                    placeholder="Identificador de referência (opcional)"
                    value={createOrigemRefId}
                    onChange={e => setCreateOrigemRefId(e.target.value)}
                  />
                </div>

                <div className="form-field full">
                  <label>Dados técnicos pré-preenchidos (opcionais, sem documento pessoal)</label>
                </div>

                <div className="form-field">
                  <label>Nome da barragem</label>
                  <input
                    className="input"
                    maxLength={200}
                    value={createNomeBarragem}
                    onChange={e => setCreateNomeBarragem(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Município</label>
                  <input
                    className="input"
                    maxLength={150}
                    value={createMunicipio}
                    onChange={e => setCreateMunicipio(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Curso d’água</label>
                  <input
                    className="input"
                    maxLength={150}
                    value={createCursoAgua}
                    onChange={e => setCreateCursoAgua(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Coordenadas</label>
                  <input
                    className="input"
                    maxLength={120}
                    placeholder="Ex.: -15.6014, -56.0979"
                    value={createCoordenadas}
                    onChange={e => setCreateCoordenadas(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Uso principal</label>
                  <input
                    className="input"
                    maxLength={150}
                    value={createUso}
                    onChange={e => setCreateUso(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Classificação</label>
                  <input
                    className="input"
                    maxLength={150}
                    value={createClassificacao}
                    onChange={e => setCreateClassificacao(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Nome do empreendedor</label>
                  <input
                    className="input"
                    maxLength={200}
                    value={createNomeEmp}
                    onChange={e => setCreateNomeEmp(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Observação inicial (histórico)</label>
                  <input
                    className="input"
                    maxLength={500}
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
                {createSubmitting ? 'Enviando...' : 'Registrar solicitação'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL DETALHES, AÇÕES E HISTÓRICO */}
      {selectedItem && (
        <div
          className="modal-back"
          onClick={e => {
            if (e.target === e.currentTarget && !actionSubmitting) setSelectedItem(null);
          }}
        >
          <div className="modal" style={{ width: 'min(820px, 100%)' }}>
            <div className="modal-head">
              <div>
                <h3>Solicitação de Vistoria</h3>
                <span className="micro muted">
                  ID: {selectedItem.id} · Origem: {selectedItem.sistema_origem}
                </span>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => !actionSubmitting && setSelectedItem(null)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {detailLoading && (
                <div className="notice slate" style={{ marginBottom: '12px' }}>
                  Carregando detalhes e histórico...
                </div>
              )}
              {detailError && (
                <div className="notice amber" style={{ marginBottom: '12px' }}>
                  {detailError}
                </div>
              )}

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
                  <span className="muted">Status atual:</span>
                  <div>
                    <span
                      className={`badge ${SOLICITACAO_STATUS_BADGES[selectedItem.status] || 'gray'}`}
                    >
                      {SOLICITACAO_STATUS_LABELS[selectedItem.status] || selectedItem.status}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="muted">Quem enviou:</span>
                  <div>
                    <b>{resolveUserName(selectedItem.solicitante_id, selectedItem.solicitante_nome)}</b>
                    <div className="micro muted">
                      {selectedItem.solicitante_perfil || '—'} ·{' '}
                      {formatDateTimePtBr(selectedItem.created_at)}
                    </div>
                  </div>
                </div>
                <div>
                  <span className="muted">Data de realização:</span>
                  <div>
                    <b>{formatDateTimePtBr(selectedItem.data_realizacao)}</b>
                    {selectedItem.vistoria_id && (
                      <div className="micro muted">Registro: {selectedItem.vistoria_id}</div>
                    )}
                  </div>
                </div>
                <div>
                  <span className="muted">Equipe designada:</span>
                  <div>
                    <b>
                      {Array.isArray(selectedItem.equipe) && selectedItem.equipe.length > 0
                        ? selectedItem.equipe.map(m => m.nome).join(', ')
                        : 'Não atribuída'}
                    </b>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: '12px', fontSize: '12px', color: '#334155' }}>
                <b>Relato:</b> {selectedItem.relato}
              </div>

              {selectedItem.observacao_campo && (
                <div className="notice slate" style={{ marginBottom: '12px' }}>
                  <b>Observação de campo:</b> {selectedItem.observacao_campo}
                  {selectedItem.observacao_atualizada_em && (
                    <div className="micro muted" style={{ marginTop: '4px' }}>
                      Atualizada em {formatDateTimePtBr(selectedItem.observacao_atualizada_em)}
                    </div>
                  )}
                </div>
              )}

              {selectedItem.dados_pre_preenchidos && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    marginBottom: '14px',
                    fontSize: '11px'
                  }}
                >
                  <b>Dados técnicos pré-preenchidos:</b>
                  <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                    {selectedItem.dados_pre_preenchidos.nome_barragem && (
                      <span>
                        <b>Barragem:</b> {selectedItem.dados_pre_preenchidos.nome_barragem}
                      </span>
                    )}
                    {selectedItem.dados_pre_preenchidos.municipio && (
                      <span>
                        <b>Município:</b> {selectedItem.dados_pre_preenchidos.municipio}
                      </span>
                    )}
                    {selectedItem.dados_pre_preenchidos.curso_agua && (
                      <span>
                        <b>Curso d’água:</b> {selectedItem.dados_pre_preenchidos.curso_agua}
                      </span>
                    )}
                    {selectedItem.dados_pre_preenchidos.coordenadas && (
                      <span>
                        <b>Coordenadas:</b> {selectedItem.dados_pre_preenchidos.coordenadas}
                      </span>
                    )}
                    {selectedItem.dados_pre_preenchidos.uso && (
                      <span>
                        <b>Uso:</b> {selectedItem.dados_pre_preenchidos.uso}
                      </span>
                    )}
                    {selectedItem.dados_pre_preenchidos.classificacao && (
                      <span>
                        <b>Classificação:</b> {selectedItem.dados_pre_preenchidos.classificacao}
                      </span>
                    )}
                    {selectedItem.dados_pre_preenchidos.nome_empreendedor && (
                      <span>
                        <b>Empreendedor:</b>{' '}
                        {selectedItem.dados_pre_preenchidos.nome_empreendedor}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {!isReadOnly && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
                  <button
                    type="button"
                    className={`btn ${modalMode === 'historico' ? 'soft' : 'light'} small`}
                    onClick={() => {
                      setModalMode('historico');
                      setActionError(null);
                    }}
                  >
                    Histórico ({historico.length})
                  </button>
                  {canEditOrCancel(selectedItem) && (
                    <>
                      <button
                        type="button"
                        className={`btn ${modalMode === 'editar' ? 'soft' : 'light'} small`}
                        onClick={() => {
                          setModalMode('editar');
                          setActionError(null);
                        }}
                      >
                        Editar solicitação
                      </button>
                      <button
                        type="button"
                        className={`btn ${modalMode === 'cancelar' ? 'soft' : 'light'} small`}
                        onClick={() => {
                          setModalMode('cancelar');
                          setActionError(null);
                        }}
                      >
                        Cancelar solicitação
                      </button>
                    </>
                  )}
                  {canEditObservacao(selectedItem) && (
                    <button
                      type="button"
                      className={`btn ${modalMode === 'observacao' ? 'green' : 'light'} small`}
                      onClick={() => {
                        setModalMode('observacao');
                        setActionError(null);
                      }}
                    >
                      Editar observação de campo
                    </button>
                  )}
                </div>
              )}

              {actionError && (
                <div className="notice amber" style={{ marginBottom: '12px' }}>
                  {actionError}
                </div>
              )}

              {/* FORM EDITAR */}
              {modalMode === 'editar' && canEditOrCancel(selectedItem) && (
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
                    <div className="form-field full">
                      <label>Relato * ({editRelato.length}/1000)</label>
                      <textarea
                        className="textarea"
                        required
                        minLength={3}
                        maxLength={1000}
                        value={editRelato}
                        onChange={e => setEditRelato(e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label>Status</label>
                      <select
                        className="select"
                        value={editStatus}
                        onChange={e =>
                          setEditStatus(
                            e.target.value === 'em_planejamento' ? 'em_planejamento' : 'solicitada'
                          )
                        }
                      >
                        <option value="solicitada">Solicitada</option>
                        <option value="em_planejamento">Em planejamento</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Processo de referência</label>
                      <input
                        className="input"
                        maxLength={120}
                        value={editProcessoRef}
                        onChange={e => setEditProcessoRef(e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label>Barragem cadastrada</label>
                      <select
                        className="select"
                        value={editBarragemId}
                        onChange={e => setEditBarragemId(e.target.value)}
                      >
                        <option value="">Sem vínculo direto</option>
                        {(barragens || []).map(b => (
                          <option key={b.id} value={b.id}>
                            {b.nome || b.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Empreendedor cadastrado</label>
                      <select
                        className="select"
                        value={editEmpreendedorId}
                        onChange={e => setEditEmpreendedorId(e.target.value)}
                      >
                        <option value="">Sem vínculo direto</option>
                        {(empreendedores || []).map(emp => (
                          <option key={emp.id} value={emp.id}>
                            {emp.nome || emp.nomeFantasia || emp.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Referência na origem</label>
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
                        value={editMotivo}
                        onChange={e => setEditMotivo(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn light small"
                      onClick={() => setModalMode('historico')}
                    >
                      Cancelar
                    </button>
                    <button type="submit" className="btn green small" disabled={actionSubmitting}>
                      {actionSubmitting ? 'Salvando...' : 'Salvar alterações'}
                    </button>
                  </div>
                </form>
              )}

              {/* FORM CANCELAR */}
              {modalMode === 'cancelar' && canEditOrCancel(selectedItem) && (
                <form
                  onSubmit={handleCancelSubmit}
                  style={{
                    padding: '14px',
                    border: '1px solid #fecdd3',
                    background: '#fff1f2',
                    borderRadius: '10px',
                    marginBottom: '16px'
                  }}
                >
                  <div className="form-grid">
                    <div className="form-field full">
                      <label>Motivo do cancelamento *</label>
                      <textarea
                        className="textarea"
                        required
                        minLength={3}
                        maxLength={500}
                        placeholder="Justifique o cancelamento desta solicitação (sem CPF/CNPJ)..."
                        value={cancelMotivo}
                        onChange={e => setCancelMotivo(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn light small"
                      onClick={() => setModalMode('historico')}
                    >
                      Voltar
                    </button>
                    <button type="submit" className="btn green small" disabled={actionSubmitting}>
                      {actionSubmitting ? 'Cancelando...' : 'Confirmar cancelamento'}
                    </button>
                  </div>
                </form>
              )}

              {/* FORM OBSERVAÇÃO DE CAMPO */}
              {modalMode === 'observacao' && canEditObservacao(selectedItem) && (
                <form
                  onSubmit={handleObservacaoSubmit}
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
                      <label>Observação de campo * ({obsTexto.length}/1000)</label>
                      <textarea
                        className="textarea"
                        required
                        minLength={1}
                        maxLength={1000}
                        placeholder="Registre observações coletadas pela equipe em campo (sem CPF/CNPJ)..."
                        value={obsTexto}
                        onChange={e => setObsTexto(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn light small"
                      onClick={() => setModalMode('historico')}
                    >
                      Cancelar
                    </button>
                    <button type="submit" className="btn green small" disabled={actionSubmitting}>
                      {actionSubmitting ? 'Salvando...' : 'Salvar observação'}
                    </button>
                  </div>
                </form>
              )}

              <div className="section-title" style={{ marginTop: '6px' }}>
                Histórico de alterações (somente leitura)
              </div>

              {!detailLoading && historico.length === 0 ? (
                <div className="notice slate">
                  Nenhum registro encontrado no histórico desta solicitação.
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
                              {SOLICITACAO_HISTORICO_ACAO_LABELS[h.acao] || h.acao}
                            </span>
                          </td>
                          <td>{(h.campo && SOLICITACAO_CAMPO_LABELS[h.campo]) || h.campo || '—'}</td>
                          <td>
                            <span>{h.valor_anterior || '—'}</span>
                            {' → '}
                            <b>{h.valor_novo || '—'}</b>
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
                onClick={() => setSelectedItem(null)}
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

export const SolicitacoesVistoriaView: React.FC<SolicitacoesVistoriaViewProps> = props => (
  <SolicitacoesVistoriaErrorBoundary>
    <SolicitacoesVistoriaContent {...props} />
  </SolicitacoesVistoriaErrorBoundary>
);
