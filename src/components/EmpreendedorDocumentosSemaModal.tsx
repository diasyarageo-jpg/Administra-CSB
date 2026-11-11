// src/components/EmpreendedorDocumentosSemaModal.tsx
import React, { useState, useEffect } from 'react';
import { consultarDocumentosSema } from '../services/carLookupService';
import { SemaDocumentosGroupedResult, SemaDocumentoItem } from '../types/carLookup';

interface EmpreendedorDocumentosSemaModalProps {
  empreendedor: any;
  onClose: () => void;
}

export function EmpreendedorDocumentosSemaModal({
  empreendedor,
  onClose
}: EmpreendedorDocumentosSemaModalProps) {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [data, setData] = useState<SemaDocumentosGroupedResult | null>(null);
  const [activeTab, setActiveTab] = useState<'licencas' | 'notificacoes' | 'autos' | 'embargos' | 'car'>('licencas');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  const cleanCpfCnpj = String(empreendedor?.cpfCnpj || '').replace(/\D/g, '');

  useEffect(() => {
    if (!cleanCpfCnpj) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    consultarDocumentosSema(cleanCpfCnpj)
      .then(res => {
        setData(res);
        if (res.licencas.length > 0) setActiveTab('licencas');
        else if (res.notificacoes.length > 0) setActiveTab('notificacoes');
        else if (res.autosInfracao.length > 0) setActiveTab('autos');
        else if (res.termosEmbargo.length > 0) setActiveTab('embargos');
        else setActiveTab('car');
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [cleanCpfCnpj]);

  const renderDocumentList = (items: SemaDocumentoItem[], emptyMsg: string) => {
    if (items.length === 0) {
      return (
        <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
          {emptyMsg}
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {items.map(item => {
          const isExpanded = expandedItemId === item.id;
          return (
            <div
              key={item.id}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px 14px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="badge blue" style={{ fontSize: '10px' }}>{item.tipo}</span>
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                      Nº {item.numeroDocumento}
                    </strong>
                    {item.status && (
                      <span className={`badge ${item.status.toLowerCase().includes('defer') ? 'green' : 'gray'}`} style={{ fontSize: '10px' }}>
                        {item.status}
                      </span>
                    )}
                  </div>
                  {item.nomeDocumento && item.nomeDocumento !== item.tipo && (
                    <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                      {item.nomeDocumento}
                    </div>
                  )}
                </div>

                <div style={{ fontSize: '11px', color: '#64748b', textAlign: 'right' }}>
                  <div>Data: <strong>{item.dataDocumento}</strong></div>
                  {item.dataValidade && <div>Validade: {item.dataValidade}</div>}
                </div>
              </div>

              <div style={{ marginTop: '8px', fontSize: '12px', color: '#334155', display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
                {item.numeroProcesso && (
                  <div>
                    <span style={{ color: '#64748b' }}>Processo: </span>
                    <strong>{item.numeroProcesso}</strong>
                  </div>
                )}
                {item.municipio && (
                  <div>
                    <span style={{ color: '#64748b' }}>Município: </span>
                    {item.municipio}
                  </div>
                )}
                <div>
                  <span style={{ color: '#64748b' }}>Camada: </span>
                  <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{item.camadaOrigem.replace('Geoportal:', '')}</span>
                </div>
              </div>

              <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  {item.linkDocumento && (
                    <a
                      href={item.linkDocumento}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn light"
                      style={{ fontSize: '11px', padding: '3px 8px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <span>↗</span> Acessar documento original
                    </a>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                  style={{ background: 'none', border: 'none', color: '#0369a1', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}
                >
                  {isExpanded ? 'Ocultar propriedades brutas' : 'Ver propriedades brutas'}
                </button>
              </div>

              {isExpanded && (
                <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '11px' }}>
                  <strong style={{ display: 'block', marginBottom: '6px', color: '#475569' }}>
                    Propriedades brutas retornadas pelo Geoportal:
                  </strong>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '180px', overflowY: 'auto' }}>
                    {JSON.stringify(item.propriedadesBrutas, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(820px, 100%)' }}>
        <div className="modal-head">
          <div>
            <h3>Registros e Documentos SEMA-MT · Geoportal</h3>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {empreendedor?.nome} · CPF/CNPJ: {empreendedor?.cpfCnpj || 'Não informado'}
            </span>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '76vh', overflowY: 'auto' }}>
          {!cleanCpfCnpj ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#b45309', backgroundColor: '#fffbeb', borderRadius: '8px' }}>
              ⚠️ Este empreendedor não possui CPF ou CNPJ válido cadastrado. A consulta oficial ao Geoportal da SEMA-MT requer um documento com dígitos válidos.
            </div>
          ) : isLoading ? (
            <div style={{ textAlign: 'center', padding: '36px 10px' }}>
              <div style={{ fontSize: '28px', marginBottom: '10px' }}>🔍</div>
              <strong style={{ fontSize: '14px', color: '#0369a1', display: 'block', marginBottom: '6px' }}>
                Consultando camadas oficiais da SEMA-MT...
              </strong>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Pesquisando licenças, notificações e autos de infração para o documento informado.
              </span>
            </div>
          ) : (
            <div>
              {/* Resumo da consulta */}
              <div style={{
                padding: '10px 14px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                marginBottom: '14px',
                fontSize: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                <div>
                  <strong>Status: </strong>
                  <span>{data?.mensagemStatus}</span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  Consulta realizada em {data?.consultadoEm ? new Date(data.consultadoEm).toLocaleString('pt-BR') : '—'}
                </div>
              </div>

              {/* Abas por Categoria */}
              <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: '14px', gap: '4px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`btn light ${activeTab === 'licencas' ? 'green' : ''}`}
                  onClick={() => setActiveTab('licencas')}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  Licenças ({data?.licencas.length || 0})
                </button>
                <button
                  type="button"
                  className={`btn light ${activeTab === 'notificacoes' ? 'green' : ''}`}
                  onClick={() => setActiveTab('notificacoes')}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  Notificações ({data?.notificacoes.length || 0})
                </button>
                <button
                  type="button"
                  className={`btn light ${activeTab === 'autos' ? 'green' : ''}`}
                  onClick={() => setActiveTab('autos')}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  Autos de Infração ({data?.autosInfracao.length || 0})
                </button>
                <button
                  type="button"
                  className={`btn light ${activeTab === 'embargos' ? 'green' : ''}`}
                  onClick={() => setActiveTab('embargos')}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  Termos de Embargo ({data?.termosEmbargo.length || 0})
                </button>
                <button
                  type="button"
                  className={`btn light ${activeTab === 'car' ? 'green' : ''}`}
                  onClick={() => setActiveTab('car')}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  CAR / Imóveis
                </button>
              </div>

              {/* Conteúdo da Aba */}
              {activeTab === 'licencas' &&
                renderDocumentList(
                  data?.licencas || [],
                  'Nenhuma licença ambiental (LP, LI, LO) localizada nas camadas consultadas para este CPF/CNPJ.'
                )}

              {activeTab === 'notificacoes' &&
                renderDocumentList(
                  data?.notificacoes || [],
                  'Nenhuma notificação de fiscalização localizada para este CPF/CNPJ.'
                )}

              {activeTab === 'autos' &&
                renderDocumentList(
                  data?.autosInfracao || [],
                  'Nenhum auto de infração localizado para este CPF/CNPJ.'
                )}

              {activeTab === 'embargos' &&
                renderDocumentList(
                  data?.termosEmbargo || [],
                  'Nenhum termo de embargo localizado para este CPF/CNPJ.'
                )}

              {activeTab === 'car' && (
                <div style={{ padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12.5px', lineHeight: '1.5', color: '#334155' }}>
                  <div style={{ fontWeight: 600, color: '#0369a1', marginBottom: '6px' }}>
                    ℹ️ Consulta de Imóveis no CAR/ATP (SEMA-MT):
                  </div>
                  <p style={{ margin: '0 0 10px 0' }}>
                    A camada oficial <code>Geoportal:CAR_ATP</code> da SEMA-MT publica os registros de proprietários com documento anonimizado/mascarado (ex: <code>XXX492578XX</code>), sem disponibilizar atributo para busca exata por CPF/CNPJ desmascarado.
                  </p>
                  <p style={{ margin: 0 }}>
                    Para localizar e vincular imóveis do CAR a barragens, utilize a consulta espacial por <strong>coordenadas geográficas GMS</strong> diretamente no formulário de cadastro de cada barragem.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn light" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
