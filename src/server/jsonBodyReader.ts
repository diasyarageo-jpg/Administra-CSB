// src/server/jsonBodyReader.ts
export type JsonBodyReaderErrorCode =
  | 'INVALID_CONTENT_LENGTH'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_STREAM'
  | 'INVALID_CHUNK'
  | 'INVALID_UTF8'
  | 'STREAM_ABORTED'
  | 'STREAM_ERROR'
  | 'BODY_TIMEOUT'
  | 'INVALID_JSON'
  | 'INVALID_JSON_OBJECT';

export class JsonBodyReaderError extends Error {
  readonly statusCode: number;
  readonly code: JsonBodyReaderErrorCode;

  constructor(statusCode: number, message: string, code: JsonBodyReaderErrorCode) {
    super(message);
    this.name = 'JsonBodyReaderError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface StreamReadableLike {
  headers?: Record<string, string | string[] | undefined>;
  complete?: boolean;
  on?: (event: string, listener: (...args: any[]) => void) => any;
  off?: (event: string, listener: (...args: any[]) => void) => any;
  removeListener?: (event: string, listener: (...args: any[]) => void) => any;
}

export interface ReadRawBodyOptions {
  maxBytes?: number;
  timeoutMs?: number;
  payloadTooLargeMessage?: string;
  invalidChunkMessage?: string;
  invalidContentLengthMessage?: string;
  timeoutMessage?: string;
  abortedMessage?: string;
  streamErrorMessage?: string;
  streamUnavailableMessage?: string;
}

export interface ReadJsonObjectBodyOptions {
  maxBytes?: number;
  timeoutMs?: number;
  allowEmpty?: boolean;
  payloadTooLargeMessage?: string;
  invalidJsonMessage?: string;
  invalidObjectMessage?: string;
  invalidContentLengthMessage?: string;
  timeoutMessage?: string;
  abortedMessage?: string;
  streamErrorMessage?: string;
  streamUnavailableMessage?: string;
}

export const DEFAULT_JSON_BODY_MAX_BYTES = 16 * 1024;
export const DEFAULT_JSON_BODY_TIMEOUT_MS = 10_000;

const noopErrorListener = () => {};

function getHeaderCaseInsensitive(
  headers: Record<string, string | string[] | undefined> | undefined,
  targetName: string
): string | string[] | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const lowerTarget = targetName.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(headers, lowerTarget)) {
    return headers[lowerTarget];
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowerTarget) {
      return headers[key];
    }
  }
  return undefined;
}

function validateDeclaredContentLength(
  headers: Record<string, string | string[] | undefined> | undefined,
  maxBytes: number,
  invalidContentLengthMessage: string,
  payloadTooLargeMessage: string
): void {
  const rawHeader = getHeaderCaseInsensitive(headers, 'content-length');
  if (rawHeader === undefined) return;

  let normalizedValue = '';
  if (Array.isArray(rawHeader)) {
    if (rawHeader.length === 0) {
      throw new JsonBodyReaderError(400, invalidContentLengthMessage, 'INVALID_CONTENT_LENGTH');
    }
    const items = rawHeader.map(v => String(v ?? '').trim());
    for (const item of items) {
      if (!/^\d+$/.test(item)) {
        throw new JsonBodyReaderError(400, invalidContentLengthMessage, 'INVALID_CONTENT_LENGTH');
      }
    }
    if (new Set(items).size > 1) {
      throw new JsonBodyReaderError(400, invalidContentLengthMessage, 'INVALID_CONTENT_LENGTH');
    }
    normalizedValue = items[0];
  } else if (typeof rawHeader === 'string') {
    normalizedValue = rawHeader.trim();
    if (!/^\d+$/.test(normalizedValue)) {
      throw new JsonBodyReaderError(400, invalidContentLengthMessage, 'INVALID_CONTENT_LENGTH');
    }
  } else {
    throw new JsonBodyReaderError(400, invalidContentLengthMessage, 'INVALID_CONTENT_LENGTH');
  }

  const declaredBytes = Number(normalizedValue);
  if (Number.isNaN(declaredBytes) || declaredBytes < 0) {
    throw new JsonBodyReaderError(400, invalidContentLengthMessage, 'INVALID_CONTENT_LENGTH');
  }
  if (declaredBytes > maxBytes) {
    throw new JsonBodyReaderError(413, payloadTooLargeMessage, 'PAYLOAD_TOO_LARGE');
  }
}

export async function readRawBodyBuffer(
  req: StreamReadableLike,
  options: ReadRawBodyOptions = {}
): Promise<Buffer> {
  const maxBytes =
    typeof options.maxBytes === 'number' && Number.isFinite(options.maxBytes) && options.maxBytes > 0
      ? Math.floor(options.maxBytes)
      : DEFAULT_JSON_BODY_MAX_BYTES;
  const timeoutMs =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? Math.floor(options.timeoutMs)
      : DEFAULT_JSON_BODY_TIMEOUT_MS;

  const payloadTooLargeMessage =
    options.payloadTooLargeMessage || 'Requisição excede o tamanho máximo permitido.';
  const invalidChunkMessage = options.invalidChunkMessage || 'Corpo JSON inválido.';
  const invalidContentLengthMessage =
    options.invalidContentLengthMessage || 'Cabeçalho Content-Length inválido.';
  const timeoutMessage =
    options.timeoutMessage || 'Tempo limite esgotado ao ler o corpo da requisição.';
  const abortedMessage =
    options.abortedMessage || 'Conexão encerrada antes da conclusão do envio da requisição.';
  const streamErrorMessage =
    options.streamErrorMessage || 'Falha ao ler o corpo da requisição.';
  const streamUnavailableMessage =
    options.streamUnavailableMessage || 'Fluxo de leitura da requisição indisponível.';

  validateDeclaredContentLength(
    req?.headers,
    maxBytes,
    invalidContentLengthMessage,
    payloadTooLargeMessage
  );

  if (!req || typeof req.on !== 'function') {
    throw new JsonBodyReaderError(400, streamUnavailableMessage, 'INVALID_STREAM');
  }

  const on = req.on.bind(req);

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const removeListenerSafe = (event: string, listener: (...args: any[]) => void) => {
      try {
        if (typeof req.off === 'function') {
          req.off(event, listener);
        } else if (typeof req.removeListener === 'function') {
          req.removeListener(event, listener);
        }
      } catch {
        // Ignora falhas de remoção em mocks customizados
      }
    };

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      removeListenerSafe('data', onData);
      removeListenerSafe('end', onEnd);
      removeListenerSafe('error', onError);
      removeListenerSafe('close', onClose);
      if (typeof req.on === 'function') {
        try {
          req.on('error', noopErrorListener);
        } catch {
          // Ignora falhas ao anexar no-op em mocks customizados
        }
      }
    };

    const finish = (err?: Error, value?: Buffer) => {
      if (settled) return;
      settled = true;
      cleanup();
      const result = err ? undefined : value ?? Buffer.concat(chunks, totalBytes);
      chunks.length = 0;
      if (err) {
        reject(err);
        return;
      }
      resolve(result as Buffer);
    };

    const onData = (chunk: unknown) => {
      if (settled) return;
      let buf: Buffer;
      if (Buffer.isBuffer(chunk)) {
        buf = chunk;
      } else if (chunk instanceof Uint8Array) {
        buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      } else {
        finish(new JsonBodyReaderError(400, invalidChunkMessage, 'INVALID_CHUNK'));
        return;
      }

      totalBytes += buf.byteLength;
      if (totalBytes > maxBytes) {
        finish(new JsonBodyReaderError(413, payloadTooLargeMessage, 'PAYLOAD_TOO_LARGE'));
        return;
      }

      if (buf.byteLength > 0) {
        chunks.push(buf);
      }
    };

    const onEnd = () => {
      if (settled) return;
      try {
        finish(undefined, Buffer.concat(chunks, totalBytes));
      } catch {
        finish(new JsonBodyReaderError(400, invalidChunkMessage, 'INVALID_JSON'));
      }
    };

    const onError = () => {
      finish(new JsonBodyReaderError(400, streamErrorMessage, 'STREAM_ERROR'));
    };

    const onClose = () => {
      if (req.complete === false) {
        finish(new JsonBodyReaderError(400, abortedMessage, 'STREAM_ABORTED'));
      }
    };

    timer = setTimeout(() => {
      finish(new JsonBodyReaderError(408, timeoutMessage, 'BODY_TIMEOUT'));
    }, timeoutMs);

    on('error', onError);
    if (settled) return;
    on('close', onClose);
    if (settled) return;
    on('end', onEnd);
    if (settled) return;
    on('data', onData);
  });
}

const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export function decodeStrictUtf8(
  rawBuffer: Buffer | Uint8Array,
  invalidUtf8Message = 'Codificação UTF-8 inválida no corpo da requisição.'
): string {
  try {
    return STRICT_UTF8_DECODER.decode(rawBuffer);
  } catch {
    throw new JsonBodyReaderError(400, invalidUtf8Message, 'INVALID_UTF8');
  }
}

export function parseStrictUtf8JsonObject(
  rawBuffer: Buffer | Uint8Array,
  options: {
    allowEmpty?: boolean;
    invalidUtf8Message?: string;
    invalidJsonMessage?: string;
    invalidObjectMessage?: string;
  } = {}
): Record<string, any> {
  const allowEmpty = options.allowEmpty ?? true;
  const invalidJsonMessage = options.invalidJsonMessage || 'Corpo JSON inválido.';
  const invalidObjectMessage =
    options.invalidObjectMessage || 'O corpo da requisição deve ser um objeto JSON válido.';

  const decoded = decodeStrictUtf8(
    rawBuffer,
    options.invalidUtf8Message || invalidJsonMessage
  );
  const raw = decoded.trim();

  if (!raw) {
    if (allowEmpty) {
      return {};
    }
    throw new JsonBodyReaderError(400, invalidObjectMessage, 'INVALID_JSON_OBJECT');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new JsonBodyReaderError(400, invalidJsonMessage, 'INVALID_JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new JsonBodyReaderError(400, invalidObjectMessage, 'INVALID_JSON_OBJECT');
  }

  return parsed as Record<string, any>;
}

export async function readJsonObjectBody(
  req: StreamReadableLike,
  options: ReadJsonObjectBodyOptions = {}
): Promise<Record<string, any>> {
  const allowEmpty = options.allowEmpty ?? true;
  const invalidJsonMessage = options.invalidJsonMessage || 'Corpo JSON inválido.';
  const invalidObjectMessage =
    options.invalidObjectMessage || 'O corpo da requisição deve ser um objeto JSON válido.';

  const rawBuffer = await readRawBodyBuffer(req, {
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs,
    payloadTooLargeMessage: options.payloadTooLargeMessage,
    invalidChunkMessage: invalidJsonMessage,
    invalidContentLengthMessage: options.invalidContentLengthMessage,
    timeoutMessage: options.timeoutMessage,
    abortedMessage: options.abortedMessage,
    streamErrorMessage: options.streamErrorMessage,
    streamUnavailableMessage: options.streamUnavailableMessage
  });

  return parseStrictUtf8JsonObject(rawBuffer, {
    allowEmpty,
    invalidUtf8Message: invalidJsonMessage,
    invalidJsonMessage,
    invalidObjectMessage
  });
}
