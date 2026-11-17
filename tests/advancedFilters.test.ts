import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectDistinctValues,
  countActiveAdvancedFilters,
  EMPTY_BARRAGENS_FILTERS,
  EMPTY_CONCILIACAO_FILTERS,
  EMPTY_EMPREENDEDORES_FILTERS,
  EMPTY_PORTARIAS_FILTERS,
  EMPTY_PRODUTIVIDADE_FILTERS,
  EMPTY_RTS_FILTERS,
  EMPTY_USUARIOS_FILTERS,
  hasValidCoordinates,
  matchesBarragemAdvanced,
  matchesConciliacaoBarragemAdvanced,
  matchesConciliacaoEmpreendedorAdvanced,
  matchesConciliacaoRevisaoAdvanced,
  matchesEmpreendedorAdvanced,
  matchesPortariaAdvanced,
  matchesProdutividadeAdvanced,
  matchesRtAdvanced,
  matchesUsuarioAdvanced
} from '../src/utils/databaseAdvancedFilters';

test('countActiveAdvancedFilters and helpers handle text, digits, dates, ranges, coordinates, and distinct values', () => {
  assert.equal(countActiveAdvancedFilters(EMPTY_EMPREENDEDORES_FILTERS, EMPTY_EMPREENDEDORES_FILTERS), 0);
  assert.equal(
    countActiveAdvancedFilters(
      { ...EMPTY_BARRAGENS_FILTERS, uf: 'MT', alturaMin: '10', situacao: 'Confirmada' },
      EMPTY_BARRAGENS_FILTERS,
      ['situacao']
    ),
    2
  );

  assert.equal(hasValidCoordinates('-15.601', '-56.097'), true);
  assert.equal(hasValidCoordinates("15° 36' 03\" S", "56° 05' 49\" W"), true);
  assert.equal(hasValidCoordinates('', '-56.097'), false);
  assert.equal(hasValidCoordinates('invalid', 'invalid'), false);

  const distinct = collectDistinctValues(
    [{ setor: ' CSB ' }, { setor: 'CSB' }, { setor: 'OUTORGA' }, { setor: '—' }, { setor: null }],
    item => item.setor
  );
  assert.deepEqual(distinct, ['CSB', 'OUTORGA']);
});

test('matchesEmpreendedorAdvanced filters across all empreendedor fields and linked context', () => {
  const rec = {
    id: 'emp-1',
    tipoPessoa: 'PJ',
    nome: 'Agropecuária Água Limpa Ltda',
    nomeFantasia: 'Fazenda Água Limpa',
    cpfCnpj: '12.345.678/0001-90',
    email: 'contato@agualimpa.com.br',
    telefone: '(65) 99988-1122',
    uf: 'MT',
    municipio: 'Sorriso',
    municipioIbge: '5107925',
    situacao: 'Ativo',
    observacoes: 'Cadastro validado pela equipe CSB',
    updatedAt: '2026-05-10T12:00:00Z',
    empreendimentos: [
      {
        nome: 'Fazenda Primavera',
        car: 'MT-5107925-AABBCC11',
        escritura: 'Matrícula 4410',
        tipo: 'Irrigação',
        municipio: 'Sorriso'
      }
    ]
  };
  const vinculos = {
    cars: ['MT-5107925-AABBCC11'],
    processos: ['2026/00101-SEMA'],
    barragensVinculadas: [{ nome: 'Barragem Norte', processo: '2026/00101-SEMA', snisb: 'SN-10' }]
  };

  assert.equal(matchesEmpreendedorAdvanced(rec, EMPTY_EMPREENDEDORES_FILTERS, vinculos), true);
  assert.equal(
    matchesEmpreendedorAdvanced(
      rec,
      {
        ...EMPTY_EMPREENDEDORES_FILTERS,
        tipoPessoa: 'PJ',
        nome: 'agua limpa',
        nomeFantasia: 'fazenda',
        cpfCnpj: '12345678000190',
        email: 'agualimpa.com.br',
        telefone: '6599988',
        uf: 'MT',
        municipio: '5107925',
        situacao: 'Ativo',
        empreendimentoStatus: 'com_car',
        barragemStatus: 'com_barragens',
        empreendimentoTexto: 'matricula 4410',
        barragemOuProcesso: '2026/00101',
        observacoes: 'equipe csb',
        dataInicio: '2026-05-01',
        dataFim: '2026-05-31'
      },
      vinculos
    ),
    true
  );

  assert.equal(
    matchesEmpreendedorAdvanced(rec, { ...EMPTY_EMPREENDEDORES_FILTERS, empreendimentoStatus: 'sem_car' }, vinculos),
    false
  );
  assert.equal(
    matchesEmpreendedorAdvanced(rec, { ...EMPTY_EMPREENDEDORES_FILTERS, barragemStatus: 'sem_barragens' }, vinculos),
    false
  );
});

test('matchesBarragemAdvanced filters all fields including ranges, coordinates, DPA/CRI and dates', () => {
  const rec = {
    id: 'bar-1',
    nome: 'Barragem São José',
    car: 'MT-5103403-XYZ999',
    uf: 'MT',
    municipio: 'Cuiabá',
    municipioIbge: '5103403',
    processo: '2025/09090-SEMA',
    snisb: '900123',
    cursoAgua: 'Córrego Ribeirão',
    latitude: '-15.601',
    longitude: '-56.097',
    danoPotencial: 'Médio',
    categoriaRisco: 'Baixo',
    altura: '14,5',
    volume: '125000',
    situacao: 'Confirmada',
    classificadaEm: '2026-02-15T09:00:00Z',
    updatedAt: '2026-06-01T10:00:00Z',
    observacoes: 'Vertedouro inspecionado'
  };
  const ctx = {
    resolvedEmpreendedorId: 'emp-1',
    resolvedEmpreendedorName: 'Agropecuária Central',
    resolvedEmpreendimentoName: 'Estância São José'
  };

  assert.equal(matchesBarragemAdvanced(rec, EMPTY_BARRAGENS_FILTERS, ctx), true);
  assert.equal(
    matchesBarragemAdvanced(
      rec,
      {
        ...EMPTY_BARRAGENS_FILTERS,
        nome: 'sao jose',
        car: 'xyz999',
        carStatus: 'com_car',
        uf: 'MT',
        municipio: 'cuiaba',
        empreendedorStatus: 'com_empreendedor',
        empreendedor: 'central',
        empreendimento: 'estancia',
        processo: '09090',
        snisb: '900123',
        cursoAgua: 'ribeirao',
        coordenadasStatus: 'com_coordenadas',
        danoPotencial: 'Médio',
        categoriaRisco: 'Baixo',
        alturaMin: '10',
        alturaMax: '20',
        volumeMin: '100000',
        volumeMax: '200000',
        situacao: 'Confirmada',
        classificadaInicio: '2026-02-01',
        classificadaFim: '2026-02-28',
        atualizadaInicio: '2026-06-01',
        atualizadaFim: '2026-06-30',
        observacoes: 'vertedouro'
      },
      ctx
    ),
    true
  );

  assert.equal(
    matchesBarragemAdvanced(rec, { ...EMPTY_BARRAGENS_FILTERS, alturaMin: '16' }, ctx),
    false
  );
  assert.equal(
    matchesBarragemAdvanced(rec, { ...EMPTY_BARRAGENS_FILTERS, coordenadasStatus: 'sem_coordenadas' }, ctx),
    false
  );
  assert.equal(
    matchesBarragemAdvanced({ ...rec, danoPotencial: '' }, { ...EMPTY_BARRAGENS_FILTERS, danoPotencial: 'nao_informado' }, ctx),
    true
  );
});

test('matchesRtAdvanced filters RT attributes, vinculos, ART/RRT, validade and revisaoStatus', () => {
  const rt = {
    id: 'rt-1',
    nome: 'Eng. Marina Costa',
    cpf: '111.222.333-44',
    conselho: 'CREA',
    ufConselho: 'MT',
    registro: 'MT-045912',
    especialidades: 'Geotecnia e Hidrologia',
    email: 'marina@eng.com.br',
    telefone: '(65) 98111-2233',
    requiresReview: true,
    situacao: 'Ativo',
    observacoes: 'ART anexada em PDF',
    vinculos: [
      {
        artRrt: 'ART-2026-7788',
        barragemId: 'bar-1',
        barragemNome: 'Barragem Verde',
        validade: '2099-12-31',
        processo: '2026/00444'
      }
    ]
  };
  const resolveDam = (_id?: string | null, fallback?: string | null) => fallback || 'Barragem Verde';

  assert.equal(matchesRtAdvanced(rt, EMPTY_RTS_FILTERS, resolveDam), true);
  assert.equal(
    matchesRtAdvanced(
      rt,
      {
        ...EMPTY_RTS_FILTERS,
        nome: 'marina',
        cpf: '11122233344',
        conselho: 'CREA',
        ufConselho: 'MT',
        registro: '045912',
        especialidades: 'geotecnia',
        email: 'eng.com',
        telefone: '6598111',
        artRrt: '7788',
        barragemVinculada: 'verde',
        processo: '00444',
        validadeStatus: 'vigente',
        validadeInicio: '2099-01-01',
        validadeFim: '2099-12-31',
        revisaoStatus: 'revisao_necessaria',
        situacao: 'Ativo',
        observacoes: 'pdf'
      },
      resolveDam
    ),
    true
  );
  assert.equal(
    matchesRtAdvanced(rt, { ...EMPTY_RTS_FILTERS, validadeStatus: 'vencida' }, resolveDam),
    false
  );
  assert.equal(
    matchesRtAdvanced(rt, { ...EMPTY_RTS_FILTERS, revisaoStatus: 'confiavel' }, resolveDam),
    false
  );
});

test('matchesUsuarioAdvanced, matchesProdutividadeAdvanced and matchesPortariaAdvanced filter all domain fields', () => {
  const user = {
    nome: 'Carlos Eduardo',
    matricula: 'MAT-9921',
    login: 'carlos.eduardo',
    email: 'carlos@sema.mt.gov.br',
    perfilProfissional: 'Analista de Meio Ambiente',
    setor: 'CSB',
    papel: 'Gestor',
    situacao: 'Ativo',
    observacoes: 'Acesso Administra e Notifica',
    updatedAt: '2026-04-12T15:00:00Z'
  };
  assert.equal(
    matchesUsuarioAdvanced(user, {
      ...EMPTY_USUARIOS_FILTERS,
      nome: 'carlos',
      matricula: '9921',
      login: 'carlos.eduardo',
      email: 'sema.mt',
      perfilProfissional: 'Analista de Meio Ambiente',
      setor: 'CSB',
      papel: 'Gestor',
      situacao: 'Ativo',
      observacoes: 'notifica',
      dataInicio: '2026-04-01',
      dataFim: '2026-04-30'
    }),
    true
  );

  const prod = {
    serverName: 'Ana Paula',
    unit: 'CSB',
    kind: 'extra',
    productCode: 'P-12',
    sourceType: 'notifica',
    sourceName: 'Notifica',
    processRef: '2026/00555',
    documentRef: 'NOT-88',
    extraStatus: 'Aprovado',
    coordinator: 'João Coordenador',
    inOfficialSheet: true,
    date: '2026-05-03',
    productTitle: 'Vistoria Técnica',
    notes: 'Relatório fotográfico completo'
  };
  assert.equal(
    matchesProdutividadeAdvanced(
      prod,
      {
        ...EMPTY_PRODUTIVIDADE_FILTERS,
        serverName: 'ana paula',
        unit: 'csb',
        kind: 'extra',
        productCode: 'P-12',
        sourceType: 'notifica',
        sourceName: 'notifica',
        processRef: '00555',
        documentRef: 'not-88',
        extraStatus: 'Aprovado',
        coordinator: 'joao',
        inOfficialSheet: 'sim',
        pontosMin: '15',
        pontosMax: '25',
        dataInicio: '2026-05-01',
        dataFim: '2026-05-31',
        descricaoNotas: 'fotografico'
      },
      () => 20
    ),
    true
  );

  const portaria = {
    processNumber: '2026/12345',
    orderNumber: 'PORT-089/2026',
    secretarySigned: true,
    extractPublished: true,
    orderPublished: true,
    draft: false,
    sentDate: '2026-03-01',
    finalDate: '2026-03-20',
    notes: 'Publicada no DOE-MT'
  };
  assert.equal(
    matchesPortariaAdvanced(portaria, {
      ...EMPTY_PORTARIAS_FILTERS,
      processNumber: '12345',
      orderNumber: '089',
      status: 'Concluído',
      secretarySigned: 'sim',
      extractPublished: 'sim',
      orderPublished: 'sim',
      draft: 'nao',
      envioInicio: '2026-03-01',
      envioFim: '2026-03-05',
      finalInicio: '2026-03-10',
      finalFim: '2026-03-31',
      notes: 'doe-mt'
    }),
    true
  );
  assert.equal(
    matchesPortariaAdvanced(portaria, { ...EMPTY_PORTARIAS_FILTERS, status: 'Pendente' }),
    false
  );
});

test('matchesConciliacao helpers filter entrepreneurs, dams without link, and cross-system revisions', () => {
  const emp = {
    uf: 'MT',
    municipio: 'Lucas do Rio Verde',
    cpfCnpj: '55.444.333/0001-22',
    tipoPessoa: 'PJ',
    email: 'adm@lucas.com',
    telefone: '6535490000',
    situacao: 'Ativo',
    empreendimentos: [{ car: 'MT-5105259-001' }]
  };
  assert.equal(
    matchesConciliacaoEmpreendedorAdvanced(emp, {
      ...EMPTY_CONCILIACAO_FILTERS,
      uf: 'MT',
      municipio: 'lucas',
      cpfCnpj: '55444333000122',
      tipoPessoa: 'PJ',
      car: '5105259',
      temCar: 'com_car',
      temEmpreendimentos: 'com',
      contato: '3549',
      situacaoDetalhada: 'Ativo'
    }),
    true
  );

  const damItem = {
    record: {
      uf: 'MT',
      municipio: 'Sinop',
      car: 'MT-5107909-555',
      processo: '2026/0777',
      snisb: 'SN-77',
      cursoAgua: 'Rio Teles Pires',
      latitude: '-11.864',
      longitude: '-55.502',
      danoPotencial: 'Alto',
      categoriaRisco: 'Médio',
      situacao: 'Aguardando confirmação'
    },
    legacyText: 'Agro Sinop Ltda',
    suggestedEmpreendedorId: 'emp-9',
    suggestedEmpreendedorName: 'Agro Sinop Ltda',
    brokenReference: false
  };
  assert.equal(
    matchesConciliacaoBarragemAdvanced(damItem, {
      ...EMPTY_CONCILIACAO_FILTERS,
      uf: 'MT',
      municipio: 'sinop',
      car: '5107909',
      temCar: 'com_car',
      processo: '0777',
      snisb: 'sn-77',
      cursoAgua: 'teles pires',
      temCoordenadas: 'com_coordenadas',
      vinculoSugerido: 'sugerido',
      contato: 'agro sinop',
      danoPotencial: 'Alto',
      categoriaRisco: 'Médio',
      situacaoDetalhada: 'Aguardando confirmação'
    }),
    true
  );

  const revisao = {
    entidade: 'Barragem',
    origemA: 'Administra',
    origemB: 'Classifica',
    identificador: 'CAR MT-5107909-555',
    divergencias: 'DPA divergente entre sistemas',
    situacao: 'Pendente'
  };
  assert.equal(
    matchesConciliacaoRevisaoAdvanced(revisao, 'divergente', {
      ...EMPTY_CONCILIACAO_FILTERS,
      revisaoOrigem: 'classifica',
      revisaoSituacao: 'Pendente'
    }),
    true
  );
  assert.equal(
    matchesConciliacaoRevisaoAdvanced(revisao, 'divergente', {
      ...EMPTY_CONCILIACAO_FILTERS,
      revisaoSituacao: 'Concluído'
    }),
    false
  );
});
