// tests/apiV2CatalogEndpoints.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';

import barragensHandler, { config as barragensConfig } from '../api/v2/barragens';
import empreendedoresHandler, {
  config as empreendedoresConfig
} from '../api/v2/empreendedores';
import {
  BARRAGENS_SELECT_COLUMNS,
  EMPREENDEDORES_SELECT_COLUMNS,
  encodeV2Cursor
} from '../src/server/apiV2Catalog';
import {
  buildS2sCanonicalMessage,
  canonicalizeQueryString,
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
  url: string;
  kid: string;
  privateKey: crypto.KeyObject;
  timestamp?: number;
  jti?: string;
  consumerUserId?: string;
  consumerRole?: string;
}) {
  const method = (opts.method || 'GET').toUpperCase();
  const rawBody = Buffer.alloc(0);
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const jti = opts.jti ?? crypto.randomUUID();
  const bodySha = sha256BodyHexLower(rawBody);

  const qIdx = opts.url.indexOf('?');
  const rawPath = qIdx === -1 ? opts.url : opts.url.slice(0, qIdx);
  const rawQuery = qIdx === -1 ? '' : opts.url.slice(qIdx + 1);

  const canonicalMessage = buildS2sCanonicalMessage({
    method,
    normalizedPath: normalizePublicPath(rawPath),
    canonicalQuery: canonicalizeQueryString(rawQuery),
    contentTypeNormalized: normalizeContentType(''),
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
    'x-s2s-signature': signature
  };
  if (opts.consumerUserId !== undefined) {
    headers['x-consumer-user-id'] = opts.consumerUserId;
  }
  if (opts.consumerRole !== undefined) {
    headers['x-consumer-role'] = opts.consumerRole;
  }

  const stream = new PassThrough() as any;
  stream.method = method;
  stream.url = opts.url;
  stream.headers = headers;
  Object.defineProperty(stream, 'body', {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error('req.body nunca deve ser acessado em rotas S2S');
    }
  });
  stream.end(rawBody);
  return stream;
}

function createCatalogMockSupabase(options: {
  clients: ClientRecord[];
  barragens?: Array<Record<string, any>>;
  empreendedores?: Array<Record<string, any>>;
  failCatalogQuery?: boolean;
  throwCatalogQuery?: boolean;
}) {
  const reservedNonces = new Set<string>();
  const tableQueries: Array<{
    table: string;
    selectCols: string;
    orderCol?: string;
    ascending?: boolean;
    gtCol?: string;
    gtVal?: string;
    limit?: number;
  }> = [];

  const mock: any = {
    _tableQueries: tableQueries,
    from(table: string) {
      const state: {
        selectCols: string;
        eqFilters: Record<string, any>;
        orderCol?: string;
        ascending?: boolean;
        gtCol?: string;
        gtVal?: string;
      } = {
        selectCols: '',
        eqFilters: {}
      };

      const builder: any = {
        select(cols: string) {
          state.selectCols = cols;
          return builder;
        },
        eq(col: string, val: any) {
          state.eqFilters[col] = val;
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          state.orderCol = col;
          state.ascending = opts?.ascending !== false;
          return builder;
        },
        gt(col: string, val: string) {
          state.gtCol = col;
          state.gtVal = val;
          return builder;
        },
        async limit(n: number) {
          if (table === 'integracao_clientes_s2s') {
            const matched = options.clients.filter(c => {
              if (state.eqFilters.kid !== undefined && c.kid !== state.eqFilters.kid) return false;
              return true;
            });
            return { data: matched.slice(0, n), error: null };
          }

          tableQueries.push({
            table,
            selectCols: state.selectCols,
            orderCol: state.orderCol,
            ascending: state.ascending,
            gtCol: state.gtCol,
            gtVal: state.gtVal,
            limit: n
          });

          if (options.throwCatalogQuery) {
            throw new Error('unexpected driver failure postgres://internal');
          }
          if (options.failCatalogQuery) {
            return {
              data: null,
              error: { message: 'connection failed postgres://secret-host:5432/postgres' }
            };
          }

          const sourceRows =
            table === 'barragens'
              ? [...(options.barragens || [])]
              : table === 'empreendedores'
              ? [...(options.empreendedores || [])]
              : [];

          // Simula banco ordenando por id crescente e filtrando gt('id', cursor)
          sourceRows.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));

          const filtered =
            state.gtCol === 'id' && state.gtVal !== undefined
              ? sourceRows.filter(r => String(r.id) > String(state.gtVal))
              : sourceRows;

          return {
            data: filtered.slice(0, n),
            error: null
          };
        }
      };

      return builder;
    },
    async rpc(fn: string, params: any) {
      if (fn === 'reservar_nonce_s2s') {
        const key = `${params.p_sistema}::${String(params.p_jti).toLowerCase()}`;
        if (reservedNonces.has(key)) {
          return { data: false, error: null };
        }
        reservedNonces.add(key);
        return { data: true, error: null };
      }
      return { data: null, error: { message: 'unknown rpc' } };
    }
  };

  return mock;
}

function assertSecurityHeaders(res: ReturnType<typeof createMockRes>) {
  const headers = res.getHeaders();
  assert.equal(headers['cache-control'], 'private, no-store, max-age=0');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(headers['content-type'], 'application/json; charset=utf-8');
}

test('Etapa 2 configs e método HTTP: aceita somente GET e retorna 405 com Allow: GET nos demais', async () => {
  assert.deepEqual(barragensConfig, { api: { bodyParser: false } });
  assert.deepEqual(empreendedoresConfig, { api: { bodyParser: false } });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const resBar = createMockRes();
    await barragensHandler({ method, url: '/api/v2/barragens', headers: {} } as any, resBar);
    assert.equal(resBar.getStatus(), 405);
    assert.equal(resBar.getHeaders()['allow'], 'GET');
    assertSecurityHeaders(resBar);

    const resEmp = createMockRes();
    await empreendedoresHandler(
      { method, url: '/api/v2/empreendedores', headers: {} } as any,
      resEmp
    );
    assert.equal(resEmp.getStatus(), 405);
    assert.equal(resEmp.getHeaders()['allow'], 'GET');
    assertSecurityHeaders(resEmp);
  }
});

test('Autenticação S2S e política estrita de escopos (sem curingas) para barragens e empreendedores', async () => {
  const validKeys = createKeyPair();
  const wrongKeys = createKeyPair();

  const mockDb = createCatalogMockSupabase({
    clients: [
      {
        sistema: 'classifica',
        kid: 'classifica-bar-only',
        public_key_pem: validKeys.publicKeyPem,
        escopos: ['barragens:read'],
        ativo: true
      },
      {
        sistema: 'notifica',
        kid: 'notifica-wildcard-rejected',
        public_key_pem: validKeys.publicKeyPem,
        escopos: ['*', 'barragens:*', 'empreendedores:*', 'health:read'],
        ativo: true
      },
      {
        sistema: 'fiscaliza',
        kid: 'fiscaliza-emp-only',
        public_key_pem: validKeys.publicKeyPem,
        escopos: ['empreendedores:read'],
        ativo: true
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    // 1. Assinatura inválida -> 401 sem consultar catálogo
    const badSigRes = createMockRes();
    await barragensHandler(
      createSignedRequest({
        url: '/api/v2/barragens',
        kid: 'classifica-bar-only',
        privateKey: wrongKeys.privateKey
      }),
      badSigRes
    );
    assert.equal(badSigRes.getStatus(), 401);
    assertSecurityHeaders(badSigRes);

    // 2. Curingas '*' ou 'barragens:*' são rejeitados com 403
    const wildcardBarRes = createMockRes();
    await barragensHandler(
      createSignedRequest({
        url: '/api/v2/barragens',
        kid: 'notifica-wildcard-rejected',
        privateKey: validKeys.privateKey
      }),
      wildcardBarRes
    );
    assert.equal(wildcardBarRes.getStatus(), 403);

    const wildcardEmpRes = createMockRes();
    await empreendedoresHandler(
      createSignedRequest({
        url: '/api/v2/empreendedores',
        kid: 'notifica-wildcard-rejected',
        privateKey: validKeys.privateKey
      }),
      wildcardEmpRes
    );
    assert.equal(wildcardEmpRes.getStatus(), 403);

    // 3. Escopo cruzado rejeitado com 403
    const crossBarRes = createMockRes();
    await empreendedoresHandler(
      createSignedRequest({
        url: '/api/v2/empreendedores',
        kid: 'classifica-bar-only',
        privateKey: validKeys.privateKey
      }),
      crossBarRes
    );
    assert.equal(crossBarRes.getStatus(), 403);

    const crossEmpRes = createMockRes();
    await barragensHandler(
      createSignedRequest({
        url: '/api/v2/barragens',
        kid: 'fiscaliza-emp-only',
        privateKey: validKeys.privateKey
      }),
      crossEmpRes
    );
    assert.equal(crossEmpRes.getStatus(), 403);

    // 4. Replay do mesmo JTI em solicitação válida -> 200 depois 409
    const fixedJti = crypto.randomUUID();
    const fixedTs = Math.floor(Date.now() / 1000);
    const firstRes = createMockRes();
    await barragensHandler(
      createSignedRequest({
        url: '/api/v2/barragens',
        kid: 'classifica-bar-only',
        privateKey: validKeys.privateKey,
        timestamp: fixedTs,
        jti: fixedJti
      }),
      firstRes
    );
    assert.equal(firstRes.getStatus(), 200);

    const replayRes = createMockRes();
    await barragensHandler(
      createSignedRequest({
        url: '/api/v2/barragens',
        kid: 'classifica-bar-only',
        privateKey: validKeys.privateKey,
        timestamp: fixedTs,
        jti: fixedJti
      }),
      replayRes
    );
    assert.equal(replayRes.getStatus(), 409);

    // Nenhuma consulta à tabela de catálogo nos erros 401/403/409
    assert.equal(mockDb._tableQueries.length, 1);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('GET /api/v2/barragens pagina por cursor sem lacunas nem duplicatas, usa tabela base, respeita limit e omite campos internos/livres', async () => {
  const { publicKeyPem, privateKey } = createKeyPair();
  const sampleBarragens = [
    {
      id: 'bar_005',
      nome: 'Barragem Cinco',
      car: 'MT500/2024',
      uf: 'MT',
      municipio: 'Sorriso',
      municipio_ibge: '5107925',
      empreendedor_id: 'emp_002',
      empreendedor: 'Fulano CPF 123.456.789-01',
      empreendimento: 'Fazenda Norte',
      processo: '1005/2024',
      snisb: '5005',
      curso_agua: 'Rio Teles Pires',
      latitude: '-12.54',
      longitude: '-55.71',
      altura: 15.5,
      volume: 250000,
      dano_potencial: 'Alto',
      categoria_risco: 'Médio',
      classificada_em: '2026-10-01T10:00:00Z',
      situacao: 'Ativa',
      observacoes: 'Contato pessoal 123.456.789-01',
      created_by: 'usr-internal-1',
      updated_by: 'usr-internal-2',
      created_at: '2026-01-05T00:00:00Z',
      updated_at: '2026-02-05T00:00:00Z'
    },
    {
      id: 'bar_001',
      nome: 'Barragem Um (65) 3549-0000 - Safra 2020-2024',
      car: 'MT100/2020',
      uf: 'MT',
      municipio: 'Cuiabá',
      municipio_ibge: '5103403',
      empreendedor_id: 'emp_001',
      empreendedor: 'Texto legado 111.222.333-44',
      empreendimento: 'Fazenda Um Tel +55 65 98111-2233 - 19/11/2026',
      processo: '1001/2020',
      snisb: '5001',
      curso_agua: 'Córrego A',
      latitude: '-15.60',
      longitude: '-56.09',
      altura: 8,
      volume: 80000,
      dano_potencial: 'Baixo',
      categoria_risco: 'Baixo',
      classificada_em: null,
      situacao: 'Ativa',
      observacoes: 'Observação confidencial',
      created_by: 'usr-internal-1',
      updated_by: 'usr-internal-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z'
    },
    {
      id: 'bar_003',
      nome: 'Barragem Três',
      car: null,
      uf: 'MT',
      municipio: 'Sinop',
      municipio_ibge: null,
      empreendedor_id: 'emp_001',
      empreendedor: 'Texto legado 3',
      empreendimento: null,
      processo: null,
      snisb: null,
      curso_agua: null,
      latitude: null,
      longitude: null,
      altura: null,
      volume: null,
      dano_potencial: 'Não classificada',
      categoria_risco: 'Não classificada',
      classificada_em: null,
      situacao: 'Aguardando confirmação',
      observacoes: 'Obs 3',
      created_by: 'usr-internal-3',
      updated_by: null,
      created_at: '2026-01-03T00:00:00Z',
      updated_at: '2026-02-03T00:00:00Z'
    },
    {
      id: 'bar_002',
      nome: 'Barragem Dois',
      car: 'MT200/2021',
      uf: 'MT',
      municipio: 'Lucas do Rio Verde',
      municipio_ibge: '5105259',
      empreendedor_id: 'emp_002',
      empreendedor: 'Texto legado 2',
      empreendimento: 'Estância Dois',
      processo: '1002/2021',
      snisb: '5002',
      curso_agua: 'Rio Verde',
      latitude: '-13.05',
      longitude: '-55.91',
      altura: '12.4',
      volume: '120000',
      dano_potencial: 'Médio',
      categoria_risco: 'Baixo',
      classificada_em: '2026-05-01T12:00:00Z',
      situacao: 'Ativa',
      observacoes: 'Obs 2',
      created_by: 'usr-internal-2',
      updated_by: 'usr-internal-2',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-02-02T00:00:00Z'
    },
    {
      id: 'bar_004',
      nome: 'Barragem Quatro',
      car: 'MT400/2023',
      uf: 'MT',
      municipio: 'Rondonópolis',
      municipio_ibge: '5107602',
      empreendedor_id: 'emp_003',
      empreendedor: 'Texto legado 4',
      empreendimento: 'Fazenda Quatro',
      processo: '1004/2023',
      snisb: '5004',
      curso_agua: 'Rio Vermelho',
      latitude: '-16.47',
      longitude: '-54.63',
      altura: 20,
      volume: 500000,
      dano_potencial: 'Alto',
      categoria_risco: 'Alto',
      classificada_em: '2026-08-01T09:00:00Z',
      situacao: 'Ativa',
      observacoes: 'Obs 4',
      created_by: 'usr-internal-4',
      updated_by: 'usr-internal-4',
      created_at: '2026-01-04T00:00:00Z',
      updated_at: '2026-02-04T00:00:00Z'
    }
  ];

  const mockDb = createCatalogMockSupabase({
    clients: [
      {
        sistema: 'classifica',
        kid: 'classifica-bar-read',
        public_key_pem: publicKeyPem,
        escopos: ['barragens:read'],
        ativo: true
      }
    ],
    barragens: sampleBarragens
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    const collectedIds: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const url = cursor
        ? `/api/v2/barragens?limit=2&cursor=${encodeURIComponent(cursor)}`
        : '/api/v2/barragens?limit=2';

      const res = createMockRes();
      await barragensHandler(
        createSignedRequest({
          url,
          kid: 'classifica-bar-read',
          privateKey,
          consumerUserId: 'usr-admin-1',
          consumerRole: 'Administrador'
        }),
        res
      );

      assert.equal(res.getStatus(), 200);
      assertSecurityHeaders(res);

      const body = res.getBody();
      assert.equal(body.success, true);
      assert.equal(body.apiVersion, '2.0');
      assert.equal(body.maskingPolicy, 'masked');
      assert.equal(body.pagination.limit, 2);

      for (const item of body.items) {
        collectedIds.push(item.id);
        assert.equal('created_by' in item, false);
        assert.equal('createdBy' in item, false);
        assert.equal('updated_by' in item, false);
        assert.equal('updatedBy' in item, false);
        assert.equal('observacoes' in item, false);
        assert.equal('empreendedor' in item, false);
      }

      pages += 1;
      if (pages < 3) {
        assert.equal(body.pagination.hasMore, true);
        assert.ok(typeof body.pagination.nextCursor === 'string' && body.pagination.nextCursor.length > 0);
      } else {
        assert.equal(body.pagination.hasMore, false);
        assert.equal(body.pagination.nextCursor, null);
      }
      cursor = body.pagination.nextCursor;
    } while (cursor);

    assert.equal(pages, 3);
    assert.deepEqual(collectedIds, ['bar_001', 'bar_002', 'bar_003', 'bar_004', 'bar_005']);

    // Garante mascaramento de telefones em nome/empreendimento preservando dados não telefônicos
    const page1Res = createMockRes();
    await barragensHandler(
      createSignedRequest({
        url: '/api/v2/barragens?limit=1',
        kid: 'classifica-bar-read',
        privateKey
      }),
      page1Res
    );
    assert.equal(page1Res.getStatus(), 200);
    const firstBarragem = page1Res.getBody().items[0];
    assert.doesNotMatch(firstBarragem.nome, /3549-?0000/);
    assert.match(firstBarragem.nome, /2020-2024/);
    assert.match(firstBarragem.nome, /\(65\) \*\*\*\*-\*\*00/);
    assert.doesNotMatch(firstBarragem.empreendimento, /98111-?2233/);
    assert.match(firstBarragem.empreendimento, /19\/11\/2026/);
    assert.match(firstBarragem.empreendimento, /\+55 \(65\) \*\*\*\*\*-\*\*33/);

    assert.equal(mockDb._tableQueries.length, 4);
    for (const q of mockDb._tableQueries) {
      assert.equal(q.table, 'barragens');
      assert.equal(q.orderCol, 'id');
      assert.equal(q.ascending, true);
      assert.equal(q.selectCols, BARRAGENS_SELECT_COLUMNS.join(', '));
      assert.doesNotMatch(q.selectCols, /\b(created_by|updated_by|observacoes)\b/);
      assert.doesNotMatch(q.selectCols, /(^|,\s*)empreendedor(\s*,|$)/);
      assert.doesNotMatch(q.selectCols, /\*/);
    }
    assert.equal(mockDb._tableQueries[0].limit, 3);
    assert.equal(mockDb._tableQueries[1].limit, 3);
    assert.equal(mockDb._tableQueries[2].limit, 3);
    assert.equal(mockDb._tableQueries[3].limit, 2);

    // Padrão sem limit usa limit=100 (consulta limit+1 = 101) e aceita limit=500 (limit+1 = 501)
    const defaultRes = createMockRes();
    await barragensHandler(
      createSignedRequest({ url: '/api/v2/barragens', kid: 'classifica-bar-read', privateKey }),
      defaultRes
    );
    assert.equal(defaultRes.getStatus(), 200);
    assert.equal(defaultRes.getBody().pagination.limit, 100);
    assert.equal(mockDb._tableQueries[4].limit, 101);

    const maxRes = createMockRes();
    await barragensHandler(
      createSignedRequest({
        url: '/api/v2/barragens?limit=500',
        kid: 'classifica-bar-read',
        privateKey
      }),
      maxRes
    );
    assert.equal(maxRes.getStatus(), 200);
    assert.equal(maxRes.getBody().pagination.limit, 500);
    assert.equal(mockDb._tableQueries[5].limit, 501);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('GET /api/v2/empreendedores aplica mascaramento fail-closed, pagina em múltiplas páginas exatas e exclui campos internos/livres', async () => {
  const { publicKeyPem, privateKey } = createKeyPair();
  const sampleEmpreendedores = [
    {
      id: 'emp_001',
      tipo_pessoa: 'Pessoa física',
      nome: 'Produtor Teste CPF 123.456.789-01 Fone (65) 99988-1122',
      cpf_cnpj: '123.456.789-01',
      nome_fantasia: 'Contato joao.silva@fazenda.com.br ou 65 3549-0000',
      email: 'joao.silva@fazenda.com.br',
      telefone: '(65) 99988-1122',
      uf: 'MT',
      municipio: 'Cuiabá',
      municipio_ibge: '5103403',
      observacoes: 'Anotação interna sensível com CPF 12345678901',
      created_by: 'usr-admin-root',
      updated_by: 'usr-admin-root',
      empreendimentos: [
        {
          id: 'empr_1',
          nome: 'Fazenda Boa Esperança Tel 99777-4455 (2026-10-01)',
          tipo: 'Rural',
          car: 'MT12345/2021',
          escritura: 'Matrícula 98765 Cartório Central',
          uf: 'MT',
          municipio: 'Cuiabá',
          municipioIbge: '5103403',
          barragemId: 'bar_001',
          observacoes: 'Obs interna do empreendimento que não deve sair'
        }
      ],
      situacao: 'Ativo',
      created_at: '2026-01-01T10:00:00Z',
      updated_at: '2026-02-01T10:00:00Z'
    },
    {
      id: 'emp_002',
      tipo_pessoa: 'Pessoa jurídica',
      nome: 'Agropecuária Modelo LTDA',
      cpf_cnpj: '12345678000195',
      nome_fantasia: 'Modelo Agro',
      email: 'ab@empresa.com',
      telefone: '6535490000',
      uf: 'MT',
      municipio: 'Sorriso',
      municipio_ibge: '5107925',
      observacoes: 'Observação 2',
      created_by: 'usr-2',
      updated_by: 'usr-2',
      empreendimentos: [],
      situacao: 'Ativo',
      created_at: '2026-01-02T10:00:00Z',
      updated_at: '2026-02-02T10:00:00Z'
    },
    {
      id: 'emp_003',
      tipo_pessoa: 'Pessoa jurídica',
      nome: 'Usina Três',
      cpf_cnpj: '99887766', // documento malformado deve falhar fechado para '***'
      nome_fantasia: null,
      email: 'invalido-sem-arroba',
      telefone: '123',
      uf: 'MT',
      municipio: 'Sinop',
      municipio_ibge: '5107909',
      observacoes: 'Obs 3',
      created_by: 'usr-3',
      updated_by: null,
      empreendimentos: null,
      situacao: 'Ativo',
      created_at: '2026-01-03T10:00:00Z',
      updated_at: '2026-02-03T10:00:00Z'
    },
    {
      id: 'emp_004',
      tipo_pessoa: 'Pessoa física',
      nome: 'Maria Quatro',
      cpf_cnpj: null,
      nome_fantasia: null,
      email: null,
      telefone: null,
      uf: 'MT',
      municipio: 'Rondonópolis',
      municipio_ibge: '5107602',
      observacoes: 'Obs 4',
      created_by: 'usr-4',
      updated_by: 'usr-4',
      empreendimentos: [],
      situacao: 'Inativo',
      created_at: '2026-01-04T10:00:00Z',
      updated_at: '2026-02-04T10:00:00Z'
    }
  ];

  const mockDb = createCatalogMockSupabase({
    clients: [
      {
        sistema: 'notifica',
        kid: 'notifica-emp-read',
        public_key_pem: publicKeyPem,
        escopos: ['empreendedores:read'],
        ativo: true
      }
    ],
    empreendedores: sampleEmpreendedores
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    // 4 registros com limit=2 -> exatamente 2 páginas sem página extra vazia
    const page1Res = createMockRes();
    await empreendedoresHandler(
      createSignedRequest({
        url: '/api/v2/empreendedores?limit=2',
        kid: 'notifica-emp-read',
        privateKey,
        consumerUserId: 'usr-admin-99',
        consumerRole: 'Administrador'
      }),
      page1Res
    );
    assert.equal(page1Res.getStatus(), 200);
    assertSecurityHeaders(page1Res);

    const p1 = page1Res.getBody();
    assert.equal(p1.success, true);
    assert.equal(p1.apiVersion, '2.0');
    assert.equal(p1.maskingPolicy, 'masked');
    assert.equal(p1.pagination.limit, 2);
    assert.equal(p1.pagination.hasMore, true);
    assert.ok(typeof p1.pagination.nextCursor === 'string');
    assert.equal(p1.items.length, 2);

    const [emp1, emp2] = p1.items;
    assert.equal(emp1.id, 'emp_001');
    assert.equal(emp1.cpfCnpj, '***.456.***-01');
    assert.equal(emp1.email, 'jo***@***');
    assert.equal(emp1.telefone, '(65) *****-**22');
    assert.doesNotMatch(emp1.nome, /123\.?456\.?789-?01/);
    assert.doesNotMatch(emp1.nome, /99988-?1122/);
    assert.match(emp1.nome, /\(65\) \*\*\*\*\*-\*\*22/);
    assert.doesNotMatch(emp1.nomeFantasia || '', /fazenda\.com\.br/);
    assert.doesNotMatch(emp1.nomeFantasia || '', /3549-?0000/);
    assert.match(emp1.nomeFantasia || '', /\(65\) \*\*\*\*-\*\*00/);
    assert.equal('created_by' in emp1, false);
    assert.equal('createdBy' in emp1, false);
    assert.equal('updated_by' in emp1, false);
    assert.equal('updatedBy' in emp1, false);
    assert.equal('observacoes' in emp1, false);
    assert.equal(emp1.empreendimentos.length, 1);
    assert.equal('observacoes' in emp1.empreendimentos[0], false);
    assert.equal('escritura' in emp1.empreendimentos[0], false);
    assert.doesNotMatch(emp1.empreendimentos[0].nome || '', /99777-?4455/);
    assert.match(emp1.empreendimentos[0].nome || '', /\*\*\*\*\*-\*\*55/);
    assert.match(emp1.empreendimentos[0].nome || '', /2026-10-01/);
    assert.equal(emp1.empreendimentos[0].car, 'MT12345/2021');
    assert.equal(emp1.empreendimentos[0].barragemId, 'bar_001');

    assert.equal(emp2.id, 'emp_002');
    assert.equal(emp2.cpfCnpj, '**.345.***/0001-**');
    assert.equal(emp2.email, 'a***@***');
    assert.equal(emp2.telefone, '(65) ****-**00');

    const page2Res = createMockRes();
    await empreendedoresHandler(
      createSignedRequest({
        url: `/api/v2/empreendedores?limit=2&cursor=${encodeURIComponent(p1.pagination.nextCursor)}`,
        kid: 'notifica-emp-read',
        privateKey,
        consumerUserId: 'usr-analista-1',
        consumerRole: 'Analista'
      }),
      page2Res
    );
    assert.equal(page2Res.getStatus(), 200);
    const p2 = page2Res.getBody();
    assert.equal(p2.maskingPolicy, 'masked');
    assert.equal(p2.pagination.hasMore, false);
    assert.equal(p2.pagination.nextCursor, null);
    assert.deepEqual(
      p2.items.map((i: any) => i.id),
      ['emp_003', 'emp_004']
    );

    const [emp3, emp4] = p2.items;
    assert.equal(emp3.cpfCnpj, '***');
    assert.equal(emp3.email, '***');
    assert.equal(emp3.telefone, '***');
    assert.deepEqual(emp3.empreendimentos, []);

    assert.equal(emp4.cpfCnpj, null);
    assert.equal(emp4.email, null);
    assert.equal(emp4.telefone, null);

    // Verifica consultas diretas à tabela base com allowlist explícita
    assert.equal(mockDb._tableQueries.length, 2);
    for (const q of mockDb._tableQueries) {
      assert.equal(q.table, 'empreendedores');
      assert.equal(q.limit, 3);
      assert.equal(q.orderCol, 'id');
      assert.equal(q.selectCols, EMPREENDEDORES_SELECT_COLUMNS.join(', '));
      assert.doesNotMatch(q.selectCols, /\b(created_by|updated_by|observacoes)\b/);
      assert.doesNotMatch(q.selectCols, /\*/);
    }

    // Nenhuma string sensível completa aparece no JSON serializado
    const fullSerialized = JSON.stringify([p1, p2]);
    assert.doesNotMatch(
      fullSerialized,
      /123\.?456\.?789-?01|12345678000195|joao\.silva|99988-?1122|99777-?4455|3549-?0000|Matrícula 98765/
    );
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Parâmetros inválidos, filtros não suportados e cursores adulterados retornam 400 antes de consultar o banco', async () => {
  const { publicKeyPem, privateKey } = createKeyPair();
  const mockDb = createCatalogMockSupabase({
    clients: [
      {
        sistema: 'fiscaliza',
        kid: 'fiscaliza-validation-check',
        public_key_pem: publicKeyPem,
        escopos: ['barragens:read', 'empreendedores:read'],
        ativo: true
      }
    ]
  });
  setTestSupabaseAdminForSemaAudit(mockDb);

  try {
    const crossCursor = encodeV2Cursor('empreendedores', 'emp_001');
    const badExtraFieldCursor = Buffer.from(
      JSON.stringify({ v: 1, resource: 'barragens', lastId: 'bar_001', extra: true }),
      'utf8'
    ).toString('base64url');
    const nonCanonicalBase64Cursor = `${encodeV2Cursor('barragens', 'bar_001')}=`;
    const badIdCursor = Buffer.from(
      JSON.stringify({ v: 1, resource: 'barragens', lastId: 'bar 001,id.neq.1' }),
      'utf8'
    ).toString('base64url');

    const badBarUrls = [
      '/api/v2/barragens?limit=0',
      '/api/v2/barragens?limit=501',
      '/api/v2/barragens?limit=-1',
      '/api/v2/barragens?limit=1.5',
      '/api/v2/barragens?limit=abc',
      '/api/v2/barragens?limit=',
      '/api/v2/barragens?limit=10&limit=20',
      '/api/v2/barragens?updatedSince=2026-01-01T00:00:00Z',
      '/api/v2/barragens?situacao=Ativa',
      '/api/v2/barragens?id=bar_001',
      '/api/v2/barragens?limit',
      '/api/v2/barragens?limit=10&',
      '/api/v2/barragens?cursor=',
      '/api/v2/barragens?cursor=nao-eh-json-valido',
      `/api/v2/barragens?cursor=${encodeURIComponent(crossCursor)}`,
      `/api/v2/barragens?cursor=${encodeURIComponent(badExtraFieldCursor)}`,
      `/api/v2/barragens?cursor=${encodeURIComponent(nonCanonicalBase64Cursor)}`,
      `/api/v2/barragens?cursor=${encodeURIComponent(badIdCursor)}`
    ];

    for (const url of badBarUrls) {
      const res = createMockRes();
      await barragensHandler(
        createSignedRequest({ url, kid: 'fiscaliza-validation-check', privateKey }),
        res
      );
      assert.equal(res.getStatus(), 400, `Esperava 400 para ${url}`);
      assertSecurityHeaders(res);
      assert.equal(res.getBody().success, false);
    }

    const crossEmpCursor = encodeV2Cursor('barragens', 'bar_001');
    const empBadRes = createMockRes();
    await empreendedoresHandler(
      createSignedRequest({
        url: `/api/v2/empreendedores?cursor=${encodeURIComponent(crossEmpCursor)}`,
        kid: 'fiscaliza-validation-check',
        privateKey
      }),
      empBadRes
    );
    assert.equal(empBadRes.getStatus(), 400);

    // Zero consultas às tabelas de catálogo
    assert.equal(mockDb._tableQueries.length, 0);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Falha ou indisponibilidade do banco central retorna 503 retryable:true e nunca 200 com lista vazia', async () => {
  const { publicKeyPem, privateKey } = createKeyPair();
  const prevUrl = process.env.SUPABASE_URL;
  const prevViteUrl = process.env.VITE_SUPABASE_URL;
  const prevNextUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevVitePubUrl = process.env.VITE_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // 1. Erro retornado pelo PostgREST na consulta -> 503
    setTestSupabaseAdminForSemaAudit(
      createCatalogMockSupabase({
        clients: [
          {
            sistema: 'notifica',
            kid: 'notifica-db-fail',
            public_key_pem: publicKeyPem,
            escopos: ['barragens:read', 'empreendedores:read'],
            ativo: true
          }
        ],
        failCatalogQuery: true
      })
    );

    for (const [handler, url] of [
      [barragensHandler, '/api/v2/barragens'],
      [empreendedoresHandler, '/api/v2/empreendedores']
    ] as const) {
      const res = createMockRes();
      await handler(createSignedRequest({ url, kid: 'notifica-db-fail', privateKey }), res);
      assert.equal(res.getStatus(), 503);
      assertSecurityHeaders(res);
      assert.deepEqual(res.getBody(), {
        success: false,
        status: 'unavailable',
        retryable: true
      });
    }

    // 2. Exceção inesperada durante consulta -> 503
    setTestSupabaseAdminForSemaAudit(
      createCatalogMockSupabase({
        clients: [
          {
            sistema: 'notifica',
            kid: 'notifica-db-throw',
            public_key_pem: publicKeyPem,
            escopos: ['barragens:read', 'empreendedores:read'],
            ativo: true
          }
        ],
        throwCatalogQuery: true
      })
    );

    for (const [handler, url] of [
      [barragensHandler, '/api/v2/barragens'],
      [empreendedoresHandler, '/api/v2/empreendedores']
    ] as const) {
      const res = createMockRes();
      await handler(createSignedRequest({ url, kid: 'notifica-db-throw', privateKey }), res);
      assert.equal(res.getStatus(), 503);
      assert.deepEqual(res.getBody(), {
        success: false,
        status: 'unavailable',
        retryable: true
      });
    }

    // 3. Cliente Supabase indisponível -> 503
    setTestSupabaseAdminForSemaAudit(null);
    delete process.env.SUPABASE_URL;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.VITE_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    for (const [handler, url] of [
      [barragensHandler, '/api/v2/barragens'],
      [empreendedoresHandler, '/api/v2/empreendedores']
    ] as const) {
      const res = createMockRes();
      await handler(createSignedRequest({ url, kid: 'notifica-db-fail', privateKey }), res);
      assert.equal(res.getStatus(), 503);
      assert.deepEqual(res.getBody(), {
        success: false,
        status: 'unavailable',
        retryable: true
      });
    }
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevViteUrl === undefined) delete process.env.VITE_SUPABASE_URL;
    else process.env.VITE_SUPABASE_URL = prevViteUrl;
    if (prevNextUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevNextUrl;
    if (prevVitePubUrl === undefined) delete process.env.VITE_PUBLIC_SUPABASE_URL;
    else process.env.VITE_PUBLIC_SUPABASE_URL = prevVitePubUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});
