// src/server/privatePathGuard.ts
import type { IncomingMessage, ServerResponse } from 'http';
import path from 'path';

export const ALLOWED_AISTUDIO_PUBLIC_ASSETS = new Set<string>([
  '/assets/aistudio/sisbam-mt_s__desenho_76e8031e.png'
]);

const PRIVATE_FILE_EXTENSIONS = new Set<string>([
  '.sql',
  '.csv',
  '.tsv',
  '.dump',
  '.bak',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.env',
  '.log',
  '.pem',
  '.key',
  '.crt',
  '.p12'
]);

const PRIVATE_PREFIXES = [
  '/docs',
  '/supabase',
  '/tests',
  '/public',
  '/dist'
];

const PRIVATE_EXACT_PATHS = new Set<string>([
  '/package.json',
  '/package-lock.json',
  '/bun.lock',
  '/tsconfig.json',
  '/vercel.json',
  '/vite.config.ts',
  '/metadata.json',
  '/.gitignore'
]);

function decodePathnameSafely(rawPathname: string): { decoded: string; malformed: boolean } {
  let current = rawPathname;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) {
        return { decoded: current, malformed: false };
      }
      current = next;
    } catch {
      return { decoded: current, malformed: true };
    }
  }
  return { decoded: current, malformed: false };
}

function normalizeRequestPathname(rawUrl: string): {
  rawLower: string;
  normalized: string;
  hasTraversal: boolean;
  malformed: boolean;
} {
  const input = String(rawUrl || '/').trim() || '/';
  if (input.includes('\0')) {
    return { rawLower: '', normalized: '', hasTraversal: true, malformed: true };
  }

  let rawPathname = input.split('?')[0].split('#')[0] || '/';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPathname)) {
    const schemeEnd = rawPathname.indexOf('://');
    const pathStart = rawPathname.indexOf('/', schemeEnd + 3);
    rawPathname = pathStart >= 0 ? rawPathname.slice(pathStart) : '/';
  }

  const { decoded, malformed } = decodePathnameSafely(rawPathname);
  if (decoded.includes('\0')) {
    return { rawLower: '', normalized: '', hasTraversal: true, malformed: true };
  }

  const unifiedSlashes = decoded.replace(/\\+/g, '/').replace(/\/{2,}/g, '/');
  const rawSegments = unifiedSlashes.split('/').filter(Boolean);
  const hasTraversal = rawSegments.some(seg => seg === '..' || seg === '.');
  const posixNormalized = path.posix.normalize(unifiedSlashes.startsWith('/') ? unifiedSlashes : `/${unifiedSlashes}`);
  return {
    rawLower: unifiedSlashes.toLowerCase(),
    normalized: posixNormalized,
    hasTraversal,
    malformed
  };
}

export function isBlockedPrivateRequestPath(
  rawUrl: string,
  options: { isPreview?: boolean } = {}
): boolean {
  const { rawLower, normalized, hasTraversal, malformed } = normalizeRequestPathname(rawUrl);
  if (malformed || hasTraversal || !normalized) {
    return true;
  }

  const lowerPath = normalized.toLowerCase();
  const segments = lowerPath.split('/').filter(Boolean);

  // Qualquer tentativa direta ou indireta em /assets/aistudio/ só pode servir o asset institucional permitido.
  if (
    rawLower === '/assets/aistudio' ||
    rawLower.startsWith('/assets/aistudio/') ||
    rawLower.includes('/assets/aistudio/') ||
    lowerPath === '/assets/aistudio' ||
    lowerPath.startsWith('/assets/aistudio/') ||
    lowerPath.includes('/assets/aistudio/')
  ) {
    if (ALLOWED_AISTUDIO_PUBLIC_ASSETS.has(lowerPath)) {
      return false;
    }
    return true;
  }

  // Bloqueia dotfiles sensíveis (.env*, .git*, etc.), preservando rotas internas do Vite (.vite).
  if (
    segments.some(
      seg =>
        seg === '.env' ||
        seg.startsWith('.env.') ||
        seg === '.git' ||
        seg.startsWith('.git') ||
        seg === '.vercel'
    )
  ) {
    return true;
  }

  // Bloqueia extensões de exportações, dumps, scripts SQL, bancos locais e arquivos de configuração/chave.
  const ext = path.posix.extname(lowerPath);
  if (ext && PRIVATE_FILE_EXTENSIONS.has(ext)) {
    return true;
  }

  // Bloqueia diretórios privados do repositório (inclusive via /@fs/ no Vite dev server).
  if (
    PRIVATE_PREFIXES.some(prefix => lowerPath === prefix || lowerPath.startsWith(`${prefix}/`)) ||
    (lowerPath.startsWith('/@fs/') &&
      (lowerPath.includes('/docs/') ||
        lowerPath.includes('/supabase/') ||
        lowerPath.includes('/tests/')))
  ) {
    return true;
  }

  if (PRIVATE_EXACT_PATHS.has(lowerPath)) {
    return true;
  }

  // Em preview, /src e /api/*.ts nunca devem ser servidos nem cair no fallback SPA.
  if (options.isPreview) {
    if (lowerPath === '/src' || lowerPath.startsWith('/src/')) {
      return true;
    }
    if (lowerPath.startsWith('/api/') && ext === '.ts') {
      return true;
    }
  } else if (lowerPath.startsWith('/api/') && ext === '.ts') {
    return true;
  }

  return false;
}

export function sendPrivatePathNotFound(res: ServerResponse): void {
  if (!res.headersSent) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end('Not found');
}

export function createPrivatePathGuardMiddleware(
  options: { isPreview?: boolean } = {}
): (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => void {
  return (req, res, next) => {
    if (isBlockedPrivateRequestPath(req?.url || '/', options)) {
      sendPrivatePathNotFound(res);
      return;
    }
    next();
  };
}
