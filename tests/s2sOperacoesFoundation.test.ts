// tests/s2sOperacoesFoundation.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import resourceHandler from '../api/v2/[resource]';
import {
  buildS2sCanonicalMessage,
  canonicalizeQueryString,
  normalizeContentType,
  normalizePublicPath,
  sha256BodyHexLower
} from '../src/server/s2sAuth';
import { S2S_OPERACOES_MAX_BODY_BYTES, S2S_OPERATIONS_REGISTRY } from '../src/server/s2sOperacoes';
import { setTestSupabaseAdminForSemaAudit } from '../src/server/semaAudit';

const ROOT_DIR = process.cwd();
const MIGRATION_PATH = path.join(
  ROOT_DIR,
  'supabase',
  'migrations',
  '20261127_s2s_politicas_e_operacoes.sql'
);

// CPFs/CNPJs matematicamente válidos apenas para testes unitários
const VALID_CPF_A = '52998224725';
const VALID_CPF_B = '11144477735';
const VALID_CNPJ_A = '11222333000181';

interface MockClient {
  sistema: 'notifica' | 'classifica' | 'fiscaliza';
  kid: string;
  public_key_pem: string;
  escopos: string[];
  ativo: boolean;
}

interface MockPolicy {
  id: string;
  sistema_origem: 'notifica' | 'classifica' | 'fiscaliza';
  operacao: string;
  modo: 'execucao_direta' | 'proposta_aprovacao';
  ativo: boolean;
  parametros: Record<string, any>;
  restricoes: Record<string, any>;
  criado_por_uid: string;
  criado_por_login: string;
  atualizado_por_uid: string;
  atualizado_por_login: string;
  motivo_ultima_alteracao: string | null;
  created_at: string;
  updated_at: string;
}

interface MockUsuario {
  id: string;
  auth_user_id: string;
  papel: 'Administrador' | 'Analista' | 'Usuário' | 'Visualizador';
  situacao: 'Ativo' | 'Inativo' | 'Pendente' | 'Recusado';
  status?: string;
  login: string;
  nome: string;
}

function createKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString('utf8');
  return { publicKeyPem, privateKey };
}

function createMockRes() {
  let statusCode = 200;
  let body: any = null;
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = String(v);
    },
    getHeader(k: string) {
      return headers[k.toLowerCase()];
    },
    status(code: number) {
      statusCode = code;
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      body = data;
      return res;
    },
    end(raw?: string) {
      if (raw !== undefined && body === null) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      return res;
    },
    getStatus: () => statusCode,
    getBody: () => body,
    getHeaders: () => headers
  };
  return res;
}

function createSignedS2sRequest(opts: {
  method?: string;
  url: string;
  signedUrl?: string;
  kid: string;
  privateKey: crypto.KeyObject;
  body?: unknown;
  rawBodyOverride?: Buffer;
  contentType?: string;
  timestamp?: number;
  jti?: string;
  consumerUserId?: string;
  consumerRole?: string;
  extraHeaders?: Record<string, string>;
  query?: Record<string, string | string[] | undefined>;
}) {
  const method = (opts.method || 'POST').toUpperCase();
  const rawBody =
    opts.rawBodyOverride !== undefined
      ? opts.rawBodyOverride
      : opts.body === undefined
      ? Buffer.alloc(0)
      : Buffer.from(JSON.stringify(opts.body), 'utf8');
  const contentType =
    opts.contentType !== undefined
      ? opts.contentType
      : rawBody.length > 0
      ? 'application/json; charset=utf-8'
      : '';
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const jti = opts.jti ?? crypto.randomUUID();
  const bodySha = sha256BodyHexLower(rawBody);

  const urlToSign = opts.signedUrl || opts.url;
  const qIdx = urlToSign.indexOf('?');
  const rawPath = qIdx === -1 ? urlToSign : urlToSign.slice(0, qIdx);
  const rawQuery = qIdx === -1 ? '' : urlToSign.slice(qIdx + 1);

  const canonicalMessage = buildS2sCanonicalMessage({
    method,
    normalizedPath: normalizePublicPath(rawPath),
    canonicalQuery: canonicalizeQueryString(rawQuery),
    contentTypeNormalized: normalizeContentType(contentType),
    bodySha256HexLower: bodySha,
    kid: opts.kid,
    timestamp,
    jti,
    consumerUserId: opts.consumerUserId ?? '',
    consumerRole: opts.consumerRole ?? ''
  });

  const signature = crypto
    .sign(null, Buffer.from(canonicalMessage, 'utf8'), opts.privateKey)
    .toString('base64url');

  const headers: Record<string, string> = {
    'x-s2s-key-id': opts.kid,
    'x-s2s-timestamp': timestamp,
    'x-s2s-jti': jti,
    'x-s2s-body-sha256': bodySha,
    'x-s2s-signature': signature,
    ...(opts.extraHeaders || {})
  };
  if (contentType) {
    headers['content-type'] = contentType;
  }
  if (opts.consumerUserId !== undefined) {
    headers['x-consumer-user-id'] = opts.consumerUserId;
  }
  if (opts.consumerRole !== undefined) {
    headers['x-consumer-role'] = opts.consumerRole;
  }

  const stream = new PassThrough() as any;
  stream.method = method;
  stream.url = opts.url;
  if (opts.query !== undefined) {
    stream.query = opts.query;
  }
  stream.headers = headers;
  stream.end(rawBody);
  return stream;
}

function createAdminSessionRequest(opts: {
  method: string;
  url: string;
  token?: string;
  body?: unknown;
  extraHeaders?: Record<string, string>;
  query?: Record<string, string | string[] | undefined>;
}) {
  const rawBody =
    opts.body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(opts.body), 'utf8');
  const headers: Record<string, string> = {
    ...(opts.extraHeaders || {})
  };
  if (opts.token) {
    headers['authorization'] = `Bearer ${opts.token}`;
  }
  if (rawBody.length > 0) {
    headers['content-type'] = 'application/json';
  }
  const stream = new PassThrough() as any;
  stream.method = opts.method;
  stream.url = opts.url;
  if (opts.query !== undefined) {
    stream.query = opts.query;
  }
  stream.headers = headers;
  stream.end(rawBody);
  return stream;
}

function createFoundationMockSupabase(options: {
  clients: MockClient[];
  politicas?: MockPolicy[];
  usuarios?: Record<string, MockUsuario>; // key = bearer token
  empreendedores?: Array<Record<string, any>>;
  barragens?: Array<Record<string, any>>;
  rts?: Array<Record<string, any>>;
  solicitacoes?: Array<Record<string, any>>;
  simulateTransactionFailure?: boolean;
}) {
  const nonces = new Set<string>();
  const state = {
    politicas: [...(options.politicas || [])],
    empreendedores: [...(options.empreendedores || [])],
    barragens: [...(options.barragens || [])],
    rts: [...(options.rts || [])],
    solicitacoes: [...(options.solicitacoes || [])],
    logs: [] as Array<Record<string, any>>,
    entidadeOrigens: [] as Array<Record<string, any>>,
    rpcCalls: [] as string[]
  };

  function normDigits(v: unknown): string {
    return String(v || '').replace(/\D/g, '');
  }

  function clone<T>(val: T): T {
    return JSON.parse(JSON.stringify(val));
  }

  const mock: any = {
    _state: state,
    auth: {
      async getUser(jwt: string) {
        const u = options.usuarios?.[jwt];
        if (!u) {
          return { data: { user: null }, error: { message: 'Invalid JWT' } };
        }
        return { data: { user: { id: u.auth_user_id } }, error: null };
      }
    },
    from(table: string) {
      const filters: Array<{ col: string; val: any }> = [];
      let orderCol: string | null = null;
      let orderAsc = true;

      const execSelect = (limitN?: number, singleMode?: boolean) => {
        if (table === 'integracao_clientes_s2s') {
          let rows = options.clients.filter(c => filters.every(f => (c as any)[f.col] === f.val));
          if (limitN !== undefined) rows = rows.slice(0, limitN);
          return { data: rows, error: null };
        }
        if (table === 'usuarios') {
          const allUsers = Object.values(options.usuarios || {});
          const rows = allUsers.filter(u => filters.every(f => (u as any)[f.col] === f.val));
          if (singleMode) {
            return { data: rows[0] || null, error: null };
          }
          return { data: rows, error: null };
        }
        if (table === 'integracao_s2s_politicas') {
          let rows = state.politicas.filter(p => filters.every(f => (p as any)[f.col] === f.val));
          if (orderCol) {
            rows = [...rows].sort((a: any, b: any) =>
              orderAsc
                ? String(a[orderCol!]).localeCompare(String(b[orderCol!]))
                : String(b[orderCol!]).localeCompare(String(a[orderCol!]))
            );
          }
          if (limitN !== undefined) rows = rows.slice(0, limitN);
          return { data: clone(rows), error: null };
        }
        if (table === 'integracao_s2s_solicitacoes') {
          let rows = state.solicitacoes.filter(s => filters.every(f => (s as any)[f.col] === f.val));
          if (orderCol) {
            rows = [...rows].sort((a: any, b: any) =>
              orderAsc
                ? String(a[orderCol!]).localeCompare(String(b[orderCol!]))
                : String(b[orderCol!]).localeCompare(String(a[orderCol!]))
            );
          }
          if (limitN !== undefined) rows = rows.slice(0, limitN);
          return { data: clone(rows), error: null };
        }
        return { data: [], error: null };
      };

      const builder: any = {
        select() {
          return builder;
        },
        eq(col: string, val: any) {
          filters.push({ col, val });
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orderCol = col;
          orderAsc = opts?.ascending !== false;
          return builder;
        },
        async limit(n: number) {
          return execSelect(n, false);
        },
        async maybeSingle() {
          return execSelect(1, true);
        },
        async insert(row: Record<string, any>) {
          if (table === 'integracao_s2s_operacoes_log') {
            state.logs.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...clone(row) });
            return { data: null, error: null };
          }
          return { data: null, error: { message: 'insert blocked in mock' } };
        }
      };
      return builder;
    },
    async rpc(fn: string, params: Record<string, any>) {
      state.rpcCalls.push(fn);

      if (fn === 'reservar_nonce_s2s') {
        const key = `${params.p_sistema}::${String(params.p_jti).toLowerCase()}`;
        if (nonces.has(key)) return { data: false, error: null };
        nonces.add(key);
        return { data: true, error: null };
      }

      if (options.simulateTransactionFailure) {
        // Simula rollback de transação Postgres sem deixar alteração parcial
        return {
          data: null,
          error: { message: 'ERROR: postgres://internal-secret-db:5432 forced rollback failure' }
        };
      }

      if (fn === 'admin_upsert_politica_s2s') {
        const admin = Object.values(options.usuarios || {}).find(
          u => u.auth_user_id === params.p_admin_auth_user_id && u.papel === 'Administrador' && u.situacao === 'Ativo'
        );
        if (!admin) {
          return {
            data: {
              success: false,
              http_status: 403,
              code: 'ADMIN_REQUIRED',
              error: 'Apenas Administrador ativo no Administra pode gerenciar políticas S2S.'
            },
            error: null
          };
        }
        const now = new Date().toISOString();
        const existingIdx = state.politicas.findIndex(
          p => p.sistema_origem === params.p_sistema_origem && p.operacao === params.p_operacao
        );
        const pol: MockPolicy = {
          id: existingIdx >= 0 ? state.politicas[existingIdx].id : crypto.randomUUID(),
          sistema_origem: params.p_sistema_origem,
          operacao: params.p_operacao,
          modo: params.p_modo,
          ativo: Boolean(params.p_ativo),
          parametros: clone(params.p_parametros || {}),
          restricoes: clone(params.p_restricoes || {}),
          criado_por_uid: existingIdx >= 0 ? state.politicas[existingIdx].criado_por_uid : admin.auth_user_id,
          criado_por_login: existingIdx >= 0 ? state.politicas[existingIdx].criado_por_login : admin.login,
          atualizado_por_uid: admin.auth_user_id,
          atualizado_por_login: admin.login,
          motivo_ultima_alteracao: params.p_motivo || null,
          created_at: existingIdx >= 0 ? state.politicas[existingIdx].created_at : now,
          updated_at: now
        };
        if (existingIdx >= 0) state.politicas[existingIdx] = pol;
        else state.politicas.push(pol);
        return { data: { success: true, politica: clone(pol) }, error: null };
      }

      if (fn === 's2s_executar_cadastro_novo') {
        const pol = state.politicas.find(
          p => p.sistema_origem === params.p_sistema_origem && p.operacao === params.p_operacao
        );
        if (!pol) {
          return { data: { success: false, http_status: 403, code: 'POLICY_NOT_FOUND', error: 'Política ausente.' }, error: null };
        }
        if (!pol.ativo) {
          return { data: { success: false, http_status: 403, code: 'POLICY_INACTIVE', error: 'Política desativada.' }, error: null };
        }
        if (pol.modo !== 'execucao_direta') {
          return { data: { success: false, http_status: 403, code: 'POLICY_MODE_MISMATCH', error: 'Modo incompatível.' }, error: null };
        }

        const existingLog = state.logs.find(
          l =>
            l.sistema_origem === params.p_sistema_origem &&
            l.operacao === params.p_operacao &&
            l.idempotency_key === params.p_idempotency_key &&
            l.status_execucao === 'sucesso'
        );
        if (existingLog) {
          if (existingLog.request_hash_sha256 !== params.p_request_hash_sha256) {
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'IDEMPOTENCY_CONFLICT',
                error: 'Chave de idempotência já utilizada com payload divergente.'
              },
              error: null
            };
          }
          return { data: { ...clone(existingLog.resultado_resumo), idempotent_replay: true }, error: null };
        }

        const dados = params.p_dados || {};
        let tabelaNome = 'empreendedores';
        let entidadeTipo = 'empreendedor';
        let newId = '';

        if (params.p_operacao === 'cadastrar_empreendedor') {
          newId = dados.id || `emp_${crypto.randomUUID().slice(0, 8)}`;
          const doc = normDigits(dados.cpf_cnpj);
          const dup = state.empreendedores.some(e => e.id === newId || normDigits(e.cpf_cnpj) === doc);
          if (dup) {
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'DUPLICATE_RECORD',
                error: 'Empreendedor já existe no cadastro mestre; sobrescrita bloqueada.'
              },
              error: null
            };
          }
          state.empreendedores.push({
            id: newId,
            ...clone(dados),
            situacao: 'Ativo',
            created_by: `s2s:${params.p_sistema_origem}:${params.p_usuario_origem}`
          });
        } else if (params.p_operacao === 'cadastrar_barragem') {
          tabelaNome = 'barragens';
          entidadeTipo = 'barragem';
          newId = dados.id || `bar_${crypto.randomUUID().slice(0, 8)}`;
          if (dados.empreendedor_id && !state.empreendedores.some(e => e.id === dados.empreendedor_id)) {
            return {
              data: {
                success: false,
                http_status: 422,
                code: 'EMPREENDEDOR_NOT_FOUND',
                error: 'Empreendedor referenciado não encontrado.'
              },
              error: null
            };
          }
          const dup = state.barragens.some(
            b =>
              b.id === newId ||
              (dados.snisb && String(b.snisb || '').toUpperCase() === String(dados.snisb).toUpperCase()) ||
              (String(b.nome).toLowerCase() === String(dados.nome).toLowerCase() &&
                (b.empreendedor_id || '') === (dados.empreendedor_id || '') &&
                String(b.municipio || '').toLowerCase() === String(dados.municipio || '').toLowerCase())
          );
          if (dup) {
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'DUPLICATE_RECORD',
                error: 'Barragem já existe no cadastro mestre; sobrescrita bloqueada.'
              },
              error: null
            };
          }
          state.barragens.push({
            id: newId,
            ...clone(dados),
            situacao: 'Ativa',
            created_by: `s2s:${params.p_sistema_origem}:${params.p_usuario_origem}`
          });
        } else {
          tabelaNome = 'rts';
          entidadeTipo = 'rt';
          newId = dados.id || `rt_${crypto.randomUUID().slice(0, 8)}`;
          const doc = normDigits(dados.cpf);
          const dup = state.rts.some(
            r =>
              r.id === newId ||
              (doc && normDigits(r.cpf) === doc) ||
              (dados.registro &&
                String(r.registro || '').toUpperCase() === String(dados.registro).toUpperCase())
          );
          if (dup) {
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'DUPLICATE_RECORD',
                error: 'Responsável técnico já existe no cadastro mestre; sobrescrita bloqueada.'
              },
              error: null
            };
          }
          state.rts.push({
            id: newId,
            ...clone(dados),
            situacao: 'Ativo',
            created_by: `s2s:${params.p_sistema_origem}:${params.p_usuario_origem}`
          });
        }

        const origemSistemaMap: Record<string, string> = {
          classifica: 'Classifica',
          notifica: 'Notifica',
          fiscaliza: 'Fiscaliza'
        };
        const origemSistema = origemSistemaMap[String(params.p_sistema_origem || '').toLowerCase()];
        if (!origemSistema) {
          const rollbackList =
            tabelaNome === 'empreendedores'
              ? state.empreendedores
              : tabelaNome === 'barragens'
              ? state.barragens
              : state.rts;
          const rbIdx = rollbackList.findIndex(r => r.id === newId);
          if (rbIdx >= 0) rollbackList.splice(rbIdx, 1);
          return {
            data: {
              success: false,
              http_status: 403,
              code: 'SYSTEM_FORBIDDEN',
              error: 'Sistema de origem sem mapeamento explícito.'
            },
            error: null
          };
        }

        const origemRegistroId =
          typeof dados.referencia_externa === 'string' && dados.referencia_externa.trim()
            ? dados.referencia_externa.trim()
            : newId;
        const existingOrigin = state.entidadeOrigens.find(
          eo =>
            eo.entidade_tipo === entidadeTipo &&
            eo.origem_sistema === origemSistema &&
            eo.origem_registro_id === origemRegistroId
        );
        if (existingOrigin) {
          if (existingOrigin.entidade_id !== newId) {
            const rollbackList =
              tabelaNome === 'empreendedores'
                ? state.empreendedores
                : tabelaNome === 'barragens'
                ? state.barragens
                : state.rts;
            const rbIdx = rollbackList.findIndex(r => r.id === newId);
            if (rbIdx >= 0) rollbackList.splice(rbIdx, 1);
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'ORIGIN_REFERENCE_CONFLICT',
                error: 'Referência externa já está vinculada a outra entidade do mesmo tipo e sistema de origem.'
              },
              error: null
            };
          }
        } else {
          state.entidadeOrigens.push({
            id: crypto.randomUUID(),
            entidade_tipo: entidadeTipo,
            entidade_id: newId,
            origem_sistema: origemSistema,
            origem_registro_id: origemRegistroId,
            data_origem: new Date().toISOString(),
            payload_original: {},
            conciliacao_status: 'confirmado',
            evidencia: {},
            observacoes: `Cadastro novo via S2S por ${params.p_usuario_origem}`
          });
        }

        const histId = crypto.randomUUID();

        const result = {
          success: true,
          http_status: 201,
          operacao: params.p_operacao,
          modo: 'execucao_direta',
          entidade_tipo: entidadeTipo,
          tabela_nome: tabelaNome,
          registro_id: newId,
          situacao: 'Ativo',
          sistema_origem: params.p_sistema_origem,
          usuario_origem: params.p_usuario_origem,
          matricula_origem: params.p_matricula_origem ?? null,
          historico_id: histId,
          idempotency_key: params.p_idempotency_key
        };

        state.logs.push({
          id: crypto.randomUUID(),
          sistema_origem: params.p_sistema_origem,
          kid: params.p_kid,
          jti: params.p_jti,
          operacao: params.p_operacao,
          politica_id: pol.id,
          modo_aplicado: 'execucao_direta',
          idempotency_key: params.p_idempotency_key,
          request_hash_sha256: params.p_request_hash_sha256,
          usuario_origem: params.p_usuario_origem,
          matricula_origem: params.p_matricula_origem ?? null,
          entidade_tipo: entidadeTipo,
          registro_id: newId,
          status_execucao: 'sucesso',
          http_status: 201,
          resultado_resumo: clone(result)
        });

        return { data: result, error: null };
      }

      if (fn === 's2s_criar_solicitacao_alteracao') {
        const pol = state.politicas.find(
          p => p.sistema_origem === params.p_sistema_origem && p.operacao === params.p_operacao
        );
        if (!pol || !pol.ativo || pol.modo !== 'proposta_aprovacao') {
          return {
            data: {
              success: false,
              http_status: 403,
              code: 'DIRECT_MUTATION_FORBIDDEN',
              error: 'Alteração direta proibida.'
            },
            error: null
          };
        }

        const existingLog = state.logs.find(
          l =>
            l.sistema_origem === params.p_sistema_origem &&
            l.operacao === params.p_operacao &&
            l.idempotency_key === params.p_idempotency_key &&
            l.status_execucao === 'sucesso'
        );
        if (existingLog) {
          if (existingLog.request_hash_sha256 !== params.p_request_hash_sha256) {
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'IDEMPOTENCY_CONFLICT',
                error: 'Chave de idempotência já utilizada com payload divergente.'
              },
              error: null
            };
          }
          return { data: { ...clone(existingLog.resultado_resumo), idempotent_replay: true }, error: null };
        }

        const entidadeTipo =
          params.p_operacao === 'propor_alteracao_empreendedor'
            ? 'empreendedor'
            : params.p_operacao === 'propor_alteracao_barragem'
            ? 'barragem'
            : 'rt';
        const tabelaNome =
          entidadeTipo === 'empreendedor'
            ? 'empreendedores'
            : entidadeTipo === 'barragem'
            ? 'barragens'
            : 'rts';

        const list =
          tabelaNome === 'empreendedores'
            ? state.empreendedores
            : tabelaNome === 'barragens'
            ? state.barragens
            : state.rts;
        const target = list.find(r => r.id === params.p_registro_id);
        if (!target) {
          return {
            data: {
              success: false,
              http_status: 404,
              code: 'RECORD_NOT_FOUND',
              error: 'Registro alvo não encontrado.'
            },
            error: null
          };
        }

        const solicId = crypto.randomUUID();
        state.solicitacoes.push({
          id: solicId,
          politica_id: pol.id,
          sistema_origem: params.p_sistema_origem,
          operacao: params.p_operacao,
          entidade_tipo: entidadeTipo,
          tabela_nome: tabelaNome,
          registro_id: params.p_registro_id,
          idempotency_key: params.p_idempotency_key,
          jti: params.p_jti,
          usuario_origem: params.p_usuario_origem,
          matricula_origem: params.p_matricula_origem ?? null,
          referencia_externa: params.p_referencia_externa ?? null,
          justificativa: params.p_justificativa,
          dados_propostos: clone(params.p_dados_propostos),
          dados_atuais_snapshot: clone(target),
          status: 'Pendente',
          solicitado_em: new Date().toISOString()
        });

        const result = {
          success: true,
          http_status: 202,
          operacao: params.p_operacao,
          modo: 'proposta_aprovacao',
          solicitacao_id: solicId,
          status: 'Pendente',
          entidade_tipo: entidadeTipo,
          tabela_nome: tabelaNome,
          registro_id: params.p_registro_id,
          sistema_origem: params.p_sistema_origem,
          usuario_origem: params.p_usuario_origem,
          matricula_origem: params.p_matricula_origem ?? null,
          idempotency_key: params.p_idempotency_key
        };

        state.logs.push({
          id: crypto.randomUUID(),
          sistema_origem: params.p_sistema_origem,
          kid: params.p_kid,
          jti: params.p_jti,
          operacao: params.p_operacao,
          politica_id: pol.id,
          modo_aplicado: 'proposta_aprovacao',
          idempotency_key: params.p_idempotency_key,
          request_hash_sha256: params.p_request_hash_sha256,
          usuario_origem: params.p_usuario_origem,
          matricula_origem: params.p_matricula_origem ?? null,
          entidade_tipo: entidadeTipo,
          registro_id: params.p_registro_id,
          solicitacao_id: solicId,
          status_execucao: 'sucesso',
          http_status: 202,
          resultado_resumo: clone(result)
        });

        return { data: result, error: null };
      }

      if (fn === 's2s_cancelar_solicitacao_pendente') {
        const pol = state.politicas.find(
          p => p.sistema_origem === params.p_sistema_origem && p.operacao === 'cancelar_solicitacao_pendente'
        );
        if (!pol || !pol.ativo || pol.modo !== 'execucao_direta') {
          return {
            data: { success: false, http_status: 403, code: 'POLICY_INACTIVE', error: 'Política ausente ou inativa.' },
            error: null
          };
        }
        const existingLog = state.logs.find(
          l =>
            l.sistema_origem === params.p_sistema_origem &&
            l.operacao === 'cancelar_solicitacao_pendente' &&
            l.idempotency_key === params.p_idempotency_key &&
            l.status_execucao === 'sucesso'
        );
        if (existingLog) {
          if (existingLog.request_hash_sha256 !== params.p_request_hash_sha256) {
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'IDEMPOTENCY_CONFLICT',
                error: 'Chave de idempotência divergente.'
              },
              error: null
            };
          }
          return { data: { ...clone(existingLog.resultado_resumo), idempotent_replay: true }, error: null };
        }

        const solic = state.solicitacoes.find(s => s.id === params.p_solicitacao_id);
        if (!solic) {
          return { data: { success: false, http_status: 404, code: 'SOLICITATION_NOT_FOUND', error: 'Não encontrada.' }, error: null };
        }
        if (solic.sistema_origem !== params.p_sistema_origem) {
          return {
            data: {
              success: false,
              http_status: 403,
              code: 'ORIGIN_MISMATCH',
              error: 'Apenas o sistema de origem que abriu a solicitação pode cancelá-la.'
            },
            error: null
          };
        }
        if (solic.status !== 'Pendente') {
          return {
            data: {
              success: false,
              http_status: 409,
              code: 'SOLICITATION_NOT_PENDING',
              error: 'Somente solicitações ainda pendentes podem ser canceladas.'
            },
            error: null
          };
        }
        const delegados = Array.isArray(pol.restricoes?.canceladores_autorizados)
          ? pol.restricoes.canceladores_autorizados.map((v: any) => String(v).toLowerCase())
          : [];
        const allowedActor =
          String(solic.usuario_origem).toLowerCase() === String(params.p_usuario_origem).toLowerCase() ||
          delegados.includes(String(params.p_usuario_origem).toLowerCase());
        if (!allowedActor) {
          return {
            data: {
              success: false,
              http_status: 403,
              code: 'ACTOR_FORBIDDEN',
              error: 'Solicitante informado não está autorizado a cancelar esta solicitação.'
            },
            error: null
          };
        }

        solic.status = 'Cancelada';
        solic.cancelado_em = new Date().toISOString();
        solic.cancelado_por_origem = params.p_matricula_origem || params.p_usuario_origem;
        solic.motivo_cancelamento = params.p_motivo;

        const result = {
          success: true,
          http_status: 200,
          operacao: 'cancelar_solicitacao_pendente',
          modo: 'execucao_direta',
          solicitacao_id: solic.id,
          status: 'Cancelada',
          sistema_origem: params.p_sistema_origem,
          usuario_origem: params.p_usuario_origem,
          matricula_origem: params.p_matricula_origem ?? null,
          motivo: params.p_motivo,
          idempotency_key: params.p_idempotency_key
        };

        state.logs.push({
          id: crypto.randomUUID(),
          sistema_origem: params.p_sistema_origem,
          kid: params.p_kid,
          jti: params.p_jti,
          operacao: 'cancelar_solicitacao_pendente',
          politica_id: pol.id,
          modo_aplicado: 'execucao_direta',
          idempotency_key: params.p_idempotency_key,
          request_hash_sha256: params.p_request_hash_sha256,
          usuario_origem: params.p_usuario_origem,
          entidade_tipo: solic.entidade_tipo,
          registro_id: solic.registro_id,
          solicitacao_id: solic.id,
          status_execucao: 'sucesso',
          http_status: 200,
          resultado_resumo: clone(result)
        });
        return { data: result, error: null };
      }

      if (fn === 'admin_decidir_solicitacao_s2s') {
        const admin = Object.values(options.usuarios || {}).find(
          u => u.auth_user_id === params.p_admin_auth_user_id && u.papel === 'Administrador' && u.situacao === 'Ativo'
        );
        if (!admin) {
          return {
            data: {
              success: false,
              http_status: 403,
              code: 'ADMIN_REQUIRED',
              error: 'Apenas Administrador ativo no Administra pode aprovar ou rejeitar solicitações S2S.'
            },
            error: null
          };
        }
        const solic = state.solicitacoes.find(s => s.id === params.p_solicitacao_id);
        if (!solic) {
          return { data: { success: false, http_status: 404, code: 'SOLICITATION_NOT_FOUND', error: 'Não encontrada.' }, error: null };
        }
        if (solic.status !== 'Pendente') {
          return { data: { success: false, http_status: 409, code: 'SOLICITATION_ALREADY_DECIDED', error: 'Já analisada.' }, error: null };
        }

        if (params.p_decisao === 'rejeitar') {
          solic.status = 'Rejeitada';
          solic.analisado_em = new Date().toISOString();
          solic.analisado_por_uid = admin.auth_user_id;
          solic.analisado_por_login = admin.login;
          solic.observacao_analise = params.p_observacao || null;
          return {
            data: {
              success: true,
              solicitacao_id: solic.id,
              status: 'Rejeitada',
              analisado_por_login: admin.login
            },
            error: null
          };
        }

        const list =
          solic.tabela_nome === 'empreendedores'
            ? state.empreendedores
            : solic.tabela_nome === 'barragens'
            ? state.barragens
            : state.rts;
        const target = list.find(r => r.id === solic.registro_id);
        if (!target) {
          return { data: { success: false, http_status: 404, code: 'RECORD_NOT_FOUND', error: 'Alvo ausente.' }, error: null };
        }
        Object.assign(target, clone(solic.dados_propostos), {
          updated_by: admin.auth_user_id,
          updated_at: new Date().toISOString()
        });
        const histId = crypto.randomUUID();
        solic.status = 'Aprovada';
        solic.analisado_em = new Date().toISOString();
        solic.analisado_por_uid = admin.auth_user_id;
        solic.analisado_por_login = admin.login;
        solic.observacao_analise = params.p_observacao || null;
        solic.historico_id = histId;
        return {
          data: {
            success: true,
            solicitacao_id: solic.id,
            status: 'Aprovada',
            historico_id: histId,
            analisado_por_login: admin.login
          },
          error: null
        };
      }

      return { data: null, error: { message: 'unknown rpc' } };
    }
  };

  return mock;
}

function makePolicy(
  sistema: 'notifica' | 'classifica' | 'fiscaliza',
  operacao: string,
  modo: 'execucao_direta' | 'proposta_aprovacao',
  ativo = true,
  restricoes: Record<string, any> = {}
): MockPolicy {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    sistema_origem: sistema,
    operacao,
    modo,
    ativo,
    parametros: {},
    restricoes,
    criado_por_uid: '00000000-0000-4000-8000-000000000001',
    criado_por_login: 'admin.root',
    atualizado_por_uid: '00000000-0000-4000-8000-000000000001',
    atualizado_por_login: 'admin.root',
    motivo_ultima_alteracao: 'Política de teste',
    created_at: now,
    updated_at: now
  };
}

test('1 & 2 & 3. Default-deny: operação sem política, política inativa e sistema não autorizado são bloqueados sem escrita', async () => {
  const keys = createKeyPair();
  const mockDb = createFoundationMockSupabase({
    clients: [
      {
        sistema: 'notifica',
        kid: 'notifica-write-k1',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: true
      },
      {
        sistema: 'classifica',
        kid: 'classifica-read-only',
        public_key_pem: keys.publicKeyPem,
        escopos: ['barragens:read'],
        ativo: true
      },
      {
        sistema: 'fiscaliza',
        kid: 'fiscaliza-inactive',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: false
      }
    ],
    politicas: [
      makePolicy('notifica', 'cadastrar_rt', 'execucao_direta', false), // inativa
      makePolicy('classifica', 'cadastrar_empreendedor', 'execucao_direta', true) // apenas para classifica
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    // 1. Operação sem política para notifica -> 403 POLICY_NOT_FOUND
    const noPolicyRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes?resource=operacoes',
        signedUrl: '/api/v2/operacoes',
        kid: 'notifica-write-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'srv.notifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'notifica-no-policy-001',
          autorOrigem: { usuario: 'srv.notifica', matricula: 'MT-1001' },
          dados: { nome: 'Empreendedor Sem Política', cpf_cnpj: VALID_CPF_A }
        }
      }),
      noPolicyRes
    );
    assert.equal(noPolicyRes.getStatus(), 403);
    assert.equal(noPolicyRes.getBody().code, 'POLICY_NOT_FOUND');
    assert.equal(mockDb._state.empreendedores.length, 0);

    // 2. Política inativa -> 403 POLICY_INACTIVE
    const inactivePolicyRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-write-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'srv.notifica',
        body: {
          operacao: 'cadastrar_rt',
          idempotencyKey: 'notifica-inactive-pol-001',
          autorOrigem: { usuario: 'srv.notifica' },
          dados: { nome: 'Engenheiro Teste', cpf: VALID_CPF_A }
        }
      }),
      inactivePolicyRes
    );
    assert.equal(inactivePolicyRes.getStatus(), 403);
    assert.equal(inactivePolicyRes.getBody().code, 'POLICY_INACTIVE');
    assert.equal(mockDb._state.rts.length, 0);

    // 3a. Sistema sem escopo operacoes:write -> 403
    const noScopeRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-read-only',
        privateKey: keys.privateKey,
        consumerUserId: 'srv.classifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'classifica-no-scope-001',
          autorOrigem: { usuario: 'srv.classifica' },
          dados: { nome: 'Empreendedor Teste', cpf_cnpj: VALID_CPF_A }
        }
      }),
      noScopeRes
    );
    assert.equal(noScopeRes.getStatus(), 403);

    // 3b. Cliente S2S desativado -> 401
    const inactiveClientRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'fiscaliza-inactive',
        privateKey: keys.privateKey,
        consumerUserId: 'srv.fiscaliza',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'fiscaliza-inactive-001',
          autorOrigem: { usuario: 'srv.fiscaliza' },
          dados: { nome: 'Empreendedor Teste', cpf_cnpj: VALID_CPF_A }
        }
      }),
      inactiveClientRes
    );
    assert.equal(inactiveClientRes.getStatus(), 401);

    // Zero chamadas às RPCs de escrita
    assert.equal(
      mockDb._state.rpcCalls.some((fn: string) => fn !== 'reservar_nonce_s2s'),
      false
    );
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('4 & 5. Payload inválido, campos de controle forjados, tentativa de alteração direta e operações bloqueadas', async () => {
  const keys = createKeyPair();
  const adminToken = 'jwt-admin-1';
  const mockDb = createFoundationMockSupabase({
    clients: [
      {
        sistema: 'notifica',
        kid: 'notifica-k1',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: true
      }
    ],
    usuarios: {
      [adminToken]: {
        id: 'usr-adm-1',
        auth_user_id: '00000000-0000-4000-8000-000000000001',
        papel: 'Administrador',
        situacao: 'Ativo',
        login: 'admin.sema',
        nome: 'Administrador SEMA'
      }
    },
    politicas: [
      makePolicy('notifica', 'cadastrar_empreendedor', 'execucao_direta', true, {
        exigir_matricula_origem: true,
        usuarios_autorizados: ['srv.notifica']
      }),
      // Política propositalmente inconsistente no banco para testar defesa em profundidade no backend
      makePolicy('notifica', 'propor_alteracao_barragem', 'execucao_direta' as any, true),
      makePolicy('notifica', 'desativar_cadastro', 'execucao_direta', true),
      makePolicy('notifica', 'cadastrar_empreendimento', 'execucao_direta', true),
      makePolicy('notifica', 'registrar_documento', 'execucao_direta', true)
    ],
    barragens: [
      { id: 'bar_existing', nome: 'Barragem Original', uf: 'MT', municipio: 'Cuiabá', situacao: 'Ativa' }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    // 4a. JSON malformado -> 400
    const badJsonRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        rawBodyOverride: Buffer.from('{bad-json', 'utf8'),
        contentType: 'application/json'
      }),
      badJsonRes
    );
    assert.equal(badJsonRes.getStatus(), 400);

    // 4b. Payload acima de 64KB -> 413
    const oversizedRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        rawBodyOverride: Buffer.alloc(S2S_OPERACOES_MAX_BODY_BYTES + 1, 'a'),
        contentType: 'application/json'
      }),
      oversizedRes
    );
    assert.equal(oversizedRes.getStatus(), 413);

    // 4c. Tentativa de forjar modo/papel/auto-aprovação no payload -> 400 FORBIDDEN_CONTROL_FIELDS
    for (const controlKey of ['modo', 'isAdmin', 'papel', 'sistemaOrigem', 'aprovarAutomaticamente']) {
      const forgedRes = createMockRes();
      await resourceHandler(
        createSignedS2sRequest({
          url: '/api/v2/operacoes',
          kid: 'notifica-k1',
          privateKey: keys.privateKey,
          consumerUserId: 'srv.notifica',
          body: {
            operacao: 'cadastrar_empreendedor',
            idempotencyKey: `forged-${controlKey}-001`,
            autorOrigem: { usuario: 'srv.notifica', matricula: 'MT-100' },
            [controlKey]: true,
            dados: { nome: 'Teste', cpf_cnpj: VALID_CPF_A }
          }
        }),
        forgedRes
      );
      assert.equal(forgedRes.getStatus(), 400);
      assert.equal(forgedRes.getBody().code, 'FORBIDDEN_CONTROL_FIELDS');
    }

    // 4d. CPF mascarado ou inválido -> 400 INVALID_PAYLOAD
    for (const badDoc of ['***.982.***-25', '12345678901', '00000000000']) {
      const badDocRes = createMockRes();
      await resourceHandler(
        createSignedS2sRequest({
          url: '/api/v2/operacoes',
          kid: 'notifica-k1',
          privateKey: keys.privateKey,
          consumerUserId: 'srv.notifica',
          body: {
            operacao: 'cadastrar_empreendedor',
            idempotencyKey: `baddoc-${Math.random().toString(36).slice(2, 10)}`,
            autorOrigem: { usuario: 'srv.notifica', matricula: 'MT-100' },
            dados: { nome: 'Produtor Inválido', cpf_cnpj: badDoc }
          }
        }),
        badDocRes
      );
      assert.equal(badDocRes.getStatus(), 400);
      assert.equal(badDocRes.getBody().code, 'INVALID_PAYLOAD');
    }

    // 4e. Restrição da política: sem matrícula -> 403 MATRICULA_REQUIRED_BY_POLICY
    const missingMatRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'srv.notifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'missing-mat-001',
          autorOrigem: { usuario: 'srv.notifica' },
          dados: { nome: 'Produtor Sem Matrícula', cpf_cnpj: VALID_CPF_A }
        }
      }),
      missingMatRes
    );
    assert.equal(missingMatRes.getStatus(), 403);
    assert.equal(missingMatRes.getBody().code, 'MATRICULA_REQUIRED_BY_POLICY');

    // 5a. Tentativa de alteração direta em cadastro existente -> 403 POLICY_MODE_MISMATCH
    const directAlterRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'srv.notifica',
        body: {
          operacao: 'propor_alteracao_barragem',
          idempotencyKey: 'direct-alter-attempt-001',
          autorOrigem: { usuario: 'srv.notifica', matricula: 'MT-100' },
          registroId: 'bar_existing',
          justificativa: 'Atualizar nome em vistoria',
          dados: { nome: 'Barragem Sobrescrita' }
        }
      }),
      directAlterRes
    );
    assert.equal(directAlterRes.getStatus(), 403);
    assert.equal(directAlterRes.getBody().code, 'POLICY_MODE_MISMATCH');
    assert.equal(mockDb._state.barragens[0].nome, 'Barragem Original');

    // 5b. Admin tentando configurar propor_alteracao_* como execucao_direta -> 422 POLICY_MODE_INVALID
    const badPolicyModeRes = createMockRes();
    await resourceHandler(
      createAdminSessionRequest({
        method: 'POST',
        url: '/api/v2/politicas',
        token: adminToken,
        body: {
          sistemaOrigem: 'notifica',
          operacao: 'propor_alteracao_barragem',
          modo: 'execucao_direta',
          ativo: true
        }
      }),
      badPolicyModeRes
    );
    assert.equal(badPolicyModeRes.getStatus(), 422);
    assert.equal(badPolicyModeRes.getBody().code, 'POLICY_MODE_INVALID');

    // 5c. Operações bloqueadas por lacuna de contrato ou etapa -> 403 OPERATION_BLOCKED (mesmo se houver linha no mock)
    for (const blockedOp of [
      'cadastrar_empreendimento',
      'propor_alteracao_empreendimento',
      'registrar_documento',
      'desativar_cadastro',
      'cancelar_ato_aplicado',
      'transferir_titularidade',
      'reverter_ato'
    ] as const) {
      assert.notEqual(S2S_OPERATIONS_REGISTRY[blockedOp].status, 'liberada');
      const blockedRes = createMockRes();
      await resourceHandler(
        createSignedS2sRequest({
          url: '/api/v2/operacoes',
          kid: 'notifica-k1',
          privateKey: keys.privateKey,
          consumerUserId: 'srv.notifica',
          body: {
            operacao: blockedOp,
            idempotencyKey: `blocked-${blockedOp}-001`,
            autorOrigem: { usuario: 'srv.notifica', matricula: 'MT-100' },
            dados: { nome: 'Teste' }
          }
        }),
        blockedRes
      );
      assert.equal(blockedRes.getStatus(), 403, `Esperava 403 para ${blockedOp}`);
      assert.equal(blockedRes.getBody().code, 'OPERATION_BLOCKED');

      // Admin também não pode ativar operação bloqueada -> 422 OPERATION_BLOCKED
      const adminActivateBlocked = createMockRes();
      await resourceHandler(
        createAdminSessionRequest({
          method: 'POST',
          url: '/api/v2/politicas',
          token: adminToken,
          body: {
            sistemaOrigem: 'notifica',
            operacao: blockedOp,
            modo: 'execucao_direta',
            ativo: true
          }
        }),
        adminActivateBlocked
      );
      assert.equal(adminActivateBlocked.getStatus(), 422);
      assert.equal(adminActivateBlocked.getBody().code, 'OPERATION_BLOCKED');
    }
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('6 & 7. Cadastro novo sem sobrescrita, duplicado (409), repetição idempotente (200) e conflito de idempotência (409)', async () => {
  const keys = createKeyPair();
  const mockDb = createFoundationMockSupabase({
    clients: [
      {
        sistema: 'classifica',
        kid: 'classifica-k1',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: true
      }
    ],
    politicas: [
      makePolicy('classifica', 'cadastrar_empreendedor', 'execucao_direta', true),
      makePolicy('classifica', 'cadastrar_barragem', 'execucao_direta', true),
      makePolicy('classifica', 'cadastrar_rt', 'execucao_direta', true)
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    const createEmpPayload = {
      operacao: 'cadastrar_empreendedor',
      idempotencyKey: 'classifica-emp-create-001',
      autorOrigem: { usuario: 'ana.silva', matricula: 'SEMA-204' },
      referenciaExterna: 'PROC-CLA-2026-01',
      dados: {
        nome: 'Produtor Rural Mato Grosso',
        cpf_cnpj: VALID_CPF_A,
        uf: 'mt',
        municipio: 'Cuiabá'
      }
    };

    // 1. Primeiro cadastro novo -> 201 com origem e ativo
    const createRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.silva',
        body: createEmpPayload
      }),
      createRes
    );
    assert.equal(createRes.getStatus(), 201);
    const createdBody = createRes.getBody();
    assert.equal(createdBody.success, true);
    assert.equal(createdBody.idempotentReplay, false);
    assert.equal(createdBody.situacao, 'Ativo');
    assert.equal(createdBody.sistemaOrigem, 'classifica');
    assert.equal(createdBody.usuarioOrigem, 'ana.silva');
    assert.equal(mockDb._state.empreendedores.length, 1);
    assert.equal(mockDb._state.entidadeOrigens.length, 1);
    assert.equal(mockDb._state.entidadeOrigens[0].entidade_id, createdBody.registroId);
    assert.equal(mockDb._state.entidadeOrigens[0].origem_sistema, 'Classifica');
    assert.equal(mockDb._state.entidadeOrigens[0].origem_registro_id, 'PROC-CLA-2026-01');

    // 2. Repetição idempotente (novo jti, mesma idempotencyKey e mesmo payload) -> 200 idempotentReplay: true, sem duplicar
    const replayRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.silva',
        body: createEmpPayload
      }),
      replayRes
    );
    assert.equal(replayRes.getStatus(), 200);
    assert.equal(replayRes.getBody().idempotentReplay, true);
    assert.equal(replayRes.getBody().registroId, createdBody.registroId);
    assert.equal(mockDb._state.empreendedores.length, 1);

    // 3. Mesma idempotencyKey com payload divergente -> 409 IDEMPOTENCY_CONFLICT
    const conflictIdemRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.silva',
        body: {
          ...createEmpPayload,
          dados: { ...createEmpPayload.dados, nome: 'Nome Divergente' }
        }
      }),
      conflictIdemRes
    );
    assert.equal(conflictIdemRes.getStatus(), 409);
    assert.equal(conflictIdemRes.getBody().code, 'IDEMPOTENCY_CONFLICT');

    // 4. Cadastro duplicado com nova idempotencyKey e mesmo CPF -> 409 DUPLICATE_RECORD sem sobrescrever
    const dupEmpRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.silva',
        body: {
          ...createEmpPayload,
          idempotencyKey: 'classifica-emp-create-002',
          dados: { nome: 'Tentativa Sobrescrita', cpf_cnpj: VALID_CPF_A, uf: 'MT' }
        }
      }),
      dupEmpRes
    );
    assert.equal(dupEmpRes.getStatus(), 409);
    assert.equal(dupEmpRes.getBody().code, 'DUPLICATE_RECORD');
    assert.equal(mockDb._state.empreendedores.length, 1);
    assert.equal(mockDb._state.empreendedores[0].nome, 'Produtor Rural Mato Grosso');

    // 5. Barragem e RT duplicados -> 409 sem sobrescrever
    const barCreateRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.silva',
        body: {
          operacao: 'cadastrar_barragem',
          idempotencyKey: 'classifica-bar-001',
          autorOrigem: { usuario: 'ana.silva' },
          dados: {
            nome: 'Barragem Rio Claro',
            municipio: 'Sinop',
            uf: 'MT',
            empreendedor_id: createdBody.registroId,
            snisb: '9001'
          }
        }
      }),
      barCreateRes
    );
    assert.equal(barCreateRes.getStatus(), 201);

    const barDupRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.silva',
        body: {
          operacao: 'cadastrar_barragem',
          idempotencyKey: 'classifica-bar-002',
          autorOrigem: { usuario: 'ana.silva' },
          dados: { nome: 'Barragem Alterada', snisb: '9001', uf: 'MT' }
        }
      }),
      barDupRes
    );
    assert.equal(barDupRes.getStatus(), 409);
    assert.equal(barDupRes.getBody().code, 'DUPLICATE_RECORD');
    assert.equal(mockDb._state.barragens[0].nome, 'Barragem Rio Claro');

    const rtCreateRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.silva',
        body: {
          operacao: 'cadastrar_rt',
          idempotencyKey: 'classifica-rt-001',
          autorOrigem: { usuario: 'ana.silva' },
          dados: { nome: 'Eng. Carlos', cpf: VALID_CPF_B, registro: 'CREA-12345' }
        }
      }),
      rtCreateRes
    );
    assert.equal(rtCreateRes.getStatus(), 201);

    const rtDupRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.silva',
        body: {
          operacao: 'cadastrar_rt',
          idempotencyKey: 'classifica-rt-002',
          autorOrigem: { usuario: 'ana.silva' },
          dados: { nome: 'Outro Nome', cpf: VALID_CPF_B, registro: 'CREA-99999' }
        }
      }),
      rtDupRes
    );
    assert.equal(rtDupRes.getStatus(), 409);
    assert.equal(rtDupRes.getBody().code, 'DUPLICATE_RECORD');
    assert.equal(mockDb._state.rts[0].nome, 'Eng. Carlos');
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('8. Falha parcial / rollback não persiste registro nem vaza detalhes internos', async () => {
  const keys = createKeyPair();
  const mockDb = createFoundationMockSupabase({
    clients: [
      {
        sistema: 'fiscaliza',
        kid: 'fiscaliza-k1',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: true
      }
    ],
    politicas: [makePolicy('fiscaliza', 'cadastrar_empreendedor', 'execucao_direta', true)],
    simulateTransactionFailure: true
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    const res = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'fiscaliza-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'fiscal.01',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'fiscaliza-rollback-001',
          autorOrigem: { usuario: 'fiscal.01', matricula: 'F-90' },
          dados: { nome: 'Empresa Teste Rollback', cpf_cnpj: VALID_CNPJ_A }
        }
      }),
      res
    );

    assert.equal(res.getStatus(), 503);
    assert.deepEqual(res.getBody(), {
      success: false,
      status: 'unavailable',
      retryable: true
    });
    // Nenhum registro criado após rollback e nenhuma entrada de sucesso no log
    assert.equal(mockDb._state.empreendedores.length, 0);
    assert.equal(mockDb._state.entidadeOrigens.length, 0);
    assert.equal(mockDb._state.logs.some((l: any) => l.status_execucao === 'sucesso'), false);
    assert.equal(JSON.stringify(res.getBody()).includes('postgres://'), false);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('9. Aprovação, cancelamento pendente e bloqueio de perfis não-Administrador e chamadas S2S', async () => {
  const keys = createKeyPair();
  const adminToken = 'jwt-admin';
  const analistaToken = 'jwt-analista';
  const usuarioToken = 'jwt-usuario';
  const visualizadorToken = 'jwt-visualizador';

  const mockDb = createFoundationMockSupabase({
    clients: [
      {
        sistema: 'notifica',
        kid: 'notifica-k1',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: true
      },
      {
        sistema: 'classifica',
        kid: 'classifica-k1',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: true
      }
    ],
    usuarios: {
      [adminToken]: {
        id: 'u-adm',
        auth_user_id: '00000000-0000-4000-8000-000000000001',
        papel: 'Administrador',
        situacao: 'Ativo',
        login: 'admin.csb',
        nome: 'Admin CSB'
      },
      [analistaToken]: {
        id: 'u-ana',
        auth_user_id: '00000000-0000-4000-8000-000000000002',
        papel: 'Analista',
        situacao: 'Ativo',
        login: 'analista.csb',
        nome: 'Analista CSB'
      },
      [usuarioToken]: {
        id: 'u-usr',
        auth_user_id: '00000000-0000-4000-8000-000000000003',
        papel: 'Usuário',
        situacao: 'Ativo',
        login: 'usuario.csb',
        nome: 'Usuário CSB'
      },
      [visualizadorToken]: {
        id: 'u-vis',
        auth_user_id: '00000000-0000-4000-8000-000000000004',
        papel: 'Visualizador',
        situacao: 'Ativo',
        login: 'vis.csb',
        nome: 'Visualizador CSB'
      }
    },
    barragens: [
      { id: 'bar_100', nome: 'Barragem Antiga', uf: 'MT', municipio: 'Cuiabá', situacao: 'Ativa' }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    // 9a. Perfis não-Administrador não podem criar políticas nem listar/decidir solicitações -> 403
    for (const nonAdminToken of [analistaToken, usuarioToken, visualizadorToken]) {
      const polRes = createMockRes();
      await resourceHandler(
        createAdminSessionRequest({
          method: 'POST',
          url: '/api/v2/politicas',
          token: nonAdminToken,
          body: {
            sistemaOrigem: 'notifica',
            operacao: 'propor_alteracao_barragem',
            modo: 'proposta_aprovacao',
            ativo: true
          }
        }),
        polRes
      );
      assert.equal(polRes.getStatus(), 403);
      assert.equal(polRes.getBody().code, 'ADMIN_REQUIRED');

      const solRes = createMockRes();
      await resourceHandler(
        createAdminSessionRequest({
          method: 'GET',
          url: '/api/v2/solicitacoes',
          token: nonAdminToken
        }),
        solRes
      );
      assert.equal(solRes.getStatus(), 403);
      assert.equal(solRes.getBody().code, 'ADMIN_REQUIRED');
    }

    // 9b. S2S nunca pode aprovar solicitação nem alterar política -> 403 S2S_FORBIDDEN
    const s2sPolicyAttempt = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        method: 'POST',
        url: '/api/v2/politicas',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        body: {
          sistemaOrigem: 'notifica',
          operacao: 'propor_alteracao_barragem',
          modo: 'proposta_aprovacao',
          ativo: true
        }
      }),
      s2sPolicyAttempt
    );
    assert.equal(s2sPolicyAttempt.getStatus(), 403);
    assert.equal(s2sPolicyAttempt.getBody().code, 'S2S_FORBIDDEN');

    const s2sApproveAttempt = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        method: 'POST',
        url: '/api/v2/solicitacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        body: {
          solicitacaoId: crypto.randomUUID(),
          decisao: 'aprovar'
        }
      }),
      s2sApproveAttempt
    );
    assert.equal(s2sApproveAttempt.getStatus(), 403);
    assert.equal(s2sApproveAttempt.getBody().code, 'S2S_FORBIDDEN');

    // 9c. Administrador ativo habilita política de proposta e cancelamento pendente
    for (const opSpec of [
      { operacao: 'propor_alteracao_barragem', modo: 'proposta_aprovacao' },
      { operacao: 'cancelar_solicitacao_pendente', modo: 'execucao_direta' }
    ]) {
      const admPolRes = createMockRes();
      await resourceHandler(
        createAdminSessionRequest({
          method: 'POST',
          url: '/api/v2/politicas',
          token: adminToken,
          body: {
            sistemaOrigem: 'notifica',
            operacao: opSpec.operacao,
            modo: opSpec.modo,
            ativo: true,
            motivo: 'Liberação controlada'
          }
        }),
        admPolRes
      );
      assert.equal(admPolRes.getStatus(), 200);
      assert.equal(admPolRes.getBody().politica.ativo, true);
    }

    // 9d. S2S propõe alteração (fica Pendente, sem alterar bar_100)
    const propRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'fiscal.notifica',
        body: {
          operacao: 'propor_alteracao_barragem',
          idempotencyKey: 'notifica-prop-bar-001',
          autorOrigem: { usuario: 'fiscal.notifica', matricula: 'N-123' },
          registroId: 'bar_100',
          justificativa: 'Atualização oficial após notificação nº 44/2026',
          dados: { nome: 'Barragem Atualizada' }
        }
      }),
      propRes
    );
    assert.equal(propRes.getStatus(), 202);
    const solicId = propRes.getBody().solicitacaoId;
    assert.equal(propRes.getBody().status, 'Pendente');
    assert.equal(mockDb._state.barragens[0].nome, 'Barragem Antiga');

    // 9e. Perfil não-Administrador não consegue aprovar -> 403
    const analistaApproveRes = createMockRes();
    await resourceHandler(
      createAdminSessionRequest({
        method: 'POST',
        url: '/api/v2/solicitacoes',
        token: analistaToken,
        body: { solicitacaoId: solicId, decisao: 'aprovar' }
      }),
      analistaApproveRes
    );
    assert.equal(analistaApproveRes.getStatus(), 403);
    assert.equal(mockDb._state.barragens[0].nome, 'Barragem Antiga');

    // 9f. Outro sistema não pode cancelar solicitação pendente de notifica -> 403 ORIGIN_MISMATCH
    mockDb._state.politicas.push(
      makePolicy('classifica', 'cancelar_solicitacao_pendente', 'execucao_direta', true)
    );
    const crossCancelRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'fiscal.notifica',
        body: {
          operacao: 'cancelar_solicitacao_pendente',
          idempotencyKey: 'cross-cancel-001',
          autorOrigem: { usuario: 'fiscal.notifica' },
          solicitacaoId: solicId,
          motivo: 'Tentativa indevida de outro sistema'
        }
      }),
      crossCancelRes
    );
    assert.equal(crossCancelRes.getStatus(), 403);
    assert.equal(crossCancelRes.getBody().code, 'ORIGIN_MISMATCH');

    // 9g. Outro usuário não autorizado do mesmo sistema não pode cancelar -> 403 ACTOR_FORBIDDEN
    const wrongActorCancelRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'outro.usuario',
        body: {
          operacao: 'cancelar_solicitacao_pendente',
          idempotencyKey: 'wrong-actor-cancel-001',
          autorOrigem: { usuario: 'outro.usuario' },
          solicitacaoId: solicId,
          motivo: 'Tentativa sem autorização'
        }
      }),
      wrongActorCancelRes
    );
    assert.equal(wrongActorCancelRes.getStatus(), 403);
    assert.equal(wrongActorCancelRes.getBody().code, 'ACTOR_FORBIDDEN');

    // 9h. Administrador aprova solicitação -> atualiza barragem e marca Aprovada
    const admApproveRes = createMockRes();
    await resourceHandler(
      createAdminSessionRequest({
        method: 'POST',
        url: '/api/v2/solicitacoes',
        token: adminToken,
        body: {
          solicitacaoId: solicId,
          decisao: 'aprovar',
          observacao: 'Documentação conferida'
        }
      }),
      admApproveRes
    );
    assert.equal(admApproveRes.getStatus(), 200);
    assert.equal(admApproveRes.getBody().status, 'Aprovada');
    assert.equal(admApproveRes.getBody().analisadoPorLogin, 'admin.csb');
    assert.equal(mockDb._state.barragens[0].nome, 'Barragem Atualizada');

    // 9i. Tentativa de cancelar após já aprovada falha com 409 SOLICITATION_NOT_PENDING
    const lateCancelRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'fiscal.notifica',
        body: {
          operacao: 'cancelar_solicitacao_pendente',
          idempotencyKey: 'late-cancel-001',
          autorOrigem: { usuario: 'fiscal.notifica' },
          solicitacaoId: solicId,
          motivo: 'Cancelamento tardio após aprovação'
        }
      }),
      lateCancelRes
    );
    assert.equal(lateCancelRes.getStatus(), 409);
    assert.equal(lateCancelRes.getBody().code, 'SOLICITATION_NOT_PENDING');

    // 9j. Nova proposta pode ser cancelada enquanto Pendente pelo autor de origem
    const prop2Res = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'fiscal.notifica',
        body: {
          operacao: 'propor_alteracao_barragem',
          idempotencyKey: 'notifica-prop-bar-002',
          autorOrigem: { usuario: 'fiscal.notifica', matricula: 'N-123' },
          registroId: 'bar_100',
          justificativa: 'Solicitação aberta por engano',
          dados: { municipio: 'Sinop' }
        }
      }),
      prop2Res
    );
    assert.equal(prop2Res.getStatus(), 202);
    const solic2Id = prop2Res.getBody().solicitacaoId;

    const okCancelRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'fiscal.notifica',
        body: {
          operacao: 'cancelar_solicitacao_pendente',
          idempotencyKey: 'ok-cancel-002',
          autorOrigem: { usuario: 'fiscal.notifica' },
          solicitacaoId: solic2Id,
          motivo: 'Protocolo substituído antes da análise'
        }
      }),
      okCancelRes
    );
    assert.equal(okCancelRes.getStatus(), 200);
    assert.equal(okCancelRes.getBody().status, 'Cancelada');
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('10. Bloqueio de acesso indevido pelo navegador, isolamento de código cliente e hardening SQL da migration', async () => {
  const adminToken = 'jwt-admin';
  const mockDb = createFoundationMockSupabase({
    clients: [],
    usuarios: {
      [adminToken]: {
        id: 'u-adm',
        auth_user_id: '00000000-0000-4000-8000-000000000001',
        papel: 'Administrador',
        situacao: 'Ativo',
        login: 'admin.csb',
        nome: 'Admin CSB'
      }
    }
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    // 10a. Navegador tentando chamar POST /api/v2/operacoes apenas com Bearer JWT (sem chave Ed25519 S2S) -> 401
    const browserS2sRes = createMockRes();
    await resourceHandler(
      createAdminSessionRequest({
        method: 'POST',
        url: '/api/v2/operacoes',
        token: adminToken,
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'browser-attempt-001',
          autorOrigem: { usuario: 'admin.csb' },
          dados: { nome: 'Teste', cpf_cnpj: VALID_CPF_A }
        }
      }),
      browserS2sRes
    );
    assert.equal(browserS2sRes.getStatus(), 401);

    // 10b. Acesso anônimo a /api/v2/politicas e /api/v2/solicitacoes -> 401
    for (const ep of ['/api/v2/politicas', '/api/v2/solicitacoes']) {
      const anonRes = createMockRes();
      await resourceHandler(
        createAdminSessionRequest({ method: 'GET', url: ep }),
        anonRes
      );
      assert.equal(anonRes.getStatus(), 401);
    }
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }

  // 10c. Código do navegador (src/ fora de src/server/) nunca importa s2sOperacoes, service_role nem acessa tabelas/RPCs S2S diretamente
  const listSrcFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path.relative(ROOT_DIR, full).replace(/\\/g, '/') === 'src/server') continue;
        out.push(...listSrcFiles(full));
      } else if (/\.(ts|tsx|js|jsx)$/i.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  };

  const clientForbiddenRefs = [
    's2sOperacoes',
    's2sAuth',
    'VITE_SUPABASE_SERVICE_ROLE_KEY',
    'process.env.SUPABASE_SERVICE_ROLE_KEY',
    'import.meta.env.SUPABASE_SERVICE_ROLE_KEY',
    'integracao_s2s_politicas',
    'integracao_s2s_solicitacoes',
    'integracao_s2s_operacoes_log',
    's2s_executar_cadastro_novo',
    's2s_criar_solicitacao_alteracao',
    's2s_cancelar_solicitacao_pendente',
    'admin_upsert_politica_s2s',
    'admin_decidir_solicitacao_s2s'
  ];

  for (const file of listSrcFiles(path.join(ROOT_DIR, 'src'))) {
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
    for (const forbidden of clientForbiddenRefs) {
      assert.equal(
        content.includes(forbidden),
        false,
        `Referência proibida no cliente (${forbidden}) em ${rel}`
      );
    }
  }

  // 10d. Migration 20261127 possui RLS estrita, REVOKE PUBLIC/anon/authenticated e constraints estruturais
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC,\s*anon,\s*authenticated/i);
  assert.match(sql, /GRANT SELECT,\s*INSERT,\s*UPDATE ON TABLE public\.%I TO service_role/i);
  assert.match(sql, /chk_s2s_pol_alteracao_exige_aprovacao/i);
  assert.match(sql, /chk_s2s_pol_operacoes_bloqueadas_inativas/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_decidir_solicitacao_s2s\(/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.s2s_executar_cadastro_novo\(/i);
  assert.match(sql, /SELECT \* INTO v_adm FROM public\._validar_admin_ativo_s2s/i);
});
