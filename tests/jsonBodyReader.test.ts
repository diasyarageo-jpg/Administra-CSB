// tests/jsonBodyReader.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import carLookupHandler from '../api/car-lookup';
import {
  JsonBodyReaderError,
  readJsonObjectBody
} from '../src/server/jsonBodyReader';
import { setTestSupabaseAdminForSemaAudit } from '../src/server/semaAudit';

function createMockRes() {
  let statusCode = 200;
  let body: any = null;
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return headers[k.toLowerCase()];
    },
    status(code: number) {
      statusCode = code;
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      body = data;
      return res;
    },
    end(raw?: string) {
      if (raw && body === null) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      return res;
    },
    getStatus: () => statusCode,
    getBody: () => body
  };
  return res;
}

function createBodyTrapReq(base: Record<string, any>): any {
  Object.defineProperty(base, 'body', {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error('req.body NÃO deve ser acessado');
    }
  });
  return base;
}

function createVercelRestoreBodyMockReq(opts: {
  method?: string;
  headers?: Record<string, string | string[]>;
  rawBytes: Buffer;
  emitUnderlyingCloseBeforeEnd?: boolean;
}) {
  const originalReq = new EventEmitter() as any;
  originalReq.method = opts.method || 'POST';
  originalReq.url = '/api/car-lookup';
  originalReq.headers = opts.headers || {};
  originalReq.complete = true;
  originalReq.readableEnded = true;

  const replicateBody = new PassThrough();
  const on = replicateBody.on.bind(replicateBody);
  const originalOn = originalReq.on.bind(originalReq);

  originalReq.read = replicateBody.read.bind(replicateBody);
  originalReq.on = originalReq.addListener = (name: string, cb: (...args: any[]) => void) =>
    name === 'data' || name === 'end' ? on(name, cb) : originalOn(name, cb);

  replicateBody.write(opts.rawBytes);
  replicateBody.end();

  if (opts.emitUnderlyingCloseBeforeEnd) {
    queueMicrotask(() => {
      originalReq.emit('close');
    });
  }

  return createBodyTrapReq(originalReq);
}

test('readJsonObjectBody decodifica UTF-8 partido entre chunks sem corromper caracteres multibyte', async () => {
  const payloadText = JSON.stringify({
    fazenda: "São José d'Água — Conceição 🚀",
    lat: -15.6,
    lng: -56.1
  });
  const payloadBuf = Buffer.from(payloadText, 'utf8');
  // Divide no meio de um caractere multibyte UTF-8 ("ã" = 0xC3 0xA3)
  const splitIdx = payloadBuf.indexOf(Buffer.from('ã', 'utf8')) + 1;
  assert.ok(splitIdx > 1);

  const stream = createBodyTrapReq(new PassThrough());
  stream.write(payloadBuf.subarray(0, splitIdx));
  stream.end(payloadBuf.subarray(splitIdx));

  const parsed = await readJsonObjectBody(stream, { maxBytes: 16 * 1024 });
  assert.deepEqual(parsed, {
    fazenda: "São José d'Água — Conceição 🚀",
    lat: -15.6,
    lng: -56.1
  });
  assert.equal(stream.listenerCount('data'), 0);
  assert.equal(stream.listenerCount('end'), 0);
  assert.equal(stream.listenerCount('error'), 1);
  assert.equal(stream.listenerCount('close'), 0);
});

test('readJsonObjectBody aplica limite exato em bytes (16 KiB) e rejeita limite + 1 com 413', async () => {
  const maxBytes = 16 * 1024;
  const prefix = '{"texto":"';
  const suffix = '"}';
  const exactFillerBytes = maxBytes - Buffer.byteLength(prefix, 'utf8') - Buffer.byteLength(suffix, 'utf8');

  // Exatamente 16 KiB com UTF-8 multibyte (ex.: "á" = 2 bytes, mas length = 1 em UTF-16)
  const exactStream = createBodyTrapReq(new PassThrough());
  const exactStr = `${prefix}${'á'.repeat(exactFillerBytes / 2)}${suffix}`;
  const exactBuf = Buffer.from(exactStr, 'utf8');
  assert.equal(exactBuf.byteLength, maxBytes);
  exactStream.end(exactBuf);

  const okObj = await readJsonObjectBody(exactStream, { maxBytes });
  assert.equal(okObj.texto.length, exactFillerBytes / 2);

  // 16 KiB + 1 byte -> 413 (mesmo que string.length seja menor que 16384!)
  const overStream = createBodyTrapReq(new PassThrough());
  const overBuf = Buffer.concat([exactBuf.subarray(0, exactBuf.byteLength - 2), Buffer.from('a"}', 'utf8')]);
  assert.equal(overBuf.byteLength, maxBytes + 1);
  overStream.end(overBuf);

  await assert.rejects(
    readJsonObjectBody(overStream, { maxBytes }),
    (err: any) => err instanceof JsonBodyReaderError && err.statusCode === 413
  );
  assert.equal(overStream.listenerCount('data'), 0);
  assert.equal(overStream.listenerCount('end'), 0);
  assert.equal(overStream.listenerCount('error'), 1);
  assert.equal(overStream.listenerCount('close'), 0);
});

test('readJsonObjectBody valida Content-Length (inválido -> 400; acima do limite -> 413; exato -> OK)', async () => {
  for (const invalidCl of ['', '-1', '12.5', 'abc', ['10', '20']]) {
    const req = createBodyTrapReq({
      headers: { 'content-length': invalidCl },
      on: () => {
        throw new Error('Não deve anexar listeners para Content-Length inválido');
      }
    });
    await assert.rejects(
      readJsonObjectBody(req, { maxBytes: 16 * 1024 }),
      (err: any) => err instanceof JsonBodyReaderError && err.statusCode === 400
    );
  }

  const reqOver = createBodyTrapReq({
    headers: { 'Content-Length': String(16 * 1024 + 1) },
    on: () => {
      throw new Error('Não deve ler stream quando Content-Length excede limite');
    }
  });
  await assert.rejects(
    readJsonObjectBody(reqOver, { maxBytes: 16 * 1024 }),
    (err: any) => err instanceof JsonBodyReaderError && err.statusCode === 413
  );

  const payload = Buffer.from(JSON.stringify({ lat: -15.6, lng: -56.1 }), 'utf8');
  const reqExactCl = createBodyTrapReq(new PassThrough());
  reqExactCl.headers = { 'content-length': String(payload.byteLength) };
  reqExactCl.end(payload);
  const parsed = await readJsonObjectBody(reqExactCl, { maxBytes: 16 * 1024 });
  assert.deepEqual(parsed, { lat: -15.6, lng: -56.1 });
});

test('readJsonObjectBody rejeita JSON inválido, array, null e primitivos sem vazar mensagem do JSON.parse', async () => {
  const invalidCases = ['{invalido', '{"a": }', '[1,2,3]', 'null', '"texto"', '123', 'true'];
  for (const raw of invalidCases) {
    const stream = createBodyTrapReq(new PassThrough());
    stream.end(Buffer.from(raw, 'utf8'));

    await assert.rejects(
      readJsonObjectBody(stream, {
        maxBytes: 16 * 1024,
        invalidJsonMessage: 'Dados de consulta inválidos.',
        invalidObjectMessage: 'Dados de consulta inválidos.'
      }),
      (err: any) =>
        err instanceof JsonBodyReaderError &&
        err.statusCode === 400 &&
        err.message === 'Dados de consulta inválidos.' &&
        !/Unexpected|JSON|position|token/i.test(err.message)
    );
  }

  // Corpo vazio retorna {} quando allowEmpty=true
  const emptyStream = createBodyTrapReq(new PassThrough());
  emptyStream.end(Buffer.from('   \n  ', 'utf8'));
  const emptyResult = await readJsonObjectBody(emptyStream, { maxBytes: 16 * 1024, allowEmpty: true });
  assert.deepEqual(emptyResult, {});
});

test('readJsonObjectBody trata close apenas quando req.complete === false e suporta restoreBody da Vercel', async () => {
  // 1. close com req.complete === false antes de end -> 400 e limpa listeners
  const abortedReq = createBodyTrapReq(new EventEmitter());
  abortedReq.complete = false;
  const promiseAborted = readJsonObjectBody(abortedReq, { maxBytes: 16 * 1024, timeoutMs: 500 });
  abortedReq.emit('data', Buffer.from('{"lat":', 'utf8'));
  abortedReq.emit('close');

  await assert.rejects(
    promiseAborted,
    (err: any) =>
      err instanceof JsonBodyReaderError &&
      err.statusCode === 400 &&
      err.code === 'STREAM_ABORTED'
  );
  assert.equal(abortedReq.listenerCount('data'), 0);
  assert.equal(abortedReq.listenerCount('end'), 0);
  assert.equal(abortedReq.listenerCount('error'), 1);
  assert.equal(abortedReq.listenerCount('close'), 0);

  // 2. close com req.complete === true não interrompe stream já completo (ex.: restoreBody da Vercel)
  const vercelReq = createVercelRestoreBodyMockReq({
    rawBytes: Buffer.from(JSON.stringify({ lat: -14.5, lng: -56.2 }), 'utf8'),
    emitUnderlyingCloseBeforeEnd: true
  });
  const parsedVercel = await readJsonObjectBody(vercelReq, { maxBytes: 16 * 1024, timeoutMs: 500 });
  assert.deepEqual(parsedVercel, { lat: -14.5, lng: -56.2 });
});

test('readJsonObjectBody aplica timeout com finish idempotente e rejeita mock sem .on sem acessar req.body', async () => {
  // 1. Timeout + eventos tardios ignorados pelo finish idempotente
  const stalledReq = createBodyTrapReq(new EventEmitter());
  stalledReq.complete = false;
  const timeoutPromise = readJsonObjectBody(stalledReq, { maxBytes: 16 * 1024, timeoutMs: 30 });
  stalledReq.emit('data', Buffer.from('{"lat": -15', 'utf8'));

  await assert.rejects(
    timeoutPromise,
    (err: any) =>
      err instanceof JsonBodyReaderError &&
      err.statusCode === 408 &&
      err.code === 'BODY_TIMEOUT'
  );
  // Emissões posteriores não devem lançar erro nem alterar estado
  assert.doesNotThrow(() => {
    stalledReq.emit('data', Buffer.from(',"lng":-56}', 'utf8'));
    stalledReq.emit('end');
    stalledReq.emit('close');
  });
  assert.equal(stalledReq.listenerCount('data'), 0);
  assert.equal(stalledReq.listenerCount('end'), 0);
  assert.equal(stalledReq.listenerCount('error'), 1);
  assert.equal(stalledReq.listenerCount('close'), 0);

  // 2. Mock sem .on falha de forma controlada (400) e nunca lê req.body
  const noOnReq = createBodyTrapReq({ headers: {} });
  await assert.rejects(
    readJsonObjectBody(noOnReq, { maxBytes: 16 * 1024 }),
    (err: any) =>
      err instanceof JsonBodyReaderError &&
      err.statusCode === 400 &&
      err.code === 'INVALID_STREAM'
  );
});

test('/api/car-lookup mantém autenticação antes da leitura do corpo, falha fechado (503) sem servidor configurado, usa 16 KiB, { error }, corpo vazio {} e não acessa req.body', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevViteUrl = process.env.VITE_SUPABASE_URL;
  const prevSrv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  setTestSupabaseAdminForSemaAudit(null);

  try {
    // 0. Sem configuração no servidor -> 503 antes de ler stream ou req.body
    let streamReadStartedUnconfigured = false;
    const unconfReq = createBodyTrapReq({
      method: 'POST',
      url: '/api/car-lookup',
      headers: {
        authorization: 'Bearer any-jwt',
        'content-length': '999999'
      },
      on() {
        streamReadStartedUnconfigured = true;
      }
    });
    const unconfRes = createMockRes();
    await carLookupHandler(unconfReq, unconfRes);
    assert.equal(unconfRes.getStatus(), 503);
    assert.equal(streamReadStartedUnconfigured, false);
    assert.ok(unconfRes.getBody().error);

    // 1. Com Supabase configurado e JWT ausente/inválido -> 401 antes de ler body
    const mockAuthSupabase: any = {
      auth: {
        async getUser() {
          return { data: { user: null }, error: { message: 'Invalid JWT' } };
        }
      }
    };
    setTestSupabaseAdminForSemaAudit(mockAuthSupabase);

    let streamReadStarted = false;
    const unauthReq = createBodyTrapReq({
      method: 'POST',
      url: '/api/car-lookup',
      headers: { 'content-length': '999999' },
      on() {
        streamReadStarted = true;
      }
    });
    const unauthRes = createMockRes();
    await carLookupHandler(unauthReq, unauthRes);
    assert.equal(unauthRes.getStatus(), 401);
    assert.equal(streamReadStarted, false);
    assert.ok(unauthRes.getBody().error);

    // Cliente configurado com usuário ativo para testar regras de corpo
    const syntheticUid = '00000000-0000-4000-8000-000000000001';
    const mockValidSupabase: any = {
      auth: {
        async getUser(jwt: string) {
          if (jwt !== 'synthetic-valid-jwt') {
            return { data: { user: null }, error: { message: 'Invalid JWT' } };
          }
          return { data: { user: { id: syntheticUid } }, error: null };
        }
      },
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    if (table !== 'usuarios') return { data: null, error: null };
                    return {
                      data: {
                        id: 'usr_synth_01',
                        auth_user_id: syntheticUid,
                        papel: 'Usuário',
                        situacao: 'Ativo',
                        status: 'Ativo',
                        login: 'usuario.teste',
                        nome: 'Usuario Teste'
                      },
                      error: null
                    };
                  }
                };
              }
            };
          }
        };
      }
    };
    setTestSupabaseAdminForSemaAudit(mockValidSupabase);

    // 2. Content-Length acima de 16 KiB -> 413 { error }
    const resOverCl = createMockRes();
    await carLookupHandler(
      createBodyTrapReq({
        method: 'POST',
        url: '/api/car-lookup',
        headers: {
          authorization: 'Bearer synthetic-valid-jwt',
          'content-length': String(16 * 1024 + 1)
        },
        on() {}
      }),
      resOverCl
    );
    assert.equal(resOverCl.getStatus(), 413);
    assert.equal(resOverCl.getBody().error, 'Requisição excede o tamanho máximo permitido.');

    // 3. Array JSON -> 400 { error }
    const arrReq = createBodyTrapReq(new PassThrough());
    arrReq.method = 'POST';
    arrReq.url = '/api/car-lookup';
    arrReq.headers = { authorization: 'Bearer synthetic-valid-jwt' };
    arrReq.end(Buffer.from('[{"lat":-15.6,"lng":-56.1}]', 'utf8'));
    const resArr = createMockRes();
    await carLookupHandler(arrReq, resArr);
    assert.equal(resArr.getStatus(), 400);
    assert.equal(resArr.getBody().error, 'Dados de consulta inválidos.');

    // 4. Corpo vazio vira {} e cai na validação padrão de coordenadas (400 { error })
    const emptyReq = createBodyTrapReq(new PassThrough());
    emptyReq.method = 'POST';
    emptyReq.url = '/api/car-lookup';
    emptyReq.headers = { authorization: 'Bearer synthetic-valid-jwt' };
    emptyReq.end(Buffer.alloc(0));
    const resEmpty = createMockRes();
    await carLookupHandler(emptyReq, resEmpty);
    assert.equal(resEmpty.getStatus(), 400);
    assert.match(String(resEmpty.getBody().error), /Parâmetros "lat" e "lng" são obrigatórios/i);

    // 5. Mock sem .on -> 400 { error } sem TypeError e sem tocar req.body
    const resNoOn = createMockRes();
    await carLookupHandler(
      createBodyTrapReq({
        method: 'POST',
        url: '/api/car-lookup',
        headers: { authorization: 'Bearer synthetic-valid-jwt' }
      }),
      resNoOn
    );
    assert.equal(resNoOn.getStatus(), 400);
    assert.ok(resNoOn.getBody().error);
    assert.doesNotMatch(String(resNoOn.getBody().error), /req\.on is not a function/i);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
    if (prevViteUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteUrl;
    if (prevSrv !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevSrv;
  }
});

test('readJsonObjectBody não lança exceção não capturada se stream emitir error após rejeição 413', async () => {
  const req = createBodyTrapReq(new EventEmitter());
  const promise = readJsonObjectBody(req, { maxBytes: 16 * 1024 });

  req.emit('data', Buffer.alloc(16 * 1024 + 1, 'a'));

  await assert.rejects(
    promise,
    (err: any) => err instanceof JsonBodyReaderError && err.statusCode === 413
  );

  assert.doesNotThrow(() => {
    req.emit('error', new Error('erro tardio após 413'));
  });
});
