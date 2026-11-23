// src/utils/appRoutes.ts
export const APP_ROUTE_PATHS = {
  home: '/',
  empreendedores: '/empreendedores',
  barragens: '/barragens',
  rts: '/rts',
  revisoes: '/conciliacao',
  produtividade: '/produtividade',
  portarias: '/portarias',
  pendencias: '/pendencias',
  solicitacoes_vistoria: '/solicitacoes-vistoria',
  documentos: '/documentos',
  usuarios: '/usuarios',
  integracao: '/integracao',
  referencias: '/referencias'
} as const;

export type AppViewKey = keyof typeof APP_ROUTE_PATHS;

const PATH_TO_VIEW: Record<string, AppViewKey> = {
  '/': 'home',
  '/index.html': 'home',
  '/empreendedores': 'empreendedores',
  '/barragens': 'barragens',
  '/rts': 'rts',
  '/conciliacao': 'revisoes',
  '/revisoes': 'revisoes',
  '/produtividade': 'produtividade',
  '/portarias': 'portarias',
  '/pendencias': 'pendencias',
  '/solicitacoes-vistoria': 'solicitacoes_vistoria',
  '/solicitacoes_vistoria': 'solicitacoes_vistoria',
  '/documentos': 'documentos',
  '/usuarios': 'usuarios',
  '/integracao': 'integracao',
  '/referencias': 'referencias'
};

export const SPA_FALLBACK_ROUTE_PATHS: readonly string[] = [
  '/empreendedores',
  '/barragens',
  '/rts',
  '/conciliacao',
  '/revisoes',
  '/produtividade',
  '/portarias',
  '/pendencias',
  '/solicitacoes-vistoria',
  '/documentos',
  '/usuarios',
  '/integracao',
  '/referencias'
];

export function normalizeAppPathname(rawPathname?: string | null): string {
  const withoutQueryOrHash = String(rawPathname || '/')
    .trim()
    .split('?')[0]
    .split('#')[0];

  if (!withoutQueryOrHash) return '/';

  const withLeadingSlash = withoutQueryOrHash.startsWith('/')
    ? withoutQueryOrHash
    : `/${withoutQueryOrHash}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, '/');
  const trimmed = collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;

  return (trimmed || '/').toLowerCase();
}

export function getViewFromPathname(rawPathname?: string | null): AppViewKey {
  const normalized = normalizeAppPathname(rawPathname);
  return PATH_TO_VIEW[normalized] ?? 'home';
}

export function getPathForView(view: string): string {
  if (Object.prototype.hasOwnProperty.call(APP_ROUTE_PATHS, view)) {
    return APP_ROUTE_PATHS[view as AppViewKey];
  }
  return APP_ROUTE_PATHS.home;
}

export function syncBrowserUrlForView(
  view: string,
  options: { replace?: boolean } = {}
): void {
  if (typeof window === 'undefined' || !window.history) return;

  const targetPath = getPathForView(view);
  const currentPath = normalizeAppPathname(window.location.pathname);

  if (currentPath === targetPath && window.location.pathname === targetPath) {
    return;
  }

  if (options.replace) {
    window.history.replaceState({ view }, '', targetPath);
  } else {
    window.history.pushState({ view }, '', targetPath);
  }
}
