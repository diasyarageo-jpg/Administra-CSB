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
export function filterAndSortDocumentos(
  docs: DocumentoCatalogoItem[],
  filters: DocumentoFilterOptions
): DocumentoCatalogoItem[] {
  const busca = (filters.busca || '').trim().toLowerCase();
  const origem = filters.origem || 'Todas';
  const tipoCodigo = filters.tipoCodigo || 'Todos';
  const dataInicio = filters.dataInicio || '';
  const dataFim = filters.dataFim || '';
  const analista = (filters.analista || '').trim().toLowerCase();
  const ordenarPor = filters.ordenarPor || 'data';
  const direcao = filters.direcao || 'desc';

  const filtered = docs.filter(doc => {
    if (origem !== 'Todas' && doc.origemSistema !== origem) {
      return false;
    }

    if (tipoCodigo !== 'Todos' && doc.tipoCodigo !== tipoCodigo) {
      return false;
    }

    if (dataInicio && doc.dataEmissao && doc.dataEmissao < dataInicio) {
      return false;
    }

    if (dataFim && doc.dataEmissao && doc.dataEmissao > dataFim) {
      return false;
    }

    if (analista) {
      const hasAnalista =
        doc.analistasElaboradores.some(a => a.toLowerCase().includes(analista)) ||
        (doc.responsavelTecnicoNome || '').toLowerCase().includes(analista);
      if (!hasAnalista) return false;
    }

    if (busca) {
      const searchable = [
        doc.titulo,
        doc.numero,
        doc.empreendedorNome,
        doc.empreendedorCpfCnpj,
        doc.processo,
        doc.carMt,
        doc.barragemNome,
        doc.tipoNome
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

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
