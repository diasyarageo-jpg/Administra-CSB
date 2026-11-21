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
  extractSafeErrorMessage,
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

function scrubDiagnosticText(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : '';
  return text
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [oculto]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[token oculto]')
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, '[segredo oculto]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf oculto]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj oculto]');
}

function toSafeString(val: unknown, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : fallback;
  if (typeof val === 'boolean') return String(val);
  return fallback;
}

function toSafeNumber(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function hasOwn(obj: unknown, key: string): boolean {
  return Boolean(obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key));
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

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Registro exclusivo para diagnóstico no console do navegador (sem exibir na interface).
    console.error('[SolicitacoesVistoriaErrorBoundary]', {
      name: toSafeString(error?.name, 'Error'),
      message: scrubDiagnosticText(error?.message || 'Erro de renderização desconhecido'),
      componentStack: scrubDiagnosticText(info?.componentStack || '')
    });
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

function formatDateTimePtBr(raw?: unknown): string {
  const text = toSafeString(raw).trim();
  if (!text) return '—';
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return text;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function normalizeSearch(val: unknown): string {
  return toSafeString(val)
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
    initialLoading !== undefined ? Boolean(initialLoading) : !hasInitialStateOverride
  );
  const [error, setError] = useState<string | null>(() =>
    initialError !== undefined && initialError !== null
      ? extractSafeErrorMessage(initialError, 'Não foi possível carregar as solicitações de vistoria.')
      : null
  );
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoVistoriaRecord[]>(() =>
    Array.isArray(initialSolicitacoes)
      ? initialSolicitacoes.filter(
          (item): item is SolicitacaoVistoriaRecord =>
            Boolean(item && typeof item === 'object' && !Array.isArray(item))
        )
      : []
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
  const initialPre =
    canPreFillFromShortcut &&
    initialCreateDraft &&
    typeof initialCreateDraft === 'object' &&
    initialCreateDraft.dados_pre_preenchidos &&
    typeof initialCreateDraft.dados_pre_preenchidos === 'object'
      ? initialCreateDraft.dados_pre_preenchidos
      : undefined;

  // Modal Nova Solicitação
  const [showCreateModal, setShowCreateModal] = useState<boolean>(
    Boolean(initialCreateDraft && canPreFillFromShortcut)
  );
  const [createSubmitting, setCreateSubmitting] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createRelato, setCreateRelato] = useState<string>('');
  const [createBarragemId, setCreateBarragemId] = useState<string>(
    canPreFillFromShortcut ? toSafeString(initialCreateDraft?.barragem_id) : ''
  );
  const [createEmpreendedorId, setCreateEmpreendedorId] = useState<string>(
    canPreFillFromShortcut ? toSafeString(initialCreateDraft?.empreendedor_id) : ''
  );
  const [createProcessoRef, setCreateProcessoRef] = useState<string>(
    canPreFillFromShortcut ? toSafeString(initialCreateDraft?.processo_referencia) : ''
  );
  const [createOrigemRefId, setCreateOrigemRefId] = useState<string>('');
  const [createMotivo, setCreateMotivo] = useState<string>('');
  const [createNomeBarragem, setCreateNomeBarragem] = useState<string>(
    toSafeString(initialPre?.nome_barragem)
  );
  const [createMunicipio, setCreateMunicipio] = useState<string>(
    toSafeString(initialPre?.municipio)
  );
  const [createCursoAgua, setCreateCursoAgua] = useState<string>(
    toSafeString(initialPre?.curso_agua)
  );
  const [createCoordenadas, setCreateCoordenadas] = useState<string>(
    toSafeString(initialPre?.coordenadas)
  );
  const [createUso, setCreateUso] = useState<string>(toSafeString(initialPre?.uso));
  const [createClassificacao, setCreateClassificacao] = useState<string>(
    toSafeString(initialPre?.classificacao)
  );
  const [createNomeEmp, setCreateNomeEmp] = useState<string>(
    toSafeString(initialPre?.nome_empreendedor)
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

  const safeBarragens = useMemo(
    () =>
      Array.isArray(barragens)
        ? barragens.filter(
            (b): b is BarragemRecord => Boolean(b && typeof b === 'object' && !Array.isArray(b))
          )
        : [],
    [barragens]
  );

  const safeEmpreendedores = useMemo(
    () =>
      Array.isArray(empreendedores)
        ? empreendedores.filter(
            (e): e is EmpreendedorRecord =>
              Boolean(e && typeof e === 'object' && !Array.isArray(e))
          )
        : [],
    [empreendedores]
  );

  const barragemMap = useMemo(() => {
    const map = new Map<string, BarragemRecord>();
    for (const b of safeBarragens) {
      const bId = toSafeString(b?.id).trim();
      if (bId) map.set(bId, b);
    }
    return map;
  }, [safeBarragens]);

  const empreendedorMap = useMemo(() => {
    const map = new Map<string, EmpreendedorRecord>();
    for (const e of safeEmpreendedores) {
      const eId = toSafeString(e?.id).trim();
      if (eId) map.set(eId, e);
    }
    return map;
  }, [safeEmpreendedores]);

  const safeSolicitacoes = useMemo(
    () =>
      Array.isArray(solicitacoes)
        ? solicitacoes.filter(
            (item): item is SolicitacaoVistoriaRecord =>
              Boolean(item && typeof item === 'object' && !Array.isArray(item))
          )
        : [],
    [solicitacoes]
  );

  const safeHistorico = useMemo(
    () =>
      Array.isArray(historico)
        ? historico.filter(
            (h): h is SolicitacaoVistoriaHistoricoRecord =>
              Boolean(h && typeof h === 'object' && !Array.isArray(h))
          )
        : [],
    [historico]
  );

  const safeUsuariosNomes = useMemo(
    () =>
      usuariosNomes && typeof usuariosNomes === 'object' && !Array.isArray(usuariosNomes)
        ? usuariosNomes
        : {},
    [usuariosNomes]
  );

  const safeCounts = useMemo(
    () => ({
      total: toSafeNumber(counts?.total, 0),
      solicitada: toSafeNumber(counts?.solicitada, 0),
      em_planejamento: toSafeNumber(counts?.em_planejamento, 0),
      realizada: toSafeNumber(counts?.realizada, 0),
      cancelada: toSafeNumber(counts?.cancelada, 0)
    }),
    [counts]
  );

  const loadSolicitacoes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await listarSolicitacoesVistoria({
        status: statusFiltro,
        sistema_origem: origemFiltro
      });

      if (!res || !res.success) {
        setError(
          extractSafeErrorMessage(
            res?.error,
            'Não foi possível carregar as solicitações de vistoria.'
          )
        );
        setSolicitacoes([]);
        return;
      }

      setSolicitacoes(Array.isArray(res.solicitacoes) ? res.solicitacoes : []);
      setCounts(
        res.counts && typeof res.counts === 'object'
          ? {
              total: toSafeNumber(res.counts.total, 0),
              solicitada: toSafeNumber(res.counts.solicitada, 0),
              em_planejamento: toSafeNumber(res.counts.em_planejamento, 0),
              realizada: toSafeNumber(res.counts.realizada, 0),
              cancelada: toSafeNumber(res.counts.cancelada, 0)
            }
          : { total: 0, solicitada: 0, em_planejamento: 0, realizada: 0, cancelada: 0 }
      );
      setUsuariosNomes(
        res.usuariosNomes && typeof res.usuariosNomes === 'object' && !Array.isArray(res.usuariosNomes)
          ? res.usuariosNomes
          : {}
      );
      setServerUserId(toSafeString(res.currentUser?.userId).trim() || null);
      setServerUserEmail(toSafeString(res.currentUser?.email).trim() || null);
    } catch (err) {
      setError(
        extractSafeErrorMessage(err, 'Não foi possível carregar as solicitações de vistoria.')
      );
      setSolicitacoes([]);
    } finally {
      setLoading(false);
    }
  }, [origemFiltro, statusFiltro]);

  useEffect(() => {
    void loadSolicitacoes();
  }, [loadSolicitacoes]);

  const effectiveUserId = toSafeString(serverUserId || currentAuthUserId).trim() || null;

  const userIdentityTokens = useMemo(() => {
    const tokens = new Set<string>();
    for (const raw of [effectiveUserId, serverUserEmail, currentAuthEmail, currentAuthLogin]) {
      const val = toSafeString(raw).trim().toLowerCase();
      if (val) tokens.add(val);
    }
    return tokens;
  }, [currentAuthEmail, currentAuthLogin, effectiveUserId, serverUserEmail]);

  const resolveUserName = useCallback(
    (userId?: unknown, fallbackName?: unknown): string => {
      const cleanFallback = toSafeString(fallbackName).trim();
      if (cleanFallback) return cleanFallback;
      const cleanUserId = toSafeString(userId).trim();
      if (!cleanUserId) return '—';
      const info = hasOwn(safeUsuariosNomes, cleanUserId)
        ? safeUsuariosNomes[cleanUserId]
        : undefined;
      const infoNome = toSafeString(info?.nome).trim();
      const infoSetor = toSafeString(info?.setor).trim();
      if (infoNome) {
        return infoSetor ? `${infoNome} (${infoSetor})` : infoNome;
      }
      return cleanUserId;
    },
    [safeUsuariosNomes]
  );

  const canEditOrCancel = useCallback(
    (item: SolicitacaoVistoriaRecord | null | undefined): boolean => {
      if (isReadOnly || !item || typeof item !== 'object') return false;
      const status = toSafeString(item.status).trim().toLowerCase();
      if (status === 'realizada' || status === 'cancelada') return false;
      if (isAdmin) return true;
      const solicitanteId = toSafeString(item.solicitante_id).trim().toLowerCase();
      return Boolean(effectiveUserId && solicitanteId === effectiveUserId.toLowerCase());
    },
    [effectiveUserId, isAdmin, isReadOnly]
  );

  const canEditObservacao = useCallback(
    (item: SolicitacaoVistoriaRecord | null | undefined): boolean => {
      if (isReadOnly || !item || typeof item !== 'object') return false;
      const status = toSafeString(item.status).trim().toLowerCase();
      if (status === 'cancelada') return false;
      if (isAdmin) return true;
      if (!Array.isArray(item.equipe) || item.equipe.length === 0) return false;
      return item.equipe.some(member => {
        if (!member) return false;
        const mId =
          typeof member === 'string'
            ? toSafeString(member).trim().toLowerCase()
            : toSafeString((member as any).id).trim().toLowerCase();
        return Boolean(mId && userIdentityTokens.has(mId));
      });
    },
    [isAdmin, isReadOnly, userIdentityTokens]
  );

  const applyCreateDraft = useCallback(
    (draft: SolicitacaoCreatePreFillDraft) => {
      if (isReadOnly || !canCreateSolicitacaoVistoriaRole(userRole) || !draft || typeof draft !== 'object') {
        return;
      }
      const pre =
        draft.dados_pre_preenchidos && typeof draft.dados_pre_preenchidos === 'object'
          ? draft.dados_pre_preenchidos
          : {};
      setCreateError(null);
      setCreateRelato('');
      setCreateBarragemId(toSafeString(draft.barragem_id));
      setCreateEmpreendedorId(toSafeString(draft.empreendedor_id));
      setCreateProcessoRef(toSafeString(draft.processo_referencia));
      setCreateOrigemRefId('');
      setCreateMotivo('');
      setCreateNomeBarragem(toSafeString(pre.nome_barragem));
      setCreateMunicipio(toSafeString(pre.municipio));
      setCreateCursoAgua(toSafeString(pre.curso_agua));
      setCreateCoordenadas(toSafeString(pre.coordenadas));
      setCreateUso(toSafeString(pre.uso));
      setCreateClassificacao(toSafeString(pre.classificacao));
      setCreateNomeEmp(toSafeString(pre.nome_empreendedor));
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
    const draft = buildBarragemSolicitacaoDraft(bar, safeEmpreendedores);
    const pre = draft.dados_pre_preenchidos || {};
    setCreateEmpreendedorId(toSafeString(draft.empreendedor_id));
    setCreateProcessoRef(toSafeString(draft.processo_referencia));
    setCreateNomeBarragem(toSafeString(pre.nome_barragem));
    setCreateMunicipio(toSafeString(pre.municipio));
    setCreateCursoAgua(toSafeString(pre.curso_agua));
    setCreateCoordenadas(toSafeString(pre.coordenadas));
    setCreateUso(toSafeString(pre.uso));
    setCreateClassificacao(toSafeString(pre.classificacao));
    setCreateNomeEmp(toSafeString(pre.nome_empreendedor));
  };

  const handleEmpreendedorSelectChange = (empId: string) => {
    setCreateEmpreendedorId(empId);
    const emp = empreendedorMap.get(empId);
    if (!emp) {
      setCreateNomeEmp('');
      return;
    }
    const rawName = (toSafeString(emp.nome) || toSafeString(emp.nomeFantasia)).trim();
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
    try {
      const res = await criarSolicitacaoVistoria({
        relato,
        barragem_id: createBarragemId || undefined,
        empreendedor_id: createEmpreendedorId || undefined,
        processo_referencia: createProcessoRef.trim() || undefined,
        origem_ref_id: createOrigemRefId.trim() || undefined,
        motivo: createMotivo.trim() || undefined,
        dados_pre_preenchidos: Object.keys(dadosPre).length > 0 ? dadosPre : undefined
      });

      if (!res || !res.success) {
        setCreateError(
          extractSafeErrorMessage(res?.error, 'Falha ao registrar solicitação de vistoria.')
        );
        return;
      }

      setShowCreateModal(false);
      onNotify('Solicitação de vistoria registrada.');
      await loadSolicitacoes();
    } catch (err) {
      setCreateError(
        extractSafeErrorMessage(err, 'Falha ao registrar solicitação de vistoria.')
      );
    } finally {
      setCreateSubmitting(false);
    }
  };

  const openDetailModal = async (
    item: SolicitacaoVistoriaRecord,
    mode: ModalActionMode = 'historico'
  ) => {
    if (!item || typeof item !== 'object') return;
    setSelectedItem(item);
    setModalMode(mode);
    setDetailLoading(true);
    setDetailError(null);
    setActionError(null);
    setEditRelato(toSafeString(item.relato));
    setEditStatus(item.status === 'em_planejamento' ? 'em_planejamento' : 'solicitada');
    setEditBarragemId(toSafeString(item.barragem_id));
    setEditEmpreendedorId(toSafeString(item.empreendedor_id));
    setEditProcessoRef(toSafeString(item.processo_referencia));
    setEditOrigemRefId(toSafeString(item.origem_ref_id));
    setEditMotivo('');
    setCancelMotivo('');
    setObsTexto(toSafeString(item.observacao_campo));
    setHistorico([]);

    const itemId = toSafeString(item.id).trim();
    if (!itemId) {
      setDetailError('Solicitação sem identificador válido.');
      setDetailLoading(false);
      return;
    }

    try {
      const detail = await obterDetalheSolicitacaoVistoria(itemId);
      if (!detail || !detail.success) {
        setDetailError(
          extractSafeErrorMessage(detail?.error, 'Erro ao carregar detalhes e histórico.')
        );
        return;
      }

      if (detail.solicitacao && typeof detail.solicitacao === 'object') {
        setSelectedItem(detail.solicitacao);
        setEditRelato(toSafeString(detail.solicitacao.relato));
        setObsTexto(toSafeString(detail.solicitacao.observacao_campo));
      }
      setHistorico(Array.isArray(detail.historico) ? detail.historico : []);
      if (detail.usuariosNomes && typeof detail.usuariosNomes === 'object') {
        setUsuariosNomes(prev => ({
          ...(prev && typeof prev === 'object' ? prev : {}),
          ...detail.usuariosNomes
        }));
      }
    } catch (err) {
      setDetailError(extractSafeErrorMessage(err, 'Erro ao carregar detalhes e histórico.'));
    } finally {
      setDetailLoading(false);
    }
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
    try {
      const res = await editarSolicitacaoVistoria(toSafeString(selectedItem.id), {
        relato,
        status: editStatus,
        barragem_id: editBarragemId || null,
        empreendedor_id: editEmpreendedorId || null,
        processo_referencia: editProcessoRef.trim() || null,
        origem_ref_id: editOrigemRefId.trim() || null,
        motivo: editMotivo.trim() || undefined
      });

      if (!res || !res.success) {
        setActionError(extractSafeErrorMessage(res?.error, 'Falha ao salvar alterações.'));
        return;
      }

      onNotify('Solicitação de vistoria atualizada.');
      await loadSolicitacoes();
      await openDetailModal(res.solicitacao || selectedItem, 'historico');
    } catch (err) {
      setActionError(extractSafeErrorMessage(err, 'Falha ao salvar alterações.'));
    } finally {
      setActionSubmitting(false);
    }
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
    try {
      const res = await cancelarSolicitacaoVistoria(toSafeString(selectedItem.id), motivo);

      if (!res || !res.success) {
        setActionError(extractSafeErrorMessage(res?.error, 'Falha ao cancelar solicitação.'));
        return;
      }

      onNotify('Solicitação de vistoria cancelada.');
      await loadSolicitacoes();
      await openDetailModal(res.solicitacao || selectedItem, 'historico');
    } catch (err) {
      setActionError(extractSafeErrorMessage(err, 'Falha ao cancelar solicitação.'));
    } finally {
      setActionSubmitting(false);
    }
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
    try {
      const res = await editarObservacaoCampoSolicitacao(toSafeString(selectedItem.id), texto);

      if (!res || !res.success) {
        setActionError(
          extractSafeErrorMessage(res?.error, 'Falha ao atualizar observação de campo.')
        );
        return;
      }

      onNotify('Observação de campo atualizada.');
      await loadSolicitacoes();
      await openDetailModal(res.solicitacao || selectedItem, 'historico');
    } catch (err) {
      setActionError(
        extractSafeErrorMessage(err, 'Falha ao atualizar observação de campo.')
      );
    } finally {
      setActionSubmitting(false);
    }
  };

  const filteredSolicitacoes = useMemo(() => {
    const q = normalizeSearch(searchTerm);
    if (!q) return safeSolicitacoes;
    return safeSolicitacoes.filter(item => {
      const bId = toSafeString(item?.barragem_id).trim();
      const eId = toSafeString(item?.empreendedor_id).trim();
      const barragem = bId ? barragemMap.get(bId) : undefined;
      const emp = eId ? empreendedorMap.get(eId) : undefined;
      const pre =
        item?.dados_pre_preenchidos && typeof item.dados_pre_preenchidos === 'object'
          ? item.dados_pre_preenchidos
          : null;
      const equipeStr = Array.isArray(item?.equipe)
        ? item.equipe
            .map(m => (typeof m === 'string' ? m : toSafeString((m as any)?.nome || (m as any)?.id)))
            .join(' ')
        : '';
      const haystack = normalizeSearch(
        [
          toSafeString(item?.sistema_origem),
          toSafeString(item?.solicitante_nome),
          toSafeString(item?.solicitante_perfil),
          toSafeString(item?.relato),
          toSafeString(item?.processo_referencia),
          toSafeString(item?.observacao_campo),
          toSafeString(item?.vistoria_id),
          equipeStr,
          toSafeString(barragem?.nome) || toSafeString(pre?.nome_barragem),
          toSafeString(emp?.nome) || toSafeString(pre?.nome_empreendedor)
        ].join(' ')
      );
      return haystack.includes(q);
    });
  }, [barragemMap, empreendedorMap, safeSolicitacoes, searchTerm]);

  const { pagedItems } = useMemo(
    () => paginateList(filteredSolicitacoes, page, pageSize),
    [filteredSolicitacoes, page, pageSize]
  );

  const safeErrorMsg = error ? toSafeString(error, 'Erro ao carregar as solicitações de vistoria.') : null;
  const safeCreateErrorMsg = createError
    ? toSafeString(createError, 'Falha ao registrar solicitação de vistoria.')
    : null;
  const safeDetailErrorMsg = detailError
    ? toSafeString(detailError, 'Erro ao carregar detalhes e histórico.')
    : null;
  const safeActionErrorMsg = actionError
    ? toSafeString(actionError, 'Falha ao executar ação na solicitação.')
    : null;

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
            <div className="value">{safeCounts.total}</div>
          </div>
          <div className="stat-ico">▤</div>
        </div>
        <div className="stat">
          <div>
            <div className="label">Solicitadas</div>
            <div className="value">{safeCounts.solicitada}</div>
          </div>
          <div className="stat-ico">⚑</div>
        </div>
        <div className="stat">
          <div>
            <div className="label">Em planejamento</div>
            <div className="value">{safeCounts.em_planejamento}</div>
          </div>
          <div className="stat-ico">◷</div>
        </div>
        <div className="stat">
          <div>
            <div className="label">Realizadas</div>
            <div className="value">{safeCounts.realizada}</div>
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

        {!loading && safeErrorMsg && (
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
                <strong>Não foi possível carregar as solicitações:</strong> {safeErrorMsg}
              </div>
              <button type="button" className="btn light small" onClick={loadSolicitacoes}>
                Tentar novamente
              </button>
            </div>
          </div>
        )}

        {!loading && !safeErrorMsg && (
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
                      const itemId = toSafeString(item?.id).trim();
                      const bId = toSafeString(item?.barragem_id).trim();
                      const eId = toSafeString(item?.empreendedor_id).trim();
                      const barragem = bId ? barragemMap.get(bId) : undefined;
                      const empreendedor = eId ? empreendedorMap.get(eId) : undefined;
                      const pre =
                        item?.dados_pre_preenchidos &&
                        typeof item.dados_pre_preenchidos === 'object' &&
                        !Array.isArray(item.dados_pre_preenchidos)
                          ? item.dados_pre_preenchidos
                          : null;

                      const statusStr = toSafeString(item?.status).trim();
                      const stBadge = hasOwn(SOLICITACAO_STATUS_BADGES, statusStr)
                        ? SOLICITACAO_STATUS_BADGES[statusStr as keyof typeof SOLICITACAO_STATUS_BADGES]
                        : 'gray';
                      const stLabel = hasOwn(SOLICITACAO_STATUS_LABELS, statusStr)
                        ? SOLICITACAO_STATUS_LABELS[statusStr as keyof typeof SOLICITACAO_STATUS_LABELS]
                        : statusStr || 'Solicitada';

                      const sistemaOrigem = toSafeString(item?.sistema_origem).trim() || 'administra';
                      const origemRefId = toSafeString(item?.origem_ref_id).trim();
                      const processoRef = toSafeString(item?.processo_referencia).trim();
                      const solicitantePerfil = toSafeString(item?.solicitante_perfil).trim();
                      const relatoTexto = toSafeString(item?.relato);
                      const obsCampoTexto = toSafeString(item?.observacao_campo);
                      const vistoriaId = toSafeString(item?.vistoria_id).trim();
                      const barragemNome =
                        toSafeString(barragem?.nome).trim() ||
                        toSafeString(pre?.nome_barragem).trim();
                      const empreendedorNome =
                        toSafeString(empreendedor?.nome).trim() ||
                        toSafeString(empreendedor?.nomeFantasia).trim() ||
                        toSafeString(pre?.nome_empreendedor).trim();

                      const equipeLista = Array.isArray(item?.equipe) ? item.equipe : [];
                      const equipeNomes = equipeLista
                        .map(m => {
                          if (!m) return '';
                          if (typeof m === 'string') return toSafeString(m).trim();
                          return toSafeString((m as any).nome || (m as any).id).trim();
                        })
                        .filter(Boolean)
                        .join(', ');

                      const allowEdit = canEditOrCancel(item);
                      const allowObs = canEditObservacao(item);

                      return (
                        <tr key={itemId || `sol-${idx}`} className={idx % 2 === 0 ? 'row-even' : 'row-odd'}>
                          <td>
                            <div className="td-main">{sistemaOrigem}</div>
                            {origemRefId && <span className="td-sub">Ref.: {origemRefId}</span>}
                            {processoRef && <span className="td-sub">Proc.: {processoRef}</span>}
                          </td>
                          <td>
                            <div className="td-main">
                              {resolveUserName(item?.solicitante_id, item?.solicitante_nome)}
                            </div>
                            <span className="td-sub">
                              {solicitantePerfil || '—'} · {formatDateTimePtBr(item?.created_at)}
                            </span>
                          </td>
                          <td>
                            <div>
                              {relatoTexto.length > 140
                                ? `${relatoTexto.slice(0, 140)}...`
                                : relatoTexto || '—'}
                            </div>
                            {barragemNome && (
                              <span className="td-sub">Barragem: {barragemNome}</span>
                            )}
                            {empreendedorNome && (
                              <span className="td-sub">Empreendedor: {empreendedorNome}</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${stBadge}`}>{stLabel}</span>
                          </td>
                          <td>
                            {toSafeString(item?.data_realizacao).trim() ? (
                              <div>{formatDateTimePtBr(item.data_realizacao)}</div>
                            ) : (
                              <span className="muted">Não realizada</span>
                            )}
                            {equipeNomes && <span className="td-sub">Equipe: {equipeNomes}</span>}
                            {vistoriaId && <span className="td-sub">Registro: {vistoriaId}</span>}
                          </td>
                          <td>
                            {obsCampoTexto ? (
                              <>
                                <div>
                                  {obsCampoTexto.length > 120
                                    ? `${obsCampoTexto.slice(0, 120)}...`
                                    : obsCampoTexto}
                                </div>
                                {toSafeString(item?.observacao_atualizada_em).trim() && (
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
              {safeCreateErrorMsg && (
                <div className="notice amber" style={{ marginBottom: '14px' }}>
                  {safeCreateErrorMsg}
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
                    {safeBarragens.map((b, bIdx) => {
                      const bId = toSafeString(b?.id).trim();
                      if (!bId) return null;
                      const bNome = toSafeString(b?.nome).trim() || bId;
                      const bMunicipio = toSafeString(b?.municipio).trim();
                      return (
                        <option key={`${bId}-${bIdx}`} value={bId}>
                          {bNome}
                          {bMunicipio ? ` · ${bMunicipio}` : ''}
                        </option>
                      );
                    })}
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
                    {safeEmpreendedores.map((emp, eIdx) => {
                      const eId = toSafeString(emp?.id).trim();
                      if (!eId) return null;
                      const eNome =
                        toSafeString(emp?.nome).trim() ||
                        toSafeString(emp?.nomeFantasia).trim() ||
                        eId;
                      return (
                        <option key={`${eId}-${eIdx}`} value={eId}>
                          {eNome}
                        </option>
                      );
                    })}
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
                  ID: {toSafeString(selectedItem.id, '—')} · Origem:{' '}
                  {toSafeString(selectedItem.sistema_origem, 'administra') || 'administra'}
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
              {safeDetailErrorMsg && (
                <div className="notice amber" style={{ marginBottom: '12px' }}>
                  {safeDetailErrorMsg}
                </div>
              )}

              {(() => {
                const selStatus = toSafeString(selectedItem.status).trim();
                const selBadge = hasOwn(SOLICITACAO_STATUS_BADGES, selStatus)
                  ? SOLICITACAO_STATUS_BADGES[selStatus as keyof typeof SOLICITACAO_STATUS_BADGES]
                  : 'gray';
                const selLabel = hasOwn(SOLICITACAO_STATUS_LABELS, selStatus)
                  ? SOLICITACAO_STATUS_LABELS[selStatus as keyof typeof SOLICITACAO_STATUS_LABELS]
                  : selStatus || 'Solicitada';
                const selVistoriaId = toSafeString(selectedItem.vistoria_id).trim();
                const selEquipeStr = Array.isArray(selectedItem.equipe)
                  ? selectedItem.equipe
                      .map(m =>
                        typeof m === 'string'
                          ? toSafeString(m).trim()
                          : toSafeString((m as any)?.nome || (m as any)?.id).trim()
                      )
                      .filter(Boolean)
                      .join(', ')
                  : '';
                const selObs = toSafeString(selectedItem.observacao_campo).trim();
                const selPre =
                  selectedItem.dados_pre_preenchidos &&
                  typeof selectedItem.dados_pre_preenchidos === 'object' &&
                  !Array.isArray(selectedItem.dados_pre_preenchidos)
                    ? selectedItem.dados_pre_preenchidos
                    : null;

                return (
                  <>
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
                          <span className={`badge ${selBadge}`}>{selLabel}</span>
                        </div>
                      </div>
                      <div>
                        <span className="muted">Quem enviou:</span>
                        <div>
                          <b>
                            {resolveUserName(
                              selectedItem.solicitante_id,
                              selectedItem.solicitante_nome
                            )}
                          </b>
                          <div className="micro muted">
                            {toSafeString(selectedItem.solicitante_perfil, '—') || '—'} ·{' '}
                            {formatDateTimePtBr(selectedItem.created_at)}
                          </div>
                        </div>
                      </div>
                      <div>
                        <span className="muted">Data de realização:</span>
                        <div>
                          <b>{formatDateTimePtBr(selectedItem.data_realizacao)}</b>
                          {selVistoriaId && (
                            <div className="micro muted">Registro: {selVistoriaId}</div>
                          )}
                        </div>
                      </div>
                      <div>
                        <span className="muted">Equipe designada:</span>
                        <div>
                          <b>{selEquipeStr || 'Não atribuída'}</b>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginBottom: '12px', fontSize: '12px', color: '#334155' }}>
                      <b>Relato:</b> {toSafeString(selectedItem.relato, '—') || '—'}
                    </div>

                    {selObs && (
                      <div className="notice slate" style={{ marginBottom: '12px' }}>
                        <b>Observação de campo:</b> {selObs}
                        {toSafeString(selectedItem.observacao_atualizada_em).trim() && (
                          <div className="micro muted" style={{ marginTop: '4px' }}>
                            Atualizada em {formatDateTimePtBr(selectedItem.observacao_atualizada_em)}
                          </div>
                        )}
                      </div>
                    )}

                    {selPre && (
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
                        <div
                          style={{
                            marginTop: '6px',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '12px'
                          }}
                        >
                          {toSafeString(selPre.nome_barragem).trim() && (
                            <span>
                              <b>Barragem:</b> {toSafeString(selPre.nome_barragem)}
                            </span>
                          )}
                          {toSafeString(selPre.municipio).trim() && (
                            <span>
                              <b>Município:</b> {toSafeString(selPre.municipio)}
                            </span>
                          )}
                          {toSafeString(selPre.curso_agua).trim() && (
                            <span>
                              <b>Curso d’água:</b> {toSafeString(selPre.curso_agua)}
                            </span>
                          )}
                          {toSafeString(selPre.coordenadas).trim() && (
                            <span>
                              <b>Coordenadas:</b> {toSafeString(selPre.coordenadas)}
                            </span>
                          )}
                          {toSafeString(selPre.uso).trim() && (
                            <span>
                              <b>Uso:</b> {toSafeString(selPre.uso)}
                            </span>
                          )}
                          {toSafeString(selPre.classificacao).trim() && (
                            <span>
                              <b>Classificação:</b> {toSafeString(selPre.classificacao)}
                            </span>
                          )}
                          {toSafeString(selPre.nome_empreendedor).trim() && (
                            <span>
                              <b>Empreendedor:</b> {toSafeString(selPre.nome_empreendedor)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

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
                    Histórico ({safeHistorico.length})
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

              {safeActionErrorMsg && (
                <div className="notice amber" style={{ marginBottom: '12px' }}>
                  {safeActionErrorMsg}
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
                        {safeBarragens.map((b, bIdx) => {
                          const bId = toSafeString(b?.id).trim();
                          if (!bId) return null;
                          return (
                            <option key={`${bId}-${bIdx}`} value={bId}>
                              {toSafeString(b?.nome).trim() || bId}
                            </option>
                          );
                        })}
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
                        {safeEmpreendedores.map((emp, eIdx) => {
                          const eId = toSafeString(emp?.id).trim();
                          if (!eId) return null;
                          return (
                            <option key={`${eId}-${eIdx}`} value={eId}>
                              {toSafeString(emp?.nome).trim() ||
                                toSafeString(emp?.nomeFantasia).trim() ||
                                eId}
                            </option>
                          );
                        })}
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

              {!detailLoading && safeHistorico.length === 0 ? (
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
                      {safeHistorico.map((h, hIdx) => {
                        const hId = toSafeString(h?.id).trim() || `hist-${hIdx}`;
                        const acaoRaw = toSafeString(h?.acao).trim();
                        const acaoLabel = hasOwn(SOLICITACAO_HISTORICO_ACAO_LABELS, acaoRaw)
                          ? SOLICITACAO_HISTORICO_ACAO_LABELS[acaoRaw]
                          : acaoRaw || '—';
                        const campoRaw = toSafeString(h?.campo).trim();
                        const campoLabel =
                          campoRaw && hasOwn(SOLICITACAO_CAMPO_LABELS, campoRaw)
                            ? SOLICITACAO_CAMPO_LABELS[campoRaw]
                            : campoRaw || '—';
                        const valorAnterior = toSafeString(h?.valor_anterior).trim() || '—';
                        const valorNovo = toSafeString(h?.valor_novo).trim() || '—';
                        const motivoTexto = toSafeString(h?.motivo).trim() || '—';
                        return (
                          <tr key={hId}>
                            <td>{formatDateTimePtBr(h?.created_at)}</td>
                            <td>{resolveUserName(h?.usuario_id)}</td>
                            <td>
                              <span className="badge gray">{acaoLabel}</span>
                            </td>
                            <td>{campoLabel}</td>
                            <td>
                              <span>{valorAnterior}</span>
                              {' → '}
                              <b>{valorNovo}</b>
                            </td>
                            <td>{motivoTexto}</td>
                          </tr>
                        );
                      })}
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
