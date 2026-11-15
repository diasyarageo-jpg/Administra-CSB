// api/car-sync.ts
import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  SEMA_FIELD_CANDIDATES,
  resolveConfirmedFields,
  extractConfirmedFieldValue,
  collectConfirmedPropertyNames,
  sanitizeSemaProperties
} from '../src/config/carCampos';

interface VercelLikeRequest extends IncomingMessage {
  query?: Record<string, string | string[]>;
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (data: any) => VercelLikeResponse;
}

type SyncStatusValue = 'ocioso' | 'em_andamento' | 'sucesso' | 'parcial' | 'falha';

interface LayerXmlSchema {
  ok: boolean;
  fields: Map<string, string>;
  geomFields: Set<string>;
  errorMsg?: string;
}

const WFS_URL = 'https://geo.sema.mt.gov.br/geoserver/wfs';
const GEOSERVER_AUTHKEY =
  process.env.SEMA_GEOSERVER_AUTHKEY ||
  process.env.GEOSERVER_AUTHKEY ||
  '541085de-9a2e-454e-bdba-eb3d57a2f492';

const TARGET_SYNC_LAYERS = [
  'Geoportal:CAR_ATP',
  'Geoportal:MVW_REQUERIMENTO_ATP',
  'Geoportal:TDAD_FISCALIZACAO_NOTIFICACAO',
  'Geoportal:TDAD_LICENCIAMENTO_LICENCA_DE_OPERACAO'
] as const;

const GLOBAL_STATE_KEY = '__GLOBAL__';
const PAGE_SIZE = 200;
const MAX_EXECUTION_MS = 40_000;
const LOCK_STALE_MS = 10 * 60 * 1000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function timingSafeBearerEquals(authHeader: string, expectedSecret: string): boolean {
  if (!expectedSecret) return false;
  const expectedHeader = `Bearer ${expectedSecret}`;
  const a = Buffer.from(authHeader, 'utf8');
  const b = Buffer.from(expectedHeader, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getServerSupabaseClient(): SupabaseClient<any, any, any> | null {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function isMissingSchemaOrColumnError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST205' ||
    code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('could not find')
  );
}

function sanitizeServerMessage(raw: string): string {
  return String(raw || '')
    .replace(new RegExp(GEOSERVER_AUTHKEY, 'gi'), '[REDACTED]')
    .trim();
}

/**
 * Dependência confirmada no projeto:
 *   - Tabela `public.usuarios` com colunas `auth_user_id`, `papel`, `situacao`, `status`
 *     (definida em `supabase/migrations/20261029_auth_rbac_isolated_login.sql`).
 *   - Caso a tabela ou alguma dessas colunas esteja ausente no ambiente conectado,
 *     a ação manual é bloqueada com erro seguro sem presumir estrutura.
 */
async function authorizeManualSync(req: VercelLikeRequest): Promise<
  | { authorized: true; supabaseAdmin: SupabaseClient<any, any, any> }
  | { authorized: false; httpStatus: number; error: string }
> {
  const supabaseAdmin = getServerSupabaseClient();
  if (!supabaseAdmin) {
    return {
      authorized: false,
      httpStatus: 503,
      error:
        'Sincronização manual bloqueada: configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para autenticar Analistas/Administradores e gravar no cache.'
    };
  }

  const rawAuth = req.headers['authorization'];
  const authHeader = Array.isArray(rawAuth) ? String(rawAuth[0] || '') : String(rawAuth || '');
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const jwt = bearerMatch ? bearerMatch[1].trim() : '';

  if (!jwt) {
    return {
      authorized: false,
      httpStatus: 401,
      error: 'Autenticação obrigatória. Faça login institucional como Analista ou Administrador.'
    };
  }

  try {
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return {
        authorized: false,
        httpStatus: 401,
        error: 'Sessão inválida ou expirada. Faça login novamente para sincronizar.'
      };
    }

    const { data: profile, error: profErr } = await supabaseAdmin
      .from('usuarios')
      .select('id, papel, situacao, status, auth_user_id')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();

    if (profErr) {
      if (isMissingSchemaOrColumnError(profErr)) {
        return {
          authorized: false,
          httpStatus: 503,
          error:
            'Dependência ausente no banco de dados: tabela public.usuarios ou colunas (auth_user_id, papel, situacao, status) não encontradas. Aplique a migração 20261029_auth_rbac_isolated_login.sql.'
        };
      }
      return {
        authorized: false,
        httpStatus: 500,
        error: 'Não foi possível validar o perfil institucional do usuário no servidor.'
      };
    }

    if (!profile) {
      return {
        authorized: false,
        httpStatus: 403,
        error: 'Perfil institucional não encontrado ou sem permissão no servidor.'
      };
    }

    const isActive = profile.situacao
      ? profile.situacao === 'Ativo'
      : profile.status === 'Ativo';
    const allowedRoles = ['Administrador', 'Analista'];

    if (!isActive || !allowedRoles.includes(String(profile.papel || ''))) {
      return {
        authorized: false,
        httpStatus: 403,
        error: 'Ação restrita exclusivamente a Analistas ou Administradores ativos.'
      };
    }

    return { authorized: true, supabaseAdmin };
  } catch {
    return {
      authorized: false,
      httpStatus: 500,
      error: 'Erro ao validar credenciais do usuário no servidor.'
    };
  }
}

async function verificarTabelasCache(
  supabaseAdmin: SupabaseClient<any, any, any> | null
): Promise<{ ok: boolean; errorMsg?: string }> {
  if (!supabaseAdmin) {
    return {
      ok: false,
      errorMsg:
        'Pré-requisito pendente: configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para persistir nas tabelas geoportal_sync_cache e geoportal_sync_estado.'
    };
  }

  const [cacheCheck, stateCheck] = await Promise.all([
    supabaseAdmin.from('geoportal_sync_cache').select('id').limit(1),
    supabaseAdmin.from('geoportal_sync_estado').select('camada').limit(1)
  ]);

  if (cacheCheck.error) {
    if (isMissingSchemaOrColumnError(cacheCheck.error)) {
      return {
        ok: false,
        errorMsg:
          'Pré-requisito pendente: a tabela public.geoportal_sync_cache não foi encontrada no Supabase. Aplique a migração supabase/migrations/20261113_geoportal_cache.sql.'
      };
    }
    return {
      ok: false,
      errorMsg: `Tabela geoportal_sync_cache indisponível: ${cacheCheck.error.message}`
    };
  }

  if (stateCheck.error) {
    if (isMissingSchemaOrColumnError(stateCheck.error)) {
      return {
        ok: false,
        errorMsg:
          'Pré-requisito pendente: a tabela public.geoportal_sync_estado não foi encontrada no Supabase. Aplique a migração supabase/migrations/20261113_geoportal_cache.sql.'
      };
    }
    return {
      ok: false,
      errorMsg: `Tabela geoportal_sync_estado indisponível: ${stateCheck.error.message}`
    };
  }

  return { ok: true };
}

async function getConfirmedWfsLayers(): Promise<Set<string>> {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetCapabilities',
    authkey: GEOSERVER_AUTHKEY
  });
  const res = await fetchWithTimeout(`${WFS_URL}?${params.toString()}`, 12000);
  if (!res.ok) {
    throw new Error(`WFS GetCapabilities retornou HTTP ${res.status}.`);
  }
  const xml = await res.text();
  const names = new Set<string>();
  const matches = xml.matchAll(/<(?:[\w-]+:)?Name>([^<]+)<\/(?:[\w-]+:)?Name>/gi);
  for (const m of matches) {
    names.add(m[1].trim());
  }
  return names;
}

async function describeLayerSchemaXml(layerName: string): Promise<LayerXmlSchema> {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'DescribeFeatureType',
    typeNames: layerName,
    authkey: GEOSERVER_AUTHKEY
  });

  try {
    const res = await fetchWithTimeout(`${WFS_URL}?${params.toString()}`, 10000);
    if (!res.ok) {
      return {
        ok: false,
        fields: new Map(),
        geomFields: new Set(),
        errorMsg: `DescribeFeatureType XML retornou HTTP ${res.status}.`
      };
    }

    const xml = await res.text();
    if (/ExceptionReport/i.test(xml)) {
      return {
        ok: false,
        fields: new Map(),
        geomFields: new Set(),
        errorMsg: 'GeoServer retornou ExceptionReport no DescribeFeatureType XML.'
      };
    }

    const fields = new Map<string, string>();
    const geomFields = new Set<string>();
    const localName = layerName.includes(':') ? layerName.split(':')[1] : layerName;
    const elementTags = xml.matchAll(/<(?:xsd:)?element\b([^>]+)\/?>/gi);

    for (const tagMatch of elementTags) {
      const attrs = tagMatch[1] || '';
      const nameAttr = attrs.match(/\bname\s*=\s*"([^"]+)"/i);
      const typeAttr = attrs.match(/\btype\s*=\s*"([^"]+)"/i);
      if (!nameAttr || !typeAttr) continue;

      const fieldName = nameAttr[1].trim();
      const fieldType = typeAttr[1].trim();
      if (fieldName === localName && /Type$/i.test(fieldType)) {
        continue;
      }

      fields.set(fieldName, fieldType);

      const lowerType = fieldType.toLowerCase();
      if (
        lowerType.startsWith('gml:') ||
        lowerType.includes('geometry') ||
        lowerType.includes('surface') ||
        lowerType.includes('polygon') ||
        lowerType.includes('point') ||
        lowerType.includes('curve') ||
        lowerType.includes('linestring')
      ) {
        geomFields.add(fieldName);
      }
    }

    if (fields.size === 0) {
      return {
        ok: false,
        fields,
        geomFields,
        errorMsg: 'Esquema XML sem atributos reconhecidos.'
      };
    }

    return { ok: true, fields, geomFields };
  } catch {
    return {
      ok: false,
      fields: new Map(),
      geomFields: new Set(),
      errorMsg: 'Falha ao consultar DescribeFeatureType XML.'
    };
  }
}

async function acquireDbSyncLock(
  supabaseAdmin: SupabaseClient<any, any, any>,
  nowIso: string
): Promise<boolean> {
  await supabaseAdmin.from('geoportal_sync_estado').upsert(
    {
      camada: GLOBAL_STATE_KEY,
      proximo_start_index: 0,
      status: 'ocioso',
      registros_sincronizados: 0
    },
    { onConflict: 'camada', ignoreDuplicates: true }
  );

  const staleThresholdIso = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('geoportal_sync_estado')
    .update({
      status: 'em_andamento',
      iniciado_em: nowIso,
      concluido_em: null,
      mensagem: 'Sincronização em andamento...'
    })
    .eq('camada', GLOBAL_STATE_KEY)
    .or(`status.neq.em_andamento,iniciado_em.lt.${staleThresholdIso},iniciado_em.is.null`)
    .select('camada');

  if (error) {
    throw new Error(`Falha ao adquirir controle de concorrência no banco: ${error.message}`);
  }

  return Array.isArray(data) && data.length > 0;
}

async function releaseDbSyncLock(
  supabaseAdmin: SupabaseClient<any, any, any>,
  payload: {
    status: SyncStatusValue;
    registrosSincronizados: number;
    concluidoEm: string;
    ultimoSucessoEm?: string | null;
    mensagem: string;
  }
): Promise<void> {
  await supabaseAdmin
    .from('geoportal_sync_estado')
    .update({
      status: payload.status,
      registros_sincronizados: payload.registrosSincronizados,
      concluido_em: payload.concluidoEm,
      ...(payload.ultimoSucessoEm ? { ultimo_sucesso_em: payload.ultimoSucessoEm } : {}),
      mensagem: sanitizeServerMessage(payload.mensagem)
    })
    .eq('camada', GLOBAL_STATE_KEY);
}

async function readPersistedSyncStatus(
  supabaseAdmin: SupabaseClient<any, any, any> | null
): Promise<{
  ultimaSincronizacao: string;
  status: SyncStatusValue;
  registrosSincronizados: number;
  camadasProcessadas: string[];
  mensagem: string;
  camadasEstado?: Array<{
    camada: string;
    status: string;
    proximoStartIndex: number;
    registrosSincronizados: number;
    ultimoSucessoEm?: string | null;
    mensagem?: string | null;
  }>;
}> {
  if (!supabaseAdmin) {
    return {
      ultimaSincronizacao: '',
      status: 'ocioso',
      registrosSincronizados: 0,
      camadasProcessadas: [],
      mensagem: 'Banco de estado indisponível no servidor.'
    };
  }

  const { data: rows, error } = await supabaseAdmin
    .from('geoportal_sync_estado')
    .select('camada, proximo_start_index, status, registros_sincronizados, iniciado_em, concluido_em, ultimo_sucesso_em, mensagem');

  if (error || !Array.isArray(rows) || rows.length === 0) {
    return {
      ultimaSincronizacao: '',
      status: 'ocioso',
      registrosSincronizados: 0,
      camadasProcessadas: [],
      mensagem: error ? 'Tabela de estado da sincronização ainda não inicializada.' : 'Nenhuma sincronização registrada.'
    };
  }

  const globalRow = rows.find(r => r.camada === GLOBAL_STATE_KEY);
  const layerRows = rows.filter(r => r.camada !== GLOBAL_STATE_KEY);

  const isGlobalLockActive =
    globalRow?.status === 'em_andamento' &&
    globalRow?.iniciado_em &&
    Date.now() - new Date(globalRow.iniciado_em).getTime() < LOCK_STALE_MS;

  let derivedStatus: SyncStatusValue = 'ocioso';
  if (isGlobalLockActive) {
    derivedStatus = 'em_andamento';
  } else if (globalRow?.status && ['sucesso', 'parcial', 'falha', 'ocioso'].includes(globalRow.status)) {
    derivedStatus = globalRow.status as SyncStatusValue;
  } else if (layerRows.length > 0) {
    const hasParcial = layerRows.some(r => r.status === 'parcial');
    const hasSucesso = layerRows.some(r => r.status === 'sucesso');
    const hasFalha = layerRows.some(r => r.status === 'falha');
    if (hasParcial || (hasSucesso && hasFalha)) derivedStatus = 'parcial';
    else if (hasSucesso) derivedStatus = 'sucesso';
    else if (hasFalha) derivedStatus = 'falha';
  }

  const totalRegistros = layerRows.reduce(
    (acc, r) => acc + (Number(r.registros_sincronizados) || 0),
    0
  ) || Number(globalRow?.registros_sincronizados || 0);

  const camadasProcessadas = layerRows
    .filter(r => r.status === 'sucesso' || r.status === 'parcial')
    .map(r => r.camada);

  const ultimaSincronizacao =
    globalRow?.ultimo_sucesso_em ||
    globalRow?.concluido_em ||
    layerRows
      .map(r => r.ultimo_sucesso_em || r.concluido_em)
      .filter(Boolean)
      .sort()
      .reverse()[0] ||
    '';

  return {
    ultimaSincronizacao,
    status: derivedStatus,
    registrosSincronizados: totalRegistros,
    camadasProcessadas,
    mensagem: globalRow?.mensagem || '',
    camadasEstado: layerRows.map(r => ({
      camada: r.camada,
      status: r.status,
      proximoStartIndex: Number(r.proximo_start_index || 0),
      registrosSincronizados: Number(r.registros_sincronizados || 0),
      ultimoSucessoEm: r.ultimo_sucesso_em,
      mensagem: r.mensagem
    }))
  };
}

async function executarSincronizacaoPaginada(
  supabaseAdmin: SupabaseClient<any, any, any>
): Promise<{
  sucesso: boolean;
  status: SyncStatusValue;
  totalRegistros: number;
  camadas: string[];
  detalhes: string;
}> {
  const runStartedAt = Date.now();
  const confirmedWfsLayers = await getConfirmedWfsLayers();
  const camadasAlvo = TARGET_SYNC_LAYERS.filter(l => confirmedWfsLayers.has(l));

  if (camadasAlvo.length === 0) {
    throw new Error('Nenhuma camada alvo confirmada no WFS GetCapabilities atual.');
  }

  // Lê pontos de retomada existentes no banco
  const { data: existingStates } = await supabaseAdmin
    .from('geoportal_sync_estado')
    .select('*')
    .in('camada', [...camadasAlvo]);

  const stateMap = new Map<string, any>();
  for (const row of existingStates || []) {
    stateMap.set(row.camada, row);
  }

  let totalRegistrosNestaExecucao = 0;
  const camadasConcluidas: string[] = [];
  const camadasParciais: string[] = [];
  const camadasComFalha: string[] = [];
  let timeBudgetReached = false;

  const candidateGroupsForSync: string[][] = [
    SEMA_FIELD_CANDIDATES.featureId,
    SEMA_FIELD_CANDIDATES.sortId,
    SEMA_FIELD_CANDIDATES.carEstadual,
    SEMA_FIELD_CANDIDATES.carFederal,
    SEMA_FIELD_CANDIDATES.protocolo,
    SEMA_FIELD_CANDIDATES.nomePropriedade,
    SEMA_FIELD_CANDIDATES.titular,
    SEMA_FIELD_CANDIDATES.documento,
    SEMA_FIELD_CANDIDATES.municipioCodigo,
    SEMA_FIELD_CANDIDATES.municipioNome,
    SEMA_FIELD_CANDIDATES.situacaoCar,
    SEMA_FIELD_CANDIDATES.areaHa,
    SEMA_FIELD_CANDIDATES.numeroProcesso,
    SEMA_FIELD_CANDIDATES.tipoDocumento,
    SEMA_FIELD_CANDIDATES.numeroDocumento,
    SEMA_FIELD_CANDIDATES.statusDocumento,
    SEMA_FIELD_CANDIDATES.linkDocumento
  ];

  for (const camada of camadasAlvo) {
    if (Date.now() - runStartedAt >= MAX_EXECUTION_MS) {
      timeBudgetReached = true;
      break;
    }

    const prevState = stateMap.get(camada);
    let startIndex =
      prevState?.status === 'parcial' && Number(prevState?.proximo_start_index) > 0
        ? Number(prevState.proximo_start_index)
        : 0;
    let acumuladoCamada =
      startIndex > 0 ? Number(prevState?.registros_sincronizados || 0) : 0;

    const layerStartedIso = new Date().toISOString();

    await supabaseAdmin.from('geoportal_sync_estado').upsert(
      {
        camada,
        proximo_start_index: startIndex,
        status: 'em_andamento',
        registros_sincronizados: acumuladoCamada,
        iniciado_em: layerStartedIso,
        mensagem: `Sincronizando a partir de startIndex=${startIndex}...`
      },
      { onConflict: 'camada' }
    );

    try {
      const schema = await describeLayerSchemaXml(camada);
      if (!schema.ok) {
        camadasComFalha.push(camada);
        await supabaseAdmin.from('geoportal_sync_estado').upsert(
          {
            camada,
            proximo_start_index: startIndex,
            status: 'falha',
            registros_sincronizados: acumuladoCamada,
            concluido_em: new Date().toISOString(),
            mensagem: schema.errorMsg || 'Falha ao inspecionar esquema XML da camada.'
          },
          { onConflict: 'camada' }
        );
        continue;
      }

      const propertyNames = collectConfirmedPropertyNames(
        schema.fields,
        schema.geomFields,
        candidateGroupsForSync
      );

      // Ordenação por atributo estável confirmado no esquema XML (evita falhas de paginação)
      const confirmedSortCandidates = resolveConfirmedFields(
        schema.fields,
        SEMA_FIELD_CANDIDATES.sortId
      ).filter(f => !schema.geomFields.has(f));
      const fallbackSortField = Array.from(schema.fields.keys()).find(
        k => !schema.geomFields.has(k)
      );
      const sortField = confirmedSortCandidates[0] || fallbackSortField;

      const confirmedDocFields = resolveConfirmedFields(
        schema.fields,
        SEMA_FIELD_CANDIDATES.documento
      );
      const confirmedIdFields = resolveConfirmedFields(
        schema.fields,
        SEMA_FIELD_CANDIDATES.featureId
      );

      let layerExhausted = false;
      let layerErrored = false;
      let layerErrorMsg = '';

      while (!layerExhausted) {
        if (Date.now() - runStartedAt >= MAX_EXECUTION_MS) {
          timeBudgetReached = true;
          break;
        }

        const params = new URLSearchParams({
          service: 'WFS',
          version: '2.0.0',
          request: 'GetFeature',
          typeNames: camada,
          outputFormat: 'application/json',
          count: String(PAGE_SIZE),
          startIndex: String(startIndex),
          authkey: GEOSERVER_AUTHKEY
        });

        if (sortField) {
          params.set('sortBy', `${sortField} ASC`);
        }
        if (propertyNames.length > 0) {
          params.set('propertyName', propertyNames.join(','));
        }

        const response = await fetchWithTimeout(`${WFS_URL}?${params.toString()}`, 15000);
        const bodyText = await response.text();

        if (!response.ok || /ExceptionReport/i.test(bodyText)) {
          layerErrored = true;
          layerErrorMsg = `GeoServer retornou HTTP ${response.status} em startIndex=${startIndex}.`;
          break;
        }

        let data: any;
        try {
          data = JSON.parse(bodyText);
        } catch {
          layerErrored = true;
          layerErrorMsg = `Resposta GeoJSON inválida em startIndex=${startIndex}.`;
          break;
        }

        const features = Array.isArray(data?.features) ? data.features : [];
        if (features.length === 0) {
          layerExhausted = true;
          break;
        }

        const nowIso = new Date().toISOString();
        const rowsToUpsert: any[] = [];

        for (const f of features) {
          const rawProps = f?.properties && typeof f.properties === 'object' ? f.properties : {};
          const fallbackPropId = extractConfirmedFieldValue(
            rawProps,
            schema.fields,
            confirmedIdFields
          );
          const featureId = f?.id
            ? String(f.id).trim()
            : fallbackPropId
            ? `${camada}.${fallbackPropId}`
            : '';

          if (!featureId) continue;

          // Sanitiza CPF/CNPJ antes de persistir no cache
          const sanitizedRawProps = sanitizeSemaProperties(rawProps, confirmedDocFields);

          const munCodRaw = extractConfirmedFieldValue(
            sanitizedRawProps,
            schema.fields,
            SEMA_FIELD_CANDIDATES.municipioCodigo
          );
          const munCodNum =
            munCodRaw && !isNaN(Number(munCodRaw)) ? Number(munCodRaw) : null;

          const areaRaw = extractConfirmedFieldValue(
            sanitizedRawProps,
            schema.fields,
            SEMA_FIELD_CANDIDATES.areaHa
          );
          const areaNum = areaRaw && !isNaN(Number(areaRaw)) ? Number(areaRaw) : null;

          const rawLink = extractConfirmedFieldValue(
            sanitizedRawProps,
            schema.fields,
            SEMA_FIELD_CANDIDATES.linkDocumento
          );
          const safeLink = rawLink && /^https?:\/\/\S+$/i.test(rawLink) ? rawLink : null;

          rowsToUpsert.push({
            id: `${camada}::${featureId}`,
            camada,
            feature_id: featureId,
            numero_estadual:
              extractConfirmedFieldValue(
                sanitizedRawProps,
                schema.fields,
                SEMA_FIELD_CANDIDATES.carEstadual
              ) || null,
            car_federal:
              extractConfirmedFieldValue(
                sanitizedRawProps,
                schema.fields,
                SEMA_FIELD_CANDIDATES.carFederal
              ) || null,
            protocolo:
              extractConfirmedFieldValue(
                sanitizedRawProps,
                schema.fields,
                SEMA_FIELD_CANDIDATES.protocolo
              ) || null,
            nome_propriedade:
              extractConfirmedFieldValue(
                sanitizedRawProps,
                schema.fields,
                SEMA_FIELD_CANDIDATES.nomePropriedade
              ) || null,
            nome_proprietario:
              extractConfirmedFieldValue(
                sanitizedRawProps,
                schema.fields,
                SEMA_FIELD_CANDIDATES.titular
              ) || null,
            municipio_codigo: munCodNum,
            municipio_nome:
              extractConfirmedFieldValue(
                sanitizedRawProps,
                schema.fields,
                SEMA_FIELD_CANDIDATES.municipioNome
              ) || null,
            situacao_car:
              extractConfirmedFieldValue(
                sanitizedRawProps,
                schema.fields,
                SEMA_FIELD_CANDIDATES.situacaoCar
              ) || null,
            area_ha: areaNum,
            numero_processo:
              extractConfirmedFieldValue(
                sanitizedRawProps,
                schema.fields,
                SEMA_FIELD_CANDIDATES.numeroProcesso
              ) || null,
            tipo_documento:
              extractConfirmedFieldValue(
                sanitizedRawProps,
                schema.fields,
                SEMA_FIELD_CANDIDATES.tipoDocumento
              ) || null,
            numero_documento:
              extractConfirmedFieldValue(
                sanitizedRawProps,
                schema.fields,
                SEMA_FIELD_CANDIDATES.numeroDocumento
              ) || null,
            status_documento:
              extractConfirmedFieldValue(
                sanitizedRawProps,
                schema.fields,
                SEMA_FIELD_CANDIDATES.statusDocumento
              ) || null,
            link_documento: safeLink,
            raw_properties: sanitizedRawProps,
            sincronizado_em: nowIso
          });
        }

        if (rowsToUpsert.length > 0) {
          const { error: upsertErr } = await supabaseAdmin
            .from('geoportal_sync_cache')
            .upsert(rowsToUpsert, { onConflict: 'camada,feature_id' });
          if (upsertErr) {
            layerErrored = true;
            layerErrorMsg = `Falha ao gravar lote no cache: ${upsertErr.message}`;
            break;
          }
          totalRegistrosNestaExecucao += rowsToUpsert.length;
          acumuladoCamada += rowsToUpsert.length;
        }

        startIndex += features.length;

        // Salva progresso incremental no banco para retomada segura
        await supabaseAdmin.from('geoportal_sync_estado').upsert(
          {
            camada,
            proximo_start_index: startIndex,
            status: 'parcial',
            registros_sincronizados: acumuladoCamada,
            mensagem: `Lote gravado até startIndex=${startIndex}.`
          },
          { onConflict: 'camada' }
        );

        if (features.length < PAGE_SIZE) {
          layerExhausted = true;
        }
      }

      const finishedIso = new Date().toISOString();
      if (layerExhausted) {
        camadasConcluidas.push(camada);
        await supabaseAdmin.from('geoportal_sync_estado').upsert(
          {
            camada,
            proximo_start_index: 0,
            status: 'sucesso',
            registros_sincronizados: acumuladoCamada,
            concluido_em: finishedIso,
            ultimo_sucesso_em: finishedIso,
            mensagem: `Camada sincronizada integralmente (${acumuladoCamada} registro(s)).`
          },
          { onConflict: 'camada' }
        );
      } else if (layerErrored) {
        camadasComFalha.push(camada);
        await supabaseAdmin.from('geoportal_sync_estado').upsert(
          {
            camada,
            proximo_start_index: startIndex,
            status: acumuladoCamada > 0 ? 'parcial' : 'falha',
            registros_sincronizados: acumuladoCamada,
            concluido_em: finishedIso,
            mensagem: sanitizeServerMessage(layerErrorMsg)
          },
          { onConflict: 'camada' }
        );
      } else {
        camadasParciais.push(camada);
        await supabaseAdmin.from('geoportal_sync_estado').upsert(
          {
            camada,
            proximo_start_index: startIndex,
            status: 'parcial',
            registros_sincronizados: acumuladoCamada,
            concluido_em: finishedIso,
            mensagem: `Limite de tempo atingido; retomará em startIndex=${startIndex}.`
          },
          { onConflict: 'camada' }
        );
      }
    } catch (err: any) {
      camadasComFalha.push(camada);
      await supabaseAdmin.from('geoportal_sync_estado').upsert(
        {
          camada,
          proximo_start_index: startIndex,
          status: acumuladoCamada > 0 ? 'parcial' : 'falha',
          registros_sincronizados: acumuladoCamada,
          concluido_em: new Date().toISOString(),
          mensagem: sanitizeServerMessage(err?.message || 'Erro inesperado durante sincronização da camada.')
        },
        { onConflict: 'camada' }
      );
    }
  }

  const allCompleted =
    camadasConcluidas.length === camadasAlvo.length &&
    camadasParciais.length === 0 &&
    camadasComFalha.length === 0 &&
    !timeBudgetReached;

  const anyProgress =
    camadasConcluidas.length > 0 ||
    camadasParciais.length > 0 ||
    totalRegistrosNestaExecucao > 0;

  let finalStatus: SyncStatusValue;
  if (allCompleted) {
    finalStatus = 'sucesso';
  } else if (anyProgress) {
    finalStatus = 'parcial';
  } else {
    finalStatus = 'falha';
  }

  const camadasProcessadas = Array.from(new Set([...camadasConcluidas, ...camadasParciais]));
  const detalhes =
    finalStatus === 'sucesso'
      ? `Sincronização completa concluída em ${camadasConcluidas.length} camada(s) (${totalRegistrosNestaExecucao} registro(s) processado(s) nesta execução).`
      : finalStatus === 'parcial'
      ? `Sincronização parcial: ${camadasConcluidas.length} camada(s) concluída(s), ${camadasParciais.length} pausada(s) para retomada e ${camadasComFalha.length} com falha (${totalRegistrosNestaExecucao} registro(s) nesta execução).`
      : `Falha na sincronização: nenhuma camada pôde ser sincronizada (${camadasComFalha.length} camada(s) com erro).`;

  return {
    sucesso: finalStatus === 'sucesso',
    status: finalStatus,
    totalRegistros: totalRegistrosNestaExecucao,
    camadas: camadasProcessadas,
    detalhes
  };
}

function sendJson(res: VercelLikeResponse, statusCode: number, data: any): void {
  const statusFn = typeof res.status === 'function' ? res.status.bind(res) : null;
  const jsonFn = typeof res.json === 'function' ? res.json.bind(res) : null;
  if (statusFn && jsonFn) {
    statusFn(statusCode);
    jsonFn(data);
    return;
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function runSyncFlow(
  supabaseAdmin: SupabaseClient<any, any, any> | null,
  res: VercelLikeResponse
): Promise<void> {
  const cacheCheck = await verificarTabelasCache(supabaseAdmin);
  if (!cacheCheck.ok || !supabaseAdmin) {
    sendJson(res, 412, {
      sucesso: false,
      sincronizadoEm: new Date().toISOString(),
      registrosProcessados: 0,
      camadas: [],
      status: 'falha',
      error: cacheCheck.errorMsg,
      mensagemErro: cacheCheck.errorMsg
    });
    return;
  }

  const nowIso = new Date().toISOString();
  let lockAcquired = false;

  try {
    lockAcquired = await acquireDbSyncLock(supabaseAdmin, nowIso);
  } catch (err: any) {
    sendJson(res, 500, {
      sucesso: false,
      status: 'falha',
      error: sanitizeServerMessage(err?.message || 'Falha ao controlar concorrência no banco.'),
      mensagemErro: sanitizeServerMessage(err?.message || 'Falha ao controlar concorrência no banco.')
    });
    return;
  }

  if (!lockAcquired) {
    sendJson(res, 409, {
      sucesso: false,
      error: 'Sincronização já está em andamento em outra execução. Aguarde a conclusão.',
      mensagemErro: 'Sincronização já está em andamento em outra execução. Aguarde a conclusão.',
      status: 'em_andamento'
    });
    return;
  }

  try {
    const resultado = await executarSincronizacaoPaginada(supabaseAdmin);
    const agora = new Date().toISOString();

    await releaseDbSyncLock(supabaseAdmin, {
      status: resultado.status,
      registrosSincronizados: resultado.totalRegistros,
      concluidoEm: agora,
      ultimoSucessoEm: resultado.status === 'sucesso' || resultado.status === 'parcial' ? agora : null,
      mensagem: resultado.detalhes
    });

    const httpCode = resultado.status === 'falha' ? 502 : 200;
    sendJson(res, httpCode, {
      sucesso: resultado.sucesso,
      sincronizadoEm: agora,
      registrosProcessados: resultado.totalRegistros,
      camadas: resultado.camadas,
      status: resultado.status,
      mensagem: resultado.detalhes,
      mensagemErro: resultado.status === 'falha' ? resultado.detalhes : undefined
    });
  } catch (err: any) {
    const agora = new Date().toISOString();
    const errMsg = sanitizeServerMessage(err?.message || 'Falha durante a sincronização com o Geoportal.');
    await releaseDbSyncLock(supabaseAdmin, {
      status: 'falha',
      registrosSincronizados: 0,
      concluidoEm: agora,
      mensagem: errMsg
    }).catch(() => {});

    sendJson(res, 502, {
      sucesso: false,
      sincronizadoEm: agora,
      registrosProcessados: 0,
      camadas: [],
      status: 'falha',
      mensagemErro: errMsg
    });
  }
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  if (!res.status) {
    res.status = function (code: number) {
      res.statusCode = code;
      return res;
    };
  }
  if (!res.json) {
    res.json = function (data: any) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(data));
      return res;
    };
  }

  const rawAuth = req.headers['authorization'];
  const authHeader = Array.isArray(rawAuth) ? String(rawAuth[0] || '') : String(rawAuth || '');
  const cronSecret = (process.env.CRON_SECRET || '').trim();

  if (req.method === 'GET') {
    // Vercel Cron envia GET com Authorization: Bearer <CRON_SECRET>
    if (authHeader) {
      if (!cronSecret || !timingSafeBearerEquals(authHeader, cronSecret)) {
        sendJson(res, 401, {
          sucesso: false,
          status: 'falha',
          error: 'CRON_SECRET inválido ou não configurado.',
          mensagemErro: 'CRON_SECRET inválido ou não configurado.'
        });
        return;
      }

      const supabaseAdmin = getServerSupabaseClient();
      await runSyncFlow(supabaseAdmin, res);
      return;
    }

    // GET sem cabeçalho Authorization: apenas consulta o estado persistido no banco
    const supabaseAdmin = getServerSupabaseClient();
    const statusData = await readPersistedSyncStatus(supabaseAdmin);
    sendJson(res, 200, statusData);
    return;
  }

  if (req.method === 'POST') {
    const authCheck = await authorizeManualSync(req);
    if (!authCheck.authorized) {
      sendJson(res, authCheck.httpStatus, {
        sucesso: false,
        status: 'falha',
        error: authCheck.error,
        mensagemErro: authCheck.error
      });
      return;
    }

    await runSyncFlow(authCheck.supabaseAdmin, res);
    return;
  }

  sendJson(res, 405, {
    error: 'Método não permitido. Utilize GET para status/cron ou POST autenticado para sincronização manual.'
  });
}
