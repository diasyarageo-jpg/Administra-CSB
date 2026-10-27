export interface IbgeUf {
  id: number;
  sigla: string;
  nome: string;
}

export interface IbgeMunicipio {
  id: number;
  nome: string;
}

export const UF_SIGLA_TO_IBGE_CODE: Record<string, number> = {
  RO: 11,
  AC: 12,
  AM: 13,
  RR: 14,
  PA: 15,
  AP: 16,
  TO: 17,
  MA: 21,
  PI: 22,
  CE: 23,
  RN: 24,
  PB: 25,
  PE: 26,
  AL: 27,
  SE: 28,
  BA: 29,
  MG: 31,
  ES: 32,
  RJ: 33,
  SP: 35,
  PR: 41,
  SC: 42,
  RS: 43,
  MS: 50,
  MT: 51,
  GO: 52,
  DF: 53
};

export const IBGE_CODE_TO_SIGLA: Record<number, string> = Object.entries(UF_SIGLA_TO_IBGE_CODE).reduce(
  (acc, [sigla, code]) => {
    acc[code] = sigla;
    return acc;
  },
  {} as Record<number, string>
);

export function resolveIbgeUfCode(uf: string | number): number | null {
  if (uf === undefined || uf === null) return null;
  const clean = String(uf).trim().toUpperCase();
  if (!clean) return null;

  const num = Number(clean);
  if (!Number.isNaN(num) && IBGE_CODE_TO_SIGLA[num]) {
    return num;
  }

  if (UF_SIGLA_TO_IBGE_CODE[clean]) {
    return UF_SIGLA_TO_IBGE_CODE[clean];
  }

  return null;
}

const CACHE_KEY_UFS = 'ibge_ufs_cache_v1';
const CACHE_PREFIX_MUN = 'ibge_mun_cache_';

/**
 * Carrega a lista oficial de UFs brasileiras via API do IBGE.
 * Atualiza o cache quando a API responde; usa o cache em caso de indisponibilidade.
 */
export async function getUfs(): Promise<IbgeUf[]> {
  try {
    const list = await fetchUfsFromApi();
    try {
      localStorage.setItem(CACHE_KEY_UFS, JSON.stringify(list));
    } catch {}
    return list;
  } catch {
    try {
      const cached = localStorage.getItem(CACHE_KEY_UFS);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  }
}

async function fetchUfsFromApi(): Promise<IbgeUf[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome', {
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.map((item: any) => ({
      id: Number(item.id),
      sigla: String(item.sigla || '').toUpperCase(),
      nome: String(item.nome || '')
    }));
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Carrega os municípios de uma UF específica via API oficial do IBGE.
 * - Garante que a chamada à API receba o código numérico oficial da UF (ex.: 51 para Mato Grosso).
 * - Consulta primeiro a API do IBGE;
 * - Quando a API responder, atualiza o cache e retorna a lista oficial mais recente;
 * - Usa o cache como alternativa somente quando a consulta à API falhar;
 * - Mantém o cache consistente para cada UF tanto por código quanto por sigla;
 * - Se a API falhar e não houver cache para a UF solicitada, retorna lista vazia.
 */
export async function getMunicipiosByUf(uf: string | number): Promise<IbgeMunicipio[]> {
  const ufCode = resolveIbgeUfCode(uf);
  if (!ufCode) return [];

  const sigla = IBGE_CODE_TO_SIGLA[ufCode];

  try {
    const list = await fetchMunicipiosFromApi(ufCode);
    saveMunicipiosCache(ufCode, sigla, list);
    return list;
  } catch {
    const cached = getMunicipiosFromCache(ufCode, sigla);
    if (cached) return cached;
    return [];
  }
}

async function fetchMunicipiosFromApi(ufCode: number): Promise<IbgeMunicipio[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${ufCode}/municipios?orderBy=nome`,
      { signal: controller.signal }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.map((item: any) => ({
      id: Number(item.id),
      nome: String(item.nome || '')
    }));
  } finally {
    clearTimeout(timeoutId);
  }
}

function saveMunicipiosCache(ufCode: number, sigla: string | undefined, list: IbgeMunicipio[]): void {
  try {
    const serialized = JSON.stringify(list);
    localStorage.setItem(`${CACHE_PREFIX_MUN}${ufCode}`, serialized);
    if (sigla) {
      localStorage.setItem(`${CACHE_PREFIX_MUN}${sigla}`, serialized);
    }
  } catch {}
}

function getMunicipiosFromCache(ufCode: number, sigla: string | undefined): IbgeMunicipio[] | null {
  try {
    const byCode = localStorage.getItem(`${CACHE_PREFIX_MUN}${ufCode}`);
    if (byCode) {
      const parsed = JSON.parse(byCode);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
    if (sigla) {
      const bySigla = localStorage.getItem(`${CACHE_PREFIX_MUN}${sigla}`);
      if (bySigla) {
        const parsed = JSON.parse(bySigla);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    }
  } catch {}
  return null;
}

/**
 * Carrega somente municípios de Mato Grosso (UF 51) para o cadastro de Barragens.
 */
export async function getMatoGrossoMunicipios(): Promise<IbgeMunicipio[]> {
  return getMunicipiosByUf(51);
}
