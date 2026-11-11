// src/components/VisualizacaoModal.tsx
import React, { useState } from 'react';
import { parseCoordAdvanced, decimalToGms } from '../services/coordService';

interface VisualizacaoModalProps {
  moduleKey: string;
  record: any;
  index: number | null;
  db: {
    empreendedores: any[];
    barragens: any[];
    rts: any[];
    documentos?: any[];
  };
  canEdit?: boolean;
  onClose: () => void;
  onEdit?: () => void;
  onOpenSemaDocs?: (empreendedor: any) => void;
}

export function VisualizacaoModal({
  moduleKey,
  record,
  db,
  canEdit = true,
  onClose,
  onEdit,
  onOpenSemaDocs
}: VisualizacaoModalProps) {
  const [activeTab, setActiveTab] = useState<'geral' | 'vinculos' | 'documentos'>('geral');

  if (!record) return null;

  // Resolve nomes de vínculos para barragens
  const resolveEmpreendedorNome = (empIdOrName: any) => {
    if (!empIdOrName) return '—';
    const found = db.empreendedores.find(
      e => String(e.id) === String(empIdOrName) || e.nome?.toLowerCase() === String(empIdOrName).toLowerCase()
    );
    return found ? found.nome : String(empIdOrName);
  };

  const resolveEmpreendedorObj = (empIdOrName: any) => {
    if (!empIdOrName) return null;
    return db.empreendedores.find(
      e => String(e.id) === String(empIdOrName) || e.nome?.toLowerCase() === String(empIdOrName).toLowerCase()
    ) || null;
  };

  const resolveEmpreendimentoNome = (empNomeOrId: any, empObj: any) => {
    if (!empNomeOrId) return '—';
    if (empObj && Array.isArray(empObj.empreendimentos)) {
      const found = empObj.empreendimentos.find(
        (p: any) => String(p.id) === String(empNomeOrId) || p.nome?.toLowerCase() === String(empNomeOrId).toLowerCase()
      );
      if (found) return found.nome;
    }
    return String(empNomeOrId);
  };

  // Coordenadas formatadas para barragens
  const formatCoordDisplay = (val: any, isLng = false) => {
    if (!val) return '—';
    const parsed = parseCoordAdvanced(val, isLng);
    if (parsed.valido && parsed.gms) {
      const decStr = parsed.decimal !== null ? `${parsed.decimal.toFixed(6)}°` : '';
      return `${parsed.gms} (${decStr})`;
    }
    return String(val);
  };

  const formatDataIso = (iso: string | undefined | null) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleDateString('pt-BR');
    } catch {
      return String(iso);
    }
  };

  // Documentos vinculados à barragem
  const getDocumentosDaBarragem = (barragemId: any, barragemNome: string) => {
    const docs = db.documentos || [];
    return docs.filter((d: any) => {
      const matchId = barragemId && String(d.barragemId) === String(barragemId);
      const matchNome = barragemNome && String(d.barragemNome || d.barragem || '').toLowerCase() === barragemNome.toLowerCase();
      return matchId || matchNome;
    });
  };

  // Título e Ícone conforme o módulo
  let moduloNome = 'Registro';
  let moduloIcone = '👁️';

  if (moduleKey === 'empreendedores') {
    moduloNome = 'Empreendedor';
    moduloIcone = '◉';
  } else if (moduleKey === 'barragens') {
    moduloNome = 'Barragem Cadastrada';
    moduloIcone = '▤';
  } else if (moduleKey === 'rts') {
    moduloNome = 'Responsável Técnico';
    moduloIcone = '⌘';
  }

  const linkedEmpObj = moduleKey === 'barragens' ? resolveEmpreendedorObj(record.empreendedor) : null;
  const docsBarragem = moduleKey === 'barragens' ? getDocumentosDaBarragem(record.id, record.nome || '') : [];

  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(860px, 98vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        {/* Cabeçalho do Modal de Visualização */}
        <div className="modal-head" style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '18px', color: '#0284c7' }}>{moduloIcone}</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>
                  {record.nome || record.nomeBarragem || 'Detalhes do Registro'}
                </h3>
                <span
                  style={{
                    backgroundColor: '#e0f2fe',
                    color: '#0369a1',
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    border: '1px solid #bae6fd',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <span>👁️</span> MODO VISUALIZAÇÃO
                </span>
                {record.situacao && (
                  <span className={`badge ${record.situacao.toLowerCase().includes('ativ') ? 'green' : 'gray'}`}>
                    {record.situacao}
                  </span>
                )}
              </div>
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                {moduloNome} · ID: <code style={{ fontSize: '10px' }}>{record.id || '—'}</code>
              </span>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} title="Fechar visualização">×</button>
        </div>

        {/* Abas de Navegação interna se houver múltiplos aspectos */}
        <div style={{ display: 'flex', gap: '6px', padding: '10px 18px 0', borderBottom: '1px solid #e2e8f0', backgroundColor: '#fafbfc' }}>
          <button
            type="button"
            className={`btn light small ${activeTab === 'geral' ? 'green' : ''}`}
            onClick={() => setActiveTab('geral')}
            style={{ fontSize: '11.5px', borderRadius: '6px 6px 0 0' }}
          >
            Informações Gerais
          </button>
          {moduleKey === 'empreendedores' && (
            <button
              type="button"
              className={`btn light small ${activeTab === 'vinculos' ? 'green' : ''}`}
              onClick={() => setActiveTab('vinculos')}
              style={{ fontSize: '11.5px', borderRadius: '6px 6px 0 0' }}
            >
              Empreendimentos / Imóveis ({record.empreendimentos?.length || 0})
            </button>
          )}
          {moduleKey === 'barragens' && (
            <button
              type="button"
              className={`btn light small ${activeTab === 'documentos' ? 'green' : ''}`}
              onClick={() => setActiveTab('documentos')}
              style={{ fontSize: '11.5px', borderRadius: '6px 6px 0 0' }}
            >
              Documentos Vinculados ({docsBarragem.length})
            </button>
          )}
          {moduleKey === 'rts' && (
            <button
              type="button"
              className={`btn light small ${activeTab === 'vinculos' ? 'green' : ''}`}
              onClick={() => setActiveTab('vinculos')}
              style={{ fontSize: '11.5px', borderRadius: '6px 6px 0 0' }}
            >
              ARTs e Barragens ({record.vinculos?.length || (record.art || record.artRrt ? 1 : 0)})
            </button>
          )}
        </div>

        {/* Corpo com Informações em Modo Leitura / Visualização */}
        <div className="modal-body" style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
          {/* =====================================================================
              1. VISUALIZAÇÃO DE EMPREENDEDOR
             ===================================================================== */}
          {moduleKey === 'empreendedores' && (
            <>
              {activeTab === 'geral' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Grid de Identificação */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Nome / Razão Social</span>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>{record.nome || '—'}</strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>CPF / CNPJ</span>
                      <strong style={{ fontSize: '13px', color: '#0f172a', fontFamily: 'monospace' }}>{record.cpfCnpj || '—'}</strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Tipo de Pessoa</span>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>{record.tipoPessoa || 'Pessoa jurídica'}</strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Nome Fantasia</span>
                      <span style={{ fontSize: '13px', color: '#334155' }}>{record.nomeFantasia || '—'}</span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>E-mail Institucional</span>
                      <span style={{ fontSize: '13px', color: '#334155' }}>{record.email || '—'}</span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Telefone de Contato</span>
                      <span style={{ fontSize: '13px', color: '#334155' }}>{record.telefone || '—'}</span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Município / UF</span>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                        {record.municipio ? `${record.municipio}${record.uf ? `/${record.uf}` : ''}` : '—'}
                      </strong>
                      {record.municipioIbge && (
                        <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>
                          Código IBGE: {record.municipioIbge}
                        </span>
                      )}
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Situação Cadastral</span>
                      <span className={`badge ${record.situacao === 'Inativo' ? 'gray' : 'green'}`} style={{ marginTop: '2px' }}>
                        {record.situacao || 'Ativo'}
                      </span>
                    </div>
                  </div>

                  {/* Atalho para Consulta Geoportal SEMA se houver CPF/CNPJ */}
                  {record.cpfCnpj && onOpenSemaDocs && (
                    <div style={{
                      backgroundColor: '#f0f9ff',
                      border: '1px solid #bae6fd',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '10px'
                    }}>
                      <div>
                        <strong style={{ fontSize: '12px', color: '#0369a1', display: 'block' }}>
                          Integração com Geoportal SEMA-MT:
                        </strong>
                        <span style={{ fontSize: '11px', color: '#475569' }}>
                          Consulte licenças ambientais, notificações de fiscalização e autos cadastrados na SEMA.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn soft small"
                        style={{ backgroundColor: '#0284c7', color: '#ffffff' }}
                        onClick={() => onOpenSemaDocs(record)}
                      >
                        🔍 Ver Documentos SEMA
                      </button>
                    </div>
                  )}

                  {/* Observações */}
                  <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600, marginBottom: '4px' }}>
                      Observações e Informações Complementares
                    </span>
                    <p style={{ margin: 0, fontSize: '12px', color: '#334155', whiteSpace: 'pre-wrap' }}>
                      {record.observacoes || 'Nenhuma observação informada.'}
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'vinculos' && (
                <div>
                  <h4 style={{ fontSize: '13px', margin: '0 0 10px', color: '#334155' }}>
                    Empreendimentos e Imóveis Rurais Cadastrados ({record.empreendimentos?.length || 0})
                  </h4>
                  {(!record.empreendimentos || record.empreendimentos.length === 0) ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '12px' }}>
                      Nenhum empreendimento ou imóvel rural vinculado a este empreendedor.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {record.empreendimentos.map((emp: any, i: number) => (
                        <div key={emp.id || i} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <strong style={{ fontSize: '13px', color: '#0f172a' }}>{emp.nome}</strong>
                              <span className="badge gray" style={{ marginLeft: '8px', fontSize: '10px' }}>{emp.tipo || 'Rural'}</span>
                            </div>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                              {emp.municipio ? `${emp.municipio}${emp.uf ? `/${emp.uf}` : ''}` : '—'}
                            </span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', marginTop: '8px', fontSize: '12px' }}>
                            <div>
                              <span style={{ color: '#64748b' }}>CAR/MT: </span>
                              <strong style={{ fontFamily: 'monospace' }}>{emp.car || '—'}</strong>
                            </div>
                            <div>
                              <span style={{ color: '#64748b' }}>Matrícula / Escritura: </span>
                              <span>{emp.escritura || '—'}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* =====================================================================
              2. VISUALIZAÇÃO DE BARRAGEM
             ===================================================================== */}
          {moduleKey === 'barragens' && (
            <>
              {activeTab === 'geral' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Grid de Dados Principais */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Nome da Barragem</span>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>{record.nome || record.nomeBarragem || '—'}</strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Código / Identificador SNISB</span>
                      <span style={{ fontSize: '13px', color: '#334155', fontFamily: 'monospace' }}>{record.codigo || record.snisb || '—'}</span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Município (Mato Grosso)</span>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                        {record.municipio || '—'}
                      </strong>
                      {record.municipioIbge && (
                        <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>
                          Código IBGE: {record.municipioIbge}
                        </span>
                      )}
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Curso d’Água / Bacia</span>
                      <span style={{ fontSize: '13px', color: '#334155' }}>{record.cursoAgua || record.cursoDagua || record.rio || '—'}</span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Empreendedor Vinculado</span>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                        {resolveEmpreendedorNome(record.empreendedor)}
                      </strong>
                      {linkedEmpObj?.cpfCnpj && (
                        <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>
                          CPF/CNPJ: {linkedEmpObj.cpfCnpj}
                        </span>
                      )}
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Empreendimento / Fazenda</span>
                      <span style={{ fontSize: '13px', color: '#334155' }}>
                        {resolveEmpreendimentoNome(record.empreendimento, linkedEmpObj)}
                      </span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Registro no CAR/MT</span>
                      <strong style={{ fontSize: '13px', color: '#0284c7', fontFamily: 'monospace' }}>
                        {record.car || '—'}
                      </strong>
                      {record.carFederal && (
                        <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>
                          SICAR: {record.carFederal}
                        </span>
                      )}
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Processo SEMA-MT</span>
                      <span style={{ fontSize: '13px', color: '#334155', fontFamily: 'monospace' }}>{record.processo || '—'}</span>
                    </div>
                  </div>

                  {/* Coordenadas Geográficas Padronizadas */}
                  <div style={{
                    background: '#f8fafc',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0'
                  }}>
                    <strong style={{ fontSize: '12px', color: '#0f172a', display: 'block', marginBottom: '8px' }}>
                      📍 Coordenadas Geográficas (Padrão Oficial Administra GMS / EPSG:4326)
                    </strong>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                      <div>
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Latitude:</span>
                        <strong style={{ fontSize: '13px', color: '#0f172a', fontFamily: 'monospace' }}>
                          {formatCoordDisplay(record.latitude || record.lat, false)}
                        </strong>
                      </div>
                      <div>
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Longitude:</span>
                        <strong style={{ fontSize: '13px', color: '#0f172a', fontFamily: 'monospace' }}>
                          {formatCoordDisplay(record.longitude || record.lng, true)}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Características de Segurança e Classificação */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                    <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Categoria de Risco (CRI)</span>
                      <span className={`badge ${record.categoriaRisco === 'Alto' ? 'red' : record.categoriaRisco === 'Médio' ? 'amber' : 'green'}`} style={{ marginTop: '2px' }}>
                        {record.categoriaRisco || 'Não classificada'}
                      </span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Dano Potencial (DPA)</span>
                      <span className={`badge ${record.danoPotencial === 'Alto' ? 'red' : record.danoPotencial === 'Médio' ? 'amber' : 'green'}`} style={{ marginTop: '2px' }}>
                        {record.danoPotencial || 'Não classificada'}
                      </span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Altura do Maciço</span>
                      <span style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>
                        {record.altura ? `${record.altura} m` : '—'}
                      </span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Volume do Reservatório</span>
                      <span style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>
                        {record.volume ? `${record.volume} m³` : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Observações */}
                  <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600, marginBottom: '4px' }}>
                      Observações e Histórico de Campo
                    </span>
                    <p style={{ margin: 0, fontSize: '12px', color: '#334155', whiteSpace: 'pre-wrap' }}>
                      {record.observacoes || 'Nenhuma observação informada.'}
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'documentos' && (
                <div>
                  <h4 style={{ fontSize: '13px', margin: '0 0 10px', color: '#334155' }}>
                    Documentos Oficiais Vinculados a esta Barragem ({docsBarragem.length})
                  </h4>
                  {docsBarragem.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '12px' }}>
                      Nenhum documento (Parecer, Notificação, Ofício) vinculado a esta barragem no catálogo do Administra.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {docsBarragem.map((doc: any, i: number) => (
                        <div key={doc.id || i} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <span className="badge blue" style={{ fontSize: '10px', marginRight: '6px' }}>{doc.tipo || doc.sistemaOrigem}</span>
                              <strong style={{ fontSize: '12px', color: '#0f172a' }}>{doc.titulo || doc.numero || 'Documento'}</strong>
                            </div>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>{formatDataIso(doc.dataEmissao)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* =====================================================================
              3. VISUALIZAÇÃO DE RESPONSÁVEL TÉCNICO
             ===================================================================== */}
          {moduleKey === 'rts' && (
            <>
              {activeTab === 'geral' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Grid de Dados Pessoais / Profissionais */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Nome do Profissional</span>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>{record.nome || '—'}</strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>CPF</span>
                      <strong style={{ fontSize: '13px', color: '#0f172a', fontFamily: 'monospace' }}>{record.cpf || '—'}</strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Conselho Profissional</span>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                        {record.conselho ? `${record.conselho}${record.ufConselho ? `/${record.ufConselho}` : ''}` : '—'}
                      </strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Número do Registro Profissional</span>
                      <span style={{ fontSize: '13px', color: '#334155', fontFamily: 'monospace' }}>{record.registro || '—'}</span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Especialidades / Formação</span>
                      <span style={{ fontSize: '13px', color: '#334155' }}>{record.especialidades || record.profissao || '—'}</span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>E-mail de Contato</span>
                      <span style={{ fontSize: '13px', color: '#334155' }}>{record.email || '—'}</span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Telefone</span>
                      <span style={{ fontSize: '13px', color: '#334155' }}>{record.telefone || '—'}</span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Situação Cadastral</span>
                      <span className={`badge ${record.situacao === 'Inativo' ? 'gray' : 'green'}`} style={{ marginTop: '2px' }}>
                        {record.situacao || 'Ativo'}
                      </span>
                    </div>
                  </div>

                  {/* Alerta de conciliação se requiresReview */}
                  {record.requiresReview && (
                    <div style={{
                      backgroundColor: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      fontSize: '12px',
                      color: '#92400e'
                    }}>
                      <strong>⚠️ Pendência de Conciliação de Vínculo:</strong>
                      <p style={{ margin: '4px 0 0' }}>
                        Este responsável técnico possui dados recebidos de sistemas externos (Notifica/Classifica) que necessitam de conferência e confirmação na base central.
                      </p>
                    </div>
                  )}

                  {/* Observações */}
                  <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600, marginBottom: '4px' }}>
                      Observações e Anotações
                    </span>
                    <p style={{ margin: 0, fontSize: '12px', color: '#334155', whiteSpace: 'pre-wrap' }}>
                      {record.observacoes || 'Nenhuma observação informada.'}
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'vinculos' && (
                <div>
                  <h4 style={{ fontSize: '13px', margin: '0 0 10px', color: '#334155' }}>
                    Vínculos de ART e Barragens Associadas
                  </h4>
                  {Array.isArray(record.vinculos) && record.vinculos.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {record.vinculos.map((v: any, i: number) => (
                        <div key={v.id || i} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <div>
                              <span className="badge blue" style={{ fontSize: '10px' }}>ART: {v.art || 'S/ ART'}</span>
                              <strong style={{ fontSize: '13px', color: '#0f172a', marginLeft: '8px' }}>
                                ➔ {v.barragemNome || v.nomeBarragem || v.barragemId || 'Barragem vinculada'}
                              </strong>
                            </div>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                              {v.validade ? `Validade: ${formatDataIso(v.validade)}` : ''}
                            </span>
                          </div>
                          {v.tipoVinculo && (
                            <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '6px' }}>
                              Tipo de atuação: <strong>{v.tipoVinculo}</strong>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span className="badge blue" style={{ fontSize: '10px' }}>ART: {record.art || record.artRrt || 'Não informada'}</span>
                          <strong style={{ fontSize: '13px', color: '#0f172a', marginLeft: '8px' }}>
                            ➔ {record.barragemVinculada || record.nomeBarragem || 'Barragem cadastrada'}
                          </strong>
                        </div>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>
                          {record.validade ? `Validade: ${formatDataIso(record.validade)}` : ''}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Metadados de Auditoria */}
          <div style={{
            marginTop: '20px',
            paddingTop: '12px',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
            color: '#94a3b8'
          }}>
            <div>
              <span>Cadastrado em: </span>
              <strong>{formatDataIso(record.createdAt)}</strong>
            </div>
            <div>
              <span>Última atualização: </span>
              <strong>{formatDataIso(record.updatedAt || record.createdAt)}</strong>
            </div>
          </div>
        </div>

        {/* Rodapé do Modal */}
        <div className="modal-foot" style={{ borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '11px', color: '#64748b' }}>
            Somente leitura · Para realizar alterações, utilize o botão Editar.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn light" onClick={onClose}>
              Fechar
            </button>
            {canEdit && onEdit && (
              <button
                type="button"
                className="btn green"
                onClick={onEdit}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <span>✏️</span> Editar Cadastro
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
