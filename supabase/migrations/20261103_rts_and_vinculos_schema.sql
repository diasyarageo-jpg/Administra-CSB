-- ============================================================================
-- SCRIPT DE MIGRAÇÃO INCREMENTAL E IDEMPOTENTE:
-- MODELAGEM RELACIONAL DE RESPONSÁVEIS TÉCNICOS E VÍNCULOS DE ART/BARRAGENS
-- Administra-CSB / Notifica-CSB — SEMA-MT / SURH / CSB
-- Data: 03/11/2026
-- ============================================================================
-- Objetivo:
-- 1. Estabelecer o cadastro único por profissional na tabela public.rts.
-- 2. Manter e relacionar todos os vínculos individuais de ART/RRT e Barragens
--    na tabela public.responsaveis_tecnicos_barragens.
-- 3. Habilitar RLS estrito em ambas as tabelas (somente usuários ativos da CSB).
-- 4. Preservar 100% dos dados legados e chaves existentes (não destrutivo).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ESTRUTURA DA TABELA public.rts (Ficha Única do Profissional)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rts (
  id text PRIMARY KEY,
  nome text NOT NULL,
  cpf text,
  conselho text DEFAULT 'CREA-MT',
  uf_conselho text DEFAULT 'MT',
  registro text,
  especialidades text,
  telefone text,
  email text,
  situacao text DEFAULT 'Ativo',
  observacoes text,
  created_by text,
  updated_by text,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

-- Garante todas as colunas caso a tabela já existisse com menos campos
ALTER TABLE public.rts
  ADD COLUMN IF NOT EXISTS cpf text,
  ADD COLUMN IF NOT EXISTS conselho text DEFAULT 'CREA-MT',
  ADD COLUMN IF NOT EXISTS uf_conselho text DEFAULT 'MT',
  ADD COLUMN IF NOT EXISTS registro text,
  ADD COLUMN IF NOT EXISTS especialidades text,
  ADD COLUMN IF NOT EXISTS telefone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS situacao text DEFAULT 'Ativo',
  ADD COLUMN IF NOT EXISTS observacoes text,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

-- ----------------------------------------------------------------------------
-- 2. ESTRUTURA DA TABELA public.responsaveis_tecnicos_barragens (Vínculos de ART)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.responsaveis_tecnicos_barragens (
  id text PRIMARY KEY,
  rt_id text,
  nome text,
  art text,
  art_rrt text,
  barragem_id text,
  barragem_vinculada text,
  nome_barragem text,
  validade text,
  situacao text DEFAULT 'Ativo',
  observacoes text,
  created_by text,
  updated_by text,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

ALTER TABLE public.responsaveis_tecnicos_barragens
  ADD COLUMN IF NOT EXISTS rt_id text,
  ADD COLUMN IF NOT EXISTS nome text,
  ADD COLUMN IF NOT EXISTS art text,
  ADD COLUMN IF NOT EXISTS art_rrt text,
  ADD COLUMN IF NOT EXISTS barragem_id text,
  ADD COLUMN IF NOT EXISTS barragem_vinculada text,
  ADD COLUMN IF NOT EXISTS nome_barragem text,
  ADD COLUMN IF NOT EXISTS validade text,
  ADD COLUMN IF NOT EXISTS situacao text DEFAULT 'Ativo',
  ADD COLUMN IF NOT EXISTS observacoes text,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

-- ----------------------------------------------------------------------------
-- 3. ÍNDICES DE PERFORMANCE E PESQUISA
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rts_cpf ON public.rts(cpf);
CREATE INDEX IF NOT EXISTS idx_rts_registro ON public.rts(registro);
CREATE INDEX IF NOT EXISTS idx_rts_nome_trgm ON public.rts(nome);
CREATE INDEX IF NOT EXISTS idx_rt_barragens_rt_id ON public.responsaveis_tecnicos_barragens(rt_id);
CREATE INDEX IF NOT EXISTS idx_rt_barragens_art ON public.responsaveis_tecnicos_barragens(art);
CREATE INDEX IF NOT EXISTS idx_rt_barragens_barragem_id ON public.responsaveis_tecnicos_barragens(barragem_id);

-- ----------------------------------------------------------------------------
-- 4. POLÍTICAS DE ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------
ALTER TABLE public.rts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responsaveis_tecnicos_barragens ENABLE ROW LEVEL SECURITY;

-- Remove políticas anteriores para evitar duplicidade
DROP POLICY IF EXISTS "rts_select_active" ON public.rts;
DROP POLICY IF EXISTS "rts_insert_active" ON public.rts;
DROP POLICY IF EXISTS "rts_update_active" ON public.rts;
DROP POLICY IF EXISTS "rts_delete_admin" ON public.rts;

DROP POLICY IF EXISTS "responsaveis_tecnicos_barragens_select_active" ON public.responsaveis_tecnicos_barragens;
DROP POLICY IF EXISTS "responsaveis_tecnicos_barragens_insert_active" ON public.responsaveis_tecnicos_barragens;
DROP POLICY IF EXISTS "responsaveis_tecnicos_barragens_update_active" ON public.responsaveis_tecnicos_barragens;
DROP POLICY IF EXISTS "responsaveis_tecnicos_barragens_delete_admin" ON public.responsaveis_tecnicos_barragens;

-- Políticas para public.rts
CREATE POLICY "rts_select_active" ON public.rts
  FOR SELECT TO authenticated
  USING (public.is_active_user());

CREATE POLICY "rts_insert_active" ON public.rts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin() OR (public.get_my_role() = 'Usuário')
  );

CREATE POLICY "rts_update_active" ON public.rts
  FOR UPDATE TO authenticated
  USING (
    public.is_admin() OR (public.get_my_role() = 'Usuário')
  )
  WITH CHECK (
    public.is_admin() OR (public.get_my_role() = 'Usuário')
  );

CREATE POLICY "rts_delete_admin" ON public.rts
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- Políticas para public.responsaveis_tecnicos_barragens
CREATE POLICY "responsaveis_tecnicos_barragens_select_active" ON public.responsaveis_tecnicos_barragens
  FOR SELECT TO authenticated
  USING (public.is_active_user());

CREATE POLICY "responsaveis_tecnicos_barragens_insert_active" ON public.responsaveis_tecnicos_barragens
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin() OR (public.get_my_role() = 'Usuário')
  );

CREATE POLICY "responsaveis_tecnicos_barragens_update_active" ON public.responsaveis_tecnicos_barragens
  FOR UPDATE TO authenticated
  USING (
    public.is_admin() OR (public.get_my_role() = 'Usuário')
  )
  WITH CHECK (
    public.is_admin() OR (public.get_my_role() = 'Usuário')
  );

CREATE POLICY "responsaveis_tecnicos_barragens_delete_admin" ON public.responsaveis_tecnicos_barragens
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. PROCEDIMENTO IDEMPOTENTE DE MIGRAÇÃO INICIAL (SE rts ESTIVER VAZIA)
--    Gera o cadastro único de profissional para cada grupo com CPF/Registro
--    e vincula o rt_id correspondente em responsaveis_tecnicos_barragens.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_count_rts int;
  v_count_links int;
BEGIN
  SELECT COUNT(*) INTO v_count_rts FROM public.rts;
  SELECT COUNT(*) INTO v_count_links FROM public.responsaveis_tecnicos_barragens;

  IF v_count_rts = 0 AND v_count_links > 0 THEN
    -- Popula public.rts com base nos profissionais com identificador confiável
    INSERT INTO public.rts (id, nome, cpf, conselho, uf_conselho, registro, situacao, created_at, updated_at)
    SELECT
      'rt_' || md5(COALESCE(NULLIF(regexp_replace(cpf, '\D', '', 'g'), ''), NULLIF(registro, ''), id)),
      MAX(nome),
      NULLIF(regexp_replace(cpf, '\D', '', 'g'), ''),
      COALESCE(MAX(conselho), 'CREA-MT'),
      COALESCE(MAX(uf_conselho), 'MT'),
      MAX(registro),
      'Ativo',
      NOW(),
      NOW()
    FROM public.responsaveis_tecnicos_barragens
    GROUP BY COALESCE(NULLIF(regexp_replace(cpf, '\D', '', 'g'), ''), NULLIF(registro, ''), id)
    ON CONFLICT (id) DO NOTHING;

    -- Atualiza rt_id nos vínculos
    UPDATE public.responsaveis_tecnicos_barragens v
    SET rt_id = 'rt_' || md5(COALESCE(NULLIF(regexp_replace(v.cpf, '\D', '', 'g'), ''), NULLIF(v.registro, ''), v.id))
    WHERE v.rt_id IS NULL;

    RAISE NOTICE 'Migração inicial de profissionais em public.rts concluída com sucesso.';
  END IF;
END $$;
