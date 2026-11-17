// src/utils/semaVinculoHelpers.ts
import {
  CAR_CAMPOS,
  deduplicateCarImoveisByCar,
  findBarragensMatchingSemaItem,
  formatCpfCnpjReadable,
  getCanonicalCarKeyFromSemaItem,
  stripOuterQuotesAndBrackets
} from '../config/carCampos';
import { CarFeatureMapped, SemaDocumentoItem } from '../types/carLookup';
import { IbgeMunicipio } from '../services/ibgeService';

export type BarragemSemaFieldKey =
  | 'car'
  | 'empreendimento'
  | 'municipio'
  | 'municipio_ibge'
  | 'processo';

export type FieldSelectionAction = 'preencher' | 'substituir' | 'manter';

export interface BarragemSemaFieldComparison {
  key: BarragemSemaFieldKey;
  label: string;
  currentValue: string;
  currentDisplay: string;
  semaValue: string;
  semaDisplay: string;
  isEmptyCurrent: boolean;
  isEqual: boolean;
  action: FieldSelectionAction;
}

export interface ConfirmedCpfCnpjExtraction {
  status: 'completo' | 'mascarado' | 'ausente';
  digits: string;
  formatted: string;
  campoOrigem?: string;
}

export interface EmpreendedorMatchOutcome {
  status: 'unico' | 'ambiguo' | 'nao_encontrado' | 'sem_documento';
  empreendedor?: any;
  matches: any[];
  digits: string;
}

export interface CarGroupedCard {
  canonicalKey: string;
  item: SemaDocumentoItem;
  carExibicao: string;
  carFederalExibicao: string;
  nomePropriedade: string;
  municipioExibicao: string;
  titularExibicao: string;
  camadaOrigem: string;
  consultadoEm: string;
  matchedBarragens: Array<{
    barragem: any;
    isCurrentBarragem: boolean;
  }>;
  hasOtherRegisteredDam: boolean;
  hasCurrentDam: boolean;
}

export const PROTECTED_BARRAGEM_FIELDS: ReadonlySet<string> = new Set([
  'latitude',
  'longitude',
  'altura',
  'volume',
  'danoPotencial',
  'dano_potencial',
  'dpa',
  'categoriaRisco',
  'categoria_risco',
  'cri',
  'situacao'
]);

export function cleanSemaText(val: unknown): string {
  if (val === undefined || val === null) return '';
  const cleaned = stripOuterQuotesAndBrackets(String(val)).replace(/"/g, '').trim();
  if (!cleaned || ['nan', 'null', 'undefined'].includes(cleaned.toLowerCase())) {
    return '';
  }
  return cleaned;
}

export function normalizeTextLoose(val: unknown): string {
  return cleanSemaText(val)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeDocDigits(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s || /[x*]/i.test(s)) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 || digits.length === 14) {
    return digits;
  }
  return '';
}

export function extractCleanOwnerName(raw: unknown): string {
  const base = cleanSemaText(raw);
  if (!base) return '';
  return base
    .replace(/^\[+|\]+$/g, '')
    .replace(/\s*\((?:[\d*xX]{2,3}\.[\d*xX]{3}\.[\d*xX]{3}(?:\/[\d*xX]{4})?-[\d*xX]{2}|[xX*]{11,14}|\d{11}|\d{14})\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^,\s*|,\s*$/g, '')
    .trim();
}

export function carFeatureToSemaItem(
  feat: CarFeatureMapped,
  consultadoEm?: string
): SemaDocumentoItem {
  const props = feat.propriedadesBrutas || {};
  const propNome = cleanSemaText(feat.empreendimento || props.NOMEPROPRIEDADE);
  const carEst = cleanSemaText(feat.car || props.NUMEROESTADUAL || props.PROTOCOLO);
  const carFed = cleanSemaText(feat.carFederal || props.CAR_FEDERAL || props.CODIGO_CAR_FEDERAL);
  const proc = cleanSemaText(
    props.NUMERO_PROCESSO || props.PROTOCOLO_NUMERO || props.PROTOCOLO
  );
  const owner = cleanSemaText(
    feat.empreendedor || props.NOMESPROPRIETARIOS || props.RAZAO_SOCIAL || props.PROPRIETARIOS
  );

  return {
    id: feat.id || carEst || carFed || null,
    tipo: 'CAR / Imóvel Rural',
    numeroDocumento: carEst || carFed || '',
    nomeDocumento: propNome || 'Imóvel sem denominação informada',
    dataDocumento: cleanSemaText(props.DATA_APROVACAO || props.DATA_CADASTRO || props.DATA_LANCAMENTO),
    numeroProcesso: proc || undefined,
    status: cleanSemaText(feat.situacaoCar || props.SITUACAO_CAR || props.SITUACAO) || undefined,
    razaoSocial: owner || undefined,
    municipio: cleanSemaText(feat.municipio || props.MUNICIPIO) || undefined,
    municipioCodigo: cleanSemaText(feat.municipioCodigo || props.MUNICIPIO_CODIGO) || undefined,
    camadaOrigem: feat.camadaOrigem || 'Geoportal:CAR_ATP',
    auditoriaId: feat.auditoriaId,
    camadaTitulo:
      feat.camadaOrigem === 'Geoportal:MVW_REQUERIMENTO_ATP'
        ? 'Requerimento de CAR (SEMA-MT)'
        : 'Cadastro Ambiental Rural - CAR/ATP (SEMA-MT)',
    carFederal: carFed || undefined,
    areaHa: cleanSemaText(feat.areaHa || props.AREA_HA) || undefined,
    atividade: cleanSemaText(feat.atividade || props.ATIVIDADE) || undefined,
    criterioEspacial: feat.criterioEspacial,
    distanciaMetros: feat.distanciaMetros,
    observacaoEspacial: feat.evidenciaNota,
    correspondenciaExploratoria: false,
    camposConfirmadosEsquema: feat.camposConfirmadosEsquema,
    cpfCnpjCompletoDisponivel: feat.cpfCnpjCompletoDisponivel,
    cpfCnpjCampoOrigem: feat.cpfCnpjCampoOrigem,
    cpfCnpjStatus: feat.cpfCnpjStatus,
    consultadoEm,
    propriedadesBrutas: props
  };
}

/**
 * Lê CPF/CNPJ exclusivamente de atributos confirmados no esquema XML da camada (DescribeFeatureType).
 * Nunca inventa, deduz de critérios de pesquisa ou utiliza valores mascarados (XXX / ***).
 */
export function extractSchemaConfirmedCpfCnpj(
  item: SemaDocumentoItem | null | undefined
): ConfirmedCpfCnpjExtraction {
  if (!item) {
    return { status: 'ausente', digits: '', formatted: '' };
  }

  const confirmedSchema = Array.isArray(item.camposConfirmadosEsquema)
    ? item.camposConfirmadosEsquema
    : [];

  if (confirmedSchema.length === 0) {
    return {
      status: item.cpfCnpjStatus === 'mascarado' ? 'mascarado' : 'ausente',
      digits: '',
      formatted: ''
    };
  }

  if (item.cpfCnpjCompletoDisponivel !== true || !item.cpfCnpjCampoOrigem) {
    return {
      status: item.cpfCnpjStatus === 'mascarado' ? 'mascarado' : 'ausente',
      digits: '',
      formatted: ''
    };
  }

  const confirmedField = confirmedSchema.find(
    f => f.toLowerCase() === item.cpfCnpjCampoOrigem!.toLowerCase()
  );
  if (!confirmedField) {
    return {
      status: item.cpfCnpjStatus === 'mascarado' ? 'mascarado' : 'ausente',
      digits: '',
      formatted: ''
    };
  }

  const props = item.propriedadesBrutas || {};
  const actualKey = Object.keys(props).find(
    k => k.toLowerCase() === confirmedField.toLowerCase()
  );
  const rawVal = actualKey ? cleanSemaText(props[actualKey]) : '';
  if (!rawVal) {
    return { status: 'ausente', digits: '', formatted: '' };
  }

  if (/[x*]/i.test(rawVal) && !/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(rawVal) && !/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(rawVal)) {
    return { status: 'mascarado', digits: '', formatted: '' };
  }

  // Se o campo confirmado for dedicado a documento
  const directDigits = normalizeDocDigits(rawVal);
  if (directDigits) {
    return {
      status: 'completo',
      digits: directDigits,
      formatted: formatCpfCnpjReadable(directDigits) || directDigits,
      campoOrigem: confirmedField
    };
  }

  // Se for campo textual composto de titular (ex.: NOMESPROPRIETARIOS), busca documento íntegro completo
  const embeddedMatch =
    rawVal.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/) ||
    rawVal.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/) ||
    rawVal.match(/(?<![\d/.\-xX*])(\d{14}|\d{11})(?![\d/.\-xX*])/);

  if (embeddedMatch?.[0]) {
    const digits = normalizeDocDigits(embeddedMatch[0]);
    if (digits) {
      return {
        status: 'completo',
        digits,
        formatted: formatCpfCnpjReadable(digits) || digits,
        campoOrigem: confirmedField
      };
    }
  }

  if (/x{2,}|\*{2,}/i.test(rawVal)) {
    return { status: 'mascarado', digits: '', formatted: '' };
  }

  return { status: 'ausente', digits: '', formatted: '' };
}

/**
 * Identifica empreendedor no cadastro mestre exclusivamente por igualdade exata
 * do CPF/CNPJ completo normalizado (somente dígitos).
 */
export function matchEmpreendedorByCpfCnpj(
  digitsInput: string,
  empreendedores: any[] = []
): EmpreendedorMatchOutcome {
  const digits = normalizeDocDigits(digitsInput);
  if (!digits) {
    return { status: 'sem_documento', matches: [], digits: '' };
  }

  const matches = (Array.isArray(empreendedores) ? empreendedores : []).filter(emp => {
    if (!emp || typeof emp !== 'object') return false;
    return normalizeDocDigits(emp.cpfCnpj ?? emp.cpf_cnpj) === digits;
  });

  if (matches.length === 1) {
    return { status: 'unico', empreendedor: matches[0], matches, digits };
  }
  if (matches.length > 1) {
    return { status: 'ambiguo', matches, digits };
  }
  return { status: 'nao_encontrado', matches: [], digits };
}

/**
 * Lista candidatos no cadastro de empreendedores por nome apenas para revisão manual.
 * Nunca cria vínculo automático.
 */
export function findManualNameCandidates(
  ownerNameRaw: string | undefined,
  empreendedores: any[] = []
): Array<{ empreendedor: any; motivo: string }> {
  const cleanName = extractCleanOwnerName(ownerNameRaw);
  const normTarget = normalizeTextLoose(cleanName);
  if (!normTarget || normTarget.length < 4) return [];

  const targetTokens = normTarget.split(' ').filter(t => t.length >= 3);
  if (targetTokens.length === 0) return [];

  const candidates: Array<{ empreendedor: any; motivo: string; score: number }> = [];
  const seenIds = new Set<string>();

  for (const emp of Array.isArray(empreendedores) ? empreendedores : []) {
    if (!emp || typeof emp !== 'object') continue;
    const empId = String(emp.id || '');
    if (!empId || seenIds.has(empId)) continue;

    const empNome = normalizeTextLoose(emp.nome);
    const empFantasia = normalizeTextLoose(emp.nomeFantasia);

    if (empNome === normTarget || (empFantasia && empFantasia === normTarget)) {
      seenIds.add(empId);
      candidates.push({
        empreendedor: emp,
        motivo: 'Nome idêntico na base (somente revisão manual — requer conferência de CPF/CNPJ)',
        score: 100
      });
      continue;
    }

    if (targetTokens.length >= 2) {
      const empFull = `${empNome} ${empFantasia}`.trim();
      const matchedTokens = targetTokens.filter(tok => empFull.includes(tok));
      if (matchedTokens.length >= Math.min(2, targetTokens.length) && matchedTokens.length / targetTokens.length >= 0.75) {
        seenIds.add(empId);
        candidates.push({
          empreendedor: emp,
          motivo: 'Semelhança nominal (somente revisão manual — não comprova titularidade)',
          score: 50
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 6).map(({ empreendedor, motivo }) => ({ empreendedor, motivo }));
}

export function checkDuplicateEmpreendedorByCpfCnpj(
  cpfCnpj: string,
  empreendedores: any[] = []
): { hasDuplicate: boolean; existing?: any; digits: string } {
  const digits = normalizeDocDigits(cpfCnpj);
  if (!digits) {
    return { hasDuplicate: false, digits: '' };
  }
  const existing = (Array.isArray(empreendedores) ? empreendedores : []).find(
    e => e && normalizeDocDigits(e.cpfCnpj ?? e.cpf_cnpj) === digits
  );
  return {
    hasDuplicate: Boolean(existing),
    existing,
    digits
  };
}

export function resolveLocalidadeFromSemaItem(
  item: SemaDocumentoItem,
  mtMunicipios: IbgeMunicipio[] = []
): { uf: string; municipio: string; municipioIbge: string; ibgeConfirmed: boolean } {
  const confirmedSchema = Array.isArray(item.camposConfirmadosEsquema)
    ? item.camposConfirmadosEsquema.map(c => c.toLowerCase())
    : [];

  const hasSchemaFilter = confirmedSchema.length > 0;
  const props = item.propriedadesBrutas || {};

  const codAllowed =
    !hasSchemaFilter ||
    confirmedSchema.includes('municipio_codigo') ||
    confirmedSchema.includes('cod_ibge');
  const munAllowed =
    !hasSchemaFilter ||
    confirmedSchema.includes('municipio') ||
    confirmedSchema.includes('nomemunicipio') ||
    confirmedSchema.includes('nome_municipio');

  const rawCod = codAllowed
    ? cleanSemaText(item.municipioCodigo || props.MUNICIPIO_CODIGO || props.COD_IBGE)
    : '';
  const cleanCod = /^\d{6,7}$/.test(rawCod.replace(/\D/g, '')) ? rawCod.replace(/\D/g, '') : '';

  if (cleanCod && mtMunicipios.length > 0) {
    const byId = mtMunicipios.find(m => String(m.id) === cleanCod);
    if (byId) {
      return {
        uf: 'MT',
        municipio: byId.nome,
        municipioIbge: String(byId.id),
        ibgeConfirmed: true
      };
    }
  }

  const rawMun = munAllowed
    ? cleanSemaText(item.municipio || props.MUNICIPIO || props.NOMEMUNICIPIO || props.NOME_MUNICIPIO)
    : '';
  const munText = rawMun && !/^código ibge/i.test(rawMun) ? rawMun : '';

  if (munText && mtMunicipios.length > 0) {
    const norm = normalizeTextLoose(munText);
    const byName = mtMunicipios.find(m => normalizeTextLoose(m.nome) === norm);
    if (byName) {
      return {
        uf: 'MT',
        municipio: byName.nome,
        municipioIbge: String(byName.id),
        ibgeConfirmed: true
      };
    }
  }

  const rawUf = cleanSemaText(props.UF);
  return {
    uf: rawUf || (cleanCod.startsWith('51') ? 'MT' : ''),
    municipio: munText,
    municipioIbge: cleanCod,
    ibgeConfirmed: Boolean(cleanCod && (!mtMunicipios.length || cleanCod.startsWith('51')))
  };
}

export function extractCarNumberFromSemaItem(item: SemaDocumentoItem): string {
  const props = item.propriedadesBrutas || {};
  return (
    cleanSemaText(props.NUMEROESTADUAL) ||
    cleanSemaText(props.CAR_ESTADUAL) ||
    (String(item.camadaOrigem || '').toUpperCase().includes('CAR') ||
    String(item.camadaOrigem || '').toUpperCase().includes('REQUERIMENTO')
      ? cleanSemaText(item.numeroDocumento)
      : '') ||
    cleanSemaText(item.carFederal) ||
    cleanSemaText(props.CAR_FEDERAL) ||
    cleanSemaText(props.CODIGO_CAR_FEDERAL)
  );
}

export function isCarLayerItem(item: SemaDocumentoItem): boolean {
  const layer = String(item.camadaOrigem || '').toUpperCase();
  const tipo = String(item.tipo || '').toUpperCase();
  return layer.includes('CAR_ATP') || layer.includes('REQUERIMENTO_ATP') || tipo.includes('CAR');
}

/**
 * Agrupa e deduplica os resultados da SEMA-MT:
 * - Nunca repete o mesmo CAR em múltiplos quadros;
 * - Dentro de cada CAR, lista cada barragem cadastrada correspondente uma única vez.
 */
export function groupAndDeduplicateSemaResults(
  items: SemaDocumentoItem[] = [],
  barragens: any[] = [],
  currentBarragemId?: string
): {
  carCards: CarGroupedCard[];
  otherDocs: SemaDocumentoItem[];
} {
  const rawCars: SemaDocumentoItem[] = [];
  const otherDocs: SemaDocumentoItem[] = [];
  const seenOtherKeys = new Set<string>();

  for (const item of items) {
    if (!item) continue;
    if (isCarLayerItem(item)) {
      rawCars.push(item);
    } else {
      const docKey = `${item.camadaOrigem}::${item.id || ''}::${item.numeroDocumento || ''}::${item.numeroProcesso || ''}`;
      if (!seenOtherKeys.has(docKey)) {
        seenOtherKeys.add(docKey);
        otherDocs.push(item);
      }
    }
  }

  const uniqueCars = deduplicateCarImoveisByCar(rawCars);

  const carCards: CarGroupedCard[] = uniqueCars.map((item, idx) => {
    const props = item.propriedadesBrutas || {};
    const carExibicao = extractCarNumberFromSemaItem(item) || 'Sem número de CAR';
    const carFederalExibicao = cleanSemaText(
      item.carFederal || props.CAR_FEDERAL || props.CODIGO_CAR_FEDERAL
    );
    const rawProp = cleanSemaText(props.NOMEPROPRIEDADE || item.nomeDocumento);
    const nomePropriedade =
      rawProp && rawProp.toLowerCase() !== 'imóvel sem denominação informada'
        ? rawProp
        : 'Propriedade sem denominação informada';
    const municipioExibicao = cleanSemaText(item.municipio || props.MUNICIPIO) || 'Não informado';
    const titularExibicao =
      cleanSemaText(item.razaoSocial || props.NOMESPROPRIETARIOS || props.RAZAO_SOCIAL || props.PROPRIETARIOS) ||
      'Não informado pela base';

    const rawMatches = findBarragensMatchingSemaItem(item, barragens);
    const dedupDamMap = new Map<string, { barragem: any; isCurrentBarragem: boolean }>();
    for (let i = 0; i < rawMatches.length; i++) {
      const b = rawMatches[i];
      if (!b) continue;
      const damUid = String(
        b.id || `${normalizeTextLoose(b.nome)}::${normalizeTextLoose(b.car)}::${i}`
      );
      if (!dedupDamMap.has(damUid)) {
        dedupDamMap.set(damUid, {
          barragem: b,
          isCurrentBarragem: Boolean(currentBarragemId && String(b.id) === String(currentBarragemId))
        });
      }
    }

    const matchedBarragens = Array.from(dedupDamMap.values());
    const canonicalKey = getCanonicalCarKeyFromSemaItem(item) || `CAR_CARD:${idx}`;

    return {
      canonicalKey,
      item,
      carExibicao,
      carFederalExibicao,
      nomePropriedade,
      municipioExibicao,
      titularExibicao,
      camadaOrigem: item.camadaTitulo || item.camadaOrigem,
      consultadoEm: item.consultadoEm || '',
      matchedBarragens,
      hasOtherRegisteredDam: matchedBarragens.some(m => !m.isCurrentBarragem),
      hasCurrentDam: matchedBarragens.some(m => m.isCurrentBarragem)
    };
  });

  // Destaca primeiro CARs que correspondem a barragens já cadastradas
  carCards.sort((a, b) => {
    const scoreA = a.matchedBarragens.length > 0 ? 1 : 0;
    const scoreB = b.matchedBarragens.length > 0 ? 1 : 0;
    return scoreB - scoreA;
  });

  return { carCards, otherDocs };
}

/**
 * Gera comparações lado a lado apenas para os campos compatíveis da barragem
 * retornados pela SEMA-MT. Nunca inclui latitude, longitude, altura, volume,
 * DPA, CRI ou situação cadastral.
 */
export function buildBarragemFieldComparisons(
  item: SemaDocumentoItem,
  currentBarragem: {
    car?: string;
    empreendimento?: string;
    municipio?: string;
    municipioIbge?: string;
    processo?: string;
  },
  mtMunicipios: IbgeMunicipio[] = []
): BarragemSemaFieldComparison[] {
  const confirmedSchema = Array.isArray(item.camposConfirmadosEsquema)
    ? item.camposConfirmadosEsquema.map(c => c.toLowerCase())
    : [];
  const hasSchemaFilter = confirmedSchema.length > 0;
  const props = item.propriedadesBrutas || {};

  const hasConfirmedAny = (candidates: string[]) =>
    !hasSchemaFilter || candidates.some(c => confirmedSchema.includes(c.toLowerCase()));

  const comparisons: BarragemSemaFieldComparison[] = [];

  // 1. CAR/MT
  if (hasConfirmedAny([...CAR_CAMPOS.car, ...CAR_CAMPOS.carFederal])) {
    const semaCar = extractCarNumberFromSemaItem(item);
    if (semaCar) {
      const curCar = cleanSemaText(currentBarragem.car);
      const isEmptyCurrent = !curCar;
      const isEqual = !isEmptyCurrent && normalizeTextLoose(curCar) === normalizeTextLoose(semaCar);
      comparisons.push({
        key: 'car',
        label: 'CAR/MT',
        currentValue: curCar,
        currentDisplay: curCar || 'Vazio no sistema',
        semaValue: semaCar,
        semaDisplay: semaCar,
        isEmptyCurrent,
        isEqual,
        action: isEqual ? 'manter' : isEmptyCurrent ? 'preencher' : 'manter'
      });
    }
  }

  // 2. Empreendimento (Nome da Propriedade / Imóvel)
  if (hasConfirmedAny(CAR_CAMPOS.empreendimento)) {
    const rawProp = cleanSemaText(props.NOMEPROPRIEDADE || item.nomeDocumento);
    const semaEmpreendimento =
      rawProp && rawProp.toLowerCase() !== 'imóvel sem denominação informada' ? rawProp : '';
    if (semaEmpreendimento) {
      const curEmp = cleanSemaText(currentBarragem.empreendimento);
      const isEmptyCurrent = !curEmp;
      const isEqual =
        !isEmptyCurrent && normalizeTextLoose(curEmp) === normalizeTextLoose(semaEmpreendimento);
      comparisons.push({
        key: 'empreendimento',
        label: 'Empreendimento / Nome da propriedade',
        currentValue: curEmp,
        currentDisplay: curEmp || 'Vazio no sistema',
        semaValue: semaEmpreendimento,
        semaDisplay: semaEmpreendimento,
        isEmptyCurrent,
        isEqual,
        action: isEqual ? 'manter' : isEmptyCurrent ? 'preencher' : 'manter'
      });
    }
  }

  // 3. Município e 4. Código IBGE (quando confirmado)
  const loc = resolveLocalidadeFromSemaItem(item, mtMunicipios);
  if (loc.municipio) {
    const curMun = cleanSemaText(currentBarragem.municipio);
    const isEmptyCurrent = !curMun;
    const isEqual = !isEmptyCurrent && normalizeTextLoose(curMun) === normalizeTextLoose(loc.municipio);
    comparisons.push({
      key: 'municipio',
      label: 'Município (MT)',
      currentValue: curMun,
      currentDisplay: curMun || 'Vazio no sistema',
      semaValue: loc.municipio,
      semaDisplay: loc.municipio,
      isEmptyCurrent,
      isEqual,
      action: isEqual ? 'manter' : isEmptyCurrent ? 'preencher' : 'manter'
    });
  }

  if (loc.municipioIbge && loc.ibgeConfirmed) {
    const curIbge = cleanSemaText(currentBarragem.municipioIbge);
    const isEmptyCurrent = !curIbge;
    const isEqual = !isEmptyCurrent && curIbge.replace(/\D/g, '') === loc.municipioIbge.replace(/\D/g, '');
    comparisons.push({
      key: 'municipio_ibge',
      label: 'Código IBGE do Município',
      currentValue: curIbge,
      currentDisplay: curIbge || 'Vazio no sistema',
      semaValue: loc.municipioIbge,
      semaDisplay: loc.municipioIbge,
      isEmptyCurrent,
      isEqual,
      action: isEqual ? 'manter' : isEmptyCurrent ? 'preencher' : 'manter'
    });
  }

  // 5. Processo
  if (hasConfirmedAny(['NUMERO_PROCESSO', 'PROTOCOLO_NUMERO', 'PROTOCOLO'])) {
    const semaProc = cleanSemaText(
      item.numeroProcesso || props.NUMERO_PROCESSO || props.PROTOCOLO_NUMERO || props.PROTOCOLO
    );
    if (semaProc) {
      const curProc = cleanSemaText(currentBarragem.processo);
      const isEmptyCurrent = !curProc;
      const isEqual = !isEmptyCurrent && normalizeTextLoose(curProc) === normalizeTextLoose(semaProc);
      comparisons.push({
        key: 'processo',
        label: 'Número do processo',
        currentValue: curProc,
        currentDisplay: curProc || 'Vazio no sistema',
        semaValue: semaProc,
        semaDisplay: semaProc,
        isEmptyCurrent,
        isEqual,
        action: isEqual ? 'manter' : isEmptyCurrent ? 'preencher' : 'manter'
      });
    }
  }

  return comparisons;
}

export function buildSemaAuditPayloadForBarragem(
  item: SemaDocumentoItem,
  mtMunicipios: IbgeMunicipio[] = []
): Record<string, any> {
  const props = item.propriedadesBrutas || {};
  const loc = resolveLocalidadeFromSemaItem(item, mtMunicipios);
  const car = extractCarNumberFromSemaItem(item);
  const rawProp = cleanSemaText(props.NOMEPROPRIEDADE || item.nomeDocumento);
  const empreendimento =
    rawProp && rawProp.toLowerCase() !== 'imóvel sem denominação informada' ? rawProp : '';
  const processo = cleanSemaText(
    item.numeroProcesso || props.NUMERO_PROCESSO || props.PROTOCOLO_NUMERO || props.PROTOCOLO
  );
  const titularNome = extractCleanOwnerName(
    item.razaoSocial || props.NOMESPROPRIETARIOS || props.RAZAO_SOCIAL || props.PROPRIETARIOS
  );

  return {
    camada: item.camadaOrigem,
    featureId: String(item.id || item.numeroDocumento || 'sema_item'),
    auditoriaId: item.auditoriaId,
    consultadoEm: item.consultadoEm || new Date().toISOString(),
    car: car || undefined,
    carEstadual: cleanSemaText(props.NUMEROESTADUAL) || undefined,
    carFederal: cleanSemaText(item.carFederal || props.CAR_FEDERAL || props.CODIGO_CAR_FEDERAL) || undefined,
    empreendimento: empreendimento || undefined,
    nomePropriedade: empreendimento || undefined,
    municipio: loc.municipio || undefined,
    municipioIbge: loc.ibgeConfirmed ? loc.municipioIbge : undefined,
    uf: loc.uf || undefined,
    processo: processo || undefined,
    numeroProcesso: processo || undefined,
    titularNome: titularNome || undefined
  };
}
