// tests/privateAssetsGuard.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build, createServer, preview } from 'vite';
import {
  ALLOWED_AISTUDIO_PUBLIC_ASSETS,
  createPrivatePathGuardMiddleware,
  isBlockedPrivateRequestPath
} from '../src/server/privatePathGuard';
import {
  MT_BORDER_COORDINATES,
  MT_OUTER_MASK_GEOJSON,
  MT_STATE_GEOJSON
} from '../src/data/mtGeoFallback';
import { LoginPage } from '../src/components/LoginPage';

const ROOT_DIR = process.cwd();

function listFilesRecursive(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

test('public/ contém apenas assets institucionais e dados geográficos ativos do mapa', () => {
  const aistudioDir = path.join(ROOT_DIR, 'public', 'assets', 'aistudio');
  const aistudioFiles = fs.readdirSync(aistudioDir).sort();
  assert.deepEqual(aistudioFiles, ['SISBAM-MT_S__DESENHO_76e8031e.png']);

  const allPublicFiles = listFilesRecursive(path.join(ROOT_DIR, 'public')).map(file =>
    path.relative(ROOT_DIR, file).replace(/\\/g, '/')
  );

  for (const rel of allPublicFiles) {
    assert.equal(/\.(sql|csv|tsv|dump|bak|sqlite|db|env|log)$/i.test(rel), false, `Arquivo sensível em public: ${rel}`);
    assert.equal(/image_[a-f0-9]+\.png$/i.test(rel), false, `Captura temporária em public: ${rel}`);
    assert.equal(/Paste_/i.test(rel), false, `Arquivo temporário Paste_ em public: ${rel}`);
  }

  assert.ok(allPublicFiles.includes('public/data/geojs-51-mun.json'));
  const munGeoJson = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'public', 'data', 'geojs-51-mun.json'), 'utf8')
  );
  assert.equal(munGeoJson.type, 'FeatureCollection');
  assert.equal(Array.isArray(munGeoJson.features), true);
  assert.equal(munGeoJson.features.length, 141);

  assert.ok(MT_BORDER_COORDINATES.length > 100);
  assert.equal(MT_OUTER_MASK_GEOJSON.type, 'Feature');
  assert.equal(MT_STATE_GEOJSON.type, 'Feature');

  const minimapSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'components', 'BarragensMinimap.tsx'),
    'utf8'
  );
  assert.equal(minimapSrc.includes('geojs-51-uf.json'), false);
  assert.equal(minimapSrc.includes('mt-outer-mask.json'), false);
  assert.equal(minimapSrc.includes('mtBorderFallback.json'), false);
  assert.ok(minimapSrc.includes('/data/geojs-51-mun.json'));
  assert.ok(minimapSrc.includes("from '../data/mtGeoFallback'"));
});

test('index.html e vercel.json preservam noindex/X-Robots-Tag sem regra SPA que converta rotas privadas em index.html', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
  assert.match(indexHtml, /<meta\s+name="robots"\s+content="noindex,\s*nofollow"\s*\/?>/i);

  const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'vercel.json'), 'utf8'));
  const rootHeaderRule = (vercelConfig.headers || []).find((h: any) => h.source === '/(.*)');
  assert.ok(rootHeaderRule);
  const robotsHeader = (rootHeaderRule.headers || []).find(
    (h: any) => String(h.key || '').toLowerCase() === 'x-robots-tag'
  );
  assert.equal(robotsHeader?.value, 'noindex, nofollow');

  const rewrites: Array<{ source?: string; destination?: string }> = vercelConfig.rewrites || [];
  for (const rw of rewrites) {
    assert.notEqual(rw.destination, '/index.html');
    assert.notEqual(rw.source, '/(.*)');
    assert.ok(String(rw.source || '').startsWith('/api/'));
  }
});

test('isBlockedPrivateRequestPath e middleware bloqueiam arquivos privados/exportações e liberam assets públicos', () => {
  const blockedUrls = [
    '/assets/aistudio/usuarios_rows_6a8603c6.sql',
    '/assets/aistudio/empreendedores_rows_0aebaf64.csv',
    '/assets/aistudio/image_5cf942ad.png',
    '/assets/aistudio/Paste_November_15__2026_-_3_07PM_c5a88352',
    '/assets/aistudio/%2e%2e/data/geojs-51-mun.json',
    '/assets/aistudio/SISBAM-MT_S__DESENHO_76e8031e.png.sql',
    '/docs/sql/administra_auth_user_link.sql',
    '/docs/ARQUITETURA_INTEGRACAO_DADOS.md',
    '/supabase/migrations/20261117_conciliacao_atomica_e_proveniencia.sql',
    '/.env',
    '/.env.example',
    '/.git/config',
    '/export.csv?download=1',
    '/dump.sql',
    '/package.json',
    '/vercel.json'
  ];

  for (const url of blockedUrls) {
    assert.equal(isBlockedPrivateRequestPath(url, { isPreview: false }), true, `Dev deveria bloquear ${url}`);
    assert.equal(isBlockedPrivateRequestPath(url, { isPreview: true }), true, `Preview deveria bloquear ${url}`);
  }

  assert.equal(isBlockedPrivateRequestPath('/src/main.tsx', { isPreview: false }), false);
  assert.equal(isBlockedPrivateRequestPath('/src/main.tsx', { isPreview: true }), true);

  const allowedUrls = [
    '/',
    '/index.html',
    '/assets/aistudio/SISBAM-MT_S__DESENHO_76e8031e.png',
    '/data/geojs-51-mun.json',
    '/assets/index-bundle.js',
    '/api/auth-config'
  ];

  for (const url of allowedUrls) {
    assert.equal(isBlockedPrivateRequestPath(url, { isPreview: true }), false, `Preview não deveria bloquear ${url}`);
  }
  assert.ok(ALLOWED_AISTUDIO_PUBLIC_ASSETS.has('/assets/aistudio/sisbam-mt_s__desenho_76e8031e.png'));

  const mw = createPrivatePathGuardMiddleware({ isPreview: true });
  let nextCalled = false;
  let endedBody = '';
  const headers: Record<string, string> = {};
  const mockRes = {
    statusCode: 200,
    headersSent: false,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    end(chunk?: string) {
      endedBody = String(chunk || '');
    }
  } as unknown as ServerResponse;

  mw(
    { url: '/assets/aistudio/usuarios_rows_6a8603c6.sql', headers: { accept: 'text/html' } } as IncomingMessage,
    mockRes,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, false);
  assert.equal(mockRes.statusCode, 404);
  assert.equal(headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(endedBody, 'Not found');
});

test('build de produção (dist/), preview server e telas principais/mapa carregam sem arquivos privados ou recursos ausentes', async () => {
  await build({ logLevel: 'silent' });

  const distFiles = listFilesRecursive(path.join(ROOT_DIR, 'dist')).map(file =>
    path.relative(ROOT_DIR, file).replace(/\\/g, '/')
  );

  for (const rel of distFiles) {
    assert.equal(/\.(sql|csv|tsv|dump|bak|sqlite|db|env|log)$/i.test(rel), false, `Arquivo privado no build: ${rel}`);
    assert.equal(/image_[a-f0-9]+\.png$/i.test(rel), false, `Captura no build: ${rel}`);
    assert.equal(/Paste_/i.test(rel), false, `Arquivo temporário no build: ${rel}`);
  }

  const distAistudio = distFiles.filter(f => f.startsWith('dist/assets/aistudio/'));
  assert.deepEqual(distAistudio, ['dist/assets/aistudio/SISBAM-MT_S__DESENHO_76e8031e.png']);
  assert.ok(distFiles.includes('dist/data/geojs-51-mun.json'));
  assert.ok(distFiles.includes('dist/index.html'));

  const jsBundles = distFiles.filter(f => /^dist\/assets\/.*\.js$/i.test(f));
  const cssBundles = distFiles.filter(f => /^dist\/assets\/.*\.css$/i.test(f));
  assert.ok(jsBundles.length >= 1);
  assert.ok(cssBundles.length >= 1);

  const builtJs = jsBundles
    .map(f => fs.readFileSync(path.join(ROOT_DIR, f), 'utf8'))
    .join('\n');
  const builtCss = cssBundles
    .map(f => fs.readFileSync(path.join(ROOT_DIR, f), 'utf8'))
    .join('\n');

  assert.ok(builtJs.includes('/data/geojs-51-mun.json'));
  assert.ok(builtJs.includes('Mato Grosso Outer Mask'));
  assert.ok(builtJs.includes('SISBAM-MT_S__DESENHO_76e8031e.png'));
  assert.ok(builtCss.includes('leaflet-container'));
  assert.ok(builtCss.includes('minimap-map-canvas'));

  const previewServer = await preview({
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 0 }
  });

  try {
    const resolvedUrl = previewServer.resolvedUrls?.local?.[0];
    assert.ok(resolvedUrl, 'Preview server deve expor URL local');
    const baseUrl = resolvedUrl.replace(/\/$/, '');

    const rootRes = await fetch(`${baseUrl}/`, { headers: { Accept: 'text/html' } });
    assert.equal(rootRes.status, 200);
    const rootHtml = await rootRes.text();
    assert.match(rootHtml, /noindex,\s*nofollow/i);

    const scriptMatch = rootHtml.match(/src="(\/assets\/[^"]+\.js)"/);
    assert.ok(scriptMatch, 'index.html compilado deve referenciar bundle JS');
    const bundleRes = await fetch(`${baseUrl}${scriptMatch[1]}`);
    assert.equal(bundleRes.status, 200);
    await bundleRes.text();

    const logoRes = await fetch(`${baseUrl}/assets/aistudio/SISBAM-MT_S__DESENHO_76e8031e.png`);
    assert.equal(logoRes.status, 200);
    assert.match(logoRes.headers.get('content-type') || '', /image\/png/i);
    await logoRes.arrayBuffer();

    const munRes = await fetch(`${baseUrl}/data/geojs-51-mun.json`);
    assert.equal(munRes.status, 200);
    const munData: any = await munRes.json();
    assert.equal(munData.type, 'FeatureCollection');
    assert.equal(munData.features.length, 141);

    const privateHtmlProbePaths = [
      '/assets/aistudio/usuarios_rows_6a8603c6.sql',
      '/assets/aistudio/empreendedores_rows_0aebaf64.csv',
      '/assets/aistudio/image_5cf942ad.png',
      '/assets/aistudio/Paste_November_15__2026_-_3_07PM_c5a88352',
      '/docs/sql/administra_auth_user_link.sql',
      '/supabase/migrations/20261117_conciliacao_atomica_e_proveniencia.sql',
      '/.env',
      '/.env.example',
      '/src/main.tsx'
    ];

    for (const probePath of privateHtmlProbePaths) {
      const res = await fetch(`${baseUrl}${probePath}`, {
        headers: { Accept: 'text/html,application/xhtml+xml,*/*' }
      });
      const body = await res.text();
      assert.equal(res.status, 404, `Rota privada ${probePath} retornou ${res.status}`);
      assert.equal(body.includes('<div id="root">'), false, `Rota privada ${probePath} caiu no fallback SPA`);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
    }
  } finally {
    (previewServer.httpServer as any).closeAllConnections?.();
    await previewServer.close();
  }

  const loginHtml = renderToStaticMarkup(
    React.createElement(LoginPage, { authConfigured: true, onLoginSuccess: () => {} })
  );
  assert.ok(loginHtml.includes('/assets/aistudio/SISBAM-MT_S__DESENHO_76e8031e.png'));

  // Verifica em modo dev middleware que arquivos privados retornam 404 sem cair no fallback SPA
  const devServer = await createServer({
    logLevel: 'silent',
    server: { middlewareMode: true, watch: null, hmr: false },
    appType: 'spa'
  });

  try {
    const runMiddlewareProbe = (url: string) =>
      new Promise<{ status: number; body: string; robots?: string }>((resolve, reject) => {
        let settled = false;
        const headers: Record<string, string> = {};
        const chunks: Buffer[] = [];
        const req = {
          url,
          method: 'GET',
          headers: { accept: 'text/html,application/xhtml+xml,*/*' }
        } as unknown as IncomingMessage;
        const res = {
          statusCode: 200,
          headersSent: false,
          setHeader(k: string, v: string | number | readonly string[]) {
            headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
          },
          getHeader(k: string) {
            return headers[k.toLowerCase()];
          },
          write(chunk: any) {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
            return true;
          },
          end(chunk?: any) {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
            if (!settled) {
              settled = true;
              resolve({
                status: res.statusCode,
                body: Buffer.concat(chunks).toString('utf8'),
                robots: headers['x-robots-tag']
              });
            }
          }
        } as unknown as ServerResponse;

        devServer.middlewares.handle(req, res, (err: any) => {
          if (err) {
            reject(err);
            return;
          }
          if (!settled) {
            settled = true;
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString('utf8'),
              robots: headers['x-robots-tag']
            });
          }
        });
      });

    const devBlocked = await runMiddlewareProbe('/assets/aistudio/usuarios_rows_6a8603c6.sql');
    assert.equal(devBlocked.status, 404);
    assert.equal(devBlocked.robots, 'noindex, nofollow');
    assert.equal(devBlocked.body.includes('<div id="root">'), false);
  } finally {
    await devServer.close();
  }
});
