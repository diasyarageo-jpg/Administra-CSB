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

function toSafeText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : '';
  if (typeof raw === 'boolean') return String(raw);
  return '';
}

function toSafeOptionalText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = toSafeText(raw);
  return text ? text : null;
}

function scrubErrorSecrets(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [oculto]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[token oculto]')
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, '[segredo oculto]');
}

export function extractSafeErrorMessage(
  rawError: unknown,
  fallback: string,
  depth = 0
): string {
  if (depth > 2 || rawError === null || rawError === undefined) {
    return fallback;
  }
  if (typeof rawError === 'string') {
    const clean = scrubErrorSecrets(rawError.trim());
    return clean || fallback;
  }
  if (typeof rawError === 'number' || typeof rawError === 'boolean') {
    return String(rawError);
  }
  if (typeof rawError === 'object' && !Array.isArray(rawError)) {
    const obj = rawError as Record<string, unknown>;
    const candidate = obj.message ?? obj.error ?? obj.details ?? obj.hint;
    if (candidate !== undefined && candidate !== null) {
      return extractSafeErrorMessage(candidate, fallback, depth + 1);
    }
    const code = toSafeText(obj.code).trim();
    if (code) {
      return `${fallback} (${code})`;
    }
  }
  return fallback;
}

function normalizeDadosPrePreenchidos(raw: unknown): DadosPrePreenchidos | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: DadosPrePreenchidos = {};
  const nomeBarragem = toSafeOptionalText(src.nome_barragem);
  const municipio = toSafeOptionalText(src.municipio);
  const cursoAgua = toSafeOptionalText(src.curso_agua);
  const coordenadas = toSafeOptionalText(src.coordenadas);
  const uso = toSafeOptionalText(src.uso);
  const classificacao = toSafeOptionalText(src.classificacao);
  const nomeEmp = toSafeOptionalText(src.nome_empreendedor);

  if (nomeBarragem !== null) out.nome_barragem = nomeBarragem;
  if (municipio !== null) out.municipio = municipio;
  if (cursoAgua !== null) out.curso_agua = cursoAgua;
  if (coordenadas !== null) out.coordenadas = coordenadas;
  if (uso !== null) out.uso = uso;
  if (classificacao !== null) out.classificacao = classificacao;
  if (nomeEmp !== null) out.nome_empreendedor = nomeEmp;

  return Object.keys(out).length > 0 ? out : null;
}

function normalizeEquipe(raw: unknown): EquipeVistoriaMembro[] {
  if (!Array.isArray(raw)) return [];
  const out: EquipeVistoriaMembro[] = [];
  for (const item of raw) {
    if (!item) continue;
    if (typeof item === 'string') {
      const clean = item.trim();
      if (clean) out.push({ id: clean, nome: clean });
      continue;
    }
    if (typeof item === 'object' && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>;
      const id = toSafeText(obj.id).trim();
      const nome = toSafeText(obj.nome).trim();
      if (id || nome) {
        out.push({ id, nome: nome || id || 'Integrante' });
      }
    }
  }
  return out;
}

function normalizeSolicitacaoRecord(raw: any): SolicitacaoVistoriaRecord {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawStatus = toSafeText(r.status).trim() as SolicitacaoVistoriaStatus;
  const status = SOLICITACAO_STATUS_LIST.includes(rawStatus) ? rawStatus : 'solicitada';

  return {
    id: toSafeText(r.id),
    sistema_origem: toSafeText(r.sistema_origem) || 'administra',
    origem_ref_id: toSafeOptionalText(r.origem_ref_id),
    solicitante_id: toSafeText(r.solicitante_id),
    solicitante_nome: toSafeOptionalText(r.solicitante_nome),
    solicitante_perfil: toSafeOptionalText(r.solicitante_perfil),
    relato: toSafeText(r.relato),
    empreendedor_id: toSafeOptionalText(r.empreendedor_id),
    barragem_id: toSafeOptionalText(r.barragem_id),
    processo_referencia: toSafeOptionalText(r.processo_referencia),
    dados_pre_preenchidos: normalizeDadosPrePreenchidos(r.dados_pre_preenchidos),
    status,
    vistoria_id: toSafeOptionalText(r.vistoria_id),
    data_realizacao: toSafeOptionalText(r.data_realizacao),
    equipe: normalizeEquipe(r.equipe),
    observacao_campo: toSafeOptionalText(r.observacao_campo),
    observacao_atualizada_em: toSafeOptionalText(r.observacao_atualizada_em),
    observacao_atualizada_por: toSafeOptionalText(r.observacao_atualizada_por),
    created_at: toSafeText(r.created_at),
    updated_at: toSafeOptionalText(r.updated_at)
  };
}

function normalizeHistoricoRecord(raw: unknown): SolicitacaoVistoriaHistoricoRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const h = raw as Record<string, unknown>;
  return {
    id: toSafeText(h.id),
    solicitacao_id: toSafeText(h.solicitacao_id),
    acao: toSafeText(h.acao),
    campo: toSafeOptionalText(h.campo),
    valor_anterior: toSafeOptionalText(h.valor_anterior),
    valor_novo: toSafeOptionalText(h.valor_novo),
    usuario_id: toSafeOptionalText(h.usuario_id),
    motivo: toSafeOptionalText(h.motivo),
    created_at: toSafeText(h.created_at)
  };
}

function normalizeUsuariosNomes(raw: unknown): Record<string, SolicitacaoUserRefInfo> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, SolicitacaoUserRefInfo> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) continue;
    if (typeof val === 'string') {
      const clean = val.trim();
      if (clean) out[key] = { id: key, nome: clean };
      continue;
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      const nome = toSafeText(obj.nome).trim();
      const setor = toSafeText(obj.setor).trim();
      const papel = toSafeText(obj.papel).trim();
      out[key] = {
        id: toSafeText(obj.id).trim() || key,
        nome: nome || key,
        ...(setor ? { setor } : {}),
        ...(papel ? { papel } : {})
      };
    }
  }
  return out;
}

function normalizeCounts(raw: any): SolicitacoesListResponse['counts'] {
  const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const safeNum = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return {
    total: safeNum(c.total),
    solicitada: safeNum(c.solicitada),
    em_planejamento: safeNum(c.em_planejamento),
    realizada: safeNum(c.realizada),
    cancelada: safeNum(c.cancelada)
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
  const rawParsed = await res.json().catch(() => null);
  const isPlainObject =
    rawParsed !== null && typeof rawParsed === 'object' && !Array.isArray(rawParsed);
  const data = (isPlainObject ? rawParsed : null) as T | null;
  const isJson = Boolean(isPlainObject && (!contentType || contentType.includes('json')));
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
      const fallback =
        ok && !isJson
          ? 'Resposta inesperada do servidor ao carregar solicitações de vistoria.'
          : `Falha ao carregar solicitações de vistoria (HTTP ${status}).`;
      return {
        success: false,
        error: extractSafeErrorMessage((data as any)?.error, fallback),
        solicitacoes: [],
        counts: { total: 0, solicitada: 0, em_planejamento: 0, realizada: 0, cancelada: 0 },
        usuariosNomes: {}
      };
    }

    const rawCurrent = (data as any).currentUser;
    const currentUser =
      rawCurrent && typeof rawCurrent === 'object' && !Array.isArray(rawCurrent)
        ? {
            userId: toSafeText(rawCurrent.userId),
            nome: toSafeText(rawCurrent.nome) || undefined,
            email: toSafeText(rawCurrent.email) || undefined
          }
        : undefined;

    return {
      success: true,
      solicitacoes: Array.isArray(data.solicitacoes)
        ? data.solicitacoes.map(normalizeSolicitacaoRecord)
        : [],
      counts: normalizeCounts(data.counts),
      currentUser,
      usuariosNomes: normalizeUsuariosNomes(data.usuariosNomes)
    };
  } catch (err: any) {
    return {
      success: false,
      error: extractSafeErrorMessage(
        err?.message || err,
        'Erro de comunicação ao carregar solicitações de vistoria.'
      ),
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
        error: extractSafeErrorMessage(
          (data as any)?.error,
          `Falha ao carregar histórico da solicitação (HTTP ${status}).`
        ),
        historico: [],
        usuariosNomes: {}
      };
    }

    const historico = Array.isArray(data.historico)
      ? data.historico
          .map(normalizeHistoricoRecord)
          .filter((h): h is SolicitacaoVistoriaHistoricoRecord => h !== null)
      : [];

    return {
      success: true,
      solicitacao:
        data.solicitacao && typeof data.solicitacao === 'object'
          ? normalizeSolicitacaoRecord(data.solicitacao)
          : undefined,
      historico,
      usuariosNomes: normalizeUsuariosNomes(data.usuariosNomes)
    };
  } catch (err: any) {
    return {
      success: false,
      error: extractSafeErrorMessage(
        err?.message || err,
        'Erro de comunicação ao carregar detalhes da solicitação.'
      ),
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
        code: toSafeText((data as any)?.code) || undefined,
        error: extractSafeErrorMessage(
          (data as any)?.error,
          `Não foi possível registrar a solicitação (HTTP ${status}).`
        )
      };
    }

    return {
      success: true,
      solicitacao:
        data.solicitacao && typeof data.solicitacao === 'object'
          ? normalizeSolicitacaoRecord(data.solicitacao)
          : null
    };
  } catch (err: any) {
    return {
      success: false,
      error: extractSafeErrorMessage(
        err?.message || err,
        'Erro de comunicação ao registrar solicitação de vistoria.'
      )
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
        code: toSafeText((data as any)?.code) || undefined,
        error: extractSafeErrorMessage(
          (data as any)?.error,
          `Não foi possível editar a solicitação (HTTP ${status}).`
        )
      };
    }

    return {
      success: true,
      solicitacao:
        data.solicitacao && typeof data.solicitacao === 'object'
          ? normalizeSolicitacaoRecord(data.solicitacao)
          : null
    };
  } catch (err: any) {
    return {
      success: false,
      error: extractSafeErrorMessage(
        err?.message || err,
        'Erro de comunicação ao editar solicitação de vistoria.'
      )
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
        code: toSafeText((data as any)?.code) || undefined,
        error: extractSafeErrorMessage(
          (data as any)?.error,
          `Não foi possível cancelar a solicitação (HTTP ${status}).`
        )
      };
    }

    return {
      success: true,
      solicitacao:
        data.solicitacao && typeof data.solicitacao === 'object'
          ? normalizeSolicitacaoRecord(data.solicitacao)
          : null
    };
  } catch (err: any) {
    return {
      success: false,
      error: extractSafeErrorMessage(
        err?.message || err,
        'Erro de comunicação ao cancelar solicitação de vistoria.'
      )
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
        code: toSafeText((data as any)?.code) || undefined,
        error: extractSafeErrorMessage(
          (data as any)?.error,
          `Não foi possível atualizar a observação de campo (HTTP ${status}).`
        )
      };
    }

    return {
      success: true,
      solicitacao:
        data.solicitacao && typeof data.solicitacao === 'object'
          ? normalizeSolicitacaoRecord(data.solicitacao)
          : null
    };
  } catch (err: any) {
    return {
      success: false,
      error: extractSafeErrorMessage(
        err?.message || err,
        'Erro de comunicação ao atualizar observação de campo.'
      )
    };
  }
}
