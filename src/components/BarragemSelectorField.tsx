// src/components/BarragemSelectorField.tsx
// Seletor reutilizável, pesquisável e paginado de barragens para todos os formulários do sistema.
// Não altera cadastros mestres durante a seleção e explicita estados de vínculo e coordenadas.

import React, { useEffect, useMemo, useState } from 'react';
import {
  BarragemSearchEntry,
  evaluateBarragemVinculoStatus,
  evaluateDamCoordinates,
  searchAndPrioritizeBarragens
} from '../utils/vinculoStatus';

interface CommonSelectorProps {
  barragens: any[];
  empreendedores: any[];
  prioritizeEmpreendedorId?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  pageSize?: number;
  allowEmptyOption?: boolean;
  emptyOptionLabel?: string;
  onInspectConferencia?: (dam: any) => void;
}

export type BarragemSelectorSingleProps = CommonSelectorProps & {
  multiple?: false;
  value: string;
  onChange: (barragemId: string, damRaw?: any) => void;
};

export type BarragemSelectorMultipleProps = CommonSelectorProps & {
  multiple: true;
  selectedIds: string[];
  onChangeMultiple: (barragemIds: string[], selectedDams: any[]) => void;
};

export type BarragemSelectorFieldProps =
  | BarragemSelectorSingleProps
  | BarragemSelectorMultipleProps;

export const BarragemSelectorField: React.FC<BarragemSelectorFieldProps> = props => {
  const {
    barragens,
    empreendedores,
    prioritizeEmpreendedorId,
    label,
    placeholder = 'Buscar por nome, SNISB, CAR, município ou ID...',
    required = false,
    disabled = false,
    pageSize = 6,
    allowEmptyOption = true,
    emptyOptionLabel = 'Sem vínculo direto',
    onInspectConferencia
  } = props;

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [isOpen, setIsOpen] = useState(false);

  const selectedIdSet = useMemo(() => {
    if (props.multiple) {
      return new Set((props.selectedIds || []).map(v => String(v).trim()).filter(Boolean));
    }
    const single = String(props.value || '').trim();
    return single ? new Set([single]) : new Set<string>();
  }, [props]);

  useEffect(() => {
    setPage(1);
  }, [query, prioritizeEmpreendedorId]);

  const searchResult = useMemo(
    () =>
      searchAndPrioritizeBarragens(barragens, empreendedores, {
        query,
        prioritizeEmpreendedorId,
        page,
        pageSize
      }),
    [barragens, empreendedores, query, prioritizeEmpreendedorId, page, pageSize]
  );

  const selectedSummaries = useMemo(() => {
    const out: Array<{
      id: string;
      nome: string;
      municipio: string;
      snisb: string;
      car: string;
      vinculoLabel: string;
      badgeClass: 'green' | 'amber' | 'gray';
      coordsAvailable: boolean;
      raw?: any;
    }> = [];

    for (const id of selectedIdSet) {
      const found = (barragens || []).find(b => String(b?.id || '').trim() === id);
      if (found) {
        const vinc = evaluateBarragemVinculoStatus(found, empreendedores, prioritizeEmpreendedorId);
        const coords = evaluateDamCoordinates(found);
        out.push({
          id,
          nome: String(found.nome || found.name || id),
          municipio: String(found.municipio || '—'),
          snisb: String(found.snisb || '—'),
          car: String(found.car || '—'),
          vinculoLabel: vinc.shortLabel,
          badgeClass: vinc.badgeClass,
          coordsAvailable: coords.available,
          raw: found
        });
      } else {
        out.push({
          id,
          nome: `${id} (Identificação mantida)`,
          municipio: '—',
          snisb: '—',
          car: '—',
          vinculoLabel: 'Vínculo pendente de revisão',
          badgeClass: 'amber',
          coordsAvailable: false
        });
      }
    }

    return out;
  }, [selectedIdSet, barragens, empreendedores, prioritizeEmpreendedorId]);

  const handleToggleEntry = (entry: BarragemSearchEntry) => {
    if (disabled) return;
    if (props.multiple) {
      const nextSet = new Set(selectedIdSet);
      if (nextSet.has(entry.id)) {
        nextSet.delete(entry.id);
      } else {
        nextSet.add(entry.id);
      }
      const nextIds = Array.from(nextSet);
      const nextRaw = nextIds
        .map(id => (barragens || []).find(b => String(b?.id || '').trim() === id))
        .filter(Boolean);
      props.onChangeMultiple(nextIds, nextRaw);
    } else {
      props.onChange(entry.id, entry.raw);
      setIsOpen(false);
    }
  };

  const handleClearSingle = () => {
    if (disabled || props.multiple) return;
    props.onChange('', undefined);
  };

  const handleRemoveMulti = (id: string) => {
    if (disabled || !props.multiple) return;
    const nextIds = Array.from(selectedIdSet).filter(item => item !== id);
    const nextRaw = nextIds
      .map(itemId => (barragens || []).find(b => String(b?.id || '').trim() === itemId))
      .filter(Boolean);
    props.onChangeMultiple(nextIds, nextRaw);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {label && (
        <label style={{ fontSize: '11px', fontWeight: 700, color: '#334155' }}>
          {label}
          {required ? ' *' : ''}
        </label>
      )}

      {/* Resumo da seleção atual */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap',
          padding: '8px 10px',
          borderRadius: '8px',
          border: '1px solid #cbd5e1',
          background: disabled ? '#f1f5f9' : '#ffffff'
        }}
      >
        <div style={{ flex: 1, minWidth: '180px' }}>
          {selectedSummaries.length === 0 ? (
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {props.multiple ? 'Nenhuma barragem selecionada' : emptyOptionLabel}
            </span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {selectedSummaries.map(sel => (
                <div
                  key={sel.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px',
                    flexWrap: 'wrap',
                    padding: props.multiple ? '4px 6px' : '0',
                    background: props.multiple ? '#f8fafc' : 'transparent',
                    borderRadius: '6px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '12px', color: '#0f172a' }}>{sel.nome}</strong>
                    <span className="micro muted">
                      {sel.municipio !== '—' ? `${sel.municipio} · ` : ''}
                      {sel.snisb !== '—' ? `SNISB ${sel.snisb} · ` : ''}
                      {sel.car !== '—' ? `CAR ${sel.car}` : `ID ${sel.id}`}
                    </span>
                    <span className={`badge ${sel.badgeClass}`}>{sel.vinculoLabel}</span>
                    {!sel.coordsAvailable && (
                      <span className="badge gray">Coordenadas indisponíveis</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {onInspectConferencia && sel.raw && (
                      <button
                        type="button"
                        className="iconbtn"
                        onClick={() => onInspectConferencia(sel.raw)}
                        title="Conferir documentos relacionados a esta barragem"
                      >
                        Docs
                      </button>
                    )}
                    {!disabled && props.multiple && (
                      <button
                        type="button"
                        className="iconbtn"
                        onClick={() => handleRemoveMulti(sel.id)}
                        title="Remover barragem selecionada"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {!disabled && !props.multiple && selectedSummaries.length > 0 && allowEmptyOption && (
            <button type="button" className="btn light small" onClick={handleClearSingle}>
              Limpar
            </button>
          )}
          {!disabled && (
            <button
              type="button"
              className="btn soft small"
              onClick={() => setIsOpen(prev => !prev)}
            >
              {isOpen ? 'Ocultar lista' : props.multiple ? 'Selecionar barragens' : 'Buscar barragem'}
            </button>
          )}
        </div>
      </div>

      {/* Painel pesquisável e paginado */}
      {isOpen && !disabled && (
        <div
          style={{
            border: '1px solid #cbd5e1',
            borderRadius: '10px',
            background: '#f8fafc',
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="input"
              style={{ flex: 1, minWidth: '220px', background: '#ffffff' }}
              placeholder={placeholder}
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {!props.multiple && allowEmptyOption && (
              <button
                type="button"
                className="btn light small"
                onClick={() => {
                  props.onChange('', undefined);
                  setIsOpen(false);
                }}
              >
                {emptyOptionLabel}
              </button>
            )}
          </div>

          {prioritizeEmpreendedorId && (
            <div className="micro muted">
              Priorizando barragens com vínculo oficial ao empreendedor selecionado (
              {searchResult.linkedToSelectedCount}). Estruturas sem vínculo continuam pesquisáveis
              como pendentes de revisão.
            </div>
          )}

          {searchResult.items.length === 0 ? (
            <div className="notice slate">
              Nenhuma barragem encontrada para “{query}”.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {searchResult.items.map(entry => {
                const isSelected = selectedIdSet.has(entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => handleToggleEntry(entry)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: isSelected ? '1.5px solid #047857' : '1px solid #e2e8f0',
                      background: isSelected ? '#ecfdf5' : '#ffffff',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '3px'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap'
                      }}
                    >
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                        {props.multiple ? (isSelected ? '☑ ' : '☐ ') : isSelected ? '● ' : ''}
                        {entry.nome}
                      </span>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        <span className={`badge ${entry.vinculo.badgeClass}`}>
                          {entry.vinculo.shortLabel}
                        </span>
                        {!entry.coordenadas.available && (
                          <span className="badge gray">Coordenadas indisponíveis</span>
                        )}
                      </div>
                    </div>
                    <div className="micro muted" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                      <span>Município: {entry.municipio || 'Não informado'}</span>
                      <span>SNISB: {entry.snisb || '—'}</span>
                      <span>CAR: {entry.car || '—'}</span>
                      <span>
                        Empreendedor: {entry.vinculo.officialEmpreendedorNome || 'Não vinculado'}
                      </span>
                      <span>ID: {entry.id}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Paginação */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
              paddingTop: '4px',
              borderTop: '1px solid #e2e8f0',
              fontSize: '11px',
              color: '#475569'
            }}
          >
            <span>
              {searchResult.allMatchedCount} estrutura(s) · Página {searchResult.safePage} de{' '}
              {searchResult.totalPages}
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="btn light small"
                disabled={searchResult.safePage <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                className="btn light small"
                disabled={searchResult.safePage >= searchResult.totalPages}
                onClick={() => setPage(p => Math.min(searchResult.totalPages, p + 1))}
              >
                Próxima
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
