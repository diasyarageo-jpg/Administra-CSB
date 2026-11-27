// tests/s2sCadastroNovoEntidadeOrigens.test.ts
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
import { setTestSupabaseAdminForSemaAudit } from '../src/server/semaAudit';

const ROOT_DIR = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'supabase', 'migrations');
const ORIGINAL_MIGRATION_FILENAME = '20261127_s2s_politicas_e_operacoes.sql';
const FIX_MIGRATION_FILENAME = '20261128_fix_s2s_cadastro_novo_entidade_origens.sql';
const FIX_MIGRATION_PATH = path.join(MIGRATIONS_DIR, FIX_MIGRATION_FILENAME);

const VALID_CPF_A = '52998224725';
const VALID_CPF_B = '11144477735';
const VALID_CNPJ_A = '11222333000181';

const REAL_ENTIDADE_ORIGENS_COLUMNS = new Set([
  'id',
  'entidade_tipo',
  'entidade_id',
  'origem_sistema',
  'origem_registro_id',
  'lote_id',
  'data_origem',
  'data_recepcao',
  'payload_original',
  'conciliacao_status',
  'evidencia',
  'aprovado_por',
  'aprovado_em',
  'observacoes'
]);

const ALLOWED_ORIGEM_SISTEMA = new Set([
  'Administra',
  'Classifica',
  'Notifica',
  'Fiscaliza',
  'SEMA-MT'
]);

const FORBIDDEN_ENTIDADE_ORIGENS_COLUMNS = [
  'tabela_origem',
  'confiabilidade',
  'sistema_origem',
  'registro_origem_id'
];

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
    getBody: () => body
  };
  return res;
}

function createSignedS2sRequest(opts: {
  url: string;
  kid: string;
  privateKey: crypto.KeyObject;
  body: unknown;
  consumerUserId: string;
}) {
  const method = 'POST';
  const rawBody = Buffer.from(JSON.stringify(opts.body), 'utf8');
  const contentType = 'application/json; charset=utf-8';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const jti = crypto.randomUUID();
  const bodySha = sha256BodyHexLower(rawBody);

  const canonicalMessage = buildS2sCanonicalMessage({
    method,
    normalizedPath: normalizePublicPath(opts.url),
    canonicalQuery: canonicalizeQueryString(''),
    contentTypeNormalized: normalizeContentType(contentType),
    bodySha256HexLower: bodySha,
    kid: opts.kid,
    timestamp,
    jti,
    consumerUserId: opts.consumerUserId,
    consumerRole: ''
  });

  const signature = crypto
    .sign(null, Buffer.from(canonicalMessage, 'utf8'), opts.privateKey)
    .toString('base64url');

  const stream = new PassThrough() as any;
  stream.method = method;
  stream.url = opts.url;
  stream.headers = {
    'x-s2s-key-id': opts.kid,
    'x-s2s-timestamp': timestamp,
    'x-s2s-jti': jti,
    'x-s2s-body-sha256': bodySha,
    'x-s2s-signature': signature,
    'content-type': contentType,
    'x-consumer-user-id': opts.consumerUserId
  };
  stream.end(rawBody);
  return stream;
}

/**
 * Simula fielmente o schema real de public.entidade_origens e a semântica transacional
 * da função corrigida public.s2s_executar_cadastro_novo:
 * - valida explicitamente colunas reais e CHECK de origem_sistema
 * - aplica UNIQUE (entidade_tipo, origem_sistema, origem_registro_id)
 * - executa rollback integral de cadastro mestre, origem e log em qualquer erro/conflito
 */
function createStrictSchemaMockSupabase(options: {
  clients: MockClient[];
  politicas: MockPolicy[];
  initialEntidadeOrigens?: Array<Record<string, any>>;
  initialEmpreendedores?: Array<Record<string, any>>;
}) {
  const nonces = new Set<string>();
  const state = {
    politicas: [...options.politicas],
    empreendedores: [...(options.initialEmpreendedores || [])],
    barragens: [] as Array<Record<string, any>>,
    rts: [] as Array<Record<string, any>>,
    entidadeOrigens: [...(options.initialEntidadeOrigens || [])],
    logs: [] as Array<Record<string, any>>
  };

  function normDigits(v: unknown): string {
    return String(v || '').replace(/\D/g, '');
  }

  function clone<T>(val: T): T {
    return JSON.parse(JSON.stringify(val));
  }

  function insertIntoRealEntidadeOrigens(row: Record<string, any>): { inserted: boolean } {
    for (const col of Object.keys(row)) {
      if (!REAL_ENTIDADE_ORIGENS_COLUMNS.has(col)) {
        throw new Error(`column "${col}" of relation "entidade_origens" does not exist`);
      }
    }
    if (!ALLOWED_ORIGEM_SISTEMA.has(String(row.origem_sistema))) {
      throw new Error(`new row violates check constraint on "origem_sistema": ${row.origem_sistema}`);
    }
    if (!row.entidade_tipo || !row.entidade_id || !row.origem_registro_id) {
      throw new Error('null value in NOT NULL column of entidade_origens');
    }

    const existing = state.entidadeOrigens.find(
      eo =>
        eo.entidade_tipo === row.entidade_tipo &&
        eo.origem_sistema === row.origem_sistema &&
        eo.origem_registro_id === row.origem_registro_id
    );
    if (existing) {
      if (existing.entidade_id !== row.entidade_id) {
        throw new Error('ORIGIN_REFERENCE_CONFLICT');
      }
      return { inserted: false };
    }

    state.entidadeOrigens.push({
      id: crypto.randomUUID(),
      entidade_tipo: row.entidade_tipo,
      entidade_id: row.entidade_id,
      origem_sistema: row.origem_sistema,
      origem_registro_id: row.origem_registro_id,
      lote_id: null,
      data_origem: row.data_origem ?? new Date().toISOString(),
      data_recepcao: new Date().toISOString(),
      payload_original: {},
      conciliacao_status: 'confirmado',
      evidencia: {},
      aprovado_por: null,
      aprovado_em: null,
      observacoes: row.observacoes ?? null
    });
    return { inserted: true };
  }

  const mock: any = {
    _state: state,
    auth: {
      async getUser() {
        return { data: { user: null }, error: { message: 'unused' } };
      }
    },
    from(table: string) {
      const filters: Array<{ col: string; val: any }> = [];
      const builder: any = {
        select() {
          return builder;
        },
        eq(col: string, val: any) {
          filters.push({ col, val });
          return builder;
        },
        async limit(n: number) {
          if (table === 'integracao_clientes_s2s') {
            return {
              data: options.clients.filter(c => filters.every(f => (c as any)[f.col] === f.val)).slice(0, n),
              error: null
            };
          }
          if (table === 'integracao_s2s_politicas') {
            return {
              data: clone(
                state.politicas.filter(p => filters.every(f => (p as any)[f.col] === f.val)).slice(0, n)
              ),
              error: null
            };
          }
          return { data: [], error: null };
        },
        async insert(row: Record<string, any>) {
          if (table === 'integracao_s2s_operacoes_log') {
            state.logs.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...clone(row) });
            return { data: null, error: null };
          }
          return { data: null, error: { message: 'blocked' } };
        }
      };
      return builder;
    },
    async rpc(fn: string, params: Record<string, any>) {
      if (fn === 'reservar_nonce_s2s') {
        const key = `${params.p_sistema}::${String(params.p_jti).toLowerCase()}`;
        if (nonces.has(key)) return { data: false, error: null };
        nonces.add(key);
        return { data: true, error: null };
      }

      if (fn !== 's2s_executar_cadastro_novo') {
        return { data: null, error: { message: 'unexpected rpc' } };
      }

      const sistema = String(params.p_sistema_origem || '').trim().toLowerCase();
      const sistemaMap: Record<string, string> = {
        classifica: 'Classifica',
        notifica: 'Notifica',
        fiscaliza: 'Fiscaliza'
      };
      const origemSistema = sistemaMap[sistema] || null;
      if (!origemSistema) {
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

      const existingLog = state.logs.find(
        l =>
          l.sistema_origem === sistema &&
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
      const snapshotEmp = clone(state.empreendedores);
      const snapshotBar = clone(state.barragens);
      const snapshotRts = clone(state.rts);
      const snapshotOrigens = clone(state.entidadeOrigens);
      const snapshotLogs = clone(state.logs);

      try {
        let tabelaNome = 'empreendedores';
        let entidadeTipo = 'empreendedor';
        let newId = '';

        if (params.p_operacao === 'cadastrar_empreendedor') {
          newId = dados.id || `emp_${crypto.randomUUID().slice(0, 8)}`;
          const doc = normDigits(dados.cpf_cnpj);
          if (state.empreendedores.some(e => e.id === newId || normDigits(e.cpf_cnpj) === doc)) {
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'DUPLICATE_RECORD',
                error: 'Empreendedor já existe no cadastro mestre.'
              },
              error: null
            };
          }
          state.empreendedores.push({
            id: newId,
            ...clone(dados),
            situacao: 'Ativo'
          });
        } else if (params.p_operacao === 'cadastrar_barragem') {
          tabelaNome = 'barragens';
          entidadeTipo = 'barragem';
          newId = dados.id || `bar_${crypto.randomUUID().slice(0, 8)}`;
          if (
            state.barragens.some(
              b =>
                b.id === newId ||
                (dados.snisb && String(b.snisb || '').toUpperCase() === String(dados.snisb).toUpperCase())
            )
          ) {
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'DUPLICATE_RECORD',
                error: 'Barragem já existe no cadastro mestre.'
              },
              error: null
            };
          }
          state.barragens.push({
            id: newId,
            ...clone(dados),
            situacao: 'Ativa'
          });
        } else {
          tabelaNome = 'rts';
          entidadeTipo = 'rt';
          newId = dados.id || `rt_${crypto.randomUUID().slice(0, 8)}`;
          const cpf = normDigits(dados.cpf);
          if (state.rts.some(r => r.id === newId || (cpf && normDigits(r.cpf) === cpf))) {
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'DUPLICATE_RECORD',
                error: 'RT já existe no cadastro mestre.'
              },
              error: null
            };
          }
          state.rts.push({
            id: newId,
            ...clone(dados),
            situacao: 'Ativo'
          });
        }

        const refExt =
          typeof dados.referencia_externa === 'string' && dados.referencia_externa.trim()
            ? dados.referencia_externa.trim()
            : '';
        const origemRegistroId = refExt || newId;

        insertIntoRealEntidadeOrigens({
          entidade_tipo: entidadeTipo,
          entidade_id: newId,
          origem_sistema: origemSistema,
          origem_registro_id: origemRegistroId,
          data_origem: new Date().toISOString(),
          observacoes: `Cadastro novo via S2S por ${params.p_usuario_origem}`
        });

        const result = {
          success: true,
          http_status: 201,
          operacao: params.p_operacao,
          modo: 'execucao_direta',
          entidade_tipo: entidadeTipo,
          tabela_nome: tabelaNome,
          registro_id: newId,
          situacao: 'Ativo',
          sistema_origem: sistema,
          usuario_origem: params.p_usuario_origem,
          matricula_origem: params.p_matricula_origem ?? null,
          historico_id: crypto.randomUUID(),
          idempotency_key: params.p_idempotency_key
        };

        state.logs.push({
          id: crypto.randomUUID(),
          sistema_origem: sistema,
          kid: params.p_kid,
          jti: params.p_jti,
          operacao: params.p_operacao,
          politica_id: 'pol-id',
          modo_aplicado: 'execucao_direta',
          idempotency_key: params.p_idempotency_key,
          request_hash_sha256: params.p_request_hash_sha256,
          usuario_origem: params.p_usuario_origem,
          entidade_tipo: entidadeTipo,
          registro_id: newId,
          status_execucao: 'sucesso',
          http_status: 201,
          resultado_resumo: clone(result)
        });

        return { data: result, error: null };
      } catch (err: any) {
        // Simula rollback atômico de subtransação em PostgreSQL
        state.empreendedores = snapshotEmp;
        state.barragens = snapshotBar;
        state.rts = snapshotRts;
        state.entidadeOrigens = snapshotOrigens;
        state.logs = snapshotLogs;

        if (err?.message === 'ORIGIN_REFERENCE_CONFLICT') {
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
        return { data: null, error: { message: String(err?.message || 'transaction aborted') } };
      }
    }
  };
  return mock;
}

test('SQL: nova migration incremental corrige apenas public.s2s_executar_cadastro_novo com colunas e constraint reais de entidade_origens', () => {
  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort();

  const idxOrig = migrationFiles.indexOf(ORIGINAL_MIGRATION_FILENAME);
  const idxFix = migrationFiles.indexOf(FIX_MIGRATION_FILENAME);
  assert.notEqual(idxOrig, -1);
  assert.notEqual(idxFix, -1);
  assert.ok(idxFix > idxOrig, 'Migration corretiva deve ser posterior à migration original de 2026-11-27');

  const rawSql = fs.readFileSync(FIX_MIGRATION_PATH, 'utf8');
  const sqlNoComments = rawSql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // Altera exclusivamente a função public.s2s_executar_cadastro_novo
  const createFuncMatches = sqlNoComments.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-zA-Z0-9_.]+)/gi) || [];
  assert.equal(createFuncMatches.length, 1);
  assert.match(createFuncMatches[0], /public\.s2s_executar_cadastro_novo$/i);
  assert.equal(/\bCREATE\s+TABLE\b/i.test(sqlNoComments), false);
  assert.equal(/\bALTER\s+TABLE\b/i.test(sqlNoComments), false);
  assert.equal(/\bCREATE\s+POLICY\b/i.test(sqlNoComments), false);

  // Mapeamento explícito dos sistemas minúsculos para os valores da constraint CHECK e rejeição se ausente
  assert.match(sqlNoComments, /WHEN\s+'classifica'\s+THEN\s+'Classifica'/i);
  assert.match(sqlNoComments, /WHEN\s+'notifica'\s+THEN\s+'Notifica'/i);
  assert.match(sqlNoComments, /WHEN\s+'fiscaliza'\s+THEN\s+'Fiscaliza'/i);
  assert.match(sqlNoComments, /IF\s+v_origem_sistema\s+IS\s+NULL\s+THEN/i);

  // Extrai todo INSERT INTO public.entidade_origens (...) e ON CONFLICT (...)
  const eoInsertMatch = sqlNoComments.match(
    /INSERT\s+INTO\s+public\.entidade_origens\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*ON\s+CONFLICT\s*\(([\s\S]*?)\)\s*DO\s+NOTHING/i
  );
  assert.ok(eoInsertMatch, 'INSERT em public.entidade_origens com ON CONFLICT deve estar presente');

  const insertCols = eoInsertMatch![1]
    .split(',')
    .map(c => c.trim().toLowerCase())
    .filter(Boolean);
  const conflictCols = eoInsertMatch![3]
    .split(',')
    .map(c => c.trim().toLowerCase())
    .filter(Boolean);

  // Nenhum INSERT referencia colunas inexistentes ou antigas em entidade_origens
  for (const forbidden of FORBIDDEN_ENTIDADE_ORIGENS_COLUMNS) {
    assert.equal(
      insertCols.includes(forbidden),
      false,
      `Coluna proibida/inexistente "${forbidden}" encontrada no INSERT em entidade_origens`
    );
    assert.equal(
      conflictCols.includes(forbidden),
      false,
      `Coluna proibida/inexistente "${forbidden}" encontrada no ON CONFLICT de entidade_origens`
    );
  }

  for (const col of insertCols) {
    assert.ok(REAL_ENTIDADE_ORIGENS_COLUMNS.has(col), `Coluna não reconhecida em entidade_origens: ${col}`);
  }

  assert.deepEqual(insertCols, [
    'entidade_tipo',
    'entidade_id',
    'origem_sistema',
    'origem_registro_id',
    'data_origem',
    'observacoes'
  ]);
  assert.deepEqual(conflictCols, ['entidade_tipo', 'origem_sistema', 'origem_registro_id']);

  // Não copia CPF/CNPJ/dados pessoais para payload_original ou evidencia
  assert.equal(insertCols.includes('payload_original'), false);
  assert.equal(insertCols.includes('evidencia'), false);

  // Verifica detecção de entidade_id divergente e rollback transacional via subtransação
  assert.match(sqlNoComments, /RETURNING\s+id\s+INTO\s+v_origin_row_id/i);
  assert.match(sqlNoComments, /v_existing_origin_entidade_id\s+IS\s+DISTINCT\s+FROM\s+v_new_id/i);
  assert.match(sqlNoComments, /RAISE\s+EXCEPTION\s+'ORIGIN_REFERENCE_CONFLICT'/i);
  assert.match(sqlNoComments, /WHEN\s+SQLSTATE\s+'P0001'\s+THEN/i);
  assert.match(sqlNoComments, /'ORIGIN_REFERENCE_CONFLICT'/);

  // Preserva grants restritivos
  assert.match(
    sqlNoComments,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.s2s_executar_cadastro_novo\([\s\S]*?\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
  );
  assert.match(
    sqlNoComments,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.s2s_executar_cadastro_novo\([\s\S]*?\)\s+TO\s+service_role/i
  );
});

test('Regressão: cadastro novo de empreendedor, barragem e RT grava entidade_origens com colunas reais e origem_sistema mapeado', async () => {
  const keys = createKeyPair();
  const mockDb = createStrictSchemaMockSupabase({
    clients: [
      {
        sistema: 'classifica',
        kid: 'classifica-k1',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: true
      },
      {
        sistema: 'notifica',
        kid: 'notifica-k1',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: true
      },
      {
        sistema: 'fiscaliza',
        kid: 'fiscaliza-k1',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: true
      }
    ],
    politicas: [
      {
        id: 'pol-1',
        sistema_origem: 'classifica',
        operacao: 'cadastrar_empreendedor',
        modo: 'execucao_direta',
        ativo: true,
        parametros: {},
        restricoes: {}
      },
      {
        id: 'pol-2',
        sistema_origem: 'notifica',
        operacao: 'cadastrar_barragem',
        modo: 'execucao_direta',
        ativo: true,
        parametros: {},
        restricoes: {}
      },
      {
        id: 'pol-3',
        sistema_origem: 'fiscaliza',
        operacao: 'cadastrar_rt',
        modo: 'execucao_direta',
        ativo: true,
        parametros: {},
        restricoes: {}
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    // 1. Empreendedor via classifica (com referenciaExterna explícita) -> origem_sistema = 'Classifica'
    const empRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.classifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'reg-emp-classifica-001',
          autorOrigem: { usuario: 'ana.classifica', matricula: 'CLS-01' },
          referenciaExterna: 'CLS-EMP-9001',
          dados: { nome: 'Fazenda Boa Esperança', cpf_cnpj: VALID_CNPJ_A, uf: 'MT' }
        }
      }),
      empRes
    );
    assert.equal(empRes.getStatus(), 201);
    const empId = empRes.getBody().registroId;

    // 2. Barragem via notifica (sem referenciaExterna -> fallback para v_new_id) -> origem_sistema = 'Notifica'
    const barRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'joao.notifica',
        body: {
          operacao: 'cadastrar_barragem',
          idempotencyKey: 'reg-bar-notifica-001',
          autorOrigem: { usuario: 'joao.notifica' },
          dados: { nome: 'Barragem Norte', municipio: 'Sorriso', uf: 'MT', snisb: 'SNISB-8801' }
        }
      }),
      barRes
    );
    assert.equal(barRes.getStatus(), 201);
    const barId = barRes.getBody().registroId;

    // 3. RT via fiscaliza (com referenciaExterna explícita) -> origem_sistema = 'Fiscaliza'
    const rtRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'fiscaliza-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'maria.fiscaliza',
        body: {
          operacao: 'cadastrar_rt',
          idempotencyKey: 'reg-rt-fiscaliza-001',
          autorOrigem: { usuario: 'maria.fiscaliza', matricula: 'FSC-22' },
          referenciaExterna: 'FSC-RT-300',
          dados: { nome: 'Eng. Roberto Lima', cpf: VALID_CPF_A, registro: 'CREA-MT-7711' }
        }
      }),
      rtRes
    );
    assert.equal(rtRes.getStatus(), 201);
    const rtId = rtRes.getBody().registroId;

    assert.equal(mockDb._state.entidadeOrigens.length, 3);

    const [eoEmp, eoBar, eoRt] = mockDb._state.entidadeOrigens;
    assert.equal(eoEmp.entidade_tipo, 'empreendedor');
    assert.equal(eoEmp.entidade_id, empId);
    assert.equal(eoEmp.origem_sistema, 'Classifica');
    assert.equal(eoEmp.origem_registro_id, 'CLS-EMP-9001');
    assert.deepEqual(eoEmp.payload_original, {});
    assert.deepEqual(eoEmp.evidencia, {});

    assert.equal(eoBar.entidade_tipo, 'barragem');
    assert.equal(eoBar.entidade_id, barId);
    assert.equal(eoBar.origem_sistema, 'Notifica');
    assert.equal(eoBar.origem_registro_id, barId);
    assert.deepEqual(eoBar.payload_original, {});
    assert.deepEqual(eoBar.evidencia, {});

    assert.equal(eoRt.entidade_tipo, 'rt');
    assert.equal(eoRt.entidade_id, rtId);
    assert.equal(eoRt.origem_sistema, 'Fiscaliza');
    assert.equal(eoRt.origem_registro_id, 'FSC-RT-300');
    assert.deepEqual(eoRt.payload_original, {});
    assert.deepEqual(eoRt.evidencia, {});

    // Nenhuma coluna inexistente foi gravada e nenhum CPF/CNPJ foi copiado para payload_original/evidencia
    for (const eo of mockDb._state.entidadeOrigens) {
      for (const forbidden of FORBIDDEN_ENTIDADE_ORIGENS_COLUMNS) {
        assert.equal(Object.prototype.hasOwnProperty.call(eo, forbidden), false);
      }
      const serializedSensitive = JSON.stringify({
        payload_original: eo.payload_original,
        evidencia: eo.evidencia,
        observacoes: eo.observacoes
      });
      assert.equal(serializedSensitive.includes(VALID_CNPJ_A), false);
      assert.equal(serializedSensitive.includes(VALID_CPF_A), false);
    }
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Regressão: referência externa repetida para a mesma entidade é idempotente e não duplica o vínculo', async () => {
  const keys = createKeyPair();
  const fixedEmpId = 'emp_prelinked_001';
  const mockDb = createStrictSchemaMockSupabase({
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
      {
        id: 'pol-1',
        sistema_origem: 'classifica',
        operacao: 'cadastrar_empreendedor',
        modo: 'execucao_direta',
        ativo: true,
        parametros: {},
        restricoes: {}
      }
    ],
    initialEntidadeOrigens: [
      {
        id: '00000000-0000-4000-8000-000000000999',
        entidade_tipo: 'empreendedor',
        entidade_id: fixedEmpId,
        origem_sistema: 'Classifica',
        origem_registro_id: 'CLS-SAME-ENTITY-01',
        payload_original: {},
        conciliacao_status: 'confirmado',
        evidencia: {}
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    const res = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.classifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'reg-same-origin-link-001',
          autorOrigem: { usuario: 'ana.classifica' },
          referenciaExterna: 'CLS-SAME-ENTITY-01',
          dados: { id: fixedEmpId, nome: 'Empreendedor Mesmo Vínculo', cpf_cnpj: VALID_CPF_B }
        }
      }),
      res
    );

    assert.equal(res.getStatus(), 201);
    assert.equal(res.getBody().registroId, fixedEmpId);
    assert.equal(mockDb._state.empreendedores.length, 1);
    assert.equal(mockDb._state.entidadeOrigens.length, 1);
    assert.equal(mockDb._state.entidadeOrigens[0].entidade_id, fixedEmpId);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Regressão: referência externa já vinculada a entidade_id diferente falha com conflito controlado e reverte cadastro e log de sucesso', async () => {
  const keys = createKeyPair();
  const mockDb = createStrictSchemaMockSupabase({
    clients: [
      {
        sistema: 'classifica',
        kid: 'classifica-k1',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: true
      },
      {
        sistema: 'notifica',
        kid: 'notifica-k1',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: true
      }
    ],
    politicas: [
      {
        id: 'pol-1',
        sistema_origem: 'classifica',
        operacao: 'cadastrar_empreendedor',
        modo: 'execucao_direta',
        ativo: true,
        parametros: {},
        restricoes: {}
      },
      {
        id: 'pol-2',
        sistema_origem: 'notifica',
        operacao: 'cadastrar_barragem',
        modo: 'execucao_direta',
        ativo: true,
        parametros: {},
        restricoes: {}
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    // 1. Primeiro cadastro válido vincula CLS-REF-CONFLICT à primeira entidade
    const firstRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.classifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'reg-conflict-first-001',
          autorOrigem: { usuario: 'ana.classifica' },
          referenciaExterna: 'CLS-REF-CONFLICT',
          dados: { nome: 'Empreendedor Original', cpf_cnpj: VALID_CPF_A }
        }
      }),
      firstRes
    );
    assert.equal(firstRes.getStatus(), 201);
    const originalId = firstRes.getBody().registroId;
    assert.equal(mockDb._state.empreendedores.length, 1);
    assert.equal(mockDb._state.entidadeOrigens.length, 1);
    assert.equal(mockDb._state.logs.filter((l: any) => l.status_execucao === 'sucesso').length, 1);

    // 2. Segundo cadastro (outro CPF/entidade_id, nova idempotencyKey) com a mesma referenciaExterna
    const conflictRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.classifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'reg-conflict-second-002',
          autorOrigem: { usuario: 'ana.classifica' },
          referenciaExterna: 'CLS-REF-CONFLICT',
          dados: { nome: 'Outro Empreendedor Conflitante', cpf_cnpj: VALID_CPF_B }
        }
      }),
      conflictRes
    );

    assert.equal(conflictRes.getStatus(), 409);
    assert.equal(conflictRes.getBody().success, false);
    assert.equal(conflictRes.getBody().code, 'ORIGIN_REFERENCE_CONFLICT');

    // Novo cadastro foi revertido, vínculo original preservado e nenhum log de sucesso adicional gravado
    assert.equal(mockDb._state.empreendedores.length, 1);
    assert.equal(mockDb._state.empreendedores[0].id, originalId);
    assert.equal(mockDb._state.entidadeOrigens.length, 1);
    assert.equal(mockDb._state.entidadeOrigens[0].entidade_id, originalId);
    assert.equal(mockDb._state.logs.filter((l: any) => l.status_execucao === 'sucesso').length, 1);
    assert.equal(
      mockDb._state.logs.some(
        (l: any) => l.status_execucao === 'rejeitado' && l.erro_codigo === 'ORIGIN_REFERENCE_CONFLICT'
      ),
      true
    );

    // 3. Mesmo cenário para barragem
    const bar1 = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'joao.notifica',
        body: {
          operacao: 'cadastrar_barragem',
          idempotencyKey: 'reg-bar-conflict-001',
          autorOrigem: { usuario: 'joao.notifica' },
          referenciaExterna: 'NOT-BAR-55',
          dados: { nome: 'Barragem A', municipio: 'Cuiabá', snisb: 'SN-100' }
        }
      }),
      bar1
    );
    assert.equal(bar1.getStatus(), 201);

    const barConflict = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'joao.notifica',
        body: {
          operacao: 'cadastrar_barragem',
          idempotencyKey: 'reg-bar-conflict-002',
          autorOrigem: { usuario: 'joao.notifica' },
          referenciaExterna: 'NOT-BAR-55',
          dados: { nome: 'Barragem B', municipio: 'Sinop', snisb: 'SN-200' }
        }
      }),
      barConflict
    );
    assert.equal(barConflict.getStatus(), 409);
    assert.equal(barConflict.getBody().code, 'ORIGIN_REFERENCE_CONFLICT');
    assert.equal(mockDb._state.barragens.length, 1);
    assert.equal(mockDb._state.logs.filter((l: any) => l.operacao === 'cadastrar_barragem' && l.status_execucao === 'sucesso').length, 1);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Regressão: execução idempotente repetida não duplica cadastro, entidade_origens nem log de sucesso', async () => {
  const keys = createKeyPair();
  const mockDb = createStrictSchemaMockSupabase({
    clients: [
      {
        sistema: 'fiscaliza',
        kid: 'fiscaliza-k1',
        public_key_pem: keys.publicKeyPem,
        escopos: ['operacoes:write'],
        ativo: true
      }
    ],
    politicas: [
      {
        id: 'pol-1',
        sistema_origem: 'fiscaliza',
        operacao: 'cadastrar_rt',
        modo: 'execucao_direta',
        ativo: true,
        parametros: {},
        restricoes: {}
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    const payload = {
      operacao: 'cadastrar_rt',
      idempotencyKey: 'reg-idem-rt-001',
      autorOrigem: { usuario: 'fiscal.01', matricula: 'F-01' },
      referenciaExterna: 'FSC-RT-IDEM-01',
      dados: { nome: 'Eng. Paula Costa', cpf: VALID_CPF_A, registro: 'CREA-MT-9988' }
    };

    const first = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'fiscaliza-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'fiscal.01',
        body: payload
      }),
      first
    );
    assert.equal(first.getStatus(), 201);
    assert.equal(first.getBody().idempotentReplay, false);

    const second = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'fiscaliza-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'fiscal.01',
        body: payload
      }),
      second
    );
    assert.equal(second.getStatus(), 200);
    assert.equal(second.getBody().idempotentReplay, true);
    assert.equal(second.getBody().registroId, first.getBody().registroId);

    assert.equal(mockDb._state.rts.length, 1);
    assert.equal(mockDb._state.entidadeOrigens.length, 1);
    assert.equal(mockDb._state.logs.filter((l: any) => l.status_execucao === 'sucesso').length, 1);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});
