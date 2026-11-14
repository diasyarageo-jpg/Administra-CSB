import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.trim().length > 0 &&
    supabaseAnonKey.trim().length > 0 &&
    !supabaseUrl.includes('your-project-ref') &&
    !supabaseAnonKey.includes('your-anon-public-key')
  );
};

export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(supabaseUrl.trim(), supabaseAnonKey.trim(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : null;

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
