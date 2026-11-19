// tests/pendencias.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import pendenciasHandler from '../api/pendencias';
import { setTestSupabaseAdminForSemaAudit } from '../src/server/semaAudit';

const ADMIN_AUTH_ID = '11111111-1111-4111-8111-111111111111';
const USER_AUTH_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_AUTH_ID = '33333333-3333-4333-8333-333333333333';
const VIEWER_AUTH_ID = '44444444-4444-4444-8444-444444444444';

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
      email: 'admin@sema.mt.gov.br',
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
      email: 'maria@sema.mt.gov.br',
      papel: 'Usuário',
      setor: 'Setor de Classificação',
      situacao: 'Ativo',
      status: 'Ativo'
    },
    {
      id: 'usr_other',
      auth_user_id: OTHER_AUTH_ID,
      nome: 'Analista Joao',
      login: 'joao.csb',
      email: 'joao@sema.mt.gov.br',
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
      email: 'pedro@sema.mt.gov.br',
      papel: 'Visualizador',
      setor: 'Setor de Fiscalização',
      situacao: 'Ativo',
      status: 'Ativo'
    }
  ];

  const pendencias: any[] = [];
  const historico: any[] = [];
  let historicoMutationAttempted = false;
  let seq = 1;

  const tokenToUid: Record<string, string> = {
    'tok-admin': ADMIN_AUTH_ID,
    'tok-user': USER_AUTH_ID,
    'tok-other': OTHER_AUTH_ID,
    'tok-viewer': VIEWER_AUTH_ID
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
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let opPayload: any = null;

      const applyFilters = (list: any[]) =>
        list.filter(row => filters.every(f => String(row[f.col] ?? '') === String(f.val ?? '')));

      const execSelect = () => {
        if (table === 'usuarios') return applyFilters(usuarios).map(r => ({ ...r }));
        if (table === 'pendencias') return applyFilters(pendencias).map(r => ({ ...r }));
        if (table === 'pendencias_historico') return applyFilters(historico).map(r => ({ ...r }));
        return [];
      };

      const chain: any = {
        select() {
          return chain;
        },
        insert(payload: any) {
          op = 'insert';
          opPayload = payload;
          return chain;
        },
        update(payload: any) {
          if (table === 'pendencias_historico') {
            historicoMutationAttempted = true;
          }
          op = 'update';
          opPayload = payload;
          return chain;
        },
        delete() {
          if (table === 'pendencias_historico') {
            historicoMutationAttempted = true;
          }
          op = 'delete';
          return chain;
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
        async single() {
          if (op === 'insert' && table === 'pendencias') {
            const row = { id: opPayload.id || `pend_${seq++}`, ...opPayload };
            pendencias.unshift(row);
            return { data: { ...row }, error: null };
          }
          if (op === 'update' && table === 'pendencias') {
            const idx = pendencias.findIndex(r =>
              filters.every(f => String(r[f.col] ?? '') === String(f.val ?? ''))
            );
            if (idx < 0) return { data: null, error: { message: 'Not found' } };
            pendencias[idx] = { ...pendencias[idx], ...opPayload };
            return { data: { ...pendencias[idx] }, error: null };
          }
          const rows = execSelect();
          return { data: rows[0] || null, error: null };
        },
        then(resolve: any, reject: any) {
          if (op === 'insert' && table === 'pendencias_historico') {
            const items = Array.isArray(opPayload) ? opPayload : [opPayload];
            const inserted = items.map(it => {
              const row = { id: it.id || `hist_${seq++}`, ...it };
              historico.unshift(row);
              return { ...row };
            });
            return Promise.resolve({ data: inserted, error: null }).then(resolve, reject);
          }
          if (op === 'delete' && table === 'pendencias') {
            for (let i = pendencias.length - 1; i >= 0; i--) {
              if (filters.every(f => String(pendencias[i][f.col] ?? '') === String(f.val ?? ''))) {
                pendencias.splice(i, 1);
              }
            }
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
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
    wasHistoricoMutated: () => historicoMutationAttempted
  };
}

test('Pendências API: falha fechada (503) quando banco central não está configurado e exige JWT (401)', async () => {
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
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
    if (prevViteUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteUrl;
    if (prevSrv !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevSrv;
  }
});

test('Pendências API: RBAC, não confia em usuário/permissão do navegador, bloqueia CPF/CNPJ e grava histórico append-only', async () => {
  const mock = createPendenciasSupabaseMock();
  setTestSupabaseAdminForSemaAudit(mock.client);

  try {
    // 1. Visualizador não pode criar nem acessar aba Direcionado
    const viewerPost = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-viewer' },
      body: { action: 'criar', tipo: 'Pendência documental', titulo: 'Teste viewer' }
    });
    const resViewerPost = createMockRes();
    await pendenciasHandler(viewerPost, resViewerPost);
    assert.equal(resViewerPost.statusCode, 403);

    const viewerDir = createMockReq({
      method: 'GET',
      url: '/api/pendencias?tab=direcionado',
      headers: { authorization: 'Bearer tok-viewer' }
    });
    const resViewerDir = createMockRes();
    await pendenciasHandler(viewerDir, resViewerDir);
    assert.equal(resViewerDir.statusCode, 403);

    // 2. Bloqueia tentativa de falsificar criado_por / papel / payload / CPF-CNPJ
    const spoofReq = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-user' },
      body: {
        action: 'criar',
        tipo: 'Pendência documental',
        titulo: 'Falsificação',
        criado_por: ADMIN_AUTH_ID
      }
    });
    const resSpoof = createMockRes();
    await pendenciasHandler(spoofReq, resSpoof);
    assert.equal(resSpoof.statusCode, 400);

    const cpfReq = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-user' },
      body: {
        action: 'criar',
        tipo: 'Pendência documental',
        titulo: 'Regularizar titular CPF 123.456.789-01'
      }
    });
    const resCpf = createMockRes();
    await pendenciasHandler(cpfReq, resCpf);
    assert.equal(resCpf.statusCode, 400);

    // 3. Usuário não-admin não pode escolher responsável ao criar
    const userWithResp = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-user' },
      body: {
        action: 'criar',
        tipo: 'Conciliação cadastral',
        titulo: 'Verificar CAR duplicado',
        responsavelUsuarioId: 'usr_other'
      }
    });
    const resUserWithResp = createMockRes();
    await pendenciasHandler(userWithResp, resUserWithResp);
    assert.equal(resUserWithResp.statusCode, 403);

    // 4. Usuário cria pendência sem responsável (usa origem Administra e criado_por da sessão)
    const createOpenReq = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-user' },
      body: {
        action: 'criar',
        tipo: 'Conciliação cadastral',
        titulo: 'Confirmar vínculo de barragem',
        barragem_id: 'bar_101',
        empreendedor_id: 'emp_202',
        tipo_referencia: 'barragem',
        referencia_id: 'bar_101'
      }
    });
    const resCreateOpen = createMockRes();
    await pendenciasHandler(createOpenReq, resCreateOpen);
    assert.equal(resCreateOpen.statusCode, 201);
    assert.equal(resCreateOpen._body.pendencia.origem, 'Administra');
    assert.equal(resCreateOpen._body.pendencia.criado_por, USER_AUTH_ID);
    assert.equal(resCreateOpen._body.pendencia.situacao, 'aberta');
    assert.equal(resCreateOpen._body.pendencia.responsavel_id, null);

    const openId = resCreateOpen._body.pendencia.id;

    // 5. Qualquer usuário autorizado pode resolver pendência sem responsável
    const resolveOpenReq = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-other' },
      body: {
        action: 'resolver',
        pendenciaId: openId,
        motivo: 'Vínculo conferido no cadastro central'
      }
    });
    const resResolveOpen = createMockRes();
    await pendenciasHandler(resolveOpenReq, resResolveOpen);
    assert.equal(resResolveOpen.statusCode, 200);
    assert.equal(resResolveOpen._body.pendencia.situacao, 'resolvida');
    assert.equal(resResolveOpen._body.pendencia.resolvido_por, OTHER_AUTH_ID);

    // 6. Admin cria pendência e direciona para USER_AUTH_ID; não-admin não pode direcionar
    const adminCreateReq = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-admin' },
      body: {
        action: 'criar',
        tipo: 'Verificação de RT/ART',
        titulo: 'Validar ART citada no parecer 44/2026',
        barragem_id: 'bar_999'
      }
    });
    const resAdminCreate = createMockRes();
    await pendenciasHandler(adminCreateReq, resAdminCreate);
    assert.equal(resAdminCreate.statusCode, 201);
    const assignedPendenciaId = resAdminCreate._body.pendencia.id;

    const userTryAssign = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-user' },
      body: {
        action: 'direcionar',
        pendenciaId: assignedPendenciaId,
        responsavelUsuarioId: 'usr_user'
      }
    });
    const resUserTryAssign = createMockRes();
    await pendenciasHandler(userTryAssign, resUserTryAssign);
    assert.equal(resUserTryAssign.statusCode, 403);

    const adminAssignReq = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-admin' },
      body: {
        action: 'direcionar',
        pendenciaId: assignedPendenciaId,
        responsavelUsuarioId: 'usr_user',
        motivo: 'Encaminhado para análise técnica'
      }
    });
    const resAdminAssign = createMockRes();
    await pendenciasHandler(adminAssignReq, resAdminAssign);
    assert.equal(resAdminAssign.statusCode, 200);
    assert.equal(resAdminAssign._body.pendencia.responsavel_id, USER_AUTH_ID);
    assert.equal(resAdminAssign._body.pendencia.situacao, 'direcionada');

    // 7. Outro usuário não autorizado nesta pendência direcionada não pode alterá-la (403)
    const otherTryEdit = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-other' },
      body: {
        action: 'editar',
        pendenciaId: assignedPendenciaId,
        titulo: 'Alteração indevida'
      }
    });
    const resOtherTryEdit = createMockRes();
    await pendenciasHandler(otherTryEdit, resOtherTryEdit);
    assert.equal(resOtherTryEdit.statusCode, 403);

    // 8. Responsável atual edita, muda situação para em_analise e resolve; status inválido retorna 400
    const badStatusReq = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-user' },
      body: {
        action: 'alterar_situacao',
        pendenciaId: assignedPendenciaId,
        situacao: 'invalida_xyz'
      }
    });
    const resBadStatus = createMockRes();
    await pendenciasHandler(badStatusReq, resBadStatus);
    assert.equal(resBadStatus.statusCode, 400);

    const editReq = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-user' },
      body: {
        action: 'editar',
        pendenciaId: assignedPendenciaId,
        titulo: 'Validar ART 12345 no parecer 44/2026',
        motivo: 'Complemento do número da ART'
      }
    });
    const resEdit = createMockRes();
    await pendenciasHandler(editReq, resEdit);
    assert.equal(resEdit.statusCode, 200);

    const analiseReq = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer tok-user' },
      body: {
        action: 'alterar_situacao',
        pendenciaId: assignedPendenciaId,
        situacao: 'em_analise',
        motivo: 'Iniciada conferência documental'
      }
    });
    const resAnalise = createMockRes();
    await pendenciasHandler(analiseReq, resAnalise);
    assert.equal(resAnalise.statusCode, 200);
    assert.equal(resAnalise._body.pendencia.situacao, 'em_analise');

    // 9. Abas Minhas pendências vs Lista geral vs Direcionado
    const minhasUserReq = createMockReq({
      method: 'GET',
      url: '/api/pendencias?tab=minhas',
      headers: { authorization: 'Bearer tok-user' }
    });
    const resMinhasUser = createMockRes();
    await pendenciasHandler(minhasUserReq, resMinhasUser);
    assert.equal(resMinhasUser.statusCode, 200);
    assert.equal(resMinhasUser._body.pendencias.length, 1);
    assert.equal(resMinhasUser._body.pendencias[0].id, assignedPendenciaId);

    const minhasOtherReq = createMockReq({
      method: 'GET',
      url: '/api/pendencias?tab=minhas',
      headers: { authorization: 'Bearer tok-other' }
    });
    const resMinhasOther = createMockRes();
    await pendenciasHandler(minhasOtherReq, resMinhasOther);
    assert.equal(resMinhasOther.statusCode, 200);
    assert.equal(resMinhasOther._body.pendencias.length, 0);

    const adminDirReq = createMockReq({
      method: 'GET',
      url: '/api/pendencias?tab=direcionado',
      headers: { authorization: 'Bearer tok-admin' }
    });
    const resAdminDir = createMockRes();
    await pendenciasHandler(adminDirReq, resAdminDir);
    assert.equal(resAdminDir.statusCode, 200);
    assert.equal(resAdminDir._body.pendencias.length, 1);
    assert.ok(Array.isArray(resAdminDir._body.usuariosDirecionaveis));

    // 10. Detalhe + histórico contém criacao, direcionamento, edicao, mudanca_situacao, resolucao sem update/delete no histórico
    const detailReq = createMockReq({
      method: 'GET',
      url: `/api/pendencias?pendenciaId=${assignedPendenciaId}`,
      headers: { authorization: 'Bearer tok-user' }
    });
    const resDetail = createMockRes();
    await pendenciasHandler(detailReq, resDetail);
    assert.equal(resDetail.statusCode, 200);
    const acoes = resDetail._body.historico.map((h: any) => h.acao);
    assert.ok(acoes.includes('criacao'));
    assert.ok(acoes.includes('direcionamento'));
    assert.ok(acoes.includes('edicao'));
    assert.ok(acoes.includes('mudanca_situacao'));

    assert.equal(mock.wasHistoricoMutated(), false);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});
