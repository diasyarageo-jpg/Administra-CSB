-- supabase/migrations/20261114_correlacao_leve_cadastros.sql
-- Correlação leve e idempotente entre Empreendedores, Barragens, CAR/MT e Responsáveis Técnicos.

-- 1. Vínculo leve por FK em barragens -> empreendedores (preservando a coluna legada "empreendedor")
ALTER TABLE public.barragens
  ADD COLUMN IF NOT EXISTS empreendedor_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_barragens_empreendedor_id'
  ) THEN
    ALTER TABLE public.barragens
      ADD CONSTRAINT fk_barragens_empreendedor_id
      FOREIGN KEY (empreendedor_id)
      REFERENCES public.empreendedores(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Índices leves para cruzamentos e buscas
CREATE INDEX IF NOT EXISTS idx_barragens_empreendedor_id ON public.barragens(empreendedor_id);
CREATE INDEX IF NOT EXISTS idx_barragens_car ON public.barragens(car);
CREATE INDEX IF NOT EXISTS idx_barragens_processo ON public.barragens(processo);
CREATE INDEX IF NOT EXISTS idx_barragens_snisb ON public.barragens(snisb);
CREATE INDEX IF NOT EXISTS idx_empreendedores_cpf_cnpj ON public.empreendedores(cpf_cnpj);
CREATE INDEX IF NOT EXISTS idx_rt_barragens_processo ON public.responsaveis_tecnicos_barragens(processo);

-- 3. Backfill de barragens.empreendedor_id
-- 3a) Correspondência direta por ID já gravado em barragens.empreendedor
UPDATE public.barragens b
SET empreendedor_id = e.id,
    updated_at = NOW()
FROM public.empreendedores e
WHERE b.empreendedor_id IS NULL
  AND b.empreendedor IS NOT NULL
  AND btrim(b.empreendedor) = e.id;

-- 3b) Correspondência única por nome exato normalizado (nome ou nome_fantasia)
WITH emp_matches AS (
  SELECT
    b.id AS barragem_id,
    MIN(e.id) AS matched_emp_id,
    COUNT(*) AS total_matches
  FROM public.barragens b
  JOIN public.empreendedores e
    ON lower(btrim(b.empreendedor)) = lower(btrim(e.nome))
    OR (e.nome_fantasia IS NOT NULL AND btrim(e.nome_fantasia) <> '' AND lower(btrim(b.empreendedor)) = lower(btrim(e.nome_fantasia)))
  WHERE b.empreendedor_id IS NULL
    AND b.empreendedor IS NOT NULL
    AND btrim(b.empreendedor) <> ''
  GROUP BY b.id
)
UPDATE public.barragens b
SET empreendedor_id = m.matched_emp_id,
    updated_at = NOW()
FROM emp_matches m
WHERE b.id = m.barragem_id
  AND m.total_matches = 1;

-- 3c) Correspondência única por CPF/CNPJ via fiscaliza_notificacoes_importadas (processo ou CAR)
DO $$
BEGIN
  IF to_regclass('public.fiscaliza_notificacoes_importadas') IS NOT NULL THEN
    WITH fisc_matches AS (
      SELECT
        b.id AS barragem_id,
        MIN(e.id) AS matched_emp_id,
        COUNT(DISTINCT e.id) AS total_matches
      FROM public.barragens b
      JOIN public.fiscaliza_notificacoes_importadas f
        ON (b.processo IS NOT NULL AND btrim(b.processo) <> '' AND upper(btrim(f.processo)) = upper(btrim(b.processo)))
        OR (
          b.car IS NOT NULL AND btrim(b.car) <> ''
          AND f.payload IS NOT NULL
          AND (f.payload->>'carMt') IS NOT NULL
          AND regexp_replace(upper(f.payload->>'carMt'), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(b.car), '[^A-Z0-9]', '', 'g')
        )
      JOIN public.empreendedores e
        ON NULLIF(regexp_replace(COALESCE(f.cpf_cnpj, ''), '\D', '', 'g'), '') IS NOT NULL
        AND regexp_replace(COALESCE(e.cpf_cnpj, ''), '\D', '', 'g') = regexp_replace(COALESCE(f.cpf_cnpj, ''), '\D', '', 'g')
      WHERE b.empreendedor_id IS NULL
      GROUP BY b.id
    )
    UPDATE public.barragens b
    SET empreendedor_id = fm.matched_emp_id,
        updated_at = NOW()
    FROM fisc_matches fm
    WHERE b.id = fm.barragem_id
      AND fm.total_matches = 1;
  END IF;
END $$;

-- 4. Enriquecimento leve de empreendedores.empreendimentos com os CAR/MT das barragens vinculadas
WITH barragem_car_items AS (
  SELECT
    b.empreendedor_id,
    jsonb_build_object(
      'id', 'empr_barr_' || b.id,
      'nome', COALESCE(NULLIF(btrim(b.empreendimento), ''), b.nome),
      'tipo', 'Rural',
      'car', btrim(b.car),
      'escritura', '',
      'uf', COALESCE(NULLIF(btrim(b.uf), ''), 'MT'),
      'municipio', COALESCE(NULLIF(btrim(b.municipio), ''), ''),
      'municipioIbge', COALESCE(NULLIF(btrim(b.municipio_ibge), ''), ''),
      'barragemId', b.id,
      'createdAt', NOW()
    ) AS novo_item,
    regexp_replace(upper(b.car), '[^A-Z0-9/]', '', 'g') AS car_norm
  FROM public.barragens b
  WHERE b.empreendedor_id IS NOT NULL
    AND b.car IS NOT NULL
    AND btrim(b.car) <> ''
),
missing_items AS (
  SELECT
    bci.empreendedor_id,
    jsonb_agg(bci.novo_item ORDER BY bci.car_norm) AS novos_empreendimentos
  FROM (
    SELECT DISTINCT ON (empreendedor_id, car_norm)
      empreendedor_id,
      car_norm,
      novo_item
    FROM barragem_car_items
  ) bci
  JOIN public.empreendedores e ON e.id = bci.empreendedor_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(e.empreendimentos) = 'array' THEN e.empreendimentos
        ELSE '[]'::jsonb
      END
    ) AS elem
    WHERE regexp_replace(upper(COALESCE(elem->>'car', '')), '[^A-Z0-9/]', '', 'g') = bci.car_norm
  )
  GROUP BY bci.empreendedor_id
)
UPDATE public.empreendedores e
SET empreendimentos = (
      CASE
        WHEN jsonb_typeof(e.empreendimentos) = 'array' THEN e.empreendimentos
        ELSE '[]'::jsonb
      END
    ) || mi.novos_empreendimentos,
    updated_at = NOW()
FROM missing_items mi
WHERE e.id = mi.empreendedor_id;

-- 5. Correlação leve entre Responsáveis Técnicos (rts) e Vínculos (responsaveis_tecnicos_barragens)
WITH rt_name_matches AS (
  SELECT
    v.id AS vinculo_id,
    MIN(r.id) AS matched_rt_id,
    COUNT(*) AS total_matches
  FROM public.responsaveis_tecnicos_barragens v
  JOIN public.rts r
    ON lower(btrim(v.nome)) = lower(btrim(r.nome))
  WHERE (v.rt_id IS NULL OR btrim(v.rt_id) = '')
    AND v.nome IS NOT NULL
    AND btrim(v.nome) <> ''
  GROUP BY v.id
)
UPDATE public.responsaveis_tecnicos_barragens v
SET rt_id = m.matched_rt_id
FROM rt_name_matches m
WHERE v.id = m.vinculo_id
  AND m.total_matches = 1;

WITH agg_vinculos AS (
  SELECT
    v.rt_id,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(btrim(COALESCE(v.barragem_id, '')), '')), NULL) AS barr_ids,
    (ARRAY_AGG(NULLIF(btrim(v.art), '') ORDER BY v.created_at DESC NULLS LAST))[1] AS first_art,
    (ARRAY_AGG(NULLIF(btrim(v.barragem_id), '') ORDER BY v.created_at DESC NULLS LAST))[1] AS first_barr
  FROM public.responsaveis_tecnicos_barragens v
  WHERE v.rt_id IS NOT NULL
    AND btrim(v.rt_id) <> ''
  GROUP BY v.rt_id
)
UPDATE public.rts r
SET
  barragens_vinculadas = COALESCE(a.barr_ids, r.barragens_vinculadas, ARRAY[]::text[]),
  barragem_vinculada = COALESCE(NULLIF(btrim(r.barragem_vinculada), ''), a.first_barr),
  art = COALESCE(NULLIF(btrim(r.art), ''), a.first_art),
  art_rrt = COALESCE(NULLIF(btrim(r.art_rrt), ''), a.first_art),
  updated_at = NOW()
FROM agg_vinculos a
WHERE r.id = a.rt_id;

-- 6. Correlação opcional de histórico de transferências com barragens (por SNISB ou Processo único)
DO $$
BEGIN
  IF to_regclass('public.historico_transferencias_titularidade') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_hist_transf_barragem_id ON public.historico_transferencias_titularidade(barragem_id);
    CREATE INDEX IF NOT EXISTS idx_hist_transf_snisb ON public.historico_transferencias_titularidade(snisb);
    CREATE INDEX IF NOT EXISTS idx_hist_transf_processo ON public.historico_transferencias_titularidade(processo);

    WITH transf_matches AS (
      SELECT
        h.id AS transf_id,
        MIN(b.id) AS matched_barr_id,
        COUNT(DISTINCT b.id) AS total_matches
      FROM public.historico_transferencias_titularidade h
      JOIN public.barragens b
        ON (h.snisb IS NOT NULL AND btrim(h.snisb) <> '' AND btrim(b.snisb) = btrim(h.snisb))
        OR (h.processo IS NOT NULL AND btrim(h.processo) <> '' AND upper(btrim(b.processo)) = upper(btrim(h.processo)))
      WHERE (h.barragem_id IS NULL OR btrim(h.barragem_id) = '')
      GROUP BY h.id
    )
    UPDATE public.historico_transferencias_titularidade h
    SET barragem_id = tm.matched_barr_id
    FROM transf_matches tm
    WHERE h.id = tm.transf_id
      AND tm.total_matches = 1;
  END IF;
END $$;

-- 7. Visão consolidada leve (respeita as políticas de acesso do usuário autenticado)
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
        'processo', b.processo,
        'snisb', b.snisb,
        'municipio', b.municipio,
        'latitude', b.latitude,
        'longitude', b.longitude
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
