// tests/appRoutes.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  APP_ROUTE_PATHS,
  SPA_FALLBACK_ROUTE_PATHS,
  getPathForView,
  getViewFromPathname,
  normalizeAppPathname,
  syncBrowserUrlForView
} from '../src/utils/appRoutes';
import { isBlockedPrivateRequestPath } from '../src/server/privatePathGuard';

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

test('syncBrowserUrlForView atualiza history.pushState e replaceState sem duplicar entradas', () => {
  const originalWindow = (globalThis as any).window;
  const calls: Array<{ method: string; view: string; url: string }> = [];
  const fakeLocation = { pathname: '/' };

  (globalThis as any).window = {
    location: fakeLocation,
    history: {
      pushState(state: any, _title: string, url: string) {
        calls.push({ method: 'pushState', view: state?.view, url });
        fakeLocation.pathname = url;
      },
      replaceState(state: any, _title: string, url: string) {
        calls.push({ method: 'replaceState', view: state?.view, url });
        fakeLocation.pathname = url;
      }
    }
  };

  try {
    syncBrowserUrlForView('barragens');
    assert.equal(fakeLocation.pathname, '/barragens');
    assert.deepEqual(calls, [{ method: 'pushState', view: 'barragens', url: '/barragens' }]);

    // Mesma rota não deve gerar entrada duplicada no histórico
    syncBrowserUrlForView('barragens');
    assert.equal(calls.length, 1);

    // Alias normalizado usa replaceState
    fakeLocation.pathname = '/barragens/';
    syncBrowserUrlForView('barragens', { replace: true });
    assert.equal(fakeLocation.pathname, '/barragens');
    assert.equal(calls[1]?.method, 'replaceState');

    syncBrowserUrlForView('home', { replace: true });
    assert.equal(fakeLocation.pathname, '/');
    assert.equal(calls[2]?.method, 'replaceState');
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  }
});

test('rotas SPA liberadas no vercel.json não colidem com arquivos privados nem são bloqueadas pelo guard', () => {
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
});
