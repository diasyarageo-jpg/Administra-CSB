-- ============================================================================
-- SCRIPT DE MIGRAÇÃO INCREMENTAL E IDEMPOTENTE:
-- PÁGINA DE LOGIN ISOLADA, SOLICITAÇÃO DE ACESSO, RLS E VÍNCULO DE CONTA ADMIN
-- Administra-CSB / Notifica-CSB — SEMA-MT / SURH / CSB
-- Data: 29/10/2026
-- ============================================================================
-- Instruções:
-- 1. Abra o painel do seu projeto Supabase (https://supabase.com/dashboard).
-- 2. Acesse "SQL Editor" no menu lateral.
-- 3. Cole este script completo e clique em "Run".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ESTRUTURA DA TABELA USUARIOS (Suporte a solicitações pendentes e recusas)
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.usuarios
  ADD COLUMN IF NOT EXISTS matricula text,
  ADD COLUMN IF NOT EXISTS perfil_profissional text,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS senha_provisoria_enc text,
  ADD COLUMN IF NOT EXISTS situacao text DEFAULT 'Ativo',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'Ativo',
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text;

-- Atualiza a restrição de situações aceitas na tabela usuarios
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

-- Atualiza a restrição de papéis aceitos
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

-- Índices essenciais
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_auth_user_id
  ON public.usuarios(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_situacao
  ON public.usuarios(situacao);

CREATE INDEX IF NOT EXISTS idx_usuarios_email_lower
  ON public.usuarios(LOWER(email));

-- ----------------------------------------------------------------------------
-- 2. VÍNCULO SEGURO DA CONTA AUTH EXISTENTE yarageologa@gmail.com
--    UID: f26897f0-bb2f-4dc7-a444-ee4550c8d569 como ADMINISTRADOR ATIVO
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_admin_uid uuid := 'f26897f0-bb2f-4dc7-a444-ee4550c8d569'::uuid;
  v_admin_email text := 'yarageologa@gmail.com';
  v_existing_id text;
BEGIN
  -- Verifica se já existe registro com esse e-mail ou esse auth_user_id
  SELECT id INTO v_existing_id
  FROM public.usuarios
  WHERE LOWER(email) = LOWER(v_admin_email) OR auth_user_id = v_admin_uid
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Atualiza o registro existente para garantir função de Administrador e Ativo
    UPDATE public.usuarios
    SET
      auth_user_id = v_admin_uid,
      papel = 'Administrador',
      situacao = 'Ativo',
      status = 'Ativo',
      nome = COALESCE(NULLIF(nome, ''), 'Yara Geóloga'),
      login = COALESCE(NULLIF(login, ''), 'yarageologa'),
      matricula = COALESCE(NULLIF(matricula, ''), 'SEMA-ADMIN-01'),
      perfil_profissional = COALESCE(NULLIF(perfil_profissional, ''), 'Analista de Meio Ambiente'),
      setor = COALESCE(NULLIF(setor, ''), 'Setor de Fiscalização'),
      updated_at = NOW()
    WHERE id = v_existing_id;
  ELSE
    -- Insere o cadastro com os vínculos corretos
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

-- ----------------------------------------------------------------------------
-- 3. FUNÇÕES DE SEGURANÇA NÃO-RECURSIVAS (SECURITY DEFINER)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(papel, 'Visualizador')
  FROM public.usuarios
  WHERE auth_user_id = auth.uid()
    AND situacao = 'Ativo'
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
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE auth_user_id = auth.uid()
      AND situacao = 'Ativo'
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. POLÍTICAS DE RLS PARA public.usuarios
--    - Administradores veem TODOS os registros (Ativos, Inativos, Pendentes, Recusados)
--    - Usuários operacionais veem apenas o seu próprio perfil
--    - Acesso anônimo não possui permissão de leitura direta
-- ----------------------------------------------------------------------------
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usuarios_select_policy" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_insert_policy" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_update_policy" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_delete_policy" ON public.usuarios;

-- SELECT: Administrador lista todos os usuários de todas as funções e situações; outros veem apenas o seu
CREATE POLICY "usuarios_select_policy" ON public.usuarios
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin() OR auth_user_id = auth.uid()
  );

-- INSERT: Apenas Administradores podem inserir diretamente na tabela (solicitações passam pela Edge Function)
CREATE POLICY "usuarios_insert_policy" ON public.usuarios
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
  );

-- UPDATE: Administrador pode atualizar qualquer usuário; o usuário pode atualizar seu próprio perfil sem alterar papel/situação
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

-- DELETE: Apenas Administradores podem excluir
CREATE POLICY "usuarios_delete_policy" ON public.usuarios
  FOR DELETE
  TO authenticated
  USING (
    public.is_admin()
  );

-- ----------------------------------------------------------------------------
-- 5. POLÍTICAS DE RLS PARA TABELAS OPERACIONAIS
--    (Isolamento rigoroso: nenhum dado exposto para usuários não-autenticados ou pendentes)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY['empreendedores', 'barragens', 'rts', 'revisoes', 'portarias', 'produtividades'];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_select_all_active" ON public.%I;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert_admin_or_user" ON public.%I;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update_admin_or_owner" ON public.%I;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete_admin_only" ON public.%I;', tbl, tbl);

    -- SELECT: Apenas usuários autenticados e com cadastro ATIVO na CSB podem ler dados do sistema
    EXECUTE format('
      CREATE POLICY "%s_select_all_active" ON public.%I
        FOR SELECT
        TO authenticated
        USING (public.is_active_user());
    ', tbl, tbl);

    -- INSERT: Administrador ou Usuário operacional ativo
    EXECUTE format('
      CREATE POLICY "%s_insert_admin_or_user" ON public.%I
        FOR INSERT
        TO authenticated
        WITH CHECK (
          public.is_admin() OR (
            public.get_my_role() = ''Usuário''
            AND (created_by IS NULL OR created_by = auth.uid()::text)
          )
        );
    ', tbl, tbl);

    -- UPDATE: Administrador ou o próprio criador do registro
    EXECUTE format('
      CREATE POLICY "%s_update_admin_or_owner" ON public.%I
        FOR UPDATE
        TO authenticated
        USING (
          public.is_admin() OR (
            public.get_my_role() = ''Usuário''
            AND created_by = auth.uid()::text
          )
        )
        WITH CHECK (
          public.is_admin() OR (
            public.get_my_role() = ''Usuário''
            AND created_by = auth.uid()::text
          )
        );
    ', tbl, tbl);

    -- DELETE: Exclusão apenas por Administrador
    EXECUTE format('
      CREATE POLICY "%s_delete_admin_only" ON public.%I
        FOR DELETE
        TO authenticated
        USING (public.is_admin());
    ', tbl, tbl);
  END LOOP;
END $$;

-- Leitura de municípios
ALTER TABLE IF EXISTS public.municipios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "municipios_read_policy" ON public.municipios;
CREATE POLICY "municipios_read_policy" ON public.municipios
  FOR SELECT
  TO authenticated
  USING (true);
