import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import type {
  ColumnProfile,
  ColumnType,
  DateOutputFormat,
  NumericColumnRule,
  PhoneOutputFormat,
  QualityScoreBreakdown,
  SupportedPhoneRegion,
} from './types';

export const MISSING_TOKENS = new Set([
  '',
  'na',
  'n/a',
  'null',
  'nan',
  'none',
  'unknown',
  '??',
  '-',
  'invalid-email',
  'not-a-date',
  'misc',
]);

export const DEFAULT_PLACEHOLDER_TOKENS = [
  'n/a',
  'na',
  'null',
  'none',
  'nan',
  'unknown',
  '??',
  '-',
  'invalid-email',
  'not-a-date',
  'misc',
];

export const COUPON_EMPTY_TOKENS = new Set([
  '',
  'none',
  'na',
  'n/a',
  'null',
  'nan',
  'nil',
  'no coupon',
  'no_coupon',
  '-',
]);

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
const E164_SAFE_REGEX = /^\+[1-9]\d{6,14}$/;

const ASCENDING_SEQUENTIAL = new Set([
  '0123456',
  '1234567',
  '01234567',
  '12345678',
  '012345678',
  '123456789',
  '0123456789',
  '1234567890',
]);

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

export function isPlaceholderValue(value: string, tokens: string[] | Set<string>): boolean {
  const norm = value.trim().toLowerCase();
  if (!norm) return false;
  if (tokens instanceof Set) return tokens.has(norm);
  return tokens.includes(norm);
}

export function isCouponHeader(header: string): boolean {
  return /\b(coupon|promo|voucher)(?:_code)?\b/i.test(header) || /coupon|promo|voucher/i.test(header);
}

export function isQuantityHeader(header: string): boolean {
  const h = header.trim().toLowerCase();
  return /^(qty|quantity|units|item_qty|order_qty)$/.test(h) || /\b(qty|quantity)\b/.test(h);
}

export function isPriceHeader(header: string): boolean {
  const h = header.trim().toLowerCase();
  return /^(price|unit_price|item_price|mrp|unit_cost|selling_price)$/.test(h) || /\b(unit_price|item_price|price|mrp)\b/.test(h);
}

export function defaultNumericRuleForHeader(header: string): NumericColumnRule | null {
  if (isQuantityHeader(header)) {
    return {
      mode: 'positive_integer',
      min: 1,
      max: 1000,
      sentinels: ['-99', '-999'],
    };
  }
  if (isPriceHeader(header)) {
    return {
      mode: 'positive_decimal',
      min: 0.000001,
      decimals: 2,
      sentinels: ['-99', '-999'],
    };
  }
  return null;
}

export function validateNumericValue(
  raw: string,
  rule: NumericColumnRule,
): { valid: boolean; formatted: string; numericValue?: number } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, formatted: raw };

  const sentinels = rule.sentinels ?? ['-99', '-999'];
  if (sentinels.includes(trimmed)) {
    return { valid: false, formatted: raw };
  }

  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    return { valid: false, formatted: raw };
  }

  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { valid: false, formatted: raw };
  }

  if (rule.mode === 'positive_integer' || rule.mode === 'integer') {
    if (!Number.isInteger(num)) {
      return { valid: false, formatted: raw };
    }
    if (rule.mode === 'positive_integer' && num <= 0) {
      return { valid: false, formatted: raw };
    }
  } else if (rule.mode === 'positive_decimal' && num <= 0) {
    return { valid: false, formatted: raw };
  } else if (rule.mode === 'non_negative_decimal' && num < 0) {
    return { valid: false, formatted: raw };
  }

  if (rule.min !== undefined && num < rule.min) {
    return { valid: false, formatted: raw };
  }
  if (rule.max !== undefined && num > rule.max) {
    return { valid: false, formatted: raw };
  }

  if (rule.mode === 'positive_integer' || rule.mode === 'integer') {
    return { valid: true, formatted: String(Math.trunc(num)), numericValue: num };
  }

  const decimals = rule.decimals ?? (rule.mode === 'positive_decimal' ? 2 : undefined);
  const formatted = decimals !== undefined ? num.toFixed(decimals) : String(num);
  return { valid: true, formatted, numericValue: num };
}

export function isValidEmailSyntax(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 254) return false;
  if (trimmed.includes('..')) return false;
  return EMAIL_REGEX.test(trimmed);
}

export function isJunkPhoneDigits(nationalDigits: string, region: SupportedPhoneRegion): boolean {
  if (!nationalDigits) return true;
  if (/^(\d)\1+$/.test(nationalDigits)) return true;
  if (ASCENDING_SEQUENTIAL.has(nationalDigits)) return true;
  if (region === 'IN' && nationalDigits.length !== 10) return true;
  return false;
}

const phoneValidationCache = new Map<string, { valid: boolean; formatted: string }>();

export function validateAndFormatPhone(
  raw: string,
  region: SupportedPhoneRegion,
  outputFormat: PhoneOutputFormat = 'E.164',
): { valid: boolean; formatted: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, formatted: raw };

  const cacheKey = `${region}|${outputFormat}|${trimmed}`;
  const cached = phoneValidationCache.get(cacheKey);
  if (cached) return cached;

  const parsed = parsePhoneNumberFromString(trimmed, region as CountryCode);
  if (!parsed || !parsed.isValid()) {
    const res = { valid: false, formatted: raw };
    if (phoneValidationCache.size < 25000) phoneValidationCache.set(cacheKey, res);
    return res;
  }

  const natDigits = String(parsed.nationalNumber ?? '').replace(/\D/g, '');
  if (isJunkPhoneDigits(natDigits, (parsed.country as SupportedPhoneRegion | undefined) ?? region)) {
    const res = { valid: false, formatted: raw };
    if (phoneValidationCache.size < 25000) phoneValidationCache.set(cacheKey, res);
    return res;
  }

  let formatted: string;
  if (outputFormat === 'INTERNATIONAL') {
    formatted = parsed.formatInternational();
  } else if (outputFormat === 'NATIONAL') {
    formatted = parsed.formatNational();
  } else {
    formatted = parsed.number;
  }

  const res = { valid: true, formatted };
  if (phoneValidationCache.size < 25000) phoneValidationCache.set(cacheKey, res);
  return res;
}

const exportPhoneLiteralCache = new Map<string, boolean>();

export function isValidPhoneLiteralForExport(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith('+')) return false;
  if (E164_SAFE_REGEX.test(trimmed)) return true;
  const cached = exportPhoneLiteralCache.get(trimmed);
  if (cached !== undefined) return cached;
  let valid = false;
  if (/^\+[1-9][\d\s().-]{6,19}\d$/.test(trimmed) && !trimmed.slice(1).includes('+')) {
    const parsed = parsePhoneNumberFromString(trimmed);
    valid = Boolean(parsed && parsed.isValid());
  }
  if (exportPhoneLiteralCache.size < 25000) {
    exportPhoneLiteralCache.set(trimmed, valid);
  }
  return valid;
}

export function isFormulaTrigger(value: string, isNumericColumn = false): boolean {
  if (!value) return false;
  const first = value.charAt(0);
  if (first === '=' || first === '@' || first === '\t' || first === '\r') {
    return true;
  }
  if (first === '+') {
    if (isValidPhoneLiteralForExport(value)) return false;
    if (isNumericColumn && /^\+\d+(?:\.\d+)?$/.test(value.trim())) return false;
    return true;
  }
  if (first === '-') {
    return !/^-?\d+(?:\.\d+)?$/.test(value.trim());
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

const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const CURRENT_MAX_ALLOWED_DATE_YEAR = Math.max(2026, new Date().getFullYear()) + 1;

export function getMaxAllowedDateYear(): number {
  return Math.max(CURRENT_MAX_ALLOWED_DATE_YEAR, new Date().getFullYear() + 1);
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1990 || year > CURRENT_MAX_ALLOWED_DATE_YEAR || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay = month === 2 && isLeap ? 29 : DAYS_IN_MONTH[month];
  return day <= maxDay;
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

  if (looksLikeDateCandidate(t) && (parseDateValue(t, true).valid || hint.includes('date'))) {
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
  const isCouponCol = isCouponHeader(headerName);
  const numericRule = defaultNumericRuleForHeader(headerName);

  for (const val of values) {
    const trimmed = val.trim();
    if (isCouponCol && trimmed === '') {
      // Blank coupon is explicitly documented as valid "no coupon" state
      continue;
    }
    if (isCouponCol && COUPON_EMPTY_TOKENS.has(trimmed.toLowerCase())) {
      // Count non-canonical empty sentinels like "NONE" / "nil" once under invalidCount, not missingCount
      nonEmptyCount++;
      counts.text++;
      continue;
    }
    if (isMissingValue(val)) {
      missingCount++;
      continue;
    }
    nonEmptyCount++;
    const cellType = classifyCellType(val, hint);
    counts[cellType]++;
  }

  if (nonEmptyCount === 0) {
    return {
      detectedType: isCouponCol ? 'text' : 'empty',
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
      const trimmed = val.trim();
      if (trimmed.startsWith('+')) {
        if (!E164_SAFE_REGEX.test(trimmed) || isJunkPhoneDigits(trimmed.slice(-10), 'IN')) {
          const parsed = parsePhoneNumberFromString(trimmed);
          const nat = String(parsed?.nationalNumber ?? '').replace(/\D/g, '');
          const region = (parsed?.country as SupportedPhoneRegion | undefined) ?? 'IN';
          if (!parsed || !parsed.isValid() || isJunkPhoneDigits(nat, region)) {
            invalidCount++;
          }
        }
      } else {
        const digits = trimmed.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15 || isJunkPhoneDigits(digits.slice(-10), 'IN')) {
          invalidCount++;
        }
      }
    }
    typeInconsistentCount = invalidCount;
  } else if (numericRule) {
    detectedType = numericRule.mode === 'positive_integer' ? 'integer' : 'decimal';
    invalidCount = 0;
    for (const val of values) {
      if (isMissingValue(val)) continue;
      if (!validateNumericValue(val, numericRule).valid) {
        invalidCount++;
      }
    }
    typeInconsistentCount = invalidCount;
  } else if (isCouponCol) {
    detectedType = 'text';
    invalidCount = 0;
    for (const val of values) {
      const trimmed = val.trim();
      if (trimmed !== '' && COUPON_EMPTY_TOKENS.has(trimmed.toLowerCase())) {
        invalidCount++;
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

function isCellFailingValidation(
  val: string,
  headerName: string,
  detectedType: ColumnType,
  numericRule: NumericColumnRule | null,
): boolean {
  const trimmed = val.trim();
  const isCouponCol = isCouponHeader(headerName);

  // Explicit exemption: blank coupon means "no coupon applied"
  if (isCouponCol && trimmed === '') {
    return val !== '';
  }
  if (isCouponCol && COUPON_EMPTY_TOKENS.has(trimmed.toLowerCase())) {
    return true;
  }
  // Missing or empty cell in any non-coupon column MUST fail validation
  if (isMissingValue(val)) {
    return true;
  }
  // Whitespace hygiene defect
  if (val !== trimmed || / {2,}|\t/.test(val)) {
    return true;
  }
  const isNumericCol = detectedType === 'integer' || detectedType === 'decimal';
  if (isFormulaTrigger(val, isNumericCol)) {
    return true;
  }
  if (detectedType === 'email') {
    return !isValidEmailSyntax(val);
  }
  if (detectedType === 'date') {
    return !parseDateValue(val, true).valid;
  }
  if (detectedType === 'phone') {
    if (trimmed.startsWith('+')) {
      if (!E164_SAFE_REGEX.test(trimmed) || isJunkPhoneDigits(trimmed.slice(-10), 'IN')) {
        const parsed = parsePhoneNumberFromString(trimmed);
        const nat = String(parsed?.nationalNumber ?? '').replace(/\D/g, '');
        const region = (parsed?.country as SupportedPhoneRegion | undefined) ?? 'IN';
        return !parsed || !parsed.isValid() || isJunkPhoneDigits(nat, region);
      }
      return false;
    }
    const digits = trimmed.replace(/\D/g, '');
    return digits.length < 7 || digits.length > 15 || isJunkPhoneDigits(digits.slice(-10), 'IN');
  }
  if (numericRule) {
    return !validateNumericValue(val, numericRule).valid;
  }
  return false;
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
      passingCells: 0,
      failingCells: 0,
      validationPassRate: 1,
      formulaDescription:
        'score = round(100 * (passing_cells / total_cells), 1); non-coupon empty/missing cells always fail, empty coupon cells pass as no-coupon, each cell counted at most once',
    };
  }

  const missingRate = missingCount / totalCells;
  const invalidRate = invalidCount / totalCells;
  const duplicateRate = duplicateRowCount / totalRows;
  const populatedCells = Math.max(1, totalCells - missingCount);
  const typeInconsistencyRate = Math.min(1, typeInconsistentCount / populatedCells);

  const numericRules = headers.map((h) => defaultNumericRuleForHeader(h));
  const detectedTypes = headers.map(
    (h, idx) => columnProfiles[idx]?.detectedType ?? 'text',
  );

  // Per-cell exact deduplicated pass/fail classification (each cell counted at most once)
  let failingCells = 0;
  const seenRowKeys = new Set<string>();
  for (const row of rows) {
    const isBlankRow = row.every((c) => (c ?? '').trim() === '');
    if (isBlankRow) {
      failingCells += totalCols;
      continue;
    }
    const rowKey = JSON.stringify(row);
    if (seenRowKeys.has(rowKey)) {
      failingCells += totalCols;
      continue;
    }
    seenRowKeys.add(rowKey);

    for (let c = 0; c < totalCols; c++) {
      const val = row[c] ?? '';
      if (isCellFailingValidation(val, headers[c], detectedTypes[c], numericRules[c])) {
        failingCells++;
      }
    }
  }

  failingCells = Math.min(totalCells, failingCells);
  const passingCells = Math.max(0, totalCells - failingCells);
  const validationPassRate = passingCells / totalCells;

  const score = Math.round(Math.max(0, Math.min(100, validationPassRate * 100)) * 10) / 10;

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
    passingCells,
    failingCells,
    validationPassRate,
    formulaDescription:
      'score = round(100 * (passing_cells / total_cells), 1); non-coupon empty/missing cells always fail, empty coupon cells pass as no-coupon, each cell counted at most once',
  };
}
