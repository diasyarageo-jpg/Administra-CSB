// tests/solicitacoesVistoria.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import solicitacoesVistoriaHandler, {
  SOLICITACAO_HISTORICO_RESPONSE_ALLOWLIST,
  SOLICITACAO_RESPONSE_ALLOWLIST,
  constantTimeTokenEquals,
  sanitizeSolicitacaoHistoricoForResponse,
  sanitizeSolicitacaoRecordForResponse
} from '../api/solicitacoesVistoria';
import { setTestSupabaseAdminForSemaAudit } from '../src/server/semaAudit';

const ADMIN_AUTH_ID = '11111111-1111-4111-8111-111111111111';
const ANALYST_A_ID = '22222222-2222-4222-8222-222222222222';
const ANALYST_B_ID = '33333333-3333-4333-8333-333333333333';
const VIEWER_AUTH_ID = '44444444-4444-4444-8444-444444444444';
const INACTIVE_AUTH_ID = '55555555-5555-4555-8555-555555555555';
const TEAM_EMAIL_USER_ID = '66666666-6666-4666-8666-666666666666';

const SOLIC_ANALYST_A_ID = 'aaaa1111-1111-4111-8111-111111111111';
const SOLIC_REALIZADA_ID = 'bbbb2222-2222-4222-8222-222222222222';

function createMockReq(opts: {
  method?: string;
  url?: string;
  body?: any;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}) {
  const req = new EventEmitter() as any;
  req.method = opts.method || 'GET';
  req.url = opts.url || '/api/solicitacoes-vistoria';
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

function createSolicitacoesSupabaseMock(opts?: { enableRpcs?: boolean }) {
  const enableRpcs = Boolean(opts?.enableRpcs);

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
      id: 'usr_analyst_a',
      auth_user_id: ANALYST_A_ID,
      nome: 'Analista Ana',
      login: 'ana.csb',
      email: 'ana.sigiloso@sema.mt.gov.br',
      papel: 'Analista',
      setor: 'Setor de Classificação',
      situacao: 'Ativo',
      status: 'Ativo'
    },
    {
      id: 'usr_analyst_b',
      auth_user_id: ANALYST_B_ID,
      nome: 'Analista Bruno',
      login: 'bruno.csb',
      email: 'bruno.sigiloso@sema.mt.gov.br',
      papel: 'Analista',
      setor: 'Setor de Fiscalização',
      situacao: 'Ativo',
      status: 'Ativo'
    },
    {
      id: 'usr_team_email',
      auth_user_id: TEAM_EMAIL_USER_ID,
      nome: 'Fiscal Camila',
      login: 'camila.csb',
      email: 'camila.campo@sema.mt.gov.br',
      papel: 'Analista',
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
      login: 'ex.csb',
      email: 'ex@sema.mt.gov.br',
      papel: 'Analista',
      setor: 'Setor de Fiscalização',
      situacao: 'Inativo',
      status: 'Inativo'
    }
  ];

  const solicitacoes: any[] = [
    {
      id: SOLIC_ANALYST_A_ID,
      sistema_origem: 'classifica',
      origem_ref_id: 'CLS-2026-01',
      solicitante_id: ANALYST_A_ID,
      solicitante_nome: 'Analista Ana (ana.sigiloso@sema.mt.gov.br)',
      solicitante_perfil: 'Analista',
      relato: 'Solicita verificação de anomalia no talude e extravasor da barragem REF-12.345.678/0001-90.',
      empreendedor_id: 'emp_12345678901',
      barragem_id: 'bar_101',
      processo_referencia: 'PROC-2026/0012',
      dados_pre_preenchidos: {
        nome_barragem: 'Barragem Norte',
        municipio: 'Cuiabá',
        curso_agua: 'Rio Coxipó',
        coordenadas: '-15.60, -56.09',
        uso: 'Irrigação',
        classificacao: 'Alto DPA',
        nome_empreendedor: 'Empreendimento Rural Norte',
        cpf_cnpj: '123.456.789-01',
        campo_indevido: 'sigilo'
      },
      status: 'solicitada',
      vistoria_id: null,
      data_realizacao: null,
      equipe: null,
      observacao_campo: null,
      observacao_atualizada_em: null,
      observacao_atualizada_por: null,
      created_at: '2026-11-19T10:00:00Z',
      updated_at: '2026-11-19T10:00:00Z',
      campo_extra_secreto: '12345678901',
      payload_bruto: { raw: 'nao-deve-sair' }
    },
    {
      id: SOLIC_REALIZADA_ID,
      sistema_origem: 'administra',
      origem_ref_id: null,
      solicitante_id: ADMIN_AUTH_ID,
      solicitante_nome: 'Admin CSB',
      solicitante_perfil: 'Administrador',
      relato: 'Vistoria programada para acompanhamento de plano de ação.',
      empreendedor_id: 'emp_202',
      barragem_id: 'bar_202',
      processo_referencia: 'PROC-2026/0099',
      dados_pre_preenchidos: {
        nome_barragem: 'Barragem Sul',
        municipio: 'Rondonópolis'
      },
      status: 'realizada',
      vistoria_id: 'VST-2026-88',
      data_realizacao: '2026-11-18T14:30:00Z',
      equipe: [
        { id: ANALYST_A_ID, nome: 'Analista Ana', email: 'ana.sigiloso@sema.mt.gov.br' },
        { id: 'camila.campo@sema.mt.gov.br', nome: 'Fiscal Camila' }
      ],
      observacao_campo: 'Estruturas estáveis na data da vistoria.',
      observacao_atualizada_em: '2026-11-18T17:00:00Z',
      observacao_atualizada_por: ANALYST_A_ID,
      created_at: '2026-11-15T09:00:00Z',
      updated_at: '2026-11-18T17:00:00Z'
    }
  ];

  const historico: any[] = [
    {
      id: 'dddd1111-1111-4111-8111-111111111111',
      solicitacao_id: SOLIC_ANALYST_A_ID,
      acao: 'criacao',
      campo: 'status',
      valor_anterior: null,
      valor_novo: 'solicitada',
      usuario_id: ANALYST_A_ID,
      motivo: 'Abertura pela equipe',
      created_at: '2026-11-19T10:00:00Z',
      extra_hist: '98.765.432/0001-10'
    }
  ];

  const writeOperations: Array<{ table: string; op: string }> = [];
  const rpcCalls: Array<{ fnName: string; params: Record<string, any> }> = [];

  const tokenToUid: Record<string, string> = {
    'tok-admin': ADMIN_AUTH_ID,
    'tok-analyst-a': ANALYST_A_ID,
    'tok-analyst-b': ANALYST_B_ID,
    'tok-team-email': TEAM_EMAIL_USER_ID,
    'tok-viewer': VIEWER_AUTH_ID,
    'tok-inactive': INACTIVE_AUTH_ID
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
    async rpc(fnName: string, params: Record<string, any>) {
      rpcCalls.push({ fnName, params });
      if (!enableRpcs) {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: `Could not find the function public.${fnName} in the schema cache`
          }
        };
      }

      const now = '2026-11-20T12:00:00.000Z';
      if (fnName === 'criar_solicitacao_vistoria') {
        const created = {
          id: 'cccc3333-3333-4333-8333-333333333333',
          sistema_origem: params.p_sistema_origem,
          origem_ref_id: params.p_origem_ref_id,
          solicitante_id: params.p_solicitante_id,
          solicitante_nome: params.p_solicitante_nome,
          solicitante_perfil: params.p_solicitante_perfil,
          relato: params.p_relato,
          empreendedor_id: params.p_empreendedor_id,
          barragem_id: params.p_barragem_id,
          processo_referencia: params.p_processo_referencia,
          dados_pre_preenchidos: params.p_dados_pre_preenchidos,
          status: 'solicitada',
          vistoria_id: null,
          data_realizacao: null,
          equipe: null,
          observacao_campo: null,
          observacao_atualizada_em: null,
          observacao_atualizada_por: null,
          created_at: now,
          updated_at: now
        };
        solicitacoes.push(created);
        return { data: created, error: null };
      }

      if (fnName === 'editar_observacao_campo') {
        const target = solicitacoes.find(s => s.id === params.p_id);
        if (!target) return { data: null, error: { message: 'Not found' } };
        // NUNCA altera data_realizacao nem status
        target.observacao_campo = params.p_texto;
        target.observacao_atualizada_em = now;
        target.observacao_atualizada_por = params.p_usuario_id;
        target.updated_at = now;
        return { data: { ...target }, error: null };
      }

      if (fnName === 'concluir_solicitacao_vistoria') {
        const target = solicitacoes.find(s => s.id === params.p_id);
        if (!target) return { data: null, error: { message: 'Not found' } };
        target.status = 'realizada';
        target.vistoria_id = params.p_vistoria_id;
        target.data_realizacao = params.p_data_realizacao;
        target.equipe = params.p_equipe;
        if (params.p_observacao_campo) {
          target.observacao_campo = params.p_observacao_campo;
          target.observacao_atualizada_em = now;
          target.observacao_atualizada_por = params.p_usuario_id;
        }
        target.updated_at = now;
        return { data: { ...target }, error: null };
      }

      if (fnName === 'cancelar_solicitacao_vistoria') {
        const target = solicitacoes.find(s => s.id === params.p_id);
        if (!target) return { data: null, error: { message: 'Not found' } };
        target.status = 'cancelada';
        target.updated_at = now;
        return { data: { ...target }, error: null };
      }

      if (fnName === 'atualizar_solicitacao_vistoria') {
        const target = solicitacoes.find(s => s.id === params.p_id);
        if (!target) return { data: null, error: { message: 'Not found' } };
        Object.assign(target, params.p_campos, { updated_at: now });
        return { data: { ...target }, error: null };
      }

      return { data: null, error: { code: '42883', message: 'function does not exist' } };
    },
    from(table: string) {
      let filters: Array<{ col: string; val: unknown }> = [];
      const applyFilters = (list: any[]) =>
        list.filter(row => filters.every(f => String(row[f.col] ?? '') === String(f.val ?? '')));

      const execSelect = () => {
        if (table === 'usuarios') return applyFilters(usuarios).map(r => ({ ...r }));
        if (table === 'solicitacoes_vistoria') return applyFilters(solicitacoes).map(r => ({ ...r }));
        if (table === 'solicitacoes_vistoria_historico') {
          return applyFilters(historico).map(r => ({ ...r }));
        }
        return [];
      };

      const chain: any = {
        select() {
          return chain;
        },
        insert() {
          writeOperations.push({ table, op: 'insert' });
          throw new Error(`Gravação direta proibida (insert) em ${table}`);
        },
        update() {
          writeOperations.push({ table, op: 'update' });
          throw new Error(`Gravação direta proibida (update) em ${table}`);
        },
        delete() {
          writeOperations.push({ table, op: 'delete' });
          throw new Error(`Gravação direta proibida (delete) em ${table}`);
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

  return { client, solicitacoes, historico, writeOperations, rpcCalls };
}

test('Solicitações de Vistoria: 401 sem sessão, 403 para inativo e 503 sem configuração', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevViteUrl = process.env.VITE_SUPABASE_URL;
  const prevSrv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  setTestSupabaseAdminForSemaAudit(null);

  try {
    const res503 = createMockRes();
    await solicitacoesVistoriaHandler(createMockReq({ method: 'GET' }), res503);
    assert.equal(res503.statusCode, 503);

    const mock = createSolicitacoesSupabaseMock();
    setTestSupabaseAdminForSemaAudit(mock.client);

    const res401Get = createMockRes();
    await solicitacoesVistoriaHandler(createMockReq({ method: 'GET' }), res401Get);
    assert.equal(res401Get.statusCode, 401);

    const res401Post = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'POST',
        body: { relato: 'Solicitação sem sessão' }
      }),
      res401Post
    );
    assert.equal(res401Post.statusCode, 401);

    const res401InvalidJwt = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'GET',
        headers: { authorization: 'Bearer token-invalido' }
      }),
      res401InvalidJwt
    );
    assert.equal(res401InvalidJwt.statusCode, 401);

    const res403Inactive = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'GET',
        headers: { authorization: 'Bearer tok-inactive' }
      }),
      res403Inactive
    );
    assert.equal(res403Inactive.statusCode, 403);
    assert.equal(mock.writeOperations.length, 0);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
    if (prevViteUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteUrl;
    if (prevSrv !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevSrv;
  }
});

test('Solicitações de Vistoria: RBAC (Visualizador não altera; Analista só altera a própria; Administrador altera qualquer)', async () => {
  const mock = createSolicitacoesSupabaseMock({ enableRpcs: false });
  setTestSupabaseAdminForSemaAudit(mock.client);

  try {
    // Visualizador lê normalmente
    const resViewerGet = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'GET',
        headers: { authorization: 'Bearer tok-viewer' }
      }),
      resViewerGet
    );
    assert.equal(resViewerGet.statusCode, 200);
    assert.equal(resViewerGet._body.solicitacoes.length, 2);

    // Visualizador nunca altera (POST criar, PATCH editar, POST cancelar, POST concluir, PATCH observacao)
    for (const reqOpts of [
      {
        method: 'POST',
        url: '/api/solicitacoes-vistoria',
        body: { relato: 'Tentativa viewer criar' }
      },
      {
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}`,
        body: { relato: 'Tentativa viewer editar' }
      },
      {
        method: 'POST',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}/cancelar`,
        body: { motivo: 'Tentativa viewer cancelar' }
      },
      {
        method: 'POST',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}/concluir`,
        body: {
          vistoria_id: 'VST-1',
          data_realizacao: '2026-11-20T10:00:00Z',
          equipe: [{ id: ADMIN_AUTH_ID, nome: 'Admin' }]
        }
      },
      {
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_REALIZADA_ID}/observacao`,
        body: { observacao_campo: 'Tentativa viewer observação' }
      }
    ]) {
      const res = createMockRes();
      await solicitacoesVistoriaHandler(
        createMockReq({ ...reqOpts, headers: { authorization: 'Bearer tok-viewer' } }),
        res
      );
      assert.equal(res.statusCode, 403);
    }

    // Analista B não pode editar nem cancelar solicitação criada por Analista A (403)
    const resAnalystBEdit = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}`,
        headers: { authorization: 'Bearer tok-analyst-b' },
        body: { relato: 'Tentativa de edição por outro analista' }
      }),
      resAnalystBEdit
    );
    assert.equal(resAnalystBEdit.statusCode, 403);

    const resAnalystBCancel = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'POST',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}/cancelar`,
        headers: { authorization: 'Bearer tok-analyst-b' },
        body: { motivo: 'Tentativa de cancelamento por outro analista' }
      }),
      resAnalystBCancel
    );
    assert.equal(resAnalystBCancel.statusCode, 403);

    // Analista A (autora) passa pelo RBAC e chega à RPC -> 409 enquanto função não existir
    const resAnalystAEdit = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}`,
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: { relato: 'Atualização autorizada da autora' }
      }),
      resAnalystAEdit
    );
    assert.equal(resAnalystAEdit.statusCode, 409);

    const resAnalystACancel = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'POST',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}/cancelar`,
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: { motivo: 'Cancelamento autorizado pela autora' }
      }),
      resAnalystACancel
    );
    assert.equal(resAnalystACancel.statusCode, 409);

    // Administrador altera qualquer solicitação (inclusive de Analista A) -> chega à RPC -> 409 sem função
    const resAdminEditAny = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}`,
        headers: { authorization: 'Bearer tok-admin' },
        body: { relato: 'Ajuste administrativo permitido', status: 'em_planejamento' }
      }),
      resAdminEditAny
    );
    assert.equal(resAdminEditAny.statusCode, 409);

    const resAdminCancelAny = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'POST',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}/cancelar`,
        headers: { authorization: 'Bearer tok-admin' },
        body: { motivo: 'Cancelamento administrativo' }
      }),
      resAdminCancelAny
    );
    assert.equal(resAdminCancelAny.statusCode, 409);

    assert.equal(mock.writeOperations.length, 0);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Solicitações de Vistoria: observação de campo por membro da equipe e Admin, negada a outros, e nunca altera data_realizacao nem status', async () => {
  const mock = createSolicitacoesSupabaseMock({ enableRpcs: true });
  setTestSupabaseAdminForSemaAudit(mock.client);

  try {
    const initialDate = mock.solicitacoes[1].data_realizacao;
    const initialStatus = mock.solicitacoes[1].status;

    // 1. Analista fora da equipe recebe 403
    const resNonMember = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_REALIZADA_ID}/observacao`,
        headers: { authorization: 'Bearer tok-analyst-b' },
        body: { observacao_campo: 'Não sou da equipe' }
      }),
      resNonMember
    );
    assert.equal(resNonMember.statusCode, 403);

    // 2. Rejeita qualquer campo diferente de observacao_campo (ex.: data_realizacao ou status)
    for (const badObsBody of [
      { observacao_campo: 'Tentativa extra', status: 'solicitada' },
      { observacao_campo: 'Tentativa extra', data_realizacao: '2026-12-01T00:00:00Z' },
      { observacao_campo: 'Tentativa extra', motivo: 'extra' },
      { status: 'cancelada' }
    ]) {
      const resBad = createMockRes();
      await solicitacoesVistoriaHandler(
        createMockReq({
          method: 'PATCH',
          url: `/api/solicitacoes-vistoria/${SOLIC_REALIZADA_ID}/observacao`,
          headers: { authorization: 'Bearer tok-admin' },
          body: badObsBody
        }),
        resBad
      );
      assert.equal(resBad.statusCode, 400);
    }

    // 3. Membro da equipe por ID (Analista A) altera observacao_campo sem mexer em data_realizacao nem status
    const resTeamId = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_REALIZADA_ID}/observacao`,
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: { observacao_campo: 'Observação atualizada pelo membro por ID' }
      }),
      resTeamId
    );
    assert.equal(resTeamId.statusCode, 200);
    assert.equal(
      resTeamId._body.solicitacao.observacao_campo,
      'Observação atualizada pelo membro por ID'
    );
    assert.equal(resTeamId._body.solicitacao.data_realizacao, initialDate);
    assert.equal(resTeamId._body.solicitacao.status, initialStatus);

    // 4. Membro da equipe por e-mail da sessão (Fiscal Camila) altera observacao_campo
    const resTeamEmail = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_REALIZADA_ID}/observacao`,
        headers: { authorization: 'Bearer tok-team-email' },
        body: { observacao_campo: 'Observação atualizada via vínculo por e-mail' }
      }),
      resTeamEmail
    );
    assert.equal(resTeamEmail.statusCode, 200);
    assert.equal(
      resTeamEmail._body.solicitacao.observacao_campo,
      'Observação atualizada via vínculo por e-mail'
    );
    assert.equal(resTeamEmail._body.solicitacao.data_realizacao, initialDate);
    assert.equal(resTeamEmail._body.solicitacao.status, initialStatus);

    // 5. Administrador também pode editar observacao_campo sem alterar data_realizacao nem status
    const resAdminObs = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_REALIZADA_ID}/observacao`,
        headers: { authorization: 'Bearer tok-admin' },
        body: { observacao_campo: 'Complemento administrativo de campo' }
      }),
      resAdminObs
    );
    assert.equal(resAdminObs.statusCode, 200);
    assert.equal(
      resAdminObs._body.solicitacao.observacao_campo,
      'Complemento administrativo de campo'
    );
    assert.equal(resAdminObs._body.solicitacao.data_realizacao, initialDate);
    assert.equal(resAdminObs._body.solicitacao.status, initialStatus);

    // Verifica que todas as chamadas RPC de observação passaram somente p_id, p_texto, p_usuario_id
    const obsRpcs = mock.rpcCalls.filter(c => c.fnName === 'editar_observacao_campo');
    assert.equal(obsRpcs.length, 3);
    for (const call of obsRpcs) {
      assert.deepEqual(Object.keys(call.params).sort(), ['p_id', 'p_texto', 'p_usuario_id']);
    }
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Solicitações de Vistoria: rejeita CPF/CNPJ, payloads copiados e texto acima de 1000 caracteres', async () => {
  const mock = createSolicitacoesSupabaseMock({ enableRpcs: true });
  setTestSupabaseAdminForSemaAudit(mock.client);

  try {
    const over1000 = 'a'.repeat(1001);

    // Texto > 1000 em relato e observacao_campo
    const resLongRelato = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: { relato: over1000 }
      }),
      resLongRelato
    );
    assert.equal(resLongRelato.statusCode, 400);

    const resLongObs = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_REALIZADA_ID}/observacao`,
        headers: { authorization: 'Bearer tok-admin' },
        body: { observacao_campo: over1000 }
      }),
      resLongObs
    );
    assert.equal(resLongObs.statusCode, 400);

    // CPF/CNPJ em diversas formas e campos
    for (const badCreateBody of [
      { relato: 'Titular CPF 123.456.789-01 precisa vistoria' },
      { relato: 'CNPJ 12.345.678/0001-90 identificado' },
      { relato: 'Documento contínuo 12345678901 no relato' },
      { relato: 'Documento misto 12 345 678/0001-90' },
      { relato: 'Relato válido', barragem_id: 'BAR-12345678901' },
      { relato: 'Relato válido', processo_referencia: 'REF-12.345.678/0001-90' },
      {
        relato: 'Relato válido',
        dados_pre_preenchidos: { nome_empreendedor: 'Fulano 123.456.789-01' }
      },
      {
        relato: 'Relato válido',
        dados_pre_preenchidos: { nome_barragem: 'Barragem A', cpf_cnpj: '12345678901' }
      },
      {
        relato: 'Relato válido',
        payload: { copiado: true }
      },
      {
        relato: 'Relato válido',
        sistema_origem: 'classifica'
      },
      {
        relato: 'Relato válido',
        solicitante_id: ADMIN_AUTH_ID
      }
    ]) {
      const resBad = createMockRes();
      await solicitacoesVistoriaHandler(
        createMockReq({
          method: 'POST',
          headers: { authorization: 'Bearer tok-analyst-a' },
          body: badCreateBody
        }),
        resBad
      );
      assert.equal(resBad.statusCode, 400);
    }

    // CPF/CNPJ na observação de campo
    const resCpfObs = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_REALIZADA_ID}/observacao`,
        headers: { authorization: 'Bearer tok-admin' },
        body: { observacao_campo: 'Responsável com CPF 555.666.777-88 em campo' }
      }),
      resCpfObs
    );
    assert.equal(resCpfObs.statusCode, 400);

    // Nenhuma RPC deve ter sido chamada para entradas rejeitadas
    assert.equal(mock.rpcCalls.length, 0);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Solicitações de Vistoria: retorna 409 quando função de banco não existe e não grava nada', async () => {
  const mock = createSolicitacoesSupabaseMock({ enableRpcs: false });
  setTestSupabaseAdminForSemaAudit(mock.client);

  try {
    const requests = [
      {
        method: 'POST',
        url: '/api/solicitacoes-vistoria',
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: {
          relato: 'Solicitação de vistoria válida sem dados pessoais',
          barragem_id: 'bar_101',
          dados_pre_preenchidos: { nome_barragem: 'Barragem Modelo', municipio: 'Cuiabá' }
        }
      },
      {
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}`,
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: { relato: 'Edição válida aguardando função RPC' }
      },
      {
        method: 'POST',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}/cancelar`,
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: { motivo: 'Cancelamento válido aguardando RPC' }
      },
      {
        method: 'POST',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}/concluir`,
        headers: { authorization: 'Bearer tok-admin' },
        body: {
          vistoria_id: 'VST-2026-999',
          data_realizacao: '2026-11-20T15:00:00Z',
          equipe: [{ id: ANALYST_A_ID, nome: 'Analista Ana' }],
          observacao_campo: 'Conclusão sem documentos'
        }
      },
      {
        method: 'PATCH',
        url: `/api/solicitacoes-vistoria/${SOLIC_REALIZADA_ID}/observacao`,
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: { observacao_campo: 'Nova observação aguardando RPC' }
      }
    ];

    for (const r of requests) {
      const res = createMockRes();
      await solicitacoesVistoriaHandler(createMockReq(r), res);
      assert.equal(res.statusCode, 409);
      assert.equal(res._body.success, false);
      assert.equal(res._body.code, 'DB_FUNCTION_NOT_AVAILABLE');
    }

    assert.equal(mock.rpcCalls.length, 5);
    assert.equal(mock.writeOperations.length, 0);
    assert.equal(mock.solicitacoes.length, 2);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Solicitações de Vistoria: allowlists sem campos extras, sanitização de CPF/CNPJ e mascaramento de e-mails para não-Admin', async () => {
  const mock = createSolicitacoesSupabaseMock({ enableRpcs: false });
  setTestSupabaseAdminForSemaAudit(mock.client);

  try {
    // Allowlist unitária
    const unitRec = sanitizeSolicitacaoRecordForResponse(
      {
        ...mock.solicitacoes[0],
        campo_nao_permitido: '12345678901'
      },
      false
    );
    assert.deepEqual(
      Object.keys(unitRec).every(k => (SOLICITACAO_RESPONSE_ALLOWLIST as readonly string[]).includes(k)),
      true
    );
    assert.equal('campo_nao_permitido' in unitRec, false);
    assert.equal('campo_extra_secreto' in unitRec, false);
    assert.equal('payload_bruto' in unitRec, false);
    assert.equal('cpf_cnpj' in (unitRec.dados_pre_preenchidos || {}), false);
    assert.equal('campo_indevido' in (unitRec.dados_pre_preenchidos || {}), false);

    const unitHist = sanitizeSolicitacaoHistoricoForResponse(mock.historico[0], false);
    assert.deepEqual(
      Object.keys(unitHist).every(k =>
        (SOLICITACAO_HISTORICO_RESPONSE_ALLOWLIST as readonly string[]).includes(k)
      ),
      true
    );
    assert.equal('extra_hist' in unitHist, false);

    // GET lista como Analista (não-Admin): sem campos extras, sem CPF/CNPJ, sem e-mails crus
    const resListAnalyst = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'GET',
        url: '/api/solicitacoes-vistoria?sistema_origem=classifica&status=solicitada',
        headers: { authorization: 'Bearer tok-analyst-a' }
      }),
      resListAnalyst
    );
    assert.equal(resListAnalyst.statusCode, 200);
    assert.equal(resListAnalyst._body.solicitacoes.length, 1);

    const listStr = JSON.stringify(resListAnalyst._body);
    assert.equal(listStr.includes('12345678901'), false);
    assert.equal(listStr.includes('12.345.678/0001-90'), false);
    assert.equal(listStr.includes('@sema.mt.gov.br'), false);
    assert.equal(listStr.includes('campo_extra_secreto'), false);
    assert.equal(listStr.includes('payload_bruto'), false);
    assert.equal(listStr.includes('campo_indevido'), false);
    assert.equal(resListAnalyst._body.solicitacoes[0].empreendedor_id, 'emp_[documento protegido]');

    // GET detalhe como Visualizador: histórico com allowlist e sem e-mail da equipe
    const resDetailViewer = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'GET',
        url: `/api/solicitacoes-vistoria/${SOLIC_REALIZADA_ID}`,
        headers: { authorization: 'Bearer tok-viewer' }
      }),
      resDetailViewer
    );
    assert.equal(resDetailViewer.statusCode, 200);
    assert.equal(JSON.stringify(resDetailViewer._body).includes('@'), false);
    assert.equal(
      resDetailViewer._body.solicitacao.equipe.every(
        (m: any) => Object.keys(m).length === 2 && 'id' in m && 'nome' in m
      ),
      true
    );

    const resDetailHist = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'GET',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}`,
        headers: { authorization: 'Bearer tok-viewer' }
      }),
      resDetailHist
    );
    assert.equal(resDetailHist.statusCode, 200);
    assert.equal(resDetailHist._body.historico.length, 1);
    assert.equal('extra_hist' in resDetailHist._body.historico[0], false);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Solicitações de Vistoria: autenticação entre sistemas (SOLICITACOES_SERVICE_TOKEN em tempo constante e falha fechada)', async () => {
  const prevServiceToken = process.env.SOLICITACOES_SERVICE_TOKEN;
  process.env.SOLICITACOES_SERVICE_TOKEN = 'segredo-teste-integracao-csb';

  const mock = createSolicitacoesSupabaseMock({ enableRpcs: true });
  setTestSupabaseAdminForSemaAudit(mock.client);

  try {
    assert.equal(constantTimeTokenEquals('abc', 'abc'), true);
    assert.equal(constantTimeTokenEquals('abc', 'abd'), false);
    assert.equal(constantTimeTokenEquals('', ''), false);

    // 1. Sem segredo e tentando enviar x-sistema-origem externo -> 403
    const resNoSecret = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'POST',
        headers: {
          authorization: 'Bearer tok-analyst-a',
          'x-sistema-origem': 'classifica'
        },
        body: { relato: 'Tentativa sem segredo de serviço' }
      }),
      resNoSecret
    );
    assert.equal(resNoSecret.statusCode, 403);

    // 2. Com segredo errado -> 401
    const resWrongSecret = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'POST',
        headers: {
          authorization: 'Bearer tok-analyst-a',
          'x-sistema-origem': 'classifica',
          'x-solicitacoes-service-token': 'segredo-errado'
        },
        body: { relato: 'Tentativa com segredo errado' }
      }),
      resWrongSecret
    );
    assert.equal(resWrongSecret.statusCode, 401);

    // 3. Usuário direto do Administra (sem segredo, sem origem externa) -> cria com origem 'administra'
    const resAdministraCreate = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: { relato: 'Solicitação aberta no próprio Administra' }
      }),
      resAdministraCreate
    );
    assert.equal(resAdministraCreate.statusCode, 201);
    assert.equal(resAdministraCreate._body.solicitacao.sistema_origem, 'administra');
    assert.equal(resAdministraCreate._body.solicitacao.solicitante_id, ANALYST_A_ID);

    // 4. Chamada servidor-servidor autenticada pelo Notifica com SOLICITACOES_SERVICE_TOKEN
    const resNotificaCreate = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'POST',
        headers: {
          authorization: 'Bearer tok-analyst-a',
          'x-sistema-origem': 'notifica',
          'x-solicitacoes-service-token': 'segredo-teste-integracao-csb'
        },
        body: { relato: 'Solicitação originada no servidor Notifica', origem_ref_id: 'NOTIF-2026-10' }
      }),
      resNotificaCreate
    );
    assert.equal(resNotificaCreate.statusCode, 201);
    assert.equal(resNotificaCreate._body.solicitacao.sistema_origem, 'notifica');

    // 5. Chamada servidor-servidor autenticada pelo Fiscaliza para concluir vistoria
    const resFiscalizaConcluir = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'POST',
        url: `/api/solicitacoes-vistoria/${SOLIC_ANALYST_A_ID}/concluir`,
        headers: {
          authorization: 'Bearer tok-analyst-b',
          'x-sistema-origem': 'fiscaliza',
          'x-solicitacoes-service-token': 'segredo-teste-integracao-csb'
        },
        body: {
          vistoria_id: 'VST-FISC-2026-01',
          data_realizacao: '2026-11-20T16:00:00Z',
          equipe: [{ id: ANALYST_B_ID, nome: 'Analista Bruno' }],
          observacao_campo: 'Vistoria concluída com registro técnico'
        }
      }),
      resFiscalizaConcluir
    );
    assert.equal(resFiscalizaConcluir.statusCode, 200);
    assert.equal(resFiscalizaConcluir._body.solicitacao.status, 'realizada');
    assert.equal(resFiscalizaConcluir._body.solicitacao.vistoria_id, 'VST-FISC-2026-01');
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    if (prevServiceToken === undefined) {
      delete process.env.SOLICITACOES_SERVICE_TOKEN;
    } else {
      process.env.SOLICITACOES_SERVICE_TOKEN = prevServiceToken;
    }
  }
});

test('Solicitações de Vistoria: rota /api/solicitacoesVistoria (Vercel) com query params de detalhe, edição, cancelamento e observação', async () => {
  const mock = createSolicitacoesSupabaseMock({ enableRpcs: true });
  setTestSupabaseAdminForSemaAudit(mock.client);

  try {
    const resList = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'GET',
        url: '/api/solicitacoesVistoria?status=todos',
        headers: { authorization: 'Bearer tok-analyst-a' }
      }),
      resList
    );
    assert.equal(resList.statusCode, 200);
    assert.equal(resList._body.success, true);
    assert.equal(resList._body.solicitacoes.length, 2);

    const resDetail = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'GET',
        url: `/api/solicitacoesVistoria?solicitacaoId=${SOLIC_ANALYST_A_ID}`,
        headers: { authorization: 'Bearer tok-viewer' }
      }),
      resDetail
    );
    assert.equal(resDetail.statusCode, 200);
    assert.equal(resDetail._body.solicitacao.id, SOLIC_ANALYST_A_ID);

    const resCreate = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'POST',
        url: '/api/solicitacoesVistoria',
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: { relato: 'Solicitação enviada pela rota direta Vercel' }
      }),
      resCreate
    );
    assert.equal(resCreate.statusCode, 201);
    assert.equal(resCreate._body.success, true);

    const resPatch = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'PATCH',
        url: `/api/solicitacoesVistoria?id=${SOLIC_ANALYST_A_ID}`,
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: { relato: 'Relato atualizado pela rota direta Vercel' }
      }),
      resPatch
    );
    assert.equal(resPatch.statusCode, 200);
    assert.equal(resPatch._body.solicitacao.relato, 'Relato atualizado pela rota direta Vercel');

    const resObs = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'PATCH',
        url: `/api/solicitacoesVistoria?id=${SOLIC_REALIZADA_ID}&action=observacao`,
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: { observacao_campo: 'Observação atualizada via query param' }
      }),
      resObs
    );
    assert.equal(resObs.statusCode, 200);
    assert.equal(
      resObs._body.solicitacao.observacao_campo,
      'Observação atualizada via query param'
    );

    const resCancel = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'POST',
        url: `/api/solicitacoesVistoria?id=${SOLIC_ANALYST_A_ID}&action=cancelar`,
        headers: { authorization: 'Bearer tok-analyst-a' },
        body: { motivo: 'Cancelamento via rota Vercel sem conflito' }
      }),
      resCancel
    );
    assert.equal(resCancel.statusCode, 200);
    assert.equal(resCancel._body.solicitacao.status, 'cancelada');
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});

test('Solicitações de Vistoria: retorna HTTP 503 JSON amigável quando a tabela solicitacoes_vistoria ainda não foi criada (42P01/PGRST205)', async () => {
  const mock = createSolicitacoesSupabaseMock({ enableRpcs: false });
  const originalFrom = mock.client.from.bind(mock.client);
  mock.client.from = (table: string) => {
    if (table === 'solicitacoes_vistoria') {
      const missingTableErr = {
        code: 'PGRST205',
        message: "Could not find the table 'public.solicitacoes_vistoria' in the schema cache"
      };
      const queryResult = Promise.resolve({ data: null, error: missingTableErr });
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => queryResult,
        maybeSingle: () => queryResult,
        then: (resolve: any, reject: any) => queryResult.then(resolve, reject)
      };
      return chain;
    }
    return originalFrom(table);
  };
  setTestSupabaseAdminForSemaAudit(mock.client);

  try {
    const resList = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'GET',
        url: '/api/solicitacoesVistoria',
        headers: { authorization: 'Bearer tok-analyst-a' }
      }),
      resList
    );
    assert.equal(resList.statusCode, 503);
    assert.equal(resList._body.success, false);
    assert.equal(resList._body.code, 'DB_TABLE_NOT_AVAILABLE');
    assert.equal(typeof resList._body.error, 'string');
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});
