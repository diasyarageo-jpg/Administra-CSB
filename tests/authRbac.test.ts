// tests/authRbac.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
  clearAuthHashFromUrl,
  createAuthService,
  hasRecoveryTokenInHash,
  MIN_PASSWORD_LENGTH,
  validateInstitutionalProfile
} from '../src/services/authService';
import {
  ForcePasswordChangePage,
  validateForcePasswordChangeInput
} from '../src/components/ForcePasswordChangePage';
import {
  ChangeOwnPasswordModal,
  DEFAULT_RESET_CONFIRMATION_MESSAGE,
  validateChangeOwnPasswordInput
} from '../src/components/ChangeOwnPasswordModal';
import { UserProfileMenu } from '../src/components/UserProfileMenu';
import { resolveAuthorizedAppView } from '../src/utils/appRoutes';
import {
  buildDefaultOwnResetPassword,
  handleAdminManageUserRequest,
  MIN_PASSWORD_LENGTH as HANDLER_MIN_PASSWORD_LENGTH
} from '../supabase/functions/admin-manage-user/handler.ts';

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
      if (name === 'DEFAULT_TEMP_PASSWORD') return 'Synth#Temp!Pass123';
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
  assert.equal(insertPayloads.at(-1)?.force_password_change, true);
});

test('Edge Function admin-manage-user: revisão e aprovação segura de public.admin_solicitacoes_acesso com FK, usuario_id, validação de auth_user_id, falhas parciais e concorrência', async () => {
  const synthAdminUid = '00000000-0000-4000-8000-000000000041';
  const synthUserRoleUid = '00000000-0000-4000-8000-000000000042';
  const synthInactiveAdminUid = '00000000-0000-4000-8000-000000000043';
  const synthPrelinkedValidAuthUid = '00000000-0000-4000-8000-000000000044';
  const synthPrelinkedMismatchAuthUid = '00000000-0000-4000-8000-000000000045';
  const synthPrelinkedSharedAuthUid = '00000000-0000-4000-8000-000000000046';

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
        id: 'usr_canonico_01_dup',
        auth_user_id: null,
        nome: 'Servidor Canônico Um Duplicado',
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
        usuario_id: null,
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
        usuario_id: null,
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
        usuario_id: 'usr_operacional_42',
        status: 'aprovada',
        observacoes_admin: 'Concluída',
        revisado_por: 'usr_admin_41',
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
      failSolicitacaoApproveUpdateOnce: false,
      failSolicitacaoRollbackOnce: false
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
              async getUserById(id: string) {
                const found = authUsers.find(u => u.id === id);
                if (!found) {
                  return { data: { user: null }, error: { status: 404, message: 'User not found' } };
                }
                return { data: { user: { ...found } }, error: null };
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
            const matchRows = (
              filters: Record<string, any>,
              inFilters: Record<string, any[]>,
              isFilters: Record<string, any>
            ) =>
              tableRows.filter(row => {
                for (const [k, v] of Object.entries(filters)) {
                  if (row[k] !== v) return false;
                }
                for (const [k, allowed] of Object.entries(inFilters)) {
                  if (!allowed.includes(row[k])) return false;
                }
                for (const [k, expectedNullOrBool] of Object.entries(isFilters)) {
                  if ((row[k] ?? null) !== expectedNullOrBool) return false;
                }
                return true;
              });

            const validateForeignKeysOnSolicitacao = (updPayload: Record<string, any>) => {
              if (table !== 'admin_solicitacoes_acesso') return null;
              if (updPayload.revisado_por !== undefined && updPayload.revisado_por !== null) {
                const existsAdmin = usuarios.some(u => u.id === updPayload.revisado_por);
                if (!existsAdmin) {
                  return {
                    code: '23503',
                    message:
                      'insert or update on table "admin_solicitacoes_acesso" violates foreign key constraint "admin_solicitacoes_acesso_revisado_por_fkey"'
                  };
                }
              }
              if (updPayload.usuario_id !== undefined && updPayload.usuario_id !== null) {
                const existsUsuario = usuarios.some(u => u.id === updPayload.usuario_id);
                if (!existsUsuario) {
                  return {
                    code: '23503',
                    message:
                      'insert or update on table "admin_solicitacoes_acesso" violates foreign key constraint "admin_solicitacoes_acesso_usuario_id_fkey"'
                  };
                }
              }
              return null;
            };

            return {
              select() {
                const filters: Record<string, any> = {};
                const inFilters: Record<string, any[]> = {};
                const isFilters: Record<string, any> = {};
                let limitVal: number | null = null;
                let orderCol: string | null = null;
                let orderAsc = true;

                const runQuery = () => {
                  let res = matchRows(filters, inFilters, isFilters).map(r => ({ ...r }));
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
                  is(col: string, val: any) {
                    isFilters[col] = val;
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
                const isFilters: Record<string, any> = {};

                const executeUpdate = () => {
                  const fkError = validateForeignKeysOnSolicitacao(updPayload);
                  if (fkError) {
                    return { data: null, error: fkError };
                  }
                  if (table === 'usuarios' && stats.failUsuarioUpdateOnce) {
                    stats.failUsuarioUpdateOnce = false;
                    return { data: null, error: { message: 'Simulated DB error updating usuarios' } };
                  }
                  if (
                    table === 'admin_solicitacoes_acesso' &&
                    updPayload.status === 'aprovada' &&
                    stats.failSolicitacaoApproveUpdateOnce
                  ) {
                    stats.failSolicitacaoApproveUpdateOnce = false;
                    return { data: null, error: { message: 'Simulated DB error approving solicitacao' } };
                  }
                  if (
                    table === 'admin_solicitacoes_acesso' &&
                    filters.status === 'aprovada' &&
                    stats.failSolicitacaoRollbackOnce
                  ) {
                    stats.failSolicitacaoRollbackOnce = false;
                    return { data: null, error: { message: 'Simulated DB error rolling back solicitacao' } };
                  }
                  const matched = matchRows(filters, inFilters, isFilters);
                  if (!matched[0]) return { data: null, error: null };
                  Object.assign(matched[0], updPayload);
                  return { data: { ...matched[0] }, error: null };
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
                  is(col: string, val: any) {
                    isFilters[col] = val;
                    return chain;
                  },
                  then(resolve: (val: any) => void) {
                    resolve(executeUpdate());
                  },
                  select() {
                    return {
                      async maybeSingle() {
                        return executeUpdate();
                      },
                      async single() {
                        const res = executeUpdate();
                        if (res.error) return res;
                        if (!res.data) return { data: null, error: { message: 'Not found' } };
                        return res;
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
      'status',
      'usuario_id'
    ]);
  }

  // 4. review-access-request: validações, FK de revisado_por (adminRecord.id) e bloqueio de solicitação já finalizada
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
    assert.equal(correcaoJson.solicitacao.revisado_por, 'usr_admin_41');
    assert.notEqual(correcaoJson.solicitacao.revisado_por, synthAdminUid);
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
    const recusarJson = await recusarRes.json();
    assert.equal(recusarJson.solicitacao.revisado_por, 'usr_admin_41');

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

  // 5. approve-access-request: validações, falhas parciais com reversão e idempotência
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
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_div_02')?.usuario_id, null);

    // Falha parcial 1: Auth falha -> 500, libera reserva da solicitação e cadastro permanece Pendente
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
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.usuario_id, null);

    // Falha parcial 2: Auth cria conta, mas update de aprovação em admin_solicitacoes_acesso falha ->
    // cadastro NÃO é ativado (permanece Pendente) e reserva da solicitação é liberada
    s.stats.failAuthInvite = false;
    s.stats.failAuthCreate = false;
    s.stats.failSolicitacaoApproveUpdateOnce = true;
    const solicApproveFailRes = await handleAdminManageUserRequest(
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
    assert.equal(solicApproveFailRes.status, 500);
    assert.equal(s.authUsers.length, 1);
    assert.equal(s.usuarios.find(u => u.id === 'usr_canonico_01')?.situacao, 'Pendente');
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.status, 'pendente');
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.usuario_id, null);

    // Falha parcial 3: solicitação é marcada como aprovada, mas update em public.usuarios falha ->
    // NUNCA deixa cadastro ativo com solicitação pendente; reverte a solicitação para pendente e mantém cadastro Pendente
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
          usuarioId: 'usr_canonico_01',
          papel: 'Administrador',
          observacoesAdmin: 'Tentativa que sofre falha ao ativar usuario'
        })
      }),
      s.deps(true)
    );
    assert.equal(userUpdFailRes.status, 500);
    assert.equal(s.authUsers.length, 1);
    assert.equal(s.usuarios.find(u => u.id === 'usr_canonico_01')?.situacao, 'Pendente');
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.status, 'pendente');
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.usuario_id, null);
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.revisado_por, null);
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.revisado_em, null);
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.observacoes_admin, null);

    // Retry final após falhas parciais conclui com sucesso, reutiliza conta Auth existente, grava usuario_id e revisado_por=adminRecord.id
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
    assert.equal(approveJson.solicitacao.usuario_id, 'usr_canonico_01');
    assert.equal(approveJson.solicitacao.revisado_por, 'usr_admin_41');
    assert.notEqual(approveJson.solicitacao.revisado_por, synthAdminUid);
    assert.equal(approveJson.solicitacao.observacoes_admin, 'Aprovado após conferência cadastral');
    assert.equal(s.stats.usuariosInsertCalls, 0);

    // Repetição após aprovação (mesmo tentando apontar outro cadastro) é bloqueada com 409
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
          usuarioId: 'usr_canonico_01_dup'
        })
      }),
      s.deps(true)
    );
    assert.equal(replayRes.status, 409);
    assert.equal(s.authUsers.length, 1);
    assert.equal(s.usuarios.find(u => u.id === 'usr_canonico_01_dup')?.situacao, 'Pendente');
    assert.equal(s.stats.usuariosInsertCalls, 0);
  }

  // 6. Falha de reversão após erro em public.usuarios nunca deixa usuário Ativo com solicitação pendente
  {
    const s = createScenarioState();
    s.stats.failUsuarioUpdateOnce = true;
    s.stats.failSolicitacaoRollbackOnce = true;

    const doubleFailRes = await handleAdminManageUserRequest(
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
    assert.equal(doubleFailRes.status, 500);
    assert.equal(s.usuarios.find(u => u.id === 'usr_canonico_01')?.situacao, 'Pendente');
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.status, 'aprovada');
    assert.equal(s.solicitacoes.find(r => r.id === 'sol_pend_01')?.usuario_id, 'usr_canonico_01');
  }

  // 7. Validação estrita quando public.usuarios já possui auth_user_id (existência no Auth, e-mail canônico e unicidade)
  {
    const s = createScenarioState();
    s.authUsers.push(
      {
        id: synthPrelinkedValidAuthUid,
        email: 'servidor.dois@example.invalid',
        user_metadata: {}
      },
      {
        id: synthPrelinkedMismatchAuthUid,
        email: 'outro.email@example.invalid',
        user_metadata: {}
      },
      {
        id: synthPrelinkedSharedAuthUid,
        email: 'servidor.dois@example.invalid',
        user_metadata: {}
      }
    );

    const sol2 = s.solicitacoes.find(r => r.id === 'sol_div_02')!;
    sol2.matricula = 'MAT-2002';

    const target2 = s.usuarios.find(u => u.id === 'usr_canonico_02')!;

    // 7a. auth_user_id inexistente no Auth -> 409 sem ativar cadastro nem aprovar solicitação
    target2.auth_user_id = '00000000-0000-4000-8000-999999999999';
    const ghostAuthRes = await handleAdminManageUserRequest(
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
    assert.equal(ghostAuthRes.status, 409);
    assert.equal(target2.situacao, 'Pendente');
    assert.equal(sol2.status, 'pendente');
    assert.equal(sol2.usuario_id, null);

    // 7b. auth_user_id pertence a conta Auth com e-mail divergente do e-mail canônico -> 409
    target2.auth_user_id = synthPrelinkedMismatchAuthUid;
    const wrongEmailRes = await handleAdminManageUserRequest(
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
    assert.equal(wrongEmailRes.status, 409);
    assert.equal(target2.situacao, 'Pendente');
    assert.equal(sol2.status, 'pendente');
    assert.equal(sol2.usuario_id, null);

    // 7c. auth_user_id já está vinculado a outro cadastro em public.usuarios -> 409
    s.usuarios.push({
      id: 'usr_outro_vinculado',
      auth_user_id: synthPrelinkedSharedAuthUid,
      nome: 'Outro Vinculado',
      matricula: 'MAT-8888',
      email: 'outro.vinculado@example.invalid',
      papel: 'Usuário',
      situacao: 'Ativo',
      status: 'Ativo'
    });
    target2.auth_user_id = synthPrelinkedSharedAuthUid;
    const sharedAuthRes = await handleAdminManageUserRequest(
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
    assert.equal(sharedAuthRes.status, 409);
    assert.equal(target2.situacao, 'Pendente');
    assert.equal(sol2.status, 'pendente');
    assert.equal(sol2.usuario_id, null);

    // 7d. auth_user_id válido (existe no Auth, mesmo e-mail canônico e exclusivo do cadastro) -> 200
    target2.auth_user_id = synthPrelinkedValidAuthUid;
    const validPrelinkedRes = await handleAdminManageUserRequest(
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
    assert.equal(validPrelinkedRes.status, 200);
    const validPrelinkedJson = await validPrelinkedRes.json();
    assert.equal(validPrelinkedJson.authUserId, synthPrelinkedValidAuthUid);
    assert.equal(target2.situacao, 'Ativo');
    assert.equal(target2.papel, 'Usuário');
    assert.equal(sol2.status, 'aprovada');
    assert.equal(sol2.usuario_id, 'usr_canonico_02');
    assert.equal(sol2.revisado_por, 'usr_admin_41');
  }

  // 8. Aprovações concorrentes da mesma solicitação para cadastros diferentes -> somente 1 vence (200) e a outra recebe 409
  {
    const s = createScenarioState();
    const sharedDeps = s.deps(true);

    const [resA, resB] = await Promise.all([
      handleAdminManageUserRequest(
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
        sharedDeps
      ),
      handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer synth-admin-jwt'
          },
          body: JSON.stringify({
            action: 'approve-access-request',
            solicitacaoId: 'sol_pend_01',
            usuarioId: 'usr_canonico_01_dup'
          })
        }),
        sharedDeps
      )
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);

    const activeMatches = s.usuarios.filter(
      u => (u.id === 'usr_canonico_01' || u.id === 'usr_canonico_01_dup') && u.situacao === 'Ativo'
    );
    assert.equal(activeMatches.length, 1);

    const sol = s.solicitacoes.find(r => r.id === 'sol_pend_01')!;
    assert.equal(sol.status, 'aprovada');
    assert.equal(sol.usuario_id, activeMatches[0].id);
    assert.equal(sol.revisado_por, 'usr_admin_41');
    assert.equal(s.authUsers.length, 1);
  }
});

test('Edge Function admin-manage-user: create-user seguro com DEFAULT_TEMP_PASSWORD, rollback em falha, sem enumeração e proteção a Administrador ativo', async () => {
  const synthAdminUid = '00000000-0000-4000-8000-000000000051';
  const synthActiveAdminTargetUid = '00000000-0000-4000-8000-000000000052';
  const synthOrphanAuthUid = '00000000-0000-4000-8000-000000000053';
  const synthTempSecret = 'Synth#DefaultTempSecret2026!';

  const makeState = (opts?: { defaultTempPassword?: string }) => {
    const authUsers: Array<{ id: string; email: string; password?: string; user_metadata?: Record<string, any> }> = [
      { id: synthAdminUid, email: 'admin.criador@example.invalid' },
      { id: synthActiveAdminTargetUid, email: 'admin.ativo@example.invalid' },
      { id: synthOrphanAuthUid, email: 'auth.previo@example.invalid' }
    ];
    const usuarios: Array<Record<string, any>> = [
      {
        id: 'usr_admin_51',
        auth_user_id: synthAdminUid,
        nome: 'Admin Criador',
        matricula: 'ADM-51',
        email: 'admin.criador@example.invalid',
        login: 'admin.criador',
        papel: 'Administrador',
        situacao: 'Ativo',
        status: 'Ativo',
        force_password_change: false
      },
      {
        id: 'usr_admin_alvo_52',
        auth_user_id: synthActiveAdminTargetUid,
        nome: 'Admin Alvo Ativo',
        matricula: 'ADM-52',
        email: 'admin.ativo@example.invalid',
        login: 'admin.ativo',
        papel: 'Administrador',
        situacao: 'Ativo',
        status: 'Ativo',
        force_password_change: false
      }
    ];
    const stats = {
      authCreateCalls: 0,
      authDeleteCalls: [] as string[],
      usuariosInsertCalls: 0,
      usuariosUpdateCalls: 0,
      failNextUsuarioInsert: false,
      lastCreatedPassword: ''
    };

    const deps = {
      envGet(name: string) {
        if (name === 'SUPABASE_URL') return 'https://example.invalid';
        if (name === 'SUPABASE_SERVICE_ROLE_KEY') return 'synth-service-role-secret-51';
        if (name === 'DEFAULT_TEMP_PASSWORD') return opts?.defaultTempPassword;
        return undefined;
      },
      createSupabaseClient() {
        return {
          auth: {
            async getUser(jwt: string) {
              if (jwt === 'synth-admin-jwt') return { data: { user: { id: synthAdminUid } }, error: null };
              return { data: { user: null }, error: { message: 'Invalid JWT' } };
            },
            admin: {
              async listUsers() {
                return { data: { users: authUsers.map(u => ({ ...u })) }, error: null };
              },
              async createUser(payload: any) {
                stats.authCreateCalls += 1;
                stats.lastCreatedPassword = String(payload?.password || '');
                const created = {
                  id: `00000000-0000-4000-8000-${String(100000000000 + authUsers.length + 1)}`,
                  email: payload.email,
                  password: payload.password,
                  user_metadata: payload.user_metadata || {}
                };
                authUsers.push(created);
                return { data: { user: created }, error: null };
              },
              async deleteUser(id: string) {
                stats.authDeleteCalls.push(id);
                const idx = authUsers.findIndex(u => u.id === id);
                if (idx >= 0) authUsers.splice(idx, 1);
                return { error: null };
              }
            }
          },
          from(table: string) {
            assert.equal(table, 'usuarios');
            return {
              select() {
                const filters: Record<string, any> = {};
                const chain: any = {
                  eq(col: string, val: any) {
                    filters[col] = val;
                    return chain;
                  },
                  async maybeSingle() {
                    const found = usuarios.find(r =>
                      Object.entries(filters).every(([k, v]) => r[k] === v)
                    );
                    return { data: found ? { ...found } : null, error: null };
                  },
                  async single() {
                    const found = usuarios.find(r =>
                      Object.entries(filters).every(([k, v]) => r[k] === v)
                    );
                    if (!found) return { data: null, error: { message: 'Not found' } };
                    return { data: { ...found }, error: null };
                  }
                };
                return chain;
              },
              insert(row: Record<string, any>) {
                stats.usuariosInsertCalls += 1;
                return {
                  select() {
                    return {
                      async single() {
                        if (stats.failNextUsuarioInsert) {
                          stats.failNextUsuarioInsert = false;
                          return { data: null, error: { message: 'Simulated DB insert failure' } };
                        }
                        usuarios.push({ ...row });
                        return { data: { ...row }, error: null };
                      }
                    };
                  }
                };
              },
              update() {
                stats.usuariosUpdateCalls += 1;
                return {
                  eq() {
                    return {
                      select() {
                        return {
                          async single() {
                            return { data: null, error: null };
                          }
                        };
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
    };

    return { authUsers, usuarios, stats, deps };
  };

  // 1. approve-user não pode alterar papel de um Administrador ativo
  {
    const s = makeState({ defaultTempPassword: synthTempSecret });
    const res = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'approve-user',
          usuarioId: 'usr_admin_alvo_52',
          papel: 'Visualizador'
        })
      }),
      s.deps
    );
    assert.equal(res.status, 409);
    assert.equal(s.stats.usuariosUpdateCalls, 0);
    assert.equal(s.usuarios.find(u => u.id === 'usr_admin_alvo_52')?.papel, 'Administrador');
  }

  // 2. create-user rejeita senha temporária enviada pelo cliente (400)
  {
    const s = makeState({ defaultTempPassword: synthTempSecret });
    const res = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'create-user',
          nome: 'Pessoa Sintética',
          email: 'pessoa.nova@example.invalid',
          matricula: 'MAT-700',
          papel: 'Usuário',
          temporaryPassword: 'ClienteNaoPodeDefinirSenha'
        })
      }),
      s.deps
    );
    assert.equal(res.status, 400);
    assert.equal(s.stats.authCreateCalls, 0);
    assert.equal(s.stats.usuariosInsertCalls, 0);
  }

  // 3. create-user falha fechado (500) quando DEFAULT_TEMP_PASSWORD está ausente ou em branco, sem criar conta parcial
  for (const missingSecret of [undefined, '   ']) {
    const s = makeState({ defaultTempPassword: missingSecret });
    const res = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'create-user',
          nome: 'Pessoa Sem Secret',
          email: 'sem.secret@example.invalid',
          matricula: 'MAT-701',
          papel: 'Analista'
        })
      }),
      s.deps
    );
    assert.equal(res.status, 500);
    const bodyText = await res.text();
    assert.equal(bodyText.includes('synth-service-role-secret-51'), false);
    assert.equal(s.stats.authCreateCalls, 0);
    assert.equal(s.stats.usuariosInsertCalls, 0);
  }

  // 4. create-user cria conta no Auth com DEFAULT_TEMP_PASSWORD, normaliza e-mail, grava auth_user_id e force_password_change=true
  {
    const s = makeState({ defaultTempPassword: synthTempSecret });
    const res = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'create-user',
          nome: 'Novo Servidor Sintético',
          email: '  Novo.Servidor@EXAMPLE.invalid ',
          matricula: 'MAT-702',
          papel: 'Analista'
        })
      }),
      s.deps
    );
    assert.equal(res.status, 200);
    const rawText = await res.text();
    assert.equal(rawText.includes(synthTempSecret), false);
    const json = JSON.parse(rawText);
    assert.equal(json.success, true);
    assert.equal(s.stats.lastCreatedPassword, synthTempSecret);
    assert.equal(json.usuarioRecord.email, 'novo.servidor@example.invalid');
    assert.equal(json.usuarioRecord.login, 'novo.servidor');
    assert.equal(json.usuarioRecord.papel, 'Analista');
    assert.equal(json.usuarioRecord.force_password_change, true);
    assert.equal(json.usuarioRecord.auth_user_id, json.authUserId);
    assert.equal(Object.prototype.hasOwnProperty.call(json.usuarioRecord, 'senha_provisoria_enc'), false);
  }

  // 5. Duplicidades (e-mail, login, matrícula, conta prévia no Auth) retornam 409 uniforme sem enumeração
  {
    const s = makeState({ defaultTempPassword: synthTempSecret });
    const conflictPayloads = [
      // Conflito por e-mail já cadastrado em usuarios
      { nome: 'Dup Email', email: 'ADMIN.ATIVO@example.invalid', login: 'unico.login.1', matricula: 'MAT-UNICA-1' },
      // Conflito por login já cadastrado em usuarios
      { nome: 'Dup Login', email: 'unico.email.2@example.invalid', login: 'admin.ativo', matricula: 'MAT-UNICA-2' },
      // Conflito por matrícula já cadastrada em usuarios
      { nome: 'Dup Matricula', email: 'unico.email.3@example.invalid', login: 'unico.login.3', matricula: 'ADM-52' },
      // Conflito por e-mail já existente no Auth (sem linha em usuarios)
      { nome: 'Dup Auth', email: 'auth.previo@example.invalid', login: 'unico.login.4', matricula: 'MAT-UNICA-4' }
    ];

    const conflictBodies: string[] = [];
    for (const payload of conflictPayloads) {
      const res = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer synth-admin-jwt'
          },
          body: JSON.stringify({
            action: 'create-user',
            papel: 'Usuário',
            ...payload
          })
        }),
        s.deps
      );
      assert.equal(res.status, 409);
      conflictBodies.push(await res.text());
    }
    assert.equal(new Set(conflictBodies).size, 1);
    assert.equal(s.stats.authCreateCalls, 0);
    assert.equal(s.stats.usuariosInsertCalls, 0);
  }

  // 6. Falha ao inserir em public.usuarios após criar no Auth executa rollback (deleteUser) e não vaza detalhes
  {
    const s = makeState({ defaultTempPassword: synthTempSecret });
    const initialAuthCount = s.authUsers.length;
    s.stats.failNextUsuarioInsert = true;

    const res = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer synth-admin-jwt'
        },
        body: JSON.stringify({
          action: 'create-user',
          nome: 'Rollback Teste',
          email: 'rollback.teste@example.invalid',
          matricula: 'MAT-ROLLBACK',
          papel: 'Usuário'
        })
      }),
      s.deps
    );
    assert.equal(res.status, 500);
    const bodyText = await res.text();
    assert.equal(bodyText.includes('Simulated DB insert failure'), false);
    assert.equal(bodyText.includes(synthTempSecret), false);
    assert.equal(s.stats.authDeleteCalls.length, 1);
    assert.equal(s.authUsers.length, initialAuthCount);
  }
});

test('Edge Function admin-manage-user: reset-password por auth_user_id (sem e-mail) e complete-password-change restrito ao caller auth.uid()', async () => {
  const synthAdminUid = '00000000-0000-4000-8000-000000000061';
  const synthUserUid = '00000000-0000-4000-8000-000000000062';
  const synthViewerUid = '00000000-0000-4000-8000-000000000063';
  const synthInactiveAdminUid = '00000000-0000-4000-8000-000000000064';
  const synthTempSecret = 'Synth#ResetSecret2026!';

  const makeResetScenario = (opts?: { defaultTempPassword?: string }) => {
    const authUsers: Array<{
      id: string;
      email: string;
      password: string;
      app_metadata?: Record<string, any>;
    }> = [
      { id: synthAdminUid, email: 'admin.reset@example.invalid', password: 'old', app_metadata: {} },
      { id: synthUserUid, email: 'servidor.reset@example.invalid', password: 'old', app_metadata: {} },
      {
        id: synthViewerUid,
        email: 'leitor.reset@example.invalid',
        password: 'OldTempPassword@63',
        app_metadata: {}
      },
      { id: synthInactiveAdminUid, email: 'admin.inativo@example.invalid', password: 'old', app_metadata: {} }
    ];
    const usuarios: Array<Record<string, any>> = [
      {
        id: 'usr_admin_61',
        auth_user_id: synthAdminUid,
        nome: 'Admin Reset',
        matricula: 'ADM-61',
        email: 'admin.reset@example.invalid',
        papel: 'Administrador',
        situacao: 'Ativo',
        status: 'Ativo',
        force_password_change: false
      },
      {
        id: 'usr_srv_62',
        auth_user_id: synthUserUid,
        nome: 'Servidor Resetado',
        matricula: 'MAT-620',
        email: 'servidor.reset@example.invalid',
        papel: 'Usuário',
        situacao: 'Ativo',
        status: 'Ativo',
        force_password_change: false
      },
      {
        id: 'usr_viewer_63',
        auth_user_id: synthViewerUid,
        nome: 'Leitor Primeiro Acesso',
        matricula: 'MAT-630',
        email: 'leitor.reset@example.invalid',
        papel: 'Visualizador',
        situacao: 'Ativo',
        status: 'Ativo',
        force_password_change: true
      },
      {
        id: 'usr_admin_inativo_64',
        auth_user_id: synthInactiveAdminUid,
        nome: 'Admin Inativo',
        matricula: 'ADM-64',
        email: 'admin.inativo@example.invalid',
        papel: 'Administrador',
        situacao: 'Inativo',
        status: 'Inativo',
        force_password_change: false
      },
      {
        id: 'usr_sem_vinculo_65',
        auth_user_id: null,
        nome: 'Sem Auth Vinculado',
        matricula: 'MAT-650',
        email: 'semvinculo@example.invalid',
        papel: 'Usuário',
        situacao: 'Ativo',
        status: 'Ativo',
        force_password_change: false
      },
      {
        id: 'usr_inativo_66',
        auth_user_id: '00000000-0000-4000-8000-000000000066',
        nome: 'Usuário Inativo',
        matricula: 'MAT-660',
        email: 'inativo@example.invalid',
        papel: 'Usuário',
        situacao: 'Inativo',
        status: 'Inativo',
        force_password_change: false
      }
    ];
    const stats = {
      authUpdateCalls: [] as Array<{ id: string; password?: string }>,
      failNextAuthUpdate: false,
      failNextUsuarioUpdate: false,
      usuarioUpdates: [] as Array<Record<string, any>>,
      auditEvents: [] as Array<Record<string, any>>,
      auditDbRows: [] as Array<Record<string, any>>
    };

    const deps = {
      envGet(name: string) {
        if (name === 'SUPABASE_URL') return 'https://example.invalid';
        if (name === 'SUPABASE_SERVICE_ROLE_KEY') return 'synth-service-role-secret-61';
        if (name === 'DEFAULT_TEMP_PASSWORD') return opts?.defaultTempPassword;
        return undefined;
      },
      onAuditEvent(evt: Record<string, any>) {
        stats.auditEvents.push(evt);
      },
      createSupabaseClient() {
        return {
          auth: {
            async getUser(jwt: string) {
              const map: Record<string, string> = {
                'synth-admin-jwt': synthAdminUid,
                'synth-user-jwt': synthUserUid,
                'synth-viewer-jwt': synthViewerUid,
                'synth-inactive-admin-jwt': synthInactiveAdminUid
              };
              const uid = map[jwt];
              if (!uid) return { data: { user: null }, error: { message: 'Invalid JWT' } };
              const found = authUsers.find(u => u.id === uid);
              if (!found) return { data: { user: null }, error: { message: 'User not found' } };
              return {
                data: {
                  user: {
                    id: found.id,
                    email: found.email,
                    app_metadata: { ...(found.app_metadata || {}) }
                  }
                },
                error: null
              };
            },
            async signInWithPassword({ email, password }: { email: string; password: string }) {
              const found = authUsers.find(
                u => u.email.trim().toLowerCase() === String(email || '').trim().toLowerCase()
              );
              if (!found || found.password !== password) {
                return {
                  data: { user: null, session: null },
                  error: { message: 'Invalid login credentials' }
                };
              }
              return {
                data: {
                  user: {
                    id: found.id,
                    email: found.email,
                    app_metadata: { ...(found.app_metadata || {}) }
                  },
                  session: { access_token: 'reauth-tok', user: { id: found.id, email: found.email } }
                },
                error: null
              };
            },
            admin: {
              async getUserById(id: string) {
                const found = authUsers.find(u => u.id === id);
                if (!found) return { data: { user: null }, error: { status: 404, message: 'User not found' } };
                return {
                  data: {
                    user: {
                      id: found.id,
                      email: found.email,
                      app_metadata: { ...(found.app_metadata || {}) }
                    }
                  },
                  error: null
                };
              },
              async updateUserById(id: string, patch: any) {
                stats.authUpdateCalls.push({ id, password: patch?.password });
                if (stats.failNextAuthUpdate) {
                  stats.failNextAuthUpdate = false;
                  return { error: { message: 'Auth update failure' } };
                }
                const found = authUsers.find(u => u.id === id);
                if (!found) return { error: { message: 'User not found' } };
                if (typeof patch?.password === 'string') found.password = patch.password;
                if (patch?.app_metadata && typeof patch.app_metadata === 'object') {
                  found.app_metadata = { ...(found.app_metadata || {}), ...patch.app_metadata };
                }
                return { error: null };
              }
            }
          },
          from(table: string) {
            if (table === 'historico_alteracoes_dados') {
              return {
                async insert(row: Record<string, any>) {
                  stats.auditDbRows.push(row);
                  return { error: null };
                }
              };
            }
            assert.equal(table, 'usuarios');
            const applyFilter = (rows: any[], filters: Record<string, any>) =>
              rows.filter(r => Object.entries(filters).every(([k, v]) => r[k] === v));

            return {
              select() {
                const filters: Record<string, any> = {};
                const chain: any = {
                  eq(col: string, val: any) {
                    filters[col] = val;
                    return chain;
                  },
                  async maybeSingle() {
                    const matched = applyFilter(usuarios, filters);
                    return { data: matched[0] ? { ...matched[0] } : null, error: null };
                  }
                };
                return chain;
              },
              update(payload: Record<string, any>) {
                const filters: Record<string, any> = {};
                const chain: any = {
                  eq(col: string, val: any) {
                    filters[col] = val;
                    return chain;
                  },
                  select() {
                    return {
                      async maybeSingle() {
                        if (stats.failNextUsuarioUpdate) {
                          stats.failNextUsuarioUpdate = false;
                          return { data: null, error: { message: 'DB update failure' } };
                        }
                        const matched = applyFilter(usuarios, filters);
                        if (!matched[0]) return { data: null, error: null };
                        Object.assign(matched[0], payload);
                        stats.usuarioUpdates.push({ id: matched[0].id, payload: { ...payload } });
                        return { data: { ...matched[0] }, error: null };
                      }
                    };
                  }
                };
                return chain;
              }
            };
          }
        };
      }
    };

    return { authUsers, usuarios, stats, deps };
  };

  // 1. Autorização de reset-password: nega sem JWT (401), usuário comum (403) e admin inativo (403)
  {
    const s = makeResetScenario({ defaultTempPassword: synthTempSecret });
    const unauth = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-password', usuarioId: 'usr_srv_62' })
      }),
      s.deps
    );
    assert.equal(unauth.status, 401);

    for (const badJwt of ['synth-user-jwt', 'synth-inactive-admin-jwt']) {
      const forbidden = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${badJwt}` },
          body: JSON.stringify({ action: 'reset-password', usuarioId: 'usr_srv_62' })
        }),
        s.deps
      );
      assert.equal(forbidden.status, 403);
    }
    assert.equal(s.stats.authUpdateCalls.length, 0);
  }

  // 2. Rejeita identificação somente por e-mail ou ausente (400) e falta de DEFAULT_TEMP_PASSWORD (500)
  {
    const s = makeResetScenario({ defaultTempPassword: synthTempSecret });
    const emailOnlyRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-admin-jwt' },
        body: JSON.stringify({ action: 'reset-password', email: 'servidor.reset@example.invalid' })
      }),
      s.deps
    );
    assert.equal(emailOnlyRes.status, 400);

    const noSecret = makeResetScenario({ defaultTempPassword: undefined });
    const missingEnvRes = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-admin-jwt' },
        body: JSON.stringify({ action: 'reset-password', usuarioId: 'usr_srv_62' })
      }),
      noSecret.deps
    );
    assert.equal(missingEnvRes.status, 500);
    assert.equal(noSecret.stats.authUpdateCalls.length, 0);
  }

  // 3. Alvo inexistente, sem auth_user_id ou inativo retorna 409 uniforme (sem enumeração)
  {
    const s = makeResetScenario({ defaultTempPassword: synthTempSecret });
    const errorBodies: string[] = [];
    for (const body of [
      { action: 'reset-password', usuarioId: 'usr_nao_existe' },
      { action: 'reset-password', usuarioId: 'usr_sem_vinculo_65' },
      { action: 'reset-password', usuarioId: 'usr_inativo_66' },
      { action: 'reset-password', usuarioId: 'usr_srv_62', authUserId: synthViewerUid }
    ]) {
      const res = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-admin-jwt' },
          body: JSON.stringify(body)
        }),
        s.deps
      );
      assert.equal(res.status, 409);
      errorBodies.push(await res.text());
    }
    assert.equal(new Set(errorBodies).size, 1);
    assert.equal(s.stats.authUpdateCalls.length, 0);
  }

  // 4. Se updateUserById falhar no Auth, NÃO marca force_password_change=true
  {
    const s = makeResetScenario({ defaultTempPassword: synthTempSecret });
    s.stats.failNextAuthUpdate = true;
    const res = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-admin-jwt' },
        body: JSON.stringify({ action: 'reset-password', usuarioId: 'usr_srv_62', authUserId: synthUserUid })
      }),
      s.deps
    );
    assert.equal(res.status, 500);
    assert.equal(s.usuarios.find(u => u.id === 'usr_srv_62')?.force_password_change, false);
    assert.equal(s.stats.usuarioUpdates.length, 0);
  }

  // 5. Sucesso no reset-password atualiza senha Auth com DEFAULT_TEMP_PASSWORD, marca force_password_change=true e não vaza PII/segredos
  {
    const s = makeResetScenario({ defaultTempPassword: synthTempSecret });
    const res = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-admin-jwt' },
        body: JSON.stringify({ action: 'reset-password', authUserId: synthUserUid })
      }),
      s.deps
    );
    assert.equal(res.status, 200);
    const bodyText = await res.text();
    assert.equal(bodyText.includes(synthTempSecret), false);
    assert.equal(bodyText.includes('servidor.reset@example.invalid'), false);
    assert.equal(bodyText.includes('MAT-620'), false);
    assert.equal(bodyText.includes(synthUserUid), false);
    assert.equal(s.stats.authUpdateCalls.length, 1);
    assert.equal(s.stats.authUpdateCalls[0].id, synthUserUid);
    assert.equal(s.stats.authUpdateCalls[0].password, synthTempSecret);
    assert.equal(s.usuarios.find(u => u.id === 'usr_srv_62')?.force_password_change, true);
  }

  // 6. complete-password-change: exige currentPassword + newPassword (>=8), confirma Auth, atualiza apenas auth.uid(),
  //    limpa flag apenas após troca real, permite retry seguro em falha parcial do banco e nunca expõe senhas
  {
    const s = makeResetScenario({ defaultTempPassword: synthTempSecret });
    const capturedLogs: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = (...args: any[]) => capturedLogs.push(args.map(String).join(' '));
    console.warn = (...args: any[]) => capturedLogs.push(args.map(String).join(' '));
    console.error = (...args: any[]) => capturedLogs.push(args.map(String).join(' '));

    try {
      const noAuth = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'complete-password-change',
            currentPassword: 'OldTempPassword@63',
            newPassword: 'ViewerNewPassword@8'
          })
        }),
        s.deps
      );
      assert.equal(noAuth.status, 401);

      const inactive = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-inactive-admin-jwt' },
          body: JSON.stringify({
            action: 'complete-password-change',
            currentPassword: 'old',
            newPassword: 'AdminNewPassword@8'
          })
        }),
        s.deps
      );
      assert.equal(inactive.status, 403);

      // Chamada direta sem senhas NÃO limpa a flag e não altera senha no Auth
      const noPasswordsRes = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-viewer-jwt' },
          body: JSON.stringify({ action: 'complete-password-change' })
        }),
        s.deps
      );
      assert.equal(noPasswordsRes.status, 400);
      assert.equal(s.usuarios.find(u => u.id === 'usr_viewer_63')?.force_password_change, true);
      assert.equal(s.authUsers.find(u => u.id === synthViewerUid)?.password, 'OldTempPassword@63');

      // Senha nova curta (< 8) ou igual à atual é rejeitada
      const shortNewRes = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-viewer-jwt' },
          body: JSON.stringify({
            action: 'complete-password-change',
            currentPassword: 'OldTempPassword@63',
            newPassword: 'Short@7'
          })
        }),
        s.deps
      );
      assert.equal(shortNewRes.status, 400);
      assert.equal(s.usuarios.find(u => u.id === 'usr_viewer_63')?.force_password_change, true);

      const samePwdRes = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-viewer-jwt' },
          body: JSON.stringify({
            action: 'complete-password-change',
            currentPassword: 'OldTempPassword@63',
            newPassword: 'OldTempPassword@63'
          })
        }),
        s.deps
      );
      assert.equal(samePwdRes.status, 400);
      assert.equal(s.usuarios.find(u => u.id === 'usr_viewer_63')?.force_password_change, true);

      // Senha atual incorreta (inclusive tentando passar a senha atual em newPassword) não altera senha nem flag
      const wrongCurRes = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-viewer-jwt' },
          body: JSON.stringify({
            action: 'complete-password-change',
            currentPassword: 'SenhaErrada@999',
            newPassword: 'OldTempPassword@63'
          })
        }),
        s.deps
      );
      assert.equal(wrongCurRes.status, 403);
      assert.equal(s.usuarios.find(u => u.id === 'usr_viewer_63')?.force_password_change, true);
      assert.equal(s.authUsers.find(u => u.id === synthViewerUid)?.password, 'OldTempPassword@63');
      assert.equal(s.stats.authUpdateCalls.length, 0);

      // Se troca no Auth funcionar e atualização da flag no banco falhar -> falha fechado (500) e mantém flag=true;
      // repetir com segurança conclui sem expor outro UID ou senhas
      s.stats.failNextUsuarioUpdate = true;
      const partialFailRes = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-viewer-jwt' },
          body: JSON.stringify({
            action: 'complete-password-change',
            currentPassword: 'OldTempPassword@63',
            newPassword: 'ViewerNewPassword@8',
            usuarioId: 'usr_admin_61',
            authUserId: synthAdminUid,
            email: 'admin.reset@example.invalid',
            papel: 'Administrador'
          })
        }),
        s.deps
      );
      assert.equal(partialFailRes.status, 500);
      assert.equal(s.authUsers.find(u => u.id === synthViewerUid)?.password, 'ViewerNewPassword@8');
      assert.equal(s.authUsers.find(u => u.id === synthAdminUid)?.password, 'old');
      assert.equal(s.usuarios.find(u => u.id === 'usr_viewer_63')?.force_password_change, true);

      // Tentativa com senha atual ainda errada após falha parcial NÃO libera se não bater com nova senha pendente
      const wrongRetryRes = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-viewer-jwt' },
          body: JSON.stringify({
            action: 'complete-password-change',
            currentPassword: 'OldTempPassword@63',
            newPassword: 'OutraSenhaQualquer@8'
          })
        }),
        s.deps
      );
      assert.equal(wrongRetryRes.status, 403);
      assert.equal(s.usuarios.find(u => u.id === 'usr_viewer_63')?.force_password_change, true);

      // Repetição segura da mesma solicitação conclui limpeza da flag somente do próprio usuário (auth.uid())
      const viewerOk = await handleAdminManageUserRequest(
        new Request('https://example.invalid/admin-manage-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synth-viewer-jwt' },
          body: JSON.stringify({
            action: 'complete-password-change',
            currentPassword: 'OldTempPassword@63',
            newPassword: 'ViewerNewPassword@8',
            usuarioId: 'usr_admin_61',
            authUserId: synthAdminUid,
            email: 'admin.reset@example.invalid',
            papel: 'Administrador'
          })
        }),
        s.deps
      );
      assert.equal(viewerOk.status, 200);
      const viewerRawText = await viewerOk.text();
      const viewerJson = JSON.parse(viewerRawText);
      assert.equal(viewerJson.success, true);
      assert.equal(viewerJson.forcePasswordChange, false);
      assert.equal(s.usuarios.find(u => u.id === 'usr_viewer_63')?.force_password_change, false);
      assert.equal(s.usuarios.find(u => u.id === 'usr_viewer_63')?.papel, 'Visualizador');
      assert.equal(s.authUsers.find(u => u.id === synthAdminUid)?.password, 'old');
      assert.equal(s.usuarios.find(u => u.id === 'usr_admin_61')?.papel, 'Administrador');

      // Nenhuma senha aparece na resposta, auditoria ou logs
      const allSerialized = [
        viewerRawText,
        JSON.stringify(s.stats.auditEvents),
        JSON.stringify(s.stats.auditDbRows),
        capturedLogs.join('\n')
      ].join('\n');
      assert.equal(allSerialized.includes('OldTempPassword@63'), false);
      assert.equal(allSerialized.includes('ViewerNewPassword@8'), false);
      assert.equal(s.stats.auditEvents.length, 1);
      assert.equal(s.stats.auditEvents[0].event, 'complete-password-change');
      assert.equal(s.stats.auditDbRows.length, 1);
      assert.equal(s.stats.auditDbRows[0].motivo, 'complete-password-change');
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
  }
});

test('Troca obrigatória no primeiro acesso: auth-session, authService, ForcePasswordChangePage e bloqueio de telas/APIs', async () => {
  const synthUid = '00000000-0000-4000-8000-000000000071';

  // 1. /api/auth-session propaga forcePasswordChange do banco
  const prevUrl = process.env.SUPABASE_URL;
  const prevViteUrl = process.env.VITE_SUPABASE_URL;
  const prevSrv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synth-service-role';
  setTestSupabaseAdminForSemaAudit(
    createServerAuthSupabaseMock({
      tokenMap: { 'tok-first-access': { id: synthUid, email: 'primeiro@example.invalid' } },
      usuariosRows: [
        {
          id: 'usr_first_71',
          auth_user_id: synthUid,
          nome: 'Servidor Primeiro Acesso',
          login: 'primeiro.acesso',
          matricula: 'MAT-71',
          papel: 'Usuário',
          situacao: 'Ativo',
          force_password_change: true
        }
      ]
    })
  );

  try {
    const res = createMockRes();
    await authSessionHandler(
      createMockReq({ method: 'GET', headers: { authorization: 'Bearer tok-first-access' } }) as any,
      res as any
    );
    assert.equal(res.getStatus(), 200);
    assert.equal(res.getBody().profile.forcePasswordChange, true);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
    else delete process.env.SUPABASE_URL;
    if (prevViteUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteUrl;
    else delete process.env.VITE_SUPABASE_URL;
    if (prevSrv !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevSrv;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }

  // 2. authService: política mínima de 8 caracteres, policy do Auth, confirmação no servidor e re-validação
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  let forceFlagInDb = true;
  let rejectWeakPassword = true;
  let failServerComplete = false;
  let invokeCalls: Array<{ fn: string; body: any }> = [];
  let updateUserCalls: string[] = [];
  let directUsuarioInserts = 0;

  const mockClient: any = {
    auth: {
      async getSession() {
        return { data: { session: { access_token: 'tok-first-access', user: { id: synthUid } } }, error: null };
      },
      async signInWithPassword() {
        return {
          data: {
            user: { id: synthUid, email: 'primeiro@example.invalid' },
            session: { access_token: 'tok-first-access', user: { id: synthUid } }
          },
          error: null
        };
      },
      async updateUser({ password }: { password: string }) {
        updateUserCalls.push(password);
        assert.ok(password.length >= MIN_PASSWORD_LENGTH);
        if (rejectWeakPassword) {
          return { error: { message: 'Password should contain uppercase, lowercase and number.' } };
        }
        return { error: null };
      },
      async signOut() {
        return { error: null };
      }
    },
    functions: {
      async invoke(fn: string, opts: any) {
        invokeCalls.push({ fn, body: opts?.body });
        if (opts?.body?.action === 'complete-password-change') {
          if (opts?.body?.currentPassword !== 'TempPass!1') {
            return { data: { success: false, error: 'Senha atual incorreta.' }, error: null };
          }
          if (rejectWeakPassword) {
            return {
              data: { success: false, error: 'Password should contain uppercase, lowercase and number.' },
              error: null
            };
          }
          if (failServerComplete) {
            return { data: null, error: { message: 'Server confirm failed' } };
          }
          forceFlagInDb = false;
          return { data: { success: true, forcePasswordChange: false }, error: null };
        }
        if (opts?.body?.action === 'create-user') {
          return { data: null, error: { message: 'Edge function unavailable' } };
        }
        if (opts?.body?.action === 'reset-password') {
          return { data: { success: true, message: 'Senha redefinida.' }, error: null };
        }
        return { data: null, error: null };
      }
    },
    from(table: string) {
      assert.equal(table, 'usuarios');
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      id: 'usr_first_71',
                      auth_user_id: synthUid,
                      nome: 'Servidor Primeiro Acesso',
                      login: 'primeiro.acesso',
                      email: 'primeiro@example.invalid',
                      matricula: 'MAT-71',
                      papel: 'Usuário',
                      situacao: 'Ativo',
                      force_password_change: forceFlagInDb
                    },
                    error: null
                  };
                }
              };
            }
          };
        },
        insert() {
          directUsuarioInserts += 1;
          return { error: null };
        }
      };
    }
  };

  const svc = createAuthService(() => ({ client: mockClient, configured: true }));

  const loginRes = await svc.loginWithPassword('primeiro@example.invalid', 'TempPass!1');
  assert.equal(loginRes.success, true);
  assert.equal(loginRes.profile?.forcePasswordChange, true);

  // Senhas com menos de 8 caracteres (6 ou 7) são recusadas antes de chamar Auth ou Edge Function
  for (const shortPwd of ['Ab1!xy', 'Ab1!xyz']) {
    const uiErr = validateForcePasswordChangeInput(shortPwd, shortPwd, 'TempPass!1', 'forced');
    assert.match(String(uiErr), /8 caracteres/);

    const svcShortErr = await svc.completeFirstAccessPasswordChange('TempPass!1', shortPwd, shortPwd);
    assert.equal(svcShortErr.success, false);
    assert.match(String(svcShortErr.error), /8 caracteres/);

    const updShortErr = await svc.updatePassword(shortPwd);
    assert.equal(updShortErr.success, false);
    assert.match(String(updShortErr.error), /8 caracteres/);
  }
  assert.equal(updateUserCalls.length, 0);
  assert.equal(invokeCalls.length, 0);
  assert.equal(forceFlagInDb, true);

  // Sem senha atual ou senha igual à atual é bloqueado antes de chamar Edge Function
  assert.match(String(validateForcePasswordChangeInput('Ab1!wxyz', 'Ab1!wxyz', '', 'forced')), /atual/);
  assert.match(
    String(validateForcePasswordChangeInput('TempPass!1', 'TempPass!1', 'TempPass!1', 'forced')),
    /diferente/
  );
  const wrongFirstPwd = await svc.completeFirstAccessPasswordChange('Errada@1', 'Ab1!wxyz', 'Ab1!wxyz');
  assert.equal(wrongFirstPwd.success, false);
  assert.equal(updateUserCalls.length, 0);
  assert.equal(forceFlagInDb, true);

  // Senha com 8 caracteres sem atender complexidade do Auth é recusada pelo servidor sem chamar browser updateUser e sem destravar
  assert.equal(validateForcePasswordChangeInput('fraca123', 'fraca123', 'TempPass!1', 'forced'), null);
  const policyFail = await svc.completeFirstAccessPasswordChange('TempPass!1', 'fraca123', 'fraca123');
  assert.equal(policyFail.success, false);
  assert.match(String(policyFail.error), /uppercase/i);
  assert.equal(updateUserCalls.length, 0);
  assert.equal(forceFlagInDb, true);

  // Falha de confirmação no backend mantém bloqueio sem chamar browser updateUser
  rejectWeakPassword = false;
  failServerComplete = true;
  const serverFail = await svc.completeFirstAccessPasswordChange('TempPass!1', 'Ab1!wxyz', 'Ab1!wxyz');
  assert.equal(serverFail.success, false);
  assert.equal(updateUserCalls.length, 0);
  assert.equal(forceFlagInDb, true);

  // Senha com 8 caracteres válida no servidor conclui, atualiza forcePasswordChange=false e NÃO chama browser updateUser
  failServerComplete = false;
  assert.equal(validateForcePasswordChangeInput('Ab1!wxyz', 'Ab1!wxyz', 'TempPass!1', 'forced'), null);
  const completeOk = await svc.completeFirstAccessPasswordChange('TempPass!1', 'Ab1!wxyz', 'Ab1!wxyz');
  assert.equal(completeOk.success, true);
  assert.equal(completeOk.profile?.forcePasswordChange, false);
  assert.equal(updateUserCalls.length, 0);
  const completeCall = invokeCalls.filter(c => c.body?.action === 'complete-password-change').pop();
  assert.equal(completeCall?.body?.currentPassword, 'TempPass!1');
  assert.equal(completeCall?.body?.newPassword, 'Ab1!wxyz');

  // adminCreateUser nunca envia temporaryPassword e nunca faz fallback de insert direto
  const createFail = await svc.adminCreateUser({
    nome: 'Teste',
    matricula: '999',
    email: 'teste@example.invalid',
    perfilProfissional: 'Analista',
    setor: 'CSB',
    papel: 'Usuário'
  });
  assert.equal(createFail.success, false);
  assert.equal(directUsuarioInserts, 0);
  const createCall = invokeCalls.find(c => c.body?.action === 'create-user');
  assert.ok(createCall);
  assert.equal('temporaryPassword' in createCall.body, false);
  assert.equal('sendInviteEmail' in createCall.body, false);

  // adminResetUserPassword aciona reset-password com usuarioId/authUserId
  const resetRes = await svc.adminResetUserPassword('usr_first_71', synthUid);
  assert.equal(resetRes.success, true);
  const resetCall = invokeCalls.find(c => c.body?.action === 'reset-password');
  assert.equal(resetCall?.body?.usuarioId, 'usr_first_71');
  assert.equal(resetCall?.body?.authUserId, synthUid);

  // 3. Renderização da tela ForcePasswordChangePage e inspeção estática da constante única
  const html = renderToStaticMarkup(
    React.createElement(ForcePasswordChangePage, {
      profile: {
        id: 'usr_first_71',
        authUserId: synthUid,
        nome: 'Servidor Primeiro Acesso',
        login: 'primeiro.acesso',
        email: 'primeiro@example.invalid',
        matricula: 'MAT-71',
        perfilProfissional: 'Analista',
        setor: 'CSB',
        papel: 'Usuário',
        situacao: 'Ativo',
        forcePasswordChange: true,
        createdAt: '2026-11-24T00:00:00.000Z'
      },
      onPasswordChanged: () => {},
      onLogout: () => {}
    })
  );
  assert.ok(html.includes('Definição de Nova Senha'));
  assert.ok(html.includes('mínimo de 8 caracteres'));
  assert.ok(html.includes('force-current-password-input'));
  assert.ok(html.includes('force-new-password-input'));
  assert.ok(html.includes('force-confirm-password-input'));

  const root = process.cwd();
  const appSrc = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const modalSrc = fs.readFileSync(path.join(root, 'src/components/UsuarioModal.tsx'), 'utf8');
  const forcePageSrc = fs.readFileSync(path.join(root, 'src/components/ForcePasswordChangePage.tsx'), 'utf8');
  const loginModalSrc = fs.readFileSync(path.join(root, 'src/components/LoginModal.tsx'), 'utf8');
  const changeOwnModalSrc = fs.readFileSync(path.join(root, 'src/components/ChangeOwnPasswordModal.tsx'), 'utf8');
  const authServiceSrc = fs.readFileSync(path.join(root, 'src/services/authService.ts'), 'utf8');
  const handlerSrc = fs.readFileSync(path.join(root, 'supabase/functions/admin-manage-user/handler.ts'), 'utf8');
  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const docSrc = fs.readFileSync(path.join(root, 'docs/EDGE_FUNCTION_ADMIN_MANAGE_USER.md'), 'utf8');

  assert.equal(appSrc.includes('requiresForcedPasswordChange'), true);
  assert.equal(appSrc.includes('!currentUserProfile?.forcePasswordChange'), true);
  assert.equal(appSrc.includes('<ForcePasswordChangePage'), true);
  assert.equal(modalSrc.includes('temporaryPassword'), false);
  assert.equal(modalSrc.includes('DEFAULT_TEMP_PASSWORD'), false);
  assert.equal(envExample.includes('DEFAULT_TEMP_PASSWORD'), false);
  assert.equal(docSrc.includes('DEFAULT_TEMP_PASSWORD'), true);
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(HANDLER_MIN_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH);
  assert.equal(authServiceSrc.includes('supabase/functions'), false);
  assert.equal(handlerSrc.includes('_shared'), false);
  assert.equal(/TEMPOR[AÁ]RIO|voltar para 8/i.test(handlerSrc), false);
  assert.equal(/TEMPOR[AÁ]RIO:|voltar para 8/i.test(authServiceSrc), false);
  assert.equal(handlerSrc.includes('MIN_PASSWORD_LENGTH'), true);
  for (const pwdSrc of [forcePageSrc, loginModalSrc, changeOwnModalSrc, authServiceSrc, handlerSrc]) {
    assert.equal(/length\s*<\s*[68]|minLength=\{?[68]\}?|[68]\s+caracteres/i.test(pwdSrc), false);
  }
});

test('Autoatendimento de senha (changeOwnPassword, ChangeOwnPasswordModal) e visibilidade de menu por papel (Analista vs Administrador)', async () => {
  const synthAnalystUid = '00000000-0000-4000-8000-000000000081';
  let forceFlag = false;
  let updateUserCalls: string[] = [];
  let completeInvokeCalls = 0;
  let signOutCalls = 0;

  const mockClient: any = {
    auth: {
      async getSession() {
        return {
          data: {
            session: {
              access_token: 'tok-analyst',
              user: { id: synthAnalystUid, email: 'analista@example.invalid' }
            }
          },
          error: null
        };
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        assert.equal(email, 'analista@example.invalid');
        if (password !== 'SenhaAtual@1') {
          return { data: { user: null, session: null }, error: { message: 'Invalid login credentials (details that must not leak)' } };
        }
        return {
          data: {
            user: { id: synthAnalystUid, email },
            session: { access_token: 'tok-analyst', user: { id: synthAnalystUid, email } }
          },
          error: null
        };
      },
      async updateUser({ password }: { password: string }) {
        updateUserCalls.push(password);
        return { error: null };
      },
      async signOut() {
        signOutCalls += 1;
        return { error: null };
      }
    },
    functions: {
      async invoke(_fn: string, opts: any) {
        if (opts?.body?.action === 'complete-password-change') {
          assert.equal(opts.body.currentPassword, 'SenhaAtual@1');
          assert.equal(opts.body.newPassword, 'Nova2@8x');
          completeInvokeCalls += 1;
          forceFlag = false;
          return { data: { success: true, forcePasswordChange: false }, error: null };
        }
        return { data: null, error: null };
      }
    },
    from(table: string) {
      assert.equal(table, 'usuarios');
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      id: 'usr_analista_81',
                      auth_user_id: synthAnalystUid,
                      nome: 'Analista Teste',
                      login: 'analista.teste',
                      email: 'analista@example.invalid',
                      matricula: '12345',
                      papel: 'Analista',
                      situacao: 'Ativo',
                      force_password_change: forceFlag
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

  const svc = createAuthService(() => ({ client: mockClient, configured: true }));

  // 1. Validações de UI e serviço (< 8 caracteres, igual à atual, confirmação diferente)
  assert.match(String(validateChangeOwnPasswordInput('SenhaAtual@1', 'Ab1!xyz', 'Ab1!xyz')), /8 caracteres/);
  assert.match(String(validateChangeOwnPasswordInput('SenhaAtual@1', 'SenhaAtual@1', 'SenhaAtual@1')), /diferente/);
  assert.match(String(validateChangeOwnPasswordInput('SenhaAtual@1', 'Nova@8ab', 'Outra@8b')), /não confere/);
  assert.equal(validateChangeOwnPasswordInput('SenhaAtual@1', 'Nova@8ab', 'Nova@8ab'), null);

  const shortRes = await svc.changeOwnPassword('SenhaAtual@1', '1234567', '1234567');
  assert.equal(shortRes.success, false);
  assert.match(String(shortRes.error), /8 caracteres/);
  assert.equal(updateUserCalls.length, 0);

  // 2. Senha atual incorreta -> retorna exatamente "Senha atual incorreta" sem detalhes e não atualiza senha
  const wrongCurrentRes = await svc.changeOwnPassword('Errada@1', 'Nova@8ab', 'Nova@8ab');
  assert.equal(wrongCurrentRes.success, false);
  assert.equal(wrongCurrentRes.error, 'Senha atual incorreta');
  assert.equal(updateUserCalls.length, 0);
  assert.equal(completeInvokeCalls, 0);

  // 3. Troca bem-sucedida com forcePasswordChange=false não precisa chamar complete-password-change
  const okNormalRes = await svc.changeOwnPassword('SenhaAtual@1', 'Nova@8ab', 'Nova@8ab');
  assert.equal(okNormalRes.success, true);
  assert.deepEqual(updateUserCalls, ['Nova@8ab']);
  assert.equal(completeInvokeCalls, 0);
  assert.equal(okNormalRes.profile?.papel, 'Analista');

  // 4. Troca com forcePasswordChange=true delega ao servidor via complete-password-change sem chamar updateUser antes
  forceFlag = true;
  const okForceRes = await svc.changeOwnPassword('SenhaAtual@1', 'Nova2@8x', 'Nova2@8x');
  assert.equal(okForceRes.success, true);
  assert.equal(completeInvokeCalls, 1);
  assert.equal(forceFlag, false);
  assert.equal(updateUserCalls.length, 1);
  assert.equal(okForceRes.profile?.forcePasswordChange, false);

  // 5. Renderização do ChangeOwnPasswordModal e UserProfileMenu para todos os perfis
  const baseProfile = {
    id: 'usr_analista_81',
    authUserId: synthAnalystUid,
    nome: 'Analista Teste',
    login: 'analista.teste',
    email: 'analista@example.invalid',
    matricula: '12345',
    perfilProfissional: 'Analista',
    setor: 'CSB',
    papel: 'Analista' as const,
    situacao: 'Ativo' as const,
    forcePasswordChange: false,
    createdAt: '2026-11-24T00:00:00.000Z'
  };

  for (const role of ['Administrador', 'Analista', 'Usuário', 'Visualizador'] as const) {
    const menuHtml = renderToStaticMarkup(
      React.createElement(UserProfileMenu, {
        profile: { ...baseProfile, papel: role },
        userRole: role,
        defaultOpen: true,
        onOpenChangePassword: () => {},
        onLogout: () => {}
      })
    );
    assert.ok(menuHtml.includes('Alterar minha senha'), `${role} deve ver "Alterar minha senha"`);
    assert.equal(menuHtml.includes('Gerenciar usuários'), false);
  }

  const modalHtml = renderToStaticMarkup(
    React.createElement(ChangeOwnPasswordModal, {
      isOpen: true,
      profile: baseProfile,
      onClose: () => {}
    })
  );
  assert.ok(modalHtml.includes('Alterar minha senha'));
  assert.ok(modalHtml.includes('own-current-password-input'));
  assert.ok(modalHtml.includes('own-new-password-input'));
  assert.ok(modalHtml.includes('own-confirm-password-input'));
  assert.ok(modalHtml.includes('Redefinir para a senha padrão'));
  assert.equal(
    DEFAULT_RESET_CONFIRMATION_MESSAGE,
    'Sua senha será redefinida e você terá que criar uma nova no próximo acesso'
  );

  // 6. Analista não acessa Gerenciar usuários na UI (roteamento + guarda em App.tsx)
  const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  const adminSidebarBlockMatch = appSrc.match(
    /\{userRole === 'Administrador' && \(\s*<>([\s\S]*?)<\/>\s*\)\}/
  );
  assert.ok(adminSidebarBlockMatch);
  assert.ok(adminSidebarBlockMatch[1].includes('Gerenciar usuários'));
  assert.equal(
    resolveAuthorizedAppView('usuarios', { userRole: 'Analista', enforceAdminGuard: true }).allowed,
    false
  );
  assert.equal(signOutCalls, 0);
});

test('Edge Function reset-own-password: JWT obrigatório, alvo estrito auth.uid(), formato Csb@matriculaPrimeiroNome, force_password_change=true, auditoria sem senha, rate limit (429) e logout no cliente', async () => {
  const synthAnalystUid = '00000000-0000-4000-8000-000000000091';
  const synthOtherUid = '00000000-0000-4000-8000-000000000092';
  const synthNoMatUid = '00000000-0000-4000-8000-000000000093';
  const synthInactiveUid = '00000000-0000-4000-8000-000000000094';
  const synthUnlinkedUid = '00000000-0000-4000-8000-000000000095';

  assert.equal(buildDefaultOwnResetPassword('12345', 'Géssika Almeida'), 'Csb@12345Gessika');
  assert.equal(buildDefaultOwnResetPassword('9876', '  joão da silva  '), 'Csb@9876Joao');
  assert.equal(buildDefaultOwnResetPassword('', 'Géssika Almeida'), null);
  assert.equal(buildDefaultOwnResetPassword(null, 'Géssika Almeida'), null);

  let currentNow = Date.UTC(2026, 10, 24, 15, 0, 0);
  const rateLimitStore = new Map<string, number[]>();
  const auditEvents: Array<Record<string, any>> = [];
  const auditDbRows: Array<Record<string, any>> = [];
  const authUpdateCalls: Array<{ id: string; password?: string }> = [];

  const usuarios = [
    {
      id: 'usr_gessika_91',
      auth_user_id: synthAnalystUid,
      nome: 'Géssika Almeida',
      matricula: '12345',
      login: 'gessika.almeida',
      email: 'gessika@example.invalid',
      papel: 'Analista',
      situacao: 'Ativo',
      status: 'Ativo',
      force_password_change: false
    },
    {
      id: 'usr_outro_92',
      auth_user_id: synthOtherUid,
      nome: 'Outro Usuário',
      matricula: '99999',
      login: 'outro.usuario',
      email: 'outro@example.invalid',
      papel: 'Administrador',
      situacao: 'Ativo',
      status: 'Ativo',
      force_password_change: false
    },
    {
      id: 'usr_sem_mat_93',
      auth_user_id: synthNoMatUid,
      nome: 'Sem Matrícula',
      matricula: '',
      login: 'sem.mat',
      email: 'semmat@example.invalid',
      papel: 'Usuário',
      situacao: 'Ativo',
      status: 'Ativo',
      force_password_change: false
    },
    {
      id: 'usr_inativo_94',
      auth_user_id: synthInactiveUid,
      nome: 'Servidor Inativo',
      matricula: '55555',
      login: 'inativo',
      email: 'inativo@example.invalid',
      papel: 'Visualizador',
      situacao: 'Inativo',
      status: 'Inativo',
      force_password_change: false
    }
  ];

  const deps = {
    envGet(name: string) {
      if (name === 'SUPABASE_URL') return 'https://example.invalid';
      if (name === 'SUPABASE_SERVICE_ROLE_KEY') return 'synth-service-role-key-91';
      return undefined;
    },
    now: () => currentNow,
    rateLimitStore,
    onAuditEvent(evt: any) {
      auditEvents.push(evt);
    },
    createSupabaseClient() {
      return {
        auth: {
          async getUser(jwt: string) {
            if (jwt === 'jwt-gessika') return { data: { user: { id: synthAnalystUid } }, error: null };
            if (jwt === 'jwt-nomat') return { data: { user: { id: synthNoMatUid } }, error: null };
            if (jwt === 'jwt-inativo') return { data: { user: { id: synthInactiveUid } }, error: null };
            if (jwt === 'jwt-sem-vinculo') return { data: { user: { id: synthUnlinkedUid } }, error: null };
            return { data: { user: null }, error: { message: 'Invalid JWT' } };
          },
          admin: {
            async updateUserById(id: string, patch: any) {
              authUpdateCalls.push({ id, password: patch?.password });
              return { error: null };
            }
          }
        },
        from(table: string) {
          if (table === 'historico_alteracoes_dados') {
            return {
              async insert(row: Record<string, any>) {
                auditDbRows.push(row);
                return { error: null };
              }
            };
          }
          assert.equal(table, 'usuarios');
          const applyFilters = (rows: any[], filters: Record<string, any>) =>
            rows.filter(r => Object.entries(filters).every(([k, v]) => r[k] === v));
          return {
            select() {
              const filters: Record<string, any> = {};
              const chain: any = {
                eq(col: string, val: any) {
                  filters[col] = val;
                  return chain;
                },
                async maybeSingle() {
                  const matched = applyFilters(usuarios, filters);
                  return { data: matched[0] ? { ...matched[0] } : null, error: null };
                }
              };
              return chain;
            },
            update(payload: Record<string, any>) {
              const filters: Record<string, any> = {};
              const chain: any = {
                eq(col: string, val: any) {
                  filters[col] = val;
                  return chain;
                },
                select() {
                  return {
                    async maybeSingle() {
                      const matched = applyFilters(usuarios, filters);
                      if (!matched[0]) return { data: null, error: null };
                      Object.assign(matched[0], payload);
                      return { data: { ...matched[0] }, error: null };
                    }
                  };
                }
              };
              return chain;
            }
          };
        }
      };
    }
  };

  // 1. Sem JWT -> 401
  const noJwtRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset-own-password' })
    }),
    deps
  );
  assert.equal(noJwtRes.status, 401);

  // 2. Senha enviada pelo cliente é recusada (400)
  const clientPwdRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-gessika' },
      body: JSON.stringify({ action: 'reset-own-password', password: 'ClientPassword1!' })
    }),
    deps
  );
  assert.equal(clientPwdRes.status, 400);
  assert.equal(authUpdateCalls.length, 0);

  // 3. Sem matrícula, sem vínculo e usuário inativo recebem o mesmo HTTP 403 e erro genérico idêntico
  const noMatRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-nomat' },
      body: JSON.stringify({ action: 'reset-own-password' })
    }),
    deps
  );
  assert.equal(noMatRes.status, 403);
  const noMatText = await noMatRes.text();
  assert.equal(/matr[ií]cula/i.test(noMatText), false);

  const inactiveRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-inativo' },
      body: JSON.stringify({ action: 'reset-own-password' })
    }),
    deps
  );
  assert.equal(inactiveRes.status, 403);
  const inactiveText = await inactiveRes.text();

  const unlinkedRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-sem-vinculo' },
      body: JSON.stringify({ action: 'reset-own-password' })
    }),
    deps
  );
  assert.equal(unlinkedRes.status, 403);
  const unlinkedText = await unlinkedRes.text();

  assert.equal(noMatText, inactiveText);
  assert.equal(noMatText, unlinkedText);
  assert.equal(authUpdateCalls.length, 0);

  // 4. Analista executa reset-own-password mesmo tentando apontar outro usuarioId/email ->
  //    ignora alvo do cliente, usa auth.uid(), gera Csb@12345Gessika no servidor, marca force_password_change=true,
  //    registra auditoria sem senha e nunca devolve a senha na resposta
  const ok1 = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-gessika' },
      body: JSON.stringify({
        action: 'reset-own-password',
        usuarioId: 'usr_outro_92',
        email: 'outro@example.invalid',
        authUserId: synthOtherUid
      })
    }),
    deps
  );
  assert.equal(ok1.status, 200);
  const ok1Text = await ok1.text();
  assert.equal(ok1Text.includes('Csb@12345Gessika'), false);
  assert.equal(ok1Text.includes('Csb@'), false);
  const ok1Json = JSON.parse(ok1Text);
  assert.equal(ok1Json.success, true);
  assert.equal(ok1Json.forcePasswordChange, true);
  assert.equal(authUpdateCalls.length, 1);
  assert.equal(authUpdateCalls[0].id, synthAnalystUid);
  assert.equal(authUpdateCalls[0].password, 'Csb@12345Gessika');
  assert.equal(usuarios.find(u => u.id === 'usr_gessika_91')?.force_password_change, true);
  assert.equal(usuarios.find(u => u.id === 'usr_outro_92')?.force_password_change, false);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].event, 'reset-own-password');
  assert.equal(auditEvents[0].usuarioId, 'usr_gessika_91');
  assert.equal(JSON.stringify(auditEvents[0]).includes('Csb@12345Gessika'), false);
  assert.equal(auditDbRows.length, 1);
  assert.equal(JSON.stringify(auditDbRows[0]).includes('Csb@12345Gessika'), false);

  // 5. Analista continua bloqueado (403) para gerenciamento administrativo de outros usuários
  const adminActionRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-gessika' },
      body: JSON.stringify({ action: 'create-user', nome: 'X', email: 'x@example.invalid', papel: 'Usuário' })
    }),
    deps
  );
  assert.equal(adminActionRes.status, 403);

  // 6. Rate limit: 2ª e 3ª chamadas dentro de 1h passam; 4ª retorna 429; após +1h volta a permitir
  for (let i = 0; i < 2; i += 1) {
    currentNow += 5 * 60 * 1000;
    const res = await handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-gessika' },
        body: JSON.stringify({ action: 'reset-own-password' })
      }),
      deps
    );
    assert.equal(res.status, 200);
  }
  assert.equal(authUpdateCalls.length, 3);

  currentNow += 60 * 1000;
  const rateLimitedRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-gessika' },
      body: JSON.stringify({ action: 'reset-own-password' })
    }),
    deps
  );
  assert.equal(rateLimitedRes.status, 429);
  assert.equal(authUpdateCalls.length, 3);

  // Avança > 1 hora da primeira chamada
  currentNow += 60 * 60 * 1000;
  const afterWindowRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-gessika' },
      body: JSON.stringify({ action: 'reset-own-password' })
    }),
    deps
  );
  assert.equal(afterWindowRes.status, 200);
  assert.equal(authUpdateCalls.length, 4);

  // 7. Cliente: resetOwnPasswordToDefault encerra sessão e retorna mensagem esperada
  let signedOut = false;
  const clientMock: any = {
    auth: {
      async signOut() {
        signedOut = true;
        return { error: null };
      }
    },
    functions: {
      async invoke(fn: string, opts: any) {
        assert.equal(fn, 'admin-manage-user');
        assert.equal(opts?.body?.action, 'reset-own-password');
        return {
          data: {
            success: true,
            message: 'Senha redefinida. Entre com a senha padrão e crie uma nova.'
          },
          error: null
        };
      }
    }
  };
  const clientSvc = createAuthService(() => ({ client: clientMock, configured: true }));
  const clientResetRes = await clientSvc.resetOwnPasswordToDefault();
  assert.equal(clientResetRes.success, true);
  assert.equal(signedOut, true);
  assert.equal(clientResetRes.message, 'Senha redefinida. Entre com a senha padrão e crie uma nova.');
});

test('Edge Function reset-own-password: reserva atômica via RPC reserve_password_reset_rate_limit (concorrência, 3/hora, 429, falha fechada sem alterar senha e janela expirada)', async () => {
  const synthUid = '00000000-0000-4000-8000-000000000097';
  const spoofUid = '00000000-0000-4000-8000-000000000098';
  let currentNow = Date.UTC(2026, 10, 24, 18, 0, 0);
  let failRpc = true;
  const callSequence: string[] = [];
  const rpcCalls: Array<Record<string, any>> = [];
  const rateLimitRows: Array<{
    id: string;
    auth_user_id: string;
    usuario_id: string;
    action: string;
    created_at: string;
  }> = [];
  const authUpdates: Array<{ id: string; password?: string }> = [];
  const userRow = {
    id: 'usr_persist_97',
    auth_user_id: synthUid,
    nome: 'Ana Paula',
    matricula: '77777',
    login: 'ana.paula',
    email: 'ana@example.invalid',
    papel: 'Analista',
    situacao: 'Ativo',
    status: 'Ativo',
    force_password_change: false
  };

  // Simula lock transacional por auth_user_id (pg_advisory_xact_lock) no mock da RPC
  let rpcLockQueue: Promise<void> = Promise.resolve();
  const withSerializedRpc = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = rpcLockQueue;
    let release!: () => void;
    rpcLockQueue = new Promise<void>(resolve => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };

  const deps = {
    envGet(name: string) {
      if (name === 'SUPABASE_URL') return 'https://example.invalid';
      if (name === 'SUPABASE_SERVICE_ROLE_KEY') return 'synth-service-role-key-97';
      return undefined;
    },
    now: () => currentNow,
    createSupabaseClient() {
      return {
        auth: {
          async getUser(jwt: string) {
            if (jwt === 'jwt-persist') return { data: { user: { id: synthUid } }, error: null };
            return { data: { user: null }, error: { message: 'Invalid JWT' } };
          },
          admin: {
            async updateUserById(id: string, patch: any) {
              callSequence.push('auth:updateUserById');
              await new Promise(resolve => setTimeout(resolve, 10));
              authUpdates.push({ id, password: patch?.password });
              return { error: null };
            }
          }
        },
        async rpc(fnName: string, params: Record<string, any>) {
          assert.equal(fnName, 'reserve_password_reset_rate_limit');
          rpcCalls.push({ ...params });
          callSequence.push('rpc:reserve_password_reset_rate_limit');

          return withSerializedRpc(async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            if (failRpc) {
              return { data: null, error: { message: 'rpc unavailable' } };
            }

            const nowMs = Date.parse(params.p_now);
            const windowMs = Number(params.p_window_minutes || 60) * 60 * 1000;
            const windowStartMs = nowMs - windowMs;
            const maxAttempts = Number(params.p_max_attempts || 3);
            const recentCount = rateLimitRows.filter(
              row =>
                row.auth_user_id === params.p_auth_user_id &&
                row.action === params.p_action &&
                Date.parse(row.created_at) > windowStartMs
            ).length;

            if (recentCount >= maxAttempts) {
              return {
                data: [{ allowed: false, current_count: recentCount, reservation_id: null }],
                error: null
              };
            }

            const reservationId = `rl_${rateLimitRows.length + 1}`;
            rateLimitRows.push({
              id: reservationId,
              auth_user_id: params.p_auth_user_id,
              usuario_id: params.p_usuario_id,
              action: params.p_action,
              created_at: params.p_now
            });

            return {
              data: [{ allowed: true, current_count: recentCount + 1, reservation_id: reservationId }],
              error: null
            };
          });
        },
        from(table: string) {
          if (table === 'historico_alteracoes_dados') {
            return { async insert() { return { error: null }; } };
          }
          assert.equal(table, 'usuarios');
          return {
            select() {
              const filters: Record<string, any> = {};
              const chain: any = {
                eq(col: string, val: any) {
                  filters[col] = val;
                  return chain;
                },
                async maybeSingle() {
                  const ok = Object.entries(filters).every(([k, v]) => (userRow as any)[k] === v);
                  return { data: ok ? { ...userRow } : null, error: null };
                }
              };
              return chain;
            },
            update(payload: Record<string, any>) {
              const filters: Record<string, any> = {};
              const chain: any = {
                eq(col: string, val: any) {
                  filters[col] = val;
                  return chain;
                },
                select() {
                  return {
                    async maybeSingle() {
                      const ok = Object.entries(filters).every(([k, v]) => (userRow as any)[k] === v);
                      if (!ok) return { data: null, error: null };
                      callSequence.push('db:usuarios.update');
                      Object.assign(userRow, payload);
                      return { data: { ...userRow }, error: null };
                    }
                  };
                }
              };
              return chain;
            }
          };
        }
      };
    }
  };

  // 1. Falha fechada da RPC: erro em reserve_password_reset_rate_limit não altera senha nem grava reserva
  const rpcFailRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-persist' },
      body: JSON.stringify({ action: 'reset-own-password' })
    }),
    deps
  );
  assert.equal(rpcFailRes.status, 500);
  const rpcFailJson = await rpcFailRes.json();
  assert.equal(rpcFailJson.success, false);
  assert.equal(authUpdates.length, 0);
  assert.equal(rateLimitRows.length, 0);

  // 2. Duas solicitações concorrentes simultâneas (inclusive com spoof de auth_user_id/usuario_id no body):
  //    RPC serializa, usa exclusivamente callerUser.id/callerProfile.id e reserva antes de updateUserById
  failRpc = false;
  currentNow += 5 * 60 * 1000;
  const [conc1, conc2] = await Promise.all([
    handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-persist' },
        body: JSON.stringify({
          action: 'reset-own-password',
          auth_user_id: spoofUid,
          usuario_id: 'usr_spoof_98'
        })
      }),
      deps
    ),
    handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-persist' },
        body: JSON.stringify({
          action: 'reset-own-password',
          authUserId: spoofUid,
          usuarioId: 'usr_spoof_98'
        })
      }),
      deps
    )
  ]);
  assert.equal(conc1.status, 200);
  assert.equal(conc2.status, 200);
  assert.equal(authUpdates.length, 2);
  assert.equal(rateLimitRows.length, 2);
  assert.equal(rpcCalls[1].p_auth_user_id, synthUid);
  assert.equal(rpcCalls[1].p_usuario_id, 'usr_persist_97');
  assert.equal(rpcCalls[2].p_auth_user_id, synthUid);
  assert.equal(rpcCalls[2].p_usuario_id, 'usr_persist_97');
  assert.ok(
    callSequence.indexOf('rpc:reserve_password_reset_rate_limit') <
      callSequence.indexOf('auth:updateUserById')
  );

  // 3. Mais duas solicitações concorrentes disputando a 3ª e última vaga: apenas 1 passa (200) e a outra é bloqueada (429)
  currentNow += 5 * 60 * 1000;
  const [race3, race4] = await Promise.all([
    handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-persist' },
        body: JSON.stringify({ action: 'reset-own-password' })
      }),
      deps
    ),
    handleAdminManageUserRequest(
      new Request('https://example.invalid/admin-manage-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-persist' },
        body: JSON.stringify({ action: 'reset-own-password' })
      }),
      deps
    )
  ]);
  assert.deepEqual([race3.status, race4.status].sort(), [200, 429]);
  assert.equal(authUpdates.length, 3);
  assert.equal(rateLimitRows.length, 3);

  // 4. Quarta tentativa sequencial dentro de 60 minutos também é bloqueada com 429 genérico sem alterar senha
  currentNow += 60 * 1000;
  const blockedRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-persist' },
      body: JSON.stringify({ action: 'reset-own-password' })
    }),
    deps
  );
  assert.equal(blockedRes.status, 429);
  assert.equal(authUpdates.length, 3);
  assert.equal(rateLimitRows.length, 3);

  // 5. Após expirar a janela de 60 minutos desde os registros anteriores, volta a permitir
  currentNow += 61 * 60 * 1000;
  const afterWindowRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-persist' },
      body: JSON.stringify({ action: 'reset-own-password' })
    }),
    deps
  );
  assert.equal(afterWindowRes.status, 200);
  assert.equal(authUpdates.length, 4);
  assert.equal(rateLimitRows.length, 4);
});

test('Edge Function index.ts (produção): monta dependências sem rateLimitStore, força RPC reserve_password_reset_rate_limit e falha fechado se a RPC der erro', async () => {
  const indexSrc = fs.readFileSync(
    path.join(process.cwd(), 'supabase/functions/admin-manage-user/index.ts'),
    'utf8'
  );
  assert.equal(indexSrc.includes('new Map'), false);
  assert.match(indexSrc, /rateLimitStore\?:\s*never/);
  assert.match(indexSrc, /handleAdminManageUserRequest\(req,\s*productionDeps\)/);

  const synthUid = '00000000-0000-4000-8000-000000000099';
  let rpcFail = true;
  const rpcCalls: Array<{ fnName: string; params: Record<string, any> }> = [];
  const authUpdates: Array<{ id: string; password?: string }> = [];
  const userRow = {
    id: 'usr_prod_99',
    auth_user_id: synthUid,
    nome: 'Carlos Silva',
    matricula: '88888',
    login: 'carlos.silva',
    email: 'carlos@example.invalid',
    papel: 'Analista',
    situacao: 'Ativo',
    status: 'Ativo',
    force_password_change: false
  };

  // Mesmo formato de dependências usado em index.ts (+ DENO_DEPLOYMENT_ID simulando Edge Runtime real).
  // Mesmo se alguém tentasse injetar um Map em ambiente com DENO_DEPLOYMENT_ID, handler.ts ignora o Map e usa a RPC.
  const prodLikeDeps: any = {
    envGet(name: string) {
      if (name === 'SUPABASE_URL') return 'https://example.invalid';
      if (name === 'SUPABASE_SERVICE_ROLE_KEY') return 'synth-service-role-prod';
      if (name === 'DENO_DEPLOYMENT_ID') return 'dep-prod-01';
      return undefined;
    },
    rateLimitStore: new Map<string, number[]>(),
    createSupabaseClient() {
      return {
        auth: {
          async getUser(jwt: string) {
            if (jwt === 'jwt-prod') return { data: { user: { id: synthUid } }, error: null };
            return { data: { user: null }, error: { message: 'Invalid JWT' } };
          },
          admin: {
            async updateUserById(id: string, patch: any) {
              authUpdates.push({ id, password: patch?.password });
              return { error: null };
            }
          }
        },
        async rpc(fnName: string, params: Record<string, any>) {
          rpcCalls.push({ fnName, params });
          if (rpcFail) {
            return { data: null, error: { message: 'database connection refused' } };
          }
          return {
            data: [{ allowed: true, current_count: 1, reservation_id: 'rl_prod_1' }],
            error: null
          };
        },
        from(table: string) {
          if (table === 'historico_alteracoes_dados') {
            return { async insert() { return { error: null }; } };
          }
          assert.equal(table, 'usuarios');
          return {
            select() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return { data: { ...userRow }, error: null };
                    }
                  };
                }
              };
            },
            update(payload: Record<string, any>) {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        select() {
                          return {
                            async maybeSingle() {
                              Object.assign(userRow, payload);
                              return { data: { ...userRow }, error: null };
                            }
                          };
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  // 1. Falha na RPC -> falha fechado (500) e nunca altera a senha no Auth
  const failRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-prod' },
      body: JSON.stringify({ action: 'reset-own-password' })
    }),
    prodLikeDeps
  );
  assert.equal(failRes.status, 500);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fnName, 'reserve_password_reset_rate_limit');
  assert.equal('p_now' in rpcCalls[0].params, false);
  assert.equal(authUpdates.length, 0);

  // 2. Com RPC operacional e sem deps.rateLimitStore (formato exato de index.ts), usa a RPC e conclui reset
  delete prodLikeDeps.rateLimitStore;
  rpcFail = false;
  const okRes = await handleAdminManageUserRequest(
    new Request('https://example.invalid/admin-manage-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-prod' },
      body: JSON.stringify({ action: 'reset-own-password' })
    }),
    prodLikeDeps
  );
  assert.equal(okRes.status, 200);
  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[1].fnName, 'reserve_password_reset_rate_limit');
  assert.equal(rpcCalls[1].params.p_auth_user_id, synthUid);
  assert.equal(rpcCalls[1].params.p_usuario_id, 'usr_prod_99');
  assert.equal(authUpdates.length, 1);
});

test('Recuperação de senha por e-mail: redirectTo com origin dinâmico, detecção/limpeza do hash recovery e completeRecoveryPasswordChange', async () => {
  const synthUid = '00000000-0000-4000-8000-000000000099';
  const originalWindow = (globalThis as any).window;
  let capturedRedirectTo = '';
  let capturedHash = '#access_token=synth-tok&refresh_token=synth-ref&type=recovery';
  let replaceStateCalls = 0;

  (globalThis as any).window = {
    location: {
      origin: 'https://administra.sema.example.invalid',
      pathname: '/login',
      search: '',
      get hash() {
        return capturedHash;
      },
      set hash(v: string) {
        capturedHash = v;
      }
    },
    history: {
      state: { view: 'home' },
      replaceState(_state: any, _title: string, url: string) {
        replaceStateCalls += 1;
        if (!url.includes('#')) capturedHash = '';
      }
    }
  };

  try {
    assert.equal(hasRecoveryTokenInHash(), true);
    assert.equal(hasRecoveryTokenInHash('#access_token=abc&type=recovery'), true);
    assert.equal(hasRecoveryTokenInHash('#access_token=abc&type=signup'), false);
    assert.equal(hasRecoveryTokenInHash(''), false);

    clearAuthHashFromUrl();
    assert.equal(capturedHash, '');
    assert.equal(replaceStateCalls, 1);

    const forceFlag = false;
    const updatedPasswords: string[] = [];
    let completeInvokedInRecovery = 0;
    const mockClient: any = {
      auth: {
        async resetPasswordForEmail(_email: string, opts: { redirectTo?: string }) {
          capturedRedirectTo = String(opts?.redirectTo || '');
          return { error: null };
        },
        async getSession() {
          return {
            data: { session: { access_token: 'tok-rec', user: { id: synthUid } } },
            error: null
          };
        },
        async updateUser({ password }: { password: string }) {
          updatedPasswords.push(password);
          return { error: null };
        }
      },
      functions: {
        async invoke(_fn: string, opts: any) {
          if (opts?.body?.action === 'complete-password-change') {
            completeInvokedInRecovery += 1;
          }
          return { data: null, error: null };
        }
      },
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        id: 'usr_rec_99',
                        auth_user_id: synthUid,
                        nome: 'Servidor Recuperação',
                        login: 'rec.user',
                        email: 'rec@example.invalid',
                        matricula: 'MAT-99',
                        papel: 'Usuário',
                        situacao: 'Ativo',
                        force_password_change: forceFlag
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

    const svc = createAuthService(() => ({ client: mockClient, configured: true }));
    const emailRes = await svc.sendPasswordReset('rec@example.invalid');
    assert.equal(emailRes.success, true);
    assert.equal(capturedRedirectTo, 'https://administra.sema.example.invalid');
    assert.equal(capturedRedirectTo.includes('localhost'), false);

    const shortRecovery = await svc.completeRecoveryPasswordChange('1234567', '1234567');
    assert.equal(shortRecovery.success, false);
    assert.match(String(shortRecovery.error), /8 caracteres/);
    assert.equal(updatedPasswords.length, 0);

    const okRecovery = await svc.completeRecoveryPasswordChange('NovaRec@8', 'NovaRec@8');
    assert.equal(okRecovery.success, true);
    assert.deepEqual(updatedPasswords, ['NovaRec@8']);
    assert.equal(okRecovery.profile?.forcePasswordChange, false);
    assert.equal(completeInvokedInRecovery, 0);

    const recPageHtml = renderToStaticMarkup(
      React.createElement(ForcePasswordChangePage, {
        mode: 'recovery',
        profile: {
          id: 'usr_rec_99',
          authUserId: synthUid,
          nome: 'Servidor Recuperação',
          login: 'rec.user',
          email: 'rec@example.invalid',
          matricula: 'MAT-99',
          perfilProfissional: 'Analista',
          setor: 'CSB',
          papel: 'Usuário',
          situacao: 'Ativo',
          forcePasswordChange: false,
          createdAt: '2026-11-24T00:00:00.000Z'
        },
        onPasswordChanged: () => {},
        onLogout: () => {}
      })
    );
    assert.ok(recPageHtml.includes('REDEFINIÇÃO DE SENHA'));

    const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
    assert.equal(appSrc.includes('PASSWORD_RECOVERY'), true);
    assert.equal(appSrc.includes('hasRecoveryTokenInHash'), true);
    assert.equal(appSrc.includes('clearAuthHashFromUrl'), true);
    assert.equal(appSrc.includes('isPasswordRecoveryMode'), true);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  }
});



