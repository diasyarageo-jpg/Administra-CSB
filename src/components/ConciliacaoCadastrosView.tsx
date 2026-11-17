import React, { useMemo, useState, useEffect } from 'react';
import {
  BarragemRecord,
  EmpreendedorRecord,
  getEmpreendedorVinculos
} from '../services/notificaDataService';
import { PaginationBar, PageSizeOption, paginateList } from './PaginationBar';
import { UserRole } from '../types/auth';

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
  revisoes: any[];
  userRole: UserRole;
  currentAuthUserId?: string;
  onViewRecord: (key: 'empreendedores' | 'barragens', record: any, originalIndex: number) => void;
  onEditRecord: (key: 'empreendedores' | 'barragens', originalIndex: number) => void;
  onArchiveRecord: (key: 'empreendedores' | 'barragens', originalIndex: number) => void;
  onConsultarSemaEmpreendedor: (record: EmpreendedorRecord) => void;
  onOpenGeoportalSync?: () => void;
}

type ConciliacaoTab = 'todos' | 'empreendedores' | 'barragens' | 'revisoes';
type SituacaoFiltro = 'todos' | 'ativos' | 'inativos';

function getSituacaoBadgeClass(situacao?: string): string {
  const s = normalizeMatchText(situacao);
  if (s === 'ativo' || s === 'confirmado' || s === 'regular') return 'green';
  if (s === 'inativo' || s === 'arquivado') return 'gray';
  if (s === 'recusado') return 'red';
  return 'amber';
}

export const ConciliacaoCadastrosView: React.FC<ConciliacaoCadastrosViewProps> = ({
  empreendedores,
  barragens,
  revisoes,
  userRole,
  currentAuthUserId,
  onViewRecord,
  onEditRecord,
  onArchiveRecord,
  onConsultarSemaEmpreendedor,
  onOpenGeoportalSync
}) => {
  const [activeTab, setActiveTab] = useState<ConciliacaoTab>('todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [situacaoFiltro, setSituacaoFiltro] = useState<SituacaoFiltro>('todos');
  const [empPage, setEmpPage] = useState<number>(1);
  const [empPageSize, setEmpPageSize] = useState<PageSizeOption>(20);
  const [damPage, setDamPage] = useState<number>(1);
  const [damPageSize, setDamPageSize] = useState<PageSizeOption>(20);

  const { empreendedoresSemBarragens, barragensSemEmpreendedor } = useMemo(
    () => computeConciliacaoPendencias(empreendedores, barragens),
    [empreendedores, barragens]
  );

  useEffect(() => {
    setEmpPage(1);
    setDamPage(1);
  }, [searchTerm, situacaoFiltro, activeTab]);

  const matchesSituacao = (situacao?: string): boolean => {
    if (situacaoFiltro === 'todos') return true;
    const isInativo = normalizeMatchText(situacao) === 'inativo';
    return situacaoFiltro === 'inativos' ? isInativo : !isInativo;
  };

  const normalizedSearch = normalizeMatchText(searchTerm);

  const filteredEmps = useMemo(() => {
    return empreendedoresSemBarragens.filter(({ record }) => {
      if (!matchesSituacao(record.situacao)) return false;
      if (!normalizedSearch) return true;
      const carsText = Array.isArray(record.empreendimentos)
        ? record.empreendimentos.map(e => `${e.nome || ''} ${e.car || ''}`).join(' ')
        : '';
      const haystack = normalizeMatchText(
        `${record.nome || ''} ${record.nomeFantasia || ''} ${record.cpfCnpj || ''} ${record.municipio || ''} ${record.uf || ''} ${record.email || ''} ${record.telefone || ''} ${carsText}`
      );
      return haystack.includes(normalizedSearch);
    });
  }, [empreendedoresSemBarragens, normalizedSearch, situacaoFiltro]);

  const filteredDams = useMemo(() => {
    return barragensSemEmpreendedor.filter(item => {
      const { record, legacyText, suggestedEmpreendedorName } = item;
      if (!matchesSituacao(record.situacao)) return false;
      if (!normalizedSearch) return true;
      const haystack = normalizeMatchText(
        `${record.nome || ''} ${record.car || ''} ${record.municipio || ''} ${record.uf || ''} ${record.snisb || ''} ${record.processo || ''} ${record.cursoAgua || ''} ${legacyText || ''} ${suggestedEmpreendedorName || ''}`
      );
      return haystack.includes(normalizedSearch);
    });
  }, [barragensSemEmpreendedor, normalizedSearch, situacaoFiltro]);

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
  const totalPendencias = empreendedoresSemBarragens.length + barragensSemEmpreendedor.length;

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
        <div className="stat">
          <div>
            <div className="label">Vínculos sugeridos (nome/doc)</div>
            <div className="value">{suggestedDamMatchesCount}</div>
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
        </div>
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
                        <td className="td-main">
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
                        <td className="td-main">
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
                        </td>
                        <td>
                          {record.municipio ? `${record.municipio}${record.uf ? `/${record.uf}` : ''}` : record.uf || '—'}
                        </td>
                        <td>
                          {record.latitude || record.longitude ? (
                            <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                              {[record.latitude, record.longitude].filter(Boolean).join(', ')}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'normal', maxWidth: '260px' }}>
                          {suggestedEmpreendedorId ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span className="badge blue" style={{ width: 'fit-content' }}>
                                Correspondência: {suggestedEmpreendedorName}
                              </span>
                              <span className="micro muted">Texto sem ID formal — abra para confirmar vínculo</span>
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

      {(activeTab === 'revisoes' || (activeTab === 'todos' && revisoes.length > 0)) && (
        <div className="panel">
          <div className="panel-head">
            <h3>Revisões pendentes e concluídas</h3>
            <span className="badge gray">{revisoes.length} registros</span>
          </div>
          {revisoes.length > 0 ? (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Entidade / Origem</th>
                    <th>Descrição</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {revisoes.map((rev: any, i: number) => (
                    <tr key={rev.id || i} className={i % 2 === 0 ? 'row-even' : 'row-odd'}>
                      <td className="td-main">{rev.entidade || rev.origem || 'Revisão'}</td>
                      <td>{rev.descricao || rev.motivo || rev.detalhes || '—'}</td>
                      <td>
                        <span className={`badge ${getSituacaoBadgeClass(rev.situacao)}`}>
                          {rev.situacao || 'Pendente'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon">⇄</div>
              <b>Nenhuma revisão cadastrada</b>
              <p>Quando houver registros de fontes distintas para comparação direta, as revisões aparecerão aqui.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
