// tests/pendencias.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import pendenciasHandler, {
  PENDENCIA_ORIGEM,
  buildAlterarSituacaoDraft,
  buildCreatePendenciaDraft,
  buildEditarPendenciaDraft,
  canReadPendenciaRow,
  sanitizePendenciaHistoricoForResponse,
  sanitizePendenciaRecordForResponse,
  sanitizePendenciaTextForResponse
} from '../api/pendencias';
import { setTestSupabaseAdminForSemaAudit } from '../src/server/semaAudit';

const ADMIN_AUTH_ID = '11111111-1111-4111-8111-111111111111';
const USER_AUTH_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_AUTH_ID = '33333333-3333-4333-8333-333333333333';
const VIEWER_AUTH_ID = '44444444-4444-4444-8444-444444444444';
const INACTIVE_AUTH_ID = '55555555-5555-4555-8555-555555555555';
const ANALYST_AUTH_ID = '66666666-6666-4666-8666-666666666666';
const UNKNOWN_ROLE_AUTH_ID = '77777777-7777-4777-8777-777777777777';

const PEND_MINHA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const PEND_COLEGA_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const PEND_ABERTA_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';

function createMockReq(opts: {
  method?: string;
  url?: string;
  body?: any;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}) {
  const req = new EventEmitter() as any;
  req.method = opts.method || 'GET';
  req.url = opts.url || '/api/pendencias';
  req.query = opts.query || {};
  req.headers = opts.headers || {};
  if (opts.body !== undefined) req.body = opts.body;
  return req;
}

function createMockRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return headers[k.toLowerCase()];
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res._body = data;
      return res;
    },
    end(raw?: string) {
      if (raw && res._body === undefined) {
        try {
          res._body = JSON.parse(raw);
        } catch {
          res._body = raw;
        }
      }
      return res;
    }
  };
  return res;
}

function createPendenciasSupabaseMock() {
  const usuarios = [
    {
      id: 'usr_admin',
      auth_user_id: ADMIN_AUTH_ID,
      nome: 'Admin CSB',
      login: 'admin.csb',
      email: 'admin.sigiloso@sema.mt.gov.br',
      papel: 'Administrador',
      setor: 'Setor de Administrativo',
      situacao: 'Ativo',
      status: 'Ativo'
    },
    {
      id: 'usr_user',
      auth_user_id: USER_AUTH_ID,
      nome: 'Analista Maria',
      login: 'maria.csb',
      email: 'maria.sigiloso@sema.mt.gov.br',
      papel: 'Usuário',
      setor: 'Setor de Classificação',
      situacao: 'Ativo',
      status: 'Ativo'
    },
    {
      id: 'usr_other',
      auth_user_id: OTHER_AUTH_ID,
      nome: '',
      login: 'joao.sigiloso@sema.mt.gov.br',
      email: 'joao.sigiloso@sema.mt.gov.br',
      papel: 'Usuário',
      setor: 'Setor de Fiscalização',
      situacao: 'Ativo',
      status: 'Ativo'
    },
    {
      id: 'usr_viewer',
      auth_user_id: VIEWER_AUTH_ID,
      nome: 'Leitor Pedro',
      login: 'pedro.csb',
      email: 'pedro.sigiloso@sema.mt.gov.br',
      papel: 'Visualizador',
      setor: 'Setor de Fiscalização',
      situacao: 'Ativo',
      status: 'Ativo'
    },
    {
      id: 'usr_inactive',
      auth_user_id: INACTIVE_AUTH_ID,
      nome: 'Ex Servidor',
      login: 'ex.servidor',
      email: 'ex@sema.mt.gov.br',
      papel: 'Usuário',
      setor: 'Setor de Fiscalização',
      situacao: 'Inativo',
      status: 'Inativo'
    },
    {
      id: 'usr_analyst',
      auth_user_id: ANALYST_AUTH_ID,
      nome: 'Analista Carla',
      login: 'carla.csb',
      email: 'carla.sigiloso@sema.mt.gov.br',
      papel: 'Analista',
      setor: 'Setor de Classificação',
      situacao: 'Ativo',
      status: 'Ativo'
    },
    {
      id: 'usr_unknown_role',
      auth_user_id: UNKNOWN_ROLE_AUTH_ID,
      nome: 'Convidado Externo',
      login: 'externo.csb',
      email: 'externo@sema.mt.gov.br',
      papel: 'Externo',
      setor: 'Externo',
      situacao: 'Ativo',
      status: 'Ativo'
    }
  ];

  const pendencias: any[] = [
    {
      id: PEND_MINHA_ID,
      origem: 'administra',
      origem_ref_id: 'PROC-2026/001',
      tipo: 'Conciliação cadastral',
      titulo: 'Pendência da Maria',
      descricao: 'Conferir documentação',
      situacao: 'direcionada',
      responsavel_id: USER_AUTH_ID,
      criado_por: ADMIN_AUTH_ID,
      direcionado_por: ADMIN_AUTH_ID,
      direcionado_em: '2026-11-18T10:00:00Z',
      resolvido_por: null,
      resolvido_em: null,
      tipo_referencia: 'barragem',
      referencia_id: 'PORT-99',
      empreendedor_id: 'emp_202',
      barragem_id: 'bar_101',
      created_at: '2026-11-18T09:00:00Z',
      updated_at: '2026-11-18T10:00:00Z'
    },
    {
      id: PEND_COLEGA_ID,
      origem: 'administra',
      origem_ref_id: 'PROC-2026/002',
      tipo: 'Verificação de RT/ART',
      titulo: 'Pendência do João',
      descricao: 'Validar ART do parecer',
      situacao: 'em_analise',
      responsavel_id: OTHER_AUTH_ID,
      criado_por: ADMIN_AUTH_ID,
      direcionado_por: ADMIN_AUTH_ID,
      direcionado_em: '2026-11-18T11:00:00Z',
      resolvido_por: null,
      resolvido_em: null,
      tipo_referencia: 'barragem',
      referencia_id: 'bar_202',
      empreendedor_id: null,
      barragem_id: 'bar_202',
      created_at: '2026-11-18T10:30:00Z',
      updated_at: '2026-11-18T11:00:00Z'
    },
    {
      id: PEND_ABERTA_ID,
      origem: 'administra',
      origem_ref_id: null,
      tipo: 'Pendência documental',
      titulo: 'Pendência em aberto sem responsável',
      descricao: null,
      situacao: 'aberta',
      responsavel_id: null,
      criado_por: USER_AUTH_ID,
      direcionado_por: null,
      direcionado_em: null,
      resolvido_por: null,
      resolvido_em: null,
      tipo_referencia: 'empreendedor',
      referencia_id: 'emp_303',
      empreendedor_id: 'emp_303',
      barragem_id: null,
      created_at: '2026-11-18T12:00:00Z',
      updated_at: '2026-11-18T12:00:00Z'
    }
  ];

  const historico: any[] = [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
      pendencia_id: PEND_MINHA_ID,
      acao: 'criacao',
      campo: 'situacao',
      valor_anterior: null,
      valor_novo: 'aberta',
      usuario_id: ADMIN_AUTH_ID,
      motivo: 'Criação inicial',
      created_at: '2026-11-18T09:00:00Z'
    },
    {
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
      pendencia_id: PEND_COLEGA_ID,
      acao: 'direcionamento',
      campo: 'responsavel_id',
      valor_anterior: null,
      valor_novo: OTHER_AUTH_ID,
      usuario_id: ADMIN_AUTH_ID,
      motivo: 'Encaminhado ao colega',
      created_at: '2026-11-18T11:00:00Z'
    }
  ];

  const writeOperations: Array<{ table: string; op: string }> = [];
  const readTables: string[] = [];

  const tokenToUid: Record<string, string> = {
    'tok-admin': ADMIN_AUTH_ID,
    'tok-user': USER_AUTH_ID,
    'tok-other': OTHER_AUTH_ID,
    'tok-viewer': VIEWER_AUTH_ID,
    'tok-inactive': INACTIVE_AUTH_ID,
    'tok-analyst': ANALYST_AUTH_ID,
    'tok-unknown-role': UNKNOWN_ROLE_AUTH_ID
  };

  const client: any = {
    auth: {
      async getUser(jwt: string) {
        const uid = tokenToUid[jwt];
        if (!uid) return { data: { user: null }, error: { message: 'Invalid token' } };
        const u = usuarios.find(item => item.auth_user_id === uid);
        return { data: { user: { id: uid, email: u?.email } }, error: null };
      }
    },
    from(table: string) {
      let filters: Array<{ col: string; val: unknown }> = [];

      const applyFilters = (list: any[]) =>
        list.filter(row => filters.every(f => String(row[f.col] ?? '') === String(f.val ?? '')));

      const execSelect = () => {
        readTables.push(table);
        if (table === 'usuarios') return applyFilters(usuarios).map(r => ({ ...r }));
        if (table === 'pendencias') return applyFilters(pendencias).map(r => ({ ...r }));
        if (table === 'pendencias_historico') return applyFilters(historico).map(r => ({ ...r }));
        return [];
      };

      const chain: any = {
        select() {
          return chain;
        },
        insert() {
          writeOperations.push({ table, op: 'insert' });
          throw new Error(`Gravação inesperada (insert) em ${table}`);
        },
        update() {
          writeOperations.push({ table, op: 'update' });
          throw new Error(`Gravação inesperada (update) em ${table}`);
        },
        delete() {
          writeOperations.push({ table, op: 'delete' });
          throw new Error(`Operação proibida (delete) em ${table}`);
        },
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return chain;
        },
        ilike(col: string, val: unknown) {
          filters.push({ col, val });
          return chain;
        },
        order() {
          return Promise.resolve({ data: execSelect(), error: null });
        },
        async maybeSingle() {
          const rows = execSelect();
          return { data: rows[0] || null, error: null };
        },
        then(resolve: any, reject: any) {
          return Promise.resolve({ data: execSelect(), error: null }).then(resolve, reject);
        }
      };

      return chain;
    }
  };

  return {
    client,
    pendencias,
    historico,
    writeOperations,
    readTables
  };
}

test('Pendências API: autenticação falha fechado (503, 401 e 403 para inativo)', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevViteUrl = process.env.VITE_SUPABASE_URL;
  const prevSrv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  setTestSupabaseAdminForSemaAudit(null);

  try {
    const req503 = createMockReq({ method: 'GET', url: '/api/pendencias?tab=geral' });
    const res503 = createMockRes();
    await pendenciasHandler(req503, res503);
    assert.equal(res503.statusCode, 503);
    assert.equal(res503._body.success, false);

    const mock = createPendenciasSupabaseMock();
    setTestSupabaseAdminForSemaAudit(mock.client);

    const req401 = createMockReq({ method: 'GET', url: '/api/pendencias?tab=geral' });
    const res401 = createMockRes();
    await pendenciasHandler(req401, res401);
    assert.equal(res401.statusCode, 401);

    const reqInactive = createMockReq({
      method: 'GET',
      url: '/api/pendencias?tab=geral',
      headers: { authorization: 'Bearer tok-inactive' }
    });
    const resInactive = createMockRes();
    await pendenciasHandler(reqInactive, resInactive);
    assert.equal(resInactive.statusCode, 403);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
    if (prevViteUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteUrl;
    if (prevSrv !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevSrv;
  }
});

test('Pendências API: leitura por abas, lista geral inclui colegas, Direcionado só Admin, proteção de detalhe/histórico e zero escritas', async () => {
  const mock = createPendenciasSupabaseMock();
  setTestSupabaseAdminForSemaAudit(mock.client);

  try {
    // 1. Minhas pendências: estritamente responsavel_id === usuário autenticado (não inclui criadas sem responsável nem de colegas)
    const minhasUser = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'GET',
        url: '/api/pendencias?tab=minhas',
        headers: { authorization: 'Bearer tok-user' }
      }),
      minhasUser
    );
    assert.equal(minhasUser.statusCode, 200);
    assert.equal(minhasUser._body.mutationsEnabled, false);
    assert.equal(minhasUser._body.pendencias.length, 1);
    assert.equal(minhasUser._body.pendencias[0].id, PEND_MINHA_ID);
    assert.equal(minhasUser._body.counts.minhas, 1);
    assert.equal(minhasUser._body.counts.geral, 3);
    assert.equal(minhasUser._body.counts.direcionado, undefined);
    assert.equal(minhasUser._body.usuariosDirecionaveis, undefined);

    // Admin sem pendências atribuídas a ele recebe lista vazia em Minhas pendências mesmo tendo criado itens
    const minhasAdmin = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'GET',
        url: '/api/pendencias?tab=minhas',
        headers: { authorization: 'Bearer tok-admin' }
      }),
      minhasAdmin
    );
    assert.equal(minhasAdmin.statusCode, 200);
    assert.equal(minhasAdmin._body.pendencias.length, 0);
    assert.equal(minhasAdmin._body.counts.minhas, 0);
    assert.equal(minhasAdmin._body.counts.geral, 3);
    assert.equal(minhasAdmin._body.counts.direcionado, 2);

    // Colega recebe estritamente a pendência atribuída a ele
    const minhasOther = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'GET',
        url: '/api/pendencias?tab=minhas',
        headers: { authorization: 'Bearer tok-other' }
      }),
      minhasOther
    );
    assert.equal(minhasOther.statusCode, 200);
    assert.deepEqual(
      minhasOther._body.pendencias.map((p: any) => p.id),
      [PEND_COLEGA_ID]
    );

    // Não expõe e-mails em resposta de não-administrador
    const userPayloadStr = JSON.stringify(minhasUser._body);
    assert.equal(userPayloadStr.includes('@sema.mt.gov.br'), false);
    assert.equal(userPayloadStr.includes('@'), false);

    // 2. Lista geral: inclui todas as pendências visíveis aos perfis autorizados, inclusive atribuídas a colegas
    for (const token of ['tok-user', 'tok-analyst', 'tok-viewer', 'tok-admin']) {
      const geralRes = createMockRes();
      await pendenciasHandler(
        createMockReq({
          method: 'GET',
          url: '/api/pendencias?tab=geral',
          headers: { authorization: `Bearer ${token}` }
        }),
        geralRes
      );
      assert.equal(geralRes.statusCode, 200);
      assert.equal(geralRes._body.pendencias.length, 3);
      const geralIds = geralRes._body.pendencias.map((p: any) => p.id);
      assert.ok(geralIds.includes(PEND_MINHA_ID));
      assert.ok(geralIds.includes(PEND_COLEGA_ID));
      assert.ok(geralIds.includes(PEND_ABERTA_ID));
      if (token !== 'tok-admin') {
        assert.equal(JSON.stringify(geralRes._body).includes('@'), false);
      }
    }

    // 3. Acesso de não administrador (Usuário, Analista e Visualizador) a detalhe e histórico de pendência de colega
    for (const token of ['tok-user', 'tok-analyst', 'tok-viewer']) {
      const colleagueDetail = createMockRes();
      await pendenciasHandler(
        createMockReq({
          method: 'GET',
          url: `/api/pendencias?pendenciaId=${PEND_COLEGA_ID}`,
          headers: { authorization: `Bearer ${token}` }
        }),
        colleagueDetail
      );
      assert.equal(colleagueDetail.statusCode, 200);
      assert.equal(colleagueDetail._body.pendencia.id, PEND_COLEGA_ID);
      assert.equal(colleagueDetail._body.historico.length, 1);
      assert.equal(colleagueDetail._body.historico[0].pendencia_id, PEND_COLEGA_ID);
      assert.equal(JSON.stringify(colleagueDetail._body).includes('@'), false);
    }

    // 4. Proteção de detalhe e histórico na rota direta para usuários sem permissão (não consulta pendencias_historico)
    const histReadsBeforeBlocked = mock.readTables.filter(t => t === 'pendencias_historico').length;

    const unauthDetail = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'GET',
        url: `/api/pendencias?pendenciaId=${PEND_COLEGA_ID}`
      }),
      unauthDetail
    );
    assert.equal(unauthDetail.statusCode, 401);

    const inactiveDetail = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'GET',
        url: `/api/pendencias?pendenciaId=${PEND_COLEGA_ID}`,
        headers: { authorization: 'Bearer tok-inactive' }
      }),
      inactiveDetail
    );
    assert.equal(inactiveDetail.statusCode, 403);

    const unknownRoleDetail = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'GET',
        url: `/api/pendencias?pendenciaId=${PEND_COLEGA_ID}`,
        headers: { authorization: 'Bearer tok-unknown-role' }
      }),
      unknownRoleDetail
    );
    assert.equal(unknownRoleDetail.statusCode, 403);

    const nonAdminDirecionadoDetail = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'GET',
        url: `/api/pendencias?tab=direcionado&pendenciaId=${PEND_COLEGA_ID}`,
        headers: { authorization: 'Bearer tok-user' }
      }),
      nonAdminDirecionadoDetail
    );
    assert.equal(nonAdminDirecionadoDetail.statusCode, 403);

    const histReadsAfterBlocked = mock.readTables.filter(t => t === 'pendencias_historico').length;
    assert.equal(histReadsAfterBlocked, histReadsBeforeBlocked);

    // Verifica canReadPendenciaRow diretamente
    assert.equal(
      canReadPendenciaRow(mock.pendencias[1], {
        configured: true,
        authorized: true,
        userId: USER_AUTH_ID,
        role: 'Usuário',
        supabaseAdmin: mock.client
      }),
      true
    );
    assert.equal(
      canReadPendenciaRow(mock.pendencias[1], {
        configured: true,
        authorized: true,
        userId: UNKNOWN_ROLE_AUTH_ID,
        role: 'Externo',
        supabaseAdmin: mock.client
      }),
      false
    );

    // ID da pendência deve ser UUID válido no detalhe
    const badDetail = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'GET',
        url: '/api/pendencias?pendenciaId=nao-uuid-123',
        headers: { authorization: 'Bearer tok-user' }
      }),
      badDetail
    );
    assert.equal(badDetail.statusCode, 400);

    // 5. Aba Direcionado é exclusiva do Administrador
    for (const token of ['tok-user', 'tok-analyst', 'tok-viewer', 'tok-unknown-role']) {
      const nonAdminDir = createMockRes();
      await pendenciasHandler(
        createMockReq({
          method: 'GET',
          url: '/api/pendencias?tab=direcionado',
          headers: { authorization: `Bearer ${token}` }
        }),
        nonAdminDir
      );
      assert.equal(nonAdminDir.statusCode, 403);
    }

    const adminDir = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'GET',
        url: '/api/pendencias?tab=direcionado',
        headers: { authorization: 'Bearer tok-admin' }
      }),
      adminDir
    );
    assert.equal(adminDir.statusCode, 200);
    assert.equal(adminDir._body.pendencias.length, 2);
    assert.equal(adminDir._body.counts.direcionado, 2);
    assert.ok(Array.isArray(adminDir._body.usuariosDirecionaveis));
    assert.equal(
      adminDir._body.usuariosDirecionaveis.some((u: any) => u.id === INACTIVE_AUTH_ID),
      false
    );
    assert.ok(
      adminDir._body.usuariosDirecionaveis.every((u: any) =>
        /^[0-9a-f-]{36}$/i.test(String(u.id))
      )
    );

    assert.equal(mock.writeOperations.length, 0);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Pendências drafts: origem minúscula "administra", IDs textuais preservados, sem motivo em pendencias e limpa resolvido ao reabrir', () => {
  const nowIso = '2026-11-19T12:00:00.000Z';
  const createDraft = buildCreatePendenciaDraft(
    {
      tipo: 'Conciliação cadastral',
      titulo: 'Conferir barragem sem empreendedor',
      descricao: 'Dados de referência textual',
      origem_ref_id: 'NOTIF-2026/088',
      tipo_referencia: 'barragem',
      referencia_id: 'PORT-MT-55',
      empreendedor_id: 'emp_texto_123',
      barragem_id: 'bar_texto_456',
      motivo: 'Justificativa deve ir apenas para o histórico'
    },
    USER_AUTH_ID,
    null,
    nowIso
  );

  assert.equal(PENDENCIA_ORIGEM, 'administra');
  assert.equal(createDraft.pendencia.origem, 'administra');
  assert.equal(createDraft.pendencia.criado_por, USER_AUTH_ID);
  assert.equal(createDraft.pendencia.origem_ref_id, 'NOTIF-2026/088');
  assert.equal(createDraft.pendencia.referencia_id, 'PORT-MT-55');
  assert.equal(createDraft.pendencia.empreendedor_id, 'emp_texto_123');
  assert.equal(createDraft.pendencia.barragem_id, 'bar_texto_456');
  assert.equal('motivo' in createDraft.pendencia, false);
  assert.equal(createDraft.historico[0].usuario_id, USER_AUTH_ID);
  assert.equal(createDraft.historico[0].motivo, 'Justificativa deve ir apenas para o histórico');

  const resolveDraft = buildAlterarSituacaoDraft(
    { id: PEND_MINHA_ID, situacao: 'em_analise' },
    'resolvida',
    'Regularizado no processo',
    USER_AUTH_ID,
    nowIso
  );
  assert.equal(resolveDraft.patch.situacao, 'resolvida');
  assert.equal(resolveDraft.patch.resolvido_por, USER_AUTH_ID);
  assert.equal(resolveDraft.patch.resolvido_em, nowIso);
  assert.equal('motivo' in resolveDraft.patch, false);
  assert.equal(resolveDraft.historico[0].acao, 'resolucao');
  assert.equal(resolveDraft.historico[0].motivo, 'Regularizado no processo');

  const reopenDraft = buildAlterarSituacaoDraft(
    { id: PEND_MINHA_ID, situacao: 'resolvida' },
    'aberta',
    'Reaberto após revisão',
    ADMIN_AUTH_ID,
    nowIso
  );
  assert.equal(reopenDraft.patch.situacao, 'aberta');
  assert.equal(reopenDraft.patch.resolvido_por, null);
  assert.equal(reopenDraft.patch.resolvido_em, null);
  assert.equal('motivo' in reopenDraft.patch, false);
  assert.equal(reopenDraft.historico[0].acao, 'mudanca_situacao');

  const editDraft = buildEditarPendenciaDraft(
    {
      id: PEND_MINHA_ID,
      barragem_id: 'bar_101',
      empreendedor_id: 'emp_202'
    },
    {
      barragem_id: 'bar_nao_uuid_999',
      empreendedor_id: 'emp_nao_uuid_888',
      motivo: 'Ajuste de ID textual'
    },
    USER_AUTH_ID,
    nowIso
  );
  assert.equal(editDraft.patch.barragem_id, 'bar_nao_uuid_999');
  assert.equal(editDraft.patch.empreendedor_id, 'emp_nao_uuid_888');
  assert.equal('motivo' in editDraft.patch, false);
  assert.equal(editDraft.historico.length, 2);
  assert.equal(editDraft.historico[0].motivo, 'Ajuste de ID textual');
});

test('Pendências API: RBAC, bloqueio de spoofing, IDs textuais aceitos e mutações bloqueadas com 409 sem gravação parcial', async () => {
  const mock = createPendenciasSupabaseMock();
  setTestSupabaseAdminForSemaAudit(mock.client);

  try {
    // 1. Visualizador bloqueado (403)
    const resViewerPost = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer tok-viewer' },
        body: { action: 'criar', tipo: 'Pendência documental', titulo: 'Teste viewer' }
      }),
      resViewerPost
    );
    assert.equal(resViewerPost.statusCode, 403);

    // 2. Bloqueio de spoofing (criado_por, origem, papel, payload, CPF/CNPJ)
    for (const badBody of [
      { action: 'criar', tipo: 'Pendência documental', titulo: 'Spoof autor', criado_por: ADMIN_AUTH_ID },
      { action: 'criar', tipo: 'Pendência documental', titulo: 'Spoof origem', origem: 'outro' },
      { action: 'criar', tipo: 'Pendência documental', titulo: 'Spoof papel', papel: 'Administrador' },
      { action: 'criar', tipo: 'Pendência documental', titulo: 'Spoof payload', payload: { x: 1 } },
      { action: 'criar', tipo: 'Pendência documental', titulo: 'Titular CPF 123.456.789-01' }
    ]) {
      const resBad = createMockRes();
      await pendenciasHandler(
        createMockReq({
          method: 'POST',
          headers: { authorization: 'Bearer tok-user' },
          body: badBody
        }),
        resBad
      );
      assert.equal(resBad.statusCode, 400);
    }

    // 3. Não-admin não pode direcionar nem definir responsável ao criar (403)
    const resUserWithResp = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer tok-user' },
        body: {
          action: 'criar',
          tipo: 'Conciliação cadastral',
          titulo: 'Verificar CAR',
          responsavelUsuarioId: OTHER_AUTH_ID
        }
      }),
      resUserWithResp
    );
    assert.equal(resUserWithResp.statusCode, 403);

    const resUserDirecionar = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer tok-user' },
        body: {
          action: 'direcionar',
          pendenciaId: PEND_ABERTA_ID,
          responsavelUsuarioId: OTHER_AUTH_ID
        }
      }),
      resUserDirecionar
    );
    assert.equal(resUserDirecionar.statusCode, 403);

    // 4. Não-admin não pode alterar pendência atribuída a colega (403)
    const resOtherEdit = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer tok-user' },
        body: {
          action: 'editar',
          pendenciaId: PEND_COLEGA_ID,
          titulo: 'Tentativa em pendência do colega'
        }
      }),
      resOtherEdit
    );
    assert.equal(resOtherEdit.statusCode, 403);

    // 5. UUID exigido apenas para pendenciaId e usuário responsável (400), não para IDs textuais
    const resNonUuidPend = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer tok-admin' },
        body: {
          action: 'editar',
          pendenciaId: 'id-invalido',
          titulo: 'Título válido'
        }
      }),
      resNonUuidPend
    );
    assert.equal(resNonUuidPend.statusCode, 400);

    const resNonUuidResp = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer tok-admin' },
        body: {
          action: 'direcionar',
          pendenciaId: PEND_ABERTA_ID,
          responsavelUsuarioId: 'usr_user'
        }
      }),
      resNonUuidResp
    );
    assert.equal(resNonUuidResp.statusCode, 400);

    const resInactiveResp = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer tok-admin' },
        body: {
          action: 'direcionar',
          pendenciaId: PEND_ABERTA_ID,
          responsavelUsuarioId: INACTIVE_AUTH_ID
        }
      }),
      resInactiveResp
    );
    assert.equal(resInactiveResp.statusCode, 400);

    // 6. Requisições válidas (inclusive com IDs textuais não UUID) falham fechado com 409 sem gravação parcial
    const resCreateBlocked = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer tok-user' },
        body: {
          action: 'criar',
          tipo: 'Conciliação cadastral',
          titulo: 'Confirmar vínculo de barragem',
          origem_ref_id: 'DOC-2026-01',
          barragem_id: 'bar_101',
          empreendedor_id: 'emp_202',
          tipo_referencia: 'barragem',
          referencia_id: 'bar_101',
          motivo: 'Necessita conferência cadastral'
        }
      }),
      resCreateBlocked
    );
    assert.equal(resCreateBlocked.statusCode, 409);
    assert.equal(resCreateBlocked._body.success, false);
    assert.equal(resCreateBlocked._body.code, 'ATOMIC_TRANSACTION_REQUIRED');

    const resAdminDirecionarBlocked = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer tok-admin' },
        body: {
          action: 'direcionar',
          pendenciaId: PEND_ABERTA_ID,
          responsavelUsuarioId: USER_AUTH_ID,
          motivo: 'Direcionamento administrativo'
        }
      }),
      resAdminDirecionarBlocked
    );
    assert.equal(resAdminDirecionarBlocked.statusCode, 409);
    assert.equal(resAdminDirecionarBlocked._body.success, false);

    const resResolveOpenBlocked = createMockRes();
    await pendenciasHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer tok-user' },
        body: {
          action: 'resolver',
          pendenciaId: PEND_ABERTA_ID,
          motivo: 'Resolvido por usuário autorizado'
        }
      }),
      resResolveOpenBlocked
    );
    assert.equal(resResolveOpenBlocked.statusCode, 409);
    assert.equal(resResolveOpenBlocked._body.success, false);

    assert.equal(mock.writeOperations.length, 0);
    assert.equal(mock.pendencias.length, 3);
    assert.equal(mock.historico.length, 2);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Pendências privacidade: substitui CPF/CNPJ mantendo prefixos após delimitadores (-, _, /, .), aplica allowlist estrita e protege até para Administrador', async () => {
  // 1. Testes unitários do sanitizador de texto
  assert.equal(sanitizePendenciaTextForResponse('11111111-1111-4111-8111-111111111111'), '11111111-1111-4111-8111-111111111111');
  assert.equal(sanitizePendenciaTextForResponse('12345678-1234-4123-8123-123456789012'), '12345678-1234-4123-8123-123456789012');
  assert.equal(
    sanitizePendenciaTextForResponse('ID 12345678-1234-4123-8123-123456789012 referente a CPF 123.456.789-01'),
    'ID 12345678-1234-4123-8123-123456789012 referente a CPF [documento protegido]'
  );

  // Datas e timestamps preservados
  assert.equal(sanitizePendenciaTextForResponse('Data 2026-11-19 e 2026-11-19T10:00:00Z'), 'Data 2026-11-19 e 2026-11-19T10:00:00Z');
  assert.equal(sanitizePendenciaTextForResponse('Emitido em 19/11/2026 14:30:00'), 'Emitido em 19/11/2026 14:30:00');
  assert.equal(sanitizePendenciaTextForResponse('Protocolo de 19-11-2026 para CPF 12345678901'), 'Protocolo de 19-11-2026 para CPF [documento protegido]');

  // Referências e números que não formam CPF/CNPJ preservados integralmente
  assert.equal(sanitizePendenciaTextForResponse('PROC-2026/0012'), 'PROC-2026/0012');
  assert.equal(sanitizePendenciaTextForResponse('PROC-2026/0012-001'), 'PROC-2026/0012-001');
  assert.equal(sanitizePendenciaTextForResponse('PORT-MT-55'), 'PORT-MT-55');
  assert.equal(sanitizePendenciaTextForResponse('EMP-MT-042'), 'EMP-MT-042');
  assert.equal(sanitizePendenciaTextForResponse('bar_texto_456'), 'bar_texto_456');
  assert.equal(sanitizePendenciaTextForResponse('2026-1234567'), '2026-1234567');
  assert.equal(sanitizePendenciaTextForResponse('MT-5103403-A1B2C3D4E5F67890'), 'MT-5103403-A1B2C3D4E5F67890');

  // Referências e chaves com delimitadores (-, _, /, .) seguidos de CPF/CNPJ: preserva prefixo e protege sufixo
  assert.equal(sanitizePendenciaTextForResponse('BAR-12345678901'), 'BAR-[documento protegido]');
  assert.equal(sanitizePendenciaTextForResponse('REF-12.345.678/0001-90'), 'REF-[documento protegido]');
  assert.equal(sanitizePendenciaTextForResponse('emp_12345678901'), 'emp_[documento protegido]');
  assert.equal(sanitizePendenciaTextForResponse('empreendedor_55566677788'), 'empreendedor_[documento protegido]');
  assert.equal(sanitizePendenciaTextForResponse('BAR.12345678901'), 'BAR.[documento protegido]');
  assert.equal(sanitizePendenciaTextForResponse('DOC/12345678000190'), 'DOC/[documento protegido]');
  assert.equal(sanitizePendenciaTextForResponse('DOC/123.456.789-01'), 'DOC/[documento protegido]');
  assert.equal(sanitizePendenciaTextForResponse('REF-2026-12.345.678/0001-90'), 'REF-2026-[documento protegido]');
  assert.equal(sanitizePendenciaTextForResponse('EMP-042_123.456.789-01'), 'EMP-042_[documento protegido]');
  assert.equal(sanitizePendenciaTextForResponse('BAR-12345678901/2026'), 'BAR-[documento protegido]/2026');

  // Sequências 11/14 dígitos e formatos com espaços/separadores misturados -> zero dígitos visíveis
  for (const sensitiveDoc of [
    '12345678901',
    '12345678000190',
    '123-456.789/01',
    '123 456 789-01',
    '123_456_789_01',
    '123456789-01',
    '12-345 678/0001.90',
    '12.345678 0001-90',
    '12345678/0001-90',
    '12 345 678 0001 90'
  ]) {
    assert.equal(sanitizePendenciaTextForResponse(sensitiveDoc), '[documento protegido]');
  }
  assert.equal(sanitizePendenciaTextForResponse('CPF:12345678901'), 'CPF:[documento protegido]');

  // Allowlist estrita remove campos extras/desconhecidos e sanitiza títulos, referências, IDs e chaves de objeto
  const sanitizedRec = sanitizePendenciaRecordForResponse({
    id: PEND_MINHA_ID,
    origem: 'administra',
    tipo: 'Conciliação CPF 123.456.789-01',
    titulo: 'Regularizar BAR-12345678901, REF-12.345.678/0001-90 e emp_12345678901 em 19/11/2026',
    descricao: {
      detalhe: 'CNPJ 12-345-678/0001.90 / EMP-042_123.456.789-01',
      empreendedor_55566677788: 'PROC-2026/0012',
      emp_12345678901: 'BAR.12345678901'
    },
    origem_ref_id: 'REF-12.345.678/0001-90',
    referencia_id: 'emp_12345678901',
    empreendedor_id: 'empreendedor_55566677788',
    barragem_id: 'BAR-12345678901',
    situacao: 'direcionada',
    responsavel_id: USER_AUTH_ID,
    created_at: '2026-11-19T09:00:00Z',
    campo_extra_sigiloso: '12345678901',
    payload: { cpf_bruto: '123.456.789-01' }
  });
  assert.equal(sanitizedRec.id, PEND_MINHA_ID);
  assert.equal(sanitizedRec.tipo, 'Conciliação CPF [documento protegido]');
  assert.equal(
    sanitizedRec.titulo,
    'Regularizar BAR-[documento protegido], REF-[documento protegido] e emp_[documento protegido] em 19/11/2026'
  );
  assert.deepEqual(sanitizedRec.descricao, {
    detalhe: 'CNPJ [documento protegido] / EMP-042_[documento protegido]',
    'empreendedor_[documento protegido]': 'PROC-2026/0012',
    'emp_[documento protegido]': 'BAR.[documento protegido]'
  });
  assert.equal(sanitizedRec.origem_ref_id, 'REF-[documento protegido]');
  assert.equal(sanitizedRec.referencia_id, 'emp_[documento protegido]');
  assert.equal(sanitizedRec.empreendedor_id, 'empreendedor_[documento protegido]');
  assert.equal(sanitizedRec.barragem_id, 'BAR-[documento protegido]');
  assert.equal('campo_extra_sigiloso' in sanitizedRec, false);
  assert.equal('payload' in sanitizedRec, false);

  const sanitizedHist = sanitizePendenciaHistoricoForResponse({
    id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd9',
    pendencia_id: PEND_MINHA_ID,
    acao: 'edicao',
    campo: 'empreendedor_55566677788',
    valor_anterior: 'REF-12.345.678/0001-90',
    valor_novo: '11111111-1111-4111-8111-111111111111',
    usuario_id: ADMIN_AUTH_ID,
    motivo: 'Substituído emp_12345678901 e BAR-12345678901 por EMP-MT-042 em 2026-11-19',
    created_at: '2026-11-19T10:05:00Z',
    raw_extra_hist: '98.765.432/0001-10'
  });
  assert.equal(sanitizedHist.campo, 'empreendedor_[documento protegido]');
  assert.equal(sanitizedHist.valor_anterior, 'REF-[documento protegido]');
  assert.equal(sanitizedHist.valor_novo, '11111111-1111-4111-8111-111111111111');
  assert.equal(sanitizedHist.usuario_id, ADMIN_AUTH_ID);
  assert.equal(
    sanitizedHist.motivo,
    'Substituído emp_[documento protegido] e BAR-[documento protegido] por EMP-MT-042 em 2026-11-19'
  );
  assert.equal('raw_extra_hist' in sanitizedHist, false);

  // 2. Testes ponta a ponta nas rotas GET de lista (Minhas, Lista geral, Direcionado — inclusive Administrador) e detalhe/histórico
  const mock = createPendenciasSupabaseMock();
  const LEGACY_SENSITIVE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4';
  mock.pendencias.push({
    id: LEGACY_SENSITIVE_ID,
    origem: 'administra',
    origem_ref_id: 'REF-12.345.678/0001-90',
    tipo: 'Conciliação 98.765.432/0001-10',
    titulo: 'Titular BAR-12345678901, REF-12.345.678/0001-90, emp_12345678901 e 987-654.321/00',
    descricao: {
      resumo:
        'Consta CNPJ 11222333000181 em 19/11/2026 15:00:00, UUID 550e8400-e29b-41d4-a716-446655440000, PROC-2026/0012, PORT-MT-55, EMP-MT-042 e bar_texto_456',
      empreendedor_55566677788: 'REF-2026-12.345.678/0001-90'
    },
    situacao: 'direcionada',
    responsavel_id: USER_AUTH_ID,
    criado_por: ADMIN_AUTH_ID,
    direcionado_por: ADMIN_AUTH_ID,
    direcionado_em: '2026-11-19T10:00:00Z',
    resolvido_por: null,
    resolvido_em: null,
    tipo_referencia: 'empreendedor',
    referencia_id: 'emp_12345678901',
    empreendedor_id: 'empreendedor_55566677788',
    barragem_id: 'BAR-12345678901',
    created_at: '2026-11-19T09:00:00Z',
    updated_at: '2026-11-19T10:00:00Z',
    campo_desconhecido: '11122233344',
    cpf_cnpj: '98.765.432/0001-10'
  });
  mock.historico.push({
    id: 'ffffffff-ffff-4fff-8fff-fffffffffff3',
    pendencia_id: LEGACY_SENSITIVE_ID,
    acao: 'edicao',
    campo: 'empreendedor_55566677788',
    valor_anterior: 'BAR-12345678901',
    valor_novo: 'EMP-MT-042',
    usuario_id: ADMIN_AUTH_ID,
    motivo:
      'Removido emp_12345678901, 98 765 432/0001-10 e CPF 555.666 777-88 em 2026-11-19; mantido UUID 550e8400-e29b-41d4-a716-446655440000 e PROC-2026/0012; ref REF-12.345.678/0001-90',
    created_at: '2026-11-19T10:05:00Z',
    payload_bruto_extra: '98765432000110'
  });

  const rawRowSnapshot = JSON.stringify(mock.pendencias[3]);
  const rawHistSnapshot = JSON.stringify(mock.historico[2]);

  setTestSupabaseAdminForSemaAudit(mock.client);
  try {
    const assertNoPartialDigitsFor = (text: string, fragments: string[]) => {
      for (const frag of fragments) {
        assert.equal(text.includes(frag), false);
      }
    };

    const assertResponseSanitized = (item: any) => {
      const serialized = JSON.stringify(item);
      assertNoPartialDigitsFor(serialized, [
        '11122233344',
        '11122',
        '33344',
        '987-654.321/00',
        '987',
        '654.321',
        '11222333000181',
        '11222',
        '333000181',
        '55566677788',
        '55566',
        '77788',
        '98.765.432/0001-10',
        '98.765',
        '12.345.678/0001-90',
        '12.345.678',
        '0001-90',
        '12345678901',
        'campo_desconhecido',
        'cpf_cnpj'
      ]);

      assert.equal(item.id, LEGACY_SENSITIVE_ID);
      assert.equal(item.responsavel_id, USER_AUTH_ID);
      assert.equal(item.criado_por, ADMIN_AUTH_ID);
      assert.equal(item.direcionado_por, ADMIN_AUTH_ID);
      assert.equal(item.tipo, 'Conciliação [documento protegido]');
      assert.equal(
        item.titulo,
        'Titular BAR-[documento protegido], REF-[documento protegido], emp_[documento protegido] e [documento protegido]'
      );
      assert.deepEqual(item.descricao, {
        resumo:
          'Consta CNPJ [documento protegido] em 19/11/2026 15:00:00, UUID 550e8400-e29b-41d4-a716-446655440000, PROC-2026/0012, PORT-MT-55, EMP-MT-042 e bar_texto_456',
        'empreendedor_[documento protegido]': 'REF-2026-[documento protegido]'
      });
      assert.equal(item.origem_ref_id, 'REF-[documento protegido]');
      assert.equal(item.referencia_id, 'emp_[documento protegido]');
      assert.equal(item.empreendedor_id, 'empreendedor_[documento protegido]');
      assert.equal(item.barragem_id, 'BAR-[documento protegido]');
      assert.equal(item.created_at, '2026-11-19T09:00:00Z');
      assert.equal(item.updated_at, '2026-11-19T10:00:00Z');
      assert.equal('campo_desconhecido' in item, false);
      assert.equal('cpf_cnpj' in item, false);
    };

    // Lista: Minhas, Lista geral (não admin e admin) e Direcionado (Admin) — inclusive Admin nunca recebe CPF/CNPJ
    for (const [tab, token] of [
      ['minhas', 'tok-user'],
      ['geral', 'tok-analyst'],
      ['geral', 'tok-admin'],
      ['direcionado', 'tok-admin']
    ] as const) {
      const listRes = createMockRes();
      await pendenciasHandler(
        createMockReq({
          method: 'GET',
          url: `/api/pendencias?tab=${tab}`,
          headers: { authorization: `Bearer ${token}` }
        }),
        listRes
      );
      assert.equal(listRes.statusCode, 200);
      const legacyItem = listRes._body.pendencias.find((p: any) => p.id === LEGACY_SENSITIVE_ID);
      assert.ok(legacyItem);
      assertResponseSanitized(legacyItem);

      // IDs textuais legítimos da primeira pendência permanecem preservados
      const regularItem = listRes._body.pendencias.find((p: any) => p.id === PEND_MINHA_ID);
      assert.ok(regularItem);
      assert.equal(regularItem.origem_ref_id, 'PROC-2026/001');
      assert.equal(regularItem.referencia_id, 'PORT-99');
      assert.equal(regularItem.empreendedor_id, 'emp_202');
      assert.equal(regularItem.barragem_id, 'bar_101');
    }

    // Detalhe e histórico (para Visualizador e para Administrador)
    for (const token of ['tok-viewer', 'tok-admin']) {
      const detailRes = createMockRes();
      await pendenciasHandler(
        createMockReq({
          method: 'GET',
          url: `/api/pendencias?pendenciaId=${LEGACY_SENSITIVE_ID}`,
          headers: { authorization: `Bearer ${token}` }
        }),
        detailRes
      );
      assert.equal(detailRes.statusCode, 200);
      assertResponseSanitized(detailRes._body.pendencia);

      const histEntry = detailRes._body.historico[0];
      const histSerialized = JSON.stringify(histEntry);
      assertNoPartialDigitsFor(histSerialized, [
        '98 765 432/0001-10',
        '98 765',
        '432/0001',
        '98765432000110',
        '555.666 777-88',
        '555.666',
        '777-88',
        '55566677788',
        '12.345.678/0001-90',
        '12345678901',
        'payload_bruto_extra'
      ]);
      assert.equal(histEntry.id, 'ffffffff-ffff-4fff-8fff-fffffffffff3');
      assert.equal(histEntry.pendencia_id, LEGACY_SENSITIVE_ID);
      assert.equal(histEntry.usuario_id, ADMIN_AUTH_ID);
      assert.equal(histEntry.campo, 'empreendedor_[documento protegido]');
      assert.equal(histEntry.valor_anterior, 'BAR-[documento protegido]');
      assert.equal(histEntry.valor_novo, 'EMP-MT-042');
      assert.equal(
        histEntry.motivo,
        'Removido emp_[documento protegido], [documento protegido] e CPF [documento protegido] em 2026-11-19; mantido UUID 550e8400-e29b-41d4-a716-446655440000 e PROC-2026/0012; ref REF-[documento protegido]'
      );
      assert.equal(histEntry.created_at, '2026-11-19T10:05:00Z');
      assert.equal('payload_bruto_extra' in histEntry, false);
    }

    // Confirma que dados no banco em memória não foram alterados e zero escritas ocorreram
    assert.equal(JSON.stringify(mock.pendencias[3]), rawRowSnapshot);
    assert.equal(JSON.stringify(mock.historico[2]), rawHistSnapshot);
    assert.equal(mock.writeOperations.length, 0);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});
