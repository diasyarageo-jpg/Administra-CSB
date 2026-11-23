// api/sema-documentos.ts
import type { IncomingMessage, ServerResponse } from 'http';
import {
  SEMA_FIELD_CANDIDATES,
  resolveConfirmedFields,
  extractConfirmedFieldValue,
  extractCarSearchTokens,
  deduplicateCarImoveisByCar,
  formatCpfCnpjReadable,
  maskCpfCnpjDisplay,
  preserveSemaProperties,
  sanitizeSemaProperties,
  stripOuterQuotesAndBrackets
} from '../src/config/carCampos.js';
import {
  authorizeSemaLookupRequest,
  canViewFullSemaPersonalData,
  parseSemaAuditTargetContext,
  recordSemaServerAuditDetailed,
  scrubSensitiveTextForServerLog,
  sha256HexServer,
  validateTargetEntityAccess
} from '../src/server/semaAudit.js';
import {
  SemaAttrFilterClause,
  SemaCoordPoint,
  describeSemaLayerXml,
  escapeCqlLiteral,
  executeSemaGetFeature,
  getSemaCapabilities,
  queryGeoportalCacheFallback
} from '../src/server/semaGeoserver.js';

interface VercelLikeRequest extends IncomingMessage {
  query?: Record<string, string | string[]>;
  body?: any;
  method?: string;
  url?: string;
}

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (data: any) => VercelLikeResponse;
}

type CamadaStatusCode =
  | 'consultada'
  | 'sem_resultados'
  | 'nao_suportado'
  | 'indisponivel'
  | 'filtro_incompativel'
  | 'erro_comunicacao';

interface CamadaStatus {
  camada: string;
  titulo?: string;
  grupo: string;
  status: CamadaStatusCode;
  suportado: boolean;
  registrosEncontrados: number;
  camposPesquisados?: string[];
  camposConfirmados?: string[];
  mensagem: string;
}

const TARGET_LAYERS = [
  { name: 'Geoportal:CAR_ATP', grupo: 'carImoveis' },
  { name: 'Geoportal:MVW_REQUERIMENTO_ATP', grupo: 'carImoveis' },
  { name: 'Geoportal:TDAD_LICENCIAMENTO_LICENCA_PREVIA', grupo: 'licencas' },
  { name: 'Geoportal:TDAD_LICENCIAMENTO_LICENCA_DE_INSTALACAO', grupo: 'licencas' },
  { name: 'Geoportal:TDAD_LICENCIAMENTO_LICENCA_DE_OPERACAO', grupo: 'licencas' },
  { name: 'Geoportal:SIMLAMGEO_LP', grupo: 'licencas' },
  { name: 'Geoportal:SIMLAMGEO_LI', grupo: 'licencas' },
  { name: 'Geoportal:SIMLAMGEO_LO', grupo: 'licencas' },
  { name: 'Geoportal:SIMLAMGEO_LOP', grupo: 'licencas' },
  { name: 'Geoportal:TDAD_FISCALIZACAO_NOTIFICACAO', grupo: 'notificacoes' },
  { name: 'Geoportal:TDAD_FISCALIZACAO_AUTO_DE_INFRACAO', grupo: 'autosInfracao' },
  { name: 'Geoportal:TDAD_FISCALIZACAO_TERMO_DE_EMBARGO', grupo: 'termosEmbargo' }
] as const;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIdx = 0;
  const runners = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (nextIdx < items.length) {
      const current = nextIdx++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

function cleanTextValue(val: any): string | undefined {
  if (val === undefined || val === null) return undefined;
  const s = String(val).trim();
  if (!s || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') {
    return undefined;
  }
  return s;
}

function sanitizeSearchInput(val: string, maxLen: number): string {
  return val
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[%_;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function normalizeForCompare(val: string): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatCpfCnpjMask(digits: string): string {
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return digits;
}

function sanitizeHttpUrl(raw: any): string | undefined {
  const s = cleanTextValue(raw);
  if (!s) return undefined;
  if (/^https?:\/\/\S+$/i.test(s)) {
    return s;
  }
  return undefined;
}

async function readJsonBody(req: VercelLikeRequest): Promise<Record<string, any>> {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body);
  }
  return await new Promise<Record<string, any>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const MAX_BYTES = 64 * 1024;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BYTES) {
        reject(new Error('Requisição excede o tamanho máximo permitido.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Dados de consulta inválidos.'));
      }
    });
    req.on('error', err => reject(err));
  });
}

interface FilterBuildResult {
  supported: boolean;
  attrCqlFilter: string;
  attrClauses: SemaAttrFilterClause[];
  spatialCqlFilter: string;
  spatialGeomField?: string;
  spatialPoints: SemaCoordPoint[];
  fieldsUsed: string[];
  confirmedDocFields: string[];
  ownerTextFields: string[];
  carFields: string[];
  procFields: string[];
  nameFields: string[];
  unsupportedReason?: string;
}

function buildSchemaFilterForLayer(
  fields: Map<string, string>,
  geomFields: Set<string>,
  grupo: string,
  criteria: {
    cleanDoc: string;
    carTokens: string[];
    procList: string[];
    coordenadas: SemaCoordPoint[];
    cleanNome: string;
    buscaExploratoria: boolean;
  }
): FilterBuildResult {
  const orAttrClauses: string[] = [];
  const attrClauses: SemaAttrFilterClause[] = [];
  const fieldsUsed: string[] = [];
  const seenFields = new Set<string>();
  const addFieldUsed = (f: string) => {
    if (f && !seenFields.has(f)) {
      seenFields.add(f);
      fieldsUsed.push(f);
    }
  };

  const confirmedDocFields = resolveConfirmedFields(fields, SEMA_FIELD_CANDIDATES.filtroDocumento);
  const ownerTextFields = resolveConfirmedFields(fields, ['NOMESPROPRIETARIOS', 'PROPRIETARIOS', 'RAZAO_SOCIAL']);
  const carFields = resolveConfirmedFields(fields, SEMA_FIELD_CANDIDATES.filtroCar);
  const procFields = resolveConfirmedFields(fields, SEMA_FIELD_CANDIDATES.filtroProcesso);
  const nameFields = resolveConfirmedFields(fields, SEMA_FIELD_CANDIDATES.filtroNome);

  if (criteria.cleanDoc) {
    if (confirmedDocFields.length > 0) {
      const formatted = formatCpfCnpjMask(criteria.cleanDoc);
      const escClean = escapeCqlLiteral(criteria.cleanDoc);
      const escFmt = escapeCqlLiteral(formatted);
      for (const field of confirmedDocFields) {
        if (escFmt !== escClean) {
          orAttrClauses.push(`(${field} = '${escClean}' OR ${field} = '${escFmt}')`);
          attrClauses.push({ type: 'eq', field, value: criteria.cleanDoc });
          attrClauses.push({ type: 'eq', field, value: formatted });
        } else {
          orAttrClauses.push(`${field} = '${escClean}'`);
          attrClauses.push({ type: 'eq', field, value: criteria.cleanDoc });
        }
        addFieldUsed(field);
      }
    }

    if (ownerTextFields.length > 0) {
      const escClean = escapeCqlLiteral(criteria.cleanDoc);
      const formatted = formatCpfCnpjMask(criteria.cleanDoc);
      const escFmt = escapeCqlLiteral(formatted);
      for (const field of ownerTextFields) {
        if (criteria.cleanDoc.length === 14) {
          orAttrClauses.push(`${field} ILIKE '%${escClean}%'`);
          attrClauses.push({ type: 'ilike', field, value: criteria.cleanDoc });
          if (escFmt !== escClean) {
            orAttrClauses.push(`${field} ILIKE '%${escFmt}%'`);
            attrClauses.push({ type: 'ilike', field, value: formatted });
          }
          addFieldUsed(field);
        } else if (criteria.cleanDoc.length === 11) {
          const mid6 = criteria.cleanDoc.slice(3, 9);
          orAttrClauses.push(`${field} ILIKE '%XXX${mid6}XX%'`);
          orAttrClauses.push(`${field} ILIKE '%${escClean}%'`);
          attrClauses.push({ type: 'ilike', field, value: `XXX${mid6}XX` });
          attrClauses.push({ type: 'ilike', field, value: criteria.cleanDoc });
          if (escFmt !== escClean) {
            orAttrClauses.push(`${field} ILIKE '%${escFmt}%'`);
            attrClauses.push({ type: 'ilike', field, value: formatted });
          }
          addFieldUsed(field);
        }
      }
    }
  }

  if (criteria.carTokens.length > 0 && carFields.length > 0) {
    for (const tok of criteria.carTokens) {
      const escTok = escapeCqlLiteral(tok);
      for (const f of carFields) {
        orAttrClauses.push(`${f} ILIKE '%${escTok}%'`);
        attrClauses.push({ type: 'ilike', field: f, value: tok });
        addFieldUsed(f);
      }
    }
  }

  if (criteria.procList.length > 0 && procFields.length > 0) {
    for (const proc of criteria.procList) {
      const escProc = escapeCqlLiteral(proc);
      for (const f of procFields) {
        orAttrClauses.push(`${f} ILIKE '%${escProc}%'`);
        attrClauses.push({ type: 'ilike', field: f, value: proc });
        addFieldUsed(f);
      }
    }
  }

  if (criteria.buscaExploratoria && criteria.cleanNome && nameFields.length > 0) {
    const escNome = escapeCqlLiteral(criteria.cleanNome);
    for (const f of nameFields) {
      orAttrClauses.push(`${f} ILIKE '%${escNome}%'`);
      attrClauses.push({ type: 'ilike', field: f, value: criteria.cleanNome });
      addFieldUsed(f);
    }
  }

  let spatialCqlFilter = '';
  let spatialGeomField: string | undefined;
  let spatialPoints: SemaCoordPoint[] = [];
  const primaryGeomField = Array.from(geomFields)[0];
  if (grupo === 'carImoveis' && primaryGeomField && criteria.coordenadas.length > 0) {
    const spatialParts = criteria.coordenadas.map(
      c => `INTERSECTS(${primaryGeomField},POINT(${c.lng} ${c.lat}))`
    );
    spatialCqlFilter = spatialParts.join(' OR ');
    spatialGeomField = primaryGeomField;
    spatialPoints = criteria.coordenadas;
    addFieldUsed(primaryGeomField);
  }

  const attrCqlFilter = orAttrClauses.join(' OR ');

  if (!attrCqlFilter && !spatialCqlFilter) {
    return {
      supported: false,
      attrCqlFilter: '',
      attrClauses: [],
      spatialCqlFilter: '',
      spatialPoints: [],
      fieldsUsed: [],
      confirmedDocFields,
      ownerTextFields,
      carFields,
      procFields,
      nameFields,
      unsupportedReason: 'Esta base não disponibiliza pesquisa direta pelos critérios informados.'
    };
  }

  return {
    supported: true,
    attrCqlFilter,
    attrClauses,
    spatialCqlFilter,
    spatialGeomField,
    spatialPoints,
    fieldsUsed,
    confirmedDocFields,
    ownerTextFields,
    carFields,
    procFields,
    nameFields
  };
}

const NAME_STOPWORDS = new Set([
  'das',
  'dos',
  'com',
  'para',
  'ltda',
  'eireli',
  'epp',
  's/a',
  'agro',
  'fazenda',
  'agropecuaria',
  'empreendimentos'
]);

function hasSignificantNameOverlap(ownerText: string, expectedName: string): boolean {
  const normOwner = normalizeForCompare(ownerText);
  const normExpected = normalizeForCompare(expectedName);
  if (!normExpected || normExpected.length < 3) return true;

  const words = normExpected
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !NAME_STOPWORDS.has(w));

  if (words.length === 0) return true;
  return words.some(w => normOwner.includes(w));
}

function evaluateFeatureMatch(
  rawProps: Record<string, any>,
  isSpatialHit: boolean,
  filterBuild: FilterBuildResult,
  criteria: {
    cleanDoc: string;
    carTokens: string[];
    procList: string[];
    cleanNome: string;
    buscaExploratoria: boolean;
  }
): { matches: boolean; confirmatory: boolean } {
  if (isSpatialHit) {
    return { matches: true, confirmatory: true };
  }

  if (criteria.cleanDoc && filterBuild.confirmedDocFields.length > 0) {
    for (const field of filterBuild.confirmedDocFields) {
      const raw = rawProps[field];
      if (raw === undefined || raw === null) continue;
      const digits = String(raw).replace(/\D/g, '');
      if (digits === criteria.cleanDoc) {
        return { matches: true, confirmatory: true };
      }
    }
  }

  if (criteria.cleanDoc && filterBuild.ownerTextFields.length > 0) {
    for (const field of filterBuild.ownerTextFields) {
      const raw = rawProps[field];
      if (raw === undefined || raw === null) continue;
      const text = String(raw);
      if (criteria.cleanDoc.length === 14) {
        const formatted = formatCpfCnpjMask(criteria.cleanDoc);
        if (text.includes(criteria.cleanDoc) || text.includes(formatted)) {
          return { matches: true, confirmatory: true };
        }
      } else if (criteria.cleanDoc.length === 11) {
        const mid6 = criteria.cleanDoc.slice(3, 9);
        const formatted = formatCpfCnpjMask(criteria.cleanDoc);
        const hasFullCpf = text.includes(criteria.cleanDoc) || text.includes(formatted);
        const hasMaskedCpf = new RegExp(`xxx${mid6}xx`, 'i').test(text);
        if (hasFullCpf) {
          return { matches: true, confirmatory: true };
        }
        if (hasMaskedCpf) {
          if (!criteria.cleanNome || hasSignificantNameOverlap(text, criteria.cleanNome)) {
            return { matches: true, confirmatory: true };
          }
        }
      }
    }
  }

  if (criteria.carTokens.length > 0 && filterBuild.carFields.length > 0) {
    for (const field of filterBuild.carFields) {
      const raw = rawProps[field];
      if (raw === undefined || raw === null) continue;
      const valNorm = String(raw).toUpperCase().replace(/[^A-Z0-9/]/g, '');
      for (const tok of criteria.carTokens) {
        const tokNorm = tok.toUpperCase().replace(/[^A-Z0-9/]/g, '');
        if (tokNorm && valNorm.includes(tokNorm)) {
          return { matches: true, confirmatory: true };
        }
      }
    }
  }

  if (criteria.procList.length > 0 && filterBuild.procFields.length > 0) {
    for (const field of filterBuild.procFields) {
      const raw = rawProps[field];
      if (raw === undefined || raw === null) continue;
      const valNorm = normalizeForCompare(String(raw));
      for (const proc of criteria.procList) {
        if (valNorm.includes(normalizeForCompare(proc))) {
          return { matches: true, confirmatory: true };
        }
      }
    }
  }

  if (criteria.buscaExploratoria && criteria.cleanNome && filterBuild.nameFields.length > 0) {
    const normQuery = normalizeForCompare(criteria.cleanNome);
    for (const field of filterBuild.nameFields) {
      const raw = rawProps[field];
      if (raw === undefined || raw === null) continue;
      if (normalizeForCompare(String(raw)).includes(normQuery)) {
        return { matches: true, confirmatory: false };
      }
    }
  }

  return { matches: false, confirmatory: false };
}

function inspectConfirmedCpfCnpjFromSchema(
  rawProps: Record<string, any>,
  schemaFields: Map<string, string>
): {
  cpfCnpjCompletoDisponivel: boolean;
  cpfCnpjCampoOrigem?: string;
  cpfCnpjStatus: 'completo' | 'mascarado' | 'ausente';
  fullDocReadable?: string;
  docDigits?: string;
} {
  const confirmedDocFields = resolveConfirmedFields(schemaFields, SEMA_FIELD_CANDIDATES.documento);
  const confirmedOwnerFields = resolveConfirmedFields(schemaFields, SEMA_FIELD_CANDIDATES.titular);
  let sawMasked = false;

  for (const field of confirmedDocFields) {
    const val = rawProps[field];
    if (val === undefined || val === null) continue;
    const str = String(val).trim();
    if (!str) continue;
    if (/[x*]/i.test(str)) {
      sawMasked = true;
      continue;
    }
    const digits = str.replace(/\D/g, '');
    if (digits.length === 11 || digits.length === 14) {
      return {
        cpfCnpjCompletoDisponivel: true,
        cpfCnpjCampoOrigem: field,
        cpfCnpjStatus: 'completo',
        fullDocReadable: formatCpfCnpjReadable(digits),
        docDigits: digits
      };
    }
  }

  for (const field of confirmedOwnerFields) {
    const val = rawProps[field];
    if (val === undefined || val === null) continue;
    const str = String(val).trim();
    if (!str) continue;
    const docMatch =
      str.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/) ||
      str.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/) ||
      str.match(/(?<![\d/.\-xX*])(\d{14}|\d{11})(?![\d/.\-xX*])/);
    if (docMatch?.[0]) {
      const digits = docMatch[0].replace(/\D/g, '');
      return {
        cpfCnpjCompletoDisponivel: true,
        cpfCnpjCampoOrigem: field,
        cpfCnpjStatus: 'completo',
        fullDocReadable: formatCpfCnpjReadable(docMatch[0]),
        docDigits: digits
      };
    }
    if (/x{2,}\d+x{2,}|\*{2,}/i.test(str)) {
      sawMasked = true;
    }
  }

  return {
    cpfCnpjCompletoDisponivel: false,
    cpfCnpjStatus: sawMasked ? 'mascarado' : 'ausente'
  };
}

function mapFeatureToDocumentItem(
  f: any,
  layerName: string,
  layerTitle: string,
  grupo: string,
  schemaFields: Map<string, string>,
  geomFields: Set<string>,
  confirmedDocFields: string[],
  correspondenciaExploratoria: boolean,
  consultadoEm: string
) {
  const rawProps = f.properties && typeof f.properties === 'object' ? f.properties : {};
  const camposConfirmadosEsquema = Array.from(schemaFields.keys()).filter(k => !geomFields.has(k));

  const confirmedIdProp = extractConfirmedFieldValue(
    rawProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.featureId
  );
  const stableId =
    f.id !== undefined && f.id !== null && String(f.id).trim() !== ''
      ? String(f.id).trim()
      : confirmedIdProp
      ? `${layerName}.${confirmedIdProp}`
      : null;

  const preservedProps = preserveSemaProperties(rawProps, confirmedDocFields);
  const docCheck = inspectConfirmedCpfCnpjFromSchema(rawProps, schemaFields);

  const rawDocVal = extractConfirmedFieldValue(
    rawProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.documento
  );

  const carEstadual = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.carEstadual
  );
  const carFederal = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.carFederal
  );
  const protocolo = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.protocolo
  );
  const nomePropriedadeRaw = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.nomePropriedade
  );
  const nomePropriedade = nomePropriedadeRaw ? stripOuterQuotesAndBrackets(nomePropriedadeRaw) : undefined;

  const titularRaw = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.titular
  );
  const titular = titularRaw ? stripOuterQuotesAndBrackets(titularRaw) : undefined;

  const cpfCnpjReadable = docCheck.fullDocReadable || formatCpfCnpjReadable(rawDocVal);

  const situacaoRaw = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.situacaoCar
  );
  const situacaoLimpa = situacaoRaw ? stripOuterQuotesAndBrackets(situacaoRaw) : undefined;
  const atividadeRaw = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.atividade
  );
  const atividadeLimpa = atividadeRaw ? stripOuterQuotesAndBrackets(atividadeRaw) : undefined;
  const munCod = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.municipioCodigo
  );
  const munNome = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.municipioNome
  );
  const areaRaw = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.areaHa
  );
  const areaNum =
    areaRaw && !isNaN(Number(areaRaw))
      ? `${Number(areaRaw).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha`
      : undefined;
  const linkDoc = sanitizeHttpUrl(
    extractConfirmedFieldValue(preservedProps, schemaFields, SEMA_FIELD_CANDIDATES.linkDocumento)
  );
  const numProcesso = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.numeroProcesso
  );
  const dataDoc = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.dataDocumento
  );
  const dataVal = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.dataValidade
  );

  if (grupo === 'carImoveis') {
    return {
      id: stableId,
      tipo: atividadeLimpa || layerTitle,
      numeroDocumento: carEstadual || carFederal || protocolo || '',
      nomeDocumento: nomePropriedade || '',
      dataDocumento: dataDoc || '',
      numeroProcesso: numProcesso,
      status: situacaoLimpa,
      razaoSocial: titular,
      cpfCnpjMascarado: cpfCnpjReadable,
      municipio: munNome || (munCod ? `Código IBGE ${munCod}` : undefined),
      municipioCodigo: munCod,
      camadaOrigem: layerName,
      camadaTitulo: layerTitle,
      carFederal,
      areaHa: areaNum,
      atividade: atividadeLimpa,
      linkDocumento: linkDoc,
      correspondenciaExploratoria,
      camposConfirmadosEsquema,
      cpfCnpjCompletoDisponivel: docCheck.cpfCnpjCompletoDisponivel,
      cpfCnpjCampoOrigem: docCheck.cpfCnpjCampoOrigem,
      cpfCnpjStatus: docCheck.cpfCnpjStatus,
      consultadoEm,
      propriedadesBrutas: preservedProps,
      _auditRawProps: rawProps,
      _auditDocDigits: docCheck.docDigits,
      _auditCar: carEstadual || carFederal || protocolo || undefined
    };
  }

  const tipoDoc = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.tipoDocumento
  );
  const numDoc = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.numeroDocumento
  );
  const nomeDoc = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.nomeDocumento
  );
  const statusDoc = extractConfirmedFieldValue(
    preservedProps,
    schemaFields,
    SEMA_FIELD_CANDIDATES.statusDocumento
  );

  return {
    id: stableId,
    tipo: tipoDoc || layerTitle,
    numeroDocumento: numDoc || '',
    nomeDocumento: nomeDoc || '',
    dataDocumento: dataDoc || '',
    dataValidade: dataVal,
    numeroProcesso: numProcesso,
    status: statusDoc,
    razaoSocial: titular,
    cpfCnpjMascarado: cpfCnpjReadable,
    municipio: munNome,
    municipioCodigo: munCod,
    linkDocumento: linkDoc,
    camadaOrigem: layerName,
    camadaTitulo: layerTitle,
    atividade: atividadeLimpa,
    correspondenciaExploratoria,
    camposConfirmadosEsquema,
    cpfCnpjCompletoDisponivel: docCheck.cpfCnpjCompletoDisponivel,
    cpfCnpjCampoOrigem: docCheck.cpfCnpjCampoOrigem,
    cpfCnpjStatus: docCheck.cpfCnpjStatus,
    consultadoEm,
    propriedadesBrutas: preservedProps,
    _auditRawProps: rawProps,
    _auditDocDigits: docCheck.docDigits,
    _auditCar: carEstadual || carFederal || protocolo || undefined
  };
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  if (!res.status) {
    res.status = function (code: number) {
      res.statusCode = code;
      return res;
    };
  }
  if (!res.json) {
    res.json = function (data: any) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(data));
      return res;
    };
  }

  const method = (req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.status(204)!.end();
    return;
  }
  if (method !== 'GET' && method !== 'POST') {
    res.status(405)!.json!({
      error: 'Método não permitido.'
    });
    return;
  }

  const authCtx = await authorizeSemaLookupRequest(req as any);
  if (authCtx.configured !== true) {
    res.status(503)!.json!({
      error: 'Serviço de autenticação indisponível no servidor para consultar documentos na SEMA-MT.'
    });
    return;
  }
  if (!authCtx.authorized) {
    res.status(authCtx.httpStatus || 401)!.json!({
      error: authCtx.error || 'Autenticação obrigatória.'
    });
    return;
  }

  let rawCpfCnpj: any;
  let rawProcesso: any;
  let rawProcessos: any[] = [];
  let rawNome: any;
  let rawCar: any;
  let rawCars: any[] = [];
  let rawCoords: any[] = [];
  let rawExploratorio: any;
  let rawTargetTipo: any;
  let rawTargetId: any;

  if (method === 'GET') {
    let queryCpfCnpj = req.query?.cpfCnpj;
    rawProcesso = req.query?.processo;
    rawNome = req.query?.nome;
    rawCar = req.query?.car;
    rawExploratorio = req.query?.buscaExploratoria;
    rawTargetTipo = req.query?.entidadeAlvoTipo;
    rawTargetId = req.query?.entidadeAlvoId;
    const qCars = req.query?.cars;
    const qProcs = req.query?.processos;

    if (req.url) {
      try {
        const parsedUrl = new URL(req.url, 'http://localhost');
        if (queryCpfCnpj === undefined) queryCpfCnpj = parsedUrl.searchParams.get('cpfCnpj') ?? undefined;
        if (rawProcesso === undefined) rawProcesso = parsedUrl.searchParams.get('processo');
        if (rawNome === undefined) rawNome = parsedUrl.searchParams.get('nome');
        if (rawCar === undefined) rawCar = parsedUrl.searchParams.get('car');
        if (rawExploratorio === undefined) rawExploratorio = parsedUrl.searchParams.get('buscaExploratoria');
        if (rawTargetTipo === undefined) rawTargetTipo = parsedUrl.searchParams.get('entidadeAlvoTipo');
        if (rawTargetId === undefined) rawTargetId = parsedUrl.searchParams.get('entidadeAlvoId');
        const carsParam = qCars ?? parsedUrl.searchParams.get('cars');
        if (carsParam) rawCars = String(carsParam).split(/[,;]/);
        const procsParam = qProcs ?? parsedUrl.searchParams.get('processos');
        if (procsParam) rawProcessos = String(procsParam).split(/[,;]/);
      } catch {}
    }

    if (queryCpfCnpj !== undefined && String(queryCpfCnpj).trim() !== '') {
      res.status(400)!.json!({
        error: 'Por segurança, a consulta por CPF/CNPJ deve ser enviada via requisição segura (POST).'
      });
      return;
    }
  } else {
    try {
      const body = await readJsonBody(req);
      rawCpfCnpj = body.cpfCnpj;
      rawProcesso = body.processo;
      rawProcessos = Array.isArray(body.processos) ? body.processos : [];
      rawNome = body.nome;
      rawCar = body.car;
      rawCars = Array.isArray(body.cars) ? body.cars : [];
      rawCoords = Array.isArray(body.coordenadas) ? body.coordenadas : [];
      rawExploratorio = body.buscaExploratoria;
      rawTargetTipo = body.entidadeAlvoTipo;
      rawTargetId = body.entidadeAlvoId;
    } catch (err: any) {
      res.status(400)!.json!({
        error: err?.message || 'Dados inválidos na requisição.'
      });
      return;
    }
  }

  const targetCtx = parseSemaAuditTargetContext({
    entidadeAlvoTipo: rawTargetTipo,
    entidadeAlvoId: rawTargetId
  });
  const targetAccess = await validateTargetEntityAccess(authCtx, targetCtx);
  if (!targetAccess.ok) {
    res.status(targetAccess.httpStatus || 403)!.json!({
      error: targetAccess.error || 'Sem permissão para o registro alvo informado.'
    });
    return;
  }

  const rawDocStr = String(rawCpfCnpj || '').trim();
  const cleanDoc = rawDocStr.replace(/\D/g, '');

  if (rawDocStr && cleanDoc.length !== 11 && cleanDoc.length !== 14) {
    res.status(400)!.json!({
      error: 'CPF/CNPJ inválido. Informe 11 dígitos (CPF) ou 14 dígitos (CNPJ).'
    });
    return;
  }

  const rawCarStr = sanitizeSearchInput(String(rawCar || ''), 160);
  const allCarInputs = [rawCarStr, ...rawCars.map(c => sanitizeSearchInput(String(c || ''), 120))].filter(Boolean);
  const carTokenSet = new Set<string>();
  for (const carStr of allCarInputs) {
    for (const tok of extractCarSearchTokens(carStr)) {
      carTokenSet.add(tok);
    }
  }
  const carTokens = Array.from(carTokenSet).slice(0, 12);

  const procSet = new Set<string>();
  const rawProcList = [
    ...String(rawProcesso || '').split(/[,;]/),
    ...rawProcessos.map(p => String(p || ''))
  ];
  for (const p of rawProcList) {
    const cleanP = sanitizeSearchInput(p, 60);
    if (cleanP.length >= 3) {
      procSet.add(cleanP);
    }
  }
  const procList = Array.from(procSet).slice(0, 8);

  const coordList: SemaCoordPoint[] = [];
  const coordSeen = new Set<string>();
  for (const c of rawCoords) {
    if (!c || typeof c !== 'object') continue;
    const lat = Number(c.lat);
    const lng = Number(c.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      continue;
    }
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (!coordSeen.has(key)) {
      coordSeen.add(key);
      coordList.push({ lat, lng, label: c.label ? String(c.label).slice(0, 80) : undefined });
    }
    if (coordList.length >= 5) break;
  }

  const cleanNome = sanitizeSearchInput(String(rawNome || ''), 100);
  const hasConfirmatoryCriteria = Boolean(
    cleanDoc || carTokens.length > 0 || procList.length > 0 || coordList.length > 0
  );
  const explicitExploratory = rawExploratorio === true || rawExploratorio === 'true' || rawExploratorio === '1';
  const buscaExploratoria = Boolean(cleanNome && (explicitExploratory || !hasConfirmatoryCriteria));

  if (!hasConfirmatoryCriteria && !buscaExploratoria) {
    res.status(400)!.json!({
      error: 'Informe CPF/CNPJ, Número do CAR/MT, Processo ou um termo para busca por nome (mín. 3 caracteres).'
    });
    return;
  }

  if (buscaExploratoria && cleanNome.length < 3) {
    res.status(400)!.json!({
      error: 'Para busca por nome, informe ao menos 3 caracteres.'
    });
    return;
  }

  const consultadoEm = new Date().toISOString();
  const capResult = await getSemaCapabilities();
  const hasConfirmedCatalog = capResult.ok && capResult.wfsLayers.size > 0;

  const resultado = {
    carImoveis: [] as any[],
    licencas: [] as any[],
    notificacoes: [] as any[],
    autosInfracao: [] as any[],
    termosEmbargo: [] as any[],
    outros: [] as any[]
  };

  let camadasConsultadas: CamadaStatus[] = [];
  let geoserverDirectFailed = false;
  let anyTimeout = Boolean(capResult.isTimeout);

  if (hasConfirmedCatalog || !capResult.isTimeout) {
    const layerResults = await mapWithConcurrency(
      TARGET_LAYERS,
      4,
      async target => {
        const capWfs = capResult.wfsLayers.get(target.name);
        const capWms = capResult.wmsLayers.get(target.name);
        const layerTitle = capWfs?.title || capWms?.title || target.name;

        if (hasConfirmedCatalog && !capWfs) {
          return {
            status: {
              camada: target.name,
              titulo: layerTitle,
              grupo: target.grupo,
              status: 'indisponivel' as CamadaStatusCode,
              suportado: false,
              registrosEncontrados: 0,
              mensagem: 'Base não disponível no momento.'
            },
            items: [] as any[]
          };
        }

        const schemaRes = await describeSemaLayerXml(target.name);
        if (!schemaRes.ok) {
          return {
            status: {
              camada: target.name,
              titulo: layerTitle,
              grupo: target.grupo,
              status: (schemaRes.isTimeout || schemaRes.httpStatus === 403
                ? 'erro_comunicacao'
                : 'indisponivel') as CamadaStatusCode,
              suportado: false,
              registrosEncontrados: 0,
              mensagem: schemaRes.errorMsg || 'Não foi possível consultar esta base no momento.'
            },
            items: [] as any[],
            isTimeout: Boolean(schemaRes.isTimeout)
          };
        }

        const filterBuild = buildSchemaFilterForLayer(schemaRes.fields, schemaRes.geomFields, target.grupo, {
          cleanDoc,
          carTokens,
          procList,
          coordenadas: coordList,
          cleanNome,
          buscaExploratoria
        });

        if (!filterBuild.supported) {
          return {
            status: {
              camada: target.name,
              titulo: layerTitle,
              grupo: target.grupo,
              status: 'nao_suportado' as CamadaStatusCode,
              suportado: false,
              registrosEncontrados: 0,
              mensagem: filterBuild.unsupportedReason || 'Critério não aplicável a esta base.'
            },
            items: [] as any[]
          };
        }

        const propertyNames = Array.from(schemaRes.fields.keys()).filter(
          fieldName => !schemaRes.geomFields.has(fieldName)
        );

        const queryTasks: Array<
          Promise<{ isSpatial: boolean; res: Awaited<ReturnType<typeof executeSemaGetFeature>> }>
        > = [];

        if (filterBuild.attrCqlFilter) {
          queryTasks.push(
            executeSemaGetFeature({
              layerName: target.name,
              cqlFilter: filterBuild.attrCqlFilter,
              propertyNames,
              includeSrs4326: false,
              maxFeatures: 25,
              attrClauses: filterBuild.attrClauses
            }).then(res => ({
              isSpatial: false,
              res
            }))
          );
        }

        if (filterBuild.spatialCqlFilter) {
          queryTasks.push(
            executeSemaGetFeature({
              layerName: target.name,
              cqlFilter: filterBuild.spatialCqlFilter,
              propertyNames,
              includeSrs4326: true,
              maxFeatures: 25,
              spatialGeomField: filterBuild.spatialGeomField,
              spatialPoints: filterBuild.spatialPoints
            }).then(res => ({
              isSpatial: true,
              res
            }))
          );
        }

        const responses = await Promise.all(queryTasks);
        const anyOk = responses.some(r => r.res.ok);

        if (!anyOk) {
          const firstErr = responses[0]?.res;
          const isFilterIncompatible = Boolean(firstErr?.isFilterIncompatible);
          const isTimeout = Boolean(firstErr?.isTimeout);
          const httpSuffix = firstErr?.httpStatus ? ` (HTTP ${firstErr.httpStatus})` : '';
          return {
            status: {
              camada: target.name,
              titulo: layerTitle,
              grupo: target.grupo,
              status: (isFilterIncompatible ? 'filtro_incompativel' : 'erro_comunicacao') as CamadaStatusCode,
              suportado: !isFilterIncompatible,
              registrosEncontrados: 0,
              camposPesquisados: filterBuild.fieldsUsed,
              mensagem: isFilterIncompatible
                ? 'Critério de busca não compatível com esta base.'
                : isTimeout
                ? 'Tempo limite esgotado ao consultar esta base.'
                : `Falha de comunicação ao consultar esta base${httpSuffix}.`
            },
            items: [] as any[],
            isTimeout
          };
        }

        const seenIds = new Set<string>();
        const items: any[] = [];

        for (const { isSpatial, res: qRes } of responses) {
          if (!qRes.ok) continue;
          for (const f of qRes.features) {
            const rawProps = f?.properties && typeof f.properties === 'object' ? f.properties : {};
            const matchEval = evaluateFeatureMatch(rawProps, isSpatial, filterBuild, {
              cleanDoc,
              carTokens,
              procList,
              cleanNome,
              buscaExploratoria
            });

            if (!matchEval.matches) continue;

            const item = mapFeatureToDocumentItem(
              f,
              target.name,
              layerTitle,
              target.grupo,
              schemaRes.fields,
              schemaRes.geomFields,
              filterBuild.confirmedDocFields,
              !matchEval.confirmatory,
              consultadoEm
            );

            if (item.id) {
              if (seenIds.has(item.id)) continue;
              seenIds.add(item.id);
            }
            items.push(item);
          }
        }

        return {
          status: {
            camada: target.name,
            titulo: layerTitle,
            grupo: target.grupo,
            status: (items.length > 0 ? 'consultada' : 'sem_resultados') as CamadaStatusCode,
            suportado: true,
            registrosEncontrados: items.length,
            camposPesquisados: filterBuild.fieldsUsed,
            camposConfirmados: propertyNames,
            mensagem:
              items.length > 0
                ? `${items.length} registro(s) encontrado(s).`
                : 'Nenhum registro encontrado para os critérios informados.'
          },
          items
        };
      }
    );

    for (const r of layerResults) {
      camadasConsultadas.push(r.status);
      if (r.isTimeout) anyTimeout = true;
      if (r.status.grupo === 'carImoveis') resultado.carImoveis.push(...r.items);
      else if (r.status.grupo === 'licencas') resultado.licencas.push(...r.items);
      else if (r.status.grupo === 'notificacoes') resultado.notificacoes.push(...r.items);
      else if (r.status.grupo === 'autosInfracao') resultado.autosInfracao.push(...r.items);
      else if (r.status.grupo === 'termosEmbargo') resultado.termosEmbargo.push(...r.items);
      else resultado.outros.push(...r.items);
    }
  } else {
    geoserverDirectFailed = true;
    camadasConsultadas = TARGET_LAYERS.map(target => ({
      camada: target.name,
      titulo: target.name,
      grupo: target.grupo,
      status: 'erro_comunicacao' as CamadaStatusCode,
      suportado: false,
      registrosEncontrados: 0,
      mensagem: capResult.errorMsg || 'Serviço público da SEMA-MT temporariamente inacessível.'
    }));
  }

  const consultadasDirectCount = camadasConsultadas.filter(
    c => c.status === 'consultada' || c.status === 'sem_resultados'
  ).length;

  let origemDados: 'geoserver_wfs' | 'cache_local' = 'geoserver_wfs';

  if (consultadasDirectCount === 0) {
    geoserverDirectFailed = true;
    const cacheFallback = await queryGeoportalCacheFallback(
      authCtx.supabaseAdmin,
      {
        cleanDoc,
        carTokens,
        procList,
        cleanNome,
        buscaExploratoria
      },
      consultadoEm
    );

    if (cacheFallback.used && cacheFallback.totalCount > 0) {
      origemDados = 'cache_local';
      resultado.carImoveis.push(...cacheFallback.itemsByGroup.carImoveis);
      resultado.licencas.push(...cacheFallback.itemsByGroup.licencas);
      resultado.notificacoes.push(...cacheFallback.itemsByGroup.notificacoes);
      resultado.autosInfracao.push(...cacheFallback.itemsByGroup.autosInfracao);
      resultado.termosEmbargo.push(...cacheFallback.itemsByGroup.termosEmbargo);
      resultado.outros.push(...cacheFallback.itemsByGroup.outros);

      const countsByLayer = new Map<string, number>();
      for (const list of [
        cacheFallback.itemsByGroup.carImoveis,
        cacheFallback.itemsByGroup.licencas,
        cacheFallback.itemsByGroup.notificacoes,
        cacheFallback.itemsByGroup.autosInfracao,
        cacheFallback.itemsByGroup.termosEmbargo,
        cacheFallback.itemsByGroup.outros
      ]) {
        for (const it of list) {
          const k = String(it.camadaOrigem || '');
          countsByLayer.set(k, (countsByLayer.get(k) || 0) + 1);
        }
      }

      camadasConsultadas = camadasConsultadas.map(c => {
        const count = countsByLayer.get(c.camada) || 0;
        if (count > 0) {
          return {
            ...c,
            status: 'consultada',
            suportado: true,
            registrosEncontrados: count,
            mensagem: `${count} registro(s) recuperado(s) do cache local sincronizado da SEMA-MT.`
          };
        }
        return c;
      });
    } else if (!capResult.ok && capResult.isTimeout) {
      res.status(504)!.json!({
        error: capResult.errorMsg || 'Tempo limite esgotado ao conectar com a base pública da SEMA-MT.',
        camadasConsultadas,
        consultadoEm
      });
      return;
    } else if (!capResult.ok && geoserverDirectFailed && camadasConsultadas.every(c => c.status === 'erro_comunicacao')) {
      res.status(anyTimeout ? 504 : 502)!.json!({
        error:
          capResult.errorMsg ||
          'Base pública da SEMA-MT bloqueou ou não respondeu à consulta externa neste momento.',
        camadasConsultadas,
        consultadoEm
      });
      return;
    }
  }

  resultado.carImoveis = deduplicateCarImoveisByCar(resultado.carImoveis);

  const auditCritTipo: 'car' | 'coordenada' | 'processo' | 'cpf_cnpj_hash' | 'nome_exploratorio' =
    cleanDoc
      ? 'cpf_cnpj_hash'
      : carTokens.length > 0
      ? 'car'
      : procList.length > 0
      ? 'processo'
      : coordList.length > 0
      ? 'coordenada'
      : 'nome_exploratorio';
  const auditCritVal =
    auditCritTipo === 'cpf_cnpj_hash'
      ? cleanDoc
      : auditCritTipo === 'car'
      ? rawCarStr || carTokens[0]
      : auditCritTipo === 'processo'
      ? procList[0]
      : auditCritTipo === 'coordenada'
      ? `sha256:${sha256HexServer(`${coordList[0].lat.toFixed(6)},${coordList[0].lng.toFixed(6)}`).slice(0, 24)}`
      : cleanNome;

  const canViewFullPii = canViewFullSemaPersonalData(authCtx);

  const redactSemaItemPersonalData = (item: any) => {
    const hadDoc = Boolean(
      item?.cpfCnpjStatus === 'completo' ||
        item?.cpfCnpjStatus === 'mascarado' ||
        item?.cpfCnpjMascarado
    );
    const out: any = {
      ...item,
      ...(item?.razaoSocial
        ? { razaoSocial: scrubSensitiveTextForServerLog(String(item.razaoSocial)) }
        : {}),
      ...(item?.cpfCnpjMascarado
        ? { cpfCnpjMascarado: maskCpfCnpjDisplay(String(item.cpfCnpjMascarado)) || '***' }
        : {}),
      cpfCnpjCompletoDisponivel: false,
      cpfCnpjStatus: hadDoc ? 'mascarado' : 'ausente',
      propriedadesBrutas: sanitizeSemaProperties(item?.propriedadesBrutas || {}, [])
    };
    delete out.cpfCnpjCampoOrigem;
    return out;
  };

  const attachAuditToGroup = async (list: any[]): Promise<any[]> => {
    return await Promise.all(
      list.map(async item => {
        const { _auditRawProps, _auditDocDigits, _auditCar, ...publicItem } = item;
        const rawProps = _auditRawProps || publicItem.propriedadesBrutas || {};
        const camposConsultados = Object.keys(publicItem.propriedadesBrutas || rawProps || {});

        const auditRes = await recordSemaServerAuditDetailed(authCtx, targetAccess.resolvedTarget, {
          criterioTipo: auditCritTipo,
          criterioValor: auditCritVal,
          camada: publicItem.camadaOrigem || 'Geoportal:CAR_ATP',
          featureId: String(publicItem.id || publicItem.numeroDocumento || 'sema_item'),
          car:
            _auditCar ||
            publicItem.carFederal ||
            (publicItem.camadaOrigem?.includes('CAR') ? publicItem.numeroDocumento : undefined),
          rawProps,
          docStatus: publicItem.cpfCnpjStatus || 'ausente',
          docDigits: _auditDocDigits,
          camposConsultados,
          consultadoEm,
          extraSafeAttrs: {
            ...(publicItem.razaoSocial
              ? { titularNome: scrubSensitiveTextForServerLog(String(publicItem.razaoSocial)) }
              : {}),
            ...(publicItem.nomeDocumento ? { nomeDocumento: publicItem.nomeDocumento } : {}),
            ...(publicItem.municipio ? { municipio: publicItem.municipio } : {}),
            ...(publicItem.municipioCodigo ? { municipioCodigo: publicItem.municipioCodigo } : {}),
            ...(publicItem.numeroProcesso ? { numeroProcesso: publicItem.numeroProcesso } : {}),
            ...(_auditDocDigits
              ? { tipoPessoa: _auditDocDigits.length === 11 ? 'Pessoa física' : 'Pessoa jurídica' }
              : {})
          }
        });

        const auditOk = Boolean(auditRes.ok && auditRes.auditoriaId);
        const allowFullPersonalData = canViewFullPii && auditOk;
        const baseItem = allowFullPersonalData ? publicItem : redactSemaItemPersonalData(publicItem);

        return {
          ...baseItem,
          auditoriaDisponivel: auditOk,
          ...(auditOk ? { auditoriaId: auditRes.auditoriaId } : {})
        };
      })
    );
  };

  const [
    auditedCarImoveis,
    auditedLicencas,
    auditedNotificacoes,
    auditedAutosInfracao,
    auditedTermosEmbargo,
    auditedOutros
  ] = await Promise.all([
    attachAuditToGroup(resultado.carImoveis),
    attachAuditToGroup(resultado.licencas),
    attachAuditToGroup(resultado.notificacoes),
    attachAuditToGroup(resultado.autosInfracao),
    attachAuditToGroup(resultado.termosEmbargo),
    attachAuditToGroup(resultado.outros)
  ]);

  resultado.carImoveis = auditedCarImoveis;
  resultado.licencas = auditedLicencas;
  resultado.notificacoes = auditedNotificacoes;
  resultado.autosInfracao = auditedAutosInfracao;
  resultado.termosEmbargo = auditedTermosEmbargo;
  resultado.outros = auditedOutros;

  const totalRegistros =
    resultado.carImoveis.length +
    resultado.licencas.length +
    resultado.notificacoes.length +
    resultado.autosInfracao.length +
    resultado.termosEmbargo.length +
    resultado.outros.length;

  const allReturnedItems = [
    ...resultado.carImoveis,
    ...resultado.licencas,
    ...resultado.notificacoes,
    ...resultado.autosInfracao,
    ...resultado.termosEmbargo,
    ...resultado.outros
  ];
  const auditoriaDisponivel =
    allReturnedItems.length > 0
      ? allReturnedItems.every(it => it.auditoriaDisponivel === true)
      : Boolean(authCtx.configured && authCtx.authorized && authCtx.role !== 'Visualizador');

  const consultadasCount = camadasConsultadas.filter(
    c => c.status === 'consultada' || c.status === 'sem_resultados'
  ).length;
  const naoSuportadasCount = camadasConsultadas.filter(c => c.status === 'nao_suportado').length;
  const falhasCount = camadasConsultadas.filter(
    c =>
      c.status === 'erro_comunicacao' ||
      c.status === 'indisponivel' ||
      c.status === 'filtro_incompativel'
  ).length;

  let mensagemStatus = '';
  if (totalRegistros > 0) {
    mensagemStatus =
      origemDados === 'cache_local'
        ? `${totalRegistros} registro(s) recuperado(s) do cache sincronizado da SEMA-MT (serviço externo temporariamente indisponível).`
        : `${totalRegistros} registro(s) encontrado(s) na base pública da SEMA-MT.`;
    if (buscaExploratoria && !hasConfirmatoryCriteria) {
      mensagemStatus += ' Resultados obtidos por correspondência textual de nome.';
    }
  } else if (consultadasCount === 0 && falhasCount > 0) {
    mensagemStatus = 'Não foi possível concluir a consulta na base pública da SEMA-MT no momento.';
  } else if (consultadasCount === 0 && naoSuportadasCount > 0) {
    mensagemStatus = 'Os critérios informados não retornaram correspondência direta nas bases disponíveis.';
  } else {
    mensagemStatus = 'Consulta concluída sem registros correspondentes na base pública da SEMA-MT.';
  }

  res.status(200)!.json!({
    sucesso: consultadasCount > 0 || (naoSuportadasCount > 0 && falhasCount === 0),
    origemDados,
    auditoriaDisponivel,
    criteriosUtilizados: {
      temCpfCnpj: Boolean(cleanDoc),
      car: rawCarStr || undefined,
      cars: carTokens.length > 0 ? carTokens : undefined,
      processo: procList[0] || undefined,
      processos: procList.length > 0 ? procList : undefined,
      coordenadasCount: coordList.length,
      nomeExploratorio: buscaExploratoria ? cleanNome : undefined,
      buscaExploratoria
    },
    ...resultado,
    totalRegistros,
    consultadoEm,
    mensagemStatus,
    camadasConsultadas
  });
}
