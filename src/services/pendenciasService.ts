// src/services/pendenciasService.ts
import { supabase, isSupabaseConfigured } from './supabaseClient';

export type PendenciaSituacao =
  | 'aberta'
  | 'direcionada'
  | 'em_analise'
  | 'resolvida'
  | 'cancelada';

export type PendenciaTab = 'minhas' | 'geral' | 'direcionado';

export const PENDENCIA_SITUACOES: PendenciaSituacao[] = [
  'aberta',
  'direcionada',
  'em_analise',
  'resolvida',
  'cancelada'
];

export const PENDENCIA_SITUACAO_LABELS: Record<PendenciaSituacao, string> = {
  aberta: 'Aberta',
  direcionada: 'Direcionada',
  em_analise: 'Em análise',
  resolvida: 'Resolvida',
  cancelada: 'Cancelada'
};

export const PENDENCIA_SITUACAO_BADGES: Record<PendenciaSituacao, string> = {
  aberta: 'amber',
  direcionada: 'blue',
  em_analise: 'blue',
  resolvida: 'green',
  cancelada: 'gray'
};

export const PENDENCIA_HISTORICO_ACAO_LABELS: Record<string, string> = {
  criacao: 'Criação',
  direcionamento: 'Direcionamento',
  mudanca_situacao: 'Mudança de situação',
  edicao: 'Edição',
  resolucao: 'Resolução'
};

export const PENDENCIA_CAMPO_LABELS: Record<string, string> = {
  situacao: 'Situação',
  responsavel_id: 'Responsável',
  tipo: 'Tipo',
  titulo: 'Título',
  descricao: 'Descrição',
  origem_ref_id: 'Ref. de origem',
  tipo_referencia: 'Tipo de referência',
  referencia_id: 'ID da referência',
  empreendedor_id: 'Empreendedor',
  barragem_id: 'Barragem'
};

export const PENDENCIA_TIPOS = [
  'Conciliação cadastral',
  'Pendência documental',
  'Regularização de empreendedor',
  'Regularização de barragem',
  'Verificação de RT/ART',
  'Tramitação administrativa',
  'Outro'
] as const;

export const PENDENCIA_REFERENCIA_TIPOS = [
  { value: '', label: 'Sem referência específica' },
  { value: 'barragem', label: 'Barragem' },
  { value: 'empreendedor', label: 'Empreendedor' },
  { value: 'rt', label: 'Responsável Técnico' },
  { value: 'portaria', label: 'Portaria' },
  { value: 'revisao', label: 'Revisão de conciliação' },
  { value: 'documento', label: 'Documento' }
] as const;

export interface PendenciaRecord {
  id: string;
  origem: string;
  origem_ref_id?: string | null;
  tipo: string;
  titulo: string;
  descricao?: string | null;
  situacao: PendenciaSituacao;
  responsavel_id?: string | null;
  criado_por?: string | null;
  direcionado_por?: string | null;
  resolvido_por?: string | null;
  tipo_referencia?: string | null;
  referencia_id?: string | null;
  empreendedor_id?: string | null;
  barragem_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  direcionado_em?: string | null;
  resolvido_em?: string | null;
}

export interface PendenciaHistoricoRecord {
  id: string;
  pendencia_id: string;
  acao: string;
  campo?: string | null;
  valor_anterior?: string | null;
  valor_novo?: string | null;
  usuario_id?: string | null;
  motivo?: string | null;
  created_at: string;
}

export interface PendenciaUserRefInfo {
  id: string;
  nome: string;
  setor?: string;
  papel?: string;
}

export interface PendenciaUsuarioOption {
  id: string;
  authUserId?: string | null;
  nome: string;
  login?: string;
  setor?: string;
  papel?: string;
}

export interface PendenciasListResponse {
  success: boolean;
  error?: string;
  mutationsEnabled?: boolean;
  pendencias: PendenciaRecord[];
  counts: {
    minhas: number;
    geral: number;
    direcionado?: number;
  };
  currentUser?: {
    userId: string;
    nome?: string;
  };
  usuariosNomes: Record<string, PendenciaUserRefInfo>;
  usuariosDirecionaveis?: PendenciaUsuarioOption[];
}

export interface PendenciaDetailResponse {
  success: boolean;
  error?: string;
  pendencia?: PendenciaRecord;
  historico: PendenciaHistoricoRecord[];
  usuariosNomes: Record<string, PendenciaUserRefInfo>;
  usuariosDirecionaveis?: PendenciaUsuarioOption[];
}

export interface PendenciaMutationResponse {
  success: boolean;
  error?: string;
  pendencia?: PendenciaRecord;
  historico?: PendenciaHistoricoRecord[];
}

export function containsCpfOrCnpjFrontend(raw: unknown): boolean {
  const text = String(raw || '').trim();
  if (!text) return false;
  if (/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(text)) return true;
  if (/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(text)) return true;
  if (/(?<![\/.\-\da-zA-Z])\d{14}(?![\/.\-\da-zA-Z])/.test(text)) return true;
  if (/(?<![\/.\-\da-zA-Z])\d{11}(?![\/.\-\da-zA-Z])/.test(text)) return true;
  return false;
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

async function fetchPendenciasApi<T>(
  path: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null }> {
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

  const data = (await res.json().catch(() => null)) as T | null;
  return { ok: res.ok, status: res.status, data };
}

export async function listarPendencias(params: {
  tab: PendenciaTab;
  situacao?: string;
}): Promise<PendenciasListResponse> {
  try {
    const qs = new URLSearchParams({ tab: params.tab });
    if (params.situacao && params.situacao !== 'todas') {
      qs.set('situacao', params.situacao);
    }

    const { ok, status, data } = await fetchPendenciasApi<PendenciasListResponse>(
      `/api/pendencias?${qs.toString()}`,
      { method: 'GET' }
    );

    if (!ok || !data || data.success === false) {
      return {
        success: false,
        error: data?.error || `Falha ao carregar pendências (HTTP ${status}).`,
        pendencias: [],
        counts: { minhas: 0, geral: 0 },
        usuariosNomes: {}
      };
    }

    return {
      success: true,
      mutationsEnabled: Boolean(data.mutationsEnabled),
      pendencias: Array.isArray(data.pendencias) ? data.pendencias : [],
      counts: data.counts || { minhas: 0, geral: 0 },
      currentUser: data.currentUser,
      usuariosNomes: data.usuariosNomes || {},
      usuariosDirecionaveis: data.usuariosDirecionaveis
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Erro de comunicação ao carregar pendências.',
      pendencias: [],
      counts: { minhas: 0, geral: 0 },
      usuariosNomes: {}
    };
  }
}

export async function obterDetalhePendencia(pendenciaId: string): Promise<PendenciaDetailResponse> {
  try {
    const qs = new URLSearchParams({ pendenciaId });
    const { ok, status, data } = await fetchPendenciasApi<PendenciaDetailResponse>(
      `/api/pendencias?${qs.toString()}`,
      { method: 'GET' }
    );

    if (!ok || !data || data.success === false) {
      return {
        success: false,
        error: data?.error || `Falha ao carregar histórico da pendência (HTTP ${status}).`,
        historico: [],
        usuariosNomes: {}
      };
    }

    return {
      success: true,
      pendencia: data.pendencia,
      historico: Array.isArray(data.historico) ? data.historico : [],
      usuariosNomes: data.usuariosNomes || {},
      usuariosDirecionaveis: data.usuariosDirecionaveis
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Erro de comunicação ao carregar histórico da pendência.',
      historico: [],
      usuariosNomes: {}
    };
  }
}

async function postPendenciaMutation(body: Record<string, any>): Promise<PendenciaMutationResponse> {
  try {
    const { ok, status, data } = await fetchPendenciasApi<PendenciaMutationResponse>(
      '/api/pendencias',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );

    if (!ok || !data || data.success === false) {
      return {
        success: false,
        error: data?.error || `Falha na operação de pendência (HTTP ${status}).`
      };
    }

    return {
      success: true,
      pendencia: data.pendencia,
      historico: data.historico
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Erro de comunicação com o servidor de pendências.'
    };
  }
}

export function criarPendencia(payload: {
  tipo: string;
  titulo: string;
  descricao?: string;
  origem_ref_id?: string;
  tipo_referencia?: string;
  referencia_id?: string;
  empreendedor_id?: string;
  barragem_id?: string;
  responsavelUsuarioId?: string;
  motivo?: string;
}): Promise<PendenciaMutationResponse> {
  return postPendenciaMutation({
    action: 'criar',
    ...payload
  });
}

export function direcionarPendencia(payload: {
  pendenciaId: string;
  responsavelUsuarioId: string;
  motivo?: string;
}): Promise<PendenciaMutationResponse> {
  return postPendenciaMutation({
    action: 'direcionar',
    ...payload
  });
}

export function alterarSituacaoPendencia(payload: {
  pendenciaId: string;
  situacao: PendenciaSituacao;
  motivo?: string;
}): Promise<PendenciaMutationResponse> {
  return postPendenciaMutation({
    action: 'alterar_situacao',
    ...payload
  });
}

export function editarPendencia(payload: {
  pendenciaId: string;
  tipo?: string;
  titulo?: string;
  descricao?: string;
  origem_ref_id?: string;
  tipo_referencia?: string;
  referencia_id?: string;
  empreendedor_id?: string;
  barragem_id?: string;
  motivo?: string;
}): Promise<PendenciaMutationResponse> {
  return postPendenciaMutation({
    action: 'editar',
    ...payload
  });
}

export function resolverPendencia(payload: {
  pendenciaId: string;
  motivo: string;
}): Promise<PendenciaMutationResponse> {
  return postPendenciaMutation({
    action: 'resolver',
    ...payload
  });
}
