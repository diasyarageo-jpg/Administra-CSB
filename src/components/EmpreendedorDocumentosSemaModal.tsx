// src/components/EmpreendedorDocumentosSemaModal.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { consultarDocumentosSema } from '../services/carLookupService';
import { getEmpreendedorVinculos } from '../services/notificaDataService';
import {
  CamadaConsultaStatus,
  SemaDocumentosGroupedResult,
  SemaDocumentoItem
} from '../types/carLookup';
import {
  formatCpfCnpjReadable,
  formatSemaPropertiesEntries,
  stripOuterQuotesAndBrackets
} from '../config/carCampos';

interface EmpreendedorDocumentosSemaModalProps {
  empreendedor: any;
  barragens?: any[];
  onClose: () => void;
}

export function EmpreendedorDocumentosSemaModal({
  empreendedor,
  barragens = [],
  onClose
}: EmpreendedorDocumentosSemaModalProps) {
  const vinculos = useMemo(
    () => getEmpreendedorVinculos(empreendedor, barragens),
    [empreendedor, barragens]
  );

  const initialDoc = String(empreendedor?.cpfCnpj || '').trim();
  const initialHasValidDigits = [11, 14].includes(initialDoc.replace(/\D/g, '').length);
  const initialNome = String(empreendedor?.nome || '').trim();
  const initialCarStr = vinculos.cars.join(', ');
  const initialProcStr = vinculos.processos.join(', ');
  const hasInitialCriteria =
    initialHasValidDigits ||
    vinculos.cars.length > 0 ||
    vinculos.processos.length > 0 ||
    vinculos.coordenadas.length > 0;

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [data, setData] = useState<SemaDocumentosGroupedResult | null>(null);
  const [activeTab, setActiveTab] = useState<
    'car' | 'licencas' | 'notificacoes' | 'autos' | 'embargos' | 'diagnostico'
  >('car');
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);
  const [showEmptyByKey, setShowEmptyByKey] = useState<Record<string, boolean>>({});

  const [buscaCpfCnpj, setBuscaCpfCnpj] = useState<string>(initialDoc);
  const [buscaCar, setBuscaCar] = useState<string>(initialCarStr);
  const [buscaProcesso, setBuscaProcesso] = useState<string>(initialProcStr);
  const [buscaNome, setBuscaNome] = useState<string>(initialNome);
  const [usarCoordsBarragens, setUsarCoordsBarragens] = useState<boolean>(
    vinculos.coordenadas.length > 0
  );
  const [usarBuscaExploratoria, setUsarBuscaExploratoria] = useState<boolean>(
    !hasInitialCriteria && initialNome.length >= 3
  );

  const executarConsulta = (opts?: {
    cpfCnpj?: string;
    car?: string;
    processo?: string;
    nome?: string;
    exploratoria?: boolean;
    usarCoords?: boolean;
  }) => {
    const doc = opts?.cpfCnpj !== undefined ? opts.cpfCnpj : buscaCpfCnpj;
    const carVal = opts?.car !== undefined ? opts.car : buscaCar;
    const procVal = opts?.processo !== undefined ? opts.processo : buscaProcesso;
    const nomeVal = opts?.nome !== undefined ? opts.nome : buscaNome;
    const exploratoria =
      opts?.exploratoria !== undefined ? opts.exploratoria : usarBuscaExploratoria;
    const incluirCoords =
      opts?.usarCoords !== undefined ? opts.usarCoords : usarCoordsBarragens;

    const carsExtra = carVal
      .split(/[,;\n]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const procsExtra = procVal
      .split(/[,;\n]+/)
      .map(s => s.trim())
      .filter(Boolean);

    setIsLoading(true);
    setExpandedItemKey(null);

    consultarDocumentosSema({
      cpfCnpj: doc,
      car: carsExtra[0] || carVal,
      cars: carsExtra,
      processo: procsExtra[0] || procVal,
      processos: procsExtra,
      coordenadas: incluirCoords ? vinculos.coordenadas : [],
      nome: nomeVal,
      buscaExploratoria: exploratoria
    })
      .then(res => {
        setData(res);
        if (res.carImoveis.length > 0) setActiveTab('car');
        else if (res.licencas.length > 0) setActiveTab('licencas');
        else if (res.notificacoes.length > 0) setActiveTab('notificacoes');
        else if (res.autosInfracao.length > 0) setActiveTab('autos');
        else if (res.termosEmbargo.length > 0) setActiveTab('embargos');
        else setActiveTab('car');
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    const doc = String(empreendedor?.cpfCnpj || '').trim();
    const digitsLen = doc.replace(/\D/g, '').length;
    const nome = String(empreendedor?.nome || '').trim();
    const hasDoc = digitsLen === 11 || digitsLen === 14;
    const carStr = vinculos.cars.join(', ');
    const procStr = vinculos.processos.join(', ');
    const hasCar = vinculos.cars.length > 0;
    const hasProc = vinculos.processos.length > 0;
    const hasCoords = vinculos.coordenadas.length > 0;

    setBuscaCpfCnpj(doc);
    setBuscaNome(nome);
    setBuscaCar(carStr);
    setBuscaProcesso(procStr);
    setUsarCoordsBarragens(hasCoords);

    const expl = !hasDoc && !hasCar && !hasProc && !hasCoords && nome.length >= 3;
    setUsarBuscaExploratoria(expl);

    if (hasDoc || hasCar || hasProc || hasCoords || expl) {
      executarConsulta({
        cpfCnpj: hasDoc ? doc : '',
        car: carStr,
        processo: procStr,
        nome,
        exploratoria: expl,
        usarCoords: hasCoords
      });
    } else {
      setData(null);
    }
  }, [empreendedor, vinculos]);

  const getGroupStatuses = (grupos: string[]): CamadaConsultaStatus[] => {
    if (!data?.camadasConsultadas) return [];
    return data.camadasConsultadas.filter(c => grupos.includes(c.grupo || ''));
  };

  const renderGroupStateAlert = (
    items: SemaDocumentoItem[],
    grupos: string[],
    emptyLabel: string
  ) => {
    if (!data) return null;

    if (data.erroGeral) {
      return (
        <div
          style={{
            padding: '18px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#991b1b',
            fontSize: '13px'
          }}
        >
          <strong>Falha na consulta à base da SEMA-MT:</strong> {data.erroGeral}
        </div>
      );
    }

    const groupStatuses = getGroupStatuses(grupos);
    const consultadasOk = groupStatuses.filter(
      s => s.status === 'consultada' || s.status === 'sem_resultados'
    );
    const falhas = groupStatuses.filter(
      s =>
        s.status === 'erro_comunicacao' ||
        s.status === 'indisponivel' ||
        s.status === 'filtro_incompativel'
    );
    const naoSuportadas = groupStatuses.filter(s => s.status === 'nao_suportado');

    if (items.length > 0) {
      return (
        <>
          {falhas.length > 0 && (
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#92400e',
                marginBottom: '12px'
              }}
            >
              <strong>Atenção parcial:</strong> {falhas.length} base(s) deste grupo estavam temporariamente indisponíveis ({falhas.map(f => f.titulo || f.camada.replace('Geoportal:', '')).join(', ')}).
            </div>
          )}
        </>
      );
    }

    if (consultadasOk.length === 0 && falhas.length > 0) {
      return (
        <div
          style={{
            padding: '18px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#991b1b',
            fontSize: '12.5px'
          }}
        >
          <strong style={{ display: 'block', marginBottom: '6px' }}>
            Consulta temporariamente indisponível
          </strong>
          {falhas.map(f => (
            <div key={f.camada} style={{ marginTop: '4px' }}>
              <strong>{f.titulo || f.camada.replace('Geoportal:', '')}:</strong> {f.mensagem}
            </div>
          ))}
        </div>
      );
    }

    if (consultadasOk.length === 0 && naoSuportadas.length > 0) {
      return (
        <div
          style={{
            padding: '18px',
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '8px',
            color: '#92400e',
            fontSize: '12.5px',
            lineHeight: 1.5
          }}
        >
          <strong style={{ display: 'block', marginBottom: '6px' }}>
            Critério não suficiente para consulta direta neste grupo
          </strong>
          {naoSuportadas.map(n => (
            <div key={n.camada} style={{ marginTop: '4px' }}>
              <strong>{n.titulo || n.camada.replace('Geoportal:', '')}:</strong> {n.mensagem}
            </div>
          ))}
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#78350f' }}>
            Informe o <strong>Número do CAR/MT</strong>, vincule uma barragem com coordenadas ou ative a <strong>busca exploratória por nome</strong>.
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          padding: '20px',
          textAlign: 'center',
          backgroundColor: '#f8fafc',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          color: '#475569',
          fontSize: '12.5px'
        }}
      >
        <strong style={{ display: 'block', color: '#334155', marginBottom: '4px' }}>
          Nenhum registro encontrado
        </strong>
        <span>{emptyLabel}</span>
        {falhas.length > 0 && (
          <div style={{ marginTop: '6px', fontSize: '11.5px', color: '#991b1b' }}>
            Falha parcial em {falhas.length} base(s): {falhas.map(f => f.titulo || f.camada.replace('Geoportal:', '')).join(', ')}.
          </div>
        )}
      </div>
    );
  };

  const renderSemaStructuredGrid = (
    propriedadesBrutas: Record<string, any> | undefined | null,
    itemKey: string
  ) => {
    const allEntries = formatSemaPropertiesEntries(propriedadesBrutas);
    if (allEntries.length === 0) return null;

    const filledEntries = allEntries.filter(e => !e.isEmpty);
    const emptyEntries = allEntries.filter(e => e.isEmpty);
    const showEmpty = Boolean(showEmptyByKey[itemKey]);
    const visibleEntries = showEmpty || filledEntries.length === 0 ? allEntries : filledEntries;

    return (
      <div
        style={{
          marginTop: '12px',
          padding: '12px',
          backgroundColor: '#f8fafc',
          borderRadius: '8px',
          border: '1px solid #e2e8f0'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
          <strong style={{ fontSize: '11.5px', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Ficha Completa Retornada pela SEMA-MT ({filledEntries.length} preenchido(s) · {allEntries.length} total)
          </strong>
          {emptyEntries.length > 0 && filledEntries.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setShowEmptyByKey(prev => ({ ...prev, [itemKey]: !prev[itemKey] }))
              }
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '3px 9px',
                color: '#0369a1',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 600
              }}
            >
              {showEmpty
                ? `Ocultar ${emptyEntries.length} campo(s) sem preenchimento`
                : `Exibir também ${emptyEntries.length} campo(s) sem preenchimento`}
            </button>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))',
            gap: '8px'
          }}
        >
          {visibleEntries.map(entry => (
            <div
              key={entry.key}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '8px 10px',
                opacity: entry.isEmpty ? 0.72 : 1
              }}
            >
              <span
                style={{
                  display: 'block',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  color: '#64748b',
                  marginBottom: '2px'
                }}
              >
                {entry.label}
              </span>
              {entry.isLink ? (
                <a
                  href={entry.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '12px',
                    color: '#0369a1',
                    fontWeight: 600,
                    wordBreak: 'break-all',
                    textDecoration: 'underline'
                  }}
                >
                  Acessar link oficial ↗
                </a>
              ) : (
                <span
                  style={{
                    fontSize: '12.5px',
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
  };

  const renderCarImoveisList = (items: SemaDocumentoItem[]) => {
    const alertBlock = renderGroupStateAlert(
      items,
      ['carImoveis'],
      'Nenhum imóvel rural ou cadastro ambiental encontrado na base da SEMA-MT para os critérios informados.'
    );

    if (items.length === 0) return alertBlock;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {alertBlock}
        {items.map((item, idx) => {
          const itemKey = String(item.id ?? `${item.camadaOrigem}-${idx}`);
          const isCollapsed = expandedItemKey === `hide:${itemKey}`;
          const cleanTitulo = stripOuterQuotesAndBrackets(item.nomeDocumento || '') || 'Imóvel Rural / CAR';
          const cleanStatus = item.status ? stripOuterQuotesAndBrackets(item.status) : '';
          const cleanOwners = item.razaoSocial ? stripOuterQuotesAndBrackets(item.razaoSocial) : '';
          const cleanDocNumber = item.numeroDocumento ? stripOuterQuotesAndBrackets(item.numeroDocumento) : '';
          const cleanCpfCnpj = item.cpfCnpjMascarado ? formatCpfCnpjReadable(item.cpfCnpjMascarado) || item.cpfCnpjMascarado : '';

          return (
            <div
              key={itemKey}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderLeft: '4px solid #0284c7',
                borderRadius: '10px',
                padding: '15px 16px',
                boxShadow: '0 2px 6px rgba(15, 23, 42, 0.05)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ flex: '1 1 320px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: '#e0f2fe',
                        color: '#0369a1'
                      }}
                    >
                      {item.camadaTitulo || item.camadaOrigem.replace('Geoportal:', '')}
                    </span>
                    <strong style={{ fontSize: '15px', color: '#0f172a' }}>
                      {cleanTitulo}
                    </strong>
                    {cleanStatus && (
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '10.5px',
                          fontWeight: 600,
                          backgroundColor: '#f1f5f9',
                          color: '#334155',
                          border: '1px solid #e2e8f0'
                        }}
                      >
                        {cleanStatus}
                      </span>
                    )}
                    {item.correspondenciaExploratoria && (
                      <span
                        style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 600,
                          backgroundColor: '#fef3c7',
                          color: '#92400e'
                        }}
                      >
                        Busca exploratória por nome
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '12.5px', color: '#334155', marginTop: '8px' }}>
                    {cleanDocNumber && (
                      <div>
                        <span style={{ color: '#64748b' }}>CAR Estadual: </span>
                        <strong style={{ color: '#0369a1' }}>{cleanDocNumber}</strong>
                      </div>
                    )}
                    {item.carFederal && (
                      <div>
                        <span style={{ color: '#64748b' }}>CAR Federal (SICAR): </span>
                        <strong style={{ color: '#0f172a', fontFamily: 'monospace', fontSize: '12px' }}>
                          {stripOuterQuotesAndBrackets(item.carFederal)}
                        </strong>
                      </div>
                    )}
                    {cleanCpfCnpj && (
                      <div>
                        <span style={{ color: '#64748b' }}>CPF / CNPJ: </span>
                        <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{cleanCpfCnpj}</strong>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ fontSize: '12px', color: '#475569', textAlign: 'right' }}>
                  {item.areaHa && (
                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '13px' }}>
                      Área: {item.areaHa}
                    </div>
                  )}
                  {item.municipio && <div style={{ marginTop: '2px' }}>{stripOuterQuotesAndBrackets(item.municipio)}</div>}
                </div>
              </div>

              {cleanOwners && (
                <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#0f172a', backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', padding: '8px 12px', borderRadius: '6px' }}>
                  <strong style={{ color: '#0369a1' }}>Nome dos Proprietários: </strong>
                  <span>{cleanOwners}</span>
                </div>
              )}

              <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  {item.linkDocumento && (
                    <a
                      href={item.linkDocumento}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn light"
                      style={{ fontSize: '11.5px', padding: '4px 10px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <span>↗</span> Acessar documento oficial
                    </a>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setExpandedItemKey(isCollapsed ? null : `hide:${itemKey}`)}
                  style={{ background: 'none', border: 'none', color: '#0369a1', cursor: 'pointer', fontSize: '11.5px', fontWeight: 600, textDecoration: 'underline' }}
                >
                  {isCollapsed ? 'Exibir todos os campos retornados' : 'Recolher ficha completa'}
                </button>
              </div>

              {!isCollapsed && renderSemaStructuredGrid(item.propriedadesBrutas, itemKey)}
            </div>
          );
        })}
      </div>
    );
  };

  const renderDocumentList = (
    items: SemaDocumentoItem[],
    grupos: string[],
    emptyLabel: string
  ) => {
    const alertBlock = renderGroupStateAlert(items, grupos, emptyLabel);
    if (items.length === 0) return alertBlock;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {alertBlock}
        {items.map((item, idx) => {
          const itemKey = String(item.id ?? `${item.camadaOrigem}-${idx}`);
          const isCollapsed = expandedItemKey === `hide:${itemKey}`;
          const cleanTipo = stripOuterQuotesAndBrackets(item.tipo || '');
          const cleanNumero = stripOuterQuotesAndBrackets(item.numeroDocumento || '');
          const cleanNome = stripOuterQuotesAndBrackets(item.nomeDocumento || '');
          const cleanStatus = item.status ? stripOuterQuotesAndBrackets(item.status) : '';
          const cleanTitular = item.razaoSocial ? stripOuterQuotesAndBrackets(item.razaoSocial) : '';
          const cleanCpfCnpj = item.cpfCnpjMascarado ? formatCpfCnpjReadable(item.cpfCnpjMascarado) || item.cpfCnpjMascarado : '';

          return (
            <div
              key={itemKey}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderLeft: '4px solid #0f766e',
                borderRadius: '10px',
                padding: '14px 16px',
                boxShadow: '0 2px 6px rgba(15, 23, 42, 0.04)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className="badge blue" style={{ fontSize: '10.5px' }}>{cleanTipo}</span>
                    <strong style={{ fontSize: '14px', color: '#0f172a' }}>
                      {cleanNumero ? `Nº ${cleanNumero}` : 'Registro SEMA-MT'}
                    </strong>
                    {cleanStatus && (
                      <span className="badge gray" style={{ fontSize: '10.5px' }}>
                        {cleanStatus}
                      </span>
                    )}
                    {item.correspondenciaExploratoria && (
                      <span
                        style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 600,
                          backgroundColor: '#fef3c7',
                          color: '#92400e'
                        }}
                      >
                        Exploratória por nome
                      </span>
                    )}
                  </div>
                  {cleanNome && cleanNome !== cleanTipo && (
                    <div style={{ fontSize: '12.5px', color: '#334155', fontWeight: 600, marginTop: '4px' }}>
                      {cleanNome}
                    </div>
                  )}
                </div>

                <div style={{ fontSize: '11.5px', color: '#64748b', textAlign: 'right' }}>
                  {item.dataDocumento && <div>Data: <strong style={{ color: '#0f172a' }}>{stripOuterQuotesAndBrackets(item.dataDocumento)}</strong></div>}
                  {item.dataValidade && <div>Vencimento/Validade: <strong style={{ color: '#0f172a' }}>{stripOuterQuotesAndBrackets(item.dataValidade)}</strong></div>}
                </div>
              </div>

              <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#334155', display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
                {cleanTitular && (
                  <div>
                    <span style={{ color: '#64748b' }}>Titular / Razão Social: </span>
                    <strong style={{ color: '#0f172a' }}>{cleanTitular}</strong>
                  </div>
                )}
                {cleanCpfCnpj && (
                  <div>
                    <span style={{ color: '#64748b' }}>CPF / CNPJ: </span>
                    <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{cleanCpfCnpj}</strong>
                  </div>
                )}
                {item.numeroProcesso && (
                  <div>
                    <span style={{ color: '#64748b' }}>Processo/Protocolo: </span>
                    <strong>{stripOuterQuotesAndBrackets(item.numeroProcesso)}</strong>
                  </div>
                )}
                {item.municipio && (
                  <div>
                    <span style={{ color: '#64748b' }}>Município: </span>
                    <strong>{stripOuterQuotesAndBrackets(item.municipio)}</strong>
                  </div>
                )}
                {item.camadaTitulo && (
                  <div>
                    <span style={{ color: '#64748b' }}>Base: </span>
                    <span>{item.camadaTitulo}</span>
                  </div>
                )}
              </div>

              <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  {item.linkDocumento && (
                    <a
                      href={item.linkDocumento}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn light"
                      style={{ fontSize: '11.5px', padding: '4px 10px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <span>↗</span> Acessar documento oficial
                    </a>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setExpandedItemKey(isCollapsed ? null : `hide:${itemKey}`)}
                  style={{ background: 'none', border: 'none', color: '#0369a1', cursor: 'pointer', fontSize: '11.5px', fontWeight: 600, textDecoration: 'underline' }}
                >
                  {isCollapsed ? 'Exibir todos os campos retornados' : 'Recolher ficha completa'}
                </button>
              </div>

              {!isCollapsed && renderSemaStructuredGrid(item.propriedadesBrutas, itemKey)}
            </div>
          );
        })}
      </div>
    );
  };

  const renderStatusBadge = (st: CamadaConsultaStatus['status']) => {
    const map: Record<CamadaConsultaStatus['status'], { label: string; bg: string; fg: string }> = {
      consultada: { label: 'Registros encontrados', bg: '#dcfce7', fg: '#166534' },
      sem_resultados: { label: 'Sem registros para este filtro', bg: '#f1f5f9', fg: '#334155' },
      nao_suportado: { label: 'Critério não aplicável', bg: '#fef3c7', fg: '#92400e' },
      filtro_incompativel: { label: 'Filtro não aplicável', bg: '#fee2e2', fg: '#991b1b' },
      indisponivel: { label: 'Temporariamente indisponível', bg: '#fee2e2', fg: '#991b1b' },
      erro_comunicacao: { label: 'Falha temporária', bg: '#fee2e2', fg: '#991b1b' }
    };
    const cfg = map[st];
    return (
      <span
        style={{
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '10.5px',
          fontWeight: 600,
          backgroundColor: cfg.bg,
          color: cfg.fg
        }}
      >
        {cfg.label}
      </span>
    );
  };

  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(940px, 98vw)' }}>
        <div className="modal-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0, wordBreak: 'break-word' }}>
              Consulta Pública SEMA-MT · {empreendedor?.nome || empreendedor?.nomeFantasia || 'Empreendedor'}
            </h3>
            <span style={{ fontSize: '11.5px', color: '#64748b' }}>
              Pesquisa integrada de CAR / Imóveis, Licenças, Notificações, Autos e Embargos na base da SEMA-MT
            </span>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '78vh', overflowY: 'auto', padding: '16px' }}>
          {/* Ficha visível do empreendedor selecionado */}
          <div
            style={{
              padding: '12px 14px',
              background: 'linear-gradient(135deg, #f8fafc 0%, #f0f9ff 100%)',
              border: '1px solid #bae6fd',
              borderLeft: '4px solid #0284c7',
              borderRadius: '10px',
              marginBottom: '12px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0369a1', display: 'block' }}>
                  Empreendedor em Consulta
                </span>
                <div style={{ fontSize: '16.5px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                  {empreendedor?.nome || empreendedor?.nomeFantasia || 'Nome não informado'}
                </div>
                {empreendedor?.nomeFantasia && (
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                    Nome Fantasia: <strong style={{ color: '#334155' }}>{empreendedor.nomeFantasia}</strong>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '5px 10px' }}>
                  <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>CPF / CNPJ</span>
                  <strong style={{ fontSize: '12.5px', color: '#0f172a', fontFamily: 'monospace' }}>
                    {formatCpfCnpjReadable(empreendedor?.cpfCnpj) || empreendedor?.cpfCnpj || 'Não informado'}
                  </strong>
                </div>
                <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '5px 10px' }}>
                  <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Situação</span>
                  <strong style={{ fontSize: '12px', color: '#0f172a' }}>{empreendedor?.situacao || 'Ativo'}</strong>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginTop: '8px', fontSize: '12px', color: '#334155' }}>
              <span>
                <span style={{ color: '#64748b' }}>Tipo: </span>
                <strong>{empreendedor?.tipoPessoa || 'Pessoa jurídica'}</strong>
              </span>
              <span>
                <span style={{ color: '#64748b' }}>Município / UF: </span>
                <strong>
                  {empreendedor?.municipio
                    ? `${empreendedor.municipio}${empreendedor?.uf ? `/${empreendedor.uf}` : ''}`
                    : empreendedor?.uf || 'Não informado'}
                </strong>
              </span>
              {empreendedor?.email && (
                <span>
                  <span style={{ color: '#64748b' }}>E-mail: </span>
                  <strong>{empreendedor.email}</strong>
                </span>
              )}
              {empreendedor?.telefone && (
                <span>
                  <span style={{ color: '#64748b' }}>Telefone: </span>
                  <strong>{empreendedor.telefone}</strong>
                </span>
              )}
            </div>
          </div>
          {/* Resumo automático dos vínculos entre empreendedor e barragens */}
          {vinculos.barragensVinculadas.length > 0 && (
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: '#f0f9ff',
                border: '1px solid #bae6fd',
                borderRadius: '8px',
                marginBottom: '14px',
                fontSize: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <strong style={{ color: '#0369a1' }}>
                  Dados cruzados de {vinculos.barragensVinculadas.length} barragem(ns) vinculada(s) a este empreendedor:
                </strong>
                {vinculos.coordenadas.length > 0 && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#0369a1', cursor: 'pointer', fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={usarCoordsBarragens}
                      onChange={e => setUsarCoordsBarragens(e.target.checked)}
                    />
                    <span>Usar coordenadas das barragens ({vinculos.coordenadas.length} ponto(s))</span>
                  </label>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '11.5px', color: '#334155' }}>
                <span>
                  <strong>CAR/MT localizados:</strong>{' '}
                  {vinculos.cars.length > 0 ? vinculos.cars.join(', ') : 'Nenhum informado nas barragens'}
                </span>
                {vinculos.processos.length > 0 && (
                  <span>
                    · <strong>Processos:</strong> {vinculos.processos.join(', ')}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Barra de Filtros */}
          <div
            style={{
              padding: '12px 14px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              marginBottom: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <strong style={{ fontSize: '12px', color: '#1e293b' }}>
              Critérios da Consulta na Base da SEMA-MT:
            </strong>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '3px' }}>
                  CPF / CNPJ:
                </label>
                <input
                  type="text"
                  value={buscaCpfCnpj}
                  onChange={e => setBuscaCpfCnpj(e.target.value)}
                  placeholder="11 ou 14 dígitos"
                  style={{ width: '100%', fontSize: '12px', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '3px' }}>
                  Nº(s) do CAR/MT ou CAR Federal:
                </label>
                <input
                  type="text"
                  value={buscaCar}
                  onChange={e => setBuscaCar(e.target.value)}
                  placeholder="Ex: MT19852/2018"
                  style={{ width: '100%', fontSize: '12px', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '3px' }}>
                  Nº(s) do Processo / Protocolo:
                </label>
                <input
                  type="text"
                  value={buscaProcesso}
                  onChange={e => setBuscaProcesso(e.target.value)}
                  placeholder="Ex: 1234/2023"
                  style={{ width: '100%', fontSize: '12px', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                />
              </div>
            </div>

            <div style={{ paddingTop: '6px', borderTop: '1px dashed #cbd5e1', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#334155', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={usarBuscaExploratoria}
                  onChange={e => setUsarBuscaExploratoria(e.target.checked)}
                />
                <span>
                  <strong>Busca ampliada por Nome / Razão Social</strong> (útil quando não houver CPF/CNPJ, CAR ou coordenadas vinculados)
                </span>
              </label>

              {usarBuscaExploratoria && (
                <div>
                  <input
                    type="text"
                    value={buscaNome}
                    onChange={e => setBuscaNome(e.target.value)}
                    placeholder="Informe ao menos 3 caracteres do nome ou razão social"
                    style={{ width: '100%', fontSize: '12px', padding: '6px 8px', border: '1px solid #f59e0b', borderRadius: '4px', backgroundColor: '#fffbeb' }}
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                className="btn light"
                style={{ fontSize: '12px', padding: '6px 14px' }}
                onClick={() => {
                  setBuscaCpfCnpj('');
                  setBuscaCar('');
                  setBuscaProcesso('');
                  setBuscaNome('');
                  setUsarCoordsBarragens(false);
                  setUsarBuscaExploratoria(false);
                }}
              >
                Limpar
              </button>
              <button
                type="button"
                className="btn green"
                style={{ fontSize: '12px', padding: '6px 16px' }}
                onClick={() => executarConsulta()}
                disabled={isLoading}
              >
                {isLoading ? 'Consultando SEMA-MT...' : 'Consultar Base SEMA-MT'}
              </button>
            </div>
          </div>

          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '36px 10px' }}>
              <strong style={{ fontSize: '14px', color: '#0369a1', display: 'block', marginBottom: '6px' }}>
                Consultando a base pública da SEMA-MT...
              </strong>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Cruzando CPF/CNPJ, CAR/MT, processos e coordenadas das barragens vinculadas.
              </span>
            </div>
          ) : data ? (
            <div>
              {data.criteriosUtilizados.buscaExploratoria && (
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#92400e',
                    marginBottom: '12px'
                  }}
                >
                  <strong>Aviso:</strong> resultados obtidos apenas por semelhança de nome devem ser conferidos antes do vínculo cadastral.
                </div>
              )}

              {/* Resumo de Status */}
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: data.erroGeral ? '#fef2f2' : '#f8fafc',
                  border: `1px solid ${data.erroGeral ? '#fecaca' : '#e2e8f0'}`,
                  borderRadius: '6px',
                  marginBottom: '14px',
                  fontSize: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px'
                }}
              >
                <div>
                  <strong>Resultado da consulta: </strong>
                  <span>{data.mensagemStatus}</span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  {data.consultadoEm ? new Date(data.consultadoEm).toLocaleString('pt-BR') : '—'}
                </div>
              </div>

              {/* Abas */}
              <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: '14px', gap: '4px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`btn light ${activeTab === 'car' ? 'green' : ''}`}
                  onClick={() => setActiveTab('car')}
                  style={{ fontSize: '12px', padding: '6px 12px', fontWeight: 600 }}
                >
                  CAR / Imóveis ({data.carImoveis.length})
                </button>
                <button
                  type="button"
                  className={`btn light ${activeTab === 'licencas' ? 'green' : ''}`}
                  onClick={() => setActiveTab('licencas')}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  Licenças ({data.licencas.length})
                </button>
                <button
                  type="button"
                  className={`btn light ${activeTab === 'notificacoes' ? 'green' : ''}`}
                  onClick={() => setActiveTab('notificacoes')}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  Notificações ({data.notificacoes.length})
                </button>
                <button
                  type="button"
                  className={`btn light ${activeTab === 'autos' ? 'green' : ''}`}
                  onClick={() => setActiveTab('autos')}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  Autos de Infração ({data.autosInfracao.length})
                </button>
                <button
                  type="button"
                  className={`btn light ${activeTab === 'embargos' ? 'green' : ''}`}
                  onClick={() => setActiveTab('embargos')}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  Termos de Embargo ({data.termosEmbargo.length})
                </button>
                <button
                  type="button"
                  className={`btn light ${activeTab === 'diagnostico' ? 'green' : ''}`}
                  onClick={() => setActiveTab('diagnostico')}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  Bases Consultadas ({data.camadasConsultadas.length})
                </button>
              </div>

              {activeTab === 'car' && renderCarImoveisList(data.carImoveis)}

              {activeTab === 'licencas' &&
                renderDocumentList(
                  data.licencas,
                  ['licencas'],
                  'Nenhuma licença localizada na base da SEMA-MT para os critérios informados.'
                )}

              {activeTab === 'notificacoes' &&
                renderDocumentList(
                  data.notificacoes,
                  ['notificacoes'],
                  'Nenhuma notificação localizada na base da SEMA-MT para os critérios informados.'
                )}

              {activeTab === 'autos' &&
                renderDocumentList(
                  data.autosInfracao,
                  ['autosInfracao'],
                  'Nenhum auto de infração localizado na base da SEMA-MT para os critérios informados.'
                )}

              {activeTab === 'embargos' &&
                renderDocumentList(
                  data.termosEmbargo,
                  ['termosEmbargo'],
                  'Nenhum termo de embargo localizado na base da SEMA-MT para os critérios informados.'
                )}

              {activeTab === 'diagnostico' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {data.camadasConsultadas.length === 0 ? (
                    <div style={{ padding: '16px', color: '#64748b', fontSize: '12px' }}>
                      Nenhuma base consultada nesta pesquisa.
                    </div>
                  ) : (
                    data.camadasConsultadas.map(cam => (
                      <div
                        key={cam.camada}
                        style={{
                          backgroundColor: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: '6px',
                          padding: '10px 12px',
                          fontSize: '12px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                          <div>
                            <strong style={{ color: '#0f172a' }}>
                              {cam.titulo || cam.camada.replace('Geoportal:', '')}
                            </strong>
                          </div>
                          {renderStatusBadge(cam.status)}
                        </div>
                        <div style={{ marginTop: '4px', color: '#475569' }}>{cam.mensagem}</div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
              Informe um critério acima (CPF/CNPJ, Nº do CAR/MT, Processo ou busca por nome) e clique em <strong>Consultar Base SEMA-MT</strong>.
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
