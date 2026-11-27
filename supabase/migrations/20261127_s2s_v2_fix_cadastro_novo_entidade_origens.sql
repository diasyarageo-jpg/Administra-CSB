-- ============================================================================
-- SCRIPT DE MIGRAÇÃO INCREMENTAL E IDEMPOTENTE:
-- CORREÇÃO DE public.s2s_executar_cadastro_novo PARA O SCHEMA REAL DE
-- public.entidade_origens
-- Administra-CSB — SEMA-MT / SURH / CSB
-- ============================================================================
-- ATENÇÃO:
--   - Script preparado para revisão e execução controlada; NÃO presumir aplicação
--     automática em produção.
--   - Corrige exclusivamente public.s2s_executar_cadastro_novo sem modificar a
--     migration original 20261127_s2s_politicas_e_operacoes.sql.
--   - O registro em public.entidade_origens é obrigatório para concluir o
--     cadastro S2S (sem desvio opcional via to_regclass).
--   - Schema real verificado de public.entidade_origens:
--       entidade_tipo, entidade_id, origem_sistema, origem_registro_id,
--       lote_id, data_origem, data_recepcao, payload_original,
--       conciliacao_status, evidencia, aprovado_por, aprovado_em, observacoes
--       UNIQUE (entidade_tipo, origem_sistema, origem_registro_id)
--       CHECK origem_sistema IN ('Administra', 'Classifica', 'Notifica', 'Fiscaliza', 'SEMA-MT')
-- ============================================================================

BEGIN;

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
  v_origem_sistema text;
  v_op text := lower(btrim(COALESCE(p_operacao, '')));
  v_idem text := btrim(COALESCE(p_idempotency_key, ''));
  v_user text := NULLIF(btrim(COALESCE(p_usuario_origem, '')), '');
  v_mat text := NULLIF(btrim(COALESCE(p_matricula_origem, '')), '');
  v_ref_ext text := NULLIF(btrim(COALESCE(p_dados ->> 'referencia_externa', '')), '');
  v_explicit_id text := NULLIF(btrim(COALESCE(p_dados ->> 'id', '')), '');
  v_actor_tag text;
  v_tabela text;
  v_entidade_tipo text;
  v_new_id text;
  v_origem_registro_id text;
  v_origin_row_id uuid;
  v_existing_origin_entidade_id text;
  v_existing_entity boolean := false;
  v_existing_situacao text;
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

  -- Mapeamento explícito do identificador S2S interno para a constraint real de origem_sistema
  v_origem_sistema := CASE v_sistema
    WHEN 'classifica' THEN 'Classifica'
    WHEN 'notifica' THEN 'Notifica'
    WHEN 'fiscaliza' THEN 'Fiscaliza'
    ELSE NULL
  END;

  IF v_origem_sistema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'SYSTEM_FORBIDDEN', 'error', 'Sistema de origem sem mapeamento explícito autorizado.');
  END IF;

  IF v_op NOT IN ('cadastrar_empreendedor', 'cadastrar_barragem', 'cadastrar_rt') THEN
    RETURN jsonb_build_object('success', false, 'http_status', 403, 'code', 'OPERATION_FORBIDDEN', 'error', 'Operação não permitida para cadastro direto S2S.');
  END IF;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'ACTOR_REQUIRED', 'error', 'Autor de origem é obrigatório.');
  END IF;

  IF v_ref_ext IS NOT NULL AND (length(v_ref_ext) > 160 OR v_ref_ext ~ '[[:cntrl:]]') THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_PAYLOAD', 'error', 'Identificador de referência externa inválido.');
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

  -- Idempotência transacional pela mesma idempotency_key
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

  -- Determina entidade_tipo, valida campos mínimos e define IDs antes de checar duplicidade mestre
  IF v_op = 'cadastrar_empreendedor' THEN
    v_tabela := 'empreendedores';
    v_entidade_tipo := 'empreendedor';
    v_nome := NULLIF(btrim(COALESCE(p_dados ->> 'nome', '')), '');
    v_doc_digits := public.norm_digits_only(p_dados ->> 'cpf_cnpj');
    v_new_id := COALESCE(v_explicit_id, 'emp_' || replace(gen_random_uuid()::text, '-', ''));

    IF v_nome IS NULL OR v_doc_digits IS NULL OR length(v_doc_digits) NOT IN (11, 14) THEN
      RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_PAYLOAD', 'error', 'Nome e CPF/CNPJ completo válido são obrigatórios para cadastrar empreendedor.');
    END IF;

  ELSIF v_op = 'cadastrar_barragem' THEN
    v_tabela := 'barragens';
    v_entidade_tipo := 'barragem';
    v_nome := NULLIF(btrim(COALESCE(p_dados ->> 'nome', '')), '');
    v_snisb := NULLIF(btrim(COALESCE(p_dados ->> 'snisb', '')), '');
    v_municipio := NULLIF(btrim(COALESCE(p_dados ->> 'municipio', '')), '');
    v_emp_id := NULLIF(btrim(COALESCE(p_dados ->> 'empreendedor_id', '')), '');
    v_new_id := COALESCE(v_explicit_id, 'bar_' || replace(gen_random_uuid()::text, '-', ''));

    IF v_nome IS NULL THEN
      RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_PAYLOAD', 'error', 'Nome da barragem é obrigatório.');
    END IF;

  ELSIF v_op = 'cadastrar_rt' THEN
    v_tabela := 'rts';
    v_entidade_tipo := 'rt';
    v_nome := NULLIF(btrim(COALESCE(p_dados ->> 'nome', '')), '');
    v_doc_digits := public.norm_digits_only(p_dados ->> 'cpf');
    v_conselho := COALESCE(NULLIF(upper(btrim(COALESCE(p_dados ->> 'conselho', ''))), ''), 'CREA-MT');
    v_uf_conselho := COALESCE(NULLIF(upper(btrim(COALESCE(p_dados ->> 'uf_conselho', ''))), ''), 'MT');
    v_reg_norm := NULLIF(upper(regexp_replace(COALESCE(p_dados ->> 'registro', ''), '[^A-Za-z0-9]', '', 'g')), '');
    v_new_id := COALESCE(v_explicit_id, 'rt_' || replace(gen_random_uuid()::text, '-', ''));

    IF v_nome IS NULL OR ((v_doc_digits IS NULL OR length(v_doc_digits) <> 11) AND v_reg_norm IS NULL) THEN
      RETURN jsonb_build_object('success', false, 'http_status', 400, 'code', 'INVALID_PAYLOAD', 'error', 'Nome e CPF válido ou registro profissional são obrigatórios para cadastrar RT.');
    END IF;
  END IF;

  v_origem_registro_id := COALESCE(v_ref_ext, v_new_id);

  -- Consulta prévia em entidade_origens antes da checagem de duplicidade do cadastro mestre
  SELECT eo.entidade_id
  INTO v_existing_origin_entidade_id
  FROM public.entidade_origens eo
  WHERE eo.entidade_tipo = v_entidade_tipo
    AND eo.origem_sistema = v_origem_sistema
    AND eo.origem_registro_id = v_origem_registro_id
  LIMIT 1
  FOR SHARE;

  IF FOUND THEN
    IF v_explicit_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'http_status', 409,
        'code', 'ORIGIN_REFERENCE_CONFLICT',
        'error', 'Referência externa já vinculada na origem; identificador explícito da entidade é obrigatório para confirmar correspondência.'
      );
    END IF;

    IF v_existing_origin_entidade_id IS DISTINCT FROM v_explicit_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'http_status', 409,
        'code', 'ORIGIN_REFERENCE_CONFLICT',
        'error', 'Referência externa já está vinculada a outra entidade do mesmo tipo e sistema de origem.'
      );
    END IF;

    -- Verifica existência explícita da entidade mestre sem usar FOUND após EXECUTE
    v_existing_entity := false;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I t WHERE t.id = $1)', v_tabela)
    INTO v_existing_entity
    USING v_explicit_id;

    IF v_existing_entity IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'http_status', 409,
        'code', 'ORIGIN_REFERENCE_CONFLICT',
        'error', 'Vínculo de origem existente aponta para identificador inexistente no cadastro mestre.'
      );
    END IF;

    EXECUTE format('SELECT t.situacao FROM public.%I t WHERE t.id = $1 LIMIT 1', v_tabela)
    INTO v_existing_situacao
    USING v_explicit_id;

    v_res := jsonb_build_object(
      'success', true,
      'http_status', 200,
      'operacao', v_op,
      'modo', 'execucao_direta',
      'entidade_tipo', v_entidade_tipo,
      'tabela_nome', v_tabela,
      'registro_id', v_explicit_id,
      'situacao', COALESCE(v_existing_situacao, 'Ativo'),
      'sistema_origem', v_sistema,
      'usuario_origem', v_user,
      'matricula_origem', v_mat,
      'historico_id', NULL,
      'idempotency_key', v_idem,
      'sem_mutacao', true,
      'origem_ja_vinculada', true
    );

    INSERT INTO public.integracao_s2s_operacoes_log (
      sistema_origem, kid, jti, operacao, politica_id, modo_aplicado,
      idempotency_key, request_hash_sha256, usuario_origem, matricula_origem,
      entidade_tipo, registro_id, status_execucao, http_status, resultado_resumo
    ) VALUES (
      v_sistema, p_kid, p_jti, v_op, v_pol.id, 'execucao_direta',
      v_idem, p_request_hash_sha256, v_user, v_mat,
      v_entidade_tipo, v_explicit_id, 'sucesso', 200, v_res
    );

    RETURN v_res;
  END IF;

  -- Checagem de integridade referencial e não sobrescrita no cadastro mestre
  IF v_op = 'cadastrar_empreendedor' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.empreendedores e
      WHERE e.id = v_new_id
         OR public.norm_digits_only(e.cpf_cnpj) = v_doc_digits
    ) INTO v_duplicate;

    IF v_duplicate THEN
      RETURN jsonb_build_object('success', false, 'http_status', 409, 'code', 'DUPLICATE_RECORD', 'error', 'Empreendedor já existe no cadastro mestre; sobrescrita bloqueada.');
    END IF;

  ELSIF v_op = 'cadastrar_barragem' THEN
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

  ELSIF v_op = 'cadastrar_rt' THEN
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
  END IF;

  -- Subtransação atômica: cadastro mestre, entidade_origens (obrigatório) e log na mesma transação
  BEGIN
    PERFORM set_config('app.sistema_origem', v_sistema, true);
    PERFORM set_config('app.usuario_login', COALESCE(v_mat, v_user), true);
    PERFORM set_config('app.motivo_alteracao', COALESCE(NULLIF(btrim(COALESCE(p_motivo, '')), ''), format('Cadastro novo via S2S (%s)', v_sistema)), true);
    PERFORM set_config('app.ultimo_historico_id', '', true);

    IF v_op = 'cadastrar_empreendedor' THEN
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

    -- INSERT obrigatório em public.entidade_origens; falha de contrato/tabela reverte tudo
    v_origin_row_id := NULL;
    v_existing_origin_entidade_id := NULL;

    INSERT INTO public.entidade_origens (
      entidade_tipo,
      entidade_id,
      origem_sistema,
      origem_registro_id,
      data_origem,
      observacoes
    ) VALUES (
      v_entidade_tipo,
      v_new_id,
      v_origem_sistema,
      v_origem_registro_id,
      now(),
      format('Cadastro novo via S2S por %s%s', v_user, COALESCE(' (matrícula ' || v_mat || ')', ''))
    )
    ON CONFLICT (entidade_tipo, origem_sistema, origem_registro_id) DO NOTHING
    RETURNING id INTO v_origin_row_id;

    IF v_origin_row_id IS NULL THEN
      SELECT eo.entidade_id
      INTO v_existing_origin_entidade_id
      FROM public.entidade_origens eo
      WHERE eo.entidade_tipo = v_entidade_tipo
        AND eo.origem_sistema = v_origem_sistema
        AND eo.origem_registro_id = v_origem_registro_id
      LIMIT 1;

      IF v_explicit_id IS NULL
         OR v_existing_origin_entidade_id IS NULL
         OR v_existing_origin_entidade_id IS DISTINCT FROM v_new_id THEN
        RAISE EXCEPTION 'ORIGIN_REFERENCE_CONFLICT' USING ERRCODE = 'P0001';
      END IF;
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
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM = 'ORIGIN_REFERENCE_CONFLICT' THEN
        RETURN jsonb_build_object(
          'success', false,
          'http_status', 409,
          'code', 'ORIGIN_REFERENCE_CONFLICT',
          'error', 'Referência externa já está vinculada a outra entidade do mesmo tipo e sistema de origem.'
        );
      END IF;
      RAISE;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.s2s_executar_cadastro_novo(text, text, uuid, text, text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.s2s_executar_cadastro_novo(text, text, uuid, text, text, text, text, text, jsonb, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
