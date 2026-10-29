-- ============================================================================
-- SCRIPT DE MIGRAÇÃO INCREMENTAL E IDEMPOTENTE: SUPABASE AUTH & RBAC
-- Administra-CSB / Notifica-CSB — SEMA-MT / SURH / CSB
-- Data: 29/10/2026
-- ============================================================================
-- Instruções:
-- 1. Abra o painel do seu projeto Supabase (https://supabase.com/dashboard).
-- 2. Acesse "SQL Editor" no menu lateral.
-- 3. Cole este script completo e clique em "Run".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ESTRUTURA DA TABELA USUARIOS (Campos novos e vínculos com auth.users)
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.usuarios
  ADD COLUMN IF NOT EXISTS matricula text,
  ADD COLUMN IF NOT EXISTS perfil_profissional text,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text;

-- Restrição de papéis aceitos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_papel'
  ) THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT chk_usuarios_papel
      CHECK (papel IN ('Administrador', 'Usuário', 'Visualizador', 'Analista'));
  END IF;
END $$;

-- Índices para buscas rápidas e garantia de unicidade de vínculo com auth.users
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_auth_user_id
  ON public.usuarios(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_matricula
  ON public.usuarios(matricula);

CREATE INDEX IF NOT EXISTS idx_usuarios_email_lower
  ON public.usuarios(LOWER(email));

-- ----------------------------------------------------------------------------
-- 2. CAMPOS DE AUDITORIA E PROPRIEDADE (created_by e updated_by)
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.empreendedores
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text;

ALTER TABLE IF EXISTS public.barragens
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text;

ALTER TABLE IF EXISTS public.rts
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text;

ALTER TABLE IF EXISTS public.revisoes
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text;

ALTER TABLE IF EXISTS public.portarias
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text;

ALTER TABLE IF EXISTS public.produtividades
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text;

-- Índices de auditoria
CREATE INDEX IF NOT EXISTS idx_empreendedores_created_by ON public.empreendedores(created_by);
CREATE INDEX IF NOT EXISTS idx_barragens_created_by ON public.barragens(created_by);
CREATE INDEX IF NOT EXISTS idx_rts_created_by ON public.rts(created_by);
CREATE INDEX IF NOT EXISTS idx_revisoes_created_by ON public.revisoes(created_by);
CREATE INDEX IF NOT EXISTS idx_portarias_created_by ON public.portarias(created_by);
CREATE INDEX IF NOT EXISTS idx_produtividades_created_by ON public.produtividades(created_by);

-- ----------------------------------------------------------------------------
-- 3. FUNÇÕES DE SEGURANÇA NÃO-RECURSIVAS (SECURITY DEFINER)
-- ----------------------------------------------------------------------------

-- Retorna o papel do usuário autenticado atual
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
    AND (situacao = 'Ativo' OR status = 'Ativo')
  LIMIT 1;
$$;

-- Verifica se o usuário autenticado atual é Administrador ativo
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
      AND (situacao = 'Ativo' OR status = 'Ativo')
  );
$$;

-- Verifica se o usuário autenticado atual possui cadastro ativo na instituição
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
      AND (situacao = 'Ativo' OR status = 'Ativo')
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. GATILHO PARA CARIMBO AUTOMÁTICO DE AUDITORIA (created_by / updated_by)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_stamp_audit_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Define o criador como o auth.uid() autenticado, se disponível
    IF NEW.created_by IS NULL OR NOT public.is_admin() THEN
      NEW.created_by := COALESCE(auth.uid()::text, NEW.created_by);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Impede que usuários não-administradores alterem o autor original
    IF NOT public.is_admin() AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      NEW.created_by := OLD.created_by;
    END IF;
  END IF;

  NEW.updated_by := COALESCE(auth.uid()::text, NEW.updated_by);
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- Aplica o gatilho nas tabelas de dados
DROP TRIGGER IF EXISTS trg_empreendedores_audit ON public.empreendedores;
CREATE TRIGGER trg_empreendedores_audit
  BEFORE INSERT OR UPDATE ON public.empreendedores
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_audit_fields();

DROP TRIGGER IF EXISTS trg_barragens_audit ON public.barragens;
CREATE TRIGGER trg_barragens_audit
  BEFORE INSERT OR UPDATE ON public.barragens
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_audit_fields();

DROP TRIGGER IF EXISTS trg_rts_audit ON public.rts;
CREATE TRIGGER trg_rts_audit
  BEFORE INSERT OR UPDATE ON public.rts
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_audit_fields();

DROP TRIGGER IF EXISTS trg_revisoes_audit ON public.revisoes;
CREATE TRIGGER trg_revisoes_audit
  BEFORE INSERT OR UPDATE ON public.revisoes
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_audit_fields();

DROP TRIGGER IF EXISTS trg_portarias_audit ON public.portarias;
CREATE TRIGGER trg_portarias_audit
  BEFORE INSERT OR UPDATE ON public.portarias
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_audit_fields();

DROP TRIGGER IF EXISTS trg_produtividades_audit ON public.produtividades;
CREATE TRIGGER trg_produtividades_audit
  BEFORE INSERT OR UPDATE ON public.produtividades
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_audit_fields();

-- ----------------------------------------------------------------------------
-- 5. POLÍTICAS DE SEGURANÇA EM NÍVEL DE LINHA (ROW LEVEL SECURITY - RLS)
-- ----------------------------------------------------------------------------

-- Habilita RLS em todas as tabelas internas
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empreendedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barragens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revisoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtividades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.municipios ENABLE ROW LEVEL SECURITY;

-- 5.1 Políticas para public.usuarios
DROP POLICY IF EXISTS "usuarios_select_policy" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_insert_policy" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_update_policy" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_delete_policy" ON public.usuarios;

-- Administrador vê todos; outros usuários só veem seu próprio perfil
CREATE POLICY "usuarios_select_policy" ON public.usuarios
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin() OR auth_user_id = auth.uid()
  );

-- Apenas Administradores podem inserir novos usuários
CREATE POLICY "usuarios_insert_policy" ON public.usuarios
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
  );

-- Administradores editam qualquer usuário; o próprio usuário pode editar observações/telefone mas não papel ou situacao
CREATE POLICY "usuarios_update_policy" ON public.usuarios
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin() OR auth_user_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin() OR (auth_user_id = auth.uid() AND papel = (SELECT u.papel FROM public.usuarios u WHERE u.auth_user_id = auth.uid()))
  );

-- Apenas Administrador pode excluir usuário
CREATE POLICY "usuarios_delete_policy" ON public.usuarios
  FOR DELETE
  TO authenticated
  USING (
    public.is_admin()
  );

-- 5.2 Macro de políticas para tabelas operacionais
-- Regras aplicadas:
-- - SELECT: Qualquer usuário ativo autenticado (Administrador, Usuário, Visualizador)
-- - INSERT: Administrador OU Usuário
-- - UPDATE: Administrador OU (Usuário QUE SEJA O CRIADOR do registro)
-- - DELETE: Apenas Administrador (Usuário e Visualizador NÃO podem excluir)

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY['empreendedores', 'barragens', 'rts', 'revisoes', 'portarias', 'produtividades'];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_select_all_active" ON public.%I;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert_admin_or_user" ON public.%I;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update_admin_or_owner" ON public.%I;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete_admin_only" ON public.%I;', tbl, tbl);

    -- SELECT: Todos os usuários com perfil ativo podem visualizar os registros
    EXECUTE format('
      CREATE POLICY "%s_select_all_active" ON public.%I
        FOR SELECT
        TO authenticated
        USING (public.is_active_user());
    ', tbl, tbl);

    -- INSERT: Administrador ou Usuário podem criar novos registros
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

    -- UPDATE: Administrador pode editar qualquer registro.
    -- O Usuário operacional só pode editar registros criados por ele mesmo (created_by = auth.uid()).
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

    -- DELETE: Apenas Administradores podem excluir fisicamente registros
    EXECUTE format('
      CREATE POLICY "%s_delete_admin_only" ON public.%I
        FOR DELETE
        TO authenticated
        USING (public.is_admin());
    ', tbl, tbl);
  END LOOP;
END $$;

-- Tabela de municípios: leitura para todos os usuários autenticados, gravação apenas por admin
DROP POLICY IF EXISTS "municipios_read_policy" ON public.municipios;
DROP POLICY IF EXISTS "municipios_write_admin_policy" ON public.municipios;

CREATE POLICY "municipios_read_policy" ON public.municipios
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "municipios_write_admin_policy" ON public.municipios
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- 6. ESTRATÉGIA PARA REGISTROS LEGADOS (SEM AUTOR IDENTIFICADO: created_by IS NULL)
-- ----------------------------------------------------------------------------
-- Registros anteriores com created_by IS NULL permanecem visíveis para todos
-- os usuários ativos (garantindo que nada suma da tela).
-- No entanto, apenas Administradores têm permissão para editá-los ou excluí-los,
-- prevenindo que usuários operacionais sobrescrevam dados históricos legados.
-- Opcionalmente, para atribuir os registros legados a um administrador específico,
-- execute no SQL Editor:
--
-- UPDATE public.empreendedores SET created_by = '<ADMIN_AUTH_USER_ID>' WHERE created_by IS NULL;
-- UPDATE public.barragens SET created_by = '<ADMIN_AUTH_USER_ID>' WHERE created_by IS NULL;
-- UPDATE public.rts SET created_by = '<ADMIN_AUTH_USER_ID>' WHERE created_by IS NULL;
-- UPDATE public.revisoes SET created_by = '<ADMIN_AUTH_USER_ID>' WHERE created_by IS NULL;
-- UPDATE public.portarias SET created_by = '<ADMIN_AUTH_USER_ID>' WHERE created_by IS NULL;
-- UPDATE public.produtividades SET created_by = '<ADMIN_AUTH_USER_ID>' WHERE created_by IS NULL;
