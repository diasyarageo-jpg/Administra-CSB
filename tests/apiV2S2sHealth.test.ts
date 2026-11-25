// tests/apiV2S2sHealth.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import healthHandler, { config as healthConfig } from '../api/v2/health';
import noncesCleanupHandler, {
  config as noncesCleanupConfig
} from '../api/v2/s2s-nonces-cleanup';
import {
  JsonBodyReaderError,
  decodeStrictUtf8,
  parseStrictUtf8JsonObject,
  readJsonObjectBody,
  readRawBodyBuffer
} from '../src/server/jsonBodyReader';
import {
  authenticateS2sRequest,
  buildS2sCanonicalMessage,
  canonicalizeQueryString,
  deriveConsumerMaskingContext,
  isValidS2sJtiUuidV4,
  normalizeContentType,
  normalizePublicPath,
  sha256BodyHexLower
} from '../src/server/s2sAuth';
import { setTestSupabaseAdminForSemaAudit } from '../src/server/semaAudit';

interface ClientRecord {
  sistema: string;
  kid: string;
  public_key_pem: string;
  escopos: string[];
  ativo: boolean;
}

interface MockNonceEntry {
  sistema: string;
  jti: string;
  expiresAtMs: number;
  consumidoEmIso: string;
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

function createSignedRequest(opts: {
  method?: string;
  url?: string;
  kid: string;
  privateKey: crypto.KeyObject;
  timestamp?: number;
  jti?: string;
  contentType?: string;
  rawBody?: Buffer;
  consumerUserId?: string;
  consumerRole?: string;
  signMethodOverride?: string;
  signPathOverride?: string;
  signQueryOverride?: string;
  signContentTypeOverride?: string;
  signBodyHashOverride?: string;
  extraHeaders?: Record<string, string>;
  omitBodyTrap?: boolean;
}) {
  const method = (opts.method || 'GET').toUpperCase();
  const url = opts.url || '/api/v2/health';
  const rawBody = opts.rawBody ?? Buffer.alloc(0);
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const jti = opts.jti ?? crypto.randomUUID();
  const bodySha = sha256BodyHexLower(rawBody);

  const qIdx = url.indexOf('?');
  const rawPath = qIdx === -1 ? url : url.slice(0, qIdx);
  const rawQuery = qIdx === -1 ? '' : url.slice(qIdx + 1);

  const normalizedPath = opts.signPathOverride ?? normalizePublicPath(rawPath);
  const canonicalQuery = opts.signQueryOverride ?? canonicalizeQueryString(rawQuery);
  const contentTypeNormalized =
    opts.signContentTypeOverride ??
    (opts.contentType ? normalizeContentType(opts.contentType) : '');

  const canonicalMessage = buildS2sCanonicalMessage({
    method: opts.signMethodOverride ?? method,
    normalizedPath,
    canonicalQuery,
    contentTypeNormalized,
    bodySha256HexLower: opts.signBodyHashOverride ?? bodySha,
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
    'x-s2s-signature': signature
  };
  if (opts.contentType !== undefined) {
    headers['content-type'] = opts.contentType;
  }
  if (opts.consumerUserId !== undefined) {
    headers['x-consumer-user-id'] = opts.consumerUserId;
  }
  if (opts.consumerRole !== undefined) {
    headers['x-consumer-role'] = opts.consumerRole;
  }
  if (opts.extraHeaders) {
    Object.assign(headers, opts.extraHeaders);
  }

  const stream = new PassThrough() as any;
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  if (!opts.omitBodyTrap) {
    Object.defineProperty(stream, 'body', {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error('req.body nunca deve ser acessado na verificação S2S');
      }
    });
  }
  stream.end(rawBody);
  return stream;
}

function createMockSupabaseAdmin(options: {
  clients: ClientRecord[];
  failClientQuery?: boolean;
  failHealthQuery?: boolean;
  failNonceRpc?: boolean;
  failCleanupRpc?: boolean;
  failCleanupAfterBatches?: number;
  throwOnCleanupRpc?: boolean;
  failAuditInsert?: boolean;
  throwAuditInsert?: boolean;
  nonceDelayMs?: number;
  initialNonces?: MockNonceEntry[];
}) {
  const reservedNonces = new Map<string, MockNonceEntry>();
  for (const entry of options.initialNonces || []) {
    reservedNonces.set(`${entry.sistema}::${entry.jti}`, entry);
  }
  const rpcCalls: Array<{ fn: string; params: any }> = [];
  const queryCalls: string[] = [];
  const cleanupAuditInserts: Array<Record<string, any>> = [];
  let cleanupRpcCalls = 0;
  let auditSelectCalled = false;

  const mock: any = {
    _reservedNonces: reservedNonces,
    _rpcCalls: rpcCalls,
    _queryCalls: queryCalls,
    _cleanupAuditInserts: cleanupAuditInserts,
    get _auditSelectCalled() {
      return auditSelectCalled;
    },
    from(table: string) {
      queryCalls.push(table);
      const filters: Record<string, any> = {};
      const builder: any = {
        select() {
          if (table === 's2s_nonce_cleanup_runs') {
            auditSelectCalled = true;
          }
          return builder;
        },
        insert(payload: Record<string, any>) {
          if (table === 's2s_nonce_cleanup_runs') {
            cleanupAuditInserts.push(structuredClone(payload));
          }
          const runInsert = async () => {
            if (table === 's2s_nonce_cleanup_runs') {
              if (options.throwAuditInsert) {
                throw new Error('postgres://audit-insert-exception password=secret-token');
              }
              if (options.failAuditInsert) {
                return {
                  data: null,
                  error: { message: 'insert failed postgres://audit-internal-host:5432 secret' }
                };
              }
            }
            return { data: null, error: null };
          };
          const promise: any = runInsert();
          promise.select = () => {
            auditSelectCalled = true;
            return Promise.resolve({
              data: null,
              error: { message: 'permission denied for SELECT on s2s_nonce_cleanup_runs' }
            });
          };
          return promise;
        },
        eq(col: string, val: any) {
          filters[col] = val;
          return builder;
        },
        async limit(n: number) {
          if (table === 'integracao_clientes_s2s') {
            if (options.failClientQuery) {
              return {
                data: null,
                error: { message: 'postgres://secret-internal-host:5432 failed' }
              };
            }
            const matched = options.clients.filter(c => {
              if (filters.kid !== undefined && c.kid !== filters.kid) return false;
              if (filters.sistema !== undefined && c.sistema !== filters.sistema) return false;
              return true;
            });
            return { data: matched.slice(0, n), error: null };
          }
          if (table === 'barragens') {
            if (options.failHealthQuery) {
              return { data: null, error: { message: 'connection refused postgres://internal' } };
            }
            return { data: [], count: 1, error: null };
          }
          return { data: [], error: null };
        }
      };
      return builder;
    },
    async rpc(fn: string, params: any) {
      rpcCalls.push({ fn, params });
      if (fn === 'reservar_nonce_s2s') {
        if (options.failNonceRpc) {
          return { data: null, error: { message: 'db write error password=secret' } };
        }
        // Contrato SQL atualizado: p_sistema (text) + p_jti (uuid) -> colunas (sistema, jti, expires_at, consumido_em)
        const expectedKeys = ['p_sistema', 'p_jti', 'p_expires_at'];
        for (const k of expectedKeys) {
          if (params?.[k] === undefined) {
            return { data: null, error: { message: `missing parameter ${k}` } };
          }
        }
        if (
          typeof params.p_jti !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.p_jti)
        ) {
          return { data: null, error: { message: 'invalid input syntax for type uuid' } };
        }
        if (options.nonceDelayMs) {
          await new Promise(resolve => setTimeout(resolve, options.nonceDelayMs));
        }
        const normalizedJti = params.p_jti.toLowerCase();
        const key = `${params.p_sistema}::${normalizedJti}`;
        if (reservedNonces.has(key)) {
          return { data: false, error: null };
        }
        reservedNonces.set(key, {
          sistema: params.p_sistema,
          jti: normalizedJti,
          expiresAtMs: Date.parse(params.p_expires_at) || Date.now() + 600_000,
          consumidoEmIso: new Date().toISOString()
        });
        return { data: true, error: null };
      }

      if (fn === 'limpar_nonces_s2s_expirados') {
        cleanupRpcCalls += 1;
        if (options.throwOnCleanupRpc) {
          throw new Error('unexpected rpc crash postgres://secret-host:5432');
        }
        if (
          options.failCleanupRpc ||
          (options.failCleanupAfterBatches !== undefined &&
            cleanupRpcCalls > options.failCleanupAfterBatches)
        ) {
          return { data: null, error: { message: 'cleanup failed postgres://internal' } };
        }
        const limit = Number(params?.p_limit || 5000);
        const now = Date.now();
        let deleted = 0;
        for (const [key, entry] of reservedNonces.entries()) {
          if (deleted >= limit) break;
          if (entry.expiresAtMs < now) {
            reservedNonces.delete(key);
            deleted += 1;
          }
        }
        return { data: deleted, error: null };
      }

      return { data: null, error: { message: 'unknown rpc' } };
    }
  };
  return mock;
}

test('Migração SQL impõe UNIQUE(kid), RLS fail-closed e vercel.json agenda limpeza periódica', () => {
  assert.deepEqual(healthConfig, { api: { bodyParser: false } });
  assert.deepEqual(noncesCleanupConfig, { api: { bodyParser: false } });

  const sqlPath = path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '20261118_api_v2_s2s_clientes_e_nonces.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.integracao_clientes_s2s/i);
  assert.match(sql, /CONSTRAINT uq_integracao_clientes_s2s_kid UNIQUE \(kid\)/i);
  assert.doesNotMatch(sql, /UNIQUE\s*\(\s*sistema\s*,\s*kid\s*\)/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.integracao_s2s_nonces/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.integracao_clientes_s2s FROM PUBLIC, anon, authenticated/i
  );
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.integracao_s2s_nonces FROM PUBLIC, anon, authenticated/i
  );
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.reservar_nonce_s2s/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.limpar_nonces_s2s_expirados/i);
  assert.match(sql, /ON CONFLICT \(sistema, jti\) DO NOTHING/i);
  assert.doesNotMatch(sql, /BEGIN PUBLIC KEY/i);
  assert.doesNotMatch(sql, /CREATE POLICY/i);

  const vercelJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')
  );
  const cleanupCron = (vercelJson.crons || []).find(
    (c: any) => c.path === '/api/v2/s2s-nonces-cleanup'
  );
  assert.ok(cleanupCron);
  assert.equal(cleanupCron.schedule, '0 3 * * *');

  const fixSqlPath = path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '20261119_api_v2_s2s_alinhamento_esquema.sql'
  );
  const fixSql = fs.readFileSync(fixSqlPath, 'utf8');
  assert.match(fixSql, /^(?:\s*--[^\n]*\r?\n|\s*\r?\n)*\s*BEGIN;/i);
  assert.match(fixSql, /NOTIFY\s+pgrst\s*,\s*'reload schema'\s*;\s*COMMIT;\s*$/i);
  const beginIdx = fixSql.search(/\bBEGIN;/i);
  const notifyIdx = fixSql.search(/NOTIFY\s+pgrst\s*,\s*'reload schema'\s*;/i);
  const commitIdx = fixSql.search(/\bCOMMIT;\s*$/i);
  assert.ok(beginIdx >= 0 && notifyIdx > beginIdx && commitIdx > notifyIdx);
  assert.match(fixSql, /RENAME COLUMN sistema_origem TO sistema/i);
  assert.match(fixSql, /DROP CONSTRAINT %I/i);
  assert.match(fixSql, /ADD CONSTRAINT uq_integracao_clientes_s2s_kid UNIQUE \(kid\)/i);
  assert.match(fixSql, /DROP FUNCTION IF EXISTS %s/i);
  assert.match(fixSql, /CREATE FUNCTION public\.reservar_nonce_s2s\(\s*p_sistema text,\s*p_jti uuid,\s*p_expires_at timestamptz/i);
  assert.match(fixSql, /INSERT INTO public\.integracao_s2s_nonces \(sistema, jti, expires_at, consumido_em\)/i);
  assert.match(fixSql, /ON CONFLICT \(sistema, jti\) DO NOTHING/i);
  assert.match(fixSql, /CREATE OR REPLACE FUNCTION public\.limpar_nonces_s2s_expirados/i);
  assert.match(fixSql, /WHERE expires_at < now\(\)/i);
  assert.match(fixSql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(fixSql, /REVOKE ALL ON TABLE public\.integracao_clientes_s2s FROM PUBLIC, anon, authenticated/i);
  assert.match(fixSql, /REVOKE ALL ON TABLE public\.integracao_s2s_nonces FROM PUBLIC, anon, authenticated/i);
  assert.match(fixSql, /REVOKE ALL ON FUNCTION public\.reservar_nonce_s2s\(text, uuid, timestamptz\) FROM PUBLIC, anon, authenticated/i);
  assert.match(fixSql, /GRANT EXECUTE ON FUNCTION public\.reservar_nonce_s2s\(text, uuid, timestamptz\) TO service_role/i);
  assert.doesNotMatch(fixSql, /BEGIN PUBLIC KEY/i);
});

test('JTI exige UUID v4 estrito antes de consultar banco ou reservar nonce e registra colunas atuais (sistema, jti, consumido_em)', async () => {
  const { publicKeyPem, privateKey } = createKeyPair();
  const mockDb = createMockSupabaseAdmin({
    clients: [
      {
        sistema: 'fiscaliza',
        kid: 'fiscaliza-uuid-v4-test',
        public_key_pem: publicKeyPem,
        escopos: ['health:read'],
        ativo: true
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    const validLower = crypto.randomUUID();
    const validUpper = crypto.randomUUID().toUpperCase();
    assert.equal(isValidS2sJtiUuidV4(validLower), true);
    assert.equal(isValidS2sJtiUuidV4(validUpper), true);

    const invalidJtis = [
      `jti-${crypto.randomUUID()}`,
      'nonce-arbitrario-123456',
      '12345678',
      '550e8400-e29b-11d4-a716-446655440000', // UUID v1
      '886313e1-3b8a-5372-9b90-0c9aee199e5d', // UUID v5
      '550e8400-e29b-41d4-0716-446655440000', // variante inválida (0)
      '550e8400-e29b-41d4-f716-446655440000', // variante inválida (f)
      '00000000-0000-0000-0000-000000000000', // nil UUID
      '550e8400e29b41d4a716446655440000' // sem hifens
    ];

    for (const badJti of invalidJtis) {
      assert.equal(isValidS2sJtiUuidV4(badJti), false, `Esperava rejeição de ${badJti}`);
      const res = createMockRes();
      await healthHandler(
        createSignedRequest({
          kid: 'fiscaliza-uuid-v4-test',
          privateKey,
          jti: badJti
        }),
        res
      );
      assert.equal(res.getStatus(), 401, `Esperava 401 para JTI inválido ${badJti}`);
    }

    // Nenhuma consulta ou reserva deve acontecer antes de validar UUID v4
    assert.equal(mockDb._queryCalls.length, 0);
    assert.equal(mockDb._rpcCalls.length, 0);

    // UUID v4 válido (inclusive hex maiúsculo na entrada, normalizado para uuid canonical lowercase no banco)
    const okRes = createMockRes();
    await healthHandler(
      createSignedRequest({
        kid: 'fiscaliza-uuid-v4-test',
        privateKey,
        jti: validUpper
      }),
      okRes
    );
    assert.equal(okRes.getStatus(), 200);
    assert.equal(mockDb._rpcCalls.length, 1);
    assert.equal(mockDb._rpcCalls[0].fn, 'reservar_nonce_s2s');
    assert.equal(mockDb._rpcCalls[0].params.p_sistema, 'fiscaliza');
    assert.equal(mockDb._rpcCalls[0].params.p_jti, validUpper.toLowerCase());
    const stored = mockDb._reservedNonces.get(`fiscaliza::${validUpper.toLowerCase()}`);
    assert.ok(stored);
    assert.equal(stored.sistema, 'fiscaliza');
    assert.equal(stored.jti, validUpper.toLowerCase());
    assert.ok(typeof stored.consumidoEmIso === 'string' && stored.consumidoEmIso.includes('T'));
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('GET /api/v2/health aceita assinatura Ed25519 válida e normaliza query RFC 3986 sem vazar segredos', async () => {
  const { publicKeyPem, privateKey } = createKeyPair();
  const mockDb = createMockSupabaseAdmin({
    clients: [
      {
        sistema: 'notifica',
        kid: 'notifica-2026-01',
        public_key_pem: publicKeyPem,
        escopos: ['health:read'],
        ativo: true
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    const req = createSignedRequest({
      method: 'GET',
      url: '/api/v2/health?z=last&a=hello%20world&m=caf%C3%A9',
      kid: 'notifica-2026-01',
      privateKey,
      consumerUserId: 'usr-notifica-1',
      consumerRole: 'Analista'
    });
    const res = createMockRes();
    await healthHandler(req, res);

    assert.equal(res.getStatus(), 200);
    assert.equal(res.getHeaders()['cache-control'], 'private, no-store, max-age=0');
    const body = res.getBody();
    assert.equal(body.success, true);
    assert.equal(body.status, 'ok');
    assert.equal(body.database, 'ok');
    assert.equal(body.apiVersion, '2.0');
    assert.ok(typeof body.checkedAt === 'string' && body.checkedAt.includes('T'));
    assert.equal(JSON.stringify(body).includes('BEGIN PUBLIC KEY'), false);
    assert.equal(mockDb._rpcCalls.length, 1);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('1) Mascaramento fail-closed: ID e papel válidos sem vínculo verificado permanecem masked', async () => {
  const { publicKeyPem, privateKey } = createKeyPair();
  const mockDb = createMockSupabaseAdmin({
    clients: [
      {
        sistema: 'notifica',
        kid: 'notifica-mask-check',
        public_key_pem: publicKeyPem,
        escopos: ['barragens:read'],
        ativo: true
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    for (const role of ['Administrador', 'Analista', 'Visualizador', 'Usuário', '']) {
      const ctx = deriveConsumerMaskingContext('notifica', 'usr-admin-123', role);
      assert.equal(ctx.verifiedLink, false);
      assert.equal(ctx.maskingPolicy, 'masked');
      assert.equal(ctx.trustedAdministraSession, false);
    }

    // Mesmo passando cabeçalhos assinados com ID e papel Administrador/Analista,
    // na etapa 1 (sem verificação de vínculo ativo) o resultado segue mascarado.
    for (const declaredRole of ['Administrador', 'Analista']) {
      const auth = await authenticateS2sRequest(
        createSignedRequest({
          method: 'GET',
          url: '/api/v2/health',
          kid: 'notifica-mask-check',
          privateKey,
          consumerUserId: 'usr-valid-format-01',
          consumerRole: declaredRole
        }),
        { requiredScope: 'barragens:read' }
      );
      assert.equal(auth.ok, true);
      if (auth.ok) {
        assert.equal(auth.context.consumer.consumerUserId, 'usr-valid-format-01');
        assert.equal(auth.context.consumer.consumerRole, declaredRole);
        assert.equal(auth.context.consumer.consumerRoleValid, true);
        assert.equal(auth.context.consumer.verifiedLink, false);
        assert.equal(auth.context.consumer.maskingPolicy, 'masked');
        assert.equal(auth.context.consumer.trustedAdministraSession, false);
      }
    }

    // Somente com verificação server-side explícita de vínculo ativo para Administrador/Analista
    const verifiedCtx = deriveConsumerMaskingContext('notifica', 'usr-admin-123', 'Analista', {
      verifiedActiveLink: true
    });
    assert.equal(verifiedCtx.verifiedLink, true);
    assert.equal(verifiedCtx.maskingPolicy, 'full');
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('2) Identificação inequívoca exclusivamente por kid: ignora cabeçalho de sistema divergente, rejeita kid desconhecido e kid inativo', async () => {
  const validKeys = createKeyPair();
  const inactiveKeys = createKeyPair();
  const mockDb = createMockSupabaseAdmin({
    clients: [
      {
        sistema: 'notifica',
        kid: 'kid-global-notifica-01',
        public_key_pem: validKeys.publicKeyPem,
        escopos: ['health:read'],
        ativo: true
      },
      {
        sistema: 'fiscaliza',
        kid: 'kid-global-fiscaliza-inactive',
        public_key_pem: inactiveKeys.publicKeyPem,
        escopos: ['health:read'],
        ativo: false
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    // Tentativa de enviar X-S2S-Sistema e X-S2S-System divergentes:
    // servidor ignora ambos, autentica exclusivamente pelo kid e usa o sistema 'notifica' do banco.
    const authRes = await authenticateS2sRequest(
      createSignedRequest({
        kid: 'kid-global-notifica-01',
        privateKey: validKeys.privateKey,
        extraHeaders: {
          'x-s2s-sistema': 'fiscaliza',
          'x-s2s-system': 'classifica'
        }
      }),
      { requiredScope: 'health:read' }
    );
    assert.equal(authRes.ok, true);
    if (authRes.ok) {
      assert.equal(authRes.context.sistema, 'notifica');
      assert.equal(authRes.context.consumer.scopeSistema, 'notifica');
    }
    assert.equal(mockDb._rpcCalls.length, 1);
    assert.equal(mockDb._rpcCalls[0].params.p_sistema, 'notifica');

    // kid desconhecido -> 401 antes de reservar jti
    const unknownRes = createMockRes();
    await healthHandler(
      createSignedRequest({
        kid: 'kid-desconhecido',
        privateKey: validKeys.privateKey,
        extraHeaders: { 'x-s2s-sistema': 'notifica' }
      }),
      unknownRes
    );
    assert.equal(unknownRes.getStatus(), 401);
    assert.equal(mockDb._rpcCalls.length, 1);

    // kid inativo -> 401 antes de reservar jti
    const inactiveRes = createMockRes();
    await healthHandler(
      createSignedRequest({
        kid: 'kid-global-fiscaliza-inactive',
        privateKey: inactiveKeys.privateKey
      }),
      inactiveRes
    );
    assert.equal(inactiveRes.getStatus(), 401);
    assert.equal(mockDb._rpcCalls.length, 1);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('3) Caminhos ambíguos são rejeitados antes de consultar o banco ou reservar nonce, preservando caminhos válidos', async () => {
  assert.equal(normalizePublicPath('/'), '/');
  assert.equal(normalizePublicPath('/api/v2/health'), '/api/v2/health');
  assert.equal(normalizePublicPath('/api/v2/caf%C3%A9'), '/api/v2/caf%C3%A9');

  const ambiguousPaths = [
    '/api//v2/health',
    '/api/v2/health/',
    '/api/./v2/health',
    '/api/../v2/health',
    '/api/%2e/v2/health',
    '/api/%2e%2e/v2/health',
    '/api/%762/health',
    '/api/v2/%68ealth',
    '/api/v2%2fhealth',
    '/api/v2%2Fhealth',
    '/api/v2%5chealth',
    '/api/v2/caf%c3%a9',
    ' /api/v2/health'
  ];

  for (const badPath of ambiguousPaths) {
    assert.throws(() => normalizePublicPath(badPath), /PATH_INVALID/, `Deveria rejeitar ${badPath}`);
  }

  const { publicKeyPem, privateKey } = createKeyPair();
  const mockDb = createMockSupabaseAdmin({
    clients: [
      {
        sistema: 'classifica',
        kid: 'classifica-path-check',
        public_key_pem: publicKeyPem,
        escopos: ['health:read'],
        ativo: true
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    for (const badPath of [
      '/api//v2/health',
      '/api/v2/health/',
      '/api/%2e%2e/v2/health',
      '/api/%762/health',
      '/api/v2%2fhealth',
      '/api/v2%5chealth'
    ]) {
      const req = createSignedRequest({
        method: 'GET',
        url: badPath,
        signPathOverride: '/api/v2/health',
        kid: 'classifica-path-check',
        privateKey
      });
      const res = createMockRes();
      await healthHandler(req, res);
      assert.equal(res.getStatus(), 400, `Esperava 400 para caminho ambíguo ${badPath}`);
    }

    // Nenhuma consulta ao banco nem reserva de nonce deve ocorrer para caminhos inválidos
    assert.equal(mockDb._queryCalls.length, 0);
    assert.equal(mockDb._rpcCalls.length, 0);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('4) Corpo bruto aceita apenas Buffer/Uint8Array, valida UTF-8 estrito e detecta alteração por whitespace', async () => {
  // 1. Bloco string emitido no stream é rejeitado em readRawBodyBuffer e authenticateS2sRequest
  const stringChunkReq = new EventEmitter() as any;
  stringChunkReq.method = 'POST';
  stringChunkReq.url = '/api/v2/test';
  stringChunkReq.headers = { 'content-type': 'application/json' };
  const rawReadPromise = readRawBodyBuffer(stringChunkReq);
  stringChunkReq.emit('data', '{"a":1}');
  await assert.rejects(
    rawReadPromise,
    (err: any) => err instanceof JsonBodyReaderError && err.statusCode === 400 && err.code === 'INVALID_CHUNK'
  );

  const { publicKeyPem, privateKey } = createKeyPair();
  const mockDb = createMockSupabaseAdmin({
    clients: [
      {
        sistema: 'fiscaliza',
        kid: 'fiscaliza-raw-body',
        public_key_pem: publicKeyPem,
        escopos: ['barragens:read'],
        ativo: true
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    const validRaw = Buffer.from('{"a":1}', 'utf8');
    const validReq = createSignedRequest({
      method: 'POST',
      url: '/api/v2/test',
      kid: 'fiscaliza-raw-body',
      privateKey,
      contentType: 'application/json',
      rawBody: validRaw
    });
    const validAuth = await authenticateS2sRequest(validReq, { requiredScope: 'barragens:read' });
    assert.equal(validAuth.ok, true);
    if (validAuth.ok) {
      assert.deepEqual(validAuth.rawBody, validRaw);
      assert.deepEqual(parseStrictUtf8JsonObject(validAuth.rawBody), { a: 1 });
    }

    // Alteração por whitespace mantendo assinatura/hash originais -> 401 BODY_HASH_MISMATCH
    const origReq = createSignedRequest({
      method: 'POST',
      url: '/api/v2/test',
      kid: 'fiscaliza-raw-body',
      privateKey,
      contentType: 'application/json',
      rawBody: validRaw
    });
    const wsTamperedReq = new PassThrough() as any;
    wsTamperedReq.method = 'POST';
    wsTamperedReq.url = '/api/v2/test';
    wsTamperedReq.headers = { ...origReq.headers };
    wsTamperedReq.end(Buffer.from('{"a": 1}', 'utf8'));

    const wsAuth = await authenticateS2sRequest(wsTamperedReq, { requiredScope: 'barragens:read' });
    assert.equal(wsAuth.ok, false);
    if (!wsAuth.ok) {
      assert.equal(wsAuth.httpStatus, 401);
      assert.equal(wsAuth.code, 'BODY_HASH_MISMATCH');
    }

    // Bloco string enviado em autenticação S2S falha fechado (400 RAW_BODY_UNAVAILABLE)
    const strEmitterReq = new EventEmitter() as any;
    strEmitterReq.method = 'POST';
    strEmitterReq.url = '/api/v2/test';
    strEmitterReq.headers = { ...origReq.headers };
    const strAuthPromise = authenticateS2sRequest(strEmitterReq, {
      requiredScope: 'barragens:read'
    });
    strEmitterReq.emit('data', '{"a":1}');
    const strAuthResult = await strAuthPromise;
    assert.equal(strAuthResult.ok, false);
    if (!strAuthResult.ok) {
      assert.equal(strAuthResult.httpStatus, 400);
      assert.equal(strAuthResult.code, 'RAW_BODY_UNAVAILABLE');
    }

    // UTF-8 inválido falha fechado na interpretação JSON, preservando integridade do hash em bytes brutos
    const invalidUtf8Bytes = Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d]);
    assert.throws(
      () => decodeStrictUtf8(invalidUtf8Bytes),
      (err: any) => err instanceof JsonBodyReaderError && err.statusCode === 400 && err.code === 'INVALID_UTF8'
    );
    assert.throws(
      () => parseStrictUtf8JsonObject(invalidUtf8Bytes),
      (err: any) => err instanceof JsonBodyReaderError && err.statusCode === 400 && err.code === 'INVALID_UTF8'
    );

    const invalidUtf8Stream = new PassThrough() as any;
    invalidUtf8Stream.end(invalidUtf8Bytes);
    await assert.rejects(
      readJsonObjectBody(invalidUtf8Stream, { invalidJsonMessage: 'Corpo JSON inválido.' }),
      (err: any) => err instanceof JsonBodyReaderError && err.statusCode === 400
    );

    // Hash de integridade continua sendo calculado sobre bytes brutos
    const invalidUtf8SignedReq = createSignedRequest({
      method: 'POST',
      url: '/api/v2/test',
      kid: 'fiscaliza-raw-body',
      privateKey,
      contentType: 'application/octet-stream',
      rawBody: invalidUtf8Bytes
    });
    const invalidUtf8Auth = await authenticateS2sRequest(invalidUtf8SignedReq, {
      requiredScope: 'barragens:read'
    });
    assert.equal(invalidUtf8Auth.ok, true);
    if (invalidUtf8Auth.ok) {
      assert.throws(
        () => parseStrictUtf8JsonObject(invalidUtf8Auth.rawBody),
        (err: any) => err instanceof JsonBodyReaderError && err.statusCode === 400 && err.code === 'INVALID_UTF8'
      );
    }
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Rejeita assinatura inválida, timestamp expirado e adulteração de método/query/Content-Type antes de reservar jti', async () => {
  const validKeys = createKeyPair();
  const wrongKeys = createKeyPair();
  const mockDb = createMockSupabaseAdmin({
    clients: [
      {
        sistema: 'classifica',
        kid: 'classifica-active',
        public_key_pem: validKeys.publicKeyPem,
        escopos: ['health:read', 'barragens:read'],
        ativo: true
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    const badSigRes = createMockRes();
    await healthHandler(
      createSignedRequest({ kid: 'classifica-active', privateKey: wrongKeys.privateKey }),
      badSigRes
    );
    assert.equal(badSigRes.getStatus(), 401);

    const nowSec = Math.floor(Date.now() / 1000);
    for (const badTs of [nowSec - 301, nowSec + 301]) {
      const expiredRes = createMockRes();
      await healthHandler(
        createSignedRequest({
          kid: 'classifica-active',
          privateKey: validKeys.privateKey,
          timestamp: badTs
        }),
        expiredRes
      );
      assert.equal(expiredRes.getStatus(), 401);
    }

    const badMethodRes = createMockRes();
    await healthHandler(
      createSignedRequest({
        method: 'GET',
        signMethodOverride: 'POST',
        kid: 'classifica-active',
        privateKey: validKeys.privateKey
      }),
      badMethodRes
    );
    assert.equal(badMethodRes.getStatus(), 401);

    const badQueryRes = createMockRes();
    await healthHandler(
      createSignedRequest({
        url: '/api/v2/health?a=1',
        signQueryOverride: 'a=2',
        kid: 'classifica-active',
        privateKey: validKeys.privateKey
      }),
      badQueryRes
    );
    assert.equal(badQueryRes.getStatus(), 401);

    const badCtResult = await authenticateS2sRequest(
      createSignedRequest({
        method: 'POST',
        url: '/api/v2/test',
        kid: 'classifica-active',
        privateKey: validKeys.privateKey,
        contentType: 'text/plain',
        signContentTypeOverride: 'application/json',
        rawBody: Buffer.from('{"a":1}', 'utf8')
      }),
      { requiredScope: 'barragens:read' }
    );
    assert.equal(badCtResult.ok, false);
    if (!badCtResult.ok) {
      assert.equal(badCtResult.httpStatus, 401);
    }

    const preParsedResult = await authenticateS2sRequest(
      {
        method: 'POST',
        url: '/api/v2/test',
        headers: { 'content-type': 'application/json' },
        body: { a: 1 }
      } as any,
      { requiredScope: 'barragens:read' }
    );
    assert.equal(preParsedResult.ok, false);
    if (!preParsedResult.ok) {
      assert.equal(preParsedResult.httpStatus, 400);
      assert.equal(preParsedResult.code, 'RAW_BODY_UNAVAILABLE');
    }

    assert.equal(mockDb._rpcCalls.length, 0);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Replay concorrente do mesmo jti retorna exatamente um 200 e um 409', async () => {
  const { publicKeyPem, privateKey } = createKeyPair();
  const mockDb = createMockSupabaseAdmin({
    clients: [
      {
        sistema: 'notifica',
        kid: 'notifica-replay-test',
        public_key_pem: publicKeyPem,
        escopos: ['health:read'],
        ativo: true
      }
    ],
    nonceDelayMs: 15
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    const fixedJti = crypto.randomUUID();
    const fixedTs = Math.floor(Date.now() / 1000);

    const req1 = createSignedRequest({
      kid: 'notifica-replay-test',
      privateKey,
      timestamp: fixedTs,
      jti: fixedJti
    });
    const req2 = createSignedRequest({
      kid: 'notifica-replay-test',
      privateKey,
      timestamp: fixedTs,
      jti: fixedJti
    });
    const res1 = createMockRes();
    const res2 = createMockRes();

    await Promise.all([healthHandler(req1, res1), healthHandler(req2, res2)]);

    const statuses = [res1.getStatus(), res2.getStatus()].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Escopo ausente retorna 403 e falha do banco retorna 503 sem vazar detalhes internos', async () => {
  const { publicKeyPem, privateKey } = createKeyPair();
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => {
    warnings.push(args.map(a => String(a)).join(' '));
  };

  try {
    setTestSupabaseAdminForSemaAudit(
      createMockSupabaseAdmin({
        clients: [
          {
            sistema: 'classifica',
            kid: 'classifica-no-health',
            public_key_pem: publicKeyPem,
            escopos: ['barragens:read'],
            ativo: true
          }
        ]
      })
    );
    const forbiddenRes = createMockRes();
    await healthHandler(
      createSignedRequest({ kid: 'classifica-no-health', privateKey }),
      forbiddenRes
    );
    assert.equal(forbiddenRes.getStatus(), 403);

    setTestSupabaseAdminForSemaAudit(
      createMockSupabaseAdmin({
        clients: [
          {
            sistema: 'classifica',
            kid: 'classifica-health',
            public_key_pem: publicKeyPem,
            escopos: ['health:read'],
            ativo: true
          }
        ],
        failHealthQuery: true
      })
    );
    const dbFailRes = createMockRes();
    await healthHandler(
      createSignedRequest({ kid: 'classifica-health', privateKey }),
      dbFailRes
    );
    assert.equal(dbFailRes.getStatus(), 503);
    assert.deepEqual(dbFailRes.getBody(), {
      success: false,
      status: 'unavailable',
      retryable: true
    });

    for (const log of warnings) {
      assert.doesNotMatch(log, /BEGIN PUBLIC KEY|secret|password|postgres:\/\//i);
    }
  } finally {
    console.warn = origWarn;
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('5) Rotina de limpeza de nonces exige CRON_SECRET, rejeita ausência/erro/service role, remove apenas vencidos em lotes e preserva ativos', async () => {
  const prevCron = process.env.CRON_SECRET;
  const prevService = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const syntheticCronSecret = 'test-vercel-cron-secret-value-02';
  const syntheticServiceRole = 'synthetic-service-role-should-not-authorize';
  const now = Date.now();
  const expiredJti1 = '11111111-1111-4111-8111-111111111111';
  const expiredJti2 = '22222222-2222-4222-8222-222222222222';
  const expiredJti3 = '33333333-3333-4333-8333-333333333333';
  const activeJti1 = '44444444-4444-4444-8444-444444444444';
  const activeJti2 = '55555555-5555-4555-8555-555555555555';

  const mockDb = createMockSupabaseAdmin({
    clients: [],
    initialNonces: [
      { sistema: 'notifica', jti: expiredJti1, expiresAtMs: now - 120_000, consumidoEmIso: new Date(now - 720_000).toISOString() },
      { sistema: 'classifica', jti: expiredJti2, expiresAtMs: now - 5_000, consumidoEmIso: new Date(now - 605_000).toISOString() },
      { sistema: 'fiscaliza', jti: expiredJti3, expiresAtMs: now - 1_000, consumidoEmIso: new Date(now - 601_000).toISOString() },
      { sistema: 'notifica', jti: activeJti1, expiresAtMs: now + 300_000, consumidoEmIso: new Date(now - 300_000).toISOString() },
      { sistema: 'fiscaliza', jti: activeJti2, expiresAtMs: now + 600_000, consumidoEmIso: new Date(now).toISOString() }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    // 1. Sem CRON_SECRET configurado no servidor -> 401 mesmo enviando Bearer
    delete process.env.CRON_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = syntheticServiceRole;

    const unconfRes = createMockRes();
    await noncesCleanupHandler(
      {
        method: 'GET',
        url: '/api/v2/s2s-nonces-cleanup',
        headers: { authorization: `Bearer ${syntheticServiceRole}` }
      } as any,
      unconfRes
    );
    assert.equal(unconfRes.getStatus(), 401);
    assert.equal(JSON.stringify(unconfRes.getBody()).includes(syntheticServiceRole), false);

    // 2. Com CRON_SECRET configurado: rejeita sem Authorization, com segredo errado ou usando service role como Bearer
    process.env.CRON_SECRET = syntheticCronSecret;

    for (const badAuth of [
      undefined,
      '',
      'Bearer wrong-secret',
      syntheticCronSecret,
      `Bearer ${syntheticServiceRole}`
    ]) {
      const deniedRes = createMockRes();
      await noncesCleanupHandler(
        {
          method: 'GET',
          url: '/api/v2/s2s-nonces-cleanup',
          headers: badAuth !== undefined ? { authorization: badAuth } : {}
        } as any,
        deniedRes
      );
      assert.equal(deniedRes.getStatus(), 401);
      assert.equal(JSON.stringify(deniedRes.getBody()).includes(syntheticCronSecret), false);
      assert.equal(JSON.stringify(deniedRes.getBody()).includes(syntheticServiceRole), false);
    }

    // 3. Método não permitido -> 405
    const wrongMethodRes = createMockRes();
    await noncesCleanupHandler(
      {
        method: 'DELETE',
        url: '/api/v2/s2s-nonces-cleanup',
        headers: { authorization: `Bearer ${syntheticCronSecret}` }
      } as any,
      wrongMethodRes
    );
    assert.equal(wrongMethodRes.getStatus(), 405);

    // 3b. Parâmetro limit inválido -> 400 sem gravar execução
    const badLimitRes = createMockRes();
    await noncesCleanupHandler(
      {
        method: 'GET',
        url: '/api/v2/s2s-nonces-cleanup?limit=abc',
        headers: { authorization: `Bearer ${syntheticCronSecret}` }
      } as any,
      badLimitRes
    );
    assert.equal(badLimitRes.getStatus(), 400);
    assert.equal(mockDb._cleanupAuditInserts.length, 0);

    // 4. CRON_SECRET correto com limit=2 executa em múltiplos lotes, remove somente os 3 vencidos, preserva ativos e registra 1 resumo
    const okRes = createMockRes();
    await noncesCleanupHandler(
      {
        method: 'GET',
        url: '/api/v2/s2s-nonces-cleanup?limit=2',
        headers: { authorization: `Bearer ${syntheticCronSecret}` }
      } as any,
      okRes
    );
    assert.equal(okRes.getStatus(), 200);
    const body = okRes.getBody();
    assert.equal(body.success, true);
    assert.equal(body.deletedCount, 3);
    assert.equal(body.batchesExecuted, 2);
    assert.equal(body.batchLimit, 2);
    assert.equal(JSON.stringify(body).includes(syntheticCronSecret), false);
    assert.equal(JSON.stringify(body).includes(syntheticServiceRole), false);

    assert.equal(mockDb._reservedNonces.has(`notifica::${expiredJti1}`), false);
    assert.equal(mockDb._reservedNonces.has(`classifica::${expiredJti2}`), false);
    assert.equal(mockDb._reservedNonces.has(`fiscaliza::${expiredJti3}`), false);
    assert.equal(mockDb._reservedNonces.has(`notifica::${activeJti1}`), true);
    assert.equal(mockDb._reservedNonces.has(`fiscaliza::${activeJti2}`), true);

    assert.equal(mockDb._cleanupAuditInserts.length, 1);
    assert.equal(mockDb._auditSelectCalled, false);
    const successAudit = mockDb._cleanupAuditInserts[0];
    assert.deepEqual(Object.keys(successAudit).sort(), [
      'batch_limit',
      'batches_executed',
      'deleted_count',
      'duration_ms',
      'error_code',
      'finished_at',
      'started_at',
      'status'
    ]);
    assert.equal(successAudit.status, 'success');
    assert.equal(successAudit.error_code, null);
    assert.equal(successAudit.deleted_count, 3);
    assert.equal(successAudit.batches_executed, 2);
    assert.equal(successAudit.batch_limit, 2);
    assert.equal(Number.isInteger(successAudit.duration_ms), true);
    assert.equal(successAudit.duration_ms >= 0, true);
    assert.equal(Number.isNaN(Date.parse(successAudit.started_at)), false);
    assert.equal(Number.isNaN(Date.parse(successAudit.finished_at)), false);
    assert.equal(Date.parse(successAudit.finished_at) >= Date.parse(successAudit.started_at), true);
    assert.equal(JSON.stringify(successAudit).includes(syntheticCronSecret), false);
    assert.equal(JSON.stringify(successAudit).includes(syntheticServiceRole), false);

    // 5. Falha de banco retorna 503 sem vazar detalhes ou segredo e grava erro genérico 'cleanup_rpc_failed'
    const failDb = createMockSupabaseAdmin({
      clients: [],
      failCleanupRpc: true
    });
    setTestSupabaseAdminForSemaAudit(failDb);
    const failRes = createMockRes();
    await noncesCleanupHandler(
      {
        method: 'GET',
        url: '/api/v2/s2s-nonces-cleanup',
        headers: { authorization: `Bearer ${syntheticCronSecret}` }
      } as any,
      failRes
    );
    assert.equal(failRes.getStatus(), 503);
    assert.deepEqual(failRes.getBody(), {
      success: false,
      status: 'unavailable',
      retryable: true
    });
    assert.equal(JSON.stringify(failRes.getBody()).includes(syntheticCronSecret), false);
    assert.equal(failDb._cleanupAuditInserts.length, 1);
    assert.equal(failDb._auditSelectCalled, false);
    assert.equal(failDb._cleanupAuditInserts[0].status, 'failure');
    assert.equal(failDb._cleanupAuditInserts[0].error_code, 'cleanup_rpc_failed');
    assert.equal(failDb._cleanupAuditInserts[0].deleted_count, 0);
    assert.equal(failDb._cleanupAuditInserts[0].batches_executed, 0);
    assert.equal(failDb._cleanupAuditInserts[0].batch_limit, 5000);
    assert.equal(JSON.stringify(failDb._cleanupAuditInserts[0]).includes('postgres://'), false);
    assert.equal(JSON.stringify(failDb._cleanupAuditInserts[0]).includes(syntheticCronSecret), false);
    assert.equal(JSON.stringify(failDb._cleanupAuditInserts[0]).includes(syntheticServiceRole), false);

    // 6. Falha parcial após 1 lote preserva deleted_count e batches_executed acumulados
    const partialFailDb = createMockSupabaseAdmin({
      clients: [],
      failCleanupAfterBatches: 1,
      initialNonces: [
        { sistema: 'notifica', jti: expiredJti1, expiresAtMs: now - 120_000, consumidoEmIso: new Date(now - 720_000).toISOString() },
        { sistema: 'classifica', jti: expiredJti2, expiresAtMs: now - 5_000, consumidoEmIso: new Date(now - 605_000).toISOString() },
        { sistema: 'fiscaliza', jti: expiredJti3, expiresAtMs: now - 1_000, consumidoEmIso: new Date(now - 601_000).toISOString() }
      ]
    });
    setTestSupabaseAdminForSemaAudit(partialFailDb);
    const partialFailRes = createMockRes();
    await noncesCleanupHandler(
      {
        method: 'POST',
        url: '/api/v2/s2s-nonces-cleanup?limit=2',
        headers: { authorization: `Bearer ${syntheticCronSecret}` }
      } as any,
      partialFailRes
    );
    assert.equal(partialFailRes.getStatus(), 503);
    assert.equal(partialFailDb._cleanupAuditInserts.length, 1);
    assert.equal(partialFailDb._cleanupAuditInserts[0].status, 'failure');
    assert.equal(partialFailDb._cleanupAuditInserts[0].error_code, 'cleanup_rpc_failed');
    assert.equal(partialFailDb._cleanupAuditInserts[0].deleted_count, 2);
    assert.equal(partialFailDb._cleanupAuditInserts[0].batches_executed, 1);
    assert.equal(partialFailDb._cleanupAuditInserts[0].batch_limit, 2);

    // 7. Exceção inesperada grava 'unexpected_error' e mantém 503 sem vazar erro bruto
    const throwRpcDb = createMockSupabaseAdmin({
      clients: [],
      throwOnCleanupRpc: true
    });
    setTestSupabaseAdminForSemaAudit(throwRpcDb);
    const throwRpcRes = createMockRes();
    await noncesCleanupHandler(
      {
        method: 'GET',
        url: '/api/v2/s2s-nonces-cleanup',
        headers: { authorization: `Bearer ${syntheticCronSecret}` }
      } as any,
      throwRpcRes
    );
    assert.equal(throwRpcRes.getStatus(), 503);
    assert.equal(throwRpcDb._cleanupAuditInserts.length, 1);
    assert.equal(throwRpcDb._cleanupAuditInserts[0].status, 'failure');
    assert.equal(throwRpcDb._cleanupAuditInserts[0].error_code, 'unexpected_error');
    assert.equal(JSON.stringify(throwRpcDb._cleanupAuditInserts[0]).includes('postgres://'), false);
    assert.equal(JSON.stringify(throwRpcRes.getBody()).includes('postgres://'), false);

    // 8. Falha (error ou exceção) ao inserir resumo de auditoria não altera resposta 200 ou 503
    const auditErrorDb = createMockSupabaseAdmin({
      clients: [],
      failAuditInsert: true,
      initialNonces: [
        { sistema: 'notifica', jti: expiredJti1, expiresAtMs: now - 60_000, consumidoEmIso: new Date(now - 600_000).toISOString() }
      ]
    });
    setTestSupabaseAdminForSemaAudit(auditErrorDb);
    const auditErrorOkRes = createMockRes();
    await noncesCleanupHandler(
      {
        method: 'GET',
        url: '/api/v2/s2s-nonces-cleanup?limit=10',
        headers: { authorization: `Bearer ${syntheticCronSecret}` }
      } as any,
      auditErrorOkRes
    );
    assert.equal(auditErrorOkRes.getStatus(), 200);
    assert.equal(auditErrorOkRes.getBody().success, true);
    assert.equal(auditErrorOkRes.getBody().deletedCount, 1);
    assert.equal(auditErrorDb._cleanupAuditInserts.length, 1);
    assert.equal(JSON.stringify(auditErrorOkRes.getBody()).includes('postgres://'), false);

    const auditThrowDb = createMockSupabaseAdmin({
      clients: [],
      failCleanupRpc: true,
      throwAuditInsert: true
    });
    setTestSupabaseAdminForSemaAudit(auditThrowDb);
    const auditThrowFailRes = createMockRes();
    await noncesCleanupHandler(
      {
        method: 'GET',
        url: '/api/v2/s2s-nonces-cleanup',
        headers: { authorization: `Bearer ${syntheticCronSecret}` }
      } as any,
      auditThrowFailRes
    );
    assert.equal(auditThrowFailRes.getStatus(), 503);
    assert.deepEqual(auditThrowFailRes.getBody(), {
      success: false,
      status: 'unavailable',
      retryable: true
    });
    assert.equal(auditThrowDb._cleanupAuditInserts.length, 1);
    assert.equal(JSON.stringify(auditThrowFailRes.getBody()).includes('secret-token'), false);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    if (prevCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCron;
    if (prevService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevService;
  }
});
