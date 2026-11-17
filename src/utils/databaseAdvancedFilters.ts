import { parseCoordAdvanced } from '../services/coordService';

export function normFilterText(val: unknown): string {
  return String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function onlyDigits(val: unknown): string {
  return String(val ?? '').replace(/\D/g, '');
}

export function parseNumericValue(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (!s) return null;
  const normalized =
    s.includes(',') && !s.includes('.')
      ? s.replace(',', '.')
      : s.includes(',') && s.includes('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

export function matchesTextField(candidate: unknown, query: string): boolean {
  const q = normFilterText(query);
  if (!q) return true;
  return normFilterText(candidate).includes(q);
}

export function matchesTextOrDigitsField(candidate: unknown, query: string): boolean {
  const q = normFilterText(query);
  if (!q) return true;
  if (normFilterText(candidate).includes(q)) return true;
  const qDigits = onlyDigits(query);
  if (qDigits.length >= 2) {
    return onlyDigits(candidate).includes(qDigits);
  }
  return false;
}

export function matchesDateRange(isoDateOrTimestamp: unknown, startDate: string, endDate: string): boolean {
  if (!startDate && !endDate) return true;
  const raw = String(isoDateOrTimestamp ?? '').trim();
  if (!raw) return false;
  const dateOnly = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return false;
  if (startDate && dateOnly < startDate) return false;
  if (endDate && dateOnly > endDate) return false;
  return true;
}

export function matchesNumericRange(val: unknown, minStr: string, maxStr: string): boolean {
  const minVal = parseNumericValue(minStr);
  const maxVal = parseNumericValue(maxStr);
  if (minVal === null && maxVal === null) return true;
  const num = parseNumericValue(val);
  if (num === null) return false;
  if (minVal !== null && num < minVal) return false;
  if (maxVal !== null && num > maxVal) return false;
  return true;
}

export function hasValidCoordinates(latitude: unknown, longitude: unknown): boolean {
  const latStr = String(latitude ?? '').trim();
  const lngStr = String(longitude ?? '').trim();
  if (!latStr || !lngStr) return false;
  const latParsed = parseCoordAdvanced(latStr, false);
  const lngParsed = parseCoordAdvanced(lngStr, true);
  return Boolean(latParsed.valido && lngParsed.valido && latParsed.decimal !== null && lngParsed.decimal !== null);
}

export function collectDistinctValues(items: any[], extractor: (item: any) => unknown): string[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    const raw = extractor(item);
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      const str = String(v ?? '').trim();
      if (!str || ['—', 'nan', 'null', 'undefined'].includes(str.toLowerCase())) continue;
      const key = normFilterText(str);
      if (key && !seen.has(key)) {
        seen.set(key, str);
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}

export function countActiveAdvancedFilters<T extends Record<string, any>>(
  filters: T,
  defaultObj: T,
  excludeKeys: (keyof T)[] = []
): number {
  let count = 0;
  for (const key of Object.keys(defaultObj) as (keyof T)[]) {
    if (excludeKeys.includes(key)) continue;
    const val = filters[key];
    const defVal = defaultObj[key];
    if (typeof val === 'string' ? val.trim() !== String(defVal ?? '') : val !== defVal) {
      count++;
    }
  }
  return count;
}

// ============================================================================
// 1. EMPREENDEDORES
// ============================================================================
export interface EmpreendedoresAdvancedFilters {
  tipoPessoa: string;
  nome: string;
  nomeFantasia: string;
  cpfCnpj: string;
  email: string;
  telefone: string;
  uf: string;
  municipio: string;
  situacao: string;
  empreendimentoStatus: string;
  barragemStatus: string;
  empreendimentoTexto: string;
  barragemOuProcesso: string;
  observacoes: string;
  dataInicio: string;
  dataFim: string;
}

export const EMPTY_EMPREENDEDORES_FILTERS: EmpreendedoresAdvancedFilters = {
  tipoPessoa: 'Todos',
  nome: '',
  nomeFantasia: '',
  cpfCnpj: '',
  email: '',
  telefone: '',
  uf: 'Todas',
  municipio: '',
  situacao: 'Todas',
  empreendimentoStatus: 'Todos',
  barragemStatus: 'Todos',
  empreendimentoTexto: '',
  barragemOuProcesso: '',
  observacoes: '',
  dataInicio: '',
  dataFim: ''
};

export interface EmpreendedorMatchContext {
  cars: string[];
  processos: string[];
  barragensVinculadas: any[];
}

export function matchesEmpreendedorAdvanced(
  rec: any,
  filters: EmpreendedoresAdvancedFilters,
  vinculos: EmpreendedorMatchContext
): boolean {
  if (filters.tipoPessoa !== 'Todos' && normFilterText(rec.tipoPessoa) !== normFilterText(filters.tipoPessoa)) {
    return false;
  }
  if (!matchesTextField(rec.nome, filters.nome)) return false;
  if (!matchesTextField(rec.nomeFantasia, filters.nomeFantasia)) return false;
  if (!matchesTextOrDigitsField(rec.cpfCnpj, filters.cpfCnpj)) return false;
  if (!matchesTextField(rec.email, filters.email)) return false;
  if (!matchesTextOrDigitsField(rec.telefone, filters.telefone)) return false;
  if (filters.uf !== 'Todas' && normFilterText(rec.uf) !== normFilterText(filters.uf)) return false;
  if (filters.municipio) {
    const munCombined = `${rec.municipio || ''} ${rec.municipioIbge || ''}`;
    if (!matchesTextOrDigitsField(munCombined, filters.municipio)) return false;
  }
  if (filters.situacao !== 'Todas' && normFilterText(rec.situacao || 'Ativo') !== normFilterText(filters.situacao)) {
    return false;
  }

  const empsList = Array.isArray(rec.empreendimentos) ? rec.empreendimentos : [];
  const hasCar = empsList.some((em: any) => Boolean(String(em?.car || '').trim())) || vinculos.cars.length > 0;

  if (filters.empreendimentoStatus === 'com_empreendimentos' && empsList.length === 0) return false;
  if (filters.empreendimentoStatus === 'sem_empreendimentos' && empsList.length > 0) return false;
  if (filters.empreendimentoStatus === 'com_car' && !hasCar) return false;
  if (filters.empreendimentoStatus === 'sem_car' && hasCar) return false;

  if (filters.barragemStatus === 'com_barragens' && vinculos.barragensVinculadas.length === 0) return false;
  if (filters.barragemStatus === 'sem_barragens' && vinculos.barragensVinculadas.length > 0) return false;

  if (filters.empreendimentoTexto) {
    const empText = [
      ...empsList.map((em: any) => `${em.nome || ''} ${em.car || ''} ${em.escritura || ''} ${em.tipo || ''} ${em.municipio || ''}`),
      ...vinculos.cars
    ].join(' ');
    if (!matchesTextField(empText, filters.empreendimentoTexto)) return false;
  }

  if (filters.barragemOuProcesso) {
    const damProcText = [
      ...vinculos.processos,
      ...vinculos.barragensVinculadas.map((b: any) => `${b.nome || ''} ${b.processo || ''} ${b.snisb || ''}`)
    ].join(' ');
    if (!matchesTextField(damProcText, filters.barragemOuProcesso)) return false;
  }

  if (!matchesTextField(rec.observacoes, filters.observacoes)) return false;
  if (!matchesDateRange(rec.updatedAt || rec.createdAt, filters.dataInicio, filters.dataFim)) return false;

  return true;
}

// ============================================================================
// 2. BARRAGENS CADASTRADAS
// ============================================================================
export interface BarragensAdvancedFilters {
  nome: string;
  car: string;
  carStatus: string;
  uf: string;
  municipio: string;
  empreendedorStatus: string;
  empreendedor: string;
  empreendimento: string;
  processo: string;
  snisb: string;
  cursoAgua: string;
  coordenadasStatus: string;
  danoPotencial: string;
  categoriaRisco: string;
  alturaMin: string;
  alturaMax: string;
  volumeMin: string;
  volumeMax: string;
  situacao: string;
  classificadaInicio: string;
  classificadaFim: string;
  atualizadaInicio: string;
  atualizadaFim: string;
  observacoes: string;
}

export const EMPTY_BARRAGENS_FILTERS: BarragensAdvancedFilters = {
  nome: '',
  car: '',
  carStatus: 'Todos',
  uf: 'Todas',
  municipio: '',
  empreendedorStatus: 'Todos',
  empreendedor: '',
  empreendimento: '',
  processo: '',
  snisb: '',
  cursoAgua: '',
  coordenadasStatus: 'Todos',
  danoPotencial: 'Todos',
  categoriaRisco: 'Todos',
  alturaMin: '',
  alturaMax: '',
  volumeMin: '',
  volumeMax: '',
  situacao: 'Todas',
  classificadaInicio: '',
  classificadaFim: '',
  atualizadaInicio: '',
  atualizadaFim: '',
  observacoes: ''
};

export interface BarragemMatchContext {
  resolvedEmpreendedorId?: string;
  resolvedEmpreendedorName: string;
  resolvedEmpreendimentoName: string;
}

export function matchesBarragemAdvanced(
  rec: any,
  filters: BarragensAdvancedFilters,
  ctx: BarragemMatchContext
): boolean {
  if (!matchesTextField(rec.nome, filters.nome)) return false;
  if (!matchesTextField(rec.car, filters.car)) return false;

  const hasCar = Boolean(String(rec.car ?? '').trim());
  if (filters.carStatus === 'com_car' && !hasCar) return false;
  if (filters.carStatus === 'sem_car' && hasCar) return false;

  if (filters.uf !== 'Todas' && normFilterText(rec.uf || 'MT') !== normFilterText(filters.uf)) return false;
  if (filters.municipio) {
    const munCombined = `${rec.municipio || ''} ${rec.municipioIbge || ''}`;
    if (!matchesTextOrDigitsField(munCombined, filters.municipio)) return false;
  }

  const hasValidEmp = Boolean(ctx.resolvedEmpreendedorId || String(rec.empreendedorId ?? '').trim());
  if (filters.empreendedorStatus === 'com_empreendedor' && !hasValidEmp) return false;
  if (filters.empreendedorStatus === 'sem_empreendedor' && hasValidEmp) return false;

  if (filters.empreendedor) {
    const empCombined = `${ctx.resolvedEmpreendedorName} ${rec.empreendedor || ''} ${rec.empreendedorId || ''}`;
    if (!matchesTextField(empCombined, filters.empreendedor)) return false;
  }

  if (filters.empreendimento) {
    const emprCombined = `${ctx.resolvedEmpreendimentoName} ${rec.empreendimento || ''}`;
    if (!matchesTextField(emprCombined, filters.empreendimento)) return false;
  }

  if (!matchesTextField(rec.processo, filters.processo)) return false;
  if (!matchesTextField(rec.snisb, filters.snisb)) return false;
  if (!matchesTextField(rec.cursoAgua, filters.cursoAgua)) return false;

  const hasCoords = hasValidCoordinates(rec.latitude, rec.longitude);
  if (filters.coordenadasStatus === 'com_coordenadas' && !hasCoords) return false;
  if (filters.coordenadasStatus === 'sem_coordenadas' && hasCoords) return false;

  const dpaVal = String(rec.danoPotencial ?? rec.dpa ?? '').trim();
  if (filters.danoPotencial !== 'Todos') {
    if (filters.danoPotencial === 'nao_informado') {
      if (dpaVal && normFilterText(dpaVal) !== 'nao classificada') return false;
    } else if (normFilterText(dpaVal) !== normFilterText(filters.danoPotencial)) {
      return false;
    }
  }

  const criVal = String(rec.categoriaRisco ?? rec.cri ?? '').trim();
  if (filters.categoriaRisco !== 'Todos') {
    if (filters.categoriaRisco === 'nao_informado') {
      if (criVal && normFilterText(criVal) !== 'nao classificada') return false;
    } else if (normFilterText(criVal) !== normFilterText(filters.categoriaRisco)) {
      return false;
    }
  }

  if (!matchesNumericRange(rec.altura, filters.alturaMin, filters.alturaMax)) return false;
  if (!matchesNumericRange(rec.volume, filters.volumeMin, filters.volumeMax)) return false;

  if (
    filters.situacao !== 'Todas' &&
    normFilterText(rec.situacao || 'Aguardando confirmação') !== normFilterText(filters.situacao)
  ) {
    return false;
  }

  if (!matchesDateRange(rec.classificadaEm, filters.classificadaInicio, filters.classificadaFim)) return false;
  if (!matchesDateRange(rec.updatedAt || rec.createdAt, filters.atualizadaInicio, filters.atualizadaFim)) return false;
  if (!matchesTextField(rec.observacoes, filters.observacoes)) return false;

  return true;
}

// ============================================================================
// 3. RESPONSÁVEIS TÉCNICOS
// ============================================================================
export interface RtsAdvancedFilters {
  nome: string;
  cpf: string;
  conselho: string;
  ufConselho: string;
  registro: string;
  especialidades: string;
  email: string;
  telefone: string;
  artRrt: string;
  barragemVinculada: string;
  processo: string;
  validadeStatus: string;
  validadeInicio: string;
  validadeFim: string;
  revisaoStatus: string;
  situacao: string;
  observacoes: string;
}

export const EMPTY_RTS_FILTERS: RtsAdvancedFilters = {
  nome: '',
  cpf: '',
  conselho: 'Todos',
  ufConselho: 'Todas',
  registro: '',
  especialidades: '',
  email: '',
  telefone: '',
  artRrt: '',
  barragemVinculada: '',
  processo: '',
  validadeStatus: 'Todos',
  validadeInicio: '',
  validadeFim: '',
  revisaoStatus: 'Todos',
  situacao: 'Todas',
  observacoes: ''
};

export function matchesRtAdvanced(
  rec: any,
  filters: RtsAdvancedFilters,
  resolveDamNameFn: (damIdOrName?: string | null, fallbackName?: string | null) => string
): boolean {
  if (!matchesTextField(rec.nome, filters.nome)) return false;
  if (!matchesTextOrDigitsField(rec.cpf, filters.cpf)) return false;
  if (filters.conselho !== 'Todos' && normFilterText(rec.conselho) !== normFilterText(filters.conselho)) return false;
  if (filters.ufConselho !== 'Todas' && normFilterText(rec.ufConselho) !== normFilterText(filters.ufConselho)) {
    return false;
  }
  if (!matchesTextField(rec.registro, filters.registro)) return false;
  if (!matchesTextField(rec.especialidades, filters.especialidades)) return false;
  if (!matchesTextField(rec.email, filters.email)) return false;
  if (!matchesTextOrDigitsField(rec.telefone, filters.telefone)) return false;

  const vinculos: any[] =
    Array.isArray(rec.vinculos) && rec.vinculos.length > 0
      ? rec.vinculos
      : rec.art || rec.artRrt || rec.barragemVinculada
      ? [
          {
            art: rec.art || rec.artRrt || '',
            artRrt: rec.artRrt || rec.art || '',
            barragemId: rec.barragemId || rec.barragemVinculada || '',
            barragemVinculada: rec.barragemVinculada || '',
            barragemNome: rec.nomeBarragem || rec.barragemNome || '',
            validade: rec.validade || '',
            processo: rec.processo || ''
          }
        ]
      : [];

  if (filters.artRrt) {
    const allArts = [rec.art, rec.artRrt, ...vinculos.map(v => `${v.art || ''} ${v.artRrt || ''}`)].join(' ');
    if (!matchesTextField(allArts, filters.artRrt)) return false;
  }

  if (filters.barragemVinculada) {
    const allDams = [
      resolveDamNameFn(rec.barragemVinculada, rec.nomeBarragem || rec.barragemNome),
      ...vinculos.map(v => `${v.barragemId || ''} ${v.barragemVinculada || ''} ${resolveDamNameFn(v.barragemId || v.barragemVinculada, v.barragemNome)}`)
    ].join(' ');
    if (!matchesTextField(allDams, filters.barragemVinculada)) return false;
  }

  if (filters.processo) {
    const allProcs = [rec.processo, ...vinculos.map(v => v.processo || '')].join(' ');
    if (!matchesTextField(allProcs, filters.processo)) return false;
  }

  const validadeDates = [rec.validade, ...vinculos.map(v => v.validade)]
    .map(d => String(d ?? '').trim().slice(0, 10))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));

  if (filters.validadeStatus !== 'Todos') {
    const todayIso = new Date().toISOString().slice(0, 10);
    if (filters.validadeStatus === 'sem_validade' && validadeDates.length > 0) return false;
    if (filters.validadeStatus === 'vigente' && !validadeDates.some(d => d >= todayIso)) return false;
    if (
      filters.validadeStatus === 'vencida' &&
      (validadeDates.length === 0 || validadeDates.some(d => d >= todayIso))
    ) {
      return false;
    }
  }

  if (filters.validadeInicio || filters.validadeFim) {
    if (!validadeDates.some(d => matchesDateRange(d, filters.validadeInicio, filters.validadeFim))) {
      return false;
    }
  }

  if (filters.revisaoStatus === 'revisao_necessaria' && !rec.requiresReview) return false;
  if (filters.revisaoStatus === 'confiavel' && Boolean(rec.requiresReview)) return false;

  if (filters.situacao !== 'Todas' && normFilterText(rec.situacao || 'Ativo') !== normFilterText(filters.situacao)) {
    return false;
  }
  if (!matchesTextField(rec.observacoes, filters.observacoes)) return false;

  return true;
}

// ============================================================================
// 4. USUÁRIOS
// ============================================================================
export interface UsuariosAdvancedFilters {
  nome: string;
  matricula: string;
  login: string;
  email: string;
  perfilProfissional: string;
  setor: string;
  papel: string;
  situacao: string;
  observacoes: string;
  dataInicio: string;
  dataFim: string;
}

export const EMPTY_USUARIOS_FILTERS: UsuariosAdvancedFilters = {
  nome: '',
  matricula: '',
  login: '',
  email: '',
  perfilProfissional: 'Todos',
  setor: 'Todos',
  papel: 'Todos',
  situacao: 'Todos',
  observacoes: '',
  dataInicio: '',
  dataFim: ''
};

export function matchesUsuarioAdvanced(rec: any, filters: UsuariosAdvancedFilters): boolean {
  if (!matchesTextField(rec.nome, filters.nome)) return false;
  if (!matchesTextField(rec.matricula, filters.matricula)) return false;
  if (!matchesTextField(rec.login, filters.login)) return false;
  if (!matchesTextField(rec.email, filters.email)) return false;
  if (
    filters.perfilProfissional !== 'Todos' &&
    normFilterText(rec.perfilProfissional) !== normFilterText(filters.perfilProfissional)
  ) {
    return false;
  }
  if (filters.setor !== 'Todos' && normFilterText(rec.setor) !== normFilterText(filters.setor)) return false;
  if (filters.papel !== 'Todos' && normFilterText(rec.papel || 'Usuário') !== normFilterText(filters.papel)) {
    return false;
  }
  if (filters.situacao !== 'Todos' && normFilterText(rec.situacao || 'Ativo') !== normFilterText(filters.situacao)) {
    return false;
  }
  if (!matchesTextField(rec.observacoes, filters.observacoes)) return false;
  if (!matchesDateRange(rec.updatedAt || rec.createdAt, filters.dataInicio, filters.dataFim)) return false;

  return true;
}

// ============================================================================
// 5. PRODUTIVIDADE SURH
// ============================================================================
export interface ProdutividadeAdvancedFilters {
  serverName: string;
  unit: string;
  kind: string;
  productCode: string;
  sourceType: string;
  sourceName: string;
  processRef: string;
  documentRef: string;
  extraStatus: string;
  coordinator: string;
  inOfficialSheet: string;
  pontosMin: string;
  pontosMax: string;
  dataInicio: string;
  dataFim: string;
  descricaoNotas: string;
}

export const EMPTY_PRODUTIVIDADE_FILTERS: ProdutividadeAdvancedFilters = {
  serverName: '',
  unit: '',
  kind: 'Todos',
  productCode: 'Todos',
  sourceType: 'Todos',
  sourceName: '',
  processRef: '',
  documentRef: '',
  extraStatus: 'Todos',
  coordinator: '',
  inOfficialSheet: 'Todos',
  pontosMin: '',
  pontosMax: '',
  dataInicio: '',
  dataFim: '',
  descricaoNotas: ''
};

export function matchesProdutividadeAdvanced(
  rec: any,
  filters: ProdutividadeAdvancedFilters,
  getPointsFn: (r: any) => number
): boolean {
  if (!matchesTextField(rec.serverName, filters.serverName)) return false;
  if (!matchesTextField(rec.unit, filters.unit)) return false;
  if (filters.kind !== 'Todos' && rec.kind !== filters.kind) return false;
  if (
    filters.productCode !== 'Todos' &&
    normFilterText(rec.productCode) !== normFilterText(filters.productCode)
  ) {
    return false;
  }
  if (filters.sourceType !== 'Todos' && (rec.sourceType || 'manual') !== filters.sourceType) return false;
  if (!matchesTextField(rec.sourceName, filters.sourceName)) return false;
  if (!matchesTextField(rec.processRef, filters.processRef)) return false;
  if (!matchesTextField(rec.documentRef, filters.documentRef)) return false;
  if (filters.extraStatus !== 'Todos') {
    if (rec.kind !== 'extra') return false;
    if (normFilterText(rec.extraStatus || 'Pendente') !== normFilterText(filters.extraStatus)) return false;
  }
  if (!matchesTextField(rec.coordinator, filters.coordinator)) return false;
  if (filters.inOfficialSheet === 'sim' && !rec.inOfficialSheet) return false;
  if (filters.inOfficialSheet === 'nao' && Boolean(rec.inOfficialSheet)) return false;

  const pts = getPointsFn(rec);
  if (!matchesNumericRange(pts, filters.pontosMin, filters.pontosMax)) return false;
  if (!matchesDateRange(rec.date, filters.dataInicio, filters.dataFim)) return false;

  if (filters.descricaoNotas) {
    const descText = `${rec.productTitle || ''} ${rec.description || ''} ${rec.unscoredDescription || ''} ${rec.unscoredType || ''} ${rec.notes || ''} ${rec.extraOrder || ''} ${rec.extraApproval || ''}`;
    if (!matchesTextField(descText, filters.descricaoNotas)) return false;
  }

  return true;
}

// ============================================================================
// 6. PORTARIAS
// ============================================================================
export interface PortariasAdvancedFilters {
  processNumber: string;
  orderNumber: string;
  status: string;
  secretarySigned: string;
  extractPublished: string;
  orderPublished: string;
  draft: string;
  envioInicio: string;
  envioFim: string;
  finalInicio: string;
  finalFim: string;
  notes: string;
}

export const EMPTY_PORTARIAS_FILTERS: PortariasAdvancedFilters = {
  processNumber: '',
  orderNumber: '',
  status: 'Todos',
  secretarySigned: 'Todos',
  extractPublished: 'Todos',
  orderPublished: 'Todos',
  draft: 'Todos',
  envioInicio: '',
  envioFim: '',
  finalInicio: '',
  finalFim: '',
  notes: ''
};

export function matchesPortariaAdvanced(rec: any, filters: PortariasAdvancedFilters): boolean {
  if (!matchesTextField(rec.processNumber, filters.processNumber)) return false;
  if (!matchesTextField(rec.orderNumber, filters.orderNumber)) return false;

  const complete = Boolean(rec.secretarySigned && rec.extractPublished && rec.orderPublished);
  const computedStatus = rec.draft ? 'Rascunho' : complete ? 'Concluído' : 'Pendente';
  if (filters.status !== 'Todos' && normFilterText(computedStatus) !== normFilterText(filters.status)) {
    return false;
  }

  if (filters.secretarySigned === 'sim' && !rec.secretarySigned) return false;
  if (filters.secretarySigned === 'nao' && Boolean(rec.secretarySigned)) return false;
  if (filters.extractPublished === 'sim' && !rec.extractPublished) return false;
  if (filters.extractPublished === 'nao' && Boolean(rec.extractPublished)) return false;
  if (filters.orderPublished === 'sim' && !rec.orderPublished) return false;
  if (filters.orderPublished === 'nao' && Boolean(rec.orderPublished)) return false;
  if (filters.draft === 'sim' && !rec.draft) return false;
  if (filters.draft === 'nao' && Boolean(rec.draft)) return false;

  if (!matchesDateRange(rec.sentDate, filters.envioInicio, filters.envioFim)) return false;
  if (!matchesDateRange(rec.finalDate, filters.finalInicio, filters.finalFim)) return false;
  if (!matchesTextField(rec.notes, filters.notes)) return false;

  return true;
}

// ============================================================================
// 7. CONCILIAÇÃO DE CADASTROS
// ============================================================================
export interface ConciliacaoAdvancedFilters {
  uf: string;
  municipio: string;
  cpfCnpj: string;
  tipoPessoa: string;
  car: string;
  temCar: string;
  temEmpreendimentos: string;
  processo: string;
  snisb: string;
  cursoAgua: string;
  temCoordenadas: string;
  vinculoSugerido: string;
  danoPotencial: string;
  categoriaRisco: string;
  contato: string;
  situacaoDetalhada: string;
  revisaoOrigem: string;
  revisaoSituacao: string;
}

export const EMPTY_CONCILIACAO_FILTERS: ConciliacaoAdvancedFilters = {
  uf: 'Todas',
  municipio: '',
  cpfCnpj: '',
  tipoPessoa: 'Todos',
  car: '',
  temCar: 'Todos',
  temEmpreendimentos: 'Todos',
  processo: '',
  snisb: '',
  cursoAgua: '',
  temCoordenadas: 'Todos',
  vinculoSugerido: 'Todos',
  danoPotencial: 'Todos',
  categoriaRisco: 'Todos',
  contato: '',
  situacaoDetalhada: 'Todas',
  revisaoOrigem: '',
  revisaoSituacao: 'Todas'
};

export function matchesConciliacaoEmpreendedorAdvanced(
  rec: any,
  filters: ConciliacaoAdvancedFilters
): boolean {
  if (filters.uf !== 'Todas' && normFilterText(rec.uf) !== normFilterText(filters.uf)) return false;
  if (filters.municipio && !matchesTextOrDigitsField(`${rec.municipio || ''} ${rec.municipioIbge || ''}`, filters.municipio)) {
    return false;
  }
  if (!matchesTextOrDigitsField(rec.cpfCnpj, filters.cpfCnpj)) return false;
  if (filters.tipoPessoa !== 'Todos' && normFilterText(rec.tipoPessoa) !== normFilterText(filters.tipoPessoa)) {
    return false;
  }

  const empList = Array.isArray(rec.empreendimentos) ? rec.empreendimentos : [];
  const cars = empList.map((e: any) => String(e?.car || '').trim()).filter(Boolean);

  if (filters.car && !matchesTextField(cars.join(' '), filters.car)) return false;
  if (filters.temCar === 'com_car' && cars.length === 0) return false;
  if (filters.temCar === 'sem_car' && cars.length > 0) return false;
  if (filters.temEmpreendimentos === 'com' && empList.length === 0) return false;
  if (filters.temEmpreendimentos === 'sem' && empList.length > 0) return false;

  if (filters.contato) {
    const contatoText = `${rec.email || ''} ${rec.telefone || ''}`;
    if (!matchesTextOrDigitsField(contatoText, filters.contato)) return false;
  }

  if (
    filters.situacaoDetalhada !== 'Todas' &&
    normFilterText(rec.situacao || 'Ativo') !== normFilterText(filters.situacaoDetalhada)
  ) {
    return false;
  }

  return true;
}

export function matchesConciliacaoBarragemAdvanced(
  item: {
    record: any;
    legacyText: string;
    suggestedEmpreendedorId?: string;
    suggestedEmpreendedorName?: string;
    brokenReference: boolean;
  },
  filters: ConciliacaoAdvancedFilters
): boolean {
  const { record, legacyText, suggestedEmpreendedorId, suggestedEmpreendedorName, brokenReference } = item;

  if (filters.uf !== 'Todas' && normFilterText(record.uf || 'MT') !== normFilterText(filters.uf)) return false;
  if (
    filters.municipio &&
    !matchesTextOrDigitsField(`${record.municipio || ''} ${record.municipioIbge || ''}`, filters.municipio)
  ) {
    return false;
  }
  if (!matchesTextField(record.car, filters.car)) return false;

  const hasCar = Boolean(String(record.car ?? '').trim());
  if (filters.temCar === 'com_car' && !hasCar) return false;
  if (filters.temCar === 'sem_car' && hasCar) return false;

  if (!matchesTextField(record.processo, filters.processo)) return false;
  if (!matchesTextField(record.snisb, filters.snisb)) return false;
  if (!matchesTextField(record.cursoAgua, filters.cursoAgua)) return false;

  const hasCoords = hasValidCoordinates(record.latitude, record.longitude);
  if (filters.temCoordenadas === 'com_coordenadas' && !hasCoords) return false;
  if (filters.temCoordenadas === 'sem_coordenadas' && hasCoords) return false;

  if (filters.vinculoSugerido !== 'Todos') {
    if (filters.vinculoSugerido === 'sugerido' && !suggestedEmpreendedorId) return false;
    if (filters.vinculoSugerido === 'ausente' && !brokenReference) return false;
    if (
      filters.vinculoSugerido === 'legado' &&
      (Boolean(suggestedEmpreendedorId) || Boolean(brokenReference) || !legacyText)
    ) {
      return false;
    }
    if (
      filters.vinculoSugerido === 'nao_informado' &&
      (Boolean(suggestedEmpreendedorId) || Boolean(brokenReference) || Boolean(legacyText))
    ) {
      return false;
    }
  }

  if (filters.contato) {
    const refText = `${legacyText || ''} ${suggestedEmpreendedorName || ''}`;
    if (!matchesTextField(refText, filters.contato)) return false;
  }

  const dpaVal = String(record.danoPotencial ?? record.dpa ?? '').trim();
  if (filters.danoPotencial !== 'Todos') {
    if (filters.danoPotencial === 'nao_informado') {
      if (dpaVal && normFilterText(dpaVal) !== 'nao classificada') return false;
    } else if (normFilterText(dpaVal) !== normFilterText(filters.danoPotencial)) {
      return false;
    }
  }

  const criVal = String(record.categoriaRisco ?? record.cri ?? '').trim();
  if (filters.categoriaRisco !== 'Todos') {
    if (filters.categoriaRisco === 'nao_informado') {
      if (criVal && normFilterText(criVal) !== 'nao classificada') return false;
    } else if (normFilterText(criVal) !== normFilterText(filters.categoriaRisco)) {
      return false;
    }
  }

  if (
    filters.situacaoDetalhada !== 'Todas' &&
    normFilterText(record.situacao || 'Aguardando confirmação') !== normFilterText(filters.situacaoDetalhada)
  ) {
    return false;
  }

  return true;
}

export function matchesConciliacaoRevisaoAdvanced(
  rev: any,
  searchTerm: string,
  filters: ConciliacaoAdvancedFilters
): boolean {
  const q = normFilterText(searchTerm);
  if (q) {
    const text = normFilterText(
      `${rev.entidade || ''} ${rev.origem || ''} ${rev.origemA || ''} ${rev.origemB || ''} ${rev.tipo || ''} ${rev.identificador || ''} ${rev.descricao || ''} ${rev.motivo || ''} ${rev.detalhes || ''} ${rev.divergencias || ''} ${rev.situacao || ''}`
    );
    if (!text.includes(q)) return false;
  }

  if (filters.revisaoOrigem) {
    const orig = `${rev.origem || ''} ${rev.origemA || ''} ${rev.origemB || ''} ${rev.entidade || ''} ${rev.tipo || ''}`;
    if (!matchesTextField(orig, filters.revisaoOrigem)) return false;
  }

  if (
    filters.revisaoSituacao !== 'Todas' &&
    normFilterText(rev.situacao || 'Pendente') !== normFilterText(filters.revisaoSituacao)
  ) {
    return false;
  }

  return true;
}
