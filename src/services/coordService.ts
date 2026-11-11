/**
 * src/services/coordService.ts
 *
 * Serviço de detecção, validação, conversão e formatação de coordenadas para o Administra-CSB.
 * Padrão oficial do sistema: GMS (Graus, Minutos e Segundos)
 *   - Latitude: DD°MM'SS,SS" com hemisfério N ou S
 *   - Longitude: DDD°MM'SS,SS" com hemisfério E ou W (ou L/O)
 *   - Vírgula como separador decimal dos segundos
 */

export type CoordFormatType = 'GMS' | 'DECIMAL' | 'UTM' | 'UTM_SEM_PARAMETROS' | 'INCOMPLETO' | 'INVALIDO';

export interface CoordParseResult {
  tipo: CoordFormatType;
  valido: boolean;
  decimal: number | null;
  gms: string;
  mensagem?: string;
  detalhes?: {
    graus?: number;
    minutos?: number;
    segundos?: number;
    hemisferio?: string;
    zonaUtm?: number;
    datumUtm?: string;
  };
}

/**
 * Converte valor numérico decimal em formato GMS padronizado do Administra:
 * Latitude: DD°MM'SS,SS" S/N
 * Longitude: DDD°MM'SS,SS" W/E
 */
export function decimalToGms(dec: number, isLongitude = false): string {
  if (isNaN(dec) || dec === null || dec === undefined) return '';

  const abs = Math.abs(dec);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const secFloat = (minFloat - min) * 60;
  // Arredonda para 2 casas decimais e garante que 59.999 não gere 60
  let sec = Number(secFloat.toFixed(2));
  let m = min;
  let d = deg;
  if (sec >= 60) {
    sec = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d += 1;
  }

  const secStr = sec.toFixed(2).replace('.', ',').padStart(5, '0');
  const minStr = String(m).padStart(2, '0');

  let hemisferio: string;
  if (isLongitude) {
    hemisferio = dec < 0 ? 'W' : 'E';
  } else {
    hemisferio = dec < 0 ? 'S' : 'N';
  }

  if (isLongitude) {
    const degStr = String(d).padStart(3, '0');
    return `${degStr}°${minStr}'${secStr}"${hemisferio}`;
  } else {
    const degStr = String(d).padStart(2, '0');
    return `${degStr}°${minStr}'${secStr}"${hemisferio}`;
  }
}

/**
 * Converte coordenadas UTM (Projeção Transversa de Mercator - WGS84 / SIRGAS 2000)
 * para Latitude e Longitude decimais.
 */
export function utmToDecimal(
  easting: number,
  northing: number,
  zone: number,
  isSouthernHemisphere = true
): { lat: number; lng: number } {
  const a = 6378137.0; // semi-eixo maior WGS84/SIRGAS2000
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const ePrime2 = (a * a - b * b) / (b * b);
  const k0 = 0.9996;

  const x = easting - 500000.0;
  const y = isSouthernHemisphere ? northing - 10000000.0 : northing;

  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const phi1Rad = mu +
    (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu) +
    (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) +
    (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);

  const n1 = a / Math.sqrt(1 - e2 * Math.sin(phi1Rad) * Math.sin(phi1Rad));
  const t1 = Math.tan(phi1Rad) * Math.tan(phi1Rad);
  const c1 = ePrime2 * Math.cos(phi1Rad) * Math.cos(phi1Rad);
  const r1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi1Rad) * Math.sin(phi1Rad), 1.5);
  const d = x / (n1 * k0);

  const latRad = phi1Rad - (n1 * Math.tan(phi1Rad) / r1) * (
    d * d / 2 -
    (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ePrime2) * Math.pow(d, 4) / 24 +
    (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ePrime2 - 3 * c1 * c1) * Math.pow(d, 6) / 720
  );

  const lonOrigin = (zone - 1) * 6 - 180 + 3;
  const lonRad = (
    d -
    (1 + 2 * t1 + c1) * Math.pow(d, 3) / 6 +
    (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ePrime2 + 24 * t1 * t1) * Math.pow(d, 5) / 120
  ) / Math.cos(phi1Rad);

  const lat = (latRad * 180) / Math.PI;
  const lng = lonOrigin + (lonRad * 180) / Math.PI;

  return { lat, lng };
}

/**
 * Analisa e valida uma string ou número de coordenada, identificando seu formato (GMS, Decimal, UTM).
 */
export function parseCoordAdvanced(
  val: string | number | null | undefined,
  isLongitude = false
): CoordParseResult {
  if (val === undefined || val === null) {
    return { tipo: 'INCOMPLETO', valido: false, decimal: null, gms: '' };
  }

  const rawStr = String(val).trim();
  if (!rawStr) {
    return { tipo: 'INCOMPLETO', valido: false, decimal: null, gms: '' };
  }

  // 1. Detecção de UTM explícito ou numérico elevado (coordenadas planas em metros)
  const isUtmLabeled = /utm/i.test(rawStr) || /fuso|zona/i.test(rawStr);
  const plainNums = rawStr.replace(/[^0-9.,-]/g, ' ').trim().split(/\s+/).filter(Boolean);

  if (isUtmLabeled || (plainNums.length === 1 && Math.abs(parseFloat(plainNums[0].replace(',', '.'))) > 1000)) {
    // Tenta extrair fuso se presente (MT geralmente usa 20, 21 ou 22)
    const zoneMatch = rawStr.match(/(?:fuso|zona|zone|z)\s*([0-9]{1,2})/i);
    const zone = zoneMatch ? parseInt(zoneMatch[1], 10) : null;
    const isSouth = !/(\bN\b|norte)/i.test(rawStr); // MT está no hemisfério Sul

    const numVal = Math.abs(parseFloat(plainNums[0].replace(',', '.')));

    if (!zone || zone < 1 || zone > 60) {
      return {
        tipo: 'UTM_SEM_PARAMETROS',
        valido: false,
        decimal: null,
        gms: rawStr,
        mensagem: 'Coordenada em UTM sem fuso ou datum confirmados. Mato Grosso abrange os fusos 20S, 21S e 22S. Insira a coordenada em formato GMS.'
      };
    }

    // Se temos fuso confirmado e o valor aparenta ser Easting ou Northing isolado
    return {
      tipo: 'UTM',
      valido: false,
      decimal: null,
      gms: rawStr,
      mensagem: `Coordenada UTM Fuso ${zone}${isSouth ? 'S' : 'N'}. Para conversão exata, são necessários Easting e Northing simultâneos.`
    };
  }

  // 2. Detecção de formato GMS
  // Padrão aceita DD°MM'SS,SS"H ou variações com espaços e símbolos
  const gmsRegex = /([0-9]{1,3})\s*[°ºdD\s]\s*([0-9]{1,2})\s*['’mM\s]\s*([0-9]{1,2}(?:[.,][0-9]+)?)\s*["”sS]?\s*([NSEWLO])?/i;
  const gmsMatch = rawStr.match(gmsRegex);

  if (gmsMatch) {
    const deg = parseInt(gmsMatch[1], 10);
    const min = parseInt(gmsMatch[2], 10);
    const sec = parseFloat(gmsMatch[3].replace(',', '.'));
    const rawHemi = (gmsMatch[4] || '').toUpperCase();

    // Normaliza hemisfério (L -> E, O -> W)
    let hemi = rawHemi;
    if (hemi === 'O') hemi = 'W';
    if (hemi === 'L') hemi = 'E';

    // Se não tiver hemisfério explícito, verifica contexto de MT (Latitude é S, Longitude é W se graus estiverem no intervalo de MT)
    if (!hemi) {
      if (!isLongitude && deg >= 7 && deg <= 19) {
        hemi = 'S';
      } else if (isLongitude && deg >= 50 && deg <= 62) {
        hemi = 'W';
      }
    }

    // Validações estritas de GMS
    if (min >= 60 || min < 0) {
      return {
        tipo: 'INVALIDO',
        valido: false,
        decimal: null,
        gms: rawStr,
        mensagem: 'Minutos inválidos (devem estar entre 0 e 59).'
      };
    }
    if (sec >= 60 || sec < 0) {
      return {
        tipo: 'INVALIDO',
        valido: false,
        decimal: null,
        gms: rawStr,
        mensagem: 'Segundos inválidos (devem estar entre 0 e menos de 60).'
      };
    }

    const maxDeg = isLongitude ? 180 : 90;
    if (deg > maxDeg || deg < 0) {
      return {
        tipo: 'INVALIDO',
        valido: false,
        decimal: null,
        gms: rawStr,
        mensagem: `Graus fora do limite geográfico (máximo ${maxDeg}°).`
      };
    }

    let dec = deg + min / 60 + sec / 3600;
    if (hemi === 'S' || hemi === 'W') {
      dec = -dec;
    } else if (!hemi) {
      // Se ainda não determinou hemisfério, não presume
      return {
        tipo: 'INCOMPLETO',
        valido: false,
        decimal: null,
        gms: rawStr,
        mensagem: 'Informe o hemisfério da coordenada (S para latitude ou W para longitude).'
      };
    }

    // Formata no padrão estrito DD°MM'SS,SS"H
    const gmsNormalizado = decimalToGms(dec, isLongitude);

    return {
      tipo: 'GMS',
      valido: true,
      decimal: dec,
      gms: gmsNormalizado,
      detalhes: {
        graus: deg,
        minutos: min,
        segundos: sec,
        hemisferio: hemi
      }
    };
  }

  // 3. Detecção de formato Decimal
  const cleanDot = rawStr.replace(',', '.');
  const decimalMatch = cleanDot.match(/^([-+]?\d+(\.\d+)?)\s*([NSEWLO])?$/i);

  if (decimalMatch) {
    let dec = parseFloat(decimalMatch[1]);
    const explicitHemi = (decimalMatch[3] || '').toUpperCase();

    if (explicitHemi === 'S' || explicitHemi === 'W' || explicitHemi === 'O') {
      dec = -Math.abs(dec);
    } else if (explicitHemi === 'N' || explicitHemi === 'E' || explicitHemi === 'L') {
      dec = Math.abs(dec);
    } else if (dec > 0) {
      // Se não tem hemisfério explícito e é positivo, mas está na faixa do Brasil/MT
      if (!isLongitude && dec <= 35) {
        dec = -dec;
      } else if (isLongitude && dec <= 85) {
        dec = -dec;
      }
    }

    const maxLimit = isLongitude ? 180 : 90;
    if (Math.abs(dec) > maxLimit) {
      return {
        tipo: 'INVALIDO',
        valido: false,
        decimal: null,
        gms: rawStr,
        mensagem: `Coordenada decimal fora do limite geográfico (${-maxLimit}° a ${maxLimit}°).`
      };
    }

    const gmsCalculado = decimalToGms(dec, isLongitude);

    return {
      tipo: 'DECIMAL',
      valido: true,
      decimal: dec,
      gms: gmsCalculado
    };
  }

  return {
    tipo: 'INVALIDO',
    valido: false,
    decimal: null,
    gms: rawStr,
    mensagem: 'Formato não reconhecido. Informe a coordenada em formato GMS (ex: 15°35\'45,00"S).'
  };
}

/**
 * Formatação progressiva em tempo real conforme o analista digita os dígitos.
 * Permite edição, deleção e substituição livres sem travar o cursor ou impedir a digitação.
 */
export function formatGmsInput(input: string, isLongitude = false): string {
  if (!input) return '';

  const clean = input.trim();

  // Preserva hemisfério se o analista digitou explicitamente no final
  const hemiMatch = clean.match(/([NSEWLO])$/i);
  let hemi = hemiMatch ? hemiMatch[1].toUpperCase() : '';
  if (hemi === 'O') hemi = 'W';
  if (hemi === 'L') hemi = 'E';

  // Se o usuário colou formato decimal puro (ex: -15.5960)
  if (/^-?\d+([.,]\d+)?$/.test(clean) && (clean.includes('.') || clean.includes(','))) {
    const num = parseFloat(clean.replace(',', '.'));
    if (!isNaN(num)) {
      return decimalToGms(num, isLongitude);
    }
  }

  // Extrai apenas números
  const digits = clean.replace(/[^0-9]/g, '');
  if (!digits) return clean;

  const maxDegDigits = isLongitude ? 3 : 2;
  const degDigits = digits.length > (maxDegDigits + 4) ? maxDegDigits : (digits.length >= 2 ? 2 : digits.length);

  const deg = digits.slice(0, degDigits);
  if (digits.length <= degDigits) {
    return `${deg}°`;
  }

  const min = digits.slice(degDigits, degDigits + 2);
  if (digits.length <= degDigits + 2) {
    return `${deg}°${min}'`;
  }

  const secInt = digits.slice(degDigits + 2, degDigits + 4);
  if (digits.length <= degDigits + 4) {
    return hemi ? `${deg}°${min}'${secInt}"${hemi}` : `${deg}°${min}'${secInt}"`;
  }

  const secDec = digits.slice(degDigits + 4, degDigits + 6);
  const defaultHemi = isLongitude ? 'W' : 'S';
  const finalHemi = hemi || defaultHemi;

  return `${deg}°${min}'${secInt},${secDec}"${finalHemi}`;
}
