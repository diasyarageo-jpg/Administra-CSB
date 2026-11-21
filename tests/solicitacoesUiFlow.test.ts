// tests/solicitacoesUiFlow.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  SOLICITACOES_API_BASE,
  buildBarragemSolicitacaoDraft,
  canCreateSolicitacaoVistoriaRole,
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

  // 5. ErrorBoundary impede tela em branco
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
  const fallbackHtml = renderToStaticMarkup(instance.render() as React.ReactElement);
  assert.equal(
    fallbackHtml.includes('Não foi possível exibir o módulo de Solicitações de Vistoria.'),
    true
  );
  assert.equal(fallbackHtml.includes('Tentar novamente'), true);
});

test('Solicitações Service: usa rota Vercel /api/solicitacoesVistoria e trata resposta não-JSON sem quebrar', async () => {
  assert.equal(SOLICITACOES_API_BASE, '/api/solicitacoesVistoria');

  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    capturedUrl = String(input);
    return new Response('<!doctype html><html><body>Fallback</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }) as typeof fetch;

  try {
    const res = await listarSolicitacoesVistoria({ status: 'solicitada' });
    assert.equal(capturedUrl, '/api/solicitacoesVistoria?status=solicitada');
    assert.equal(res.success, false);
    assert.equal(Boolean(res.error && res.error.length > 0), true);
    assert.deepEqual(res.solicitacoes, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
