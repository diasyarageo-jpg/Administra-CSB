// api/pendencias.ts
import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  authorizeSemaLookupRequest,
  scrubSensitiveTextForServerLog,
  type SemaAuthContext
} from '../src/server/semaAudit';

export const ALLOWED_PENDENCIA_SITUACOES = [
  'aberta',
  'direcionada',
  'em_analise',
  'resolvida',
  'cancelada'
] as const;

export type PendenciaSituacao = typeof ALLOWED_PENDENCIA_SITUACOES[number];

export const ALLOWED_PENDENCIA_HISTORICO_ACOES = [
  'criacao',
  'direcionamento',
  'mudanca_situacao',
  'edicao',
  'resolucao'
] as const;

export type PendenciaHistoricoAcao = typeof ALLOWED_PENDENCIA_HISTORICO_ACOES[number];

const VALID_SITUACOES_SET = new Set<string>(ALLOWED_PENDENCIA_SITUACOES);
const CLOSED_SITUACOES = new Set<string>(['resolvida', 'cancelada']);

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'payload',
  'rawpayload',
  'raw',
  'propriedadesbrutas',
  'properties',
  'cpf',
  'cnpj',
  'cpfcnpj',
  'cpf_cnpj',
  'nr_cpf',
  'nr_cnpj',
  'nr_cpf_cnpj',
  'documento_titular',
  'criado_por',
  'criadopor',
  'direcionado_por',
  'direcionadopor',
  'resolvido_por',
  'resolvidopor',
  'usuario_id',
  'usuarioid',
  'userid',
  'role',
  'papel'
]);

const EDITABLE_TEXT_FIELDS = [
  'tipo',
  'titulo',
  'descricao',
  'origem_ref_id',
  'tipo_referencia',
  'referencia_id',
  'empreendedor_id',
  'barragem_id'
] as const;

function sendJson(
  res: ServerResponse & { status?: any; json?: any },
  status: number,
  payload: unknown
) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(payload);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(
  req: IncomingMessage & { body?: any }
): Promise<Record<string, any> | null> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, any>;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  if (typeof (req as any).on !== 'function') {
    return null;
  }

  return new Promise(resolve => {
    let raw = '';
    let settled = false;
    const finish = (val: Record<string, any> | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    (req as any).on('data', (chunk: Buffer | string) => {
      raw += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (raw.length > 131_072) {
        finish(null);
      }
    });
    (req as any).on('end', () => {
      if (!raw.trim()) {
        finish({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        finish(parsed && typeof parsed === 'object' ? parsed : null);
      } catch {
        finish(null);
      }
    });
    (req as any).on('error', () => finish(null));
  });
}

function getQueryParams(
  req: IncomingMessage & { url?: string; query?: Record<string, string | string[] | undefined> }
): URLSearchParams {
  const params = new URLSearchParams();
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      parsed.searchParams.forEach((v, k) => params.set(k, v));
    } catch {
      // Ignora URL malformada
    }
  }
  if (req.query && typeof req.query === 'object') {
    for (const [k, v] of Object.entries(req.query)) {
      if (v === undefined) continue;
      params.set(k, Array.isArray(v) ? String(v[0] || '') : String(v));
    }
  }
  return params;
}

export function containsSensitiveCpfOrCnpj(raw: unknown): boolean {
  const text = String(raw || '').trim();
  if (!text) return false;
  if (/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(text)) return true;
  if (/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(text)) return true;
  if (/(?<![\/.\-\da-zA-Z])\d{14}(?![\/.\-\da-zA-Z])/.test(text)) return true;
  if (/(?<![\/.\-\da-zA-Z])\d{11}(?![\/.\-\da-zA-Z])/.test(text)) return true;
  return false;
}

function normalizeOptionalString(val: unknown, maxLen: number): string | null {
  if (val === undefined || val === null) return null;
  const trimmed = String(val).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function getSelfIdSet(authCtx: SemaAuthContext): Set<string> {
  const ids = new Set<string>();
  if (authCtx.userId) ids.add(String(authCtx.userId));
  if (authCtx.usuarioId) ids.add(String(authCtx.usuarioId));
  return ids;
}

function canReadPendenciaRow(
  row: Record<string, any>,
  authCtx: SemaAuthContext,
  selfIds: Set<string>
): boolean {
  if (authCtx.role === 'Administrador') return true;
  const respId = row.responsavel_id ? String(row.responsavel_id) : '';
  const criadoPor = row.criado_por ? String(row.criado_por) : '';
  if (!respId) return true;
  if (selfIds.has(respId)) return true;
  if (criadoPor && selfIds.has(criadoPor)) return true;
  return false;
}

function canMutatePendenciaRow(
  row: Record<string, any>,
  authCtx: SemaAuthContext,
  selfIds: Set<string>
): boolean {
  if (!['Administrador', 'Analista', 'Usuário'].includes(authCtx.role || '')) {
    return false;
  }
  if (authCtx.role === 'Administrador') return true;
  const respId = row.responsavel_id ? String(row.responsavel_id) : '';
  if (!respId) return true;
  return selfIds.has(respId);
}

interface UsuarioRow {
  id: string;
  auth_user_id?: string | null;
  nome?: string | null;
  login?: string | null;
  email?: string | null;
  papel?: string | null;
  setor?: string | null;
  perfil_profissional?: string | null;
  situacao?: string | null;
  status?: string | null;
}

async function fetchUsuariosDirectory(
  supabaseAdmin: NonNullable<SemaAuthContext['supabaseAdmin']>
): Promise<UsuarioRow[]> {
  const primary = await supabaseAdmin
    .from('usuarios')
    .select('id, auth_user_id, nome, login, email, papel, setor, perfil_profissional, situacao, status');

  if (!primary.error && Array.isArray(primary.data)) {
    return primary.data as UsuarioRow[];
  }

  const fallback = await supabaseAdmin
    .from('usuarios')
    .select('id, auth_user_id, nome, login, email, papel, situacao');

  if (!fallback.error && Array.isArray(fallback.data)) {
    return fallback.data as UsuarioRow[];
  }

  return [];
}

function isUsuarioActive(u: UsuarioRow): boolean {
  const sit = String(u.situacao ?? u.status ?? '')
    .trim()
    .toLowerCase();
  return sit === 'ativo';
}

function buildUsuariosNomesMap(
  usuarios: UsuarioRow[]
): Record<string, { id: string; nome: string; setor?: string; papel?: string }> {
  const map: Record<string, { id: string; nome: string; setor?: string; papel?: string }> = {};
  for (const u of usuarios) {
    const label = String(u.nome || u.login || u.email || u.id).trim();
    const entry = {
      id: String(u.id),
      nome: label,
      ...(u.setor ? { setor: String(u.setor) } : {}),
      ...(u.papel ? { papel: String(u.papel) } : {})
    };
    if (u.id) map[String(u.id)] = entry;
    if (u.auth_user_id) map[String(u.auth_user_id)] = entry;
  }
  return map;
}

function isMissingOptionalColumnError(error: any, colName: string): boolean {
  const code = String(error?.code || '');
  const msg = String(error?.message || '');
  return (code === '42703' || code === 'PGRST204') && msg.toLowerCase().includes(colName.toLowerCase());
}

function isFkUsuariosError(error: any): boolean {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return code === '23503' && msg.includes('usuarios');
}

function isNotNullIdError(error: any): boolean {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return code === '23502' && msg.includes('id');
}

async function insertPendenciaRowWithAdaptiveCompat(
  supabaseAdmin: NonNullable<SemaAuthContext['supabaseAdmin']>,
  baseRow: Record<string, any>,
  actorAuthId: string,
  actorUsuarioId?: string | null,
  targetUsuarioId?: string | null
): Promise<{ data: any; error: any; resolvedActorId: string }> {
  let payload: Record<string, any> = { ...baseRow };
  let resolvedActorId = actorAuthId;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await supabaseAdmin
      .from('pendencias')
      .insert(payload)
      .select()
      .single();

    if (!res.error && res.data) {
      return { data: res.data, error: null, resolvedActorId };
    }

    const err = res.error;
    if (isNotNullIdError(err) && !payload.id) {
      payload = { ...payload, id: crypto.randomUUID() };
      continue;
    }

    if (isFkUsuariosError(err) && actorUsuarioId && resolvedActorId !== actorUsuarioId) {
      resolvedActorId = actorUsuarioId;
      payload = {
        ...payload,
        criado_por: actorUsuarioId,
        ...(payload.direcionado_por ? { direcionado_por: actorUsuarioId } : {}),
        ...(payload.responsavel_id && targetUsuarioId ? { responsavel_id: targetUsuarioId } : {})
      };
      continue;
    }

    let strippedOptional = false;
    for (const optCol of ['direcionado_em', 'resolvido_em', 'motivo']) {
      if (optCol in payload && isMissingOptionalColumnError(err, optCol)) {
        const next = { ...payload };
        delete next[optCol];
        payload = next;
        strippedOptional = true;
        break;
      }
    }
    if (strippedOptional) continue;

    return { data: null, error: err, resolvedActorId };
  }

  return {
    data: null,
    error: { message: 'Falha ao inserir pendência após tentativas de compatibilidade.' },
    resolvedActorId
  };
}

async function updatePendenciaRowWithAdaptiveCompat(
  supabaseAdmin: NonNullable<SemaAuthContext['supabaseAdmin']>,
  pendenciaId: string,
  basePatch: Record<string, any>,
  actorAuthId: string,
  actorUsuarioId?: string | null,
  targetUsuarioId?: string | null
): Promise<{ data: any; error: any; resolvedActorId: string }> {
  let patch: Record<string, any> = { ...basePatch };
  let resolvedActorId = actorAuthId;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await supabaseAdmin
      .from('pendencias')
      .update(patch)
      .eq('id', pendenciaId)
      .select()
      .single();

    if (!res.error && res.data) {
      return { data: res.data, error: null, resolvedActorId };
    }

    const err = res.error;
    if (isFkUsuariosError(err) && actorUsuarioId && resolvedActorId !== actorUsuarioId) {
      resolvedActorId = actorUsuarioId;
      const next = { ...patch };
      if (next.direcionado_por) next.direcionado_por = actorUsuarioId;
      if (next.resolvido_por) next.resolvido_por = actorUsuarioId;
      if (next.responsavel_id && targetUsuarioId) next.responsavel_id = targetUsuarioId;
      patch = next;
      continue;
    }

    let strippedOptional = false;
    for (const optCol of ['direcionado_em', 'resolvido_em', 'motivo']) {
      if (optCol in patch && isMissingOptionalColumnError(err, optCol)) {
        const next = { ...patch };
        delete next[optCol];
        patch = next;
        strippedOptional = true;
        break;
      }
    }
    if (strippedOptional) continue;

    return { data: null, error: err, resolvedActorId };
  }

  return {
    data: null,
    error: { message: 'Falha ao atualizar pendência após tentativas de compatibilidade.' },
    resolvedActorId
  };
}

interface HistoricoEntryInput {
  pendencia_id: string;
  acao: PendenciaHistoricoAcao;
  campo: string;
  valor_anterior: string | null;
  valor_novo: string | null;
  usuario_id: string;
  motivo: string | null;
  created_at: string;
}

async function insertHistoricoAppendOnly(
  supabaseAdmin: NonNullable<SemaAuthContext['supabaseAdmin']>,
  entries: HistoricoEntryInput[],
  actorUsuarioId?: string | null
): Promise<{ data: any[]; error: any }> {
  if (entries.length === 0) return { data: [], error: null };

  let rowsToInsert: Record<string, any>[] = entries.map(e => ({
    pendencia_id: e.pendencia_id,
    acao: e.acao,
    campo: e.campo,
    valor_anterior: e.valor_anterior !== null ? scrubSensitiveTextForServerLog(e.valor_anterior) : null,
    valor_novo: e.valor_novo !== null ? scrubSensitiveTextForServerLog(e.valor_novo) : null,
    usuario_id: e.usuario_id,
    motivo: e.motivo !== null ? scrubSensitiveTextForServerLog(e.motivo) : null,
    created_at: e.created_at
  }));

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await supabaseAdmin
      .from('pendencias_historico')
      .insert(rowsToInsert)
      .select();

    if (!res.error) {
      return { data: Array.isArray(res.data) ? res.data : rowsToInsert, error: null };
    }

    const err = res.error;
    if (isNotNullIdError(err) && !rowsToInsert[0]?.id) {
      rowsToInsert = rowsToInsert.map(r => ({ ...r, id: crypto.randomUUID() }));
      continue;
    }

    if (isFkUsuariosError(err) && actorUsuarioId && rowsToInsert[0]?.usuario_id !== actorUsuarioId) {
      rowsToInsert = rowsToInsert.map(r => ({ ...r, usuario_id: actorUsuarioId }));
      continue;
    }

    return { data: [], error: err };
  }

  return { data: [], error: { message: 'Falha ao registrar histórico de pendência.' } };
}

function validateBodySafetyAndNoSpoof(body: Record<string, any>): string | null {
  for (const key of Object.keys(body)) {
    const normKey = key.toLowerCase();
    if (FORBIDDEN_PAYLOAD_KEYS.has(normKey)) {
      return `Campo não permitido no corpo da requisição ("${key}"). Utilize somente campos e IDs de referência permitidos.`;
    }
    const val = body[key];
    if (typeof val === 'object' && val !== null) {
      return `Não é permitido enviar objetos ou cópias de payload em "${key}". Utilize somente identificadores de referência.`;
    }
  }

  const textFieldsToScan = ['tipo', 'titulo', 'descricao', 'motivo', 'tipo_referencia'];
  for (const field of textFieldsToScan) {
    if (body[field] !== undefined && body[field] !== null && containsSensitiveCpfOrCnpj(body[field])) {
      return 'Não é permitido gravar CPF/CNPJ em pendências. Utilize apenas os IDs de referência dos cadastros.';
    }
  }

  const refFieldsToScan = ['origem_ref_id', 'referencia_id', 'empreendedor_id', 'barragem_id'];
  for (const field of refFieldsToScan) {
    const val = String(body[field] || '').trim();
    if (!val) continue;
    if (/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(val) || /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(val)) {
      return 'Não é permitido gravar CPF/CNPJ nos campos de referência. Utilize apenas os IDs dos cadastros.';
    }
  }

  return null;
}

export default async function pendenciasHandler(
  req: IncomingMessage & {
    body?: any;
    method?: string;
    url?: string;
    query?: Record<string, string | string[] | undefined>;
    headers?: Record<string, string | string[] | undefined>;
  },
  res: ServerResponse & { status?: any; json?: any }
) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') {
    return sendJson(res, 405, {
      success: false,
      error: 'Método não permitido. Utilize GET ou POST.'
    });
  }

  // 1. Autenticação obrigatória via sessão verificada no servidor
  const authCtx = await authorizeSemaLookupRequest(req);
  if (!authCtx.configured) {
    return sendJson(res, 503, {
      success: false,
      error:
        'Serviço central de pendências indisponível no servidor. Verifique a configuração da base central.'
    });
  }

  if (!authCtx.authorized || !authCtx.userId) {
    return sendJson(res, authCtx.httpStatus || 401, {
      success: false,
      error: authCtx.error || 'Sessão institucional ausente ou inválida.'
    });
  }

  if (!authCtx.supabaseAdmin) {
    return sendJson(res, 503, {
      success: false,
      error:
        'Serviço central de pendências indisponível no servidor. Verifique a configuração da base central.'
    });
  }

  const supabaseAdmin = authCtx.supabaseAdmin;
  const selfIds = getSelfIdSet(authCtx);
  const isAdmin = authCtx.role === 'Administrador';

  // ==================== GET: LISTAGEM / DETALHE + HISTÓRICO ====================
  if (method === 'GET') {
    const query = getQueryParams(req);
    const tab = String(query.get('tab') || 'geral').trim().toLowerCase();
    const situacaoFiltro = String(query.get('situacao') || '').trim().toLowerCase();
    const pendenciaId = String(query.get('pendenciaId') || '').trim();

    if (tab !== 'minhas' && tab !== 'geral' && tab !== 'direcionado') {
      return sendJson(res, 400, {
        success: false,
        error: 'Aba solicitada é inválida.'
      });
    }

    if (tab === 'direcionado' && !isAdmin) {
      return sendJson(res, 403, {
        success: false,
        error: 'A aba Direcionado é visível somente para o perfil Administrador.'
      });
    }

    if (situacaoFiltro && situacaoFiltro !== 'todas' && !VALID_SITUACOES_SET.has(situacaoFiltro)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Situação de filtro inválida.'
      });
    }

    try {
      const usuarios = await fetchUsuariosDirectory(supabaseAdmin);
      const usuariosNomes = buildUsuariosNomesMap(usuarios);

      if (pendenciaId) {
        const { data: item, error: itemErr } = await supabaseAdmin
          .from('pendencias')
          .select('*')
          .eq('id', pendenciaId)
          .maybeSingle();

        if (itemErr) {
          return sendJson(res, 500, {
            success: false,
            error: scrubSensitiveTextForServerLog(`Erro ao consultar pendência: ${itemErr.message}`)
          });
        }

        if (!item) {
          return sendJson(res, 404, {
            success: false,
            error: 'Pendência não encontrada.'
          });
        }

        if (!canReadPendenciaRow(item, authCtx, selfIds)) {
          return sendJson(res, 403, {
            success: false,
            error: 'Sem permissão para visualizar esta pendência.'
          });
        }

        const { data: histRows, error: histErr } = await supabaseAdmin
          .from('pendencias_historico')
          .select('id, pendencia_id, acao, campo, valor_anterior, valor_novo, usuario_id, motivo, created_at')
          .eq('pendencia_id', pendenciaId)
          .order('created_at', { ascending: false });

        if (histErr) {
          return sendJson(res, 500, {
            success: false,
            error: scrubSensitiveTextForServerLog(
              `Erro ao consultar histórico da pendência: ${histErr.message}`
            )
          });
        }

        return sendJson(res, 200, {
          success: true,
          pendencia: item,
          historico: Array.isArray(histRows) ? histRows : [],
          usuariosNomes,
          ...(isAdmin
            ? {
                usuariosDirecionaveis: usuarios
                  .filter(isUsuarioActive)
                  .map(u => ({
                    id: String(u.id),
                    authUserId: u.auth_user_id ? String(u.auth_user_id) : null,
                    nome: String(u.nome || u.login || u.email || u.id).trim(),
                    login: u.login ? String(u.login) : '',
                    setor: u.setor ? String(u.setor) : '',
                    papel: u.papel ? String(u.papel) : 'Usuário'
                  }))
              }
            : {})
        });
      }

      const { data: allRows, error: listErr } = await supabaseAdmin
        .from('pendencias')
        .select('*')
        .order('updated_at', { ascending: false });

      if (listErr) {
        return sendJson(res, 500, {
          success: false,
          error: scrubSensitiveTextForServerLog(`Erro ao carregar pendências: ${listErr.message}`)
        });
      }

      const rows = Array.isArray(allRows) ? allRows : [];
      const minhasRows = rows.filter(r => Boolean(r.responsavel_id && selfIds.has(String(r.responsavel_id))));
      const geralRows = isAdmin
        ? rows
        : rows.filter(r => canReadPendenciaRow(r, authCtx, selfIds));
      const direcionadoRows = isAdmin ? rows.filter(r => Boolean(r.responsavel_id)) : [];

      let tabRows = tab === 'minhas' ? minhasRows : tab === 'direcionado' ? direcionadoRows : geralRows;
      if (situacaoFiltro && situacaoFiltro !== 'todas') {
        tabRows = tabRows.filter(r => String(r.situacao || '').toLowerCase() === situacaoFiltro);
      }

      return sendJson(res, 200, {
        success: true,
        tab,
        role: authCtx.role,
        currentUser: {
          userId: authCtx.userId,
          usuarioId: authCtx.usuarioId || null,
          nome: authCtx.userName || authCtx.login || authCtx.userId
        },
        counts: {
          minhas: minhasRows.length,
          geral: geralRows.length,
          ...(isAdmin ? { direcionado: direcionadoRows.length } : {})
        },
        pendencias: tabRows,
        usuariosNomes,
        ...(isAdmin
          ? {
              usuariosDirecionaveis: usuarios
                .filter(isUsuarioActive)
                .map(u => ({
                  id: String(u.id),
                  authUserId: u.auth_user_id ? String(u.auth_user_id) : null,
                  nome: String(u.nome || u.login || u.email || u.id).trim(),
                  login: u.login ? String(u.login) : '',
                  setor: u.setor ? String(u.setor) : '',
                  papel: u.papel ? String(u.papel) : 'Usuário'
                }))
            }
          : {})
      });
    } catch (err: any) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          err?.message || 'Erro interno ao consultar módulo de pendências.'
        )
      });
    }
  }

  // ==================== POST / PATCH: MUTAÇÕES COM HISTÓRICO ====================
  if (!['Administrador', 'Analista', 'Usuário'].includes(authCtx.role || '')) {
    return sendJson(res, 403, {
      success: false,
      error: 'Perfil Visualizador não possui permissão para criar ou alterar pendências.'
    });
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    return sendJson(res, 400, {
      success: false,
      error: 'Corpo JSON inválido.'
    });
  }

  const safetyErr = validateBodySafetyAndNoSpoof(body);
  if (safetyErr) {
    return sendJson(res, 400, {
      success: false,
      error: safetyErr
    });
  }

  const action = String(body.action || 'criar').trim().toLowerCase();
  const nowIso = new Date().toISOString();

  // --- AÇÃO 1: CRIAR ---
  if (action === 'criar') {
    const requestedRespRaw = normalizeOptionalString(
      body.responsavel_id ?? body.responsavelUsuarioId,
      120
    );

    if (!isAdmin && requestedRespRaw) {
      return sendJson(res, 403, {
        success: false,
        error: 'Usuários não administradores não podem escolher nem atribuir responsável.'
      });
    }

    const titulo = normalizeOptionalString(body.titulo, 200);
    const tipo = normalizeOptionalString(body.tipo, 100);
    const descricao = normalizeOptionalString(body.descricao, 2000);
    const origemRefId = normalizeOptionalString(body.origem_ref_id, 120);
    const tipoReferencia = normalizeOptionalString(body.tipo_referencia, 80);
    const referenciaId = normalizeOptionalString(body.referencia_id, 120);
    const empreendedorId = normalizeOptionalString(body.empreendedor_id, 120);
    const barragemId = normalizeOptionalString(body.barragem_id, 120);
    const motivo = normalizeOptionalString(body.motivo, 500);

    if (!titulo || titulo.length < 3) {
      return sendJson(res, 400, {
        success: false,
        error: 'Informe um título com pelo menos 3 caracteres.'
      });
    }
    if (!tipo) {
      return sendJson(res, 400, {
        success: false,
        error: 'Informe o tipo da pendência.'
      });
    }

    let resolvedRespId: string | null = null;
    let targetUsuarioId: string | null = null;
    if (isAdmin && requestedRespRaw) {
      const usuarios = await fetchUsuariosDirectory(supabaseAdmin);
      const targetUser = usuarios.find(
        u =>
          String(u.id) === requestedRespRaw ||
          (u.auth_user_id && String(u.auth_user_id) === requestedRespRaw)
      );
      if (!targetUser || !isUsuarioActive(targetUser)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Usuário responsável selecionado não foi encontrado ou está inativo.'
        });
      }
      targetUsuarioId = String(targetUser.id);
      resolvedRespId = targetUser.auth_user_id ? String(targetUser.auth_user_id) : String(targetUser.id);
    }

    const initialSituacao: PendenciaSituacao = resolvedRespId ? 'direcionada' : 'aberta';
    const newRow: Record<string, any> = {
      origem: 'Administra',
      origem_ref_id: origemRefId,
      tipo,
      titulo,
      descricao,
      situacao: initialSituacao,
      responsavel_id: resolvedRespId,
      criado_por: authCtx.userId,
      direcionado_por: resolvedRespId ? authCtx.userId : null,
      direcionado_em: resolvedRespId ? nowIso : null,
      resolvido_por: null,
      resolvido_em: null,
      tipo_referencia: tipoReferencia,
      referencia_id: referenciaId,
      empreendedor_id: empreendedorId,
      barragem_id: barragemId,
      motivo,
      created_at: nowIso,
      updated_at: nowIso
    };

    const insertRes = await insertPendenciaRowWithAdaptiveCompat(
      supabaseAdmin,
      newRow,
      authCtx.userId,
      authCtx.usuarioId,
      targetUsuarioId
    );

    if (insertRes.error || !insertRes.data) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Falha ao criar pendência: ${insertRes.error?.message || 'Erro desconhecido.'}`
        )
      });
    }

    const created = insertRes.data;
    const histEntries: HistoricoEntryInput[] = [
      {
        pendencia_id: String(created.id),
        acao: 'criacao',
        campo: 'situacao',
        valor_anterior: null,
        valor_novo: String(created.situacao || initialSituacao),
        usuario_id: insertRes.resolvedActorId,
        motivo: motivo || 'Criação da pendência',
        created_at: nowIso
      }
    ];

    if (created.responsavel_id) {
      histEntries.push({
        pendencia_id: String(created.id),
        acao: 'direcionamento',
        campo: 'responsavel_id',
        valor_anterior: null,
        valor_novo: String(created.responsavel_id),
        usuario_id: insertRes.resolvedActorId,
        motivo: motivo || 'Direcionamento inicial na criação',
        created_at: nowIso
      });
    }

    const histRes = await insertHistoricoAppendOnly(supabaseAdmin, histEntries, authCtx.usuarioId);
    if (histRes.error) {
      // Não deixa registro de pendência sem histórico auditável; nunca altera nem apaga pendencias_historico.
      try {
        await supabaseAdmin.from('pendencias').delete().eq('id', created.id);
      } catch {
        // Melhor-esforço de reversão da pendência recém-criada
      }
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Falha ao gravar histórico da pendência; operação cancelada: ${histRes.error.message}`
        )
      });
    }

    return sendJson(res, 201, {
      success: true,
      pendencia: created,
      historico: histRes.data
    });
  }

  // --- AÇÕES SOBRE PENDÊNCIA EXISTENTE ---
  const pendenciaId = normalizeOptionalString(body.pendenciaId ?? body.id, 120);
  if (!pendenciaId) {
    return sendJson(res, 400, {
      success: false,
      error: 'Identificador da pendência é obrigatório.'
    });
  }

  const { data: current, error: fetchErr } = await supabaseAdmin
    .from('pendencias')
    .select('*')
    .eq('id', pendenciaId)
    .maybeSingle();

  if (fetchErr) {
    return sendJson(res, 500, {
      success: false,
      error: scrubSensitiveTextForServerLog(`Erro ao localizar pendência: ${fetchErr.message}`)
    });
  }

  if (!current) {
    return sendJson(res, 404, {
      success: false,
      error: 'Pendência não encontrada.'
    });
  }

  const currentSituacao = String(current.situacao || 'aberta').toLowerCase();

  // --- AÇÃO 2: DIRECIONAR (ADMIN ONLY) ---
  if (action === 'direcionar') {
    if (!isAdmin) {
      return sendJson(res, 403, {
        success: false,
        error: 'Apenas Administradores podem direcionar ou alterar o responsável de uma pendência.'
      });
    }

    if (CLOSED_SITUACOES.has(currentSituacao)) {
      return sendJson(res, 409, {
        success: false,
        error: 'Não é possível direcionar uma pendência já resolvida ou cancelada.'
      });
    }

    const targetRaw = normalizeOptionalString(
      body.responsavel_id ?? body.responsavelUsuarioId,
      120
    );
    if (!targetRaw) {
      return sendJson(res, 400, {
        success: false,
        error: 'Selecione um usuário ativo para direcionar a pendência.'
      });
    }

    const usuarios = await fetchUsuariosDirectory(supabaseAdmin);
    const targetUser = usuarios.find(
      u =>
        String(u.id) === targetRaw ||
        (u.auth_user_id && String(u.auth_user_id) === targetRaw)
    );
    if (!targetUser || !isUsuarioActive(targetUser)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Usuário selecionado não encontrado ou inativo.'
      });
    }

    const nextRespId = targetUser.auth_user_id
      ? String(targetUser.auth_user_id)
      : String(targetUser.id);
    const prevRespId = current.responsavel_id ? String(current.responsavel_id) : null;
    const motivo = normalizeOptionalString(body.motivo, 500);

    if (prevRespId && (prevRespId === nextRespId || prevRespId === String(targetUser.id))) {
      return sendJson(res, 400, {
        success: false,
        error: 'A pendência já está direcionada para este usuário.'
      });
    }

    const nextSituacao: PendenciaSituacao =
      currentSituacao === 'aberta' ? 'direcionada' : (currentSituacao as PendenciaSituacao);

    const patch: Record<string, any> = {
      responsavel_id: nextRespId,
      direcionado_por: authCtx.userId,
      direcionado_em: nowIso,
      situacao: nextSituacao,
      updated_at: nowIso
    };

    const updRes = await updatePendenciaRowWithAdaptiveCompat(
      supabaseAdmin,
      pendenciaId,
      patch,
      authCtx.userId,
      authCtx.usuarioId,
      String(targetUser.id)
    );

    if (updRes.error || !updRes.data) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Erro ao direcionar pendência: ${updRes.error?.message || 'Falha no servidor.'}`
        )
      });
    }

    const updated = updRes.data;
    const histEntries: HistoricoEntryInput[] = [
      {
        pendencia_id: pendenciaId,
        acao: 'direcionamento',
        campo: 'responsavel_id',
        valor_anterior: prevRespId,
        valor_novo: String(updated.responsavel_id || nextRespId),
        usuario_id: updRes.resolvedActorId,
        motivo: motivo || 'Direcionamento de responsável',
        created_at: nowIso
      }
    ];

    if (nextSituacao !== currentSituacao) {
      histEntries.push({
        pendencia_id: pendenciaId,
        acao: 'mudanca_situacao',
        campo: 'situacao',
        valor_anterior: currentSituacao,
        valor_novo: nextSituacao,
        usuario_id: updRes.resolvedActorId,
        motivo: motivo || 'Situação atualizada ao direcionar',
        created_at: nowIso
      });
    }

    const histRes = await insertHistoricoAppendOnly(supabaseAdmin, histEntries, authCtx.usuarioId);
    if (histRes.error) {
      await updatePendenciaRowWithAdaptiveCompat(
        supabaseAdmin,
        pendenciaId,
        {
          responsavel_id: current.responsavel_id ?? null,
          direcionado_por: current.direcionado_por ?? null,
          direcionado_em: current.direcionado_em ?? null,
          situacao: current.situacao,
          updated_at: current.updated_at || nowIso
        },
        authCtx.userId,
        authCtx.usuarioId
      );
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Falha ao registrar histórico de direcionamento: ${histRes.error.message}`
        )
      });
    }

    return sendJson(res, 200, {
      success: true,
      pendencia: updated,
      historico: histRes.data
    });
  }

  // Para editar / alterar_situacao / resolver: verifica se usuário está autorizado na pendência
  if (!canMutatePendenciaRow(current, authCtx, selfIds)) {
    return sendJson(res, 403, {
      success: false,
      error:
        'Sem permissão para alterar esta pendência. Pendências atribuídas a outro responsável são geridas pelo responsável designado ou por um Administrador.'
    });
  }

  // --- AÇÃO 3: MUDAR SITUAÇÃO ---
  if (action === 'alterar_situacao') {
    const novaSituacao = String(body.situacao || '').trim().toLowerCase();
    const motivo = normalizeOptionalString(body.motivo, 500);

    if (!VALID_SITUACOES_SET.has(novaSituacao)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Situação informada não é permitida.'
      });
    }

    if (novaSituacao === currentSituacao) {
      return sendJson(res, 400, {
        success: false,
        error: 'A pendência já se encontra nessa situação.'
      });
    }

    if (novaSituacao === 'direcionada' && !current.responsavel_id) {
      return sendJson(res, isAdmin ? 400 : 403, {
        success: false,
        error: isAdmin
          ? 'Para definir a situação como Direcionada, utilize a ação Direcionar e selecione um responsável.'
          : 'Somente Administradores podem direcionar pendências sem responsável.'
      });
    }

    if ((novaSituacao === 'resolvida' || novaSituacao === 'cancelada') && (!motivo || motivo.length < 3)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Informe o motivo (mínimo 3 caracteres) para resolver ou cancelar a pendência.'
      });
    }

    const patch: Record<string, any> = {
      situacao: novaSituacao,
      updated_at: nowIso,
      ...(motivo ? { motivo } : {}),
      ...(novaSituacao === 'resolvida'
        ? { resolvido_por: authCtx.userId, resolvido_em: nowIso }
        : currentSituacao === 'resolvida'
        ? { resolvido_por: null, resolvido_em: null }
        : {})
    };

    const updRes = await updatePendenciaRowWithAdaptiveCompat(
      supabaseAdmin,
      pendenciaId,
      patch,
      authCtx.userId,
      authCtx.usuarioId
    );

    if (updRes.error || !updRes.data) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Erro ao atualizar situação da pendência: ${updRes.error?.message || 'Falha no servidor.'}`
        )
      });
    }

    const histEntries: HistoricoEntryInput[] = [
      {
        pendencia_id: pendenciaId,
        acao: novaSituacao === 'resolvida' ? 'resolucao' : 'mudanca_situacao',
        campo: 'situacao',
        valor_anterior: currentSituacao,
        valor_novo: novaSituacao,
        usuario_id: updRes.resolvedActorId,
        motivo: motivo || `Situação alterada para ${novaSituacao}`,
        created_at: nowIso
      }
    ];

    const histRes = await insertHistoricoAppendOnly(supabaseAdmin, histEntries, authCtx.usuarioId);
    if (histRes.error) {
      await updatePendenciaRowWithAdaptiveCompat(
        supabaseAdmin,
        pendenciaId,
        {
          situacao: current.situacao,
          motivo: current.motivo ?? null,
          resolvido_por: current.resolvido_por ?? null,
          resolvido_em: current.resolvido_em ?? null,
          updated_at: current.updated_at || nowIso
        },
        authCtx.userId,
        authCtx.usuarioId
      );
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Falha ao registrar histórico de mudança de situação: ${histRes.error.message}`
        )
      });
    }

    return sendJson(res, 200, {
      success: true,
      pendencia: updRes.data,
      historico: histRes.data
    });
  }

  // --- AÇÃO 4: EDITAR ---
  if (action === 'editar') {
    if (!isAdmin && (body.responsavel_id !== undefined || body.responsavelUsuarioId !== undefined)) {
      return sendJson(res, 403, {
        success: false,
        error: 'Usuários não administradores não podem alterar o responsável da pendência.'
      });
    }

    if (CLOSED_SITUACOES.has(currentSituacao)) {
      return sendJson(res, 409, {
        success: false,
        error: 'Pendências resolvidas ou canceladas não podem ser editadas diretamente.'
      });
    }

    const motivo = normalizeOptionalString(body.motivo, 500);
    const patch: Record<string, any> = {};
    const diffs: Array<{ campo: string; valor_anterior: string | null; valor_novo: string | null }> = [];

    for (const field of EDITABLE_TEXT_FIELDS) {
      if (!(field in body)) continue;
      const maxLen = field === 'descricao' ? 2000 : field === 'titulo' ? 200 : 120;
      const nextVal = normalizeOptionalString(body[field], maxLen);
      const prevVal = current[field] !== undefined && current[field] !== null && String(current[field]).trim() !== ''
        ? String(current[field]).trim()
        : null;

      if (field === 'titulo' && (!nextVal || nextVal.length < 3)) {
        return sendJson(res, 400, {
          success: false,
          error: 'O título deve ter pelo menos 3 caracteres.'
        });
      }
      if (field === 'tipo' && !nextVal) {
        return sendJson(res, 400, {
          success: false,
          error: 'O tipo da pendência é obrigatório.'
        });
      }

      if (nextVal !== prevVal) {
        patch[field] = nextVal;
        diffs.push({
          campo: field,
          valor_anterior: prevVal,
          valor_novo: nextVal
        });
      }
    }

    if (diffs.length === 0) {
      return sendJson(res, 400, {
        success: false,
        error: 'Nenhuma alteração identificada nos campos da pendência.'
      });
    }

    patch.updated_at = nowIso;

    const updRes = await updatePendenciaRowWithAdaptiveCompat(
      supabaseAdmin,
      pendenciaId,
      patch,
      authCtx.userId,
      authCtx.usuarioId
    );

    if (updRes.error || !updRes.data) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Erro ao editar pendência: ${updRes.error?.message || 'Falha no servidor.'}`
        )
      });
    }

    const histEntries: HistoricoEntryInput[] = diffs.map(d => ({
      pendencia_id: pendenciaId,
      acao: 'edicao',
      campo: d.campo,
      valor_anterior: d.valor_anterior,
      valor_novo: d.valor_novo,
      usuario_id: updRes.resolvedActorId,
      motivo: motivo || `Edição do campo ${d.campo}`,
      created_at: nowIso
    }));

    const histRes = await insertHistoricoAppendOnly(supabaseAdmin, histEntries, authCtx.usuarioId);
    if (histRes.error) {
      const revertPatch: Record<string, any> = { updated_at: current.updated_at || nowIso };
      for (const d of diffs) {
        revertPatch[d.campo] = d.valor_anterior;
      }
      await updatePendenciaRowWithAdaptiveCompat(
        supabaseAdmin,
        pendenciaId,
        revertPatch,
        authCtx.userId,
        authCtx.usuarioId
      );
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Falha ao registrar histórico de edição: ${histRes.error.message}`
        )
      });
    }

    return sendJson(res, 200, {
      success: true,
      pendencia: updRes.data,
      historico: histRes.data
    });
  }

  // --- AÇÃO 5: RESOLVER ---
  if (action === 'resolver') {
    if (CLOSED_SITUACOES.has(currentSituacao)) {
      return sendJson(res, 409, {
        success: false,
        error: 'Esta pendência já está resolvida ou cancelada.'
      });
    }

    const motivo = normalizeOptionalString(body.motivo, 500);
    if (!motivo || motivo.length < 3) {
      return sendJson(res, 400, {
        success: false,
        error: 'Informe o motivo / observação da resolução (mínimo 3 caracteres).'
      });
    }

    const patch: Record<string, any> = {
      situacao: 'resolvida',
      resolvido_por: authCtx.userId,
      resolvido_em: nowIso,
      motivo,
      updated_at: nowIso
    };

    const updRes = await updatePendenciaRowWithAdaptiveCompat(
      supabaseAdmin,
      pendenciaId,
      patch,
      authCtx.userId,
      authCtx.usuarioId
    );

    if (updRes.error || !updRes.data) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Erro ao resolver pendência: ${updRes.error?.message || 'Falha no servidor.'}`
        )
      });
    }

    const histEntries: HistoricoEntryInput[] = [
      {
        pendencia_id: pendenciaId,
        acao: 'resolucao',
        campo: 'situacao',
        valor_anterior: currentSituacao,
        valor_novo: 'resolvida',
        usuario_id: updRes.resolvedActorId,
        motivo,
        created_at: nowIso
      }
    ];

    const histRes = await insertHistoricoAppendOnly(supabaseAdmin, histEntries, authCtx.usuarioId);
    if (histRes.error) {
      await updatePendenciaRowWithAdaptiveCompat(
        supabaseAdmin,
        pendenciaId,
        {
          situacao: current.situacao,
          resolvido_por: current.resolvido_por ?? null,
          resolvido_em: current.resolvido_em ?? null,
          motivo: current.motivo ?? null,
          updated_at: current.updated_at || nowIso
        },
        authCtx.userId,
        authCtx.usuarioId
      );
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Falha ao registrar histórico de resolução: ${histRes.error.message}`
        )
      });
    }

    return sendJson(res, 200, {
      success: true,
      pendencia: updRes.data,
      historico: histRes.data
    });
  }

  return sendJson(res, 400, {
    success: false,
    error: `Ação "${action}" não reconhecida para pendências.`
  });
}
