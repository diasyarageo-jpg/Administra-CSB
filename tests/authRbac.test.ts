// tests/authRbac.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import authConfigHandler, { resolvePublicSupabaseConfigFromEnv } from '../api/auth-config';
import authSessionHandler from '../api/auth-session';
import integracoesStatusHandler from '../api/integracoes-status';
import pendenciasHandler from '../api/pendencias';
import solicitacoesVistoriaHandler from '../api/solicitacoesVistoria';
import conciliacaoGravarHandler from '../api/conciliacao-gravar';
import { setTestSupabaseAdminForSemaAudit } from '../src/server/semaAudit';
import {
  createAuthService,
  validateInstitutionalProfile
} from '../src/services/authService';

const YARA_AUTH_UID = '52f8280d-cc4c-4aad-98f6-7446da912dd1';
const YARA_USUARIO_ID = 'usr_yara_dias_01';

function createMockReq(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
}): IncomingMessage & { query?: any; body?: any; url?: string } {
  return {
    method: opts.method || 'GET',
    url: opts.url || '/',
    headers: opts.headers || {},
    body: opts.body
  } as any;
}

function createMockRes() {
  let statusCode = 200;
  let body: any = null;
  const headers: Record<string, string> = {};
  const res: any = {
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      body = data;
      return res;
    },
    end(chunk?: any) {
      if (typeof chunk === 'string' && chunk.trim()) {
        try {
          body = JSON.parse(chunk);
        } catch {
          body = chunk;
        }
      }
      return res;
    },
    getStatus: () => statusCode,
    getBody: () => body,
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    get _body() {
      return body;
    }
  };
  return res as ServerResponse & {
    getStatus: () => number;
    getBody: () => any;
    statusCode: number;
    _body: any;
  };
}

function createServerAuthSupabaseMock(opts: {
  tokenMap: Record<string, { id: string; email?: string; user_metadata?: Record<string, any> }>;
  usuariosRows: Array<Record<string, any>>;
}) {
  const emailQueries: string[] = [];
  const updateCalls: any[] = [];

  const client: any = {
    emailQueries,
    updateCalls,
    auth: {
      async getUser(jwt: string) {
        const user = opts.tokenMap[jwt];
        if (!user) {
          return { data: { user: null }, error: { message: 'Invalid or expired JWT' } };
        }
        return { data: { user }, error: null };
      }
    },
    from(table: string) {
      return {
        select() {
          const filters: Record<string, any> = {};
          const chain: any = {
            eq(col: string, val: any) {
              filters[col] = val;
              return chain;
            },
            ilike(col: string, val: any) {
              if (col === 'email') emailQueries.push(String(val));
              filters[`ilike:${col}`] = val;
              return chain;
            },
            async maybeSingle() {
              if (table !== 'usuarios') return { data: null, error: null };
              const matched = opts.usuariosRows.find(row => {
                if ('auth_user_id' in filters) {
                  return String(row.auth_user_id || '') === String(filters.auth_user_id || '');
                }
                return false;
              });
              return { data: matched || null, error: null };
            }
          };
          return chain;
        },
        update(payload: any) {
          updateCalls.push({ table, payload });
          return {
            eq() {
              return Promise.resolve({ data: null, error: null });
            }
          };
        }
      };
    }
  };

  return client;
}

function createFrontendAuthClientMock(opts: {
  configured?: boolean;
  session?: any;
  sessionError?: any;
  getUserResult?: { user: any | null; error: any | null };
  signInResult?: { data: any; error: any };
  usuariosRows?: Array<Record<string, any>>;
  queryError?: any;
}) {
  let signOutCount = 0;
  let lastSignInArgs: any = null;
  const emailLookups: string[] = [];

  const client: any = {
    get signOutCount() {
      return signOutCount;
    },
    get lastSignInArgs() {
      return lastSignInArgs;
    },
    emailLookups,
    auth: {
      async getSession() {
        if (opts.sessionError) {
          return { data: { session: null }, error: opts.sessionError };
        }
        return { data: { session: opts.session ?? null }, error: null };
      },
      async getUser(_jwt?: string) {
        if (opts.getUserResult) {
          return { data: { user: opts.getUserResult.user }, error: opts.getUserResult.error };
        }
        return {
          data: { user: opts.session?.user ?? null },
          error: opts.session?.user ? null : { message: 'Sessão ausente' }
        };
      },
      async signInWithPassword(creds: { email: string; password: string }) {
        lastSignInArgs = creds;
        if (opts.signInResult) return opts.signInResult;
        return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
      },
      async signOut() {
        signOutCount += 1;
        return { error: null };
      }
    },
    from(table: string) {
      return {
        select() {
          const filters: Record<string, any> = {};
          const chain: any = {
            eq(col: string, val: any) {
              filters[col] = val;
              return chain;
            },
            ilike(col: string, val: any) {
              if (col === 'email') emailLookups.push(String(val));
              return chain;
            },
            async maybeSingle() {
              if (opts.queryError) {
                return { data: null, error: opts.queryError };
              }
              if (table !== 'usuarios') return { data: null, error: null };
              const match = (opts.usuariosRows || []).find(r =>
                'auth_user_id' in filters
                  ? String(r.auth_user_id || '') === String(filters.auth_user_id || '')
                  : false
              );
              return { data: match || null, error: null };
            }
          };
          return chain;
        }
      };
    }
  };

  return client;
}

test('Auth RBAC: valida vínculo estrito por auth_user_id preservando usuarios.id (usr_...) e rejeita correspondência só por e-mail', async () => {
  const client = createFrontendAuthClientMock({
    signInResult: {
      data: {
        user: {
          id: YARA_AUTH_UID,
          email: 'yarageologa@gmail.com',
          // Tentativa de spoofing em user_metadata deve ser ignorada
          user_metadata: { papel: 'Visualizador' }
        },
        session: { access_token: 'tok-yara', user: { id: YARA_AUTH_UID } }
      },
      error: null
    },
    usuariosRows: [
      {
        id: YARA_USUARIO_ID,
        auth_user_id: YARA_AUTH_UID,
        nome: 'Yara Dias',
        login: 'yarageologa',
        email: 'yarageologa@gmail.com',
        papel: 'Administrador',
        situacao: 'Ativo',
        status: 'Ativo'
      }
    ]
  });

  const svc = createAuthService(() => ({ client, configured: true }));
  const loginRes = await svc.loginWithPassword('yarageologa@gmail.com', 'segredo-teste');

  assert.equal(loginRes.success, true);
  assert.equal(loginRes.profile?.id, YARA_USUARIO_ID);
  assert.equal(loginRes.profile?.authUserId, YARA_AUTH_UID);
  assert.equal(loginRes.profile?.papel, 'Administrador');
  assert.equal(client.signOutCount, 0);
  assert.equal(client.emailLookups.length, 0);

  // Linha que tem o mesmo e-mail mas auth_user_id nulo ou divergente NÃO pode logar
  const unlinkedClient = createFrontendAuthClientMock({
    signInResult: {
      data: {
        user: { id: YARA_AUTH_UID, email: 'yarageologa@gmail.com' },
        session: { access_token: 'tok-yara', user: { id: YARA_AUTH_UID } }
      },
      error: null
    },
    usuariosRows: [
      {
        id: YARA_USUARIO_ID,
        auth_user_id: null,
        nome: 'Yara Dias',
        email: 'yarageologa@gmail.com',
        papel: 'Administrador',
        situacao: 'Ativo'
      }
    ]
  });

  const unlinkedSvc = createAuthService(() => ({ client: unlinkedClient, configured: true }));
  const blockedRes = await unlinkedSvc.loginWithPassword('yarageologa@gmail.com', 'segredo-teste');

  assert.equal(blockedRes.success, false);
  assert.equal(blockedRes.code, 'PROFILE_MISSING');
  assert.equal(unlinkedClient.signOutCount, 1);
  assert.equal(unlinkedClient.emailLookups.length, 0);
});

test('Auth RBAC: falha fechado para perfis inativos, pendentes, recusados e papel inválido ou ausente', async () => {
  for (const scenario of [
    { situacao: 'Inativo', papel: 'Administrador', expectedCode: 'PROFILE_INACTIVE' },
    { situacao: 'Pendente', papel: 'Usuário', expectedCode: 'PROFILE_PENDING' },
    { situacao: 'Recusado', papel: 'Usuário', expectedCode: 'PROFILE_REJECTED' },
    { situacao: null, papel: 'Administrador', expectedCode: 'PROFILE_INACTIVE' },
    { situacao: 'Ativo', papel: 'SuperAdminInexistente', expectedCode: 'ROLE_INVALID' },
    { situacao: 'Ativo', papel: '', expectedCode: 'ROLE_INVALID' }
  ]) {
    const uid = '11111111-1111-4111-8111-111111111111';
    const validated = validateInstitutionalProfile(
      {
        id: 'usr_teste_01',
        auth_user_id: uid,
        nome: 'Servidor Teste',
        papel: scenario.papel,
        situacao: scenario.situacao
      },
      uid
    );
    assert.equal(validated.profile, null);
    assert.equal(validated.code, scenario.expectedCode);

    const client = createFrontendAuthClientMock({
      signInResult: {
        data: {
          user: { id: uid, email: 'teste@sema.mt.gov.br', user_metadata: { papel: 'Administrador' } },
          session: { access_token: 'tok-teste', user: { id: uid } }
        },
        error: null
      },
      usuariosRows: [
        {
          id: 'usr_teste_01',
          auth_user_id: uid,
          nome: 'Servidor Teste',
          papel: scenario.papel,
          situacao: scenario.situacao
        }
      ]
    });

    const svc = createAuthService(() => ({ client, configured: true }));
    const res = await svc.loginWithPassword('teste@sema.mt.gov.br', 'senha');
    assert.equal(res.success, false);
    assert.equal(res.code, scenario.expectedCode);
    assert.equal(client.signOutCount, 1);
  }
});

test('Auth RBAC: restauração de sessão, expiração, logout, erro de rede e ambiente sem configuração', async () => {
  // 1. Ambiente sem configuração falha fechado
  const unconfiguredSvc = createAuthService(() => ({ client: null, configured: false }));
  const unconfLogin = await unconfiguredSvc.loginWithPassword('yarageologa@gmail.com', '123456');
  assert.equal(unconfLogin.success, false);
  assert.equal(unconfLogin.code, 'AUTH_NOT_CONFIGURED');

  const unconfRestore = await unconfiguredSvc.restoreVerifiedSession();
  assert.equal(unconfRestore.status, 'unconfigured');
  assert.equal(unconfRestore.code, 'AUTH_NOT_CONFIGURED');

  // 2. Cadastro público desativado
  const signupBlocked = await unconfiguredSvc.requestAccess({
    nome: 'Invasor',
    matricula: '999',
    email: 'invasor@example.com',
    perfilProfissional: 'Técnico de Meio Ambiente',
    setor: 'Setor de Fiscalização'
  });
  assert.equal(signupBlocked.success, false);
  assert.match(String(signupBlocked.error), /desativado/i);

  // 3. Restauração válida de sessão
  const validClient = createFrontendAuthClientMock({
    session: {
      access_token: 'tok-valid',
      user: { id: YARA_AUTH_UID, email: 'yarageologa@gmail.com' }
    },
    usuariosRows: [
      {
        id: YARA_USUARIO_ID,
        auth_user_id: YARA_AUTH_UID,
        nome: 'Yara Dias',
        login: 'yarageologa',
        papel: 'Analista',
        situacao: 'Ativo'
      }
    ]
  });
  const validSvc = createAuthService(() => ({ client: validClient, configured: true }));
  const restoredOk = await validSvc.restoreVerifiedSession();
  assert.equal(restoredOk.status, 'authenticated');
  assert.equal(restoredOk.profile?.id, YARA_USUARIO_ID);
  assert.equal(restoredOk.profile?.papel, 'Analista');

  await validSvc.logout();
  assert.equal(validClient.signOutCount, 1);

  // 4. Sessão expirada/revogada no servidor Auth
  const expiredClient = createFrontendAuthClientMock({
    session: {
      access_token: 'tok-expired',
      user: { id: YARA_AUTH_UID }
    },
    getUserResult: { user: null, error: { message: 'JWT expired' } }
  });
  const expiredSvc = createAuthService(() => ({ client: expiredClient, configured: true }));
  const expiredRes = await expiredSvc.restoreVerifiedSession();
  assert.equal(expiredRes.status, 'expired');
  assert.equal(expiredRes.code, 'SESSION_EXPIRED');
  assert.equal(expiredClient.signOutCount, 1);

  // 5. Falha temporária de rede ao consultar perfil
  const netClient = createFrontendAuthClientMock({
    session: {
      access_token: 'tok-valid',
      user: { id: YARA_AUTH_UID }
    },
    queryError: { message: 'Failed to fetch from Supabase' }
  });
  const netSvc = createAuthService(() => ({ client: netClient, configured: true }));
  const netRes = await netSvc.restoreVerifiedSession();
  assert.equal(netRes.status, 'blocked');
  assert.equal(netRes.code, 'NETWORK_ERROR');
  assert.equal(netClient.signOutCount, 0);
});

test('Servidor (/api/auth-session e APIs protegidas): valida JWT + auth_user_id, ignora spoofing e falha fechado', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevViteUrl = process.env.VITE_SUPABASE_URL;
  const prevSrv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  setTestSupabaseAdminForSemaAudit(null);

  try {
    // 1. Sem configuração server-side -> 503 em todos os endpoints protegidos
    for (const [h, method] of [
      [authSessionHandler, 'GET'],
      [integracoesStatusHandler, 'GET'],
      [pendenciasHandler, 'GET'],
      [solicitacoesVistoriaHandler, 'GET'],
      [conciliacaoGravarHandler, 'POST']
    ] as const) {
      const res503 = createMockRes();
      await h(createMockReq({ method }) as any, res503 as any);
      assert.equal(res503.getStatus(), 503);
    }

    // 2. Com Supabase Admin mockado
    const viewerUid = '22222222-2222-4222-8222-222222222222';
    const noProfileUid = '33333333-3333-4333-8333-333333333333';
    const inactiveUid = '44444444-4444-4444-8444-444444444444';
    const invalidRoleUid = '55555555-5555-4555-8555-555555555555';

    const mockClient = createServerAuthSupabaseMock({
      tokenMap: {
        'tok-yara-admin': {
          id: YARA_AUTH_UID,
          email: 'yarageologa@gmail.com',
          user_metadata: { papel: 'Visualizador' }
        },
        'tok-viewer': {
          id: viewerUid,
          email: 'viewer@sema.mt.gov.br',
          user_metadata: { papel: 'Administrador' } // Spoofing no user_metadata
        },
        'tok-no-profile': {
          id: noProfileUid,
          email: 'semcadastro@sema.mt.gov.br'
        },
        'tok-inactive': {
          id: inactiveUid,
          email: 'inativo@sema.mt.gov.br'
        },
        'tok-invalid-role': {
          id: invalidRoleUid,
          email: 'roleinvalida@sema.mt.gov.br'
        }
      },
      usuariosRows: [
        {
          id: YARA_USUARIO_ID,
          auth_user_id: YARA_AUTH_UID,
          nome: 'Yara Dias',
          login: 'yarageologa',
          email: 'yarageologa@gmail.com',
          papel: 'Administrador',
          situacao: 'Ativo',
          status: 'Ativo'
        },
        {
          id: 'usr_viewer_01',
          auth_user_id: viewerUid,
          nome: 'Leitor SEMA',
          login: 'leitor',
          email: 'viewer@sema.mt.gov.br',
          papel: 'Visualizador',
          situacao: 'Ativo'
        },
        {
          id: 'usr_sem_auth_link',
          auth_user_id: null,
          nome: 'Sem Vinculo Auth',
          email: 'semcadastro@sema.mt.gov.br',
          papel: 'Administrador',
          situacao: 'Ativo'
        },
        {
          id: 'usr_inativo_01',
          auth_user_id: inactiveUid,
          nome: 'Servidor Inativo',
          email: 'inativo@sema.mt.gov.br',
          papel: 'Administrador',
          situacao: 'Inativo'
        },
        {
          id: 'usr_role_bad',
          auth_user_id: invalidRoleUid,
          nome: 'Papel Invalido',
          email: 'roleinvalida@sema.mt.gov.br',
          papel: 'RootInvalido',
          situacao: 'Ativo'
        }
      ]
    });
    setTestSupabaseAdminForSemaAudit(mockClient);

    // 2a. Sem token -> 401
    const resNoAuth = createMockRes();
    await authSessionHandler(createMockReq({ method: 'GET' }) as any, resNoAuth as any);
    assert.equal(resNoAuth.getStatus(), 401);

    // 2b. Token inválido -> 401
    const resBadJwt = createMockRes();
    await authSessionHandler(
      createMockReq({
        method: 'GET',
        headers: { authorization: 'Bearer jwt-forjado' }
      }) as any,
      resBadJwt as any
    );
    assert.equal(resBadJwt.getStatus(), 401);

    // 2c. Sem perfil vinculado por auth_user_id (mesmo com email igual no banco!) -> 403 PROFILE_MISSING
    const resNoProf = createMockRes();
    await authSessionHandler(
      createMockReq({
        method: 'GET',
        headers: { authorization: 'Bearer tok-no-profile' }
      }) as any,
      resNoProf as any
    );
    assert.equal(resNoProf.getStatus(), 403);
    assert.equal(resNoProf.getBody().code, 'PROFILE_MISSING');
    assert.equal(mockClient.emailQueries.length, 0);
    assert.equal(mockClient.updateCalls.length, 0);

    // 2d. Perfil Inativo -> 403 PROFILE_INACTIVE
    const resInact = createMockRes();
    await authSessionHandler(
      createMockReq({
        method: 'GET',
        headers: { authorization: 'Bearer tok-inactive' }
      }) as any,
      resInact as any
    );
    assert.equal(resInact.getStatus(), 403);
    assert.equal(resInact.getBody().code, 'PROFILE_INACTIVE');

    // 2e. Papel inválido -> 403 ROLE_INVALID
    const resBadRole = createMockRes();
    await authSessionHandler(
      createMockReq({
        method: 'GET',
        headers: { authorization: 'Bearer tok-invalid-role' }
      }) as any,
      resBadRole as any
    );
    assert.equal(resBadRole.getStatus(), 403);
    assert.equal(resBadRole.getBody().code, 'ROLE_INVALID');

    // 2f. Viewer tentando spoofing por headers -> papel continua estritamente Visualizador, sem e-mail exposto, e /api/integracoes-status bloqueia com 403
    const resViewerSession = createMockRes();
    await authSessionHandler(
      createMockReq({
        method: 'GET',
        headers: {
          authorization: 'Bearer tok-viewer',
          'x-user-role': 'Administrador',
          'x-role': 'Administrador',
          'x-auth-user-id': YARA_AUTH_UID
        }
      }) as any,
      resViewerSession as any
    );
    assert.equal(resViewerSession.getStatus(), 200);
    assert.equal(resViewerSession.getBody().profile.papel, 'Visualizador');
    assert.equal(resViewerSession.getBody().profile.id, 'usr_viewer_01');
    assert.equal('email' in resViewerSession.getBody().profile, false);

    const resIntegracoesViewer = createMockRes();
    await integracoesStatusHandler(
      createMockReq({
        method: 'GET',
        headers: { authorization: 'Bearer tok-viewer', 'x-user-role': 'Administrador' }
      }) as any,
      resIntegracoesViewer as any
    );
    assert.equal(resIntegracoesViewer.getStatus(), 403);

    // 2g. Yara Dias (Administrador) autenticada -> 200 com id usr_... preservado e authUserId separado
    const resAdminSession = createMockRes();
    await authSessionHandler(
      createMockReq({
        method: 'GET',
        headers: { authorization: 'Bearer tok-yara-admin' }
      }) as any,
      resAdminSession as any
    );
    assert.equal(resAdminSession.getStatus(), 200);
    assert.equal(resAdminSession.getBody().authenticated, true);
    assert.equal(resAdminSession.getBody().profile.id, YARA_USUARIO_ID);
    assert.equal(resAdminSession.getBody().profile.authUserId, YARA_AUTH_UID);
    assert.equal(resAdminSession.getBody().profile.papel, 'Administrador');
    assert.equal('email' in resAdminSession.getBody().profile, false);

    const resIntegracoesAdmin = createMockRes();
    await integracoesStatusHandler(
      createMockReq({
        method: 'GET',
        headers: { authorization: 'Bearer tok-yara-admin' }
      }) as any,
      resIntegracoesAdmin as any
    );
    assert.equal(resIntegracoesAdmin.getStatus(), 200);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
    if (prevViteUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteUrl;
    if (prevSrv !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevSrv;
  }
});

test('Segurança de código, UI e scripts SQL: sem bypass offline, sem autocadastro, sem segredos VITE_* e UID oficial da Yara', () => {
  const root = process.cwd();
  const appSrc = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const loginSrc = fs.readFileSync(path.join(root, 'src/components/LoginPage.tsx'), 'utf8');
  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const linkSql = fs.readFileSync(path.join(root, 'docs/sql/administra_auth_user_link.sql'), 'utf8');
  const rlsSql = fs.readFileSync(
    path.join(root, 'docs/sql/administra_admin_role_and_rls_review.sql'),
    'utf8'
  );

  // Nenhum bypass administrativo offline nem simulador de papel
  assert.equal(appSrc.includes('Simular papel localmente'), false);
  assert.equal(appSrc.includes("setUserRole('Administrador')"), false);
  assert.equal(appSrc.includes('hasValidAuthenticatedAccess'), true);

  // Sem autocadastro público aberto na página de login
  assert.equal(loginSrc.includes('Solicitar novo acesso'), false);
  assert.equal(loginSrc.includes('Cadastro público desativado'), true);

  // Nenhuma service_role ou segredo privado em src/ ou em variáveis VITE_*
  const walkSrc = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'server' || entry.name === '__tests__') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkSrc(full));
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  for (const file of walkSrc(path.join(root, 'src'))) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(
      /VITE_[A-Z0-9_]*SERVICE_ROLE|\bSUPABASE_SERVICE_ROLE_KEY\b/.test(content),
      false,
      `Referência indevida a service_role no frontend em ${file}`
    );
  }
  assert.equal(/VITE_[A-Z0-9_]*SERVICE_ROLE/i.test(envExample), false);

  // Scripts SQL de revisão usam exclusivamente o UID oficial e preservam public.usuarios.id
  assert.equal(linkSql.includes(YARA_AUTH_UID), true);
  assert.equal(linkSql.includes('yarageologa@gmail.com'), true);
  assert.equal(linkSql.includes('f26897f0-bb2f-4dc7-a444-ee4550c8d569'), false);
  assert.equal(rlsSql.includes(YARA_AUTH_UID), true);
  assert.equal(rlsSql.includes('REVOKE ALL ON TABLE public.usuarios FROM anon'), true);
});

test('Auth Config (/api/auth-config) e fallback de schema: suporta aliases públicos, bloqueia service_role e aceita tabela sem colunas opcionais', async () => {
  const makeJwtWithRole = (role: string) => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ role, iss: 'supabase' })).toString('base64url');
    return `${header}.${payload}.sig`;
  };

  const anonJwt = makeJwtWithRole('anon');
  const serviceJwt = makeJwtWithRole('service_role');

  // 1. Resolve SUPABASE_URL + SUPABASE_ANON_KEY sem prefixo VITE_
  const resolved = resolvePublicSupabaseConfigFromEnv({
    SUPABASE_URL: '"https://adm-baragem.supabase.co/"',
    SUPABASE_ANON_KEY: anonJwt,
    SUPABASE_SERVICE_ROLE_KEY: serviceJwt
  });
  assert.equal(resolved.configured, true);
  assert.equal(resolved.supabaseUrl, 'https://adm-baragem.supabase.co');
  assert.equal(resolved.supabaseAnonKey, anonJwt);

  // 2. Bloqueia qualquer chave service_role ou sb_secret_ colocada acidentalmente em ANON_KEY
  const blockedService = resolvePublicSupabaseConfigFromEnv({
    VITE_SUPABASE_URL: 'https://adm-baragem.supabase.co',
    VITE_SUPABASE_ANON_KEY: serviceJwt
  });
  assert.equal(blockedService.configured, false);
  assert.equal(blockedService.supabaseAnonKey, '');

  const blockedSecret = resolvePublicSupabaseConfigFromEnv({
    VITE_SUPABASE_URL: 'https://adm-baragem.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_secret_123456'
  });
  assert.equal(blockedSecret.configured, false);

  // 3. Handler HTTP retorna 200 sem cache e sem expor service_role
  const prevUrl = process.env.SUPABASE_URL;
  const prevAnon = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://adm-baragem.supabase.co';
  process.env.SUPABASE_ANON_KEY = anonJwt;
  try {
    const res = createMockRes();
    await authConfigHandler(createMockReq({ method: 'GET' }) as any, res as any);
    assert.equal(res.getStatus(), 200);
    assert.equal(res.getBody().configured, true);
    assert.equal(res.getBody().supabaseUrl, 'https://adm-baragem.supabase.co');
    assert.equal(res.getBody().supabaseAnonKey, anonJwt);
  } finally {
    if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
    else delete process.env.SUPABASE_URL;
    if (prevAnon !== undefined) process.env.SUPABASE_ANON_KEY = prevAnon;
    else delete process.env.SUPABASE_ANON_KEY;
  }

  // 4. Fallback para select('*') quando alguma coluna opcional não existe na tabela public.usuarios
  let selectCalls = 0;
  const schemaFallbackClient: any = {
    auth: {
      async signInWithPassword() {
        return {
          data: {
            user: { id: YARA_AUTH_UID, email: 'yarageologa@gmail.com' },
            session: { access_token: 'tok-yara', user: { id: YARA_AUTH_UID } }
          },
          error: null
        };
      },
      async signOut() {
        return { error: null };
      }
    },
    from() {
      return {
        select(cols: string) {
          selectCalls += 1;
          return {
            eq() {
              return {
                async maybeSingle() {
                  if (cols !== '*') {
                    return {
                      data: null,
                      error: { code: '42703', message: 'column usuarios.created_by does not exist' }
                    };
                  }
                  return {
                    data: {
                      id: YARA_USUARIO_ID,
                      auth_user_id: YARA_AUTH_UID,
                      nome: 'Yara Dias',
                      papel: 'Administrador',
                      situacao: '',
                      status: 'Ativo'
                    },
                    error: null
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  const svc = createAuthService(() => ({ client: schemaFallbackClient, configured: true }));
  const loginRes = await svc.loginWithPassword('yarageologa@gmail.com', 'senha-teste');
  assert.equal(loginRes.success, true);
  assert.equal(selectCalls, 2);
  assert.equal(loginRes.profile?.id, YARA_USUARIO_ID);
  assert.equal(loginRes.profile?.papel, 'Administrador');
  assert.equal(loginRes.profile?.situacao, 'Ativo');
});
