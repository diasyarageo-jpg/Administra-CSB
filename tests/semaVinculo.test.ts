// tests/semaVinculo.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import carLookupHandler from '../api/car-lookup';
import semaDocumentosHandler from '../api/sema-documentos';
import {
  aceitarCamposSemaParaMestre,
  aceitarDadoSemaParaMestre,
  clearPersistedSemaLookup,
  consultarDocumentosSema,
  getPersistedSemaLookup,
  isSemaMasterFieldAllowed,
  isValidSemaAuditoriaId,
  mapPropertiesToCarFeature,
  sanitizePersistedLookupForStorage,
  setPersistedSemaLookup
} from '../src/services/carLookupService';
import { setTestSupabaseAdminForSemaAudit } from '../src/server/semaAudit';
import { resetSemaGeoserverCachesForTest } from '../src/server/semaGeoserver';
import {
  buildBarragemFieldComparisons,
  buildSemaAuditPayloadForBarragem,
  carFeatureToSemaItem,
  checkDuplicateEmpreendedorByCpfCnpj,
  extractSchemaConfirmedCpfCnpj,
  findManualNameCandidates,
  groupAndDeduplicateSemaResults,
  matchEmpreendedorByCpfCnpj,
  PROTECTED_BARRAGEM_FIELDS
} from '../src/utils/semaVinculoHelpers';
import { sanitizeSemaProperties } from '../src/config/carCampos';
import { SemaDocumentoItem } from '../src/types/carLookup';

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
  if (opts.body !== undefined) {
    req.body = opts.body;
  }
  return req;
}

function createMockRes() {
  let statusCode = 200;
  let body: any = null;
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    setHeader(k: string, v: string) {
      headers[k] = v;
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
    end(raw: string) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      return res;
    },
    getStatus: () => statusCode,
    getBody: () => body
  };
  return res;
}

function createConfiguredSemaAuthMock(role: 'Usuário' | 'Analista' | 'Administrador' = 'Usuário'): any {
  const synthUid = '00000000-0000-4000-8000-000000000010';
  return {
    auth: {
      async getUser(token: string) {
        if (token !== 'synthetic-jwt-token') {
          return { data: { user: null }, error: { message: 'Invalid JWT' } };
        }
        return { data: { user: { id: synthUid } }, error: null };
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
                      id: 'usr_synth_10',
                      papel: role,
                      situacao: 'Ativo',
                      status: 'Ativo',
                      auth_user_id: synthUid
                    },
                    error: null
                  };
                }
              };
            }
          };
        }
      };
    },
    async rpc() {
      return { data: '00000000-0000-4000-8000-000000000099', error: null };
    }
  };
}

test('Cenário 1 e 12: Deduplicação de CAR e barragens correspondentes (destaca sem repetir)', () => {
  const barragens = [
    { id: 'barr_1', nome: 'Barragem Sem Dono', car: 'MT47798/2017', municipio: 'Sorriso' },
    { id: 'barr_1', nome: 'Barragem Sem Dono', car: 'MT47798/2017', municipio: 'Sorriso' },
    { id: 'barr_2', nome: 'Barragem Vizinha', car: '47798/2017', municipio: 'Sorriso' }
  ];

  const items: SemaDocumentoItem[] = [
    {
      id: 'CAR_ATP.1',
      tipo: 'CAR / Imóvel Rural',
      numeroDocumento: 'MT47798/2017',
      nomeDocumento: 'Fazenda Esperança',
      dataDocumento: '2024-01-10',
      razaoSocial: 'Agropecuária Esperança Ltda',
      municipio: 'Sorriso',
      camadaOrigem: 'Geoportal:CAR_ATP',
      propriedadesBrutas: {
        NUMEROESTADUAL: 'MT47798/2017',
        NOMEPROPRIEDADE: 'Fazenda Esperança',
        MUNICIPIO: 'Sorriso'
      }
    },
    {
      id: 'MVW_REQ.9',
      tipo: 'CAR / Imóvel Rural',
      numeroDocumento: '47798/2017',
      nomeDocumento: 'Fazenda Esperança',
      dataDocumento: '2024-01-10',
      camadaOrigem: 'Geoportal:MVW_REQUERIMENTO_ATP',
      propriedadesBrutas: {
        PROTOCOLO: '47798/2017'
      }
    }
  ];

  const grouped = groupAndDeduplicateSemaResults(items, barragens, 'barr_1');
  assert.equal(grouped.carCards.length, 1, 'Mesmo CAR deve ser exibido em apenas um quadro');
  assert.equal(grouped.carCards[0].matchedBarragens.length, 2, 'Cada barragem deve aparecer uma única vez');
  assert.equal(grouped.carCards[0].hasCurrentDam, true);
  assert.equal(grouped.carCards[0].hasOtherRegisteredDam, true);
});

test('Cenário 2: Conversão de feição espacial preservando _schemaMeta e persistência sem expiração', () => {
  const mapped = mapPropertiesToCarFeature({
    type: 'Feature',
    id: 'CAR_ATP.55',
    camadaOrigem: 'Geoportal:CAR_ATP',
    _schemaMeta: {
      camposConfirmados: ['NUMEROESTADUAL', 'NOMEPROPRIEDADE', 'MUNICIPIO', 'MUNICIPIO_CODIGO'],
      cpfCnpjCompletoDisponivel: false,
      cpfCnpjStatus: 'ausente'
    },
    properties: {
      NUMEROESTADUAL: 'MT-12345/2020',
      NOMEPROPRIEDADE: 'Fazenda Modelo',
      MUNICIPIO: 'Lucas do Rio Verde',
      MUNICIPIO_CODIGO: '5105259'
    }
  });

  assert.deepEqual(mapped.camposConfirmadosEsquema, [
    'NUMEROESTADUAL',
    'NOMEPROPRIEDADE',
    'MUNICIPIO',
    'MUNICIPIO_CODIGO'
  ]);
  assert.equal(mapped.cpfCnpjCompletoDisponivel, false);

  const semaItem = carFeatureToSemaItem(mapped, '2026-11-15T12:00:00.000Z');
  assert.equal(semaItem.camadaOrigem, 'Geoportal:CAR_ATP');
  assert.equal(semaItem.cpfCnpjStatus, 'ausente');

  // Persistência em memória mantida até limpeza explícita
  const key = 'test:barragem:persist';
  setPersistedSemaLookup(key, { item: semaItem, consultadoEm: '2026-11-15T12:00:00.000Z' });
  const loaded = getPersistedSemaLookup<any>(key);
  assert.equal(loaded?.item?.numeroDocumento, 'MT-12345/2020');
  clearPersistedSemaLookup(key);
  assert.equal(getPersistedSemaLookup(key), null);
});

test('Cenário 4: CPF/CNPJ completo confirmado via DescribeFeatureType identifica único empreendedor sem auto-vínculo', () => {
  const item: SemaDocumentoItem = {
    id: 'LP.100',
    tipo: 'Licença Prévia',
    numeroDocumento: 'LP-999/2025',
    nomeDocumento: 'Fazenda Sol',
    dataDocumento: '2025-05-01',
    camadaOrigem: 'Geoportal:TDAD_LICENCIAMENTO_LICENCA_PREVIA',
    camposConfirmadosEsquema: ['NUMERO_DOCUMENTO', 'CPF_CNPJ', 'RAZAO_SOCIAL', 'MUNICIPIO'],
    cpfCnpjCompletoDisponivel: true,
    cpfCnpjCampoOrigem: 'CPF_CNPJ',
    cpfCnpjStatus: 'completo',
    propriedadesBrutas: {
      NUMERO_DOCUMENTO: 'LP-999/2025',
      CPF_CNPJ: '12.345.678/0001-90',
      RAZAO_SOCIAL: 'Fazenda Sol Agro S/A',
      MUNICIPIO: 'Sinop'
    }
  };

  const extracted = extractSchemaConfirmedCpfCnpj(item);
  assert.equal(extracted.status, 'completo');
  assert.equal(extracted.digits, '12345678000190');

  const empreendedores = [
    { id: 'emp_1', nome: 'Fazenda Sol Agro S/A', cpfCnpj: '12345678000190' },
    { id: 'emp_2', nome: 'Outro Empreendedor', cpfCnpj: '98765432000100' }
  ];

  const match = matchEmpreendedorByCpfCnpj(extracted.digits, empreendedores);
  assert.equal(match.status, 'unico');
  assert.equal(match.empreendedor?.id, 'emp_1');
});

test('Cenário 5: CPF/CNPJ mascarado, ausente ou campo não confirmado no esquema nunca é inferido/inventado', () => {
  const maskedItem: SemaDocumentoItem = {
    id: 'CAR.20',
    tipo: 'CAR / Imóvel Rural',
    numeroDocumento: 'MT11111/2019',
    nomeDocumento: 'Fazenda Norte',
    dataDocumento: '',
    razaoSocial: 'JOAO DA SILVA (***.456.***-89)',
    camadaOrigem: 'Geoportal:CAR_ATP',
    camposConfirmadosEsquema: ['NUMEROESTADUAL', 'NOMESPROPRIETARIOS'],
    cpfCnpjCompletoDisponivel: false,
    cpfCnpjStatus: 'mascarado',
    propriedadesBrutas: {
      NUMEROESTADUAL: 'MT11111/2019',
      NOMESPROPRIETARIOS: 'JOAO DA SILVA (***.456.***-89)'
    }
  };

  const docRes = extractSchemaConfirmedCpfCnpj(maskedItem);
  assert.equal(docRes.status, 'mascarado');
  assert.equal(docRes.digits, '');

  // Campo que não existe no DescribeFeatureType (mesmo se injetado em propriedadesBrutas) deve ser ignorado
  const unconfirmedFieldItem: SemaDocumentoItem = {
    ...maskedItem,
    cpfCnpjCompletoDisponivel: true,
    cpfCnpjCampoOrigem: 'CAMPO_INEXISTENTE_NO_ESQUEMA',
    propriedadesBrutas: {
      CAMPO_INEXISTENTE_NO_ESQUEMA: '111.222.333-44'
    }
  };
  assert.equal(extractSchemaConfirmedCpfCnpj(unconfirmedFieldItem).digits, '');

  // Nome semelhante gera apenas candidato para revisão manual
  const candidates = findManualNameCandidates('JOAO DA SILVA', [
    { id: 'emp_j1', nome: 'João da Silva', cpfCnpj: '11122233344' },
    { id: 'emp_j2', nome: 'Maria Oliveira', cpfCnpj: '55566677788' }
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].empreendedor.id, 'emp_j1');
  assert.match(candidates[0].motivo, /revisão manual/i);
});

test('Cenário 6 e 7: Múltiplos empreendedores com mesmo CPF/CNPJ (ambíguo) e verificação de duplicidade antes de criar novo', () => {
  const emps = [
    { id: 'emp_a', nome: 'Agro A', cpfCnpj: '12.345.678/0001-90' },
    { id: 'emp_b', nome: 'Agro B', cpfCnpj: '12345678000190' }
  ];

  const match = matchEmpreendedorByCpfCnpj('12345678000190', emps);
  assert.equal(match.status, 'ambiguo');
  assert.equal(match.matches.length, 2);

  const dup = checkDuplicateEmpreendedorByCpfCnpj('12.345.678/0001-90', emps);
  assert.equal(dup.hasDuplicate, true);
  assert.equal(dup.existing?.id, 'emp_a');

  const noDup = checkDuplicateEmpreendedorByCpfCnpj('99.888.777/0001-66', emps);
  assert.equal(noDup.hasDuplicate, false);
});

test('Cenário 8 e 9: Comparação lado a lado apenas para campos compatíveis; campos protegidos jamais sobrescritos', async () => {
  const semaItem: SemaDocumentoItem = {
    id: 'CAR_ATP.88',
    tipo: 'CAR / Imóvel Rural',
    numeroDocumento: 'MT88888/2021',
    nomeDocumento: 'Fazenda Santa Helena',
    numeroProcesso: '555444/2023',
    dataDocumento: '',
    municipio: 'Tangará da Serra',
    municipioCodigo: '5107958',
    camadaOrigem: 'Geoportal:CAR_ATP',
    camposConfirmadosEsquema: [
      'NUMEROESTADUAL',
      'NOMEPROPRIEDADE',
      'MUNICIPIO',
      'MUNICIPIO_CODIGO',
      'PROTOCOLO'
    ],
    propriedadesBrutas: {
      NUMEROESTADUAL: 'MT88888/2021',
      NOMEPROPRIEDADE: 'Fazenda Santa Helena',
      MUNICIPIO: 'Tangará da Serra',
      MUNICIPIO_CODIGO: '5107958',
      PROTOCOLO: '555444/2023'
    }
  };

  const comparisons = buildBarragemFieldComparisons(
    semaItem,
    {
      car: '',
      empreendimento: 'Fazenda Antiga',
      municipio: 'Tangará da Serra',
      municipioIbge: '',
      processo: ''
    },
    [{ id: 5107958, nome: 'Tangará da Serra' }]
  );

  const keys = comparisons.map(c => c.key);
  assert.deepEqual(keys, ['car', 'empreendimento', 'municipio', 'municipio_ibge', 'processo']);

  // Campos protegidos nunca aparecem nas comparações
  for (const k of keys) {
    assert.equal(PROTECTED_BARRAGEM_FIELDS.has(k), false);
  }

  // Vazio vem como 'preencher'; divergente inicia como 'manter'
  assert.equal(comparisons.find(c => c.key === 'car')?.action, 'preencher');
  assert.equal(comparisons.find(c => c.key === 'empreendimento')?.action, 'manter');
  assert.equal(comparisons.find(c => c.key === 'municipio')?.isEqual, true);

  // Bloqueio explícito na camada de serviço antes do RPC
  assert.equal(isSemaMasterFieldAllowed('barragem', 'latitude'), false);
  assert.equal(isSemaMasterFieldAllowed('barragem', 'longitude'), false);
  assert.equal(isSemaMasterFieldAllowed('barragem', 'altura'), false);
  assert.equal(isSemaMasterFieldAllowed('barragem', 'volume'), false);
  assert.equal(isSemaMasterFieldAllowed('barragem', 'dano_potencial'), false);
  assert.equal(isSemaMasterFieldAllowed('barragem', 'categoria_risco'), false);
  assert.equal(isSemaMasterFieldAllowed('barragem', 'situacao'), false);

  const blockedSingle = await aceitarDadoSemaParaMestre({
    auditoriaId: '00000000-0000-0000-0000-000000000001',
    entidadeTipo: 'barragem',
    entidadeId: 'barr_1',
    campoNome: 'latitude',
    novoValor: '-15.0000'
  });
  assert.equal(blockedSingle.success, false);

  const blockedBatch = await aceitarCamposSemaParaMestre({
    auditoriaId: '00000000-0000-0000-0000-000000000001',
    entidadeTipo: 'barragem',
    entidadeId: 'barr_1',
    campos: { altura: '20' }
  });
  assert.equal(blockedBatch.success, false);
});

test('Cenário 10: Sanitização de storage e payload de auditoria sem exposição de CPF/CNPJ completo', () => {
  const rawPayload = {
    query: '12345678901',
    items: [
      {
        camadaOrigem: 'Geoportal:CAR_ATP',
        propriedadesBrutas: {
          CPF_CNPJ: '12345678901',
          NOMESPROPRIETARIOS: 'FULANO DE TAL (123.456.789-01)',
          NUMEROESTADUAL: 'MT47798/2017'
        }
      }
    ]
  };

  const sanitized = sanitizePersistedLookupForStorage(rawPayload);
  const json = JSON.stringify(sanitized);
  assert.equal(json.includes('12345678901'), false);
  assert.equal(json.includes('123.456.789-01'), false);
  assert.equal(json.includes('MT47798/2017'), true);

  const auditPayload = buildSemaAuditPayloadForBarragem(
    {
      id: 'f1',
      tipo: 'CAR / Imóvel Rural',
      numeroDocumento: 'MT47798/2017',
      nomeDocumento: 'Fazenda Teste',
      dataDocumento: '',
      razaoSocial: 'FULANO DE TAL (12.345.678/0001-90)',
      camadaOrigem: 'Geoportal:CAR_ATP',
      propriedadesBrutas: {
        NUMEROESTADUAL: 'MT47798/2017',
        NOMEPROPRIEDADE: 'Fazenda Teste',
        CPF_CNPJ: '12.345.678/0001-90'
      }
    },
    []
  );
  assert.equal(JSON.stringify(auditPayload).includes('12.345.678/0001-90'), false);
  assert.equal(auditPayload.titularNome, 'FULANO DE TAL');
});

test('Cenário 10 e 11: API /api/sema-documentos bloqueia CPF/CNPJ em GET e valida atributos por DescribeFeatureType', async () => {
  setTestSupabaseAdminForSemaAudit(createConfiguredSemaAuthMock('Usuário'));
  const originalFetch = globalThis.fetch;

  try {
    // 1. GET com cpfCnpj na URL deve retornar 400
    const reqGet = createMockReq({
      method: 'GET',
      url: '/api/sema-documentos?cpfCnpj=12345678901',
      query: { cpfCnpj: '12345678901' },
      headers: { authorization: 'Bearer synthetic-jwt-token' }
    });
    const resGet = createMockRes();
    await semaDocumentosHandler(reqGet, resGet);
    assert.equal(resGet.getStatus(), 400);

    // 2. Mock de fetch para testar validação por DescribeFeatureType e camada indisponível
    globalThis.fetch = (async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('request=GetCapabilities') && urlStr.includes('service=WFS')) {
        const xml = `<WFS_Capabilities>
          <FeatureTypeList>
            <FeatureType><Name>Geoportal:CAR_ATP</Name><Title>CAR ATP</Title></FeatureType>
          </FeatureTypeList>
        </WFS_Capabilities>`;
        return new Response(xml, { status: 200 });
      }
      if (urlStr.includes('request=GetCapabilities') && urlStr.includes('service=wms')) {
        return new Response('<WMS_Capabilities></WMS_Capabilities>', { status: 200 });
      }
      if (urlStr.includes('request=DescribeFeatureType')) {
        const xsd = `<xsd:schema>
          <xsd:element name="the_geom" type="gml:MultiSurfacePropertyType"/>
          <xsd:element name="NUMEROESTADUAL" type="xsd:string"/>
          <xsd:element name="NOMEPROPRIEDADE" type="xsd:string"/>
          <xsd:element name="NOMESPROPRIETARIOS" type="xsd:string"/>
          <xsd:element name="MUNICIPIO" type="xsd:string"/>
        </xsd:schema>`;
        return new Response(xsd, { status: 200 });
      }
      if (urlStr.includes('request=GetFeature')) {
        return new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                id: 'CAR_ATP.77',
                properties: {
                  NUMEROESTADUAL: 'MT47798/2017',
                  NOMEPROPRIEDADE: '"Fazenda Teste Aspas"',
                  NOMESPROPRIETARIOS: 'PRODUTOR TESTE',
                  MUNICIPIO: 'Cuiabá'
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    // Testa /api/car-lookup por coordenada
    const reqCoord = createMockReq({
      method: 'GET',
      url: '/api/car-lookup?lat=-15.6&lng=-56.1',
      query: { lat: '-15.6', lng: '-56.1' },
      headers: { authorization: 'Bearer synthetic-jwt-token' }
    });
    const resCoord = createMockRes();
    await carLookupHandler(reqCoord, resCoord);

    assert.equal(resCoord.getStatus(), 200);
    const coordBody = resCoord.getBody();
    assert.equal(coordBody.encontrado, true);
    assert.equal(coordBody.feicoes.length, 1);
    assert.deepEqual(coordBody.feicoes[0]._schemaMeta.camposConfirmados, [
      'NUMEROESTADUAL',
      'NOMEPROPRIEDADE',
      'NOMESPROPRIETARIOS',
      'MUNICIPIO'
    ]);
    assert.equal(coordBody.feicoes[0]._schemaMeta.cpfCnpjCompletoDisponivel, false);
    const reqLayerStatus = coordBody.camadasConsultadas.find(
      (c: any) => c.camada === 'Geoportal:MVW_REQUERIMENTO_ATP'
    );
    assert.equal(reqLayerStatus?.status, 'indisponivel');

    // Testa /api/sema-documentos via POST por CAR
    const reqDocs = createMockReq({
      method: 'POST',
      url: '/api/sema-documentos',
      headers: { authorization: 'Bearer synthetic-jwt-token' },
      body: { car: 'MT47798/2017' }
    });
    const resDocs = createMockRes();
    await semaDocumentosHandler(reqDocs, resDocs);

    assert.equal(resDocs.getStatus(), 200);
    const docsBody = resDocs.getBody();
    assert.equal(docsBody.sucesso, true);
    assert.equal(docsBody.carImoveis.length, 1);
    assert.equal(docsBody.carImoveis[0].nomeDocumento, 'Fazenda Teste Aspas');
    assert.equal(docsBody.carImoveis[0].cpfCnpjCompletoDisponivel, false);
    assert.equal(
      docsBody.camadasConsultadas.some((c: any) => c.status === 'indisponivel'),
      true
    );
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    globalThis.fetch = originalFetch;
  }
});

test('Cenário 10 e 12: Preservação de processo/protocolo de 11 dígitos na sanitização e tratamento de consulta sem resultados', async () => {
  const sanitizedProps = sanitizeSemaProperties({
    processo: '12345678901',
    protocolo: '12345678901234',
    cpf_cnpj: '12345678901',
    observacao: 'Titular 123.456.789-01 processo 999888/2024'
  });

  assert.equal(sanitizedProps.processo, '12345678901');
  assert.equal(sanitizedProps.protocolo, '12345678901234');
  assert.notEqual(sanitizedProps.cpf_cnpj, '12345678901');
  assert.equal(String(sanitizedProps.observacao).includes('123.456.789-01'), false);

  const storageSanitized = sanitizePersistedLookupForStorage({
    items: [
      {
        numeroProcesso: '12345678901',
        cpfCnpj: '12345678901'
      }
    ]
  });
  assert.equal(storageSanitized.items[0].numeroProcesso, '12345678901');
  assert.notEqual(storageSanitized.items[0].cpfCnpj, '12345678901');

  // Agrupamento vazio retorna listas vazias sem erros
  const emptyGrouped = groupAndDeduplicateSemaResults([], [], 'barr_1');
  assert.deepEqual(emptyGrouped.carCards, []);
  assert.deepEqual(emptyGrouped.otherDocs, []);

  // Consulta API sem resultados retorna sucesso=true com listas vazias
  setTestSupabaseAdminForSemaAudit(createConfiguredSemaAuthMock('Usuário'));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('request=GetCapabilities') && urlStr.includes('service=WFS')) {
        return new Response(
          `<WFS_Capabilities><FeatureTypeList><FeatureType><Name>Geoportal:CAR_ATP</Name><Title>CAR ATP</Title></FeatureType></FeatureTypeList></WFS_Capabilities>`,
          { status: 200 }
        );
      }
      if (urlStr.includes('request=GetCapabilities') && urlStr.includes('service=wms')) {
        return new Response('<WMS_Capabilities></WMS_Capabilities>', { status: 200 });
      }
      if (urlStr.includes('request=DescribeFeatureType')) {
        return new Response(
          `<xsd:schema><xsd:element name="NUMEROESTADUAL" type="xsd:string"/></xsd:schema>`,
          { status: 200 }
        );
      }
      if (urlStr.includes('request=GetFeature')) {
        return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const reqCoordEmpty = createMockReq({
      method: 'GET',
      url: '/api/car-lookup?lat=-15.6&lng=-56.1',
      query: { lat: '-15.6', lng: '-56.1' },
      headers: { authorization: 'Bearer synthetic-jwt-token' }
    });
    const resCoordEmpty = createMockRes();
    await carLookupHandler(reqCoordEmpty, resCoordEmpty);
    assert.equal(resCoordEmpty.getStatus(), 200);
    assert.equal(resCoordEmpty.getBody().encontrado, false);
    assert.deepEqual(resCoordEmpty.getBody().feicoes, []);

    const reqDocsEmpty = createMockReq({
      method: 'POST',
      url: '/api/sema-documentos',
      headers: { authorization: 'Bearer synthetic-jwt-token' },
      body: { car: 'MT00000/2099' }
    });
    const resDocsEmpty = createMockRes();
    await semaDocumentosHandler(reqDocsEmpty, resDocsEmpty);
    assert.equal(resDocsEmpty.getStatus(), 200);
    assert.equal(resDocsEmpty.getBody().sucesso, true);
    assert.deepEqual(resDocsEmpty.getBody().carImoveis, []);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    globalThis.fetch = originalFetch;
  }
});

test('Cenário 13: Auditoria server-side via mock Supabase exige JWT, valida alvo, retorna auditoriaId e nunca grava CPF/CNPJ em claro', async () => {
  const rpcCalls: Array<{ fn: string; args: Record<string, any> }> = [];
  const MOCK_AUDIT_UUID = '11111111-2222-4333-8444-555555555555';
  let currentRole = 'Analista';
  let currentStatus = 'Ativo';
  let targetCreatedBy = 'user-123';

  const mockSupabaseAdmin: any = {
    auth: {
      async getUser(token: string) {
        if (token !== 'valid-jwt-token') {
          return { data: { user: null }, error: { message: 'Invalid JWT' } };
        }
        return { data: { user: { id: 'user-123' } }, error: null };
      }
    },
    from(table: string) {
      return {
        select() {
          return {
            eq(_col: string, val: string) {
              return {
                async maybeSingle() {
                  if (table === 'usuarios') {
                    return {
                      data: {
                        id: 'u1',
                        papel: currentRole,
                        situacao: currentStatus,
                        status: currentStatus,
                        auth_user_id: 'user-123'
                      },
                      error: null
                    };
                  }
                  if (table === 'barragens' && val === 'barr_target_1') {
                    return {
                      data: { id: 'barr_target_1', created_by: targetCreatedBy },
                      error: null
                    };
                  }
                  return { data: null, error: null };
                }
              };
            }
          };
        }
      };
    },
    async rpc(fn: string, args: Record<string, any>) {
      rpcCalls.push({ fn, args });
      return { data: MOCK_AUDIT_UUID, error: null };
    }
  };

  const originalFetch = globalThis.fetch;
  setTestSupabaseAdminForSemaAudit(mockSupabaseAdmin);

  try {
    globalThis.fetch = (async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('request=GetCapabilities') && urlStr.includes('service=WFS')) {
        return new Response(
          `<WFS_Capabilities><FeatureTypeList>
            <FeatureType><Name>Geoportal:CAR_ATP</Name><Title>CAR ATP</Title></FeatureType>
            <FeatureType><Name>Geoportal:TDAD_LICENCIAMENTO_LICENCA_PREVIA</Name><Title>Licença Prévia</Title></FeatureType>
          </FeatureTypeList></WFS_Capabilities>`,
          { status: 200 }
        );
      }
      if (urlStr.includes('request=GetCapabilities') && urlStr.includes('service=wms')) {
        return new Response('<WMS_Capabilities></WMS_Capabilities>', { status: 200 });
      }
      if (urlStr.includes('request=DescribeFeatureType')) {
        return new Response(
          `<xsd:schema>
            <xsd:element name="the_geom" type="gml:MultiSurfacePropertyType"/>
            <xsd:element name="NUMEROESTADUAL" type="xsd:string"/>
            <xsd:element name="NOMEPROPRIEDADE" type="xsd:string"/>
            <xsd:element name="NOMESPROPRIETARIOS" type="xsd:string"/>
            <xsd:element name="CPF_CNPJ" type="xsd:string"/>
            <xsd:element name="MUNICIPIO" type="xsd:string"/>
            <xsd:element name="MUNICIPIO_CODIGO" type="xsd:string"/>
          </xsd:schema>`,
          { status: 200 }
        );
      }
      if (urlStr.includes('request=GetFeature')) {
        return new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                id: 'CAR_ATP.99',
                properties: {
                  NUMEROESTADUAL: 'MT99999/2024',
                  NOMEPROPRIEDADE: 'Fazenda Auditada',
                  NOMESPROPRIETARIOS: 'PRODUTOR AUDITADO (12.345.678/0001-90)',
                  CPF_CNPJ: '12.345.678/0001-90',
                  MUNICIPIO: 'Sorriso',
                  MUNICIPIO_CODIGO: '5107925'
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    // 1. Sem Bearer token -> 401
    const resUnauth = createMockRes();
    await carLookupHandler(
      createMockReq({ method: 'GET', url: '/api/car-lookup?lat=-15.6&lng=-56.1', query: { lat: '-15.6', lng: '-56.1' } }),
      resUnauth
    );
    assert.equal(resUnauth.getStatus(), 401);

    // 2. Usuário comum tentando vincular auditoria a barragem de outro usuário -> 403
    currentRole = 'Usuário';
    targetCreatedBy = 'other-user-999';
    const resForbidden = createMockRes();
    await semaDocumentosHandler(
      createMockReq({
        method: 'POST',
        url: '/api/sema-documentos',
        headers: { authorization: 'Bearer valid-jwt-token' },
        body: {
          cpfCnpj: '12345678000190',
          entidadeAlvoTipo: 'barragem',
          entidadeAlvoId: 'barr_target_1'
        }
      }),
      resForbidden
    );
    assert.equal(resForbidden.getStatus(), 403);

    // 3. Analista autenticado consulta via /api/sema-documentos por CPF/CNPJ -> grava auditoria com hashes SHA-256 e retorna auditoriaId
    currentRole = 'Analista';
    const resDocs = createMockRes();
    await semaDocumentosHandler(
      createMockReq({
        method: 'POST',
        url: '/api/sema-documentos',
        headers: { authorization: 'Bearer valid-jwt-token' },
        body: {
          cpfCnpj: '12345678000190',
          entidadeAlvoTipo: 'barragem',
          entidadeAlvoId: 'barr_target_1'
        }
      }),
      resDocs
    );
    assert.equal(resDocs.getStatus(), 200);
    const docsBody = resDocs.getBody();
    assert.equal(docsBody.carImoveis[0].auditoriaId, MOCK_AUDIT_UUID);
    assert.equal(isValidSemaAuditoriaId(docsBody.carImoveis[0].auditoriaId), true);

    assert.ok(rpcCalls.length >= 1);
    const auditCall = rpcCalls[0];
    assert.equal(auditCall.fn, 'registrar_consulta_sema_auditoria');
    assert.equal(auditCall.args.p_criterio_tipo, 'cpf_cnpj_hash');
    assert.match(String(auditCall.args.p_criterio_referencia), /^[a-f0-9]{64}$/);
    assert.equal(auditCall.args.p_doc_status, 'completo');
    assert.match(String(auditCall.args.p_doc_sha256), /^[a-f0-9]{64}$/);
    assert.equal(auditCall.args.p_entidade_alvo_tipo, 'barragem');
    assert.equal(auditCall.args.p_entidade_alvo_id, 'barr_target_1');
    assert.equal(auditCall.args.p_consultado_por, 'user-123');

    const serializedAudit = JSON.stringify(auditCall.args);
    assert.equal(serializedAudit.includes('12345678000190'), false, 'CNPJ sem máscara não pode ir para auditoria');
    assert.equal(serializedAudit.includes('12.345.678/0001-90'), false, 'CNPJ formatado não pode ir para auditoria');

    // 4. /api/car-lookup também retorna auditoriaId e propaga até carFeatureToSemaItem
    const resCoord = createMockRes();
    await carLookupHandler(
      createMockReq({
        method: 'GET',
        url: '/api/car-lookup?lat=-15.6&lng=-56.1&entidadeAlvoTipo=barragem&entidadeAlvoId=barr_target_1',
        headers: { authorization: 'Bearer valid-jwt-token' },
        query: {
          lat: '-15.6',
          lng: '-56.1',
          entidadeAlvoTipo: 'barragem',
          entidadeAlvoId: 'barr_target_1'
        }
      }),
      resCoord
    );
    assert.equal(resCoord.getStatus(), 200);
    const featRaw = resCoord.getBody().feicoes[0];
    assert.equal(featRaw.auditoriaId, MOCK_AUDIT_UUID);
    const mappedFeat = mapPropertiesToCarFeature(featRaw);
    const mappedItem = carFeatureToSemaItem(mappedFeat);
    assert.equal(mappedItem.auditoriaId, MOCK_AUDIT_UUID);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    globalThis.fetch = originalFetch;
  }
});

test('Cenário 14: Bloqueia aceite sem auditoriaId UUID válido e rejeita cpf_cnpj/campos protegidos no serviço', async () => {
  assert.equal(isValidSemaAuditoriaId(''), false);
  assert.equal(isValidSemaAuditoriaId('forged-id'), false);
  assert.equal(isValidSemaAuditoriaId('11111111-2222-4333-8444-555555555555'), true);

  assert.equal(isSemaMasterFieldAllowed('empreendedor', 'cpf_cnpj'), false);
  assert.equal(isSemaMasterFieldAllowed('barragem', 'empreendedor'), false);
  assert.equal(isSemaMasterFieldAllowed('barragem', 'snisb'), false);

  const missingAuditSingle = await aceitarDadoSemaParaMestre({
    auditoriaId: '',
    entidadeTipo: 'barragem',
    entidadeId: 'barr_1',
    campoNome: 'car',
    novoValor: 'MT47798/2017'
  });
  assert.equal(missingAuditSingle.success, false);
  assert.match(String(missingAuditSingle.error), /auditoria/i);

  const missingAuditBatch = await aceitarCamposSemaParaMestre({
    auditoriaId: 'not-a-uuid',
    entidadeTipo: 'barragem',
    entidadeId: 'barr_1',
    campos: { car: 'MT47798/2017', empreendedor_id: 'emp_1' },
    criterioVinculo: 'confirmacao_manual_analista'
  });
  assert.equal(missingAuditBatch.success, false);
  assert.match(String(missingAuditBatch.error), /auditoria/i);
});

test('Cenário 15: Resiliência contra HTTP 403 no GetCapabilities, GET cql_filter (POST XML fallback) e proxy POST->GET', async () => {
  const originalFetch = globalThis.fetch;
  resetSemaGeoserverCachesForTest();
  setTestSupabaseAdminForSemaAudit(createConfiguredSemaAuthMock('Usuário'));

  try {
    // 1. GeoServer bloqueando GetCapabilities (403) e GET GetFeature com cql_filter (403),
    // mas aceitando DescribeFeatureType e POST XML WFS 1.1.0
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const urlStr = String(input);
      const method = String(init?.method || 'GET').toUpperCase();

      if (urlStr.includes('request=GetCapabilities')) {
        return new Response('<html><body>403 Forbidden</body></html>', { status: 403 });
      }
      if (urlStr.includes('request=DescribeFeatureType')) {
        if (urlStr.includes('Geoportal%3ACAR_ATP') || urlStr.includes('Geoportal:CAR_ATP')) {
          return new Response(
            `<xsd:schema>
              <xsd:element name="the_geom" type="gml:MultiSurfacePropertyType"/>
              <xsd:element name="NUMEROESTADUAL" type="xsd:string"/>
              <xsd:element name="NOMEPROPRIEDADE" type="xsd:string"/>
              <xsd:element name="MUNICIPIO" type="xsd:string"/>
            </xsd:schema>`,
            { status: 200 }
          );
        }
        return new Response('', { status: 404 });
      }
      if (urlStr.includes('request=GetFeature')) {
        if (method === 'GET' || String(init?.headers && (init.headers as any)['Content-Type']).includes('x-www-form-urlencoded')) {
          return new Response('<html><body>403 WAF Blocked CQL</body></html>', { status: 403 });
        }
        if (method === 'POST' && String(init?.body || '').includes('<wfs:GetFeature')) {
          return new Response(
            JSON.stringify({
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  id: 'CAR_ATP.403',
                  properties: {
                    NUMEROESTADUAL: 'MT55555/2024',
                    NOMEPROPRIEDADE: 'Fazenda Resiliente',
                    MUNICIPIO: 'Sorriso'
                  }
                }
              ]
            }),
            { status: 200 }
          );
        }
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const reqResilient = createMockReq({
      method: 'POST',
      url: '/api/sema-documentos',
      headers: { authorization: 'Bearer synthetic-jwt-token' },
      body: { car: 'MT55555/2024' }
    });
    const resResilient = createMockRes();
    await semaDocumentosHandler(reqResilient, resResilient);

    assert.equal(resResilient.getStatus(), 200);
    const body = resResilient.getBody();
    assert.equal(body.sucesso, true);
    assert.equal(body.carImoveis.length, 1);
    assert.equal(body.carImoveis[0].numeroDocumento, 'MT55555/2024');
    assert.equal(body.carImoveis[0].nomeDocumento, 'Fazenda Resiliente');

    // 2. Cliente: se POST /api/sema-documentos retornar 403 HTML do proxy, faz fallback para GET seguro
    const seenUrls: string[] = [];
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const urlStr = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      seenUrls.push(`${method} ${urlStr}`);

      if (urlStr.startsWith('/api/sema-documentos') && method === 'POST') {
        return new Response('<html><body>403 Forbidden by Proxy</body></html>', { status: 403 });
      }
      if (urlStr.startsWith('/api/sema-documentos') && method === 'GET') {
        assert.equal(urlStr.includes('cpfCnpj'), false, 'Fallback GET nunca deve conter cpfCnpj na URL');
        return new Response(
          JSON.stringify({
            sucesso: true,
            carImoveis: [
              {
                id: 'CAR_ATP.777',
                tipo: 'CAR / Imóvel Rural',
                numeroDocumento: 'MT77777/2024',
                nomeDocumento: 'Fazenda Via Get Fallback',
                dataDocumento: '',
                camadaOrigem: 'Geoportal:CAR_ATP'
              }
            ],
            licencas: [],
            notificacoes: [],
            autosInfracao: [],
            termosEmbargo: [],
            outros: [],
            totalRegistros: 1,
            consultadoEm: '2026-11-16T12:00:00.000Z',
            mensagemStatus: '1 registro(s) encontrado(s).',
            camadasConsultadas: []
          }),
          { status: 200 }
        );
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const clientRes = await consultarDocumentosSema({
      cpfCnpj: '12345678901',
      car: 'MT77777/2024',
      cars: ['MT77777/2024']
    });
    assert.equal(clientRes.sucesso, true);
    assert.equal(clientRes.carImoveis.length, 1);
    assert.equal(clientRes.carImoveis[0].numeroDocumento, 'MT77777/2024');
    assert.equal(seenUrls.some(u => u.startsWith('POST /api/sema-documentos')), true);
    assert.equal(seenUrls.some(u => u.startsWith('GET /api/sema-documentos')), true);
  } finally {
    setTestSupabaseAdminForSemaAudit(null);
    resetSemaGeoserverCachesForTest();
    globalThis.fetch = originalFetch;
  }
});
