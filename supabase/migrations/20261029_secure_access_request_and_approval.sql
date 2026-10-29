-- ============================================================================
-- SCRIPT INCREMENTAL E IDEMPOTENTE:
-- FLUXO SEGURO DE SOLICITAÇÃO DE ACESSO, RLS E APROVAÇÃO VIA EDGE FUNCTION
-- Administra-CSB / Notifica-CSB — SEMA-MT / SURH / CSB
-- Data: 29/10/2026
-- ============================================================================

-- 1. GARANTE ESTRUTURA E COLUNAS NA TABELA public.usuarios
ALTER TABLE IF EXISTS public.usuarios
  ADD COLUMN IF NOT EXISTS matricula text,
  ADD COLUMN IF NOT EXISTS perfil_profissional text,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS senha_provisoria_enc text,
  ADD COLUMN IF NOT EXISTS situacao text DEFAULT 'Ativo',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'Ativo',
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text;

-- Remove qualquer valor residual de senhas provisórias para garantir não-persistência
UPDATE public.usuarios
SET senha_provisoria_enc = NULL
WHERE senha_provisoria_enc IS NOT NULL;

-- Restrições de valores aceitos
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_situacao') THEN
    ALTER TABLE public.usuarios DROP CONSTRAINT chk_usuarios_situacao;
  END IF;
  ALTER TABLE public.usuarios
    ADD CONSTRAINT chk_usuarios_situacao
    CHECK (situacao IN ('Ativo', 'Inativo', 'Pendente', 'Recusado'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_papel') THEN
    ALTER TABLE public.usuarios DROP CONSTRAINT chk_usuarios_papel;
  END IF;
  ALTER TABLE public.usuarios
    ADD CONSTRAINT chk_usuarios_papel
    CHECK (papel IN ('Administrador', 'Usuário', 'Visualizador', 'Analista'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. PRESERVAÇÃO E VÍNCULO DA CONTA ADMINISTRADORA EXISTENTE
DO $$
DECLARE
  v_admin_uid uuid := 'f26897f0-bb2f-4dc7-a444-ee4550c8d569'::uuid;
  v_admin_email text := 'yarageologa@gmail.com';
  v_existing_id text;
BEGIN
  SELECT id INTO v_existing_id
  FROM public.usuarios
  WHERE LOWER(email) = LOWER(v_admin_email) OR auth_user_id = v_admin_uid
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.usuarios
    SET
      auth_user_id = v_admin_uid,
      papel = 'Administrador',
      situacao = 'Ativo',
      status = 'Ativo',
      updated_at = NOW()
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.usuarios (
      id,
      nome,
      login,
      email,
      matricula,
      perfil_profissional,
      setor,
      papel,
      situacao,
      status,
      auth_user_id,
      observacoes,
      created_at,
      updated_at
    ) VALUES (
      'usr_' || SUBSTRING(v_admin_uid::text, 1, 8),
      'Yara Geóloga',
      'yarageologa',
      v_admin_email,
      'SEMA-ADMIN-01',
      'Analista de Meio Ambiente',
      'Setor de Fiscalização',
      'Administrador',
      'Ativo',
      'Ativo',
      v_admin_uid,
      'Conta administradora institucional vinculada ao Supabase Auth.',
      NOW(),
      NOW()
    );
  END IF;
END $$;

-- 3. FUNÇÕES DE AUTORIZAÇÃO SEGURAS COM search_path FIXO
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE auth_user_id = auth.uid()
      AND papel = 'Administrador'
      AND situacao = 'Ativo'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE auth_user_id = auth.uid()
      AND situacao = 'Ativo'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(papel, 'Visualizador')
  FROM public.usuarios
  WHERE auth_user_id = auth.uid()
    AND situacao = 'Ativo'
  LIMIT 1;
$$;

-- 4. REMOÇÃO DE RPCS OBSOLETAS QUE COLETAVAM SENHA OU BURLAVAM A EDGE FUNCTION
DROP FUNCTION IF EXISTS public.solicitar_novo_acesso(text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.aprovar_usuario(text, text);

-- 5. RPC SEGURA: solicitar_novo_acesso (SEM COLETA DE SENHA)
-- Permite registrar a solicitação pendente no banco de dados com segurança
CREATE OR REPLACE FUNCTION public.solicitar_novo_acesso(
  p_nome text,
  p_matricula text,
  p_email text,
  p_login text,
  p_perfil_profissional text,
  p_setor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_id text;
  v_existing_id text;
  v_existing_situacao text;
BEGIN
  IF TRIM(COALESCE(p_nome, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nome completo é obrigatório.');
  END IF;
  IF TRIM(COALESCE(p_matricula, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Matrícula funcional é obrigatória.');
  END IF;
  IF TRIM(COALESCE(p_email, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'E-mail institucional é obrigatório.');
  END IF;

  SELECT id, situacao INTO v_existing_id, v_existing_situacao
  FROM public.usuarios
  WHERE LOWER(email) = LOWER(TRIM(p_email))
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_situacao = 'Ativo' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Já existe um cadastro ativo com este e-mail. Utilize a recuperação de senha institucional.');
    END IF;

    UPDATE public.usuarios
    SET
      nome = TRIM(p_nome),
      matricula = TRIM(p_matricula),
      login = LOWER(COALESCE(NULLIF(TRIM(p_login), ''), SPLIT_PART(TRIM(p_email), '@', 1))),
      perfil_profissional = p_perfil_profissional,
      setor = p_setor,
      situacao = 'Pendente',
      status = 'Inativo',
      senha_provisoria_enc = NULL,
      updated_at = NOW()
    WHERE id = v_existing_id;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Solicitação reenviada com sucesso! Ela foi registrada como Pendente no Gerenciamento de Usuários.'
    );
  END IF;

  v_new_id := 'usr_' || SUBSTRING(REPLACE(gen_random_uuid()::text, '-', ''), 1, 12);

  INSERT INTO public.usuarios (
    id,
    nome,
    matricula,
    email,
    login,
    perfil_profissional,
    setor,
    papel,
    situacao,
    status,
    senha_provisoria_enc,
    observacoes,
    created_at,
    updated_at
  ) VALUES (
    v_new_id,
    TRIM(p_nome),
    TRIM(p_matricula),
    LOWER(TRIM(p_email)),
    LOWER(COALESCE(NULLIF(TRIM(p_login), ''), SPLIT_PART(TRIM(p_email), '@', 1))),
    p_perfil_profissional,
    p_setor,
    'Visualizador',
    'Pendente',
    'Inativo',
    NULL,
    'Solicitação de acesso institucional registrada via página de login.',
    NOW(),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Solicitação registrada com sucesso! Ela foi enviada para o Gerenciamento de Usuários para análise da administração.'
  );
END;
$$;

-- Permissões mínimas para a RPC de solicitação
REVOKE ALL ON FUNCTION public.solicitar_novo_acesso(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.solicitar_novo_acesso(text, text, text, text, text, text) TO anon, authenticated;

-- 6. POLÍTICAS DE RLS REFORÇADAS NA TABELA public.usuarios
-- Garante que listas de usuários ou solicitações NÃO sejam públicas
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usuarios_select_policy" ON public.usuarios;
CREATE POLICY "usuarios_select_policy" ON public.usuarios
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin() OR auth_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "usuarios_insert_policy" ON public.usuarios;
CREATE POLICY "usuarios_insert_policy" ON public.usuarios
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
  );

DROP POLICY IF EXISTS "usuarios_update_policy" ON public.usuarios;
CREATE POLICY "usuarios_update_policy" ON public.usuarios
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin() OR auth_user_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin() OR (
      auth_user_id = auth.uid()
      AND papel = (SELECT u.papel FROM public.usuarios u WHERE u.auth_user_id = auth.uid())
      AND situacao = (SELECT u.situacao FROM public.usuarios u WHERE u.auth_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "usuarios_delete_policy" ON public.usuarios;
CREATE POLICY "usuarios_delete_policy" ON public.usuarios
  FOR DELETE
  TO authenticated
  USING (
    public.is_admin()
  );

-- 7. ISOLAMENTO TOTAL DOS DADOS OPERACIONAIS
-- Garante que usuários Pendentes ou Recusados não tenham acesso aos dados
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY['empreendedores', 'barragens', 'rts', 'revisoes', 'portarias', 'produtividades'];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_select_all_active" ON public.%I;', tbl, tbl);
    EXECUTE format('
      CREATE POLICY "%s_select_all_active" ON public.%I
        FOR SELECT
        TO authenticated
        USING (public.is_active_user());
    ', tbl, tbl);
  END LOOP;
END $$;
