import { createClient, SupabaseClient } from '@supabase/supabase-js';

declare const __ADMINISTRA_PUBLIC_SUPABASE_URL__: string | undefined;
declare const __ADMINISTRA_PUBLIC_SUPABASE_ANON_KEY__: string | undefined;

function cleanPublicValue(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

function isValidUrlValue(raw: string): boolean {
  const clean = cleanPublicValue(raw);
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

function decodeJwtRoleBrowser(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) return '';
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const jsonStr =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonStr);
    return String(parsed?.role || '').toLowerCase();
  } catch {
    return '';
  }
}

function isSafeAnonKeyValue(raw: string): boolean {
  const clean = cleanPublicValue(raw);
  if (!clean || clean.includes('your-anon-public-key') || clean.startsWith('sb_secret_')) {
    return false;
  }
  const role = decodeJwtRoleBrowser(clean);
  if (role === 'service_role' || role === 'supabase_admin') {
    return false;
  }
  return true;
}

function resolveInitialPublicCredentials(): { url: string; anonKey: string } {
  const metaEnv: Record<string, any> = (import.meta as any)?.env || {};
  const defineUrl =
    typeof __ADMINISTRA_PUBLIC_SUPABASE_URL__ !== 'undefined'
      ? __ADMINISTRA_PUBLIC_SUPABASE_URL__
      : '';
  const defineAnon =
    typeof __ADMINISTRA_PUBLIC_SUPABASE_ANON_KEY__ !== 'undefined'
      ? __ADMINISTRA_PUBLIC_SUPABASE_ANON_KEY__
      : '';

  const url =
    [
      metaEnv.VITE_SUPABASE_URL,
      metaEnv.VITE_PUBLIC_SUPABASE_URL,
      metaEnv.NEXT_PUBLIC_SUPABASE_URL,
      defineUrl
    ]
      .map(cleanPublicValue)
      .find(isValidUrlValue)
      ?.replace(/\/+$/, '') || '';

  const anonKey =
    [
      metaEnv.VITE_SUPABASE_ANON_KEY,
      metaEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
      metaEnv.VITE_PUBLIC_SUPABASE_ANON_KEY,
      metaEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      metaEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      defineAnon
    ]
      .map(cleanPublicValue)
      .find(isSafeAnonKeyValue) || '';

  return { url, anonKey };
}

const initialCreds = resolveInitialPublicCredentials();
let activeSupabaseUrl = initialCreds.url;
let activeSupabaseAnonKey = initialCreds.anonKey;
let initPromise: Promise<boolean> | null = null;

function buildBrowserClient(url: string, anonKey: string): SupabaseClient | null {
  if (!isValidUrlValue(url) || !isSafeAnonKeyValue(anonKey)) {
    return null;
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    }
  });
}

export const hasConfiguredSupabaseUrl = (): boolean => isValidUrlValue(activeSupabaseUrl);
export const hasConfiguredSupabaseAnonKey = (): boolean => isSafeAnonKeyValue(activeSupabaseAnonKey);

export const isSupabaseConfigured = (): boolean => {
  return hasConfiguredSupabaseUrl() && hasConfiguredSupabaseAnonKey() && Boolean(supabase);
};

export let supabase: SupabaseClient | null = buildBrowserClient(
  activeSupabaseUrl,
  activeSupabaseAnonKey
);

export function getSupabaseClient(): SupabaseClient | null {
  return supabase;
}

export async function ensureSupabaseInitialized(): Promise<boolean> {
  if (isSupabaseConfigured()) {
    return true;
  }

  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return false;
  }

  if (!initPromise) {
    initPromise = (async () => {
      try {
        const resp = await fetch('/api/auth-config', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        });
        if (!resp.ok) return false;
        const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('application/json')) return false;
        const payload = await resp.json().catch(() => null);
        const url = cleanPublicValue(payload?.supabaseUrl).replace(/\/+$/, '');
        const anonKey = cleanPublicValue(payload?.supabaseAnonKey);

        if (!isValidUrlValue(url) || !isSafeAnonKeyValue(anonKey)) {
          return false;
        }

        activeSupabaseUrl = url;
        activeSupabaseAnonKey = anonKey;
        supabase = buildBrowserClient(activeSupabaseUrl, activeSupabaseAnonKey);
        return isSupabaseConfigured();
      } catch {
        return false;
      } finally {
        if (!isSupabaseConfigured()) {
          initPromise = null;
        }
      }
    })();
  }

  return initPromise;
}

export interface SupabaseConnectionStatus {
  configured: boolean;
  connected: boolean;
  message: string;
  latencyMs?: number;
}

/**
 * Testa a conexão com o Supabase sem gravar dados.
 */
export async function checkSupabaseConnection(): Promise<SupabaseConnectionStatus> {
  if (!isSupabaseConfigured() || !supabase) {
    return {
      configured: false,
      connected: false,
      message: 'Conexão com o banco de dados central não configurada.'
    };
  }

  const start = performance.now();
  try {
    const { error } = await supabase
      .from('empreendedores')
      .select('id', { count: 'exact', head: true });

    const latencyMs = Math.round(performance.now() - start);

    if (error) {
      return {
        configured: true,
        connected: false,
        latencyMs,
        message: `Falha na consulta à base central: ${error.message}`
      };
    }

    return {
      configured: true,
      connected: true,
      latencyMs,
      message: `Conectado com sucesso à base central (${latencyMs}ms).`
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      configured: true,
      connected: false,
      latencyMs,
      message: `Erro de rede ou conexão com a base central: ${err?.message || 'Indisponível'}`
    };
  }
}
