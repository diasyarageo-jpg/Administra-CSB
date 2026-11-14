-- supabase/migrations/20261114_integracao_barragens_caracteristicas_e_visoes.sql
-- Integração fluida entre cadastro do sistema, características técnicas das barragens
-- (altura, volume, DPA/CRI), vínculos de CAR/MT, RTs e base pública SEMA-MT, sem duplicar dados.

-- 1. Características técnicas e classificação de segurança em public.barragens
ALTER TABLE IF EXISTS public.barragens
  ADD COLUMN IF NOT EXISTS altura numeric(12, 2),
  ADD COLUMN IF NOT EXISTS volume numeric(16, 2),
  ADD COLUMN IF NOT EXISTS dano_potencial text,
  ADD COLUMN IF NOT EXISTS categoria_risco text,
  ADD COLUMN IF NOT EXISTS classificada_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_barragens_dano_potencial'
  ) THEN
    ALTER TABLE public.barragens
      ADD CONSTRAINT chk_barragens_dano_potencial
      CHECK (
        dano_potencial IS NULL
        OR btrim(dano_potencial) = ''
        OR dano_potencial IN ('Baixo', 'Médio', 'Alto', 'Não classificada')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_barragens_categoria_risco'
  ) THEN
    ALTER TABLE public.barragens
      ADD CONSTRAINT chk_barragens_categoria_risco
      CHECK (
        categoria_risco IS NULL
        OR btrim(categoria_risco) = ''
        OR categoria_risco IN ('Baixo', 'Médio', 'Alto', 'Não classificada')
      );
  END IF;
END $$;

-- 2. Funções puras de normalização para cruzamentos sem duplicação de dados
CREATE OR REPLACE FUNCTION public.norm_car_mt(raw_car text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(upper(COALESCE(raw_car, '')), '^(?:CAR\s*[–—:\-]*\s*)', '', 'i'),
      '[^A-Z0-9/]',
      '',
      'g'
    ),
    '^MT(?=\d)',
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.norm_digits_only(raw_val text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(raw_val, ''), '\D', '', 'g'), '');
$$;

-- 3. Índices para buscas e cruzamentos rápidos por CAR normalizado, DPA e documento
CREATE INDEX IF NOT EXISTS idx_barragens_car_norm
  ON public.barragens (public.norm_car_mt(car));

CREATE INDEX IF NOT EXISTS idx_barragens_dano_potencial
  ON public.barragens (dano_potencial);

CREATE INDEX IF NOT EXISTS idx_empreendedores_cpf_cnpj_digits
  ON public.empreendedores (public.norm_digits_only(cpf_cnpj));

-- 4. Visão consolidada única por Barragem (evita duplicação no frontend/consultas)
CREATE OR REPLACE VIEW public.vw_barragens_integradas
WITH (security_invoker = true) AS
SELECT
  b.id,
  b.nome,
  b.car,
  public.norm_car_mt(b.car) AS car_norm,
  b.uf,
  b.municipio,
  b.municipio_ibge,
  b.empreendimento,
  b.processo,
  b.snisb,
  b.curso_agua,
  b.latitude,
  b.longitude,
  b.altura,
  b.volume,
  NULLIF(btrim(b.dano_potencial), '') AS dano_potencial,
  NULLIF(btrim(b.categoria_risco), '') AS categoria_risco,
  (
    NULLIF(btrim(b.dano_potencial), '') IS NOT NULL
    AND b.dano_potencial <> 'Não classificada'
  ) AS dpa_classificada,
  b.classificada_em,
  b.situacao,
  b.observacoes,
  COALESCE(e.id, b.empreendedor_id) AS empreendedor_id,
  COALESCE(e.nome, b.empreendedor) AS empreendedor_nome,
  e.cpf_cnpj AS empreendedor_cpf_cnpj,
  e.municipio AS empreendedor_municipio,
  e.uf AS empreendedor_uf,
  COALESCE(
    (
      SELECT jsonb_agg(
        DISTINCT jsonb_build_object(
          'rtId', COALESCE(r.id, v.rt_id),
          'nome', COALESCE(r.nome, v.nome),
          'art', v.art,
          'validade', v.validade,
          'situacao', v.situacao
        )
      )
      FROM public.responsaveis_tecnicos_barragens v
      LEFT JOIN public.rts r ON r.id = v.rt_id
      WHERE v.barragem_id = b.id
         OR (v.barragem_vinculada IS NOT NULL AND btrim(v.barragem_vinculada) = b.id)
    ),
    '[]'::jsonb
  ) AS responsaveis_tecnicos,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'orderNumber', p.order_number,
          'processNumber', p.process_number,
          'sentDate', p.sent_date,
          'finalDate', p.final_date,
          'orderPublished', p.order_published,
          'extractPublished', p.extract_published,
          'secretarySigned', p.secretary_signed,
          'draft', p.draft
        )
        ORDER BY COALESCE(p.final_date, p.sent_date) DESC
      )
      FROM public.portarias p
      WHERE b.processo IS NOT NULL
        AND btrim(b.processo) <> ''
        AND upper(btrim(p.process_number)) = upper(btrim(b.processo))
    ),
    '[]'::jsonb
  ) AS portarias_vinculadas,
  b.created_at,
  b.updated_at
FROM public.barragens b
LEFT JOIN public.empreendedores e
  ON e.id = b.empreendedor_id
  OR (b.empreendedor_id IS NULL AND lower(btrim(b.empreendedor)) = lower(btrim(e.nome)));

-- 5. Atualiza visão consolidada Empreendedor <-> Barragens <-> RTs incluindo altura, volume e DPA/CRI
CREATE OR REPLACE VIEW public.vw_empreendedores_barragens_rts
WITH (security_invoker = true) AS
SELECT
  e.id AS empreendedor_id,
  e.nome AS empreendedor_nome,
  e.cpf_cnpj,
  e.municipio AS empreendedor_municipio,
  e.uf AS empreendedor_uf,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(btrim(b.car), '')), NULL) AS cars_mt,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(btrim(b.processo), '')), NULL) AS processos,
  COUNT(DISTINCT b.id) AS total_barragens,
  COALESCE(
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'id', b.id,
        'nome', b.nome,
        'car', b.car,
        'carNorm', public.norm_car_mt(b.car),
        'processo', b.processo,
        'snisb', b.snisb,
        'municipio', b.municipio,
        'empreendimento', b.empreendimento,
        'cursoAgua', b.curso_agua,
        'latitude', b.latitude,
        'longitude', b.longitude,
        'altura', b.altura,
        'volume', b.volume,
        'danoPotencial', NULLIF(btrim(b.dano_potencial), ''),
        'categoriaRisco', NULLIF(btrim(b.categoria_risco), ''),
        'dpaClassificada', (NULLIF(btrim(b.dano_potencial), '') IS NOT NULL AND b.dano_potencial <> 'Não classificada'),
        'situacao', b.situacao
      )
    ) FILTER (WHERE b.id IS NOT NULL),
    '[]'::jsonb
  ) AS barragens_vinculadas,
  COALESCE(
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'rtId', COALESCE(r.id, v.rt_id),
        'nome', COALESCE(r.nome, v.nome),
        'art', v.art,
        'barragemId', v.barragem_id
      )
    ) FILTER (WHERE v.id IS NOT NULL),
    '[]'::jsonb
  ) AS responsaveis_tecnicos
FROM public.empreendedores e
LEFT JOIN public.barragens b
  ON b.empreendedor_id = e.id
  OR (b.empreendedor_id IS NULL AND lower(btrim(b.empreendedor)) = lower(btrim(e.nome)))
LEFT JOIN public.responsaveis_tecnicos_barragens v
  ON v.barragem_id = b.id
LEFT JOIN public.rts r
  ON r.id = v.rt_id
GROUP BY e.id, e.nome, e.cpf_cnpj, e.municipio, e.uf;

-- 6. Visão agrupada por CAR/MT único (evita repetição de quadros quando há mais de uma barragem no mesmo CAR)
CREATE OR REPLACE VIEW public.vw_cruzamento_car_barragens
WITH (security_invoker = true) AS
SELECT
  public.norm_car_mt(b.car) AS car_norm,
  MIN(btrim(b.car)) AS car_exibicao,
  COUNT(DISTINCT b.id) AS total_barragens,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(e.id, b.empreendedor_id)), NULL) AS empreendedores_ids,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(e.nome, b.empreendedor)), NULL) AS empreendedores_nomes,
  COALESCE(
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'id', b.id,
        'nome', b.nome,
        'municipio', b.municipio,
        'empreendimento', b.empreendimento,
        'processo', b.processo,
        'snisb', b.snisb,
        'altura', b.altura,
        'volume', b.volume,
        'danoPotencial', NULLIF(btrim(b.dano_potencial), ''),
        'categoriaRisco', NULLIF(btrim(b.categoria_risco), ''),
        'dpaClassificada', (NULLIF(btrim(b.dano_potencial), '') IS NOT NULL AND b.dano_potencial <> 'Não classificada'),
        'situacao', b.situacao
      )
    ) FILTER (WHERE b.id IS NOT NULL),
    '[]'::jsonb
  ) AS barragens_do_car
FROM public.barragens b
LEFT JOIN public.empreendedores e
  ON e.id = b.empreendedor_id
  OR (b.empreendedor_id IS NULL AND lower(btrim(b.empreendedor)) = lower(btrim(e.nome)))
WHERE NULLIF(public.norm_car_mt(b.car), '') IS NOT NULL
GROUP BY public.norm_car_mt(b.car);

-- 7. Função segura para cruzamento integrado (Sistema + Cache Público SEMA-MT) sem expor dados sensíveis nem duplicar registros
CREATE OR REPLACE FUNCTION public.consultar_cruzamento_sema_integrado(
  p_cars text[] DEFAULT ARRAY[]::text[],
  p_cpf_cnpj text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_car_norms text[];
  v_doc_digits text;
  v_barragens jsonb := '[]'::jsonb;
  v_sema_cache jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Acesso negado: usuário inativo ou não autenticado.';
  END IF;

  v_doc_digits := public.norm_digits_only(p_cpf_cnpj);

  SELECT ARRAY(
    SELECT DISTINCT n
    FROM unnest(COALESCE(p_cars, ARRAY[]::text[])) AS raw_c,
         LATERAL (SELECT public.norm_car_mt(raw_c) AS n) sub
    WHERE NULLIF(n, '') IS NOT NULL
  ) INTO v_car_norms;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(vw)),
    '[]'::jsonb
  )
  INTO v_barragens
  FROM public.vw_barragens_integradas vw
  WHERE (
    COALESCE(array_length(v_car_norms, 1), 0) > 0
    AND vw.car_norm = ANY(v_car_norms)
  )
  OR (
    v_doc_digits IS NOT NULL
    AND public.norm_digits_only(vw.empreendedor_cpf_cnpj) = v_doc_digits
  );

  IF to_regclass('public.geoportal_sync_cache') IS NOT NULL AND COALESCE(array_length(v_car_norms, 1), 0) > 0 THEN
    EXECUTE $sql$
      SELECT COALESCE(
        jsonb_agg(to_jsonb(sub)),
        '[]'::jsonb
      )
      FROM (
        SELECT DISTINCT ON (public.norm_car_mt(COALESCE(numero_estadual, car_federal)))
          id,
          camada,
          numero_estadual,
          car_federal,
          public.norm_car_mt(COALESCE(numero_estadual, car_federal)) AS car_norm,
          nome_propriedade,
          nome_proprietario,
          municipio_nome,
          situacao_car,
          area_ha,
          numero_processo,
          link_documento,
          sincronizado_em
        FROM public.geoportal_sync_cache
        WHERE public.norm_car_mt(COALESCE(numero_estadual, car_federal)) = ANY($1)
        ORDER BY
          public.norm_car_mt(COALESCE(numero_estadual, car_federal)),
          CASE WHEN upper(camada) LIKE '%CAR_ATP%' THEN 0 ELSE 1 END,
          sincronizado_em DESC
      ) sub
    $sql$
    INTO v_sema_cache
    USING v_car_norms;
  END IF;

  RETURN jsonb_build_object(
    'barragens', COALESCE(v_barragens, '[]'::jsonb),
    'sema_cache', COALESCE(v_sema_cache, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consultar_cruzamento_sema_integrado(text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consultar_cruzamento_sema_integrado(text[], text) TO authenticated;
