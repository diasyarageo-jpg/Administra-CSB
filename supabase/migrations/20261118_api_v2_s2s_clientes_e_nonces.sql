-- supabase/migrations/20261118_api_v2_s2s_clientes_e_nonces.sql
-- Etapa 1 da API v2: fundação de autenticação S2S (clientes Ed25519 + controle atômico de nonces).
-- ATENÇÃO: Script preparado apenas para revisão/execução controlada; não contém chaves reais nem dados de produção.

CREATE TABLE IF NOT EXISTS public.integracao_clientes_s2s (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sistema text NOT NULL CHECK (sistema IN ('notifica', 'classifica', 'fiscaliza')),
  kid text NOT NULL,
  public_key_pem text NOT NULL,
  escopos text[] NOT NULL DEFAULT ARRAY[]::text[],
  ativo boolean NOT NULL DEFAULT true,
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_integracao_clientes_s2s_kid UNIQUE (kid)
);

CREATE INDEX IF NOT EXISTS idx_integracao_clientes_s2s_sistema_ativo
  ON public.integracao_clientes_s2s (sistema)
  WHERE ativo = true;

CREATE TABLE IF NOT EXISTS public.integracao_s2s_nonces (
  sistema text NOT NULL CHECK (sistema IN ('notifica', 'classifica', 'fiscaliza')),
  jti text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_integracao_s2s_nonces PRIMARY KEY (sistema, jti)
);

CREATE INDEX IF NOT EXISTS idx_integracao_s2s_nonces_expires_at
  ON public.integracao_s2s_nonces (expires_at);

ALTER TABLE public.integracao_clientes_s2s ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_s2s_nonces ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.integracao_clientes_s2s FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.integracao_s2s_nonces FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.integracao_clientes_s2s TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.integracao_s2s_nonces TO service_role;

CREATE OR REPLACE FUNCTION public.reservar_nonce_s2s(
  p_sistema text,
  p_jti text,
  p_expires_at timestamptz DEFAULT (now() + interval '10 minutes')
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted_jti text;
BEGIN
  IF p_sistema IS NULL OR p_sistema NOT IN ('notifica', 'classifica', 'fiscaliza') THEN
    RAISE EXCEPTION 'Sistema S2S inválido.';
  END IF;

  IF p_jti IS NULL OR length(btrim(p_jti)) < 8 OR length(btrim(p_jti)) > 128 THEN
    RAISE EXCEPTION 'Nonce S2S inválido.';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Expiração de nonce S2S inválida.';
  END IF;

  INSERT INTO public.integracao_s2s_nonces (sistema, jti, expires_at)
  VALUES (p_sistema, btrim(p_jti), p_expires_at)
  ON CONFLICT (sistema, jti) DO NOTHING
  RETURNING jti INTO v_inserted_jti;

  RETURN v_inserted_jti IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.limpar_nonces_s2s_expirados(
  p_limit integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_size integer;
  v_deleted integer := 0;
BEGIN
  v_batch_size := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 50000);

  WITH target AS (
    SELECT ctid
    FROM public.integracao_s2s_nonces
    WHERE expires_at < now()
    ORDER BY expires_at ASC
    LIMIT v_batch_size
  )
  DELETE FROM public.integracao_s2s_nonces n
  USING target t
  WHERE n.ctid = t.ctid;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_nonce_s2s(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.limpar_nonces_s2s_expirados(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reservar_nonce_s2s(text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.limpar_nonces_s2s_expirados(integer) TO service_role;
