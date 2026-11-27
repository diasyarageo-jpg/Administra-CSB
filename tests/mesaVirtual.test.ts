// tests/mesaVirtual.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_INFRACAO_ACTION_CONFIG,
  EMPTY_MESA_VIRTUAL_FILTERS,
  MesaVirtualActor,
  MesaVirtualWorkflowStore,
  buildMesaVirtualDocumentos,
  canEditOrDeleteMesaVirtualDocumento,
  computeMesaVirtualSummary,
  decidirRevisaoAdministrativaSolicitacao,
  decidirSolicitacaoRevisaoDocumento,
  dispatchMesaVirtualSolicitacao,
  filterMesaVirtualDocuments,
  getMesaVirtualPermissions,
  isDocumentoDoUsuarioAtual,
  redistribuirSolicitacaoGeral,
  registrarSolicitacaoRevisaoDocumento,
  solicitarRevisaoAdministrativaSolicitacao
} from '../src/services/mesaVirtualService';
import { DocumentoCatalogoItem } from '../src/types/documentos';
import { maskCpfCnpjSafe } from '../src/utils/vinculoStatus';

const SAMPLE_BARRAGENS = [
  {
    id: 'bar_1',
    nome: 'Barragem Rio Claro',
    empreendedor: 'emp_1',
    empreendimento: 'Fazenda Rio Claro',
    municipio: 'Cuiabá',
    car: 'MT-5103403-1111222233334444',
    processo: 'PROC-2026/0010'
  },
  {
    id: 'bar_2',
    nome: 'Barragem Serra Azul',
    empreendedor: 'emp_2',
    empreendimento: 'Estância Serra Azul',
    municipio: 'Sinop',
    car: 'MT-5107909-9999888877776666',
    processo: 'PROC-2026/0099'
  }
];

const SAMPLE_EMPREENDEDORES = [
  {
    id: 'emp_1',
    nome: 'Agropecuária Rio Claro Ltda',
    cpfCnpj: '12345678000190'
  },
  {
    id: 'emp_2',
    nome: 'João da Silva Agro',
    cpfCnpj: '12345678901'
  }
];

const SAMPLE_CATALOGO: DocumentoCatalogoItem[] = [
  {
    id: 'doc_1',
    origemSistema: 'Classifica',
    origemDocumentoId: 'cls_10',
    tipoCodigo: 'PARECER_CLASSIFICACAO',
    tipoNome: 'Parecer de Classificação',
    titulo: 'Parecer DPA/CRI Rio Claro',
    numero: 'PC-010/2026',
    dataEmissao: '2026-03-15',
    prazo: '2026-06-15',
    analistasElaboradores: ['Ana Analista'],
    autorId: 'usr_ana',
    barragemId: 'bar_1',
    barragemNome: 'Barragem Rio Claro',
    empreendedorId: 'emp_1',
    empreendedorNome: 'Agropecuária Rio Claro Ltda',
    empreendedorCpfCnpj: '12345678000190',
    empreendimentoId: 'imp_1',
    empreendimentoNome: 'Fazenda Rio Claro',
    municipio: 'Cuiabá',
    processo: 'PROC-2026/0010',
    carMt: 'MT-5103403-1111222233334444',
    vinculoStatus: 'oficial',
    referenciaSeguraOrigem: 'https://classifica.local/doc/10',
    suportaDownload: true,
    situacao: 'Emitido',
    sincronizacaoEstado: 'Sincronizado',
    criadoEm: '2026-03-15T10:00:00Z',
    sincronizadoEm: '2026-03-15T10:05:00Z'
  },
  {
    id: 'doc_2',
    origemSistema: 'Notifica',
    origemDocumentoId: 'ntf_20',
    tipoCodigo: 'NOTIFICACAO',
    tipoNome: 'Notificação',
    titulo: 'Notificação de Regularização',
    numero: 'NOT-020/2026',
    dataEmissao: '2026-04-02',
    prazo: '2026-05-02',
    analistasElaboradores: ['Bruno Analista'],
    autorId: 'usr_bruno',
    barragemId: undefined,
    barragemNome: 'Barragem Rio Claro',
    empreendedorId: undefined,
    empreendedorCpfCnpj: '12345678901',
    municipio: 'Sinop',
    processo: 'PROC-2026/0099',
    carMt: 'MT-5107909-9999888877776666',
    vinculoStatus: 'pendente_revisao',
    referenciaSeguraOrigem: undefined,
    suportaDownload: false,
    situacao: 'Em análise',
    sincronizacaoEstado: 'Pendente',
    criadoEm: '2026-04-02T12:00:00Z',
    sincronizadoEm: '2026-04-02T12:00:00Z'
  },
  {
    id: 'doc_3',
    origemSistema: 'Fiscaliza',
    origemDocumentoId: 'fisc_30',
    tipoCodigo: 'RELATORIO_VISTORIA',
    tipoNome: 'Relatório de Vistoria',
    titulo: 'Vistoria in loco Serra Azul',
    numero: 'RV-030/2026',
    dataEmissao: '2026-05-10',
    prazo: '2026-07-01',
    analistasElaboradores: ['Ana Analista'],
    autorId: 'usr_ana',
    barragemId: 'bar_2',
    barragemNome: 'Barragem Serra Azul',
    empreendedorId: 'emp_2',
    empreendedorNome: 'João da Silva Agro',
    empreendimentoId: 'imp_2',
    empreendimentoNome: 'Estância Serra Azul',
    municipio: 'Sinop',
    processo: 'PROC-2026/0099',
    vinculoStatus: 'oficial',
    referenciaSeguraOrigem: 'https://fiscaliza.local/doc/30',
    suportaDownload: true,
    situacao: 'Vigente',
    sincronizacaoEstado: 'Sincronizado',
    criadoEm: '2026-05-10T09:00:00Z',
    sincronizadoEm: '2026-05-10T09:00:00Z'
  }
];

const ACTOR_ANA: MesaVirtualActor = {
  id: 'usr_ana',
  nome: 'Ana Analista',
  login: 'ana.analista',
  email: 'ana@sema.mt.gov.br',
  papel: 'Analista'
};

const ACTOR_ADMIN: MesaVirtualActor = {
  id: 'usr_admin',
  nome: 'Carlos Administrador',
  login: 'carlos.admin',
  email: 'carlos@sema.mt.gov.br',
  papel: 'Administrador'
};

const ACTOR_VIEWER: MesaVirtualActor = {
  id: 'usr_view',
  nome: 'Paulo Visualizador',
  papel: 'Visualizador'
};

test('RBAC da Mesa Virtual distingue Administrador, Analista e Visualizador corretamente', () => {
  const adminPerms = getMesaVirtualPermissions('Administrador');
  assert.equal(adminPerms.canViewTodosDocumentosCsb, true);
  assert.equal(adminPerms.canCreateSolicitacao, true);
  assert.equal(adminPerms.canTargetSpecificUser, true);
  assert.equal(adminPerms.canRedistributeGeral, true);
  assert.equal(adminPerms.canDecideRevisaoAdministrativa, true);

  const analistaPerms = getMesaVirtualPermissions('Analista');
  assert.equal(analistaPerms.canViewTodosDocumentosCsb, true);
  assert.equal(analistaPerms.canCreateSolicitacao, true);
  assert.equal(analistaPerms.canTargetSpecificUser, false);
  assert.equal(analistaPerms.canRedistributeGeral, false);
  assert.equal(analistaPerms.canRequestRevisaoSolicitacao, true);
  assert.equal(analistaPerms.canDecideRevisaoAdministrativa, false);

  const viewerPerms = getMesaVirtualPermissions('Visualizador');
  assert.equal(viewerPerms.isReadOnly, true);
  assert.equal(viewerPerms.canCreateSolicitacao, false);
  assert.equal(viewerPerms.canDecideRevisaoAdministrativa, false);
});

test('buildMesaVirtualDocumentos mascara CPF/CNPJ, preserva leitura e não promove vínculo textual/CAR a oficial', () => {
  const docs = buildMesaVirtualDocumentos({
    catalogoDocs: SAMPLE_CATALOGO,
    barragens: SAMPLE_BARRAGENS,
    empreendedores: SAMPLE_EMPREENDEDORES,
    portarias: [
      {
        id: 'port_1',
        orderNumber: '045/2026',
        processNumber: 'PROC-2026/0010',
        orderPublished: true,
        createdBy: 'Ana Analista',
        createdAt: '2026-05-12T10:00:00Z'
      }
    ]
  });

  assert.equal(docs.length, 4);

  for (const doc of docs) {
    assert.equal(doc.empreendedorCpfCnpj, undefined);
    assert.equal(doc.somenteLeitura, true);
    if (doc.empreendedorDocumentoMascarado && doc.empreendedorDocumentoMascarado !== '—') {
      assert.ok(doc.empreendedorDocumentoMascarado.includes('*'));
      assert.ok(!doc.empreendedorDocumentoMascarado.includes('12345678000190'));
      assert.ok(!doc.empreendedorDocumentoMascarado.includes('12345678901'));
    }
  }

  assert.equal(maskCpfCnpjSafe('12345678901'), '***.456.789-**');
  assert.equal(maskCpfCnpjSafe('12345678000190'), '**.345.678/0001-**');

  // doc_2 só tinha nome/CAR sem barragemId/empreendedorId -> nunca vira 'oficial'
  const doc2 = docs.find(d => d.id === 'doc_2')!;
  assert.equal(doc2.vinculoEvaluatedCode, 'pendente_revisao');

  // Usuário pode ver documento de outro autor, mas nunca editar/excluir diretamente
  const editOther = canEditOrDeleteMesaVirtualDocumento(doc2, ACTOR_ANA);
  assert.equal(editOther.allowed, false);

  const doc1 = docs.find(d => d.id === 'doc_1')!;
  const editOwnCompleted = canEditOrDeleteMesaVirtualDocumento(doc1, ACTOR_ANA);
  assert.equal(editOwnCompleted.allowed, false);
});

test('Abas Meus documentos vs Todos documentos CSB, todos os 12 filtros e sincronização dos cards de resumo', () => {
  const docs = buildMesaVirtualDocumentos({
    catalogoDocs: SAMPLE_CATALOGO,
    barragens: SAMPLE_BARRAGENS,
    empreendedores: SAMPLE_EMPREENDEDORES
  });

  // Aba Meus documentos traz apenas documentos de Ana
  const meus = filterMesaVirtualDocuments(docs, EMPTY_MESA_VIRTUAL_FILTERS, {
    tab: 'meus_documentos',
    actor: ACTOR_ANA
  });
  assert.equal(meus.length, 2);
  assert.ok(meus.every(d => isDocumentoDoUsuarioAtual(d, ACTOR_ANA)));

  // Aba Todos documentos CSB traz todos (inclusive de Bruno)
  const todos = filterMesaVirtualDocuments(docs, EMPTY_MESA_VIRTUAL_FILTERS, {
    tab: 'todos_documentos',
    actor: ACTOR_ANA
  });
  assert.equal(todos.length, 3);

  // Testa filtros individuais e combinados (sistema, tipo, estado, autor, período, processo, município, barragem, empreendedor, empreendimento, prazo, sincronização)
  assert.equal(
    filterMesaVirtualDocuments(docs, { ...EMPTY_MESA_VIRTUAL_FILTERS, sistema: 'Notifica' }).length,
    1
  );
  assert.equal(
    filterMesaVirtualDocuments(docs, { ...EMPTY_MESA_VIRTUAL_FILTERS, tipo: 'PARECER_CLASSIFICACAO' }).length,
    1
  );
  assert.equal(
    filterMesaVirtualDocuments(docs, { ...EMPTY_MESA_VIRTUAL_FILTERS, estado: 'Em análise' }).length,
    1
  );
  assert.equal(
    filterMesaVirtualDocuments(docs, { ...EMPTY_MESA_VIRTUAL_FILTERS, autor: 'Bruno' }).length,
    1
  );
  assert.equal(
    filterMesaVirtualDocuments(docs, {
      ...EMPTY_MESA_VIRTUAL_FILTERS,
      periodoInicio: '2026-04-01',
      periodoFim: '2026-05-01'
    }).length,
    1
  );
  assert.equal(
    filterMesaVirtualDocuments(docs, { ...EMPTY_MESA_VIRTUAL_FILTERS, processo: '0099' }).length,
    2
  );
  assert.equal(
    filterMesaVirtualDocuments(docs, { ...EMPTY_MESA_VIRTUAL_FILTERS, municipio: 'Cuiaba' }).length,
    1
  );
  assert.equal(
    filterMesaVirtualDocuments(docs, { ...EMPTY_MESA_VIRTUAL_FILTERS, barragemId: 'bar_2' }).length,
    1
  );
  assert.equal(
    filterMesaVirtualDocuments(docs, { ...EMPTY_MESA_VIRTUAL_FILTERS, empreendedorId: 'emp_1' }).length,
    1
  );
  assert.equal(
    filterMesaVirtualDocuments(docs, { ...EMPTY_MESA_VIRTUAL_FILTERS, empreendimentoId: 'imp_2' }).length,
    1
  );
  assert.equal(
    filterMesaVirtualDocuments(docs, {
      ...EMPTY_MESA_VIRTUAL_FILTERS,
      prazoInicio: '2026-06-01',
      prazoFim: '2026-07-15'
    }).length,
    2
  );
  assert.equal(
    filterMesaVirtualDocuments(docs, {
      ...EMPTY_MESA_VIRTUAL_FILTERS,
      sincronizacaoEstado: 'Pendente'
    }).length,
    1
  );

  const filteredSummary = computeMesaVirtualSummary(meus);
  assert.equal(filteredSummary.total, 2);
  assert.equal(filteredSummary.porSistema.Classifica, 1);
  assert.equal(filteredSummary.porSistema.Fiscaliza, 1);
  assert.equal(filteredSummary.porSistema.Notifica || 0, 0);
  assert.equal(filteredSummary.porVinculo.oficial, 2);
});

test('Auto de infração permanece desabilitado e rejeitado sem simulação', async () => {
  assert.equal(AUTO_INFRACAO_ACTION_CONFIG.disabled, true);
  assert.equal(AUTO_INFRACAO_ACTION_CONFIG.badge, 'Em planejamento');

  const emptyStore: MesaVirtualWorkflowStore = { solicitacoes: [], revisoesDocumentos: [] };
  const res = await dispatchMesaVirtualSolicitacao(emptyStore, {
    clientRequestKey: 'req_auto_1',
    acaoSolicitada: 'solicitar_auto_infracao',
    destinatarioTipo: 'GERAL',
    entidades: [
      {
        barragemId: 'bar_1',
        barragemNome: 'Barragem Rio Claro',
        vinculoStatus: 'oficial'
      }
    ],
    justificativaGeral: 'Tentativa de autuação',
    actor: ACTOR_ADMIN
  });

  assert.equal(res.ok, false);
  assert.equal(res.nextStore.solicitacoes.length, 0);
});

test('Solicitação multi-entidade com vistoria real, idempotência, falha controlada, Notifica honesto e governança Admin/Analista', async () => {
  let store: MesaVirtualWorkflowStore = { solicitacoes: [], revisoesDocumentos: [] };

  // Analista não pode enviar direto para usuário específico
  const deniedUserTarget = await dispatchMesaVirtualSolicitacao(store, {
    clientRequestKey: 'req_denied_target',
    acaoSolicitada: 'solicitar_vistoria',
    destinatarioTipo: 'USUARIO',
    destinatarioUsuarioId: 'usr_admin',
    entidades: [{ barragemId: 'bar_1', barragemNome: 'Barragem Rio Claro', vinculoStatus: 'oficial' }],
    justificativaGeral: 'Encaminhamento direto por analista',
    actor: ACTOR_ANA
  });
  assert.equal(deniedUserTarget.ok, false);

  // Visualizador não pode criar solicitação
  const deniedViewer = await dispatchMesaVirtualSolicitacao(store, {
    clientRequestKey: 'req_viewer',
    acaoSolicitada: 'solicitar_vistoria',
    destinatarioTipo: 'GERAL',
    entidades: [{ barragemId: 'bar_1', barragemNome: 'Barragem Rio Claro', vinculoStatus: 'oficial' }],
    justificativaGeral: 'Visualizador tentando enviar',
    actor: ACTOR_VIEWER
  });
  assert.equal(deniedViewer.ok, false);

  // Envio real multi-entidade para GERAL com stub da função de vistoria
  let callsCount = 0;
  const okVistoriaDispatch = async (payload: any) => {
    callsCount += 1;
    return {
      success: true,
      solicitacao: {
        id: `vis_${callsCount}`,
        sistema_origem: 'administra',
        solicitante_id: ACTOR_ANA.id,
        status: 'solicitada' as const,
        relato: payload.relato,
        created_at: new Date().toISOString()
      }
    };
  };

  const sent = await dispatchMesaVirtualSolicitacao(store, {
    clientRequestKey: 'idem_key_001',
    acaoSolicitada: 'solicitar_vistoria',
    destinatarioTipo: 'GERAL',
    entidades: [
      { barragemId: 'bar_1', barragemNome: 'Barragem Rio Claro', vinculoStatus: 'oficial' },
      { barragemId: 'bar_2', barragemNome: 'Barragem Serra Azul', vinculoStatus: 'pendente_revisao' }
    ],
    justificativaGeral: 'Necessidade de vistoria conjunta nas estruturas do vale.',
    justificativasPorDestino: {
      bar_2: 'Conferir vertedouro e vínculo pendente.'
    },
    actor: ACTOR_ANA,
    dispatchVistoriaFn: okVistoriaDispatch
  });

  assert.equal(sent.ok, true);
  assert.equal(callsCount, 2);
  assert.equal(sent.item?.caixaAtual, 'GERAL');
  assert.equal(sent.item?.statusSincronizacao, 'Sincronizado');
  assert.equal(sent.item?.vistoriaRetornos.length, 2);
  store = sent.nextStore;

  // Idempotência: mesma clientRequestKey não reenvia nem duplica
  const dup = await dispatchMesaVirtualSolicitacao(store, {
    clientRequestKey: 'idem_key_001',
    acaoSolicitada: 'solicitar_vistoria',
    destinatarioTipo: 'GERAL',
    entidades: [{ barragemId: 'bar_1', barragemNome: 'Barragem Rio Claro', vinculoStatus: 'oficial' }],
    justificativaGeral: 'Repetição acidental',
    actor: ACTOR_ANA,
    dispatchVistoriaFn: okVistoriaDispatch
  });
  assert.equal(dup.ok, true);
  assert.equal(dup.duplicated, true);
  assert.equal(callsCount, 2);

  // Falha no endpoint real -> registra como Falha controlada (nunca como Sincronizado)
  const failedVistoria = await dispatchMesaVirtualSolicitacao(store, {
    clientRequestKey: 'idem_fail_002',
    acaoSolicitada: 'solicitar_vistoria',
    destinatarioTipo: 'GERAL',
    entidades: [{ barragemId: 'bar_1', barragemNome: 'Barragem Rio Claro', vinculoStatus: 'oficial' }],
    justificativaGeral: 'Vistoria com erro simulado de rede',
    actor: ACTOR_ANA,
    dispatchVistoriaFn: async () => ({ success: false, error: 'Erro 500 simulado' })
  });
  assert.equal(failedVistoria.ok, true);
  assert.equal(failedVistoria.item?.statusFluxo, 'Falha controlada');
  assert.equal(failedVistoria.item?.statusSincronizacao, 'Falha controlada');
  store = failedVistoria.nextStore;

  // Solicitar notificação -> honesto "Aguardando integração", nunca "Sincronizado"
  const notifRes = await dispatchMesaVirtualSolicitacao(store, {
    clientRequestKey: 'idem_notif_003',
    acaoSolicitada: 'solicitar_notificacao',
    destinatarioTipo: 'GERAL',
    entidades: [{ barragemId: 'bar_1', barragemNome: 'Barragem Rio Claro', vinculoStatus: 'oficial' }],
    justificativaGeral: 'Solicitação de notificação para atualização cadastral.',
    actor: ACTOR_ANA
  });
  assert.equal(notifRes.ok, true);
  assert.equal(notifRes.item?.statusFluxo, 'Aguardando integração');
  assert.equal(notifRes.item?.statusSincronizacao, 'Pendente de integração');
  store = notifRes.nextStore;

  const targetSolId = sent.item!.id;

  // Analista NÃO pode redistribuir GERAL
  const redDenied = redistribuirSolicitacaoGeral(store, {
    solicitacaoId: targetSolId,
    destinatarioUsuarioId: 'usr_ana',
    destinatarioUsuarioNome: 'Ana Analista',
    justificativa: 'Tentativa sem perfil Admin',
    actor: ACTOR_ANA
  });
  assert.equal(redDenied.ok, false);

  // Admin redistribui GERAL -> Pessoal com histórico
  const redOk = redistribuirSolicitacaoGeral(store, {
    solicitacaoId: targetSolId,
    destinatarioUsuarioId: 'usr_ana',
    destinatarioUsuarioNome: 'Ana Analista',
    justificativa: 'Direcionamento técnico para equipe da bacia.',
    actor: ACTOR_ADMIN
  });
  assert.equal(redOk.ok, true);
  assert.equal(redOk.item?.caixaAtual, 'Pessoal');
  assert.equal(redOk.item?.destinatarioUsuarioId, 'usr_ana');
  assert.equal(redOk.item?.historico.some(h => h.acao === 'redistribuida'), true);
  store = redOk.nextStore;

  // Analista pede revisão administrativa, NÃO pode decidir, e Admin decide com justificativa
  const revReq = solicitarRevisaoAdministrativaSolicitacao(store, {
    solicitacaoId: targetSolId,
    motivo: 'Necessita revisão do escopo antes de concluir.',
    actor: ACTOR_ANA
  });
  assert.equal(revReq.ok, true);
  assert.equal(revReq.item?.statusFluxo, 'Em revisão administrativa');
  store = revReq.nextStore;

  const revDecDenied = decidirRevisaoAdministrativaSolicitacao(store, {
    solicitacaoId: targetSolId,
    decisao: 'aceita',
    justificativa: 'Analista tentando aprovar',
    actor: ACTOR_ANA
  });
  assert.equal(revDecDenied.ok, false);

  const revDecNoReason = decidirRevisaoAdministrativaSolicitacao(store, {
    solicitacaoId: targetSolId,
    decisao: 'recusada',
    justificativa: 'nao',
    actor: ACTOR_ADMIN
  });
  assert.equal(revDecNoReason.ok, false);

  const revDecOk = decidirRevisaoAdministrativaSolicitacao(store, {
    solicitacaoId: targetSolId,
    decisao: 'aceita',
    justificativa: 'Revisão administrativa validada pela coordenação.',
    actor: ACTOR_ADMIN
  });
  assert.equal(revDecOk.ok, true);
  assert.equal(revDecOk.item?.statusFluxo, 'Aceita');
  assert.equal(revDecOk.item?.revisaoAdministrativa?.decididaPorId, ACTOR_ADMIN.id);
});

test('Fluxo auditável de revisão/retificação de documentos permite solicitação e exige Admin para decidir', () => {
  const docs = buildMesaVirtualDocumentos({
    catalogoDocs: SAMPLE_CATALOGO,
    barragens: SAMPLE_BARRAGENS,
    empreendedores: SAMPLE_EMPREENDEDORES
  });

  let store: MesaVirtualWorkflowStore = { solicitacoes: [], revisoesDocumentos: [] };
  const docRev = registrarSolicitacaoRevisaoDocumento(store, {
    documento: docs[0],
    tipoSolicitacao: 'retificacao',
    justificativa: 'Retificação de coordenada do vertedouro registrada no parecer.',
    actor: ACTOR_ANA
  });
  assert.equal(docRev.ok, true);
  assert.equal(docRev.item?.status, 'Pendente de análise administrativa');
  store = docRev.nextStore;

  const decDenied = decidirSolicitacaoRevisaoDocumento(store, {
    revisaoId: docRev.item!.id,
    decisao: 'aceita',
    justificativa: 'Tentativa analista',
    actor: ACTOR_ANA
  });
  assert.equal(decDenied.ok, false);

  const decOk = decidirSolicitacaoRevisaoDocumento(store, {
    revisaoId: docRev.item!.id,
    decisao: 'recusada',
    justificativa: 'Coordenada anterior já foi validada em campo.',
    actor: ACTOR_ADMIN
  });
  assert.equal(decOk.ok, true);
  assert.equal(decOk.nextStore.revisoesDocumentos[0].status, 'Recusada');
});
