// src/services/solicitacoesVistoriaService.ts
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { containsCpfOrCnpjFrontend } from './pendenciasService';

export type SolicitacaoSistemaOrigem = 'classifica' | 'notifica' | 'administra';
export type SolicitacaoVistoriaStatus =
  | 'solicitada'
  | 'em_planejamento'
  | 'realizada'
  | 'cancelada';

export const SOLICITACAO_ORIGENS: SolicitacaoSistemaOrigem[] = [
  'administra',
  'classifica',
  'notifica'
];

export const SOLICITACAO_ORIGEM_LABELS: Record<SolicitacaoSistemaOrigem, string> = {
  administra: 'administra',
  classifica: 'classifica',
  notifica: 'notifica'
};

export const SOLICITACAO_STATUS_LIST: SolicitacaoVistoriaStatus[] = [
  'solicitada',
  'em_planejamento',
  'realizada',
  'cancelada'
];

export const SOLICITACAO_STATUS_LABELS: Record<SolicitacaoVistoriaStatus, string> = {
  solicitada: 'Solicitada',
  em_planejamento: 'Em planejamento',
  realizada: 'Realizada',
  cancelada: 'Cancelada'
};

export const SOLICITACAO_STATUS_BADGES: Record<SolicitacaoVistoriaStatus, string> = {
  solicitada: 'amber',
  em_planejamento: 'blue',
  realizada: 'green',
  cancelada: 'gray'
};

export const SOLICITACAO_HISTORICO_ACAO_LABELS: Record<string, string> = {
  criacao: 'Criação',
  atualizacao: 'Edição',
  cancelamento: 'Cancelamento',
  conclusao: 'Conclusão',
  edicao_observacao: 'Observação de campo'
};

export const SOLICITACAO_CAMPO_LABELS: Record<string, string> = {
  status: 'Status',
  relato: 'Relato',
  empreendedor_id: 'Empreendedor',
  barragem_id: 'Barragem',
  processo_referencia: 'Processo',
  origem_ref_id: 'Ref. de origem',
  dados_pre_preenchidos: 'Dados pré-preenchidos',
  observacao_campo: 'Observação de campo'
};

export interface DadosPrePreenchidos {
  nome_barragem?: string | null;
  municipio?: string | null;
  curso_agua?: string | null;
  coordenadas?: string | null;
  uso?: string | null;
  classificacao?: string | null;
  nome_empreendedor?: string | null;
}

export interface EquipeVistoriaMembro {
  id: string;
  nome: string;
}

export interface SolicitacaoVistoriaRecord {
  id: string;
  sistema_origem: SolicitacaoSistemaOrigem | string;
  origem_ref_id?: string | null;
  solicitante_id: string;
  solicitante_nome?: string | null;
  solicitante_perfil?: string | null;
  relato: string;
  empreendedor_id?: string | null;
  barragem_id?: string | null;
  processo_referencia?: string | null;
  dados_pre_preenchidos?: DadosPrePreenchidos | null;
  status: SolicitacaoVistoriaStatus;
  vistoria_id?: string | null;
  data_realizacao?: string | null;
  equipe?: EquipeVistoriaMembro[] | null;
  observacao_campo?: string | null;
  observacao_atualizada_em?: string | null;
  observacao_atualizada_por?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface SolicitacaoVistoriaHistoricoRecord {
  id: string;
  solicitacao_id: string;
  acao: string;
  campo?: string | null;
  valor_anterior?: string | null;
  valor_novo?: string | null;
  usuario_id?: string | null;
  motivo?: string | null;
  created_at: string;
}

export interface SolicitacaoUserRefInfo {
  id: string;
  nome: string;
  setor?: string;
  papel?: string;
}

export interface SolicitacoesListResponse {
  success: boolean;
  error?: string;
  solicitacoes: SolicitacaoVistoriaRecord[];
  counts: {
    total: number;
    solicitada: number;
    em_planejamento: number;
    realizada: number;
    cancelada: number;
  };
  currentUser?: {
    userId: string;
    nome?: string;
    email?: string;
  };
  usuariosNomes: Record<string, SolicitacaoUserRefInfo>;
}

export interface SolicitacaoDetailResponse {
  success: boolean;
  error?: string;
  solicitacao?: SolicitacaoVistoriaRecord;
  historico: SolicitacaoVistoriaHistoricoRecord[];
  usuariosNomes: Record<string, SolicitacaoUserRefInfo>;
}

export interface SolicitacaoMutationResponse {
  success: boolean;
  code?: string;
  error?: string;
  solicitacao?: SolicitacaoVistoriaRecord | null;
}

export interface SolicitacaoCreatePreFillDraft {
  barragem_id: string;
  empreendedor_id: string;
  processo_referencia: string;
  dados_pre_preenchidos: DadosPrePreenchidos;
}

export const SOLICITACOES_API_BASE = '/api/solicitacoesVistoria';

export { containsCpfOrCnpjFrontend };

export function canCreateSolicitacaoVistoriaRole(role?: string | null): boolean {
  return role === 'Administrador' || role === 'Analista';
}

function sanitizeDraftField(value: unknown): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  if (containsCpfOrCnpjFrontend(trimmed)) return '';
  return trimmed;
}

function looksLikeRecordId(value: string): boolean {
  return Boolean(value) && !/\s/.test(value);
}

export function buildBarragemSolicitacaoDraft(
  barragem: any,
  empreendedores: Array<{ id?: string; nome?: string; nomeFantasia?: string }> = []
): SolicitacaoCreatePreFillDraft {
  if (!barragem || typeof barragem !== 'object') {
    return {
      barragem_id: '',
      empreendedor_id: '',
      processo_referencia: '',
      dados_pre_preenchidos: {}
    };
  }

  const barragemId = sanitizeDraftField(barragem.id);
  const rawEmpId = sanitizeDraftField(barragem.empreendedorId);
  const rawEmpRef = sanitizeDraftField(barragem.empreendedor);

  const empList = Array.isArray(empreendedores) ? empreendedores : [];
  const matchedEmp = empList.find(e => {
    if (!e) return false;
    const eId = String(e.id || '').trim();
    const eNome = String(e.nome || '').trim().toLowerCase();
    const eFantasia = String(e.nomeFantasia || '').trim().toLowerCase();
    if (rawEmpId && eId === rawEmpId) return true;
    if (rawEmpRef && eId === rawEmpRef) return true;
    if (rawEmpRef && (eNome === rawEmpRef.toLowerCase() || eFantasia === rawEmpRef.toLowerCase())) {
      return true;
    }
    return false;
  });

  const empreendedorId = sanitizeDraftField(
    matchedEmp?.id || rawEmpId || (looksLikeRecordId(rawEmpRef) ? rawEmpRef : '')
  );

  const nomeEmpreendedor = sanitizeDraftField(
    matchedEmp?.nome ||
      matchedEmp?.nomeFantasia ||
      barragem.nomeEmpreendedor ||
      (!looksLikeRecordId(rawEmpRef) ? rawEmpRef : '')
  );

  const nomeBarragem = sanitizeDraftField(barragem.nome || barragem.nomeBarragem);
  const municipio = sanitizeDraftField(barragem.municipio);
  const cursoAgua = sanitizeDraftField(
    barragem.cursoAgua || barragem.cursoDagua || barragem.rio
  );

  const lat = sanitizeDraftField(barragem.latitude ?? barragem.lat);
  const lng = sanitizeDraftField(barragem.longitude ?? barragem.lng);
  const coordenadas = sanitizeDraftField([lat, lng].filter(Boolean).join(', '));

  const uso = sanitizeDraftField(barragem.uso || barragem.finalidade || barragem.usoPrincipal);

  const rawClassificacao = sanitizeDraftField(barragem.classificacao);
  const dpa = sanitizeDraftField(barragem.danoPotencial || barragem.dpa);
  const cri = sanitizeDraftField(barragem.categoriaRisco || barragem.cri);
  const classificacao =
    rawClassificacao ||
    sanitizeDraftField(
      [
        dpa && dpa !== 'Não classificada' ? `DPA: ${dpa}` : '',
        cri && cri !== 'Não classificada' ? `CRI: ${cri}` : ''
      ]
        .filter(Boolean)
        .join(' · ')
    );

  const dadosPre: DadosPrePreenchidos = {};
  if (nomeBarragem) dadosPre.nome_barragem = nomeBarragem;
  if (municipio) dadosPre.municipio = municipio;
  if (cursoAgua) dadosPre.curso_agua = cursoAgua;
  if (coordenadas) dadosPre.coordenadas = coordenadas;
  if (uso) dadosPre.uso = uso;
  if (classificacao) dadosPre.classificacao = classificacao;
  if (nomeEmpreendedor) dadosPre.nome_empreendedor = nomeEmpreendedor;

  return {
    barragem_id: barragemId,
    empreendedor_id: empreendedorId,
    processo_referencia: sanitizeDraftField(barragem.processo),
    dados_pre_preenchidos: dadosPre
  };
}

function normalizeSolicitacaoRecord(raw: any): SolicitacaoVistoriaRecord {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    id: String(r.id || ''),
    sistema_origem: String(r.sistema_origem || 'administra'),
    origem_ref_id: r.origem_ref_id ?? null,
    solicitante_id: String(r.solicitante_id || ''),
    solicitante_nome: r.solicitante_nome ?? null,
    solicitante_perfil: r.solicitante_perfil ?? null,
    relato: String(r.relato ?? ''),
    empreendedor_id: r.empreendedor_id ?? null,
    barragem_id: r.barragem_id ?? null,
    processo_referencia: r.processo_referencia ?? null,
    dados_pre_preenchidos:
      r.dados_pre_preenchidos && typeof r.dados_pre_preenchidos === 'object'
        ? r.dados_pre_preenchidos
        : null,
    status: (r.status || 'solicitada') as SolicitacaoVistoriaStatus,
    vistoria_id: r.vistoria_id ?? null,
    data_realizacao: r.data_realizacao ?? null,
    equipe: Array.isArray(r.equipe) ? r.equipe : [],
    observacao_campo: r.observacao_campo ?? null,
    observacao_atualizada_em: r.observacao_atualizada_em ?? null,
    observacao_atualizada_por: r.observacao_atualizada_por ?? null,
    created_at: String(r.created_at || ''),
    updated_at: r.updated_at ?? null
  };
}

function normalizeCounts(raw: any): SolicitacoesListResponse['counts'] {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    total: Number(c.total) || 0,
    solicitada: Number(c.solicitada) || 0,
    em_planejamento: Number(c.em_planejamento) || 0,
    realizada: Number(c.realizada) || 0,
    cancelada: Number(c.cancelada) || 0
  };
}

async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  if (!isSupabaseConfigured() || !supabase) return {};
  try {
    const { data } = await supabase.auth.getSession();
    let session = data?.session;
    const expiresAtMs = session?.expires_at ? Number(session.expires_at) * 1000 : 0;
    const isNearExpiry = Boolean(expiresAtMs && expiresAtMs - Date.now() < 60_000);

    if ((forceRefresh || isNearExpiry || !session?.access_token) && session) {
      const { data: refreshed } = await supabase.auth.refreshSession().catch(() => ({ data: null }));
      if (refreshed?.session) {
        session = refreshed.session;
      }
    }

    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function fetchSolicitacoesApi<T>(
  path: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null; isJson: boolean }> {
  const doReq = async (forceRefresh: boolean) => {
    const authHeaders = await getAuthHeaders(forceRefresh);
    return fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(init.headers || {}),
        ...authHeaders
      }
    });
  };

  let res = await doReq(false);
  if (res.status === 401 && isSupabaseConfigured()) {
    res = await doReq(true);
  }

  const contentType = String(res.headers?.get?.('content-type') || '').toLowerCase();
  const data = (await res.json().catch(() => null)) as T | null;
  const isJson = Boolean(data !== null && (!contentType || contentType.includes('json')));
  return { ok: res.ok, status: res.status, data, isJson };
}

export async function listarSolicitacoesVistoria(params?: {
  status?: string;
  sistema_origem?: string;
}): Promise<SolicitacoesListResponse> {
  try {
    const qs = new URLSearchParams();
    if (params?.status && params.status !== 'todos') {
      qs.set('status', params.status);
    }
    if (params?.sistema_origem && params.sistema_origem !== 'todos') {
      qs.set('sistema_origem', params.sistema_origem);
    }
    const queryStr = qs.toString();
    const url = queryStr ? `${SOLICITACOES_API_BASE}?${queryStr}` : SOLICITACOES_API_BASE;
    const { ok, status, data, isJson } = await fetchSolicitacoesApi<SolicitacoesListResponse>(url, {
      method: 'GET'
    });

    if (!ok || !data || !isJson || data.success === false) {
      return {
        success: false,
        error:
          data?.error ||
          (ok && !isJson
            ? 'Resposta inesperada do servidor ao carregar solicitações de vistoria.'
            : `Falha ao carregar solicitações de vistoria (HTTP ${status}).`),
        solicitacoes: [],
        counts: { total: 0, solicitada: 0, em_planejamento: 0, realizada: 0, cancelada: 0 },
        usuariosNomes: {}
      };
    }

    return {
      success: true,
      solicitacoes: Array.isArray(data.solicitacoes)
        ? data.solicitacoes.map(normalizeSolicitacaoRecord)
        : [],
      counts: normalizeCounts(data.counts),
      currentUser: data.currentUser,
      usuariosNomes: data.usuariosNomes || {}
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Erro de comunicação ao carregar solicitações de vistoria.',
      solicitacoes: [],
      counts: { total: 0, solicitada: 0, em_planejamento: 0, realizada: 0, cancelada: 0 },
      usuariosNomes: {}
    };
  }
}

export async function obterDetalheSolicitacaoVistoria(
  solicitacaoId: string
): Promise<SolicitacaoDetailResponse> {
  try {
    const qs = new URLSearchParams({ solicitacaoId });
    const { ok, status, data, isJson } = await fetchSolicitacoesApi<SolicitacaoDetailResponse>(
      `${SOLICITACOES_API_BASE}?${qs.toString()}`,
      { method: 'GET' }
    );

    if (!ok || !data || !isJson || data.success === false) {
      return {
        success: false,
        error:
          data?.error ||
          `Falha ao carregar histórico da solicitação (HTTP ${status}).`,
        historico: [],
        usuariosNomes: {}
      };
    }

    return {
      success: true,
      solicitacao: data.solicitacao ? normalizeSolicitacaoRecord(data.solicitacao) : undefined,
      historico: Array.isArray(data.historico) ? data.historico : [],
      usuariosNomes: data.usuariosNomes || {}
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Erro de comunicação ao carregar detalhes da solicitação.',
      historico: [],
      usuariosNomes: {}
    };
  }
}

export async function criarSolicitacaoVistoria(payload: {
  relato: string;
  origem_ref_id?: string;
  empreendedor_id?: string;
  barragem_id?: string;
  processo_referencia?: string;
  dados_pre_preenchidos?: DadosPrePreenchidos;
  motivo?: string;
}): Promise<SolicitacaoMutationResponse> {
  try {
    const { ok, status, data, isJson } = await fetchSolicitacoesApi<SolicitacaoMutationResponse>(
      SOLICITACOES_API_BASE,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    if (!ok || !data || !isJson || data.success === false) {
      return {
        success: false,
        code: data?.code,
        error: data?.error || `Não foi possível registrar a solicitação (HTTP ${status}).`
      };
    }

    return {
      success: true,
      solicitacao: data.solicitacao ? normalizeSolicitacaoRecord(data.solicitacao) : null
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Erro de comunicação ao registrar solicitação de vistoria.'
    };
  }
}

export async function editarSolicitacaoVistoria(
  solicitacaoId: string,
  payload: {
    relato?: string;
    origem_ref_id?: string | null;
    empreendedor_id?: string | null;
    barragem_id?: string | null;
    processo_referencia?: string | null;
    dados_pre_preenchidos?: DadosPrePreenchidos | null;
    status?: 'solicitada' | 'em_planejamento';
    motivo?: string;
  }
): Promise<SolicitacaoMutationResponse> {
  try {
    const qs = new URLSearchParams({ id: solicitacaoId });
    const { ok, status, data, isJson } = await fetchSolicitacoesApi<SolicitacaoMutationResponse>(
      `${SOLICITACOES_API_BASE}?${qs.toString()}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    if (!ok || !data || !isJson || data.success === false) {
      return {
        success: false,
        code: data?.code,
        error: data?.error || `Não foi possível editar a solicitação (HTTP ${status}).`
      };
    }

    return {
      success: true,
      solicitacao: data.solicitacao ? normalizeSolicitacaoRecord(data.solicitacao) : null
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Erro de comunicação ao editar solicitação de vistoria.'
    };
  }
}

export async function cancelarSolicitacaoVistoria(
  solicitacaoId: string,
  motivo: string
): Promise<SolicitacaoMutationResponse> {
  try {
    const qs = new URLSearchParams({ id: solicitacaoId, action: 'cancelar' });
    const { ok, status, data, isJson } = await fetchSolicitacoesApi<SolicitacaoMutationResponse>(
      `${SOLICITACOES_API_BASE}?${qs.toString()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo })
      }
    );

    if (!ok || !data || !isJson || data.success === false) {
      return {
        success: false,
        code: data?.code,
        error: data?.error || `Não foi possível cancelar a solicitação (HTTP ${status}).`
      };
    }

    return {
      success: true,
      solicitacao: data.solicitacao ? normalizeSolicitacaoRecord(data.solicitacao) : null
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Erro de comunicação ao cancelar solicitação de vistoria.'
    };
  }
}

export async function editarObservacaoCampoSolicitacao(
  solicitacaoId: string,
  observacao_campo: string
): Promise<SolicitacaoMutationResponse> {
  try {
    const qs = new URLSearchParams({ id: solicitacaoId, action: 'observacao' });
    const { ok, status, data, isJson } = await fetchSolicitacoesApi<SolicitacaoMutationResponse>(
      `${SOLICITACOES_API_BASE}?${qs.toString()}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observacao_campo })
      }
    );

    if (!ok || !data || !isJson || data.success === false) {
      return {
        success: false,
        code: data?.code,
        error: data?.error || `Não foi possível atualizar a observação de campo (HTTP ${status}).`
      };
    }

    return {
      success: true,
      solicitacao: data.solicitacao ? normalizeSolicitacaoRecord(data.solicitacao) : null
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Erro de comunicação ao atualizar observação de campo.'
    };
  }
}
