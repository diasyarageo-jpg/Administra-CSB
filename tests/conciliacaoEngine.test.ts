// tests/conciliacaoEngine.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import carLookupHandler, { estimateGeometryDistanceMeters } from '../api/car-lookup';
import { resetSemaGeoserverCachesForTest } from '../src/server/semaGeoserver';
import { setTestSupabaseAdminForSemaAudit } from '../src/server/semaAudit';
import {
  analisarPareceresRtPendentes,
  avaliarCoordenadasBarragem,
  construirRegistroRevisaoConciliacao,
  detectarMultiplasBarragensMesmoCar,
  encontrarCandidatosEmpreendedor,
  extrairAtoresDoProcesso,
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
  const req = new EventEmitter() as any;
  req.method = opts.method || 'GET';
  req.url = opts.url || '/';
  req.query = opts.query || {};
  req.headers = opts.headers || {};
  if (opts.body !== undefined) req.body = opts.body;
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
      <xsd:element name="MUNICIPIO_CODIGO" type="xsd:string"/>
      <xsd:element name="AREA_HA" type="xsd:double"/>
    </xsd:sequence>
  </xsd:complexType>
</xsd:schema>`;

// ---------------------------------------------------------------------------
// Cenário 1: Pessoa notificada / responsável pela área diferente do empreendedor
// ---------------------------------------------------------------------------
test('Cenário 1: pessoa notificada e responsável pela área nunca são presumidos empreendedores ou proprietários', () => {
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

  // Sem proprietário explícito, notificado NÃO vira candidato automático a empreendedor
  const semProp = encontrarCandidatosEmpreendedor({
    barragem,
    empreendedores,
    atoresDoProcesso: atores.filter(a => a.papel !== 'proprietario_titular')
  });
  assert.equal(semProp.classificacaoInicial, 'papeis_diferentes');
  assert.equal(semProp.candidatos.length, 0);
});

// ---------------------------------------------------------------------------
// Cenário 2: Duas barragens distintas no mesmo CAR
// ---------------------------------------------------------------------------
test('Cenário 2: detecta múltiplas barragens no mesmo CAR e alerta que CAR não identifica barragem isoladamente', () => {
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

  // Grau inteiro (baixa precisão / potencial sede)
  const imprecisa = avaliarCoordenadasBarragem('-14.0', '-56.0');
  assert.equal(imprecisa.status, 'fora_mt_ou_ambigua');
  assert.equal(imprecisa.permiteConsultaEspacial, true);

  // Fora dos limites de MT (eixos invertidos)
  const foraMt = avaliarCoordenadasBarragem('-56.5', '-14.2');
  assert.equal(foraMt.status, 'fora_mt_ou_ambigua');
  assert.equal(foraMt.permiteConsultaEspacial, false);

  // Válida em GMS de Mato Grosso
  const valida = avaliarCoordenadasBarragem(`14°26'52.8"S`, `56°58'51.6"W`);
  assert.equal(valida.status, 'valida');
  assert.equal(valida.permiteConsultaEspacial, true);
});

// ---------------------------------------------------------------------------
// Cenário 4 & 5: Nenhuma feição encontrada / Proximidade BBOX / SEMA indisponível
// ---------------------------------------------------------------------------
test('Cenário 4 e 5: /api/car-lookup trata nenhuma feição (INTERSECTS+BBOX), proximidade BBOX com distância e SEMA indisponível HTTP 403 sem simular dados', async () => {
  const originalFetch = globalThis.fetch;
  resetSemaGeoserverCachesForTest();
  setTestSupabaseAdminForSemaAudit(null);

  // 4A. Nenhuma feição encontrada em INTERSECTS nem BBOX
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

  try {
    const reqEmpty = createMockReq({
      method: 'POST',
      headers: { 'x-test-auth': '1' },
      body: { lat: -14.448, lng: -56.981, incluirProximidade: true, raioMetros: 1500 }
    });
    const resEmpty = createMockRes();
    await carLookupHandler(reqEmpty, resEmpty);
    assert.equal(resEmpty.statusCode, 200);
    assert.equal(resEmpty._body.encontrado, false);
    assert.equal(resEmpty._body.feicoes.length, 0);

    // 4B. INTERSECTS vazio -> BBOX proximidade retorna 1 imóvel com distância calculada
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
      // BBOX retorna um polígono ~500m ao norte
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
                NOMESPROPRIETARIOS: 'MARIA TITULAR (XXX.456.789-XX)',
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
      headers: { 'x-test-auth': '1' },
      body: { lat: -14.448, lng: -56.981, incluirProximidade: true, raioMetros: 1500 }
    });
    const resProx = createMockRes();
    await carLookupHandler(reqProx, resProx);
    assert.equal(resProx.statusCode, 200);
    assert.equal(resProx._body.encontrado, true);
    assert.equal(resProx._body.feicoes.length, 1);
    assert.equal(resProx._body.feicoes[0]._spatialMeta.criterioEspacial, 'BBOX_PROXIMIDADE');
    assert.ok(resProx._body.feicoes[0]._spatialMeta.distanciaMetros > 300);
    assert.ok(resProx._body.feicoes[0]._spatialMeta.distanciaMetros < 800);
    assert.ok(callCount >= 2);

    // 5. SEMA indisponível (HTTP 403) -> retorna erro transparente sem inventar dados
    resetSemaGeoserverCachesForTest();
    globalThis.fetch = (async () =>
      new Response('Forbidden', { status: 403 })) as typeof fetch;

    const reqDown = createMockReq({
      method: 'POST',
      headers: { 'x-test-auth': '1' },
      body: { lat: -14.448, lng: -56.981 }
    });
    const resDown = createMockRes();
    await carLookupHandler(reqDown, resDown);
    assert.equal(resDown.statusCode, 502);
    assert.ok(resDown._body.error);
  } finally {
    globalThis.fetch = originalFetch;
    resetSemaGeoserverCachesForTest();
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
// Cenário 6: Nome semelhante sem identificador forte
// ---------------------------------------------------------------------------
test('Cenário 6: nome semelhante sem CPF/CNPJ/ID forte é marcado como possível erro de grafia e não como confirmado', () => {
  const barragem: BarragemRecord = {
    id: 'bar_grafia',
    nome: 'Barragem Santa Luzia',
    empreendedor: 'Joao Batista da Sylva',
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

  assert.equal(analise.candidatos.length, 1);
  assert.equal(analise.candidatos[0].possuiIdentificadorForte, false);
  assert.equal(analise.candidatos[0].classificacaoSugerida, 'possivel_erro_grafia');
  assert.equal(analise.classificacaoInicial, 'possivel_erro_grafia');
});

// ---------------------------------------------------------------------------
// Cenário 7: Parecer com RT/ART no texto sem vínculo estruturado vs Notificação/Ofício sem RT
// ---------------------------------------------------------------------------
test('Cenário 7: Parecer cita RT/ART sem vínculo estruturado gera pendência; Notificação/Ofício sem RT NÃO é divergência', () => {
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

  // Apenas o Parecer gera pendência; Notificação e Ofício sem RT são ignorados corretamente
  assert.equal(pendencias.length, 1);
  assert.equal(pendencias[0].documentoId, 'parecer_com_rt');
  assert.equal(pendencias[0].citacao.artNumero, 'MT20250088123');
  assert.equal(pendencias[0].candidatosRtMestre[0].rtId, 'rt_mestre_1');
  assert.equal(pendencias[0].candidatosRtMestre[0].possuiIdentificadorForte, true);
  assert.equal(pendencias[0].classificacaoSugerida, 'vinculo_ausente');
});

// ---------------------------------------------------------------------------
// Concorrência otimista + Auditoria completa em `revisoes`
// ---------------------------------------------------------------------------
test('Valida concorrência otimista antes de gravar no mestre e serializa/desserializa auditoria completa em revisoes', async () => {
  const barragens: BarragemRecord[] = [
    {
      id: 'bar_lock',
      nome: 'Barragem Controle',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-05-01T12:00:00.000Z'
    }
  ];

  const staleCheck = await verificarConcorrenciaCadastroMestre({
    entidadeTipo: 'barragem',
    entidadeId: 'bar_lock',
    expectedUpdatedAt: '2026-01-01T10:00:00.000Z',
    localRecords: barragens
  });
  assert.equal(staleCheck.ok, false);
  assert.match(staleCheck.error || '', /modificado/i);

  const freshCheck = await verificarConcorrenciaCadastroMestre({
    entidadeTipo: 'barragem',
    entidadeId: 'bar_lock',
    expectedUpdatedAt: '2026-05-01T12:00:00.000Z',
    localRecords: barragens
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
  assert.equal(parsed.structured?.justificativa, 'Confirmado via documentação do processo e interseção CAR.');
});
