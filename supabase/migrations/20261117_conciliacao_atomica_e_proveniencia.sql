-- supabase/migrations/20261117_conciliacao_atomica_e_proveniencia.sql
-- Conciliação assistida atômica no servidor (master + auditoria na mesma transação)
-- e correção idempotente de proveniência para dados importados via SQL
-- reusando `integracao_lotes`, `entidade_origens` e `entidade_campo_proveniencia`.
-- ATENÇÃO: Script incremental/idempotente para execução manual controlada;
-- não sobrescreve valores existentes nem altera registros já gravados em `historico_alteracoes_dados`.

-- 1. Estruturas de proveniência para lotes e origens de importação
CREATE TABLE IF NOT EXISTS public.integracao_lotes (
  id text PRIMARY KEY,
  sistema_origem text NOT NULL DEFAULT 'desconhecida',
  tabela_destino text NOT NULL,
  referencia_lote text,
  origem_comprovavel boolean NOT NULL DEFAULT false,
  confiabilidade text NOT NULL DEFAULT 'desconhecida'
    CHECK (confiabilidade IN ('comprovada', 'parcial', 'desconhecida')),
  importado_em timestamptz,
  registrado_em timestamptz NOT NULL DEFAULT now(),
  observacoes text
);

CREATE TABLE IF NOT EXISTS public.entidade_origens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidade_tipo text NOT NULL,
  entidade_id text NOT NULL,
  sistema_origem text NOT NULL DEFAULT 'desconhecida',
  tabela_origem text,
  lote_id text REFERENCES public.integracao_lotes(id) ON DELETE SET NULL,
  registro_origem_id text,
  data_origem timestamptz,
  confiabilidade text NOT NULL DEFAULT 'desconhecida'
    CHECK (confiabilidade IN ('comprovada', 'parcial', 'desconhecida')),
  observacoes text,
  registrado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entidade_tipo, entidade_id, sistema_origem)
);

CREATE INDEX IF NOT EXISTS idx_entidade_origens_entidade
  ON public.entidade_origens (entidade_tipo, entidade_id);

CREATE INDEX IF NOT EXISTS idx_entidade_origens_lote
  ON public.entidade_origens (lote_id)
  WHERE lote_id IS NOT NULL;

ALTER TABLE IF EXISTS public.entidade_campo_proveniencia
  ADD COLUMN IF NOT EXISTS lote_id text REFERENCES public.integracao_lotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tabela_origem text,
  ADD COLUMN IF NOT EXISTS confiabilidade_origem text DEFAULT 'comprovada';

ALTER TABLE public.integracao_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entidade_origens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.integracao_lotes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.entidade_origens FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.integracao_lotes TO authenticated;
GRANT SELECT ON TABLE public.entidade_origens TO authenticated;

DROP POLICY IF EXISTS integracao_lotes_select_active ON public.integracao_lotes;
CREATE POLICY integracao_lotes_select_active ON public.integracao_lotes
  FOR SELECT TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS entidade_origens_select_active ON public.entidade_origens;
CREATE POLICY entidade_origens_select_active ON public.entidade_origens
  FOR SELECT TO authenticated
  USING (public.is_active_user());

-- 2. Corrige `_resolver_ator_auditoria()` para nunca atribuir ao Administra
-- inserções/edições executadas por SQL direto sem usuário/contexto explícito.
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
  usuario_login := COALESCE(
    v_ctx_login,
    v_u_login,
    v_jwt_email,
    CASE
      WHEN public._is_service_role_caller() THEN 'integracao_sistema'
      WHEN v_uid IS NOT NULL THEN 'usuario_autenticado'
      ELSE 'origem_desconhecida'
    END
  );
  usuario_nome := v_u_nome;
  auth_user_id := v_uid;
  sistema_origem := COALESCE(
    v_ctx_sistema,
    v_jwt_sistema,
    CASE
      WHEN v_uid IS NOT NULL THEN 'Administra'
      ELSE 'desconhecida'
    END
  );
  RETURN NEXT;
END;
$$;

-- 3. Backfill idempotente de proveniência de dados importados (sem sobrescrever valores ou histórico existente)
DO $$
DECLARE
  v_lote_fisc text := 'lote_sql_fiscaliza_notificacoes';
  v_lote_geoportal text := 'lote_sync_geoportal_sema';
  v_lote_bar_desc text := 'lote_sql_barragens_origem_desconhecida';
  v_lote_emp_desc text := 'lote_sql_empreendedores_origem_desconhecida';
  v_lote_rt_desc text := 'lote_sql_rts_origem_desconhecida';
BEGIN
  -- 3.1 Lote Fiscaliza (tabela e data comprováveis quando `imported_at`/`created_at` existir)
  IF to_regclass('public.fiscaliza_notificacoes_importadas') IS NOT NULL THEN
    INSERT INTO public.integracao_lotes (
      id, sistema_origem, tabela_destino, referencia_lote,
      origem_comprovavel, confiabilidade, importado_em, observacoes
    )
    VALUES (
      v_lote_fisc,
      'Fiscaliza',
      'fiscaliza_notificacoes_importadas',
      'fiscaliza_notificacoes_importadas',
      true,
      'comprovada',
      (SELECT MIN(imported_at) FROM public.fiscaliza_notificacoes_importadas WHERE imported_at IS NOT NULL),
      'Registros importados da tabela fiscaliza_notificacoes_importadas (origem Fiscaliza comprovável).'
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.entidade_origens (
      entidade_tipo, entidade_id, sistema_origem, tabela_origem,
      lote_id, registro_origem_id, data_origem, confiabilidade, observacoes
    )
    SELECT
      'fiscaliza_notificacao',
      f.id::text,
      'Fiscaliza',
      'fiscaliza_notificacoes_importadas',
      v_lote_fisc,
      COALESCE(NULLIF(btrim(f.processo), ''), f.id::text),
      COALESCE(f.imported_at, f.created_at),
      CASE WHEN COALESCE(f.imported_at, f.created_at) IS NOT NULL THEN 'comprovada' ELSE 'parcial' END,
      'Proveniência preservada de fiscaliza_notificacoes_importadas sem alteração de conteúdo.'
    FROM public.fiscaliza_notificacoes_importadas f
    ON CONFLICT (entidade_tipo, entidade_id, sistema_origem) DO NOTHING;
  END IF;

  -- 3.2 Cache Geoportal SEMA-MT
  IF to_regclass('public.geoportal_sync_cache') IS NOT NULL THEN
    INSERT INTO public.integracao_lotes (
      id, sistema_origem, tabela_destino, referencia_lote,
      origem_comprovavel, confiabilidade, importado_em, observacoes
    )
    VALUES (
      v_lote_geoportal,
      'SEMA-MT',
      'geoportal_sync_cache',
      'geoportal_sync_cache',
      true,
      'comprovada',
      NULL,
      'Espelho técnico de feições públicas consultadas no Geoportal SEMA-MT.'
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- 3.3 Barragens sem usuário criador comprovável (ex.: carga SQL legada) -> nunca atribuir a Administra
  IF to_regclass('public.barragens') IS NOT NULL THEN
    INSERT INTO public.integracao_lotes (
      id, sistema_origem, tabela_destino, referencia_lote,
      origem_comprovavel, confiabilidade, importado_em, observacoes
    )
    VALUES (
      v_lote_bar_desc,
      'desconhecida',
      'barragens',
      'carga_sql_sem_autor_comprovavel',
      false,
      'desconhecida',
      NULL,
      'Registros de barragens inseridos fora do fluxo autenticado Administra (sem autoria UUID/origem comprovável); data original não inventada.'
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.entidade_origens (
      entidade_tipo, entidade_id, sistema_origem, tabela_origem,
      lote_id, registro_origem_id, data_origem, confiabilidade, observacoes
    )
    SELECT
      'barragem',
      b.id,
      CASE
        WHEN coalesce(b.created_by, '') ILIKE 'fiscaliza%' THEN 'Fiscaliza'
        WHEN coalesce(b.created_by, '') ILIKE 'sema%' THEN 'SEMA-MT'
        ELSE 'desconhecida'
      END,
      CASE
        WHEN coalesce(b.created_by, '') ILIKE 'fiscaliza%' THEN 'fiscaliza_notificacoes_importadas'
        ELSE 'barragens (carga SQL)'
      END,
      CASE
        WHEN coalesce(b.created_by, '') ILIKE 'fiscaliza%' THEN v_lote_fisc
        ELSE v_lote_bar_desc
      END,
      b.id,
      NULL,
      CASE
        WHEN coalesce(b.created_by, '') ILIKE 'fiscaliza%' OR coalesce(b.created_by, '') ILIKE 'sema%' THEN 'parcial'
        ELSE 'desconhecida'
      END,
      'Registro anterior à rastreabilidade de lote; não atribuído ao Administra e sem invenção de data.'
    FROM public.barragens b
    WHERE (
      b.created_by IS NULL
      OR btrim(b.created_by) = ''
      OR btrim(b.created_by) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
      AND NOT EXISTS (
        SELECT 1 FROM public.entidade_origens eo
        WHERE eo.entidade_tipo = 'barragem' AND eo.entidade_id = b.id
      )
    ON CONFLICT (entidade_tipo, entidade_id, sistema_origem) DO NOTHING;

    INSERT INTO public.entidade_campo_proveniencia (
      entidade_tipo, entidade_id, campo_nome, valor_atual,
      fonte_origem, tabela_origem, lote_id, confiabilidade_origem,
      consultado_em, aceito_em, aceito_por, motivo
    )
    SELECT
      'barragem',
      b.id,
      'registro_importado',
      COALESCE(NULLIF(btrim(b.nome), ''), b.id),
      eo.sistema_origem,
      eo.tabela_origem,
      eo.lote_id,
      eo.confiabilidade,
      eo.data_origem,
      now(),
      NULL,
      'Proveniência identificada retroativamente sem sobrescrever valores ou histórico.'
    FROM public.barragens b
    JOIN public.entidade_origens eo
      ON eo.entidade_tipo = 'barragem' AND eo.entidade_id = b.id
    WHERE (
      b.created_by IS NULL
      OR btrim(b.created_by) = ''
      OR btrim(b.created_by) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    ON CONFLICT (entidade_tipo, entidade_id, campo_nome) DO NOTHING;
  END IF;

  -- 3.4 Empreendedores sem usuário criador UUID comprovável
  IF to_regclass('public.empreendedores') IS NOT NULL THEN
    INSERT INTO public.integracao_lotes (
      id, sistema_origem, tabela_destino, referencia_lote,
      origem_comprovavel, confiabilidade, importado_em, observacoes
    )
    VALUES (
      v_lote_emp_desc,
      'desconhecida',
      'empreendedores',
      'carga_sql_sem_autor_comprovavel',
      false,
      'desconhecida',
      NULL,
      'Registros de empreendedores inseridos fora do fluxo autenticado Administra; origem marcada como desconhecida.'
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.entidade_origens (
      entidade_tipo, entidade_id, sistema_origem, tabela_origem,
      lote_id, registro_origem_id, data_origem, confiabilidade, observacoes
    )
    SELECT
      'empreendedor',
      e.id,
      CASE
        WHEN coalesce(e.created_by, '') ILIKE 'fiscaliza%' THEN 'Fiscaliza'
        WHEN coalesce(e.created_by, '') ILIKE 'sema%' THEN 'SEMA-MT'
        ELSE 'desconhecida'
      END,
      'empreendedores (carga SQL)',
      v_lote_emp_desc,
      e.id,
      NULL,
      'desconhecida',
      'Registro importado sem lote explícito anterior; não atribuído ao Administra.'
    FROM public.empreendedores e
    WHERE (
      e.created_by IS NULL
      OR btrim(e.created_by) = ''
      OR btrim(e.created_by) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
      AND NOT EXISTS (
        SELECT 1 FROM public.entidade_origens eo
        WHERE eo.entidade_tipo = 'empreendedor' AND eo.entidade_id = e.id
      )
    ON CONFLICT (entidade_tipo, entidade_id, sistema_origem) DO NOTHING;

    INSERT INTO public.entidade_campo_proveniencia (
      entidade_tipo, entidade_id, campo_nome, valor_atual,
      fonte_origem, tabela_origem, lote_id, confiabilidade_origem,
      consultado_em, aceito_em, aceito_por, motivo
    )
    SELECT
      'empreendedor',
      e.id,
      'registro_importado',
      COALESCE(NULLIF(btrim(e.nome), ''), e.id),
      eo.sistema_origem,
      eo.tabela_origem,
      eo.lote_id,
      eo.confiabilidade,
      eo.data_origem,
      now(),
      NULL,
      'Proveniência identificada retroativamente sem sobrescrever valores ou histórico.'
    FROM public.empreendedores e
    JOIN public.entidade_origens eo
      ON eo.entidade_tipo = 'empreendedor' AND eo.entidade_id = e.id
    WHERE (
      e.created_by IS NULL
      OR btrim(e.created_by) = ''
      OR btrim(e.created_by) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    ON CONFLICT (entidade_tipo, entidade_id, campo_nome) DO NOTHING;
  END IF;

  -- 3.5 RTs sem usuário criador UUID comprovável
  IF to_regclass('public.rts') IS NOT NULL THEN
    INSERT INTO public.integracao_lotes (
      id, sistema_origem, tabela_destino, referencia_lote,
      origem_comprovavel, confiabilidade, importado_em, observacoes
    )
    VALUES (
      v_lote_rt_desc,
      'desconhecida',
      'rts',
      'carga_sql_sem_autor_comprovavel',
      false,
      'desconhecida',
      NULL,
      'Registros de responsáveis técnicos inseridos fora do fluxo autenticado Administra; origem marcada como desconhecida.'
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.entidade_origens (
      entidade_tipo, entidade_id, sistema_origem, tabela_origem,
      lote_id, registro_origem_id, data_origem, confiabilidade, observacoes
    )
    SELECT
      'rt',
      r.id,
      'desconhecida',
      'rts (carga SQL)',
      v_lote_rt_desc,
      r.id,
      NULL,
      'desconhecida',
      'Registro importado sem lote explícito anterior; não atribuído ao Administra.'
    FROM public.rts r
    WHERE (
      r.created_by IS NULL
      OR btrim(r.created_by) = ''
      OR btrim(r.created_by) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
      AND NOT EXISTS (
        SELECT 1 FROM public.entidade_origens eo
        WHERE eo.entidade_tipo = 'rt' AND eo.entidade_id = r.id
      )
    ON CONFLICT (entidade_tipo, entidade_id, sistema_origem) DO NOTHING;
  END IF;
END $$;

-- 4. RPC transacional atômica exclusiva do servidor (`service_role`) para gravar conciliação assistida
-- Garante: RBAC + trava da linha + validação de concorrência + gravação no mestre + gravação obrigatória
-- na auditoria (`revisoes` e `historico_alteracoes_dados`) na mesma transação.
DROP FUNCTION IF EXISTS public.executar_conciliacao_assistida(
  text, text, text, text, text, text, text, text, text, text, text, uuid, boolean, text, uuid, text, text, jsonb
);

CREATE OR REPLACE FUNCTION public.executar_conciliacao_assistida(
  p_alvo_tipo text,
  p_barragem_id text,
  p_acao text,
  p_classificacao text,
  p_justificativa text,
  p_master_updated_at_snapshot text DEFAULT NULL,
  p_master_empreendedor_id_snapshot text DEFAULT NULL,
  p_selected_empreendedor_id text DEFAULT NULL,
  p_selected_rt_id text DEFAULT NULL,
  p_selected_rt_art text DEFAULT NULL,
  p_selected_rt_updated_at_snapshot text DEFAULT NULL,
  p_auditoria_id uuid DEFAULT NULL,
  p_vincular_car_da_sema boolean DEFAULT false,
  p_sema_car text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_actor_login text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_audit_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_srv boolean := public._is_service_role_caller();
  v_actor_uid uuid := COALESCE(p_actor_user_id, auth.uid());
  v_actor_uid_text text;
  v_actor_role text;
  v_actor_login text;
  v_u_situacao text;
  v_u_papel text;
  v_u_login text;
  v_u_nome text;
  v_dam record;
  v_emp record;
  v_rt_id text;
  v_rt_nome text;
  v_rt_updated_at timestamptz;
  v_rt_link_pk text;
  v_just text := NULLIF(btrim(coalesce(p_justificativa, '')), '');
  v_sema_car text := NULLIF(btrim(coalesce(p_sema_car, '')), '');
  v_now timestamptz := now();
  v_new_rev_id text;
  v_rev_situacao text;
  v_rev_tipo text;
  v_rev_identificador text;
  v_rev_origem_a text;
  v_rev_origem_b text;
  v_rev_divergencias text;
  v_active_titular_count integer;
  v_current_titular_emp_id text;
  v_link_id text;
  v_class_label text;
  v_acao_label text;
  v_valor_ant text;
  v_valor_prop text;
BEGIN
  IF NOT v_is_srv THEN
    RETURN jsonb_build_object(
      'success', false,
      'http_status', 403,
      'error', 'Esta operação só pode ser executada pela rota segura do servidor.'
    );
  END IF;

  IF v_actor_uid IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'http_status', 401,
      'error', 'Usuário autenticador ausente na transação.'
    );
  END IF;
  v_actor_uid_text := v_actor_uid::text;

  SELECT
    lower(btrim(coalesce(u.situacao, 'Inativo'))),
    btrim(coalesce(u.papel, '')),
    COALESCE(NULLIF(btrim(u.login), ''), NULLIF(btrim(u.email), '')),
    NULLIF(btrim(u.nome), '')
  INTO v_u_situacao, v_u_papel, v_u_login, v_u_nome
  FROM public.usuarios u
  WHERE u.auth_user_id = v_actor_uid
  LIMIT 1;

  IF NOT FOUND OR v_u_situacao <> 'ativo' THEN
    RETURN jsonb_build_object(
      'success', false,
      'http_status', 403,
      'error', 'Usuário institucional inativo ou não localizado para auditoria.'
    );
  END IF;

  v_actor_role := CASE lower(translate(v_u_papel, 'ÁÀÃÂáàãâÉÊéêÍíÓÔÕóôõÚúÇç', 'AAAAaaaaEEeeIiOOOoooUuCc'))
    WHEN 'administrador' THEN 'Administrador'
    WHEN 'admin' THEN 'Administrador'
    WHEN 'analista' THEN 'Analista'
    WHEN 'usuario' THEN 'Usuário'
    WHEN 'visualizador' THEN 'Visualizador'
    ELSE v_u_papel
  END;

  IF v_actor_role NOT IN ('Administrador', 'Analista', 'Usuário') THEN
    RETURN jsonb_build_object(
      'success', false,
      'http_status', 403,
      'error', 'Perfil sem permissão para alterar cadastro mestre ou registrar conciliação.'
    );
  END IF;

  v_actor_login := COALESCE(NULLIF(btrim(p_actor_login), ''), v_u_login, v_actor_uid_text);

  IF p_alvo_tipo NOT IN ('barragem_empreendedor', 'barragem_rt_parecer') THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'error', 'Alvo de conciliação inválido.');
  END IF;

  IF p_acao NOT IN ('vincular', 'rejeitar', 'encaminhar_analise') THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'error', 'Ação de conciliação inválida.');
  END IF;

  IF p_classificacao NOT IN (
    'sem_correspondencia',
    'candidato',
    'ambiguo',
    'possivel_erro_grafia',
    'papeis_diferentes',
    'vinculo_ausente',
    'confirmado_usuario',
    'nao_e_divergencia'
  ) THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'error', 'Classificação de conciliação inválida.');
  END IF;

  IF v_just IS NULL OR length(v_just) < 5 THEN
    RETURN jsonb_build_object('success', false, 'http_status', 400, 'error', 'Justificativa obrigatória (mínimo 5 caracteres).');
  END IF;

  -- Configura contexto transacional de auditoria para triggers (`historico_alteracoes_dados`)
  PERFORM set_config('app.sistema_origem', 'Administra', true);
  PERFORM set_config('app.usuario_login', v_actor_login, true);
  PERFORM set_config('app.motivo_alteracao', left(v_just, 500), true);

  -- Bloqueia o registro alvo da barragem na transação
  SELECT b.*
  INTO v_dam
  FROM public.barragens b
  WHERE b.id = p_barragem_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'http_status', 404,
      'error', 'Barragem alvo não encontrada no cadastro central.'
    );
  END IF;

  IF v_actor_role = 'Usuário' AND NULLIF(btrim(coalesce(v_dam.created_by, '')), '') IS NOT NULL
     AND btrim(v_dam.created_by) IS DISTINCT FROM v_actor_uid_text THEN
    RETURN jsonb_build_object(
      'success', false,
      'http_status', 403,
      'error', 'Permissão negada: usuário comum só pode conciliar registros criados por ele.'
    );
  END IF;

  -- Validação atômica de concorrência otimista na linha travada
  IF NULLIF(btrim(coalesce(p_master_updated_at_snapshot, '')), '') IS NOT NULL THEN
    IF v_dam.updated_at IS NULL OR abs(extract(epoch FROM (v_dam.updated_at - p_master_updated_at_snapshot::timestamptz))) > 0.002 THEN
      RETURN jsonb_build_object(
        'success', false,
        'http_status', 409,
        'error', 'Conflito de concorrência detectado: a barragem foi alterada no banco central após a abertura da revisão.'
      );
    END IF;
  END IF;

  IF p_alvo_tipo = 'barragem_empreendedor'
     AND p_acao = 'vincular'
     AND p_master_empreendedor_id_snapshot IS NOT NULL THEN
    IF COALESCE(NULLIF(btrim(v_dam.empreendedor_id), ''), '') IS DISTINCT FROM COALESCE(NULLIF(btrim(p_master_empreendedor_id_snapshot), ''), '') THEN
      RETURN jsonb_build_object(
        'success', false,
        'http_status', 409,
        'error', 'Conflito detectado: o empreendedor vinculado desta barragem já foi modificado no banco central.'
      );
    END IF;
  END IF;

  -- Aplicação controlada no cadastro mestre somente quando acao = 'vincular'
  IF p_acao = 'vincular' THEN
    IF p_alvo_tipo = 'barragem_empreendedor' THEN
      IF NULLIF(btrim(coalesce(p_selected_empreendedor_id, '')), '') IS NULL THEN
        RETURN jsonb_build_object('success', false, 'http_status', 400, 'error', 'Empreendedor selecionado é obrigatório para vincular.');
      END IF;

      SELECT e.*
      INTO v_emp
      FROM public.empreendedores e
      WHERE e.id = p_selected_empreendedor_id
      FOR SHARE;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'http_status', 404, 'error', 'Empreendedor selecionado não encontrado no cadastro mestre.');
      END IF;

      IF COALESCE(NULLIF(btrim(v_emp.situacao), ''), 'Ativo') <> 'Ativo' THEN
        RETURN jsonb_build_object('success', false, 'http_status', 400, 'error', 'Apenas empreendedores Ativos podem ser vinculados.');
      END IF;

      IF p_auditoria_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.sema_consultas_auditoria sa
          WHERE sa.id = p_auditoria_id
            AND (sa.entidade_alvo_tipo IS NULL OR (sa.entidade_alvo_tipo = 'barragem' AND sa.entidade_alvo_id = p_barragem_id))
        ) THEN
          RETURN jsonb_build_object('success', false, 'http_status', 400, 'error', 'Referência de auditoria SEMA inválida para esta barragem.');
        END IF;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('titularidade:' || p_barragem_id, 0)
      );

      SELECT COUNT(*), MIN(empreendedor_id)
      INTO v_active_titular_count, v_current_titular_emp_id
      FROM public.empreendedor_barragem_titularidade
      WHERE barragem_id = p_barragem_id
        AND vigente = true;

      IF v_active_titular_count > 1 THEN
        RETURN jsonb_build_object(
          'success', false,
          'http_status', 409,
          'error', 'Conflito de titularidade: múltiplos vínculos vigentes ativos encontrados para esta barragem.'
        );
      END IF;

      IF v_active_titular_count = 1 AND v_current_titular_emp_id IS DISTINCT FROM v_emp.id THEN
        UPDATE public.empreendedor_barragem_titularidade
        SET vigente = false,
            situacao = 'Encerrada',
            fim_em = v_now,
            updated_at = v_now
        WHERE barragem_id = p_barragem_id
          AND vigente = true;
      END IF;

      IF v_active_titular_count = 0 OR v_current_titular_emp_id IS DISTINCT FROM v_emp.id THEN
        INSERT INTO public.empreendedor_barragem_titularidade (
          barragem_id,
          empreendedor_id,
          vigente,
          situacao,
          inicio_em,
          origem,
          auditoria_id,
          motivo,
          aprovado_por,
          created_at,
          updated_at
        )
        VALUES (
          p_barragem_id,
          v_emp.id,
          true,
          'Vigente',
          v_now,
          CASE WHEN p_auditoria_id IS NOT NULL THEN 'SEMA-MT' ELSE 'Administra' END,
          p_auditoria_id,
          'Conciliação assistida: ' || left(v_just, 250),
          v_actor_uid,
          v_now,
          v_now
        );
      END IF;

      UPDATE public.barragens
      SET empreendedor_id = v_emp.id,
          empreendedor = v_emp.id,
          car = CASE
            WHEN p_vincular_car_da_sema AND v_sema_car IS NOT NULL THEN v_sema_car
            ELSE car
          END,
          updated_by = v_actor_uid_text,
          updated_at = v_now
      WHERE id = p_barragem_id;

      INSERT INTO public.entidade_campo_proveniencia (
        entidade_tipo, entidade_id, campo_nome, valor_atual,
        fonte_origem, auditoria_id, confiabilidade_origem, aceito_em, aceito_por, motivo
      )
      VALUES (
        'barragem', p_barragem_id, 'empreendedor_id', v_emp.id,
        'Administra:Conciliacao', p_auditoria_id, 'comprovada', v_now, v_actor_uid, left(v_just, 250)
      )
      ON CONFLICT (entidade_tipo, entidade_id, campo_nome)
      DO UPDATE SET
        valor_atual = EXCLUDED.valor_atual,
        fonte_origem = EXCLUDED.fonte_origem,
        auditoria_id = EXCLUDED.auditoria_id,
        confiabilidade_origem = EXCLUDED.confiabilidade_origem,
        aceito_em = EXCLUDED.aceito_em,
        aceito_por = EXCLUDED.aceito_por,
        motivo = EXCLUDED.motivo;

      IF p_vincular_car_da_sema AND v_sema_car IS NOT NULL THEN
        INSERT INTO public.entidade_campo_proveniencia (
          entidade_tipo, entidade_id, campo_nome, valor_atual,
          fonte_origem, auditoria_id, confiabilidade_origem, aceito_em, aceito_por, motivo
        )
        VALUES (
          'barragem', p_barragem_id, 'car', v_sema_car,
          'SEMA-MT', p_auditoria_id, 'comprovada', v_now, v_actor_uid, left(v_just, 250)
        )
        ON CONFLICT (entidade_tipo, entidade_id, campo_nome)
        DO UPDATE SET
          valor_atual = EXCLUDED.valor_atual,
          fonte_origem = EXCLUDED.fonte_origem,
          auditoria_id = EXCLUDED.auditoria_id,
          confiabilidade_origem = EXCLUDED.confiabilidade_origem,
          aceito_em = EXCLUDED.aceito_em,
          aceito_por = EXCLUDED.aceito_por,
          motivo = EXCLUDED.motivo;
      END IF;

    ELSE
      -- p_alvo_tipo = 'barragem_rt_parecer'
      IF NULLIF(btrim(coalesce(p_selected_rt_id, '')), '') IS NULL
         OR NULLIF(btrim(coalesce(p_selected_rt_art, '')), '') IS NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'http_status', 400,
          'error', 'RT e número da ART/RRT são obrigatórios para vínculo técnico.'
        );
      END IF;

      SELECT r.id, r.nome, r.updated_at
      INTO v_rt_id, v_rt_nome, v_rt_updated_at
      FROM public.rts r
      WHERE r.id = p_selected_rt_id
      FOR UPDATE;

      IF NOT FOUND AND p_selected_rt_id LIKE 'rt_%' THEN
        v_rt_link_pk := substring(p_selected_rt_id from 4);
        SELECT COALESCE(NULLIF(btrim(l.rt_id), ''), p_selected_rt_id), l.nome, l.updated_at
        INTO v_rt_id, v_rt_nome, v_rt_updated_at
        FROM public.responsaveis_tecnicos_barragens l
        WHERE l.id = v_rt_link_pk OR l.rt_id = p_selected_rt_id
        LIMIT 1
        FOR UPDATE;
      END IF;

      IF v_rt_id IS NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'http_status', 404,
          'error', 'Responsável Técnico selecionado não encontrado no cadastro mestre.'
        );
      END IF;

      IF NULLIF(btrim(coalesce(p_selected_rt_updated_at_snapshot, '')), '') IS NOT NULL
         AND v_rt_updated_at IS NOT NULL
         AND abs(extract(epoch FROM (v_rt_updated_at - p_selected_rt_updated_at_snapshot::timestamptz))) > 0.002 THEN
        RETURN jsonb_build_object(
          'success', false,
          'http_status', 409,
          'error', 'Conflito de concorrência: o cadastro do Responsável Técnico foi atualizado por outro usuário durante a revisão.'
        );
      END IF;

      v_link_id := 'vinc_' || replace(gen_random_uuid()::text, '-', '');
      INSERT INTO public.responsaveis_tecnicos_barragens (
        id,
        rt_id,
        nome,
        art,
        art_rrt,
        barragem_id,
        barragem_vinculada,
        nome_barragem,
        situacao,
        processo,
        parecer_origem_id,
        observacoes,
        created_by,
        updated_by,
        created_at,
        updated_at
      )
      VALUES (
        v_link_id,
        v_rt_id,
        v_rt_nome,
        btrim(p_selected_rt_art),
        btrim(p_selected_rt_art),
        v_dam.id,
        v_dam.id,
        v_dam.nome,
        'Ativo',
        v_dam.processo,
        COALESCE(NULLIF(btrim(coalesce(p_audit_payload->'evidencias'->>'parecerDocumento', '')), ''), 'ADMINISTRA:CONCILIACAO'),
        'Conciliação de Parecer: ' || v_just,
        v_actor_uid_text,
        v_actor_uid_text,
        v_now,
        v_now
      );

      IF EXISTS (SELECT 1 FROM public.rts r WHERE r.id = v_rt_id) THEN
        UPDATE public.rts
        SET updated_by = v_actor_uid_text,
            updated_at = v_now
        WHERE id = v_rt_id;
      END IF;

      UPDATE public.barragens
      SET updated_by = v_actor_uid_text,
          updated_at = v_now
      WHERE id = p_barragem_id;
    END IF;
  END IF;

  -- 5. Registro obrigatório e inseparável da auditoria em `public.revisoes` na mesma transação
  v_new_rev_id := 'rev_' || replace(gen_random_uuid()::text, '-', '');
  v_rev_situacao := CASE
    WHEN p_acao = 'vincular' OR p_classificacao IN ('confirmado_usuario', 'nao_e_divergencia') THEN 'Conciliado'
    WHEN p_acao = 'rejeitar' THEN 'Rejeitado'
    ELSE 'Pendente'
  END;

  v_rev_tipo := CASE
    WHEN p_alvo_tipo = 'barragem_rt_parecer' THEN 'Conciliação RT x Parecer'
    ELSE 'Conciliação Barragem x Empreendedor'
  END;

  v_class_label := CASE p_classificacao
    WHEN 'sem_correspondencia' THEN 'Sem correspondência'
    WHEN 'candidato' THEN 'Candidato'
    WHEN 'ambiguo' THEN 'Ambíguo'
    WHEN 'possivel_erro_grafia' THEN 'Possível erro de grafia'
    WHEN 'papeis_diferentes' THEN 'Papéis diferentes'
    WHEN 'vinculo_ausente' THEN 'Vínculo ausente'
    WHEN 'confirmado_usuario' THEN 'Confirmado por usuário'
    ELSE 'Não é divergência'
  END;

  v_acao_label := CASE p_acao
    WHEN 'vincular' THEN 'Vincular no cadastro mestre'
    WHEN 'rejeitar' THEN 'Rejeitar sugestão'
    ELSE 'Encaminhar para análise'
  END;

  v_valor_ant := COALESCE(NULLIF(btrim(coalesce(p_audit_payload->>'valorAnterior', '')), ''), 'Sem vínculo');
  v_valor_prop := COALESCE(NULLIF(btrim(coalesce(p_audit_payload->>'valorProposto', '')), ''), 'Mantido sem vínculo');

  v_rev_identificador := COALESCE(NULLIF(btrim(v_dam.nome), ''), 'Barragem sem nome') || ' (' || v_dam.id || ')';
  v_rev_origem_a := CASE
    WHEN NULLIF(btrim(v_dam.processo), '') IS NOT NULL THEN 'Processo ' || btrim(v_dam.processo)
    ELSE 'Dados do Processo / Administra'
  END;
  v_rev_origem_b := CASE
    WHEN COALESCE((p_audit_payload->'evidencias'->>'semaConsultada')::boolean, false) THEN
      'SEMA/MT (' || COALESCE(NULLIF(btrim(p_audit_payload->'evidencias'->>'semaCamada'), ''), 'Geoportal') || ')'
    ELSE 'Conferência manual cadastral'
  END;
  v_rev_divergencias := format(
    '[%s] %s · Anterior: %s → Proposto: %s · Justificativa: %s',
    v_class_label, v_acao_label, v_valor_ant, v_valor_prop, v_just
  );

  INSERT INTO public.revisoes (
    id,
    tipo,
    identificador,
    origem_a,
    origem_b,
    divergencias,
    situacao,
    decisao,
    responsavel,
    created_by,
    updated_by,
    created_at,
    updated_at
  )
  VALUES (
    v_new_rev_id,
    v_rev_tipo,
    v_rev_identificador,
    v_rev_origem_a,
    v_rev_origem_b,
    v_rev_divergencias,
    v_rev_situacao,
    COALESCE(p_audit_payload, '{}'::jsonb)::text,
    COALESCE(v_u_nome, v_actor_login),
    v_actor_uid_text,
    v_actor_uid_text,
    v_now,
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'http_status', 200,
    'revisao_id', v_new_rev_id,
    'updated_at', v_now
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'http_status', 500,
      'error', 'Transação revertida (nenhum dado mestre alterado): ' || SQLERRM
    );
END;
$$;

REVOKE ALL ON FUNCTION public.executar_conciliacao_assistida(
  text, text, text, text, text, text, text, text, text, text, text, uuid, boolean, text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.executar_conciliacao_assistida(
  text, text, text, text, text, text, text, text, text, text, text, uuid, boolean, text, uuid, text, text, jsonb
) TO service_role;
