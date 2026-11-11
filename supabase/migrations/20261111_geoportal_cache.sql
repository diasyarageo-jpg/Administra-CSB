-- supabase/migrations/20261111_geoportal_cache.sql
-- Tabela dedicada de cache e sincronização da base local do Geoportal SEMA-MT (CAR/ATP, Licenciamento e Fiscalização)
-- ATENÇÃO: Migração separada e dedicada ao cache. Não altera nenhuma tabela operacional existente (empreendedores, barragens, rts).
-- NÃO executar automaticamente; aplicar sob demanda pelo administrador do banco.

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
    cpf_cnpj_hash TEXT,
    numero_processo TEXT,
    tipo_documento TEXT,
    numero_documento TEXT,
    status_documento TEXT,
    link_documento TEXT,
    raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_geoportal_camada_feature UNIQUE (camada, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_geoportal_cache_numero_estadual ON public.geoportal_sync_cache(numero_estadual);
CREATE INDEX IF NOT EXISTS idx_geoportal_cache_car_federal ON public.geoportal_sync_cache(car_federal);
CREATE INDEX IF NOT EXISTS idx_geoportal_cache_municipio_codigo ON public.geoportal_sync_cache(municipio_codigo);
CREATE INDEX IF NOT EXISTS idx_geoportal_cache_processo ON public.geoportal_sync_cache(numero_processo);
CREATE INDEX IF NOT EXISTS idx_geoportal_cache_camada ON public.geoportal_sync_cache(camada);

COMMENT ON TABLE public.geoportal_sync_cache IS 'Base de cache e sincronização periódica de metadados do Geoportal SEMA-MT.';
