import React, { useMemo, useState, useEffect } from 'react';
import {
  BarragemRecord,
  EmpreendedorRecord,
  PortariaRecord,
  ResponsavelTecnicoRecord,
  getEmpreendedorVinculos
} from '../services/notificaDataService';
import {
  BarragemDocumentoEmitidoItem,
  carregarDocumentosEmitidosPorBarragens
} from '../services/documentosService';
import { PaginationBar, PageSizeOption, paginateList } from './PaginationBar';
import { UserRole } from '../types/auth';
import { parseCoordAdvanced } from '../services/coordService';
import {
  ConciliacaoAdvancedFilters,
  EMPTY_CONCILIACAO_FILTERS,
  collectDistinctValues,
  countActiveAdvancedFilters,
  matchesConciliacaoBarragemAdvanced,
  matchesConciliacaoEmpreendedorAdvanced,
  matchesConciliacaoRevisaoAdvanced
} from '../utils/databaseAdvancedFilters';
import {
  AdvancedFilterDrawer,
  AdvancedFilterField,
  AdvancedFilterToggleButton
} from './AdvancedFilterPanel';
import {
  CONCILIACAO_ACAO_LABELS,
  CONCILIACAO_CLASSIFICACAO_LABELS,
  RtParecerPendencia,
  analisarPareceresRtPendentes,
  detectarMultiplasBarragensMesmoCar,
  parseRevisaoConciliacaoDetalhes
} from '../utils/conciliacaoEngine';
import {
  ConciliacaoAssistidaModal,
  ConciliacaoDecisaoSubmission
} from './ConciliacaoAssistidaModal';

export interface IndexedItem<T> {
  record: T;
  originalIndex: number;
}

export interface BarragemSemEmpreendedorItem extends IndexedItem<BarragemRecord> {
  legacyText: string;
  suggestedEmpreendedorId?: string;
  suggestedEmpreendedorName?: string;
  brokenReference: boolean;
}

export interface ConciliacaoPendenciasResult {
  empreendedoresSemBarragens: IndexedItem<EmpreendedorRecord>[];
  barragensSemEmpreendedor: BarragemSemEmpreendedorItem[];
}

function normalizeMatchText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function resolveEntrepreneurMatch(
  rawEmpreendedor: string | undefined | null,
  empreendedores: EmpreendedorRecord[]
): { id?: string; displayName: string; isUniqueMatch: boolean; isExactId: boolean } {
  if (!rawEmpreendedor || !String(rawEmpreendedor).trim()) {
    return { displayName: '', isUniqueMatch: false, isExactId: false };
  }

  const raw = String(rawEmpreendedor).trim();
  const byId = empreendedores.find(e => String(e.id) === raw);
  if (byId) {
    return {
      id: byId.id,
      displayName: byId.nome || byId.nomeFantasia || byId.cpfCnpj || byId.id,
      isUniqueMatch: true,
      isExactId: true
    };
  }

  const normalized = normalizeMatchText(raw);
  const cleanRawDoc = raw.replace(/\D/g, '');
  const matches = empreendedores.filter(e => {
    const nome = normalizeMatchText(e.nome);
    const nomeFantasia = normalizeMatchText(e.nomeFantasia);
    const cleanEmpDoc = String(e.cpfCnpj || '').replace(/\D/g, '');
    const docMatch = cleanRawDoc.length >= 11 && cleanEmpDoc === cleanRawDoc;
    return (Boolean(nome) && nome === normalized) || (Boolean(nomeFantasia) && nomeFantasia === normalized) || docMatch;
  });

  if (matches.length === 1) {
    const match = matches[0];
    return {
      id: match.id,
      displayName: match.nome || match.nomeFantasia || raw,
      isUniqueMatch: true,
      isExactId: false
    };
  }

  return { displayName: raw, isUniqueMatch: false, isExactId: false };
}

export function computeConciliacaoPendencias(
  empreendedores: EmpreendedorRecord[] = [],
  barragens: BarragemRecord[] = []
): ConciliacaoPendenciasResult {
  const safeEmps = Array.isArray(empreendedores) ? empreendedores : [];
  const safeDams = Array.isArray(barragens) ? barragens : [];
  const empIdSet = new Set(safeEmps.map(e => String(e?.id || '').trim()).filter(Boolean));

  const empreendedoresSemBarragens: IndexedItem<EmpreendedorRecord>[] = [];
  safeEmps.forEach((emp, idx) => {
    if (!emp) return;
    const vinculos = getEmpreendedorVinculos(emp, safeDams);
    if (vinculos.barragensVinculadas.length === 0) {
      empreendedoresSemBarragens.push({ record: emp, originalIndex: idx });
    }
  });

  empreendedoresSemBarragens.sort((a, b) =>
    String(a.record.nome || '').localeCompare(String(b.record.nome || ''), 'pt-BR', { sensitivity: 'base' })
  );

  const barragensSemEmpreendedor: BarragemSemEmpreendedorItem[] = [];
  safeDams.forEach((dam, idx) => {
    if (!dam) return;
    const directEmpId = String((dam as any).empreendedorId || (dam as any).empreendedor_id || '').trim();
    const hasValidDirectId = Boolean(directEmpId && empIdSet.has(directEmpId));
    const resolved = resolveEntrepreneurMatch(dam.empreendedor, safeEmps);

    if (hasValidDirectId || resolved.isExactId) {
      return;
    }

    const legacyText = String(dam.empreendedor || '').trim();
    barragensSemEmpreendedor.push({
      record: dam,
      originalIndex: idx,
      legacyText,
      suggestedEmpreendedorId: resolved.isUniqueMatch ? resolved.id : undefined,
      suggestedEmpreendedorName: resolved.isUniqueMatch ? resolved.displayName : undefined,
      brokenReference: Boolean(directEmpId && !hasValidDirectId)
    });
  });

  barragensSemEmpreendedor.sort((a, b) =>
    String(a.record.nome || '').localeCompare(String(b.record.nome || ''), 'pt-BR', { sensitivity: 'base' })
  );

  return {
    empreendedoresSemBarragens,
    barragensSemEmpreendedor
  };
}

interface ConciliacaoCadastrosViewProps {
  empreendedores: EmpreendedorRecord[];
  barragens: BarragemRecord[];
  rts?: ResponsavelTecnicoRecord[];
  portarias?: PortariaRecord[];
  revisoes: any[];
  userRole: UserRole;
  currentAuthUserId?: string;
  currentAuthUserName?: string;
  onViewRecord: (key: 'empreendedores' | 'barragens', record: any, originalIndex: number) => void;
  onEditRecord: (key: 'empreendedores' | 'barragens', originalIndex: number) => void;
  onArchiveRecord: (key: 'empreendedores' | 'barragens', originalIndex: number) => void;
  onConsultarSemaEmpreendedor: (record: EmpreendedorRecord) => void;
  onOpenGeoportalSync?: () => void;
  onRegistrarConciliacao?: (
    submission: ConciliacaoDecisaoSubmission
  ) => Promise<{ success: boolean; error?: string }>;
}

type ConciliacaoTab = 'todos' | 'empreendedores' | 'barragens' | 'rts_parecer' | 'revisoes';
type SituacaoFiltro = 'todos' | 'ativos' | 'inativos';

function getSituacaoBadgeClass(situacao?: string): string {
  const s = normalizeMatchText(situacao);
  if (s === 'ativo' || s === 'confirmado' || s === 'regular' || s === 'conciliado') return 'green';
  if (s === 'inativo' || s === 'arquivado') return 'gray';
  if (s === 'recusado' || s === 'rejeitado') return 'red';
  return 'amber';
}

export const ConciliacaoCadastrosView: React.FC<ConciliacaoCadastrosViewProps> = ({
  empreendedores,
  barragens,
  rts = [],
  portarias = [],
  revisoes,
  userRole,
  currentAuthUserId,
  currentAuthUserName,
  onViewRecord,
  onEditRecord,
  onArchiveRecord,
  onConsultarSemaEmpreendedor,
  onOpenGeoportalSync,
  onRegistrarConciliacao
}) => {
  const [activeTab, setActiveTab] = useState<ConciliacaoTab>('todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [situacaoFiltro, setSituacaoFiltro] = useState<SituacaoFiltro>('todos');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [advFilters, setAdvFilters] = useState<ConciliacaoAdvancedFilters>(EMPTY_CONCILIACAO_FILTERS);
  const [empPage, setEmpPage] = useState<number>(1);
  const [empPageSize, setEmpPageSize] = useState<PageSizeOption>(20);
  const [damPage, setDamPage] = useState<number>(1);
  const [damPageSize, setDamPageSize] = useState<PageSizeOption>(20);
  const [docsPorBarragem, setDocsPorBarragem] = useState<
    Record<string, BarragemDocumentoEmitidoItem[]>
  >({});
  const [docsLoaded, setDocsLoaded] = useState<boolean>(false);
  const [investigandoBarragem, setInvestigandoBarragem] =
    useState<BarragemSemEmpreendedorItem | null>(null);
  const [investigandoRtPendencia, setInvestigandoRtPendencia] =
    useState<RtParecerPendencia | null>(null);
  const [expandedRevId, setExpandedRevId] = useState<string | null>(null);

  const { empreendedoresSemBarragens, barragensSemEmpreendedor } = useMemo(
    () => computeConciliacaoPendencias(empreendedores, barragens),
    [empreendedores, barragens]
  );

  useEffect(() => {
    let active = true;
    if (!barragens || barragens.length === 0) {
      setDocsPorBarragem({});
      setDocsLoaded(true);
      return;
    }
    carregarDocumentosEmitidosPorBarragens(barragens, { portarias })
      .then(map => {
        if (active) {
          setDocsPorBarragem(map || {});
          setDocsLoaded(true);
        }
      })
      .catch(() => {
        if (active) setDocsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [barragens, portarias]);

  const pareceresRtPendentes = useMemo(
    () =>
      analisarPareceresRtPendentes({
        barragens,
        rts,
        documentosPorBarragem: docsPorBarragem
      }),
    [barragens, rts, docsPorBarragem]
  );

  useEffect(() => {
    setEmpPage(1);
    setDamPage(1);
  }, [searchTerm, situacaoFiltro, activeTab, advFilters]);

  const matchesSituacao = (situacao?: string): boolean => {
    if (situacaoFiltro === 'todos') return true;
    const isInativo = normalizeMatchText(situacao) === 'inativo';
    return situacaoFiltro === 'inativos' ? isInativo : !isInativo;
  };

  const normalizedSearch = normalizeMatchText(searchTerm);

  const advActiveCount = useMemo(
    () => countActiveAdvancedFilters(advFilters, EMPTY_CONCILIACAO_FILTERS),
    [advFilters]
  );

  const distinctUfs = useMemo(
    () => collectDistinctValues([{ uf: 'MT' }, ...empreendedores, ...barragens], r => r.uf),
    [empreendedores, barragens]
  );

  const distinctMunicipios = useMemo(
    () => collectDistinctValues([...empreendedores, ...barragens], r => r.municipio),
    [empreendedores, barragens]
  );

  const distinctSituacoes = useMemo(
    () =>
      collectDistinctValues(
        [
          { situacao: 'Ativo' },
          { situacao: 'Inativo' },
          { situacao: 'Aguardando confirmação' },
          ...empreendedores,
          ...barragens
        ],
        r => r.situacao
      ),
    [empreendedores, barragens]
  );

  const filteredEmps = useMemo(() => {
    return empreendedoresSemBarragens.filter(({ record }) => {
      if (!matchesSituacao(record.situacao)) return false;
      if (!matchesConciliacaoEmpreendedorAdvanced(record, advFilters)) return false;
      if (!normalizedSearch) return true;
      const carsText = Array.isArray(record.empreendimentos)
        ? record.empreendimentos.map(e => `${e.nome || ''} ${e.car || ''}`).join(' ')
        : '';
      const haystack = normalizeMatchText(
        `${record.nome || ''} ${record.nomeFantasia || ''} ${record.cpfCnpj || ''} ${record.municipio || ''} ${record.uf || ''} ${record.email || ''} ${record.telefone || ''} ${carsText}`
      );
      return haystack.includes(normalizedSearch);
    });
  }, [empreendedoresSemBarragens, normalizedSearch, situacaoFiltro, advFilters]);

  const filteredDams = useMemo(() => {
    return barragensSemEmpreendedor.filter(item => {
      const { record, legacyText, suggestedEmpreendedorName } = item;
      if (!matchesSituacao(record.situacao)) return false;
      if (!matchesConciliacaoBarragemAdvanced(item, advFilters)) return false;
      if (!normalizedSearch) return true;
      const haystack = normalizeMatchText(
        `${record.nome || ''} ${record.car || ''} ${record.municipio || ''} ${record.uf || ''} ${record.snisb || ''} ${record.processo || ''} ${record.cursoAgua || ''} ${legacyText || ''} ${suggestedEmpreendedorName || ''}`
      );
      return haystack.includes(normalizedSearch);
    });
  }, [barragensSemEmpreendedor, normalizedSearch, situacaoFiltro, advFilters]);

  const filteredRtPendencias = useMemo(() => {
    if (!normalizedSearch) return pareceresRtPendentes;
    return pareceresRtPendentes.filter(p => {
      const haystack = normalizeMatchText(
        `${p.barragemNome} ${p.processo || ''} ${p.car || ''} ${p.documentoTipo} ${p.documentoNumero || ''} ${p.citacao.rtNome || ''} ${p.citacao.artNumero || ''}`
      );
      return haystack.includes(normalizedSearch);
    });
  }, [pareceresRtPendentes, normalizedSearch]);

  const filteredRevisoes = useMemo(() => {
    return (Array.isArray(revisoes) ? revisoes : []).filter(rev =>
      matchesConciliacaoRevisaoAdvanced(rev, searchTerm, advFilters)
    );
  }, [revisoes, searchTerm, advFilters]);

  const suggestedDamMatchesCount = useMemo(
    () => barragensSemEmpreendedor.filter(d => Boolean(d.suggestedEmpreendedorId)).length,
    [barragensSemEmpreendedor]
  );

  const canEditRecord = (record: any): boolean => {
    if (userRole === 'Visualizador') return false;
    return (
      userRole === 'Administrador' ||
      (userRole as string) === 'Analista' ||
      !record?.createdBy ||
      Boolean(currentAuthUserId && record.createdBy === currentAuthUserId)
    );
  };

  const empPagination = paginateList(filteredEmps, empPage, empPageSize);
  const damPagination = paginateList(filteredDams, damPage, damPageSize);
  const totalPendencias =
    empreendedoresSemBarragens.length +
    barragensSemEmpreendedor.length +
    pareceresRtPendentes.length;

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Qualidade cadastral</div>
          <h2>Conciliação de cadastros</h2>
          <p>
            Listagem completa de empreendedores sem barragens vinculadas e barragens sem empreendedor vinculado para edição, consulta à SEMA-MT e regularização pelos analistas.
          </p>
        </div>
        {onOpenGeoportalSync && userRole !== 'Visualizador' && (
          <div className="actions">
            <button
              type="button"
              className="btn light"
              onClick={onOpenGeoportalSync}
              title="Atualizar base de consulta do Geoportal SEMA-MT"
            >
              Atualizar base do Geoportal
            </button>
          </div>
        )}
      </div>

      <div className="stats">
        <div
          className="stat"
          style={{ cursor: 'pointer', borderColor: activeTab === 'empreendedores' ? '#047857' : undefined }}
          onClick={() => setActiveTab('empreendedores')}
          title="Filtrar apenas empreendedores sem barragens"
        >
          <div>
            <div className="label">Empreendedores sem barragens</div>
            <div className="value">{empreendedoresSemBarragens.length}</div>
          </div>
          <div className="stat-ico">◉</div>
        </div>
        <div
          className="stat"
          style={{ cursor: 'pointer', borderColor: activeTab === 'barragens' ? '#047857' : undefined }}
          onClick={() => setActiveTab('barragens')}
          title="Filtrar apenas barragens sem empreendedor"
        >
          <div>
            <div className="label">Barragens sem empreendedor</div>
            <div className="value">{barragensSemEmpreendedor.length}</div>
          </div>
          <div className="stat-ico">▤</div>
        </div>
        <div
          className="stat"
          style={{ cursor: 'pointer', borderColor: activeTab === 'rts_parecer' ? '#047857' : undefined }}
          onClick={() => setActiveTab('rts_parecer')}
          title="Conciliar RTs e ARTs citados em Pareceres sem vínculo estruturado"
        >
          <div>
            <div className="label">Pareceres x RT/ART</div>
            <div className="value">{pareceresRtPendentes.length}</div>
          </div>
          <div className="stat-ico">⇄</div>
        </div>
        <div
          className="stat"
          style={{ cursor: 'pointer', borderColor: activeTab === 'revisoes' ? '#047857' : undefined }}
          onClick={() => setActiveTab('revisoes')}
          title="Visualizar revisões registradas"
        >
          <div>
            <div className="label">Revisões registradas</div>
            <div className="value">{revisoes.length}</div>
          </div>
          <div className="stat-ico">✓</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '16px' }}>
        <div className="toolbar" style={{ flexWrap: 'wrap', gap: '10px' }}>
          <div className="field-search">
            <span>⌕</span>
            <input
              className="input"
              placeholder="Pesquisar por nome, CPF/CNPJ, CAR/MT, município, SNISB ou processo..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            {(
              [
                ['todos', `Todas as pendências (${totalPendencias})`],
                ['empreendedores', `Empreendedores (${empreendedoresSemBarragens.length})`],
                ['barragens', `Barragens (${barragensSemEmpreendedor.length})`],
                ['rts_parecer', `Pareceres x RT (${pareceresRtPendentes.length})`],
                ['revisoes', `Revisões (${revisoes.length})`]
              ] as Array<[ConciliacaoTab, string]>
            ).map(([tabKey, label]) => {
              const selected = activeTab === tabKey;
              return (
                <button
                  key={tabKey}
                  type="button"
                  className={`btn ${selected ? 'soft' : 'light'} small`}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: selected ? 700 : 500,
                    borderColor: selected ? '#047857' : undefined,
                    color: selected ? '#047857' : undefined
                  }}
                  onClick={() => setActiveTab(tabKey)}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <select
            className="select"
            style={{ width: 'auto', minWidth: '150px', fontSize: '12px' }}
            value={situacaoFiltro}
            onChange={e => setSituacaoFiltro(e.target.value as SituacaoFiltro)}
            aria-label="Filtrar por situação cadastral"
          >
            <option value="todos">Todas as situações</option>
            <option value="ativos">Apenas ativos / pendentes</option>
            <option value="inativos">Apenas inativos</option>
          </select>

          <AdvancedFilterToggleButton
            isOpen={showAdvancedFilters}
            activeCount={advActiveCount}
            onToggle={() => setShowAdvancedFilters(prev => !prev)}
          />
        </div>

        {showAdvancedFilters && (
          <AdvancedFilterDrawer
            title="Pesquisa avançada · Conciliação de cadastros"
            subtitle="Todos os atributos de empreendedores sem barragens, barragens sem empreendedor e revisões"
            activeCount={advActiveCount}
            onClear={() => setAdvFilters(EMPTY_CONCILIACAO_FILTERS)}
            onClose={() => setShowAdvancedFilters(false)}
          >
            <AdvancedFilterField label="UF">
              <select
                className="select"
                value={advFilters.uf}
                onChange={e => setAdvFilters(prev => ({ ...prev, uf: e.target.value }))}
              >
                <option value="Todas">Todas as UFs</option>
                {distinctUfs.map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </AdvancedFilterField>

            <AdvancedFilterField label="Município / IBGE">
              <input
                className="input"
                list="adv-conc-municipios"
                placeholder="Município ou código IBGE..."
                value={advFilters.municipio}
                onChange={e => setAdvFilters(prev => ({ ...prev, municipio: e.target.value }))}
              />
              <datalist id="adv-conc-municipios">
                {distinctMunicipios.map(m => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </AdvancedFilterField>

            <AdvancedFilterField label="CPF / CNPJ (Empreendedor)">
              <input
                className="input"
                placeholder="CPF ou CNPJ..."
                value={advFilters.cpfCnpj}
                onChange={e => setAdvFilters(prev => ({ ...prev, cpfCnpj: e.target.value }))}
              />
            </AdvancedFilterField>

            <AdvancedFilterField label="Tipo de pessoa">
              <select
                className="select"
                value={advFilters.tipoPessoa}
                onChange={e => setAdvFilters(prev => ({ ...prev, tipoPessoa: e.target.value }))}
              >
                <option value="Todos">Todos os tipos</option>
                <option value="Pessoa física">Pessoa física</option>
                <option value="Pessoa jurídica">Pessoa jurídica</option>
              </select>
            </AdvancedFilterField>

            <AdvancedFilterField label="CAR / MT">
              <input
                className="input"
                placeholder="Número do CAR/MT..."
                value={advFilters.car}
                onChange={e => setAdvFilters(prev => ({ ...prev, car: e.target.value }))}
              />
            </AdvancedFilterField>

            <AdvancedFilterField label="Presença de CAR/MT">
              <select
                className="select"
                value={advFilters.temCar}
                onChange={e => setAdvFilters(prev => ({ ...prev, temCar: e.target.value }))}
              >
                <option value="Todos">Todos</option>
                <option value="com_car">Com CAR cadastrado</option>
                <option value="sem_car">Sem CAR cadastrado</option>
              </select>
            </AdvancedFilterField>

            <AdvancedFilterField label="Empreendimentos (Empreendedor)">
              <select
                className="select"
                value={advFilters.temEmpreendimentos}
                onChange={e => setAdvFilters(prev => ({ ...prev, temEmpreendimentos: e.target.value }))}
              >
                <option value="Todos">Todos</option>
                <option value="com">Com empreendimentos</option>
                <option value="sem">Sem empreendimentos</option>
              </select>
            </AdvancedFilterField>

            <AdvancedFilterField label="Processo (Barragem)">
              <input
                className="input"
                placeholder="Número do processo..."
                value={advFilters.processo}
                onChange={e => setAdvFilters(prev => ({ ...prev, processo: e.target.value }))}
              />
            </AdvancedFilterField>

            <AdvancedFilterField label="SNISB (Barragem)">
              <input
                className="input"
                placeholder="Código SNISB..."
                value={advFilters.snisb}
                onChange={e => setAdvFilters(prev => ({ ...prev, snisb: e.target.value }))}
              />
            </AdvancedFilterField>

            <AdvancedFilterField label="Curso d’água (Barragem)">
              <input
                className="input"
                placeholder="Rio ou córrego..."
                value={advFilters.cursoAgua}
                onChange={e => setAdvFilters(prev => ({ ...prev, cursoAgua: e.target.value }))}
              />
            </AdvancedFilterField>

            <AdvancedFilterField label="Coordenadas (Barragem)">
              <select
                className="select"
                value={advFilters.temCoordenadas}
                onChange={e => setAdvFilters(prev => ({ ...prev, temCoordenadas: e.target.value }))}
              >
                <option value="Todos">Todas</option>
                <option value="com_coordenadas">Com coordenadas válidas</option>
                <option value="sem_coordenadas">Sem coordenadas válidas</option>
              </select>
            </AdvancedFilterField>

            <AdvancedFilterField label="Referência / vínculo da barragem">
              <select
                className="select"
                value={advFilters.vinculoSugerido}
                onChange={e => setAdvFilters(prev => ({ ...prev, vinculoSugerido: e.target.value }))}
              >
                <option value="Todos">Todos</option>
                <option value="sugerido">Com correspondência sugerida</option>
                <option value="ausente">ID vinculado ausente na base</option>
                <option value="legado">Texto legado sem cadastro</option>
                <option value="nao_informado">Empreendedor não informado</option>
              </select>
            </AdvancedFilterField>

            <AdvancedFilterField label="Dano Potencial (DPA)">
              <select
                className="select"
                value={advFilters.danoPotencial}
                onChange={e => setAdvFilters(prev => ({ ...prev, danoPotencial: e.target.value }))}
              >
                <option value="Todos">Todos</option>
                <option value="Alto">Alto</option>
                <option value="Médio">Médio</option>
                <option value="Baixo">Baixo</option>
                <option value="Não classificada">Não classificada</option>
                <option value="nao_informado">Não informado</option>
              </select>
            </AdvancedFilterField>

            <AdvancedFilterField label="Categoria de Risco (CRI)">
              <select
                className="select"
                value={advFilters.categoriaRisco}
                onChange={e => setAdvFilters(prev => ({ ...prev, categoriaRisco: e.target.value }))}
              >
                <option value="Todos">Todos</option>
                <option value="Alto">Alto</option>
                <option value="Médio">Médio</option>
                <option value="Baixo">Baixo</option>
                <option value="Não classificada">Não classificada</option>
                <option value="nao_informado">Não informado</option>
              </select>
            </AdvancedFilterField>

            <AdvancedFilterField label="Contato ou referência textual">
              <input
                className="input"
                placeholder="E-mail, telefone ou texto legado..."
                value={advFilters.contato}
                onChange={e => setAdvFilters(prev => ({ ...prev, contato: e.target.value }))}
              />
            </AdvancedFilterField>

            <AdvancedFilterField label="Situação exata do registro">
              <select
                className="select"
                value={advFilters.situacaoDetalhada}
                onChange={e => setAdvFilters(prev => ({ ...prev, situacaoDetalhada: e.target.value }))}
              >
                <option value="Todas">Todas</option>
                {distinctSituacoes.map(st => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </AdvancedFilterField>

            <AdvancedFilterField label="Origem / entidade (Revisões)">
              <input
                className="input"
                placeholder="Origem da revisão..."
                value={advFilters.revisaoOrigem}
                onChange={e => setAdvFilters(prev => ({ ...prev, revisaoOrigem: e.target.value }))}
              />
            </AdvancedFilterField>

            <AdvancedFilterField label="Situação (Revisões)">
              <select
                className="select"
                value={advFilters.revisaoSituacao}
                onChange={e => setAdvFilters(prev => ({ ...prev, revisaoSituacao: e.target.value }))}
              >
                <option value="Todas">Todas</option>
                <option value="Pendente">Pendente</option>
                <option value="Conciliado">Conciliado</option>
                <option value="Rejeitado">Rejeitado</option>
              </select>
            </AdvancedFilterField>
          </AdvancedFilterDrawer>
        )}
      </div>

      {(activeTab === 'todos' || activeTab === 'empreendedores') && (
        <div className="panel" style={{ marginBottom: '16px' }}>
          <div className="panel-head">
            <div>
              <h3>Empreendedores sem barragens vinculadas</h3>
              <small style={{ color: '#64748b' }}>
                Clique em “Editar” para atualizar os dados do empreendedor ou em “CAR / SEMA” para consultar imóveis e documentos na SEMA-MT.
              </small>
            </div>
            <span className="badge amber">{filteredEmps.length} registros</span>
          </div>

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Empreendedor</th>
                  <th>CPF / CNPJ</th>
                  <th>Município / UF</th>
                  <th>Empreendimentos / CAR</th>
                  <th>Contato</th>
                  <th>Situação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {empPagination.pagedItems.length > 0 ? (
                  empPagination.pagedItems.map(({ record, originalIndex }, idx) => {
                    const empList = Array.isArray(record.empreendimentos) ? record.empreendimentos : [];
                    const cars = empList.map(e => String(e?.car || '').trim()).filter(Boolean);
                    const editable = canEditRecord(record);
                    const isInativo = normalizeMatchText(record.situacao) === 'inativo';

                    return (
                      <tr
                        key={record.id || `emp-unlinked-${originalIndex}`}
                        className={`${idx % 2 === 0 ? 'row-even' : 'row-odd'} row-interactive`}
                        onClick={() => onViewRecord('empreendedores', record, originalIndex)}
                        title="Clique para visualizar os dados completos do empreendedor"
                      >
                        <td className="td-main" style={{ minWidth: '150px', maxWidth: '240px' }}>
                          <div>{record.nome || 'Sem nome'}</div>
                          {(record.nomeFantasia || record.tipoPessoa) && (
                            <span className="td-sub">
                              {[record.tipoPessoa, record.nomeFantasia].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                            {record.cpfCnpj || '—'}
                          </span>
                        </td>
                        <td>
                          {record.municipio ? `${record.municipio}${record.uf ? `/${record.uf}` : ''}` : record.uf || '—'}
                        </td>
                        <td>
                          {empList.length > 0 || cars.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px' }}>
                              <span>{empList.length} empreendimento(s)</span>
                              {cars.length > 0 && (
                                <span style={{ color: '#0369a1', fontFamily: 'monospace' }}>
                                  {cars.slice(0, 2).join(', ')}
                                  {cars.length > 2 ? ` +${cars.length - 2}` : ''}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>Nenhum</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px' }}>
                            <span>{record.telefone || '—'}</span>
                            {record.email && <span className="td-sub">{record.email}</span>}
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${getSituacaoBadgeClass(record.situacao)}`}>
                            {record.situacao || 'Ativo'}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="iconbtn"
                              onClick={e => {
                                e.stopPropagation();
                                onViewRecord('empreendedores', record, originalIndex);
                              }}
                            >
                              Visualizar
                            </button>
                            {userRole !== 'Visualizador' && (record.cpfCnpj || record.nome) && (
                              <button
                                type="button"
                                className="iconbtn"
                                style={{ color: '#0369a1' }}
                                title="Consultar imóveis, CAR/MT e documentos na SEMA-MT"
                                onClick={e => {
                                  e.stopPropagation();
                                  onConsultarSemaEmpreendedor(record);
                                }}
                              >
                                CAR / SEMA
                              </button>
                            )}
                            {editable && (
                              <button
                                type="button"
                                className="iconbtn"
                                style={{ color: '#047857', fontWeight: 700 }}
                                title="Editar cadastro do empreendedor"
                                onClick={e => {
                                  e.stopPropagation();
                                  onEditRecord('empreendedores', originalIndex);
                                }}
                              >
                                Editar
                              </button>
                            )}
                            {editable && !isInativo && (
                              <button
                                type="button"
                                className="iconbtn"
                                title="Inativar empreendedor"
                                onClick={e => {
                                  e.stopPropagation();
                                  onArchiveRecord('empreendedores', originalIndex);
                                }}
                              >
                                Inativar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty">
                        <div className="empty-icon">◉</div>
                        <b>Nenhum empreendedor sem barragem encontrado</b>
                        <p>Todos os empreendedores filtrados possuem ao menos uma barragem vinculada ou não correspondem à pesquisa.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <PaginationBar
            totalItems={filteredEmps.length}
            currentPage={empPage}
            pageSize={empPageSize}
            onPageChange={setEmpPage}
            onPageSizeChange={setEmpPageSize}
          />
        </div>
      )}

      {(activeTab === 'todos' || activeTab === 'barragens') && (
        <div className="panel" style={{ marginBottom: '16px' }}>
          <div className="panel-head">
            <div>
              <h3>Barragens sem empreendedor vinculado</h3>
              <small style={{ color: '#64748b' }}>
                Clique em “Editar / Vincular” para associar um empreendedor existente, criar um novo cadastro ou localizar o titular via consulta pública da SEMA-MT.
              </small>
            </div>
            <span className="badge amber">{filteredDams.length} registros</span>
          </div>

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Barragem</th>
                  <th>CAR / MT</th>
                  <th>Município / UF</th>
                  <th>Coordenadas</th>
                  <th>Referência atual</th>
                  <th>Situação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {damPagination.pagedItems.length > 0 ? (
                  damPagination.pagedItems.map((item, idx) => {
                    const { record, originalIndex, legacyText, suggestedEmpreendedorId, suggestedEmpreendedorName, brokenReference } = item;
                    const editable = canEditRecord(record);
                    const isInativo = normalizeMatchText(record.situacao) === 'inativo';

                    return (
                      <tr
                        key={record.id || `dam-unlinked-${originalIndex}`}
                        className={`${idx % 2 === 0 ? 'row-even' : 'row-odd'} row-interactive`}
                        onClick={() => onViewRecord('barragens', record, originalIndex)}
                        title="Clique para visualizar os dados completos da barragem"
                      >
                        <td className="td-main" style={{ minWidth: '150px', maxWidth: '240px' }}>
                          <div>{record.nome || 'Barragem sem nome'}</div>
                          {(record.snisb || record.processo) && (
                            <span className="td-sub">
                              {[
                                record.snisb ? `SNISB: ${record.snisb}` : '',
                                record.processo ? `Proc.: ${record.processo}` : ''
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                            {record.car || '—'}
                          </span>
                          {(() => {
                            const carInfo = detectarMultiplasBarragensMesmoCar(record, barragens);
                            if (!carInfo.avisoMultiplasBarragens) return null;
                            return (
                              <div style={{ marginTop: '3px' }}>
                                <span
                                  className="badge amber"
                                  style={{ fontSize: '10px', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal' }}
                                  title={carInfo.mensagem}
                                >
                                  {carInfo.totalBarragensNoMesmoCar} barragens neste CAR
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td>
                          {record.municipio ? `${record.municipio}${record.uf ? `/${record.uf}` : ''}` : record.uf || '—'}
                        </td>
                        <td>
                          {(() => {
                            const fmt = (raw: any, isLng: boolean) => {
                              const s = String(raw ?? '').trim();
                              if (!s) return '';
                              const p = parseCoordAdvanced(s, isLng);
                              return p.valido && p.gms ? p.gms : s;
                            };
                            const latGms = fmt(record.latitude, false);
                            const lngGms = fmt(record.longitude, true);
                            if (!latGms && !lngGms) {
                              return <span style={{ color: '#94a3b8' }}>—</span>;
                            }
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontFamily: 'monospace', fontSize: '11px' }}>
                                <span style={{ whiteSpace: 'normal' }}>Lat: {latGms || '—'}</span>
                                <span style={{ whiteSpace: 'normal' }}>Lon: {lngGms || '—'}</span>
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{ whiteSpace: 'normal', maxWidth: '260px' }}>
                          {suggestedEmpreendedorId ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span className="badge blue" style={{ width: 'fit-content', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineHeight: 1.3 }}>
                                Correspondência: {suggestedEmpreendedorName}
                              </span>
                              <span className="micro muted">Texto sem ID formal — investigue para confirmar</span>
                            </div>
                          ) : brokenReference ? (
                            <span className="badge red">ID vinculado ausente na base</span>
                          ) : legacyText ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span style={{ fontSize: '12px', color: '#334155', fontWeight: 600 }}>{legacyText}</span>
                              <span className="micro muted">Sem cadastro correspondente por ID</span>
                            </div>
                          ) : (
                            <span className="badge gray">Não informado</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${getSituacaoBadgeClass(record.situacao)}`}>
                            {record.situacao || 'Aguardando confirmação'}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="iconbtn"
                              style={{ color: '#0369a1', fontWeight: 700 }}
                              title="Investigar evidências, SEMA/MT e decidir conciliação"
                              onClick={e => {
                                e.stopPropagation();
                                setInvestigandoBarragem(item);
                              }}
                            >
                              Conciliar / Investigar
                            </button>
                            <button
                              type="button"
                              className="iconbtn"
                              onClick={e => {
                                e.stopPropagation();
                                onViewRecord('barragens', record, originalIndex);
                              }}
                            >
                              Visualizar
                            </button>
                            {editable && (
                              <button
                                type="button"
                                className="iconbtn"
                                style={{ color: '#047857', fontWeight: 700 }}
                                title="Editar barragem e vincular empreendedor"
                                onClick={e => {
                                  e.stopPropagation();
                                  onEditRecord('barragens', originalIndex);
                                }}
                              >
                                Editar / Vincular
                              </button>
                            )}
                            {editable && !isInativo && (
                              <button
                                type="button"
                                className="iconbtn"
                                title="Inativar barragem"
                                onClick={e => {
                                  e.stopPropagation();
                                  onArchiveRecord('barragens', originalIndex);
                                }}
                              >
                                Inativar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty">
                        <div className="empty-icon">▤</div>
                        <b>Nenhuma barragem sem empreendedor encontrada</b>
                        <p>Todas as barragens filtradas já possuem empreendedor vinculado ou não correspondem à pesquisa.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <PaginationBar
            totalItems={filteredDams.length}
            currentPage={damPage}
            pageSize={damPageSize}
            onPageChange={setDamPage}
            onPageSizeChange={setDamPageSize}
          />
        </div>
      )}

      {(activeTab === 'rts_parecer' ||
        (activeTab === 'todos' && pareceresRtPendentes.length > 0)) && (
        <div className="panel" style={{ marginBottom: '16px' }}>
          <div className="panel-head">
            <div>
              <h3>Conciliação de Pareceres x RTs e ARTs estruturados</h3>
              <small style={{ color: '#64748b' }}>
                Compara RT/ART citados em pareceres técnicos/de classificação com os vínculos em <code>responsaveis_tecnicos_barragens</code>. Ausência de RT em Notificações e Ofícios não é tratada como divergência.
              </small>
            </div>
            <span className="badge amber">
              {docsLoaded ? `${filteredRtPendencias.length} pendências` : 'Analisando documentos...'}
            </span>
          </div>

          {filteredRtPendencias.length > 0 ? (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Barragem / Processo</th>
                    <th>Parecer de origem</th>
                    <th>RT / ART citado</th>
                    <th>Classificação sugerida</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRtPendencias.map((pend, idx) => (
                    <tr
                      key={pend.id}
                      className={idx % 2 === 0 ? 'row-even' : 'row-odd'}
                    >
                      <td className="td-main" style={{ whiteSpace: 'normal', maxWidth: '240px' }}>
                        <div>{pend.barragemNome}</div>
                        <span className="td-sub">
                          {[pend.processo ? `Proc.: ${pend.processo}` : '', pend.car ? `CAR: ${pend.car}` : '']
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'normal', maxWidth: '260px', fontSize: '12px' }}>
                        <div style={{ fontWeight: 600 }}>
                          {pend.documentoTipo}
                          {pend.documentoNumero ? ` nº ${pend.documentoNumero}` : ''}
                        </div>
                        <div className="td-sub">
                          {pend.documentoTitulo} ({pend.documentoOrigem})
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'normal', maxWidth: '240px', fontSize: '12px' }}>
                        <div>
                          <b>RT:</b> {pend.citacao.rtNome || '—'}
                        </div>
                        <div>
                          <b>ART:</b> {pend.citacao.artNumero || '—'}
                        </div>
                        {pend.candidatosRtMestre.length > 0 && (
                          <div className="td-sub" style={{ color: '#0369a1' }}>
                            {pend.candidatosRtMestre.length} candidato(s) no cadastro mestre
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="badge amber">
                          {CONCILIACAO_CLASSIFICACAO_LABELS[pend.classificacaoSugerida]}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="iconbtn"
                            style={{ color: '#0369a1', fontWeight: 700 }}
                            onClick={() => setInvestigandoRtPendencia(pend)}
                          >
                            Conciliar RT / ART
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon">⇄</div>
              <b>Nenhuma pendência entre Pareceres e RTs</b>
              <p>
                Todos os pareceres com citação de RT/ART possuem vínculo correspondente ou não há pareceres pendentes de conciliação.
              </p>
            </div>
          )}
        </div>
      )}

      {(activeTab === 'revisoes' || (activeTab === 'todos' && revisoes.length > 0)) && (
        <div className="panel">
          <div className="panel-head">
            <h3>Revisões pendentes e concluídas</h3>
            <span className="badge gray">{filteredRevisoes.length} registros</span>
          </div>
          {filteredRevisoes.length > 0 ? (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Entidade / Origem</th>
                    <th>Descrição / Auditoria</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRevisoes.map((rev: any, i: number) => {
                    const parsed = parseRevisaoConciliacaoDetalhes(rev);
                    const s = parsed.structured;
                    const revKey = String(rev.id || i);
                    const isExpanded = expandedRevId === revKey;

                    return (
                      <React.Fragment key={revKey}>
                        <tr
                          className={`${i % 2 === 0 ? 'row-even' : 'row-odd'} row-interactive`}
                          onClick={() =>
                            setExpandedRevId(isExpanded ? null : revKey)
                          }
                          title="Clique para expandir detalhes auditados"
                        >
                          <td className="td-main" style={{ whiteSpace: 'normal', maxWidth: '260px' }}>
                            <div>{rev.entidade || rev.identificador || rev.origem || rev.tipo || 'Revisão'}</div>
                            {s && (
                              <span className="td-sub">
                                {CONCILIACAO_CLASSIFICACAO_LABELS[s.classificacao]} ·{' '}
                                {CONCILIACAO_ACAO_LABELS[s.acao]}
                              </span>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'normal' }}>
                            <div>{parsed.resumoTexto}</div>
                            {s && (
                              <div className="micro muted" style={{ marginTop: '2px' }}>
                                Fonte: {s.fonte} · Usuário: {s.usuario} ·{' '}
                                {new Date(s.dataDecisao).toLocaleString('pt-BR')}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${getSituacaoBadgeClass(rev.situacao)}`}>
                              {rev.situacao || 'Pendente'}
                            </span>
                          </td>
                        </tr>
                        {isExpanded && s && (
                          <tr className={i % 2 === 0 ? 'row-even' : 'row-odd'}>
                            <td colSpan={3} style={{ background: '#f8fafc', fontSize: '11px', lineHeight: 1.5 }}>
                              <div><b>Valor anterior:</b> {s.valorAnterior}</div>
                              <div><b>Valor proposto:</b> {s.valorProposto}</div>
                              <div><b>Justificativa:</b> {s.justificativa}</div>
                              <div>
                                <b>Evidências:</b>{' '}
                                {[
                                  s.evidencias.processo ? `Proc. ${s.evidencias.processo}` : '',
                                  s.evidencias.car ? `CAR ${s.evidencias.car}` : '',
                                  s.evidencias.multiplasBarragensNoCar && s.evidencias.multiplasBarragensNoCar > 1
                                    ? `${s.evidencias.multiplasBarragensNoCar} barragens no mesmo CAR`
                                    : '',
                                  s.evidencias.semaConsultada
                                    ? `SEMA: ${s.evidencias.semaCriterioEspacial || 'Consultada'} (${s.evidencias.semaCamada || 'Geoportal'})`
                                    : 'Sem consulta espacial SEMA',
                                  s.evidencias.semaIndisponivelMotivo
                                    ? `SEMA indisponível: ${s.evidencias.semaIndisponivelMotivo}`
                                    : ''
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon">⇄</div>
              <b>Nenhuma revisão encontrada</b>
              <p>Quando houver registros correspondentes aos filtros para comparação direta, as revisões aparecerão aqui.</p>
            </div>
          )}
        </div>
      )}

      {investigandoBarragem && (
        <ConciliacaoAssistidaModal
          mode="barragem_empreendedor"
          barragemItem={investigandoBarragem}
          barragemTarget={investigandoBarragem.record}
          todasBarragens={barragens}
          empreendedores={empreendedores}
          rts={rts}
          portarias={portarias}
          currentUserName={currentAuthUserName || 'Usuário'}
          readOnly={userRole === 'Visualizador'}
          onClose={() => setInvestigandoBarragem(null)}
          onSubmitDecisao={async submission => {
            if (!onRegistrarConciliacao) {
              return {
                success: false,
                error: 'Manipulador de gravação de conciliação não conectado.'
              };
            }
            return await onRegistrarConciliacao(submission);
          }}
        />
      )}

      {investigandoRtPendencia && (() => {
        const dam = barragens.find(
          b => String(b.id) === String(investigandoRtPendencia.barragemId)
        );
        if (!dam) return null;
        return (
          <ConciliacaoAssistidaModal
            mode="barragem_rt_parecer"
            rtPendencia={investigandoRtPendencia}
            barragemTarget={dam}
            todasBarragens={barragens}
            empreendedores={empreendedores}
            rts={rts}
            portarias={portarias}
            currentUserName={currentAuthUserName || 'Usuário'}
            readOnly={userRole === 'Visualizador'}
            onClose={() => setInvestigandoRtPendencia(null)}
            onSubmitDecisao={async submission => {
              if (!onRegistrarConciliacao) {
                return {
                  success: false,
                  error: 'Manipulador de gravação de conciliação não conectado.'
                };
              }
              return await onRegistrarConciliacao(submission);
            }}
          />
        );
      })()}
    </div>
  );
};
