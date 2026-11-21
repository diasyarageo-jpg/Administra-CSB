// src/server/pendenciaSanitizer.ts
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PROTECTED_DOCUMENT_PLACEHOLDER = '[documento protegido]' as const;

export function isValidUuid(val: unknown): boolean {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

export function containsSensitiveCpfOrCnpj(raw: unknown): boolean {
  const text = String(raw || '').trim();
  if (!text) return false;
  if (/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(text)) return true;
  if (/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(text)) return true;
  if (/(?<![\/.\-\da-zA-Z])\d{14}(?![\/.\-\da-zA-Z])/.test(text)) return true;
  if (/(?<![\/.\-\da-zA-Z])\d{11}(?![\/.\-\da-zA-Z])/.test(text)) return true;
  return false;
}

const PRESERVE_TOKEN_REGEX = new RegExp(
  [
    // 1. UUIDs (isolados ou após delimitadores de prefixo, sem casar dentro de sequências alfanuméricas contíguas)
    '(?<![0-9a-zA-Z])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-zA-Z])',
    // 2. Datas e timestamps ISO (ex.: 2026-11-19, 2026-11-19T10:00:00Z, 2026-11-19 10:00:00)
    '(?<![0-9a-zA-Z])\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])(?:[T\\s]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?(?![0-9a-zA-Z])',
    // 3. Datas no formato brasileiro com hora opcional (ex.: 19/11/2026, 19/11/2026 14:30:00)
    '(?<![0-9a-zA-Z])(?:0[1-9]|[12]\\d|3[01])[./-](?:0[1-9]|1[0-2])[./-](?:19|20)\\d{2}(?:[T\\s]\\d{2}:\\d{2}(?::\\d{2})?)?(?![0-9a-zA-Z])'
  ].join('|'),
  'gi'
);

function scrubCpfCnpjSegment(segment: string): string {
  if (!segment) return segment;

  let out = segment;

  // 1. CNPJ com separadores padrão, espaços ou separadores misturados (inclusive após prefixos com -, _, /, .)
  const cnpjPatterns: RegExp[] = [
    /(?<![0-9a-zA-Z])\d{2}[ \t./_-]+\d{3}[ \t./_-]+\d{3}[ \t./_-]+\d{4}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{2}[ \t./_-]+\d{6}[ \t./_-]+\d{4}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{2}[ \t./_-]+\d{3}[ \t./_-]+\d{3}[ \t./_-]+\d{6}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{5}[ \t./_-]+\d{3}[ \t./_-]+\d{4}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{2}[ \t./_-]+\d{6}[ \t./_-]+\d{6}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{8}[ \t./_-]+\d{4}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{8}[ \t./_-]+\d{6}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{12}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g
  ];
  for (const pattern of cnpjPatterns) {
    out = out.replace(pattern, PROTECTED_DOCUMENT_PLACEHOLDER);
  }

  // 2. CPF com separadores padrão, espaços ou separadores misturados (inclusive após prefixos com -, _, /, .)
  const cpfPatterns: RegExp[] = [
    /(?<![0-9a-zA-Z])\d{3}[ \t./_-]+\d{3}[ \t./_-]+\d{3}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{3}[ \t./_-]+\d{3}[ \t./_-]+\d{5}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{3}[ \t./_-]+\d{6}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{6}[ \t./_-]+\d{3}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{6}[ \t./_-]+\d{5}(?![0-9a-zA-Z])/g,
    /(?<![0-9a-zA-Z])\d{9}[ \t./_-]+\d{2}(?![0-9a-zA-Z])/g
  ];
  for (const pattern of cpfPatterns) {
    out = out.replace(pattern, PROTECTED_DOCUMENT_PLACEHOLDER);
  }

  // 3. Sequências numéricas contíguas de 14 dígitos (CNPJ) e 11 dígitos (CPF)
  out = out.replace(
    /(?<![0-9a-zA-Z])\d{14}(?![0-9a-zA-Z])/g,
    PROTECTED_DOCUMENT_PLACEHOLDER
  );
  out = out.replace(
    /(?<![0-9a-zA-Z])\d{11}(?![0-9a-zA-Z])/g,
    PROTECTED_DOCUMENT_PLACEHOLDER
  );

  return out;
}

export function sanitizePendenciaTextForResponse(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw);
  if (!text) return '';

  const trimmed = text.trim();
  if (UUID_REGEX.test(trimmed)) {
    return trimmed;
  }

  let result = '';
  let lastIdx = 0;
  for (const match of text.matchAll(PRESERVE_TOKEN_REGEX)) {
    const idx = match.index ?? 0;
    result += scrubCpfCnpjSegment(text.slice(lastIdx, idx));
    result += match[0];
    lastIdx = idx + match[0].length;
  }
  result += scrubCpfCnpjSegment(text.slice(lastIdx));
  return result;
}
