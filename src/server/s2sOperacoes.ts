// src/server/s2sOperacoes.ts
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  readJsonObjectBody,
  JsonBodyReaderError,
  type StreamReadableLike
} from './jsonBodyReader.js';
import { sendV2Json, sendV2Unavailable, type VercelLikeResponse } from './apiV2Catalog.js';
import {
  authenticateS2sRequest,
  parseStrictUtf8JsonObject,
  sha256BodyHexLower,
  type S2sRequestLike,
  type S2sSistema
} from './s2sAuth.js';
import {
  authorizeSemaLookupRequest,
  scrubSensitiveTextForServerLog
} from './semaAudit.js';

export const S2S_OPERACOES_WRITE_SCOPE = 'operacoes:write' as const;
export const S2S_OPERACOES_MAX_BODY_BYTES = 64 * 1024;
export const ADMIN_JSON_MAX_BODY_BYTES = 64 * 1024;

export type S2sModoExecucao = 'execucao_direta' | 'proposta_aprovacao';

export type S2sOperacaoNome =
  | 'cadastrar_empreendedor'
  | 'cadastrar_empreendimento'
  | 'cadastrar_barragem'
  | 'cadastrar_rt'
  | 'propor_alteracao_empreendedor'
  | 'propor_alteracao_empreendimento'
  | 'propor_alteracao_barragem'
  | 'propor_alteracao_rt'
  | 'registrar_documento'
  | 'cancelar_solicitacao_pendente'
  | 'desativar_cadastro'
  | 'cancelar_ato_aplicado'
  | 'transferir_titularidade'
  | 'reverter_ato';

export type S2sEntidadeTipo = 'empreendedor' | 'barragem' | 'rt';

export interface S2sOperationSpec {
  operacao: S2sOperacaoNome;
  status: 'liberada' | 'bloqueada_lacuna_contrato' | 'bloqueada_etapa';
  requiredMode: S2sModoExecucao | null;
  entidadeTipo?: S2sEntidadeTipo;
  tabelaNome?: 'empreendedores' | 'barragens' | 'rts';
  blockedReason?: string;
}

/**
 * Allowlist tipada de operações S2S.
 *
 * LACUNAS DE CONTRATO IDENTIFICADAS NO REPOSITÓRIO (bloqueadas por padrão):
 * 1. `cadastrar_empreendimento` e `propor_alteracao_empreendimento`:
 *    Não há migration/DDL para tabela `public.empreendimentos` neste repositório;
 *    o esquema versionado usa o array JSONB `empreendedores.empreendimentos` e o
 *    campo textual `barragens.empreendimento`. Sem tabela e FK oficiais definidas,
 *    a operação permanece bloqueada sem inventar schema.
 * 2. `registrar_documento`:
 *    Embora `src/services/documentosService.ts` e o trigger condicional de
 *    `20261116_historico_alteracoes_e_integracao_externa.sql` mencionem
 *    `public.documentos_catalogo`, não existe `CREATE TABLE` nem constraint
 *    única `(origem_sistema, origem_documento_id)` nas migrations do repositório
 *    para garantir contrato e idempotência no banco. Permanece bloqueada até
 *    migration dedicada do catálogo de documentos.
 * 3. `desativar_cadastro`, `cancelar_ato_aplicado`, `transferir_titularidade`,
 *    `reverter_ato`: bloqueadas nesta etapa por decisão arquitetural.
 */
export const S2S_OPERATIONS_REGISTRY: Record<S2sOperacaoNome, S2sOperationSpec> = {
  cadastrar_empreendedor: {
    operacao: 'cadastrar_empreendedor',
    status: 'liberada',
    requiredMode: 'execucao_direta',
    entidadeTipo: 'empreendedor',
    tabelaNome: 'empreendedores'
  },
  cadastrar_empreendimento: {
    operacao: 'cadastrar_empreendimento',
    status: 'bloqueada_lacuna_contrato',
    requiredMode: null,
    blockedReason:
      'Operação bloqueada: tabela public.empreendimentos e contrato de vínculo não possuem migration definida neste repositório.'
  },
  cadastrar_barragem: {
    operacao: 'cadastrar_barragem',
    status: 'liberada',
    requiredMode: 'execucao_direta',
    entidadeTipo: 'barragem',
    tabelaNome: 'barragens'
  },
  cadastrar_rt: {
    operacao: 'cadastrar_rt',
    status: 'liberada',
    requiredMode: 'execucao_direta',
    entidadeTipo: 'rt',
    tabelaNome: 'rts'
  },
  propor_alteracao_empreendedor: {
    operacao: 'propor_alteracao_empreendedor',
    status: 'liberada',
    requiredMode: 'proposta_aprovacao',
    entidadeTipo: 'empreendedor',
    tabelaNome: 'empreendedores'
  },
  propor_alteracao_empreendimento: {
    operacao: 'propor_alteracao_empreendimento',
    status: 'bloqueada_lacuna_contrato',
    requiredMode: null,
    blockedReason:
      'Operação bloqueada: tabela public.empreendimentos e contrato de vínculo não possuem migration definida neste repositório.'
  },
  propor_alteracao_barragem: {
    operacao: 'propor_alteracao_barragem',
    status: 'liberada',
    requiredMode: 'proposta_aprovacao',
    entidadeTipo: 'barragem',
    tabelaNome: 'barragens'
  },
  propor_alteracao_rt: {
    operacao: 'propor_alteracao_rt',
    status: 'liberada',
    requiredMode: 'proposta_aprovacao',
    entidadeTipo: 'rt',
    tabelaNome: 'rts'
  },
  registrar_documento: {
    operacao: 'registrar_documento',
    status: 'bloqueada_lacuna_contrato',
    requiredMode: null,
    blockedReason:
      'Operação bloqueada: public.documentos_catalogo e índice único de idempotência não possuem migration versionada neste repositório.'
  },
  cancelar_solicitacao_pendente: {
    operacao: 'cancelar_solicitacao_pendente',
    status: 'liberada',
    requiredMode: 'execucao_direta'
  },
  desativar_cadastro: {
    operacao: 'desativar_cadastro',
    status: 'bloqueada_etapa',
    requiredMode: null,
    blockedReason: 'Desativação cadastral via S2S bloqueada nesta etapa.'
  },
  cancelar_ato_aplicado: {
    operacao: 'cancelar_ato_aplicado',
    status: 'bloqueada_etapa',
    requiredMode: null,
    blockedReason: 'Cancelamento de ato já aplicado bloqueado nesta etapa.'
  },
  transferir_titularidade: {
    operacao: 'transferir_titularidade',
    status: 'bloqueada_etapa',
    requiredMode: null,
    blockedReason: 'Transferência de titularidade via S2S bloqueada nesta etapa.'
  },
  reverter_ato: {
    operacao: 'reverter_ato',
    status: 'bloqueada_etapa',
    requiredMode: null,
    blockedReason: 'Reversão de ato via S2S bloqueada nesta etapa.'
  }
};

const CONTROL_CHARS_REGEX = /[\u0000-\u001f\u007f]/;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._:-]{8,128}$/;
const SAFE_ID_REGEX = /^[A-Za-z0-9._:-]{2,120}$/;
const SAFE_ACTOR_REGEX = /^[A-Za-z0-9._:@/-]{2,128}$/;
const SAFE_MATRICULA_REGEX = /^[A-Za-z0-9._/-]{2,64}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UF_REGEX = /^[A-Z]{2}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MASKED_HINT_REGEX = /(\*{2,}|xxx)/i;

const FORBIDDEN_TOP_LEVEL_KEYS = new Set([
  'modo',
  'politica',
  'politicaAtiva',
  'politica_ativa',
  'ativo',
  'aprovar',
  'aprovarAutomaticamente',
  'aprovar_automaticamente',
  'autoAprovar',
  'auto_aprovar',
  'papel',
  'role',
  'isAdmin',
  'is_admin',
  'sistema',
  'sistemaOrigem',
  'sistema_origem',
  'situacaoAprovacao',
  'situacao_aprovacao',
  'analisadoPor',
  'analisado_por'
]);

const FORBIDDEN_ENTITY_DATA_KEYS = new Set([
  'created_at',
  'createdAt',
  'created_by',
  'createdBy',
  'updated_at',
  'updatedAt',
  'updated_by',
  'updatedBy',
  'situacao',
  'status',
  'ativo',
  'modo',
  'is_admin',
  'isAdmin',
  'papel',
  'role'
]);

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'operacao',
  'idempotencyKey',
  'autorOrigem',
  'registroId',
  'solicitacaoId',
  'justificativa',
  'motivo',
  'referenciaExterna',
  'dados'
]);

const EMPREENDEDOR_ALLOWED_FIELDS = new Set([
  'id',
  'tipo_pessoa',
  'nome',
  'cpf_cnpj',
  'nome_fantasia',
  'email',
  'telefone',
  'uf',
  'municipio',
  'municipio_ibge',
  'observacoes'
]);

const BARRAGEM_ALLOWED_FIELDS = new Set([
  'id',
  'nome',
  'car',
  'uf',
  'municipio',
  'municipio_ibge',
  'empreendedor_id',
  'empreendimento',
  'processo',
  'snisb',
  'curso_agua',
  'latitude',
  'longitude',
  'altura',
  'volume',
  'dano_potencial',
  'categoria_risco',
  'observacoes'
]);

const RT_ALLOWED_FIELDS = new Set([
  'id',
  'nome',
  'cpf',
  'conselho',
  'uf_conselho',
  'registro',
  'especialidades',
  'telefone',
  'email',
  'observacoes'
]);

const ALLOWED_DPA_CRI = new Set(['Baixo', 'Médio', 'Alto', 'Não classificada']);
const ALLOWED_TIPO_PESSOA = new Set(['Pessoa física', 'Pessoa jurídica']);

interface PolicyRow {
  id: string;
  sistema_origem: S2sSistema;
  operacao: S2sOperacaoNome;
  modo: S2sModoExecucao;
  ativo: boolean;
  parametros: Record<string, any> | null;
  restricoes: Record<string, any> | null;
}

export function isValidCpfDigits(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(digits[i]) * (10 - i);
  }
  let rem = (sum * 10) % 11;
  if (rem === 10) rem = 0;
  if (rem !== Number(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += Number(digits[i]) * (11 - i);
  }
  rem = (sum * 10) % 11;
  if (rem === 10) rem = 0;
  return rem === Number(digits[10]);
}

export function isValidCnpjDigits(digits: string): boolean {
  if (!/^\d{14}$/.test(digits)) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  const calcDigit = (sliceLen: number, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < sliceLen; i += 1) {
      sum += Number(digits[i]) * weights[i];
    }
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  const d1 = calcDigit(12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== Number(digits[12])) return false;
  const d2 = calcDigit(13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d2 === Number(digits[13]);
}

export function isValidCpfOrCnpjDigits(raw: string): string | null {
  if (!raw || MASKED_HINT_REGEX.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && isValidCpfDigits(digits)) return digits;
  if (digits.length === 14 && isValidCnpjDigits(digits)) return digits;
  return null;
}

function getHeaderSingle(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== target) continue;
    const raw = headers[key];
    if (Array.isArray(raw)) {
      if (raw.length === 0) return null;
      const items = raw.map(v => String(v ?? '').trim());
      if (new Set(items).size > 1) return '';
      return items[0] || null;
    }
    const val = String(raw ?? '').trim();
    return val || null;
  }
  return null;
}

function sanitizeCleanString(
  raw: unknown,
  opts: { minLen?: number; maxLen: number; fieldName: string }
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: `Campo "${opts.fieldName}" deve ser texto.` };
  }
  const trimmed = raw.trim();
  if (CONTROL_CHARS_REGEX.test(trimmed)) {
    return { ok: false, error: `Campo "${opts.fieldName}" contém caracteres inválidos.` };
  }
  if (opts.minLen !== undefined && trimmed.length < opts.minLen) {
    return {
      ok: false,
      error: `Campo "${opts.fieldName}" deve possuir ao menos ${opts.minLen} caracteres.`
    };
  }
  if (trimmed.length > opts.maxLen) {
    return {
      ok: false,
      error: `Campo "${opts.fieldName}" excede o tamanho máximo de ${opts.maxLen} caracteres.`
    };
  }
  return { ok: true, value: trimmed };
}

function validateEntityFields(
  entidadeTipo: S2sEntidadeTipo,
  rawDados: unknown,
  mode: 'create' | 'propose_update'
): { ok: true; dados: Record<string, any> } | { ok: false; error: string } {
  if (!rawDados || typeof rawDados !== 'object' || Array.isArray(rawDados)) {
    return { ok: false, error: 'Objeto "dados" é obrigatório e deve ser um JSON válido.' };
  }

  const input = rawDados as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0) {
    return { ok: false, error: 'Objeto "dados" não pode estar vazio.' };
  }

  const allowedSet =
    entidadeTipo === 'empreendedor'
      ? EMPREENDEDOR_ALLOWED_FIELDS
      : entidadeTipo === 'barragem'
      ? BARRAGEM_ALLOWED_FIELDS
      : RT_ALLOWED_FIELDS;

  const out: Record<string, any> = {};

  for (const key of keys) {
    if (FORBIDDEN_ENTITY_DATA_KEYS.has(key)) {
      return {
        ok: false,
        error: `Campo de controle "${key}" não pode ser informado no payload.`
      };
    }
    if (!allowedSet.has(key)) {
      return {
        ok: false,
        error: `Campo "${key}" não é permitido para "${entidadeTipo}".`
      };
    }
    if (mode === 'propose_update' && key === 'id') {
      return {
        ok: false,
        error: 'O campo "id" não pode ser alterado em proposta de edição.'
      };
    }
  }

  if (input.id !== undefined) {
    const idCheck = sanitizeCleanString(input.id, { minLen: 2, maxLen: 120, fieldName: 'dados.id' });
    if (idCheck.ok === false) return idCheck;
    if (!SAFE_ID_REGEX.test(idCheck.value)) {
      return { ok: false, error: 'Campo "dados.id" possui formato inválido.' };
    }
    out.id = idCheck.value;
  }

  if (entidadeTipo === 'empreendedor') {
    if (mode === 'create' || input.nome !== undefined) {
      const nome = sanitizeCleanString(input.nome, { minLen: 3, maxLen: 200, fieldName: 'dados.nome' });
      if (nome.ok === false) return nome;
      out.nome = nome.value;
    }

    if (mode === 'create' || input.cpf_cnpj !== undefined) {
      if (typeof input.cpf_cnpj !== 'string') {
        return { ok: false, error: 'Campo "dados.cpf_cnpj" deve ser texto válido.' };
      }
      const digits = isValidCpfOrCnpjDigits(input.cpf_cnpj);
      if (!digits) {
        return {
          ok: false,
          error: 'CPF ou CNPJ completo e válido é obrigatório (dados mascarados são rejeitados).'
        };
      }
      out.cpf_cnpj = digits;
    }

    if (input.tipo_pessoa !== undefined && input.tipo_pessoa !== null) {
      const tp = sanitizeCleanString(input.tipo_pessoa, { minLen: 3, maxLen: 40, fieldName: 'dados.tipo_pessoa' });
      if (tp.ok === false) return tp;
      if (!ALLOWED_TIPO_PESSOA.has(tp.value)) {
        return { ok: false, error: 'Campo "dados.tipo_pessoa" inválido.' };
      }
      out.tipo_pessoa = tp.value;
    }

    for (const optText of ['nome_fantasia', 'municipio', 'municipio_ibge', 'observacoes'] as const) {
      if (input[optText] !== undefined && input[optText] !== null) {
        const res = sanitizeCleanString(input[optText], {
          minLen: 1,
          maxLen: optText === 'observacoes' ? 1000 : 200,
          fieldName: `dados.${optText}`
        });
        if (res.ok === false) return res;
        out[optText] = res.value;
      }
    }

    if (input.uf !== undefined && input.uf !== null) {
      const uf = sanitizeCleanString(input.uf, { minLen: 2, maxLen: 2, fieldName: 'dados.uf' });
      if (uf.ok === false) return uf;
      const upperUf = uf.value.toUpperCase();
      if (!UF_REGEX.test(upperUf)) return { ok: false, error: 'Campo "dados.uf" inválido.' };
      out.uf = upperUf;
    }

    if (input.email !== undefined && input.email !== null) {
      const em = sanitizeCleanString(input.email, { minLen: 5, maxLen: 160, fieldName: 'dados.email' });
      if (em.ok === false) return em;
      if (MASKED_HINT_REGEX.test(em.value) || !EMAIL_REGEX.test(em.value)) {
        return { ok: false, error: 'Campo "dados.email" inválido.' };
      }
      out.email = em.value.toLowerCase();
    }

    if (input.telefone !== undefined && input.telefone !== null) {
      const tel = sanitizeCleanString(input.telefone, { minLen: 8, maxLen: 40, fieldName: 'dados.telefone' });
      if (tel.ok === false) return tel;
      if (MASKED_HINT_REGEX.test(tel.value)) {
        return { ok: false, error: 'Campo "dados.telefone" não pode estar mascarado.' };
      }
      out.telefone = tel.value;
    }

    return { ok: true, dados: out };
  }

  if (entidadeTipo === 'barragem') {
    if (mode === 'create' || input.nome !== undefined) {
      const nome = sanitizeCleanString(input.nome, { minLen: 2, maxLen: 200, fieldName: 'dados.nome' });
      if (nome.ok === false) return nome;
      out.nome = nome.value;
    }

    if (input.empreendedor_id !== undefined && input.empreendedor_id !== null) {
      const empId = sanitizeCleanString(input.empreendedor_id, {
        minLen: 2,
        maxLen: 120,
        fieldName: 'dados.empreendedor_id'
      });
      if (empId.ok === false) return empId;
      if (!SAFE_ID_REGEX.test(empId.value)) {
        return { ok: false, error: 'Campo "dados.empreendedor_id" inválido.' };
      }
      out.empreendedor_id = empId.value;
    }

    if (input.uf !== undefined && input.uf !== null) {
      const uf = sanitizeCleanString(input.uf, { minLen: 2, maxLen: 2, fieldName: 'dados.uf' });
      if (uf.ok === false) return uf;
      const upperUf = uf.value.toUpperCase();
      if (!UF_REGEX.test(upperUf)) return { ok: false, error: 'Campo "dados.uf" inválido.' };
      out.uf = upperUf;
    }

    for (const optText of [
      'car',
      'municipio',
      'municipio_ibge',
      'empreendimento',
      'processo',
      'snisb',
      'curso_agua',
      'latitude',
      'longitude',
      'observacoes'
    ] as const) {
      if (input[optText] !== undefined && input[optText] !== null) {
        const res = sanitizeCleanString(input[optText], {
          minLen: 1,
          maxLen: optText === 'observacoes' ? 1000 : 200,
          fieldName: `dados.${optText}`
        });
        if (res.ok === false) return res;
        out[optText] = res.value;
      }
    }

    if (input.altura !== undefined && input.altura !== null) {
      const num = typeof input.altura === 'number' ? input.altura : Number(input.altura);
      if (!Number.isFinite(num) || num <= 0 || num > 1000) {
        return { ok: false, error: 'Campo "dados.altura" deve ser numérico positivo até 1000m.' };
      }
      out.altura = num;
    }

    if (input.volume !== undefined && input.volume !== null) {
      const num = typeof input.volume === 'number' ? input.volume : Number(input.volume);
      if (!Number.isFinite(num) || num < 0 || num > 1e12) {
        return { ok: false, error: 'Campo "dados.volume" deve ser numérico não negativo válido.' };
      }
      out.volume = num;
    }

    if (input.dano_potencial !== undefined && input.dano_potencial !== null) {
      const dpa = sanitizeCleanString(input.dano_potencial, {
        minLen: 3,
        maxLen: 40,
        fieldName: 'dados.dano_potencial'
      });
      if (dpa.ok === false) return dpa;
      if (!ALLOWED_DPA_CRI.has(dpa.value)) {
        return { ok: false, error: 'Campo "dados.dano_potencial" inválido.' };
      }
      out.dano_potencial = dpa.value;
    }

    if (input.categoria_risco !== undefined && input.categoria_risco !== null) {
      const cri = sanitizeCleanString(input.categoria_risco, {
        minLen: 3,
        maxLen: 40,
        fieldName: 'dados.categoria_risco'
      });
      if (cri.ok === false) return cri;
      if (!ALLOWED_DPA_CRI.has(cri.value)) {
        return { ok: false, error: 'Campo "dados.categoria_risco" inválido.' };
      }
      out.categoria_risco = cri.value;
    }

    return { ok: true, dados: out };
  }

  // Entidade: rt
  if (mode === 'create' || input.nome !== undefined) {
    const nome = sanitizeCleanString(input.nome, { minLen: 3, maxLen: 200, fieldName: 'dados.nome' });
    if (nome.ok === false) return nome;
    out.nome = nome.value;
  }

  if (input.cpf !== undefined && input.cpf !== null) {
    if (typeof input.cpf !== 'string' || MASKED_HINT_REGEX.test(input.cpf)) {
      return { ok: false, error: 'Campo "dados.cpf" inválido ou mascarado.' };
    }
    const cpfDigits = input.cpf.replace(/\D/g, '');
    if (!isValidCpfDigits(cpfDigits)) {
      return { ok: false, error: 'Campo "dados.cpf" inválido.' };
    }
    out.cpf = cpfDigits;
  }

  for (const optText of ['conselho', 'uf_conselho', 'registro', 'especialidades', 'observacoes'] as const) {
    if (input[optText] !== undefined && input[optText] !== null) {
      const res = sanitizeCleanString(input[optText], {
        minLen: optText === 'uf_conselho' ? 2 : 1,
        maxLen: optText === 'observacoes' || optText === 'especialidades' ? 500 : 120,
        fieldName: `dados.${optText}`
      });
      if (res.ok === false) return res;
      out[optText] = optText === 'uf_conselho' || optText === 'conselho' ? res.value.toUpperCase() : res.value;
    }
  }

  if (input.email !== undefined && input.email !== null) {
    const em = sanitizeCleanString(input.email, { minLen: 5, maxLen: 160, fieldName: 'dados.email' });
    if (em.ok === false) return em;
    if (MASKED_HINT_REGEX.test(em.value) || !EMAIL_REGEX.test(em.value)) {
      return { ok: false, error: 'Campo "dados.email" inválido.' };
    }
    out.email = em.value.toLowerCase();
  }

  if (input.telefone !== undefined && input.telefone !== null) {
    const tel = sanitizeCleanString(input.telefone, { minLen: 8, maxLen: 40, fieldName: 'dados.telefone' });
    if (tel.ok === false) return tel;
    if (MASKED_HINT_REGEX.test(tel.value)) {
      return { ok: false, error: 'Campo "dados.telefone" não pode estar mascarado.' };
    }
    out.telefone = tel.value;
  }

  if (mode === 'create' && !out.cpf && !out.registro) {
    return {
      ok: false,
      error: 'Cadastro de RT exige CPF válido ou número de registro profissional.'
    };
  }

  return { ok: true, dados: out };
}

async function recordRejectedS2sAuditBestEffort(
  supabaseAdmin: SupabaseClient<any, any, any>,
  params: {
    sistema: S2sSistema;
    kid: string;
    jti: string;
    operacao: string;
    idempotencyKey: string;
    requestHashSha256: string;
    usuarioOrigem: string | null;
    matriculaOrigem: string | null;
    politicaId?: string | null;
    modoAplicado?: S2sModoExecucao | null;
    entidadeTipo?: string | null;
    registroId?: string | null;
    httpStatus: number;
    errorCode: string;
    errorMessage: string;
  }
): Promise<void> {
  try {
    const safeMsg = scrubSensitiveTextForServerLog(params.errorMessage).slice(0, 240);
    await supabaseAdmin.from('integracao_s2s_operacoes_log').insert({
      sistema_origem: params.sistema,
      kid: params.kid,
      jti: params.jti,
      operacao: params.operacao.slice(0, 80),
      politica_id: params.politicaId ?? null,
      modo_aplicado: params.modoAplicado ?? null,
      idempotency_key: params.idempotencyKey.slice(0, 128),
      request_hash_sha256: params.requestHashSha256,
      usuario_origem: params.usuarioOrigem ? params.usuarioOrigem.slice(0, 128) : null,
      matricula_origem: params.matriculaOrigem ? params.matriculaOrigem.slice(0, 64) : null,
      entidade_tipo: params.entidadeTipo ?? null,
      registro_id: params.registroId ? params.registroId.slice(0, 120) : null,
      status_execucao: params.httpStatus >= 500 ? 'erro' : 'rejeitado',
      http_status: params.httpStatus,
      resultado_resumo: {},
      erro_codigo: params.errorCode.slice(0, 64),
      erro_mensagem_sanitizada: safeMsg
    });
  } catch {
    // Auditoria best-effort em rejeições prévias nunca mascara a resposta controlada.
  }
}

function sendOperacaoRejection(
  res: VercelLikeResponse,
  httpStatus: number,
  code: string,
  error: string
): void {
  sendV2Json(res, httpStatus, {
    success: false,
    code,
    error: scrubSensitiveTextForServerLog(error)
  });
}

function evaluatePolicyRestrictions(
  politica: PolicyRow,
  context: {
    usuarioOrigem: string;
    matriculaOrigem: string | null;
    proposedKeys?: string[];
  }
): { ok: true } | { ok: false; code: string; error: string } {
  const restr = politica.restricoes && typeof politica.restricoes === 'object' ? politica.restricoes : {};

  if (restr.exigir_matricula_origem === true && !context.matriculaOrigem) {
    return {
      ok: false,
      code: 'MATRICULA_REQUIRED_BY_POLICY',
      error: 'A política S2S exige matrícula do servidor/usuário de origem.'
    };
  }

  if (Array.isArray(restr.usuarios_autorizados) && restr.usuarios_autorizados.length > 0) {
    const allowedUsers = new Set(
      restr.usuarios_autorizados.map((u: unknown) => String(u ?? '').trim().toLowerCase()).filter(Boolean)
    );
    if (!allowedUsers.has(context.usuarioOrigem.toLowerCase())) {
      return {
        ok: false,
        code: 'ACTOR_NOT_ALLOWED_BY_POLICY',
        error: 'Usuário de origem não autorizado pela política S2S vigente.'
      };
    }
  }

  if (Array.isArray(restr.campos_permitidos) && context.proposedKeys && context.proposedKeys.length > 0) {
    const allowedByPolicy = new Set(
      restr.campos_permitidos.map((c: unknown) => String(c ?? '').trim()).filter(Boolean)
    );
    for (const k of context.proposedKeys) {
      if (!allowedByPolicy.has(k)) {
        return {
          ok: false,
          code: 'FIELD_FORBIDDEN_BY_POLICY',
          error: `Campo "${k}" não autorizado pela política S2S vigente.`
        };
      }
    }
  }

  return { ok: true };
}

export async function handleS2sOperacoesRequest(
  req: S2sRequestLike,
  res: VercelLikeResponse
): Promise<void> {
  const method = String(req?.method || 'GET').trim().toUpperCase();
  if (method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendV2Json(res, 405, {
      success: false,
      code: 'METHOD_NOT_ALLOWED',
      error: 'Método não permitido. Utilize POST.'
    });
    return;
  }

  const auth = await authenticateS2sRequest(req, {
    requiredScope: S2S_OPERACOES_WRITE_SCOPE,
    maxBodyBytes: S2S_OPERACOES_MAX_BODY_BYTES
  });

  if (auth.ok === false) {
    if (auth.httpStatus === 503) {
      sendV2Unavailable(res);
      return;
    }
    sendOperacaoRejection(res, auth.httpStatus, auth.code, auth.error);
    return;
  }

  const { context, supabaseAdmin, rawBody } = auth;
  const requestHashSha256 = sha256BodyHexLower(rawBody);

  let body: Record<string, any>;
  try {
    body = parseStrictUtf8JsonObject(rawBody, {
      allowEmpty: false,
      invalidJsonMessage: 'Corpo JSON inválido.',
      invalidObjectMessage: 'O corpo da operação S2S deve ser um objeto JSON válido.'
    });
  } catch (err: any) {
    const status = err instanceof JsonBodyReaderError ? err.statusCode : 400;
    const msg = err instanceof JsonBodyReaderError ? err.message : 'Corpo JSON inválido.';
    await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
      sistema: context.sistema,
      kid: context.kid,
      jti: context.jti,
      operacao: 'desconhecida',
      idempotencyKey: `invalid-${context.jti}`,
      requestHashSha256,
      usuarioOrigem: context.consumer.consumerUserId,
      matriculaOrigem: null,
      httpStatus: status,
      errorCode: 'INVALID_JSON',
      errorMessage: msg
    });
    sendOperacaoRejection(res, status, 'INVALID_JSON', msg);
    return;
  }

  // Rejeita tentativa de forjar modo, papel, aprovação ou sistema no payload
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_TOP_LEVEL_KEYS.has(key)) {
      await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
        sistema: context.sistema,
        kid: context.kid,
        jti: context.jti,
        operacao: String(body.operacao || 'desconhecida'),
        idempotencyKey: `forbidden-${context.jti}`,
        requestHashSha256,
        usuarioOrigem: context.consumer.consumerUserId,
        matriculaOrigem: null,
        httpStatus: 400,
        errorCode: 'FORBIDDEN_CONTROL_FIELDS',
        errorMessage: `Campo de controle "${key}" não pode ser informado pelo chamador.`
      });
      sendOperacaoRejection(
        res,
        400,
        'FORBIDDEN_CONTROL_FIELDS',
        `Campo de controle "${key}" não pode ser informado pelo chamador.`
      );
      return;
    }
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
        sistema: context.sistema,
        kid: context.kid,
        jti: context.jti,
        operacao: String(body.operacao || 'desconhecida'),
        idempotencyKey: `unknown-key-${context.jti}`,
        requestHashSha256,
        usuarioOrigem: context.consumer.consumerUserId,
        matriculaOrigem: null,
        httpStatus: 400,
        errorCode: 'INVALID_PAYLOAD',
        errorMessage: `Propriedade "${key}" não é suportada no envelope S2S.`
      });
      sendOperacaoRejection(
        res,
        400,
        'INVALID_PAYLOAD',
        `Propriedade "${key}" não é suportada no envelope S2S.`
      );
      return;
    }
  }

  // Validar idempotencyKey (header e/ou body)
  const headerIdem = getHeaderSingle(req.headers, 'x-idempotency-key');
  const bodyIdem = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : null;
  if (headerIdem === '') {
    sendOperacaoRejection(res, 400, 'INVALID_IDEMPOTENCY_KEY', 'Cabeçalho X-Idempotency-Key inválido.');
    return;
  }
  if (headerIdem && bodyIdem && headerIdem !== bodyIdem) {
    sendOperacaoRejection(
      res,
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Cabeçalho X-Idempotency-Key diverge de idempotencyKey no corpo.'
    );
    return;
  }
  const idempotencyKey = headerIdem || bodyIdem || '';
  if (!IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) {
    await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
      sistema: context.sistema,
      kid: context.kid,
      jti: context.jti,
      operacao: String(body.operacao || 'desconhecida'),
      idempotencyKey: `invalid-idem-${context.jti}`,
      requestHashSha256,
      usuarioOrigem: context.consumer.consumerUserId,
      matriculaOrigem: null,
      httpStatus: 400,
      errorCode: 'INVALID_IDEMPOTENCY_KEY',
      errorMessage: 'idempotencyKey obrigatória (8 a 128 caracteres alfanuméricos, ponto, hífen ou dois-pontos).'
    });
    sendOperacaoRejection(
      res,
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'idempotencyKey obrigatória (8 a 128 caracteres alfanuméricos, ponto, hífen ou dois-pontos).'
    );
    return;
  }

  // Validar autor de origem
  const rawAutor = body.autorOrigem;
  if (!rawAutor || typeof rawAutor !== 'object' || Array.isArray(rawAutor)) {
    await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
      sistema: context.sistema,
      kid: context.kid,
      jti: context.jti,
      operacao: String(body.operacao || 'desconhecida'),
      idempotencyKey,
      requestHashSha256,
      usuarioOrigem: context.consumer.consumerUserId,
      matriculaOrigem: null,
      httpStatus: 400,
      errorCode: 'ACTOR_REQUIRED',
      errorMessage: 'Objeto "autorOrigem" com identificação do usuário de origem é obrigatório.'
    });
    sendOperacaoRejection(
      res,
      400,
      'ACTOR_REQUIRED',
      'Objeto "autorOrigem" com identificação do usuário de origem é obrigatório.'
    );
    return;
  }
  const autorKeys = Object.keys(rawAutor);
  for (const k of autorKeys) {
    if (k !== 'usuario' && k !== 'matricula') {
      sendOperacaoRejection(
        res,
        400,
        'INVALID_PAYLOAD',
        `Campo "${k}" não é permitido em autorOrigem.`
      );
      return;
    }
  }

  const usuarioOrigem =
    typeof rawAutor.usuario === 'string' ? rawAutor.usuario.trim() : '';
  if (!SAFE_ACTOR_REGEX.test(usuarioOrigem)) {
    sendOperacaoRejection(
      res,
      400,
      'ACTOR_REQUIRED',
      'Campo "autorOrigem.usuario" inválido ou ausente.'
    );
    return;
  }

  if (
    context.consumer.consumerUserId &&
    context.consumer.consumerUserId.toLowerCase() !== usuarioOrigem.toLowerCase()
  ) {
    sendOperacaoRejection(
      res,
      400,
      'ACTOR_MISMATCH',
      'Identificador de usuário em autorOrigem.usuario diverge do cabeçalho assinado x-consumer-user-id.'
    );
    return;
  }

  let matriculaOrigem: string | null = null;
  if (rawAutor.matricula !== undefined && rawAutor.matricula !== null) {
    const mat = typeof rawAutor.matricula === 'string' ? rawAutor.matricula.trim() : '';
    if (!SAFE_MATRICULA_REGEX.test(mat)) {
      sendOperacaoRejection(res, 400, 'INVALID_PAYLOAD', 'Campo "autorOrigem.matricula" inválido.');
      return;
    }
    matriculaOrigem = mat;
  }

  // Validar operação na allowlist
  const operacaoRaw = typeof body.operacao === 'string' ? body.operacao.trim() : '';
  const spec = Object.prototype.hasOwnProperty.call(S2S_OPERATIONS_REGISTRY, operacaoRaw)
    ? S2S_OPERATIONS_REGISTRY[operacaoRaw as S2sOperacaoNome]
    : null;

  if (!spec) {
    await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
      sistema: context.sistema,
      kid: context.kid,
      jti: context.jti,
      operacao: operacaoRaw || 'desconhecida',
      idempotencyKey,
      requestHashSha256,
      usuarioOrigem,
      matriculaOrigem,
      httpStatus: 403,
      errorCode: 'OPERATION_UNKNOWN',
      errorMessage: 'Operação desconhecida ou não autorizada.'
    });
    sendOperacaoRejection(res, 403, 'OPERATION_UNKNOWN', 'Operação desconhecida ou não autorizada.');
    return;
  }

  if (spec.status !== 'liberada' || !spec.requiredMode) {
    const reason = spec.blockedReason || 'Operação bloqueada nesta etapa.';
    await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
      sistema: context.sistema,
      kid: context.kid,
      jti: context.jti,
      operacao: spec.operacao,
      idempotencyKey,
      requestHashSha256,
      usuarioOrigem,
      matriculaOrigem,
      httpStatus: 403,
      errorCode: 'OPERATION_BLOCKED',
      errorMessage: reason
    });
    sendOperacaoRejection(res, 403, 'OPERATION_BLOCKED', reason);
    return;
  }

  // Consultar política ativa no banco (default-deny: ausência ou inatividade bloqueia)
  let policyRows: PolicyRow[] | null = null;
  let policyErr: any = null;
  try {
    const resPol = await supabaseAdmin
      .from('integracao_s2s_politicas')
      .select('id, sistema_origem, operacao, modo, ativo, parametros, restricoes')
      .eq('sistema_origem', context.sistema)
      .eq('operacao', spec.operacao)
      .limit(2);
    policyRows = resPol.data as PolicyRow[] | null;
    policyErr = resPol.error;
  } catch {
    sendV2Unavailable(res);
    return;
  }

  if (policyErr) {
    sendV2Unavailable(res);
    return;
  }

  if (!policyRows || policyRows.length !== 1) {
    const msg = 'Operação bloqueada por padrão: política S2S ausente para este sistema e operação.';
    await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
      sistema: context.sistema,
      kid: context.kid,
      jti: context.jti,
      operacao: spec.operacao,
      idempotencyKey,
      requestHashSha256,
      usuarioOrigem,
      matriculaOrigem,
      httpStatus: 403,
      errorCode: 'POLICY_NOT_FOUND',
      errorMessage: msg
    });
    sendOperacaoRejection(res, 403, 'POLICY_NOT_FOUND', msg);
    return;
  }

  const politica = policyRows[0];
  if (politica.ativo !== true) {
    const msg = 'Operação bloqueada: política S2S desativada.';
    await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
      sistema: context.sistema,
      kid: context.kid,
      jti: context.jti,
      operacao: spec.operacao,
      politicaId: politica.id,
      modoAplicado: politica.modo,
      idempotencyKey,
      requestHashSha256,
      usuarioOrigem,
      matriculaOrigem,
      httpStatus: 403,
      errorCode: 'POLICY_INACTIVE',
      errorMessage: msg
    });
    sendOperacaoRejection(res, 403, 'POLICY_INACTIVE', msg);
    return;
  }

  if (politica.modo !== spec.requiredMode) {
    const msg =
      spec.requiredMode === 'proposta_aprovacao'
        ? 'Alteração direta proibida: operação exige política no modo proposta_aprovacao.'
        : 'Modo da política incompatível com a operação solicitada.';
    await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
      sistema: context.sistema,
      kid: context.kid,
      jti: context.jti,
      operacao: spec.operacao,
      politicaId: politica.id,
      modoAplicado: politica.modo,
      idempotencyKey,
      requestHashSha256,
      usuarioOrigem,
      matriculaOrigem,
      httpStatus: 403,
      errorCode: 'POLICY_MODE_MISMATCH',
      errorMessage: msg
    });
    sendOperacaoRejection(res, 403, 'POLICY_MODE_MISMATCH', msg);
    return;
  }

  // Validar payload específico da operação
  if (
    spec.operacao === 'cadastrar_empreendedor' ||
    spec.operacao === 'cadastrar_barragem' ||
    spec.operacao === 'cadastrar_rt'
  ) {
    const entityCheck = validateEntityFields(spec.entidadeTipo!, body.dados, 'create');
    if (entityCheck.ok === false) {
      await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
        sistema: context.sistema,
        kid: context.kid,
        jti: context.jti,
        operacao: spec.operacao,
        politicaId: politica.id,
        modoAplicado: politica.modo,
        idempotencyKey,
        requestHashSha256,
        usuarioOrigem,
        matriculaOrigem,
        entidadeTipo: spec.entidadeTipo,
        httpStatus: 400,
        errorCode: 'INVALID_PAYLOAD',
        errorMessage: entityCheck.error
      });
      sendOperacaoRejection(res, 400, 'INVALID_PAYLOAD', entityCheck.error);
      return;
    }

    let motivo: string | null = null;
    if (body.motivo !== undefined && body.motivo !== null) {
      const m = sanitizeCleanString(body.motivo, { minLen: 3, maxLen: 500, fieldName: 'motivo' });
      if (m.ok === false) {
        sendOperacaoRejection(res, 400, 'INVALID_PAYLOAD', m.error);
        return;
      }
      motivo = m.value;
    }

    const restrCheck = evaluatePolicyRestrictions(politica, {
      usuarioOrigem,
      matriculaOrigem,
      proposedKeys: Object.keys(entityCheck.dados)
    });
    if (restrCheck.ok === false) {
      await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
        sistema: context.sistema,
        kid: context.kid,
        jti: context.jti,
        operacao: spec.operacao,
        politicaId: politica.id,
        modoAplicado: politica.modo,
        idempotencyKey,
        requestHashSha256,
        usuarioOrigem,
        matriculaOrigem,
        entidadeTipo: spec.entidadeTipo,
        httpStatus: 403,
        errorCode: restrCheck.code,
        errorMessage: restrCheck.error
      });
      sendOperacaoRejection(res, 403, restrCheck.code, restrCheck.error);
      return;
    }

    const payloadDados = { ...entityCheck.dados };
    if (body.referenciaExterna !== undefined && body.referenciaExterna !== null) {
      const ref = sanitizeCleanString(body.referenciaExterna, {
        minLen: 1,
        maxLen: 160,
        fieldName: 'referenciaExterna'
      });
      if (ref.ok === false) {
        sendOperacaoRejection(res, 400, 'INVALID_PAYLOAD', ref.error);
        return;
      }
      payloadDados.referencia_externa = ref.value;
    }

    try {
      const { data, error } = await supabaseAdmin.rpc('s2s_executar_cadastro_novo', {
        p_sistema_origem: context.sistema,
        p_kid: context.kid,
        p_jti: context.jti,
        p_operacao: spec.operacao,
        p_idempotency_key: idempotencyKey,
        p_request_hash_sha256: requestHashSha256,
        p_usuario_origem: usuarioOrigem,
        p_matricula_origem: matriculaOrigem,
        p_dados: payloadDados,
        p_motivo: motivo
      });

      if (error || !data || typeof data !== 'object') {
        await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
          sistema: context.sistema,
          kid: context.kid,
          jti: context.jti,
          operacao: spec.operacao,
          politicaId: politica.id,
          modoAplicado: politica.modo,
          idempotencyKey,
          requestHashSha256,
          usuarioOrigem,
          matriculaOrigem,
          entidadeTipo: spec.entidadeTipo,
          httpStatus: 503,
          errorCode: 'TRANSACTION_FAILED',
          errorMessage: 'Falha transacional ao executar cadastro S2S; operação revertida.'
        });
        sendV2Unavailable(res);
        return;
      }

      if (data.success !== true) {
        const status = Number(data.http_status) || 400;
        const code = String(data.code || 'OPERATION_REJECTED');
        const msg = String(data.error || 'Operação S2S rejeitada.');
        await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
          sistema: context.sistema,
          kid: context.kid,
          jti: context.jti,
          operacao: spec.operacao,
          politicaId: politica.id,
          modoAplicado: politica.modo,
          idempotencyKey,
          requestHashSha256,
          usuarioOrigem,
          matriculaOrigem,
          entidadeTipo: spec.entidadeTipo,
          httpStatus: status,
          errorCode: code,
          errorMessage: msg
        });
        sendOperacaoRejection(res, status, code, msg);
        return;
      }

      const status = data.idempotent_replay ? 200 : Number(data.http_status) || 201;
      sendV2Json(res, status, {
        success: true,
        apiVersion: '2.0',
        operacao: spec.operacao,
        modo: 'execucao_direta',
        idempotentReplay: Boolean(data.idempotent_replay),
        entidadeTipo: data.entidade_tipo,
        tabelaNome: data.tabela_nome,
        registroId: data.registro_id,
        situacao: data.situacao || 'Ativo',
        sistemaOrigem: context.sistema,
        usuarioOrigem,
        matriculaOrigem,
        historicoId: data.historico_id ?? null,
        idempotencyKey
      });
      return;
    } catch {
      sendV2Unavailable(res);
      return;
    }
  }

  if (
    spec.operacao === 'propor_alteracao_empreendedor' ||
    spec.operacao === 'propor_alteracao_barragem' ||
    spec.operacao === 'propor_alteracao_rt'
  ) {
    const regCheck = sanitizeCleanString(body.registroId, {
      minLen: 2,
      maxLen: 120,
      fieldName: 'registroId'
    });
    if (regCheck.ok === false || !SAFE_ID_REGEX.test(regCheck.value)) {
      sendOperacaoRejection(
        res,
        400,
        'INVALID_PAYLOAD',
        'Campo "registroId" válido é obrigatório para propor alteração.'
      );
      return;
    }

    const justCheck = sanitizeCleanString(body.justificativa, {
      minLen: 5,
      maxLen: 1000,
      fieldName: 'justificativa'
    });
    if (justCheck.ok === false) {
      sendOperacaoRejection(res, 400, 'INVALID_PAYLOAD', justCheck.error);
      return;
    }

    const entityCheck = validateEntityFields(spec.entidadeTipo!, body.dados, 'propose_update');
    if (entityCheck.ok === false) {
      sendOperacaoRejection(res, 400, 'INVALID_PAYLOAD', entityCheck.error);
      return;
    }

    let referenciaExterna: string | null = null;
    if (body.referenciaExterna !== undefined && body.referenciaExterna !== null) {
      const ref = sanitizeCleanString(body.referenciaExterna, {
        minLen: 1,
        maxLen: 160,
        fieldName: 'referenciaExterna'
      });
      if (ref.ok === false) {
        sendOperacaoRejection(res, 400, 'INVALID_PAYLOAD', ref.error);
        return;
      }
      referenciaExterna = ref.value;
    }

    const restrCheck = evaluatePolicyRestrictions(politica, {
      usuarioOrigem,
      matriculaOrigem,
      proposedKeys: Object.keys(entityCheck.dados)
    });
    if (restrCheck.ok === false) {
      await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
        sistema: context.sistema,
        kid: context.kid,
        jti: context.jti,
        operacao: spec.operacao,
        politicaId: politica.id,
        modoAplicado: politica.modo,
        idempotencyKey,
        requestHashSha256,
        usuarioOrigem,
        matriculaOrigem,
        entidadeTipo: spec.entidadeTipo,
        registroId: regCheck.value,
        httpStatus: 403,
        errorCode: restrCheck.code,
        errorMessage: restrCheck.error
      });
      sendOperacaoRejection(res, 403, restrCheck.code, restrCheck.error);
      return;
    }

    try {
      const { data, error } = await supabaseAdmin.rpc('s2s_criar_solicitacao_alteracao', {
        p_sistema_origem: context.sistema,
        p_kid: context.kid,
        p_jti: context.jti,
        p_operacao: spec.operacao,
        p_idempotency_key: idempotencyKey,
        p_request_hash_sha256: requestHashSha256,
        p_usuario_origem: usuarioOrigem,
        p_matricula_origem: matriculaOrigem,
        p_registro_id: regCheck.value,
        p_dados_propostos: entityCheck.dados,
        p_justificativa: justCheck.value,
        p_referencia_externa: referenciaExterna
      });

      if (error || !data || typeof data !== 'object') {
        await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
          sistema: context.sistema,
          kid: context.kid,
          jti: context.jti,
          operacao: spec.operacao,
          politicaId: politica.id,
          modoAplicado: politica.modo,
          idempotencyKey,
          requestHashSha256,
          usuarioOrigem,
          matriculaOrigem,
          entidadeTipo: spec.entidadeTipo,
          registroId: regCheck.value,
          httpStatus: 503,
          errorCode: 'TRANSACTION_FAILED',
          errorMessage: 'Falha transacional ao registrar proposta de alteração S2S.'
        });
        sendV2Unavailable(res);
        return;
      }

      if (data.success !== true) {
        const status = Number(data.http_status) || 400;
        const code = String(data.code || 'OPERATION_REJECTED');
        const msg = String(data.error || 'Proposta S2S rejeitada.');
        await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
          sistema: context.sistema,
          kid: context.kid,
          jti: context.jti,
          operacao: spec.operacao,
          politicaId: politica.id,
          modoAplicado: politica.modo,
          idempotencyKey,
          requestHashSha256,
          usuarioOrigem,
          matriculaOrigem,
          entidadeTipo: spec.entidadeTipo,
          registroId: regCheck.value,
          httpStatus: status,
          errorCode: code,
          errorMessage: msg
        });
        sendOperacaoRejection(res, status, code, msg);
        return;
      }

      const status = data.idempotent_replay ? 200 : Number(data.http_status) || 202;
      sendV2Json(res, status, {
        success: true,
        apiVersion: '2.0',
        operacao: spec.operacao,
        modo: 'proposta_aprovacao',
        idempotentReplay: Boolean(data.idempotent_replay),
        solicitacaoId: data.solicitacao_id,
        status: data.status || 'Pendente',
        entidadeTipo: data.entidade_tipo,
        tabelaNome: data.tabela_nome,
        registroId: data.registro_id,
        sistemaOrigem: context.sistema,
        usuarioOrigem,
        matriculaOrigem,
        idempotencyKey
      });
      return;
    } catch {
      sendV2Unavailable(res);
      return;
    }
  }

  // cancelar_solicitacao_pendente
  const solicIdRaw = typeof body.solicitacaoId === 'string' ? body.solicitacaoId.trim() : '';
  if (!UUID_REGEX.test(solicIdRaw)) {
    sendOperacaoRejection(
      res,
      400,
      'INVALID_PAYLOAD',
      'Campo "solicitacaoId" (UUID válido) é obrigatório.'
    );
    return;
  }

  const motivoCheck = sanitizeCleanString(body.motivo, {
    minLen: 5,
    maxLen: 1000,
    fieldName: 'motivo'
  });
  if (motivoCheck.ok === false) {
    sendOperacaoRejection(res, 400, 'INVALID_PAYLOAD', motivoCheck.error);
    return;
  }

  const restrCheck = evaluatePolicyRestrictions(politica, {
    usuarioOrigem,
    matriculaOrigem
  });
  if (restrCheck.ok === false) {
    sendOperacaoRejection(res, 403, restrCheck.code, restrCheck.error);
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('s2s_cancelar_solicitacao_pendente', {
      p_sistema_origem: context.sistema,
      p_kid: context.kid,
      p_jti: context.jti,
      p_idempotency_key: idempotencyKey,
      p_request_hash_sha256: requestHashSha256,
      p_solicitacao_id: solicIdRaw,
      p_usuario_origem: usuarioOrigem,
      p_matricula_origem: matriculaOrigem,
      p_motivo: motivoCheck.value
    });

    if (error || !data || typeof data !== 'object') {
      sendV2Unavailable(res);
      return;
    }

    if (data.success !== true) {
      const status = Number(data.http_status) || 400;
      const code = String(data.code || 'OPERATION_REJECTED');
      const msg = String(data.error || 'Cancelamento S2S rejeitado.');
      await recordRejectedS2sAuditBestEffort(supabaseAdmin, {
        sistema: context.sistema,
        kid: context.kid,
        jti: context.jti,
        operacao: spec.operacao,
        politicaId: politica.id,
        modoAplicado: politica.modo,
        idempotencyKey,
        requestHashSha256,
        usuarioOrigem,
        matriculaOrigem,
        httpStatus: status,
        errorCode: code,
        errorMessage: msg
      });
      sendOperacaoRejection(res, status, code, msg);
      return;
    }

    sendV2Json(res, 200, {
      success: true,
      apiVersion: '2.0',
      operacao: spec.operacao,
      modo: 'execucao_direta',
      idempotentReplay: Boolean(data.idempotent_replay),
      solicitacaoId: data.solicitacao_id,
      status: data.status || 'Cancelada',
      sistemaOrigem: context.sistema,
      usuarioOrigem,
      matriculaOrigem,
      motivo: data.motivo || motivoCheck.value,
      idempotencyKey
    });
  } catch {
    sendV2Unavailable(res);
  }
}

function hasAnyS2sHeader(
  headers: Record<string, string | string[] | undefined> | undefined
): boolean {
  if (!headers) return false;
  return Boolean(
    getHeaderSingle(headers, 'x-s2s-signature') ||
      getHeaderSingle(headers, 'x-s2s-key-id') ||
      getHeaderSingle(headers, 'x-s2s-jti')
  );
}

async function readAdminJsonBody(
  req: StreamReadableLike & { body?: any }
): Promise<Record<string, any>> {
  const preParsed = Object.getOwnPropertyDescriptor(req, 'body')?.value;
  if (preParsed !== undefined && typeof req.on !== 'function') {
    if (!preParsed || typeof preParsed !== 'object' || Array.isArray(preParsed)) {
      throw new JsonBodyReaderError(400, 'Corpo JSON inválido.', 'INVALID_JSON_OBJECT');
    }
    return preParsed as Record<string, any>;
  }
  return await readJsonObjectBody(req, {
    maxBytes: ADMIN_JSON_MAX_BODY_BYTES,
    allowEmpty: false
  });
}

function sanitizeSolicitacaoSummaryForAdmin(row: Record<string, any>): Record<string, any> {
  return {
    id: row.id,
    sistemaOrigem: row.sistema_origem,
    operacao: row.operacao,
    entidadeTipo: row.entidade_tipo,
    tabelaNome: row.tabela_nome,
    registroId: row.registro_id,
    usuarioOrigem: scrubSensitiveTextForServerLog(String(row.usuario_origem || '')),
    matriculaOrigem: row.matricula_origem || null,
    referenciaExterna: row.referencia_externa
      ? scrubSensitiveTextForServerLog(String(row.referencia_externa))
      : null,
    justificativa: scrubSensitiveTextForServerLog(String(row.justificativa || '')),
    camposPropostos:
      row.dados_propostos && typeof row.dados_propostos === 'object'
        ? Object.keys(row.dados_propostos)
        : [],
    status: row.status,
    solicitadoEm: row.solicitado_em,
    canceladoEm: row.cancelado_em ?? null,
    motivoCancelamento: row.motivo_cancelamento
      ? scrubSensitiveTextForServerLog(String(row.motivo_cancelamento))
      : null,
    analisadoEm: row.analisado_em ?? null,
    analisadoPorLogin: row.analisado_por_login ?? null,
    observacaoAnalise: row.observacao_analise
      ? scrubSensitiveTextForServerLog(String(row.observacao_analise))
      : null,
    historicoId: row.historico_id ?? null
  };
}

export async function handleAdminPoliticasRequest(
  req: S2sRequestLike & { body?: any },
  res: VercelLikeResponse
): Promise<void> {
  const method = String(req?.method || 'GET').trim().toUpperCase();
  if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') {
    res.setHeader('Allow', 'GET, POST, PATCH');
    sendV2Json(res, 405, {
      success: false,
      code: 'METHOD_NOT_ALLOWED',
      error: 'Método não permitido. Utilize GET, POST ou PATCH.'
    });
    return;
  }

  // Sistemas S2S nunca podem gerenciar ou aprovar políticas
  if (hasAnyS2sHeader(req?.headers)) {
    sendOperacaoRejection(
      res,
      403,
      'S2S_FORBIDDEN',
      'Sistemas S2S não podem consultar ou alterar políticas administrativas.'
    );
    return;
  }

  const auth = await authorizeSemaLookupRequest(req as any);
  if (!auth.configured) {
    sendV2Unavailable(res);
    return;
  }
  if (!auth.authorized || !auth.userId) {
    sendOperacaoRejection(
      res,
      auth.httpStatus || 401,
      auth.authErrorCode || 'SESSION_REQUIRED',
      auth.error || 'Sessão institucional obrigatória.'
    );
    return;
  }
  if (!auth.supabaseAdmin) {
    sendV2Unavailable(res);
    return;
  }
  if (auth.role !== 'Administrador') {
    sendOperacaoRejection(
      res,
      403,
      'ADMIN_REQUIRED',
      'Apenas Administrador ativo no Administra pode gerenciar políticas S2S.'
    );
    return;
  }

  if (method === 'GET') {
    try {
      const { data, error } = await auth.supabaseAdmin
        .from('integracao_s2s_politicas')
        .select(
          'id, sistema_origem, operacao, modo, ativo, parametros, restricoes, criado_por_login, atualizado_por_login, motivo_ultima_alteracao, created_at, updated_at'
        )
        .order('sistema_origem', { ascending: true });

      if (error || !Array.isArray(data)) {
        sendV2Unavailable(res);
        return;
      }

      sendV2Json(res, 200, {
        success: true,
        apiVersion: '2.0',
        politicas: data,
        allowlist: Object.values(S2S_OPERATIONS_REGISTRY)
      });
    } catch {
      sendV2Unavailable(res);
    }
    return;
  }

  let body: Record<string, any>;
  try {
    body = await readAdminJsonBody(req);
  } catch (err: any) {
    const status = err instanceof JsonBodyReaderError ? err.statusCode : 400;
    const msg = err instanceof JsonBodyReaderError ? err.message : 'Corpo JSON inválido.';
    sendOperacaoRejection(res, status, 'INVALID_PAYLOAD', msg);
    return;
  }

  const sistemaOrigem = String(body.sistemaOrigem || '').trim().toLowerCase();
  const operacao = String(body.operacao || '').trim();
  const modo = String(body.modo || '').trim();
  const ativo = Boolean(body.ativo);
  const parametros = body.parametros ?? {};
  const restricoes = body.restricoes ?? {};
  const motivo = body.motivo !== undefined && body.motivo !== null ? String(body.motivo).trim() : null;

  if (!['notifica', 'classifica', 'fiscaliza'].includes(sistemaOrigem)) {
    sendOperacaoRejection(res, 400, 'INVALID_SYSTEM', 'Sistema de origem inválido.');
    return;
  }

  const spec = Object.prototype.hasOwnProperty.call(S2S_OPERATIONS_REGISTRY, operacao)
    ? S2S_OPERATIONS_REGISTRY[operacao as S2sOperacaoNome]
    : null;
  if (!spec) {
    sendOperacaoRejection(res, 400, 'OPERATION_UNKNOWN', 'Operação desconhecida na allowlist.');
    return;
  }

  if (spec.status !== 'liberada' && ativo) {
    sendOperacaoRejection(
      res,
      422,
      'OPERATION_BLOCKED',
      spec.blockedReason || 'Operação bloqueada não pode ser ativada.'
    );
    return;
  }

  if (modo !== 'execucao_direta' && modo !== 'proposta_aprovacao') {
    sendOperacaoRejection(
      res,
      400,
      'POLICY_MODE_INVALID',
      'Campo "modo" deve ser "execucao_direta" ou "proposta_aprovacao".'
    );
    return;
  }

  if (spec.requiredMode && modo !== spec.requiredMode) {
    sendOperacaoRejection(
      res,
      422,
      'POLICY_MODE_INVALID',
      `A operação "${spec.operacao}" exige modo "${spec.requiredMode}".`
    );
    return;
  }

  if (
    !parametros ||
    typeof parametros !== 'object' ||
    Array.isArray(parametros) ||
    !restricoes ||
    typeof restricoes !== 'object' ||
    Array.isArray(restricoes)
  ) {
    sendOperacaoRejection(
      res,
      400,
      'INVALID_POLICY_JSON',
      'parametros e restricoes devem ser objetos JSON válidos.'
    );
    return;
  }

  try {
    const { data, error } = await auth.supabaseAdmin.rpc('admin_upsert_politica_s2s', {
      p_admin_auth_user_id: auth.userId,
      p_sistema_origem: sistemaOrigem,
      p_operacao: operacao,
      p_modo: modo,
      p_ativo: ativo,
      p_parametros: parametros,
      p_restricoes: restricoes,
      p_motivo: motivo
    });

    if (error || !data || typeof data !== 'object') {
      sendV2Unavailable(res);
      return;
    }

    if (data.success !== true) {
      sendOperacaoRejection(
        res,
        Number(data.http_status) || 400,
        String(data.code || 'POLICY_UPDATE_FAILED'),
        String(data.error || 'Falha ao atualizar política S2S.')
      );
      return;
    }

    sendV2Json(res, 200, {
      success: true,
      apiVersion: '2.0',
      politica: data.politica
    });
  } catch {
    sendV2Unavailable(res);
  }
}

export async function handleAdminSolicitacoesRequest(
  req: S2sRequestLike & { body?: any },
  res: VercelLikeResponse
): Promise<void> {
  const method = String(req?.method || 'GET').trim().toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendV2Json(res, 405, {
      success: false,
      code: 'METHOD_NOT_ALLOWED',
      error: 'Método não permitido. Utilize GET ou POST.'
    });
    return;
  }

  // Sistemas S2S ou chamadas externas nunca podem aprovar/decidir solicitações
  if (hasAnyS2sHeader(req?.headers)) {
    sendOperacaoRejection(
      res,
      403,
      'S2S_FORBIDDEN',
      'Sistemas S2S não podem aprovar ou decidir solicitações cadastrais.'
    );
    return;
  }

  const auth = await authorizeSemaLookupRequest(req as any);
  if (!auth.configured) {
    sendV2Unavailable(res);
    return;
  }
  if (!auth.authorized || !auth.userId) {
    sendOperacaoRejection(
      res,
      auth.httpStatus || 401,
      auth.authErrorCode || 'SESSION_REQUIRED',
      auth.error || 'Sessão institucional obrigatória.'
    );
    return;
  }
  if (!auth.supabaseAdmin) {
    sendV2Unavailable(res);
    return;
  }
  if (auth.role !== 'Administrador') {
    sendOperacaoRejection(
      res,
      403,
      'ADMIN_REQUIRED',
      'Apenas Administrador ativo no Administra pode visualizar ou aprovar solicitações S2S.'
    );
    return;
  }

  if (method === 'GET') {
    try {
      const { data, error } = await auth.supabaseAdmin
        .from('integracao_s2s_solicitacoes')
        .select(
          'id, sistema_origem, operacao, entidade_tipo, tabela_nome, registro_id, usuario_origem, matricula_origem, referencia_externa, justificativa, dados_propostos, status, solicitado_em, cancelado_em, motivo_cancelamento, analisado_em, analisado_por_login, observacao_analise, historico_id'
        )
        .order('solicitado_em', { ascending: false })
        .limit(100);

      if (error || !Array.isArray(data)) {
        sendV2Unavailable(res);
        return;
      }

      sendV2Json(res, 200, {
        success: true,
        apiVersion: '2.0',
        solicitacoes: data.map(row => sanitizeSolicitacaoSummaryForAdmin(row as Record<string, any>))
      });
    } catch {
      sendV2Unavailable(res);
    }
    return;
  }

  let body: Record<string, any>;
  try {
    body = await readAdminJsonBody(req);
  } catch (err: any) {
    const status = err instanceof JsonBodyReaderError ? err.statusCode : 400;
    const msg = err instanceof JsonBodyReaderError ? err.message : 'Corpo JSON inválido.';
    sendOperacaoRejection(res, status, 'INVALID_PAYLOAD', msg);
    return;
  }

  const solicitacaoId = typeof body.solicitacaoId === 'string' ? body.solicitacaoId.trim() : '';
  const decisao = typeof body.decisao === 'string' ? body.decisao.trim().toLowerCase() : '';
  const observacao =
    body.observacao !== undefined && body.observacao !== null ? String(body.observacao).trim() : null;

  if (!UUID_REGEX.test(solicitacaoId)) {
    sendOperacaoRejection(res, 400, 'INVALID_PAYLOAD', 'Campo "solicitacaoId" (UUID válido) é obrigatório.');
    return;
  }

  if (decisao !== 'aprovar' && decisao !== 'rejeitar') {
    sendOperacaoRejection(
      res,
      400,
      'INVALID_DECISION',
      'Campo "decisao" deve ser "aprovar" ou "rejeitar".'
    );
    return;
  }

  try {
    const { data, error } = await auth.supabaseAdmin.rpc('admin_decidir_solicitacao_s2s', {
      p_admin_auth_user_id: auth.userId,
      p_solicitacao_id: solicitacaoId,
      p_decisao: decisao,
      p_observacao: observacao
    });

    if (error || !data || typeof data !== 'object') {
      sendV2Unavailable(res);
      return;
    }

    if (data.success !== true) {
      sendOperacaoRejection(
        res,
        Number(data.http_status) || 400,
        String(data.code || 'DECISION_FAILED'),
        String(data.error || 'Não foi possível registrar decisão administrativa.')
      );
      return;
    }

    sendV2Json(res, 200, {
      success: true,
      apiVersion: '2.0',
      solicitacaoId: data.solicitacao_id,
      status: data.status,
      historicoId: data.historico_id ?? null,
      analisadoPorLogin: data.analisado_por_login ?? null
    });
  } catch {
    sendV2Unavailable(res);
  }
}
