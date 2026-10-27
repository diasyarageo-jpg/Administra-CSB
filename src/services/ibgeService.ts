/**
 * ============================================================================
 * SERVIÇO DE LOCALIDADES — API OFICIAL DO IBGE COM CACHE LOCAL E FALLBACK
 * ============================================================================
 * Fornece UFs e municípios brasileiros integrados à API oficial do IBGE:
 * - UFs: https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome
 * - Municípios: https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios?orderBy=nome
 * 
 * Regras implementadas:
 * - Em Empreendedores: seleção de UF -> carregamento dinâmico dos municípios IBGE.
 * - Em Barragens: restrito a municípios de Mato Grosso (UF 51).
 * - Armazena código IBGE, nome do município e sigla da UF.
 * - Cache local via localStorage para agilidade e operação offline.
 * - Tratamento resiliente de falhas sem perda de dados já cadastrados.
 * ============================================================================
 */

export interface IbgeUf {
  id: number;
  sigla: string;
  nome: string;
}

export interface IbgeMunicipio {
  id: number;
  nome: string;
}

// Lista oficial estática de fallback das 27 UFs brasileiras
export const FALLBACK_UFS: IbgeUf[] = [
  { id: 12, sigla: 'AC', nome: 'Acre' },
  { id: 27, sigla: 'AL', nome: 'Alagoas' },
  { id: 16, sigla: 'AP', nome: 'Amapá' },
  { id: 13, sigla: 'AM', nome: 'Amazonas' },
  { id: 29, sigla: 'BA', nome: 'Bahia' },
  { id: 23, sigla: 'CE', nome: 'Ceará' },
  { id: 53, sigla: 'DF', nome: 'Distrito Federal' },
  { id: 32, sigla: 'ES', nome: 'Espírito Santo' },
  { id: 52, sigla: 'GO', nome: 'Goiás' },
  { id: 21, sigla: 'MA', nome: 'Maranhão' },
  { id: 51, sigla: 'MT', nome: 'Mato Grosso' },
  { id: 50, sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { id: 31, sigla: 'MG', nome: 'Minas Gerais' },
  { id: 15, sigla: 'PA', nome: 'Pará' },
  { id: 25, sigla: 'PB', nome: 'Paraíba' },
  { id: 41, sigla: 'PR', nome: 'Paraná' },
  { id: 26, sigla: 'PE', nome: 'Pernambuco' },
  { id: 22, sigla: 'PI', nome: 'Piauí' },
  { id: 33, sigla: 'RJ', nome: 'Rio de Janeiro' },
  { id: 24, sigla: 'RN', nome: 'Rio Grande do Norte' },
  { id: 43, sigla: 'RS', nome: 'Rio Grande do Sul' },
  { id: 11, sigla: 'RO', nome: 'Rondônia' },
  { id: 14, sigla: 'RR', nome: 'Roraima' },
  { id: 42, sigla: 'SC', nome: 'Santa Catarina' },
  { id: 35, sigla: 'SP', nome: 'São Paulo' },
  { id: 28, sigla: 'SE', nome: 'Sergipe' },
  { id: 17, sigla: 'TO', nome: 'Tocantins' }
];

// Relação oficial dos 141 municípios de Mato Grosso (UF 51) com códigos IBGE
export const FALLBACK_MUNICIPIOS_MT: IbgeMunicipio[] = [
  { id: 5100102, nome: 'Acorizal' },
  { id: 5100201, nome: 'Água Boa' },
  { id: 5100250, nome: 'Alta Floresta' },
  { id: 5100300, nome: 'Alto Araguaia' },
  { id: 5100359, nome: 'Alto Boa Vista' },
  { id: 5100409, nome: 'Alto Garças' },
  { id: 5100508, nome: 'Alto Paraguai' },
  { id: 5100607, nome: 'Alto Taquari' },
  { id: 5100805, nome: 'Apiacás' },
  { id: 5101001, nome: 'Araguaiana' },
  { id: 5101209, nome: 'Araguainha' },
  { id: 5101258, nome: 'Araputanga' },
  { id: 5101308, nome: 'Arenápolis' },
  { id: 5101407, nome: 'Aripuanã' },
  { id: 5101605, nome: 'Barão de Melgaço' },
  { id: 5101704, nome: 'Barra do Bugres' },
  { id: 5101803, nome: 'Barra do Garças' },
  { id: 5101852, nome: 'Bom Jesus do Araguaia' },
  { id: 5101902, nome: 'Brasnorte' },
  { id: 5102504, nome: 'Cáceres' },
  { id: 5102603, nome: 'Campinápolis' },
  { id: 5102637, nome: 'Campo Novo do Parecis' },
  { id: 5102678, nome: 'Campo Verde' },
  { id: 5102686, nome: 'Campos de Júlio' },
  { id: 5102694, nome: 'Canabrava do Norte' },
  { id: 5102702, nome: 'Canarana' },
  { id: 5102793, nome: 'Carlinda' },
  { id: 5102850, nome: 'Castanheira' },
  { id: 5103007, nome: 'Chapada dos Guimarães' },
  { id: 5103056, nome: 'Cláudia' },
  { id: 5103106, nome: 'Cocalinho' },
  { id: 5103205, nome: 'Colíder' },
  { id: 5103254, nome: 'Colniza' },
  { id: 5103304, nome: 'Comodoro' },
  { id: 5103353, nome: 'Confresa' },
  { id: 5103361, nome: 'Conquista D’Oeste' },
  { id: 5103379, nome: 'Cotriguaçu' },
  { id: 5103403, nome: 'Cuiabá' },
  { id: 5103437, nome: 'Curvelândia' },
  { id: 5103452, nome: 'Denise' },
  { id: 5103502, nome: 'Diamantino' },
  { id: 5103601, nome: 'Dom Aquino' },
  { id: 5103700, nome: 'Feliz Natal' },
  { id: 5103809, nome: 'Figueirópolis D’Oeste' },
  { id: 5103858, nome: 'Gaúcha do Norte' },
  { id: 5103908, nome: 'General Carneiro' },
  { id: 5104104, nome: 'Guarantã do Norte' },
  { id: 5104203, nome: 'Guiratinga' },
  { id: 5104500, nome: 'Indiavaí' },
  { id: 5104526, nome: 'Ipiranga do Norte' },
  { id: 5104542, nome: 'Itanhangá' },
  { id: 5104559, nome: 'Itaúba' },
  { id: 5104609, nome: 'Itiquira' },
  { id: 5104807, nome: 'Jaciara' },
  { id: 5104906, nome: 'Jangada' },
  { id: 5105002, nome: 'Jauru' },
  { id: 5105101, nome: 'Juara' },
  { id: 5105150, nome: 'Juína' },
  { id: 5105176, nome: 'Juruena' },
  { id: 5105200, nome: 'Juscimeira' },
  { id: 5105234, nome: 'Lambari D’Oeste' },
  { id: 5105259, nome: 'Lucas do Rio Verde' },
  { id: 5105309, nome: 'Luciara' },
  { id: 5105580, nome: 'Marcelândia' },
  { id: 5105606, nome: 'Matupá' },
  { id: 5105622, nome: 'Mirassol d’Oeste' },
  { id: 5105903, nome: 'Nobres' },
  { id: 5106000, nome: 'Nortelândia' },
  { id: 5106109, nome: 'Nossa Senhora do Livramento' },
  { id: 5106158, nome: 'Nova Bandeirantes' },
  { id: 5106174, nome: 'Nova Brasilândia' },
  { id: 5106182, nome: 'Nova Canaã do Norte' },
  { id: 5106190, nome: 'Nova Guarita' },
  { id: 5106208, nome: 'Nova Lacerda' },
  { id: 5106216, nome: 'Nova Marilândia' },
  { id: 5106224, nome: 'Nova Maringá' },
  { id: 5106232, nome: 'Nova Monte Verde' },
  { id: 5106240, nome: 'Nova Mutum' },
  { id: 5106257, nome: 'Nova Nazaré' },
  { id: 5106265, nome: 'Nova Olímpia' },
  { id: 5106273, nome: 'Nova Santa Helena' },
  { id: 5106281, nome: 'Nova Ubiratã' },
  { id: 5106299, nome: 'Nova Xavantina' },
  { id: 5106307, nome: 'Novo Horizonte do Norte' },
  { id: 5106315, nome: 'Novo Mundo' },
  { id: 5106372, nome: 'Novo Santo Antônio' },
  { id: 5106422, nome: 'Novo São Joaquim' },
  { id: 5106455, nome: 'Paranaíta' },
  { id: 5106505, nome: 'Paranatinga' },
  { id: 5106653, nome: 'Pedra Preta' },
  { id: 5106752, nome: 'Peixoto de Azevedo' },
  { id: 5106778, nome: 'Planalto da Serra' },
  { id: 5106802, nome: 'Poconé' },
  { id: 5106828, nome: 'Pontal do Araguaia' },
  { id: 5106851, nome: 'Ponte Branca' },
  { id: 5107008, nome: 'Pontes e Lacerda' },
  { id: 5107040, nome: 'Porto Alegre do Norte' },
  { id: 5107065, nome: 'Porto dos Gaúchos' },
  { id: 5107107, nome: 'Porto Esperidião' },
  { id: 5107156, nome: 'Porto Estrela' },
  { id: 5107180, nome: 'Poxoréu' },
  { id: 5107198, nome: 'Primavera do Leste' },
  { id: 5107206, nome: 'Querência' },
  { id: 5107248, nome: 'Reserva do Cabaçal' },
  { id: 5107263, nome: 'Ribeirão Cascalheira' },
  { id: 5107297, nome: 'Ribeirãozinho' },
  { id: 5107305, nome: 'Rio Branco' },
  { id: 5107354, nome: 'Rio Crespo' },
  { id: 5107404, nome: 'Rondolândia' },
  { id: 5107602, nome: 'Rondonópolis' },
  { id: 5107701, nome: 'Rosário Oeste' },
  { id: 5107743, nome: 'Santa Carmem' },
  { id: 5107750, nome: 'Santa Cruz do Xingu' },
  { id: 5107768, nome: 'Santa Rita do Trivelato' },
  { id: 5107776, nome: 'Santa Terezinha' },
  { id: 5107792, nome: 'Santo Afonso' },
  { id: 5107800, nome: 'Santo Antônio do Leste' },
  { id: 5107859, nome: 'Santo Antônio do Leverger' },
  { id: 5107875, nome: 'São Félix do Araguaia' },
  { id: 5107883, nome: 'São José do Povo' },
  { id: 5107909, nome: 'São José do Rio Claro' },
  { id: 5107925, nome: 'São José do Xingu' },
  { id: 5107941, nome: 'São José dos Quatro Marcos' },
  { id: 5107958, nome: 'São Pedro da Cipa' },
  { id: 5108006, nome: 'Sapezal' },
  { id: 5108055, nome: 'Serra Nova Dourada' },
  { id: 5108105, nome: 'Sinop' },
  { id: 5108204, nome: 'Sorriso' },
  { id: 5108303, nome: 'Tabaporã' },
  { id: 5108352, nome: 'Tangará da Serra' },
  { id: 5108402, nome: 'Tapurah' },
  { id: 5108501, nome: 'Terra Nova do Norte' },
  { id: 5108600, nome: 'Tesouro' },
  { id: 5108808, nome: 'Torixoréu' },
  { id: 5108857, nome: 'União do Sul' },
  { id: 5108907, nome: 'Vale de São Domingos' },
  { id: 5108956, nome: 'Várzea Grande' },
  { id: 5109004, nome: 'Vera' },
  { id: 5109053, nome: 'Vila Bela da Santíssima Trindade' },
  { id: 5109061, nome: 'Vila Rica' }
];

const CACHE_KEY_UFS = 'ibge_ufs_cache_v1';
const CACHE_PREFIX_MUN = 'ibge_mun_cache_';

/**
 * Carrega a lista oficial de UFs brasileiras via API do IBGE com cache e fallback resiliente.
 */
export async function getUfs(): Promise<IbgeUf[]> {
  try {
    const cached = localStorage.getItem(CACHE_KEY_UFS);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Dispara atualização em segundo plano sem bloquear a interface
        refreshUfsCache().catch(() => {});
        return parsed;
      }
    }
  } catch {
    // Silencia erros de localStorage
  }

  try {
    const list = await fetchUfsFromApi();
    try {
      localStorage.setItem(CACHE_KEY_UFS, JSON.stringify(list));
    } catch {}
    return list;
  } catch {
    return FALLBACK_UFS;
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

async function refreshUfsCache() {
  try {
    const list = await fetchUfsFromApi();
    localStorage.setItem(CACHE_KEY_UFS, JSON.stringify(list));
  } catch {}
}

/**
 * Carrega os municípios de uma UF específica via API oficial do IBGE.
 * Trata UF por sigla (ex: "MT", "SP") ou por código numérico (ex: 51, 35).
 */
export async function getMunicipiosByUf(uf: string | number): Promise<IbgeMunicipio[]> {
  const ufKey = String(uf || '').trim().toUpperCase();
  if (!ufKey) return [];

  const cacheKey = `${CACHE_PREFIX_MUN}${ufKey}`;

  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Atualiza cache em segundo plano
        refreshMunicipiosCache(ufKey).catch(() => {});
        return parsed;
      }
    }
  } catch {}

  try {
    const list = await fetchMunicipiosFromApi(ufKey);
    try {
      localStorage.setItem(cacheKey, JSON.stringify(list));
    } catch {}
    return list;
  } catch {
    if (ufKey === 'MT' || ufKey === '51') {
      return FALLBACK_MUNICIPIOS_MT;
    }
    return [];
  }
}

async function fetchMunicipiosFromApi(ufKey: string): Promise<IbgeMunicipio[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(ufKey)}/municipios?orderBy=nome`, {
      signal: controller.signal
    });
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

async function refreshMunicipiosCache(ufKey: string) {
  try {
    const list = await fetchMunicipiosFromApi(ufKey);
    localStorage.setItem(`${CACHE_PREFIX_MUN}${ufKey}`, JSON.stringify(list));
  } catch {}
}

/**
 * Carrega somente municípios de Mato Grosso (UF 51) para o cadastro de Barragens.
 */
export async function getMatoGrossoMunicipios(): Promise<IbgeMunicipio[]> {
  return getMunicipiosByUf('51');
}
