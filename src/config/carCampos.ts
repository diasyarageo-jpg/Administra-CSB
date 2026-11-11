/**
 * src/config/carCampos.ts
 *
 * Mapeamento e correspondência de campos da camada do GeoServer/CAR (SEMA-MT).
 * Camada confirmada no GetCapabilities: "Geoportal:CAR_ATP" (Área Total da Propriedade - ATP).
 *
 * Esquema real confirmado via DescribeFeatureType em geo.sema.mt.gov.br:
 *   - NOMESPROPRIETARIOS (xsd:string)
 *   - NUMEROESTADUAL (xsd:string)
 *   - CAR_FEDERAL (xsd:string)
 *   - PROTOCOLO (xsd:string)
 *   - NOMEPROPRIEDADE (xsd:string)
 *   - ATIVIDADE (xsd:string)
 *   - SITUACAO_CAR (xsd:string)
 *   - APF_NUMERO (xsd:string)
 *   - NUMERO_ART (xsd:string)
 *   - MIGRACAO_ID (xsd:number)
 *   - CODIGO (xsd:number)
 *   - REQUERIMENTO_ID (xsd:number)
 *   - MUNICIPIO_CODIGO (xsd:number)
 *   - MODULOS_FISCAIS (xsd:number)
 *   - PERCENTUAL_SIGEF (xsd:number)
 *   - AREA_HA (xsd:number)
 *   - GEOMETRY (gml:Polygon)
 *
 * Regras:
 *   1. Apenas campos efetivamente existentes nas propriedades recebidas são preenchidos.
 *   2. Se nenhum campo corresponder, o valor permanece vazio e as propriedades brutas são preservadas.
 *   3. Não preencher UF com "MT" nem presumir qualquer valor não fornecido pela camada.
 *   4. Não inventar ou tratar CPF/CNPJ como disponível se a camada não o publicar de forma desmascarada.
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
  // Número de registro estadual no CAR/MT
  car: [
    'NUMEROESTADUAL',
    'num_car',
    'numero_car',
    'cod_imovel',
    'recibo_car',
    'codigo_car',
    'registro_car',
    'car_mt',
    'PROTOCOLO'
  ],

  // Código federal no SICAR
  carFederal: [
    'CAR_FEDERAL',
    'car_federal',
    'cod_imovel_federal',
    'sicar'
  ],

  // Nome do proprietário / detentor (na camada ATP: NOMESPROPRIETARIOS)
  empreendedor: [
    'NOMESPROPRIETARIOS',
    'nom_proprietario',
    'proprietario',
    'nome_proprietario',
    'titular',
    'razao_social'
  ],

  // Nome do imóvel rural / denominação da fazenda
  empreendimento: [
    'NOMEPROPRIEDADE',
    'nom_imovel',
    'nome_imovel',
    'nome_propriedade',
    'denominacao',
    'fazenda'
  ],

  // Nome do município (se fornecido diretamente pela camada)
  municipio: [
    'MUNICIPIO',
    'NOM_MUNICIPIO',
    'nom_municipio',
    'nm_municipio',
    'municipio',
    'cidade'
  ],

  // Código IBGE do município (SEMA-MT utiliza MUNICIPIO_CODIGO de 7 dígitos)
  municipioCodigo: [
    'MUNICIPIO_CODIGO',
    'COD_IBGE',
    'cod_ibge',
    'municipio_ibge',
    'ibge'
  ],

  // UF (não presumir "MT" se ausente nas propriedades)
  uf: [
    'UF',
    'SIG_UF',
    'sig_uf',
    'uf',
    'estado'
  ],

  // Situação cadastral do CAR
  situacaoCar: [
    'SITUACAO_CAR',
    'des_condicao',
    'situacao',
    'status_car',
    'status'
  ],

  // Área em hectares
  areaHa: [
    'AREA_HA',
    'area_imovel',
    'area_ha',
    'num_area'
  ],

  // Atividade declarada no CAR
  atividade: [
    'ATIVIDADE',
    'atividade'
  ],

  // Número da Autorização Provisória de Funcionamento (APF)
  apfNumero: [
    'APF_NUMERO',
    'apf_numero'
  ],

  // Número da ART no CAR
  numeroArt: [
    'NUMERO_ART',
    'num_art',
    'numero_art'
  ],

  // Módulos Fiscais
  modulosFiscais: [
    'MODULOS_FISCAIS',
    'modulos_fiscais'
  ]
};

/**
 * Extrai o primeiro valor existente para um campo a partir da lista de chaves candidatas.
 * Retorna string vazia se nenhum campo existir nas propriedades brutas da feição.
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
        if (s !== '' && s !== 'null' && s !== 'undefined' && s !== 'nan') {
          return s;
        }
      }
    }
  }

  return '';
}
