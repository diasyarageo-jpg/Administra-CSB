-- ============================================================================
-- SCRIPT DE MIGRAÇÃO INCREMENTAL E IDEMPOTENTE:
-- HARDENING DE AUDITORIA (HISTÓRICO, VIEW, SOLICITAÇÕES E RPCS DE INTEGRAÇÃO)
-- Administra-CSB — SEMA-MT / SURH / CSB
-- ============================================================================
-- Objetivo:
--   Reproduzir de forma versionada e idempotente as contenções de acesso sobre
--   objetos de auditoria e RPCs legadas de integração externa, sem presumir que
--   migrações anteriores ou políticas específicas já estejam aplicadas em todos
--   os ambientes.
--
-- Diretriz de arquitetura (Interface futura de Auditoria):
--   A futura interface de Auditoria do Administra NÃO deve consultar
--   diretamente `public.historico_alteracoes_dados`,
--   `public.vw_historico_alteracoes_dados`, `public.listar_historico_alteracoes`
--   ou `public.solicitacoes_alteracao_externa` a partir do navegador, pois esses
--   objetos contêm snapshots brutos (`dados_anteriores`, `dados_novos`,
--   `campos_alterados`, `dados_propostos`, `dados_atuais_snapshot`) sem
--   mascaramento de dados pessoais (CPF/CNPJ, e-mail, telefone) ou redação de
--   campos sensíveis.
--   Qualquer interface futura de Auditoria deve consumir exclusivamente uma
--   camada server-side autorizada (restrita a Administrador) e sanitizada,
--   jamais expondo snapshots brutos ao navegador.
--
-- Nota sobre privilégios:
--   - Revoga privilégios de `PUBLIC`, `anon` e `authenticated`.
--   - Preserva integralmente os privilégios já existentes de `service_role`.
--   - Não concede nenhum acesso novo a `service_role` ou a outros papéis.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. TABELAS DE AUDITORIA E SOLICITAÇÕES EXTERNAS:
--    Revogar privilégios de PUBLIC, anon e authenticated, manter RLS ativa e
--    remover políticas permissivas para não administradores.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'historico_alteracoes_dados'
      AND c.relkind IN ('r', 'p')
  ) THEN
    EXECUTE 'ALTER TABLE public.historico_alteracoes_dados ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "historico_alteracoes_select_policy" ON public.historico_alteracoes_dados';
    EXECUTE 'REVOKE ALL ON TABLE public.historico_alteracoes_dados FROM PUBLIC, anon, authenticated';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'solicitacoes_alteracao_externa'
      AND c.relkind IN ('r', 'p')
  ) THEN
    EXECUTE 'ALTER TABLE public.solicitacoes_alteracao_externa ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "solicitacoes_alteracao_select_policy" ON public.solicitacoes_alteracao_externa';
    EXECUTE 'REVOKE ALL ON TABLE public.solicitacoes_alteracao_externa FROM PUBLIC, anon, authenticated';
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. VIEW DE HISTÓRICO (`vw_historico_alteracoes_dados`):
--    Revogar todos os privilégios (incluindo SELECT e DML em view atualizável)
--    de PUBLIC, anon e authenticated, preservando eventuais privilégios atuais
--    de service_role.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'vw_historico_alteracoes_dados'
      AND c.relkind IN ('v', 'm')
  ) THEN
    EXECUTE 'REVOKE ALL ON public.vw_historico_alteracoes_dados FROM PUBLIC, anon, authenticated';
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 3. FUNÇÕES / RPCS DE HISTÓRICO E INTEGRAÇÃO EXTERNA:
--    Revogar EXECUTE de PUBLIC, anon e authenticated nas assinaturas reais
--    confirmadas, preservando os privilégios atuais de service_role.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.listar_historico_alteracoes(text, text, text, text, integer, integer)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.listar_historico_alteracoes(text, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated';
  END IF;

  IF to_regprocedure('public.integracao_inserir_registro(text, text, text, jsonb, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.integracao_inserir_registro(text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated';
  END IF;

  IF to_regprocedure('public.integracao_solicitar_edicao(text, text, text, text, jsonb, text, text, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.integracao_solicitar_edicao(text, text, text, text, jsonb, text, text, text) FROM PUBLIC, anon, authenticated';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
