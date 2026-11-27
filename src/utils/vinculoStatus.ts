// src/utils/vinculoStatus.ts
// Utilitário canônico de status de vínculo, coordenadas e busca paginada de barragens.
// Regra de integridade: NUNCA inferir vínculo oficial apenas por nome ou CAR compartilhado.

import { parseCoordAdvanced } from '../services/coordService';

export type VinculoStatusCode = 'oficial' | 'pendente_revisao' | 'nao_vinculado';

export interface VinculoStatusInfo {
  code: VinculoStatusCode;
  label: string;
  shortLabel: string;
  badgeClass: 'green' | 'amber' | 'gray';
  reason: string;
  officialEmpreendedorId?: string;
  officialEmpreendedorNome?: string;
  isLinkedToSelectedEmpreendedor?: boolean;
}

export interface CoordinateStatusInfo {
  available: boolean;
  lat: number | null;
  lon: number | null;
  label: string;
  badgeClass: 'green' | 'gray';
}

export interface BarragemSearchEntry {
  raw: any;
  id: string;
  nome: string;
  snisb: string;
  car: string;
  municipio: string;
  processo: string;
  situacao: string;
  empreendimentoNome: string;
  vinculo: VinculoStatusInfo;
  coordenadas: CoordinateStatusInfo;
  priorityTier: number;
}

export function normVinculoText(val: unknown): string {
  return String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normCarCompare(val: unknown): string {
  return String(val ?? '')
    .toUpperCase()
    .replace(/^(?:CAR\s*[–—:\-]*\s*)/i, '')
    .replace(/[^A-Z0-9/]/g, '')
    .replace(/^MT(?=\d)/, '');
}

export function maskCpfCnpjSafe(val: unknown): string {
  const digits = String(val ?? '').replace(/\D/g, '');
  if (!digits) return '—';
  if (digits.length === 11) {
    return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  }
  if (digits.length === 14) {
    return `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`;
  }
  return 'Documento restrito';
}

export function evaluateDamCoordinates(dam: any): CoordinateStatusInfo {
  if (!dam) {
    return {
      available: false,
      lat: null,
      lon: null,
      label: 'Coordenadas indisponíveis',
      badgeClass: 'gray'
    };
  }

  const latParsed = parseCoordAdvanced(dam.latitude, false);
  const lonParsed = parseCoordAdvanced(dam.longitude, true);
  const lat = latParsed.valido ? latParsed.decimal : null;
  const lon = lonParsed.valido ? lonParsed.decimal : null;

  const inMtBounds =
    lat !== null &&
    lon !== null &&
    lat >= -20 &&
    lat <= -6 &&
    lon >= -64 &&
    lon <= -49;

  if (inMtBounds) {
    return {
      available: true,
      lat,
      lon,
      label: 'Coordenadas válidas',
      badgeClass: 'green'
    };
  }

  return {
    available: false,
    lat: null,
    lon: null,
    label: 'Coordenadas indisponíveis',
    badgeClass: 'gray'
  };
}

/**
 * Avalia o estado canônico de vínculo de uma barragem sem inferir vínculo oficial por nome ou CAR.
 * Somente IDs estáveis (`empreendedorId`, `empreendedor_id` ou `empreendedor` igual a `empreendedor.id`)
 * caracterizam `oficial`.
 */
export function evaluateBarragemVinculoStatus(
  dam: any,
  empreendedores: any[] = [],
  selectedEmpreendedorId?: string
): VinculoStatusInfo {
  const safeEmps = Array.isArray(empreendedores) ? empreendedores : [];
  const empById = new Map<string, any>();
  for (const emp of safeEmps) {
    if (emp?.id !== undefined && emp?.id !== null && String(emp.id).trim() !== '') {
      empById.set(String(emp.id).trim(), emp);
    }
  }

  const explicitEmpId = String(dam?.empreendedorId || dam?.empreendedor_id || '').trim();
  const legacyEmpField = String(dam?.empreendedor || '').trim();
  const matchedByExplicitId = explicitEmpId ? empById.get(explicitEmpId) : undefined;
  const matchedByLegacyId = !explicitEmpId && legacyEmpField ? empById.get(legacyEmpField) : undefined;
  const confirmedEmp = matchedByExplicitId || matchedByLegacyId;

  const selectedId = String(selectedEmpreendedorId || '').trim();

  if (confirmedEmp) {
    const confirmedId = String(confirmedEmp.id).trim();
    const confirmedNome = String(confirmedEmp.nome || confirmedEmp.nomeFantasia || confirmedId).trim();
    const requiresReviewFlag = Boolean(dam?.requiresReview || dam?.vinculoPendenteRevisao);

    if (requiresReviewFlag) {
      return {
        code: 'pendente_revisao',
        label: 'Vínculo pendente de revisão',
        shortLabel: 'Pendente de revisão',
        badgeClass: 'amber',
        reason: String(dam?.reviewReason || 'Registro marcado para conferência analítica.'),
        officialEmpreendedorId: confirmedId,
        officialEmpreendedorNome: confirmedNome,
        isLinkedToSelectedEmpreendedor: Boolean(selectedId && selectedId === confirmedId)
      };
    }

    return {
      code: 'oficial',
      label: 'Vínculo oficial confirmado no Administra',
      shortLabel: 'Vínculo oficial',
      badgeClass: 'green',
      reason: 'Vínculo confirmado por identificador estável no cadastro central.',
      officialEmpreendedorId: confirmedId,
      officialEmpreendedorNome: confirmedNome,
      isLinkedToSelectedEmpreendedor: Boolean(selectedId && selectedId === confirmedId)
    };
  }

  // Se há texto legado de empreendedor, ID sem correspondência ou CAR/empreendimento sem ID estável
  const hasUnconfirmedRef = Boolean(
    explicitEmpId ||
      legacyEmpField ||
      String(dam?.entrepreneurName || '').trim() ||
      String(dam?.empreendimento || '').trim() ||
      String(dam?.car || '').trim()
  );

  if (hasUnconfirmedRef) {
    return {
      code: 'pendente_revisao',
      label: 'Vínculo pendente de revisão',
      shortLabel: 'Pendente de revisão',
      badgeClass: 'amber',
      reason: legacyEmpField || explicitEmpId
        ? 'Referência sem correspondência confirmada por ID estável no cadastro de empreendedores.'
        : 'Barragem possui CAR ou empreendimento informado, mas sem titularidade oficial confirmada.',
      officialEmpreendedorNome: String(dam?.entrepreneurName || legacyEmpField || '').trim() || undefined,
      isLinkedToSelectedEmpreendedor: false
    };
  }

  return {
    code: 'nao_vinculado',
    label: 'Entidade ainda não vinculada',
    shortLabel: 'Não vinculada',
    badgeClass: 'gray',
    reason: 'Nenhum empreendedor vinculado ou referenciado neste cadastro.',
    isLinkedToSelectedEmpreendedor: false
  };
}

/**
 * Avalia vínculo entre um documento de catálogo e as entidades oficiais do Administra.
 * NUNCA promove correlação por nome ou CAR ao estado `oficial`.
 */
export function evaluateDocumentoVinculoStatus(
  doc: {
    barragemId?: string;
    empreendedorId?: string;
    empreendimentoId?: string;
    processo?: string;
    carMt?: string;
    barragemNome?: string;
    empreendedorNome?: string;
    vinculoStatus?: VinculoStatusCode;
    vinculoObservacao?: string;
  },
  barragens: any[] = [],
  empreendedores: any[] = []
): VinculoStatusInfo {
  const safeDams = Array.isArray(barragens) ? barragens : [];
  const safeEmps = Array.isArray(empreendedores) ? empreendedores : [];

  const bId = String(doc?.barragemId || '').trim();
  const eId = String(doc?.empreendedorId || '').trim();

  const damMatch = bId ? safeDams.find(b => String(b?.id || '').trim() === bId) : undefined;
  const empMatch = eId ? safeEmps.find(e => String(e?.id || '').trim() === eId) : undefined;

  if (doc?.vinculoStatus === 'pendente_revisao') {
    return {
      code: 'pendente_revisao',
      label: 'Vínculo pendente de revisão',
      shortLabel: 'Pendente de revisão',
      badgeClass: 'amber',
      reason: doc.vinculoObservacao || 'Correspondência candidata aguardando confirmação por ID estável.'
    };
  }

  if (damMatch || empMatch) {
    return {
      code: 'oficial',
      label: 'Vínculo oficial confirmado no Administra',
      shortLabel: 'Vínculo oficial',
      badgeClass: 'green',
      reason: damMatch && empMatch
        ? 'Barragem e empreendedor vinculados por identificador estável.'
        : damMatch
          ? 'Barragem vinculada por identificador estável.'
          : 'Empreendedor vinculado por identificador estável.',
      officialEmpreendedorId: empMatch ? String(empMatch.id) : undefined,
      officialEmpreendedorNome: empMatch ? String(empMatch.nome || empMatch.id) : undefined
    };
  }

  const hasCandidateHints = Boolean(
    bId ||
      eId ||
      String(doc?.carMt || '').trim() ||
      String(doc?.barragemNome || '').trim() ||
      String(doc?.empreendedorNome || '').trim() ||
      String(doc?.processo || '').trim()
  );

  if (hasCandidateHints) {
    return {
      code: 'pendente_revisao',
      label: 'Vínculo pendente de revisão',
      shortLabel: 'Pendente de revisão',
      badgeClass: 'amber',
      reason: 'Documento possui apenas referência textual (nome, CAR ou processo) sem vínculo oficial por ID.'
    };
  }

  return {
    code: 'nao_vinculado',
    label: 'Entidade ainda não vinculada',
    shortLabel: 'Não vinculada',
    badgeClass: 'gray',
    reason: 'Documento sem referência de barragem ou empreendedor vinculada.'
  };
}

export interface SearchBarragensOptions {
  query?: string;
  prioritizeEmpreendedorId?: string;
  page?: number;
  pageSize?: number;
}

export interface SearchBarragensResult {
  items: BarragemSearchEntry[];
  allMatchedCount: number;
  linkedToSelectedCount: number;
  unlinkedOrReviewCount: number;
  totalPages: number;
  safePage: number;
}

/**
 * Busca, ordena e pagina barragens por nome, SNISB, CAR, município ou identificador.
 * Quando `prioritizeEmpreendedorId` é informado, prioriza barragens oficialmente
 * vinculadas ao empreendedor sem ocultar estruturas sem vínculo (marcadas como pendente/não vinculada).
 */
export function searchAndPrioritizeBarragens(
  barragens: any[] = [],
  empreendedores: any[] = [],
  options: SearchBarragensOptions = {}
): SearchBarragensResult {
  const safeDams = Array.isArray(barragens) ? barragens : [];
  const safeEmps = Array.isArray(empreendedores) ? empreendedores : [];
  const selectedEmpId = String(options.prioritizeEmpreendedorId || '').trim();
  const queryNorm = normVinculoText(options.query);
  const queryCarNorm = normCarCompare(options.query);

  const entries: BarragemSearchEntry[] = [];

  for (const dam of safeDams) {
    if (!dam) continue;
    const id = String(dam.id || '').trim();
    if (!id) continue;

    const nome = String(dam.nome || dam.name || dam.nomeBarragem || id).trim();
    const snisb = String(dam.snisb || dam.codeSnisb || dam.codigo || '').trim();
    const car = String(dam.car || '').trim();
    const municipio = String(dam.municipio || dam.municipality || '').trim();
    const processo = String(dam.processo || dam.processNumber || '').trim();
    const situacao = String(dam.situacao || 'Ativa').trim();
    const empreendimentoNome = String(dam.empreendimento || '').trim();

    const vinculo = evaluateBarragemVinculoStatus(dam, safeEmps, selectedEmpId);
    const coordenadas = evaluateDamCoordinates(dam);

    if (queryNorm) {
      const hay = normVinculoText(
        [id, nome, snisb, car, municipio, processo, vinculo.officialEmpreendedorNome, empreendimentoNome]
          .filter(Boolean)
          .join(' ')
      );
      const carMatch = queryCarNorm.length >= 3 && normCarCompare(car).includes(queryCarNorm);
      if (!hay.includes(queryNorm) && !carMatch) {
        continue;
      }
    }

    let priorityTier = 1;
    if (selectedEmpId) {
      if (vinculo.isLinkedToSelectedEmpreendedor && vinculo.code === 'oficial') {
        priorityTier = 0; // Oficialmente vinculada ao empreendedor escolhido
      } else if (vinculo.code === 'pendente_revisao' || vinculo.code === 'nao_vinculado') {
        priorityTier = 1; // Sem vínculo oficial — permanece visível logo abaixo para seleção/revisão
      } else {
        priorityTier = 2; // Oficialmente vinculada a outro empreendedor
      }
    } else {
      priorityTier = vinculo.code === 'oficial' ? 0 : vinculo.code === 'pendente_revisao' ? 1 : 2;
    }

    entries.push({
      raw: dam,
      id,
      nome,
      snisb,
      car,
      municipio,
      processo,
      situacao,
      empreendimentoNome,
      vinculo,
      coordenadas,
      priorityTier
    });
  }

  entries.sort((a, b) => {
    if (a.priorityTier !== b.priorityTier) return a.priorityTier - b.priorityTier;
    return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
  });

  const pageSize = Math.max(1, Number(options.pageSize || 8));
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.min(Math.max(1, Number(options.page || 1)), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    items: entries.slice(start, start + pageSize),
    allMatchedCount: entries.length,
    linkedToSelectedCount: entries.filter(e => e.vinculo.isLinkedToSelectedEmpreendedor && e.vinculo.code === 'oficial').length,
    unlinkedOrReviewCount: entries.filter(e => e.vinculo.code !== 'oficial').length,
    totalPages,
    safePage
  };
}
