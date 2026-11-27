-- ============================================================================
-- SCRIPT DE MIGRAÇÃO INCREMENTAL E IDEMPOTENTE:
-- FUNDAÇÃO SEGURA PARA POLÍTICAS E OPERAÇÕES S2S (API v2)
-- Administra-CSB — SEMA-MT / SURH / CSB
-- ============================================================================
-- ATENÇÃO:
--   - Script preparado para revisão e execução controlada; NÃO presumir aplicação
--     automática em produção.
--   - Regra central (default-deny): toda operação S2S é proibida por padrão
--     enquanto não houver política ativa específica + validação no servidor.
--   - Operações com lacuna de contrato ou pendentes de etapa futura permanecem
--     bloqueadas por constraint (ativo = false) e pela camada server-side:
--       * cadastrar_empreendimento / propor_alteracao_empreendimento:
--         public.empreendimentos não possui DDL/migration neste repositório
--         (apenas coluna JSONB empreendedores.empreendimentos).
--       * registrar_documento:
--         public.documentos_catalogo e suas constraints de unicidade/idempotência
--         não possuem DDL/migration versionada neste repositório.
--       * desativar_cadastro, cancelar_ato_aplicado, transferir_titularidade,
--         reverter_ato: bloqueadas nesta etapa.
--   - Aprovação de solicitações e gestão de políticas pertencem exclusivamente
--     a Administrador ativo autenticado no Administra (nunca via S2S nem por
--     service_role em nome próprio).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. TABELA DE POLÍTICAS S2S (DEFAULT-DENY)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integracao_s2s_politicas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sistema_origem text NOT NULL
    CHECK (sistema_origem IN ('notifica', 'classifica', 'fiscaliza')),
  operacao text NOT NULL
    CHECK (operacao IN (
      'cadastrar_empreendedor',
      'cadastrar_empreendimento',
      'cadastrar_barragem',
      'cadastrar_rt',
      'propor_alteracao_empreendedor',
      'propor_alteracao_empreendimento',
      'propor_alteracao_barragem',
      'propor_alteracao_rt',
      'registrar_documento',
      'cancelar_solicitacao_pendente',
      'desativar_cadastro',
      'cancelar_ato_aplicado',
      'transferir_titularidade',
      'reverter_ato'
    )),
  modo text NOT NULL
    CHECK (modo IN ('execucao_direta', 'proposta_aprovacao')),
  ativo boolean NOT NULL DEFAULT false,
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(parametros) = 'object'),
  restricoes jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(restricoes) = 'object'),
  criado_por_uid uuid NOT NULL,
  criado_por_login text NOT NULL,
  atualizado_por_uid uuid NOT NULL,
  atualizado_por_login text NOT NULL,
  motivo_ultima_alteracao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_integracao_s2s_politicas_sistema_operacao UNIQUE (sistema_origem, operacao),
  CONSTRAINT chk_s2s_pol_alteracao_exige_aprovacao CHECK (
    operacao NOT LIKE 'propor_alteracao_%' OR modo = 'proposta_aprovacao'
  ),
  CONSTRAINT chk_s2s_pol_cancelar_pendente_direto CHECK (
    operacao <> 'cancelar_solicitacao_pendente' OR modo = 'execucao_direta'
  ),
  CONSTRAINT chk_s2s_pol_operacoes_bloqueadas_inativas CHECK (
    operacao NOT IN (
      'cadastrar_empreendimento',
      'propor_alteracao_empreendimento',
      'registrar_documento',
      'desativar_cadastro',
      'cancelar_ato_aplicado',
      'transferir_titularidade',
      'reverter_ato'
    )
    OR ativo = false
  )
);

CREATE INDEX IF NOT EXISTS idx_s2s_politicas_sistema_operacao_ativo
  ON public.integracao_s2s_politicas (sistema_origem, operacao)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_s2s_politicas_updated_at
  ON public.integracao_s2s_politicas (updated_at DESC);

-- ----------------------------------------------------------------------------
-- 2. TABELA DE SOLICITAÇÕES DE ALTERAÇÃO S2S (V2)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integracao_s2s_solicitacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  politica_id uuid NOT NULL REFERENCES public.integracao_s2s_politicas(id) ON DELETE RESTRICT,
  sistema_origem text NOT NULL
    CHECK (sistema_origem IN ('notifica', 'classifica', 'fiscaliza')),
  operacao text NOT NULL
    CHECK (operacao IN (
      'propor_alteracao_empreendedor',
      'propor_alteracao_barragem',
      'propor_alteracao_rt'
    )),
  entidade_tipo text NOT NULL
    CHECK (entidade_tipo IN ('empreendedor', 'barragem', 'rt')),
  tabela_nome text NOT NULL
    CHECK (tabela_nome IN ('empreendedores', 'barragens', 'rts')),
  registro_id text NOT NULL,
  idempotency_key text NOT NULL,
  jti uuid NOT NULL,
  usuario_origem text NOT NULL,
  matricula_origem text,
  referencia_externa text,
  justificativa text NOT NULL,
  dados_propostos jsonb NOT NULL
    CHECK (jsonb_typeof(dados_propostos) = 'object'),
  dados_atuais_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(dados_atuais_snapshot) = 'object'),
  status text NOT NULL DEFAULT 'Pendente'
    CHECK (status IN ('Pendente', 'Aprovada', 'Rejeitada', 'Cancelada')),
  solicitado_em timestamptz NOT NULL DEFAULT now(),
  cancelado_em timestamptz,
  cancelado_por_origem text,
  motivo_cancelamento text,
  analisado_em timestamptz,
  analisado_por_uid uuid,
  analisado_por_id text,
  analisado_por_login text,
  observacao_analise text,
  historico_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_s2s_solic_sistema_idempotency UNIQUE (sistema_origem, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_s2s_solic_status_data
  ON public.integracao_s2s_solicitacoes (status, solicitado_em DESC);

CREATE INDEX IF NOT EXISTS idx_s2s_solic_entidade_status
  ON public.integracao_s2s_solicitacoes (tabela_nome, registro_id, status);

CREATE INDEX IF NOT EXISTS idx_s2s_solic_sistema_origem
  ON public.integracao_s2s_solicitacoes (sistema_origem, solicitado_em DESC);

-- ----------------------------------------------------------------------------
-- 3. LOG DE AUDITORIA E IDEMPOTÊNCIA DAS OPERAÇÕES S2S
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integracao_s2s_operacoes_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sistema_origem text NOT NULL
    CHECK (sistema_origem IN ('notifica', 'classifica', 'fiscaliza')),
  kid text NOT NULL,
  jti uuid NOT NULL,
  operacao text NOT NULL,
  politica_id uuid REFERENCES public.integracao_s2s_politicas(id) ON DELETE RESTRICT,
  modo_aplicado text
    CHECK (modo_aplicado IS NULL OR modo_aplicado IN ('execucao_direta', 'proposta_aprovacao')),
  idempotency_key text NOT NULL,
  request_hash_sha256 text NOT NULL
    CHECK (request_hash_sha256 ~ '^[0-9a-f]{64}$'),
  usuario_origem text,
  matricula_origem text,
  entidade_tipo text,
  registro_id text,
  solicitacao_id uuid REFERENCES public.integracao_s2s_solicitacoes(id) ON DELETE SET NULL,
  status_execucao text NOT NULL
    CHECK (status_execucao IN ('em_processamento', 'sucesso', 'rejeitado', 'erro')),
  http_status integer NOT NULL,
  resultado_resumo jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(resultado_resumo) = 'object'),
  erro_codigo text,
  erro_mensagem_sanitizada text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_s2s_op_log_sistema_op_idem_ativo
  ON public.integracao_s2s_operacoes_log (sistema_origem, operacao, idempotency_key)
  WHERE status_execucao IN ('em_processamento', 'sucesso');

CREATE INDEX IF NOT EXISTS idx_s2s_op_log_created_at
  ON public.integracao_s2s_operacoes_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_s2s_op_log_sistema_status
  ON public.integracao_s2s_operacoes_log (sistema_origem, status_execucao, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. RLS ESTRITA E GRANTS RESTRITIVOS (NENHUM ACESSO DIRETO DO NAVEGADOR)
-- ----------------------------------------------------------------------------
ALTER TABLE public.integracao_s2s_politicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_s2s_solicitacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_s2s_operacoes_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_tbl text;
  v_pol text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'integracao_s2s_politicas',
    'integracao_s2s_solicitacoes',
    'integracao_s2s_operacoes_log'
  ] LOOP
    FOR v_pol IN
      SELECT p.policyname
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = v_tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol, v_tbl);
    END LOOP;

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO service_role', v_tbl);
  END LOOP;
END
$$;

-- ----------------------------------------------------------------------------
-- 5. FUNÇÕES TRANSACIONAIS SERVER-SIDE (EXCLUSIVAS PARA service_role)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._validar_admin_ativo_s2s(
  p_admin_auth_user_id uuid
)
RETURNS TABLE (
  usuario_id text,
  usuario_login text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_u_id text;
  v_u_login text;
BEGIN
  IF p_admin_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'ADM_REQUIRED: Administrador autenticado no Administra é obrigatório.';
  END IF;

  SELECT
    u.id,
    COALESCE(NULLIF(btrim(u.login), ''), NULLIF(btrim(u.email), ''), p_admin_auth_user_id::text)
  INTO v_u_id, v_u_login
  FROM public.usuarios u
  WHERE u.auth_user_id = p_admin_auth_user_id
    AND u.papel = 'Administrador'
    AND (u.situacao = 'Ativo' OR u.status = 'Ativo')
  LIMIT 1;

  IF v_u_id IS NULL THEN
    RAISE EXCEPTION 'ADM_FORBIDDEN: Apenas Administrador ativo no Administra pode executar esta ação.';
  END IF;

  usuario_id := v_u_id;
  usuario_login := v_u_login;
  RETURN NEXT;
END;
$$;

-- 5.1 Gestão de políticas S2S (exclusiva para Administrador ativo)
CREATE OR REPLACE FUNCTION public.admin_upsert_politica_s2s(
  p_admin_auth_user_id uuid,
  p_sistema_origem text,
  p_operacao text,
  p_modo text,
  p_ativo boolean,
  p_parametros jsonb DEFAULT '{}'::jsonb,
  p_restricoes jsonb DEFAULT '{}'::jsonb,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_adm record;
  v_sistema text := lower(btrim(COALESCE(p_sistema_origem, '')));
  v_op text := lower(btrim(COALESCE(p_operacao, '')));
  v_modo text := lower(btrim(COALESCE(p_modo, '')));
  v_ativo boolean := COALESCE(p_ativo, false);
  v_params jsonb := COALESCE(p_parametros, '{}'::jsonb);
  v_restr jsonb := COALESCE(p_restricoes, '{}'::jsonb);
  v_row public.integracao_s2s_politicas%ROWTYPE;
BEGIN
  SELECT * INTO v_adm FROM public._validar_admin_ativo_s2s(p_admin_auth_user_id) LIMIT 1;

  IF v_sistema NOT IN ('notifica', 'classifica', 'fiscaliza') THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_SYSTEM', 'error', 'Sistema de origem S2S inválido.');
  END IF;

  IF v_op IN (
    'cadastrar_empreendimento',
    'propor_alteracao_empreendimento',
    'registrar_documento',
    'desativar_cadastro',
    'cancelar_ato_aplicado',
    'transferir_titularidade',
    'reverter_ato'
  ) AND v_ativo THEN
    RETURN jsonb_build_object(
      'success', false,
      'http_status', 422,
      'code', 'OPERATION_BLOCKED',
      'error', format('A operação "%s" está bloqueada nesta etapa ou aguarda contrato versionado e não pode ser ativada.', v_op)
    );
  END IF;

  IF v_op LIKE 'propor_alteracao_%' AND v_modo <> 'proposta_aprovacao' THEN
    RETURN jsonb_build_object(
      'success', false,
      'http_status', 422,
      'code', 'POLICY_MODE_INVALID',
      'error', 'Operações de alteração cadastral exigem obrigatoriamente modo proposta_aprovacao.'
    );
  END IF;

  IF jsonb_typeof(v_params) <> 'object' OR jsonb_typeof(v_restr) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_POLICY_JSON', 'error', 'Parâmetros e restrições devem ser objetos JSON válidos.');
  END IF;

  INSERT INTO public.integracao_s2s_politicas (
    sistema_origem,
    operacao,
    modo,
    ativo,
    parametros,
    restricoes,
    criado_por_uid,
    criado_por_login,
    atualizado_por_uid,
    atualizado_por_login,
    motivo_ultima_alteracao,
    created_at,
    updated_at
  )
  VALUES (
    v_sistema,
    v_op,
    v_modo,
    v_ativo,
    v_params,
    v_restr,
    p_admin_auth_user_id,
    v_adm.usuario_login,
    p_admin_auth_user_id,
    v_adm.usuario_login,
    NULLIF(btrim(COALESCE(p_motivo, '')), ''),
    now(),
    now()
  )
  ON CONFLICT (sistema_origem, operacao) DO UPDATE
  SET modo = EXCLUDED.modo,
      ativo = EXCLUDED.ativo,
      parametros = EXCLUDED.parametros,
      restricoes = EXCLUDED.restricoes,
      atualizado_por_uid = EXCLUDED.atualizado_por_uid,
      atualizado_por_login = EXCLUDED.atualizado_por_login,
      motivo_ultima_alteracao = EXCLUDED.motivo_ultima_alteracao,
      updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'success', true,
    'politica', to_jsonb(v_row)
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'ADM_%' THEN
      RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'ADMIN_REQUIRED', 'error', 'Apenas Administrador ativo no Administra pode gerenciar políticas S2S.');
    END IF;
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'POLICY_PERSIST_FAILED', 'error', 'Não foi possível salvar a política S2S com os parâmetros informados.');
END;
$$;

-- 5.2 Cadastro novo S2S (execução direta apenas se política ativa e registro inexistente)
CREATE OR REPLACE FUNCTION public.s2s_executar_cadastro_novo(
  p_sistema_origem text,
  p_kid text,
  p_jti uuid,
  p_operacao text,
  p_idempotency_key text,
  p_request_hash_sha256 text,
  p_usuario_origem text,
  p_matricula_origem text DEFAULT NULL,
  p_dados jsonb DEFAULT '{}'::jsonb,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pol public.integracao_s2s_politicas%ROWTYPE;
  v_existing_log public.integracao_s2s_operacoes_log%ROWTYPE;
  v_sistema text := lower(btrim(COALESCE(p_sistema_origem, '')));
  v_op text := lower(btrim(COALESCE(p_operacao, '')));
  v_idem text := btrim(COALESCE(p_idempotency_key, ''));
  v_user text := NULLIF(btrim(COALESCE(p_usuario_origem, '')), '');
  v_mat text := NULLIF(btrim(COALESCE(p_matricula_origem, '')), '');
  v_actor_tag text;
  v_tabela text;
  v_entidade_tipo text;
  v_new_id text;
  v_doc_digits text;
  v_snisb text;
  v_nome text;
  v_municipio text;
  v_emp_id text;
  v_conselho text;
  v_uf_conselho text;
  v_reg_norm text;
  v_duplicate boolean := false;
  v_hist_id text;
  v_res jsonb;
BEGIN
  IF v_sistema NOT IN ('notifica', 'classifica', 'fiscaliza') THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'SYSTEM_FORBIDDEN', 'error', 'Sistema de origem não autorizado.');
  END IF;

  IF v_op NOT IN ('cadastrar_empreendedor', 'cadastrar_barragem', 'cadastrar_rt') THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'OPERATION_FORBIDDEN', 'error', 'Operação não permitida para cadastro direto S2S.');
  END IF;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'ACTOR_REQUIRED', 'error', 'Autor de origem é obrigatório.');
  END IF;

  -- Trava e valida política ativa no banco (default-deny)
  SELECT * INTO v_pol
  FROM public.integracao_s2s_politicas
  WHERE sistema_origem = v_sistema
    AND operacao = v_op
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'POLICY_NOT_FOUND', 'error', 'Operação bloqueada: política S2S ausente.');
  END IF;

  IF v_pol.ativo IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'POLICY_INACTIVE', 'error', 'Operação bloqueada: política S2S desativada.');
  END IF;

  IF v_pol.modo <> 'execucao_direta' THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'POLICY_MODE_MISMATCH', 'error', 'Política configurada não autoriza execução direta.');
  END IF;

  -- Idempotência transacional
  SELECT * INTO v_existing_log
  FROM public.integracao_s2s_operacoes_log
  WHERE sistema_origem = v_sistema
    AND operacao = v_op
    AND idempotency_key = v_idem
    AND status_execucao IN ('em_processamento', 'sucesso')
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_log.status_execucao = 'em_processamento' THEN
      RETURN jsonb_build_object('success', false, 'http_status', 409, 'code', 'IDEMPOTENCY_IN_PROGRESS', 'error', 'Operação idempotente ainda em processamento.');
    END IF;
    IF v_existing_log.request_hash_sha256 <> p_request_hash_sha256 THEN
      RETURN jsonb_build_object('success', false, 'http_status', 409, 'code', 'IDEMPOTENCY_CONFLICT', 'error', 'Chave de idempotência já utilizada com payload divergente.');
    END IF;
    RETURN v_existing_log.resultado_resumo || jsonb_build_object('idempotent_replay', true);
  END IF;

  v_actor_tag := format('s2s:%s:%s', v_sistema, v_user);

  IF v_op = 'cadastrar_empreendedor' THEN
    v_tabela := 'empreendedores';
    v_entidade_tipo := 'empreendedor';
    v_nome := NULLIF(btrim(COALESCE(p_dados ->> 'nome', '')), '');
    v_doc_digits := public.norm_digits_only(p_dados ->> 'cpf_cnpj');
    v_new_id := COALESCE(NULLIF(btrim(COALESCE(p_dados ->> 'id', '')), ''), 'emp_' || replace(gen_random_uuid()::text, '-', ''));

    IF v_nome IS NULL OR v_doc_digits IS NULL OR length(v_doc_digits) NOT IN (11, 14) THEN
      RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_PAYLOAD', 'error', 'Nome e CPF/CNPJ completo válido são obrigatórios para cadastrar empreendedor.');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.empreendedores e
      WHERE e.id = v_new_id
         OR public.norm_digits_only(e.cpf_cnpj) = v_doc_digits
    ) INTO v_duplicate;

    IF v_duplicate THEN
      RETURN jsonb_build_object('success', false, 'http_status', 409, 'code', 'DUPLICATE_RECORD', 'error', 'Empreendedor já existe no cadastro mestre; sobrescrita bloqueada.');
    END IF;

    PERFORM set_config('app.sistema_origem', v_sistema, true);
    PERFORM set_config('app.usuario_login', COALESCE(v_mat, v_user), true);
    PERFORM set_config('app.motivo_alteracao', COALESCE(NULLIF(btrim(COALESCE(p_motivo, '')), ''), format('Cadastro novo via S2S (%s)', v_sistema)), true);
    PERFORM set_config('app.ultimo_historico_id', '', true);

    INSERT INTO public.empreendedores (
      id, tipo_pessoa, nome, cpf_cnpj, nome_fantasia, email, telefone,
      uf, municipio, municipio_ibge, observacoes, situacao, empreendimentos,
      created_by, updated_by, created_at, updated_at
    ) VALUES (
      v_new_id,
      COALESCE(NULLIF(btrim(COALESCE(p_dados ->> 'tipo_pessoa', '')), ''), CASE WHEN length(v_doc_digits) = 11 THEN 'Pessoa física' ELSE 'Pessoa jurídica' END),
      v_nome,
      v_doc_digits,
      NULLIF(btrim(COALESCE(p_dados ->> 'nome_fantasia', '')), ''),
      NULLIF(btrim(COALESCE(p_dados ->> 'email', '')), ''),
      NULLIF(btrim(COALESCE(p_dados ->> 'telefone', '')), ''),
      COALESCE(NULLIF(upper(btrim(COALESCE(p_dados ->> 'uf', ''))), ''), 'MT'),
      NULLIF(btrim(COALESCE(p_dados ->> 'municipio', '')), ''),
      NULLIF(btrim(COALESCE(p_dados ->> 'municipio_ibge', '')), ''),
      NULLIF(btrim(COALESCE(p_dados ->> 'observacoes', '')), ''),
      'Ativo',
      '[]'::jsonb,
      v_actor_tag,
      v_actor_tag,
      now(),
      now()
    );

  ELSIF v_op = 'cadastrar_barragem' THEN
    v_tabela := 'barragens';
    v_entidade_tipo := 'barragem';
    v_nome := NULLIF(btrim(COALESCE(p_dados ->> 'nome', '')), '');
    v_snisb := NULLIF(btrim(COALESCE(p_dados ->> 'snisb', '')), '');
    v_municipio := NULLIF(btrim(COALESCE(p_dados ->> 'municipio', '')), '');
    v_emp_id := NULLIF(btrim(COALESCE(p_dados ->> 'empreendedor_id', '')), '');
    v_new_id := COALESCE(NULLIF(btrim(COALESCE(p_dados ->> 'id', '')), ''), 'bar_' || replace(gen_random_uuid()::text, '-', ''));

    IF v_nome IS NULL THEN
      RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_PAYLOAD', 'error', 'Nome da barragem é obrigatório.');
    END IF;

    IF v_emp_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.empreendedores e WHERE e.id = v_emp_id) THEN
      RETURN jsonb_build_object('success', false, 'http_status', 422, 'code', 'EMPREENDEDOR_NOT_FOUND', 'error', 'Empreendedor referenciado não encontrado no cadastro mestre.');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.barragens b
      WHERE b.id = v_new_id
         OR (v_snisb IS NOT NULL AND upper(btrim(COALESCE(b.snisb, ''))) = upper(v_snisb))
         OR (
           lower(btrim(b.nome)) = lower(v_nome)
           AND COALESCE(b.empreendedor_id, '') = COALESCE(v_emp_id, '')
           AND lower(btrim(COALESCE(b.municipio, ''))) = lower(COALESCE(v_municipio, ''))
         )
    ) INTO v_duplicate;

    IF v_duplicate THEN
      RETURN jsonb_build_object('success', false, 'http_status', 409, 'code', 'DUPLICATE_RECORD', 'error', 'Barragem já existe no cadastro mestre; sobrescrita bloqueada.');
    END IF;

    PERFORM set_config('app.sistema_origem', v_sistema, true);
    PERFORM set_config('app.usuario_login', COALESCE(v_mat, v_user), true);
    PERFORM set_config('app.motivo_alteracao', COALESCE(NULLIF(btrim(COALESCE(p_motivo, '')), ''), format('Cadastro novo via S2S (%s)', v_sistema)), true);
    PERFORM set_config('app.ultimo_historico_id', '', true);

    INSERT INTO public.barragens (
      id, nome, car, uf, municipio, municipio_ibge, empreendedor_id,
      empreendimento, processo, snisb, curso_agua, latitude, longitude,
      altura, volume, dano_potencial, categoria_risco, situacao, observacoes,
      created_by, updated_by, created_at, updated_at
    ) VALUES (
      v_new_id,
      v_nome,
      NULLIF(btrim(COALESCE(p_dados ->> 'car', '')), ''),
      COALESCE(NULLIF(upper(btrim(COALESCE(p_dados ->> 'uf', ''))), ''), 'MT'),
      v_municipio,
      NULLIF(btrim(COALESCE(p_dados ->> 'municipio_ibge', '')), ''),
      v_emp_id,
      NULLIF(btrim(COALESCE(p_dados ->> 'empreendimento', '')), ''),
      NULLIF(btrim(COALESCE(p_dados ->> 'processo', '')), ''),
      v_snisb,
      NULLIF(btrim(COALESCE(p_dados ->> 'curso_agua', '')), ''),
      NULLIF(btrim(COALESCE(p_dados ->> 'latitude', '')), ''),
      NULLIF(btrim(COALESCE(p_dados ->> 'longitude', '')), ''),
      NULLIF(btrim(COALESCE(p_dados ->> 'altura', '')), '')::numeric,
      NULLIF(btrim(COALESCE(p_dados ->> 'volume', '')), '')::numeric,
      NULLIF(btrim(COALESCE(p_dados ->> 'dano_potencial', '')), ''),
      NULLIF(btrim(COALESCE(p_dados ->> 'categoria_risco', '')), ''),
      'Ativa',
      NULLIF(btrim(COALESCE(p_dados ->> 'observacoes', '')), ''),
      v_actor_tag,
      v_actor_tag,
      now(),
      now()
    );

  ELSIF v_op = 'cadastrar_rt' THEN
    v_tabela := 'rts';
    v_entidade_tipo := 'rt';
    v_nome := NULLIF(btrim(COALESCE(p_dados ->> 'nome', '')), '');
    v_doc_digits := public.norm_digits_only(p_dados ->> 'cpf');
    v_conselho := COALESCE(NULLIF(upper(btrim(COALESCE(p_dados ->> 'conselho', ''))), ''), 'CREA-MT');
    v_uf_conselho := COALESCE(NULLIF(upper(btrim(COALESCE(p_dados ->> 'uf_conselho', ''))), ''), 'MT');
    v_reg_norm := NULLIF(upper(regexp_replace(COALESCE(p_dados ->> 'registro', ''), '[^A-Za-z0-9]', '', 'g')), '');
    v_new_id := COALESCE(NULLIF(btrim(COALESCE(p_dados ->> 'id', '')), ''), 'rt_' || replace(gen_random_uuid()::text, '-', ''));

    IF v_nome IS NULL OR ((v_doc_digits IS NULL OR length(v_doc_digits) <> 11) AND v_reg_norm IS NULL) THEN
      RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_PAYLOAD', 'error', 'Nome e CPF válido ou registro profissional são obrigatórios para cadastrar RT.');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.rts r
      WHERE r.id = v_new_id
         OR (v_doc_digits IS NOT NULL AND public.norm_digits_only(r.cpf) = v_doc_digits)
         OR (
           v_reg_norm IS NOT NULL
           AND upper(btrim(COALESCE(r.conselho, ''))) = v_conselho
           AND upper(btrim(COALESCE(r.uf_conselho, ''))) = v_uf_conselho
           AND upper(regexp_replace(COALESCE(r.registro, ''), '[^A-Za-z0-9]', '', 'g')) = v_reg_norm
         )
    ) INTO v_duplicate;

    IF v_duplicate THEN
      RETURN jsonb_build_object('success', false, 'http_status', 409, 'code', 'DUPLICATE_RECORD', 'error', 'Responsável técnico já existe no cadastro mestre; sobrescrita bloqueada.');
    END IF;

    PERFORM set_config('app.sistema_origem', v_sistema, true);
    PERFORM set_config('app.usuario_login', COALESCE(v_mat, v_user), true);
    PERFORM set_config('app.motivo_alteracao', COALESCE(NULLIF(btrim(COALESCE(p_motivo, '')), ''), format('Cadastro novo via S2S (%s)', v_sistema)), true);
    PERFORM set_config('app.ultimo_historico_id', '', true);

    INSERT INTO public.rts (
      id, nome, cpf, conselho, uf_conselho, registro, especialidades,
      telefone, email, situacao, observacoes, created_by, updated_by,
      created_at, updated_at
    ) VALUES (
      v_new_id,
      v_nome,
      v_doc_digits,
      v_conselho,
      v_uf_conselho,
      NULLIF(btrim(COALESCE(p_dados ->> 'registro', '')), ''),
      NULLIF(btrim(COALESCE(p_dados ->> 'especialidades', '')), ''),
      NULLIF(btrim(COALESCE(p_dados ->> 'telefone', '')), ''),
      NULLIF(btrim(COALESCE(p_dados ->> 'email', '')), ''),
      'Ativo',
      NULLIF(btrim(COALESCE(p_dados ->> 'observacoes', '')), ''),
      v_actor_tag,
      v_actor_tag,
      now(),
      now()
    );
  END IF;

  v_hist_id := NULLIF(current_setting('app.ultimo_historico_id', true), '');

  IF to_regclass('public.entidade_origens') IS NOT NULL THEN
    INSERT INTO public.entidade_origens (
      entidade_tipo, entidade_id, sistema_origem, tabela_origem,
      registro_origem_id, data_origem, confiabilidade, observacoes
    ) VALUES (
      v_entidade_tipo,
      v_new_id,
      v_sistema,
      'api_v2_s2s',
      COALESCE(NULLIF(btrim(COALESCE(p_dados ->> 'referencia_externa', '')), ''), v_new_id),
      now(),
      'comprovada',
      format('Cadastro novo via S2S por %s%s', v_user, COALESCE(' (matrícula ' || v_mat || ')', ''))
    )
    ON CONFLICT (entidade_tipo, entidade_id, sistema_origem) DO NOTHING;
  END IF;

  v_res := jsonb_build_object(
    'success', true,
    'http_status', 201,
    'operacao', v_op,
    'modo', 'execucao_direta',
    'entidade_tipo', v_entidade_tipo,
    'tabela_nome', v_tabela,
    'registro_id', v_new_id,
    'situacao', 'Ativo',
    'sistema_origem', v_sistema,
    'usuario_origem', v_user,
    'matricula_origem', v_mat,
    'historico_id', v_hist_id,
    'idempotency_key', v_idem
  );

  INSERT INTO public.integracao_s2s_operacoes_log (
    sistema_origem, kid, jti, operacao, politica_id, modo_aplicado,
    idempotency_key, request_hash_sha256, usuario_origem, matricula_origem,
    entidade_tipo, registro_id, status_execucao, http_status, resultado_resumo
  ) VALUES (
    v_sistema, p_kid, p_jti, v_op, v_pol.id, 'execucao_direta',
    v_idem, p_request_hash_sha256, v_user, v_mat,
    v_entidade_tipo, v_new_id, 'sucesso', 201, v_res
  );

  RETURN v_res;
END;
$$;

-- 5.3 Proposta de alteração cadastral via S2S (sempre pendente para aprovação de Administrador)
CREATE OR REPLACE FUNCTION public.s2s_criar_solicitacao_alteracao(
  p_sistema_origem text,
  p_kid text,
  p_jti uuid,
  p_operacao text,
  p_idempotency_key text,
  p_request_hash_sha256 text,
  p_usuario_origem text,
  p_matricula_origem text DEFAULT NULL,
  p_registro_id text DEFAULT NULL,
  p_dados_propostos jsonb DEFAULT '{}'::jsonb,
  p_justificativa text DEFAULT NULL,
  p_referencia_externa text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pol public.integracao_s2s_politicas%ROWTYPE;
  v_existing_log public.integracao_s2s_operacoes_log%ROWTYPE;
  v_sistema text := lower(btrim(COALESCE(p_sistema_origem, '')));
  v_op text := lower(btrim(COALESCE(p_operacao, '')));
  v_idem text := btrim(COALESCE(p_idempotency_key, ''));
  v_user text := NULLIF(btrim(COALESCE(p_usuario_origem, '')), '');
  v_mat text := NULLIF(btrim(COALESCE(p_matricula_origem, '')), '');
  v_reg_id text := NULLIF(btrim(COALESCE(p_registro_id, '')), '');
  v_just text := NULLIF(btrim(COALESCE(p_justificativa, '')), '');
  v_tabela text;
  v_entidade_tipo text;
  v_snapshot jsonb;
  v_dados_limpos jsonb;
  v_solic_id uuid;
  v_res jsonb;
BEGIN
  IF v_sistema NOT IN ('notifica', 'classifica', 'fiscaliza') THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'SYSTEM_FORBIDDEN', 'error', 'Sistema de origem não autorizado.');
  END IF;

  IF v_op NOT IN ('propor_alteracao_empreendedor', 'propor_alteracao_barragem', 'propor_alteracao_rt') THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'OPERATION_FORBIDDEN', 'error', 'Operação não permitida para proposta de alteração.');
  END IF;

  IF v_user IS NULL OR v_reg_id IS NULL OR v_just IS NULL OR length(v_just) < 5 THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_PAYLOAD', 'error', 'Autor de origem, identificador do registro e justificativa objetiva são obrigatórios.');
  END IF;

  SELECT * INTO v_pol
  FROM public.integracao_s2s_politicas
  WHERE sistema_origem = v_sistema
    AND operacao = v_op
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'POLICY_NOT_FOUND', 'error', 'Operação bloqueada: política S2S ausente.');
  END IF;

  IF v_pol.ativo IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'POLICY_INACTIVE', 'error', 'Operação bloqueada: política S2S desativada.');
  END IF;

  IF v_pol.modo <> 'proposta_aprovacao' THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'DIRECT_MUTATION_FORBIDDEN', 'error', 'Alteração direta de cadastro existente é proibida; exige modo proposta_aprovacao.');
  END IF;

  SELECT * INTO v_existing_log
  FROM public.integracao_s2s_operacoes_log
  WHERE sistema_origem = v_sistema
    AND operacao = v_op
    AND idempotency_key = v_idem
    AND status_execucao IN ('em_processamento', 'sucesso')
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_log.status_execucao = 'em_processamento' THEN
      RETURN jsonb_build_object('success', false, 'http_status', 409, 'code', 'IDEMPOTENCY_IN_PROGRESS', 'error', 'Operação idempotente ainda em processamento.');
    END IF;
    IF v_existing_log.request_hash_sha256 <> p_request_hash_sha256 THEN
      RETURN jsonb_build_object('success', false, 'http_status', 409, 'code', 'IDEMPOTENCY_CONFLICT', 'error', 'Chave de idempotência já utilizada com payload divergente.');
    END IF;
    RETURN v_existing_log.resultado_resumo || jsonb_build_object('idempotent_replay', true);
  END IF;

  IF v_op = 'propor_alteracao_empreendedor' THEN
    v_entidade_tipo := 'empreendedor';
    v_tabela := 'empreendedores';
  ELSIF v_op = 'propor_alteracao_barragem' THEN
    v_entidade_tipo := 'barragem';
    v_tabela := 'barragens';
  ELSE
    v_entidade_tipo := 'rt';
    v_tabela := 'rts';
  END IF;

  v_dados_limpos := public._sanitizar_jsonb_para_tabela(
    v_tabela,
    p_dados_propostos,
    ARRAY['id', 'created_at', 'created_by', 'updated_at', 'updated_by']
  );

  IF v_dados_limpos = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_PAYLOAD', 'error', 'Nenhum campo válido proposto para alteração.');
  END IF;

  EXECUTE format(
    'SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1 FOR SHARE',
    v_tabela
  )
  INTO v_snapshot
  USING v_reg_id;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('success', false, 'http_status', 404, 'code', 'RECORD_NOT_FOUND', 'error', 'Registro alvo não encontrado no cadastro mestre.');
  END IF;

  INSERT INTO public.integracao_s2s_solicitacoes (
    politica_id,
    sistema_origem,
    operacao,
    entidade_tipo,
    tabela_nome,
    registro_id,
    idempotency_key,
    jti,
    usuario_origem,
    matricula_origem,
    referencia_externa,
    justificativa,
    dados_propostos,
    dados_atuais_snapshot,
    status,
    solicitado_em
  )
  VALUES (
    v_pol.id,
    v_sistema,
    v_op,
    v_entidade_tipo,
    v_tabela,
    v_reg_id,
    v_idem,
    p_jti,
    v_user,
    v_mat,
    NULLIF(btrim(COALESCE(p_referencia_externa, '')), ''),
    v_just,
    v_dados_limpos,
    v_snapshot,
    'Pendente',
    now()
  )
  RETURNING id INTO v_solic_id;

  v_res := jsonb_build_object(
    'success', true,
    'http_status', 202,
    'operacao', v_op,
    'modo', 'proposta_aprovacao',
    'solicitacao_id', v_solic_id,
    'status', 'Pendente',
    'entidade_tipo', v_entidade_tipo,
    'tabela_nome', v_tabela,
    'registro_id', v_reg_id,
    'sistema_origem', v_sistema,
    'usuario_origem', v_user,
    'matricula_origem', v_mat,
    'idempotency_key', v_idem
  );

  INSERT INTO public.integracao_s2s_operacoes_log (
    sistema_origem, kid, jti, operacao, politica_id, modo_aplicado,
    idempotency_key, request_hash_sha256, usuario_origem, matricula_origem,
    entidade_tipo, registro_id, solicitacao_id, status_execucao, http_status, resultado_resumo
  ) VALUES (
    v_sistema, p_kid, p_jti, v_op, v_pol.id, 'proposta_aprovacao',
    v_idem, p_request_hash_sha256, v_user, v_mat,
    v_entidade_tipo, v_reg_id, v_solic_id, 'sucesso', 202, v_res
  );

  RETURN v_res;
END;
$$;

-- 5.4 Cancelamento de solicitação ainda pendente pela própria origem e solicitante permitido
CREATE OR REPLACE FUNCTION public.s2s_cancelar_solicitacao_pendente(
  p_sistema_origem text,
  p_kid text,
  p_jti uuid,
  p_idempotency_key text,
  p_request_hash_sha256 text,
  p_solicitacao_id uuid,
  p_usuario_origem text,
  p_matricula_origem text DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pol public.integracao_s2s_politicas%ROWTYPE;
  v_existing_log public.integracao_s2s_operacoes_log%ROWTYPE;
  v_solic public.integracao_s2s_solicitacoes%ROWTYPE;
  v_sistema text := lower(btrim(COALESCE(p_sistema_origem, '')));
  v_idem text := btrim(COALESCE(p_idempotency_key, ''));
  v_user text := NULLIF(btrim(COALESCE(p_usuario_origem, '')), '');
  v_mat text := NULLIF(btrim(COALESCE(p_matricula_origem, '')), '');
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_delegados jsonb;
  v_autorizado boolean := false;
  v_res jsonb;
BEGIN
  IF v_sistema NOT IN ('notifica', 'classifica', 'fiscaliza') THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'SYSTEM_FORBIDDEN', 'error', 'Sistema de origem não autorizado.');
  END IF;

  IF p_solicitacao_id IS NULL OR v_user IS NULL OR v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_PAYLOAD', 'error', 'Identificador da solicitação, solicitante e motivo (mínimo 5 caracteres) são obrigatórios.');
  END IF;

  SELECT * INTO v_pol
  FROM public.integracao_s2s_politicas
  WHERE sistema_origem = v_sistema
    AND operacao = 'cancelar_solicitacao_pendente'
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'POLICY_NOT_FOUND', 'error', 'Operação bloqueada: política S2S ausente.');
  END IF;

  IF v_pol.ativo IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'POLICY_INACTIVE', 'error', 'Operação bloqueada: política S2S desativada.');
  END IF;

  IF v_pol.modo <> 'execucao_direta' THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'POLICY_MODE_MISMATCH', 'error', 'Política configurada não autoriza execução direta.');
  END IF;

  SELECT * INTO v_existing_log
  FROM public.integracao_s2s_operacoes_log
  WHERE sistema_origem = v_sistema
    AND operacao = 'cancelar_solicitacao_pendente'
    AND idempotency_key = v_idem
    AND status_execucao IN ('em_processamento', 'sucesso')
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_log.status_execucao = 'em_processamento' THEN
      RETURN jsonb_build_object('success', false, 'http_status', 409, 'code', 'IDEMPOTENCY_IN_PROGRESS', 'error', 'Operação idempotente ainda em processamento.');
    END IF;
    IF v_existing_log.request_hash_sha256 <> p_request_hash_sha256 THEN
      RETURN jsonb_build_object('success', false, 'http_status', 409, 'code', 'IDEMPOTENCY_CONFLICT', 'error', 'Chave de idempotência já utilizada com payload divergente.');
    END IF;
    RETURN v_existing_log.resultado_resumo || jsonb_build_object('idempotent_replay', true);
  END IF;

  SELECT * INTO v_solic
  FROM public.integracao_s2s_solicitacoes
  WHERE id = p_solicitacao_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'http_status', 404, 'code', 'SOLICITATION_NOT_FOUND', 'error', 'Solicitação não encontrada.');
  END IF;

  IF v_solic.sistema_origem <> v_sistema THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'ORIGIN_MISMATCH', 'error', 'Apenas o sistema de origem que abriu a solicitação pode cancelá-la.');
  END IF;

  IF v_solic.status <> 'Pendente' THEN
    RETURN jsonb_build_object('success', false, 'http_status', 409, 'code', 'SOLICITATION_NOT_PENDING', 'error', 'Somente solicitações ainda pendentes podem ser canceladas; atos já decididos exigem fluxo próprio bloqueado.');
  END IF;

  v_delegados := COALESCE(v_pol.restricoes -> 'canceladores_autorizados', '[]'::jsonb);
  v_autorizado := lower(btrim(v_solic.usuario_origem)) = lower(v_user)
    OR (
      jsonb_typeof(v_delegados) = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_delegados) AS elem(val)
        WHERE lower(btrim(elem.val)) = lower(v_user)
      )
    );

  IF NOT v_autorizado THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'ACTOR_FORBIDDEN', 'error', 'Solicitante informado não está autorizado a cancelar esta solicitação pendente.');
  END IF;

  UPDATE public.integracao_s2s_solicitacoes
  SET status = 'Cancelada',
      cancelado_em = now(),
      cancelado_por_origem = COALESCE(v_mat, v_user),
      motivo_cancelamento = v_motivo,
      updated_at = now()
  WHERE id = p_solicitacao_id;

  v_res := jsonb_build_object(
    'success', true,
    'http_status', 200,
    'operacao', 'cancelar_solicitacao_pendente',
    'modo', 'execucao_direta',
    'solicitacao_id', p_solicitacao_id,
    'status', 'Cancelada',
    'sistema_origem', v_sistema,
    'usuario_origem', v_user,
    'matricula_origem', v_mat,
    'motivo', v_motivo,
    'idempotency_key', v_idem
  );

  INSERT INTO public.integracao_s2s_operacoes_log (
    sistema_origem, kid, jti, operacao, politica_id, modo_aplicado,
    idempotency_key, request_hash_sha256, usuario_origem, matricula_origem,
    entidade_tipo, registro_id, solicitacao_id, status_execucao, http_status, resultado_resumo
  ) VALUES (
    v_sistema, p_kid, p_jti, 'cancelar_solicitacao_pendente', v_pol.id, 'execucao_direta',
    v_idem, p_request_hash_sha256, v_user, v_mat,
    v_solic.entidade_tipo, v_solic.registro_id, p_solicitacao_id, 'sucesso', 200, v_res
  );

  RETURN v_res;
END;
$$;

-- 5.5 Aprovação ou rejeição de solicitação S2S (exclusiva para Administrador ativo no Administra)
CREATE OR REPLACE FUNCTION public.admin_decidir_solicitacao_s2s(
  p_admin_auth_user_id uuid,
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
  v_adm record;
  v_solic public.integracao_s2s_solicitacoes%ROWTYPE;
  v_decisao text := lower(btrim(COALESCE(p_decisao, '')));
  v_obs text := NULLIF(btrim(COALESCE(p_observacao, '')), '');
  v_dados_limpos jsonb;
  v_col_list text;
  v_set_parts text[] := ARRAY[]::text[];
  v_row_count integer := 0;
  v_hist_id_text text;
  v_hist_id uuid;
  v_motivo text;
BEGIN
  SELECT * INTO v_adm FROM public._validar_admin_ativo_s2s(p_admin_auth_user_id) LIMIT 1;

  IF p_solicitacao_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_PAYLOAD', 'error', 'Identificador da solicitação é obrigatório.');
  END IF;

  IF v_decisao NOT IN ('aprovar', 'aprovada', 'rejeitar', 'rejeitada') THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_DECISION', 'error', 'Decisão inválida. Utilize "aprovar" ou "rejeitar".');
  END IF;

  SELECT * INTO v_solic
  FROM public.integracao_s2s_solicitacoes
  WHERE id = p_solicitacao_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'http_status', 404, 'code', 'SOLICITATION_NOT_FOUND', 'error', 'Solicitação S2S não encontrada.');
  END IF;

  IF v_solic.status <> 'Pendente' THEN
    RETURN jsonb_build_object('success', false, 'http_status', 409, 'code', 'SOLICITATION_ALREADY_DECIDED', 'error', format('Solicitação já analisada (%s).', v_solic.status));
  END IF;

  IF v_decisao IN ('rejeitar', 'rejeitada') THEN
    UPDATE public.integracao_s2s_solicitacoes
    SET status = 'Rejeitada',
        analisado_em = now(),
        analisado_por_uid = p_admin_auth_user_id,
        analisado_por_id = v_adm.usuario_id,
        analisado_por_login = v_adm.usuario_login,
        observacao_analise = v_obs,
        updated_at = now()
    WHERE id = p_solicitacao_id;

    RETURN jsonb_build_object(
      'success', true,
      'solicitacao_id', p_solicitacao_id,
      'status', 'Rejeitada',
      'analisado_por_login', v_adm.usuario_login
    );
  END IF;

  v_dados_limpos := public._sanitizar_jsonb_para_tabela(
    v_solic.tabela_nome,
    v_solic.dados_propostos,
    ARRAY['id', 'created_at', 'created_by', 'updated_at', 'updated_by']
  );

  IF v_dados_limpos = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'http_status', 422, 'code', 'EMPTY_CHANGESET', 'error', 'Solicitação não contém campos válidos para aplicação.');
  END IF;

  v_motivo := format(
    'Solicitação S2S (%s) aprovada por %s%s',
    v_solic.sistema_origem,
    v_adm.usuario_login,
    COALESCE(' — ' || COALESCE(v_obs, v_solic.justificativa), '')
  );

  PERFORM set_config('app.sistema_origem', v_solic.sistema_origem, true);
  PERFORM set_config('app.usuario_login', COALESCE(v_solic.matricula_origem, v_solic.usuario_origem), true);
  PERFORM set_config('app.motivo_alteracao', v_motivo, true);
  PERFORM set_config('app.solicitacao_externa_id', p_solicitacao_id::text, true);
  PERFORM set_config('app.ultimo_historico_id', '', true);

  SELECT string_agg(format('%I = rec.%I', c.column_name, c.column_name), ', ' ORDER BY c.ordinal_position)
  INTO v_col_list
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = v_solic.tabela_nome
    AND c.is_generated = 'NEVER'
    AND c.column_name NOT IN ('id', 'created_at', 'created_by', 'updated_at', 'updated_by')
    AND v_dados_limpos ? c.column_name;

  IF v_col_list IS NULL THEN
    RETURN jsonb_build_object('success', false, 'http_status', 422, 'code', 'EMPTY_CHANGESET', 'error', 'Nenhuma coluna elegível para alteração.');
  END IF;

  v_set_parts := array_append(v_set_parts, v_col_list);
  v_set_parts := array_append(v_set_parts, 'updated_at = now()');
  v_set_parts := array_append(v_set_parts, format('updated_by = %L', p_admin_auth_user_id::text));

  EXECUTE format(
    'UPDATE public.%I AS t SET %s FROM jsonb_populate_record(NULL::public.%I, $1) AS rec WHERE t.id = $2',
    v_solic.tabela_nome,
    array_to_string(v_set_parts, ', '),
    v_solic.tabela_nome
  )
  USING v_dados_limpos, v_solic.registro_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'TARGET_NOT_FOUND: Registro alvo não encontrado ao aplicar alteração.';
  END IF;

  v_hist_id_text := NULLIF(current_setting('app.ultimo_historico_id', true), '');
  IF v_hist_id_text IS NOT NULL THEN
    v_hist_id := v_hist_id_text::uuid;
  END IF;

  UPDATE public.integracao_s2s_solicitacoes
  SET status = 'Aprovada',
      analisado_em = now(),
      analisado_por_uid = p_admin_auth_user_id,
      analisado_por_id = v_adm.usuario_id,
      analisado_por_login = v_adm.usuario_login,
      observacao_analise = v_obs,
      historico_id = v_hist_id,
      updated_at = now()
  WHERE id = p_solicitacao_id;

  RETURN jsonb_build_object(
    'success', true,
    'solicitacao_id', p_solicitacao_id,
    'status', 'Aprovada',
    'historico_id', v_hist_id,
    'analisado_por_login', v_adm.usuario_login
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'ADM_%' THEN
      RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'ADMIN_REQUIRED', 'error', 'Apenas Administrador ativo no Administra pode aprovar ou rejeitar solicitações S2S.');
    END IF;
    RAISE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. GRANTS RESTRITIVOS DAS FUNÇÕES (NENHUM ACESSO PARA PUBLIC, anon, authenticated)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._validar_admin_ativo_s2s(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_upsert_politica_s2s(uuid, text, text, text, boolean, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.s2s_executar_cadastro_novo(text, text, uuid, text, text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.s2s_criar_solicitacao_alteracao(text, text, uuid, text, text, text, text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.s2s_cancelar_solicitacao_pendente(text, text, uuid, text, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_decidir_solicitacao_s2s(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._validar_admin_ativo_s2s(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_politica_s2s(uuid, text, text, text, boolean, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.s2s_executar_cadastro_novo(text, text, uuid, text, text, text, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.s2s_criar_solicitacao_alteracao(text, text, uuid, text, text, text, text, text, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.s2s_cancelar_solicitacao_pendente(text, text, uuid, text, text, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_decidir_solicitacao_s2s(uuid, uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
