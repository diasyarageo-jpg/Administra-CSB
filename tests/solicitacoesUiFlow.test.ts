// tests/solicitacoesUiFlow.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  SOLICITACOES_API_BASE,
  buildBarragemSolicitacaoDraft,
  canCreateSolicitacaoVistoriaRole,
  extractSafeErrorMessage,
  listarSolicitacoesVistoria
} from '../src/services/solicitacoesVistoriaService';
import {
  SolicitacoesVistoriaErrorBoundary,
  SolicitacoesVistoriaView
} from '../src/components/SolicitacoesVistoriaView';
import { VisualizacaoModal } from '../src/components/VisualizacaoModal';

test('Solicitações UI: atalho Solicitar vistoria permitido apenas para Administrador e Analista', () => {
  assert.equal(canCreateSolicitacaoVistoriaRole('Administrador'), true);
  assert.equal(canCreateSolicitacaoVistoriaRole('Analista'), true);
  assert.equal(canCreateSolicitacaoVistoriaRole('Visualizador'), false);
  assert.equal(canCreateSolicitacaoVistoriaRole('Usuário'), false);
  assert.equal(canCreateSolicitacaoVistoriaRole(undefined), false);

  const dam = {
    id: 'bar_100',
    nome: 'Barragem Rio Claro',
    municipio: 'Tangará da Serra',
    cursoAgua: 'Rio Claro',
    latitude: '-14.6229',
    longitude: '-57.4933',
    danoPotencial: 'Alto',
    categoriaRisco: 'Médio',
    empreendedor: 'emp_100',
    createdAt: '2026-11-20T00:00:00Z',
    updatedAt: '2026-11-20T00:00:00Z'
  };

  const db = {
    empreendedores: [
      {
        id: 'emp_100',
        nome: 'Cooperativa Vale Verde',
        cpfCnpj: '12.345.678/0001-90',
        createdAt: '2026-11-20T00:00:00Z',
        updatedAt: '2026-11-20T00:00:00Z'
      }
    ],
    barragens: [dam],
    rts: [],
    documentos: [],
    portarias: []
  };

  const adminHtml = renderToStaticMarkup(
    React.createElement(VisualizacaoModal, {
      moduleKey: 'barragens',
      record: dam,
      index: 0,
      db,
      canEdit: true,
      canSolicitarVistoria: canCreateSolicitacaoVistoriaRole('Administrador'),
      onClose: () => {},
      onSolicitarVistoria: () => {}
    })
  );
  assert.equal(adminHtml.includes('Solicitar vistoria'), true);

  const analystHtml = renderToStaticMarkup(
    React.createElement(VisualizacaoModal, {
      moduleKey: 'barragens',
      record: dam,
      index: 0,
      db,
      canEdit: true,
      canSolicitarVistoria: canCreateSolicitacaoVistoriaRole('Analista'),
      onClose: () => {},
      onSolicitarVistoria: () => {}
    })
  );
  assert.equal(analystHtml.includes('Solicitar vistoria'), true);

  const viewerHtml = renderToStaticMarkup(
    React.createElement(VisualizacaoModal, {
      moduleKey: 'barragens',
      record: dam,
      index: 0,
      db,
      canEdit: false,
      canSolicitarVistoria: canCreateSolicitacaoVistoriaRole('Visualizador'),
      onClose: () => {},
      onSolicitarVistoria: () => {}
    })
  );
  assert.equal(viewerHtml.includes('Solicitar vistoria'), false);
});

test('Solicitações UI: pré-preenchimento a partir da barragem usa somente os 7 campos permitidos e nunca expõe CPF/CNPJ', () => {
  const empreendedores = [
    {
      id: 'emp_501',
      nome: 'Agroindustrial Cerrado Ltda',
      cpfCnpj: '12.345.678/0001-90',
      createdAt: '2026-11-20T00:00:00Z',
      updatedAt: '2026-11-20T00:00:00Z'
    }
  ];

  const completeDam = {
    id: 'bar_501',
    nome: 'Barragem Santa Luzia',
    municipio: 'Sorriso',
    cursoAgua: 'Ribeirão Celeste',
    latitude: '-12.5425',
    longitude: '-55.7211',
    uso: 'Irrigação',
    danoPotencial: 'Alto',
    categoriaRisco: 'Baixo',
    processo: 'PROC-2026/0044',
    empreendedor: 'emp_501',
    cpfCnpj: '12345678901'
  };

  const draft = buildBarragemSolicitacaoDraft(completeDam, empreendedores);
  assert.equal(draft.barragem_id, 'bar_501');
  assert.equal(draft.empreendedor_id, 'emp_501');
  assert.equal(draft.processo_referencia, 'PROC-2026/0044');

  const allowedKeys = new Set([
    'nome_barragem',
    'municipio',
    'curso_agua',
    'coordenadas',
    'uso',
    'classificacao',
    'nome_empreendedor'
  ]);
  for (const key of Object.keys(draft.dados_pre_preenchidos)) {
    assert.equal(allowedKeys.has(key), true);
  }
  assert.equal(draft.dados_pre_preenchidos.nome_barragem, 'Barragem Santa Luzia');
  assert.equal(draft.dados_pre_preenchidos.municipio, 'Sorriso');
  assert.equal(draft.dados_pre_preenchidos.curso_agua, 'Ribeirão Celeste');
  assert.equal(draft.dados_pre_preenchidos.coordenadas, '-12.5425, -55.7211');
  assert.equal(draft.dados_pre_preenchidos.uso, 'Irrigação');
  assert.equal(draft.dados_pre_preenchidos.classificacao, 'DPA: Alto · CRI: Baixo');
  assert.equal(draft.dados_pre_preenchidos.nome_empreendedor, 'Agroindustrial Cerrado Ltda');

  const serialized = JSON.stringify(draft);
  assert.equal(serialized.includes('12.345.678/0001-90'), false);
  assert.equal(serialized.includes('12345678901'), false);

  // Barragem com campos ausentes ou documento em campo textual não lança erro e remove CPF/CNPJ
  const partialDam = {
    id: 'bar_partial',
    nome: 'Barragem Sem Dados',
    empreendedor: '12345678901'
  };
  const partialDraft = buildBarragemSolicitacaoDraft(partialDam, empreendedores);
  assert.equal(partialDraft.barragem_id, 'bar_partial');
  assert.equal(partialDraft.empreendedor_id, '');
  assert.equal(partialDraft.dados_pre_preenchidos.nome_barragem, 'Barragem Sem Dados');
  assert.equal(partialDraft.dados_pre_preenchidos.coordenadas, undefined);
  assert.equal(partialDraft.dados_pre_preenchidos.nome_empreendedor, undefined);
  assert.equal(JSON.stringify(partialDraft).includes('12345678901'), false);
});

test('Solicitações UI: renderiza estados de carregamento, erro, lista vazia, pré-preenchimento sem relato e ErrorBoundary', () => {
  const baseProps = {
    userRole: 'Analista' as const,
    empreendedores: [
      {
        id: 'emp_1',
        nome: 'Empreendedor Teste',
        cpfCnpj: '99.888.777/0001-66',
        createdAt: '2026-11-20T00:00:00Z',
        updatedAt: '2026-11-20T00:00:00Z'
      }
    ],
    barragens: [
      {
        id: 'bar_1',
        nome: 'Barragem Chapada',
        municipio: 'Chapada dos Guimarães',
        cursoAgua: 'Rio Coxipó',
        latitude: '-15.4606',
        longitude: '-55.7497',
        empreendedor: 'emp_1',
        createdAt: '2026-11-20T00:00:00Z',
        updatedAt: '2026-11-20T00:00:00Z'
      }
    ],
    onNotify: () => {}
  };

  // 1. Estado de carregamento visível
  const loadingHtml = renderToStaticMarkup(
    React.createElement(SolicitacoesVistoriaView, {
      ...baseProps,
      initialLoading: true
    })
  );
  assert.equal(loadingHtml.includes('Carregando solicitações de vistoria...'), true);

  // 2. Estado de erro visível com botão de tentar novamente e sem segredos
  const errorHtml = renderToStaticMarkup(
    React.createElement(SolicitacoesVistoriaView, {
      ...baseProps,
      initialLoading: false,
      initialError: 'Serviço central temporariamente indisponível.'
    })
  );
  assert.equal(errorHtml.includes('Não foi possível carregar as solicitações:'), true);
  assert.equal(errorHtml.includes('Serviço central temporariamente indisponível.'), true);
  assert.equal(errorHtml.includes('Tentar novamente'), true);

  // 3. Estado de lista vazia visível
  const emptyHtml = renderToStaticMarkup(
    React.createElement(SolicitacoesVistoriaView, {
      ...baseProps,
      initialLoading: false,
      initialSolicitacoes: []
    })
  );
  assert.equal(emptyHtml.includes('Nenhuma solicitação de vistoria encontrada'), true);

  // 4. Formulário pré-preenchido com barragem selecionada, relato vazio e sem CPF/CNPJ
  const draft = buildBarragemSolicitacaoDraft(baseProps.barragens[0], baseProps.empreendedores);
  const prefilledHtml = renderToStaticMarkup(
    React.createElement(SolicitacoesVistoriaView, {
      ...baseProps,
      initialLoading: false,
      initialSolicitacoes: [],
      initialCreateDraft: draft
    })
  );
  assert.equal(prefilledHtml.includes('Nova solicitação de vistoria'), true);
  assert.equal(prefilledHtml.includes('Barragem Chapada'), true);
  assert.equal(prefilledHtml.includes('Chapada dos Guimarães'), true);
  assert.equal(prefilledHtml.includes('Rio Coxipó'), true);
  assert.equal(prefilledHtml.includes('Empreendedor Teste'), true);
  assert.equal(prefilledHtml.includes('99.888.777/0001-66'), false);
  assert.equal(prefilledHtml.includes('Relato / Justificativa da vistoria * (0/1000)'), true);
  assert.equal(prefilledHtml.includes('Cancelar'), true);

  // 5. ErrorBoundary impede tela em branco, registra diagnóstico no console sem exibir stack/segredos na UI
  const originalConsoleError = console.error;
  const capturedLogs: any[][] = [];
  console.error = (...args: any[]) => {
    capturedLogs.push(args);
  };
  try {
    const boundaryElement = React.createElement(
      SolicitacoesVistoriaErrorBoundary,
      null,
      React.createElement('div', null, 'Conteúdo seguro')
    );
    const safeHtml = renderToStaticMarkup(boundaryElement);
    assert.equal(safeHtml.includes('Conteúdo seguro'), true);

    const instance = new SolicitacoesVistoriaErrorBoundary({
      children: React.createElement('div', null, 'Teste')
    });
    instance.state = SolicitacoesVistoriaErrorBoundary.getDerivedStateFromError();
    instance.componentDidCatch(
      new Error('Falha simulada com Bearer tok_secreto_123 e CPF 123.456.789-01'),
      { componentStack: '\n    at SolicitacoesVistoriaContent\n    at App' }
    );
    assert.equal(capturedLogs.length, 1);
    assert.equal(capturedLogs[0][0], '[SolicitacoesVistoriaErrorBoundary]');
    assert.equal(String(capturedLogs[0][1].message).includes('Bearer [oculto]'), true);
    assert.equal(String(capturedLogs[0][1].message).includes('tok_secreto_123'), false);
    assert.equal(String(capturedLogs[0][1].message).includes('123.456.789-01'), false);
    assert.equal(
      String(capturedLogs[0][1].componentStack).includes('SolicitacoesVistoriaContent'),
      true
    );

    const fallbackHtml = renderToStaticMarkup(instance.render() as React.ReactElement);
    assert.equal(
      fallbackHtml.includes('Não foi possível exibir o módulo de Solicitações de Vistoria.'),
      true
    );
    assert.equal(fallbackHtml.includes('Tentar novamente'), true);
    assert.equal(fallbackHtml.includes('SolicitacoesVistoriaContent'), false);
    assert.equal(fallbackHtml.includes('tok_secreto_123'), false);
  } finally {
    console.error = originalConsoleError;
  }
});

test('Solicitações UI: renderiza dados válidos e campos nulos/aninhados sem disparar exceção de renderização', () => {
  const validAndMalformedItems: any[] = [
    {
      id: 'sol-1',
      sistema_origem: 'classifica',
      origem_ref_id: 'CLS-2026-01',
      solicitante_id: 'usr-1',
      solicitante_nome: 'Analista Ana',
      solicitante_perfil: 'Analista',
      relato: 'Vistoria técnica programada em barragem válida.',
      empreendedor_id: 'emp_1',
      barragem_id: 'bar_1',
      processo_referencia: 'PROC-2026/0001',
      dados_pre_preenchidos: {
        nome_barragem: 'Barragem Chapada',
        municipio: 'Chapada dos Guimarães',
        nome_empreendedor: 'Empreendedor Teste'
      },
      status: 'realizada',
      vistoria_id: 'VST-001',
      data_realizacao: '2026-11-20T14:30:00Z',
      equipe: [{ id: 'eq-1', nome: 'Fiscal Camila' }],
      observacao_campo: 'Sem anomalias estruturais aparentes.',
      observacao_atualizada_em: '2026-11-20T16:00:00Z',
      created_at: '2026-11-19T10:00:00Z'
    },
    null,
    {
      id: null,
      sistema_origem: null,
      solicitante_id: null,
      solicitante_nome: { nome_objeto: 'invalido' },
      relato: null,
      dados_pre_preenchidos: {
        nome_barragem: { raw: 'objeto inesperado' },
        nome_empreendedor: ['array inesperado']
      },
      status: 'status_desconhecido',
      equipe: ['Integrante Texto', null, { id: 'eq-2', nome: { raw: true } }],
      observacao_campo: { texto: 'objeto' },
      created_at: 'data-invalida'
    }
  ];

  const html = renderToStaticMarkup(
    React.createElement(SolicitacoesVistoriaView, {
      userRole: 'Administrador',
      empreendedores: [null as any, { id: 'emp_1', nome: { invalid: true } as any } as any],
      barragens: [null as any, { id: 'bar_1', nome: 'Barragem Chapada' } as any],
      onNotify: () => {},
      initialLoading: false,
      initialError: { code: 'ERR', message: 'Erro estruturado tratado' } as any,
      initialSolicitacoes: validAndMalformedItems
    })
  );
  // Se initialError está presente, exibe aviso normal do módulo e nunca cai no ErrorBoundary
  assert.equal(html.includes('Não foi possível carregar as solicitações:'), true);
  assert.equal(html.includes('Erro estruturado tratado'), true);
  assert.equal(
    html.includes('Ocorreu uma falha inesperada na renderização desta tela.'),
    false
  );

  // Sem initialError, renderiza tabela com itens válidos e campos nulos/malformados sem lançar exceção
  const tableHtml = renderToStaticMarkup(
    React.createElement(SolicitacoesVistoriaView, {
      userRole: 'Administrador',
      empreendedores: [null as any, { id: 'emp_1', nome: 'Empreendedor Teste' } as any],
      barragens: [null as any, { id: 'bar_1', nome: 'Barragem Chapada' } as any],
      onNotify: () => {},
      initialLoading: false,
      initialSolicitacoes: validAndMalformedItems
    })
  );
  assert.equal(tableHtml.includes('Vistoria técnica programada em barragem válida.'), true);
  assert.equal(tableHtml.includes('Fiscal Camila'), true);
  assert.equal(tableHtml.includes('Integrante Texto'), true);
  assert.equal(
    tableHtml.includes('Ocorreu uma falha inesperada na renderização desta tela.'),
    false
  );
});

test('Solicitações Service + UI (regressão): erro HTTP com payload { error: { code, message } } não gera "Objects are not valid as a React child" nem dispara ErrorBoundary', async () => {
  const extracted = extractSafeErrorMessage(
    { code: 'FUNCTION_INVOCATION_FAILED', message: 'Falha Vercel Bearer jwt_secreto_abc' },
    'Fallback'
  );
  assert.equal(typeof extracted, 'string');
  assert.equal(extracted, 'Falha Vercel Bearer [oculto]');

  const originalFetch = globalThis.fetch;
  try {
    // 1. Reproduz resposta HTTP 500 onde data.error é um objeto (causa original de exceção no React)
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'FUNCTION_INVOCATION_FAILED',
            message: 'A server error has occurred'
          }
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )) as typeof fetch;

    const listErrRes = await listarSolicitacoesVistoria();
    assert.equal(listErrRes.success, false);
    assert.equal(typeof listErrRes.error, 'string');
    assert.equal(listErrRes.error, 'A server error has occurred');
    assert.deepEqual(listErrRes.solicitacoes, []);
    assert.deepEqual(listErrRes.counts, {
      total: 0,
      solicitada: 0,
      em_planejamento: 0,
      realizada: 0,
      cancelada: 0
    });

    const renderedErrHtml = renderToStaticMarkup(
      React.createElement(SolicitacoesVistoriaView, {
        userRole: 'Analista',
        empreendedores: [],
        barragens: [],
        onNotify: () => {},
        initialLoading: false,
        initialError: listErrRes.error
      })
    );
    assert.equal(renderedErrHtml.includes('A server error has occurred'), true);
    assert.equal(
      renderedErrHtml.includes('Ocorreu uma falha inesperada na renderização desta tela.'),
      false
    );

    // 2. Resposta HTTP 200 com campos nulos e estruturas aninhadas inesperadas normaliza com segurança
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          solicitacoes: [
            {
              id: '00000000-0000-4000-8000-000000000111',
              sistema_origem: null,
              solicitante_id: 'usr-1',
              solicitante_nome: { nested: 'obj' },
              relato: 'Solicitação normalizada',
              dados_pre_preenchidos: {
                nome_barragem: { unexpected: true },
                municipio: 'Cuiabá'
              },
              status: null,
              equipe: ['Equipe Texto', null, { id: 'm1', nome: 'Inspetor João' }],
              created_at: null
            }
          ],
          counts: null,
          usuariosNomes: { 'usr-1': 'Ana Silva', 'usr-2': { nome: { broken: true } } }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )) as typeof fetch;

    const normalizedRes = await listarSolicitacoesVistoria();
    assert.equal(normalizedRes.success, true);
    assert.equal(normalizedRes.solicitacoes.length, 1);
    assert.equal(normalizedRes.solicitacoes[0].dados_pre_preenchidos?.nome_barragem, undefined);
    assert.equal(normalizedRes.solicitacoes[0].dados_pre_preenchidos?.municipio, 'Cuiabá');
    assert.equal(normalizedRes.solicitacoes[0].equipe?.length, 2);
    assert.equal(normalizedRes.usuariosNomes['usr-1'].nome, 'Ana Silva');
    assert.equal(normalizedRes.usuariosNomes['usr-2'].nome, 'usr-2');

    const normalizedHtml = renderToStaticMarkup(
      React.createElement(SolicitacoesVistoriaView, {
        userRole: 'Analista',
        empreendedores: [],
        barragens: [],
        onNotify: () => {},
        initialLoading: false,
        initialSolicitacoes: normalizedRes.solicitacoes
      })
    );
    assert.equal(normalizedHtml.includes('Solicitação normalizada'), true);
    assert.equal(
      normalizedHtml.includes('Ocorreu uma falha inesperada na renderização desta tela.'),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Solicitações Service: usa rota Vercel /api/solicitacoesVistoria e trata resposta não-JSON ou HTML sem mascarar falha', async () => {
  assert.equal(SOLICITACOES_API_BASE, '/api/solicitacoesVistoria');

  const originalFetch = globalThis.fetch;
  let capturedUrl = '';

  try {
    // 1. HTML recebido com HTTP 200 (fallback SPA) -> falha explícita
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response('<!doctype html><html><body>Fallback</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }) as typeof fetch;

    const htmlRes = await listarSolicitacoesVistoria({ status: 'solicitada' });
    assert.equal(capturedUrl, '/api/solicitacoesVistoria?status=solicitada');
    assert.equal(htmlRes.success, false);
    assert.equal(htmlRes.error, 'Resposta inesperada do servidor ao carregar solicitações de vistoria.');
    assert.deepEqual(htmlRes.solicitacoes, []);

    // 2. HTTP 200 com JSON inválido -> falha explícita
    globalThis.fetch = (async () =>
      new Response('{corrupted-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })) as typeof fetch;

    const badJsonRes = await listarSolicitacoesVistoria();
    assert.equal(badJsonRes.success, false);
    assert.equal(
      badJsonRes.error,
      'Resposta inesperada do servidor ao carregar solicitações de vistoria.'
    );

    // 3. HTTP 500 com corpo HTML -> preserva status HTTP na mensagem
    globalThis.fetch = (async () =>
      new Response('<html><body>500 Internal Server Error</body></html>', {
        status: 500,
        headers: { 'Content-Type': 'text/html' }
      })) as typeof fetch;

    const errHtmlRes = await listarSolicitacoesVistoria();
    assert.equal(errHtmlRes.success, false);
    assert.equal(errHtmlRes.error, 'Falha ao carregar solicitações de vistoria (HTTP 500).');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

