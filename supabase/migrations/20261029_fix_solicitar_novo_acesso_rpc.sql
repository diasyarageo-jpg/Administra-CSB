-- ============================================================================
-- SCRIPT DE AJUSTE: SOLICITAÇÃO DE NOVO ACESSO E APROVAÇÃO DIRETA NO SUPABASE
-- Administra-CSB / Notifica-CSB — SEMA-MT / SURH / CSB
-- Data: 29/10/2026
-- ============================================================================
-- Este script resolve o erro "Failed to send a request to the Edge Function"
-- implementando funções nativas no PostgreSQL (RPC com SECURITY DEFINER)
-- e ajustando as políticas de RLS para que:
-- 1. Qualquer servidor na página de login possa enviar sua solicitação de acesso,
--    sendo registrada com situação 'Pendente' e enviada à tela Gerenciamento de Usuários.
-- 2. Administradores visualizem todas as solicitações e, ao aceitar/aprovar,
--    o usuário seja imediatamente transformado em usuário 'Ativo' com seu respectivo papel.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. GARANTE AS COLUNAS NECESSÁRIAS NA TABELA public.usuarios
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

-- Restrição de situações
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

-- Restrição de papéis
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

-- ----------------------------------------------------------------------------
-- 2. FUNÇÃO RPC: solicitar_novo_acesso
--    Permite o envio seguro da solicitação na tela de login sem Edge Function.
--    Salva com situação 'Pendente' para análise no Gerenciamento de Usuários.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitar_novo_acesso(
  p_nome text,
  p_matricula text,
  p_email text,
  p_login text,
  p_perfil_profissional text,
  p_setor text,
  p_senha text DEFAULT '@12345'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id text;
  v_existing_id text;
  v_existing_situacao text;
BEGIN
  -- Validações de campos obrigatórios
  IF TRIM(COALESCE(p_nome, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nome completo é obrigatório.');
  END IF;
  IF TRIM(COALESCE(p_matricula, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Matrícula funcional é obrigatória.');
  END IF;
  IF TRIM(COALESCE(p_email, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'E-mail institucional é obrigatório.');
  END IF;

  -- Verifica se já existe registro com esse e-mail
  SELECT id, situacao INTO v_existing_id, v_existing_situacao
  FROM public.usuarios
  WHERE LOWER(email) = LOWER(TRIM(p_email))
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_situacao = 'Ativo' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Já existe um cadastro ativo com este e-mail institucional. Utilize a recuperação de senha.');
    END IF;

    -- Atualiza a solicitação pendente existente
    UPDATE public.usuarios
    SET
      nome = TRIM(p_nome),
      matricula = TRIM(p_matricula),
      login = LOWER(COALESCE(NULLIF(TRIM(p_login), ''), SPLIT_PART(TRIM(p_email), '@', 1))),
      perfil_profissional = p_perfil_profissional,
      setor = p_setor,
      senha_provisoria_enc = COALESCE(NULLIF(TRIM(p_senha), ''), '@12345'),
      situacao = 'Pendente',
      status = 'Pendente',
      updated_at = NOW()
    WHERE id = v_existing_id;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Solicitação reenviada com sucesso! Aguarde a avaliação de um administrador na página Gerenciamento de Usuários.'
    );
  END IF;

  -- Gera identificador para o usuário
  v_new_id := 'usr_' || SUBSTRING(REPLACE(gen_random_uuid()::text, '-', ''), 1, 12);

  -- Registra a nova solicitação com situação Pendente
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
    'Pendente',
    COALESCE(NULLIF(TRIM(p_senha), ''), '@12345'),
    'Solicitação realizada via página de login institucional.',
    NOW(),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Solicitação registrada com sucesso! Ela foi enviada para a página Gerenciamento de Usuários para análise de um administrador.'
  );
END;
$$;

-- Permite chamada por usuários anônimos e autenticados
GRANT EXECUTE ON FUNCTION public.solicitar_novo_acesso(text, text, text, text, text, text, text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. FUNÇÃO RPC: aprovar_usuario
--    Executada por Administradores na página de Gerenciamento de Usuários.
--    Transforma a solicitação em usuário Ativo e vincula a conta Auth existente se houver.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aprovar_usuario(
  p_usuario_id text,
  p_papel text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_auth_uid uuid;
BEGIN
  -- Confirma se o executor é Administrador ativo
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permissão negada. Apenas administradores podem aprovar solicitações de acesso.');
  END IF;

  SELECT * INTO v_user
  FROM public.usuarios
  WHERE id = p_usuario_id
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário não encontrado na base de dados.');
  END IF;

  -- Se existir conta correspondente no Supabase Auth (auth.users), vincula automaticamente
  SELECT id INTO v_auth_uid
  FROM auth.users
  WHERE LOWER(email) = LOWER(v_user.email)
  LIMIT 1;

  -- Transforma em usuário Ativo no Supabase com o papel selecionado
  UPDATE public.usuarios
  SET
    papel = p_papel,
    situacao = 'Ativo',
    status = 'Ativo',
    auth_user_id = COALESCE(v_auth_uid, v_user.auth_user_id),
    updated_at = NOW()
  WHERE id = p_usuario_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Usuário aprovado com sucesso! A situação foi alterada para Ativo.',
    'auth_user_id', COALESCE(v_auth_uid, v_user.auth_user_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.aprovar_usuario(text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. FUNÇÃO RPC: recusar_usuario
--    Registra a recusa sem conceder acesso.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recusar_usuario(
  p_usuario_id text,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permissão negada. Apenas administradores podem recusar solicitações de acesso.');
  END IF;

  UPDATE public.usuarios
  SET
    situacao = 'Recusado',
    status = 'Inativo',
    observacoes = CASE
      WHEN p_motivo IS NOT NULL AND TRIM(p_motivo) <> '' THEN
        COALESCE(observacoes, '') || ' [Recusado: ' || TRIM(p_motivo) || ']'
      ELSE observacoes
    END,
    updated_at = NOW()
  WHERE id = p_usuario_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Solicitação de acesso recusada com sucesso.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.recusar_usuario(text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. POLÍTICAS DE RLS PARA A TABELA public.usuarios
-- ----------------------------------------------------------------------------
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

-- Garante que administradores leem todos os registros (incluindo Pendentes e Recusados)
DROP POLICY IF EXISTS "usuarios_select_policy" ON public.usuarios;
CREATE POLICY "usuarios_select_policy" ON public.usuarios
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin() OR auth_user_id = auth.uid()
  );

-- Permite inserção de solicitações 'Pendente' tanto via anon quanto via authenticated
DROP POLICY IF EXISTS "usuarios_insert_policy" ON public.usuarios;
CREATE POLICY "usuarios_insert_policy" ON public.usuarios
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    public.is_admin() OR situacao = 'Pendente'
  );

-- Atualização: Administradores podem aprovar/alterar qualquer usuário
DROP POLICY IF EXISTS "usuarios_update_policy" ON public.usuarios;
CREATE POLICY "usuarios_update_policy" ON public.usuarios
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin() OR auth_user_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin() OR auth_user_id = auth.uid()
  );
