// src/config/carCampos.ts
/**
 * Arquivo único e editável de configuração de candidatos de nomes de campos
 * das camadas WFS do Geoportal SEMA-MT.
 *
 * Regras:
 *   1. Nenhum candidato é presumido como existente: os serviços validam cada
 *      candidato contra a estrutura retornada pela própria camada consultada.
 *   2. Sem correspondência na estrutura: campo permanece vazio (ou critério
 *      marcado como "nao_suportado") e as propriedades brutas retornadas são
 *      preservadas (com mascaramento de CPF/CNPJ).
 *   3. Nunca preencher UF com "MT" nem rotular registros como "validado" por padrão.
 */

export interface CarFieldMappingConfig {
  car: string[];
  carFederal: string[];
  empreendedor: string[];
  empreendimento: string[];
  municipio: string[];
  municipioCodigo: string[];
  uf: string[];
  situacaoCar: string[];
  areaHa: string[];
  atividade: string[];
  apfNumero: string[];
  numeroArt: string[];
  modulosFiscais: string[];
}

export const CAR_CAMPOS: CarFieldMappingConfig = {
  car: ['NUMEROESTADUAL', 'PROTOCOLO'],
  carFederal: ['CAR_FEDERAL', 'CODIGO_CAR_FEDERAL'],
  empreendedor: ['NOMESPROPRIETARIOS'],
  empreendimento: ['NOMEPROPRIEDADE'],
  municipio: ['MUNICIPIO'],
  municipioCodigo: ['MUNICIPIO_CODIGO'],
  uf: ['UF'],
  situacaoCar: ['SITUACAO_CAR', 'SITUACAO'],
  areaHa: ['AREA_HA'],
  atividade: ['ATIVIDADE'],
  apfNumero: ['APF_NUMERO'],
  numeroArt: ['NUMERO_ART'],
  modulosFiscais: ['MODULOS_FISCAIS']
};

export interface SemaFieldCandidatesConfig {
  // Filtros WFS
  filtroDocumento: string[];
  filtroCar: string[];
  filtroProcesso: string[];
  filtroNome: string[];
  // Ordenação estável e identificador da feição (paginação WFS 2.0.0)
  sortId: string[];
  featureId: string[];
  // Atributos de mapeamento (validados via DescribeFeatureType XML)
  carEstadual: string[];
  carFederal: string[];
  protocolo: string[];
  nomePropriedade: string[];
  titular: string[];
  documento: string[];
  municipioCodigo: string[];
  municipioNome: string[];
  uf: string[];
  situacaoCar: string[];
  areaHa: string[];
  atividade: string[];
  apfNumero: string[];
  numeroArt: string[];
  modulosFiscais: string[];
  tipoDocumento: string[];
  numeroDocumento: string[];
  nomeDocumento: string[];
  numeroProcesso: string[];
  statusDocumento: string[];
  dataDocumento: string[];
  dataValidade: string[];
  linkDocumento: string[];
}

export const SEMA_FIELD_CANDIDATES: SemaFieldCandidatesConfig = {
  filtroDocumento: ['CPF_CNPJ', 'CPF', 'CNPJ', 'NR_CPF_CNPJ', 'DOCUMENTO_TITULAR'],
  filtroCar: ['NUMEROESTADUAL', 'CAR_FEDERAL', 'CODIGO_CAR_FEDERAL', 'PROTOCOLO'],
  filtroProcesso: ['NUMERO_PROCESSO', 'PROTOCOLO_NUMERO', 'PROTOCOLO', 'TITULO_NUMERO'],
  filtroNome: ['NOMESPROPRIETARIOS', 'NOMEPROPRIEDADE', 'RAZAO_SOCIAL', 'PROPRIETARIOS'],

  sortId: ['OBJECTID', 'ID', 'CODIGO', 'REQUERIMENTO_ID', 'MIGRACAO_ID', 'NUMEROESTADUAL'],
  featureId: ['ID', 'OBJECTID', 'CODIGO', 'REQUERIMENTO_ID'],

  carEstadual: ['NUMEROESTADUAL'],
  carFederal: ['CAR_FEDERAL', 'CODIGO_CAR_FEDERAL'],
  protocolo: ['PROTOCOLO', 'PROTOCOLO_NUMERO'],
  nomePropriedade: ['NOMEPROPRIEDADE'],
  titular: ['NOMESPROPRIETARIOS', 'RAZAO_SOCIAL', 'PROPRIETARIOS'],
  documento: ['CPF_CNPJ', 'CPF', 'CNPJ', 'NR_CPF_CNPJ', 'DOCUMENTO_TITULAR'],
  municipioCodigo: ['MUNICIPIO_CODIGO', 'COD_IBGE'],
  municipioNome: ['MUNICIPIO'],
  uf: ['UF'],
  situacaoCar: ['SITUACAO_CAR', 'SITUACAO'],
  areaHa: ['AREA_HA'],
  atividade: ['ATIVIDADE', 'ATIVIDADE_LICENCIADA', 'ATIVIDADE_PRINCIPAL'],
  apfNumero: ['APF_NUMERO'],
  numeroArt: ['NUMERO_ART'],
  modulosFiscais: ['MODULOS_FISCAIS'],
  tipoDocumento: ['TIPO', 'ATIVIDADE', 'NOME_DOCUMENTO'],
  numeroDocumento: ['NUMERO_DOCUMENTO', 'TITULO_NUMERO', 'NUMEROESTADUAL', 'PROTOCOLO_NUMERO', 'PROTOCOLO'],
  nomeDocumento: ['NOME_DOCUMENTO', 'NOMEPROPRIEDADE', 'ATIVIDADE_LICENCIADA', 'ATIVIDADE_PRINCIPAL', 'TIPO', 'RAZAO_SOCIAL'],
  numeroProcesso: ['NUMERO_PROCESSO', 'PROTOCOLO_NUMERO', 'PROTOCOLO'],
  statusDocumento: ['STATUS', 'SITUACAO', 'SITUACAO_CAR'],
  dataDocumento: ['DATA_DOCUMENTO', 'DATA_APROVACAO', 'DATA_LANCAMENTO', 'DATA_CADASTRO'],
  dataValidade: ['DATA_VALIDADE', 'DATA_VENCIMENTO'],
  linkDocumento: ['LINK_DOCUMENTO', 'PDF_DOCUMENTO']
};

/**
 * Extrai o primeiro valor não vazio para um campo a partir de chaves confirmadas.
 * Retorna string vazia se nenhuma chave existir nas propriedades da feição.
 */
export function extractFirstMatchingField(
  properties: Record<string, any> | undefined | null,
  alternatives: string[]
): string {
  if (!properties || typeof properties !== 'object') return '';

  for (const alt of alternatives) {
    if (!alt) continue;
    if (Object.prototype.hasOwnProperty.call(properties, alt)) {
      const val = properties[alt];
      if (val !== undefined && val !== null) {
        const s = String(val).trim();
        if (s !== '' && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined' && s.toLowerCase() !== 'nan') {
          return s;
        }
      }
    }
  }

  return '';
}

/**
 * Retorna os nomes exatos presentes no esquema XML da camada (DescribeFeatureType)
 * que correspondem aos candidatos configurados.
 */
export function resolveConfirmedFields(
  schemaFields: Map<string, string>,
  candidates: string[]
): string[] {
  if (!schemaFields || schemaFields.size === 0) return [];
  const lowerMap = new Map<string, string>();
  for (const schemaKey of schemaFields.keys()) {
    lowerMap.set(schemaKey.toLowerCase(), schemaKey);
  }

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const cand of candidates) {
    if (!cand) continue;
    const exact = schemaFields.has(cand) ? cand : lowerMap.get(cand.toLowerCase());
    if (exact && !seen.has(exact)) {
      seen.add(exact);
      resolved.push(exact);
    }
  }
  return resolved;
}

/**
 * Extrai valor apenas se o atributo candidato estiver confirmado no esquema XML da camada.
 * Sem correspondência no esquema: retorna undefined.
 */
export function extractConfirmedFieldValue(
  properties: Record<string, any> | undefined | null,
  schemaFields: Map<string, string>,
  candidates: string[]
): string | undefined {
  if (!properties || typeof properties !== 'object') return undefined;
  const confirmed = resolveConfirmedFields(schemaFields, candidates);
  if (confirmed.length === 0) return undefined;
  const val = extractFirstMatchingField(properties, confirmed);
  return val !== '' ? val : undefined;
}

/**
 * Lista todos os atributos necessários confirmados no esquema XML da camada para uso em `propertyName`,
 * excluindo rigorosamente qualquer atributo geométrico.
 */
export function collectConfirmedPropertyNames(
  schemaFields: Map<string, string>,
  geomFields: Set<string>,
  candidateGroups: string[][]
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const group of candidateGroups) {
    const confirmed = resolveConfirmedFields(schemaFields, group);
    for (const fieldName of confirmed) {
      if (!geomFields.has(fieldName) && !seen.has(fieldName)) {
        seen.add(fieldName);
        result.push(fieldName);
      }
    }
  }

  return result;
}

/**
 * Formata CPF (11 dígitos) ou CNPJ (14 dígitos) completo para leitura, sem omitir dígitos.
 */
export function formatCpfCnpjReadable(raw: string | undefined | null): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  if (/[x*]/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return trimmed;
}

/**
 * Formata CPFs/CNPJs embutidos em textos compostos (ex.: NOMESPROPRIETARIOS) sem omitir dígitos.
 */
export function formatEmbeddedCpfCnpjReadable(text: string): string {
  return text
    .replace(/(?<![\/.\-\d])(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})(?![\/.\-\d])/g, '$1.$2.$3/$4-$5')
    .replace(/(?<![\/.\-\d])(\d{3})(\d{3})(\d{3})(\d{2})(?![\/.\-\d])/g, '$1.$2.$3-$4');
}

/**
 * Mascara CPF (11 dígitos) ou CNPJ (14 dígitos), preservando formato não identificável.
 */
export function maskCpfCnpjDisplay(raw: string | undefined | null): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  if (/[x*]/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11) {
    return `***.${digits.slice(3, 6)}.***-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `**.${digits.slice(2, 5)}.***/${digits.slice(8, 12)}-**`;
  }
  return trimmed;
}

function scrubEmbeddedCpfCnpj(text: string): string {
  return text
    .replace(/\b(\d{3})\.(\d{3})\.(\d{3})-(\d{2})\b/g, '***.$2.***-$4')
    .replace(/\b(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})-(\d{2})\b/g, '**.$2.***/$4-**')
    .replace(/(?<![\/.\-\d])(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})(?![\/.\-\d])/g, '**.$2.***/$4-**')
    .replace(/(?<![\/.\-\d])(\d{3})(\d{3})(\d{3})(\d{2})(?![\/.\-\d])/g, '***.$2.***-$4');
}

/**
 * Extrai tokens normalizados de CAR/MT e SICAR a partir de textos compostos
 * (ex.: "CAR – MT57013/2017", "MT-66334/2017", "MT199475/2021 ou MT 85822/2018").
 */
export function extractCarSearchTokens(rawInput: string | undefined | null): string[] {
  const input = String(rawInput || '').trim();
  if (!input) return [];

  const tokens: string[] = [];
  const seen = new Set<string>();
  const addToken = (t: string) => {
    const clean = t.trim().toUpperCase();
    if (clean.length >= 3 && !seen.has(clean)) {
      seen.add(clean);
      tokens.push(clean);
    }
  };

  // 1. Código SICAR Federal: MT-5103403-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  const sicarMatches = input.matchAll(/\b([A-Z]{2}-\d{6,8}-[A-F0-9]{8,})\b/gi);
  for (const m of sicarMatches) {
    if (m[1]) addToken(m[1]);
  }

  // 2. Códigos estaduais CAR/MT (ex.: MT57013/2017, MT-66334/2017, 85822/2018, MT631152/018)
  const mtMatches = input.matchAll(/(?:\bMT[\s.\-–—]*)?(\d{3,8})\s*\/\s*(\d{2,4})\b/gi);
  for (const m of mtMatches) {
    const num = m[1];
    let year = m[2];
    if (year.length === 3 && year.startsWith('0')) {
      year = `2${year}`;
    } else if (year.length === 2) {
      year = `20${year}`;
    }
    addToken(`${num}/${year}`);
    addToken(`MT${num}/${year}`);
    if (m[2] !== year) {
      addToken(`${num}/${m[2]}`);
    }
  }

  if (tokens.length === 0) {
    const fallback = input
      .replace(/^(?:CAR\s*[–—:\-]*\s*)/i, '')
      .replace(/\s+/g, '')
      .trim();
    if (fallback.length >= 3) {
      addToken(fallback);
    }
  }

  return tokens.slice(0, 10);
}

/**
 * Preserva todos os atributos retornados pela SEMA-MT para leitura completa pelo usuário,
 * formatando CPF/CNPJ sem omitir dígitos e limpando apenas marcadores nulos/aspas externas.
 */
export function preserveSemaProperties(
  properties: Record<string, any> | undefined | null,
  confirmedDocFields: string[] = []
): Record<string, any> {
  if (!properties || typeof properties !== 'object') return {};

  const docFieldSet = new Set<string>([
    ...SEMA_FIELD_CANDIDATES.documento.map(f => f.toLowerCase()),
    ...SEMA_FIELD_CANDIDATES.filtroDocumento.map(f => f.toLowerCase()),
    ...confirmedDocFields.map(f => f.toLowerCase())
  ]);

  const cleaned: Record<string, any> = {};

  for (const [key, val] of Object.entries(properties)) {
    const keyLower = key.toLowerCase();
    const isDocField =
      docFieldSet.has(keyLower) ||
      /\b(cpf|cnpj|cpf_cnpj|nr_cpf|nr_cnpj|documento_titular)\b/i.test(keyLower);

    if (val === null || val === undefined) {
      cleaned[key] = null;
      continue;
    }

    if (typeof val === 'string') {
      const stripped = stripOuterQuotesAndBrackets(val).replace(/"/g, '').trim();
      if (!stripped || ['nan', 'null', 'undefined'].includes(stripped.toLowerCase())) {
        cleaned[key] = '';
        continue;
      }

      if (isDocField) {
        cleaned[key] = formatCpfCnpjReadable(stripped) || stripped;
        continue;
      }

      if (/^\d{11}$/.test(stripped) || /^\d{14}$/.test(stripped)) {
        if (!/\b(id|codigo|ibge|processo|protocolo|numero_documento)\b/i.test(keyLower)) {
          cleaned[key] = formatCpfCnpjReadable(stripped) || stripped;
          continue;
        }
      }

      cleaned[key] = formatEmbeddedCpfCnpjReadable(stripped);
    } else {
      cleaned[key] = val;
    }
  }

  return cleaned;
}

/**
 * Remove/mascara qualquer atributo identificado como documento ou cujo valor seja
 * CPF/CNPJ (11 ou 14 dígitos, com ou sem pontuação) antes de gravar no cache (raw_properties).
 */
export function sanitizeSemaProperties(
  properties: Record<string, any> | undefined | null,
  confirmedDocFields: string[] = []
): Record<string, any> {
  if (!properties || typeof properties !== 'object') return {};

  const docFieldSet = new Set<string>([
    ...SEMA_FIELD_CANDIDATES.documento.map(f => f.toLowerCase()),
    ...SEMA_FIELD_CANDIDATES.filtroDocumento.map(f => f.toLowerCase()),
    ...confirmedDocFields.map(f => f.toLowerCase())
  ]);

  const sanitized: Record<string, any> = {};

  for (const [key, val] of Object.entries(properties)) {
    const keyLower = key.toLowerCase();
    const isDocField =
      docFieldSet.has(keyLower) ||
      /\b(cpf|cnpj|cpf_cnpj|nr_cpf|nr_cnpj|documento_titular)\b/i.test(keyLower);

    if (val === null || val === undefined) {
      sanitized[key] = val;
      continue;
    }

    const strVal = String(val).trim();

    if (isDocField) {
      if (!strVal) {
        sanitized[key] = val;
      } else {
        const masked = maskCpfCnpjDisplay(strVal);
        sanitized[key] = masked && masked !== strVal ? masked : '***';
      }
      continue;
    }

    // Verifica se o valor integral é exatamente 11 ou 14 dígitos (com ou sem pontuação)
    const isFormattedCpf = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(strVal);
    const isFormattedCnpj = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(strVal);
    const isPlain11or14Digits = /^\d{11}$/.test(strVal) || /^\d{14}$/.test(strVal);

    if (isFormattedCpf || isFormattedCnpj || isPlain11or14Digits) {
      sanitized[key] = maskCpfCnpjDisplay(strVal) || '***';
      continue;
    }

    // Mascara eventuais CPFs/CNPJs formatados embutidos em campos textuais (ex.: listas de proprietários)
    if (typeof val === 'string') {
      sanitized[key] = scrubEmbeddedCpfCnpj(val);
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}

const SEMA_ATTRIBUTE_LABELS: Record<string, string> = {
  nomesproprietarios: 'Nome dos Proprietários',
  proprietarios: 'Proprietários',
  nomepropriedade: 'Nome da Propriedade / Imóvel',
  nome_propriedade: 'Nome da Propriedade / Imóvel',
  nome_imovel: 'Nome do Imóvel',
  imovel: 'Imóvel',
  numeroestadual: 'Número do CAR Estadual (CAR/MT)',
  car_estadual: 'Número do CAR Estadual (CAR/MT)',
  car_federal: 'Código CAR Federal (SICAR)',
  codigo_car_federal: 'Código CAR Federal (SICAR)',
  protocolo: 'Número do Protocolo',
  protocolo_numero: 'Número do Protocolo',
  cpf_cnpj: 'CPF / CNPJ',
  nr_cpf_cnpj: 'CPF / CNPJ',
  documento_titular: 'CPF / CNPJ do Titular',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  razao_social: 'Razão Social',
  nome_titular: 'Nome do Titular',
  titular: 'Titular',
  empreendedor: 'Empreendedor',
  empreendimento: 'Empreendimento',
  municipio: 'Município',
  nomemunicipio: 'Município',
  nome_municipio: 'Município',
  municipio_codigo: 'Código IBGE do Município',
  cod_ibge: 'Código IBGE do Município',
  uf: 'UF',
  situacao: 'Situação',
  situacao_car: 'Situação no CAR',
  status: 'Status',
  condicao: 'Condição',
  area_ha: 'Área (ha)',
  area_imovel: 'Área do Imóvel (ha)',
  area_calc: 'Área Calculada (ha)',
  modulos_fiscais: 'Módulos Fiscais',
  modulo_fiscal: 'Módulo Fiscal',
  atividade: 'Atividade',
  atividade_licenciada: 'Atividade Licenciada',
  atividade_principal: 'Atividade Principal',
  apf_numero: 'Número da APF',
  numero_art: 'Número da ART',
  tipo: 'Tipo',
  tipo_imovel: 'Tipo do Imóvel',
  tipo_documento: 'Tipo do Documento',
  numero_documento: 'Número do Documento',
  nome_documento: 'Nome do Documento',
  numero_processo: 'Número do Processo',
  processo: 'Processo',
  titulo_numero: 'Número do Título',
  data_documento: 'Data do Documento',
  data_aprovacao: 'Data de Aprovação',
  data_lancamento: 'Data de Lançamento',
  data_cadastro: 'Data de Cadastro',
  data_inscricao: 'Data de Inscrição',
  data_emissao: 'Data de Emissão',
  data_protocolo: 'Data do Protocolo',
  data_validade: 'Data de Validade',
  data_vencimento: 'Data de Vencimento',
  link_documento: 'Link do Documento',
  pdf_documento: 'Arquivo PDF do Documento',
  id: 'Identificador do Registro',
  objectid: 'Identificador do Objeto',
  codigo: 'Código',
  requerimento_id: 'Código do Requerimento',
  migracao_id: 'Código de Migração',
  gid: 'Identificador Geográfico (GID)',
  fid: 'Identificador da Feição (FID)',
  objectid_1: 'Identificador do Objeto',
  area_total: 'Área Total (ha)',
  area_consolidada: 'Área Consolidada (ha)',
  area_app: 'Área de Preservação Permanente - APP (ha)',
  area_reserva_legal: 'Área de Reserva Legal (ha)',
  reserva_legal: 'Reserva Legal',
  bioma: 'Bioma',
  bacia: 'Bacia Hidrográfica',
  bacia_hidrografica: 'Bacia Hidrográfica',
  tema: 'Tema',
  classe: 'Classe',
  subclasse: 'Subclasse',
  nome_empreendimento: 'Nome do Empreendimento',
  nome_interessado: 'Nome do Interessado',
  interessado: 'Interessado',
  autuado: 'Autuado',
  embargado: 'Embargado',
  notificado: 'Notificado',
  infracao: 'Infração',
  enquadramento: 'Enquadramento Legal',
  valor_multa: 'Valor da Multa',
  data_auto: 'Data do Auto de Infração',
  data_embargo: 'Data do Termo de Embargo',
  data_notificacao: 'Data da Notificação',
  tipo_licenca: 'Tipo de Licença',
  descricao: 'Descrição',
  observacao: 'Observação',
  observacoes: 'Observações',
  obs: 'Observação'
};

const SEMA_PRIORITY_ORDER: string[] = [
  'nomepropriedade',
  'numeroestadual',
  'car_federal',
  'codigo_car_federal',
  'nomesproprietarios',
  'proprietarios',
  'razao_social',
  'cpf_cnpj',
  'nr_cpf_cnpj',
  'cpf',
  'cnpj',
  'documento_titular',
  'situacao_car',
  'situacao',
  'status',
  'municipio',
  'uf',
  'municipio_codigo',
  'cod_ibge',
  'area_ha',
  'modulos_fiscais',
  'atividade',
  'atividade_licenciada',
  'atividade_principal',
  'tipo',
  'numero_documento',
  'nome_documento',
  'numero_processo',
  'protocolo',
  'protocolo_numero',
  'titulo_numero',
  'apf_numero',
  'numero_art',
  'data_documento',
  'data_aprovacao',
  'data_lancamento',
  'data_cadastro',
  'data_validade',
  'data_vencimento',
  'link_documento',
  'pdf_documento'
];

const UPPER_ACRONYMS = new Set(['car', 'cpf', 'cnpj', 'uf', 'ibge', 'apf', 'art', 'rrt', 'id', 'sicar', 'ha', 'pdf', 'mt', 'snisb']);

export function getSemaFieldLabel(rawKey: string): string {
  const keyClean = String(rawKey || '').trim();
  if (!keyClean) return 'Campo';
  const lower = keyClean.toLowerCase();
  if (SEMA_ATTRIBUTE_LABELS[lower]) {
    return SEMA_ATTRIBUTE_LABELS[lower];
  }

  const normalizedWords = keyClean
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return normalizedWords
    .map(w => {
      const wl = w.toLowerCase();
      if (UPPER_ACRONYMS.has(wl)) return wl.toUpperCase();
      if (['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no'].includes(wl)) return wl;
      return wl.charAt(0).toUpperCase() + wl.slice(1);
    })
    .join(' ');
}

export function stripOuterQuotesAndBrackets(val: string): string {
  let out = String(val || '').trim();
  while (
    (out.startsWith('"') && out.endsWith('"') && out.length >= 2) ||
    (out.startsWith("'") && out.endsWith("'") && out.length >= 2)
  ) {
    out = out.slice(1, -1).trim();
  }
  if (out.startsWith('[') && out.endsWith(']') && out.length >= 2) {
    out = out.slice(1, -1).trim();
    while (
      (out.startsWith('"') && out.endsWith('"') && out.length >= 2) ||
      (out.startsWith("'") && out.endsWith("'") && out.length >= 2)
    ) {
      out = out.slice(1, -1).trim();
    }
  }
  return out;
}

export function formatSemaFieldValue(rawKey: string, val: any): { text: string; isEmpty: boolean; isLink: boolean } {
  if (val === undefined || val === null) {
    return { text: 'Não informado', isEmpty: true, isLink: false };
  }

  if (typeof val === 'boolean') {
    return { text: val ? 'Sim' : 'Não', isEmpty: false, isLink: false };
  }

  if (Array.isArray(val)) {
    const parts = val
      .map(v => formatSemaFieldValue(rawKey, v))
      .filter(p => !p.isEmpty)
      .map(p => p.text);
    if (parts.length === 0) {
      return { text: 'Não informado', isEmpty: true, isLink: false };
    }
    return { text: parts.join('; '), isEmpty: false, isLink: false };
  }

  if (typeof val === 'object') {
    const entries = Object.entries(val)
      .map(([k, v]) => {
        const sub = formatSemaFieldValue(k, v);
        return sub.isEmpty ? null : `${getSemaFieldLabel(k)}: ${sub.text}`;
      })
      .filter(Boolean);
    if (entries.length === 0) {
      return { text: 'Não informado', isEmpty: true, isLink: false };
    }
    return { text: entries.join(' · '), isEmpty: false, isLink: false };
  }

  let str = stripOuterQuotesAndBrackets(String(val));
  if (!str || ['nan', 'null', 'undefined'].includes(str.toLowerCase())) {
    return { text: 'Não informado', isEmpty: true, isLink: false };
  }

  const keyLower = String(rawKey || '').toLowerCase();

  if (/^https?:\/\/\S+$/i.test(str)) {
    return { text: str, isEmpty: false, isLink: true };
  }

  const isDocKey = /\b(cpf|cnpj|cpf_cnpj|nr_cpf|nr_cnpj|documento_titular)\b/i.test(keyLower);
  if (isDocKey) {
    const formatted = formatCpfCnpjReadable(str) || str;
    return { text: formatted, isEmpty: false, isLink: false };
  }

  if (/^\d{11}$/.test(str) || /^\d{14}$/.test(str)) {
    if (!/\b(id|codigo|ibge|processo|protocolo|numero_documento)\b/i.test(keyLower)) {
      return { text: formatCpfCnpjReadable(str) || str, isEmpty: false, isLink: false };
    }
  }

  // Datas ISO (ex.: 2024-03-15 ou 2024-03-15T12:00:00Z)
  if (/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(str)) {
    const isoPart = str.slice(0, 10);
    const [y, m, d] = isoPart.split('-');
    if (y && m && d) {
      return { text: `${d}/${m}/${y}`, isEmpty: false, isLink: false };
    }
  }

  // Áreas e medidas decimais
  if (/(area|modulo)/i.test(keyLower) && !isNaN(Number(str))) {
    const num = Number(str);
    const unit = keyLower.includes('ha') ? ' ha' : '';
    return {
      text: `${num.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}${unit}`,
      isEmpty: false,
      isLink: false
    };
  }

  str = formatEmbeddedCpfCnpjReadable(str).replace(/"/g, '');
  return { text: str, isEmpty: false, isLink: false };
}

export interface FormattedSemaEntry {
  key: string;
  label: string;
  value: string;
  isEmpty: boolean;
  isLink: boolean;
}

export function formatSemaPropertiesEntries(
  properties: Record<string, any> | undefined | null
): FormattedSemaEntry[] {
  if (!properties || typeof properties !== 'object') return [];

  const entries: FormattedSemaEntry[] = Object.entries(properties).map(([key, val]) => {
    const formatted = formatSemaFieldValue(key, val);
    return {
      key,
      label: getSemaFieldLabel(key),
      value: formatted.text,
      isEmpty: formatted.isEmpty,
      isLink: formatted.isLink
    };
  });

  entries.sort((a, b) => {
    if (a.isEmpty !== b.isEmpty) return a.isEmpty ? 1 : -1;
    const idxA = SEMA_PRIORITY_ORDER.indexOf(a.key.toLowerCase());
    const idxB = SEMA_PRIORITY_ORDER.indexOf(b.key.toLowerCase());
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' });
  });

  return entries;
}

const CAR_PLACEHOLDER_VALUES = new Set([
  'NAOINFORMADO',
  'NAOPOSSUI',
  'NAOAPLICAVEL',
  'NAOIDENTIFICADO',
  'SEMCAR',
  'SEMNUMERO',
  'PENDENTE',
  'ISENTO',
  'NAOCONSTA',
  'NAN',
  'NULL',
  'UNDEFINED',
  'NA'
]);

export function extractNormalizedCarMatchKeys(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const cleaned = stripOuterQuotesAndBrackets(String(raw)).trim();
  if (!cleaned) return [];

  const upperCompact = cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (!upperCompact || CAR_PLACEHOLDER_VALUES.has(upperCompact)) {
    return [];
  }

  const keys = new Set<string>();
  const tokens = extractCarSearchTokens(cleaned);

  for (const tok of tokens) {
    const tUpper = tok.trim().toUpperCase();
    const compact = tUpper.replace(/[^A-Z0-9]/g, '');
    if (!compact || CAR_PLACEHOLDER_VALUES.has(compact)) continue;

    const isSicar = /^[A-Z]{2}-\d{6,8}-[A-F0-9]{8,}$/.test(tUpper);
    const isStateCarSlash = /\d{3,8}\/\d{2,4}$/.test(tUpper);
    const digitCount = (compact.match(/\d/g) || []).length;

    if (isSicar || isStateCarSlash || (compact.length >= 6 && digitCount >= 3)) {
      keys.add(tUpper);
      keys.add(compact);
    }
  }

  return Array.from(keys);
}

export function findBarragensMatchingCarString(
  carInput: unknown,
  barragens: any[] = []
): any[] {
  if (!Array.isArray(barragens) || barragens.length === 0) return [];
  const inputKeys = new Set(extractNormalizedCarMatchKeys(carInput));
  if (inputKeys.size === 0) return [];

  const matched: any[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < barragens.length; i++) {
    const b = barragens[i];
    if (!b || typeof b !== 'object') continue;
    const barragemKeys = [
      ...extractNormalizedCarMatchKeys(b.car),
      ...extractNormalizedCarMatchKeys(b.carFederal),
      ...extractNormalizedCarMatchKeys(b.car_mt),
      ...extractNormalizedCarMatchKeys(b.numeroCar)
    ];

    if (barragemKeys.some(k => inputKeys.has(k))) {
      const uid = String(b.id ?? `${b.nome || b.nomeBarragem || 'barragem'}-${i}`);
      if (!seen.has(uid)) {
        seen.add(uid);
        matched.push(b);
      }
    }
  }

  return matched;
}

export function findBarragensMatchingSemaItem(
  item: {
    numeroDocumento?: string;
    carFederal?: string;
    propriedadesBrutas?: Record<string, any>;
  } | null | undefined,
  barragens: any[] = []
): any[] {
  if (!item || !Array.isArray(barragens) || barragens.length === 0) return [];

  const candidateValues: unknown[] = [
    item.numeroDocumento,
    item.carFederal,
    item.propriedadesBrutas?.NUMEROESTADUAL,
    item.propriedadesBrutas?.numeroestadual,
    item.propriedadesBrutas?.CAR_ESTADUAL,
    item.propriedadesBrutas?.car_estadual,
    item.propriedadesBrutas?.CAR_FEDERAL,
    item.propriedadesBrutas?.car_federal,
    item.propriedadesBrutas?.CODIGO_CAR_FEDERAL,
    item.propriedadesBrutas?.codigo_car_federal,
    item.propriedadesBrutas?.PROTOCOLO,
    item.propriedadesBrutas?.protocolo,
    item.propriedadesBrutas?.PROTOCOLO_NUMERO,
    item.propriedadesBrutas?.protocolo_numero
  ];

  if (item.propriedadesBrutas && typeof item.propriedadesBrutas === 'object') {
    for (const [k, v] of Object.entries(item.propriedadesBrutas)) {
      if (/^(car|numero_?car|cod_?car|sicar|numero_?estadual)/i.test(k)) {
        candidateValues.push(v);
      }
    }
  }

  const itemKeys = new Set<string>();
  for (const val of candidateValues) {
    for (const k of extractNormalizedCarMatchKeys(val)) {
      itemKeys.add(k);
    }
  }

  if (itemKeys.size === 0) return [];

  const matched: any[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < barragens.length; i++) {
    const b = barragens[i];
    if (!b || typeof b !== 'object') continue;
    const barragemKeys = [
      ...extractNormalizedCarMatchKeys(b.car),
      ...extractNormalizedCarMatchKeys(b.carFederal),
      ...extractNormalizedCarMatchKeys(b.car_mt),
      ...extractNormalizedCarMatchKeys(b.numeroCar)
    ];

    if (barragemKeys.some(k => itemKeys.has(k))) {
      const uid = String(b.id ?? `${b.nome || b.nomeBarragem || 'barragem'}-${i}`);
      if (!seen.has(uid)) {
        seen.add(uid);
        matched.push(b);
      }
    }
  }

  return matched;
}

export function getCanonicalCarKeyFromSemaItem(item: {
  id?: string | number | null;
  numeroDocumento?: string;
  carFederal?: string;
  propriedadesBrutas?: Record<string, any>;
} | null | undefined): string {
  if (!item) return '';

  const stateCandidates: unknown[] = [
    item.numeroDocumento,
    item.propriedadesBrutas?.NUMEROESTADUAL,
    item.propriedadesBrutas?.numeroestadual,
    item.propriedadesBrutas?.CAR_ESTADUAL,
    item.propriedadesBrutas?.car_estadual,
    item.propriedadesBrutas?.PROTOCOLO,
    item.propriedadesBrutas?.protocolo,
    item.propriedadesBrutas?.PROTOCOLO_NUMERO,
    item.propriedadesBrutas?.protocolo_numero
  ];

  for (const val of stateCandidates) {
    const tokens = extractNormalizedCarMatchKeys(val);
    const slashTok = tokens.find(t => /\d{3,8}\/\d{2,4}$/.test(t) && !t.startsWith('MT'));
    if (slashTok) return `MTCAR:${slashTok}`;
    const mtSlashTok = tokens.find(t => /^MT\d{3,8}\/\d{2,4}$/.test(t));
    if (mtSlashTok) return `MTCAR:${mtSlashTok.slice(2)}`;
  }

  const federalCandidates: unknown[] = [
    item.carFederal,
    item.propriedadesBrutas?.CAR_FEDERAL,
    item.propriedadesBrutas?.car_federal,
    item.propriedadesBrutas?.CODIGO_CAR_FEDERAL,
    item.propriedadesBrutas?.codigo_car_federal
  ];

  for (const val of federalCandidates) {
    const tokens = extractNormalizedCarMatchKeys(val);
    const sicarTok = tokens.find(t => /^[A-Z]{2}-\d{6,8}-[A-F0-9]{8,}$/.test(t));
    if (sicarTok) return `SICAR:${sicarTok}`;
  }

  for (const val of [...stateCandidates, ...federalCandidates]) {
    const tokens = extractNormalizedCarMatchKeys(val);
    if (tokens.length > 0) return `RAW:${tokens[0]}`;
  }

  if (item.id !== undefined && item.id !== null && String(item.id).trim() !== '') {
    return `ID:${String(item.id).trim()}`;
  }

  return '';
}

function scoreCarItemCompleteness(item: any): number {
  let score = 0;
  const camada = String(item?.camadaOrigem || '').toUpperCase();
  if (camada.includes('CAR_ATP') && !camada.includes('REQUERIMENTO')) score += 20;
  if (item?.numeroDocumento) score += 8;
  if (item?.carFederal) score += 6;
  if (item?.nomeDocumento) score += 5;
  if (item?.razaoSocial) score += 5;
  if (item?.cpfCnpjMascarado) score += 5;
  if (item?.areaHa) score += 3;
  if (item?.municipio) score += 3;
  if (item?.linkDocumento) score += 2;
  if (item?.propriedadesBrutas && typeof item.propriedadesBrutas === 'object') {
    for (const v of Object.values(item.propriedadesBrutas)) {
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        score += 1;
      }
    }
  }
  return score;
}

export function deduplicateCarImoveisByCar<
  T extends {
    id?: string | number | null;
    numeroDocumento?: string;
    carFederal?: string;
    nomeDocumento?: string;
    razaoSocial?: string;
    cpfCnpjMascarado?: string;
    municipio?: string;
    areaHa?: string;
    status?: string;
    linkDocumento?: string;
    camadaOrigem?: string;
    camadaTitulo?: string;
    correspondenciaExploratoria?: boolean;
    propriedadesBrutas?: Record<string, any>;
  }
>(items: T[] = []): T[] {
  if (!Array.isArray(items) || items.length <= 1) return Array.isArray(items) ? items : [];

  const grouped = new Map<string, T>();
  const order: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const key = getCanonicalCarKeyFromSemaItem(item) || `IDX:${i}`;

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...item,
        propriedadesBrutas: item.propriedadesBrutas ? { ...item.propriedadesBrutas } : item.propriedadesBrutas
      });
      order.push(key);
      continue;
    }

    const keepIncoming = scoreCarItemCompleteness(item) > scoreCarItemCompleteness(existing);
    const primary = keepIncoming ? item : existing;
    const secondary = keepIncoming ? existing : item;

    const mergedProps: Record<string, any> = {
      ...(secondary.propriedadesBrutas || {}),
      ...(primary.propriedadesBrutas || {})
    };
    if (secondary.propriedadesBrutas) {
      for (const [k, v] of Object.entries(secondary.propriedadesBrutas)) {
        const cur = mergedProps[k];
        if (
          (cur === undefined || cur === null || String(cur).trim() === '') &&
          v !== undefined &&
          v !== null &&
          String(v).trim() !== ''
        ) {
          mergedProps[k] = v;
        }
      }
    }

    const merged: T = {
      ...secondary,
      ...primary,
      numeroDocumento: primary.numeroDocumento || secondary.numeroDocumento || '',
      carFederal: primary.carFederal || secondary.carFederal,
      nomeDocumento: primary.nomeDocumento || secondary.nomeDocumento || '',
      razaoSocial: primary.razaoSocial || secondary.razaoSocial,
      cpfCnpjMascarado: primary.cpfCnpjMascarado || secondary.cpfCnpjMascarado,
      municipio: primary.municipio || secondary.municipio,
      areaHa: primary.areaHa || secondary.areaHa,
      status: primary.status || secondary.status,
      linkDocumento: primary.linkDocumento || secondary.linkDocumento,
      correspondenciaExploratoria:
        Boolean(primary.correspondenciaExploratoria) && Boolean(secondary.correspondenciaExploratoria),
      propriedadesBrutas: Object.keys(mergedProps).length > 0 ? mergedProps : primary.propriedadesBrutas
    };

    grouped.set(key, merged);
  }

  return order.map(k => grouped.get(k)!).filter(Boolean);
}



