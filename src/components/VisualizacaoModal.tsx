// src/components/VisualizacaoModal.tsx
import React, { useState, useEffect } from 'react';
import { parseCoordAdvanced } from '../services/coordService';
import { getEmpreendedorVinculos } from '../services/notificaDataService';
import { findBarragensMatchingCarString, formatCpfCnpjReadable } from '../config/carCampos';
import {
  BarragemDocumentoEmitidoItem,
  carregarDocumentosEmitidosPorBarragens
} from '../services/documentosService';
import { ConferenciaDocumentosPanel } from './ConferenciaDocumentosModal';

interface VisualizacaoModalProps {
  moduleKey: string;
  record: any;
  index: number | null;
  db: {
    empreendedores: any[];
    barragens: any[];
    rts: any[];
    documentos?: any[];
    portarias?: any[];
  };
  canEdit?: boolean;
  canSolicitarVistoria?: boolean;
  onClose: () => void;
  onEdit?: () => void;
  onOpenSemaDocs?: (empreendedor: any) => void;
  onSolicitarVistoria?: (barragem: any) => void;
}

export function VisualizacaoModal({
  moduleKey,
  record,
  db,
  canEdit = true,
  canSolicitarVistoria = false,
  onClose,
  onEdit,
  onOpenSemaDocs,
  onSolicitarVistoria
}: VisualizacaoModalProps) {
  const [activeTab, setActiveTab] = useState<'geral' | 'vinculos' | 'documentos'>('geral');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [docsByBarragemId, setDocsByBarragemId] = useState<Record<string, BarragemDocumentoEmitidoItem[]>>({});

  useEffect(() => {
    setExpandedCards({});
    setActiveTab('geral');
  }, [moduleKey, record?.id]);

  useEffect(() => {
    let active = true;
    const targetDams =
      moduleKey === 'barragens' && record
        ? [record]
        : (moduleKey === 'empreendedores' || moduleKey === 'rts') && record
        ? db.barragens || []
        : [];
    if (targetDams.length === 0) {
      setDocsByBarragemId({});
      return;
    }
    carregarDocumentosEmitidosPorBarragens(targetDams, { portarias: db.portarias || [] })
      .then(map => {
        if (active) setDocsByBarragemId(map);
      })
      .catch(() => {
        if (active) setDocsByBarragemId({});
      });
    return () => {
      active = false;
    };
  }, [moduleKey, record, db.barragens, db.portarias]);

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

  // Documentos vinculados à barragem apenas por ID estável (sem inferência por nome)
  const getDocumentosDaBarragem = (barragemId: any, _barragemNome: string) => {
    const docs = db.documentos || [];
    const targetId = String(barragemId || '').trim();
    if (!targetId) return [];
    return docs.filter((d: any) => String(d?.barragemId || '').trim() === targetId);
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
  const empVinculos = moduleKey === 'empreendedores' ? getEmpreendedorVinculos(record, db.barragens || []) : null;
  const docsBarragem =
    moduleKey === 'barragens'
      ? docsByBarragemId[String(record.id || 'barr_0')] || getDocumentosDaBarragem(record.id, record.nome || '')
      : [];

  const getRtsForDam = (bar: any) => {
    const barId = String(bar?.id || '').trim();
    const barNome = String(bar?.nome || bar?.nomeBarragem || '').trim().toLowerCase();
    const out: Array<{ nome: string; art?: string; validade?: string }> = [];
    for (const rt of db.rts || []) {
      const vinculosRt =
        Array.isArray(rt?.vinculos) && rt.vinculos.length > 0
          ? rt.vinculos
          : [{ barragemId: rt?.barragemId || rt?.barragemVinculada, nomeBarragem: rt?.nomeBarragem, art: rt?.art || rt?.artRrt, validade: rt?.validade }];
      for (const v of vinculosRt) {
        const matchId = barId && (String(v.barragemId || '') === barId || String(v.barragemVinculada || '') === barId);
        const matchNome = barNome && (String(v.nomeBarragem || '').trim().toLowerCase() === barNome || String(v.barragemVinculada || '').trim().toLowerCase() === barNome);
        if (matchId || matchNome) {
          out.push({ nome: rt.nome || 'RT', art: v.art || v.artRrt || rt.art, validade: v.validade });
        }
      }
    }
    return out;
  };

  const renderExpandArrowButton = (expandKey: string, closedLabel = 'Expandir', openLabel = 'Suprimir') => {
    const isOpen = Boolean(expandedCards[expandKey]);
    return (
      <button
        type="button"
        onClick={() => setExpandedCards(prev => ({ ...prev, [expandKey]: !prev[expandKey] }))}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          background: isOpen ? '#e0f2fe' : '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: '6px',
          padding: '3px 8px',
          color: '#0369a1',
          cursor: 'pointer',
          fontSize: '11px',
          fontWeight: 700
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease'
          }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span>{isOpen ? openLabel : closedLabel}</span>
      </button>
    );
  };

  const renderBarragemExpandableCard = (bar: any, expandKey: string) => {
    const isOpen = Boolean(expandedCards[expandKey]);
    const alturaVal =
      bar.altura !== undefined && bar.altura !== null && String(bar.altura).trim() !== ''
        ? `${bar.altura} m`
        : 'Não informada';
    const volumeVal =
      bar.volume !== undefined && bar.volume !== null && String(bar.volume).trim() !== ''
        ? `${bar.volume} m³`
        : 'Não informado';
    const dpaVal = bar.danoPotencial || bar.dpa || '';
    const criVal = bar.categoriaRisco || bar.cri || '';
    const hasDpaClassificada = Boolean(dpaVal && String(dpaVal).trim() !== '' && String(dpaVal).trim() !== 'Não classificada');
    const docsDaDam = docsByBarragemId[String(bar.id || '')] || [];
    const rtsDaDam = getRtsForDam(bar);

    return (
      <div
        key={expandKey}
        style={{
          padding: '9px 11px',
          background: isOpen ? '#ffffff' : '#f8fafc',
          borderRadius: '8px',
          border: isOpen ? '1.5px solid #059669' : '1px solid #cbd5e1',
          fontSize: '12px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <strong style={{ color: '#0f172a', fontSize: '12.5px' }}>{bar.nome || bar.nomeBarragem || 'Barragem'}</strong>
            {hasDpaClassificada && (
              <span className={`badge ${dpaVal === 'Alto' ? 'red' : dpaVal === 'Médio' ? 'amber' : 'green'}`} style={{ fontSize: '10px' }}>
                DPA: {dpaVal}
              </span>
            )}
            {docsDaDam.length > 0 && (
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', backgroundColor: '#e0f2fe', color: '#0369a1' }}>
                {docsDaDam.length} doc(s)
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {canSolicitarVistoria && onSolicitarVistoria && (
              <button
                type="button"
                className="btn soft small"
                onClick={() => onSolicitarVistoria(bar)}
              >
                Solicitar vistoria
              </button>
            )}
            {renderExpandArrowButton(expandKey, 'Características e vínculos', 'Suprimir')}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '4px', color: '#475569', fontSize: '11.5px' }}>
          <span>CAR/MT: <strong style={{ color: '#0369a1', fontFamily: 'monospace' }}>{bar.car || 'Não informado'}</strong></span>
          {bar.processo && <span>Processo: <strong>{bar.processo}</strong></span>}
          {bar.municipio && <span>Município: <strong>{bar.municipio}</strong></span>}
        </div>

        {isOpen && (
          <div style={{ marginTop: '9px', paddingTop: '9px', borderTop: '1px dashed #cbd5e1', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '6px' }}>
              <div style={{ background: '#f8fafc', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Altura do Maciço</span>
                <strong style={{ fontSize: '12px', color: '#0f172a' }}>{alturaVal}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Volume do Reservatório</span>
                <strong style={{ fontSize: '12px', color: '#0f172a' }}>{volumeVal}</strong>
              </div>
              <div
                style={{
                  background: hasDpaClassificada
                    ? dpaVal === 'Alto'
                      ? '#fef2f2'
                      : dpaVal === 'Médio'
                      ? '#fffbeb'
                      : '#f0fdf4'
                    : '#f8fafc',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: hasDpaClassificada ? '1px solid #94a3b8' : '1px solid #cbd5e1'
                }}
              >
                <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Dano Potencial (DPA)</span>
                <strong style={{ fontSize: '12px', color: '#0f172a' }}>
                  {hasDpaClassificada ? `${dpaVal} (Classificada)` : 'Não classificada'}
                </strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '6px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Categoria de Risco (CRI)</span>
                <strong style={{ fontSize: '12px', color: '#0f172a' }}>{criVal || 'Não classificada'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '6px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Curso d’Água</span>
                <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>{bar.cursoAgua || bar.cursoDagua || 'Não informado'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '6px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Coordenadas</span>
                <strong style={{ fontSize: '11px', color: '#0f172a', fontFamily: 'monospace' }}>
                  {bar.latitude || bar.longitude ? `${formatCoordDisplay(bar.latitude, false)} / ${formatCoordDisplay(bar.longitude, true)}` : 'Não informadas'}
                </strong>
              </div>
            </div>

            {rtsDaDam.length > 0 && (
              <div style={{ fontSize: '11.5px', color: '#334155', background: '#f8fafc', padding: '6px 8px', borderRadius: '5px', border: '1px solid #e2e8f0' }}>
                <strong>RT(s): </strong>
                {rtsDaDam.map(r => (r.art ? `${r.nome} (ART: ${r.art})` : r.nome)).join('; ')}
              </div>
            )}

            {docsDaDam.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <strong style={{ fontSize: '10.5px', color: '#0369a1' }}>Documentos emitidos ({docsDaDam.length}):</strong>
                {docsDaDam.map((doc, dIdx) => (
                  <div key={`${doc.id}-${dIdx}`} style={{ fontSize: '11px', color: '#334155', background: '#f0f9ff', padding: '5px 8px', borderRadius: '5px', border: '1px solid #bae6fd' }}>
                    <strong>[{doc.tipo}]</strong> {doc.numero ? `${doc.titulo} · Nº ${doc.numero}` : doc.titulo}
                    {doc.dataEmissao ? ` · ${formatDataIso(doc.dataEmissao)}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(860px, 98vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        {/* Cabeçalho do Modal de Visualização */}
        <div className="modal-head" style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: '18px', color: '#0284c7', flexShrink: 0 }}>{moduloIcone}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a', wordBreak: 'break-word' }}>
                  {record.nome || record.nomeBarragem || record.razaoSocial || record.nomeFantasia || 'Detalhes do Registro'}
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
              Imóveis e Barragens ({(record.empreendimentos?.length || 0) + (empVinculos?.barragensVinculadas.length || 0)})
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
              {/* Faixa permanente com identificação principal do empreendedor */}
              <div
                style={{
                  background: 'linear-gradient(135deg, #f8fafc 0%, #f0f9ff 100%)',
                  border: '1px solid #bae6fd',
                  borderLeft: '4px solid #0284c7',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  marginBottom: '16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '12px'
                }}
              >
                <div>
                  <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#0369a1', display: 'block', marginBottom: '2px' }}>
                    Empreendedor Cadastrado
                  </span>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', lineHeight: 1.25 }}>
                    {record.nome || record.razaoSocial || record.nomeFantasia || 'Nome não informado'}
                  </div>
                  {record.nomeFantasia && (
                    <div style={{ fontSize: '12.5px', color: '#475569', marginTop: '2px' }}>
                      Nome Fantasia: <strong style={{ color: '#334155' }}>{record.nomeFantasia}</strong>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '6px 12px' }}>
                    <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>CPF / CNPJ</span>
                    <strong style={{ fontSize: '13.5px', color: '#0f172a', fontFamily: 'monospace' }}>
                      {formatCpfCnpjReadable(record.cpfCnpj) || record.cpfCnpj || '—'}
                    </strong>
                  </div>
                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '6px 12px' }}>
                    <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Tipo</span>
                    <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{record.tipoPessoa || 'Pessoa jurídica'}</strong>
                  </div>
                </div>
              </div>

              {activeTab === 'geral' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Grid de Identificação */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Nome / Razão Social</span>
                      <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>
                        {record.nome || record.razaoSocial || record.nomeFantasia || '—'}
                      </strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>CPF / CNPJ</span>
                      <strong style={{ fontSize: '13.5px', color: '#0f172a', fontFamily: 'monospace' }}>
                        {formatCpfCnpjReadable(record.cpfCnpj) || record.cpfCnpj || '—'}
                      </strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Tipo de Pessoa</span>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>{record.tipoPessoa || 'Pessoa jurídica'}</strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Nome Fantasia</span>
                      <strong style={{ fontSize: '13px', color: '#334155' }}>{record.nomeFantasia || '—'}</strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>E-mail Institucional</span>
                      <strong style={{ fontSize: '13px', color: '#334155', wordBreak: 'break-word' }}>{record.email || '—'}</strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Telefone de Contato</span>
                      <strong style={{ fontSize: '13px', color: '#334155' }}>{record.telefone || '—'}</strong>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Município / UF</span>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                        {record.municipio ? `${record.municipio}${record.uf ? `/${record.uf}` : ''}` : (record.uf || '—')}
                      </strong>
                      {record.municipioIbge && (
                        <span style={{ fontSize: '10.5px', color: '#64748b', display: 'block' }}>
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

                  {/* Atalho para Consulta Geoportal SEMA (CAR/Imóveis, Licenças e Autos) */}
                  {(record.cpfCnpj || record.nome || (empVinculos && (empVinculos.cars.length > 0 || empVinculos.coordenadas.length > 0))) && onOpenSemaDocs && (
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
                          Consulta Pública na Base da SEMA-MT:
                        </strong>
                        <span style={{ fontSize: '11px', color: '#475569' }}>
                          Consulte imóveis rurais no CAR/MT, licenças ambientais, notificações e autos de infração da SEMA-MT.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn soft small"
                        style={{ backgroundColor: '#0284c7', color: '#ffffff' }}
                        onClick={() => onOpenSemaDocs(record)}
                      >
                        🔍 Consultar CAR / Imóveis e Documentos SEMA
                      </button>
                    </div>
                  )}

                  {/* Resumo direto de Barragens Vinculadas e Imóveis na visão geral */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
                    <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>
                          Barragens Vinculadas ({empVinculos?.barragensVinculadas.length || 0})
                        </strong>
                        {empVinculos && empVinculos.cars.length > 0 && (
                          <span style={{ fontSize: '10.5px', color: '#0369a1', fontWeight: 600 }}>
                            {empVinculos.cars.length} CAR(s)
                          </span>
                        )}
                      </div>
                      {!empVinculos || empVinculos.barragensVinculadas.length === 0 ? (
                        <span style={{ fontSize: '12px', color: '#64748b' }}>Nenhuma barragem vinculada.</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {empVinculos.barragensVinculadas.map((bar: any, idx: number) =>
                            renderBarragemExpandableCard(bar, `emp-geral-dam-${bar.id || idx}`)
                          )}
                        </div>
                      )}
                    </div>

                    <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                      <strong style={{ fontSize: '12.5px', color: '#0f172a', display: 'block', marginBottom: '8px' }}>
                        Empreendimentos e Imóveis ({record.empreendimentos?.length || 0})
                      </strong>
                      {!record.empreendimentos || record.empreendimentos.length === 0 ? (
                        <span style={{ fontSize: '12px', color: '#64748b' }}>Nenhum empreendimento cadastrado diretamente.</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {record.empreendimentos.map((emp: any, idx: number) => {
                            const barragensDoCar = findBarragensMatchingCarString(emp.car, db.barragens);
                            const hasBarragem = barragensDoCar.length > 0;
                            const empExpandKey = `emp-geral-imovel-${emp.id || idx}`;
                            const isEmpOpen = Boolean(expandedCards[empExpandKey]);
                            return (
                              <div
                                key={emp.id || idx}
                                style={{
                                  padding: '8px 10px',
                                  background: hasBarragem ? '#f0fdf4' : '#f8fafc',
                                  borderRadius: '6px',
                                  border: hasBarragem ? '1.5px solid #059669' : '1px solid #e2e8f0',
                                  borderLeft: hasBarragem ? '5px solid #059669' : undefined,
                                  fontSize: '12px'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                  <strong style={{ color: '#0f172a' }}>{emp.nome || 'Imóvel'}</strong>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {hasBarragem && (
                                      <span
                                        style={{
                                          padding: '1px 6px',
                                          borderRadius: '4px',
                                          fontSize: '10px',
                                          fontWeight: 700,
                                          backgroundColor: '#059669',
                                          color: '#ffffff'
                                        }}
                                      >
                                        BARRAGEM NO CADASTRO ({barragensDoCar.length})
                                      </span>
                                    )}
                                    <span style={{ fontSize: '10.5px', color: '#64748b' }}>{emp.tipo || 'Rural'}</span>
                                    {hasBarragem && renderExpandArrowButton(empExpandKey, 'Ver barragens', 'Suprimir')}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '3px', color: '#475569', fontSize: '11.5px' }}>
                                  {emp.car && <span>CAR/MT: <strong style={{ color: hasBarragem ? '#065f46' : '#0369a1' }}>{emp.car}</strong></span>}
                                  {emp.escritura && <span>Escritura: <strong>{emp.escritura}</strong></span>}
                                  {emp.municipio && <span>{emp.municipio}{emp.uf ? `/${emp.uf}` : ''}</span>}
                                </div>
                                {hasBarragem && isEmpOpen && (
                                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {barragensDoCar.map((b: any, bIdx: number) =>
                                      renderBarragemExpandableCard(b, `${empExpandKey}-dam-${b.id || bIdx}`)
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Observações */}
                  <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600, marginBottom: '4px' }}>
                      Observações e Informações Complementares
                    </span>
                    <p style={{ margin: 0, fontSize: '12.5px', color: '#334155', whiteSpace: 'pre-wrap' }}>
                      {record.observacoes || 'Nenhuma observação informada.'}
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'vinculos' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  <div>
                    <h4 style={{ fontSize: '13px', margin: '0 0 10px', color: '#334155' }}>
                      Barragens Vinculadas ({empVinculos?.barragensVinculadas.length || 0})
                    </h4>
                    {!empVinculos || empVinculos.barragensVinculadas.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontSize: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        Nenhuma barragem vinculada a este empreendedor.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {empVinculos.barragensVinculadas.map((bar: any, i: number) =>
                          renderBarragemExpandableCard(bar, `emp-tab-dam-${bar.id || i}`)
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 style={{ fontSize: '13px', margin: '0 0 10px', color: '#334155' }}>
                      Empreendimentos e Imóveis Rurais Cadastrados ({record.empreendimentos?.length || 0})
                    </h4>
                    {(!record.empreendimentos || record.empreendimentos.length === 0) ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        Nenhum empreendimento ou imóvel rural vinculado diretamente a este empreendedor.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {record.empreendimentos.map((emp: any, i: number) => {
                          const barragensDoCar = findBarragensMatchingCarString(emp.car, db.barragens);
                          const hasBarragem = barragensDoCar.length > 0;
                          return (
                            <div
                              key={emp.id || i}
                              style={{
                                background: hasBarragem ? '#f0fdf4' : '#ffffff',
                                border: hasBarragem ? '1.5px solid #059669' : '1px solid #e2e8f0',
                                borderLeft: hasBarragem ? '5px solid #059669' : undefined,
                                borderRadius: '8px',
                                padding: '12px 14px'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                  {hasBarragem && (
                                    <span
                                      style={{
                                        padding: '2px 7px',
                                        borderRadius: '4px',
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        backgroundColor: '#059669',
                                        color: '#ffffff'
                                      }}
                                    >
                                      BARRAGEM NO NOSSO CADASTRO
                                    </span>
                                  )}
                                  <strong style={{ fontSize: '13px', color: '#0f172a' }}>{emp.nome}</strong>
                                  <span className="badge gray" style={{ fontSize: '10px' }}>{emp.tipo || 'Rural'}</span>
                                </div>
                                <span style={{ fontSize: '11px', color: '#64748b' }}>
                                  {emp.municipio ? `${emp.municipio}${emp.uf ? `/${emp.uf}` : ''}` : '—'}
                                </span>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', marginTop: '8px', fontSize: '12px' }}>
                                <div>
                                  <span style={{ color: '#64748b' }}>CAR/MT: </span>
                                  <strong style={{ fontFamily: 'monospace', color: hasBarragem ? '#065f46' : undefined }}>{emp.car || '—'}</strong>
                                </div>
                                <div>
                                  <span style={{ color: '#64748b' }}>Matrícula / Escritura: </span>
                                  <span>{emp.escritura || '—'}</span>
                                </div>
                              </div>
                              {hasBarragem && (
                                <div style={{ marginTop: '6px', fontSize: '11.5px', color: '#065f46', fontWeight: 600 }}>
                                  Barragem(ns) cadastrada(s): {barragensDoCar.map((b: any) => b.nome || b.nomeBarragem || 'Barragem').join(', ')}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
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

                  {/* Características de Segurança, Dimensões e Classificação */}
                  {(() => {
                    const criVal = record.categoriaRisco || record.cri || '';
                    const dpaVal = record.danoPotencial || record.dpa || '';
                    const hasDpaClassificada = Boolean(
                      dpaVal && String(dpaVal).trim() !== '' && String(dpaVal).trim() !== 'Não classificada'
                    );
                    const alturaDisplay =
                      record.altura !== undefined && record.altura !== null && String(record.altura).trim() !== ''
                        ? `${record.altura} m`
                        : 'Não informada';
                    const volumeDisplay =
                      record.volume !== undefined && record.volume !== null && String(record.volume).trim() !== ''
                        ? `${record.volume} m³`
                        : 'Não informado';
                    const rtsDaBarragem = getRtsForDam(record);
                    const vinculosOpen = Boolean(expandedCards['dam-vinculos-integrados']);

                    return (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                            <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Altura do Maciço</span>
                            <span style={{ fontSize: '13.5px', color: '#0f172a', fontWeight: 700 }}>
                              {alturaDisplay}
                            </span>
                          </div>

                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                            <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Volume do Reservatório</span>
                            <span style={{ fontSize: '13.5px', color: '#0f172a', fontWeight: 700 }}>
                              {volumeDisplay}
                            </span>
                          </div>

                          <div
                            style={{
                              background: hasDpaClassificada
                                ? dpaVal === 'Alto'
                                  ? '#fef2f2'
                                  : dpaVal === 'Médio'
                                  ? '#fffbeb'
                                  : '#f0fdf4'
                                : '#f8fafc',
                              padding: '10px 12px',
                              borderRadius: '8px',
                              border: hasDpaClassificada ? '1px solid #94a3b8' : '1px solid #cbd5e1'
                            }}
                          >
                            <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Dano Potencial Associado (DPA)</span>
                            <span
                              className={`badge ${
                                hasDpaClassificada
                                  ? dpaVal === 'Alto'
                                    ? 'red'
                                    : dpaVal === 'Médio'
                                    ? 'amber'
                                    : 'green'
                                  : 'gray'
                              }`}
                              style={{ marginTop: '3px' }}
                            >
                              {hasDpaClassificada ? `${dpaVal} (Classificada)` : 'Não classificada'}
                            </span>
                          </div>

                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Categoria de Risco (CRI)</span>
                            <span
                              className={`badge ${
                                criVal === 'Alto' ? 'red' : criVal === 'Médio' ? 'amber' : criVal ? 'green' : 'gray'
                              }`}
                              style={{ marginTop: '3px' }}
                            >
                              {criVal || 'Não classificada'}
                            </span>
                          </div>
                        </div>

                        {/* Vínculos integrados (RTs + Documentos emitidos) inicialmente suprimidos */}
                        <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <strong style={{ fontSize: '12px', color: '#0f172a' }}>
                              Vínculos Integrados: {rtsDaBarragem.length} RT(s) · {docsBarragem.length} Documento(s) Emitido(s)
                            </strong>
                            {renderExpandArrowButton('dam-vinculos-integrados', 'Expandir vínculos e documentos', 'Suprimir')}
                          </div>
                          {vinculosOpen && (
                            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed #cbd5e1', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div>
                                <strong style={{ fontSize: '11px', color: '#0369a1', display: 'block', marginBottom: '4px' }}>
                                  Responsáveis Técnicos ({rtsDaBarragem.length})
                                </strong>
                                {rtsDaBarragem.length === 0 ? (
                                  <span style={{ fontSize: '11.5px', color: '#64748b' }}>Nenhum responsável técnico vinculado.</span>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {rtsDaBarragem.map((r, rIdx) => (
                                      <div key={rIdx} style={{ fontSize: '11.5px', color: '#0f172a', background: '#f8fafc', padding: '5px 8px', borderRadius: '5px', border: '1px solid #e2e8f0' }}>
                                        <strong>{r.nome}</strong>
                                        {r.art && <span> · ART: <b>{r.art}</b></span>}
                                        {r.validade && <span> · Validade: {formatDataIso(r.validade)}</span>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div>
                                <strong style={{ fontSize: '11px', color: '#0369a1', display: 'block', marginBottom: '4px' }}>
                                  Documentos Emitidos ({docsBarragem.length})
                                </strong>
                                {docsBarragem.length === 0 ? (
                                  <span style={{ fontSize: '11.5px', color: '#64748b' }}>Nenhum documento emitido localizado para esta barragem.</span>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {docsBarragem.map((doc: any, dIdx: number) => (
                                      <div key={doc.id || dIdx} style={{ fontSize: '11.5px', color: '#0f172a', background: '#f0f9ff', padding: '5px 8px', borderRadius: '5px', border: '1px solid #bae6fd' }}>
                                        <strong>[{doc.tipo}]</strong> {doc.numero ? `${doc.titulo} · Nº ${doc.numero}` : doc.titulo}
                                        {doc.dataEmissao ? ` · ${formatDataIso(doc.dataEmissao)}` : ''}
                                        {doc.situacao ? ` · ${doc.situacao}` : ''}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}

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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <ConferenciaDocumentosPanel
                    compact
                    criteria={{
                      barragemId: record.id ? String(record.id) : undefined,
                      empreendedorId: linkedEmpObj?.id ? String(linkedEmpObj.id) : undefined,
                      processo: record.processo ? String(record.processo) : undefined,
                      carMt: record.car ? String(record.car) : undefined
                    }}
                    commonData={{
                      empreendedores: db.empreendedores || [],
                      barragens: db.barragens || [],
                      rts: db.rts || []
                    }}
                  />
                  <h4 style={{ fontSize: '13px', margin: '0 0 4px', color: '#334155' }}>
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
                  {(() => {
                    const rtVinculos = Array.isArray(record.vinculos) && record.vinculos.length > 0
                      ? record.vinculos
                      : [{
                          id: 'rt-vinculo-principal',
                          art: record.art || record.artRrt,
                          barragemId: record.barragemId || record.barragemVinculada,
                          barragemNome: record.barragemVinculada || record.nomeBarragem,
                          validade: record.validade
                        }];

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {rtVinculos.map((v: any, i: number) => {
                          const targetId = String(v.barragemId || '').trim();
                          const targetName = String(v.barragemNome || v.nomeBarragem || v.barragemVinculada || '').trim().toLowerCase();
                          const matchedDam = (db.barragens || []).find((b: any) =>
                            (targetId && String(b.id) === targetId) ||
                            (targetName && String(b.nome || '').trim().toLowerCase() === targetName)
                          );
                          return (
                            <div key={v.id || i} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                <div>
                                  <span className="badge blue" style={{ fontSize: '10px' }}>ART: {v.art || 'Não informada'}</span>
                                  <strong style={{ fontSize: '13px', color: '#0f172a', marginLeft: '8px' }}>
                                    {v.barragemNome || v.nomeBarragem || v.barragemVinculada || matchedDam?.nome || 'Barragem vinculada'}
                                  </strong>
                                </div>
                                <span style={{ fontSize: '11px', color: '#64748b' }}>
                                  {v.validade ? `Validade: ${formatDataIso(v.validade)}` : ''}
                                </span>
                              </div>
                              {v.tipoVinculo && (
                                <div style={{ fontSize: '11.5px', color: '#475569' }}>
                                  Tipo de atuação: <strong>{v.tipoVinculo}</strong>
                                </div>
                              )}
                              {matchedDam && renderBarragemExpandableCard(matchedDam, `rt-dam-${matchedDam.id || i}`)}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
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
        <div className="modal-foot" style={{ borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ fontSize: '11px', color: '#64748b' }}>
            Somente leitura · Para realizar alterações, utilize o botão Editar.
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" className="btn light" onClick={onClose}>
              Fechar
            </button>
            {moduleKey === 'barragens' && canSolicitarVistoria && onSolicitarVistoria && (
              <button
                type="button"
                className="btn soft"
                onClick={() => onSolicitarVistoria(record)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <span>◈</span> Solicitar vistoria
              </button>
            )}
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
