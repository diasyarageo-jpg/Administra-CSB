/**
 * ============================================================================
 * NOTIFICA CSB — CAMADA DE DADOS E INTEGRAÇÃO SUPABASE / LOCAL
 * Coordenadoria de Segurança de Barragens — CSB / SURH / SEMA-MT
 * ============================================================================
 *
 * Arquitetura de dados resiliente e orientada ao cliente:
 * 1. Conexão direta com Supabase via @supabase/supabase-js no cliente Vite.
 * 2. Credenciais lidas de VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.
 * 3. Chave de armazenamento local preservada (notifica_csb_local_v1).
 * 4. Operação tolerante a falhas (offline-first): dados são preservados
 *    localmente caso o Supabase esteja temporariamente indisponível.
 * 5. Migração sem duplicação de dados, com confirmação explícita antes
 *    de qualquer exclusão local.
 * ============================================================================
 */

import { supabase, isSupabaseConfigured } from './supabaseClient';

export const NOTIFICA_STORAGE_KEY = 'notifica_csb_local_v1';
export const LEGACY_STORAGE_KEY = 'administra_csb_local_v1';

export interface EmpreendimentoRecord {
  id: string;
  nome: string;
  tipo: 'Rural' | 'Urbano';
  car?: string;
  escritura?: string;
  uf?: string;
  municipio?: string;
  municipioIbge?: string;
  observacoes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EmpreendedorRecord {
  id: string;
  tipoPessoa?: string;
  nome: string;
  cpfCnpj: string;
  nomeFantasia?: string;
  email?: string;
  telefone?: string;
  uf?: string;
  municipio?: string;
  municipioIbge?: string;
  observacoes?: string;
  empreendimentos?: EmpreendimentoRecord[];
  situacao?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BarragemRecord {
  id: string;
  nome: string;
  car?: string;
  uf?: string;
  municipio?: string;
  municipioIbge?: string;
  empreendedor?: string;
  empreendimento?: string;
  processo?: string;
  snisb?: string;
  cursoAgua?: string;
  latitude?: string;
  longitude?: string;
  situacao?: string;
  observacoes?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RtVinculo {
  id: string;
  rtId?: string;
  art: string;
  artRrt?: string;
  barragemVinculada: string;
  barragemId?: string;
  nomeBarragem?: string;
  validade?: string;
  situacao?: string;
  observacoes?: string;
  originTable?: 'responsaveis_tecnicos_barragens' | 'rts' | 'local';
  rawRecord?: any;
}

export interface ResponsavelTecnicoRecord {
  id: string;
  nome: string;
  cpf?: string;
  conselho?: string;
  ufConselho?: string;
  registro?: string;
  especialidades?: string;
  telefone?: string;
  email?: string;
  situacao?: string;
  observacoes?: string;
  vinculos: RtVinculo[];
  // Campos de compatibilidade para buscas diretas e visualização legada
  art?: string;
  artRrt?: string;
  barragemVinculada?: string;
  barragensVinculadas?: string[];
  nomeBarragem?: string;
  barragemId?: string;
  validade?: string;
  hasReliableIdentifier?: boolean;
  requiresReview?: boolean;
  reviewReason?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RevisaoConciliacaoRecord {
  id: string;
  tipo: string;
  identificador: string;
  origemA: string;
  origemB: string;
  divergencias?: string;
  situacao: 'Pendente' | 'Conciliado' | 'Rejeitado';
  decisao?: string;
  responsavel?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt: string;
}

export interface UsuarioRecord {
  id: string;
  nome: string;
  login?: string;
  email: string;
  matricula?: string;
  perfilProfissional?: string;
  setor?: string;
  papel: string;
  situacao?: 'Ativo' | 'Inativo' | 'Pendente' | 'Recusado';
  status?: 'Ativo' | 'Inativo';
  authUserId?: string;
  observacoes?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PortariaRecord {
  id: string;
  processNumber: string;
  orderNumber: string;
  sentDate: string;
  finalDate?: string;
  secretarySigned: boolean;
  extractPublished: boolean;
  orderPublished: boolean;
  draft: boolean;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProdutividadeRecord {
  id: string;
  kind: 'scored' | 'unscored' | 'extra';
  date: string;
  serverName: string;
  unit?: string;
  productCode?: string;
  productTitle?: string;
  unitPoints?: number;
  quantity?: number;
  unscoredType?: string;
  unscoredDescription?: string;
  sourceType: 'manual' | 'system';
  sourceName?: string;
  processRef?: string;
  documentRef?: string;
  requestedPoints?: number;
  extraOrder?: string;
  extraApproval?: string;
  extraStatus?: 'Aguardando validação' | 'Aprovada' | 'Não aprovada' | 'Pendente';
  approvedPoints?: number;
  coordinator?: string;
  reviewedAt?: string;
  inOfficialSheet?: boolean;
  officialSheetAt?: string;
  description?: string;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificaDatabase {
  empreendedores: EmpreendedorRecord[];
  barragens: BarragemRecord[];
  rts: ResponsavelTecnicoRecord[];
  revisoes: RevisaoConciliacaoRecord[];
  usuarios: UsuarioRecord[];
  portarias: PortariaRecord[];
  produtividades: ProdutividadeRecord[];
  municipios: any[];
  [key: string]: any[];
}

export const emptyDatabase: NotificaDatabase = {
  empreendedores: [],
  barragens: [],
  rts: [],
  revisoes: [],
  usuarios: [],
  portarias: [],
  produtividades: [],
  municipios: []
};

// ============================================================================
// CONVERSORES BIDIRECIONAIS: APLICAÇÃO (camelCase) <-> SUPABASE (snake_case)
// ============================================================================

export function toDbEmpreendedor(r: any) {
  return {
    id: String(r.id),
    tipo_pessoa: r.tipoPessoa ?? r.tipo_pessoa ?? null,
    nome: String(r.nome || ''),
    cpf_cnpj: String(r.cpfCnpj ?? r.cpf_cnpj ?? ''),
    nome_fantasia: r.nomeFantasia ?? r.nome_fantasia ?? null,
    email: r.email ?? null,
    telefone: r.telefone ?? null,
    uf: r.uf ?? null,
    municipio: r.municipio ?? null,
    municipio_ibge: r.municipioIbge ?? r.municipio_ibge ?? null,
    observacoes: r.observacoes ?? null,
    situacao: r.situacao ?? 'Ativo',
    empreendimentos: Array.isArray(r.empreendimentos) ? r.empreendimentos : [],
    created_by: r.createdBy ?? r.created_by ?? null,
    updated_by: r.updatedBy ?? r.updated_by ?? null,
    created_at: r.createdAt ?? r.created_at ?? new Date().toISOString(),
    updated_at: r.updatedAt ?? r.updated_at ?? new Date().toISOString()
  };
}

export function fromDbEmpreendedor(row: any): EmpreendedorRecord {
  return {
    id: String(row.id),
    tipoPessoa: row.tipo_pessoa ?? row.tipoPessoa ?? 'Pessoa jurídica',
    nome: row.nome ?? '',
    cpfCnpj: row.cpf_cnpj ?? row.cpfCnpj ?? '',
    nomeFantasia: row.nome_fantasia ?? row.nomeFantasia ?? '',
    email: row.email ?? '',
    telefone: row.telefone ?? '',
    uf: row.uf ?? '',
    municipio: row.municipio ?? '',
    municipioIbge: row.municipio_ibge ?? row.municipioIbge ?? '',
    observacoes: row.observacoes ?? '',
    situacao: row.situacao ?? 'Ativo',
    empreendimentos: Array.isArray(row.empreendimentos) ? row.empreendimentos : [],
    createdBy: row.created_by ?? row.createdBy ?? '',
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.updatedAt ?? new Date().toISOString()
  };
}

export function toDbBarragem(r: any) {
  return {
    id: String(r.id),
    nome: String(r.nome || ''),
    car: r.car ?? null,
    uf: r.uf ?? 'MT',
    municipio: r.municipio ?? null,
    municipio_ibge: r.municipioIbge ?? r.municipio_ibge ?? null,
    empreendedor: r.empreendedor ?? null,
    empreendimento: r.empreendimento ?? null,
    processo: r.processo ?? null,
    snisb: r.snisb ?? null,
    curso_agua: r.cursoAgua ?? r.curso_agua ?? null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    situacao: r.situacao ?? 'Aguardando confirmação',
    observacoes: r.observacoes ?? null,
    created_by: r.createdBy ?? r.created_by ?? null,
    updated_by: r.updatedBy ?? r.updated_by ?? null,
    created_at: r.createdAt ?? r.created_at ?? new Date().toISOString(),
    updated_at: r.updatedAt ?? r.updated_at ?? new Date().toISOString()
  };
}

export function fromDbBarragem(row: any): BarragemRecord {
  return {
    id: String(row.id),
    nome: row.nome ?? '',
    car: row.car ?? '',
    uf: row.uf ?? 'MT',
    municipio: row.municipio ?? '',
    municipioIbge: row.municipio_ibge ?? row.municipioIbge ?? '',
    empreendedor: row.empreendedor ?? '',
    empreendimento: row.empreendimento ?? '',
    processo: row.processo ?? '',
    snisb: row.snisb ?? '',
    cursoAgua: row.curso_agua ?? row.cursoAgua ?? '',
    latitude: row.latitude ?? '',
    longitude: row.longitude ?? '',
    situacao: row.situacao ?? 'Aguardando confirmação',
    observacoes: row.observacoes ?? '',
    createdBy: row.created_by ?? row.createdBy ?? '',
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.updatedAt ?? new Date().toISOString()
  };
}

export function cleanCpf(cpf: string | undefined | null): string {
  if (!cpf) return '';
  return String(cpf).replace(/\D/g, '').trim();
}

export function cleanRegistro(reg: string | undefined | null): string {
  if (!reg) return '';
  return String(reg).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim();
}

export function toDbRt(r: any) {
  const artVal = r.artRrt ?? r.art_rrt ?? r.art ?? (r.vinculos?.[0]?.art || null);
  const damVal = r.barragemVinculada ?? r.barragem_vinculada ?? r.barragem_id ?? (r.vinculos?.[0]?.barragemVinculada || null);
  return {
    id: String(r.id),
    nome: String(r.nome || ''),
    cpf: r.cpf || null,
    conselho: r.conselho || null,
    uf_conselho: r.ufConselho ?? r.uf_conselho ?? null,
    registro: r.registro || null,
    especialidades: r.especialidades || null,
    art: artVal,
    art_rrt: artVal,
    barragem_vinculada: damVal,
    barragem_id: r.barragemId ?? damVal,
    barragens_vinculadas: Array.isArray(r.barragensVinculadas)
      ? r.barragensVinculadas
      : Array.isArray(r.vinculos)
      ? r.vinculos.map((v: any) => v.barragemVinculada)
      : damVal
      ? [damVal]
      : [],
    validade: r.validade ?? (r.vinculos?.[0]?.validade || null),
    telefone: r.telefone || null,
    email: r.email || null,
    situacao: r.situacao || 'Ativo',
    observacoes: r.observacoes || null,
    created_by: r.createdBy ?? r.created_by ?? null,
    updated_by: r.updatedBy ?? r.updated_by ?? null,
    created_at: r.createdAt ?? r.created_at ?? new Date().toISOString(),
    updated_at: r.updatedAt ?? r.updated_at ?? new Date().toISOString()
  };
}

export function fromDbRt(row: any): ResponsavelTecnicoRecord {
  // 1. Identificador único do vínculo na tabela responsaveis_tecnicos_barragens
  const id = String(
    row.id ??
    row.id_vinculo ??
    row.vinculo_id ??
    row.id_rt ??
    row.rt_id ??
    row.id_responsavel ??
    row.responsavel_id ??
    ''
  );

  // 2. Nome do Responsável Técnico (tratamento tolerante de colunas legadas e importadas)
  const nome = String(
    row.nome ??
    row.nome_responsavel ??
    row.responsavel_tecnico ??
    row.responsavel ??
    row.nome_rt ??
    row.rt_nome ??
    row.nome_profissional ??
    row.profissional ??
    ''
  ).trim();

  // 3. Documento ART / RRT
  const artVal = String(
    row.art_rrt ??
    row.artRrt ??
    row.art ??
    row.numero_art ??
    row.num_art ??
    row.art_numero ??
    row.n_art ??
    row.numero_rrt ??
    row.rrt ??
    row.documento_art ??
    ''
  ).trim();

  // 4. Barragem Vinculada (ID ou referência textual da estrutura)
  const damRef = String(
    row.barragem_vinculada ??
    row.barragemVinculada ??
    row.barragem_id ??
    row.id_barragem ??
    row.barragem ??
    row.nome_barragem ??
    row.barragem_nome ??
    row.dam_id ??
    row.codigo_barragem ??
    ''
  ).trim();

  // 5. Nome da Barragem (caso o vínculo contenha o nome textual da estrutura desnormalizado)
  const damName = String(
    row.nome_barragem ??
    row.barragem_nome ??
    row.barragem_identificacao ??
    (typeof row.barragem === 'string' && isNaN(Number(row.barragem)) && !row.barragem.startsWith('bar_') ? row.barragem : '') ??
    ''
  ).trim();

  // 6. Dados complementares profissionais (sem inventar dados; campos ausentes ficam vazios)
  const cpf = String(row.cpf ?? row.cpf_responsavel ?? row.cpf_rt ?? row.cpf_cnpj ?? '').trim();
  const conselho = String(row.conselho ?? row.conselho_profissional ?? row.orgao_classe ?? row.crea ?? '').trim();
  const ufConselho = String(row.uf_conselho ?? row.ufConselho ?? row.crea_uf ?? row.uf ?? row.estado_conselho ?? '').trim();
  const registro = String(row.registro ?? row.numero_registro ?? row.registro_crea ?? row.crea_numero ?? row.num_registro ?? row.registro_profissional ?? '').trim();
  const especialidades = String(row.especialidades ?? row.especialidade ?? row.qualificacao ?? row.formacao ?? row.funcao ?? '').trim();
  const validade = String(row.validade ?? row.validade_art ?? row.data_validade ?? row.data_fim ?? row.vencimento ?? row.data_vencimento ?? '').trim();
  const telefone = String(row.telefone ?? row.fone ?? row.contato ?? row.telefone_responsavel ?? '').trim();
  const email = String(row.email ?? row.e_mail ?? row.email_responsavel ?? row.contato_email ?? '').trim();

  // 7. Situação / Status
  const situacao = String(
    row.situacao ??
    row.status ??
    (row.ativo === false ? 'Inativo' : 'Ativo')
  ).trim() || 'Ativo';

  const observacoes = String(row.observacoes ?? row.obs ?? row.observacao ?? row.notas ?? '').trim();

  const cCpf = cleanCpf(cpf);
  const cReg = cleanRegistro(registro);
  const hasReliableId = Boolean((cCpf && cCpf.length === 11) || (cReg && cReg.length >= 3));

  const singleVinculo: RtVinculo = {
    id: id || `vinc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    rtId: row.rt_id || row.id_rt || undefined,
    art: artVal,
    artRrt: artVal,
    barragemVinculada: damRef,
    barragemId: String(row.barragem_id ?? row.id_barragem ?? '').trim() || undefined,
    nomeBarragem: damName || undefined,
    validade,
    situacao,
    observacoes: observacoes || undefined,
    originTable: 'responsaveis_tecnicos_barragens',
    rawRecord: row
  };

  return {
    id,
    nome,
    cpf,
    conselho,
    ufConselho,
    registro,
    especialidades,
    vinculos: Array.isArray(row.vinculos) ? row.vinculos : (artVal || damRef ? [singleVinculo] : []),
    art: artVal,
    artRrt: artVal,
    barragemVinculada: damRef,
    barragensVinculadas: Array.isArray(row.barragens_vinculadas)
      ? row.barragens_vinculadas
      : damRef
      ? [damRef]
      : [],
    nomeBarragem: damName || undefined,
    barragemId: String(row.barragem_id ?? row.id_barragem ?? '').trim() || undefined,
    validade,
    telefone,
    email,
    situacao,
    observacoes,
    hasReliableIdentifier: hasReliableId,
    requiresReview: !hasReliableId,
    reviewReason: !hasReliableId
      ? 'Registro importado sem identificador único confiável (CPF ou Registro ausente).'
      : undefined,
    createdBy: row.created_by ?? row.createdBy ?? '',
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.updatedAt ?? new Date().toISOString()
  };
}

/**
 * Agrupa vínculos de responsaveis_tecnicos_barragens em profissionais únicos (public.rts).
 * 
 * Regra estrita de segurança cadastral:
 * - Só agrupa quando houver identificador confiável inequívoco: CPF (11 dígitos) ou Registro profissional.
 * - Registros sem identificador confiável NUNCA são unidos por nomes iguais ou parecidos;
 *   permanecem isolados e sinalizados para conferência manual.
 */
export function groupRtLinksIntoProfessionals(
  rawLinks: any[] = [],
  existingProfessionals: any[] = []
): ResponsavelTecnicoRecord[] {
  const result: ResponsavelTecnicoRecord[] = [];
  const mapByKey = new Map<string, ResponsavelTecnicoRecord>();

  // 1. Indexa profissionais cadastrados em public.rts (se houver)
  for (const prof of existingProfessionals) {
    const pCpf = cleanCpf(prof.cpf);
    const pReg = cleanRegistro(prof.registro);
    const pCons = String(prof.conselho || '').trim().toUpperCase();

    const record: ResponsavelTecnicoRecord = {
      id: String(prof.id),
      nome: String(prof.nome || '').trim(),
      cpf: prof.cpf ? String(prof.cpf).trim() : undefined,
      conselho: prof.conselho ? String(prof.conselho).trim() : undefined,
      ufConselho: prof.ufConselho || prof.uf_conselho ? String(prof.ufConselho || prof.uf_conselho).trim() : undefined,
      registro: prof.registro ? String(prof.registro).trim() : undefined,
      especialidades: prof.especialidades ? String(prof.especialidades).trim() : undefined,
      telefone: prof.telefone ? String(prof.telefone).trim() : undefined,
      email: prof.email ? String(prof.email).trim() : undefined,
      situacao: prof.situacao || 'Ativo',
      observacoes: prof.observacoes ? String(prof.observacoes).trim() : undefined,
      vinculos: Array.isArray(prof.vinculos) ? prof.vinculos : [],
      hasReliableIdentifier: Boolean((pCpf && pCpf.length === 11) || (pReg && pReg.length >= 3)),
      requiresReview: false,
      createdBy: prof.createdBy || prof.created_by,
      updatedBy: prof.updatedBy || prof.updated_by,
      createdAt: prof.createdAt || prof.created_at || new Date().toISOString(),
      updatedAt: prof.updatedAt || prof.updated_at || new Date().toISOString()
    };

    result.push(record);
    if (prof.id) mapByKey.set(`id:${prof.id}`, record);
    if (pCpf && pCpf.length === 11) mapByKey.set(`cpf:${pCpf}`, record);
    if (pReg && pReg.length >= 3) mapByKey.set(`reg:${pCons}_${pReg}`, record);
  }

  // 2. Processa cada vínculo importado de responsaveis_tecnicos_barragens
  for (const row of rawLinks) {
    const rawParsed = fromDbRt(row);
    const linkId = String(rawParsed.id || row.id || `vinc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
    const art = rawParsed.art || rawParsed.artRrt || '';
    const dam = rawParsed.barragemVinculada || '';
    const damName = rawParsed.nomeBarragem || undefined;

    const vinculoItem: RtVinculo = {
      id: linkId,
      rtId: row.rt_id || row.id_rt || undefined,
      art,
      artRrt: art,
      barragemVinculada: dam,
      barragemId: rawParsed.barragemId || dam,
      nomeBarragem: damName,
      validade: rawParsed.validade || undefined,
      situacao: rawParsed.situacao || 'Ativo',
      observacoes: rawParsed.observacoes || undefined,
      originTable: 'responsaveis_tecnicos_barragens',
      rawRecord: row
    };

    const linkCpf = cleanCpf(rawParsed.cpf);
    const linkReg = cleanRegistro(rawParsed.registro);
    const linkCons = String(rawParsed.conselho || '').trim().toUpperCase();
    const explicitRtId = row.rt_id || row.id_rt;

    // Procura correspondência inequívoca por identificador confiável
    let matched: ResponsavelTecnicoRecord | undefined = undefined;

    if (explicitRtId && mapByKey.has(`id:${explicitRtId}`)) {
      matched = mapByKey.get(`id:${explicitRtId}`);
    } else if (linkCpf && linkCpf.length === 11 && mapByKey.has(`cpf:${linkCpf}`)) {
      matched = mapByKey.get(`cpf:${linkCpf}`);
    } else if (linkReg && linkReg.length >= 3 && mapByKey.has(`reg:${linkCons}_${linkReg}`)) {
      matched = mapByKey.get(`reg:${linkCons}_${linkReg}`);
    }

    if (matched) {
      // Correspondência confiável encontrada: agrega o vínculo à ficha do profissional
      const exists = matched.vinculos.some(v => v.id === vinculoItem.id);
      if (!exists) {
        matched.vinculos.push(vinculoItem);
      }
      if (!matched.cpf && rawParsed.cpf) matched.cpf = rawParsed.cpf;
      if (!matched.registro && rawParsed.registro) matched.registro = rawParsed.registro;
      if (!matched.conselho && rawParsed.conselho) matched.conselho = rawParsed.conselho;
      if (!matched.ufConselho && rawParsed.ufConselho) matched.ufConselho = rawParsed.ufConselho;
      if (!matched.especialidades && rawParsed.especialidades) matched.especialidades = rawParsed.especialidades;
      if (!matched.email && rawParsed.email) matched.email = rawParsed.email;
      if (!matched.telefone && rawParsed.telefone) matched.telefone = rawParsed.telefone;
      matched.art = matched.vinculos[0]?.art || '';
      matched.artRrt = matched.vinculos[0]?.artRrt || '';
      matched.barragemVinculada = matched.vinculos[0]?.barragemVinculada || '';
      matched.barragensVinculadas = matched.vinculos.map(v => v.barragemVinculada);
      matched.nomeBarragem = matched.vinculos[0]?.nomeBarragem;
    } else {
      // Sem correspondência confiável prévia
      const hasCpf = Boolean(linkCpf && linkCpf.length === 11);
      const hasReg = Boolean(linkReg && linkReg.length >= 3);
      const hasReliableId = hasCpf || hasReg;

      const profId = explicitRtId || `rt_${linkId}`;
      const newProf: ResponsavelTecnicoRecord = {
        id: profId,
        nome: rawParsed.nome || 'Responsável Técnico sem nome',
        cpf: rawParsed.cpf || undefined,
        conselho: rawParsed.conselho || undefined,
        ufConselho: rawParsed.ufConselho || undefined,
        registro: rawParsed.registro || undefined,
        especialidades: rawParsed.especialidades || undefined,
        telefone: rawParsed.telefone || undefined,
        email: rawParsed.email || undefined,
        situacao: rawParsed.situacao || 'Ativo',
        observacoes: rawParsed.observacoes || undefined,
        vinculos: [vinculoItem],
        art: vinculoItem.art,
        artRrt: vinculoItem.artRrt,
        barragemVinculada: vinculoItem.barragemVinculada,
        barragensVinculadas: [vinculoItem.barragemVinculada],
        nomeBarragem: vinculoItem.nomeBarragem,
        hasReliableIdentifier: hasReliableId,
        requiresReview: !hasReliableId,
        reviewReason: !hasReliableId
          ? 'Registro importado sem identificador único confiável (CPF ou Registro ausente).'
          : undefined,
        createdBy: rawParsed.createdBy,
        updatedBy: rawParsed.updatedBy,
        createdAt: rawParsed.createdAt || new Date().toISOString(),
        updatedAt: rawParsed.updatedAt || new Date().toISOString()
      };

      vinculoItem.rtId = profId;
      result.push(newProf);

      // Só indexa se possuir identificador confiável; registros sem identificador NUNCA são mesclados por nome
      if (hasCpf) mapByKey.set(`cpf:${linkCpf}`, newProf);
      if (hasReg) mapByKey.set(`reg:${linkCons}_${linkReg}`, newProf);
      if (profId) mapByKey.set(`id:${profId}`, newProf);
    }
  }

  return result;
}

export function toDbRevisao(r: any) {
  return {
    id: String(r.id),
    tipo: r.tipo ?? 'Comparação cadastral',
    identificador: r.identificador ?? '',
    origem_a: r.origemA ?? r.origem_a ?? '',
    origem_b: r.origemB ?? r.origem_b ?? '',
    divergencias: r.divergencias ?? null,
    situacao: r.situacao ?? 'Pendente',
    decisao: r.decisao ?? null,
    responsavel: r.responsavel ?? null,
    created_by: r.createdBy ?? r.created_by ?? null,
    updated_by: r.updatedBy ?? r.updated_by ?? null,
    created_at: r.createdAt ?? r.created_at ?? new Date().toISOString(),
    updated_at: r.updatedAt ?? r.updated_at ?? new Date().toISOString()
  };
}

export function fromDbRevisao(row: any): RevisaoConciliacaoRecord {
  return {
    id: String(row.id),
    tipo: row.tipo ?? '',
    identificador: row.identificador ?? '',
    origemA: row.origem_a ?? row.origemA ?? '',
    origemB: row.origem_b ?? row.origemB ?? '',
    divergencias: row.divergencias ?? '',
    situacao: row.situacao ?? 'Pendente',
    decisao: row.decisao ?? '',
    responsavel: row.responsavel ?? '',
    createdBy: row.created_by ?? row.createdBy ?? '',
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.updatedAt ?? new Date().toISOString()
  };
}

export function toDbUsuario(r: any) {
  return {
    id: String(r.id),
    nome: String(r.nome || ''),
    login: r.login ?? r.email ?? '',
    email: String(r.email || ''),
    matricula: r.matricula ?? null,
    perfil_profissional: r.perfilProfissional ?? r.perfil_profissional ?? null,
    setor: r.setor ?? null,
    papel: r.papel ?? 'Usuário',
    situacao: r.situacao ?? 'Ativo',
    status: (r.situacao === 'Inativo' || r.situacao === 'Recusado') ? 'Inativo' : 'Ativo',
    auth_user_id: r.authUserId ?? r.auth_user_id ?? null,
    observacoes: r.observacoes ?? null,
    created_by: r.createdBy ?? r.created_by ?? null,
    updated_by: r.updatedBy ?? r.updated_by ?? null,
    created_at: r.createdAt ?? r.created_at ?? new Date().toISOString(),
    updated_at: r.updatedAt ?? r.updated_at ?? new Date().toISOString()
  };
}

export function fromDbUsuario(row: any): UsuarioRecord {
  return {
    id: String(row.id),
    nome: row.nome ?? '',
    login: row.login ?? row.email ?? '',
    email: row.email ?? '',
    matricula: row.matricula ?? row.matricula ?? '',
    perfilProfissional: row.perfil_profissional ?? row.perfilProfissional ?? '',
    setor: row.setor ?? '',
    papel: row.papel ?? 'Usuário',
    situacao: row.situacao ?? row.status ?? 'Ativo',
    status: row.status ?? row.situacao ?? 'Ativo',
    authUserId: row.auth_user_id ?? row.authUserId ?? '',
    observacoes: row.observacoes ?? '',
    createdBy: row.created_by ?? row.createdBy ?? '',
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.updatedAt ?? new Date().toISOString()
  };
}

export function toDbPortaria(r: any) {
  return {
    id: String(r.id),
    process_number: r.processNumber ?? r.process_number ?? '',
    order_number: r.orderNumber ?? r.order_number ?? '',
    sent_date: r.sentDate ?? r.sent_date ?? '',
    final_date: r.finalDate ?? r.final_date ?? null,
    secretary_signed: Boolean(r.secretarySigned ?? r.secretary_signed),
    extract_published: Boolean(r.extractPublished ?? r.extract_published),
    order_published: Boolean(r.orderPublished ?? r.order_published),
    draft: Boolean(r.draft),
    notes: r.notes ?? null,
    created_by: r.createdBy ?? r.created_by ?? null,
    updated_by: r.updatedBy ?? r.updated_by ?? null,
    created_at: r.createdAt ?? r.created_at ?? new Date().toISOString(),
    updated_at: r.updatedAt ?? r.updated_at ?? new Date().toISOString()
  };
}

export function fromDbPortaria(row: any): PortariaRecord {
  return {
    id: String(row.id),
    processNumber: row.process_number ?? row.processNumber ?? '',
    orderNumber: row.order_number ?? row.orderNumber ?? '',
    sentDate: row.sent_date ?? row.sentDate ?? '',
    finalDate: row.final_date ?? row.finalDate ?? '',
    secretarySigned: Boolean(row.secretary_signed ?? row.secretarySigned),
    extractPublished: Boolean(row.extract_published ?? row.extractPublished),
    orderPublished: Boolean(row.order_published ?? row.orderPublished),
    draft: Boolean(row.draft),
    notes: row.notes ?? '',
    createdBy: row.created_by ?? row.createdBy ?? '',
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.updatedAt ?? new Date().toISOString()
  };
}

export function toDbProdutividade(r: any) {
  return {
    id: String(r.id),
    kind: r.kind ?? 'scored',
    date: r.date ?? '',
    server_name: r.serverName ?? r.server_name ?? '',
    unit: r.unit ?? null,
    product_code: r.productCode ?? r.product_code ?? null,
    product_title: r.productTitle ?? r.product_title ?? null,
    unit_points: Number(r.unitPoints ?? r.unit_points ?? 0),
    quantity: Number(r.quantity ?? 1),
    unscored_type: r.unscoredType ?? r.unscored_type ?? null,
    unscored_description: r.unscoredDescription ?? r.unscored_description ?? null,
    source_type: r.sourceType ?? r.source_type ?? 'manual',
    source_name: r.sourceName ?? r.source_name ?? null,
    process_ref: r.processRef ?? r.process_ref ?? null,
    document_ref: r.documentRef ?? r.document_ref ?? null,
    requested_points: Number(r.requestedPoints ?? r.requested_points ?? 0),
    extra_order: r.extraOrder ?? r.extra_order ?? null,
    extra_approval: r.extraApproval ?? r.extra_approval ?? null,
    extra_status: r.extraStatus ?? r.extra_status ?? null,
    approved_points: Number(r.approvedPoints ?? r.approved_points ?? 0),
    coordinator: r.coordinator ?? null,
    reviewed_at: r.reviewedAt ?? r.reviewed_at ?? null,
    in_official_sheet: Boolean(r.inOfficialSheet ?? r.in_official_sheet),
    official_sheet_at: r.officialSheetAt ?? r.official_sheet_at ?? null,
    description: r.description ?? null,
    notes: r.notes ?? null,
    created_by: r.createdBy ?? r.created_by ?? null,
    updated_by: r.updatedBy ?? r.updated_by ?? null,
    created_at: r.createdAt ?? r.created_at ?? new Date().toISOString(),
    updated_at: r.updatedAt ?? r.updated_at ?? new Date().toISOString()
  };
}

export function fromDbProdutividade(row: any): ProdutividadeRecord {
  return {
    id: String(row.id),
    kind: row.kind ?? 'scored',
    date: row.date ?? '',
    serverName: row.server_name ?? row.serverName ?? '',
    unit: row.unit ?? '',
    productCode: row.product_code ?? row.productCode ?? '',
    productTitle: row.product_title ?? row.productTitle ?? '',
    unitPoints: Number(row.unit_points ?? row.unitPoints ?? 0),
    quantity: Number(row.quantity ?? 1),
    unscoredType: row.unscored_type ?? row.unscoredType ?? '',
    unscoredDescription: row.unscored_description ?? row.unscoredDescription ?? '',
    sourceType: row.source_type ?? row.sourceType ?? 'manual',
    sourceName: row.source_name ?? row.sourceName ?? '',
    processRef: row.process_ref ?? row.processRef ?? '',
    documentRef: row.document_ref ?? row.documentRef ?? '',
    requestedPoints: Number(row.requested_points ?? row.requestedPoints ?? 0),
    extraOrder: row.extra_order ?? row.extraOrder ?? '',
    extraApproval: row.extra_approval ?? row.extraApproval ?? '',
    extraStatus: row.extra_status ?? row.extraStatus ?? '',
    approvedPoints: Number(row.approved_points ?? row.approvedPoints ?? 0),
    coordinator: row.coordinator ?? '',
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? '',
    inOfficialSheet: Boolean(row.in_official_sheet ?? row.inOfficialSheet),
    officialSheetAt: row.official_sheet_at ?? row.officialSheetAt ?? '',
    description: row.description ?? '',
    notes: row.notes ?? '',
    createdBy: row.created_by ?? row.createdBy ?? '',
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.updatedAt ?? new Date().toISOString()
  };
}

export function toDbMunicipio(r: any) {
  return {
    id: String(r.id),
    codigo_ibge: r.codigoIbge ?? r.codigo_ibge ?? String(r.id ?? ''),
    nome: r.nome ?? '',
    uf: r.uf ?? 'MT',
    created_at: r.createdAt ?? r.created_at ?? new Date().toISOString(),
    updated_at: r.updatedAt ?? r.updated_at ?? new Date().toISOString()
  };
}

export function fromDbMunicipio(row: any): any {
  return {
    id: String(row.id),
    codigoIbge: row.codigo_ibge ?? row.codigoIbge ?? String(row.id),
    nome: row.nome ?? '',
    uf: row.uf ?? 'MT',
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.updatedAt ?? new Date().toISOString()
  };
}

// Mapas utilitários de coleção para conversão
export const collectionConverters: Record<
  keyof NotificaDatabase,
  {
    table: string;
    toDb: (r: any) => any;
    fromDb: (row: any) => any;
  }
> = {
  empreendedores: { table: 'empreendedores', toDb: toDbEmpreendedor, fromDb: fromDbEmpreendedor },
  barragens: { table: 'barragens', toDb: toDbBarragem, fromDb: fromDbBarragem },
  rts: { table: 'rts', toDb: toDbRt, fromDb: fromDbRt },
  revisoes: { table: 'revisoes', toDb: toDbRevisao, fromDb: fromDbRevisao },
  usuarios: { table: 'usuarios', toDb: toDbUsuario, fromDb: fromDbUsuario },
  portarias: { table: 'portarias', toDb: toDbPortaria, fromDb: fromDbPortaria },
  produtividades: { table: 'produtividades', toDb: toDbProdutividade, fromDb: fromDbProdutividade },
  municipios: { table: 'municipios', toDb: toDbMunicipio, fromDb: fromDbMunicipio }
};

// ============================================================================
// ARMAZENAMENTO LOCAL (OFFLINE-FIRST)
// ============================================================================

export function loadNotificaDatabase(): NotificaDatabase {
  if (typeof window === 'undefined') {
    return { ...emptyDatabase };
  }

  try {
    const raw = localStorage.getItem(NOTIFICA_STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return { ...emptyDatabase };
    }
    const parsed = JSON.parse(raw);
    return {
      empreendedores: Array.isArray(parsed.empreendedores) ? parsed.empreendedores : [],
      barragens: Array.isArray(parsed.barragens) ? parsed.barragens : [],
      rts: Array.isArray(parsed.rts)
        ? parsed.rts.map((r: any) => ({
            ...r,
            vinculos: Array.isArray(r.vinculos)
              ? r.vinculos
              : (r.art || r.artRrt || r.barragemVinculada)
              ? [
                  {
                    id: String(r.id || `vinc_${Date.now()}`),
                    art: r.art || r.artRrt || '',
                    artRrt: r.artRrt || r.art || '',
                    barragemVinculada: r.barragemVinculada || '',
                    barragemId: r.barragemId || r.barragemVinculada,
                    nomeBarragem: r.nomeBarragem,
                    validade: r.validade,
                    situacao: r.situacao || 'Ativo',
                    observacoes: r.observacoes
                  }
                ]
              : []
          }))
        : [],
      revisoes: Array.isArray(parsed.revisoes) ? parsed.revisoes : [],
      usuarios: Array.isArray(parsed.usuarios) ? parsed.usuarios : [],
      portarias: Array.isArray(parsed.portarias) ? parsed.portarias : [],
      produtividades: Array.isArray(parsed.produtividades) ? parsed.produtividades : [],
      municipios: Array.isArray(parsed.municipios) ? parsed.municipios : []
    };
  } catch (err) {
    console.warn('[Notifica CSB] Erro ao carregar dados do armazenamento local:', err);
    return { ...emptyDatabase };
  }
}

export function saveNotificaDatabase(db: NotificaDatabase): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(NOTIFICA_STORAGE_KEY, JSON.stringify(db));
  } catch (err) {
    console.error('[Notifica CSB] Erro ao persistir dados no armazenamento local:', err);
  }
}

// ============================================================================
// SERVIÇO DE SINCRONIZAÇÃO E PERSISTÊNCIA INTEGRADA
// ============================================================================

export interface RemoteSyncResult {
  success: boolean;
  db?: NotificaDatabase;
  error?: string;
}

export interface SaveOperationResult {
  updatedDb: NotificaDatabase;
  savedLocal: boolean;
  savedRemote: boolean;
  error?: string;
}

export interface DeleteOperationResult {
  updatedDb: NotificaDatabase;
  deletedLocal: boolean;
  deletedRemote: boolean;
  error?: string;
}

export interface MigrationSummary {
  collection: string;
  totalLocal: number;
  migrated: number;
  errors: string[];
}

export const notificaDataService = {
  getDatabase(): NotificaDatabase {
    return loadNotificaDatabase();
  },

  setDatabase(db: NotificaDatabase): void {
    saveNotificaDatabase(db);
  },

  /**
   * Busca os dados remotos do Supabase para todas as coleções.
   * Não sobrescreve o cache local sem conferência.
   */
  async fetchRemoteDatabase(): Promise<RemoteSyncResult> {
    if (!isSupabaseConfigured() || !supabase) {
      return {
        success: false,
        error: 'Supabase não está configurado (variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY ausentes).'
      };
    }

    try {
      const result: NotificaDatabase = { ...emptyDatabase };

      const collections: (keyof NotificaDatabase)[] = [
        'empreendedores',
        'barragens',
        'rts',
        'revisoes',
        'usuarios',
        'portarias',
        'produtividades',
        'municipios'
      ];

      for (const col of collections) {
        if (col === 'rts') continue;
        const conf = collectionConverters[col];
        const { data, error } = await supabase.from(conf.table).select('*');
        if (error) {
          throw new Error(`Erro ao ler tabela '${conf.table}': ${error.message} (${error.code})`);
        }
        result[col] = (data || []).map(conf.fromDb);
      }

      // Consulta relacional para RTs: consulta public.rts (profissionais) e public.responsaveis_tecnicos_barragens (vínculos)
      let rtsProfissionais: any[] = [];
      const rtsRes = await supabase.from('rts').select('*');
      if (!rtsRes.error && Array.isArray(rtsRes.data)) {
        rtsProfissionais = rtsRes.data;
      }

      let rtsVinculos: any[] = [];
      const vinculosRes = await supabase.from('responsaveis_tecnicos_barragens').select('*');
      if (!vinculosRes.error && Array.isArray(vinculosRes.data)) {
        rtsVinculos = vinculosRes.data;
      }

      // Agrupa com a regra estrita de identificador confiável
      if (rtsVinculos.length === 0 && rtsProfissionais.length > 0) {
        result.rts = groupRtLinksIntoProfessionals(rtsProfissionais, []);
      } else {
        result.rts = groupRtLinksIntoProfessionals(rtsVinculos, rtsProfissionais);
      }

      return {
        success: true,
        db: result
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Falha ao sincronizar com o Supabase'
      };
    }
  },

  /**
   * Salva um registro: primeiro salva no localStorage (garantindo que o trabalho
   * não seja perdido mesmo offline) e, se o Supabase estiver configurado, envia a gravação remota.
   */
  async saveRecord<K extends keyof NotificaDatabase>(
    currentDb: NotificaDatabase,
    collectionKey: K,
    record: any,
    index: number | 'new' | null,
    currentUserId?: string
  ): Promise<SaveOperationResult> {
    const list = [...(currentDb[collectionKey] as any[])];
    const timestamp = new Date().toISOString();
    const id = record.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);

    const recordWithTimestamps = {
      ...record,
      id: String(id),
      createdBy: record.createdBy || currentUserId || undefined,
      updatedBy: currentUserId || record.updatedBy || undefined,
      updatedAt: timestamp,
      createdAt: record.createdAt || timestamp
    };

    if (index === 'new' || index === null || typeof index === 'undefined') {
      list.unshift(recordWithTimestamps);
    } else {
      list[index] = recordWithTimestamps;
    }

    const updatedDb: NotificaDatabase = {
      ...currentDb,
      [collectionKey]: list
    };

    // 1. Sempre salva localmente primeiro
    saveNotificaDatabase(updatedDb);

    // 2. Se o Supabase estiver configurado, grava no banco remoto
    if (!isSupabaseConfigured() || !supabase) {
      return {
        updatedDb,
        savedLocal: true,
        savedRemote: false
      };
    }

    // Tratamento relacional seguro para Responsáveis Técnicos
    if (collectionKey === 'rts') {
      try {
        const rtPayload = {
          id: String(recordWithTimestamps.id),
          nome: String(recordWithTimestamps.nome || ''),
          cpf: recordWithTimestamps.cpf || null,
          conselho: recordWithTimestamps.conselho || null,
          uf_conselho: recordWithTimestamps.ufConselho || null,
          registro: recordWithTimestamps.registro || null,
          especialidades: recordWithTimestamps.especialidades || null,
          telefone: recordWithTimestamps.telefone || null,
          email: recordWithTimestamps.email || null,
          situacao: recordWithTimestamps.situacao || 'Ativo',
          observacoes: recordWithTimestamps.observacoes || null,
          created_by: recordWithTimestamps.createdBy || null,
          updated_by: recordWithTimestamps.updatedBy || null,
          created_at: recordWithTimestamps.createdAt || timestamp,
          updated_at: timestamp
        };

        // 1. Grava a ficha do profissional em public.rts
        const rtsSave = await supabase.from('rts').upsert(rtPayload, { onConflict: 'id' });

        // 2. Grava cada vínculo em public.responsaveis_tecnicos_barragens
        const vinculos = Array.isArray(recordWithTimestamps.vinculos) ? recordWithTimestamps.vinculos : [];
        const vinculoErrors: string[] = [];

        for (const vinc of vinculos) {
          const vincId = vinc.id || `vinc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const vincPayload: any = {
            id: String(vincId),
            rt_id: String(recordWithTimestamps.id),
            nome: String(recordWithTimestamps.nome || ''),
            art: vinc.art || vinc.artRrt || '',
            art_rrt: vinc.art || vinc.artRrt || '',
            barragem_id: vinc.barragemId || vinc.barragemVinculada || null,
            barragem_vinculada: vinc.barragemVinculada || null,
            nome_barragem: vinc.nomeBarragem || null,
            validade: vinc.validade || null,
            situacao: vinc.situacao || recordWithTimestamps.situacao || 'Ativo',
            observacoes: vinc.observacoes || null,
            created_by: recordWithTimestamps.createdBy || null,
            updated_by: recordWithTimestamps.updatedBy || null,
            created_at: timestamp,
            updated_at: timestamp
          };

          let { error: vErr } = await supabase
            .from('responsaveis_tecnicos_barragens')
            .upsert(vincPayload, { onConflict: 'id' });

          if (vErr && vErr.code === '42703') {
            const lean: any = {
              id: vincPayload.id,
              nome: vincPayload.nome,
              art: vincPayload.art,
              barragem_id: vincPayload.barragem_id
            };
            const retry = await supabase.from('responsaveis_tecnicos_barragens').upsert(lean, { onConflict: 'id' });
            if (!retry.error) vErr = null;
          }

          if (vErr) {
            vinculoErrors.push(`ART ${vinc.art}: ${vErr.message}`);
          }
        }

        // 3. Exclui vínculos removidos pelo usuário nesta edição (se houver)
        if (Array.isArray(recordWithTimestamps.removedLinkIds) && recordWithTimestamps.removedLinkIds.length > 0) {
          for (const remId of recordWithTimestamps.removedLinkIds) {
            await supabase.from('responsaveis_tecnicos_barragens').delete().eq('id', String(remId));
          }
        }

        if (rtsSave.error && vinculoErrors.length > 0) {
          return {
            updatedDb,
            savedLocal: true,
            savedRemote: false,
            error: `Erro ao gravar profissional (${rtsSave.error.message}) e vínculos: ${vinculoErrors.join('; ')}`
          };
        } else if (vinculoErrors.length > 0) {
          return {
            updatedDb,
            savedLocal: true,
            savedRemote: true,
            error: `Ficha salva, mas houve aviso em alguns vínculos: ${vinculoErrors.join('; ')}`
          };
        }

        return {
          updatedDb,
          savedLocal: true,
          savedRemote: true
        };
      } catch (err: any) {
        return {
          updatedDb,
          savedLocal: true,
          savedRemote: false,
          error: `Falha na gravação do profissional e vínculos: ${err?.message || 'Indisponível'}`
        };
      }
    }

    try {
      const conf = collectionConverters[collectionKey];
      const payload = conf.toDb(recordWithTimestamps);

      const { error } = await supabase
        .from(conf.table)
        .upsert(payload, { onConflict: 'id' });

      if (error) {
        return {
          updatedDb,
          savedLocal: true,
          savedRemote: false,
          error: `Erro ao gravar no Supabase: ${error.message} (${error.code || 'RLS/Permission'})`
        };
      }

      return {
        updatedDb,
        savedLocal: true,
        savedRemote: true
      };
    } catch (err: any) {
      return {
        updatedDb,
        savedLocal: true,
        savedRemote: false,
        error: `Falha de rede ao gravar no Supabase: ${err?.message || 'Indisponível'}`
      };
    }
  },

  /**
   * Exclui um registro: remove localmente e, se conectado, exclui no Supabase.
   */
  async deleteRecord<K extends keyof NotificaDatabase>(
    currentDb: NotificaDatabase,
    collectionKey: K,
    index: number
  ): Promise<DeleteOperationResult> {
    const list = [...(currentDb[collectionKey] as any[])];
    const recordToDelete = list[index];
    list.splice(index, 1);

    const updatedDb: NotificaDatabase = {
      ...currentDb,
      [collectionKey]: list
    };

    saveNotificaDatabase(updatedDb);

    if (!isSupabaseConfigured() || !supabase || !recordToDelete?.id) {
      return {
        updatedDb,
        deletedLocal: true,
        deletedRemote: false
      };
    }

    // Exclusão relacional para Responsáveis Técnicos
    if (collectionKey === 'rts') {
      try {
        if (Array.isArray(recordToDelete.vinculos)) {
          for (const v of recordToDelete.vinculos) {
            if (v.id) {
              await supabase.from('responsaveis_tecnicos_barragens').delete().eq('id', String(v.id));
            }
          }
        }
        await supabase.from('responsaveis_tecnicos_barragens').delete().eq('rt_id', String(recordToDelete.id));
        await supabase.from('rts').delete().eq('id', String(recordToDelete.id));

        return {
          updatedDb,
          deletedLocal: true,
          deletedRemote: true
        };
      } catch (err: any) {
        return {
          updatedDb,
          deletedLocal: true,
          deletedRemote: false,
          error: `Falha ao excluir profissional no Supabase: ${err?.message}`
        };
      }
    }

    try {
      const conf = collectionConverters[collectionKey];
      const { error } = await supabase
        .from(conf.table)
        .delete()
        .eq('id', String(recordToDelete.id));

      if (error) {
        return {
          updatedDb,
          deletedLocal: true,
          deletedRemote: false,
          error: `Erro ao excluir no Supabase: ${error.message}`
        };
      }

      return {
        updatedDb,
        deletedLocal: true,
        deletedRemote: true
      };
    } catch (err: any) {
      return {
        updatedDb,
        deletedLocal: true,
        deletedRemote: false,
        error: `Falha ao conectar com o Supabase: ${err?.message}`
      };
    }
  },

  /**
   * Migração segura dos dados locais para o Supabase:
   * - Executa upsert de todos os registros locais existentes por chave primária (id),
   *   evitando duplicidade;
   * - NÃO apaga o armazenamento local automaticamente;
   * - Retorna relatório por coleção com total, migrados e erros.
   */
  async migrateLocalToSupabase(): Promise<{
    success: boolean;
    summaries: MigrationSummary[];
    totalMigrated: number;
    errorCount: number;
  }> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
    }

    const localDb = loadNotificaDatabase();
    const summaries: MigrationSummary[] = [];
    let totalMigrated = 0;
    let errorCount = 0;

    const collections: (keyof NotificaDatabase)[] = [
      'empreendedores',
      'barragens',
      'rts',
      'revisoes',
      'usuarios',
      'portarias',
      'produtividades',
      'municipios'
    ];

    for (const col of collections) {
      const items = (localDb[col] as any[]) || [];
      const conf = collectionConverters[col];
      const summary: MigrationSummary = {
        collection: String(col),
        totalLocal: items.length,
        migrated: 0,
        errors: []
      };

      for (const item of items) {
        try {
          const payload = conf.toDb(item);
          const { error } = await supabase.from(conf.table).upsert(payload, { onConflict: 'id' });
          if (error) {
            summary.errors.push(`ID ${item.id}: ${error.message}`);
            errorCount++;
          } else {
            summary.migrated++;
            totalMigrated++;
          }
        } catch (e: any) {
          summary.errors.push(`ID ${item.id}: ${e?.message || 'Erro desconhecido'}`);
          errorCount++;
        }
      }

      summaries.push(summary);
    }

    return {
      success: errorCount === 0,
      summaries,
      totalMigrated,
      errorCount
    };
  },

  /**
   * Limpeza controlada do armazenamento local:
   * Só permite remover após confirmação explícita no frontend de que os dados
   * foram conferidos no Supabase.
   */
  clearLocalDataAfterConfirmation(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      localStorage.removeItem(NOTIFICA_STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }
};
