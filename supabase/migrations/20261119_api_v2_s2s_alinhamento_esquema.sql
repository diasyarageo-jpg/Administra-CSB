-- supabase/migrations/20261119_api_v2_s2s_alinhamento_esquema.sql
-- Migração corretiva posterior à 20261118_api_v2_s2s_clientes_e_nonces.sql.
-- Alinha o esquema S2S existente no Supabase (tabelas vazias):
--   1. Renomeia integracao_s2s_nonces.sistema_origem -> sistema preservando a PK (sistema, jti).
--   2. Substitui UNIQUE (sistema, kid) por UNIQUE (kid) em integracao_clientes_s2s.
--   3. Mantém jti como uuid e substitui reservar_nonce_s2s sem deixar overload ambíguo.
--   4. Mantém a limpeza limitada exclusivamente a nonces expirados.
--   5. Preserva RLS e nega acesso a PUBLIC, anon e authenticated.
-- ATENÇÃO: Migração preparada para execução controlada; NÃO executar automaticamente nem expor segredos.

-- 1) integracao_clientes_s2s: garantir UNIQUE (kid) e remover UNIQUE (sistema, kid)
DO $$
DECLARE
  v_con_name text;
  v_idx_name text;
BEGIN
  FOR v_con_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'integracao_clientes_s2s'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
      ) IN (ARRAY['sistema', 'kid'], ARRAY['kid', 'sistema'])
  LOOP
    EXECUTE format('ALTER TABLE public.integracao_clientes_s2s DROP CONSTRAINT %I', v_con_name);
  END LOOP;

  FOR v_idx_name IN
    SELECT i.relname
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'integracao_clientes_s2s'
      AND ix.indisunique = true
      AND NOT ix.indisprimary
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = ix.indexrelid)
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(ix.indkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
      ) IN (ARRAY['sistema', 'kid'], ARRAY['kid', 'sistema'])
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', v_idx_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'integracao_clientes_s2s'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
      ) = ARRAY['kid']
  ) THEN
    ALTER TABLE public.integracao_clientes_s2s
      ADD CONSTRAINT uq_integracao_clientes_s2s_kid UNIQUE (kid);
  END IF;
END
$$;

DROP INDEX IF EXISTS public.idx_integracao_clientes_s2s_kid_ativo;

CREATE INDEX IF NOT EXISTS idx_integracao_clientes_s2s_sistema_ativo
  ON public.integracao_clientes_s2s (sistema)
  WHERE ativo = true;

-- 2) integracao_s2s_nonces: renomear sistema_origem -> sistema preservando PK, manter jti uuid e consumido_em
DO $$
DECLARE
  v_jti_type text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'integracao_s2s_nonces'
      AND column_name = 'sistema_origem'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'integracao_s2s_nonces'
      AND column_name = 'sistema'
  ) THEN
    ALTER TABLE public.integracao_s2s_nonces
      RENAME COLUMN sistema_origem TO sistema;
  END IF;

  SELECT c.udt_name
  INTO v_jti_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'integracao_s2s_nonces'
    AND c.column_name = 'jti';

  IF v_jti_type IS NOT NULL AND v_jti_type <> 'uuid' THEN
    ALTER TABLE public.integracao_s2s_nonces
      ALTER COLUMN jti TYPE uuid USING jti::uuid;
  END IF;
END
$$;

ALTER TABLE public.integracao_s2s_nonces
  ADD COLUMN IF NOT EXISTS consumido_em timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.integracao_s2s_nonces
  ALTER COLUMN consumido_em SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_integracao_s2s_nonces_expires_at
  ON public.integracao_s2s_nonces (expires_at);

-- 3) Preservar RLS e negar acesso a PUBLIC, anon e authenticated (operação apenas server-side via service_role)
ALTER TABLE public.integracao_clientes_s2s ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_s2s_nonces ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.integracao_clientes_s2s FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.integracao_s2s_nonces FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.integracao_clientes_s2s TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.integracao_s2s_nonces TO service_role;

-- 4) Remover todas as assinaturas antigas de reservar_nonce_s2s sem deixar overload ambíguo e criar versão UUID
DO $$
DECLARE
  v_proc_sig text;
BEGIN
  FOR v_proc_sig IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'reservar_nonce_s2s'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', v_proc_sig);
  END LOOP;
END
$$;

CREATE FUNCTION public.reservar_nonce_s2s(
  p_sistema text,
  p_jti uuid,
  p_expires_at timestamptz DEFAULT (now() + interval '10 minutes')
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted_jti uuid;
BEGIN
  IF p_sistema IS NULL OR p_sistema NOT IN ('notifica', 'classifica', 'fiscaliza') THEN
    RAISE EXCEPTION 'Sistema S2S inválido.';
  END IF;

  IF p_jti IS NULL THEN
    RAISE EXCEPTION 'Nonce S2S inválido.';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Expiração de nonce S2S inválida.';
  END IF;

  INSERT INTO public.integracao_s2s_nonces (sistema, jti, expires_at, consumido_em)
  VALUES (p_sistema, p_jti, p_expires_at, now())
  ON CONFLICT (sistema, jti) DO NOTHING
  RETURNING jti INTO v_inserted_jti;

  RETURN v_inserted_jti IS NOT NULL;
END;
$$;

-- 5) Garantir limpeza limitada exclusivamente a nonces expirados
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

REVOKE ALL ON FUNCTION public.reservar_nonce_s2s(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.limpar_nonces_s2s_expirados(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reservar_nonce_s2s(text, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.limpar_nonces_s2s_expirados(integer) TO service_role;
