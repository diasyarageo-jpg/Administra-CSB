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
import carLookupHandler from '../api/car-lookup';
import semaDocumentosHandler from '../api/sema-documentos';
import { setTestSupabaseAdminForSemaAudit } from '../src/server/semaAudit';
import {
  createAuthService,
  validateInstitutionalProfile
} from '../src/services/authService';
import { handleAdminManageUserRequest } from '../supabase/functions/admin-manage-user/handler.ts';

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

test('Contenção /api/car-lookup e /api/sema-documentos: exige authCtx.configured === true (503) antes de corpo, banco e fetch externo, mantendo S2S bloqueada', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevViteUrl = process.env.VITE_SUPABASE_URL;
  const prevSrv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevS2sToken = process.env.SOLICITACOES_SERVICE_TOKEN;
  const originalFetch = globalThis.fetch;

  const trapReq = (opts: { method: string; url: string; headers?: Record<string, string> }) => {
    let streamReadStarted = false;
    const req: any = {
      method: opts.method,
      url: opts.url,
      headers: opts.headers || {},
      on() {
        streamReadStarted = true;
      }
    };
    Object.defineProperty(req, 'body', {
      configurable: true,
      get() {
        throw new Error('req.body NÃO deve ser acessado antes da validação');
      }
    });
    return { req, getStreamReadStarted: () => streamReadStarted };
  };

  let externalFetchCalls = 0;
  globalThis.fetch = (async () => {
    externalFetchCalls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    // 1. Variáveis ausentes ou parciais (URL sem SERVICE_ROLE, SERVICE_ROLE sem URL, ou ambas ausentes) -> 503 sem ler body nem chamar fetch
    const envCases: Array<Record<string, string | undefined>> = [
      { SUPABASE_URL: undefined, VITE_SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined },
      { SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined },
      { SUPABASE_URL: undefined, VITE_SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: 'synth-service-key' }
    ];

    for (const envCase of envCases) {
      for (const [k, v] of Object.entries(envCase)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      setTestSupabaseAdminForSemaAudit(null);

      for (const [handlerFn, endpoint] of [
        [carLookupHandler, '/api/car-lookup?lat=-15.6&lng=-56.1'],
        [semaDocumentosHandler, '/api/sema-documentos?car=MT-00001']
      ] as const) {
        for (const method of ['GET', 'POST'] as const) {
          const trapped = trapReq({
            method,
            url: endpoint,
            headers: {
              authorization: 'Bearer synthetic-jwt',
              'content-length': '256'
            }
          });
          const res = createMockRes();
          await handlerFn(trapped.req, res);
          assert.equal(res.getStatus(), 503);
          assert.ok(res.getBody()?.error);
          assert.equal(trapped.getStreamReadStarted(), false);
        }
      }
    }
    assert.equal(externalFetchCalls, 0);

    // 2. Com servidor configurado: rejeita 401 sem token e preserva S2S bloqueada
    const synthUid = '00000000-0000-4000-8000-000000000021';
    const configuredMock: any = {
      auth: {
        async getUser(jwt: string) {
          if (jwt !== 'synth-valid-jwt') {
            return { data: { user: null }, error: { message: 'Invalid JWT' } };
          }
          return { data: { user: { id: synthUid } }, error: null };
        }
      },
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    if (table !== 'usuarios') return { data: null, error: null };
                    return {
                      data: {
                        id: 'usr_synth_21',
                        auth_user_id: synthUid,
                        papel: 'Usuário',
                        situacao: 'Ativo',
                        status: 'Ativo',
                        login: 'usuario.contencao'
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
    setTestSupabaseAdminForSemaAudit(configuredMock);

    for (const [handlerFn, endpoint] of [
      [carLookupHandler, '/api/car-lookup?lat=-15.6&lng=-56.1'],
      [semaDocumentosHandler, '/api/sema-documentos?car=MT-00001']
    ] as const) {
      const trapped = trapReq({ method: 'POST', url: endpoint });
      const res401 = createMockRes();
      await handlerFn(trapped.req, res401);
      assert.equal(res401.getStatus(), 401);
      assert.equal(trapped.getStreamReadStarted(), false);
    }
    assert.equal(externalFetchCalls, 0);

    // Rota S2S permanece bloqueada sem segredo válido mesmo com JWT autenticado
    delete process.env.SOLICITACOES_SERVICE_TOKEN;
    const resS2sToken = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'GET',
        url: '/api/solicitacoesVistoria',
        headers: {
          authorization: 'Bearer synth-valid-jwt',
          'x-solicitacoes-service-token': 'invalid-service-token',
          'x-sistema-origem': 'classifica'
        }
      }) as any,
      resS2sToken as any
    );
    assert.equal(resS2sToken.getStatus(), 401);

    process.env.SOLICITACOES_SERVICE_TOKEN = 'synth-configured-s2s-secret';
    const resS2sMissingHeader = createMockRes();
    await solicitacoesVistoriaHandler(
      createMockReq({
        method: 'GET',
        url: '/api/solicitacoesVistoria',
        headers: {
          authorization: 'Bearer synth-valid-jwt',
          'x-sistema-origem': 'classifica'
        }
      }) as any,
      resS2sMissingHeader as any
    );
    assert.equal(resS2sMissingHeader.getStatus(), 403);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    globalThis.fetch = originalFetch;
    if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
    else delete process.env.SUPABASE_URL;
    if (prevViteUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteUrl;
    else delete process.env.VITE_SUPABASE_URL;
    if (prevSrv !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevSrv;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (prevS2sToken !== undefined) process.env.SOLICITACOES_SERVICE_TOKEN = prevS2sToken;
    else delete process.env.SOLICITACOES_SERVICE_TOKEN;
  }
});

test('Contenção Edge Function admin-manage-user: bloqueia request-access com 409 uniforme sem ler/gravar public.usuarios e preserva ações administrativas', async () => {
  const synthAdminUid = '00000000-0000-4000-8000-000000000031';
  const synthViewerUid = '00000000-0000-4000-8000-000000000032';
  const synthApprovedAuthUid = '00000000-0000-4000-8000-000000000033';

  let envGetCalls = 0;
  let createClientCalls = 0;
  let dbCalls = 0;
  const updatePayloads: Record<string, any>[] = [];
  const insertPayloads: Record<string, any>[] = [];

  const createTrackingDeps = (envPresent: boolean) => ({
    envGet(name: string) {
      envGetCalls += 1;
      if (!envPresent) return undefined;
      if (name === 'SUPABASE_URL') return 'https://example.invalid';
      if (name === 'SUPABASE_SERVICE_ROLE_KEY') return 'synth-service-role';
      return undefined;
    },
    createSupabaseClient() {
      createClientCalls += 1;
      return {
        auth: {
          async getUser(jwt: string) {
            if (jwt === 'synth-admin-jwt') {
              return { data: { user: { id: synthAdminUid } }, error: null };
            }
            if (jwt === 'synth-viewer-jwt') {
              return { data: { user: { id: synthViewerUid } }, error: null };
            }
            return { data: { user: null }, error: { message: 'Invalid JWT' } };
          },
          admin: {
            async listUsers() {
              return {
                data: { users: [{ id: synthApprovedAuthUid, email: 'alvo.synth@example.invalid', user_metadata: {} }] },
                error: null
              };
            },
            async updateUserById(id: string) {
              assert.equal(id, synthApprovedAuthUid);
              return { error: null };
            },
            async inviteUserByEmail() {
              return { data: { user: { id: synthApprovedAuthUid } }, error: null };
            },
            async createUser() {
              return { data: { user: { id: synthApprovedAuthUid } }, error: null };
            }
          }
        },
        from(table: string) {
          dbCalls += 1;
          assert.equal(table, 'usuarios');
          return {
            select() {
              const chain: any = {
                eq(col: string, val: string) {
                  chain._filters = { ...(chain._filters || {}), [col]: val };
                  return chain;
                },
                async maybeSingle() {
                  const uid = chain._filters?.auth_user_id;
                  if (uid === synthAdminUid) {
                    return { data: { id: 'usr_admin_synth', papel: 'Administrador', situacao: 'Ativo' }, error: null };
                  }
                  if (uid === synthViewerUid) {
                    return { data: { id: 'usr_viewer_synth', papel: 'Visualizador', situacao: 'Ativo' }, error: null };
                  }
                  return { data: null, error: null };
                },
                async single() {
                  return {
                    data: {
                      id: chain._filters?.id || 'usr_target_synth',
                      nome: 'Pessoa Sintética',
                      matricula: '00001',
                      email: 'alvo.synth@example.invalid',
                      observacoes: ''
                    },
                    error: null
                  };
                }
              };
              return chain;
            },
            update(updPayload: any) {
              updatePayloads.push(updPayload);
              return {
                eq(col: string, val: string) {
                  return {
                    select() {
                      return {
                        async single() {
                          return { data: { id: val, [col]: val, ...updPayload }, error: null };
                        }
                      };
                    }
                  };
                }
              };
            },
            insert(insPayload: any) {
              insertPayloads.push(insPayload);
              return {
                select() {
                  return {
                    async single() {
                      return { data: insPayload, error: null };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  });

  // 1. OPTIONS preservado
  const optRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', { method: 'OPTIONS' }),
    createTrackingDeps(false)
  );
  assert.equal(optRes.status, 200);

  // 2. request-access bloqueado uniformemente com 409 (com e sem env vars, com/sem payload, ação omitida ou variantes)
  const expectedBodies: string[] = [];
  for (const envPresent of [false, true]) {
    for (const bodyPayload of [
      JSON.stringify({
        action: 'request-access',
        nome: 'Pessoa Sintética',
        matricula: '00001',
        email: 'synth@example.invalid'
      }),
      JSON.stringify({ action: ' REQUEST-ACCESS ' }),
      JSON.stringify({ action: '' }),
      JSON.stringify({}),
      'corrupted-json'
    ]) {
      const res = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyPayload
        }),
        createTrackingDeps(envPresent)
      );
      assert.equal(res.status, 409);
      const parsed = await res.json();
      assert.equal(parsed.success, false);
      assert.ok(parsed.error);
      expectedBodies.push(JSON.stringify(parsed));
    }
  }
  assert.equal(new Set(expectedBodies).size, 1);
  assert.equal(envGetCalls, 0);
  assert.equal(createClientCalls, 0);
  assert.equal(dbCalls, 0);

  // 3. Ações administrativas continuam exigindo env (500), JWT (401), papel Administrador ativo (403) e funcionando (200)
  const missingEnvRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve-user', usuarioId: 'usr_target_synth', papel: 'Usuário' })
    }),
    createTrackingDeps(false)
  );
  assert.equal(missingEnvRes.status, 500);
  assert.equal(dbCalls, 0);

  const noAuthRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve-user', usuarioId: 'usr_target_synth', papel: 'Usuário' })
    }),
    createTrackingDeps(true)
  );
  assert.equal(noAuthRes.status, 401);
  assert.equal(dbCalls, 0);

  const nonAdminRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer synth-viewer-jwt'
      },
      body: JSON.stringify({ action: 'approve-user', usuarioId: 'usr_target_synth', papel: 'Usuário' })
    }),
    createTrackingDeps(true)
  );
  assert.equal(nonAdminRes.status, 403);

  const approveOkRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer synth-admin-jwt'
      },
      body: JSON.stringify({ action: 'approve-user', usuarioId: 'usr_target_synth', papel: 'Usuário' })
    }),
    createTrackingDeps(true)
  );
  assert.equal(approveOkRes.status, 200);
  const approveJson = await approveOkRes.json();
  assert.equal(approveJson.success, true);

  const approveAnalistaRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer synth-admin-jwt'
      },
      body: JSON.stringify({ action: 'approve-user', usuarioId: 'usr_target_synth', papel: 'Analista' })
    }),
    createTrackingDeps(true)
  );
  assert.equal(approveAnalistaRes.status, 200);
  const approveAnalistaJson = await approveAnalistaRes.json();
  assert.equal(approveAnalistaJson.success, true);
  assert.equal(approveAnalistaJson.usuarioRecord?.papel, 'Analista');

  const approveInvalidRoleRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer synth-admin-jwt'
      },
      body: JSON.stringify({ action: 'approve-user', usuarioId: 'usr_target_synth', papel: 'PapelInexistente' })
    }),
    createTrackingDeps(true)
  );
  assert.equal(approveInvalidRoleRes.status, 400);

  const rejectOkRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer synth-admin-jwt'
      },
      body: JSON.stringify({ action: 'reject-user', usuarioId: 'usr_target_synth', motivo: 'Teste sintético' })
    }),
    createTrackingDeps(true)
  );
  assert.equal(rejectOkRes.status, 200);
  const rejectJson = await rejectOkRes.json();
  assert.equal(rejectJson.success, true);

  assert.equal(updatePayloads.length, 3);
  for (const updPayload of updatePayloads) {
    assert.equal(Object.prototype.hasOwnProperty.call(updPayload, 'senha_provisoria_enc'), false);
  }

  const createOkRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer synth-admin-jwt'
      },
      body: JSON.stringify({
        action: 'create-user',
        nome: 'Novo Usuário Sintético',
        email: 'novo.synth@example.invalid',
        papel: 'Usuário'
      })
    }),
    createTrackingDeps(true)
  );
  assert.equal(createOkRes.status, 200);
  const createJson = await createOkRes.json();
  assert.equal(createJson.success, true);

  const createAnalistaRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer synth-admin-jwt'
      },
      body: JSON.stringify({
        action: 'create-user',
        nome: 'Analista Sintético',
        email: 'analista.synth@example.invalid',
        papel: 'Analista'
      })
    }),
    createTrackingDeps(true)
  );
  assert.equal(createAnalistaRes.status, 200);
  const createAnalistaJson = await createAnalistaRes.json();
  assert.equal(createAnalistaJson.success, true);
  assert.equal(createAnalistaJson.usuarioRecord?.papel, 'Analista');
  assert.equal(insertPayloads.at(-1)?.papel, 'Analista');
});

test('Edge Function admin-manage-user: revisão e aprovação segura de public.admin_solicitacoes_acesso com idempotência e proteção contra falhas parciais', async () => {
  const synthAdminUid = '00000000-0000-4000-8000-000000000041';
  const synthUserRoleUid = '00000000-0000-4000-8000-000000000042';
  const synthInactiveAdminUid = '00000000-0000-4000-8000-000000000043';

  const createScenarioState = () => {
    const authUsers: Array<{ id: string; email: string; user_metadata: Record<string, any> }> = [];
    const usuarios: Array<Record<string, any>> = [
      {
        id: 'usr_admin_41',
        auth_user_id: synthAdminUid,
        nome: 'Admin Sintético',
        matricula: 'ADM-001',
        email: 'admin.synth@example.invalid',
        papel: 'Administrador',
        situacao: 'Ativo',
        status: 'Ativo'
      },
      {
        id: 'usr_operacional_42',
        auth_user_id: synthUserRoleUid,
        nome: 'Operacional Sintético',
        matricula: 'USR-002',
        email: 'operacional.synth@example.invalid',
        papel: 'Usuário',
        situacao: 'Ativo',
        status: 'Ativo'
      },
      {
        id: 'usr_admin_inativo_43',
        auth_user_id: synthInactiveAdminUid,
        nome: 'Admin Inativo Sintético',
        matricula: 'ADM-003',
        email: 'admin.inativo.synth@example.invalid',
        papel: 'Administrador',
        situacao: 'Inativo',
        status: 'Inativo'
      },
      {
        id: 'usr_canonico_01',
        auth_user_id: null,
        nome: 'Servidor Canônico Um',
        matricula: 'MAT-1001',
        email: 'servidor.um@example.invalid',
        papel: 'Visualizador',
        situacao: 'Pendente',
        status: 'Inativo'
      },
      {
        id: 'usr_canonico_02',
        auth_user_id: null,
        nome: 'Servidor Canônico Dois',
        matricula: 'MAT-2002',
        email: 'servidor.dois@example.invalid',
        papel: 'Visualizador',
        situacao: 'Pendente',
        status: 'Inativo'
      }
    ];

    const solicitacoes: Array<Record<string, any>> = [
      {
        id: 'sol_pend_01',
        nome: 'Nome Informado Na Solicitacao',
        matricula: 'mat-1001',
        email: 'SERVIDOR.UM@example.invalid',
        status: 'pendente',
        observacoes_admin: null,
        revisado_por: null,
        revisado_em: null,
        criado_em: '2026-11-23T10:00:00.000Z',
        atualizado_em: '2026-11-23T10:00:00.000Z',
        ip_origem: '198.51.100.10',
        user_agent: 'Agente-Interno-Secreto',
        token_hash: 'hash-interno-nao-expor'
      },
      {
        id: 'sol_div_02',
        nome: 'Servidor Divergente',
        matricula: 'MAT-9999',
        email: 'servidor.dois@example.invalid',
        status: 'pendente',
        observacoes_admin: null,
        revisado_por: null,
        revisado_em: null,
        criado_em: '2026-11-23T09:00:00.000Z',
        atualizado_em: '2026-11-23T09:00:00.000Z'
      },
      {
        id: 'sol_fin_03',
        nome: 'Solicitação Já Aprovada',
        matricula: 'MAT-3003',
        email: 'finalizada@example.invalid',
        status: 'aprovada',
        observacoes_admin: 'Concluída',
        revisado_por: synthAdminUid,
        revisado_em: '2026-11-22T12:00:00.000Z',
        criado_em: '2026-11-22T10:00:00.000Z',
        atualizado_em: '2026-11-22T12:00:00.000Z'
      }
    ];

    const stats = {
      envGetCalls: 0,
      createClientCalls: 0,
      dbCalls: 0,
      usuariosInsertCalls: 0,
      authInviteCalls: 0,
      authCreateCalls: 0,
      authUpdateCalls: 0,
      lastSolicitacaoLimit: null as number | null,
      failAuthInvite: false,
      failAuthCreate: false,
      failUsuarioUpdateOnce: false,
      failSolicitacaoUpdateOnce: false
    };

    const deps = (envPresent = true) => ({
      envGet(name: string) {
        stats.envGetCalls += 1;
        if (!envPresent) return undefined;
        if (name === 'SUPABASE_URL') return 'https://example.invalid';
        if (name === 'SUPABASE_SERVICE_ROLE_KEY') return 'synth-super-secret-service-role-key';
        return undefined;
      },
      createSupabaseClient() {
        stats.createClientCalls += 1;
        return {
          auth: {
            async getUser(jwt: string) {
              if (jwt === 'synth-admin-jwt') return { data: { user: { id: synthAdminUid } }, error: null };
              if (jwt === 'synth-user-jwt') return { data: { user: { id: synthUserRoleUid } }, error: null };
              if (jwt === 'synth-inactive-admin-jwt') {
                return { data: { user: { id: synthInactiveAdminUid } }, error: null };
              }
              return { data: { user: null }, error: { message: 'Invalid JWT' } };
            },
            admin: {
              async listUsers() {
                return { data: { users: authUsers.map(u => ({ ...u })) }, error: null };
              },
              async updateUserById(id: string, patch: any) {
                stats.authUpdateCalls += 1;
                const found = authUsers.find(u => u.id === id);
                if (!found) return { error: { message: 'Auth user not found' } };
                found.user_metadata = { ...found.user_metadata, ...(patch.user_metadata || {}) };
                return { error: null };
              },
              async inviteUserByEmail(email: string, opts: any) {
                stats.authInviteCalls += 1;
                if (stats.failAuthInvite) {
                  return { data: null, error: { message: 'SMTP unavailable' } };
                }
                const created = {
                  id: `auth_${authUsers.length + 1}`,
                  email,
                  user_metadata: opts?.data || {}
                };
                authUsers.push(created);
                return { data: { user: created }, error: null };
              },
              async createUser(opts: any) {
                stats.authCreateCalls += 1;
                if (stats.failAuthCreate) {
                  return { data: { user: null }, error: { message: 'Auth create failure' } };
                }
                const created = {
                  id: `auth_${authUsers.length + 1}`,
                  email: opts.email,
                  user_metadata: opts.user_metadata || {}
                };
                authUsers.push(created);
                return { data: { user: created }, error: null };
              }
            }
          },
          from(table: string) {
            stats.dbCalls += 1;
            const tableRows = table === 'usuarios' ? usuarios : solicitacoes;
            const matchRows = (filters: Record<string, any>, inFilters: Record<string, any[]>) =>
              tableRows.filter(row => {
                for (const [k, v] of Object.entries(filters)) {
                  if (row[k] !== v) return false;
                }
                for (const [k, allowed] of Object.entries(inFilters)) {
                  if (!allowed.includes(row[k])) return false;
                }
                return true;
              });

            return {
              select() {
                const filters: Record<string, any> = {};
                const inFilters: Record<string, any[]> = {};
                let limitVal: number | null = null;
                let orderCol: string | null = null;
                let orderAsc = true;

                const runQuery = () => {
                  let res = matchRows(filters, inFilters).map(r => ({ ...r }));
                  if (orderCol) {
                    res.sort((a, b) => {
                      const va = String(a[orderCol!] || '');
                      const vb = String(b[orderCol!] || '');
                      return orderAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                    });
                  }
                  if (limitVal !== null) {
                    if (table === 'admin_solicitacoes_acesso') {
                      stats.lastSolicitacaoLimit = limitVal;
                    }
                    res = res.slice(0, limitVal);
                  }
                  return res;
                };

                const chain: any = {
                  eq(col: string, val: any) {
                    filters[col] = val;
                    return chain;
                  },
                  in(col: string, vals: any[]) {
                    inFilters[col] = vals;
                    return chain;
                  },
                  order(col: string, opts?: { ascending?: boolean }) {
                    orderCol = col;
                    orderAsc = opts?.ascending !== false;
                    return chain;
                  },
                  limit(n: number) {
                    limitVal = n;
                    return chain;
                  },
                  then(resolve: (val: any) => void) {
                    resolve({ data: runQuery(), error: null });
                  },
                  async maybeSingle() {
                    const rows = runQuery();
                    return { data: rows[0] ?? null, error: null };
                  },
                  async single() {
                    const rows = runQuery();
                    if (!rows[0]) return { data: null, error: { message: 'Not found' } };
                    return { data: rows[0], error: null };
                  }
                };
                return chain;
              },
              update(updPayload: Record<string, any>) {
                const filters: Record<string, any> = {};
                const inFilters: Record<string, any[]> = {};
                const chain: any = {
                  eq(col: string, val: any) {
                    filters[col] = val;
                    return chain;
                  },
                  in(col: string, vals: any[]) {
                    inFilters[col] = vals;
                    return chain;
                  },
                  select() {
                    return {
                      async maybeSingle() {
                        if (table === 'usuarios' && stats.failUsuarioUpdateOnce) {
                          stats.failUsuarioUpdateOnce = false;
                          return { data: null, error: { message: 'Simulated DB error updating usuarios' } };
                        }
                        if (table === 'admin_solicitacoes_acesso' && stats.failSolicitacaoUpdateOnce) {
                          stats.failSolicitacaoUpdateOnce = false;
                          return { data: null, error: { message: 'Simulated DB error updating solicitacao' } };
                        }
                        const matched = matchRows(filters, inFilters);
                        if (!matched[0]) return { data: null, error: null };
                        Object.assign(matched[0], updPayload);
                        return { data: { ...matched[0] }, error: null };
                      },
                      async single() {
                        if (table === 'usuarios' && stats.failUsuarioUpdateOnce) {
                          stats.failUsuarioUpdateOnce = false;
                          return { data: null, error: { message: 'Simulated DB error updating usuarios' } };
                        }
                        if (table === 'admin_solicitacoes_acesso' && stats.failSolicitacaoUpdateOnce) {
                          stats.failSolicitacaoUpdateOnce = false;
                          return { data: null, error: { message: 'Simulated DB error updating solicitacao' } };
                        }
                        const matched = matchRows(filters, inFilters);
                        if (!matched[0]) return { data: null, error: { message: 'Not found' } };
                        Object.assign(matched[0], updPayload);
                        return { data: { ...matched[0] }, error: null };
                      }
                    };
                  }
                };
                return chain;
              },
              insert() {
                if (table === 'usuarios') stats.usuariosInsertCalls += 1;
                return {
                  select() {
                    return {
                      async single() {
                        return { data: null, error: { message: 'Unexpected insert' } };
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
    });

    return { authUsers, usuarios, solicitacoes, stats, deps };
  };

  // 1. request-access continua retornando 409 sem consultar env, client ou banco
  {
    const s = createScenarioState();
    const res409 = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request-access',
          nome: 'Solicitante Sintético',
          matricula: 'MAT-1001',
          email: 'servidor.um@example.invalid'
        })
      }),
      s.deps(false)
    );
    assert.equal(res409.status, 409);
    assert.equal(s.stats.envGetCalls, 0);
    assert.equal(s.stats.createClientCalls, 0);
    assert.equal(s.stats.dbCalls, 0);
  }

  // 2. Novas ações negam falta de sessão (401), usuário não-administrador (403) e administrador inativo (403)
  {
    const s = createScenarioState();
    for (const actionBody of [
      { action: 'list-access-requests' },
      { action: 'review-access-request', solicitacaoId: 'sol_pend_01', status: 'recusada', observacoesAdmin: 'Teste' },
      { action: 'approve-access-request', solicitacaoId: 'sol_pend_01', usuarioId: 'usr_canonico_01' }
    ]) {
      const resNoAuth = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(actionBody)
        }),
        s.deps(true)
      );
      assert.equal(resNoAuth.status, 401);

      for (const nonAdminJwt of ['synth-user-jwt', 'synth-inactive-admin-jwt']) {
        const resForbidden = await handleAdminManageUserRequest(
          new Request('https://example.invalid/admin-manage-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${nonAdminJwt}`
            },
            body: JSON.stringify(actionBody)
          }),
          s.deps(true)
        );
        assert.equal(resForbidden.status, 403);
      }
    }
    assert.equal(s.solicitacoes[0].status, 'pendente');
    assert.equal(s.usuarios.find(u => u.id === 'usr_canonico_01')?.situacao, 'Pendente');
  }

  // 3. list-access-requests: filtro por status, limite seguro e projeção sem vazar campos internos
  {
    const s = createScenarioState();
    const badStatusRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({ action: 'list-access-requests', status: 'status_inexistente' })
      }),
      s.deps(true)
    );
    assert.equal(badStatusRes.status, 400);

    const listRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({ action: 'list-access-requests', status: 'pendente', limit: 9999 })
      }),
      s.deps(true)
    );
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson.success, true);
    assert.equal(listJson.limit, 100);
    assert.equal(s.stats.lastSolicitacaoLimit, 100);
    assert.equal(listJson.solicitacoes.length, 2);
    assert.equal('ip_origem' in listJson.solicitacoes[0], false);
    assert.equal('user_agent' in listJson.solicitacoes[0], false);
    assert.equal('token_hash' in listJson.solicitacoes[0], false);
    assert.deepEqual(Object.keys(listJson.solicitacoes[0]).sort(), [
      'atualizado_em',
      'criado_em',
      'email',
      'id',
      'matricula',
      'nome',
      'observacoes_admin',
      'revisado_em',
      'revisado_por',
      'status'
    ]);
  }

  // 4. review-access-request: validações e bloqueio de solicitação já finalizada
  {
    const s = createScenarioState();
    const invalidIdRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({ action: 'review-access-request', solicitacaoId: 'bad id!@#', status: 'recusada' })
      }),
      s.deps(true)
    );
    assert.equal(invalidIdRes.status, 400);

    const invalidStatusRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({ action: 'review-access-request', solicitacaoId: 'sol_pend_01', status: 'aprovada' })
      }),
      s.deps(true)
    );
    assert.equal(invalidStatusRes.status, 400);

    const oversizedObsRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'review-access-request',
          solicitacaoId: 'sol_pend_01',
          status: 'aguardando_correcao',
          observacoesAdmin: 'A'.repeat(1001)
        })
      }),
      s.deps(true)
    );
    assert.equal(oversizedObsRes.status, 400);

    const finalizedRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'review-access-request',
          solicitacaoId: 'sol_fin_03',
          status: 'recusada',
          observacoesAdmin: 'Tentativa tardia'
        })
      }),
      s.deps(true)
    );
    assert.equal(finalizedRes.status, 409);

    const correcaoRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'review-access-request',
          solicitacaoId: 'sol_pend_01',
          status: 'aguardando_correcao',
          observacoesAdmin: 'Confirmar matrícula funcional'
        })
      }),
      s.deps(true)
    );
    assert.equal(correcaoRes.status, 200);
    const correcaoJson = await correcaoRes.json();
    assert.equal(correcaoJson.solicitacao.status, 'aguardando_correcao');
    assert.equal(correcaoJson.solicitacao.revisado_por, synthAdminUid);
    assert.ok(correcaoJson.solicitacao.revisado_em);
    assert.equal(correcaoJson.solicitacao.observacoes_admin, 'Confirmar matrícula funcional');
    assert.ok(correcaoJson.solicitacao.atualizado_em);

    const recusarRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'review-access-request',
          solicitacaoId: 'sol_pend_01',
          status: 'recusada',
          observacoesAdmin: 'Vínculo não confirmado'
        })
      }),
      s.deps(true)
    );
    assert.equal(recusarRes.status, 200);

    // Após recusada (finalizada), nova revisão é bloqueada
    const afterRecusaRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'review-access-request',
          solicitacaoId: 'sol_pend_01',
          status: 'aguardando_correcao',
          observacoesAdmin: 'Reabrir'
        })
      }),
      s.deps(true)
    );
    assert.equal(afterRecusaRes.status, 409);
  }

  // 5. approve-access-request: exige cadastro existente, valida e-mail/matrícula, atribui somente papel Usuário e trata falhas parciais de forma idempotente
  {
    const s = createScenarioState();

    // Sem usuarioId -> 400
    const missingUserRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({ action: 'approve-access-request', solicitacaoId: 'sol_pend_01' })
      }),
      s.deps(true)
    );
    assert.equal(missingUserRes.status, 400);

    // usuarioId inexistente -> 404 e nunca cria cadastro novo em public.usuarios
    const nonExistentUserRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'approve-access-request',
          solicitacaoId: 'sol_pend_01',
          usuarioId: 'usr_inexistente'
        })
      }),
      s.deps(true)
    );
    assert.equal(nonExistentUserRes.status, 404);
    assert.equal(s.stats.usuariosInsertCalls, 0);

    // Divergência de matrícula -> 409 orientando aguardando_correcao, sem tocar Auth ou usuarios
    const mismatchRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'approve-access-request',
          solicitacaoId: 'sol_div_02',
          usuarioId: 'usr_canonico_02'
        })
      }),
      s.deps(true)
    );
    assert.equal(mismatchRes.status, 409);
    const mismatchJson = await mismatchRes.json();
    assert.match(mismatchJson.error, /aguardando_correcao/);
    assert.equal(s.stats.authInviteCalls, 0);
    assert.equal(s.usuarios.find(u => u.id === 'usr_canonico_02')?.situacao, 'Pendente');
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_div_02')?.status, 'pendente');

    // Falha parcial 1: Auth falha -> 500, cadastro permanece Pendente e solicitação permanece pendente
    s.stats.failAuthInvite = true;
    s.stats.failAuthCreate = true;
    const authFailRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'approve-access-request',
          solicitacaoId: 'sol_pend_01',
          usuarioId: 'usr_canonico_01',
          papel: 'Administrador'
        })
      }),
      s.deps(true)
    );
    assert.equal(authFailRes.status, 500);
    const authFailBody = await authFailRes.text();
    assert.equal(authFailBody.includes('synth-super-secret-service-role-key'), false);
    assert.equal(s.usuarios.find(u => u.id === 'usr_canonico_01')?.situacao, 'Pendente');
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.status, 'pendente');

    // Falha parcial 2: Auth cria conta, mas update em public.usuarios falha -> solicitação NÃO é aprovada
    s.stats.failAuthInvite = false;
    s.stats.failAuthCreate = false;
    s.stats.failUsuarioUpdateOnce = true;
    const userUpdFailRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'approve-access-request',
          solicitacaoId: 'sol_pend_01',
          usuarioId: 'usr_canonico_01'
        })
      }),
      s.deps(true)
    );
    assert.equal(userUpdFailRes.status, 500);
    assert.equal(s.authUsers.length, 1);
    assert.equal(s.usuarios.find(u => u.id === 'usr_canonico_01')?.situacao, 'Pendente');
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.status, 'pendente');

    // Falha parcial 3: Retry ativa public.usuarios, mas update em admin_solicitacoes_acesso falha -> NÃO cria 2ª conta Auth e solicitação ainda não fica aprovada
    s.stats.failSolicitacaoUpdateOnce = true;
    const solicUpdFailRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'approve-access-request',
          solicitacaoId: 'sol_pend_01',
          usuarioId: 'usr_canonico_01',
          papel: 'Administrador'
        })
      }),
      s.deps(true)
    );
    assert.equal(solicUpdFailRes.status, 500);
    assert.equal(s.authUsers.length, 1);
    assert.equal(s.usuarios.find(u => u.id === 'usr_canonico_01')?.situacao, 'Ativo');
    assert.equal(s.usuarios.find(u => u.id === 'usr_canonico_01')?.papel, 'Usuário');
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.status, 'pendente');

    // Retry final após falha parcial conclui com sucesso, usando dados canônicos e papel Usuário (nunca Administrador)
    const approveOkRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'approve-access-request',
          solicitacaoId: 'sol_pend_01',
          usuarioId: 'usr_canonico_01',
          papel: 'Administrador',
          observacoesAdmin: 'Aprovado após conferência cadastral'
        })
      }),
      s.deps(true)
    );
    assert.equal(approveOkRes.status, 200);
    const approveJson = await approveOkRes.json();
    assert.equal(approveJson.success, true);
    assert.equal(s.authUsers.length, 1);
    assert.equal(s.authUsers[0].email, 'servidor.um@example.invalid');
    assert.equal(s.authUsers[0].user_metadata.nome, 'Servidor Canônico Um');
    assert.equal(s.authUsers[0].user_metadata.matricula, 'MAT-1001');
    assert.equal(s.authUsers[0].user_metadata.papel, 'Usuário');
    assert.equal(approveJson.usuarioRecord.papel, 'Usuário');
    assert.equal(approveJson.usuarioRecord.situacao, 'Ativo');
    assert.equal(approveJson.solicitacao.status, 'aprovada');
    assert.equal(approveJson.solicitacao.revisado_por, synthAdminUid);
    assert.equal(approveJson.solicitacao.observacoes_admin, 'Aprovado após conferência cadastral');
    assert.equal(s.stats.usuariosInsertCalls, 0);

    // Repetição após aprovação (mesmo tentando apontar outro cadastro) é bloqueada com 409 sem criar conta ou ativar outro cadastro
    const replayRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'approve-access-request',
          solicitacaoId: 'sol_pend_01',
          usuarioId: 'usr_canonico_02'
        })
      }),
      s.deps(true)
    );
    assert.equal(replayRes.status, 409);
    assert.equal(s.authUsers.length, 1);
    assert.equal(s.usuarios.find(u => u.id === 'usr_canonico_02')?.situacao, 'Pendente');
    assert.equal(s.stats.usuariosInsertCalls, 0);
  }
});

