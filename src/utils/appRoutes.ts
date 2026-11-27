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
  mesa_virtual: '/mesa-virtual',
  usuarios: '/usuarios',
  integracao: '/integracao',
  referencias: '/referencias'
} as const;

export type AppViewKey = keyof typeof APP_ROUTE_PATHS;

export const ADMIN_ONLY_VIEWS = new Set<AppViewKey>(['usuarios', 'integracao']);

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
  '/mesa-virtual': 'mesa_virtual',
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
  '/mesa-virtual',
  '/usuarios',
  '/integracao',
  '/referencias'
];

export function isValidAppView(view: string): view is AppViewKey {
  return Object.prototype.hasOwnProperty.call(APP_ROUTE_PATHS, view);
}

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
  if (isValidAppView(view)) {
    return APP_ROUTE_PATHS[view];
  }
  return APP_ROUTE_PATHS.home;
}

export function resolveAuthorizedAppView(
  requestedView: string,
  options: { userRole?: string; enforceAdminGuard?: boolean } = {}
): { view: AppViewKey; allowed: boolean } {
  const targetView: AppViewKey = isValidAppView(requestedView) ? requestedView : 'home';
  if (
    options.enforceAdminGuard &&
    ADMIN_ONLY_VIEWS.has(targetView) &&
    options.userRole !== 'Administrador'
  ) {
    return { view: 'home', allowed: false };
  }
  return { view: targetView, allowed: true };
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
    if (typeof window.history.replaceState === 'function') {
      window.history.replaceState({ view }, '', targetPath);
    }
  } else if (typeof window.history.pushState === 'function') {
    window.history.pushState({ view }, '', targetPath);
  }
}

export function bindPopStateNavigation(onViewChange: (view: AppViewKey) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }

  const handlePopState = () => {
    onViewChange(getViewFromPathname(window.location.pathname));
  };

  window.addEventListener('popstate', handlePopState);
  return () => {
    window.removeEventListener('popstate', handlePopState);
  };
}
