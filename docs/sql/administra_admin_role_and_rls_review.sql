-- ============================================================================
-- ADMINISTRA BARRAGENS (Projeto Supabase: adm_baragem)
-- ARQUIVO SOMENTE PARA REVISAO E APLICACAO MANUAL — NAO EXECUTADO AUTOMATICAMENTE
--
-- Conteudo separado para revisao da responsavel:
--   Parte 1: Conferencia e confirmacao explicita de papel='Administrador' e
--            situacao/status='Ativo' para Yara Dias (apos executar
--            docs/sql/administra_auth_user_link.sql).
--   Parte 2: Revisao minima de funcoes auxiliares e RLS de public.usuarios,
--            garantindo leitura propria segura (auth.uid() = auth_user_id),
--            leitura administrativa, bloqueio de autocadastro/autoescalacao
--            e preservacao integral das politicas operacionais existentes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PARTE 1: CONFERENCIA E GARANTIA EXPLICITA DO PRIMEIRO ADMINISTRADOR
-- (Execute a consulta SELECT abaixo antes, se desejar apenas inspecionar)
-- ----------------------------------------------------------------------------
-- SELECT id, nome, login, email, papel, situacao, status, auth_user_id
--   FROM public.usuarios
--  WHERE auth_user_id = '52f8280d-cc4c-4aad-98f6-7446da912dd1'::uuid
--     OR LOWER(TRIM(COALESCE(email, ''))) = 'yarageologa@gmail.com';

DO $$
DECLARE
  v_expected_uid   CONSTANT uuid := '52f8280d-cc4c-4aad-98f6-7446da912dd1'::uuid;
  v_expected_email CONSTANT text := 'yarageologa@gmail.com';
  v_match_count    integer;
  v_target_id      text;
BEGIN
  SELECT COUNT(*)
    INTO v_match_count
    FROM public.usuarios
   WHERE auth_user_id = v_expected_uid
     AND LOWER(TRIM(COALESCE(email, ''))) = LOWER(v_expected_email);

  IF v_match_count <> 1 THEN
    RAISE EXCEPTION
      'Promocao/ativacao abortada: esperado exatamente 1 registro vinculado para % com auth_user_id=%, encontrado(s) %. Execute administra_auth_user_link.sql antes.',
      v_expected_email, v_expected_uid, v_match_count;
  END IF;

  SELECT id
    INTO v_target_id
    FROM public.usuarios
   WHERE auth_user_id = v_expected_uid
     AND LOWER(TRIM(COALESCE(email, ''))) = LOWER(v_expected_email);

  UPDATE public.usuarios
     SET papel      = 'Administrador',
         situacao   = 'Ativo',
         status     = 'Ativo',
         updated_at = NOW()
   WHERE id = v_target_id
     AND auth_user_id = v_expected_uid
     AND (
       papel IS DISTINCT FROM 'Administrador'
       OR situacao IS DISTINCT FROM 'Ativo'
       OR status IS DISTINCT FROM 'Ativo'
     );

  RAISE NOTICE
    'Conferencia concluida para public.usuarios.id=% (papel=Administrador, situacao=Ativo).',
    v_target_id;
END $$;

-- ----------------------------------------------------------------------------
-- PARTE 2: FUNCOES DE AUTORIZACAO E RLS MINIMA E SEGURA PARA public.usuarios
-- ----------------------------------------------------------------------------

-- Garante que as funcoes usadas pelas politicas RLS falhem fechado:
-- retornam papel/autorizacao somente quando auth_user_id = auth.uid() e situacao = 'Ativo'.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.papel
    FROM public.usuarios u
   WHERE u.auth_user_id = auth.uid()
     AND u.situacao = 'Ativo'
     AND u.papel IN ('Administrador', 'Analista', 'Usuário', 'Visualizador')
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.usuarios u
     WHERE u.auth_user_id = auth.uid()
       AND u.papel = 'Administrador'
       AND u.situacao = 'Ativo'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.usuarios u
     WHERE u.auth_user_id = auth.uid()
       AND u.situacao = 'Ativo'
       AND u.papel IN ('Administrador', 'Analista', 'Usuário', 'Visualizador')
  );
$$;

-- Habilita RLS em public.usuarios e revoga acesso direto de anon
ALTER TABLE IF EXISTS public.usuarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.usuarios FROM anon;

-- Remove politicas anteriores permissivas (ex.: insert anon ou self-update sem trava)
DROP POLICY IF EXISTS "usuarios_select_policy" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_insert_policy" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_update_policy" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_delete_policy" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_anon_insert_policy" ON public.usuarios;

-- SELECT: usuario autenticado le estritamente o proprio registro por auth_user_id;
-- Administradores ativos podem listar os cadastros para gestao de usuarios.
CREATE POLICY "usuarios_select_policy" ON public.usuarios
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = auth_user_id
    OR public.is_admin()
  );

-- INSERT / UPDATE / DELETE: restritos a Administradores ativos
-- (bloqueia autocadastro, alteracao de papel/situacao ou sequestro de auth_user_id pelo cliente)
CREATE POLICY "usuarios_insert_policy" ON public.usuarios
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "usuarios_update_policy" ON public.usuarios
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "usuarios_delete_policy" ON public.usuarios
  FOR DELETE
  TO authenticated
  USING (public.is_admin());
