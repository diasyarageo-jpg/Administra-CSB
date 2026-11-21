-- ============================================================================
-- MÓDULO: SOLICITAÇÕES DE VISTORIA (ADMINISTRA — PROPRIETÁRIO CENTRAL)
-- Arquivo SQL exclusivamente para revisão. NÃO executar automaticamente.
-- ============================================================================
-- Este script define:
--   1. Tabela principal `public.solicitacoes_vistoria`
--   2. Tabela imutável de auditoria `public.solicitacoes_vistoria_historico`
--   3. Índices de consulta e filtros
--   4. RLS estrito sem políticas para anon/authenticated (acesso exclusivo via service_role)
--   5. Funções auxiliares de validação anti-CPF/CNPJ e allowlist de pré-preenchimento
--   6. Funções RPC transacionais (SECURITY DEFINER, search_path fixo, execução apenas service_role)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FUNÇÕES AUXILIARES DE VALIDAÇÃO (PRIVACIDADE E ALLOWLIST)
-- ----------------------------------------------------------------------------
-- Verifica se um texto contém padrões de CPF ou CNPJ (com ou sem pontuação).
CREATE OR REPLACE FUNCTION public._sv_contem_cpf_cnpj(p_texto text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_texto IS NULL OR btrim(p_texto) = '' THEN false
    WHEN p_texto ~ '\m\d{3}\.\d{3}\.\d{3}-\d{2}\M' THEN true
    WHEN p_texto ~ '\m\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\M' THEN true
    WHEN p_texto ~ '(^|[^0-9a-zA-Z])\d{14}([^0-9a-zA-Z]|$)' THEN true
    WHEN p_texto ~ '(^|[^0-9a-zA-Z])\d{11}([^0-9a-zA-Z]|$)' THEN true
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public._sv_contem_cpf_cnpj(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sv_contem_cpf_cnpj(text) TO service_role;

-- Valida que `dados_pre_preenchidos` contém apenas chaves permitidas e nenhum CPF/CNPJ.
-- Chaves permitidas: nome_barragem, municipio, curso_agua, coordenadas, uso,
--                    classificacao, nome_empreendedor.
CREATE OR REPLACE FUNCTION public._sv_validar_dados_pre_preenchidos(p_dados jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key text;
  v_val jsonb;
  v_allowed_keys text[] := ARRAY[
    'nome_barragem',
    'municipio',
    'curso_agua',
    'coordenadas',
    'uso',
    'classificacao',
    'nome_empreendedor'
  ];
BEGIN
  IF p_dados IS NULL THEN
    RETURN true;
  END IF;

  IF jsonb_typeof(p_dados) <> 'object' THEN
    RETURN false;
  END IF;

  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_dados)
  LOOP
    IF NOT (v_key = ANY (v_allowed_keys)) THEN
      RETURN false;
    END IF;

    IF jsonb_typeof(v_val) IN ('object', 'array') THEN
      RETURN false;
    END IF;

    IF v_val IS NOT NULL AND jsonb_typeof(v_val) = 'string' THEN
      IF public._sv_contem_cpf_cnpj(v_val #>> '{}') THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._sv_validar_dados_pre_preenchidos(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sv_validar_dados_pre_preenchidos(jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. TABELA PRINCIPAL: public.solicitacoes_vistoria
-- ----------------------------------------------------------------------------
-- Nota: `empreendedor_id` e `barragem_id` usam `text` conforme o padrão
-- existente nas tabelas `public.empreendedores(id)` e `public.barragens(id)`.
CREATE TABLE IF NOT EXISTS public.solicitacoes_vistoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sistema_origem text NOT NULL
    CHECK (sistema_origem IN ('classifica', 'notifica', 'administra')),
  origem_ref_id text NULL,
  solicitante_id uuid NOT NULL,
  solicitante_nome text NULL,
  solicitante_perfil text NULL,
  relato text NOT NULL
    CHECK (char_length(btrim(relato)) >= 3 AND char_length(relato) <= 1000),
  empreendedor_id text NULL,
  barragem_id text NULL,
  processo_referencia text NULL,
  dados_pre_preenchidos jsonb NULL
    CHECK (public._sv_validar_dados_pre_preenchidos(dados_pre_preenchidos)),
  status text NOT NULL DEFAULT 'solicitada'
    CHECK (status IN ('solicitada', 'em_planejamento', 'realizada', 'cancelada')),
  vistoria_id text NULL,
  data_realizacao timestamptz NULL,
  equipe jsonb NULL
    CHECK (equipe IS NULL OR jsonb_typeof(equipe) = 'array'),
  observacao_campo text NULL
    CHECK (observacao_campo IS NULL OR char_length(observacao_campo) <= 1000),
  observacao_atualizada_em timestamptz NULL,
  observacao_atualizada_por uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_vistoria_status_data
  ON public.solicitacoes_vistoria (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_vistoria_origem_data
  ON public.solicitacoes_vistoria (sistema_origem, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_vistoria_solicitante
  ON public.solicitacoes_vistoria (solicitante_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_vistoria_barragem
  ON public.solicitacoes_vistoria (barragem_id)
  WHERE barragem_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_solicitacoes_vistoria_empreendedor
  ON public.solicitacoes_vistoria (empreendedor_id)
  WHERE empreendedor_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. TABELA DE HISTÓRICO (SOMENTE LEITURA E INCLUSÃO): solicitacoes_vistoria_historico
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.solicitacoes_vistoria_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL
    REFERENCES public.solicitacoes_vistoria(id) ON DELETE CASCADE,
  acao text NOT NULL
    CHECK (acao IN ('criacao', 'atualizacao', 'cancelamento', 'conclusao', 'edicao_observacao')),
  campo text NULL,
  valor_anterior text NULL,
  valor_novo text NULL,
  usuario_id uuid NOT NULL,
  motivo text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_vistoria_hist_solic_data
  ON public.solicitacoes_vistoria_historico (solicitacao_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. RLS ESTRITO (ACESSO SOMENTE PELO SERVIDOR COM SERVICE_ROLE)
-- ----------------------------------------------------------------------------
-- Nenhuma política é criada para `anon` ou `authenticated`; com RLS ligado e
-- privilégios revogados, clientes de navegador nunca acessam as tabelas direto.
ALTER TABLE public.solicitacoes_vistoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes_vistoria_historico ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.solicitacoes_vistoria FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.solicitacoes_vistoria_historico FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.solicitacoes_vistoria TO service_role;
GRANT SELECT, INSERT ON TABLE public.solicitacoes_vistoria_historico TO service_role;

-- ----------------------------------------------------------------------------
-- 5. FUNÇÕES RPC TRANSACIONAIS (SOLICITAÇÃO + HISTÓRICO NA MESMA TRANSAÇÃO)
-- ----------------------------------------------------------------------------

-- 5.1) criar_solicitacao_vistoria
-- Cria nova solicitação em status 'solicitada' e grava evento 'criacao' no histórico.
CREATE OR REPLACE FUNCTION public.criar_solicitacao_vistoria(
  p_sistema_origem text,
  p_origem_ref_id text,
  p_solicitante_id uuid,
  p_solicitante_nome text,
  p_solicitante_perfil text,
  p_relato text,
  p_empreendedor_id text DEFAULT NULL,
  p_barragem_id text DEFAULT NULL,
  p_processo_referencia text DEFAULT NULL,
  p_dados_pre_preenchidos jsonb DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS public.solicitacoes_vistoria
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now timestamptz := now();
  v_relato text := btrim(COALESCE(p_relato, ''));
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_row public.solicitacoes_vistoria;
BEGIN
  IF p_sistema_origem IS NULL OR p_sistema_origem NOT IN ('classifica', 'notifica', 'administra') THEN
    RAISE EXCEPTION 'sistema_origem inválido para solicitação de vistoria.';
  END IF;

  IF p_solicitante_id IS NULL THEN
    RAISE EXCEPTION 'solicitante_id é obrigatório.';
  END IF;

  IF char_length(v_relato) < 3 OR char_length(v_relato) > 1000 THEN
    RAISE EXCEPTION 'O relato deve ter entre 3 e 1000 caracteres.';
  END IF;

  IF public._sv_contem_cpf_cnpj(v_relato)
     OR public._sv_contem_cpf_cnpj(p_origem_ref_id)
     OR public._sv_contem_cpf_cnpj(p_processo_referencia)
     OR public._sv_contem_cpf_cnpj(p_empreendedor_id)
     OR public._sv_contem_cpf_cnpj(p_barragem_id)
     OR public._sv_contem_cpf_cnpj(v_motivo) THEN
    RAISE EXCEPTION 'Não é permitido gravar CPF/CNPJ em solicitações de vistoria.';
  END IF;

  IF NOT public._sv_validar_dados_pre_preenchidos(p_dados_pre_preenchidos) THEN
    RAISE EXCEPTION 'dados_pre_preenchidos contém campos não permitidos ou documento pessoal.';
  END IF;

  INSERT INTO public.solicitacoes_vistoria (
    sistema_origem,
    origem_ref_id,
    solicitante_id,
    solicitante_nome,
    solicitante_perfil,
    relato,
    empreendedor_id,
    barragem_id,
    processo_referencia,
    dados_pre_preenchidos,
    status,
    created_at,
    updated_at
  )
  VALUES (
    p_sistema_origem,
    NULLIF(btrim(COALESCE(p_origem_ref_id, '')), ''),
    p_solicitante_id,
    NULLIF(btrim(COALESCE(p_solicitante_nome, '')), ''),
    NULLIF(btrim(COALESCE(p_solicitante_perfil, '')), ''),
    v_relato,
    NULLIF(btrim(COALESCE(p_empreendedor_id, '')), ''),
    NULLIF(btrim(COALESCE(p_barragem_id, '')), ''),
    NULLIF(btrim(COALESCE(p_processo_referencia, '')), ''),
    p_dados_pre_preenchidos,
    'solicitada',
    v_now,
    v_now
  )
  RETURNING * INTO v_row;

  INSERT INTO public.solicitacoes_vistoria_historico (
    solicitacao_id,
    acao,
    campo,
    valor_anterior,
    valor_novo,
    usuario_id,
    motivo,
    created_at
  )
  VALUES (
    v_row.id,
    'criacao',
    'status',
    NULL,
    'solicitada',
    p_solicitante_id,
    COALESCE(v_motivo, 'Criação da solicitação de vistoria'),
    v_now
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_solicitacao_vistoria(
  text, text, uuid, text, text, text, text, text, text, jsonb, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.criar_solicitacao_vistoria(
  text, text, uuid, text, text, text, text, text, text, jsonb, text
) TO service_role;

-- 5.2) atualizar_solicitacao_vistoria
-- Atualiza apenas campos permitidos enquanto não realizada/cancelada e registra histórico por campo.
CREATE OR REPLACE FUNCTION public.atualizar_solicitacao_vistoria(
  p_id uuid,
  p_campos jsonb,
  p_usuario_id uuid,
  p_motivo text DEFAULT NULL
)
RETURNS public.solicitacoes_vistoria
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now timestamptz := now();
  v_cur public.solicitacoes_vistoria;
  v_upd public.solicitacoes_vistoria;
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_key text;
  v_allowed_keys text[] := ARRAY[
    'relato',
    'empreendedor_id',
    'barragem_id',
    'processo_referencia',
    'origem_ref_id',
    'dados_pre_preenchidos',
    'status'
  ];
  v_new_relato text;
  v_new_emp text;
  v_new_bar text;
  v_new_proc text;
  v_new_origem_ref text;
  v_new_dados jsonb;
  v_new_status text;
  v_changed boolean := false;
BEGIN
  IF p_id IS NULL OR p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Identificador da solicitação e usuário são obrigatórios.';
  END IF;

  IF p_campos IS NULL OR jsonb_typeof(p_campos) <> 'object' THEN
    RAISE EXCEPTION 'p_campos deve ser um objeto JSON válido.';
  END IF;

  IF v_motivo IS NOT NULL AND public._sv_contem_cpf_cnpj(v_motivo) THEN
    RAISE EXCEPTION 'Não é permitido gravar CPF/CNPJ no motivo.';
  END IF;

  FOR v_key IN SELECT k FROM jsonb_object_keys(p_campos) AS k
  LOOP
    IF NOT (v_key = ANY (v_allowed_keys)) THEN
      RAISE EXCEPTION 'Campo "%" não permitido para atualização.', v_key;
    END IF;
  END LOOP;

  SELECT * INTO v_cur
  FROM public.solicitacoes_vistoria
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de vistoria não encontrada.';
  END IF;

  IF v_cur.status IN ('realizada', 'cancelada') THEN
    RAISE EXCEPTION 'Não é permitido editar solicitação com status "%".', v_cur.status;
  END IF;

  v_new_relato := CASE
    WHEN p_campos ? 'relato' THEN btrim(COALESCE(p_campos ->> 'relato', ''))
    ELSE v_cur.relato
  END;
  IF char_length(v_new_relato) < 3 OR char_length(v_new_relato) > 1000 THEN
    RAISE EXCEPTION 'O relato deve ter entre 3 e 1000 caracteres.';
  END IF;
  IF public._sv_contem_cpf_cnpj(v_new_relato) THEN
    RAISE EXCEPTION 'Não é permitido gravar CPF/CNPJ no relato.';
  END IF;

  v_new_emp := CASE
    WHEN p_campos ? 'empreendedor_id' THEN NULLIF(btrim(COALESCE(p_campos ->> 'empreendedor_id', '')), '')
    ELSE v_cur.empreendedor_id
  END;
  v_new_bar := CASE
    WHEN p_campos ? 'barragem_id' THEN NULLIF(btrim(COALESCE(p_campos ->> 'barragem_id', '')), '')
    ELSE v_cur.barragem_id
  END;
  v_new_proc := CASE
    WHEN p_campos ? 'processo_referencia' THEN NULLIF(btrim(COALESCE(p_campos ->> 'processo_referencia', '')), '')
    ELSE v_cur.processo_referencia
  END;
  v_new_origem_ref := CASE
    WHEN p_campos ? 'origem_ref_id' THEN NULLIF(btrim(COALESCE(p_campos ->> 'origem_ref_id', '')), '')
    ELSE v_cur.origem_ref_id
  END;

  IF public._sv_contem_cpf_cnpj(v_new_emp)
     OR public._sv_contem_cpf_cnpj(v_new_bar)
     OR public._sv_contem_cpf_cnpj(v_new_proc)
     OR public._sv_contem_cpf_cnpj(v_new_origem_ref) THEN
    RAISE EXCEPTION 'Não é permitido gravar CPF/CNPJ nas referências.';
  END IF;

  v_new_dados := CASE
    WHEN p_campos ? 'dados_pre_preenchidos' THEN p_campos -> 'dados_pre_preenchidos'
    ELSE v_cur.dados_pre_preenchidos
  END;
  IF v_new_dados = 'null'::jsonb THEN
    v_new_dados := NULL;
  END IF;
  IF NOT public._sv_validar_dados_pre_preenchidos(v_new_dados) THEN
    RAISE EXCEPTION 'dados_pre_preenchidos contém campos não permitidos ou documento pessoal.';
  END IF;

  v_new_status := CASE
    WHEN p_campos ? 'status' THEN lower(btrim(COALESCE(p_campos ->> 'status', '')))
    ELSE v_cur.status
  END;
  IF v_new_status NOT IN ('solicitada', 'em_planejamento') THEN
    RAISE EXCEPTION 'Status "%" não permitido nesta operação.', v_new_status;
  END IF;

  UPDATE public.solicitacoes_vistoria
  SET
    relato = v_new_relato,
    empreendedor_id = v_new_emp,
    barragem_id = v_new_bar,
    processo_referencia = v_new_proc,
    origem_ref_id = v_new_origem_ref,
    dados_pre_preenchidos = v_new_dados,
    status = v_new_status,
    updated_at = v_now
  WHERE id = p_id
  RETURNING * INTO v_upd;

  IF v_new_relato IS DISTINCT FROM v_cur.relato THEN
    v_changed := true;
    INSERT INTO public.solicitacoes_vistoria_historico (
      solicitacao_id, acao, campo, valor_anterior, valor_novo, usuario_id, motivo, created_at
    ) VALUES (
      p_id, 'atualizacao', 'relato', v_cur.relato, v_new_relato, p_usuario_id,
      COALESCE(v_motivo, 'Atualização do relato'), v_now
    );
  END IF;

  IF v_new_emp IS DISTINCT FROM v_cur.empreendedor_id THEN
    v_changed := true;
    INSERT INTO public.solicitacoes_vistoria_historico (
      solicitacao_id, acao, campo, valor_anterior, valor_novo, usuario_id, motivo, created_at
    ) VALUES (
      p_id, 'atualizacao', 'empreendedor_id', v_cur.empreendedor_id, v_new_emp, p_usuario_id,
      COALESCE(v_motivo, 'Atualização de empreendedor'), v_now
    );
  END IF;

  IF v_new_bar IS DISTINCT FROM v_cur.barragem_id THEN
    v_changed := true;
    INSERT INTO public.solicitacoes_vistoria_historico (
      solicitacao_id, acao, campo, valor_anterior, valor_novo, usuario_id, motivo, created_at
    ) VALUES (
      p_id, 'atualizacao', 'barragem_id', v_cur.barragem_id, v_new_bar, p_usuario_id,
      COALESCE(v_motivo, 'Atualização de barragem'), v_now
    );
  END IF;

  IF v_new_proc IS DISTINCT FROM v_cur.processo_referencia THEN
    v_changed := true;
    INSERT INTO public.solicitacoes_vistoria_historico (
      solicitacao_id, acao, campo, valor_anterior, valor_novo, usuario_id, motivo, created_at
    ) VALUES (
      p_id, 'atualizacao', 'processo_referencia', v_cur.processo_referencia, v_new_proc, p_usuario_id,
      COALESCE(v_motivo, 'Atualização de processo'), v_now
    );
  END IF;

  IF v_new_origem_ref IS DISTINCT FROM v_cur.origem_ref_id THEN
    v_changed := true;
    INSERT INTO public.solicitacoes_vistoria_historico (
      solicitacao_id, acao, campo, valor_anterior, valor_novo, usuario_id, motivo, created_at
    ) VALUES (
      p_id, 'atualizacao', 'origem_ref_id', v_cur.origem_ref_id, v_new_origem_ref, p_usuario_id,
      COALESCE(v_motivo, 'Atualização de referência de origem'), v_now
    );
  END IF;

  IF v_new_dados IS DISTINCT FROM v_cur.dados_pre_preenchidos THEN
    v_changed := true;
    INSERT INTO public.solicitacoes_vistoria_historico (
      solicitacao_id, acao, campo, valor_anterior, valor_novo, usuario_id, motivo, created_at
    ) VALUES (
      p_id, 'atualizacao', 'dados_pre_preenchidos',
      COALESCE(v_cur.dados_pre_preenchidos::text, NULL),
      COALESCE(v_new_dados::text, NULL),
      p_usuario_id,
      COALESCE(v_motivo, 'Atualização de dados pré-preenchidos'), v_now
    );
  END IF;

  IF v_new_status IS DISTINCT FROM v_cur.status THEN
    v_changed := true;
    INSERT INTO public.solicitacoes_vistoria_historico (
      solicitacao_id, acao, campo, valor_anterior, valor_novo, usuario_id, motivo, created_at
    ) VALUES (
      p_id, 'atualizacao', 'status', v_cur.status, v_new_status, p_usuario_id,
      COALESCE(v_motivo, 'Atualização de status'), v_now
    );
  END IF;

  IF NOT v_changed AND v_motivo IS NOT NULL THEN
    INSERT INTO public.solicitacoes_vistoria_historico (
      solicitacao_id, acao, campo, valor_anterior, valor_novo, usuario_id, motivo, created_at
    ) VALUES (
      p_id, 'atualizacao', NULL, NULL, NULL, p_usuario_id, v_motivo, v_now
    );
  END IF;

  RETURN v_upd;
END;
$$;

REVOKE ALL ON FUNCTION public.atualizar_solicitacao_vistoria(uuid, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atualizar_solicitacao_vistoria(uuid, jsonb, uuid, text)
  TO service_role;

-- 5.3) cancelar_solicitacao_vistoria
-- Altera o status para 'cancelada' e grava evento 'cancelamento' no histórico.
CREATE OR REPLACE FUNCTION public.cancelar_solicitacao_vistoria(
  p_id uuid,
  p_usuario_id uuid,
  p_motivo text
)
RETURNS public.solicitacoes_vistoria
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now timestamptz := now();
  v_cur public.solicitacoes_vistoria;
  v_upd public.solicitacoes_vistoria;
  v_motivo text := btrim(COALESCE(p_motivo, ''));
BEGIN
  IF p_id IS NULL OR p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Identificador da solicitação e usuário são obrigatórios.';
  END IF;

  IF char_length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento (mínimo 3 caracteres).';
  END IF;

  IF public._sv_contem_cpf_cnpj(v_motivo) THEN
    RAISE EXCEPTION 'Não é permitido gravar CPF/CNPJ no motivo do cancelamento.';
  END IF;

  SELECT * INTO v_cur
  FROM public.solicitacoes_vistoria
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de vistoria não encontrada.';
  END IF;

  IF v_cur.status = 'cancelada' THEN
    RAISE EXCEPTION 'Solicitação já se encontra cancelada.';
  END IF;

  IF v_cur.status = 'realizada' THEN
    RAISE EXCEPTION 'Não é possível cancelar uma solicitação já realizada.';
  END IF;

  UPDATE public.solicitacoes_vistoria
  SET
    status = 'cancelada',
    updated_at = v_now
  WHERE id = p_id
  RETURNING * INTO v_upd;

  INSERT INTO public.solicitacoes_vistoria_historico (
    solicitacao_id,
    acao,
    campo,
    valor_anterior,
    valor_novo,
    usuario_id,
    motivo,
    created_at
  )
  VALUES (
    p_id,
    'cancelamento',
    'status',
    v_cur.status,
    'cancelada',
    p_usuario_id,
    v_motivo,
    v_now
  );

  RETURN v_upd;
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_solicitacao_vistoria(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_solicitacao_vistoria(uuid, uuid, text)
  TO service_role;

-- 5.4) concluir_solicitacao_vistoria
-- Conclui a solicitação como 'realizada', grava vistoria_id, data_realizacao, equipe e
-- observacao_campo opcional, registrando tudo no histórico na mesma transação.
CREATE OR REPLACE FUNCTION public.concluir_solicitacao_vistoria(
  p_id uuid,
  p_vistoria_id text,
  p_data_realizacao timestamptz,
  p_equipe jsonb,
  p_observacao_campo text DEFAULT NULL,
  p_usuario_id uuid DEFAULT NULL
)
RETURNS public.solicitacoes_vistoria
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now timestamptz := now();
  v_cur public.solicitacoes_vistoria;
  v_upd public.solicitacoes_vistoria;
  v_vistoria_id text := btrim(COALESCE(p_vistoria_id, ''));
  v_obs text := NULLIF(btrim(COALESCE(p_observacao_campo, '')), '');
  v_item jsonb;
BEGIN
  IF p_id IS NULL OR p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Identificador da solicitação e usuário são obrigatórios.';
  END IF;

  IF v_vistoria_id = '' OR public._sv_contem_cpf_cnpj(v_vistoria_id) THEN
    RAISE EXCEPTION 'vistoria_id inválido ou contendo documento pessoal.';
  END IF;

  IF p_data_realizacao IS NULL THEN
    RAISE EXCEPTION 'data_realizacao é obrigatória.';
  END IF;

  IF p_equipe IS NULL OR jsonb_typeof(p_equipe) <> 'array' OR jsonb_array_length(p_equipe) = 0 THEN
    RAISE EXCEPTION 'equipe deve ser uma lista não vazia de integrantes {id, nome}.';
  END IF;

  FOR v_item IN SELECT elem FROM jsonb_array_elements(p_equipe) AS elem
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR NULLIF(btrim(COALESCE(v_item ->> 'id', '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(v_item ->> 'nome', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Cada integrante da equipe deve conter id e nome válidos.';
    END IF;
    IF public._sv_contem_cpf_cnpj(v_item ->> 'id')
       OR public._sv_contem_cpf_cnpj(v_item ->> 'nome') THEN
      RAISE EXCEPTION 'Não é permitido gravar CPF/CNPJ nos dados da equipe.';
    END IF;
  END LOOP;

  IF v_obs IS NOT NULL THEN
    IF char_length(v_obs) > 1000 THEN
      RAISE EXCEPTION 'observacao_campo não pode exceder 1000 caracteres.';
    END IF;
    IF public._sv_contem_cpf_cnpj(v_obs) THEN
      RAISE EXCEPTION 'Não é permitido gravar CPF/CNPJ na observação de campo.';
    END IF;
  END IF;

  SELECT * INTO v_cur
  FROM public.solicitacoes_vistoria
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de vistoria não encontrada.';
  END IF;

  IF v_cur.status = 'cancelada' THEN
    RAISE EXCEPTION 'Não é possível concluir uma solicitação cancelada.';
  END IF;

  UPDATE public.solicitacoes_vistoria
  SET
    status = 'realizada',
    vistoria_id = v_vistoria_id,
    data_realizacao = p_data_realizacao,
    equipe = p_equipe,
    observacao_campo = COALESCE(v_obs, v_cur.observacao_campo),
    observacao_atualizada_em = CASE WHEN v_obs IS NOT NULL THEN v_now ELSE v_cur.observacao_atualizada_em END,
    observacao_atualizada_por = CASE WHEN v_obs IS NOT NULL THEN p_usuario_id ELSE v_cur.observacao_atualizada_por END,
    updated_at = v_now
  WHERE id = p_id
  RETURNING * INTO v_upd;

  INSERT INTO public.solicitacoes_vistoria_historico (
    solicitacao_id,
    acao,
    campo,
    valor_anterior,
    valor_novo,
    usuario_id,
    motivo,
    created_at
  )
  VALUES (
    p_id,
    'conclusao',
    'status',
    v_cur.status,
    'realizada',
    p_usuario_id,
    'Conclusão da vistoria (' || v_vistoria_id || ')',
    v_now
  );

  IF v_obs IS NOT NULL AND v_obs IS DISTINCT FROM v_cur.observacao_campo THEN
    INSERT INTO public.solicitacoes_vistoria_historico (
      solicitacao_id,
      acao,
      campo,
      valor_anterior,
      valor_novo,
      usuario_id,
      motivo,
      created_at
    )
    VALUES (
      p_id,
      'conclusao',
      'observacao_campo',
      v_cur.observacao_campo,
      v_obs,
      p_usuario_id,
      'Observação registrada na conclusão',
      v_now
    );
  END IF;

  RETURN v_upd;
END;
$$;

REVOKE ALL ON FUNCTION public.concluir_solicitacao_vistoria(
  uuid, text, timestamptz, jsonb, text, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.concluir_solicitacao_vistoria(
  uuid, text, timestamptz, jsonb, text, uuid
) TO service_role;

-- 5.5) editar_observacao_campo
-- Altera SOMENTE observacao_campo e seus metadados (observacao_atualizada_em,
-- observacao_atualizada_por e updated_at). NUNCA altera data_realizacao nem status.
CREATE OR REPLACE FUNCTION public.editar_observacao_campo(
  p_id uuid,
  p_texto text,
  p_usuario_id uuid
)
RETURNS public.solicitacoes_vistoria
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now timestamptz := now();
  v_cur public.solicitacoes_vistoria;
  v_upd public.solicitacoes_vistoria;
  v_texto text := btrim(COALESCE(p_texto, ''));
BEGIN
  IF p_id IS NULL OR p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Identificador da solicitação e usuário são obrigatórios.';
  END IF;

  IF char_length(v_texto) < 1 OR char_length(v_texto) > 1000 THEN
    RAISE EXCEPTION 'A observação de campo deve ter entre 1 e 1000 caracteres.';
  END IF;

  IF public._sv_contem_cpf_cnpj(v_texto) THEN
    RAISE EXCEPTION 'Não é permitido gravar CPF/CNPJ na observação de campo.';
  END IF;

  SELECT * INTO v_cur
  FROM public.solicitacoes_vistoria
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de vistoria não encontrada.';
  END IF;

  IF v_cur.status = 'cancelada' THEN
    RAISE EXCEPTION 'Não é possível editar observação de solicitação cancelada.';
  END IF;

  UPDATE public.solicitacoes_vistoria
  SET
    observacao_campo = v_texto,
    observacao_atualizada_em = v_now,
    observacao_atualizada_por = p_usuario_id,
    updated_at = v_now
  WHERE id = p_id
  RETURNING * INTO v_upd;

  INSERT INTO public.solicitacoes_vistoria_historico (
    solicitacao_id,
    acao,
    campo,
    valor_anterior,
    valor_novo,
    usuario_id,
    motivo,
    created_at
  )
  VALUES (
    p_id,
    'edicao_observacao',
    'observacao_campo',
    v_cur.observacao_campo,
    v_texto,
    p_usuario_id,
    'Atualização de observação de campo',
    v_now
  );

  RETURN v_upd;
END;
$$;

REVOKE ALL ON FUNCTION public.editar_observacao_campo(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editar_observacao_campo(uuid, text, uuid)
  TO service_role;
