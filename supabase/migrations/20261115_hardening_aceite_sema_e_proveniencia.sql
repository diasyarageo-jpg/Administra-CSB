-- supabase/migrations/20261115_hardening_aceite_sema_e_proveniencia.sql
-- Hardening do fluxo SEMA-MT (auditoria server-side, aceite com allowlist estrita,
-- titularidade transacional, proveniência idempotente e histórico).
-- ATENÇÃO: Script idempotente para execução manual controlada no SQL Editor do Supabase.

-- 1. Tabelas canônicas de auditoria, proveniência, histórico e titularidade vigente
CREATE TABLE IF NOT EXISTS public.sema_consultas_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidade_alvo_tipo text,
  entidade_alvo_id text,
  criterio_tipo text NOT NULL,
  criterio_referencia text,
  camada text NOT NULL,
  feature_id text NOT NULL,
  car text,
  doc_status text,
  doc_sha256 text,
  atributos_recebidos jsonb NOT NULL DEFAULT '{}'::jsonb,
  consultado_em timestamptz NOT NULL DEFAULT now(),
  consultado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS public.sema_consultas_auditoria
  ADD COLUMN IF NOT EXISTS entidade_alvo_tipo text,
  ADD COLUMN IF NOT EXISTS entidade_alvo_id text,
  ADD COLUMN IF NOT EXISTS criterio_tipo text,
  ADD COLUMN IF NOT EXISTS criterio_referencia text,
  ADD COLUMN IF NOT EXISTS camada text,
  ADD COLUMN IF NOT EXISTS feature_id text,
  ADD COLUMN IF NOT EXISTS car text,
  ADD COLUMN IF NOT EXISTS doc_status text,
  ADD COLUMN IF NOT EXISTS doc_sha256 text,
  ADD COLUMN IF NOT EXISTS atributos_recebidos jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS consultado_em timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS consultado_por uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_sema_auditoria_entidade
  ON public.sema_consultas_auditoria (entidade_alvo_tipo, entidade_alvo_id);

CREATE INDEX IF NOT EXISTS idx_sema_auditoria_consultado_por
  ON public.sema_consultas_auditoria (consultado_por, consultado_em DESC);

CREATE TABLE IF NOT EXISTS public.entidade_campo_proveniencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidade_tipo text NOT NULL,
  entidade_id text NOT NULL,
  campo_nome text NOT NULL,
  valor_atual text,
  fonte_origem text NOT NULL DEFAULT 'SEMA-MT',
  camada_origem text,
  feature_id_origem text,
  auditoria_id uuid,
  consultado_em timestamptz,
  aceito_em timestamptz NOT NULL DEFAULT now(),
  aceito_por uuid DEFAULT auth.uid(),
  motivo text,
  UNIQUE (entidade_tipo, entidade_id, campo_nome)
);

ALTER TABLE IF EXISTS public.entidade_campo_proveniencia
  ADD COLUMN IF NOT EXISTS valor_atual text,
  ADD COLUMN IF NOT EXISTS fonte_origem text DEFAULT 'SEMA-MT',
  ADD COLUMN IF NOT EXISTS camada_origem text,
  ADD COLUMN IF NOT EXISTS feature_id_origem text,
  ADD COLUMN IF NOT EXISTS auditoria_id uuid,
  ADD COLUMN IF NOT EXISTS consultado_em timestamptz,
  ADD COLUMN IF NOT EXISTS aceito_em timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS aceito_por uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS motivo text;

CREATE INDEX IF NOT EXISTS idx_entidade_prov_entidade
  ON public.entidade_campo_proveniencia (entidade_tipo, entidade_id);

CREATE TABLE IF NOT EXISTS public.entidade_campo_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidade_tipo text NOT NULL,
  entidade_id text NOT NULL,
  campo_nome text NOT NULL,
  valor_anterior text,
  valor_novo text,
  fonte_origem text NOT NULL DEFAULT 'SEMA-MT',
  camada_origem text,
  feature_id_origem text,
  auditoria_id uuid,
  alterado_em timestamptz NOT NULL DEFAULT now(),
  alterado_por uuid DEFAULT auth.uid(),
  motivo text
);

ALTER TABLE IF EXISTS public.entidade_campo_historico
  ADD COLUMN IF NOT EXISTS valor_anterior text,
  ADD COLUMN IF NOT EXISTS valor_novo text,
  ADD COLUMN IF NOT EXISTS fonte_origem text DEFAULT 'SEMA-MT',
  ADD COLUMN IF NOT EXISTS camada_origem text,
  ADD COLUMN IF NOT EXISTS feature_id_origem text,
  ADD COLUMN IF NOT EXISTS auditoria_id uuid,
  ADD COLUMN IF NOT EXISTS alterado_em timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS alterado_por uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS motivo text;

CREATE INDEX IF NOT EXISTS idx_entidade_hist_entidade
  ON public.entidade_campo_historico (entidade_tipo, entidade_id, alterado_em DESC);

CREATE TABLE IF NOT EXISTS public.empreendedor_barragem_titularidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barragem_id text NOT NULL REFERENCES public.barragens(id) ON DELETE CASCADE,
  empreendedor_id text NOT NULL REFERENCES public.empreendedores(id) ON DELETE RESTRICT,
  vigente boolean NOT NULL DEFAULT true,
  situacao text NOT NULL DEFAULT 'Vigente',
  inicio_em timestamptz NOT NULL DEFAULT now(),
  fim_em timestamptz,
  origem text NOT NULL DEFAULT 'SEMA-MT',
  auditoria_id uuid,
  motivo text,
  aprovado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS public.empreendedor_barragem_titularidade
  ADD COLUMN IF NOT EXISTS vigente boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS situacao text DEFAULT 'Vigente',
  ADD COLUMN IF NOT EXISTS inicio_em timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS fim_em timestamptz,
  ADD COLUMN IF NOT EXISTS origem text DEFAULT 'SEMA-MT',
  ADD COLUMN IF NOT EXISTS auditoria_id uuid,
  ADD COLUMN IF NOT EXISTS motivo text,
  ADD COLUMN IF NOT EXISTS aprovado_por uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_titularidade_barragem_id
  ON public.empreendedor_barragem_titularidade (barragem_id);

CREATE INDEX IF NOT EXISTS idx_titularidade_empreendedor_id
  ON public.empreendedor_barragem_titularidade (empreendedor_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uq_titularidade_barragem_vigente'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.empreendedor_barragem_titularidade
      WHERE vigente = true
      GROUP BY barragem_id
      HAVING COUNT(*) > 1
    ) THEN
      CREATE UNIQUE INDEX uq_titularidade_barragem_vigente
        ON public.empreendedor_barragem_titularidade (barragem_id)
        WHERE vigente = true;
    ELSE
      RAISE NOTICE 'Índice uq_titularidade_barragem_vigente não criado automaticamente porque há múltiplas titularidades vigentes para a mesma barragem.';
    END IF;
  END IF;
END $$;

-- 2. RLS estrita (nenhuma escrita direta do cliente; leitura controlada por papel)
ALTER TABLE public.sema_consultas_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entidade_campo_proveniencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entidade_campo_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empreendedor_barragem_titularidade ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sema_consultas_auditoria FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.entidade_campo_proveniencia FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.entidade_campo_historico FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.empreendedor_barragem_titularidade FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.sema_consultas_auditoria TO authenticated;
GRANT SELECT ON TABLE public.entidade_campo_proveniencia TO authenticated;
GRANT SELECT ON TABLE public.entidade_campo_historico TO authenticated;
GRANT SELECT ON TABLE public.empreendedor_barragem_titularidade TO authenticated;

DROP POLICY IF EXISTS sema_auditoria_insert_editor ON public.sema_consultas_auditoria;
DROP POLICY IF EXISTS sema_auditoria_select_active ON public.sema_consultas_auditoria;
CREATE POLICY sema_auditoria_select_active ON public.sema_consultas_auditoria
  FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.is_admin()
      OR public.get_my_role() = 'Analista'
      OR (public.get_my_role() = 'Usuário' AND consultado_por = auth.uid())
    )
  );

DROP POLICY IF EXISTS entidade_prov_select_active ON public.entidade_campo_proveniencia;
CREATE POLICY entidade_prov_select_active ON public.entidade_campo_proveniencia
  FOR SELECT TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS entidade_hist_select_active ON public.entidade_campo_historico;
CREATE POLICY entidade_hist_select_active ON public.entidade_campo_historico
  FOR SELECT TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS titularidade_select_active ON public.empreendedor_barragem_titularidade;
CREATE POLICY titularidade_select_active ON public.empreendedor_barragem_titularidade
  FOR SELECT TO authenticated
  USING (public.is_active_user());

-- 3. Índice único parcial por CPF/CNPJ ativo (defensivo caso haja legado duplicado)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uq_empreendedores_doc_digits_ativo'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.empreendedores
      WHERE situacao = 'Ativo'
        AND public.norm_digits_only(cpf_cnpj) IS NOT NULL
      GROUP BY public.norm_digits_only(cpf_cnpj)
      HAVING COUNT(*) > 1
    ) THEN
      CREATE UNIQUE INDEX uq_empreendedores_doc_digits_ativo
        ON public.empreendedores (public.norm_digits_only(cpf_cnpj))
        WHERE situacao = 'Ativo' AND public.norm_digits_only(cpf_cnpj) IS NOT NULL;
    ELSE
      RAISE NOTICE 'Índice uq_empreendedores_doc_digits_ativo não criado automaticamente porque há registros ativos com CPF/CNPJ duplicado.';
    END IF;
  END IF;
END $$;

-- 4. RPC exclusiva do servidor (service_role) para registrar auditoria a partir da resposta real do GeoServer
DROP FUNCTION IF EXISTS public.registrar_consulta_sema_auditoria(text, text, text, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.registrar_consulta_sema_auditoria(text, text, text, text, text, text, text, jsonb, uuid, text, text);

CREATE OR REPLACE FUNCTION public.registrar_consulta_sema_auditoria(
  p_entidade_alvo_tipo text DEFAULT NULL,
  p_entidade_alvo_id text DEFAULT NULL,
  p_criterio_tipo text DEFAULT 'car',
  p_criterio_referencia text DEFAULT NULL,
  p_camada text DEFAULT 'Geoportal:CAR_ATP',
  p_feature_id text DEFAULT 'sema_item',
  p_car text DEFAULT NULL,
  p_atributos_recebidos jsonb DEFAULT '{}'::jsonb,
  p_consultado_por uuid DEFAULT NULL,
  p_doc_status text DEFAULT NULL,
  p_doc_sha256 text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_ref text;
  v_attrs_text text;
BEGIN
  IF p_criterio_tipo NOT IN ('car', 'coordenada', 'processo', 'cpf_cnpj_hash', 'nome_exploratorio') THEN
    RAISE EXCEPTION 'Tipo de critério de consulta inválido: %', p_criterio_tipo;
  END IF;

  IF p_entidade_alvo_tipo IS NOT NULL AND p_entidade_alvo_tipo NOT IN ('empreendedor', 'barragem', 'car') THEN
    RAISE EXCEPTION 'Tipo de entidade alvo inválido: %', p_entidade_alvo_tipo;
  END IF;

  IF p_doc_status IS NOT NULL AND p_doc_status NOT IN ('completo', 'mascarado', 'ausente') THEN
    RAISE EXCEPTION 'Status de documento inválido: %', p_doc_status;
  END IF;

  IF p_doc_sha256 IS NOT NULL AND p_doc_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Hash de documento inválido.';
  END IF;

  v_ref := NULLIF(btrim(coalesce(p_criterio_referencia, '')), '');

  IF p_criterio_tipo = 'cpf_cnpj_hash' AND v_ref IS NOT NULL AND v_ref !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Critério cpf_cnpj_hash exige hash SHA-256 e nunca CPF/CNPJ em claro.';
  END IF;

  IF v_ref IS NOT NULL THEN
    IF v_ref ~ '\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}' THEN
      RAISE EXCEPTION 'Referência de critério não pode conter CPF/CNPJ em claro.';
    END IF;
    IF p_criterio_tipo IN ('car', 'coordenada', 'nome_exploratorio')
       AND v_ref ~ '^\d{11}$|^\d{14}$' THEN
      RAISE EXCEPTION 'Referência de critério suspeita de conter CPF/CNPJ em claro.';
    END IF;
  END IF;

  IF p_atributos_recebidos IS NULL OR jsonb_typeof(p_atributos_recebidos) <> 'object' THEN
    RAISE EXCEPTION 'atributos_recebidos deve ser um objeto JSON válido.';
  END IF;

  v_attrs_text := p_atributos_recebidos::text;
  IF v_attrs_text ~ '\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}' THEN
    RAISE EXCEPTION 'atributos_recebidos não pode conter CPF/CNPJ formatado em claro.';
  END IF;

  INSERT INTO public.sema_consultas_auditoria (
    entidade_alvo_tipo,
    entidade_alvo_id,
    criterio_tipo,
    criterio_referencia,
    camada,
    feature_id,
    car,
    doc_status,
    doc_sha256,
    atributos_recebidos,
    consultado_em,
    consultado_por,
    created_at
  )
  VALUES (
    NULLIF(btrim(p_entidade_alvo_tipo), ''),
    NULLIF(btrim(p_entidade_alvo_id), ''),
    p_criterio_tipo,
    v_ref,
    COALESCE(NULLIF(btrim(p_camada), ''), 'Geoportal:CAR_ATP'),
    COALESCE(NULLIF(btrim(p_feature_id), ''), 'sema_item'),
    NULLIF(btrim(p_car), ''),
    p_doc_status,
    p_doc_sha256,
    p_atributos_recebidos,
    now(),
    COALESCE(p_consultado_por, auth.uid()),
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_consulta_sema_auditoria(text, text, text, text, text, text, text, jsonb, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_consulta_sema_auditoria(text, text, text, text, text, text, text, jsonb, uuid, text, text) TO service_role;

-- 5. Função auxiliar interna para validar e aplicar campo auditado + titularidade transacional
DROP FUNCTION IF EXISTS public._aplicar_campo_sema_auditado(uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS public._aplicar_campo_sema_auditado(uuid, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public._aplicar_campo_sema_auditado(
  p_auditoria_id uuid,
  p_entidade_tipo text,
  p_entidade_id text,
  p_campo_nome text,
  p_novo_valor text DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_criterio_vinculo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_uid text;
  v_audit_json jsonb;
  v_attrs jsonb;
  v_audit_ent_tipo text;
  v_audit_ent_id text;
  v_audit_consultado_por text;
  v_audit_doc_sha256 text;
  v_camada text;
  v_feature_id text;
  v_consultado_em timestamptz;
  v_campo text;
  v_criterio_vinculo text;
  v_valor_servidor text;
  v_valor_anterior text;
  v_created_by text;
  v_barr_emp_id text;
  v_emp_situacao text;
  v_emp_doc_digits text;
  v_emp_doc_sha256 text;
  v_active_titular_count integer;
  v_current_titular_emp_id text;
  v_motivo text;
BEGIN
  IF NOT public.is_active_user() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Acesso negado: usuário inativo ou não autenticado.');
  END IF;

  v_role := public.get_my_role();
  v_uid := auth.uid()::text;
  IF v_role NOT IN ('Administrador', 'Analista', 'Usuário') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil sem permissão de gravação (somente leitura).');
  END IF;

  IF p_auditoria_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Identificador da auditoria SEMA-MT é obrigatório.');
  END IF;

  IF p_entidade_tipo NOT IN ('barragem', 'empreendedor') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tipo de entidade inválido para aceite.');
  END IF;

  IF btrim(coalesce(p_entidade_id, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Identificador da entidade é obrigatório.');
  END IF;

  v_campo := lower(btrim(coalesce(p_campo_nome, '')));
  v_criterio_vinculo := lower(btrim(coalesce(p_criterio_vinculo, '')));
  v_motivo := COALESCE(NULLIF(btrim(p_motivo), ''), 'Aceite analítico via consulta pública SEMA-MT');

  -- Bloqueia explicitamente campos técnicos e operacionais protegidos
  IF v_campo IN (
    'latitude', 'longitude', 'altura', 'volume',
    'dano_potencial', 'danopotencial', 'dpa',
    'categoria_risco', 'categoriarisco', 'cri',
    'situacao', 'classificada_em', 'snisb', 'curso_agua',
    'empreendedor', 'id', 'created_by', 'created_at', 'updated_by', 'updated_at'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', format('Campo "%s" é protegido e não pode ser alterado via aceite SEMA-MT.', v_campo));
  END IF;

  IF p_entidade_tipo = 'barragem' AND v_campo NOT IN ('car', 'empreendimento', 'municipio', 'municipio_ibge', 'processo', 'empreendedor_id') THEN
    RETURN jsonb_build_object('success', false, 'error', format('Campo "%s" não está na allowlist de barragem.', v_campo));
  END IF;

  IF p_entidade_tipo = 'empreendedor' AND v_campo NOT IN ('tipo_pessoa', 'nome', 'uf', 'municipio', 'municipio_ibge') THEN
    RETURN jsonb_build_object('success', false, 'error', format('Campo "%s" não está na allowlist de empreendedor.', v_campo));
  END IF;

  -- Busca registro de auditoria no servidor
  SELECT to_jsonb(sa)
  INTO v_audit_json
  FROM public.sema_consultas_auditoria sa
  WHERE sa.id = p_auditoria_id
  LIMIT 1;

  IF v_audit_json IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Registro de auditoria da consulta SEMA-MT não encontrado.');
  END IF;

  v_audit_ent_tipo := NULLIF(btrim(coalesce(v_audit_json->>'entidade_alvo_tipo', '')), '');
  v_audit_ent_id := NULLIF(btrim(coalesce(v_audit_json->>'entidade_alvo_id', '')), '');
  v_audit_consultado_por := NULLIF(btrim(coalesce(v_audit_json->>'consultado_por', '')), '');

  -- Exige correspondência estrita entre a auditoria e a entidade alvo
  IF v_audit_ent_tipo IS DISTINCT FROM p_entidade_tipo OR v_audit_ent_id IS DISTINCT FROM p_entidade_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Auditoria SEMA-MT pertence a outra entidade ou não está vinculada ao registro alvo.');
  END IF;

  IF v_role = 'Usuário' AND v_audit_consultado_por IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permissão negada: auditoria pertence a outro usuário.');
  END IF;

  v_attrs := COALESCE(v_audit_json->'atributos_recebidos', '{}'::jsonb);
  v_audit_doc_sha256 := COALESCE(
    NULLIF(btrim(coalesce(v_audit_json->>'doc_sha256', '')), ''),
    NULLIF(btrim(coalesce(v_attrs->>'doc_sha256', '')), '')
  );
  v_camada := NULLIF(btrim(coalesce(v_audit_json->>'camada', '')), '');
  v_feature_id := NULLIF(btrim(coalesce(v_audit_json->>'feature_id', '')), '');
  v_consultado_em := COALESCE(
    NULLIF(v_audit_json->>'consultado_em', '')::timestamptz,
    NULLIF(v_audit_json->>'created_at', '')::timestamptz,
    now()
  );

  IF p_entidade_tipo = 'barragem' THEN
    SELECT
      created_by,
      empreendedor_id,
      CASE v_campo
        WHEN 'car' THEN car
        WHEN 'empreendimento' THEN empreendimento
        WHEN 'municipio' THEN municipio
        WHEN 'municipio_ibge' THEN municipio_ibge
        WHEN 'processo' THEN processo
        WHEN 'empreendedor_id' THEN empreendedor_id
      END
    INTO v_created_by, v_barr_emp_id, v_valor_anterior
    FROM public.barragens
    WHERE id = p_entidade_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Barragem não encontrada na base central.');
    END IF;

    IF v_role = 'Usuário' AND v_created_by IS DISTINCT FROM v_uid THEN
      RETURN jsonb_build_object('success', false, 'error', 'Permissão negada: usuário comum só pode editar barragens criadas por ele.');
    END IF;

    IF v_campo = 'car' THEN
      v_valor_servidor := COALESCE(
        NULLIF(btrim(v_attrs->>'NUMEROESTADUAL'), ''),
        NULLIF(btrim(v_attrs->>'CAR_ESTADUAL'), ''),
        NULLIF(btrim(v_attrs->>'carEstadual'), ''),
        NULLIF(btrim(v_attrs->>'car'), ''),
        NULLIF(btrim(v_attrs->>'CAR_FEDERAL'), ''),
        NULLIF(btrim(v_attrs->>'CODIGO_CAR_FEDERAL'), ''),
        NULLIF(btrim(v_attrs->>'carFederal'), ''),
        NULLIF(btrim(v_audit_json->>'car'), '')
      );
      IF v_valor_servidor IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'O registro auditado da SEMA-MT não possui número de CAR válido.');
      END IF;
      IF length(v_valor_servidor) < 3 OR length(v_valor_servidor) > 120 OR v_valor_servidor !~ '^[A-Za-z0-9/\-.\s]+$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Formato de CAR inválido no registro auditado.');
      END IF;
      IF NULLIF(btrim(coalesce(p_novo_valor, '')), '') IS NOT NULL
         AND public.norm_car_mt(p_novo_valor) IS DISTINCT FROM public.norm_car_mt(v_valor_servidor)
         AND btrim(p_novo_valor) IS DISTINCT FROM btrim(v_valor_servidor) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Valor enviado para "car" diverge do registro auditado pela SEMA-MT.');
      END IF;

    ELSIF v_campo = 'empreendimento' THEN
      v_valor_servidor := COALESCE(
        NULLIF(btrim(v_attrs->>'NOMEPROPRIEDADE'), ''),
        NULLIF(btrim(v_attrs->>'nomePropriedade'), ''),
        NULLIF(btrim(v_attrs->>'empreendimento'), ''),
        NULLIF(btrim(v_attrs->>'nomeDocumento'), '')
      );
      IF v_valor_servidor IS NOT NULL AND lower(v_valor_servidor) = 'imóvel sem denominação informada' THEN
        v_valor_servidor := NULL;
      END IF;
      IF v_valor_servidor IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'O registro auditado da SEMA-MT não possui nome de propriedade/empreendimento.');
      END IF;
      IF length(v_valor_servidor) < 2 OR length(v_valor_servidor) > 255 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Comprimento inválido para nome do empreendimento.');
      END IF;

      -- Permite usar o ID do empreendimento exclusivamente do empreendedor vinculado à própria barragem,
      -- desde que o nome corresponda exatamente ao imóvel retornado pela SEMA-MT.
      IF NULLIF(btrim(coalesce(p_novo_valor, '')), '') IS NOT NULL
         AND btrim(p_novo_valor) IS DISTINCT FROM btrim(v_valor_servidor) THEN
        IF v_barr_emp_id IS NULL OR NOT EXISTS (
          SELECT 1
          FROM public.empreendedores emp,
               jsonb_array_elements(
                 CASE WHEN jsonb_typeof(emp.empreendimentos) = 'array' THEN emp.empreendimentos ELSE '[]'::jsonb END
               ) AS elem
          WHERE emp.id = v_barr_emp_id
            AND elem->>'id' = btrim(p_novo_valor)
            AND lower(btrim(coalesce(elem->>'nome', ''))) = lower(btrim(v_valor_servidor))
        ) THEN
          RETURN jsonb_build_object('success', false, 'error', 'Valor de empreendimento enviado diverge do imóvel auditado na SEMA-MT.');
        END IF;
        v_valor_servidor := btrim(p_novo_valor);
      END IF;

    ELSIF v_campo = 'municipio' THEN
      v_valor_servidor := COALESCE(
        NULLIF(btrim(v_attrs->>'MUNICIPIO'), ''),
        NULLIF(btrim(v_attrs->>'NOMEMUNICIPIO'), ''),
        NULLIF(btrim(v_attrs->>'NOME_MUNICIPIO'), ''),
        NULLIF(btrim(v_attrs->>'municipio'), '')
      );
      IF v_valor_servidor IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'O registro auditado da SEMA-MT não possui município válido.');
      END IF;
      IF length(v_valor_servidor) < 2 OR length(v_valor_servidor) > 120 OR v_valor_servidor ~ '^\d+$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nome de município inválido no registro auditado.');
      END IF;
      IF EXISTS (SELECT 1 FROM public.municipios m WHERE coalesce(m.uf, 'MT') = 'MT' LIMIT 1) THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.municipios m
          WHERE coalesce(m.uf, 'MT') = 'MT'
            AND lower(btrim(m.nome)) = lower(btrim(v_valor_servidor))
        ) THEN
          RETURN jsonb_build_object('success', false, 'error', format('Município "%s" não consta no catálogo oficial de MT.', v_valor_servidor));
        END IF;
      END IF;
      IF NULLIF(btrim(coalesce(p_novo_valor, '')), '') IS NOT NULL
         AND lower(btrim(p_novo_valor)) IS DISTINCT FROM lower(btrim(v_valor_servidor)) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Valor enviado para "municipio" diverge do registro auditado pela SEMA-MT.');
      END IF;

    ELSIF v_campo = 'municipio_ibge' THEN
      v_valor_servidor := public.norm_digits_only(COALESCE(
        NULLIF(btrim(v_attrs->>'MUNICIPIO_CODIGO'), ''),
        NULLIF(btrim(v_attrs->>'COD_IBGE'), ''),
        NULLIF(btrim(v_attrs->>'municipioCodigo'), ''),
        NULLIF(btrim(v_attrs->>'municipioIbge'), ''),
        NULLIF(btrim(v_attrs->>'municipio_ibge'), '')
      ));
      IF v_valor_servidor IS NULL OR v_valor_servidor !~ '^51[0-9]{5}$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Código IBGE inválido ou não pertencente a Mato Grosso (51xxxxx).');
      END IF;
      IF EXISTS (SELECT 1 FROM public.municipios m WHERE NULLIF(btrim(m.codigo_ibge), '') IS NOT NULL LIMIT 1) THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.municipios m
          WHERE btrim(m.codigo_ibge) = v_valor_servidor
        ) THEN
          RETURN jsonb_build_object('success', false, 'error', format('Código IBGE "%s" não consta no catálogo oficial de municípios.', v_valor_servidor));
        END IF;
      END IF;
      IF NULLIF(btrim(coalesce(p_novo_valor, '')), '') IS NOT NULL
         AND public.norm_digits_only(p_novo_valor) IS DISTINCT FROM v_valor_servidor THEN
        RETURN jsonb_build_object('success', false, 'error', 'Valor enviado para "municipio_ibge" diverge do registro auditado pela SEMA-MT.');
      END IF;

    ELSIF v_campo = 'processo' THEN
      v_valor_servidor := COALESCE(
        NULLIF(btrim(v_attrs->>'NUMERO_PROCESSO'), ''),
        NULLIF(btrim(v_attrs->>'PROTOCOLO_NUMERO'), ''),
        NULLIF(btrim(v_attrs->>'PROTOCOLO'), ''),
        NULLIF(btrim(v_attrs->>'numeroProcesso'), ''),
        NULLIF(btrim(v_attrs->>'processo'), '')
      );
      IF v_valor_servidor IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'O registro auditado da SEMA-MT não possui número de processo.');
      END IF;
      IF length(v_valor_servidor) < 3 OR length(v_valor_servidor) > 80 OR v_valor_servidor !~ '^[A-Za-z0-9./\-_\s]+$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Formato de processo inválido no registro auditado.');
      END IF;
      IF NULLIF(btrim(coalesce(p_novo_valor, '')), '') IS NOT NULL
         AND btrim(p_novo_valor) IS DISTINCT FROM btrim(v_valor_servidor) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Valor enviado para "processo" diverge do registro auditado pela SEMA-MT.');
      END IF;

    ELSIF v_campo = 'empreendedor_id' THEN
      v_valor_servidor := NULLIF(btrim(coalesce(p_novo_valor, '')), '');
      IF v_valor_servidor IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Identificador do empreendedor é obrigatório para vincular titularidade.');
      END IF;

      -- Nunca aceita vínculo automático baseado apenas em nome, CAR compartilhado ou coordenada
      IF v_criterio_vinculo IN ('', 'nome', 'car', 'car_compartilhado', 'coordenada', 'auto') THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Vínculo de empreendedor exige critério seguro (CPF/CNPJ exato confirmado ou confirmação manual explícita do analista), nunca apenas nome, CAR ou coordenada.'
        );
      END IF;

      IF v_criterio_vinculo NOT IN ('cpf_cnpj_exato', 'confirmacao_manual_analista', 'cadastro_novo_cpf_cnpj') THEN
        RETURN jsonb_build_object('success', false, 'error', format('Critério de vínculo inválido: %s', v_criterio_vinculo));
      END IF;

      SELECT e.situacao, public.norm_digits_only(e.cpf_cnpj)
      INTO v_emp_situacao, v_emp_doc_digits
      FROM public.empreendedores e
      WHERE e.id = v_valor_servidor
      FOR SHARE;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Empreendedor informado não existe no cadastro central.');
      END IF;

      IF COALESCE(NULLIF(btrim(v_emp_situacao), ''), 'Ativo') <> 'Ativo' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Apenas empreendedores com situação Ativo podem ser vinculados à barragem.');
      END IF;

      IF v_emp_doc_digits IS NULL OR length(v_emp_doc_digits) NOT IN (11, 14) THEN
        RETURN jsonb_build_object('success', false, 'error', 'O empreendedor selecionado não possui CPF/CNPJ válido cadastrado.');
      END IF;

      v_emp_doc_sha256 := encode(pg_catalog.sha256(convert_to(v_emp_doc_digits, 'UTF8')), 'hex');

      IF v_audit_doc_sha256 IS NOT NULL THEN
        IF v_criterio_vinculo <> 'cpf_cnpj_exato' THEN
          RETURN jsonb_build_object('success', false, 'error', 'A consulta SEMA-MT retornou CPF/CNPJ completo; o vínculo deve usar o critério cpf_cnpj_exato.');
        END IF;
        IF v_emp_doc_sha256 IS DISTINCT FROM v_audit_doc_sha256 THEN
          RETURN jsonb_build_object('success', false, 'error', 'O CPF/CNPJ do empreendedor selecionado não corresponde ao CPF/CNPJ confirmado na consulta SEMA-MT.');
        END IF;
      ELSE
        IF v_criterio_vinculo = 'cpf_cnpj_exato' THEN
          RETURN jsonb_build_object('success', false, 'error', 'A camada consultada não disponibilizou CPF/CNPJ completo; utilize confirmação manual explícita após conferência.');
        END IF;
      END IF;

      -- Atualiza titularidade vigente de forma transacional com lock por barragem
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('titularidade:' || p_entidade_id, 0)
      );

      SELECT COUNT(*), MIN(empreendedor_id)
      INTO v_active_titular_count, v_current_titular_emp_id
      FROM public.empreendedor_barragem_titularidade
      WHERE barragem_id = p_entidade_id
        AND vigente = true;

      IF v_active_titular_count > 1 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Conflito de titularidade: há mais de um vínculo vigente ativo para esta barragem.');
      END IF;

      IF v_active_titular_count = 1 AND v_current_titular_emp_id IS DISTINCT FROM v_valor_servidor THEN
        UPDATE public.empreendedor_barragem_titularidade
        SET vigente = false,
            situacao = 'Encerrada',
            fim_em = now(),
            updated_at = now()
        WHERE barragem_id = p_entidade_id
          AND vigente = true;
      END IF;

      IF v_active_titular_count = 0 OR v_current_titular_emp_id IS DISTINCT FROM v_valor_servidor THEN
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
          p_entidade_id,
          v_valor_servidor,
          true,
          'Vigente',
          now(),
          'SEMA-MT',
          p_auditoria_id,
          v_motivo || ' (' || v_criterio_vinculo || ')',
          auth.uid(),
          now(),
          now()
        );
      END IF;
    END IF;

    IF v_campo = 'car' THEN
      UPDATE public.barragens SET car = v_valor_servidor, updated_by = v_uid, updated_at = now() WHERE id = p_entidade_id;
    ELSIF v_campo = 'empreendimento' THEN
      UPDATE public.barragens SET empreendimento = v_valor_servidor, updated_by = v_uid, updated_at = now() WHERE id = p_entidade_id;
    ELSIF v_campo = 'municipio' THEN
      UPDATE public.barragens SET municipio = v_valor_servidor, updated_by = v_uid, updated_at = now() WHERE id = p_entidade_id;
    ELSIF v_campo = 'municipio_ibge' THEN
      UPDATE public.barragens SET municipio_ibge = v_valor_servidor, updated_by = v_uid, updated_at = now() WHERE id = p_entidade_id;
    ELSIF v_campo = 'processo' THEN
      UPDATE public.barragens SET processo = v_valor_servidor, updated_by = v_uid, updated_at = now() WHERE id = p_entidade_id;
    ELSIF v_campo = 'empreendedor_id' THEN
      UPDATE public.barragens SET empreendedor_id = v_valor_servidor, empreendedor = v_valor_servidor, updated_by = v_uid, updated_at = now() WHERE id = p_entidade_id;
    END IF;

  ELSE
    -- p_entidade_tipo = 'empreendedor'
    SELECT
      created_by,
      CASE v_campo
        WHEN 'tipo_pessoa' THEN tipo_pessoa
        WHEN 'nome' THEN nome
        WHEN 'uf' THEN uf
        WHEN 'municipio' THEN municipio
        WHEN 'municipio_ibge' THEN municipio_ibge
      END
    INTO v_created_by, v_valor_anterior
    FROM public.empreendedores
    WHERE id = p_entidade_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Empreendedor não encontrado na base central.');
    END IF;

    IF v_role = 'Usuário' AND v_created_by IS DISTINCT FROM v_uid THEN
      RETURN jsonb_build_object('success', false, 'error', 'Permissão negada: usuário comum só pode editar empreendedores criados por ele.');
    END IF;

    IF v_campo = 'municipio' THEN
      v_valor_servidor := COALESCE(
        NULLIF(btrim(v_attrs->>'MUNICIPIO'), ''),
        NULLIF(btrim(v_attrs->>'NOMEMUNICIPIO'), ''),
        NULLIF(btrim(v_attrs->>'municipio'), '')
      );
      IF v_valor_servidor IS NULL OR length(v_valor_servidor) < 2 OR length(v_valor_servidor) > 120 OR v_valor_servidor ~ '^\d+$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'O registro auditado não possui município válido.');
      END IF;
    ELSIF v_campo = 'municipio_ibge' THEN
      v_valor_servidor := public.norm_digits_only(COALESCE(
        NULLIF(btrim(v_attrs->>'MUNICIPIO_CODIGO'), ''),
        NULLIF(btrim(v_attrs->>'COD_IBGE'), ''),
        NULLIF(btrim(v_attrs->>'municipioCodigo'), ''),
        NULLIF(btrim(v_attrs->>'municipioIbge'), ''),
        NULLIF(btrim(v_attrs->>'municipio_ibge'), '')
      ));
      IF v_valor_servidor IS NULL OR v_valor_servidor !~ '^51[0-9]{5}$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Código IBGE inválido no registro auditado.');
      END IF;
    ELSIF v_campo = 'uf' THEN
      v_valor_servidor := upper(COALESCE(
        NULLIF(btrim(v_attrs->>'UF'), ''),
        NULLIF(btrim(v_attrs->>'uf'), ''),
        CASE
          WHEN public.norm_digits_only(COALESCE(v_attrs->>'MUNICIPIO_CODIGO', v_attrs->>'municipioCodigo', '')) ~ '^51[0-9]{5}$'
            THEN 'MT'
          ELSE NULL
        END
      ));
      IF v_valor_servidor IS NULL OR v_valor_servidor !~ '^[A-Z]{2}$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'UF inválida ou ausente no registro auditado.');
      END IF;
    ELSIF v_campo = 'nome' THEN
      v_valor_servidor := COALESCE(
        NULLIF(btrim(v_attrs->>'titularNome'), ''),
        NULLIF(btrim(v_attrs->>'RAZAO_SOCIAL'), ''),
        NULLIF(btrim(v_attrs->>'nome'), '')
      );
      IF v_valor_servidor IS NULL OR length(v_valor_servidor) < 2 OR length(v_valor_servidor) > 255 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nome/razão social ausente ou inválido no registro auditado.');
      END IF;
      IF v_valor_servidor ~ '\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nome não pode conter CPF/CNPJ em claro.');
      END IF;
    ELSIF v_campo = 'tipo_pessoa' THEN
      v_valor_servidor := NULLIF(btrim(coalesce(v_attrs->>'tipoPessoa', '')), '');
      IF v_valor_servidor IS NULL OR v_valor_servidor NOT IN ('Pessoa física', 'Pessoa jurídica') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Tipo de pessoa não confirmado no registro auditado.');
      END IF;
    END IF;

    IF NULLIF(btrim(coalesce(p_novo_valor, '')), '') IS NOT NULL
       AND btrim(p_novo_valor) IS DISTINCT FROM btrim(v_valor_servidor) THEN
      RETURN jsonb_build_object('success', false, 'error', format('Valor enviado para "%s" diverge do registro auditado pela SEMA-MT.', v_campo));
    END IF;

    IF v_campo = 'municipio' THEN
      UPDATE public.empreendedores SET municipio = v_valor_servidor, updated_by = v_uid, updated_at = now() WHERE id = p_entidade_id;
    ELSIF v_campo = 'municipio_ibge' THEN
      UPDATE public.empreendedores SET municipio_ibge = v_valor_servidor, updated_by = v_uid, updated_at = now() WHERE id = p_entidade_id;
    ELSIF v_campo = 'uf' THEN
      UPDATE public.empreendedores SET uf = v_valor_servidor, updated_by = v_uid, updated_at = now() WHERE id = p_entidade_id;
    ELSIF v_campo = 'nome' THEN
      UPDATE public.empreendedores SET nome = v_valor_servidor, updated_by = v_uid, updated_at = now() WHERE id = p_entidade_id;
    ELSIF v_campo = 'tipo_pessoa' THEN
      UPDATE public.empreendedores SET tipo_pessoa = v_valor_servidor, updated_by = v_uid, updated_at = now() WHERE id = p_entidade_id;
    END IF;
  END IF;

  -- Preserva valor anterior no histórico apenas se houve mudança real e sem duplicar para a mesma auditoria
  IF v_valor_anterior IS DISTINCT FROM v_valor_servidor THEN
    INSERT INTO public.entidade_campo_historico (
      entidade_tipo,
      entidade_id,
      campo_nome,
      valor_anterior,
      valor_novo,
      fonte_origem,
      camada_origem,
      feature_id_origem,
      auditoria_id,
      alterado_em,
      alterado_por,
      motivo
    )
    SELECT
      p_entidade_tipo,
      p_entidade_id,
      v_campo,
      v_valor_anterior,
      v_valor_servidor,
      'SEMA-MT',
      v_camada,
      v_feature_id,
      p_auditoria_id,
      now(),
      auth.uid(),
      v_motivo
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.entidade_campo_historico h
      WHERE h.entidade_tipo = p_entidade_tipo
        AND h.entidade_id = p_entidade_id
        AND h.campo_nome = v_campo
        AND h.auditoria_id = p_auditoria_id
        AND h.valor_novo IS NOT DISTINCT FROM v_valor_servidor
    );
  END IF;

  -- Grava/atualiza proveniência por campo de forma idempotente (apenas se houver alteração real)
  INSERT INTO public.entidade_campo_proveniencia (
    entidade_tipo,
    entidade_id,
    campo_nome,
    valor_atual,
    fonte_origem,
    camada_origem,
    feature_id_origem,
    auditoria_id,
    consultado_em,
    aceito_em,
    aceito_por,
    motivo
  )
  VALUES (
    p_entidade_tipo,
    p_entidade_id,
    v_campo,
    v_valor_servidor,
    'SEMA-MT',
    v_camada,
    v_feature_id,
    p_auditoria_id,
    v_consultado_em,
    now(),
    auth.uid(),
    v_motivo
  )
  ON CONFLICT (entidade_tipo, entidade_id, campo_nome)
  DO UPDATE SET
    valor_atual = EXCLUDED.valor_atual,
    fonte_origem = EXCLUDED.fonte_origem,
    camada_origem = EXCLUDED.camada_origem,
    feature_id_origem = EXCLUDED.feature_id_origem,
    auditoria_id = EXCLUDED.auditoria_id,
    consultado_em = EXCLUDED.consultado_em,
    aceito_em = EXCLUDED.aceito_em,
    aceito_por = EXCLUDED.aceito_por,
    motivo = EXCLUDED.motivo
  WHERE (
    public.entidade_campo_proveniencia.valor_atual,
    public.entidade_campo_proveniencia.auditoria_id,
    public.entidade_campo_proveniencia.fonte_origem,
    public.entidade_campo_proveniencia.camada_origem,
    public.entidade_campo_proveniencia.feature_id_origem
  ) IS DISTINCT FROM (
    EXCLUDED.valor_atual,
    EXCLUDED.auditoria_id,
    EXCLUDED.fonte_origem,
    EXCLUDED.camada_origem,
    EXCLUDED.feature_id_origem
  );

  RETURN jsonb_build_object('success', true, 'campo', v_campo, 'valor', v_valor_servidor);
END;
$$;

REVOKE ALL ON FUNCTION public._aplicar_campo_sema_auditado(uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- 6. RPC autenticada (single-field)
DROP FUNCTION IF EXISTS public.aceitar_dado_sema_para_mestre(uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.aceitar_dado_sema_para_mestre(uuid, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.aceitar_dado_sema_para_mestre(
  p_auditoria_id uuid,
  p_entidade_tipo text,
  p_entidade_id text,
  p_campo_nome text,
  p_novo_valor text,
  p_motivo text DEFAULT NULL,
  p_criterio_vinculo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._aplicar_campo_sema_auditado(
    p_auditoria_id,
    p_entidade_tipo,
    p_entidade_id,
    p_campo_nome,
    p_novo_valor,
    p_motivo,
    p_criterio_vinculo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aceitar_dado_sema_para_mestre(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceitar_dado_sema_para_mestre(uuid, text, text, text, text, text, text) TO authenticated;

-- 7. RPC transacional em lote (aplica vínculo + campos selecionados atomicamente)
DROP FUNCTION IF EXISTS public.aceitar_campos_sema_para_mestre(uuid, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.aceitar_campos_sema_para_mestre(uuid, text, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION public.aceitar_campos_sema_para_mestre(
  p_auditoria_id uuid,
  p_entidade_tipo text,
  p_entidade_id text,
  p_campos jsonb,
  p_motivo text DEFAULT NULL,
  p_criterio_vinculo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kv record;
  v_res jsonb;
  v_applied text[] := ARRAY[]::text[];
BEGIN
  IF p_campos IS NULL OR jsonb_typeof(p_campos) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mapa de campos inválido.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM jsonb_each(p_campos)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nenhum campo selecionado para aplicação.');
  END IF;

  FOR v_kv IN
    SELECT key, value
    FROM jsonb_each(p_campos)
    ORDER BY CASE WHEN lower(btrim(key)) = 'empreendedor_id' THEN 0 ELSE 1 END, key
  LOOP
    IF jsonb_typeof(v_kv.value) NOT IN ('string', 'number', 'boolean') THEN
      RAISE EXCEPTION 'Valor inválido para o campo "%".', v_kv.key;
    END IF;

    v_res := public._aplicar_campo_sema_auditado(
      p_auditoria_id,
      p_entidade_tipo,
      p_entidade_id,
      v_kv.key,
      CASE
        WHEN jsonb_typeof(v_kv.value) = 'string' THEN v_kv.value #>> '{}'
        ELSE v_kv.value::text
      END,
      p_motivo,
      p_criterio_vinculo
    );
    IF COALESCE((v_res->>'success')::boolean, false) = false THEN
      RAISE EXCEPTION '%', COALESCE(v_res->>'error', 'Falha ao aplicar campo SEMA-MT.');
    END IF;
    v_applied := array_append(v_applied, v_kv.key);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'applied_fields', to_jsonb(v_applied));
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.aceitar_campos_sema_para_mestre(uuid, text, text, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceitar_campos_sema_para_mestre(uuid, text, text, jsonb, text, text) TO authenticated;
