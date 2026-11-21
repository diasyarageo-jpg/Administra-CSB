// api/conciliacao-gravar.ts
import type { IncomingMessage, ServerResponse } from 'http';
import {
  authorizeSemaLookupRequest,
  scrubSensitiveTextForServerLog,
  validateTargetEntityAccess
} from '../src/server/semaAudit.js';

const VALID_ACOES = new Set(['vincular', 'rejeitar', 'encaminhar_analise']);
const VALID_CLASSIFICACOES = new Set([
  'sem_correspondencia',
  'candidato',
  'ambiguo',
  'possivel_erro_grafia',
  'papeis_diferentes',
  'vinculo_ausente',
  'confirmado_usuario',
  'nao_e_divergencia'
]);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sendJson(res: ServerResponse & { status?: any; json?: any }, status: number, payload: unknown) {
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
      if (raw.length > 262_144) {
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

function sanitizeJsonValueForAudit(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return scrubSensitiveTextForServerLog(val);
  }
  if (Array.isArray(val)) {
    return val.map(item => sanitizeJsonValueForAudit(item));
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (/^(cpf|cnpj|cpf_cnpj|cpfcnpj|docDigits)$/i.test(k)) {
        continue;
      }
      out[k] = sanitizeJsonValueForAudit(v);
    }
    return out;
  }
  return val;
}

export default async function conciliacaoGravarHandler(
  req: IncomingMessage & { body?: any; method?: string; headers?: Record<string, string | string[] | undefined> },
  res: ServerResponse & { status?: any; json?: any }
) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'POST') {
    return sendJson(res, 405, {
      success: false,
      error: 'Método não permitido. Utilize POST para gravar conciliação.'
    });
  }

  // 1. Autenticação + verificação de disponibilidade da base central/auditoria no servidor
  const authCtx = await authorizeSemaLookupRequest(req);
  if (!authCtx.configured || !authCtx.supabaseAdmin) {
    return sendJson(res, 503, {
      success: false,
      error:
        'Serviço central de banco/auditoria indisponível. Nenhuma alteração pode ser gravada no cadastro mestre sem auditoria.'
    });
  }

  if (!authCtx.authorized || !authCtx.userId) {
    return sendJson(res, authCtx.httpStatus || 401, {
      success: false,
      error: authCtx.error || 'Sessão institucional ausente ou inválida.'
    });
  }

  if (!['Administrador', 'Analista', 'Usuário'].includes(authCtx.role || '')) {
    return sendJson(res, 403, {
      success: false,
      error: 'Perfil sem permissão para registrar alterações ou decisões de conciliação.'
    });
  }

  // 2. Leitura e validação estrita do payload
  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    return sendJson(res, 400, {
      success: false,
      error: 'Corpo JSON inválido para conciliação.'
    });
  }

  const alvoTipo = String(body.alvoTipo || '').trim();
  const barragemId = String(body.barragemId || '').trim();
  const acao = String(body.acao || '').trim();
  const classificacao = String(body.classificacao || '').trim();
  const justificativaLimpa = scrubSensitiveTextForServerLog(String(body.justificativa || '').trim());

  if (alvoTipo !== 'barragem_empreendedor' && alvoTipo !== 'barragem_rt_parecer') {
    return sendJson(res, 400, {
      success: false,
      error: 'Tipo de alvo de conciliação inválido.'
    });
  }

  if (!barragemId || barragemId.length > 120) {
    return sendJson(res, 400, {
      success: false,
      error: 'Identificador da barragem alvo é obrigatório.'
    });
  }

  if (!VALID_ACOES.has(acao)) {
    return sendJson(res, 400, {
      success: false,
      error: 'Ação de conciliação inválida.'
    });
  }

  if (!VALID_CLASSIFICACOES.has(classificacao)) {
    return sendJson(res, 400, {
      success: false,
      error: 'Classificação de conciliação inválida.'
    });
  }

  if (justificativaLimpa.length < 5) {
    return sendJson(res, 400, {
      success: false,
      error: 'Justificativa objetiva (mínimo 5 caracteres) é obrigatória para auditoria.'
    });
  }

  const selectedEmpreendedorId = body.selectedEmpreendedorId
    ? String(body.selectedEmpreendedorId).trim()
    : null;
  const selectedRtId = body.selectedRtId ? String(body.selectedRtId).trim() : null;
  const selectedRtArt = body.selectedRtArt ? String(body.selectedRtArt).trim() : null;
  const selectedRtUpdatedAtSnapshot = body.selectedRtUpdatedAtSnapshot
    ? String(body.selectedRtUpdatedAtSnapshot).trim()
    : null;
  const auditoriaId = body.auditoriaId ? String(body.auditoriaId).trim() : null;

  if (auditoriaId && !UUID_REGEX.test(auditoriaId)) {
    return sendJson(res, 400, {
      success: false,
      error: 'Identificador de auditoria SEMA inválido.'
    });
  }

  if (acao === 'vincular') {
    if (alvoTipo === 'barragem_empreendedor' && !selectedEmpreendedorId) {
      return sendJson(res, 400, {
        success: false,
        error: 'Selecione o empreendedor no cadastro mestre antes de confirmar o vínculo.'
      });
    }
    if (alvoTipo === 'barragem_rt_parecer' && (!selectedRtId || !selectedRtArt)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Selecione o Responsável Técnico e informe a ART/RRT correspondente.'
      });
    }
  }

  // 3. Validação RBAC por registro alvo
  const targetAccess = await validateTargetEntityAccess(authCtx, {
    entidadeAlvoTipo: 'barragem',
    entidadeAlvoId: barragemId
  });
  if (!targetAccess.ok) {
    return sendJson(res, targetAccess.httpStatus || 403, {
      success: false,
      error: targetAccess.error || 'Sem permissão para alterar a barragem informada.'
    });
  }

  const sanitizedAuditPayload = sanitizeJsonValueForAudit(body.auditPayload || {});
  const semaCarClean = body.semaCar
    ? scrubSensitiveTextForServerLog(String(body.semaCar).trim())
    : null;

  // 4. Transação atômica no PostgreSQL: trava linha, valida concorrência, aplica alteração (se vincular) e grava auditoria
  try {
    const { data, error } = await authCtx.supabaseAdmin.rpc('executar_conciliacao_assistida', {
      p_alvo_tipo: alvoTipo,
      p_barragem_id: barragemId,
      p_acao: acao,
      p_classificacao: classificacao,
      p_justificativa: justificativaLimpa,
      p_master_updated_at_snapshot: body.masterUpdatedAtSnapshot
        ? String(body.masterUpdatedAtSnapshot).trim()
        : null,
      p_master_empreendedor_id_snapshot:
        body.masterEmpreendedorIdSnapshot !== undefined && body.masterEmpreendedorIdSnapshot !== null
          ? String(body.masterEmpreendedorIdSnapshot).trim()
          : null,
      p_selected_empreendedor_id: selectedEmpreendedorId,
      p_selected_rt_id: selectedRtId,
      p_selected_rt_art: selectedRtArt,
      p_selected_rt_updated_at_snapshot: selectedRtUpdatedAtSnapshot,
      p_auditoria_id: auditoriaId,
      p_vincular_car_da_sema: Boolean(body.vincularCarDaSema),
      p_sema_car: semaCarClean,
      p_actor_user_id: authCtx.userId,
      p_actor_login: scrubSensitiveTextForServerLog(
        authCtx.login || authCtx.userName || authCtx.userId
      ),
      p_actor_role: authCtx.role,
      p_audit_payload: sanitizedAuditPayload
    });

    if (error) {
      return sendJson(res, 500, {
        success: false,
        error: scrubSensitiveTextForServerLog(
          `Falha ao executar gravação e auditoria atômica no servidor: ${error.message}`
        )
      });
    }

    if (!data || data.success !== true) {
      const msg = scrubSensitiveTextForServerLog(
        String(data?.error || 'Falha na validação transacional ou gravação de auditoria.')
      );
      const explicitStatus = Number(data?.http_status);
      const status =
        Number.isFinite(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599
          ? explicitStatus
          : /concorr[êe]ncia|modificad|alterad/i.test(msg)
          ? 409
          : /permiss|negad|perfil/i.test(msg)
          ? 403
          : /n[ãa]o encontrad/i.test(msg)
          ? 404
          : 500;
      return sendJson(res, status, {
        success: false,
        error: msg
      });
    }

    if (!data.revisao_id) {
      return sendJson(res, 500, {
        success: false,
        error: 'Auditoria de conciliação não confirmada na transação; operação cancelada.'
      });
    }

    return sendJson(res, 200, {
      success: true,
      revisaoId: String(data.revisao_id),
      updatedAt: data.updated_at ? String(data.updated_at) : undefined,
      barragem: data.barragem ?? undefined,
      revisao: data.revisao ?? undefined
    });
  } catch (err: any) {
    return sendJson(res, 500, {
      success: false,
      error: scrubSensitiveTextForServerLog(
        err?.message || 'Erro interno ao processar conciliação assistida no servidor.'
      )
    });
  }
}
