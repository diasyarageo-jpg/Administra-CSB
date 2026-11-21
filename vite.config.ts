// vite.config.ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

function registerApiMiddlewares(
  middlewares: { use: (route: string, fn: (req: any, res: any, next: any) => void) => void },
  loadModule: (file: string) => Promise<any>
) {
  const endpoints: Record<string, string> = {
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

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiDevPlugin()],
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
