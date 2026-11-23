// tests/appRoutes.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, preview } from 'vite';
import {
  ADMIN_ONLY_VIEWS,
  APP_ROUTE_PATHS,
  SPA_FALLBACK_ROUTE_PATHS,
  bindPopStateNavigation,
  getPathForView,
  getViewFromPathname,
  normalizeAppPathname,
  resolveAuthorizedAppView,
  syncBrowserUrlForView,
  type AppViewKey
} from '../src/utils/appRoutes';
import { isBlockedPrivateRequestPath } from '../src/server/privatePathGuard';

function createMockBrowserNavigation(initialPathname = '/') {
  const entries: Array<{ view: string; url: string }> = [{ view: getViewFromPathname(initialPathname), url: initialPathname }];
  let cursor = 0;
  const listeners = new Map<string, Set<() => void>>();

  const location = {
    get pathname() {
      return entries[cursor]?.url || '/';
    }
  };

  const history = {
    get state() {
      return { view: entries[cursor]?.view };
    },
    pushState(state: any, _title: string, url: string) {
      entries.splice(cursor + 1);
      entries.push({ view: String(state?.view || ''), url: String(url) });
      cursor = entries.length - 1;
    },
    replaceState(state: any, _title: string, url: string) {
      entries[cursor] = { view: String(state?.view || ''), url: String(url) };
    },
    back() {
      if (cursor > 0) {
        cursor -= 1;
        dispatch('popstate');
      }
    },
    forward() {
      if (cursor < entries.length - 1) {
        cursor += 1;
        dispatch('popstate');
      }
    }
  };

  function dispatch(eventName: string) {
    const set = listeners.get(eventName);
    if (!set) return;
    for (const fn of set) fn();
  }

  const windowObj = {
    location,
    history,
    addEventListener(eventName: string, fn: () => void) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName)!.add(fn);
    },
    removeEventListener(eventName: string, fn: () => void) {
      listeners.get(eventName)?.delete(fn);
    }
  };

  return {
    windowObj,
    entries,
    getCursor: () => cursor
  };
}

test('mapeamento bidirecional de rotas preserva todas as telas e aliases esperados', () => {
  for (const [view, routePath] of Object.entries(APP_ROUTE_PATHS)) {
    assert.equal(getPathForView(view), routePath);
    assert.equal(getViewFromPathname(routePath), view);
    if (routePath !== '/') {
      assert.equal(getViewFromPathname(`${routePath}/`), view);
      assert.equal(getViewFromPathname(routePath.toUpperCase()), view);
    }
  }

  assert.equal(getViewFromPathname('/revisoes'), 'revisoes');
  assert.equal(getViewFromPathname('/solicitacoes_vistoria'), 'solicitacoes_vistoria');
  assert.equal(getViewFromPathname('/index.html'), 'home');
  assert.equal(getViewFromPathname('/rota-inexistente'), 'home');
  assert.equal(getPathForView('desconhecida'), '/');
  assert.equal(normalizeAppPathname('/barragens/?filtro=1#topo'), '/barragens');
});

test('fluxo completo de clique/navegação, atualização da URL, recarregamento direto, voltar/avançar e RBAC', () => {
  const originalWindow = (globalThis as any).window;
  const browser = createMockBrowserNavigation('/');
  (globalThis as any).window = browser.windowObj;

  try {
    let activeView: AppViewKey = getViewFromPathname(window.location.pathname);
    let userRole: 'Administrador' | 'Analista' = 'Analista';
    const cleanupPopState = bindPopStateNavigation(nextView => {
      activeView = nextView;
    });

    const clickNavigate = (requested: string) => {
      const resolved = resolveAuthorizedAppView(requested, {
        userRole,
        enforceAdminGuard: true
      });
      if (!resolved.allowed) return false;
      activeView = resolved.view;
      syncBrowserUrlForView(resolved.view);
      return true;
    };

    // 1. Clique/navegação por módulos atualiza activeView e URL do navegador
    assert.equal(activeView, 'home');
    assert.equal(window.location.pathname, '/');

    for (const [view, expectedPath] of Object.entries(APP_ROUTE_PATHS) as Array<[AppViewKey, string]>) {
      if (ADMIN_ONLY_VIEWS.has(view)) continue;
      assert.equal(clickNavigate(view), true);
      assert.equal(activeView, view);
      assert.equal(window.location.pathname, expectedPath);
    }

    // 2. Navegação restrita para não-administrador não altera URL nem polui histórico
    const historyLenBeforeDenied = browser.entries.length;
    assert.equal(clickNavigate('usuarios'), false);
    assert.equal(window.location.pathname, '/referencias');
    assert.equal(browser.entries.length, historyLenBeforeDenied);

    // Administrador navega normalmente para rotas administrativas
    userRole = 'Administrador';
    assert.equal(clickNavigate('usuarios'), true);
    assert.equal(activeView, 'usuarios');
    assert.equal(window.location.pathname, '/usuarios');

    // 3. Clique em "Barragens cadastradas" seguido de voltar e avançar (popstate)
    assert.equal(clickNavigate('barragens'), true);
    assert.equal(activeView, 'barragens');
    assert.equal(window.location.pathname, '/barragens');

    assert.equal(clickNavigate('solicitacoes_vistoria'), true);
    assert.equal(activeView, 'solicitacoes_vistoria');
    assert.equal(window.location.pathname, '/solicitacoes-vistoria');

    const lenBeforePopState = browser.entries.length;
    browser.windowObj.history.back();
    assert.equal(window.location.pathname, '/barragens');
    assert.equal(activeView, 'barragens');
    assert.equal(browser.entries.length, lenBeforePopState);

    browser.windowObj.history.forward();
    assert.equal(window.location.pathname, '/solicitacoes-vistoria');
    assert.equal(activeView, 'solicitacoes_vistoria');
    assert.equal(browser.entries.length, lenBeforePopState);

    cleanupPopState();
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  }
});

test('recarregamento direto (F5) ou rota colada na barra preserva o módulo inicial e respeita RBAC após auth', () => {
  for (const [view, routePath] of Object.entries(APP_ROUTE_PATHS) as Array<[AppViewKey, string]>) {
    // Simula F5 / abertura direta da URL
    const restoredView = getViewFromPathname(routePath);
    assert.equal(restoredView, view);

    // Após verificação de auth: Administrador mantém qualquer rota; não-admin redireciona rotas admin para home
    const adminCheck = resolveAuthorizedAppView(restoredView, {
      userRole: 'Administrador',
      enforceAdminGuard: true
    });
    assert.equal(adminCheck.allowed, true);
    assert.equal(adminCheck.view, view);

    const analystCheck = resolveAuthorizedAppView(restoredView, {
      userRole: 'Analista',
      enforceAdminGuard: true
    });
    if (ADMIN_ONLY_VIEWS.has(view)) {
      assert.equal(analystCheck.allowed, false);
      assert.equal(analystCheck.view, 'home');
    } else {
      assert.equal(analystCheck.allowed, true);
      assert.equal(analystCheck.view, view);
    }
  }
});

test('App.tsx roteia todas as telas via navigateToView/bindPopStateNavigation sem chamadas diretas a setActiveView fora do roteador', () => {
  const appSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');

  const viewNamesMatch = appSrc.match(/const viewNames:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(viewNamesMatch, 'viewNames deve existir em src/App.tsx');
  const viewKeys = [...viewNamesMatch[1].matchAll(/^\s*([a-z0-9_]+)\s*:/gm)].map(m => m[1]);
  assert.deepEqual([...viewKeys].sort(), Object.keys(APP_ROUTE_PATHS).sort());

  // Nenhuma transição de tela deve usar setActiveView diretamente fora de navigateToView e bindPopStateNavigation
  const setActiveViewMatches = appSrc.match(/\bsetActiveView\s*\(/g) || [];
  assert.equal(setActiveViewMatches.length, 2, 'Somente navigateToView e bindPopStateNavigation devem chamar setActiveView');

  assert.ok(appSrc.includes("navigateToView('barragens')"));
  assert.ok(appSrc.includes('bindPopStateNavigation('));
  assert.ok(appSrc.includes('syncBrowserUrlForView('));
});

test('build publicado inclui código de roteamento e preview server entrega shell HTML em todas as rotas SPA sem expor arquivos privados', async () => {
  const vercelConfig = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')
  );
  const spaRewrites = (vercelConfig.rewrites || []).filter(
    (rw: any) => rw.destination === '/index.html'
  );
  const rewriteSources = spaRewrites.map((rw: any) => rw.source).sort();

  assert.deepEqual(rewriteSources, [...SPA_FALLBACK_ROUTE_PATHS].sort());

  for (const routePath of SPA_FALLBACK_ROUTE_PATHS) {
    assert.equal(isBlockedPrivateRequestPath(routePath, { isPreview: false }), false);
    assert.equal(isBlockedPrivateRequestPath(routePath, { isPreview: true }), false);
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'administra-routes-build-'));
  try {
    await build({
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true }
    });

    const builtHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    const scriptMatch = builtHtml.match(/src="(\/assets\/[^"]+\.js)"/);
    assert.ok(scriptMatch, 'index.html compilado deve referenciar bundle JS');

    const bundlePath = path.join(outDir, scriptMatch[1].replace(/^\//, ''));
    const builtJs = fs.readFileSync(bundlePath, 'utf8');
    for (const routePath of ['/empreendedores', '/barragens', '/conciliacao', '/solicitacoes-vistoria', '/usuarios', '/integracao', '/referencias']) {
      assert.ok(builtJs.includes(routePath), `Bundle publicado deve conter rota ${routePath}`);
    }
    assert.ok(builtJs.includes('pushState'));
    assert.ok(builtJs.includes('replaceState'));
    assert.ok(builtJs.includes('popstate'));

    const previewServer = await preview({
      logLevel: 'silent',
      build: { outDir },
      preview: { host: '127.0.0.1', port: 0 }
    });

    try {
      const baseUrl = (previewServer.resolvedUrls?.local?.[0] || '').replace(/\/$/, '');
      assert.ok(baseUrl);

      for (const routePath of ['/', ...SPA_FALLBACK_ROUTE_PATHS]) {
        const res = await fetch(`${baseUrl}${routePath}`, {
          headers: { Accept: 'text/html,application/xhtml+xml,*/*' }
        });
        assert.equal(res.status, 200, `Rota ${routePath} deveria retornar HTTP 200 no recarregamento direto`);
        const html = await res.text();
        assert.ok(html.includes('<div id="root">'));
        assert.ok(html.includes(scriptMatch[1]));
        assert.match(html, /noindex,\s*nofollow/i);
      }
    } finally {
      (previewServer.httpServer as any).closeAllConnections?.();
      await previewServer.close();
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
