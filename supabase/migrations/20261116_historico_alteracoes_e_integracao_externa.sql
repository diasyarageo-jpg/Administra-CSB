-- ============================================================================
-- SCRIPT DE MIGRAÇÃO INCREMENTAL E IDEMPOTENTE:
-- HISTÓRICO COMPLETO DE ALTERAÇÕES (LOGIN, DATA, SISTEMA), RESTAURAÇÃO POR
-- ADMINISTRADOR E INSERÇÃO / SOLICITAÇÃO DE EDIÇÃO POR SISTEMAS EXTERNOS
-- Administra-CSB — SEMA-MT / SURH / CSB
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABELA DE HISTÓRICO DE ALTERAÇÕES DOS DADOS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.historico_alteracoes_dados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela_nome text NOT NULL,
  registro_id text NOT NULL,
  operacao text NOT NULL CHECK (operacao IN ('INSERT', 'UPDATE', 'DELETE', 'RESTAURACAO')),
  usuario_id text,
  usuario_login text NOT NULL,
  usuario_nome text,
  auth_user_id uuid,
  sistema_origem text NOT NULL DEFAULT 'Administra',
  alterado_em timestamptz NOT NULL DEFAULT now(),
  campos_alterados jsonb NOT NULL DEFAULT '{}'::jsonb,
  dados_anteriores jsonb,
  dados_novos jsonb,
  motivo text,
  restaurado_de_historico_id uuid REFERENCES public.historico_alteracoes_dados(id) ON DELETE SET NULL,
  solicitacao_externa_id uuid
);

CREATE INDEX IF NOT EXISTS idx_hist_dados_tabela_reg_data
  ON public.historico_alteracoes_dados (tabela_nome, registro_id, alterado_em DESC);

CREATE INDEX IF NOT EXISTS idx_hist_dados_alterado_em
  ON public.historico_alteracoes_dados (alterado_em DESC);

CREATE INDEX IF NOT EXISTS idx_hist_dados_usuario_login
  ON public.historico_alteracoes_dados (usuario_login, alterado_em DESC);

CREATE INDEX IF NOT EXISTS idx_hist_dados_sistema_origem
  ON public.historico_alteracoes_dados (sistema_origem, alterado_em DESC);

CREATE INDEX IF NOT EXISTS idx_hist_dados_restaurado_de
  ON public.historico_alteracoes_dados (restaurado_de_historico_id)
  WHERE restaurado_de_historico_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. TABELA DE SOLICITAÇÕES DE EDIÇÃO / INSERÇÃO POR SISTEMAS EXTERNOS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.solicitacoes_alteracao_externa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sistema_origem text NOT NULL,
  usuario_login text NOT NULL,
  usuario_nome text,
  tabela_nome text NOT NULL,
  registro_id text NOT NULL,
  tipo_solicitacao text NOT NULL DEFAULT 'EDICAO' CHECK (tipo_solicitacao IN ('INSERCAO', 'EDICAO')),
  dados_propostos jsonb NOT NULL,
  dados_atuais_snapshot jsonb,
  justificativa text,
  referencia_externa text,
  status text NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Aprovada', 'Rejeitada', 'Cancelada')),
  solicitado_em timestamptz NOT NULL DEFAULT now(),
  analisado_em timestamptz,
  analisado_por_id text,
  analisado_por_login text,
  analisado_por_uid uuid,
  observacao_analise text,
  historico_id uuid REFERENCES public.historico_alteracoes_dados(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_solic_ext_status_data
  ON public.solicitacoes_alteracao_externa (status, solicitado_em DESC);

CREATE INDEX IF NOT EXISTS idx_solic_ext_tabela_reg
  ON public.solicitacoes_alteracao_externa (tabela_nome, registro_id);

CREATE INDEX IF NOT EXISTS idx_solic_ext_sistema
  ON public.solicitacoes_alteracao_externa (sistema_origem, solicitado_em DESC);

-- ----------------------------------------------------------------------------
-- 3. RLS ESTRITA PARA HISTÓRICO E SOLICITAÇÕES EXTERNAS
-- ----------------------------------------------------------------------------
ALTER TABLE public.historico_alteracoes_dados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes_alteracao_externa ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.historico_alteracoes_dados FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.solicitacoes_alteracao_externa FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.historico_alteracoes_dados TO authenticated;
GRANT SELECT ON TABLE public.solicitacoes_alteracao_externa TO authenticated;

DROP POLICY IF EXISTS "historico_alteracoes_select_policy" ON public.historico_alteracoes_dados;
CREATE POLICY "historico_alteracoes_select_policy" ON public.historico_alteracoes_dados
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR (public.is_active_user() AND tabela_nome <> 'usuarios')
  );

DROP POLICY IF EXISTS "solicitacoes_alteracao_select_policy" ON public.solicitacoes_alteracao_externa;
CREATE POLICY "solicitacoes_alteracao_select_policy" ON public.solicitacoes_alteracao_externa
  FOR SELECT
  TO authenticated
  USING (public.is_active_user());

-- ----------------------------------------------------------------------------
-- 4. FUNÇÕES AUXILIARES DE CONTEXTO, PAPEL E SANITIZAÇÃO
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_service_role_caller()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role', ''),
    current_user
  ) = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public._resolver_ator_auditoria()
RETURNS TABLE (
  usuario_id text,
  usuario_login text,
  usuario_nome text,
  auth_user_id uuid,
  sistema_origem text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ctx_login text := NULLIF(btrim(COALESCE(current_setting('app.usuario_login', true), '')), '');
  v_ctx_sistema text := NULLIF(btrim(COALESCE(current_setting('app.sistema_origem', true), '')), '');
  v_jwt_email text := NULLIF(btrim(COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'email'), '');
  v_jwt_sistema text := NULLIF(btrim(COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sistema_origem'), '');
  v_u_id text;
  v_u_login text;
  v_u_nome text;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT u.id, COALESCE(NULLIF(btrim(u.login), ''), NULLIF(btrim(u.email), '')), u.nome
    INTO v_u_id, v_u_login, v_u_nome
    FROM public.usuarios u
    WHERE u.auth_user_id = v_uid
    LIMIT 1;
  END IF;

  usuario_id := v_u_id;
  usuario_login := COALESCE(v_ctx_login, v_u_login, v_jwt_email, CASE WHEN public._is_service_role_caller() THEN 'integracao_sistema' ELSE 'sistema' END);
  usuario_nome := v_u_nome;
  auth_user_id := v_uid;
  sistema_origem := COALESCE(v_ctx_sistema, v_jwt_sistema, 'Administra');
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_contexto_auditoria(
  p_sistema_origem text DEFAULT 'Administra',
  p_usuario_login text DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sistema text := COALESCE(NULLIF(btrim(p_sistema_origem), ''), 'Administra');
BEGIN
  PERFORM set_config('app.sistema_origem', v_sistema, true);

  IF p_usuario_login IS NOT NULL AND (public._is_service_role_caller() OR public.is_admin()) THEN
    PERFORM set_config('app.usuario_login', NULLIF(btrim(p_usuario_login), ''), true);
  END IF;

  IF p_motivo IS NOT NULL THEN
    PERFORM set_config('app.motivo_alteracao', NULLIF(btrim(p_motivo), ''), true);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_contexto_auditoria(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_contexto_auditoria(text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._sanitizar_jsonb_para_tabela(
  p_tabela_nome text,
  p_dados jsonb,
  p_excluir_colunas text[] DEFAULT ARRAY['id', 'created_at', 'created_by', 'updated_at', 'updated_by']
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_col record;
  v_val jsonb;
BEGIN
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR v_col IN
    SELECT c.column_name, c.data_type
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = p_tabela_nome
      AND c.is_generated = 'NEVER'
      AND NOT (c.column_name = ANY(COALESCE(p_excluir_colunas, ARRAY[]::text[])))
  LOOP
    IF p_dados ? v_col.column_name THEN
      v_val := p_dados -> v_col.column_name;
      IF jsonb_typeof(v_val) = 'string'
         AND btrim(v_val #>> '{}') = ''
         AND v_col.data_type NOT IN ('text', 'character varying', 'character') THEN
        v_val := 'null'::jsonb;
      END IF;
      v_result := v_result || jsonb_build_object(v_col.column_name, v_val);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public._sanitizar_jsonb_para_tabela(text, jsonb, text[]) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. GATILHO UNIVERSAL DE HISTÓRICO DE ALTERAÇÕES
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_registrar_historico_alteracoes_dados()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_campos_alterados jsonb := '{}'::jsonb;
  v_key text;
  v_reg_id text;
  v_operacao text;
  v_ator record;
  v_motivo text := NULLIF(btrim(COALESCE(current_setting('app.motivo_alteracao', true), '')), '');
  v_restaurado_de_raw text := NULLIF(btrim(COALESCE(current_setting('app.restaurado_de_historico_id', true), '')), '');
  v_solic_ext_raw text := NULLIF(btrim(COALESCE(current_setting('app.solicitacao_externa_id', true), '')), '');
  v_restaurado_de uuid;
  v_solic_ext_id uuid;
  v_hist_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_reg_id := COALESCE(NULLIF(v_new ->> 'id', ''), md5(v_new::text));
    v_operacao := 'INSERT';
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_reg_id := COALESCE(NULLIF(v_new ->> 'id', ''), NULLIF(v_old ->> 'id', ''), md5(v_new::text));
    v_operacao := 'UPDATE';
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_reg_id := COALESCE(NULLIF(v_old ->> 'id', ''), md5(v_old::text));
    v_operacao := 'DELETE';
  ELSE
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'usuarios' THEN
    IF v_old IS NOT NULL THEN
      v_old := v_old - 'senha_provisoria_enc';
    END IF;
    IF v_new IS NOT NULL THEN
      v_new := v_new - 'senha_provisoria_enc';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN
      SELECT DISTINCT k
      FROM (
        SELECT jsonb_object_keys(v_old) AS k
        UNION
        SELECT jsonb_object_keys(v_new) AS k
      ) keys
    LOOP
      IF v_key IN ('updated_at', 'updated_by') THEN
        CONTINUE;
      END IF;
      IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
        v_campos_alterados := v_campos_alterados || jsonb_build_object(
          v_key,
          jsonb_build_object(
            'antes', COALESCE(v_old -> v_key, 'null'::jsonb),
            'depois', COALESCE(v_new -> v_key, 'null'::jsonb)
          )
        );
      END IF;
    END LOOP;

    IF v_campos_alterados = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  END IF;

  IF v_restaurado_de_raw IS NOT NULL THEN
    BEGIN
      v_restaurado_de := v_restaurado_de_raw::uuid;
      v_operacao := 'RESTAURACAO';
    EXCEPTION WHEN OTHERS THEN
      v_restaurado_de := NULL;
    END;
  END IF;

  IF v_solic_ext_raw IS NOT NULL THEN
    BEGIN
      v_solic_ext_id := v_solic_ext_raw::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_solic_ext_id := NULL;
    END;
  END IF;

  SELECT * INTO v_ator FROM public._resolver_ator_auditoria() LIMIT 1;

  INSERT INTO public.historico_alteracoes_dados (
    tabela_nome,
    registro_id,
    operacao,
    usuario_id,
    usuario_login,
    usuario_nome,
    auth_user_id,
    sistema_origem,
    alterado_em,
    campos_alterados,
    dados_anteriores,
    dados_novos,
    motivo,
    restaurado_de_historico_id,
    solicitacao_externa_id
  )
  VALUES (
    TG_TABLE_NAME,
    v_reg_id,
    v_operacao,
    v_ator.usuario_id,
    v_ator.usuario_login,
    v_ator.usuario_nome,
    v_ator.auth_user_id,
    v_ator.sistema_origem,
    now(),
    v_campos_alterados,
    v_old,
    v_new,
    v_motivo,
    v_restaurado_de,
    v_solic_ext_id
  )
  RETURNING id INTO v_hist_id;

  PERFORM set_config('app.ultimo_historico_id', v_hist_id::text, true);

  RETURN NULL;
END;
$$;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'empreendedores',
    'barragens',
    'rts',
    'responsaveis_tecnicos_barragens',
    'revisoes',
    'portarias',
    'produtividades',
    'usuarios',
    'documentos_catalogo',
    'documento_vinculos'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS "trg_hist_%s" ON public.%I;', tbl, tbl);
      EXECUTE format('
        CREATE TRIGGER "trg_hist_%s"
          AFTER INSERT OR UPDATE OR DELETE ON public.%I
          FOR EACH ROW EXECUTE FUNCTION public.trg_registrar_historico_alteracoes_dados();
      ', tbl, tbl);
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 6. VISÃO E RPC DE LISTAGEM DO HISTÓRICO DE ALTERAÇÕES
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_historico_alteracoes_dados
WITH (security_invoker = true) AS
SELECT
  h.id,
  h.tabela_nome,
  h.registro_id,
  h.operacao,
  h.usuario_id,
  h.usuario_login,
  h.usuario_nome,
  h.sistema_origem,
  h.alterado_em,
  h.motivo,
  h.campos_alterados,
  h.dados_anteriores,
  h.dados_novos,
  h.restaurado_de_historico_id,
  h.solicitacao_externa_id,
  ((h.dados_anteriores IS NOT NULL OR h.dados_novos IS NOT NULL) AND public.is_admin()) AS pode_restaurar
FROM public.historico_alteracoes_dados h
ORDER BY h.alterado_em DESC;

GRANT SELECT ON public.vw_historico_alteracoes_dados TO authenticated;

CREATE OR REPLACE FUNCTION public.listar_historico_alteracoes(
  p_tabela_nome text DEFAULT NULL,
  p_registro_id text DEFAULT NULL,
  p_sistema_origem text DEFAULT NULL,
  p_usuario_login text DEFAULT NULL,
  p_limite integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS SETOF public.vw_historico_alteracoes_dados
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lim integer := LEAST(GREATEST(COALESCE(p_limite, 100), 1), 500);
  v_off integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Acesso negado: usuário inativo ou não autenticado.';
  END IF;

  RETURN QUERY
  SELECT vw.*
  FROM public.vw_historico_alteracoes_dados vw
  WHERE (public.is_admin() OR vw.tabela_nome <> 'usuarios')
    AND (NULLIF(btrim(p_tabela_nome), '') IS NULL OR vw.tabela_nome = btrim(p_tabela_nome))
    AND (NULLIF(btrim(p_registro_id), '') IS NULL OR vw.registro_id = btrim(p_registro_id))
    AND (NULLIF(btrim(p_sistema_origem), '') IS NULL OR lower(vw.sistema_origem) = lower(btrim(p_sistema_origem)))
    AND (NULLIF(btrim(p_usuario_login), '') IS NULL OR lower(vw.usuario_login) = lower(btrim(p_usuario_login)))
  ORDER BY vw.alterado_em DESC
  LIMIT v_lim
  OFFSET v_off;
END;
$$;

REVOKE ALL ON FUNCTION public.listar_historico_alteracoes(text, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_historico_alteracoes(text, text, text, text, integer, integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. RPC DE RESTAURAÇÃO PARA EDIÇÃO ANTIGA (EXCLUSIVA PARA ADMINISTRADOR)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restaurar_versao_historico(
  p_historico_id uuid,
  p_modo text DEFAULT 'anterior',
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hist public.historico_alteracoes_dados%ROWTYPE;
  v_modo text := lower(btrim(COALESCE(p_modo, 'anterior')));
  v_snapshot jsonb;
  v_tabela text;
  v_reg_id text;
  v_ator record;
  v_motivo text;
  v_set_parts text[] := ARRAY[]::text[];
  v_col_list text;
  v_ins_cols text;
  v_ins_vals text;
  v_has_updated_at boolean := false;
  v_has_updated_by boolean := false;
  v_row_count integer := 0;
  v_uid_text text := auth.uid()::text;
  v_new_hist_id text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Permissão negada: apenas usuários com perfil Administrador podem restaurar alterações antigas.'
    );
  END IF;

  IF p_historico_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Identificador do histórico é obrigatório.');
  END IF;

  IF v_modo NOT IN ('anterior', 'novo') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Modo de restauração inválido. Utilize "anterior" ou "novo".');
  END IF;

  SELECT *
  INTO v_hist
  FROM public.historico_alteracoes_dados
  WHERE id = p_historico_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Registro de histórico não encontrado.');
  END IF;

  v_tabela := v_hist.tabela_nome;
  v_reg_id := v_hist.registro_id;

  IF v_tabela NOT IN (
    'empreendedores',
    'barragens',
    'rts',
    'responsaveis_tecnicos_barragens',
    'revisoes',
    'portarias',
    'produtividades',
    'usuarios',
    'documentos_catalogo',
    'documento_vinculos'
  ) OR to_regclass('public.' || v_tabela) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', format('Tabela "%s" não habilitada para restauração.', v_tabela));
  END IF;

  v_snapshot := CASE
    WHEN v_modo = 'anterior' THEN v_hist.dados_anteriores
    ELSE v_hist.dados_novos
  END;

  IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A versão selecionada no histórico não possui snapshot restaurável.');
  END IF;

  IF v_tabela = 'usuarios' THEN
    v_snapshot := v_snapshot - 'senha_provisoria_enc';
  END IF;

  SELECT * INTO v_ator FROM public._resolver_ator_auditoria() LIMIT 1;
  v_motivo := COALESCE(
    NULLIF(btrim(p_motivo), ''),
    format('Restauração administrativa (%s) a partir do histórico %s', v_modo, p_historico_id::text)
  );

  PERFORM set_config('app.sistema_origem', 'Administra', true);
  PERFORM set_config('app.usuario_login', v_ator.usuario_login, true);
  PERFORM set_config('app.motivo_alteracao', v_motivo, true);
  PERFORM set_config('app.restaurado_de_historico_id', p_historico_id::text, true);
  PERFORM set_config('app.ultimo_historico_id', '', true);

  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_tabela AND column_name = 'updated_at'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_tabela AND column_name = 'updated_by'
    )
  INTO v_has_updated_at, v_has_updated_by;

  SELECT string_agg(format('%I = rec.%I', c.column_name, c.column_name), ', ' ORDER BY c.ordinal_position)
  INTO v_col_list
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = v_tabela
    AND c.is_generated = 'NEVER'
    AND c.column_name NOT IN ('id', 'created_at', 'created_by', 'updated_at', 'updated_by')
    AND v_snapshot ? c.column_name;

  IF v_col_list IS NOT NULL THEN
    v_set_parts := array_append(v_set_parts, v_col_list);
  END IF;
  IF v_has_updated_at THEN
    v_set_parts := array_append(v_set_parts, 'updated_at = now()');
  END IF;
  IF v_has_updated_by THEN
    v_set_parts := array_append(v_set_parts, format('updated_by = %L', COALESCE(v_uid_text, v_ator.usuario_login)));
  END IF;

  IF COALESCE(array_length(v_set_parts, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nenhuma coluna elegível para restauração.');
  END IF;

  EXECUTE format(
    'UPDATE public.%I AS t SET %s FROM jsonb_populate_record(NULL::public.%I, $1) AS rec WHERE t.id::text = $2',
    v_tabela,
    array_to_string(v_set_parts, ', '),
    v_tabela
  )
  USING v_snapshot, v_reg_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 0 THEN
    SELECT
      string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position),
      string_agg(format('rec.%I', c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO v_ins_cols, v_ins_vals
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = v_tabela
      AND c.is_generated = 'NEVER'
      AND v_snapshot ? c.column_name;

    IF v_ins_cols IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Não foi possível reconstruir as colunas para reinserção do registro.');
    END IF;

    EXECUTE format(
      'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) AS rec',
      v_tabela,
      v_ins_cols,
      v_ins_vals,
      v_tabela
    )
    USING v_snapshot;
  END IF;

  v_new_hist_id := NULLIF(current_setting('app.ultimo_historico_id', true), '');

  RETURN jsonb_build_object(
    'success', true,
    'tabela_nome', v_tabela,
    'registro_id', v_reg_id,
    'modo', v_modo,
    'restaurado_de_historico_id', p_historico_id,
    'novo_historico_id', v_new_hist_id
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.restaurar_versao_historico(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurar_versao_historico(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. RPCS PARA SISTEMAS EXTERNOS INSERIREM DADOS E SOLICITAREM EDIÇÕES
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.integracao_inserir_registro(
  p_sistema_origem text,
  p_usuario_login text,
  p_tabela_nome text,
  p_dados jsonb,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sistema text := NULLIF(btrim(COALESCE(p_sistema_origem, '')), '');
  v_login text := NULLIF(btrim(COALESCE(p_usuario_login, '')), '');
  v_tabela text := lower(btrim(COALESCE(p_tabela_nome, '')));
  v_payload jsonb;
  v_new_id text;
  v_ins_cols text;
  v_ins_vals text;
  v_hist_id text;
  v_is_srv boolean := public._is_service_role_caller();
BEGIN
  IF NOT (v_is_srv OR public.is_admin() OR (public.is_active_user() AND public.get_my_role() IN ('Administrador', 'Usuário', 'Analista'))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Acesso negado para inserção integrada.');
  END IF;

  IF v_sistema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sistema de origem é obrigatório.');
  END IF;

  IF v_login IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Login do usuário solicitante é obrigatório.');
  END IF;

  IF v_tabela NOT IN (
    'empreendedores',
    'barragens',
    'rts',
    'responsaveis_tecnicos_barragens',
    'revisoes',
    'portarias',
    'produtividades'
  ) OR to_regclass('public.' || v_tabela) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', format('Tabela "%s" não permitida para inserção externa.', v_tabela));
  END IF;

  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payload p_dados deve ser um objeto JSON válido.');
  END IF;

  v_new_id := COALESCE(
    NULLIF(btrim(p_dados ->> 'id'), ''),
    substring(v_tabela, 1, 3) || '_' || replace(gen_random_uuid()::text, '-', '')
  );

  v_payload := public._sanitizar_jsonb_para_tabela(
    v_tabela,
    p_dados,
    ARRAY['id', 'created_at', 'created_by', 'updated_at', 'updated_by']
  );

  IF v_payload = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nenhum campo válido informado para inserção.');
  END IF;

  v_payload := v_payload || jsonb_build_object('id', v_new_id);

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_tabela AND column_name = 'created_by'
  ) THEN
    v_payload := v_payload || jsonb_build_object('created_by', COALESCE(auth.uid()::text, v_sistema || ':' || v_login));
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_tabela AND column_name = 'updated_by'
  ) THEN
    v_payload := v_payload || jsonb_build_object('updated_by', COALESCE(auth.uid()::text, v_sistema || ':' || v_login));
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_tabela AND column_name = 'created_at'
  ) THEN
    v_payload := v_payload || jsonb_build_object('created_at', now());
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_tabela AND column_name = 'updated_at'
  ) THEN
    v_payload := v_payload || jsonb_build_object('updated_at', now());
  END IF;

  PERFORM set_config('app.sistema_origem', v_sistema, true);
  PERFORM set_config('app.usuario_login', v_login, true);
  PERFORM set_config(
    'app.motivo_alteracao',
    COALESCE(NULLIF(btrim(p_motivo), ''), format('Inserção via integração (%s)', v_sistema)),
    true
  );
  PERFORM set_config('app.ultimo_historico_id', '', true);

  SELECT
    string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position),
    string_agg(format('rec.%I', c.column_name), ', ' ORDER BY c.ordinal_position)
  INTO v_ins_cols, v_ins_vals
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = v_tabela
    AND c.is_generated = 'NEVER'
    AND v_payload ? c.column_name;

  EXECUTE format(
    'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) AS rec',
    v_tabela,
    v_ins_cols,
    v_ins_vals,
    v_tabela
  )
  USING v_payload;

  v_hist_id := NULLIF(current_setting('app.ultimo_historico_id', true), '');

  RETURN jsonb_build_object(
    'success', true,
    'tabela_nome', v_tabela,
    'registro_id', v_new_id,
    'sistema_origem', v_sistema,
    'usuario_login', v_login,
    'historico_id', v_hist_id
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.integracao_inserir_registro(text, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_inserir_registro(text, text, text, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.integracao_solicitar_edicao(
  p_sistema_origem text,
  p_usuario_login text,
  p_tabela_nome text,
  p_registro_id text,
  p_dados_propostos jsonb,
  p_justificativa text DEFAULT NULL,
  p_referencia_externa text DEFAULT NULL,
  p_usuario_nome text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sistema text := NULLIF(btrim(COALESCE(p_sistema_origem, '')), '');
  v_login text := NULLIF(btrim(COALESCE(p_usuario_login, '')), '');
  v_tabela text := lower(btrim(COALESCE(p_tabela_nome, '')));
  v_reg_id text := NULLIF(btrim(COALESCE(p_registro_id, '')), '');
  v_dados_limpos jsonb;
  v_snapshot_atual jsonb;
  v_solic_id uuid;
  v_is_srv boolean := public._is_service_role_caller();
BEGIN
  IF NOT (v_is_srv OR public.is_active_user()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Acesso negado para solicitar edição.');
  END IF;

  IF v_sistema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sistema de origem é obrigatório.');
  END IF;

  IF v_login IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Login do usuário solicitante é obrigatório.');
  END IF;

  IF v_tabela NOT IN (
    'empreendedores',
    'barragens',
    'rts',
    'responsaveis_tecnicos_barragens',
    'revisoes',
    'portarias',
    'produtividades'
  ) OR to_regclass('public.' || v_tabela) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', format('Tabela "%s" não permitida para solicitação de edição.', v_tabela));
  END IF;

  IF v_reg_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Identificador do registro é obrigatório.');
  END IF;

  v_dados_limpos := public._sanitizar_jsonb_para_tabela(
    v_tabela,
    p_dados_propostos,
    ARRAY['id', 'created_at', 'created_by', 'updated_at', 'updated_by']
  );

  IF v_dados_limpos = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nenhum campo válido proposto para edição.');
  END IF;

  EXECUTE format(
    'SELECT to_jsonb(t) FROM public.%I t WHERE t.id::text = $1 LIMIT 1',
    v_tabela
  )
  INTO v_snapshot_atual
  USING v_reg_id;

  IF v_snapshot_atual IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', format('Registro "%s" não encontrado em "%s".', v_reg_id, v_tabela));
  END IF;

  INSERT INTO public.solicitacoes_alteracao_externa (
    sistema_origem,
    usuario_login,
    usuario_nome,
    tabela_nome,
    registro_id,
    tipo_solicitacao,
    dados_propostos,
    dados_atuais_snapshot,
    justificativa,
    referencia_externa,
    status,
    solicitado_em
  )
  VALUES (
    v_sistema,
    v_login,
    NULLIF(btrim(p_usuario_nome), ''),
    v_tabela,
    v_reg_id,
    'EDICAO',
    v_dados_limpos,
    v_snapshot_atual,
    NULLIF(btrim(p_justificativa), ''),
    NULLIF(btrim(p_referencia_externa), ''),
    'Pendente',
    now()
  )
  RETURNING id INTO v_solic_id;

  RETURN jsonb_build_object(
    'success', true,
    'solicitacao_id', v_solic_id,
    'status', 'Pendente',
    'tabela_nome', v_tabela,
    'registro_id', v_reg_id
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.integracao_solicitar_edicao(text, text, text, text, jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_solicitar_edicao(text, text, text, text, jsonb, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.decidir_solicitacao_alteracao_externa(
  p_solicitacao_id uuid,
  p_decisao text,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_solic public.solicitacoes_alteracao_externa%ROWTYPE;
  v_decisao text := lower(btrim(COALESCE(p_decisao, '')));
  v_ator record;
  v_dados_limpos jsonb;
  v_set_parts text[] := ARRAY[]::text[];
  v_col_list text;
  v_has_updated_at boolean := false;
  v_has_updated_by boolean := false;
  v_row_count integer := 0;
  v_hist_id_text text;
  v_hist_id uuid;
  v_motivo text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Permissão negada: apenas Administradores podem aprovar ou rejeitar solicitações de alteração.'
    );
  END IF;

  IF p_solicitacao_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Identificador da solicitação é obrigatório.');
  END IF;

  IF v_decisao NOT IN ('aprovar', 'aprovada', 'rejeitar', 'rejeitada') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Decisão inválida. Utilize "Aprovar" ou "Rejeitar".');
  END IF;

  SELECT *
  INTO v_solic
  FROM public.solicitacoes_alteracao_externa
  WHERE id = p_solicitacao_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solicitação não encontrada.');
  END IF;

  IF v_solic.status <> 'Pendente' THEN
    RETURN jsonb_build_object('success', false, 'error', format('Solicitação já analisada (%s).', v_solic.status));
  END IF;

  SELECT * INTO v_ator FROM public._resolver_ator_auditoria() LIMIT 1;

  IF v_decisao IN ('rejeitar', 'rejeitada') THEN
    UPDATE public.solicitacoes_alteracao_externa
    SET status = 'Rejeitada',
        analisado_em = now(),
        analisado_por_id = v_ator.usuario_id,
        analisado_por_login = v_ator.usuario_login,
        analisado_por_uid = auth.uid(),
        observacao_analise = NULLIF(btrim(p_observacao), '')
    WHERE id = p_solicitacao_id;

    RETURN jsonb_build_object('success', true, 'solicitacao_id', p_solicitacao_id, 'status', 'Rejeitada');
  END IF;

  v_dados_limpos := public._sanitizar_jsonb_para_tabela(
    v_solic.tabela_nome,
    v_solic.dados_propostos,
    ARRAY['id', 'created_at', 'created_by', 'updated_at', 'updated_by']
  );

  IF v_dados_limpos = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solicitação não contém campos válidos para aplicação.');
  END IF;

  v_motivo := format(
    'Solicitação externa (%s) aprovada por %s%s',
    v_solic.sistema_origem,
    v_ator.usuario_login,
    COALESCE(' — ' || NULLIF(btrim(COALESCE(p_observacao, v_solic.justificativa, '')), ''), '')
  );

  PERFORM set_config('app.sistema_origem', v_solic.sistema_origem, true);
  PERFORM set_config('app.usuario_login', v_solic.usuario_login, true);
  PERFORM set_config('app.motivo_alteracao', v_motivo, true);
  PERFORM set_config('app.solicitacao_externa_id', p_solicitacao_id::text, true);
  PERFORM set_config('app.ultimo_historico_id', '', true);

  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_solic.tabela_nome AND column_name = 'updated_at'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_solic.tabela_nome AND column_name = 'updated_by'
    )
  INTO v_has_updated_at, v_has_updated_by;

  SELECT string_agg(format('%I = rec.%I', c.column_name, c.column_name), ', ' ORDER BY c.ordinal_position)
  INTO v_col_list
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = v_solic.tabela_nome
    AND c.is_generated = 'NEVER'
    AND c.column_name NOT IN ('id', 'created_at', 'created_by', 'updated_at', 'updated_by')
    AND v_dados_limpos ? c.column_name;

  IF v_col_list IS NOT NULL THEN
    v_set_parts := array_append(v_set_parts, v_col_list);
  END IF;
  IF v_has_updated_at THEN
    v_set_parts := array_append(v_set_parts, 'updated_at = now()');
  END IF;
  IF v_has_updated_by THEN
    v_set_parts := array_append(v_set_parts, format('updated_by = %L', COALESCE(auth.uid()::text, v_solic.sistema_origem || ':' || v_solic.usuario_login)));
  END IF;

  EXECUTE format(
    'UPDATE public.%I AS t SET %s FROM jsonb_populate_record(NULL::public.%I, $1) AS rec WHERE t.id::text = $2',
    v_solic.tabela_nome,
    array_to_string(v_set_parts, ', '),
    v_solic.tabela_nome
  )
  USING v_dados_limpos, v_solic.registro_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'Registro "%" não encontrado em "%" ao aplicar solicitação.', v_solic.registro_id, v_solic.tabela_nome;
  END IF;

  v_hist_id_text := NULLIF(current_setting('app.ultimo_historico_id', true), '');
  IF v_hist_id_text IS NOT NULL THEN
    v_hist_id := v_hist_id_text::uuid;
  END IF;

  UPDATE public.solicitacoes_alteracao_externa
  SET status = 'Aprovada',
      analisado_em = now(),
      analisado_por_id = v_ator.usuario_id,
      analisado_por_login = v_ator.usuario_login,
      analisado_por_uid = auth.uid(),
      observacao_analise = NULLIF(btrim(p_observacao), ''),
      historico_id = v_hist_id
  WHERE id = p_solicitacao_id;

  RETURN jsonb_build_object(
    'success', true,
    'solicitacao_id', p_solicitacao_id,
    'status', 'Aprovada',
    'historico_id', v_hist_id
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.decidir_solicitacao_alteracao_externa(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_solicitacao_alteracao_externa(uuid, text, text) TO authenticated;
