// src/utils/conciliacaoEngine.ts
/**
 * Motor puro de conciliação assistida para Empreendedores, Barragens e RTs no Administra-CSB.
 *
 * Princípios obrigatórios:
 * - Nunca vincula, mescla, exclui ou altera cadastros mestres automaticamente.
 * - Diferencia explicitamente proprietário/titular, empreendedor, arrendatário,
 *   responsável pela área, pessoa notificada e responsável técnico (RT).
 * - Reconhece que um mesmo CAR pode conter várias barragens (CAR não identifica barragem isoladamente)
 *   e um empreendedor pode estar ligado a várias barragens.
 * - Não trata ausência de RT em Notificações ou Ofícios como divergência.
 * - Em Pareceres, compara RT/ART mencionados no documento/texto com os vínculos estruturados.
 */

import type {
  BarragemRecord,
  EmpreendedorRecord,
  ResponsavelTecnicoRecord,
  RevisaoConciliacaoRecord
} from '../services/notificaDataService';
import type { BarragemDocumentoEmitidoItem } from '../services/documentosService';
import { parseCoordAdvanced } from '../services/coordService';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';
import { extractNormalizedCarMatchKeys, maskCpfCnpjDisplay } from '../config/carCampos';

export type AtorPapel =
  | 'proprietario_titular'
  | 'empreendedor'
  | 'arrendatario'
  | 'responsavel_area'
  | 'notificado'
  | 'rt'
  | 'nao_identificado';

export const ATOR_PAPEL_LABELS: Record<AtorPapel, string> = {
  proprietario_titular: 'Proprietário / Titular',
  empreendedor: 'Empreendedor',
  arrendatario: 'Arrendatário',
  responsavel_area: 'Responsável pela área',
  notificado: 'Notificado',
  rt: 'Responsável Técnico (RT)',
  nao_identificado: 'Papel não identificado'
};

export type ConciliacaoClassificacao =
  | 'sem_correspondencia'
  | 'candidato'
  | 'ambiguo'
  | 'possivel_erro_grafia'
  | 'papeis_diferentes'
  | 'vinculo_ausente'
  | 'confirmado_usuario'
  | 'nao_e_divergencia';

export const CONCILIACAO_CLASSIFICACAO_LABELS: Record<ConciliacaoClassificacao, string> = {
  sem_correspondencia: 'Sem correspondência',
  candidato: 'Candidato',
  ambiguo: 'Ambíguo',
  possivel_erro_grafia: 'Possível erro de grafia',
  papeis_diferentes: 'Papéis diferentes',
  vinculo_ausente: 'Vínculo ausente',
  confirmado_usuario: 'Confirmado por usuário',
  nao_e_divergencia: 'Não é divergência'
};

export type ConciliacaoAcao = 'vincular' | 'rejeitar' | 'encaminhar_analise';

export const CONCILIACAO_ACAO_LABELS: Record<ConciliacaoAcao, string> = {
  vincular: 'Vincular no cadastro mestre',
  rejeitar: 'Rejeitar sugestão',
  encaminhar_analise: 'Encaminhar para análise'
};

export interface AtorExtraidoProcesso {
  id: string;
  nome: string;
  cpfCnpjMascarado?: string;
  docDigits?: string;
  papel: AtorPapel;
  origem: string;
  presunivelEmpreendedor: boolean;
  observacao?: string;
}

export interface MultiDamCarInfo {
  carOriginal: string;
  carNormalizado: string;
  totalBarragensNoMesmoCar: number;
  outrasBarragens: Array<{
    id: string;
    nome: string;
    processo?: string;
    empreendedorId?: string;
    empreendedorTexto?: string;
  }>;
  avisoMultiplasBarragens: boolean;
  mensagem: string;
}

export interface CoordenadaDiagnostico {
  status: 'valida' | 'ausente' | 'invalida' | 'fora_mt_ou_ambigua';
  latDecimal: number | null;
  lngDecimal: number | null;
  latGms?: string;
  lngGms?: string;
  mensagem: string;
  permiteConsultaEspacial: boolean;
}

export interface EmpreendedorCandidatoSugestao {
  empreendedorId: string;
  nome: string;
  nomeFantasia?: string;
  cpfCnpjMascarado?: string;
  municipioUf?: string;
  criterio:
    | 'id_exato'
    | 'cpf_cnpj_exato'
    | 'car_em_empreendimento';
  similaridade: number;
  possuiIdentificadorForte: boolean;
  papelOriginal?: AtorPapel;
  papeisOrigem?: AtorPapel[];
  carCoincidente?: string;
  classificacaoSugerida: ConciliacaoClassificacao;
  motivo: string;
}

export interface RtCandidatoSugestao {
  rtId: string;
  nome: string;
  conselho?: string;
  registro?: string;
  cpfMascarado?: string;
  criterio: 'registro_exato' | 'cpf_exato' | 'nome_exato_sem_doc' | 'nome_semelhante_sem_doc';
  similaridade: number;
  possuiIdentificadorForte: boolean;
  classificacaoSugerida: ConciliacaoClassificacao;
  motivo: string;
}

export interface ParecerRtCitacaoExtraida {
  rtNome?: string;
  artNumero?: string;
  conselho?: string;
  registro?: string;
  origemTrecho: string;
}

export interface RtParecerPendencia {
  id: string;
  barragemId: string;
  barragemNome: string;
  barragemUpdatedAt?: string;
  processo?: string;
  car?: string;
  documentoId: string;
  documentoTipo: string;
  documentoTitulo: string;
  documentoNumero?: string;
  documentoData?: string;
  documentoOrigem: string;
  citacao: ParecerRtCitacaoExtraida;
  vinculosEstruturadosDaBarragem: Array<{
    rtId: string;
    rtNome: string;
    art: string;
    situacao?: string;
  }>;
  candidatosRtMestre: RtCandidatoSugestao[];
  classificacaoSugerida: ConciliacaoClassificacao;
  motivo: string;
}

export interface NotificacaoProcessoEntrada {
  id?: string;
  processo?: string;
  carMt?: string;
  barragemId?: string;
  barragemNome?: string;
  notificadoNome?: string;
  notificadoDocumento?: string;
  empreendedorNome?: string;
  empreendedorDocumento?: string;
  responsavelAreaNome?: string;
  responsavelAreaDocumento?: string;
  arrendatarioNome?: string;
  arrendatarioDocumento?: string;
  proprietarioNome?: string;
  proprietarioDocumento?: string;
  tipoDocumento?: string;
  resumo?: string;
}

export interface RevisaoConciliacaoAuditPayload {
  schemaVersion: 1;
  modulo: 'conciliacao_assistida';
  alvoTipo: 'barragem_empreendedor' | 'barragem_rt_parecer';
  barragemId: string;
  barragemNome: string;
  classificacao: ConciliacaoClassificacao;
  acao: ConciliacaoAcao;
  fonte: string;
  dataDecisao: string;
  usuario: string;
  valorAnterior: string;
  valorProposto: string;
  justificativa: string;
  evidencias: {
    processo?: string;
    car?: string;
    multiplasBarragensNoCar?: number;
    coordenadaStatus?: string;
    semaConsultada?: boolean;
    semaCriterioEspacial?: 'INTERSECTS' | 'BBOX_PROXIMIDADE' | string;
    semaDistanciaMetros?: number;
    semaCamada?: string;
    semaCarEncontrado?: string;
    semaProprietarioRetornado?: string;
    semaConsultadoEm?: string;
    semaIndisponivelMotivo?: string;
    papeisDetectados?: Array<{ papel: AtorPapel; nome: string; origem: string }>;
    parecerDocumento?: string;
    parecerArt?: string;
    masterUpdatedAtSnapshot?: string;
  };
}

export function normConciliacaoText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function cleanOnlyDigits(value: unknown): string {
  const s = String(value || '').trim();
  if (!s || /[x*]/i.test(s)) return '';
  return s.replace(/\D/g, '');
}

export function normalizeCarKey(value: unknown): string {
  const s = String(value || '').trim().toUpperCase();
  if (!s || ['NAN', 'NULL', 'UNDEFINED'].includes(s)) return '';
  return s.replace(/[^A-Z0-9]/g, '');
}

function buildCarMatchSet(value: unknown): Set<string> {
  const out = new Set<string>();
  const raw = String(value || '').trim();
  if (!raw) return out;
  for (const k of extractNormalizedCarMatchKeys(raw)) {
    const compact = k.replace(/[^A-Z0-9]/g, '');
    if (compact.length >= 4) out.add(compact);
  }
  const simple = normalizeCarKey(raw);
  if (
    simple.length >= 6 &&
    !['NAOINFORMADO', 'NAOPOSSUI', 'SEMCAR', 'PENDENTE'].includes(simple)
  ) {
    out.add(simple);
  }
  return out;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

export function computarSimilaridadeNome(nomeA: string, nomeB: string): number {
  const a = normConciliacaoText(nomeA);
  const b = normConciliacaoText(nomeB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const maxLen = Math.max(a.length, b.length);
  const charSim = 1 - levenshteinDistance(a, b) / maxLen;

  const stopWords = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'ltda', 'sa', 'me', 'epp', 'fazenda']);
  const tokensA = a.split(' ').filter(t => t.length >= 2 && !stopWords.has(t));
  const tokensB = b.split(' ').filter(t => t.length >= 2 && !stopWords.has(t));
  if (tokensA.length === 0 || tokensB.length === 0) {
    return Number(charSim.toFixed(3));
  }

  let matchedTokens = 0;
  for (const ta of tokensA) {
    if (tokensB.some(tb => tb === ta || (ta.length >= 4 && tb.length >= 4 && levenshteinDistance(ta, tb) <= 1))) {
      matchedTokens++;
    }
  }
  const tokenSim = (2 * matchedTokens) / (tokensA.length + tokensB.length);
  return Number(Math.max(charSim, (charSim + tokenSim) / 2).toFixed(3));
}

/**
 * Avalia coordenadas de uma barragem/processo quanto à ausência, invalidade ou ambiguidade geográfica.
 */
export function avaliarCoordenadasBarragem(
  latitude: unknown,
  longitude: unknown
): CoordenadaDiagnostico {
  const rawLat = String(latitude ?? '').trim();
  const rawLng = String(longitude ?? '').trim();

  if (!rawLat && !rawLng) {
    return {
      status: 'ausente',
      latDecimal: null,
      lngDecimal: null,
      mensagem: 'Coordenadas ausentes na barragem/processo. Utilize conciliação manual ou complete a coordenada antes da consulta espacial.',
      permiteConsultaEspacial: false
    };
  }

  const latRes = parseCoordAdvanced(rawLat, false);
  const lngRes = parseCoordAdvanced(rawLng, true);

  if (!latRes.valido || !lngRes.valido || latRes.decimal === null || lngRes.decimal === null) {
    return {
      status: 'invalida',
      latDecimal: latRes.decimal,
      lngDecimal: lngRes.decimal,
      mensagem: 'Coordenadas incompletas ou inválidas (não foi possível converter para EPSG:4326).',
      permiteConsultaEspacial: false
    };
  }

  const lat = latRes.decimal;
  const lng = lngRes.decimal;

  // Verifica se está dentro dos limites aproximados de Mato Grosso e se não é coordenada genérica arredondada
  const inMtBounds = lat <= -6.0 && lat >= -19.5 && lng <= -49.5 && lng >= -62.5;
  const isRoundedInteger = Math.abs(lat - Math.round(lat)) < 1e-6 || Math.abs(lng - Math.round(lng)) < 1e-6;

  if (!inMtBounds || isRoundedInteger) {
    return {
      status: 'fora_mt_ou_ambigua',
      latDecimal: lat,
      lngDecimal: lng,
      latGms: latRes.gms || undefined,
      lngGms: lngRes.gms || undefined,
      mensagem: !inMtBounds
        ? 'Coordenada fora dos limites geográficos usuais de Mato Grosso — possível inversão de eixos, hemisfério ou datum.'
        : 'Coordenada com baixa precisão (grau inteiro sem minutos/segundos) — trate qualquer retorno espacial apenas como indício.',
      permiteConsultaEspacial: inMtBounds
    };
  }

  return {
    status: 'valida',
    latDecimal: lat,
    lngDecimal: lng,
    latGms: latRes.gms || undefined,
    lngGms: lngRes.gms || undefined,
    mensagem: 'Coordenada válida. Lembre-se: a coordenada pode apontar sede ou barragem (evidência apenas).',
    permiteConsultaEspacial: true
  };
}

/**
 * Regra crítica de domínio:
 * Um mesmo CAR pode conter várias barragens. CAR não identifica uma barragem isoladamente.
 */
export function detectarMultiplasBarragensMesmoCar(
  targetBarragem: BarragemRecord,
  todasBarragens: BarragemRecord[]
): MultiDamCarInfo {
  const carOrig = String(targetBarragem?.car || '').trim();
  const carNorm = normalizeCarKey(carOrig);
  if (!carNorm) {
    return {
      carOriginal: '',
      carNormalizado: '',
      totalBarragensNoMesmoCar: 0,
      outrasBarragens: [],
      avisoMultiplasBarragens: false,
      mensagem: 'Barragem sem número de CAR cadastrado.'
    };
  }

  const mesmas = (todasBarragens || []).filter(
    b => b && normalizeCarKey(b.car) === carNorm
  );
  const outras = mesmas
    .filter(b => String(b.id) !== String(targetBarragem.id))
    .map(b => ({
      id: String(b.id),
      nome: String(b.nome || 'Barragem sem nome'),
      processo: b.processo ? String(b.processo) : undefined,
      empreendedorId: b.empreendedorId ? String(b.empreendedorId) : undefined,
      empreendedorTexto: b.empreendedor ? String(b.empreendedor) : undefined
    }));

  return {
    carOriginal: carOrig,
    carNormalizado: carNorm,
    totalBarragensNoMesmoCar: mesmas.length,
    outrasBarragens: outras,
    avisoMultiplasBarragens: outras.length > 0,
    mensagem:
      outras.length > 0
        ? `Atenção: existem ${mesmas.length} barragens cadastradas no mesmo CAR (${carOrig}). Um mesmo CAR pode conter várias barragens e não substitui a identificação individual da estrutura.`
        : `CAR ${carOrig} possui apenas esta barragem cadastrada até o momento.`
  };
}

function pushAtorIfValid(
  list: AtorExtraidoProcesso[],
  seenKeys: Set<string>,
  rawNome: string | undefined,
  papel: AtorPapel,
  origem: string,
  rawDoc?: string,
  observacao?: string
) {
  const nome = String(rawNome || '').trim();
  if (!nome || nome.length < 2) return;
  const digits = cleanOnlyDigits(rawDoc);
  const dedupeKey = `${papel}::${normConciliacaoText(nome)}::${digits}`;
  if (seenKeys.has(dedupeKey)) return;
  seenKeys.add(dedupeKey);

  // Regra crítica: notificado e responsável pela área NUNCA são presumidos como proprietário/empreendedor
  const presunivelEmpreendedor = papel === 'empreendedor' || papel === 'proprietario_titular';

  list.push({
    id: `ator_${list.length + 1}_${papel}`,
    nome,
    docDigits: digits || undefined,
    cpfCnpjMascarado: rawDoc
      ? digits
        ? maskCpfCnpjDisplay(digits)
        : String(rawDoc).trim()
      : undefined,
    papel,
    origem,
    presunivelEmpreendedor,
    observacao
  });
}

function extractLabeledActorsFromText(
  text: string,
  origem: string,
  list: AtorExtraidoProcesso[],
  seen: Set<string>
) {
  if (!text) return;
  const patterns: Array<{ regex: RegExp; papel: AtorPapel; note?: string }> = [
    {
      regex: /(?:notificad[oa]|autuad[oa]|destinat[aá]ri[oa])\s*[:\-–]\s*([^;\n|]{3,120})/gi,
      papel: 'notificado',
      note: 'Pessoa notificada — manter papel explícito e não presumir empreendedora automaticamente.'
    },
    {
      regex: /(?:respons[aá]vel\s+pel[ao]\s+[aá]rea|gestor\s+da\s+[aá]rea|prepost[oa])\s*[:\-–]\s*([^;\n|]{3,120})/gi,
      papel: 'responsavel_area',
      note: 'Responsável pela área — papel distinto de proprietário/titular e empreendedor.'
    },
    {
      regex: /(?:arrendat[aá]ri[oa]|comodat[aá]ri[oa]|ocupante)\s*[:\-–]\s*([^;\n|]{3,120})/gi,
      papel: 'arrendatario',
      note: 'Arrendatário — não confundir com proprietário/titular do imóvel.'
    },
    {
      regex: /(?:propriet[aá]ri[oa]|titular(?:\s+do\s+im[oó]vel)?)\s*[:\-–]\s*([^;\n|]{3,120})/gi,
      papel: 'proprietario_titular'
    },
    {
      regex: /(?:empreendedor(?:a)?)\s*[:\-–]\s*([^;\n|]{3,120})/gi,
      papel: 'empreendedor'
    }
  ];

  for (const { regex, papel, note } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const segment = String(m[1] || '').trim();
      const docMatch =
        segment.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/) ||
        segment.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/) ||
        segment.match(/(?<![\d/.\-xX*])(\d{14}|\d{11})(?![\d/.\-xX*])/);
      const rawDoc = docMatch?.[0];
      const cleanName = segment
        .replace(/\(\s*(?:CPF|CNPJ)?\s*[:\-]?\s*[\d./\-]+\s*\)/gi, '')
        .replace(/\b(?:CPF|CNPJ)\s*[:\-]?\s*[\d./\-]+\b/gi, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      pushAtorIfValid(list, seen, cleanName || segment, papel, origem, rawDoc, note);
    }
  }
}

/**
 * Extrai e separa explicitamente os atores do processo/documentos/notificações por papel,
 * sem nunca promover "notificado" ou "responsável pela área" para "empreendedor" ou "proprietário".
 */
export function extrairAtoresDoProcesso(params: {
  barragem: BarragemRecord;
  documentos?: BarragemDocumentoEmitidoItem[];
  notificacoes?: NotificacaoProcessoEntrada[];
  empreendedores?: EmpreendedorRecord[];
}): AtorExtraidoProcesso[] {
  const { barragem, documentos = [], notificacoes = [], empreendedores = [] } = params;
  const result: AtorExtraidoProcesso[] = [];
  const seen = new Set<string>();

  const legacyText = String(barragem?.empreendedor || '').trim();
  const isKnownId = Boolean(
    legacyText && (empreendedores || []).some(e => String(e.id) === legacyText)
  );
  if (legacyText && !isKnownId) {
    const labeledMatches =
      /(?:notificad[oa]|respons[aá]vel\s+pel[ao]\s+[aá]rea|arrendat[aá]ri[oa]|propriet[aá]ri[oa]|titular)\s*[:\-–]/i.test(
        legacyText
      );
    if (labeledMatches) {
      extractLabeledActorsFromText(legacyText, 'Campo legado da barragem', result, seen);
    } else {
      const digits = cleanOnlyDigits(legacyText);
      const nomeClean = legacyText
        .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '')
        .replace(/^[\s\-–:|]+|[\s\-–:|]+$/g, '')
        .trim();
      pushAtorIfValid(
        result,
        seen,
        nomeClean || legacyText,
        'empreendedor',
        'Referência legada na barragem',
        digits.length === 11 || digits.length === 14 ? digits : undefined,
        'Referência textual do cadastro legado — sujeita à confirmação cadastral.'
      );
    }
  }

  if (barragem?.observacoes) {
    extractLabeledActorsFromText(String(barragem.observacoes), 'Observações da barragem', result, seen);
  }

  for (const notif of notificacoes) {
    if (!notif) continue;
    const origem = notif.tipoDocumento
      ? `${notif.tipoDocumento}${notif.processo ? ` (${notif.processo})` : ''}`
      : 'Notificação do processo';

    if (notif.notificadoNome) {
      pushAtorIfValid(
        result,
        seen,
        notif.notificadoNome,
        'notificado',
        origem,
        notif.notificadoDocumento,
        'Pessoa notificada no processo — NÃO deve ser presumida proprietária ou empreendedora.'
      );
    }
    if (notif.responsavelAreaNome) {
      pushAtorIfValid(
        result,
        seen,
        notif.responsavelAreaNome,
        'responsavel_area',
        origem,
        notif.responsavelAreaDocumento,
        'Responsável pela área citado no processo — papel distinto do empreendedor/proprietário.'
      );
    }
    if (notif.arrendatarioNome) {
      pushAtorIfValid(
        result,
        seen,
        notif.arrendatarioNome,
        'arrendatario',
        origem,
        notif.arrendatarioDocumento,
        'Arrendatário — distinto do proprietário/titular.'
      );
    }
    if (notif.proprietarioNome) {
      pushAtorIfValid(
        result,
        seen,
        notif.proprietarioNome,
        'proprietario_titular',
        origem,
        notif.proprietarioDocumento
      );
    }
    if (notif.empreendedorNome) {
      pushAtorIfValid(
        result,
        seen,
        notif.empreendedorNome,
        'empreendedor',
        origem,
        notif.empreendedorDocumento
      );
    }
    if (notif.resumo) {
      extractLabeledActorsFromText(notif.resumo, origem, result, seen);
    }
  }

  for (const doc of documentos) {
    if (!doc) continue;
    const text = [doc.titulo, doc.resumo].filter(Boolean).join(' · ');
    extractLabeledActorsFromText(text, `${doc.tipo} (${doc.origemSistema})`, result, seen);
  }

  return result;
}

/**
 * Sugere candidatos de Empreendedor no cadastro mestre Administra para investigação humana.
 * - Notificado, responsável pela área e arrendatário PODEM gerar candidatos quando possuírem
 *   CPF/CNPJ exato ou CAR/MT coincidente, mantendo explícito o papel original e sem vincular automaticamente.
 * - Somente CPF/CNPJ normalizado exato ou CAR/MT coincidente gera candidato; nome semelhante/idêntico
 *   isolado sem um desses identificadores NÃO gera candidato.
 */
export function encontrarCandidatosEmpreendedor(params: {
  barragem: BarragemRecord;
  empreendedores: EmpreendedorRecord[];
  atoresDoProcesso?: AtorExtraidoProcesso[];
  barragensDoEmpreendedor?: BarragemRecord[];
  semaTitularNome?: string;
  semaDocDigits?: string;
  semaCar?: string;
}): {
  candidatos: EmpreendedorCandidatoSugestao[];
  classificacaoInicial: ConciliacaoClassificacao;
  motivoResumo: string;
} {
  const {
    barragem,
    empreendedores = [],
    atoresDoProcesso = [],
    barragensDoEmpreendedor = [],
    semaTitularNome,
    semaDocDigits,
    semaCar
  } = params;

  const atoresEmpreendimento = atoresDoProcesso.filter(a => a.presunivelEmpreendedor);
  const notificadosOuResponsaveis = atoresDoProcesso.filter(
    a => a.papel === 'notificado' || a.papel === 'responsavel_area' || a.papel === 'arrendatario'
  );

  const legacyRaw = String(barragem?.empreendedor || '').trim();
  const legacyDigits = cleanOnlyDigits(legacyRaw);
  const semaDigits = cleanOnlyDigits(semaDocDigits);

  const referentialNames: string[] = [];
  if (legacyRaw && !empreendedores.some(e => String(e.id) === legacyRaw)) {
    referentialNames.push(legacyRaw);
  }
  for (const a of atoresDoProcesso) {
    if (a.nome) referentialNames.push(a.nome);
  }
  if (semaTitularNome) {
    referentialNames.push(semaTitularNome);
  }

  // Mapa de dígitos exatos de CPF/CNPJ -> papéis de origem nos autos/SEMA
  const docToRoles = new Map<string, Set<AtorPapel>>();
  const addDocRole = (digitsRaw: string | undefined, papel: AtorPapel) => {
    const d = cleanOnlyDigits(digitsRaw);
    if (d.length !== 11 && d.length !== 14) return;
    if (!docToRoles.has(d)) docToRoles.set(d, new Set());
    docToRoles.get(d)!.add(papel);
  };

  if (legacyDigits.length === 11 || legacyDigits.length === 14) {
    addDocRole(legacyDigits, 'empreendedor');
  }
  if (semaDigits.length === 11 || semaDigits.length === 14) {
    addDocRole(semaDigits, 'proprietario_titular');
  }
  for (const a of atoresDoProcesso) {
    if (a.docDigits) {
      addDocRole(a.docDigits, a.papel);
    }
  }

  // Chaves CAR normalizadas da barragem e da eventual feição SEMA selecionada
  const targetCarKeys = new Set<string>([
    ...buildCarMatchSet(barragem?.car),
    ...buildCarMatchSet(semaCar)
  ]);

  const candidatos: EmpreendedorCandidatoSugestao[] = [];
  const addedIds = new Set<string>();

  for (const emp of empreendedores) {
    if (!emp || !emp.id) continue;
    const empId = String(emp.id);
    const empDigits = cleanOnlyDigits(emp.cpfCnpj);

    let bestSim = 0;
    for (const refName of referentialNames) {
      bestSim = Math.max(
        bestSim,
        computarSimilaridadeNome(refName, emp.nome || ''),
        emp.nomeFantasia ? computarSimilaridadeNome(refName, emp.nomeFantasia) : 0
      );
    }

    const exactIdMatched = Boolean(legacyRaw && empId === legacyRaw);
    if (exactIdMatched) {
      addedIds.add(empId);
      candidatos.push({
        empreendedorId: empId,
        nome: emp.nome,
        nomeFantasia: emp.nomeFantasia,
        cpfCnpjMascarado: emp.cpfCnpj ? maskCpfCnpjDisplay(emp.cpfCnpj) : undefined,
        municipioUf: [emp.municipio, emp.uf].filter(Boolean).join('/'),
        criterio: 'id_exato',
        similaridade: 1,
        possuiIdentificadorForte: true,
        papelOriginal: 'empreendedor',
        papeisOrigem: ['empreendedor'],
        classificacaoSugerida: 'candidato',
        motivo: 'ID de empreendedor encontrado no texto legado da barragem (requer confirmação formal do vínculo).'
      });
      continue;
    }

    const matchedRolesSet =
      empDigits && (empDigits.length === 11 || empDigits.length === 14)
        ? docToRoles.get(empDigits)
        : undefined;

    if (matchedRolesSet && matchedRolesSet.size > 0) {
      const papeisOrigem = Array.from(matchedRolesSet);
      const hasPrimaryRole =
        matchedRolesSet.has('empreendedor') || matchedRolesSet.has('proprietario_titular');
      const papelOriginal: AtorPapel = hasPrimaryRole
        ? matchedRolesSet.has('empreendedor')
          ? 'empreendedor'
          : 'proprietario_titular'
        : papeisOrigem[0];

      addedIds.add(empId);
      candidatos.push({
        empreendedorId: empId,
        nome: emp.nome,
        nomeFantasia: emp.nomeFantasia,
        cpfCnpjMascarado: emp.cpfCnpj ? maskCpfCnpjDisplay(emp.cpfCnpj) : undefined,
        municipioUf: [emp.municipio, emp.uf].filter(Boolean).join('/'),
        criterio: 'cpf_cnpj_exato',
        similaridade: Math.max(bestSim, 0.9),
        possuiIdentificadorForte: true,
        papelOriginal,
        papeisOrigem,
        classificacaoSugerida: hasPrimaryRole ? 'candidato' : 'papeis_diferentes',
        motivo: hasPrimaryRole
          ? 'Correspondência exata por CPF/CNPJ normalizado nos autos/SEMA (requer decisão humana).'
          : `CPF/CNPJ normalizado exato encontrado como ${ATOR_PAPEL_LABELS[papelOriginal]} — papel original preservado (não presumir empreendedor sem revisão humana).`
      });
      continue;
    }

    // Correspondência por CAR/MT coincidente (em empreendimentos do titular OU outras barragens do mesmo titular)
    let matchedCarLabel: string | undefined;
    if (targetCarKeys.size > 0) {
      if (Array.isArray(emp.empreendimentos)) {
        for (const em of emp.empreendimentos) {
          const emKeys = buildCarMatchSet(em?.car);
          for (const k of emKeys) {
            if (targetCarKeys.has(k)) {
              matchedCarLabel = String(em?.car || barragem?.car || semaCar || '');
              break;
            }
          }
          if (matchedCarLabel) break;
        }
      }

      if (!matchedCarLabel && barragensDoEmpreendedor.length > 0) {
        for (const otherDam of barragensDoEmpreendedor) {
          if (!otherDam || String(otherDam.id) === String(barragem?.id)) continue;
          const otherEmpId = String(
            (otherDam as any).empreendedorId || (otherDam as any).empreendedor_id || ''
          ).trim();
          const otherEmpLegacy = String(otherDam.empreendedor || '').trim();
          const belongsToEmp = otherEmpId === empId || otherEmpLegacy === empId;
          if (!belongsToEmp) continue;

          const otherKeys = buildCarMatchSet(otherDam.car);
          for (const k of otherKeys) {
            if (targetCarKeys.has(k)) {
              matchedCarLabel = String(otherDam.car || barragem?.car || semaCar || '');
              break;
            }
          }
          if (matchedCarLabel) break;
        }
      }
    }

    if (matchedCarLabel && !addedIds.has(empId)) {
      addedIds.add(empId);
      candidatos.push({
        empreendedorId: empId,
        nome: emp.nome,
        nomeFantasia: emp.nomeFantasia,
        cpfCnpjMascarado: emp.cpfCnpj ? maskCpfCnpjDisplay(emp.cpfCnpj) : undefined,
        municipioUf: [emp.municipio, emp.uf].filter(Boolean).join('/'),
        criterio: 'car_em_empreendimento',
        similaridade: bestSim,
        possuiIdentificadorForte: false,
        carCoincidente: matchedCarLabel,
        classificacaoSugerida: 'candidato',
        motivo: `CAR/MT coincidente (${matchedCarLabel}) — candidato para revisão humana (um CAR pode conter múltiplas barragens).`
      });
    }
  }

  candidatos.sort((a, b) => {
    if (a.possuiIdentificadorForte !== b.possuiIdentificadorForte) {
      return a.possuiIdentificadorForte ? -1 : 1;
    }
    return b.similaridade - a.similaridade;
  });

  const strongDirectMatches = candidatos.filter(
    c => c.possuiIdentificadorForte && c.classificacaoSugerida !== 'papeis_diferentes'
  );
  const roleDistinctDocMatches = candidatos.filter(
    c => c.possuiIdentificadorForte && c.classificacaoSugerida === 'papeis_diferentes'
  );
  const carMatches = candidatos.filter(c => c.criterio === 'car_em_empreendimento');

  let classificacaoInicial: ConciliacaoClassificacao = 'sem_correspondencia';
  let motivoResumo =
    'Nenhuma correspondência por CPF/CNPJ exato ou CAR/MT coincidente encontrada no cadastro mestre.';

  if (strongDirectMatches.length > 1) {
    classificacaoInicial = 'ambiguo';
    motivoResumo = `Múltiplos empreendedores compatíveis por CPF/CNPJ ou ID (${strongDirectMatches.length}); requer revisão manual.`;
  } else if (strongDirectMatches.length === 1) {
    classificacaoInicial = 'candidato';
    motivoResumo = strongDirectMatches[0].motivo;
  } else if (roleDistinctDocMatches.length > 0) {
    classificacaoInicial = roleDistinctDocMatches.length > 1 ? 'ambiguo' : 'papeis_diferentes';
    motivoResumo =
      roleDistinctDocMatches.length === 1
        ? roleDistinctDocMatches[0].motivo
        : `Múltiplos candidatos com CPF/CNPJ exato em papéis distintos de empreendedor (${roleDistinctDocMatches.length}); revisar papéis antes de vincular.`;
  } else if (carMatches.length > 1) {
    classificacaoInicial = 'ambiguo';
    motivoResumo = `Múltiplos empreendedores compartilham o mesmo CAR/MT (${carMatches.length}); revisar titularidade pois um CAR pode conter múltiplas barragens.`;
  } else if (carMatches.length === 1) {
    classificacaoInicial = 'candidato';
    motivoResumo = carMatches[0].motivo;
  } else if (notificadosOuResponsaveis.length > 0) {
    if (atoresEmpreendimento.length > 0) {
      const temDivergenciaPapel = notificadosOuResponsaveis.some(n =>
        atoresEmpreendimento.every(e => computarSimilaridadeNome(n.nome, e.nome) < 0.85)
      );
      classificacaoInicial = temDivergenciaPapel ? 'papeis_diferentes' : 'papeis_diferentes';
      motivoResumo = temDivergenciaPapel
        ? 'Pessoa notificada / responsável pela área diverge do titular/empreendedor indicado; sem CPF/CNPJ ou CAR coincidente.'
        : 'Há apenas pessoa notificada, arrendatário ou responsável pela área sem correspondência por CPF/CNPJ ou CAR/MT; não presumir empreendedor.';
    } else {
      classificacaoInicial = 'papeis_diferentes';
      motivoResumo =
        'Há apenas pessoa notificada, arrendatário ou responsável pela área nos autos, sem CPF/CNPJ ou CAR/MT coincidente; não presumir como empreendedor/proprietário.';
    }
  }

  return {
    candidatos,
    classificacaoInicial,
    motivoResumo
  };
}

/**
 * Regra explícita: ausência de RT em Notificações ou Ofícios NÃO é divergência.
 */
export function isDocumentoSemRtIgnoradoComoDivergencia(tipoDocumento: unknown): boolean {
  const norm = normConciliacaoText(tipoDocumento);
  if (!norm) return true;
  if (norm.includes('parecer')) return false;
  if (
    norm.includes('notifica') ||
    norm.includes('oficio') ||
    norm.includes('auto de infracao') ||
    norm.includes('embargo')
  ) {
    return true;
  }
  return false;
}

function normArtCode(val: unknown): string {
  return String(val || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Extrai menções a RT, ART/RRT/CFT e conselho/registro de um texto de Parecer Técnico ou de Classificação.
 */
export function extrairCitacaoRtDeParecer(doc: {
  titulo?: string;
  resumo?: string;
  numero?: string;
  responsavelTecnicoNome?: string;
  artNumero?: string;
  conselhoRegistro?: string;
}): ParecerRtCitacaoExtraida | null {
  const combined = [doc.titulo, doc.resumo].filter(Boolean).join(' | ');

  let artNumero = String(doc.artNumero || '').trim();
  if (!artNumero) {
    const artMatch = combined.match(
      /\b(?:ART|RRT|TRT|CFT)\s*(?:n[º°.]?\s*)?[:\-]?\s*([A-Z0-9.\-\/]{4,24})/i
    );
    if (artMatch?.[1]) {
      artNumero = artMatch[1].trim();
    }
  }

  let rtNome = String(doc.responsavelTecnicoNome || '').trim();
  if (!rtNome) {
    const rtMatch = combined.match(
      /(?:\brespons[aá]vel\s+t[eé]cnic[oa]\b|\bRT\b)\s*[:\-–]\s*([A-Za-zÀ-ÿ\s.]{4,70}?)(?=\s*(?:\||·|;|,|\(|-|–|\bCREA\b|\bCAU\b|\bCFT\b|\bART\b|\bRRT\b|$))/i
    );
    if (rtMatch?.[1]) {
      rtNome = rtMatch[1].trim();
    }
  }

  let conselho = '';
  let registro = String(doc.conselhoRegistro || '').trim();
  const consMatch = combined.match(
    /\b(CREA|CAU|CFT|CRQ|CONFEA)\s*(?:[-\/]\s*[A-Z]{2})?\s*(?:n[º°.]?\s*)?[:\-]?\s*([0-9A-Z.\-\/]{3,20})/i
  );
  if (consMatch) {
    conselho = consMatch[1].toUpperCase();
    if (!registro && consMatch[2]) {
      registro = consMatch[2].trim();
    }
  }

  if (!artNumero && !rtNome && !registro) {
    return null;
  }

  return {
    rtNome: rtNome || undefined,
    artNumero: artNumero || undefined,
    conselho: conselho || undefined,
    registro: registro || undefined,
    origemTrecho: combined || doc.numero || 'Metadados do parecer'
  };
}

/**
 * Compara pareceres (Parecer Técnico / Parecer de Classificação) que citam RT ou ART
 * contra os vínculos estruturados em `rts` (responsaveis_tecnicos_barragens).
 * Nunca trata ausência de RT em notificações ou ofícios como divergência.
 */
export function analisarPareceresRtPendentes(params: {
  barragens: BarragemRecord[];
  rts: ResponsavelTecnicoRecord[];
  documentosPorBarragem: Record<string, BarragemDocumentoEmitidoItem[]>;
}): RtParecerPendencia[] {
  const { barragens = [], rts = [], documentosPorBarragem = {} } = params;
  const pendencias: RtParecerPendencia[] = [];

  for (const dam of barragens) {
    if (!dam || !dam.id) continue;
    const damIdStr = String(dam.id);
    const damNameNorm = normConciliacaoText(dam.nome);
    const docs = documentosPorBarragem[damIdStr] || [];

    // Vínculos estruturados atuais desta barragem
    const vinculosEstruturados: Array<{
      rtId: string;
      rtNome: string;
      art: string;
      situacao?: string;
    }> = [];

    for (const rt of rts) {
      if (!rt) continue;
      const vList = Array.isArray(rt.vinculos) ? rt.vinculos : [];
      for (const v of vList) {
        const matchesId =
          String(v.barragemId || '') === damIdStr ||
          String(v.barragemVinculada || '') === damIdStr;
        const matchesName =
          Boolean(damNameNorm) && normConciliacaoText(v.nomeBarragem) === damNameNorm;
        if (matchesId || matchesName) {
          vinculosEstruturados.push({
            rtId: String(rt.id),
            rtNome: String(rt.nome || ''),
            art: String(v.art || v.artRrt || ''),
            situacao: v.situacao || rt.situacao
          });
        }
      }
    }

    for (const doc of docs) {
      if (!doc) continue;
      // Regra: nunca tratar notificação/ofício sem RT como divergência
      if (isDocumentoSemRtIgnoradoComoDivergencia(doc.tipo)) continue;
      const tipoNorm = normConciliacaoText(doc.tipo);
      if (!tipoNorm.includes('parecer')) continue;

      const citacao = extrairCitacaoRtDeParecer({
        titulo: doc.titulo,
        resumo: doc.resumo,
        numero: doc.numero,
        responsavelTecnicoNome: (doc as any).responsavelTecnicoNome,
        artNumero: (doc as any).artNumero,
        conselhoRegistro: (doc as any).conselhoRegistro
      });

      if (!citacao) continue;

      const artNorm = normArtCode(citacao.artNumero);
      const rtNomeNorm = normConciliacaoText(citacao.rtNome);

      const jaVinculadoArt = Boolean(
        artNorm && vinculosEstruturados.some(v => normArtCode(v.art) === artNorm)
      );
      const jaVinculadoNome = Boolean(
        rtNomeNorm &&
          vinculosEstruturados.some(v => computarSimilaridadeNome(v.rtNome, citacao.rtNome || '') >= 0.9)
      );

      if (jaVinculadoArt || (jaVinculadoNome && !artNorm)) {
        continue;
      }

      // Busca candidatos no cadastro mestre de RTs sem mesclar automaticamente
      const candidatosRt: RtCandidatoSugestao[] = [];
      const regCitado = normArtCode(citacao.registro);
      for (const rt of rts) {
        if (!rt) continue;
        const regRt = normArtCode(rt.registro);
        const simNome = citacao.rtNome ? computarSimilaridadeNome(citacao.rtNome, rt.nome || '') : 0;

        if (regCitado && regRt && regCitado === regRt) {
          candidatosRt.push({
            rtId: String(rt.id),
            nome: rt.nome,
            conselho: rt.conselho,
            registro: rt.registro,
            cpfMascarado: rt.cpf ? maskCpfCnpjDisplay(rt.cpf) : undefined,
            criterio: 'registro_exato',
            similaridade: Math.max(simNome, 0.95),
            possuiIdentificadorForte: true,
            classificacaoSugerida: 'candidato',
            motivo: 'RT localizado no cadastro mestre pelo número de registro profissional.'
          });
        } else if (simNome >= 0.99) {
          candidatosRt.push({
            rtId: String(rt.id),
            nome: rt.nome,
            conselho: rt.conselho,
            registro: rt.registro,
            cpfMascarado: rt.cpf ? maskCpfCnpjDisplay(rt.cpf) : undefined,
            criterio: 'nome_exato_sem_doc',
            similaridade: 1,
            possuiIdentificadorForte: false,
            classificacaoSugerida: 'vinculo_ausente',
            motivo: 'RT com mesmo nome no cadastro mestre (sem registro/CPF conferido no parecer); vínculo ausente nesta barragem.'
          });
        } else if (simNome >= 0.72) {
          candidatosRt.push({
            rtId: String(rt.id),
            nome: rt.nome,
            conselho: rt.conselho,
            registro: rt.registro,
            cpfMascarado: rt.cpf ? maskCpfCnpjDisplay(rt.cpf) : undefined,
            criterio: 'nome_semelhante_sem_doc',
            similaridade: simNome,
            possuiIdentificadorForte: false,
            classificacaoSugerida: 'possivel_erro_grafia',
            motivo: `RT semelhante (${Math.round(simNome * 100)}%) sem confirmação por registro/CPF.`
          });
        }
      }

      candidatosRt.sort((a, b) => {
        if (a.possuiIdentificadorForte !== b.possuiIdentificadorForte) {
          return a.possuiIdentificadorForte ? -1 : 1;
        }
        return b.similaridade - a.similaridade;
      });

      const strongCount = candidatosRt.filter(c => c.possuiIdentificadorForte).length;
      const classificacaoSugerida: ConciliacaoClassificacao =
        strongCount > 1
          ? 'ambiguo'
          : strongCount === 1
          ? 'vinculo_ausente'
          : candidatosRt.length > 0
          ? candidatosRt[0].classificacaoSugerida
          : 'vinculo_ausente';

      pendencias.push({
        id: `rt_parecer_${damIdStr}_${doc.id}`,
        barragemId: damIdStr,
        barragemNome: String(dam.nome || 'Barragem sem nome'),
        barragemUpdatedAt: dam.updatedAt,
        processo: dam.processo || doc.processo,
        car: dam.car,
        documentoId: doc.id,
        documentoTipo: doc.tipo,
        documentoTitulo: doc.titulo,
        documentoNumero: doc.numero,
        documentoData: doc.dataEmissao,
        documentoOrigem: doc.origemSistema,
        citacao,
        vinculosEstruturadosDaBarragem: vinculosEstruturados,
        candidatosRtMestre: candidatosRt,
        classificacaoSugerida,
        motivo: citacao.artNumero
          ? `Parecer cita ${citacao.rtNome || 'RT'} (ART ${citacao.artNumero}) sem vínculo estruturado correspondente nesta barragem.`
          : `Parecer cita RT "${citacao.rtNome || citacao.registro}" sem vínculo estruturado correspondente nesta barragem.`
      });
    }
  }

  return pendencias;
}

function timestampsMatch(expected: string | undefined, actual: string | undefined): boolean {
  if (!expected) return true;
  if (!actual) return false;
  if (expected === actual) return true;
  const p1 = Date.parse(expected);
  const p2 = Date.parse(actual);
  if (Number.isFinite(p1) && Number.isFinite(p2)) {
    return Math.abs(p1 - p2) <= 1;
  }
  return false;
}

/**
 * Validação de concorrência otimista antes de qualquer escrita no cadastro mestre.
 * Confirma que o registro mestre existe no banco central e não foi alterado desde o início da revisão.
 */
export async function verificarConcorrenciaCadastroMestre(params: {
  entidadeTipo: 'barragem' | 'rt';
  entidadeId: string;
  expectedUpdatedAt?: string;
  expectedEmpreendedorId?: string;
  localRecords: Array<{ id: string; updatedAt?: string; empreendedorId?: string; empreendedor?: string }>;
  supabaseClient?: any;
  allowLocalOnlyFallback?: boolean;
}): Promise<{ ok: boolean; error?: string; currentUpdatedAt?: string }> {
  const {
    entidadeTipo,
    entidadeId,
    expectedUpdatedAt,
    expectedEmpreendedorId,
    localRecords,
    supabaseClient,
    allowLocalOnlyFallback = false
  } = params;

  const localItem = localRecords.find(r => String(r.id) === String(entidadeId));
  if (!localItem) {
    return {
      ok: false,
      error: 'O registro mestre alvo não foi localizado na base carregada.'
    };
  }

  if (expectedUpdatedAt && localItem.updatedAt && !timestampsMatch(expectedUpdatedAt, localItem.updatedAt)) {
    return {
      ok: false,
      currentUpdatedAt: localItem.updatedAt,
      error:
        'O cadastro mestre foi modificado durante esta revisão. Reabra a investigação para conferir os dados atualizados antes de gravar.'
    };
  }

  const remoteClient = supabaseClient ?? (isSupabaseConfigured() ? supabase : null);
  if (!remoteClient) {
    if (allowLocalOnlyFallback) {
      return {
        ok: true,
        currentUpdatedAt: localItem.updatedAt
      };
    }
    return {
      ok: false,
      error: 'Banco central indisponível para validar concorrência antes da gravação no cadastro mestre.'
    };
  }

  const table = entidadeTipo === 'barragem' ? 'barragens' : 'rts';
  const cols =
    entidadeTipo === 'barragem'
      ? 'id,updated_at,empreendedor_id,empreendedor'
      : 'id,updated_at';

  try {
    const { data, error } = await remoteClient
      .from(table)
      .select(cols)
      .eq('id', entidadeId)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        error: `Não foi possível validar o estado atual no banco central: ${error.message}`
      };
    }

    if (!data) {
      return {
        ok: false,
        error:
          'Conflito de concorrência: o registro mestre alvo não foi encontrado no banco central.'
      };
    }

    const remoteUpdatedAt = (data as any).updated_at ? String((data as any).updated_at) : '';
    if (expectedUpdatedAt && !timestampsMatch(expectedUpdatedAt, remoteUpdatedAt)) {
      return {
        ok: false,
        currentUpdatedAt: remoteUpdatedAt,
        error:
          'Conflito de concorrência detectado: outro usuário atualizou o cadastro mestre na base central desde o início desta revisão.'
      };
    }

    if (
      entidadeTipo === 'barragem' &&
      expectedEmpreendedorId !== undefined &&
      String((data as any).empreendedor_id || '') !== String(expectedEmpreendedorId || '')
    ) {
      return {
        ok: false,
        currentUpdatedAt: remoteUpdatedAt,
        error:
          'Conflito detectado: o vínculo de empreendedor desta barragem já foi alterado na base central.'
      };
    }

    return {
      ok: true,
      currentUpdatedAt: remoteUpdatedAt || localItem.updatedAt
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Erro ao verificar integridade concorrente no servidor.'
    };
  }
}

export interface GravarConciliacaoServidorParams {
  alvoTipo: 'barragem_empreendedor' | 'barragem_rt_parecer';
  barragemId: string;
  acao: ConciliacaoAcao;
  classificacao: ConciliacaoClassificacao;
  justificativa: string;
  masterUpdatedAtSnapshot?: string;
  masterEmpreendedorIdSnapshot?: string;
  selectedEmpreendedorId?: string;
  selectedRtId?: string;
  selectedRtArt?: string;
  selectedRtUpdatedAtSnapshot?: string;
  auditoriaId?: string;
  vincularCarDaSema?: boolean;
  semaCar?: string;
  auditPayload: RevisaoConciliacaoAuditPayload;
  accessToken?: string;
}

/**
 * Executa a gravação segura e atômica da conciliação exclusivamente pela rota do servidor
 * (`/api/conciliacao-gravar`), sem nunca realizar gravação direta pelo cliente.
 */
export async function gravarConciliacaoAssistidaServidor(
  params: GravarConciliacaoServidorParams
): Promise<{
  success: boolean;
  error?: string;
  revisaoId?: string;
  updatedAt?: string;
  barragem?: any;
  revisao?: any;
}> {
  let token = String(params.accessToken || '').trim();
  if (!token) {
    if (!isSupabaseConfigured() || !supabase) {
      return {
        success: false,
        error:
          'Banco central ou autenticação não configurada. A gravação de conciliação exige rota segura autenticada no servidor.'
      };
    }
    try {
      const { data } = await supabase.auth.getSession();
      let session = data?.session;
      const expiresAtMs = session?.expires_at ? Number(session.expires_at) * 1000 : 0;
      if (session && (!session.access_token || (expiresAtMs && expiresAtMs - Date.now() < 60_000))) {
        const { data: refreshed } = await supabase.auth.refreshSession().catch(() => ({ data: null }));
        if (refreshed?.session) session = refreshed.session;
      }
      token = session?.access_token || '';
    } catch {
      token = '';
    }
  }

  if (!token) {
    return {
      success: false,
      error: 'Sessão institucional ausente ou expirada. Faça login novamente antes de gravar.'
    };
  }

  try {
    const res = await fetch('/api/conciliacao-gravar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        alvoTipo: params.alvoTipo,
        barragemId: params.barragemId,
        acao: params.acao,
        classificacao: params.classificacao,
        justificativa: params.justificativa,
        masterUpdatedAtSnapshot: params.masterUpdatedAtSnapshot || null,
        masterEmpreendedorIdSnapshot: params.masterEmpreendedorIdSnapshot ?? null,
        selectedEmpreendedorId: params.selectedEmpreendedorId || null,
        selectedRtId: params.selectedRtId || null,
        selectedRtArt: params.selectedRtArt || null,
        selectedRtUpdatedAtSnapshot: params.selectedRtUpdatedAtSnapshot || null,
        auditoriaId: params.auditoriaId || null,
        vincularCarDaSema: Boolean(params.vincularCarDaSema),
        semaCar: params.semaCar || null,
        auditPayload: params.auditPayload
      })
    });

    const rawText = await res.text().catch(() => '');
    let data: any = null;
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = null;
      }
    }

    if (!res.ok || !data || data.success !== true) {
      return {
        success: false,
        error:
          data?.error ||
          `Falha ao gravar conciliação no servidor (HTTP ${res.status}). Nenhuma alteração foi aplicada.`
      };
    }

    return {
      success: true,
      revisaoId: data.revisaoId ? String(data.revisaoId) : undefined,
      updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
      barragem: data.barragem,
      revisao: data.revisao
    };
  } catch (err: any) {
    return {
      success: false,
      error:
        err?.message ||
        'Erro de comunicação com a rota segura de conciliação no servidor. Nenhuma alteração foi aplicada.'
    };
  }
}

export function construirRegistroRevisaoConciliacao(params: {
  id?: string;
  payload: RevisaoConciliacaoAuditPayload;
  createdBy?: string;
}): RevisaoConciliacaoRecord {
  const { id, payload, createdBy } = params;
  const nowIso = payload.dataDecisao || new Date().toISOString();

  const situacao: RevisaoConciliacaoRecord['situacao'] =
    payload.acao === 'vincular' ||
    payload.classificacao === 'confirmado_usuario' ||
    payload.classificacao === 'nao_e_divergencia'
      ? 'Conciliado'
      : payload.acao === 'rejeitar'
      ? 'Rejeitado'
      : 'Pendente';

  const classLabel = CONCILIACAO_CLASSIFICACAO_LABELS[payload.classificacao] || payload.classificacao;
  const acaoLabel = CONCILIACAO_ACAO_LABELS[payload.acao] || payload.acao;

  const resumoLegivel =
    `[${classLabel}] ${acaoLabel} · Anterior: ${payload.valorAnterior || 'Sem vínculo'} → Proposto: ${payload.valorProposto || 'Mantido sem vínculo'} · Justificativa: ${payload.justificativa}`;

  return {
    id:
      id ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `rev_${crypto.randomUUID()}`
        : `rev_${Date.now()}`),
    tipo:
      payload.alvoTipo === 'barragem_rt_parecer'
        ? 'Conciliação RT x Parecer'
        : 'Conciliação Barragem x Empreendedor',
    identificador: `${payload.barragemNome} (${payload.barragemId})`,
    origemA: payload.evidencias.processo
      ? `Processo ${payload.evidencias.processo}`
      : 'Dados do Processo / Administra',
    origemB: payload.evidencias.semaConsultada
      ? `SEMA/MT (${payload.evidencias.semaCamada || 'Geoportal'})`
      : 'Conferência manual cadastral',
    divergencias: resumoLegivel,
    situacao,
    decisao: JSON.stringify(payload),
    responsavel: payload.usuario,
    createdBy,
    updatedBy: createdBy,
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

export function parseRevisaoConciliacaoDetalhes(
  revisao: Partial<RevisaoConciliacaoRecord> & Record<string, any>
): {
  structured?: RevisaoConciliacaoAuditPayload;
  resumoTexto: string;
} {
  const rawDecisao = String(revisao?.decisao || '').trim();
  if (rawDecisao.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawDecisao);
      if (parsed && parsed.modulo === 'conciliacao_assistida') {
        return {
          structured: parsed as RevisaoConciliacaoAuditPayload,
          resumoTexto: String(revisao?.divergencias || parsed.justificativa || '—')
        };
      }
    } catch {
      // fallback texto simples
    }
  }
  return {
    resumoTexto: String(
      revisao?.divergencias || revisao?.decisao || revisao?.descricao || revisao?.motivo || '—'
    )
  };
}
