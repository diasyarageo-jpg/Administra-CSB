// api/v2/empreendedores.ts
import {
  EMPREENDEDORES_SELECT_COLUMNS,
  encodeV2Cursor,
  mapEmpreendedorRowToV2Dto,
  parseV2PaginationParams,
  sendV2Json,
  sendV2Unavailable,
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

const REQUIRED_SCOPE = 'empreendedores:read';

export default async function handler(
  req: S2sRequestLike,
  res: VercelLikeResponse
): Promise<void> {
  const method = String(req?.method || 'GET').trim().toUpperCase();

  if (method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendV2Json(res, 405, {
      success: false,
      error: 'Método não permitido. Utilize GET.'
    });
    return;
  }

  const auth = await authenticateS2sRequest(req, {
    requiredScope: REQUIRED_SCOPE
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

  const pagination = parseV2PaginationParams(req, 'empreendedores');
  if (pagination.ok === false) {
    sendV2Json(res, 400, {
      success: false,
      error: pagination.error
    });
    return;
  }

  try {
    let query = auth.supabaseAdmin
      .from('empreendedores')
      .select(EMPREENDEDORES_SELECT_COLUMNS.join(', '));

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
    const items = pageRows.map(row => mapEmpreendedorRowToV2Dto(row as Record<string, any>));

    const nextCursor =
      hasMore && items.length > 0
        ? encodeV2Cursor('empreendedores', items[items.length - 1].id)
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
