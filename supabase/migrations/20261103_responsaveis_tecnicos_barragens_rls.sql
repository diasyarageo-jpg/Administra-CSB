-- ============================================================================
-- SCRIPT DE MIGRAÇÃO INCREMENTAL E IDEMPOTENTE:
-- RLS E POLÍTICAS DE ACESSO PARA public.responsaveis_tecnicos_barragens
-- Administra-CSB / Notifica-CSB — SEMA-MT / SURH / CSB
-- Data: 03/11/2026
-- ============================================================================
-- Contexto:
-- Os 64 registros importados de Responsáveis Técnicos e vínculos de ART com
-- barragens estão armazenados na tabela public.responsaveis_tecnicos_barragens.
-- Este script garante a habilitação de RLS e o controle de acesso seguro (RBAC)
-- com base na função public.is_active_user(), sem expor dados anonimamente
-- e sem modificar ou apagar nenhum dado existente.
-- ============================================================================

DO $$
BEGIN
  -- 1. Habilita RLS na tabela responsaveis_tecnicos_barragens se ela existir
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'responsaveis_tecnicos_barragens'
  ) THEN
    EXECUTE 'ALTER TABLE public.responsaveis_tecnicos_barragens ENABLE ROW LEVEL SECURITY;';

    -- Remove políticas anteriores para evitar duplicidade ou conflitos
    EXECUTE 'DROP POLICY IF EXISTS "responsaveis_tecnicos_barragens_select_active" ON public.responsaveis_tecnicos_barragens;';
    EXECUTE 'DROP POLICY IF EXISTS "responsaveis_tecnicos_barragens_insert_active" ON public.responsaveis_tecnicos_barragens;';
    EXECUTE 'DROP POLICY IF EXISTS "responsaveis_tecnicos_barragens_update_active" ON public.responsaveis_tecnicos_barragens;';
    EXECUTE 'DROP POLICY IF EXISTS "responsaveis_tecnicos_barragens_delete_admin" ON public.responsaveis_tecnicos_barragens;';

    -- SELECT: Usuários autenticados com cadastro ativo na CSB podem consultar todos os vínculos de RT
    EXECUTE '
      CREATE POLICY "responsaveis_tecnicos_barragens_select_active" ON public.responsaveis_tecnicos_barragens
        FOR SELECT
        TO authenticated
        USING (public.is_active_user());
    ';

    -- INSERT: Administradores ou Usuários ativos
    EXECUTE '
      CREATE POLICY "responsaveis_tecnicos_barragens_insert_active" ON public.responsaveis_tecnicos_barragens
        FOR INSERT
        TO authenticated
        WITH CHECK (
          public.is_admin() OR (
            public.get_my_role() = ''Usuário''
          )
        );
    ';

    -- UPDATE: Administradores ou Usuários ativos
    EXECUTE '
      CREATE POLICY "responsaveis_tecnicos_barragens_update_active" ON public.responsaveis_tecnicos_barragens
        FOR UPDATE
        TO authenticated
        USING (
          public.is_admin() OR (
            public.get_my_role() = ''Usuário''
          )
        )
        WITH CHECK (
          public.is_admin() OR (
            public.get_my_role() = ''Usuário''
          )
        );
    ';

    -- DELETE: Apenas Administradores do sistema podem excluir
    EXECUTE '
      CREATE POLICY "responsaveis_tecnicos_barragens_delete_admin" ON public.responsaveis_tecnicos_barragens
        FOR DELETE
        TO authenticated
        USING (public.is_admin());
    ';

    RAISE NOTICE 'RLS e políticas configuradas com sucesso em public.responsaveis_tecnicos_barragens.';
  ELSE
    RAISE NOTICE 'Tabela public.responsaveis_tecnicos_barragens não encontrada nesta instância.';
  END IF;
END $$;
