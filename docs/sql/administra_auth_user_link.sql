-- ============================================================================
-- ADMINISTRA BARRAGENS (Projeto Supabase: adm_baragem)
-- ARQUIVO SOMENTE PARA REVISAO E APLICACAO MANUAL — NAO EXECUTADO AUTOMATICAMENTE
--
-- Objetivo:
--   1. Garantir de forma idempotente a coluna auth_user_id (uuid -> auth.users)
--      e o indice unico parcial na tabela public.usuarios, preservando a PK
--      textual existente (id text no formato usr_...).
--   2. Associar com seguranca a conta existente no Supabase Auth:
--        E-mail: yarageologa@gmail.com
--        UID:    52f8280d-cc4c-4aad-98f6-7446da912dd1
--      ao registro unico correspondente em public.usuarios.
--
-- Garantias de seguranca:
--   - Nunca altera public.usuarios.id (preserva integridade de FKs e auditoria).
--   - Falha com erro explicito se o UID nao existir em auth.users ou nao
--     pertencer ao e-mail yarageologa@gmail.com.
--   - Falha com erro explicito se houver 0 ou mais de 1 linha em public.usuarios
--     para o e-mail informado.
--   - Nunca sobrescreve um auth_user_id divergente ou ja vinculado a outro usuario.
-- ============================================================================

-- 1. Garantia estrutural idempotente (nao modifica public.usuarios.id)
ALTER TABLE IF EXISTS public.usuarios
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_auth_user_id
  ON public.usuarios(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- 2. Associacao segura da conta administrativa confirmada
DO $$
DECLARE
  v_expected_uid   CONSTANT uuid := '52f8280d-cc4c-4aad-98f6-7446da912dd1'::uuid;
  v_expected_email CONSTANT text := 'yarageologa@gmail.com';

  v_auth_email     text;
  v_email_matches  integer;
  v_target_id      text;
  v_current_auth   uuid;
  v_conflict_id    text;
  v_conflict_email text;
BEGIN
  -- Verifica existencia e correspondencia exata na tabela auth.users
  SELECT email
    INTO v_auth_email
    FROM auth.users
   WHERE id = v_expected_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Associacao abortada: UID % nao encontrado em auth.users.',
      v_expected_uid;
  END IF;

  IF LOWER(TRIM(COALESCE(v_auth_email, ''))) <> LOWER(v_expected_email) THEN
    RAISE EXCEPTION
      'Associacao abortada: UID % em auth.users pertence ao e-mail "%" e nao a "%".',
      v_expected_uid, COALESCE(v_auth_email, '<nulo>'), v_expected_email;
  END IF;

  -- Verifica se o UID ja esta vinculado a outro cadastro em public.usuarios
  SELECT id, email
    INTO v_conflict_id, v_conflict_email
    FROM public.usuarios
   WHERE auth_user_id = v_expected_uid
     AND LOWER(TRIM(COALESCE(email, ''))) <> LOWER(v_expected_email)
   LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Associacao abortada: auth_user_id % ja esta vinculado a outro cadastro (id=%, email=%).',
      v_expected_uid, v_conflict_id, COALESCE(v_conflict_email, '<nulo>');
  END IF;

  -- Verifica unicidade do cadastro institucional pelo e-mail
  SELECT COUNT(*)
    INTO v_email_matches
    FROM public.usuarios
   WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(v_expected_email);

  IF v_email_matches = 0 THEN
    RAISE EXCEPTION
      'Associacao abortada: nenhum registro encontrado em public.usuarios com e-mail "%".',
      v_expected_email;
  END IF;

  IF v_email_matches > 1 THEN
    RAISE EXCEPTION
      'Associacao abortada: encontrados % registros em public.usuarios com e-mail "%". Resolva a duplicidade antes de vincular.',
      v_email_matches, v_expected_email;
  END IF;

  -- Carrega o registro unico alvo
  SELECT id, auth_user_id
    INTO v_target_id, v_current_auth
    FROM public.usuarios
   WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(v_expected_email);

  IF v_current_auth IS NOT NULL AND v_current_auth <> v_expected_uid THEN
    RAISE EXCEPTION
      'Associacao abortada: o cadastro id=% ja possui auth_user_id=% diferente do esperado (%).',
      v_target_id, v_current_auth, v_expected_uid;
  END IF;

  IF v_current_auth = v_expected_uid THEN
    RAISE NOTICE
      'Cadastro id=% (%) ja esta corretamente vinculado ao auth_user_id=%. Nenhuma alteracao necessaria.',
      v_target_id, v_expected_email, v_expected_uid;
    RETURN;
  END IF;

  -- Atualiza estritamente auth_user_id e updated_at, preservando public.usuarios.id
  UPDATE public.usuarios
     SET auth_user_id = v_expected_uid,
         updated_at   = NOW()
   WHERE id = v_target_id
     AND auth_user_id IS NULL;

  RAISE NOTICE
    'Vinculo concluido com sucesso: public.usuarios.id=% associado ao auth_user_id=%.',
    v_target_id, v_expected_uid;
END $$;
