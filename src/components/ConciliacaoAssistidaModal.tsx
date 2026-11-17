// src/components/ConciliacaoAssistidaModal.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  BarragemRecord,
  EmpreendedorRecord,
  PortariaRecord,
  ResponsavelTecnicoRecord
} from '../services/notificaDataService';
import {
  BarragemDocumentoEmitidoItem,
  carregarDocumentosEmitidosPorBarragens
} from '../services/documentosService';
import { consultarCarPorCoordenada } from '../services/carLookupService';
import { CarFeatureMapped, CarLookupResult } from '../types/carLookup';
import { maskCpfCnpjDisplay } from '../config/carCampos';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';
import {
  ATOR_PAPEL_LABELS,
  AtorPapel,
  CONCILIACAO_ACAO_LABELS,
  CONCILIACAO_CLASSIFICACAO_LABELS,
  ConciliacaoAcao,
  ConciliacaoClassificacao,
  NotificacaoProcessoEntrada,
  RevisaoConciliacaoAuditPayload,
  RtParecerPendencia,
  avaliarCoordenadasBarragem,
  detectarMultiplasBarragensMesmoCar,
  encontrarCandidatosEmpreendedor,
  extrairAtoresDoProcesso,
  isDocumentoSemRtIgnoradoComoDivergencia,
  normConciliacaoText
} from '../utils/conciliacaoEngine';
import type { BarragemSemEmpreendedorItem } from './ConciliacaoCadastrosView';

export interface ConciliacaoDecisaoSubmission {
  alvoTipo: 'barragem_empreendedor' | 'barragem_rt_parecer';
  barragem: BarragemRecord;
  masterUpdatedAtSnapshot: string;
  masterEmpreendedorIdSnapshot: string;
  classificacao: ConciliacaoClassificacao;
  acao: ConciliacaoAcao;
  justificativa: string;
  selectedEmpreendedorId?: string;
  selectedRtId?: string;
  selectedRtArt?: string;
  selectedSemaFeature?: CarFeatureMapped | null;
  vincularCarDaSema?: boolean;
  auditPayload: RevisaoConciliacaoAuditPayload;
}

interface ConciliacaoAssistidaModalProps {
  mode: 'barragem_empreendedor' | 'barragem_rt_parecer';
  barragemItem?: BarragemSemEmpreendedorItem;
  rtPendencia?: RtParecerPendencia;
  barragemTarget: BarragemRecord;
  todasBarragens: BarragemRecord[];
  empreendedores: EmpreendedorRecord[];
  rts: ResponsavelTecnicoRecord[];
  portarias?: PortariaRecord[];
  currentUserName: string;
  readOnly?: boolean;
  onClose: () => void;
  onSubmitDecisao: (
    submission: ConciliacaoDecisaoSubmission
  ) => Promise<{ success: boolean; error?: string }>;
}

const PAPEL_BADGE_COLORS: Record<AtorPapel, { bg: string; fg: string; border: string }> = {
  proprietario_titular: { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' },
  empreendedor: { bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
  arrendatario: { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
  responsavel_area: { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' },
  notificado: { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
  rt: { bg: '#f5f3ff', fg: '#6d28d9', border: '#ddd6fe' },
  nao_identificado: { bg: '#f1f5f9', fg: '#475569', border: '#cbd5e1' }
};

export const ConciliacaoAssistidaModal: React.FC<ConciliacaoAssistidaModalProps> = ({
  mode,
  barragemItem,
  rtPendencia,
  barragemTarget,
  todasBarragens,
  empreendedores,
  rts,
  portarias = [],
  currentUserName,
  readOnly = false,
  onClose,
  onSubmitDecisao
}) => {
  // Captura o snapshot imutável do cadastro mestre no momento de abertura da revisão
  const [masterUpdatedAtSnapshot] = useState<string>(() =>
    String(barragemTarget.updatedAt || '')
  );
  const [masterEmpreendedorIdSnapshot] = useState<string>(() =>
    String((barragemTarget as any).empreendedorId || (barragemTarget as any).empreendedor_id || '')
  );

  // Documentos e notificações carregados sob demanda
  const [loadingDocs, setLoadingDocs] = useState<boolean>(false);
  const [docsDaBarragem, setDocsDaBarragem] = useState<BarragemDocumentoEmitidoItem[]>([]);
  const [notificacoesDaBarragem, setNotificacoesDaBarragem] = useState<
    NotificacaoProcessoEntrada[]
  >([]);

  // Consulta geográfica SEMA/MT sob demanda (nunca dispara automaticamente)
  const [semaLoading, setSemaLoading] = useState<boolean>(false);
  const [semaResult, setSemaResult] = useState<CarLookupResult | null>(null);
  const [selectedSemaIdx, setSelectedSemaIdx] = useState<number>(-1);
  const [vincularCarDaSema, setVincularCarDaSema] = useState<boolean>(false);

  // Seleção manual no cadastro mestre Administra (nunca pré-seleciona automaticamente casos ambíguos/fracos)
  const [empSearch, setEmpSearch] = useState<string>('');
  const [selectedEmpId, setSelectedEmpId] = useState<string>('');
  const [rtSearch, setRtSearch] = useState<string>('');
  const [selectedRtId, setSelectedRtId] = useState<string>('');
  const [selectedRtArt, setSelectedRtArt] = useState<string>(
    () => rtPendencia?.citacao?.artNumero || ''
  );

  // Classificação, ação e justificativa
  const [classificacao, setClassificacao] = useState<ConciliacaoClassificacao>(
    () => rtPendencia?.classificacaoSugerida || 'sem_correspondencia'
  );
  const [acao, setAcao] = useState<ConciliacaoAcao>('encaminhar_analise');
  const [justificativa, setJustificativa] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>('');

  const coordDiag = useMemo(
    () => avaliarCoordenadasBarragem(barragemTarget.latitude, barragemTarget.longitude),
    [barragemTarget.latitude, barragemTarget.longitude]
  );

  const multiDamCar = useMemo(
    () => detectarMultiplasBarragensMesmoCar(barragemTarget, todasBarragens),
    [barragemTarget, todasBarragens]
  );

  useEffect(() => {
    let active = true;
    setLoadingDocs(true);

    const loadEvidence = async () => {
      try {
        const docsMap = await carregarDocumentosEmitidosPorBarragens([barragemTarget], {
          portarias
        });
        const docs = docsMap[String(barragemTarget.id)] || [];

        const notifList: NotificacaoProcessoEntrada[] = [];
        if (isSupabaseConfigured() && supabase && barragemTarget.processo) {
          const { data } = await supabase
            .from('fiscaliza_notificacoes_importadas')
            .select('id,processo,tipo_documento,payload,status,situacao')
            .eq('processo', barragemTarget.processo)
            .limit(20);
          if (Array.isArray(data)) {
            for (const row of data) {
              const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
              notifList.push({
                id: String(row.id),
                processo: row.processo ? String(row.processo) : undefined,
                carMt: p.carMt ? String(p.carMt) : undefined,
                tipoDocumento: row.tipo_documento || p.tipo_documento || 'Notificação',
                notificadoNome:
                  p.notificadoNome || p.notificado || p.autuado || p.destinatario || undefined,
                notificadoDocumento: p.notificadoCpfCnpj || p.cpfCnpjNotificado || undefined,
                empreendedorNome: p.empreendedorNome || p.empreendedor || undefined,
                empreendedorDocumento: p.empreendedorCpfCnpj || p.cpfCnpjEmpreendedor || undefined,
                responsavelAreaNome: p.responsavelArea || p.responsavelPelaArea || undefined,
                arrendatarioNome: p.arrendatario || p.arrendatarioNome || undefined,
                proprietarioNome: p.proprietario || p.titular || undefined,
                resumo: [p.objetivo, p.observacoes, p.resumo].filter(Boolean).join(' · ')
              });
            }
          }
        }

        if (active) {
          setDocsDaBarragem(docs);
          setNotificacoesDaBarragem(notifList);
        }
      } catch {
        // Silencioso: prossegue com os dados em memória sem inventar documentos
      } finally {
        if (active) setLoadingDocs(false);
      }
    };

    loadEvidence();
    return () => {
      active = false;
    };
  }, [barragemTarget, portarias]);

  const atoresProcesso = useMemo(
    () =>
      extrairAtoresDoProcesso({
        barragem: barragemTarget,
        documentos: docsDaBarragem,
        notificacoes: notificacoesDaBarragem,
        empreendedores
      }),
    [barragemTarget, docsDaBarragem, notificacoesDaBarragem, empreendedores]
  );

  const selectedSemaFeature: CarFeatureMapped | null =
    semaResult &&
    semaResult.sucesso &&
    selectedSemaIdx >= 0 &&
    semaResult.feicoes[selectedSemaIdx]
      ? semaResult.feicoes[selectedSemaIdx]
      : null;

  const candidatoAnalysis = useMemo(
    () =>
      encontrarCandidatosEmpreendedor({
        barragem: barragemTarget,
        empreendedores,
        atoresDoProcesso: atoresProcesso,
        semaTitularNome: selectedSemaFeature?.empreendedor || undefined
      }),
    [barragemTarget, empreendedores, atoresProcesso, selectedSemaFeature]
  );

  // Atualiza sugestão inicial de classificação apenas quando ainda não alterada manualmente e em modo barragem_empreendedor
  useEffect(() => {
    if (mode === 'barragem_empreendedor' && !justificativa) {
      setClassificacao(candidatoAnalysis.classificacaoInicial);
    }
  }, [mode, candidatoAnalysis.classificacaoInicial, justificativa]);

  const filteredEmpsList = useMemo(() => {
    const q = normConciliacaoText(empSearch);
    const digitsQ = empSearch.replace(/\D/g, '');
    return (empreendedores || [])
      .filter(emp => {
        if (!q && !digitsQ) return true;
        const nomeMatch =
          normConciliacaoText(emp.nome).includes(q) ||
          normConciliacaoText(emp.nomeFantasia).includes(q) ||
          normConciliacaoText(emp.municipio).includes(q);
        const docMatch =
          digitsQ.length >= 3 && String(emp.cpfCnpj || '').replace(/\D/g, '').includes(digitsQ);
        return nomeMatch || docMatch;
      })
      .slice(0, 60);
  }, [empreendedores, empSearch]);

  const filteredRtsList = useMemo(() => {
    const q = normConciliacaoText(rtSearch);
    const digitsQ = rtSearch.replace(/\D/g, '');
    return (rts || [])
      .filter(rt => {
        if (!q && !digitsQ) return true;
        const textMatch =
          normConciliacaoText(rt.nome).includes(q) ||
          normConciliacaoText(rt.registro).includes(q) ||
          normConciliacaoText(rt.conselho).includes(q);
        const docMatch =
          digitsQ.length >= 3 && String(rt.cpf || '').replace(/\D/g, '').includes(digitsQ);
        return textMatch || docMatch;
      })
      .slice(0, 60);
  }, [rts, rtSearch]);

  const selectedEmpObj = useMemo(
    () => empreendedores.find(e => String(e.id) === String(selectedEmpId)) || null,
    [empreendedores, selectedEmpId]
  );

  const selectedRtObj = useMemo(
    () => rts.find(r => String(r.id) === String(selectedRtId)) || null,
    [rts, selectedRtId]
  );

  const handleConsultarSema = async () => {
    if (!coordDiag.permiteConsultaEspacial) return;
    setSemaLoading(true);
    setSelectedSemaIdx(-1);
    setVincularCarDaSema(false);
    try {
      const res = await consultarCarPorCoordenada(
        barragemTarget.latitude,
        barragemTarget.longitude,
        {
          entidadeAlvoTipo: 'barragem',
          entidadeAlvoId: barragemTarget.id,
          incluirProximidade: true,
          raioMetros: 1500
        }
      );
      setSemaResult(res);
    } finally {
      setSemaLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    setSubmitError('');

    const justTrim = justificativa.trim();
    if (justTrim.length < 5) {
      setSubmitError('Informe uma justificativa objetiva (mínimo de 5 caracteres) para registrar a auditoria.');
      return;
    }

    if (acao === 'vincular') {
      if (mode === 'barragem_empreendedor' && !selectedEmpObj) {
        setSubmitError('Selecione o empreendedor no cadastro mestre antes de confirmar o vínculo.');
        return;
      }
      if (mode === 'barragem_rt_parecer' && !selectedRtObj) {
        setSubmitError('Selecione o Responsável Técnico no cadastro mestre antes de confirmar o vínculo.');
        return;
      }
      if (mode === 'barragem_rt_parecer' && !selectedRtArt.trim()) {
        setSubmitError('Informe o número da ART/RRT correspondente ao vínculo técnico.');
        return;
      }
    }

    const nowIso = new Date().toISOString();
    const valorAnterior =
      mode === 'barragem_empreendedor'
        ? barragemItem?.legacyText
          ? `Sem vínculo formal (legado: ${barragemItem.legacyText})`
          : masterEmpreendedorIdSnapshot
          ? `ID ausente/inválido (${masterEmpreendedorIdSnapshot})`
          : 'Sem empreendedor vinculado'
        : rtPendencia?.vinculosEstruturadosDaBarragem?.length
        ? rtPendencia.vinculosEstruturadosDaBarragem
            .map(v => `${v.rtNome} (ART ${v.art || '—'})`)
            .join('; ')
        : 'Sem vínculo estruturado para o Parecer citado';

    const valorProposto =
      acao === 'vincular'
        ? mode === 'barragem_empreendedor'
          ? `${selectedEmpObj?.nome || ''} (${selectedEmpObj?.id || ''})${
              vincularCarDaSema && selectedSemaFeature?.car
                ? ` + CAR ${selectedSemaFeature.car}`
                : ''
            }`
          : `RT ${selectedRtObj?.nome || ''} · ART ${selectedRtArt.trim()}`
        : acao === 'rejeitar'
        ? 'Sugestão rejeitada — cadastro mestre preservado sem alterações'
        : 'Encaminhado para análise complementar — cadastro mestre preservado';

    const auditPayload: RevisaoConciliacaoAuditPayload = {
      schemaVersion: 1,
      modulo: 'conciliacao_assistida',
      alvoTipo: mode,
      barragemId: String(barragemTarget.id),
      barragemNome: String(barragemTarget.nome || 'Barragem sem nome'),
      classificacao,
      acao,
      fonte: selectedSemaFeature
        ? 'SEMA-MT Geoportal + Conferência Humana Administra'
        : docsDaBarragem.length > 0
        ? 'Documentos/Processo + Conferência Humana Administra'
        : 'Conferência Humana Administra',
      dataDecisao: nowIso,
      usuario: currentUserName || 'Usuário autenticado',
      valorAnterior,
      valorProposto,
      justificativa: justTrim,
      evidencias: {
        processo: barragemTarget.processo || undefined,
        car: barragemTarget.car || undefined,
        multiplasBarragensNoCar: multiDamCar.totalBarragensNoMesmoCar,
        coordenadaStatus: coordDiag.status,
        semaConsultada: Boolean(semaResult),
        semaCriterioEspacial: selectedSemaFeature?.criterioEspacial,
        semaDistanciaMetros: selectedSemaFeature?.distanciaMetros,
        semaCamada: selectedSemaFeature?.camadaOrigem,
        semaCarEncontrado: selectedSemaFeature?.car || selectedSemaFeature?.carFederal || undefined,
        semaProprietarioRetornado: selectedSemaFeature?.empreendedor || undefined,
        semaConsultadoEm: semaResult?.consultadoEm,
        semaIndisponivelMotivo:
          semaResult && !semaResult.sucesso ? semaResult.mensagemErro : undefined,
        papeisDetectados: atoresProcesso.map(a => ({
          papel: a.papel,
          nome: a.nome,
          origem: a.origem
        })),
        parecerDocumento: rtPendencia
          ? `${rtPendencia.documentoTipo} ${rtPendencia.documentoNumero || ''}`.trim()
          : undefined,
        parecerArt: rtPendencia?.citacao?.artNumero || undefined,
        masterUpdatedAtSnapshot: masterUpdatedAtSnapshot || undefined
      }
    };

    setSubmitting(true);
    try {
      const res = await onSubmitDecisao({
        alvoTipo: mode,
        barragem: barragemTarget,
        masterUpdatedAtSnapshot,
        masterEmpreendedorIdSnapshot,
        classificacao,
        acao,
        justificativa: justTrim,
        selectedEmpreendedorId: selectedEmpObj?.id,
        selectedRtId: selectedRtObj?.id,
        selectedRtArt: selectedRtArt.trim(),
        selectedSemaFeature,
        vincularCarDaSema,
        auditPayload
      });

      if (!res.success) {
        setSubmitError(res.error || 'Não foi possível concluir o registro da decisão.');
        return;
      }

      onClose();
    } catch (err: any) {
      setSubmitError(err?.message || 'Erro inesperado ao registrar conciliação.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-back"
      role="dialog"
      aria-modal="true"
      aria-label="Conciliação Assistida de Cadastros"
      onClick={e => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="modal"
        style={{
          maxWidth: '1220px',
          width: '96vw',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div className="modal-head" style={{ flexShrink: 0 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: '2px' }}>
              {mode === 'barragem_empreendedor'
                ? 'Investigação assistida · Barragem sem empreendedor'
                : 'Conciliação técnica · Parecer x RT / ART'}
            </div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              {barragemTarget.nome || 'Barragem sem nome'}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>
              ID: <span style={{ fontFamily: 'monospace' }}>{barragemTarget.id}</span>
              {barragemTarget.processo ? ` · Processo: ${barragemTarget.processo}` : ''}
              {barragemTarget.car ? ` · CAR: ${barragemTarget.car}` : ''}
              {' · '}Sugestão assistida: nenhuma alteração é gravada sem decisão humana explícita.
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Fechar investigação"
          >
            ×
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}
        >
          <div
            className="modal-body"
            style={{ overflowY: 'auto', flex: 1, padding: '16px 20px', background: '#f8fafc' }}
          >
            {multiDamCar.avisoMultiplasBarragens && (
              <div
                className="notice amber"
                style={{ marginBottom: '14px', fontSize: '12px', lineHeight: 1.5 }}
              >
                <strong>CAR compartilhado por múltiplas barragens:</strong> {multiDamCar.mensagem}{' '}
                <div style={{ marginTop: '4px', color: '#78350f' }}>
                  Outras barragens neste mesmo CAR:{' '}
                  {multiDamCar.outrasBarragens
                    .map(o => `${o.nome}${o.processo ? ` (Proc. ${o.processo})` : ''}`)
                    .join(' · ')}
                </div>
              </div>
            )}

            {/* LADO A LADO: 3 COLUNAS */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
                gap: '14px',
                marginBottom: '16px'
              }}
            >
              {/* COLUNA 1: DADOS DO PROCESSO & DOCUMENTOS */}
              <div
                style={{
                  background: '#fff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                <div style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                  <span className="badge blue" style={{ marginBottom: '4px' }}>
                    1. Processo & Documentos (Originais)
                  </span>
                  <h4 style={{ margin: '4px 0 0', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                    Dados registrados nos autos
                  </h4>
                </div>

                <div style={{ fontSize: '12px', lineHeight: 1.55, color: '#334155' }}>
                  <div>
                    <b>Processo:</b> {barragemTarget.processo || 'Não informado'}
                  </div>
                  <div>
                    <b>CAR/MT:</b>{' '}
                    <span style={{ fontFamily: 'monospace' }}>
                      {barragemTarget.car || 'Não informado'}
                    </span>
                  </div>
                  <div>
                    <b>Município/UF:</b>{' '}
                    {[barragemTarget.municipio, barragemTarget.uf].filter(Boolean).join('/') || '—'}
                  </div>
                  <div>
                    <b>Texto legado (empreendedor):</b>{' '}
                    {barragemItem?.legacyText ? (
                      <span style={{ color: '#0f172a', fontWeight: 600 }}>
                        {barragemItem.legacyText}
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>Não informado</span>
                    )}
                  </div>
                </div>

                {/* Diagnóstico de coordenadas */}
                <div
                  style={{
                    padding: '9px 10px',
                    borderRadius: '8px',
                    background:
                      coordDiag.status === 'valida'
                        ? '#f0fdf4'
                        : coordDiag.status === 'ausente'
                        ? '#f8fafc'
                        : '#fffbeb',
                    border: `1px solid ${
                      coordDiag.status === 'valida'
                        ? '#bbf7d0'
                        : coordDiag.status === 'ausente'
                        ? '#e2e8f0'
                        : '#fde68a'
                    }`,
                    fontSize: '11px'
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: '2px', color: '#0f172a' }}>
                    Coordenadas ({coordDiag.status === 'valida' ? 'GMS válidas' : coordDiag.status})
                  </div>
                  {coordDiag.latGms || coordDiag.lngGms ? (
                    <div style={{ fontFamily: 'monospace', color: '#334155', marginBottom: '3px' }}>
                      <div>Lat: {coordDiag.latGms || '—'}</div>
                      <div>Lon: {coordDiag.lngGms || '—'}</div>
                    </div>
                  ) : null}
                  <div style={{ color: '#475569' }}>{coordDiag.mensagem}</div>
                </div>

                {/* Separação explícita de papéis */}
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#475569',
                      marginBottom: '6px'
                    }}
                  >
                    Pessoas e papéis identificados nos autos
                  </div>
                  {atoresProcesso.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {atoresProcesso.map(ator => {
                        const style = PAPEL_BADGE_COLORS[ator.papel];
                        return (
                          <div
                            key={ator.id}
                            style={{
                              padding: '7px 9px',
                              borderRadius: '7px',
                              border: `1px solid ${style.border}`,
                              background: style.bg,
                              fontSize: '11px'
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: '6px',
                                alignItems: 'center',
                                flexWrap: 'wrap'
                              }}
                            >
                              <strong style={{ color: style.fg }}>
                                {ATOR_PAPEL_LABELS[ator.papel]}
                              </strong>
                              <span style={{ color: '#64748b', fontSize: '10px' }}>
                                {ator.origem}
                              </span>
                            </div>
                            <div style={{ color: '#0f172a', fontWeight: 600, marginTop: '2px' }}>
                              {ator.nome}
                              {ator.cpfCnpjMascarado ? ` (${ator.cpfCnpjMascarado})` : ''}
                            </div>
                            {ator.observacao && (
                              <div style={{ color: '#475569', fontSize: '10px', marginTop: '2px' }}>
                                {ator.observacao}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      Nenhum ator adicional extraído das notificações/observações.
                    </div>
                  )}
                </div>

                {/* Parecer / Documentos da barragem */}
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#475569',
                      marginBottom: '4px'
                    }}
                  >
                    Documentos / Pareceres vinculados ({docsDaBarragem.length})
                  </div>
                  {loadingDocs ? (
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      Carregando documentos associados...
                    </div>
                  ) : docsDaBarragem.length > 0 ? (
                    <div
                      style={{
                        maxHeight: '140px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px'
                      }}
                    >
                      {docsDaBarragem.map(d => {
                        const ignoraSemRt = isDocumentoSemRtIgnoradoComoDivergencia(d.tipo);
                        return (
                          <div
                            key={d.id}
                            style={{
                              padding: '6px 8px',
                              borderRadius: '6px',
                              border: '1px solid #e2e8f0',
                              background: '#f8fafc',
                              fontSize: '11px'
                            }}
                          >
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>
                              {d.tipo}
                              {d.numero ? ` nº ${d.numero}` : ''} · {d.origemSistema}
                            </div>
                            <div style={{ color: '#475569' }}>{d.titulo}</div>
                            {ignoraSemRt && (
                              <div style={{ color: '#64748b', fontSize: '10px', marginTop: '2px' }}>
                                Regra aplicada: ausência de RT neste tipo de documento não gera divergência.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      Nenhum documento localizado no catálogo para este processo/barragem.
                    </div>
                  )}
                </div>
              </div>

              {/* COLUNA 2: CONSULTA GEOGRÁFICA SEMA/MT */}
              <div
                style={{
                  background: '#fff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                <div style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                  <span className="badge green" style={{ marginBottom: '4px' }}>
                    2. Base Pública SEMA/MT (Evidência Espacial)
                  </span>
                  <h4 style={{ margin: '4px 0 0', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                    Consulta WFS oficial por coordenada
                  </h4>
                </div>

                <div style={{ fontSize: '11px', color: '#475569', lineHeight: 1.5 }}>
                  Executa consulta segura no servidor (<span style={{ fontFamily: 'monospace' }}>/api/car-lookup</span>) com interseção direta (<code>INTERSECTS</code>) e fallback por proximidade (<code>BBOX</code> até 1,5 km). Resultados são apenas evidências e não vinculam cadastros automaticamente.
                </div>

                <div>
                  <button
                    type="button"
                    className="btn soft small"
                    disabled={!coordDiag.permiteConsultaEspacial || semaLoading}
                    onClick={handleConsultarSema}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    {semaLoading
                      ? 'Consultando Geoportal SEMA/MT...'
                      : 'Consultar SEMA/MT pela coordenada do processo'}
                  </button>
                </div>

                {!semaResult && (
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      border: '1px dashed #cbd5e1',
                      fontSize: '11px',
                      color: '#64748b'
                    }}
                  >
                    {coordDiag.permiteConsultaEspacial
                      ? 'Clique no botão acima para investigar feições CAR/MT para esta coordenada ou siga diretamente com a conciliação manual ao lado.'
                      : 'Consulta espacial indisponível por ausência/invalidade de coordenadas válidas. Utilize a conciliação manual na coluna 3.'}
                  </div>
                )}

                {semaResult && !semaResult.sucesso && (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      fontSize: '11px',
                      color: '#991b1b',
                      lineHeight: 1.5
                    }}
                  >
                    <strong>SEMA/MT indisponível ou bloqueada:</strong>{' '}
                    {semaResult.mensagemErro ||
                      'Não foi possível obter resposta do serviço oficial da SEMA/MT.'}
                    <div style={{ marginTop: '4px', color: '#7f1d1d' }}>
                      Nenhum resultado foi simulado. Você pode continuar pela conciliação manual na coluna Cadastro Mestre.
                    </div>
                  </div>
                )}

                {semaResult && semaResult.sucesso && semaResult.feicoes.length === 0 && (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      fontSize: '11px',
                      color: '#92400e',
                      lineHeight: 1.5
                    }}
                  >
                    <strong>Nenhuma feição encontrada:</strong>{' '}
                    {semaResult.mensagemStatus ||
                      'Nenhuma propriedade CAR/MT encontrada na interseção ou proximidade imediata desta coordenada.'}
                    <div style={{ marginTop: '4px', fontSize: '10px', color: '#78350f' }}>
                      Consultado em {new Date(semaResult.consultadoEm).toLocaleString('pt-BR')} · Prossiga com classificação manual (ex.: Sem correspondência) ou encaminho para análise.
                    </div>
                  </div>
                )}

                {semaResult && semaResult.sucesso && semaResult.feicoes.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#475569' }}>
                      Consultado em{' '}
                      <b>{new Date(semaResult.consultadoEm).toLocaleString('pt-BR')}</b> · Selecione uma feição candidata apenas se desejar utilizá-la como evidência:
                    </div>
                    {semaResult.feicoes.map((feat, idx) => {
                      const selected = idx === selectedSemaIdx;
                      const distLabel =
                        feat.criterioEspacial === 'BBOX_PROXIMIDADE'
                          ? `Proximidade BBOX (~${feat.distanciaMetros ?? '?'} m)`
                          : 'Interseção direta (INTERSECTS · 0 m)';
                      return (
                        <div
                          key={`${feat.id || feat.car || idx}`}
                          onClick={() => setSelectedSemaIdx(selected ? -1 : idx)}
                          style={{
                            cursor: 'pointer',
                            padding: '10px',
                            borderRadius: '8px',
                            border: selected ? '2px solid #047857' : '1px solid #cbd5e1',
                            background: selected ? '#ecfdf5' : '#f8fafc',
                            fontSize: '11px',
                            lineHeight: 1.45
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: '6px',
                              flexWrap: 'wrap',
                              marginBottom: '4px'
                            }}
                          >
                            <span
                              className={`badge ${
                                feat.criterioEspacial === 'BBOX_PROXIMIDADE' ? 'amber' : 'green'
                              }`}
                            >
                              {distLabel}
                            </span>
                            <span style={{ fontFamily: 'monospace', color: '#475569', fontSize: '10px' }}>
                              {feat.camadaOrigem || 'Geoportal:CAR_ATP'}
                            </span>
                          </div>
                          <div>
                            <b>CAR:</b>{' '}
                            <span style={{ fontFamily: 'monospace' }}>
                              {feat.car || feat.carFederal || '—'}
                            </span>
                          </div>
                          <div>
                            <b>Propriedade:</b> {feat.empreendimento || 'Não informada'}
                          </div>
                          <div>
                            <b>Titular publicado (SEMA):</b>{' '}
                            {feat.empreendedor ? (
                              <span style={{ fontWeight: 600 }}>{feat.empreendedor}</span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>
                                Atributo de titular não publicado/ausente nesta camada
                              </span>
                            )}
                          </div>
                          <div>
                            <b>Município / Área:</b> {feat.municipio || feat.municipioCodigo || '—'}
                            {feat.areaHa ? ` · ${feat.areaHa} ha` : ''}
                          </div>
                          {feat.auditoriaId && (
                            <div style={{ color: '#047857', fontSize: '10px', marginTop: '3px' }}>
                              Auditoria SEMA registrada ({feat.auditoriaId.slice(0, 8)}…)
                            </div>
                          )}
                          <div style={{ color: '#64748b', fontSize: '10px', marginTop: '3px' }}>
                            Evidência espacial apenas: a coordenada pode apontar sede do imóvel e não confirma titularidade sem validação humana.
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* COLUNA 3: CADASTRO MESTRE ADMINISTRA */}
              <div
                style={{
                  background: '#fff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                <div style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                  <span className="badge amber" style={{ marginBottom: '4px' }}>
                    3. Cadastro Mestre Administra
                  </span>
                  <h4 style={{ margin: '4px 0 0', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                    {mode === 'barragem_empreendedor'
                      ? 'Candidatos e seleção de empreendedor'
                      : 'Parecer citado x RTs estruturados'}
                  </h4>
                </div>

                {mode === 'barragem_empreendedor' ? (
                  <>
                    <div style={{ fontSize: '11px', color: '#475569' }}>
                      <b>Diagnóstico inicial:</b> {candidatoAnalysis.motivoResumo}
                    </div>

                    {candidatoAnalysis.candidatos.length > 0 && (
                      <div>
                        <div
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: '#334155',
                            marginBottom: '5px'
                          }}
                        >
                          Candidatos sugeridos ({candidatoAnalysis.candidatos.length}) — clique para selecionar:
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '5px',
                            maxHeight: '150px',
                            overflowY: 'auto'
                          }}
                        >
                          {candidatoAnalysis.candidatos.map(c => {
                            const isSel = selectedEmpId === c.empreendedorId;
                            return (
                              <div
                                key={c.empreendedorId}
                                onClick={() =>
                                  setSelectedEmpId(isSel ? '' : c.empreendedorId)
                                }
                                style={{
                                  cursor: 'pointer',
                                  padding: '7px 9px',
                                  borderRadius: '7px',
                                  border: isSel ? '2px solid #047857' : '1px solid #cbd5e1',
                                  background: isSel ? '#ecfdf5' : '#f8fafc',
                                  fontSize: '11px'
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    gap: '6px',
                                    flexWrap: 'wrap'
                                  }}
                                >
                                  <strong style={{ color: '#0f172a' }}>{c.nome}</strong>
                                  <span
                                    className={`badge ${
                                      c.possuiIdentificadorForte ? 'green' : 'amber'
                                    }`}
                                  >
                                    {CONCILIACAO_CLASSIFICACAO_LABELS[c.classificacaoSugerida]}
                                  </span>
                                </div>
                                <div style={{ color: '#475569' }}>
                                  {c.cpfCnpjMascarado || 'Sem CPF/CNPJ'}
                                  {c.municipioUf ? ` · ${c.municipioUf}` : ''}
                                </div>
                                <div style={{ color: '#64748b', fontSize: '10px', marginTop: '2px' }}>
                                  {c.motivo}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#334155',
                          marginBottom: '4px'
                        }}
                      >
                        Selecionar empreendedor manualmente no cadastro mestre
                      </label>
                      <input
                        className="input"
                        placeholder="Filtrar empreendedor por nome ou CPF/CNPJ..."
                        value={empSearch}
                        onChange={e => setEmpSearch(e.target.value)}
                        style={{ marginBottom: '6px', fontSize: '12px' }}
                      />
                      <select
                        className="select"
                        value={selectedEmpId}
                        onChange={e => setSelectedEmpId(e.target.value)}
                        style={{ fontSize: '12px' }}
                      >
                        <option value="">— Nenhum empreendedor selecionado —</option>
                        {filteredEmpsList.map(emp => (
                          <option key={emp.id} value={emp.id}>
                            {emp.nome}
                            {emp.cpfCnpj ? ` (${maskCpfCnpjDisplay(emp.cpfCnpj)})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedSemaFeature?.car && selectedSemaFeature.auditoriaId && (
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '7px',
                          fontSize: '11px',
                          color: '#334155',
                          padding: '7px 9px',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: '7px'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={vincularCarDaSema}
                          onChange={e => setVincularCarDaSema(e.target.checked)}
                          style={{ marginTop: '2px' }}
                        />
                        <span>
                          Ao confirmar vínculo, gravar também o CAR auditado da SEMA (
                          <b>{selectedSemaFeature.car}</b>) com proveniência na barragem.
                        </span>
                      </label>
                    )}
                  </>
                ) : (
                  <>
                    {rtPendencia && (
                      <div
                        style={{
                          padding: '9px 10px',
                          borderRadius: '8px',
                          background: '#f5f3ff',
                          border: '1px solid #ddd6fe',
                          fontSize: '11px',
                          lineHeight: 1.5
                        }}
                      >
                        <div style={{ fontWeight: 700, color: '#5b21b6' }}>
                          Citação encontrada no {rtPendencia.documentoTipo}
                          {rtPendencia.documentoNumero ? ` nº ${rtPendencia.documentoNumero}` : ''}
                        </div>
                        <div>
                          <b>RT citado:</b> {rtPendencia.citacao.rtNome || 'Não informado'}
                        </div>
                        <div>
                          <b>ART/RRT citada:</b> {rtPendencia.citacao.artNumero || 'Não informada'}
                        </div>
                        {rtPendencia.citacao.registro && (
                          <div>
                            <b>Registro:</b>{' '}
                            {[rtPendencia.citacao.conselho, rtPendencia.citacao.registro]
                              .filter(Boolean)
                              .join(' ')}
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{ fontSize: '11px', color: '#475569' }}>
                      <b>Vínculos estruturados atuais nesta barragem:</b>{' '}
                      {rtPendencia?.vinculosEstruturadosDaBarragem?.length
                        ? rtPendencia.vinculosEstruturadosDaBarragem
                            .map(v => `${v.rtNome} (ART ${v.art || '—'})`)
                            .join(' · ')
                        : 'Nenhum RT estruturado vinculado.'}
                    </div>

                    {rtPendencia && rtPendencia.candidatosRtMestre.length > 0 && (
                      <div>
                        <div
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: '#334155',
                            marginBottom: '5px'
                          }}
                        >
                          Candidatos no cadastro de RTs ({rtPendencia.candidatosRtMestre.length}):
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          {rtPendencia.candidatosRtMestre.map(c => {
                            const isSel = selectedRtId === c.rtId;
                            return (
                              <div
                                key={c.rtId}
                                onClick={() => setSelectedRtId(isSel ? '' : c.rtId)}
                                style={{
                                  cursor: 'pointer',
                                  padding: '7px 9px',
                                  borderRadius: '7px',
                                  border: isSel ? '2px solid #047857' : '1px solid #cbd5e1',
                                  background: isSel ? '#ecfdf5' : '#f8fafc',
                                  fontSize: '11px'
                                }}
                              >
                                <strong>{c.nome}</strong>{' '}
                                <span style={{ color: '#64748b' }}>
                                  {[c.conselho, c.registro].filter(Boolean).join(' ')}
                                </span>
                                <div style={{ color: '#475569', fontSize: '10px' }}>{c.motivo}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#334155',
                          marginBottom: '4px'
                        }}
                      >
                        Selecionar RT manualmente no cadastro mestre
                      </label>
                      <input
                        className="input"
                        placeholder="Filtrar RT por nome ou registro..."
                        value={rtSearch}
                        onChange={e => setRtSearch(e.target.value)}
                        style={{ marginBottom: '6px', fontSize: '12px' }}
                      />
                      <select
                        className="select"
                        value={selectedRtId}
                        onChange={e => setSelectedRtId(e.target.value)}
                        style={{ marginBottom: '8px', fontSize: '12px' }}
                      >
                        <option value="">— Nenhum RT selecionado —</option>
                        {filteredRtsList.map(rt => (
                          <option key={rt.id} value={rt.id}>
                            {rt.nome}
                            {rt.registro ? ` · ${rt.conselho || ''} ${rt.registro}` : ''}
                          </option>
                        ))}
                      </select>

                      <label
                        style={{
                          display: 'block',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#334155',
                          marginBottom: '4px'
                        }}
                      >
                        ART / RRT do vínculo técnico
                      </label>
                      <input
                        className="input"
                        placeholder="Número da ART/RRT..."
                        value={selectedRtArt}
                        onChange={e => setSelectedRtArt(e.target.value)}
                        style={{ fontSize: '12px' }}
                      />
                    </div>
                  </>
                )}

                <div
                  style={{
                    marginTop: 'auto',
                    paddingTop: '8px',
                    borderTop: '1px solid #e2e8f0',
                    fontSize: '10px',
                    color: '#64748b'
                  }}
                >
                  Snapshot de concorrência capturado:{' '}
                  <span style={{ fontFamily: 'monospace' }}>
                    {masterUpdatedAtSnapshot || 'sem timestamp'}
                  </span>
                </div>
              </div>
            </div>

            {/* BLOCO DE DECISÃO HUMANA & AUDITORIA */}
            <div
              style={{
                background: '#fff',
                border: '1px solid #cbd5e1',
                borderRadius: '10px',
                padding: '14px'
              }}
            >
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#0f172a',
                  marginBottom: '10px'
                }}
              >
                Decisão humana e registro de auditoria
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '12px',
                  marginBottom: '12px'
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#334155',
                      marginBottom: '4px'
                    }}
                  >
                    Classificação da investigação
                  </label>
                  <select
                    className="select"
                    value={classificacao}
                    disabled={readOnly || submitting}
                    onChange={e =>
                      setClassificacao(e.target.value as ConciliacaoClassificacao)
                    }
                  >
                    {(Object.keys(CONCILIACAO_CLASSIFICACAO_LABELS) as ConciliacaoClassificacao[]).map(
                      key => (
                        <option key={key} value={key}>
                          {CONCILIACAO_CLASSIFICACAO_LABELS[key]}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#334155',
                      marginBottom: '4px'
                    }}
                  >
                    Decisão sobre o cadastro mestre
                  </label>
                  <select
                    className="select"
                    value={acao}
                    disabled={readOnly || submitting}
                    onChange={e => setAcao(e.target.value as ConciliacaoAcao)}
                  >
                    {(Object.keys(CONCILIACAO_ACAO_LABELS) as ConciliacaoAcao[]).map(key => (
                      <option key={key} value={key}>
                        {CONCILIACAO_ACAO_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#334155',
                    marginBottom: '4px'
                  }}
                >
                  Justificativa e observações da evidência (obrigatório)
                </label>
                <textarea
                  className="input"
                  rows={3}
                  disabled={readOnly || submitting}
                  placeholder="Descreva os documentos/evidências conferidos, distinção de papéis (se houver) e o fundamento da decisão..."
                  value={justificativa}
                  onChange={e => setJustificativa(e.target.value)}
                  style={{ width: '100%', resize: 'vertical', fontSize: '12px' }}
                />
              </div>

              {submitError && (
                <div
                  style={{
                    marginTop: '10px',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#991b1b',
                    fontSize: '12px'
                  }}
                >
                  {submitError}
                </div>
              )}
            </div>
          </div>

          <div
            className="modal-foot"
            style={{
              flexShrink: 0,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap'
            }}
          >
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Responsável pela revisão: <b>{currentUserName || 'Usuário'}</b> · Cadastro mestre só é gravado com validação de concorrência.
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn light"
                onClick={onClose}
                disabled={submitting}
              >
                Cancelar
              </button>
              {!readOnly && (
                <button
                  type="submit"
                  className="btn green"
                  disabled={submitting}
                >
                  {submitting
                    ? 'Validando e registrando...'
                    : acao === 'vincular'
                    ? 'Confirmar vínculo e gravar auditoria'
                    : acao === 'rejeitar'
                    ? 'Registrar rejeição auditada'
                    : 'Encaminhar para análise'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
