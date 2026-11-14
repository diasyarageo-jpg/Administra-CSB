// src/components/SemaCadastroLookupPanel.tsx
import React, { useState, useEffect } from 'react';
import { consultarDocumentosSema } from '../services/carLookupService';
import {
  SemaDocumentoItem,
  SemaDocumentosGroupedResult
} from '../types/carLookup';
import {
  formatCpfCnpjReadable,
  formatSemaPropertiesEntries,
  stripOuterQuotesAndBrackets
} from '../config/carCampos';

export type SemaLookupMode = 'cpf' | 'cnpj' | 'car';

export interface SemaSearchMeta {
  mode: SemaLookupMode;
  rawQuery: string;
  queryDigits: string;
}

export interface SemaCampoComparacao {
  key: string;
  label: string;
  currentValue: string;
  currentDisplay?: string;
  semaValue: string;
  semaDisplay?: string;
  isEqual?: boolean;
  payload?: any;
}

interface SemaCadastroLookupPanelProps {
  entityLabel: string;
  isNew: boolean;
  allowCar?: boolean;
  defaultMode?: SemaLookupMode;
  defaultQuery?: string;
  buildComparisons: (
    item: SemaDocumentoItem,
    meta: SemaSearchMeta
  ) => SemaCampoComparacao[];
  onApplyFields: (
    selectedFields: Record<string, SemaCampoComparacao>,
    item: SemaDocumentoItem,
    meta: SemaSearchMeta
  ) => void;
}

function formatCpfInput(val: string): string {
  const d = val.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatCnpjInput(val: string): string {
  const d = val.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function normalizeTextCompare(val: string): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function SemaCadastroLookupPanel({
  entityLabel,
  isNew,
  allowCar = false,
  defaultMode = 'cpf',
  defaultQuery = '',
  buildComparisons,
  onApplyFields
}: SemaCadastroLookupPanelProps) {
  const resolveInitialMode = (): SemaLookupMode => {
    if (defaultMode === 'car' && allowCar) return 'car';
    const digits = String(defaultQuery || '').replace(/\D/g, '');
    if (digits.length === 14) return 'cnpj';
    if (digits.length === 11) return 'cpf';
    return defaultMode === 'car' && !allowCar ? 'cpf' : defaultMode;
  };

  const [mode, setMode] = useState<SemaLookupMode>(resolveInitialMode);
  const [query, setQuery] = useState<string>(() => {
    const initialMode = resolveInitialMode();
    if (initialMode === 'cpf') return formatCpfInput(defaultQuery);
    if (initialMode === 'cnpj') return formatCnpjInput(defaultQuery);
    return String(defaultQuery || '').trim();
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [result, setResult] = useState<SemaDocumentosGroupedResult | null>(null);
  const [allItems, setAllItems] = useState<SemaDocumentoItem[]>([]);
  const [selectedItemIdx, setSelectedItemIdx] = useState<number>(0);
  const [lastMeta, setLastMeta] = useState<SemaSearchMeta | null>(null);

  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>({});
  const [decisionStatus, setDecisionStatus] = useState<string | null>(null);
  const [panelDismissed, setPanelDismissed] = useState<boolean>(false);
  const [showEmptySemaProps, setShowEmptySemaProps] = useState<boolean>(false);

  const selectedItem = allItems[selectedItemIdx] || null;

  const computeComparisons = (
    item: SemaDocumentoItem | null,
    meta: SemaSearchMeta | null
  ): SemaCampoComparacao[] => {
    if (!item || !meta) return [];
    return buildComparisons(item, meta).filter(c => String(c.semaValue || '').trim() !== '');
  };

  const initSelectionForItem = (
    item: SemaDocumentoItem | null,
    meta: SemaSearchMeta | null
  ) => {
    const comps = computeComparisons(item, meta);
    const nextChecked: Record<string, boolean> = {};
    for (const c of comps) {
      const hasCurrent = Boolean(String(c.currentValue || '').trim());
      const equal =
        c.isEqual !== undefined
          ? c.isEqual
          : hasCurrent && normalizeTextCompare(c.currentValue) === normalizeTextCompare(c.semaValue);
      // Campos vazios no sistema vêm pré-marcados para facilitar o Novo Cadastro;
      // Campos divergentes iniciam desmarcados para o usuário escolher conscientemente quais substituir.
      if (!hasCurrent) {
        nextChecked[c.key] = true;
      } else if (!equal) {
        nextChecked[c.key] = false;
      }
    }
    setCheckedKeys(nextChecked);
    setDecisionStatus(null);
    setPanelDismissed(false);
  };

  useEffect(() => {
    if (selectedItem && lastMeta) {
      initSelectionForItem(selectedItem, lastMeta);
    }
  }, [selectedItemIdx]);

  const handleModeChange = (newMode: SemaLookupMode) => {
    setMode(newMode);
    setValidationError(null);
    if (newMode === 'cpf') {
      setQuery(prev => formatCpfInput(prev));
    } else if (newMode === 'cnpj') {
      setQuery(prev => formatCnpjInput(prev));
    }
  };

  const handleQueryChange = (val: string) => {
    setValidationError(null);
    if (mode === 'cpf') {
      setQuery(formatCpfInput(val));
    } else if (mode === 'cnpj') {
      setQuery(formatCnpjInput(val));
    } else {
      setQuery(val);
    }
  };

  const handleConsultar = async () => {
    setValidationError(null);
    setApiError(null);
    setDecisionStatus(null);
    setPanelDismissed(false);

    const trimmed = query.trim();
    const digits = trimmed.replace(/\D/g, '');

    if (mode === 'cpf' && digits.length !== 11) {
      setValidationError('Informe um CPF válido com 11 dígitos para consultar na base da SEMA-MT.');
      return;
    }
    if (mode === 'cnpj' && digits.length !== 14) {
      setValidationError('Informe um CNPJ válido com 14 dígitos para consultar na base da SEMA-MT.');
      return;
    }
    if (mode === 'car' && trimmed.length < 3) {
      setValidationError('Informe o número do CAR/MT (mínimo 3 caracteres) para consultar.');
      return;
    }

    setIsLoading(true);
    setResult(null);
    setAllItems([]);
    setSelectedItemIdx(0);

    const meta: SemaSearchMeta = {
      mode,
      rawQuery: trimmed,
      queryDigits: digits
    };
    setLastMeta(meta);

    try {
      const res = await consultarDocumentosSema(
        mode === 'car' ? { car: trimmed } : { cpfCnpj: digits }
      );
      setResult(res);

      if (!res.sucesso && res.erroGeral) {
        setApiError(res.erroGeral);
        return;
      }

      const merged: SemaDocumentoItem[] = [
        ...(res.carImoveis || []),
        ...(res.licencas || []),
        ...(res.notificacoes || []),
        ...(res.autosInfracao || []),
        ...(res.termosEmbargo || []),
        ...(res.outros || [])
      ];

      setAllItems(merged);
      setSelectedItemIdx(0);
      if (merged.length > 0) {
        initSelectionForItem(merged[0], meta);
      }
    } catch (err: any) {
      setApiError(err?.message || 'Erro ao consultar a base da SEMA-MT.');
    } finally {
      setIsLoading(false);
    }
  };

  const comparisons = computeComparisons(selectedItem, lastMeta);
  const annotated = comparisons.map(c => {
    const hasCurrent = Boolean(String(c.currentValue || '').trim());
    const equal =
      c.isEqual !== undefined
        ? c.isEqual
        : hasCurrent && normalizeTextCompare(c.currentValue) === normalizeTextCompare(c.semaValue);
    return {
      ...c,
      hasCurrent,
      equal,
      isDivergent: hasCurrent && !equal
    };
  });

  const divergentFields = annotated.filter(f => f.isDivergent);
  const fillableFields = annotated.filter(f => !f.hasCurrent);
  const matchingFields = annotated.filter(f => f.hasCurrent && f.equal);
  const selectableFields = annotated.filter(f => !f.equal);

  const selectedCount = selectableFields.filter(f => checkedKeys[f.key]).length;

  const toggleAllSelectable = (checked: boolean) => {
    const next: Record<string, boolean> = { ...checkedKeys };
    for (const f of selectableFields) {
      next[f.key] = checked;
    }
    setCheckedKeys(next);
  };

  const handleConfirmReplaceOrFill = () => {
    if (!selectedItem || !lastMeta) return;
    const toApply: Record<string, SemaCampoComparacao> = {};
    for (const f of selectableFields) {
      if (checkedKeys[f.key]) {
        toApply[f.key] = f;
      }
    }
    const count = Object.keys(toApply).length;
    if (count === 0) return;

    onApplyFields(toApply, selectedItem, lastMeta);
    setDecisionStatus(
      `${count} campo(s) ${divergentFields.length > 0 ? 'atualizado(s)' : 'preenchido(s)'} com os dados da base da SEMA-MT.`
    );
    setPanelDismissed(true);
  };

  const handleKeepCurrent = () => {
    setDecisionStatus('Dados atuais do sistema mantidos sem alterações.');
    setPanelDismissed(true);
  };

  return (
    <div
      style={{
        marginBottom: '18px',
        padding: '14px',
        backgroundColor: '#f0f9ff',
        border: '1px solid #bae6fd',
        borderRadius: '10px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
        <div>
          <strong style={{ fontSize: '13px', color: '#0369a1', display: 'block' }}>
            Consulta na Base da SEMA-MT · {entityLabel}
          </strong>
          <span style={{ fontSize: '11.5px', color: '#475569' }}>
            {isNew
              ? `Consulte por ${allowCar ? 'CPF, CNPJ ou CAR/MT' : 'CPF ou CNPJ'} para importar dados já existentes na SEMA-MT.`
              : `Consulte por ${allowCar ? 'CPF, CNPJ ou CAR/MT' : 'CPF ou CNPJ'} para conferir divergências em relação à base da SEMA-MT.`}
          </span>
        </div>

        {(result || allItems.length > 0) && (
          <button
            type="button"
            className="btn light small"
            style={{ fontSize: '11px', padding: '4px 10px' }}
            onClick={() => {
              setResult(null);
              setAllItems([]);
              setApiError(null);
              setValidationError(null);
              setDecisionStatus(null);
              setPanelDismissed(false);
            }}
          >
            Limpar consulta
          </button>
        )}
      </div>

      {/* Controles de Busca */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-end' }}>
        <div style={{ minWidth: '140px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: '#334155', fontWeight: 600, marginBottom: '3px' }}>
            Pesquisar por
          </label>
          <select
            className="select"
            value={mode}
            onChange={e => handleModeChange(e.target.value as SemaLookupMode)}
            style={{ fontSize: '12px', padding: '7px 8px', backgroundColor: '#ffffff' }}
          >
            <option value="cpf">CPF</option>
            <option value="cnpj">CNPJ</option>
            {allowCar && <option value="car">CAR/MT</option>}
          </select>
        </div>

        <div style={{ flex: '1 1 240px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: '#334155', fontWeight: 600, marginBottom: '3px' }}>
            {mode === 'cpf'
              ? 'CPF (11 dígitos)'
              : mode === 'cnpj'
              ? 'CNPJ (14 dígitos)'
              : 'Número do CAR/MT ou CAR Federal'}
          </label>
          <input
            type="text"
            className="input"
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleConsultar();
              }
            }}
            placeholder={
              mode === 'cpf'
                ? '000.000.000-00'
                : mode === 'cnpj'
                ? '00.000.000/0000-00'
                : 'Ex: MT19852/2018 ou MT-5103403-...'
            }
            style={{ fontSize: '12.5px', padding: '7px 10px', backgroundColor: '#ffffff' }}
          />
        </div>

        <button
          type="button"
          className="btn"
          disabled={isLoading}
          onClick={handleConsultar}
          style={{
            backgroundColor: '#0369a1',
            color: '#ffffff',
            border: 'none',
            padding: '8px 14px',
            fontSize: '12.5px',
            fontWeight: 600,
            cursor: isLoading ? 'wait' : 'pointer'
          }}
        >
          {isLoading ? 'Consultando SEMA-MT...' : 'Consultar SEMA-MT'}
        </button>
      </div>

      {validationError && (
        <div style={{ marginTop: '8px', fontSize: '11.5px', color: '#b45309', backgroundColor: '#fffbeb', padding: '6px 10px', borderRadius: '6px', border: '1px solid #fde68a' }}>
          {validationError}
        </div>
      )}

      {apiError && (
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#991b1b', backgroundColor: '#fef2f2', padding: '8px 12px', borderRadius: '6px', border: '1px solid #fecaca' }}>
          <strong>Erro na consulta SEMA-MT:</strong> {apiError}
        </div>
      )}

      {decisionStatus && (
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#166534', backgroundColor: '#dcfce7', padding: '8px 12px', borderRadius: '6px', border: '1px solid #bbf7d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <span>✓ {decisionStatus}</span>
          {panelDismissed && allItems.length > 0 && (
            <button
              type="button"
              onClick={() => setPanelDismissed(false)}
              style={{ background: 'none', border: 'none', color: '#166534', textDecoration: 'underline', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
            >
              Revisar seleção
            </button>
          )}
        </div>
      )}

      {/* Nenhum registro localizado */}
      {result && !apiError && allItems.length === 0 && (
        <div
          style={{
            marginTop: '10px',
            padding: '10px 12px',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            fontSize: '12px',
            color: '#475569'
          }}
        >
          <strong style={{ color: '#0f172a', display: 'block', marginBottom: '3px' }}>
            Nenhum registro encontrado na base da SEMA-MT para este critério.
          </strong>
          <span>{result.mensagemStatus}</span>
          {allowCar && (mode === 'cpf' || mode === 'cnpj') && (
            <div style={{ marginTop: '5px', fontSize: '11px', color: '#92400e' }}>
              Dica: caso não retorne o imóvel rural pelo CPF/CNPJ, tente consultar diretamente pelo número do <strong>CAR/MT</strong>.
            </div>
          )}
        </div>
      )}

      {/* Resultados encontrados */}
      {allItems.length > 0 && !panelDismissed && (
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Seletor de registros retornados */}
          <div>
            <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#0369a1', marginBottom: '6px' }}>
              {allItems.length === 1
                ? '1 registro encontrado na base da SEMA-MT:'
                : `${allItems.length} registros encontrados na base da SEMA-MT — selecione qual deseja usar:`}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '210px', overflowY: 'auto' }}>
              {allItems.map((item, idx) => {
                const isSelected = idx === selectedItemIdx;
                const cleanTitle = stripOuterQuotesAndBrackets(item.razaoSocial || item.nomeDocumento || item.tipo || '');
                const cleanDocNum = item.numeroDocumento ? stripOuterQuotesAndBrackets(item.numeroDocumento) : '';
                const cleanCarFed = item.carFederal ? stripOuterQuotesAndBrackets(item.carFederal) : '';
                const cleanMun = item.municipio ? stripOuterQuotesAndBrackets(item.municipio) : '';
                const cleanStatus = item.status ? stripOuterQuotesAndBrackets(item.status) : '';
                const cleanCpfCnpj = item.cpfCnpjMascarado ? formatCpfCnpjReadable(item.cpfCnpjMascarado) || item.cpfCnpjMascarado : '';

                return (
                  <div
                    key={item.id ?? `${item.camadaOrigem}-${idx}`}
                    onClick={() => setSelectedItemIdx(idx)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: isSelected ? '2px solid #0284c7' : '1px solid #cbd5e1',
                      backgroundColor: isSelected ? '#e0f2fe' : '#ffffff',
                      cursor: 'pointer',
                      fontSize: '12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '10px'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <input
                          type="radio"
                          name={`sema-select-${entityLabel}`}
                          checked={isSelected}
                          onChange={() => setSelectedItemIdx(idx)}
                        />
                        <span style={{ fontSize: '10.5px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#334155' }}>
                          {item.camadaTitulo || item.camadaOrigem.replace('Geoportal:', '')}
                        </span>
                        <strong style={{ color: '#0f172a' }}>
                          {cleanTitle}
                        </strong>
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '4px', paddingLeft: '20px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        {cleanCpfCnpj && <span>CPF/CNPJ: <b style={{ fontFamily: 'monospace', color: '#0f172a' }}>{cleanCpfCnpj}</b></span>}
                        {cleanDocNum && <span>Doc/CAR: <b>{cleanDocNum}</b></span>}
                        {cleanCarFed && <span>CAR Federal: <b>{cleanCarFed}</b></span>}
                        {cleanMun && <span>Local: <b>{cleanMun}</b></span>}
                        {cleanStatus && <span>Situação: <b>{cleanStatus}</b></span>}
                      </div>
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: isSelected ? '#0369a1' : '#64748b' }}>
                      {isSelected ? 'Selecionado' : 'Selecionar'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Painel de Comparação / Seleção de Campos */}
          {selectedItem && (
            <div
              style={{
                backgroundColor: '#ffffff',
                border: divergentFields.length > 0 ? '1px solid #f59e0b' : '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '12px'
              }}
            >
              {divergentFields.length > 0 ? (
                <div style={{ marginBottom: '10px', padding: '8px 10px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', fontSize: '12px', color: '#92400e' }}>
                  <strong style={{ display: 'block', marginBottom: '3px' }}>
                    ⚠️ Dados divergentes encontrados na base da SEMA-MT
                  </strong>
                  <span>
                    Existem {divergentFields.length} campo(s) divergente(s) em relação aos dados cadastrados no sistema. Deseja manter os dados atuais ou substituir pelos dados da SEMA-MT? Marque nas caixinhas abaixo quais campos deseja substituir:
                  </span>
                </div>
              ) : fillableFields.length > 0 ? (
                <div style={{ marginBottom: '10px', fontSize: '12px', color: '#0369a1' }}>
                  <strong>Selecione quais dados da base SEMA-MT deseja usar no cadastro:</strong>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#166534', padding: '6px 0' }}>
                  ✓ Os dados retornados por este registro já conferem integralmente com os valores preenchidos no sistema.
                </div>
              )}

              {selectableFields.length > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '11px' }}>
                    <span style={{ color: '#64748b' }}>
                      {selectedCount} de {selectableFields.length} campo(s) selecionado(s)
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => toggleAllSelectable(true)}
                        style={{ background: 'none', border: 'none', color: '#0369a1', cursor: 'pointer', textDecoration: 'underline', fontSize: '11px' }}
                      >
                        Selecionar todos
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleAllSelectable(false)}
                        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', textDecoration: 'underline', fontSize: '11px' }}
                      >
                        Desmarcar todos
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectableFields.map(field => {
                      const isChecked = Boolean(checkedKeys[field.key]);
                      return (
                        <label
                          key={field.key}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '8px',
                            padding: '8px 10px',
                            borderRadius: '6px',
                            border: isChecked
                              ? '1px solid #38bdf8'
                              : field.isDivergent
                              ? '1px solid #fcd34d'
                              : '1px solid #e2e8f0',
                            backgroundColor: isChecked
                              ? '#f0f9ff'
                              : field.isDivergent
                              ? '#fffdf5'
                              : '#f8fafc',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={e =>
                              setCheckedKeys(prev => ({ ...prev, [field.key]: e.target.checked }))
                            }
                            style={{ marginTop: '3px' }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <strong style={{ color: '#0f172a' }}>{field.label}</strong>
                              {field.isDivergent ? (
                                <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', backgroundColor: '#fef3c7', color: '#92400e' }}>
                                  Divergente
                                </span>
                              ) : (
                                <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', backgroundColor: '#e0f2fe', color: '#0369a1' }}>
                                  Novo dado SEMA
                                </span>
                              )}
                            </div>

                            {field.isDivergent ? (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '6px', marginTop: '4px', fontSize: '11.5px' }}>
                                <div style={{ color: '#475569' }}>
                                  <span style={{ color: '#64748b' }}>Atual no sistema: </span>
                                  <span style={{ textDecoration: isChecked ? 'line-through' : 'none' }}>
                                    {field.currentDisplay || field.currentValue}
                                  </span>
                                </div>
                                <div style={{ color: '#0369a1' }}>
                                  <span style={{ color: '#64748b' }}>Base SEMA-MT: </span>
                                  <strong>{field.semaDisplay || field.semaValue}</strong>
                                </div>
                              </div>
                            ) : (
                              <div style={{ marginTop: '2px', fontSize: '11.5px', color: '#0369a1' }}>
                                <strong>{field.semaDisplay || field.semaValue}</strong>
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}

              {matchingFields.length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#475569' }}>
                  <span>Já conferem com o sistema: </span>
                  {matchingFields.map(m => m.label).join(', ')}.
                </div>
              )}

              {selectableFields.length > 0 && (
                <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '8px' }}>
                  {divergentFields.length > 0 && (
                    <button
                      type="button"
                      className="btn light"
                      onClick={handleKeepCurrent}
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      Manter dados atuais
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn green"
                    disabled={selectedCount === 0}
                    onClick={handleConfirmReplaceOrFill}
                    style={{ fontSize: '12px', padding: '6px 14px', opacity: selectedCount === 0 ? 0.55 : 1 }}
                  >
                    {divergentFields.length > 0
                      ? 'Substituir selecionados pelos dados da SEMA-MT'
                      : 'Usar dados selecionados da SEMA-MT'}
                  </button>
                </div>
              )}

              {/* Ficha organizada completa com todos os dados retornados pela SEMA-MT */}
              {(() => {
                const allEntries = formatSemaPropertiesEntries(selectedItem.propriedadesBrutas);
                if (allEntries.length === 0) return null;
                const filledEntries = allEntries.filter(e => !e.isEmpty);
                const emptyEntries = allEntries.filter(e => e.isEmpty);
                const visibleEntries =
                  showEmptySemaProps || filledEntries.length === 0 ? allEntries : filledEntries;

                return (
                  <div
                    style={{
                      marginTop: '12px',
                      paddingTop: '12px',
                      borderTop: '1px solid #e2e8f0'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>
                        Dados completos retornados pela SEMA-MT ({filledEntries.length} preenchido(s) · {allEntries.length} total)
                      </strong>
                      {emptyEntries.length > 0 && filledEntries.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowEmptySemaProps(prev => !prev)}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            padding: '2px 8px',
                            color: '#0369a1',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 600
                          }}
                        >
                          {showEmptySemaProps
                            ? `Ocultar ${emptyEntries.length} sem preenchimento`
                            : `Mostrar também ${emptyEntries.length} sem preenchimento`}
                        </button>
                      )}
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '7px'
                      }}
                    >
                      {visibleEntries.map(entry => (
                        <div
                          key={entry.key}
                          style={{
                            backgroundColor: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            padding: '6px 9px',
                            opacity: entry.isEmpty ? 0.7 : 1
                          }}
                        >
                          <span style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#64748b', marginBottom: '1px' }}>
                            {entry.label}
                          </span>
                          {entry.isLink ? (
                            <a
                              href={entry.value}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: '11.5px', color: '#0369a1', fontWeight: 600, textDecoration: 'underline', wordBreak: 'break-all' }}
                            >
                              Acessar documento oficial ↗
                            </a>
                          ) : (
                            <span
                              style={{
                                fontSize: '12px',
                                fontWeight: entry.isEmpty ? 400 : 600,
                                color: entry.isEmpty ? '#94a3b8' : '#0f172a',
                                wordBreak: 'break-word',
                                display: 'block'
                              }}
                            >
                              {entry.value}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
