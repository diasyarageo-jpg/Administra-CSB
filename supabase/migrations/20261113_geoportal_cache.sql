-- supabase/migrations/20261113_geoportal_cache.sql
-- Migração dedicada para cache paginado e estado persistente de sincronização do Geoportal SEMA-MT.
-- ATENÇÃO:
--   - Não executa automaticamente.
--   - Não altera tabelas operacionais existentes (empreendedores, barragens, rts, usuarios).
--   - RLS ativado em ambas as tabelas, sem políticas públicas de leitura ou escrita para anon.

CREATE TABLE IF NOT EXISTS public.geoportal_sync_cache (
    id TEXT PRIMARY KEY,
    camada TEXT NOT NULL,
    feature_id TEXT NOT NULL,
    numero_estadual TEXT,
    car_federal TEXT,
    protocolo TEXT,
    nome_propriedade TEXT,
    nome_proprietario TEXT,
    municipio_codigo BIGINT,
    municipio_nome TEXT,
    situacao_car TEXT,
    area_ha NUMERIC(14, 4),
    numero_processo TEXT,
    tipo_documento TEXT,
    numero_documento TEXT,
    status_documento TEXT,
    link_documento TEXT,
    raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Índice único exigido pelo upsert (camada, feature_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_geoportal_sync_cache_camada_feature
    ON public.geoportal_sync_cache (camada, feature_id);

CREATE INDEX IF NOT EXISTS idx_geoportal_sync_cache_numero_estadual
    ON public.geoportal_sync_cache (numero_estadual);

CREATE INDEX IF NOT EXISTS idx_geoportal_sync_cache_car_federal
    ON public.geoportal_sync_cache (car_federal);

CREATE INDEX IF NOT EXISTS idx_geoportal_sync_cache_municipio_codigo
    ON public.geoportal_sync_cache (municipio_codigo);

CREATE INDEX IF NOT EXISTS idx_geoportal_sync_cache_processo
    ON public.geoportal_sync_cache (numero_processo);

CREATE INDEX IF NOT EXISTS idx_geoportal_sync_cache_camada
    ON public.geoportal_sync_cache (camada);

-- Tabela de estado persistente e ponto de retomada da sincronização por camada (e trava __GLOBAL__)
CREATE TABLE IF NOT EXISTS public.geoportal_sync_estado (
    camada TEXT PRIMARY KEY,
    proximo_start_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ocioso',
    registros_sincronizados INTEGER NOT NULL DEFAULT 0,
    iniciado_em TIMESTAMPTZ,
    concluido_em TIMESTAMPTZ,
    ultimo_sucesso_em TIMESTAMPTZ,
    mensagem TEXT
);

-- RLS ativado sem políticas públicas de leitura/escrita para anon
ALTER TABLE public.geoportal_sync_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geoportal_sync_estado ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.geoportal_sync_cache FROM anon;
REVOKE ALL ON TABLE public.geoportal_sync_estado FROM anon;
REVOKE ALL ON TABLE public.geoportal_sync_cache FROM authenticated;
REVOKE ALL ON TABLE public.geoportal_sync_estado FROM authenticated;

COMMENT ON TABLE public.geoportal_sync_cache IS 'Cache persistente de atributos (sem geometria e sem CPF/CNPJ completo) do Geoportal SEMA-MT.';
COMMENT ON TABLE public.geoportal_sync_estado IS 'Estado persistente, controle de concorrência e ponto de retomada da sincronização do Geoportal SEMA-MT.';
