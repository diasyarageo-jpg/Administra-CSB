// api/auth-config.ts
import type { IncomingMessage, ServerResponse } from 'http';

interface VercelLikeRequest extends IncomingMessage {
  method?: string;
}

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (data: any) => VercelLikeResponse;
}

function sendJson(res: VercelLikeResponse, statusCode: number, data: any): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const statusFn = res.status.bind(res);
    const jsonFn = res.json.bind(res);
    statusFn(statusCode);
    jsonFn(data);
    return;
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function cleanEnvValue(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

export function isValidPublicSupabaseUrl(url: string): boolean {
  const clean = cleanEnvValue(url);
  if (!clean || clean.includes('your-project-ref')) return false;
  try {
    const parsed = new URL(clean);
    const isHttps = parsed.protocol === 'https:';
    const isLocalHttp =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    return (isHttps || isLocalHttp) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function isSafePublicSupabaseKey(key: string): boolean {
  const clean = cleanEnvValue(key);
  if (!clean || clean.includes('your-anon-public-key')) return false;
  if (clean.startsWith('sb_secret_')) return false;

  const parts = clean.split('.');
  if (parts.length === 3) {
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
      const role = String(decoded?.role || '').toLowerCase();
      if (role === 'service_role' || role === 'supabase_admin') {
        return false;
      }
    } catch {
      // Chave não-JWT ou opaca; segue validação padrão abaixo
    }
  }

  return true;
}

export function resolvePublicSupabaseConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): { configured: boolean; supabaseUrl: string; supabaseAnonKey: string } {
  const urlCandidates = [
    env.VITE_SUPABASE_URL,
    env.SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.VITE_PUBLIC_SUPABASE_URL
  ];

  const keyCandidates = [
    env.VITE_SUPABASE_ANON_KEY,
    env.SUPABASE_ANON_KEY,
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
    env.SUPABASE_PUBLISHABLE_KEY,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    env.VITE_PUBLIC_SUPABASE_ANON_KEY
  ];

  const supabaseUrl =
    urlCandidates.map(cleanEnvValue).find(isValidPublicSupabaseUrl)?.replace(/\/+$/, '') || '';
  const supabaseAnonKey = keyCandidates.map(cleanEnvValue).find(isSafePublicSupabaseKey) || '';

  return {
    configured: Boolean(supabaseUrl && supabaseAnonKey),
    supabaseUrl: supabaseUrl && supabaseAnonKey ? supabaseUrl : '',
    supabaseAnonKey: supabaseUrl && supabaseAnonKey ? supabaseAnonKey : ''
  };
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method !== 'GET') {
    sendJson(res, 405, {
      configured: false,
      error: 'Método não permitido. Utilize GET.'
    });
    return;
  }

  const config = resolvePublicSupabaseConfigFromEnv(process.env);
  sendJson(res, 200, config);
}
