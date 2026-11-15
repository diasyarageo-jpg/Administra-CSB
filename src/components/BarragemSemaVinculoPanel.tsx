// src/components/BarragemSemaVinculoPanel.tsx
import React, { useMemo, useState, useEffect } from 'react';
import {
  SemaCriterioVinculo,
  clearPersistedSemaLookup,
  consultarCarPorCoordenada,
  consultarDocumentosSema,
  getPersistedSemaLookup,
  isValidSemaAuditoriaId,
  setPersistedSemaLookup
} from '../services/carLookupService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { parseCoordAdvanced } from '../services/coordService';
import { IbgeMunicipio } from '../services/ibgeService';
import {
  formatCpfCnpjReadable,
  formatSemaPropertiesEntries
} from '../config/carCampos';
import {
  CamadaConsultaStatus,
  SemaDocumentoItem
} from '../types/carLookup';
import {
  BarragemSemaFieldComparison,
  BarragemSemaFieldKey,
  CarGroupedCard,
  FieldSelectionAction,
  buildBarragemFieldComparisons,
  buildSemaAuditPayloadForBarragem,
  carFeatureToSemaItem,
  checkDuplicateEmpreendedorByCpfCnpj,
  cleanSemaText,
  extractCleanOwnerName,
  extractSchemaConfirmedCpfCnpj,
  findManualNameCandidates,
  groupAndDeduplicateSemaResults,
  matchEmpreendedorByCpfCnpj,
  normalizeDocDigits,
  resolveLocalidadeFromSemaItem
} from '../utils/semaVinculoHelpers';

export interface NewEmpreendedorFromSemaDraft {
  tipoPessoa: 'Pessoa física' | 'Pessoa jurídica';
  nome: string;
  cpfCnpj: string;
  uf: string;
  municipio: string;
  municipioIbge: string;
}

export interface ConfirmVinculoPayload {
  item: SemaDocumentoItem;
  originSearchMode: 'car' | 'coordenada' | 'car_da_coordenada';
  empreendedorAction: 'nenhum' | 'existente' | 'criar_novo';
  selectedEmpreendedor?: any;
  newEmpreendedorDraft?: NewEmpreendedorFromSemaDraft;
  selectedFields: Array<{
    key: BarragemSemaFieldKey;
    label: string;
    semaValue: string;
    action: Exclude<FieldSelectionAction, 'manter'>;
  }>;
  criterioVinculo?: SemaCriterioVinculo;
  auditPayload: Record<string, any>;
}

interface BarragemSemaVinculoPanelProps {
  barragemId?: string;
  isNew: boolean;
  currentBarragem: {
    nome: string;
    car: string;
    empreendimento: string;
    municipio: string;
    municipioIbge: string;
    processo: string;
    latitude: string;
    longitude: string;
    empreendedorId: string;
  };
  barragensCadastradas: any[];
  empreendedores: any[];
  mtMunicipios: IbgeMunicipio[];
  onConfirmApply: (payload: ConfirmVinculoPayload) => Promise<{ success: boolean; error?: string }>;
}

interface PersistedVinculoLookupState {
  searchSource: 'car' | 'coordenada' | 'car_da_coordenada';
  carQuery: string;
  consultadoEm: string;
  items: SemaDocumentoItem[];
  camadasConsultadas: CamadaConsultaStatus[];
  mensagemStatus: string;
  selectedItemKey: string | null;
}

function formatCpfCnpjInput(val: string): string {
  const d = val.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 3) return d;
  if (d.length <= 11) {
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function formatConsultadoEmBr(iso?: string): string {
  if (!iso) return 'Data não informada';
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('pt-BR');
}

function getItemUiKey(item: SemaDocumentoItem, fallbackIdx: number): string {
  return `${item.camadaOrigem || 'sema'}::${item.id || item.numeroDocumento || fallbackIdx}`;
}

export function BarragemSemaVinculoPanel({
  barragemId,
  isNew,
  currentBarragem,
  barragensCadastradas,
  empreendedores,
  mtMunicipios,
  onConfirmApply
}: BarragemSemaVinculoPanelProps) {
  const persistKey = `vinculo-barragem:${!isNew && barragemId ? barragemId : 'nova'}`;
  const persisted = getPersistedSemaLookup<PersistedVinculoLookupState>(persistKey);

  const [carQuery, setCarQuery] = useState<string>(
    persisted?.carQuery !== undefined ? persisted.carQuery : currentBarragem.car || ''
  );
  const [searchSource, setSearchSource] = useState<'car' | 'coordenada' | 'car_da_coordenada'>(
    persisted?.searchSource || (currentBarragem.car.trim() ? 'car' : 'coordenada')
  );
  const [consultadoEm, setConsultadoEm] = useState<string>(persisted?.consultadoEm || '');
  const [items, setItems] = useState<SemaDocumentoItem[]>(persisted?.items || []);
  const [camadasConsultadas, setCamadasConsultadas] = useState<CamadaConsultaStatus[]>(
    persisted?.camadasConsultadas || []
  );
  const [mensagemStatus, setMensagemStatus] = useState<string>(persisted?.mensagemStatus || '');
  const [hasSearched, setHasSearched] = useState<boolean>(Boolean(persisted));
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(
    persisted?.selectedItemKey || null
  );

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showLayerDiagnostics, setShowLayerDiagnostics] = useState<boolean>(false);

  // Todos os quadros iniciam recolhidos por padrão
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [expandedProps, setExpandedProps] = useState<Record<string, boolean>>({});
  const [expandedDocs, setExpandedDocs] = useState<Record<string, boolean>>({});

  // Resolução de empreendedor & comparação de campos
  const [empAction, setEmpAction] = useState<'nenhum' | 'existente' | 'criar_novo'>('nenhum');
  const [manualEmpId, setManualEmpId] = useState<string>('');
  const [newEmpDraft, setNewEmpDraft] = useState<NewEmpreendedorFromSemaDraft>({
    tipoPessoa: 'Pessoa jurídica',
    nome: '',
    cpfCnpj: '',
    uf: 'MT',
    municipio: '',
    municipioIbge: ''
  });
  const [fieldActions, setFieldActions] = useState<
    Partial<Record<BarragemSemaFieldKey, FieldSelectionAction>>
  >({});

  // Confirmação final explícita
  const [awaitingFinalConfirm, setAwaitingFinalConfirm] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [applyFeedback, setApplyFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const latParse = parseCoordAdvanced(currentBarragem.latitude, false);
  const lngParse = parseCoordAdvanced(currentBarragem.longitude, true);
  const hasValidCoords =
    latParse.valido && lngParse.valido && latParse.decimal !== null && lngParse.decimal !== null;

  useEffect(() => {
    if (!hasSearched) return;
    setPersistedSemaLookup<PersistedVinculoLookupState>(persistKey, {
      searchSource,
      carQuery,
      consultadoEm,
      items,
      camadasConsultadas,
      mensagemStatus,
      selectedItemKey
    });
  }, [
    persistKey,
    hasSearched,
    searchSource,
    carQuery,
    consultadoEm,
    items,
    camadasConsultadas,
    mensagemStatus,
    selectedItemKey
  ]);

  const { carCards, otherDocs } = useMemo(
    () => groupAndDeduplicateSemaResults(items, barragensCadastradas, barragemId),
    [items, barragensCadastradas, barragemId]
  );

  const selectedItem = useMemo(() => {
    if (!selectedItemKey) return null;
    for (let i = 0; i < carCards.length; i++) {
      if (getItemUiKey(carCards[i].item, i) === selectedItemKey) {
        return carCards[i].item;
      }
    }
    for (let i = 0; i < otherDocs.length; i++) {
      if (getItemUiKey(otherDocs[i], i + 1000) === selectedItemKey) {
        return otherDocs[i];
      }
    }
    return null;
  }, [selectedItemKey, carCards, otherDocs]);

  const cpfInspection = useMemo(
    () => extractSchemaConfirmedCpfCnpj(selectedItem),
    [selectedItem]
  );

  const cpfMatchOutcome = useMemo(
    () => matchEmpreendedorByCpfCnpj(cpfInspection.digits, empreendedores),
    [cpfInspection.digits, empreendedores]
  );

  const ownerNameFromItem = useMemo(() => {
    if (!selectedItem) return '';
    return extractCleanOwnerName(
      selectedItem.razaoSocial ||
        selectedItem.propriedadesBrutas?.NOMESPROPRIETARIOS ||
        selectedItem.propriedadesBrutas?.RAZAO_SOCIAL ||
        selectedItem.propriedadesBrutas?.PROPRIETARIOS
    );
  }, [selectedItem]);

  const manualCandidates = useMemo(
    () => findManualNameCandidates(ownerNameFromItem, empreendedores),
    [ownerNameFromItem, empreendedores]
  );

  const fieldComparisons: BarragemSemaFieldComparison[] = useMemo(() => {
    if (!selectedItem) return [];
    return buildBarragemFieldComparisons(selectedItem, currentBarragem, mtMunicipios);
  }, [selectedItem, currentBarragem, mtMunicipios]);

  const initDecisionForSelectedItem = (item: SemaDocumentoItem, uiKey: string) => {
    setSelectedItemKey(uiKey);
    setAwaitingFinalConfirm(false);
    setApplyFeedback(null);

    const doc = extractSchemaConfirmedCpfCnpj(item);
    const match = matchEmpreendedorByCpfCnpj(doc.digits, empreendedores);
    const loc = resolveLocalidadeFromSemaItem(item, mtMunicipios);
    const ownerClean = extractCleanOwnerName(
      item.razaoSocial ||
        item.propriedadesBrutas?.NOMESPROPRIETARIOS ||
        item.propriedadesBrutas?.RAZAO_SOCIAL ||
        item.propriedadesBrutas?.PROPRIETARIOS
    );

    if (match.status === 'unico' && match.empreendedor) {
      setEmpAction('existente');
      setManualEmpId(String(match.empreendedor.id));
    } else {
      setEmpAction('nenhum');
      setManualEmpId('');
    }

    setNewEmpDraft({
      tipoPessoa: doc.digits.length === 11 ? 'Pessoa física' : 'Pessoa jurídica',
      nome: ownerClean,
      cpfCnpj: doc.formatted,
      uf: loc.uf || 'MT',
      municipio: loc.municipio || '',
      municipioIbge: loc.municipioIbge || ''
    });

    const comps = buildBarragemFieldComparisons(item, currentBarragem, mtMunicipios);
    const nextActions: Partial<Record<BarragemSemaFieldKey, FieldSelectionAction>> = {};
    for (const c of comps) {
      nextActions[c.key] = c.action;
    }
    setFieldActions(nextActions);
  };

  const resetDecisionOnly = () => {
    setSelectedItemKey(null);
    setEmpAction('nenhum');
    setManualEmpId('');
    setFieldActions({});
    setAwaitingFinalConfirm(false);
  };

  const handleConsultarPorCar = async (carOverride?: string, fromCoord = false) => {
    const targetCar = String(carOverride !== undefined ? carOverride : carQuery).trim();
    if (targetCar.length < 3) {
      setErrorMsg('Informe o número do CAR/MT (mínimo 3 caracteres) para consultar a SEMA-MT.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setApplyFeedback(null);
    resetDecisionOnly();

    try {
      const res = await consultarDocumentosSema({
        car: targetCar,
        entidadeAlvoTipo: !isNew && barragemId ? 'barragem' : 'car',
        entidadeAlvoId: !isNew && barragemId ? barragemId : undefined
      });
      const merged = [
        ...(res.carImoveis || []),
        ...(res.licencas || []),
        ...(res.notificacoes || []),
        ...(res.autosInfracao || []),
        ...(res.termosEmbargo || []),
        ...(res.outros || [])
      ];

      setSearchSource(fromCoord ? 'car_da_coordenada' : 'car');
      if (carOverride !== undefined) setCarQuery(targetCar);
      setConsultadoEm(res.consultadoEm || new Date().toISOString());
      setCamadasConsultadas(res.camadasConsultadas || []);
      setMensagemStatus(res.mensagemStatus || '');
      setHasSearched(true);
      setExpandedCards({});
      setExpandedProps({});
      setExpandedDocs({});

      if (!res.sucesso && res.erroGeral) {
        setErrorMsg(res.erroGeral);
        setItems([]);
      } else {
        setItems(merged);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha de comunicação ao consultar a SEMA-MT por CAR.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConsultarPorCoordenadas = async () => {
    if (!hasValidCoords) {
      setErrorMsg('Preencha latitude e longitude válidas em GMS para consultar pelas coordenadas.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setApplyFeedback(null);
    resetDecisionOnly();

    try {
      const res = await consultarCarPorCoordenada(
        currentBarragem.latitude,
        currentBarragem.longitude,
        {
          entidadeAlvoTipo: !isNew && barragemId ? 'barragem' : 'car',
          entidadeAlvoId: !isNew && barragemId ? barragemId : undefined
        }
      );
      setSearchSource('coordenada');
      setConsultadoEm(res.consultadoEm || new Date().toISOString());
      setCamadasConsultadas(res.camadasConsultadas || []);
      setHasSearched(true);
      setExpandedCards({});
      setExpandedProps({});
      setExpandedDocs({});

      if (!res.sucesso) {
        setErrorMsg(res.mensagemErro || 'Erro ao consultar Geoportal SEMA-MT pelas coordenadas.');
        setItems([]);
        setMensagemStatus('');
      } else {
        const converted = (res.feicoes || []).map(f =>
          carFeatureToSemaItem(f, res.consultadoEm)
        );
        setItems(converted);
        setMensagemStatus(
          res.mensagemStatus ||
            (converted.length > 0
              ? `${converted.length} imóvel(is) encontrado(s) para as coordenadas cadastradas.`
              : 'Nenhum imóvel encontrado na base pública da SEMA-MT para as coordenadas cadastradas.')
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha de comunicação ao consultar pelas coordenadas.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearConsulta = () => {
    clearPersistedSemaLookup(persistKey);
    setHasSearched(false);
    setItems([]);
    setCamadasConsultadas([]);
    setMensagemStatus('');
    setConsultadoEm('');
    setErrorMsg(null);
    setApplyFeedback(null);
    setExpandedCards({});
    setExpandedProps({});
    setExpandedDocs({});
    resetDecisionOnly();
  };

  const sortedActiveEmpreendedores = useMemo(
    () =>
      [...empreendedores].sort((a, b) =>
        String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' })
      ),
    [empreendedores]
  );

  const selectedExistingEmpreendedor = useMemo(
    () => empreendedores.find(e => String(e.id) === String(manualEmpId)),
    [empreendedores, manualEmpId]
  );

  const duplicateCheckForNewEmp = useMemo(() => {
    if (empAction !== 'criar_novo') return { hasDuplicate: false, digits: '' };
    return checkDuplicateEmpreendedorByCpfCnpj(newEmpDraft.cpfCnpj, empreendedores);
  }, [empAction, newEmpDraft.cpfCnpj, empreendedores]);

  const selectedFieldsToApply = useMemo(() => {
    const out: ConfirmVinculoPayload['selectedFields'] = [];
    for (const c of fieldComparisons) {
      const act = fieldActions[c.key] || 'manter';
      if (!c.isEqual && (act === 'preencher' || act === 'substituir')) {
        out.push({
          key: c.key,
          label: c.label,
          semaValue: c.semaValue,
          action: act
        });
      }
    }
    return out;
  }, [fieldComparisons, fieldActions]);

  const canProceedToConfirm = useMemo(() => {
    if (!selectedItem) return false;
    if (empAction === 'existente' && !selectedExistingEmpreendedor) return false;
    if (empAction === 'criar_novo') {
      const docDigits = normalizeDocDigits(newEmpDraft.cpfCnpj);
      if (!newEmpDraft.nome.trim() || !docDigits || duplicateCheckForNewEmp.hasDuplicate) {
        return false;
      }
    }
    return empAction !== 'nenhum' || selectedFieldsToApply.length > 0;
  }, [
    selectedItem,
    empAction,
    selectedExistingEmpreendedor,
    newEmpDraft,
    duplicateCheckForNewEmp.hasDuplicate,
    selectedFieldsToApply.length
  ]);

  const handleFinalConfirm = async () => {
    if (!selectedItem || !canProceedToConfirm) return;

    if (!isNew && barragemId && isSupabaseConfigured() && !isValidSemaAuditoriaId(selectedItem.auditoriaId)) {
      setApplyFeedback({
        type: 'error',
        text: 'Esta consulta não possui identificador de auditoria emitido pelo servidor (ou veio de cache anterior). Clique novamente em "Consultar CAR" ou "Consultar por coordenadas" antes de confirmar.'
      });
      setAwaitingFinalConfirm(false);
      return;
    }

    setIsSaving(true);
    setApplyFeedback(null);

    try {
      let criterioVinculo: SemaCriterioVinculo | undefined;
      if (empAction === 'existente' && selectedExistingEmpreendedor) {
        const selectedDocDigits = normalizeDocDigits(
          selectedExistingEmpreendedor.cpfCnpj ?? selectedExistingEmpreendedor.cpf_cnpj
        );
        criterioVinculo =
          cpfInspection.status === 'completo' &&
          cpfInspection.digits &&
          selectedDocDigits === cpfInspection.digits
            ? 'cpf_cnpj_exato'
            : 'confirmacao_manual_analista';
      } else if (empAction === 'criar_novo') {
        const draftDigits = normalizeDocDigits(newEmpDraft.cpfCnpj);
        criterioVinculo =
          cpfInspection.status === 'completo' &&
          cpfInspection.digits &&
          draftDigits === cpfInspection.digits
            ? 'cpf_cnpj_exato'
            : 'cadastro_novo_cpf_cnpj';
      }

      const auditPayload = buildSemaAuditPayloadForBarragem(
        selectedItem,
        mtMunicipios
      );

      const res = await onConfirmApply({
        item: selectedItem,
        originSearchMode: searchSource,
        empreendedorAction: empAction,
        selectedEmpreendedor:
          empAction === 'existente' ? selectedExistingEmpreendedor : undefined,
        newEmpreendedorDraft:
          empAction === 'criar_novo'
            ? {
                ...newEmpDraft,
                nome: newEmpDraft.nome.trim(),
                cpfCnpj:
                  formatCpfCnpjReadable(normalizeDocDigits(newEmpDraft.cpfCnpj)) ||
                  newEmpDraft.cpfCnpj.trim()
              }
            : undefined,
        selectedFields: selectedFieldsToApply,
        criterioVinculo,
        auditPayload
      });

      if (!res.success) {
        setApplyFeedback({
          type: 'error',
          text: res.error || 'Não foi possível aplicar os dados selecionados.'
        });
        setAwaitingFinalConfirm(false);
      } else {
        setApplyFeedback({
          type: 'success',
          text: 'Vínculo e campos selecionados aplicados com registro de proveniência SEMA-MT.'
        });
        setAwaitingFinalConfirm(false);
        resetDecisionOnly();
      }
    } catch (err: any) {
      setApplyFeedback({
        type: 'error',
        text: err?.message || 'Erro inesperado ao gravar vínculo e campos selecionados.'
      });
      setAwaitingFinalConfirm(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      style={{
        marginBottom: '18px',
        padding: '14px',
        backgroundColor: '#fffbeb',
        border: '1.5px solid #f59e0b',
        borderRadius: '10px'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: '10px'
        }}
      >
        <div>
          <strong style={{ fontSize: '13.5px', color: '#92400e', display: 'block' }}>
            Localizar e vincular empreendedor via Base Pública SEMA-MT
          </strong>
          <span style={{ fontSize: '11.5px', color: '#78350f' }}>
            Esta barragem ainda não possui empreendedor vinculado. Consulte primeiro pelo CAR/MT cadastrado ou pelas coordenadas cadastradas e revise antes de confirmar qualquer vínculo.
          </span>
        </div>

        {hasSearched && (
          <button
            type="button"
            className="btn light small"
            style={{ fontSize: '11px', padding: '4px 10px' }}
            onClick={handleClearConsulta}
          >
            Limpar consulta
          </button>
        )}
      </div>

      {/* Controles de Consulta */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '10px',
          backgroundColor: '#ffffff',
          border: '1px solid #fde68a',
          borderRadius: '8px',
          padding: '10px'
        }}
      >
        {/* 1. Consulta por CAR/MT */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: '#0f172a',
              marginBottom: '4px'
            }}
          >
            1. Consultar pelo CAR/MT
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              className="input"
              value={carQuery}
              onChange={e => setCarQuery(e.target.value)}
              placeholder="Ex: MT47798/2017 ou código SICAR"
              style={{ fontSize: '12px', padding: '6px 9px', flex: 1 }}
            />
            <button
              type="button"
              className="btn"
              disabled={isLoading || carQuery.trim().length < 3}
              onClick={() => handleConsultarPorCar()}
              style={{
                backgroundColor: '#0369a1',
                color: '#ffffff',
                border: 'none',
                fontSize: '12px',
                fontWeight: 600,
                padding: '6px 12px',
                cursor: isLoading ? 'wait' : 'pointer',
                opacity: carQuery.trim().length < 3 ? 0.55 : 1
              }}
            >
              {isLoading && searchSource !== 'coordenada' ? 'Consultando...' : 'Consultar CAR'}
            </button>
          </div>
          {!currentBarragem.car.trim() && (
            <span style={{ display: 'block', fontSize: '10.5px', color: '#b45309', marginTop: '3px' }}>
              CAR ausente nesta barragem — utilize a consulta por coordenadas ao lado ou informe um CAR acima.
            </span>
          )}
        </div>

        {/* 2. Consulta por Coordenadas */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: '#0f172a',
              marginBottom: '4px'
            }}
          >
            2. Consultar pelas coordenadas cadastradas
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              disabled={isLoading || !hasValidCoords}
              onClick={handleConsultarPorCoordenadas}
              style={{
                backgroundColor: hasValidCoords ? '#0f766e' : '#cbd5e1',
                color: '#ffffff',
                border: 'none',
                fontSize: '12px',
                fontWeight: 600,
                padding: '6px 12px',
                cursor: hasValidCoords && !isLoading ? 'pointer' : 'not-allowed'
              }}
            >
              {isLoading && searchSource === 'coordenada'
                ? 'Consultando...'
                : 'Consultar por coordenadas'}
            </button>
            <span style={{ fontSize: '11px', color: '#475569' }}>
              {hasValidCoords
                ? `${latParse.gms} · ${lngParse.gms}`
                : 'Coordenadas GMS ausentes ou inválidas no formulário abaixo.'}
            </span>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div
          style={{
            marginTop: '10px',
            padding: '8px 12px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            color: '#991b1b',
            fontSize: '12px'
          }}
        >
          <strong>Aviso na consulta SEMA-MT:</strong> {errorMsg}
        </div>
      )}

      {applyFeedback && (
        <div
          style={{
            marginTop: '10px',
            padding: '9px 12px',
            backgroundColor: applyFeedback.type === 'success' ? '#dcfce7' : '#fef2f2',
            border:
              applyFeedback.type === 'success' ? '1px solid #86efac' : '1px solid #fecaca',
            borderRadius: '6px',
            color: applyFeedback.type === 'success' ? '#166534' : '#991b1b',
            fontSize: '12px',
            fontWeight: 600
          }}
        >
          {applyFeedback.text}
        </div>
      )}

      {/* Resultados Persistidos na Tela */}
      {hasSearched && !errorMsg && (
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Aviso obrigatório sobre correspondência espacial */}
          <div
            style={{
              padding: '8px 10px',
              backgroundColor: '#fff7ed',
              border: '1px solid #fdba74',
              borderRadius: '6px',
              fontSize: '11.5px',
              color: '#9a3412',
              lineHeight: 1.45
            }}
          >
            <strong>Regra de vínculo e correspondência espacial:</strong> Uma coordenada dentro de um imóvel identifica o imóvel que contém o ponto, mas <b>não comprova, por si só, que a barragem pertence ao titular indicado pelo CAR</b>. Correspondências espaciais ou textuais nunca geram vínculo automático sem conferência humana.
          </div>

          {/* Cabeçalho da pesquisa mantida */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              fontSize: '11.5px',
              color: '#334155'
            }}
          >
            <span>
              <strong>Resultados exibidos:</strong> {carCards.length} imóvel(is) CAR ·{' '}
              {otherDocs.length} documento(s) / licença(s) ·{' '}
              <span style={{ color: '#64748b' }}>
                Consulta em {formatConsultadoEmBr(consultadoEm)} (mantida até nova solicitação)
              </span>
            </span>

            {camadasConsultadas.length > 0 && (
              <button
                type="button"
                onClick={() => setShowLayerDiagnostics(prev => !prev)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#0369a1',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 600
                }}
              >
                {showLayerDiagnostics
                  ? 'Ocultar status das camadas'
                  : `Ver status das camadas (${camadasConsultadas.length})`}
              </button>
            )}
          </div>

          {showLayerDiagnostics && camadasConsultadas.length > 0 && (
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '8px 10px',
                display: 'grid',
                gap: '4px',
                fontSize: '11px'
              }}
            >
              {camadasConsultadas.map((c, idx) => (
                <div
                  key={`${c.camada}-${idx}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '8px',
                    flexWrap: 'wrap',
                    borderBottom: idx < camadasConsultadas.length - 1 ? '1px solid #f1f5f9' : 'none',
                    paddingBottom: '3px'
                  }}
                >
                  <span style={{ color: '#0f172a', fontWeight: 600 }}>
                    {c.titulo || c.camada}{' '}
                    <span style={{ color: '#64748b', fontWeight: 400 }}>({c.status})</span>
                  </span>
                  <span style={{ color: '#475569' }}>{c.mensagem}</span>
                </div>
              ))}
            </div>
          )}

          {carCards.length === 0 && otherDocs.length === 0 && (
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '10px 12px',
                fontSize: '12px',
                color: '#475569'
              }}
            >
              {mensagemStatus || 'Nenhum registro encontrado na base pública da SEMA-MT para este critério.'}
            </div>
          )}

          {/* Quadros por CAR único — recolhidos inicialmente com seta para expandir */}
          {carCards.map((card: CarGroupedCard, idx: number) => {
            const uiKey = getItemUiKey(card.item, idx);
            const isExpanded = Boolean(expandedCards[uiKey]);
            const isPropsExpanded = Boolean(expandedProps[uiKey]);
            const isSelected = selectedItemKey === uiKey;
            const hasMatches = card.matchedBarragens.length > 0;
            const propsEntries = formatSemaPropertiesEntries(card.item.propriedadesBrutas).filter(
              e => !e.isEmpty
            );

            return (
              <div
                key={card.canonicalKey}
                style={{
                  backgroundColor: '#ffffff',
                  border: isSelected
                    ? '2px solid #0284c7'
                    : hasMatches
                    ? '1.5px solid #059669'
                    : '1px solid #cbd5e1',
                  borderLeft: hasMatches ? '5px solid #059669' : '5px solid #0369a1',
                  borderRadius: '8px',
                  overflow: 'hidden'
                }}
              >
                {/* Cabeçalho recolhido inicialmente */}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedCards(prev => ({ ...prev, [uiKey]: !prev[uiKey] }))
                  }
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: hasMatches ? '#ecfdf5' : '#f8fafc',
                    border: 'none',
                    padding: '10px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, flexWrap: 'wrap' }}>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#0f172a"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 0.15s ease',
                        flexShrink: 0
                      }}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>

                    <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
                      CAR {card.carExibicao}
                    </span>

                    <span style={{ fontSize: '12px', color: '#334155' }}>
                      · {card.nomePropriedade} ({card.municipioExibicao})
                    </span>

                    {hasMatches && (
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 700,
                          color: '#065f46',
                          backgroundColor: '#d1fae5',
                          padding: '2px 7px',
                          borderRadius: '4px'
                        }}
                      >
                        CAR correspondente a {card.matchedBarragens.length} barragem(ns) cadastrada(s)
                      </span>
                    )}
                  </div>

                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#0369a1', flexShrink: 0 }}>
                    {isExpanded ? 'Recolher' : 'Expandir'}
                  </span>
                </button>

                {isExpanded && (
                  <div style={{ padding: '12px', borderTop: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* Resumo legível e limpo */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                        gap: '8px',
                        fontSize: '12px'
                      }}
                    >
                      <div style={{ backgroundColor: '#f8fafc', padding: '7px 9px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                        <span style={{ display: 'block', fontSize: '10px', color: '#64748b' }}>CAR/MT</span>
                        <strong style={{ color: '#0f172a' }}>{card.carExibicao}</strong>
                        {card.carFederalExibicao && (
                          <span style={{ display: 'block', fontSize: '10.5px', color: '#475569' }}>
                            SICAR: {card.carFederalExibicao}
                          </span>
                        )}
                      </div>

                      <div style={{ backgroundColor: '#f8fafc', padding: '7px 9px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                        <span style={{ display: 'block', fontSize: '10px', color: '#64748b' }}>Propriedade / Imóvel</span>
                        <strong style={{ color: '#0f172a' }}>{card.nomePropriedade}</strong>
                      </div>

                      <div style={{ backgroundColor: '#f8fafc', padding: '7px 9px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                        <span style={{ display: 'block', fontSize: '10px', color: '#64748b' }}>Município</span>
                        <strong style={{ color: '#0f172a' }}>{card.municipioExibicao}</strong>
                      </div>

                      <div style={{ backgroundColor: '#f8fafc', padding: '7px 9px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                        <span style={{ display: 'block', fontSize: '10px', color: '#64748b' }}>Titular retornado (SEMA-MT)</span>
                        <strong style={{ color: '#0f172a' }}>{card.titularExibicao}</strong>
                      </div>

                      <div style={{ backgroundColor: '#f8fafc', padding: '7px 9px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                        <span style={{ display: 'block', fontSize: '10px', color: '#64748b' }}>Origem e data da consulta</span>
                        <strong style={{ color: '#0f172a', fontSize: '11px' }}>{card.camadaOrigem}</strong>
                        <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b' }}>
                          {formatConsultadoEmBr(card.consultadoEm || consultadoEm)}
                        </span>
                      </div>
                    </div>

                    {/* Destaque de correspondência com barragens já cadastradas (deduplicadas) */}
                    {card.matchedBarragens.length > 0 && (
                      <div
                        style={{
                          padding: '9px 11px',
                          backgroundColor: '#ecfdf5',
                          border: '1px solid #34d399',
                          borderRadius: '6px',
                          fontSize: '12px',
                          color: '#065f46'
                        }}
                      >
                        <strong style={{ display: 'block', marginBottom: '5px' }}>
                          CAR correspondente a barragem(ns) cadastrada(s) no sistema ({card.matchedBarragens.length}):
                        </strong>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {card.matchedBarragens.map(({ barragem, isCurrentBarragem }) => (
                            <div
                              key={String(barragem.id || barragem.nome)}
                              style={{
                                backgroundColor: '#ffffff',
                                border: '1px solid #a7f3d0',
                                borderRadius: '5px',
                                padding: '5px 8px',
                                fontSize: '11.5px',
                                color: '#064e3b'
                              }}
                            >
                              <strong>{barragem.nome || 'Barragem sem nome'}</strong>
                              {isCurrentBarragem && (
                                <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 700, color: '#0369a1' }}>
                                  [Esta barragem]
                                </span>
                              )}
                              {' · '}
                              <span>CAR: {barragem.car || '—'}</span>
                              {barragem.municipio && ` · Município: ${barragem.municipio}`}
                              {barragem.empreendimento && ` · Propriedade: ${barragem.empreendimento}`}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Todos os atributos retornados (também recolhidos inicialmente) */}
                    {propsEntries.length > 0 && (
                      <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedProps(prev => ({ ...prev, [uiKey]: !prev[uiKey] }))
                          }
                          style={{
                            width: '100%',
                            background: '#f8fafc',
                            border: 'none',
                            padding: '6px 10px',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#0369a1'
                          }}
                        >
                          <span>
                            {isPropsExpanded ? '▾' : '▸'} Atributos completos retornados ({propsEntries.length})
                          </span>
                          <span>{isPropsExpanded ? 'Recolher' : 'Expandir'}</span>
                        </button>
                        {isPropsExpanded && (
                          <div
                            style={{
                              padding: '8px 10px',
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                              gap: '6px',
                              borderTop: '1px solid #e2e8f0'
                            }}
                          >
                            {propsEntries.map(entry => (
                              <div
                                key={entry.key}
                                style={{
                                  backgroundColor: '#f8fafc',
                                  padding: '5px 7px',
                                  borderRadius: '4px',
                                  border: '1px solid #e2e8f0',
                                  fontSize: '11px'
                                }}
                              >
                                <span style={{ display: 'block', fontSize: '9.5px', color: '#64748b' }}>
                                  {entry.label}
                                </span>
                                {entry.isLink ? (
                                  <a
                                    href={entry.value}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: '#0369a1', fontWeight: 600 }}
                                  >
                                    Acessar documento ↗
                                  </a>
                                ) : (
                                  <strong style={{ color: '#0f172a', wordBreak: 'break-word' }}>
                                    {entry.value}
                                  </strong>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Ações no card */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '8px' }}>
                      {searchSource === 'coordenada' && card.carExibicao !== 'Sem número de CAR' && (
                        <button
                          type="button"
                          className="btn light small"
                          disabled={isLoading}
                          onClick={() => handleConsultarPorCar(card.carExibicao, true)}
                          style={{ fontSize: '11.5px', padding: '5px 10px', borderColor: '#0369a1', color: '#0369a1' }}
                        >
                          Consultar registros completos deste CAR na SEMA-MT
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn"
                        onClick={() => initDecisionForSelectedItem(card.item, uiKey)}
                        style={{
                          backgroundColor: isSelected ? '#0284c7' : '#0f766e',
                          color: '#ffffff',
                          border: 'none',
                          fontSize: '11.5px',
                          fontWeight: 600,
                          padding: '6px 12px'
                        }}
                      >
                        {isSelected ? 'Selecionado para revisão' : 'Analisar e vincular com este registro'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Outros registros retornados pela SEMA-MT (Licenças, Notificações, Autos, Termos) */}
          {otherDocs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <strong style={{ fontSize: '11.5px', color: '#334155' }}>
                Outros registros retornados na SEMA-MT ({otherDocs.length}):
              </strong>
              {otherDocs.map((doc, idx) => {
                const uiKey = getItemUiKey(doc, idx + 1000);
                const isDocExpanded = Boolean(expandedDocs[uiKey]);
                const isSelected = selectedItemKey === uiKey;
                const cleanTitle = cleanSemaText(doc.nomeDocumento || doc.tipo);
                const cleanDocNum = cleanSemaText(doc.numeroDocumento);
                const cleanProc = cleanSemaText(doc.numeroProcesso);
                const cleanTitular = cleanSemaText(doc.razaoSocial);

                return (
                  <div
                    key={uiKey}
                    style={{
                      backgroundColor: '#ffffff',
                      border: isSelected ? '2px solid #0284c7' : '1px solid #cbd5e1',
                      borderRadius: '7px',
                      overflow: 'hidden'
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedDocs(prev => ({ ...prev, [uiKey]: !prev[uiKey] }))
                      }
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        background: '#f8fafc',
                        border: 'none',
                        padding: '8px 11px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '12px'
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#0f172a"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{
                            transform: isDocExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                            transition: 'transform 0.15s ease'
                          }}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                        <strong style={{ color: '#0f172a' }}>
                          {doc.camadaTitulo || doc.tipo || 'Documento SEMA-MT'}
                        </strong>
                        {cleanDocNum && <span style={{ color: '#334155' }}>· Nº {cleanDocNum}</span>}
                        {cleanTitular && <span style={{ color: '#475569' }}>· {cleanTitular}</span>}
                      </span>
                      <span style={{ fontSize: '11px', color: '#0369a1', fontWeight: 600 }}>
                        {isDocExpanded ? 'Recolher' : 'Expandir'}
                      </span>
                    </button>

                    {isDocExpanded && (
                      <div style={{ padding: '10px 12px', borderTop: '1px solid #e2e8f0', fontSize: '12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginBottom: '10px' }}>
                          <div>
                            <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Descrição / Tipo</span>
                            <strong>{cleanTitle || 'Não informado'}</strong>
                          </div>
                          <div>
                            <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Titular / Interessado</span>
                            <strong>{cleanTitular || 'Não informado'}</strong>
                          </div>
                          <div>
                            <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Processo</span>
                            <strong>{cleanProc || 'Não informado'}</strong>
                          </div>
                          <div>
                            <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Origem / Consulta</span>
                            <strong>{doc.camadaOrigem}</strong>
                            <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b' }}>
                              {formatConsultadoEmBr(doc.consultadoEm || consultadoEm)}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => initDecisionForSelectedItem(doc, uiKey)}
                            style={{
                              backgroundColor: isSelected ? '#0284c7' : '#0f766e',
                              color: '#ffffff',
                              border: 'none',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              padding: '5px 12px'
                            }}
                          >
                            {isSelected ? 'Selecionado para revisão' : 'Analisar e vincular com este documento'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Painel de Identificação de Empreendedor, Comparação de Campos e Confirmação Final */}
          {selectedItem && (
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1.5px solid #0284c7',
                borderRadius: '8px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <strong style={{ fontSize: '13px', color: '#0369a1' }}>
                  Revisão analítica: vínculo de empreendedor e campos compatíveis
                </strong>
                <button
                  type="button"
                  onClick={resetDecisionOnly}
                  style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '11.5px', textDecoration: 'underline' }}
                >
                  Fechar revisão
                </button>
              </div>

              {/* Passo A: Identificação do Empreendedor */}
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '7px',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontSize: '12px'
                }}
              >
                <strong style={{ color: '#0f172a' }}>
                  Passo A · Identificação do Empreendedor
                </strong>

                {cpfInspection.status === 'completo' ? (
                  <div style={{ fontSize: '11.5px', color: '#0f172a' }}>
                    <span>
                      CPF/CNPJ completo retornado pela camada (campo confirmado{' '}
                      <code>{cpfInspection.campoOrigem}</code>):{' '}
                      <strong style={{ fontFamily: 'monospace' }}>{cpfInspection.formatted}</strong>
                    </span>

                    {cpfMatchOutcome.status === 'unico' && cpfMatchOutcome.empreendedor && (
                      <div
                        style={{
                          marginTop: '6px',
                          padding: '8px 10px',
                          backgroundColor: '#ecfdf5',
                          border: '1px solid #34d399',
                          borderRadius: '6px',
                          color: '#065f46',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '8px'
                        }}
                      >
                        <div>
                          <strong>Empreendedor único localizado no cadastro central:</strong>{' '}
                          {cpfMatchOutcome.empreendedor.nome} ({cpfMatchOutcome.empreendedor.cpfCnpj})
                        </div>
                        <button
                          type="button"
                          className="btn green small"
                          onClick={() => {
                            setEmpAction('existente');
                            setManualEmpId(String(cpfMatchOutcome.empreendedor.id));
                          }}
                        >
                          Vincular a este empreendedor
                        </button>
                      </div>
                    )}

                    {cpfMatchOutcome.status === 'ambiguo' && (
                      <div
                        style={{
                          marginTop: '6px',
                          padding: '8px 10px',
                          backgroundColor: '#fef3c7',
                          border: '1px solid #f59e0b',
                          borderRadius: '6px',
                          color: '#92400e'
                        }}
                      >
                        <strong>Atenção — Mais de um cadastro com este CPF/CNPJ ({cpfMatchOutcome.matches.length}):</strong>{' '}
                        Vínculo automático bloqueado. Selecione manualmente o registro correto abaixo após revisão.
                      </div>
                    )}

                    {cpfMatchOutcome.status === 'nao_encontrado' && (
                      <div
                        style={{
                          marginTop: '6px',
                          padding: '8px 10px',
                          backgroundColor: '#eff6ff',
                          border: '1px solid #93c5fd',
                          borderRadius: '6px',
                          color: '#1e3a8a'
                        }}
                      >
                        Nenhum empreendedor cadastrado no sistema possui este CPF/CNPJ. Você pode selecionar um cadastro existente manualmente ou cadastrar um novo empreendedor com estes dados.
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '8px 10px',
                      backgroundColor: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '6px',
                      color: '#92400e',
                      fontSize: '11.5px'
                    }}
                  >
                    <strong>CPF/CNPJ completo não disponível nesta camada:</strong>{' '}
                    {cpfInspection.status === 'mascarado'
                      ? 'A camada da SEMA-MT retornou o documento mascarado.'
                      : 'A camada consultada da SEMA-MT não possui campo de CPF/CNPJ completo confirmado via DescribeFeatureType.'}{' '}
                    Nenhum CPF/CNPJ foi inventado e nenhum vínculo automático foi criado. Selecione manualmente o empreendedor abaixo.
                  </div>
                )}

                {/* Candidatos apenas para revisão manual */}
                {manualCandidates.length > 0 && cpfMatchOutcome.status !== 'unico' && (
                  <div
                    style={{
                      padding: '8px 10px',
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px'
                    }}
                  >
                    <strong style={{ fontSize: '11px', color: '#334155', display: 'block', marginBottom: '4px' }}>
                      Candidatos por nome para revisão manual (não vinculados automaticamente):
                    </strong>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {manualCandidates.map(({ empreendedor, motivo }) => (
                        <div
                          key={String(empreendedor.id)}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px',
                            flexWrap: 'wrap',
                            fontSize: '11.5px',
                            padding: '4px 6px',
                            backgroundColor: '#f8fafc',
                            borderRadius: '4px'
                          }}
                        >
                          <span>
                            <strong>{empreendedor.nome}</strong>
                            {empreendedor.cpfCnpj ? ` (${empreendedor.cpfCnpj})` : ''} ·{' '}
                            <span style={{ color: '#64748b' }}>{motivo}</span>
                          </span>
                          <button
                            type="button"
                            className="btn light small"
                            style={{ fontSize: '11px', padding: '3px 8px' }}
                            onClick={() => {
                              setEmpAction('existente');
                              setManualEmpId(String(empreendedor.id));
                            }}
                          >
                            Selecionar para revisão
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Opções explícitas de escolha de empreendedor */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="sema-emp-action"
                      checked={empAction === 'nenhum'}
                      onChange={() => setEmpAction('nenhum')}
                    />
                    <span>Não vincular empreendedor agora (apenas atualizar campos da barragem)</span>
                  </label>

                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="sema-emp-action"
                      checked={empAction === 'existente'}
                      onChange={() => setEmpAction('existente')}
                    />
                    <span>Selecionar empreendedor cadastrado</span>
                  </label>

                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="sema-emp-action"
                      checked={empAction === 'criar_novo'}
                      onChange={() => setEmpAction('criar_novo')}
                    />
                    <span>Cadastrar novo empreendedor a partir dos dados da SEMA-MT</span>
                  </label>
                </div>

                {empAction === 'existente' && (
                  <div>
                    <select
                      className="select"
                      value={manualEmpId}
                      onChange={e => setManualEmpId(e.target.value)}
                      style={{ fontSize: '12px', padding: '6px 8px', backgroundColor: '#ffffff' }}
                    >
                      <option value="">Selecione o empreendedor existente...</option>
                      {sortedActiveEmpreendedores.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.nome}
                          {emp.cpfCnpj ? ` · ${emp.cpfCnpj}` : ''}
                          {emp.situacao && emp.situacao !== 'Ativo' ? ` (${emp.situacao})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {empAction === 'criar_novo' && (
                  <div
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '10px',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: '8px'
                    }}
                  >
                    <div>
                      <label style={{ fontSize: '10.5px', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                        Tipo de pessoa
                      </label>
                      <select
                        className="select"
                        value={newEmpDraft.tipoPessoa}
                        onChange={e =>
                          setNewEmpDraft(prev => ({
                            ...prev,
                            tipoPessoa: e.target.value as 'Pessoa física' | 'Pessoa jurídica'
                          }))
                        }
                        style={{ fontSize: '12px', padding: '5px 8px' }}
                      >
                        <option value="Pessoa jurídica">Pessoa jurídica</option>
                        <option value="Pessoa física">Pessoa física</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: '10.5px', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                        Nome / Razão social · obrigatório
                      </label>
                      <input
                        type="text"
                        className="input"
                        value={newEmpDraft.nome}
                        onChange={e => setNewEmpDraft(prev => ({ ...prev, nome: e.target.value }))}
                        style={{ fontSize: '12px', padding: '5px 8px' }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '10.5px', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                        CPF/CNPJ completo (11 ou 14 dígitos) · obrigatório
                      </label>
                      <input
                        type="text"
                        className="input"
                        value={newEmpDraft.cpfCnpj}
                        onChange={e =>
                          setNewEmpDraft(prev => ({
                            ...prev,
                            cpfCnpj: formatCpfCnpjInput(e.target.value)
                          }))
                        }
                        placeholder="Informe CPF ou CNPJ completo"
                        style={{ fontSize: '12px', padding: '5px 8px' }}
                      />
                      {duplicateCheckForNewEmp.hasDuplicate && duplicateCheckForNewEmp.existing && (
                        <span style={{ display: 'block', fontSize: '11px', color: '#dc2626', fontWeight: 600, marginTop: '3px' }}>
                          Duplicidade detectada: já existe "{duplicateCheckForNewEmp.existing.nome}" com este CPF/CNPJ. Selecione-o como empreendedor existente em vez de duplicar.
                        </span>
                      )}
                    </div>

                    <div>
                      <label style={{ fontSize: '10.5px', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                        UF
                      </label>
                      <input
                        type="text"
                        className="input"
                        maxLength={2}
                        value={newEmpDraft.uf}
                        onChange={e =>
                          setNewEmpDraft(prev => ({
                            ...prev,
                            uf: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
                          }))
                        }
                        placeholder="MT"
                        style={{ fontSize: '12px', padding: '5px 8px' }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '10.5px', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                        Município
                      </label>
                      <input
                        type="text"
                        className="input"
                        value={newEmpDraft.municipio}
                        onChange={e => {
                          const val = e.target.value;
                          const matchedIbge = mtMunicipios.find(
                            m => m.nome.toLowerCase() === val.trim().toLowerCase()
                          );
                          setNewEmpDraft(prev => ({
                            ...prev,
                            municipio: val,
                            municipioIbge: matchedIbge ? String(matchedIbge.id) : prev.municipioIbge
                          }));
                        }}
                        placeholder="Município"
                        style={{ fontSize: '12px', padding: '5px 8px' }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '10.5px', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                        Código IBGE
                      </label>
                      <input
                        type="text"
                        className="input"
                        value={newEmpDraft.municipioIbge}
                        onChange={e =>
                          setNewEmpDraft(prev => ({
                            ...prev,
                            municipioIbge: e.target.value.replace(/\D/g, '').slice(0, 7)
                          }))
                        }
                        placeholder="Ex: 5103403"
                        style={{ fontSize: '12px', padding: '5px 8px' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Passo B: Comparação lado a lado dos campos compatíveis da barragem */}
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '7px',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontSize: '12px'
                }}
              >
                <div>
                  <strong style={{ color: '#0f172a', display: 'block' }}>
                    Passo B · Seleção por campo compatível da barragem
                  </strong>
                  <span style={{ fontSize: '11px', color: '#475569' }}>
                    Coordenadas (latitude/longitude), altura, volume, DPA, CRI e situação cadastral são protegidos e nunca são sobrescritos por consultas SEMA-MT.
                  </span>
                </div>

                {fieldComparisons.length === 0 ? (
                  <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                    Nenhum campo compatível adicional foi retornado por esta camada.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {fieldComparisons.map(comp => {
                      const currentAction = fieldActions[comp.key] || comp.action;
                      return (
                        <div
                          key={comp.key}
                          style={{
                            backgroundColor: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            padding: '8px 10px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '5px' }}>
                            <strong style={{ color: '#0f172a' }}>{comp.label}</strong>
                            {comp.isEqual ? (
                              <span style={{ fontSize: '11px', color: '#059669', fontWeight: 600 }}>
                                ✓ Igual ao cadastro atual
                              </span>
                            ) : comp.isEmptyCurrent ? (
                              <span style={{ fontSize: '11px', color: '#0369a1', fontWeight: 600 }}>
                                Campo vazio no sistema
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 600 }}>
                                Divergente do cadastro atual
                              </span>
                            )}
                          </div>

                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                              gap: '8px',
                              fontSize: '11.5px',
                              marginBottom: comp.isEqual ? '0' : '6px'
                            }}
                          >
                            <div>
                              <span style={{ color: '#64748b', display: 'block', fontSize: '10px' }}>Atual no sistema</span>
                              <span style={{ color: '#334155' }}>{comp.currentDisplay}</span>
                            </div>
                            <div>
                              <span style={{ color: '#64748b', display: 'block', fontSize: '10px' }}>Retornado pela SEMA-MT</span>
                              <strong style={{ color: '#0369a1' }}>{comp.semaDisplay}</strong>
                            </div>
                          </div>

                          {!comp.isEqual && (
                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '11.5px', paddingTop: '5px', borderTop: '1px dashed #e2e8f0' }}>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                <input
                                  type="radio"
                                  name={`field-action-${comp.key}`}
                                  checked={currentAction === 'manter'}
                                  onChange={() =>
                                    setFieldActions(prev => ({ ...prev, [comp.key]: 'manter' }))
                                  }
                                />
                                <span>Manter valor atual</span>
                              </label>

                              {comp.isEmptyCurrent ? (
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#0369a1', fontWeight: 600 }}>
                                  <input
                                    type="radio"
                                    name={`field-action-${comp.key}`}
                                    checked={currentAction === 'preencher'}
                                    onChange={() =>
                                      setFieldActions(prev => ({ ...prev, [comp.key]: 'preencher' }))
                                    }
                                  />
                                  <span>Preencher campo vazio</span>
                                </label>
                              ) : (
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#b45309', fontWeight: 600 }}>
                                  <input
                                    type="radio"
                                    name={`field-action-${comp.key}`}
                                    checked={currentAction === 'substituir'}
                                    onChange={() =>
                                      setFieldActions(prev => ({ ...prev, [comp.key]: 'substituir' }))
                                    }
                                  />
                                  <span>Substituir valor divergente</span>
                                </label>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Passo C: Confirmação Final Explícita */}
              {!awaitingFinalConfirm ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn light"
                    onClick={resetDecisionOnly}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Cancelar revisão
                  </button>
                  <button
                    type="button"
                    className="btn green"
                    disabled={!canProceedToConfirm}
                    onClick={() => setAwaitingFinalConfirm(true)}
                    style={{
                      fontSize: '12px',
                      padding: '6px 14px',
                      opacity: canProceedToConfirm ? 1 : 0.55
                    }}
                  >
                    Revisar e confirmar vínculo
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    backgroundColor: '#eff6ff',
                    border: '1.5px solid #2563eb',
                    borderRadius: '7px',
                    padding: '10px 12px',
                    fontSize: '12px',
                    color: '#1e3a8a',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}
                >
                  <strong>Confirmação final necessária antes de gravar no cadastro mestre:</strong>
                  <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: 1.6 }}>
                    {empAction === 'existente' && selectedExistingEmpreendedor && (
                      <li>
                        Vincular empreendedor existente: <b>{selectedExistingEmpreendedor.nome}</b>
                        {selectedExistingEmpreendedor.cpfCnpj ? ` (${selectedExistingEmpreendedor.cpfCnpj})` : ''}
                      </li>
                    )}
                    {empAction === 'criar_novo' && (
                      <li>
                        Criar e vincular novo empreendedor: <b>{newEmpDraft.nome}</b> ({newEmpDraft.tipoPessoa} · {newEmpDraft.cpfCnpj})
                        {newEmpDraft.municipio
                          ? ` · ${newEmpDraft.municipio}${newEmpDraft.uf ? `/${newEmpDraft.uf}` : ''}`
                          : newEmpDraft.uf
                          ? ` · ${newEmpDraft.uf}`
                          : ''}
                        {newEmpDraft.municipioIbge ? ` · IBGE ${newEmpDraft.municipioIbge}` : ''}
                      </li>
                    )}
                    {selectedFieldsToApply.map(f => (
                      <li key={f.key}>
                        {f.action === 'preencher' ? 'Preencher' : 'Substituir'} <b>{f.label}</b> para:{' '}
                        <code>{f.semaValue}</code>
                      </li>
                    ))}
                    <li>
                      Proveniência registrada: origem <b>SEMA-MT</b> ({selectedItem.camadaOrigem} · {formatConsultadoEmBr(selectedItem.consultadoEm || consultadoEm)})
                    </li>
                  </ul>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn light"
                      disabled={isSaving}
                      onClick={() => setAwaitingFinalConfirm(false)}
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="btn green"
                      disabled={isSaving}
                      onClick={handleFinalConfirm}
                      style={{ fontSize: '12px', padding: '6px 14px' }}
                    >
                      {isSaving ? 'Gravando...' : 'Confirmar vínculo e gravar dados selecionados'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
