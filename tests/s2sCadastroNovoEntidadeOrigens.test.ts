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
const FIX_MIGRATION_FILENAME = '20261127_s2s_v2_fix_cadastro_novo_entidade_origens.sql';
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
 * Simula fielmente a semântica revisada de public.s2s_executar_cadastro_novo
 * e o schema real de public.entidade_origens:
 * - registro em entidade_origens é obrigatório (sem bypass por to_regclass)
 * - consulta prévia por (entidade_tipo, origem_sistema, origem_registro_id)
 * - exige ID explícito igual para tratar repetição sem mutação
 * - falha/ausência da tabela reverte cadastro mestre, histórico e log de sucesso
 */
function createStrictSchemaMockSupabase(options: {
  clients: MockClient[];
  politicas: MockPolicy[];
  initialEntidadeOrigens?: Array<Record<string, any>>;
  initialEmpreendedores?: Array<Record<string, any>>;
  entidadeOrigensTableMissing?: boolean;
  simulateEntidadeOrigensInsertError?: boolean;
}) {
  const nonces = new Set<string>();
  const state = {
    politicas: [...options.politicas],
    empreendedores: [...(options.initialEmpreendedores || [])],
    barragens: [] as Array<Record<string, any>>,
    rts: [] as Array<Record<string, any>>,
    historico: [] as Array<Record<string, any>>,
    entidadeOrigens: [...(options.initialEntidadeOrigens || [])],
    logs: [] as Array<Record<string, any>>
  };

  function normDigits(v: unknown): string {
    return String(v || '').replace(/\D/g, '');
  }

  function clone<T>(val: T): T {
    return JSON.parse(JSON.stringify(val));
  }

  function assertEntidadeOrigensAvailable() {
    if (options.entidadeOrigensTableMissing) {
      throw new Error('relation "public.entidade_origens" does not exist');
    }
  }

  function insertIntoRealEntidadeOrigens(row: Record<string, any>): { inserted: boolean } {
    assertEntidadeOrigensAvailable();
    if (options.simulateEntidadeOrigensInsertError) {
      throw new Error('simulated constraint/contract failure on public.entidade_origens');
    }

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
      const explicitId =
        typeof dados.id === 'string' && dados.id.trim() ? dados.id.trim() : null;
      const refExt =
        typeof dados.referencia_externa === 'string' && dados.referencia_externa.trim()
          ? dados.referencia_externa.trim()
          : null;

      let tabelaNome = 'empreendedores';
      let entidadeTipo = 'empreendedor';
      let newId = '';

      if (params.p_operacao === 'cadastrar_empreendedor') {
        newId = explicitId || `emp_${crypto.randomUUID().slice(0, 8)}`;
      } else if (params.p_operacao === 'cadastrar_barragem') {
        tabelaNome = 'barragens';
        entidadeTipo = 'barragem';
        newId = explicitId || `bar_${crypto.randomUUID().slice(0, 8)}`;
      } else {
        tabelaNome = 'rts';
        entidadeTipo = 'rt';
        newId = explicitId || `rt_${crypto.randomUUID().slice(0, 8)}`;
      }

      const origemRegistroId = refExt || newId;

      const snapshotEmp = clone(state.empreendedores);
      const snapshotBar = clone(state.barragens);
      const snapshotRts = clone(state.rts);
      const snapshotHist = clone(state.historico);
      const snapshotOrigens = clone(state.entidadeOrigens);
      const snapshotLogs = clone(state.logs);

      try {
        assertEntidadeOrigensAvailable();

        // Consulta prévia em entidade_origens antes da checagem de duplicidade do cadastro mestre
        const existingOrigin = state.entidadeOrigens.find(
          eo =>
            eo.entidade_tipo === entidadeTipo &&
            eo.origem_sistema === origemSistema &&
            eo.origem_registro_id === origemRegistroId
        );

        if (existingOrigin) {
          if (!explicitId) {
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'ORIGIN_REFERENCE_CONFLICT',
                error:
                  'Referência externa já vinculada na origem; identificador explícito da entidade é obrigatório para confirmar correspondência.'
              },
              error: null
            };
          }

          if (existingOrigin.entidade_id !== explicitId) {
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'ORIGIN_REFERENCE_CONFLICT',
                error:
                  'Referência externa já está vinculada a outra entidade do mesmo tipo e sistema de origem.'
              },
              error: null
            };
          }

          const masterList =
            tabelaNome === 'empreendedores'
              ? state.empreendedores
              : tabelaNome === 'barragens'
              ? state.barragens
              : state.rts;
          const existingEntity = masterList.some(r => r.id === explicitId);
          if (!existingEntity) {
            return {
              data: {
                success: false,
                http_status: 409,
                code: 'ORIGIN_REFERENCE_CONFLICT',
                error: 'Vínculo de origem existente aponta para identificador inexistente no cadastro mestre.'
              },
              error: null
            };
          }
          const existingMaster = masterList.find(r => r.id === explicitId);

          const noOpResult = {
            success: true,
            http_status: 200,
            operacao: params.p_operacao,
            modo: 'execucao_direta',
            entidade_tipo: entidadeTipo,
            tabela_nome: tabelaNome,
            registro_id: explicitId,
            situacao: existingMaster?.situacao || 'Ativo',
            sistema_origem: sistema,
            usuario_origem: params.p_usuario_origem,
            matricula_origem: params.p_matricula_origem ?? null,
            historico_id: null,
            idempotency_key: params.p_idempotency_key,
            sem_mutacao: true,
            origem_ja_vinculada: true
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
            registro_id: explicitId,
            status_execucao: 'sucesso',
            http_status: 200,
            resultado_resumo: clone(noOpResult)
          });

          return { data: noOpResult, error: null };
        }

        // Checagem de duplicidade mestre antes da gravação atômica
        if (params.p_operacao === 'cadastrar_empreendedor') {
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

        const histId = crypto.randomUUID();
        state.historico.push({
          id: histId,
          tabela_nome: tabelaNome,
          registro_id: newId,
          operacao: 'INSERT'
        });

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
          historico_id: histId,
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
        // Rollback integral: cadastro mestre, histórico, origem e log
        state.empreendedores = snapshotEmp;
        state.barragens = snapshotBar;
        state.rts = snapshotRts;
        state.historico = snapshotHist;
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

test('SQL: nova migration segue padrão 20261127 após 20261127_s2s_politicas_e_operacoes, torna entidade_origens obrigatório e valida correspondência explícita', () => {
  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort();

  const idxOrig = migrationFiles.indexOf(ORIGINAL_MIGRATION_FILENAME);
  const idxFix = migrationFiles.indexOf(FIX_MIGRATION_FILENAME);
  assert.notEqual(idxOrig, -1);
  assert.notEqual(idxFix, -1);
  assert.ok(idxFix > idxOrig, 'Migration corretiva deve ordenar após 20261127_s2s_politicas_e_operacoes.sql');
  assert.equal(
    migrationFiles.some(name => name.startsWith('20261128_')),
    false,
    'Não deve existir migration datada de 20261128'
  );

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

  // Proíbe comportamento opcional via to_regclass('public.entidade_origens')
  assert.equal(
    /to_regclass\s*\(\s*'public\.entidade_origens'\s*\)/i.test(sqlNoComments),
    false,
    'O registro em public.entidade_origens é obrigatório e não pode depender de to_regclass'
  );

  // Mapeamento explícito dos sistemas minúsculos para os valores da constraint CHECK e rejeição se ausente
  assert.match(sqlNoComments, /WHEN\s+'classifica'\s+THEN\s+'Classifica'/i);
  assert.match(sqlNoComments, /WHEN\s+'notifica'\s+THEN\s+'Notifica'/i);
  assert.match(sqlNoComments, /WHEN\s+'fiscaliza'\s+THEN\s+'Fiscaliza'/i);
  assert.match(sqlNoComments, /IF\s+v_origem_sistema\s+IS\s+NULL\s+THEN/i);

  // Consulta prévia em entidade_origens ocorre antes da checagem de duplicidade do cadastro mestre
  const preCheckIdx = sqlNoComments.search(
    /FROM\s+public\.entidade_origens\s+eo\s+WHERE\s+eo\.entidade_tipo\s*=\s*v_entidade_tipo\s+AND\s+eo\.origem_sistema\s*=\s*v_origem_sistema\s+AND\s+eo\.origem_registro_id\s*=\s*v_origem_registro_id/i
  );
  const dupEmpIdx = sqlNoComments.search(/FROM\s+public\.empreendedores\s+e/i);
  assert.notEqual(preCheckIdx, -1, 'Consulta prévia em public.entidade_origens deve existir');
  assert.notEqual(dupEmpIdx, -1);
  assert.ok(preCheckIdx < dupEmpIdx, 'Consulta em entidade_origens deve preceder checagem de duplicidade mestre');

  // Exige v_explicit_id para tratar repetição sem mutação e rejeita quando ausente ou divergente
  assert.match(sqlNoComments, /IF\s+v_explicit_id\s+IS\s+NULL\s+THEN/i);
  assert.match(sqlNoComments, /v_existing_origin_entidade_id\s+IS\s+DISTINCT\s+FROM\s+v_explicit_id/i);
  assert.match(sqlNoComments, /'sem_mutacao',\s*true/i);

  // Validação explícita da existência do cadastro mestre sem depender de FOUND após EXECUTE
  assert.match(sqlNoComments, /v_existing_entity\s+boolean\s*:=\s*false\s*;/i);
  assert.match(
    sqlNoComments,
    /EXECUTE\s+format\(\s*'SELECT EXISTS \(SELECT 1 FROM public\.%I t WHERE t\.id = \$1\)'\s*,\s*v_tabela\s*\)\s+INTO\s+v_existing_entity\s+USING\s+v_explicit_id\s*;/i
  );
  assert.match(sqlNoComments, /IF\s+v_existing_entity\s+IS\s+NOT\s+TRUE\s+THEN/i);
  assert.equal(
    /\bEXECUTE\b[\s\S]*?\bIF\s+(?:NOT\s+)?FOUND\b/i.test(sqlNoComments),
    false,
    'Não é permitido usar FOUND após EXECUTE para decidir existência da linha mestre'
  );

  // Extrai INSERT INTO public.entidade_origens (...) e ON CONFLICT (...)
  const eoInsertMatch = sqlNoComments.match(
    /INSERT\s+INTO\s+public\.entidade_origens\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*ON\s+CONFLICT\s*\(([\s\S]*?)\)\s*DO\s+NOTHING/i
  );
  assert.ok(eoInsertMatch, 'INSERT obrigatório em public.entidade_origens com ON CONFLICT deve estar presente');

  const insertCols = eoInsertMatch![1]
    .split(',')
    .map(c => c.trim().toLowerCase())
    .filter(Boolean);
  const conflictCols = eoInsertMatch![3]
    .split(',')
    .map(c => c.trim().toLowerCase())
    .filter(Boolean);

  for (const forbidden of FORBIDDEN_ENTIDADE_ORIGENS_COLUMNS) {
    assert.equal(insertCols.includes(forbidden), false);
    assert.equal(conflictCols.includes(forbidden), false);
  }
  for (const col of insertCols) {
    assert.ok(REAL_ENTIDADE_ORIGENS_COLUMNS.has(col), `Coluna inválida em entidade_origens: ${col}`);
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
  assert.equal(insertCols.includes('payload_original'), false);
  assert.equal(insertCols.includes('evidencia'), false);

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

test('Regressão 1: cadastro novo de empreendedor, barragem e RT grava entidade_origens com colunas reais e origem_sistema mapeado', async () => {
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
    assert.equal(eoEmp.origem_sistema, 'Classifica');
    assert.equal(eoEmp.origem_registro_id, 'CLS-EMP-9001');
    assert.equal(eoEmp.entidade_id, empId);

    assert.equal(eoBar.origem_sistema, 'Notifica');
    assert.equal(eoBar.origem_registro_id, barId);
    assert.equal(eoBar.entidade_id, barId);

    assert.equal(eoRt.origem_sistema, 'Fiscaliza');
    assert.equal(eoRt.origem_registro_id, 'FSC-RT-300');
    assert.equal(eoRt.entidade_id, rtId);

    for (const eo of mockDb._state.entidadeOrigens) {
      for (const forbidden of FORBIDDEN_ENTIDADE_ORIGENS_COLUMNS) {
        assert.equal(Object.prototype.hasOwnProperty.call(eo, forbidden), false);
      }
      assert.deepEqual(eo.payload_original, {});
      assert.deepEqual(eo.evidencia, {});
      const serialized = JSON.stringify({
        payload_original: eo.payload_original,
        evidencia: eo.evidencia,
        observacoes: eo.observacoes
      });
      assert.equal(serialized.includes(VALID_CNPJ_A), false);
      assert.equal(serialized.includes(VALID_CPF_A), false);
    }
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Regressão 2: referência repetida com o mesmo ID explícito não duplica cadastro nem vínculo e não altera o registro', async () => {
  const keys = createKeyPair();
  const explicitEmpId = 'emp_explicit_001';
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
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    // 1. Cadastro inicial com ID explícito e referência externa
    const first = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.classifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'reg-repeat-same-id-001',
          autorOrigem: { usuario: 'ana.classifica' },
          referenciaExterna: 'CLS-REPEAT-01',
          dados: { id: explicitEmpId, nome: 'Empreendedor Original', cpf_cnpj: VALID_CPF_B, uf: 'MT' }
        }
      }),
      first
    );
    assert.equal(first.getStatus(), 201);
    assert.equal(first.getBody().registroId, explicitEmpId);

    // 2. Repetição com nova idempotencyKey, mesma referenciaExterna e mesmo ID explícito (e nome diferente para comprovar não sobrescrita)
    const repeat = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.classifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'reg-repeat-same-id-002',
          autorOrigem: { usuario: 'ana.classifica' },
          referenciaExterna: 'CLS-REPEAT-01',
          dados: { id: explicitEmpId, nome: 'Tentativa Nome Diferente', cpf_cnpj: VALID_CPF_B, uf: 'GO' }
        }
      }),
      repeat
    );

    assert.equal(repeat.getStatus(), 200);
    assert.equal(repeat.getBody().success, true);
    assert.equal(repeat.getBody().registroId, explicitEmpId);
    assert.equal(repeat.getBody().historicoId, null);

    // Não duplicou nem sobrescreveu o registro mestre, não duplicou origem nem histórico
    assert.equal(mockDb._state.empreendedores.length, 1);
    assert.equal(mockDb._state.empreendedores[0].nome, 'Empreendedor Original');
    assert.equal(mockDb._state.empreendedores[0].uf, 'MT');
    assert.equal(mockDb._state.entidadeOrigens.length, 1);
    assert.equal(mockDb._state.historico.length, 1);

    // Auditoria coerente para a repetição sem mutação (http_status 200, sem_mutacao: true)
    const repeatLog = mockDb._state.logs.find(
      (l: any) => l.idempotency_key === 'reg-repeat-same-id-002'
    );
    assert.ok(repeatLog);
    assert.equal(repeatLog.status_execucao, 'sucesso');
    assert.equal(repeatLog.http_status, 200);
    assert.equal(repeatLog.resultado_resumo.sem_mutacao, true);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Regressão 3: referência ligada a ID diferente retorna conflito e não deixa cadastro, histórico ou log de sucesso parcial', async () => {
  const keys = createKeyPair();
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
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    const firstRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.classifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'reg-diff-id-001',
          autorOrigem: { usuario: 'ana.classifica' },
          referenciaExterna: 'CLS-REF-DIFF',
          dados: { id: 'emp_orig_A', nome: 'Empreendedor A', cpf_cnpj: VALID_CPF_A }
        }
      }),
      firstRes
    );
    assert.equal(firstRes.getStatus(), 201);

    const conflictRes = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'classifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'ana.classifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'reg-diff-id-002',
          autorOrigem: { usuario: 'ana.classifica' },
          referenciaExterna: 'CLS-REF-DIFF',
          dados: { id: 'emp_other_B', nome: 'Empreendedor B', cpf_cnpj: VALID_CPF_B }
        }
      }),
      conflictRes
    );

    assert.equal(conflictRes.getStatus(), 409);
    assert.equal(conflictRes.getBody().success, false);
    assert.equal(conflictRes.getBody().code, 'ORIGIN_REFERENCE_CONFLICT');
    assert.equal(mockDb._state.empreendedores.length, 1);
    assert.equal(mockDb._state.empreendedores[0].id, 'emp_orig_A');
    assert.equal(mockDb._state.historico.length, 1);
    assert.equal(mockDb._state.entidadeOrigens.length, 1);
    assert.equal(mockDb._state.logs.filter((l: any) => l.status_execucao === 'sucesso').length, 1);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Regressão 4: referência existente sem ID explícito no pedido NÃO é assumida como mesma entidade e retorna conflito controlado', async () => {
  const keys = createKeyPair();
  const mockDb = createStrictSchemaMockSupabase({
    clients: [
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
        sistema_origem: 'notifica',
        operacao: 'cadastrar_empreendedor',
        modo: 'execucao_direta',
        ativo: true,
        parametros: {},
        restricoes: {}
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    // 1. Cria empreendedor vinculando NOT-REF-NOID
    const first = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'srv.notifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'reg-noid-001',
          autorOrigem: { usuario: 'srv.notifica' },
          referenciaExterna: 'NOT-REF-NOID',
          dados: { id: 'emp_locked_01', nome: 'Produtor Vinculado', cpf_cnpj: VALID_CPF_A }
        }
      }),
      first
    );
    assert.equal(first.getStatus(), 201);

    // 2. Repetição com mesma referenciaExterna e mesmo CPF, porém SEM dados.id explícito
    const noIdRepeat = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'notifica-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'srv.notifica',
        body: {
          operacao: 'cadastrar_empreendedor',
          idempotencyKey: 'reg-noid-002',
          autorOrigem: { usuario: 'srv.notifica' },
          referenciaExterna: 'NOT-REF-NOID',
          dados: { nome: 'Produtor Vinculado', cpf_cnpj: VALID_CPF_A }
        }
      }),
      noIdRepeat
    );

    assert.equal(noIdRepeat.getStatus(), 409);
    assert.equal(noIdRepeat.getBody().success, false);
    assert.equal(noIdRepeat.getBody().code, 'ORIGIN_REFERENCE_CONFLICT');
    assert.equal(mockDb._state.empreendedores.length, 1);
    assert.equal(mockDb._state.historico.length, 1);
    assert.equal(mockDb._state.entidadeOrigens.length, 1);
    assert.equal(mockDb._state.logs.filter((l: any) => l.status_execucao === 'sucesso').length, 1);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Regressão 5: ausência da tabela entidade_origens ou falha no INSERT nunca resulta em sucesso e reverte tudo', async () => {
  const keys = createKeyPair();

  // Caso A: tabela public.entidade_origens ausente
  const missingTableDb = createStrictSchemaMockSupabase({
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
    ],
    entidadeOrigensTableMissing: true
  });
  setTestSupabaseAdminForSemaAudit(missingTableDb);

  try {
    const resMissing = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'fiscaliza-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'fiscal.01',
        body: {
          operacao: 'cadastrar_rt',
          idempotencyKey: 'reg-missing-table-001',
          autorOrigem: { usuario: 'fiscal.01' },
          dados: { nome: 'Eng. Sem Tabela Origem', cpf: VALID_CPF_A }
        }
      }),
      resMissing
    );
    assert.equal(resMissing.getStatus(), 503);
    assert.equal(missingTableDb._state.rts.length, 0);
    assert.equal(missingTableDb._state.historico.length, 0);
    assert.equal(missingTableDb._state.logs.filter((l: any) => l.status_execucao === 'sucesso').length, 0);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }

  // Caso B: falha no INSERT em public.entidade_origens após INSERT mestre/histórico -> rollback completo
  const insertErrorDb = createStrictSchemaMockSupabase({
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
    ],
    simulateEntidadeOrigensInsertError: true
  });
  setTestSupabaseAdminForSemaAudit(insertErrorDb);

  try {
    const resErr = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'fiscaliza-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'fiscal.01',
        body: {
          operacao: 'cadastrar_rt',
          idempotencyKey: 'reg-insert-err-001',
          autorOrigem: { usuario: 'fiscal.01' },
          dados: { nome: 'Eng. Falha Origem', cpf: VALID_CPF_A }
        }
      }),
      resErr
    );
    assert.equal(resErr.getStatus(), 503);
    assert.equal(insertErrorDb._state.rts.length, 0);
    assert.equal(insertErrorDb._state.historico.length, 0);
    assert.equal(insertErrorDb._state.entidadeOrigens.length, 0);
    assert.equal(insertErrorDb._state.logs.filter((l: any) => l.status_execucao === 'sucesso').length, 0);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Regressão 6: replay idempotente repetido segue funcionando e payload divergente na mesma chave falha com 409', async () => {
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

    const divergent = createMockRes();
    await resourceHandler(
      createSignedS2sRequest({
        url: '/api/v2/operacoes',
        kid: 'fiscaliza-k1',
        privateKey: keys.privateKey,
        consumerUserId: 'fiscal.01',
        body: { ...payload, dados: { ...payload.dados, nome: 'Outro Nome Divergente' } }
      }),
      divergent
    );
    assert.equal(divergent.getStatus(), 409);
    assert.equal(divergent.getBody().code, 'IDEMPOTENCY_CONFLICT');

    assert.equal(mockDb._state.rts.length, 1);
    assert.equal(mockDb._state.historico.length, 1);
    assert.equal(mockDb._state.entidadeOrigens.length, 1);
    assert.equal(mockDb._state.logs.filter((l: any) => l.status_execucao === 'sucesso').length, 1);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Regressão 7: origem existente apontando para entidade_id inexistente na tabela mestre retorna 409 sem cadastro, histórico ou log de sucesso', async () => {
  const keys = createKeyPair();
  const missingMasterId = 'emp_inexistente_999';
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
    initialEmpreendedores: [],
    initialEntidadeOrigens: [
      {
        id: crypto.randomUUID(),
        entidade_tipo: 'empreendedor',
        entidade_id: missingMasterId,
        origem_sistema: 'Classifica',
        origem_registro_id: 'CLS-ORPHAN-404',
        lote_id: null,
        data_origem: new Date().toISOString(),
        data_recepcao: new Date().toISOString(),
        payload_original: {},
        conciliacao_status: 'confirmado',
        evidencia: {},
        aprovado_por: null,
        aprovado_em: null,
        observacoes: 'Vínculo pré-existente órfão'
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
          idempotencyKey: 'reg-orphan-origin-001',
          autorOrigem: { usuario: 'ana.classifica' },
          referenciaExterna: 'CLS-ORPHAN-404',
          dados: {
            id: missingMasterId,
            nome: 'Empreendedor Inexistente no Mestre',
            cpf_cnpj: VALID_CNPJ_A,
            uf: 'MT'
          }
        }
      }),
      res
    );

    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().success, false);
    assert.equal(res.getBody().code, 'ORIGIN_REFERENCE_CONFLICT');
    assert.equal(mockDb._state.empreendedores.length, 0);
    assert.equal(mockDb._state.historico.length, 0);
    assert.equal(mockDb._state.entidadeOrigens.length, 1);
    assert.equal(mockDb._state.logs.filter((l: any) => l.status_execucao === 'sucesso').length, 0);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});
