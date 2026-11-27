// src/components/ConferenciaDocumentosModal.tsx
// Conferência contextual leve e sob demanda de documentos e origem relacionados
// a uma barragem, empreendedor, empreendimento ou processo (não bloqueia ações).

import React, { useEffect, useState } from 'react';
import {
  AdministraCommonData,
  carregarCatalogoDocumentos,
  ConferenciaDocumentoCriteria,
  ConferenciaDocumentosResult,
  verificarDocumentosRelacionadosEntidade
} from '../services/documentosService';
import { DocumentoCatalogoItem } from '../types/documentos';

interface ConferenciaDocumentosPanelProps {
  criteria: ConferenciaDocumentoCriteria;
  commonData: AdministraCommonData;
  documentosPreCarregados?: DocumentoCatalogoItem[];
  titulo?: string;
  compact?: boolean;
}

export const ConferenciaDocumentosPanel: React.FC<ConferenciaDocumentosPanelProps> = ({
  criteria,
  commonData,
  documentosPreCarregados,
  titulo = 'Conferência contextual de documentos relacionados',
  compact = false
}) => {
  const [loading, setLoading] = useState(false);
  const [checkedOnce, setCheckedOnce] = useState(false);
  const [result, setResult] = useState<ConferenciaDocumentosResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hasCriteria = Boolean(
    criteria.barragemId ||
      criteria.empreendedorId ||
      criteria.empreendimentoId ||
      criteria.processo ||
      criteria.carMt
  );

  const executarConferencia = async () => {
    if (!hasCriteria) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      let baseDocs = documentosPreCarregados;
      if (!baseDocs) {
        const res = await carregarCatalogoDocumentos(commonData);
        baseDocs = res.documentos || [];
      }
      const checked = verificarDocumentosRelacionadosEntidade(baseDocs, criteria);
      setResult(checked);
      setCheckedOnce(true);
    } catch (err: any) {
      setErrorMsg(
        err?.message || 'Não foi possível consultar documentos no momento; você pode prosseguir normalmente.'
      );
      setCheckedOnce(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setResult(null);
    setCheckedOnce(false);
    setErrorMsg(null);
    if (hasCriteria && documentosPreCarregados) {
      setResult(verificarDocumentosRelacionadosEntidade(documentosPreCarregados, criteria));
      setCheckedOnce(true);
    }
  }, [
    criteria.barragemId,
    criteria.empreendedorId,
    criteria.empreendimentoId,
    criteria.processo,
    criteria.carMt
  ]);

  if (!hasCriteria) return null;

  return (
    <div
      style={{
        padding: compact ? '10px 12px' : '12px 14px',
        borderRadius: '10px',
        border: '1px solid #cbd5e1',
        background: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap'
        }}
      >
        <div>
          <strong style={{ fontSize: '12px', color: '#0f172a' }}>{titulo}</strong>
          <div className="micro muted">
            Consulta informativa sob demanda por IDs estáveis e processo; não impede salvar nem enviar.
          </div>
        </div>
        <button
          type="button"
          className="btn light small"
          onClick={executarConferencia}
          disabled={loading}
        >
          {loading ? 'Conferindo...' : checkedOnce ? 'Atualizar conferência' : 'Conferir documentos agora'}
        </button>
      </div>

      {errorMsg && <div className="notice amber">{errorMsg}</div>}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11.5px' }}>
          <div className="notice slate">{result.resumoTexto}</div>

          {result.confirmadosPorId.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#047857' }}>
                Confirmados por ID estável / processo ({result.confirmadosPorId.length})
              </span>
              {result.confirmadosPorId.slice(0, 5).map(doc => (
                <div
                  key={doc.id}
                  style={{
                    padding: '6px 8px',
                    borderRadius: '6px',
                    background: '#ffffff',
                    border: '1px solid #bbf7d0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '8px',
                    flexWrap: 'wrap'
                  }}
                >
                  <div>
                    <b>{doc.titulo}</b>{' '}
                    {doc.numero ? <span className="muted">Nº {doc.numero}</span> : null}
                    <div className="micro muted">
                      Origem: {doc.origemSistema} · Emissão: {doc.dataEmissao || '—'} ·{' '}
                      {doc.situacao}
                    </div>
                  </div>
                  <span className="badge green">Vínculo oficial</span>
                </div>
              ))}
            </div>
          )}

          {result.candidatosPendentes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#b45309' }}>
                Sugestões por CAR compartilhado — pendentes de confirmação ({result.candidatosPendentes.length})
              </span>
              {result.candidatosPendentes.slice(0, 4).map(doc => (
                <div
                  key={doc.id}
                  style={{
                    padding: '6px 8px',
                    borderRadius: '6px',
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '8px',
                    flexWrap: 'wrap'
                  }}
                >
                  <div>
                    <b>{doc.titulo}</b>{' '}
                    {doc.numero ? <span className="muted">Nº {doc.numero}</span> : null}
                    <div className="micro muted">
                      Origem: {doc.origemSistema} · CAR: {doc.carMt || '—'} · Não confirmado por ID
                    </div>
                  </div>
                  <span className="badge amber">Pendente de revisão</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface ConferenciaDocumentosModalProps {
  open: boolean;
  onClose: () => void;
  entityTitle: string;
  criteria: ConferenciaDocumentoCriteria;
  commonData: AdministraCommonData;
  documentosPreCarregados?: DocumentoCatalogoItem[];
  onContinueAction?: () => void;
  continueLabel?: string;
}

export const ConferenciaDocumentosModal: React.FC<ConferenciaDocumentosModalProps> = ({
  open,
  onClose,
  entityTitle,
  criteria,
  commonData,
  documentosPreCarregados,
  onContinueAction,
  continueLabel = 'Continuar mesmo assim'
}) => {
  if (!open) return null;

  return (
    <div
      className="modal-back"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ width: 'min(680px, 100%)' }}>
        <div className="modal-head">
          <div>
            <h3>Conferência contextual de documentos</h3>
            <span className="micro muted">{entityTitle}</span>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <ConferenciaDocumentosPanel
            criteria={criteria}
            commonData={commonData}
            documentosPreCarregados={documentosPreCarregados}
          />
        </div>
        <div className="modal-foot">
          <button type="button" className="btn light" onClick={onClose}>
            Fechar
          </button>
          {onContinueAction && (
            <button
              type="button"
              className="btn green"
              onClick={() => {
                onClose();
                onContinueAction();
              }}
            >
              {continueLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
