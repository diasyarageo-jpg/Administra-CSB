// tests/conciliacaoEngine.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import carLookupHandler, { estimateGeometryDistanceMeters } from '../api/car-lookup';
import semaDocumentosHandler from '../api/sema-documentos';
import conciliacaoGravarHandler from '../api/conciliacao-gravar';
import { resetSemaGeoserverCachesForTest } from '../src/server/semaGeoserver';
import { setTestSupabaseAdminForSemaAudit } from '../src/server/semaAudit';
import {
  analisarPareceresRtPendentes,
  avaliarCoordenadasBarragem,
  construirRegistroRevisaoConciliacao,
  detectarMultiplasBarragensMesmoCar,
  encontrarCandidatosEmpreendedor,
  extrairAtoresDoProcesso,
  extrairCitacaoRtDeParecer,
  isDocumentoSemRtIgnoradoComoDivergencia,
  parseRevisaoConciliacaoDetalhes,
  verificarConcorrenciaCadastroMestre
} from '../src/utils/conciliacaoEngine';
import type {
  BarragemRecord,
  EmpreendedorRecord,
  ResponsavelTecnicoRecord
} from '../src/services/notificaDataService';
import type { BarragemDocumentoEmitidoItem } from '../src/services/documentosService';

function createMockReq(opts: {
  method?: string;
  url?: string;
  body?: any;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}) {
  const req = new PassThrough() as any;
  req.method = opts.method || 'GET';
  req.url = opts.url || '/';
  req.query = opts.query || {};
  req.headers = opts.headers || {};
  if (opts.body !== undefined) {
    req.body = opts.body;
    const raw = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    req.end(Buffer.from(raw, 'utf8'));
  } else {
    req.end();
  }
  return req;
}

function createMockRes() {
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
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res._body = data;
      return res;
    },
    end(raw?: string) {
      if (raw && res._body === undefined) {
        try {
          res._body = JSON.parse(raw);
        } catch {
          res._body = raw;
        }
      }
      return res;
    }
  };
  return res;
}

function createSupabaseMockForSemaTests(opts: {
  role: 'Administrador' | 'Analista' | 'Usuário' | 'Visualizador';
  userId?: string;
  login?: string;
  auditFail?: boolean;
  damRow?: Record<string, any> | null;
  rpcHandler?: (fnName: string, args: Record<string, any>) => Promise<{ data: any; error: any }>;
}) {
  const auditCalls: Array<{ fnName: string; args: Record<string, any> }> = [];
  const uid = opts.userId || '11111111-1111-4111-8111-111111111111';

  const makeSelectChain = (table: string) => {
    const state: { eqCol?: string; eqVal?: unknown } = {};
    const chain: any = {
      select() {
        return chain;
      },
      eq(col: string, val: unknown) {
        state.eqCol = col;
        state.eqVal = val;
        return chain;
      },
      ilike(col: string, val: unknown) {
        state.eqCol = col;
        state.eqVal = val;
        return chain;
      },
      async maybeSingle() {
        if (table === 'usuarios') {
          return {
            data: {
              id: 'usr_1',
              papel: opts.role,
              situacao: 'Ativo',
              status: 'Ativo',
              auth_user_id: uid,
              login: opts.login || 'analista.csb',
              nome: 'Analista Teste',
              email: 'analista@sema.mt.gov.br'
            },
            error: null
          };
        }
        if (table === 'barragens') {
          if (opts.damRow === null) {
            return { data: null, error: null };
          }
          return {
            data: opts.damRow || {
              id: String(state.eqVal || 'bar_1'),
              created_by: uid,
              updated_at: '2026-05-01T12:00:00.000Z',
              empreendedor_id: null,
              empreendedor: ''
            },
            error: null
          };
        }
        return { data: null, error: null };
      }
    };
    return chain;
  };

  const client: any = {
    auditCalls,
    auth: {
      async getUser(jwt: string) {
        if (!jwt || jwt === 'invalid') {
          return { data: { user: null }, error: { message: 'JWT inválido' } };
        }
        return {
          data: { user: { id: uid, email: 'analista@sema.mt.gov.br' } },
          error: null
        };
      }
    },
    from(table: string) {
      return makeSelectChain(table);
    },
    async rpc(fnName: string, args: Record<string, any>) {
      auditCalls.push({ fnName, args });
      if (opts.rpcHandler) {
        return opts.rpcHandler(fnName, args);
      }
      if (fnName === 'registrar_consulta_sema_auditoria') {
        if (opts.auditFail) {
          return { data: null, error: { message: 'Auditoria indisponível simulada' } };
        }
        return { data: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', error: null };
      }
      return { data: null, error: null };
    }
  };

  return client;
}

const CAPABILITIES_CAR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:WFS_Capabilities version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0">
  <FeatureTypeList>
    <FeatureType><Name>Geoportal:CAR_ATP</Name><Title>CAR ATP</Title></FeatureType>
  </FeatureTypeList>
</wfs:WFS_Capabilities>`;

const DESCRIBE_CAR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:gml="http://www.opengis.net/gml">
  <xsd:complexType name="CAR_ATPType">
    <xsd:sequence>
      <xsd:element name="GEOMETRY" type="gml:SurfacePropertyType"/>
      <xsd:element name="NUMEROESTADUAL" type="xsd:string"/>
      <xsd:element name="CAR_FEDERAL" type="xsd:string"/>
      <xsd:element name="NOMEPROPRIEDADE" type="xsd:string"/>
      <xsd:element name="NOMESPROPRIETARIOS" type="xsd:string"/>
      <xsd:element name="CPF_CNPJ" type="xsd:string"/>
      <xsd:element name="MUNICIPIO_CODIGO" type="xsd:string"/>
      <xsd:element name="AREA_HA" type="xsd:double"/>
    </xsd:sequence>
  </xsd:complexType>
</xsd:schema>`;

// ---------------------------------------------------------------------------
// Cenário 1: Notificado / responsável / arrendatário e vínculo por identificador
// ---------------------------------------------------------------------------
test('Cenário 1: notificado, responsável pela área e arrendatário geram candidato apenas com CPF/CNPJ exato mantendo papel original e sem vínculo automático', () => {
  const barragem: BarragemRecord = {
    id: 'bar_01',
    nome: 'Barragem Fazenda Esperança',
    processo: '12345/2024',
    car: 'MT-5103403-99999999999999999999999999999999',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z'
  };

  const empreendedores: EmpreendedorRecord[] = [
    {
      id: 'emp_notificado',
      nome: 'Carlos Eduardo Gerente',
      cpfCnpj: '111.222.333-44',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z'
    },
    {
      id: 'emp_titular_real',
      nome: 'Fazenda Esperança Agropecuária Ltda',
      cpfCnpj: '12.345.678/0001-99',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z'
    }
  ];

  const atores = extrairAtoresDoProcesso({
    barragem,
    notificacoes: [
      {
        id: 'not_1',
        processo: '12345/2024',
        tipoDocumento: 'Notificação',
        notificadoNome: 'Carlos Eduardo Gerente',
        notificadoDocumento: '111.222.333-44',
        responsavelAreaNome: 'Marcos Administrador Local',
        arrendatarioNome: 'Arrendamento Sul MT',
        proprietarioNome: 'Fazenda Esperança Agropecuária Ltda'
      }
    ],
    empreendedores
  });

  const notificado = atores.find(a => a.papel === 'notificado');
  const respArea = atores.find(a => a.papel === 'responsavel_area');
  const arrendatario = atores.find(a => a.papel === 'arrendatario');
  const proprietario = atores.find(a => a.papel === 'proprietario_titular');

  assert.equal(notificado?.presunivelEmpreendedor, false);
  assert.equal(respArea?.presunivelEmpreendedor, false);
  assert.equal(arrendatario?.presunivelEmpreendedor, false);
  assert.equal(proprietario?.presunivelEmpreendedor, true);

  // Com CPF/CNPJ normalizado exato, o notificado vira candidato para revisão humana com papel original preservado
  const comDocNotificado = encontrarCandidatosEmpreendedor({
    barragem,
    empreendedores,
    atoresDoProcesso: atores.filter(a => a.papel !== 'proprietario_titular')
  });
  assert.equal(comDocNotificado.classificacaoInicial, 'papeis_diferentes');
  assert.equal(comDocNotificado.candidatos.length, 1);
  assert.equal(comDocNotificado.candidatos[0].empreendedorId, 'emp_notificado');
  assert.equal(comDocNotificado.candidatos[0].criterio, 'cpf_cnpj_exato');
  assert.equal(comDocNotificado.candidatos[0].papelOriginal, 'notificado');
  assert.equal(comDocNotificado.candidatos[0].classificacaoSugerida, 'papeis_diferentes');

  // Sem CPF/CNPJ e sem CAR coincidente, notificado/responsável não gera candidato
  const semDoc = encontrarCandidatosEmpreendedor({
    barragem,
    empreendedores: empreendedores.map(e => ({ ...e, cpfCnpj: '' })),
    atoresDoProcesso: atores.filter(a => a.papel !== 'proprietario_titular')
  });
  assert.equal(semDoc.classificacaoInicial, 'papeis_diferentes');
  assert.equal(semDoc.candidatos.length, 0);
});

// ---------------------------------------------------------------------------
// Cenário 2: Duas barragens distintas no mesmo CAR
// ---------------------------------------------------------------------------
test('Cenário 2: detecta múltiplas barragens no mesmo CAR e CAR coincidente gera candidato para revisão humana', () => {
  const carComum = 'MT-5107909-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const dam1: BarragemRecord = {
    id: 'bar_car_1',
    nome: 'Barragem Superior',
    car: carComum,
    processo: 'PROC-001/2025',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z'
  };
  const dam2: BarragemRecord = {
    id: 'bar_car_2',
    nome: 'Barragem Inferior',
    car: 'mt 5107909 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    empreendedorId: 'emp_mesmo_car',
    processo: 'PROC-002/2025',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z'
  };

  const info = detectarMultiplasBarragensMesmoCar(dam1, [dam1, dam2]);
  assert.equal(info.avisoMultiplasBarragens, true);
  assert.equal(info.totalBarragensNoMesmoCar, 2);
  assert.equal(info.outrasBarragens.length, 1);
  assert.equal(info.outrasBarragens[0].id, 'bar_car_2');
  assert.match(info.mensagem, /não substitui a identificação individual/i);

  const analiseCar = encontrarCandidatosEmpreendedor({
    barragem: dam1,
    empreendedores: [
      {
        id: 'emp_mesmo_car',
        nome: 'Empreendedor Agro MT',
        cpfCnpj: '98.765.432/0001-10',
        createdAt: '2026-01-01T10:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z'
      }
    ],
    barragensDoEmpreendedor: [dam1, dam2]
  });

  assert.equal(analiseCar.candidatos.length, 1);
  assert.equal(analiseCar.candidatos[0].criterio, 'car_em_empreendimento');
  assert.equal(analiseCar.candidatos[0].classificacaoSugerida, 'candidato');
  assert.equal(analiseCar.classificacaoInicial, 'candidato');
});

// ---------------------------------------------------------------------------
// Cenário 3: Coordenada ambígua ou ausente
// ---------------------------------------------------------------------------
test('Cenário 3: identifica corretamente coordenada ausente, inválida e ambígua/fora de MT', () => {
  const ausente = avaliarCoordenadasBarragem('', '');
  assert.equal(ausente.status, 'ausente');
  assert.equal(ausente.permiteConsultaEspacial, false);

  const invalida = avaliarCoordenadasBarragem('abc', 'xyz');
  assert.equal(invalida.status, 'invalida');
  assert.equal(invalida.permiteConsultaEspacial, false);

  const imprecisa = avaliarCoordenadasBarragem('-14.0', '-56.0');
  assert.equal(imprecisa.status, 'fora_mt_ou_ambigua');
  assert.equal(imprecisa.permiteConsultaEspacial, true);

  const foraMt = avaliarCoordenadasBarragem('-56.5', '-14.2');
  assert.equal(foraMt.status, 'fora_mt_ou_ambigua');
  assert.equal(foraMt.permiteConsultaEspacial, false);

  const valida = avaliarCoordenadasBarragem(`14°26'52.8"S`, `56°58'51.6"W`);
  assert.equal(valida.status, 'valida');
  assert.equal(valida.permiteConsultaEspacial, true);
});

// ---------------------------------------------------------------------------
// Cenário 4 & 5 + BBOX sem dados pessoais + SEMA sem Supabase + Audit fail + RBAC
// ---------------------------------------------------------------------------
test('Cenário 4 e 5: /api/car-lookup bloqueia sem servidor configurado (503), trata vazio, BBOX sem dados pessoais e RBAC + auditoria', async () => {
  const originalFetch = globalThis.fetch;
  const prevUrl = process.env.SUPABASE_URL;
  const prevViteUrl = process.env.VITE_SUPABASE_URL;
  const prevSrv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetSemaGeoserverCachesForTest();
  setTestSupabaseAdminForSemaAudit(null);

  try {
    // 4.0 Sem configuração no servidor -> 503 sem nenhuma chamada externa ao GeoServer
    let unconfiguredFetchCalls = 0;
    globalThis.fetch = (async () => {
      unconfiguredFetchCalls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const reqUnconf = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer valid-jwt' },
      body: { lat: -14.448, lng: -56.981 }
    });
    const resUnconf = createMockRes();
    await carLookupHandler(reqUnconf, resUnconf);
    assert.equal(resUnconf.statusCode, 503);
    assert.ok(resUnconf._body.error);
    assert.equal(unconfiguredFetchCalls, 0);

    // 4A. Nenhuma feição encontrada (Visualizador configurado)
    const viewerMock = createSupabaseMockForSemaTests({ role: 'Visualizador' });
    setTestSupabaseAdminForSemaAudit(viewerMock);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('request=GetCapabilities')) {
        return new Response(CAPABILITIES_CAR_XML, { status: 200 });
      }
      if (url.includes('request=DescribeFeatureType')) {
        return new Response(DESCRIBE_CAR_XML, { status: 200 });
      }
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
        status: 200
      });
    }) as typeof fetch;

    const reqEmpty = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer valid-jwt' },
      body: { lat: -14.448, lng: -56.981, incluirProximidade: true, raioMetros: 1500 }
    });
    const resEmpty = createMockRes();
    await carLookupHandler(reqEmpty, resEmpty);
    assert.equal(resEmpty.statusCode, 200);
    assert.equal(resEmpty._body.encontrado, false);
    assert.equal(resEmpty._body.auditoriaDisponivel, false);
    assert.equal(resEmpty._body.feicoes.length, 0);

    // 4B. BBOX proximidade NÃO deve retornar proprietário, CPF/CNPJ nem outros atributos pessoais
    let callCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('request=GetCapabilities')) {
        return new Response(CAPABILITIES_CAR_XML, { status: 200 });
      }
      if (url.includes('request=DescribeFeatureType')) {
        return new Response(DESCRIBE_CAR_XML, { status: 200 });
      }
      const bodyStr = String(init?.body || url);
      callCount += 1;
      if (bodyStr.includes('INTERSECTS')) {
        return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
          status: 200
        });
      }
      return new Response(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'CAR_ATP.777',
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [-56.982, -14.444],
                    [-56.98, -14.444],
                    [-56.98, -14.442],
                    [-56.982, -14.442],
                    [-56.982, -14.444]
                  ]
                ]
              },
              properties: {
                NUMEROESTADUAL: 'MT-5100001',
                NOMEPROPRIEDADE: 'FAZENDA PROXIMA',
                NOMESPROPRIETARIOS: 'MARIA TITULAR SECRETA',
                CPF_CNPJ: '123.456.789-01',
                MUNICIPIO_CODIGO: '5103403',
                AREA_HA: 120.5
              }
            }
          ]
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const reqProx = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer valid-jwt' },
      body: { lat: -14.448, lng: -56.981, incluirProximidade: true, raioMetros: 1500 }
    });
    const resProx = createMockRes();
    await carLookupHandler(reqProx, resProx);
    assert.equal(resProx.statusCode, 200);
    assert.equal(resProx._body.encontrado, true);
    assert.equal(resProx._body.feicoes.length, 1);
    const bboxProps = resProx._body.feicoes[0].properties;
    assert.equal(bboxProps.NUMEROESTADUAL, 'MT-5100001');
    assert.equal(bboxProps.NOMEPROPRIEDADE, 'FAZENDA PROXIMA');
    assert.ok(bboxProps.DISTANCIA_ESTIMADA_METROS > 300);
    assert.equal(bboxProps.NOMESPROPRIETARIOS, undefined);
    assert.equal(bboxProps.CPF_CNPJ, undefined);
    assert.equal(bboxProps.MUNICIPIO_CODIGO, undefined);
    assert.equal(bboxProps.AREA_HA, undefined);
    assert.equal(resProx._body.feicoes[0]._schemaMeta.cpfCnpjCompletoDisponivel, false);
    assert.ok(callCount >= 2);

    // 4C. INTERSECTS com Analista + auditoria funcionando -> retorna dado completo e grava auditoria com campos_consultados
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('request=GetCapabilities')) {
        return new Response(CAPABILITIES_CAR_XML, { status: 200 });
      }
      if (url.includes('request=DescribeFeatureType')) {
        return new Response(DESCRIBE_CAR_XML, { status: 200 });
      }
      return new Response(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'CAR_ATP.888',
              properties: {
                NUMEROESTADUAL: 'MT-5100002',
                NOMEPROPRIEDADE: 'FAZENDA DIRETA',
                NOMESPROPRIETARIOS: 'JOAO TITULAR',
                CPF_CNPJ: '12345678901'
              }
            }
          ]
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const analistaMock = createSupabaseMockForSemaTests({ role: 'Analista', login: 'analista.mt' });
    setTestSupabaseAdminForSemaAudit(analistaMock);
    const resAnalista = createMockRes();
    await carLookupHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid-jwt' },
        body: { lat: -14.448, lng: -56.981 }
      }),
      resAnalista
    );
    assert.equal(resAnalista.statusCode, 200);
    assert.equal(resAnalista._body.auditoriaDisponivel, true);
    assert.equal(resAnalista._body.feicoes[0]._schemaMeta.cpfCnpjCompletoDisponivel, true);
    assert.equal(resAnalista._body.feicoes[0].properties.CPF_CNPJ, '123.456.789-01');
    assert.equal(analistaMock.auditCalls.length, 1);
    assert.equal(analistaMock.auditCalls[0].args.p_atributos_recebidos.visualizacao_dado_completo, true);
    assert.ok(Array.isArray(analistaMock.auditCalls[0].args.p_atributos_recebidos.campos_consultados));
    assert.equal(analistaMock.auditCalls[0].args.p_atributos_recebidos.consultado_por_login, 'analista.mt');
    // Não pode armazenar CPF/CNPJ bruto nos atributos auditados
    assert.equal(analistaMock.auditCalls[0].args.p_atributos_recebidos.CPF_CNPJ, undefined);

    // 4D. Usuário comum NÃO recebe CPF/CNPJ completo
    const usuarioMock = createSupabaseMockForSemaTests({ role: 'Usuário' });
    setTestSupabaseAdminForSemaAudit(usuarioMock);
    const resUsuario = createMockRes();
    await carLookupHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid-jwt' },
        body: { lat: -14.448, lng: -56.981 }
      }),
      resUsuario
    );
    assert.equal(resUsuario.statusCode, 200);
    assert.equal(resUsuario._body.feicoes[0]._schemaMeta.cpfCnpjCompletoDisponivel, false);
    assert.notEqual(resUsuario._body.feicoes[0].properties.CPF_CNPJ, '123.456.789-01');

    // 4E. Se auditoria falhar no servidor, mesmo Administrador NÃO recebe CPF/CNPJ completo
    const adminAuditFailMock = createSupabaseMockForSemaTests({
      role: 'Administrador',
      auditFail: true
    });
    setTestSupabaseAdminForSemaAudit(adminAuditFailMock);
    const resAuditFail = createMockRes();
    await carLookupHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid-jwt' },
        body: { lat: -14.448, lng: -56.981 }
      }),
      resAuditFail
    );
    assert.equal(resAuditFail.statusCode, 200);
    assert.equal(resAuditFail._body.auditoriaDisponivel, false);
    assert.equal(resAuditFail._body.feicoes[0]._schemaMeta.cpfCnpjCompletoDisponivel, false);
    assert.notEqual(resAuditFail._body.feicoes[0].properties.CPF_CNPJ, '123.456.789-01');

    // 5. SEMA indisponível (HTTP 403) com servidor autenticado e configurado
    setTestSupabaseAdminForSemaAudit(analistaMock);
    resetSemaGeoserverCachesForTest();
    globalThis.fetch = (async () =>
      new Response('Forbidden', { status: 403 })) as typeof fetch;

    const reqDown = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer valid-jwt' },
      body: { lat: -14.448, lng: -56.981 }
    });
    const resDown = createMockRes();
    await carLookupHandler(reqDown, resDown);
    assert.equal(resDown.statusCode, 502);
    assert.ok(resDown._body.error);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    globalThis.fetch = originalFetch;
    resetSemaGeoserverCachesForTest();
    if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
    if (prevViteUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteUrl;
    if (prevSrv !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevSrv;
  }
});

test('/api/sema-documentos falha fechado (503) sem Supabase, bloqueia dado pessoal completo quando auditoria falha e exige RBAC Administrador/Analista', async () => {
  const originalFetch = globalThis.fetch;
  const prevUrl = process.env.SUPABASE_URL;
  const prevViteUrl = process.env.VITE_SUPABASE_URL;
  const prevSrv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetSemaGeoserverCachesForTest();
  setTestSupabaseAdminForSemaAudit(null);

  const docsCapabilitiesXml = `<?xml version="1.0" encoding="UTF-8"?>
  <wfs:WFS_Capabilities version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0">
    <FeatureTypeList>
      <FeatureType><Name>Geoportal:CAR_ATP</Name><Title>CAR ATP</Title></FeatureType>
    </FeatureTypeList>
  </wfs:WFS_Capabilities>`;

  let fetchCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls += 1;
    const url = String(input);
    if (url.includes('request=GetCapabilities')) {
      return new Response(docsCapabilitiesXml, { status: 200 });
    }
    if (url.includes('request=DescribeFeatureType')) {
      return new Response(DESCRIBE_CAR_XML, { status: 200 });
    }
    return new Response(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'CAR_ATP.901',
            properties: {
              NUMEROESTADUAL: 'MT-5100009',
              NOMEPROPRIEDADE: 'FAZENDA DOCS',
              NOMESPROPRIETARIOS: 'EMPRESA TITULAR S/A',
              CPF_CNPJ: '12.345.678/0001-99'
            }
          }
        ]
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    // Sem Supabase configurado -> 503 antes de qualquer chamada externa ao GeoServer
    const resUnconf = createMockRes();
    await semaDocumentosHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid-jwt' },
        body: { car: 'MT-5100009' }
      }),
      resUnconf
    );
    assert.equal(resUnconf.statusCode, 503);
    assert.ok(resUnconf._body.error);
    assert.equal(fetchCalls, 0);

    // Auditoria falhando com Administrador -> mascara dado pessoal
    const failMock = createSupabaseMockForSemaTests({ role: 'Administrador', auditFail: true });
    setTestSupabaseAdminForSemaAudit(failMock);
    const resFail = createMockRes();
    await semaDocumentosHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid-jwt' },
        body: { car: 'MT-5100009' }
      }),
      resFail
    );
    assert.equal(resFail.statusCode, 200);
    assert.equal(resFail._body.auditoriaDisponivel, false);
    const itemFail = resFail._body.carImoveis[0];
    assert.equal(itemFail.cpfCnpjCompletoDisponivel, false);
    assert.notEqual(itemFail.cpfCnpjMascarado, '12.345.678/0001-99');

    // Analista com auditoria OK -> retorna dado completo e grava auditoria
    const okMock = createSupabaseMockForSemaTests({ role: 'Analista' });
    setTestSupabaseAdminForSemaAudit(okMock);
    const resOk = createMockRes();
    await semaDocumentosHandler(
      createMockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid-jwt' },
        body: { car: 'MT-5100009' }
      }),
      resOk
    );
    assert.equal(resOk.statusCode, 200);
    assert.equal(resOk._body.auditoriaDisponivel, true);
    const itemOk = resOk._body.carImoveis[0];
    assert.equal(itemOk.cpfCnpjCompletoDisponivel, true);
    assert.equal(itemOk.cpfCnpjMascarado, '12.345.678/0001-99');
    assert.equal(okMock.auditCalls[0].args.p_atributos_recebidos.visualizacao_dado_completo, true);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    globalThis.fetch = originalFetch;
    resetSemaGeoserverCachesForTest();
    if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
    if (prevViteUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteUrl;
    if (prevSrv !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevSrv;
  }
});

test('estimateGeometryDistanceMeters calcula distância coerente para ponto e polígono', () => {
  const d = estimateGeometryDistanceMeters(
    { type: 'Point', coordinates: [-56.981, -14.443] },
    -14.448,
    -56.981
  );
  assert.ok(d !== null && d > 500 && d < 600);
});

// ---------------------------------------------------------------------------
// Cenário 6: Nome semelhante ou idêntico sem identificador forte NÃO gera candidato
// ---------------------------------------------------------------------------
test('Cenário 6: nome semelhante ou idêntico sem CPF/CNPJ ou CAR coincidente não gera candidato', () => {
  const barragem: BarragemRecord = {
    id: 'bar_grafia',
    nome: 'Barragem Santa Luzia',
    empreendedor: 'João Batista da Silva',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z'
  };

  const empreendedores: EmpreendedorRecord[] = [
    {
      id: 'emp_joao',
      nome: 'João Batista da Silva',
      cpfCnpj: '123.456.789-00',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z'
    }
  ];

  const analise = encontrarCandidatosEmpreendedor({
    barragem,
    empreendedores,
    atoresDoProcesso: extrairAtoresDoProcesso({ barragem, empreendedores })
  });

  assert.equal(analise.candidatos.length, 0);
  assert.equal(analise.classificacaoInicial, 'sem_correspondencia');

  // Mesmo com nome diferente, CPF/CNPJ normalizado exato gera candidato forte
  const comDoc = encontrarCandidatosEmpreendedor({
    barragem: { ...barragem, empreendedor: 'Joao B. Silva (12345678900)' },
    empreendedores,
    atoresDoProcesso: extrairAtoresDoProcesso({
      barragem: { ...barragem, empreendedor: 'Joao B. Silva (12345678900)' },
      empreendedores
    })
  });
  assert.equal(comDoc.candidatos.length, 1);
  assert.equal(comDoc.candidatos[0].criterio, 'cpf_cnpj_exato');
  assert.equal(comDoc.candidatos[0].possuiIdentificadorForte, true);
  assert.equal(comDoc.classificacaoInicial, 'candidato');
});

// ---------------------------------------------------------------------------
// Cenário 7: Regex `\bRT\b` isolado + Parecer com RT/ART sem vínculo estruturado
// ---------------------------------------------------------------------------
test('Cenário 7: extrairCitacaoRtDeParecer exige palavra isolada \\bRT\\b e não casa dentro de ART/PART/RRT', () => {
  const soArt = extrairCitacaoRtDeParecer({
    titulo: 'Parecer de Análise · PART: João Fake · ART nº MT20259999'
  });
  assert.ok(soArt);
  assert.equal(soArt?.artNumero, 'MT20259999');
  assert.equal(soArt?.rtNome, undefined);

  const comRtIsolado = extrairCitacaoRtDeParecer({
    titulo: 'Parecer Técnico · RT: Eng. Carlos Alberto · ART nº MT20259999'
  });
  assert.ok(comRtIsolado);
  assert.equal(comRtIsolado?.rtNome, 'Eng. Carlos Alberto');
  assert.equal(comRtIsolado?.artNumero, 'MT20259999');
});

test('Cenário 7B: Parecer cita RT/ART sem vínculo estruturado gera pendência; Notificação/Ofício sem RT NÃO é divergência', () => {
  assert.equal(isDocumentoSemRtIgnoradoComoDivergencia('Notificação'), true);
  assert.equal(isDocumentoSemRtIgnoradoComoDivergencia('Ofício'), true);
  assert.equal(isDocumentoSemRtIgnoradoComoDivergencia('Parecer Técnico'), false);
  assert.equal(isDocumentoSemRtIgnoradoComoDivergencia('Parecer de Classificação'), false);

  const barragens: BarragemRecord[] = [
    {
      id: 'bar_rt_1',
      nome: 'Barragem Rio Claro',
      processo: '2025/00999',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z'
    }
  ];

  const rts: ResponsavelTecnicoRecord[] = [
    {
      id: 'rt_mestre_1',
      nome: 'Eng. Ana Paula Mendes',
      conselho: 'CREA',
      registro: '12345MT',
      vinculos: [],
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z'
    }
  ];

  const docsPorBarragem: Record<string, BarragemDocumentoEmitidoItem[]> = {
    bar_rt_1: [
      {
        id: 'notif_sem_rt',
        tipo: 'Notificação',
        titulo: 'Notificação para apresentação de PSB',
        origemSistema: 'Notifica',
        situacao: 'Emitido'
      },
      {
        id: 'oficio_sem_rt',
        tipo: 'Ofício',
        titulo: 'Ofício de solicitação de documentação',
        origemSistema: 'Fiscaliza',
        situacao: 'Emitido'
      },
      {
        id: 'parecer_com_rt',
        tipo: 'Parecer de Classificação',
        numero: '042/2025',
        titulo: 'Parecer de Classificação · RT: Eng. Ana Paula Mendes · CREA 12345MT · ART nº MT20250088123',
        origemSistema: 'Classifica',
        situacao: 'Emitido'
      }
    ]
  };

  const pendencias = analisarPareceresRtPendentes({
    barragens,
    rts,
    documentosPorBarragem: docsPorBarragem
  });

  assert.equal(pendencias.length, 1);
  assert.equal(pendencias[0].documentoId, 'parecer_com_rt');
  assert.equal(pendencias[0].citacao.artNumero, 'MT20250088123');
  assert.equal(pendencias[0].candidatosRtMestre[0].rtId, 'rt_mestre_1');
  assert.equal(pendencias[0].candidatosRtMestre[0].possuiIdentificadorForte, true);
  assert.equal(pendencias[0].classificacaoSugerida, 'vinculo_ausente');
});

// ---------------------------------------------------------------------------
// Concorrência otimista + Gravação segura no servidor (/api/conciliacao-gravar)
// ---------------------------------------------------------------------------
test('Valida concorrência otimista exigindo banco central e falhando quando registro remoto não existe', async () => {
  const barragens: BarragemRecord[] = [
    {
      id: 'bar_lock',
      nome: 'Barragem Controle',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-05-01T12:00:00.000Z'
    }
  ];

  // Sem banco central configurado, não pode confirmar concorrência por padrão
  const noRemoteCheck = await verificarConcorrenciaCadastroMestre({
    entidadeTipo: 'barragem',
    entidadeId: 'bar_lock',
    expectedUpdatedAt: '2026-05-01T12:00:00.000Z',
    localRecords: barragens
  });
  assert.equal(noRemoteCheck.ok, false);

  // Registro remoto ausente (`!data`) NÃO pode retornar ok
  const missingRemoteMock = createSupabaseMockForSemaTests({
    role: 'Analista',
    damRow: null
  });
  const missingRemoteCheck = await verificarConcorrenciaCadastroMestre({
    entidadeTipo: 'barragem',
    entidadeId: 'bar_lock',
    expectedUpdatedAt: '2026-05-01T12:00:00.000Z',
    localRecords: barragens,
    supabaseClient: missingRemoteMock
  });
  assert.equal(missingRemoteCheck.ok, false);

  const staleCheck = await verificarConcorrenciaCadastroMestre({
    entidadeTipo: 'barragem',
    entidadeId: 'bar_lock',
    expectedUpdatedAt: '2026-01-01T10:00:00.000Z',
    localRecords: barragens,
    allowLocalOnlyFallback: true
  });
  assert.equal(staleCheck.ok, false);
  assert.match(staleCheck.error || '', /modificado/i);

  const validRemoteMock = createSupabaseMockForSemaTests({
    role: 'Analista',
    damRow: {
      id: 'bar_lock',
      updated_at: '2026-05-01T12:00:00.000Z',
      empreendedor_id: null,
      empreendedor: ''
    }
  });
  const freshCheck = await verificarConcorrenciaCadastroMestre({
    entidadeTipo: 'barragem',
    entidadeId: 'bar_lock',
    expectedUpdatedAt: '2026-05-01T12:00:00.000Z',
    localRecords: barragens,
    supabaseClient: validRemoteMock
  });
  assert.equal(freshCheck.ok, true);

  const rev = construirRegistroRevisaoConciliacao({
    createdBy: 'usr_1',
    payload: {
      schemaVersion: 1,
      modulo: 'conciliacao_assistida',
      alvoTipo: 'barragem_empreendedor',
      barragemId: 'bar_lock',
      barragemNome: 'Barragem Controle',
      classificacao: 'confirmado_usuario',
      acao: 'vincular',
      fonte: 'SEMA-MT Geoportal + Conferência Humana Administra',
      dataDecisao: '2026-05-01T13:00:00.000Z',
      usuario: 'Analista CSB',
      valorAnterior: 'Sem empreendedor vinculado',
      valorProposto: 'Agropecuária Modelo Ltda (emp_1)',
      justificativa: 'Confirmado via documentação do processo e interseção CAR.',
      evidencias: {
        processo: 'PROC-999/2025',
        car: 'MT-5100001',
        multiplasBarragensNoCar: 2,
        semaConsultada: true,
        semaCriterioEspacial: 'INTERSECTS',
        semaDistanciaMetros: 0,
        semaCamada: 'Geoportal:CAR_ATP'
      }
    }
  });

  assert.equal(rev.situacao, 'Conciliado');
  const parsed = parseRevisaoConciliacaoDetalhes(rev);
  assert.equal(parsed.structured?.classificacao, 'confirmado_usuario');
  assert.equal(parsed.structured?.evidencias.multiplasBarragensNoCar, 2);
});

test('/api/conciliacao-gravar aplica RBAC, valida banco/auditoria, trata conflito e falha atômica de auditoria', async () => {
  const validBody = {
    alvoTipo: 'barragem_empreendedor',
    barragemId: 'bar_lock',
    acao: 'vincular',
    classificacao: 'confirmado_usuario',
    justificativa: 'Vínculo conferido via documento do processo CPF 123.456.789-01.',
    masterUpdatedAtSnapshot: '2026-05-01T12:00:00.000Z',
    selectedEmpreendedorId: 'emp_1',
    auditPayload: {
      schemaVersion: 1,
      modulo: 'conciliacao_assistida',
      alvoTipo: 'barragem_empreendedor',
      barragemId: 'bar_lock',
      barragemNome: 'Barragem Controle',
      classificacao: 'confirmado_usuario',
      acao: 'vincular',
      fonte: 'Conferência Humana Administra',
      dataDecisao: '2026-05-01T13:00:00.000Z',
      usuario: 'Analista CSB',
      valorAnterior: 'Sem vínculo',
      valorProposto: 'emp_1',
      justificativa: 'Conferido',
      evidencias: {}
    }
  };

  try {
    // 1. Sem banco/auditoria -> bloqueia gravação com 503
    setTestSupabaseAdminForSemaAudit(null);
    const resNoDb = createMockRes();
    await conciliacaoGravarHandler(
      createMockReq({ method: 'POST', headers: { authorization: 'Bearer jwt' }, body: validBody }),
      resNoDb
    );
    assert.equal(resNoDb.statusCode, 503);
    assert.equal(resNoDb._body.success, false);

    // 2. Perfil Visualizador -> bloqueia com 403 antes da RPC
    const vizMock = createSupabaseMockForSemaTests({ role: 'Visualizador' });
    setTestSupabaseAdminForSemaAudit(vizMock);
    const resViz = createMockRes();
    await conciliacaoGravarHandler(
      createMockReq({ method: 'POST', headers: { authorization: 'Bearer jwt' }, body: validBody }),
      resViz
    );
    assert.equal(resViz.statusCode, 403);
    assert.equal(resViz._body.success, false);
    assert.equal(vizMock.auditCalls.length, 0);

    // 3. Conflito de concorrência retornado pela RPC -> 409
    const conflictMock = createSupabaseMockForSemaTests({
      role: 'Analista',
      rpcHandler: async () => ({
        data: { success: false, http_status: 409, error: 'Conflito de concorrência detectado' },
        error: null
      })
    });
    setTestSupabaseAdminForSemaAudit(conflictMock);
    const resConflict = createMockRes();
    await conciliacaoGravarHandler(
      createMockReq({ method: 'POST', headers: { authorization: 'Bearer jwt' }, body: validBody }),
      resConflict
    );
    assert.equal(resConflict.statusCode, 409);
    assert.equal(resConflict._body.success, false);

    // 4. Falha na auditoria/revisão (erro de banco ou sem revisao_id) -> 500 e success=false
    const failAuditMock = createSupabaseMockForSemaTests({
      role: 'Analista',
      rpcHandler: async () => ({
        data: null,
        error: { message: 'Falha ao inserir auditoria em revisoes' }
      })
    });
    setTestSupabaseAdminForSemaAudit(failAuditMock);
    const resFailAudit = createMockRes();
    await conciliacaoGravarHandler(
      createMockReq({ method: 'POST', headers: { authorization: 'Bearer jwt' }, body: validBody }),
      resFailAudit
    );
    assert.equal(resFailAudit.statusCode, 500);
    assert.equal(resFailAudit._body.success, false);

    // 5. Sucesso atômico com Analista -> 200 e justificativa sanitizada sem CPF bruto
    const okMock = createSupabaseMockForSemaTests({
      role: 'Analista',
      rpcHandler: async () => ({
        data: {
          success: true,
          http_status: 200,
          revisao_id: 'rev_ok_1',
          updated_at: '2026-05-01T14:00:00.000Z'
        },
        error: null
      })
    });
    setTestSupabaseAdminForSemaAudit(okMock);
    const resOk = createMockRes();
    await conciliacaoGravarHandler(
      createMockReq({ method: 'POST', headers: { authorization: 'Bearer jwt' }, body: validBody }),
      resOk
    );
    assert.equal(resOk.statusCode, 200);
    assert.equal(resOk._body.success, true);
    assert.equal(resOk._body.revisaoId, 'rev_ok_1');
    assert.ok(!okMock.auditCalls[0].args.p_justificativa.includes('123.456.789-01'));
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
  }
});
