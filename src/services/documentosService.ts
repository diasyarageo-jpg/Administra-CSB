/**
 * ============================================================================
 * ADMINISTRA-CSB — SERVIÇO DE CATÁLOGO E INTEGRAÇÃO DE DOCUMENTOS
 * Coordenadoria de Segurança de Barragens — CSB / SURH / SEMA-MT
 * ============================================================================
 *
 * Regras de Arquitetura:
 * - O Administra atua exclusivamente como catálogo central de consulta.
 * - Os arquivos originais permanecem nos sistemas de origem (Classifica,
 *   Notifica e Fiscaliza).
 * - Nenhum endpoint, tabela externa ou credencial é inventado neste módulo;
 *   adaptadores provisórios aguardam a configuração oficial de integração.
 * - Falhas em uma origem não impedem a consulta às demais origens.
 * ============================================================================
 */

import { supabase, isSupabaseConfigured } from './supabaseClient';
import {
  DocumentoAcessoResult,
  DocumentoCatalogoItem,
  DocumentoOrigem,
  DocumentoOriginAdapter,
  OrigemSyncStatus
} from '../types/documentos';

export interface AdministraCommonData {
  empreendedores: any[];
  barragens: any[];
  rts: any[];
}

export interface DocumentoFilterOptions {
  busca?: string;
  origem?: DocumentoOrigem | 'Todas';
  tipoCodigo?: string;
  dataInicio?: string;
  dataFim?: string;
  analista?: string;
  titulo?: string;
  numero?: string;
  responsavelTecnico?: string;
  empreendedor?: string;
  processo?: string;
  barragem?: string;
  carMt?: string;
  situacao?: string;
  suportaDownload?: 'Todos' | 'sim' | 'nao';
  sincInicio?: string;
  sincFim?: string;
  ordenarPor?: 'data' | 'titulo' | 'origem' | 'empreendedor';
  direcao?: 'asc' | 'desc';
}

export interface CatalogoSyncResult {
  documentos: DocumentoCatalogoItem[];
  origensStatus: OrigemSyncStatus[];
  erroGeral?: string;
}

/**
 * Adaptador provisório para origens ainda não conectadas.
 * Não inventa endpoints nem credenciais; informa claramente o que falta configurar.
 */
export class ProvisionalOriginAdapter implements DocumentoOriginAdapter {
  readonly origem: DocumentoOrigem;
  readonly configurado = false;
  readonly descricaoConfiguracaoPendente: string;

  constructor(origem: DocumentoOrigem, descricaoConfiguracaoPendente: string) {
    this.origem = origem;
    this.descricaoConfiguracaoPendente = descricaoConfiguracaoPendente;
  }

  async fetchMetadados(): Promise<DocumentoCatalogoItem[]> {
    return [];
  }

  async abrirOriginal(doc: DocumentoCatalogoItem): Promise<DocumentoAcessoResult> {
    if (doc.situacao === 'Indisponível na origem' || !doc.referenciaSeguraOrigem) {
      return {
        sucesso: false,
        indisponivelNaOrigem: true,
        mensagemErro: `O documento "${doc.titulo}" está marcado como indisponível no sistema ${this.origem} ou não possui referência segura vinculada.`
      };
    }

    return {
      sucesso: false,
      indisponivelNaOrigem: true,
      mensagemErro: `Integração de leitura direta com ${this.origem} ainda não configurada. ${this.descricaoConfiguracaoPendente}`
    };
  }

  async baixarOriginal(doc: DocumentoCatalogoItem): Promise<DocumentoAcessoResult> {
    if (doc.suportaDownload === false) {
      return {
        sucesso: false,
        mensagemErro: `O sistema ${this.origem} não habilitou download direto para este tipo de documento.`
      };
    }
    return this.abrirOriginal(doc);
  }
}

export const defaultOriginAdapters: Record<DocumentoOrigem, DocumentoOriginAdapter> = {
  Classifica: new ProvisionalOriginAdapter(
    'Classifica',
    'Aguardando definição da tabela/view ou Edge Function autenticada do sistema Classifica.'
  ),
  Notifica: new ProvisionalOriginAdapter(
    'Notifica',
    'Aguardando definição da tabela/view ou Edge Function autenticada do sistema Notifica.'
  ),
  Fiscaliza: new ProvisionalOriginAdapter(
    'Fiscaliza',
    'Aguardando definição da tabela/view ou Edge Function autenticada do sistema Fiscaliza.'
  )
};

/**
 * Remove duplicidades usando a chave estável (origemSistema + origemDocumentoId),
 * mantendo o registro com sincronizadoEm mais recente.
 */
export function deduplicateCatalogoDocumentos(
  docs: DocumentoCatalogoItem[]
): DocumentoCatalogoItem[] {
  const byCompositeKey = new Map<string, DocumentoCatalogoItem>();

  for (const doc of docs) {
    const key = `${doc.origemSistema}::${doc.origemDocumentoId}`;
    const existing = byCompositeKey.get(key);
    if (!existing) {
      byCompositeKey.set(key, doc);
    } else {
      const existingTime = Date.parse(existing.sincronizadoEm || existing.criadoEm || '') || 0;
      const incomingTime = Date.parse(doc.sincronizadoEm || doc.criadoEm || '') || 0;
      if (incomingTime >= existingTime) {
        byCompositeKey.set(key, doc);
      }
    }
  }

  return Array.from(byCompositeKey.values());
}

/**
 * Enriquece os metadados do catálogo reutilizando os cadastros comuns do Administra
 * (empreendedores, barragens, CAR/MT, processos e RTs) sem duplicar dados mestres.
 */
export function enrichDocumentosWithAdministraData(
  docs: DocumentoCatalogoItem[],
  commonData: AdministraCommonData
): DocumentoCatalogoItem[] {
  const emps = commonData.empreendedores || [];
  const barragens = commonData.barragens || [];
  const rts = commonData.rts || [];

  return docs.map(doc => {
    const enriched = { ...doc };

    // 1. Resolver Empreendedor pelo ID ou CPF/CNPJ
    const matchedEmp =
      (doc.empreendedorId
        ? emps.find(e => String(e.id) === String(doc.empreendedorId))
        : undefined) ||
      (doc.empreendedorCpfCnpj
        ? emps.find(
            e =>
              String(e.cpfCnpj || '').replace(/\D/g, '') ===
              String(doc.empreendedorCpfCnpj || '').replace(/\D/g, '')
          )
        : undefined);

    if (matchedEmp) {
      enriched.empreendedorId = String(matchedEmp.id);
      enriched.empreendedorNome = matchedEmp.nome || enriched.empreendedorNome;
      enriched.empreendedorCpfCnpj = matchedEmp.cpfCnpj || enriched.empreendedorCpfCnpj;
    }

    // 2. Resolver Barragem pelo ID, CAR/MT ou Processo
    const matchedDam =
      (doc.barragemId
        ? barragens.find(b => String(b.id) === String(doc.barragemId))
        : undefined) ||
      (doc.carMt
        ? barragens.find(
            b =>
              String(b.car || '').trim().toLowerCase() ===
              String(doc.carMt || '').trim().toLowerCase()
          )
        : undefined) ||
      (doc.processo
        ? barragens.find(
            b =>
              String(b.processo || '').trim().toLowerCase() ===
              String(doc.processo || '').trim().toLowerCase()
          )
        : undefined);

    if (matchedDam) {
      enriched.barragemId = String(matchedDam.id);
      enriched.barragemNome = matchedDam.nome || enriched.barragemNome;
      enriched.carMt = matchedDam.car || enriched.carMt;
      enriched.processo = matchedDam.processo || enriched.processo;

      // Se o documento não trouxe empreendedor direto, herda da barragem vinculada
      if (!enriched.empreendedorId && matchedDam.empreendedor) {
        const damEmp = emps.find(e => String(e.id) === String(matchedDam.empreendedor));
        if (damEmp) {
          enriched.empreendedorId = String(damEmp.id);
          enriched.empreendedorNome = damEmp.nome;
          enriched.empreendedorCpfCnpj = damEmp.cpfCnpj;
        }
      }
    }

    // 3. Resolver Responsável Técnico pelo ID
    if (doc.responsavelTecnicoId) {
      const matchedRt = rts.find(r => String(r.id) === String(doc.responsavelTecnicoId));
      if (matchedRt) {
        enriched.responsavelTecnicoNome = matchedRt.nome || enriched.responsavelTecnicoNome;
      }
    }

    return enriched;
  });
}

/**
 * Converte linha da tabela public.documentos_catalogo (quando existente no Supabase)
 * para DocumentoCatalogoItem.
 */
export function fromDbDocumentoCatalogo(row: any): DocumentoCatalogoItem {
  return {
    id: String(row.id),
    origemSistema: row.origem_sistema as DocumentoOrigem,
    origemDocumentoId: String(row.origem_documento_id),
    tipoCodigo: String(row.tipo_codigo || 'OUTRO'),
    tipoNome: String(row.tipo_nome || row.tipo_codigo || 'Documento'),
    titulo: String(row.titulo || 'Sem título'),
    numero: row.numero ?? undefined,
    dataEmissao: String(row.data_emissao || row.criado_em || '').slice(0, 10),
    analistasElaboradores: Array.isArray(row.analistas_elaboradores)
      ? row.analistas_elaboradores
      : row.analistas_elaboradores
      ? [String(row.analistas_elaboradores)]
      : [],
    responsavelTecnicoId: row.responsavel_tecnico_id ?? undefined,
    responsavelTecnicoNome: row.responsavel_tecnico_nome ?? undefined,
    empreendedorId: row.empreendedor_id ?? undefined,
    empreendedorNome: row.empreendedor_nome ?? undefined,
    empreendedorCpfCnpj: row.empreendedor_cpf_cnpj ?? undefined,
    processo: row.processo ?? undefined,
    barragemId: row.barragem_id ?? undefined,
    barragemNome: row.barragem_nome ?? undefined,
    carMt: row.car_mt ?? undefined,
    referenciaSeguraOrigem: row.referencia_segura_origem ?? undefined,
    suportaDownload: row.suporta_download !== false,
    situacao: (row.situacao as any) || 'Emitido',
    criadoEm: row.criado_em || new Date().toISOString(),
    sincronizadoEm: row.sincronizado_em || row.criado_em || new Date().toISOString()
  };
}

/**
 * Consulta o catálogo centralizado no Supabase (se a tabela documentos_catalogo existir)
 * e/ou os adaptadores de origem configurados, tratando indisponibilidade parcial.
 */
export async function carregarCatalogoDocumentos(
  commonData: AdministraCommonData,
  adapters: Record<DocumentoOrigem, DocumentoOriginAdapter> = defaultOriginAdapters
): Promise<CatalogoSyncResult> {
  const origens: DocumentoOrigem[] = ['Classifica', 'Notifica', 'Fiscaliza'];
  const collectedDocs: DocumentoCatalogoItem[] = [];
  const origensStatus: OrigemSyncStatus[] = [];

  // 1. Tenta consultar a tabela central public.documentos_catalogo no Supabase (se configurada)
  let catalogTableAvailable = false;
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('documentos_catalogo')
        .select('*')
        .order('data_emissao', { ascending: false });

      if (!error && Array.isArray(data)) {
        catalogTableAvailable = true;
        collectedDocs.push(...data.map(fromDbDocumentoCatalogo));
      }
    } catch {
      // Tabela ainda não criada ou inacessível; segue para consulta via adaptadores
    }
  }

  // 2. Consulta cada adaptador de origem de forma isolada (falha em uma origem não bloqueia as demais)
  const adapterResults = await Promise.allSettled(
    origens.map(async origem => {
      const adapter = adapters[origem];
      const docs = await adapter.fetchMetadados();
      return { origem, adapter, docs };
    })
  );

  for (let i = 0; i < origens.length; i++) {
    const origem = origens[i];
    const res = adapterResults[i];
    const adapter = adapters[origem];

    if (res.status === 'fulfilled') {
      const docsFromAdapter = res.value.docs;
      collectedDocs.push(...docsFromAdapter);

      const docsFromCatalogForOrigin = collectedDocs.filter(d => d.origemSistema === origem);
      origensStatus.push({
        origem,
        conectado: adapter.configurado || catalogTableAvailable,
        configurado: adapter.configurado || catalogTableAvailable,
        totalDocumentos: docsFromCatalogForOrigin.length,
        ultimaSincronizacao:
          docsFromCatalogForOrigin[0]?.sincronizadoEm ||
          (adapter.configurado ? new Date().toISOString() : undefined),
        erro:
          !adapter.configurado && !catalogTableAvailable
            ? adapter.descricaoConfiguracaoPendente
            : undefined
      });
    } else {
      const docsFromCatalogForOrigin = collectedDocs.filter(d => d.origemSistema === origem);
      origensStatus.push({
        origem,
        conectado: false,
        configurado: adapter.configurado,
        totalDocumentos: docsFromCatalogForOrigin.length,
        erro: res.reason?.message || `Falha ao consultar o sistema ${origem}.`
      });
    }
  }

  const deduplicated = deduplicateCatalogoDocumentos(collectedDocs);
  const enriched = enrichDocumentosWithAdministraData(deduplicated, commonData);

  // Atualiza contagem final por origem após deduplicação
  for (const st of origensStatus) {
    st.totalDocumentos = enriched.filter(d => d.origemSistema === st.origem).length;
  }

  return {
    documentos: enriched,
    origensStatus
  };
}

/**
 * Filtra e ordena os documentos do catálogo conforme critérios da interface.
 */
function normDocFilterStr(val: unknown): string {
  return String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function filterAndSortDocumentos(
  docs: DocumentoCatalogoItem[],
  filters: DocumentoFilterOptions
): DocumentoCatalogoItem[] {
  const busca = normDocFilterStr(filters.busca);
  const origem = filters.origem || 'Todas';
  const tipoCodigo = filters.tipoCodigo || 'Todos';
  const dataInicio = filters.dataInicio || '';
  const dataFim = filters.dataFim || '';
  const analista = normDocFilterStr(filters.analista);
  const titulo = normDocFilterStr(filters.titulo);
  const numero = normDocFilterStr(filters.numero);
  const responsavelTecnico = normDocFilterStr(filters.responsavelTecnico);
  const empreendedor = normDocFilterStr(filters.empreendedor);
  const processo = normDocFilterStr(filters.processo);
  const barragem = normDocFilterStr(filters.barragem);
  const carMt = normDocFilterStr(filters.carMt);
  const situacao = filters.situacao || 'Todas';
  const suportaDownload = filters.suportaDownload || 'Todos';
  const sincInicio = filters.sincInicio || '';
  const sincFim = filters.sincFim || '';
  const ordenarPor = filters.ordenarPor || 'data';
  const direcao = filters.direcao || 'desc';

  const filtered = docs.filter(doc => {
    if (origem !== 'Todas' && doc.origemSistema !== origem) {
      return false;
    }

    if (tipoCodigo !== 'Todos' && doc.tipoCodigo !== tipoCodigo) {
      return false;
    }

    if (situacao !== 'Todas' && doc.situacao !== situacao) {
      return false;
    }

    if (suportaDownload === 'sim' && doc.suportaDownload === false) {
      return false;
    }
    if (suportaDownload === 'nao' && doc.suportaDownload !== false) {
      return false;
    }

    if (dataInicio && (!doc.dataEmissao || doc.dataEmissao.slice(0, 10) < dataInicio)) {
      return false;
    }

    if (dataFim && (!doc.dataEmissao || doc.dataEmissao.slice(0, 10) > dataFim)) {
      return false;
    }

    const sincDate = String(doc.sincronizadoEm || '').slice(0, 10);
    if (sincInicio && (!sincDate || sincDate < sincInicio)) {
      return false;
    }

    if (sincFim && (!sincDate || sincDate > sincFim)) {
      return false;
    }

    if (analista) {
      const hasAnalista =
        doc.analistasElaboradores.some(a => normDocFilterStr(a).includes(analista)) ||
        normDocFilterStr(doc.responsavelTecnicoNome).includes(analista);
      if (!hasAnalista) return false;
    }

    if (titulo && !normDocFilterStr(doc.titulo).includes(titulo)) {
      return false;
    }

    if (numero && !normDocFilterStr(doc.numero).includes(numero)) {
      return false;
    }

    if (responsavelTecnico && !normDocFilterStr(doc.responsavelTecnicoNome).includes(responsavelTecnico)) {
      return false;
    }

    if (empreendedor) {
      const empText = normDocFilterStr(`${doc.empreendedorNome || ''} ${doc.empreendedorCpfCnpj || ''}`);
      const qDigits = empreendedor.replace(/\D/g, '');
      const docDigits = String(doc.empreendedorCpfCnpj || '').replace(/\D/g, '');
      if (!empText.includes(empreendedor) && !(qDigits.length >= 2 && docDigits.includes(qDigits))) {
        return false;
      }
    }

    if (processo && !normDocFilterStr(doc.processo).includes(processo)) {
      return false;
    }

    if (barragem && !normDocFilterStr(doc.barragemNome).includes(barragem)) {
      return false;
    }

    if (carMt && !normDocFilterStr(doc.carMt).includes(carMt)) {
      return false;
    }

    if (busca) {
      const searchable = normDocFilterStr(
        [
          doc.titulo,
          doc.numero,
          doc.empreendedorNome,
          doc.empreendedorCpfCnpj,
          doc.processo,
          doc.carMt,
          doc.barragemNome,
          doc.tipoNome,
          doc.responsavelTecnicoNome,
          ...doc.analistasElaboradores
        ]
          .filter(Boolean)
          .join(' ')
      );

      if (!searchable.includes(busca)) {
        return false;
      }
    }

    return true;
  });

  const factor = direcao === 'asc' ? 1 : -1;

  return filtered.slice().sort((a, b) => {
    let cmp = 0;
    switch (ordenarPor) {
      case 'titulo':
        cmp = String(a.titulo || '').localeCompare(String(b.titulo || ''), 'pt-BR', {
          sensitivity: 'base'
        });
        break;
      case 'origem':
        cmp = String(a.origemSistema || '').localeCompare(String(b.origemSistema || ''), 'pt-BR', {
          sensitivity: 'base'
        });
        break;
      case 'empreendedor':
        cmp = String(a.empreendedorNome || '').localeCompare(
          String(b.empreendedorNome || ''),
          'pt-BR',
          { sensitivity: 'base' }
        );
        break;
      case 'data':
      default:
        cmp = String(a.dataEmissao || '').localeCompare(String(b.dataEmissao || ''));
        break;
    }
    return cmp * factor;
  });
}

/**
 * Solicita abertura segura do documento original no sistema de origem.
 */
export async function abrirDocumentoOriginal(
  doc: DocumentoCatalogoItem,
  adapters: Record<DocumentoOrigem, DocumentoOriginAdapter> = defaultOriginAdapters
): Promise<DocumentoAcessoResult> {
  if (doc.situacao === 'Indisponível na origem') {
    return {
      sucesso: false,
      indisponivelNaOrigem: true,
      mensagemErro: `O documento "${doc.titulo}" encontra-se indisponível no sistema ${doc.origemSistema}.`
    };
  }

  const adapter = adapters[doc.origemSistema];
  if (!adapter) {
    return {
      sucesso: false,
      indisponivelNaOrigem: true,
      mensagemErro: `Adaptador não encontrado para a origem ${doc.origemSistema}.`
    };
  }

  return adapter.abrirOriginal(doc);
}

/**
 * Solicita download seguro do documento original no sistema de origem.
 */
export async function baixarDocumentoOriginal(
  doc: DocumentoCatalogoItem,
  adapters: Record<DocumentoOrigem, DocumentoOriginAdapter> = defaultOriginAdapters
): Promise<DocumentoAcessoResult> {
  if (doc.situacao === 'Indisponível na origem') {
    return {
      sucesso: false,
      indisponivelNaOrigem: true,
      mensagemErro: `O documento "${doc.titulo}" encontra-se indisponível no sistema ${doc.origemSistema}.`
    };
  }

  const adapter = adapters[doc.origemSistema];
  if (!adapter) {
    return {
      sucesso: false,
      indisponivelNaOrigem: true,
      mensagemErro: `Adaptador não encontrado para a origem ${doc.origemSistema}.`
    };
  }

  return adapter.baixarOriginal(doc);
}

export interface BarragemDocumentoEmitidoItem {
  id: string;
  tipo: string;
  titulo: string;
  numero?: string;
  dataEmissao?: string;
  origemSistema: string;
  situacao?: string;
  processo?: string;
  analistas?: string[];
  resumo?: string;
}

function normDocMatchStr(val: unknown): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normCarKeySimple(val: unknown): string {
  return String(val || '')
    .toUpperCase()
    .replace(/^(?:CAR\s*[–—:\-]*\s*)/i, '')
    .replace(/[^A-Z0-9/]/g, '')
    .replace(/^MT(?=\d)/, '');
}

export async function carregarDocumentosEmitidosPorBarragens(
  barragens: any[] = [],
  options?: {
    portarias?: any[];
  }
): Promise<Record<string, BarragemDocumentoEmitidoItem[]>> {
  const result: Record<string, BarragemDocumentoEmitidoItem[]> = {};
  if (!Array.isArray(barragens) || barragens.length === 0) return result;

  const damEntries = barragens
    .filter(Boolean)
    .map((b, idx) => {
      const key = String(b.id || `barr_${idx}`);
      result[key] = [];
      return {
        key,
        dam: b,
        idStr: String(b.id || '').trim(),
        nomeNorm: normDocMatchStr(b.nome || b.nomeBarragem),
        carNorm: normCarKeySimple(b.car),
        procNorm: normDocMatchStr(b.processo || b.processNumber),
        snisbNorm: normDocMatchStr(b.snisb || b.codigo)
      };
    });

  const addDocToDam = (damKey: string, doc: BarragemDocumentoEmitidoItem) => {
    const list = result[damKey];
    if (!list) return;
    const dedupKey = `${normDocMatchStr(doc.tipo)}|${normDocMatchStr(doc.numero)}|${normDocMatchStr(doc.titulo)}|${String(doc.dataEmissao || '').slice(0, 10)}`;
    const already = list.some(
      existing =>
        `${normDocMatchStr(existing.tipo)}|${normDocMatchStr(existing.numero)}|${normDocMatchStr(existing.titulo)}|${String(existing.dataEmissao || '').slice(0, 10)}` ===
        dedupKey
    );
    if (!already) {
      list.push(doc);
    }
  };

  // 1. Documentos registrados diretamente nos objetos das barragens e portarias vinculadas por processo
  const portarias = Array.isArray(options?.portarias) ? options.portarias : [];
  for (const entry of damEntries) {
    const { key, dam, procNorm } = entry;

    if (Array.isArray(dam.documentos)) {
      dam.documentos.forEach((d: any, docIdx: number) => {
        if (!d) return;
        addDocToDam(key, {
          id: String(d.id || `doc_${key}_${docIdx}`),
          tipo: d.tipo || d.tipoNome || 'Documento',
          titulo: d.titulo || d.tipoNome || d.tipo || 'Documento emitido',
          numero: d.numero || undefined,
          dataEmissao: String(d.data || d.dataEmissao || '').slice(0, 10) || undefined,
          origemSistema: d.origemSistema || d.origem || 'Administra',
          situacao: d.situacao || 'Emitido',
          processo: d.processo || dam.processo || undefined,
          analistas: Array.isArray(d.analistas) ? d.analistas : d.analista ? [String(d.analista)] : undefined,
          resumo: d.resumo || d.objetivo || undefined
        });
      });
    }

    if (dam.parecerClassificacao || dam.parecer) {
      const num = dam.parecerNumero || (typeof dam.parecer === 'string' && dam.parecer.length <= 40 ? dam.parecer : undefined);
      addDocToDam(key, {
        id: `parecer_${key}`,
        tipo: 'Parecer de Classificação',
        titulo: 'Parecer de Classificação (CRI / DPA)',
        numero: num,
        dataEmissao: String(dam.dataParecer || '').slice(0, 10) || undefined,
        origemSistema: 'Classifica',
        situacao: 'Emitido',
        processo: dam.processo || undefined
      });
    }

    if (dam.notificacao || dam.notificacaoNumero) {
      const num = dam.notificacaoNumero || (typeof dam.notificacao === 'string' && dam.notificacao.length <= 40 ? dam.notificacao : undefined);
      addDocToDam(key, {
        id: `notif_${key}`,
        tipo: 'Notificação',
        titulo: 'Notificação Emitida',
        numero: num,
        dataEmissao: String(dam.dataNotificacao || '').slice(0, 10) || undefined,
        origemSistema: 'Notifica',
        situacao: 'Emitido',
        processo: dam.processo || undefined
      });
    }

    if (dam.oficio || dam.oficioNumero) {
      const num = dam.oficioNumero || (typeof dam.oficio === 'string' && dam.oficio.length <= 40 ? dam.oficio : undefined);
      addDocToDam(key, {
        id: `oficio_${key}`,
        tipo: 'Ofício',
        titulo: 'Ofício Emitido',
        numero: num,
        dataEmissao: String(dam.dataOficio || '').slice(0, 10) || undefined,
        origemSistema: 'Fiscaliza',
        situacao: 'Emitido',
        processo: dam.processo || undefined
      });
    }

    if (procNorm) {
      for (const p of portarias) {
        if (!p) continue;
        if (normDocMatchStr(p.processNumber) === procNorm) {
          addDocToDam(key, {
            id: `portaria_${p.id || key}`,
            tipo: 'Portaria',
            titulo: p.draft ? 'Minuta de Portaria' : 'Portaria Emitida',
            numero: p.orderNumber || undefined,
            dataEmissao: String(p.finalDate || p.sentDate || '').slice(0, 10) || undefined,
            origemSistema: 'Administra',
            situacao: p.orderPublished
              ? 'Publicada'
              : p.extractPublished
              ? 'Extrato publicado'
              : p.secretarySigned
              ? 'Assinada'
              : p.draft
              ? 'Minuta'
              : 'Em tramitação',
            processo: p.processNumber || undefined,
            resumo: p.notes || undefined
          });
        }
      }
    }
  }

  // 2. Consultas leves ao Supabase para buscar pareceres, notificações, ofícios e portarias reais
  if (isSupabaseConfigured() && supabase) {
    const [catRes, vincRes, fiscRes, transfRes] = await Promise.allSettled([
      supabase
        .from('documentos_catalogo')
        .select('id,origem_sistema,tipo_codigo,tipo_nome,titulo,numero,data_emissao,criado_em,analistas_elaboradores,processo,barragem_id,barragem_nome,car_mt,situacao')
        .order('data_emissao', { ascending: false })
        .limit(500),
      supabase
        .from('documento_vinculos')
        .select('documento_id,barragem_id,car_norm,processo,conciliacao_status')
        .neq('conciliacao_status', 'rejeitado')
        .limit(1000),
      supabase
        .from('fiscaliza_notificacoes_importadas')
        .select('id,processo,municipio,status,tipo_documento,payload,situacao,data,analista,oficio_gerado,barragens,origem_sistema,created_at')
        .limit(500),
      supabase
        .from('historico_transferencias_titularidade')
        .select('id,barragem_id,snisb,processo,data_protocolo,portaria_anterior,data_portaria_anterior,parecer_tecnico_anterior,portaria_nova,data_portaria_nova,parecer_tecnico_novo,data_parecer_tecnico_novo,status_origem')
        .limit(300)
    ]);

    const vincsByDocId = new Map<string, Array<{ barragem_id?: string; car_norm?: string; processo?: string }>>();
    if (vincRes.status === 'fulfilled' && !vincRes.value.error && Array.isArray(vincRes.value.data)) {
      for (const v of vincRes.value.data) {
        const docId = String(v.documento_id || '');
        if (!docId) continue;
        if (!vincsByDocId.has(docId)) vincsByDocId.set(docId, []);
        vincsByDocId.get(docId)!.push(v);
      }
    }

    if (catRes.status === 'fulfilled' && !catRes.value.error && Array.isArray(catRes.value.data)) {
      for (const row of catRes.value.data) {
        const rBarrId = String(row.barragem_id || '').trim();
        const rCar = normCarKeySimple(row.car_mt);
        const rProc = normDocMatchStr(row.processo);
        const rNome = normDocMatchStr(row.barragem_nome);
        const rowVinc = vincsByDocId.get(String(row.id)) || [];

        for (const entry of damEntries) {
          const matchedViaVinc = rowVinc.some(
            v =>
              (v.barragem_id && String(v.barragem_id).trim() === entry.idStr) ||
              (v.car_norm && entry.carNorm && normCarKeySimple(v.car_norm) === entry.carNorm) ||
              (v.processo && entry.procNorm && normDocMatchStr(v.processo) === entry.procNorm)
          );
          const matched =
            matchedViaVinc ||
            (rBarrId && entry.idStr && rBarrId === entry.idStr) ||
            (rCar && entry.carNorm && rCar === entry.carNorm) ||
            (rProc && entry.procNorm && rProc === entry.procNorm) ||
            (rNome && entry.nomeNorm && rNome === entry.nomeNorm);

          if (matched) {
            addDocToDam(entry.key, {
              id: `cat_${row.id}`,
              tipo: String(row.tipo_nome || row.tipo_codigo || 'Documento'),
              titulo: String(row.titulo || row.tipo_nome || 'Documento emitido'),
              numero: row.numero ? String(row.numero) : undefined,
              dataEmissao: String(row.data_emissao || row.criado_em || '').slice(0, 10) || undefined,
              origemSistema: String(row.origem_sistema || 'Administra'),
              situacao: String(row.situacao || 'Emitido'),
              processo: row.processo ? String(row.processo) : undefined,
              analistas: Array.isArray(row.analistas_elaboradores)
                ? row.analistas_elaboradores
                : row.analistas_elaboradores
                ? [String(row.analistas_elaboradores)]
                : undefined
            });
          }
        }
      }
    }

    if (fiscRes.status === 'fulfilled' && !fiscRes.value.error && Array.isArray(fiscRes.value.data)) {
      for (const row of fiscRes.value.data) {
        const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
        const rProc = normDocMatchStr(row.processo || payload.numProcesso);
        const rCar = normCarKeySimple(payload.carMt);
        const rBarragensArr = [
          ...(Array.isArray(row.barragens) ? row.barragens : []),
          ...(Array.isArray(payload.barragens) ? payload.barragens : [])
        ];
        const rBarrRefs = rBarragensArr.flatMap((item: any) => {
          if (typeof item === 'string') return [normDocMatchStr(item)];
          const rawId = String(item?.id || item?.barragemId || '').trim();
          const rawNome = String(item?.nome || '').trim();
          return [
            rawId ? normDocMatchStr(rawId) : '',
            rawId ? normDocMatchStr(`FISCALIZA:BARRAGEM:${rawId}`) : '',
            rawNome ? normDocMatchStr(rawNome) : ''
          ].filter(Boolean);
        });

        for (const entry of damEntries) {
          const matched =
            entry.idStr === `FISCALIZA:REFERENCIA:${row.id}` ||
            (rProc && entry.procNorm && rProc === entry.procNorm) ||
            (rCar && entry.carNorm && rCar === entry.carNorm) ||
            (entry.idStr && rBarrRefs.includes(normDocMatchStr(entry.idStr))) ||
            (entry.nomeNorm && rBarrRefs.includes(entry.nomeNorm));

          if (!matched) continue;

          const dataDoc = String(payload.dataNotificacao || row.data || row.created_at || '').slice(0, 10) || undefined;
          const notifNum = payload.notificacaoGerada ? String(payload.notificacaoGerada) : undefined;
          const oficioNum = String(row.oficio_gerado || payload.oficioGerado || '').trim() || undefined;
          const analistaList = row.analista
            ? [String(row.analista)]
            : payload.analista
            ? [String(payload.analista)]
            : undefined;

          addDocToDam(entry.key, {
            id: `fisc_doc_${row.id}`,
            tipo: String(row.tipo_documento || payload.tipo_documento || 'Notificação'),
            titulo: String(payload.objetivo || row.tipo_documento || 'Notificação emitida'),
            numero: notifNum,
            dataEmissao: dataDoc,
            origemSistema: String(row.origem_sistema || 'Fiscaliza'),
            situacao: String(row.situacao || row.status || 'Emitido'),
            processo: row.processo ? String(row.processo) : undefined,
            analistas: analistaList,
            resumo: payload.prazoVencimento ? `Prazo: ${payload.prazoVencimento} dias` : undefined
          });

          if (oficioNum) {
            addDocToDam(entry.key, {
              id: `fisc_oficio_${row.id}`,
              tipo: 'Ofício',
              titulo: 'Ofício vinculado à notificação',
              numero: oficioNum,
              dataEmissao: dataDoc,
              origemSistema: String(row.origem_sistema || 'Fiscaliza'),
              situacao: String(row.situacao || row.status || 'Emitido'),
              processo: row.processo ? String(row.processo) : undefined,
              analistas: analistaList
            });
          }
        }
      }
    }

    if (transfRes.status === 'fulfilled' && !transfRes.value.error && Array.isArray(transfRes.value.data)) {
      for (const row of transfRes.value.data) {
        const rBarrId = String(row.barragem_id || '').trim();
        const rSnisb = normDocMatchStr(row.snisb);
        const rProc = normDocMatchStr(row.processo);

        for (const entry of damEntries) {
          const matched =
            (rBarrId && entry.idStr && rBarrId === entry.idStr) ||
            (rSnisb && entry.snisbNorm && rSnisb === entry.snisbNorm) ||
            (rProc && entry.procNorm && rProc === entry.procNorm);

          if (!matched) continue;

          if (row.parecer_tecnico_novo) {
            addDocToDam(entry.key, {
              id: `transf_parecer_novo_${row.id}`,
              tipo: 'Parecer Técnico',
              titulo: 'Parecer Técnico (Transferência de Titularidade)',
              numero: String(row.parecer_tecnico_novo),
              dataEmissao: String(row.data_parecer_tecnico_novo || row.data_protocolo || '').slice(0, 10) || undefined,
              origemSistema: 'Administra',
              situacao: row.status_origem ? String(row.status_origem) : 'Emitido',
              processo: row.processo ? String(row.processo) : undefined
            });
          }
          if (row.portaria_nova) {
            addDocToDam(entry.key, {
              id: `transf_portaria_nova_${row.id}`,
              tipo: 'Portaria',
              titulo: 'Portaria (Transferência de Titularidade)',
              numero: String(row.portaria_nova),
              dataEmissao: String(row.data_portaria_nova || row.data_protocolo || '').slice(0, 10) || undefined,
              origemSistema: 'Administra',
              situacao: row.status_origem ? String(row.status_origem) : 'Emitido',
              processo: row.processo ? String(row.processo) : undefined
            });
          }
          if (row.parecer_tecnico_anterior) {
            addDocToDam(entry.key, {
              id: `transf_parecer_ant_${row.id}`,
              tipo: 'Parecer Técnico',
              titulo: 'Parecer Técnico Anterior',
              numero: String(row.parecer_tecnico_anterior),
              dataEmissao: String(row.data_portaria_anterior || '').slice(0, 10) || undefined,
              origemSistema: 'Administra',
              situacao: 'Histórico',
              processo: row.processo ? String(row.processo) : undefined
            });
          }
          if (row.portaria_anterior) {
            addDocToDam(entry.key, {
              id: `transf_portaria_ant_${row.id}`,
              tipo: 'Portaria',
              titulo: 'Portaria Anterior',
              numero: String(row.portaria_anterior),
              dataEmissao: String(row.data_portaria_anterior || '').slice(0, 10) || undefined,
              origemSistema: 'Administra',
              situacao: 'Histórico',
              processo: row.processo ? String(row.processo) : undefined
            });
          }
        }
      }
    }
  }

  // Ordena documentos de cada barragem do mais recente para o mais antigo
  for (const key of Object.keys(result)) {
    result[key].sort((a, b) => String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));
  }

  return result;
}

