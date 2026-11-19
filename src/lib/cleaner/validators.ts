import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import type {
  ColumnProfile,
  ColumnType,
  DateOutputFormat,
  PhoneOutputFormat,
  QualityScoreBreakdown,
  SupportedPhoneRegion,
} from './types';

export const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'null', 'nan', 'none']);

export const SUPPORTED_PHONE_REGIONS: Array<{ code: SupportedPhoneRegion; label: string }> = [
  { code: 'IN', label: 'India (+91)' },
  { code: 'US', label: 'United States (+1)' },
  { code: 'GB', label: 'United Kingdom (+44)' },
  { code: 'AU', label: 'Australia (+61)' },
  { code: 'CA', label: 'Canada (+1)' },
  { code: 'DE', label: 'Germany (+49)' },
  { code: 'SG', label: 'Singapore (+65)' },
  { code: 'FR', label: 'France (+33)' },
  { code: 'AE', label: 'UAE (+971)' },
  { code: 'JP', label: 'Japan (+81)' },
];

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const INTEGER_REGEX = /^[+-]?\d+$/;
const DECIMAL_REGEX = /^[+-]?(?:\d+\.\d+|\d+\.|\.\d+)$/;
const BOOLEAN_VALUES = new Set(['true', 'false', 'yes', 'no', '1', '0', 'y', 'n']);
const PHONE_LOOSE_REGEX = /^\+?[\d\s().-]{7,20}$/;

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export function isMissingValue(value: string): boolean {
  return MISSING_TOKENS.has(value.trim().toLowerCase());
}

export function isValidEmailSyntax(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 254) return false;
  if (trimmed.includes('..')) return false;
  return EMAIL_REGEX.test(trimmed);
}

export function validateAndFormatPhone(
  raw: string,
  region: SupportedPhoneRegion,
  outputFormat: PhoneOutputFormat = 'E.164',
): { valid: boolean; formatted: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, formatted: raw };

  const parsed = parsePhoneNumberFromString(trimmed, region as CountryCode);
  if (!parsed || !parsed.isValid()) {
    return { valid: false, formatted: raw };
  }

  if (outputFormat === 'INTERNATIONAL') {
    return { valid: true, formatted: parsed.formatInternational() };
  }
  if (outputFormat === 'NATIONAL') {
    return { valid: true, formatted: parsed.formatNational() };
  }
  return { valid: true, formatted: parsed.number };
}

export function isFormulaTrigger(value: string): boolean {
  if (!value) return false;
  const first = value.charAt(0);
  if (first === '=' || first === '+' || first === '@' || first === '\t' || first === '\r') {
    return true;
  }
  if (first === '-') {
    return !/^-?\d+(?:\.\d+)?$/.test(value);
  }
  return false;
}

export interface ParsedDateResult {
  valid: boolean;
  ambiguous: boolean;
  year?: number;
  month?: number;
  day?: number;
  formatted?: string;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function formatDateParts(
  year: number,
  month: number,
  day: number,
  format: DateOutputFormat = 'YYYY-MM-DD',
): string {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  if (format === 'DD/MM/YYYY') return `${dd}/${mm}/${yyyy}`;
  if (format === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`;
  return `${yyyy}-${mm}-${dd}`;
}

export function parseDateValue(
  raw: string,
  dayFirst: boolean,
  outputFormat: DateOutputFormat = 'YYYY-MM-DD',
): ParsedDateResult {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, ambiguous: false };

  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (isValidCalendarDate(year, month, day)) {
      return {
        valid: true,
        ambiguous: false,
        year,
        month,
        day,
        formatted: formatDateParts(year, month, day, outputFormat),
      };
    }
    return { valid: false, ambiguous: false };
  }

  const slashMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(trimmed);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);

    const bothCouldBeMonth =
      first >= 1 && first <= 12 && second >= 1 && second <= 12 && first !== second;
    let day: number;
    let month: number;

    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else if (second > 12 && first <= 12) {
      month = first;
      day = second;
    } else if (dayFirst) {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }

    if (isValidCalendarDate(year, month, day)) {
      return {
        valid: true,
        ambiguous: bothCouldBeMonth,
        year,
        month,
        day,
        formatted: formatDateParts(year, month, day, outputFormat),
      };
    }
    return { valid: false, ambiguous: false };
  }

  const dmyText = /^(\d{1,2})[\s-]+([A-Za-z]+)[\s,-]+(\d{4})$/.exec(trimmed);
  if (dmyText) {
    const day = Number(dmyText[1]);
    const month = MONTH_NAMES[dmyText[2].toLowerCase()];
    const year = Number(dmyText[3]);
    if (month && isValidCalendarDate(year, month, day)) {
      return {
        valid: true,
        ambiguous: false,
        year,
        month,
        day,
        formatted: formatDateParts(year, month, day, outputFormat),
      };
    }
  }

  const mdyText = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(trimmed);
  if (mdyText) {
    const month = MONTH_NAMES[mdyText[1].toLowerCase()];
    const day = Number(mdyText[2]);
    const year = Number(mdyText[3]);
    if (month && isValidCalendarDate(year, month, day)) {
      return {
        valid: true,
        ambiguous: false,
        year,
        month,
        day,
        formatted: formatDateParts(year, month, day, outputFormat),
      };
    }
  }

  return { valid: false, ambiguous: false };
}

export function looksLikeDateCandidate(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(t)) return true;
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(t)) return true;
  if (/^\d{1,2}[\s-]+[A-Za-z]{3,9}[\s,-]+\d{4}$/.test(t)) return true;
  if (/^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/.test(t)) return true;
  return false;
}

export function classifyCellType(
  raw: string,
  headerHint?: string,
): Exclude<ColumnType, 'mixed' | 'empty'> {
  const t = raw.trim();
  const hint = (headerHint ?? '').toLowerCase();

  if (t.includes('@') || hint.includes('email')) {
    if (isValidEmailSyntax(t) || t.includes('@')) return 'email';
  }

  if (parseDateValue(t, true).valid || (hint.includes('date') && looksLikeDateCandidate(t))) {
    return 'date';
  }

  if (INTEGER_REGEX.test(t)) {
    if (hint.includes('phone') || hint.includes('mobile') || hint.includes('tel')) {
      return t.length >= 7 ? 'phone' : 'integer';
    }
    return 'integer';
  }

  if (DECIMAL_REGEX.test(t)) {
    return 'decimal';
  }

  if (
    BOOLEAN_VALUES.has(t.toLowerCase()) &&
    (hint.includes('active') ||
      hint.includes('is_') ||
      hint.includes('flag') ||
      hint.includes('bool') ||
      t.toLowerCase() === 'true' ||
      t.toLowerCase() === 'false')
  ) {
    return 'boolean';
  }

  if (PHONE_LOOSE_REGEX.test(t)) {
    const digits = t.replace(/\D/g, '');
    if (
      digits.length >= 7 &&
      digits.length <= 15 &&
      (t.includes('+') ||
        t.includes('(') ||
        t.includes('-') ||
        hint.includes('phone') ||
        hint.includes('mobile') ||
        hint.includes('tel'))
    ) {
      return 'phone';
    }
  }

  return 'text';
}

export function inferColumnType(values: string[], headerName: string): {
  detectedType: ColumnType;
  nonEmptyCount: number;
  missingCount: number;
  invalidCount: number;
  ambiguousDateCount: number;
  typeInconsistentCount: number;
} {
  let nonEmptyCount = 0;
  let missingCount = 0;
  let invalidCount = 0;
  let ambiguousDateCount = 0;

  const counts: Record<Exclude<ColumnType, 'mixed' | 'empty'>, number> = {
    text: 0,
    integer: 0,
    decimal: 0,
    date: 0,
    email: 0,
    phone: 0,
    boolean: 0,
  };

  const hint = headerName.toLowerCase();

  for (const val of values) {
    if (isMissingValue(val)) {
      missingCount++;
      continue;
    }
    nonEmptyCount++;
    const cellType = classifyCellType(val, hint);
    counts[cellType]++;

    if (cellType === 'date') {
      const parsed = parseDateValue(val, true);
      if (!parsed.valid) {
        invalidCount++;
      } else if (parsed.ambiguous) {
        ambiguousDateCount++;
      }
    }
  }

  if (nonEmptyCount === 0) {
    return {
      detectedType: 'empty',
      nonEmptyCount: 0,
      missingCount,
      invalidCount: 0,
      ambiguousDateCount: 0,
      typeInconsistentCount: 0,
    };
  }

  const numericCount = counts.integer + counts.decimal;
  let dominantType: ColumnType = 'text';
  let dominantCount = counts.text;

  const candidates: Array<[ColumnType, number]> = [
    ['email', counts.email],
    ['date', counts.date],
    ['phone', counts.phone],
    ['boolean', counts.boolean],
    ['integer', counts.integer],
    ['decimal', counts.decimal],
    ['text', counts.text],
  ];

  for (const [type, cnt] of candidates) {
    if (cnt > dominantCount) {
      dominantType = type;
      dominantCount = cnt;
    }
  }

  if (counts.integer > 0 && counts.decimal > 0 && numericCount >= dominantCount) {
    dominantType = 'decimal';
    dominantCount = numericCount;
  }

  const ratio = dominantCount / nonEmptyCount;
  let detectedType: ColumnType = dominantType;
  let typeInconsistentCount = nonEmptyCount - dominantCount;

  if (detectedType === 'email' || (hint.includes('email') && counts.email > 0)) {
    detectedType = 'email';
    invalidCount = 0;
    for (const val of values) {
      if (!isMissingValue(val) && !isValidEmailSyntax(val)) {
        invalidCount++;
      }
    }
    typeInconsistentCount = invalidCount;
  } else if (detectedType === 'date' || (hint.includes('date') && counts.date > 0)) {
    detectedType = 'date';
    invalidCount = 0;
    ambiguousDateCount = 0;
    for (const val of values) {
      if (isMissingValue(val)) continue;
      const parsed = parseDateValue(val, true);
      if (!parsed.valid) invalidCount++;
      else if (parsed.ambiguous) ambiguousDateCount++;
    }
    typeInconsistentCount = invalidCount;
  } else if (
    detectedType === 'phone' ||
    ((hint.includes('phone') || hint.includes('mobile') || hint.includes('tel')) &&
      counts.phone > 0)
  ) {
    detectedType = 'phone';
    invalidCount = 0;
    for (const val of values) {
      if (isMissingValue(val)) continue;
      // If value starts with '+' try parsing international; otherwise check loose digit bounds (region-specific happens in explicit normalize step)
      const trimmed = val.trim();
      if (trimmed.startsWith('+')) {
        const parsed = parsePhoneNumberFromString(trimmed);
        if (!parsed || !parsed.isValid()) invalidCount++;
      } else {
        const digits = trimmed.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) invalidCount++;
      }
    }
    typeInconsistentCount = invalidCount;
  } else if (ratio < 0.75) {
    detectedType = 'mixed';
    typeInconsistentCount = nonEmptyCount - dominantCount;
  }

  return {
    detectedType,
    nonEmptyCount,
    missingCount,
    invalidCount,
    ambiguousDateCount,
    typeInconsistentCount,
  };
}

export function computeQualityScore(
  headers: string[],
  rows: string[][],
  columnProfiles: ColumnProfile[],
  duplicateRowCount: number,
  typeInconsistentCount: number,
): QualityScoreBreakdown {
  const totalRows = rows.length;
  const totalCols = headers.length;
  const totalCells = totalRows * totalCols;

  const missingCount = columnProfiles.reduce((acc, col) => acc + col.missingCount, 0);
  const invalidCount = columnProfiles.reduce((acc, col) => acc + col.invalidCount, 0);

  if (totalRows === 0 || totalCells === 0) {
    return {
      score: 100,
      missingRate: 0,
      invalidRate: 0,
      duplicateRate: 0,
      typeInconsistencyRate: 0,
      missingCount: 0,
      invalidCount: 0,
      duplicateRowCount: 0,
      typeInconsistentCount: 0,
      totalCells: 0,
      totalRows: 0,
      formulaDescription:
        'score = clamp(100 - (30 * missing_rate + 30 * invalid_rate + 25 * duplicate_rate + 15 * type_inconsistency_rate), 0, 100)',
    };
  }

  const missingRate = missingCount / totalCells;
  const invalidRate = invalidCount / totalCells;
  const duplicateRate = duplicateRowCount / totalRows;
  const populatedCells = Math.max(1, totalCells - missingCount);
  const typeInconsistencyRate = Math.min(1, typeInconsistentCount / populatedCells);

  const rawScore =
    100 -
    (30 * missingRate +
      30 * invalidRate +
      25 * duplicateRate +
      15 * typeInconsistencyRate);

  const score = Math.round(Math.max(0, Math.min(100, rawScore)) * 10) / 10;

  return {
    score,
    missingRate,
    invalidRate,
    duplicateRate,
    typeInconsistencyRate,
    missingCount,
    invalidCount,
    duplicateRowCount,
    typeInconsistentCount,
    totalCells,
    totalRows,
    formulaDescription:
      'score = clamp(100 - (30 * missing_rate + 30 * invalid_rate + 25 * duplicate_rate + 15 * type_inconsistency_rate), 0, 100)',
  };
}
