import assert from 'node:assert/strict';
import {
  abrirDocumentoOriginal,
  AdministraCommonData,
  baixarDocumentoOriginal,
  carregarCatalogoDocumentos,
  deduplicateCatalogoDocumentos,
  enrichDocumentosWithAdministraData,
  filterAndSortDocumentos
} from '../documentosService';
import {
  DocumentoAcessoResult,
  DocumentoCatalogoItem,
  DocumentoOrigem,
  DocumentoOriginAdapter
} from '../../types/documentos';

const mockCommonData: AdministraCommonData = {
  empreendedores: [
    {
      id: 'emp-1',
      nome: 'Agropecuária Rio Verde Ltda',
      cpfCnpj: '12.345.678/0001-90'
    },
    {
      id: 'emp-2',
      nome: 'Fazenda Santa Clara S/A',
      cpfCnpj: '98.765.432/0001-10'
    }
  ],
  barragens: [
    {
      id: 'bar-1',
      nome: 'Barragem Córrego Fundo',
      car: 'MT-5103403-ABC123',
      processo: '2026/00145-SEMA',
      empreendedor: 'emp-1'
    }
  ],
  rts: [
    {
      id: 'rt-1',
      nome: 'Eng. Marcos Oliveira'
    }
  ]
};

function createAdapter(
  origem: DocumentoOrigem,
  options: {
    configurado?: boolean;
    docs?: DocumentoCatalogoItem[];
    shouldFail?: boolean;
    failMessage?: string;
    openResult?: DocumentoAcessoResult;
  }
): DocumentoOriginAdapter {
  return {
    origem,
    configurado: options.configurado ?? true,
    descricaoConfiguracaoPendente: options.configurado === false ? 'Pendente' : undefined,
    async fetchMetadados() {
      if (options.shouldFail) {
        throw new Error(options.failMessage || `Timeout ao conectar em ${origem}`);
      }
      return options.docs || [];
    },
    async abrirOriginal(doc) {
      if (options.openResult) return options.openResult;
      return {
        sucesso: true,
        urlTemporaria: `https://interno.sema.mt.gov.br/signed/${doc.origemDocumentoId}?token=curta-duracao`
      };
    },
    async baixarOriginal(doc) {
      if (options.openResult) return options.openResult;
      return {
        sucesso: true,
        urlTemporaria: `https://interno.sema.mt.gov.br/download/${doc.origemDocumentoId}?token=curta-duracao`,
        nomeArquivo: `${doc.numero || doc.origemDocumentoId}.pdf`
      };
    }
  };
}

async function runTests() {
  // --------------------------------------------------------------------------
  // TESTE 1: Lista com documentos, deduplicação e enriquecimento com Administra
  // --------------------------------------------------------------------------
  const rawDocs: DocumentoCatalogoItem[] = [
    {
      id: 'cat-1',
      origemSistema: 'Classifica',
      origemDocumentoId: 'CLS-2026-01',
      tipoCodigo: 'PARECER_CLASSIFICACAO',
      tipoNome: 'Parecer de Classificação',
      titulo: 'Parecer Técnico de Classificação CRI/DPA',
      numero: '042/2026/CSB',
      dataEmissao: '2026-03-15',
      analistasElaboradores: ['Yara Dias'],
      responsavelTecnicoId: 'rt-1',
      carMt: 'MT-5103403-ABC123',
      referenciaSeguraOrigem: 'classifica://pareceres/CLS-2026-01',
      situacao: 'Emitido',
      criadoEm: '2026-03-15T10:00:00Z',
      sincronizadoEm: '2026-03-15T10:05:00Z'
    },
    // Duplicado mais recente do mesmo documento na origem Classifica
    {
      id: 'cat-1-dup',
      origemSistema: 'Classifica',
      origemDocumentoId: 'CLS-2026-01',
      tipoCodigo: 'PARECER_CLASSIFICACAO',
      tipoNome: 'Parecer de Classificação',
      titulo: 'Parecer Técnico de Classificação CRI/DPA (Revisado)',
      numero: '042/2026/CSB',
      dataEmissao: '2026-03-15',
      analistasElaboradores: ['Yara Dias'],
      responsavelTecnicoId: 'rt-1',
      carMt: 'MT-5103403-ABC123',
      referenciaSeguraOrigem: 'classifica://pareceres/CLS-2026-01',
      situacao: 'Vigente',
      criadoEm: '2026-03-15T10:00:00Z',
      sincronizadoEm: '2026-03-16T08:00:00Z'
    },
    {
      id: 'cat-2',
      origemSistema: 'Notifica',
      origemDocumentoId: 'NOT-2026-09',
      tipoCodigo: 'NOTIFICACAO',
      tipoNome: 'Notificação',
      titulo: 'Notificação para Apresentação de PSB',
      numero: '118/2026/NOT',
      dataEmissao: '2026-04-02',
      analistasElaboradores: ['Carlos Silva'],
      empreendedorCpfCnpj: '98765432000110',
      processo: '2026/00299-SEMA',
      referenciaSeguraOrigem: 'notifica://docs/NOT-2026-09',
      situacao: 'Emitido',
      criadoEm: '2026-04-02T14:00:00Z',
      sincronizadoEm: '2026-04-02T14:01:00Z'
    }
  ];

  const deduped = deduplicateCatalogoDocumentos(rawDocs);
  assert.equal(deduped.length, 2, 'Deve remover duplicidade por (origemSistema, origemDocumentoId)');
  assert.equal(deduped[0].situacao, 'Vigente', 'Deve manter a versão sincronizada mais recente');

  const enriched = enrichDocumentosWithAdministraData(deduped, mockCommonData);
  assert.equal(enriched[0].barragemNome, 'Barragem Córrego Fundo');
  assert.equal(enriched[0].empreendedorNome, 'Agropecuária Rio Verde Ltda');
  assert.equal(enriched[0].responsavelTecnicoNome, 'Eng. Marcos Oliveira');
  assert.equal(enriched[1].empreendedorNome, 'Fazenda Santa Clara S/A');

  // --------------------------------------------------------------------------
  // TESTE 2: Filtros e ordenação
  // --------------------------------------------------------------------------
  const bySearchCar = filterAndSortDocumentos(enriched, { busca: 'MT-5103403' });
  assert.equal(bySearchCar.length, 1);
  assert.equal(bySearchCar[0].origemSistema, 'Classifica');

  const byOrigem = filterAndSortDocumentos(enriched, { origem: 'Notifica' });
  assert.equal(byOrigem.length, 1);
  assert.equal(byOrigem[0].numero, '118/2026/NOT');

  const byAnalista = filterAndSortDocumentos(enriched, { analista: 'yara' });
  assert.equal(byAnalista.length, 1);

  const byPeriodo = filterAndSortDocumentos(enriched, {
    dataInicio: '2026-04-01',
    dataFim: '2026-04-30'
  });
  assert.equal(byPeriodo.length, 1);
  assert.equal(byPeriodo[0].origemSistema, 'Notifica');

  const sortedByTitleAsc = filterAndSortDocumentos(enriched, {
    ordenarPor: 'titulo',
    direcao: 'asc'
  });
  assert.equal(sortedByTitleAsc[0].origemSistema, 'Notifica'); // "Notificação..." antes de "Parecer..."

  // --------------------------------------------------------------------------
  // TESTE 3: Ausência de resultados
  // --------------------------------------------------------------------------
  const noMatches = filterAndSortDocumentos(enriched, { busca: 'INEXISTENTE-9999' });
  assert.equal(noMatches.length, 0, 'Deve retornar lista vazia quando não houver correspondência');

  // --------------------------------------------------------------------------
  // TESTE 4: Falha de uma origem sem impedir consulta às demais
  // --------------------------------------------------------------------------
  const partialSync = await carregarCatalogoDocumentos(mockCommonData, {
    Classifica: createAdapter('Classifica', { docs: [rawDocs[1]] }),
    Notifica: createAdapter('Notifica', { docs: [rawDocs[2]] }),
    Fiscaliza: createAdapter('Fiscaliza', {
      shouldFail: true,
      failMessage: 'Serviço Fiscaliza temporariamente indisponível (HTTP 503)'
    })
  });

  assert.equal(partialSync.documentos.length, 2, 'Deve manter documentos de Classifica e Notifica');
  const fiscalizaStatus = partialSync.origensStatus.find(s => s.origem === 'Fiscaliza');
  assert.equal(fiscalizaStatus?.conectado, false);
  assert.match(fiscalizaStatus?.erro || '', /HTTP 503/);

  // --------------------------------------------------------------------------
  // TESTE 5: Documento original indisponível
  // --------------------------------------------------------------------------
  const unavailableDoc: DocumentoCatalogoItem = {
    ...enriched[0],
    situacao: 'Indisponível na origem'
  };

  const openUnavailable = await abrirDocumentoOriginal(unavailableDoc);
  assert.equal(openUnavailable.sucesso, false);
  assert.equal(openUnavailable.indisponivelNaOrigem, true);
  assert.equal(openUnavailable.urlTemporaria, undefined);

  const downloadUnavailable = await baixarDocumentoOriginal(unavailableDoc);
  assert.equal(downloadUnavailable.sucesso, false);
  assert.equal(downloadUnavailable.indisponivelNaOrigem, true);

  console.log('Todos os 5 cenários de teste do módulo Documentos passaram com sucesso!');
}

runTests().catch(err => {
  console.error('Falha nos testes:', err);
  process.exit(1);
});
