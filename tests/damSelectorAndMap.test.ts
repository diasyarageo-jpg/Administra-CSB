// tests/damSelectorAndMap.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateBarragemVinculoStatus,
  evaluateDamCoordinates,
  evaluateDocumentoVinculoStatus,
  searchAndPrioritizeBarragens
} from '../src/utils/vinculoStatus';
import { verificarDocumentosRelacionadosEntidade } from '../src/services/documentosService';
import { DocumentoCatalogoItem } from '../src/types/documentos';
import fs from 'node:fs';
import path from 'node:path';

const EMPREENDEDORES = [
  { id: 'emp_1', nome: 'Produtora Verde Ltda', cpfCnpj: '11222333000144' },
  { id: 'emp_2', nome: 'Fazenda Horizonte S/A', cpfCnpj: '99888777000166' }
];

const BARRAGENS = [
  {
    id: 'bar_oficial_1',
    nome: 'Barragem Alfa',
    snisb: 'MT-001',
    car: 'MT-5103403-AAAA1111',
    municipio: 'Cuiabá',
    empreendedor: 'emp_1',
    latitude: -15.6,
    longitude: -56.1
  },
  {
    id: 'bar_sem_vinculo',
    nome: 'Barragem Beta Pendente',
    snisb: 'MT-002',
    car: 'MT-5103403-AAAA1111', // Mesmo CAR da Alfa, mas sem empreendedorId oficial
    municipio: 'Várzea Grande',
    latitude: '',
    longitude: ''
  },
  {
    id: 'bar_nao_vinculada',
    nome: 'Barragem Gama Isolada',
    snisb: 'MT-003',
    municipio: 'Rondonópolis',
    latitude: -16.47,
    longitude: -54.63
  },
  {
    id: 'bar_outro_emp',
    nome: 'Barragem Delta Outro',
    snisb: 'MT-004',
    car: 'MT-5107602-BBBB2222',
    municipio: 'Rondonópolis',
    empreendedor: 'emp_2',
    latitude: -16.5,
    longitude: -54.7
  }
];

test('Modelo explícito de 4 estados distingue oficial, pendente_revisao, nao_vinculado e Coordenadas indisponíveis', () => {
  const s1 = evaluateBarragemVinculoStatus(BARRAGENS[0], EMPREENDEDORES, 'emp_1');
  assert.equal(s1.code, 'oficial');
  assert.equal(s1.isLinkedToSelectedEmpreendedor, true);

  // Mesmo compartilhando CAR com bar_oficial_1, sem ID de empreendedor não vira 'oficial'
  const s2 = evaluateBarragemVinculoStatus(BARRAGENS[1], EMPREENDEDORES, 'emp_1');
  assert.equal(s2.code, 'pendente_revisao');

  const s3 = evaluateBarragemVinculoStatus(BARRAGENS[2], EMPREENDEDORES, 'emp_1');
  assert.equal(s3.code, 'nao_vinculado');

  const c1 = evaluateDamCoordinates(BARRAGENS[0]);
  assert.equal(c1.available, true);

  const c2 = evaluateDamCoordinates(BARRAGENS[1]);
  assert.equal(c2.available, false);
  assert.equal(c2.label, 'Coordenadas indisponíveis');

  // Documento com apenas nome/CAR sem ID não vira 'oficial'
  const docPendente = evaluateDocumentoVinculoStatus(
    {
      barragemNome: 'Barragem Alfa',
      carMt: 'MT-5103403-AAAA1111'
    },
    BARRAGENS,
    EMPREENDEDORES
  );
  assert.equal(docPendente.code, 'pendente_revisao');

  const docNaoVinc = evaluateDocumentoVinculoStatus({}, BARRAGENS, EMPREENDEDORES);
  assert.equal(docNaoVinc.code, 'nao_vinculado');
});

test('searchAndPrioritizeBarragens busca por nome, SNISB, CAR, município e ID, pagina e prioriza vínculo oficial mantendo pendentes selecionáveis', () => {
  const prioritized = searchAndPrioritizeBarragens(BARRAGENS, EMPREENDEDORES, {
    prioritizeEmpreendedorId: 'emp_1',
    page: 1,
    pageSize: 2
  });

  assert.equal(prioritized.allMatchedCount, 4);
  assert.equal(prioritized.totalPages, 2);
  assert.equal(prioritized.linkedToSelectedCount, 1);
  // Primeiro item deve ser a barragem oficialmente vinculada ao emp_1
  assert.equal(prioritized.items[0].id, 'bar_oficial_1');
  assert.equal(prioritized.items[0].priorityTier, 0);
  // Segundo item deve ser estrutura pendente/não vinculada (antes de outro empreendedor)
  assert.equal(prioritized.items[1].priorityTier, 1);

  // Busca por SNISB
  const bySnisb = searchAndPrioritizeBarragens(BARRAGENS, EMPREENDEDORES, {
    query: 'MT-003'
  });
  assert.equal(bySnisb.items.length, 1);
  assert.equal(bySnisb.items[0].id, 'bar_nao_vinculada');

  // Busca por CAR compartilhado retorna ambas, mantendo distinção de vínculo
  const byCar = searchAndPrioritizeBarragens(BARRAGENS, EMPREENDEDORES, {
    query: 'AAAA1111',
    prioritizeEmpreendedorId: 'emp_1'
  });
  assert.equal(byCar.items.length, 2);
  assert.equal(byCar.items[0].vinculo.code, 'oficial');
  assert.equal(byCar.items[1].vinculo.code, 'pendente_revisao');

  // Busca por município
  const byMunicipio = searchAndPrioritizeBarragens(BARRAGENS, EMPREENDEDORES, {
    query: 'Rondonopolis'
  });
  assert.equal(byMunicipio.items.length, 2);
});

test('verificarDocumentosRelacionadosEntidade separa IDs confirmados de candidatos por CAR compartilhado sem bloquear', () => {
  const docs: DocumentoCatalogoItem[] = [
    {
      id: 'd_oficial',
      origemSistema: 'Classifica',
      origemDocumentoId: '1',
      tipoCodigo: 'PARECER',
      tipoNome: 'Parecer',
      titulo: 'Parecer Oficial',
      dataEmissao: '2026-02-01',
      analistasElaboradores: ['Ana'],
      barragemId: 'bar_oficial_1',
      empreendedorId: 'emp_1',
      carMt: 'MT-5103403-AAAA1111',
      situacao: 'Emitido',
      criadoEm: '2026-02-01',
      sincronizadoEm: '2026-02-01'
    },
    {
      id: 'd_car_shared',
      origemSistema: 'Notifica',
      origemDocumentoId: '2',
      tipoCodigo: 'NOTIFICACAO',
      tipoNome: 'Notificação',
      titulo: 'Notificação no mesmo CAR',
      dataEmissao: '2026-03-01',
      analistasElaboradores: ['Bruno'],
      carMt: 'MT-5103403-AAAA1111',
      situacao: 'Emitido',
      criadoEm: '2026-03-01',
      sincronizadoEm: '2026-03-01'
    }
  ];

  const check = verificarDocumentosRelacionadosEntidade(docs, {
    barragemId: 'bar_oficial_1',
    carMt: 'MT-5103403-AAAA1111'
  });

  assert.equal(check.confirmadosPorId.length, 1);
  assert.equal(check.confirmadosPorId[0].id, 'd_oficial');
  assert.equal(check.candidatosPendentes.length, 1);
  assert.equal(check.candidatosPendentes[0].id, 'd_car_shared');
});

test('BarragensMinimap inicia camadas externas desmarcadas, sem dados sintéticos nem fallback por nome/CAR', () => {
  const minimapSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'components', 'BarragensMinimap.tsx'),
    'utf8'
  );

  // Camadas externas devem iniciar desmarcadas (false)
  assert.match(
    minimapSrc,
    /MINIMAP_SISTEMAS_DEFAULT\s*=\s*\{\s*sisb:\s*true,\s*classifica:\s*false,\s*notifica:\s*false,\s*fiscaliza:\s*false\s*\}/
  );

  // Não pode haver geração de documentos sintéticos nem nomes fictícios
  assert.equal(minimapSrc.includes('Mariana Silva'), false);
  assert.equal(minimapSrc.includes('Roberto Costa'), false);
  assert.equal(minimapSrc.includes('docs.length === 0'), false);

  // Lista explícita para coordenadas indisponíveis e marcadores numerados
  assert.ok(minimapSrc.includes('Coordenadas indisponíveis'));
  assert.ok(minimapSrc.includes('L.divIcon'));
});
