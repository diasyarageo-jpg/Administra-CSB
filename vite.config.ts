// vite.config.ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, Plugin } from 'vite';

function cleanEnvString(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

function isSafePublicKeyForDefine(key: string): boolean {
  const clean = cleanEnvString(key);
  if (!clean || clean.includes('your-anon-public-key') || clean.startsWith('sb_secret_')) {
    return false;
  }
  const parts = clean.split('.');
  if (parts.length === 3) {
    try {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
      const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
      const role = String(parsed?.role || '').toLowerCase();
      if (role === 'service_role' || role === 'supabase_admin') {
        return false;
      }
    } catch {
      // noop
    }
  }
  return true;
}

function isValidPublicUrlForDefine(url: string): boolean {
  const clean = cleanEnvString(url);
  if (!clean || clean.includes('your-project-ref')) return false;
  try {
    const parsed = new URL(clean);
    return (
      (parsed.protocol === 'https:' ||
        (parsed.protocol === 'http:' &&
          (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))) &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function registerApiMiddlewares(
  middlewares: { use: (route: string, fn: (req: any, res: any, next: any) => void) => void },
  loadModule: (file: string) => Promise<any>
) {
  const endpoints: Record<string, string> = {
    '/api/auth-config': '/api/auth-config.ts',
    '/api/auth-session': '/api/auth-session.ts',
    '/api/car-lookup': '/api/car-lookup.ts',
    '/api/car-sync': '/api/car-sync.ts',
    '/api/sema-documentos': '/api/sema-documentos.ts',
    '/api/integracoes-status': '/api/integracoes-status.ts',
    '/api/conciliacao-gravar': '/api/conciliacao-gravar.ts',
    '/api/pendencias': '/api/pendencias.ts',
    '/api/solicitacoes-vistoria': '/api/solicitacoesVistoria.ts'
  };

  for (const [route, file] of Object.entries(endpoints)) {
    middlewares.use(route, async (req, res) => {
      try {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-Requested-With, Accept'
        );
        if ((req.method || '').toUpperCase() === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        const mod = await loadModule(file);
        const handler = mod.default || mod;
        await handler(req, res);
      } catch (err: any) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        res.end(
          JSON.stringify({
            error: err?.message || `Erro ao processar ${route} no servidor.`
          })
        );
      }
    });
  }
}

function apiDevPlugin(): Plugin {
  return {
    name: 'api-dev-middleware',
    configureServer(server) {
      registerApiMiddlewares(server.middlewares, file => server.ssrLoadModule(file));
    },
    async configurePreviewServer(server) {
      const { createServer } = await import('vite');
      const loaderServer = await createServer({
        server: { middlewareMode: true },
        appType: 'custom'
      });
      registerApiMiddlewares(server.middlewares, file => loaderServer.ssrLoadModule(file));
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const pickEnv = (...keys: string[]) => {
    for (const k of keys) {
      const val = cleanEnvString(env[k] ?? process.env[k] ?? '');
      if (val) return val;
    }
    return '';
  };

  const rawUrl = pickEnv(
    'VITE_SUPABASE_URL',
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'VITE_PUBLIC_SUPABASE_URL'
  ).replace(/\/+$/, '');
  const rawAnon = pickEnv(
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'VITE_PUBLIC_SUPABASE_ANON_KEY'
  );

  const safeUrl = isValidPublicUrlForDefine(rawUrl) ? rawUrl : '';
  const safeAnon = isSafePublicKeyForDefine(rawAnon) ? rawAnon : '';

  return {
    plugins: [react(), tailwindcss(), apiDevPlugin()],
    define: {
      __ADMINISTRA_PUBLIC_SUPABASE_URL__: JSON.stringify(safeUrl),
      __ADMINISTRA_PUBLIC_SUPABASE_ANON_KEY__: JSON.stringify(safeAnon)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      allowedHosts: true as const
    }
  };
});
