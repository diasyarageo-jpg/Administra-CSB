// api/v2/[resource].ts
import {
  BARRAGENS_SELECT_COLUMNS,
  EMPREENDEDORES_SELECT_COLUMNS,
  encodeV2Cursor,
  mapBarragemRowToV2Dto,
  mapEmpreendedorRowToV2Dto,
  parseV2PaginationParams,
  sendV2Json,
  sendV2Unavailable,
  type BarragemV2Dto,
  type EmpreendedorV2Dto,
  type V2CatalogResource,
  type VercelLikeResponse
} from '../../src/server/apiV2Catalog.js';
import {
  authenticateS2sRequest,
  type S2sRequestLike
} from '../../src/server/s2sAuth.js';

export const config = {
  api: {
    bodyParser: false
  }
};

export interface V2ResourceRequest extends S2sRequestLike {
  query?: Record<string, string | string[] | undefined>;
}

interface CatalogResourceSpec {
  requiredScope: 'barragens:read' | 'empreendedores:read';
  table: 'barragens' | 'empreendedores';
  selectColumns: readonly string[];
  mapRow: (row: Record<string, any>) => BarragemV2Dto | EmpreendedorV2Dto;
}

const RESOURCE_SPECS: Record<V2CatalogResource, CatalogResourceSpec> = {
  barragens: {
    requiredScope: 'barragens:read',
    table: 'barragens',
    selectColumns: BARRAGENS_SELECT_COLUMNS,
    mapRow: mapBarragemRowToV2Dto
  },
  empreendedores: {
    requiredScope: 'empreendedores:read',
    table: 'empreendedores',
    selectColumns: EMPREENDEDORES_SELECT_COLUMNS,
    mapRow: mapEmpreendedorRowToV2Dto
  }
};

function isV2CatalogResource(value: unknown): value is V2CatalogResource {
  return value === 'barragens' || value === 'empreendedores';
}

export function resolveV2CatalogResource(req: V2ResourceRequest): V2CatalogResource | null {
  const rawUrl = String(req?.originalUrl || req?.url || '').trim();
  if (rawUrl) {
    let pathAndQuery = rawUrl;
    if (/^https?:\/\//i.test(rawUrl)) {
      const schemeEnd = rawUrl.indexOf('://') + 3;
      const firstSlash = rawUrl.indexOf('/', schemeEnd);
      const firstQuery = rawUrl.indexOf('?', schemeEnd);
      if (firstSlash === -1) {
        pathAndQuery = firstQuery === -1 ? '/' : `/${rawUrl.slice(firstQuery)}`;
      } else {
        pathAndQuery = rawUrl.slice(firstSlash);
      }
    }

    const qIdx = pathAndQuery.indexOf('?');
    const hashIdx = pathAndQuery.indexOf('#');
    const endIdx =
      qIdx === -1
        ? hashIdx === -1
          ? pathAndQuery.length
          : hashIdx
        : hashIdx === -1
        ? qIdx
        : Math.min(qIdx, hashIdx);
    const rawPath = pathAndQuery.slice(0, endIdx);

    const match = /^\/api\/v2\/([^/]+)\/?$/.exec(rawPath);
    if (match) {
      const segment = match[1];
      if (isV2CatalogResource(segment)) {
        return segment;
      }
      if (segment !== '[resource]' && segment !== '%5Bresource%5D') {
        return null;
      }
    } else if (rawPath && rawPath !== '/') {
      return null;
    }
  }

  const queryResource = req?.query?.resource;
  if (isV2CatalogResource(queryResource)) {
    return queryResource;
  }
  return null;
}

const CONTROL_CHARS_REGEX = /[\u0000-\u001f\u007f]/;

export function stripInternalVercelResourceParam(
  rawTarget: string,
  routeResource: V2CatalogResource
): string {
  const original = String(rawTarget || '/');
  const trimmed = original.trim();
  if (!trimmed || CONTROL_CHARS_REGEX.test(trimmed) || trimmed.includes('\\') || trimmed.includes('#')) {
    return original;
  }

  let originPrefix = '';
  let pathAndQuery = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    const schemeEnd = trimmed.indexOf('://') + 3;
    const firstSlash = trimmed.indexOf('/', schemeEnd);
    const firstQuery = trimmed.indexOf('?', schemeEnd);
    if (firstSlash === -1) {
      originPrefix = firstQuery === -1 ? trimmed : trimmed.slice(0, firstQuery);
      pathAndQuery = firstQuery === -1 ? '/' : `/${trimmed.slice(firstQuery)}`;
    } else {
      originPrefix = trimmed.slice(0, firstSlash);
      pathAndQuery = trimmed.slice(firstSlash);
    }
  }

  const qIdx = pathAndQuery.indexOf('?');
  if (qIdx === -1) {
    return original;
  }

  const rawPath = pathAndQuery.slice(0, qIdx);
  const rawQuery = pathAndQuery.slice(qIdx + 1);
  if (!rawQuery) {
    return original;
  }

  const parts = rawQuery.split('&');
  let resourceParamCount = 0;
  let internalResourceIdx = -1;

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;

    const eqIdx = part.indexOf('=');
    const rawKey = eqIdx === -1 ? part : part.slice(0, eqIdx);
    const rawVal = eqIdx === -1 ? '' : part.slice(eqIdx + 1);

    let decodedKey: string;
    let decodedVal: string;
    try {
      decodedKey = decodeURIComponent(rawKey);
      decodedVal = decodeURIComponent(rawVal);
    } catch {
      return original;
    }

    if (decodedKey === 'resource') {
      resourceParamCount += 1;
      if (
        eqIdx !== -1 &&
        rawKey === 'resource' &&
        rawVal === routeResource &&
        decodedVal === routeResource
      ) {
        internalResourceIdx = i;
      }
    }
  }

  if (resourceParamCount !== 1 || internalResourceIdx === -1) {
    return original;
  }

  const publicQuery = parts.filter((_, idx) => idx !== internalResourceIdx).join('&');
  return `${originPrefix}${rawPath}${publicQuery ? `?${publicQuery}` : ''}`;
}

function createPublicV2Request(
  req: V2ResourceRequest,
  resource: V2CatalogResource
): V2ResourceRequest {
  const rawTarget = String(req?.originalUrl || req?.url || '/');
  const publicUrl = stripInternalVercelResourceParam(rawTarget, resource);
  if (publicUrl === rawTarget) {
    return req;
  }

  return new Proxy(req, {
    get(target, prop) {
      if (prop === 'url' || prop === 'originalUrl') {
        return publicUrl;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export default async function handler(
  req: V2ResourceRequest,
  res: VercelLikeResponse
): Promise<void> {
  const resource = resolveV2CatalogResource(req);
  if (!resource) {
    sendV2Json(res, 404, {
      success: false,
      error: 'Recurso não encontrado.'
    });
    return;
  }

  const spec = RESOURCE_SPECS[resource];
  const method = String(req?.method || 'GET').trim().toUpperCase();

  if (method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendV2Json(res, 405, {
      success: false,
      error: 'Método não permitido. Utilize GET.'
    });
    return;
  }

  const publicReq = createPublicV2Request(req, resource);

  const auth = await authenticateS2sRequest(publicReq, {
    requiredScope: spec.requiredScope
  });

  if (auth.ok === false) {
    if (auth.httpStatus === 503) {
      sendV2Unavailable(res);
      return;
    }
    sendV2Json(res, auth.httpStatus, {
      success: false,
      error: auth.error
    });
    return;
  }

  const pagination = parseV2PaginationParams(publicReq, resource);
  if (pagination.ok === false) {
    sendV2Json(res, 400, {
      success: false,
      error: pagination.error
    });
    return;
  }

  try {
    let query = auth.supabaseAdmin
      .from(spec.table)
      .select(spec.selectColumns.join(', '));

    if (pagination.cursorLastId !== null) {
      query = query.gt('id', pagination.cursorLastId);
    }

    const { data, error } = await query
      .order('id', { ascending: true })
      .limit(pagination.limit + 1);
    if (error || !Array.isArray(data)) {
      sendV2Unavailable(res);
      return;
    }

    const hasMore = data.length > pagination.limit;
    const pageRows = hasMore ? data.slice(0, pagination.limit) : data;
    const items = pageRows.map(row => spec.mapRow(row as Record<string, any>));

    const nextCursor =
      hasMore && items.length > 0
        ? encodeV2Cursor(resource, items[items.length - 1].id)
        : null;

    sendV2Json(res, 200, {
      success: true,
      apiVersion: '2.0',
      items,
      pagination: {
        limit: pagination.limit,
        hasMore,
        nextCursor
      },
      maskingPolicy: 'masked'
    });
  } catch {
    sendV2Unavailable(res);
  }
}
