export type ColumnType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'date'
  | 'email'
  | 'phone'
  | 'boolean'
  | 'mixed'
  | 'empty';

export type ValidationState = 'valid' | 'invalid' | 'missing' | 'duplicate' | 'unverified';

export type OperationId =
  | 'remove_empty_rows'
  | 'remove_duplicates'
  | 'trim_whitespace'
  | 'placeholder_to_null'
  | 'canonicalize_coupons'
  | 'normalize_text'
  | 'standardize_dates'
  | 'normalize_emails'
  | 'normalize_phone_numbers'
  | 'validate_numbers'
  | 'handle_missing_values'
  | 'rename_columns';

export type TextCaseMode = 'none' | 'lower' | 'upper' | 'title';
export type DateOutputFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
export type PhoneOutputFormat = 'E.164' | 'INTERNATIONAL' | 'NATIONAL';
export type SupportedPhoneRegion =
  | 'IN'
  | 'US'
  | 'GB'
  | 'AU'
  | 'CA'
  | 'DE'
  | 'SG'
  | 'FR'
  | 'AE'
  | 'JP';

export type MissingStrategy =
  | 'keep'
  | 'remove_row'
  | 'fill_constant'
  | 'fill_mean'
  | 'fill_median'
  | 'fill_zero';
export type ColumnRenameConvention = 'snake_case' | 'camelCase' | 'lowercase' | 'custom';
export type NumericRuleMode =
  | 'positive_integer'
  | 'positive_decimal'
  | 'non_negative_decimal'
  | 'integer'
  | 'decimal';

export interface ColumnMissingRule {
  strategy: MissingStrategy;
  constantValue?: string;
}

export interface NumericColumnRule {
  mode: NumericRuleMode;
  min?: number;
  max?: number;
  decimals?: number;
  sentinels?: string[];
}

export interface CleaningIssue {
  row: number; // 1-indexed original data row
  column: string;
  original: string;
  new: string;
  rule_id: string;
  severity: 'info' | 'warning' | 'error';
}

export interface NearDuplicateMergeConflict {
  column: string;
  keptValue: string;
  conflictingValues: string[];
}

export interface NearDuplicateMergeRecord {
  keyColumns: string[];
  keyValue: string;
  keptRowNumber: number;
  mergedRowNumbers: number[];
  filledColumns: string[];
  conflicts: NearDuplicateMergeConflict[];
}

export type OperationParamsMap = {
  remove_empty_rows: Record<string, never>;
  remove_duplicates: {
    keyColumns: string[]; // empty array = all columns for exact dedup
    keep: 'first' | 'last';
    mergeNearDuplicates?: boolean;
    mergeKeyColumns?: string[];
  };
  trim_whitespace: {
    columns: string[]; // empty array = all columns
    collapseInternal: boolean;
  };
  placeholder_to_null: {
    columns: string[]; // empty array = all columns except excluded
    tokens: string[]; // case-insensitive trimmed tokens to convert to ""
    excludeColumns?: string[];
  };
  canonicalize_coupons: {
    columns: string[]; // empty array = coupon/promo columns
    emptyTokens?: string[];
    caseMode?: 'upper' | 'preserve';
  };
  normalize_text: {
    columns: string[]; // empty array = all text/mixed columns
    caseMode: TextCaseMode;
    collapseWhitespace: boolean;
    canonicalMerge?: boolean;
  };
  standardize_dates: {
    columns: string[]; // empty array = detected date columns
    dayFirst: boolean;
    outputFormat: DateOutputFormat;
    clearInvalid?: boolean;
  };
  normalize_emails: {
    columns: string[]; // empty array = detected email columns
    clearInvalid?: boolean;
  };
  normalize_phone_numbers: {
    columns: string[]; // empty array = detected phone columns
    defaultRegion: SupportedPhoneRegion;
    format: PhoneOutputFormat;
    clearInvalid?: boolean;
  };
  validate_numbers: {
    columns: string[]; // empty array = auto-detect quantity/price columns or explicit rules
    rules?: Record<string, NumericColumnRule>;
    defaultMaxQuantity?: number;
    clearInvalid?: boolean;
  };
  handle_missing_values: {
    strategies: Record<string, ColumnMissingRule>;
  };
  rename_columns: {
    convention: ColumnRenameConvention;
    customMap: Record<string, string>;
  };
};

export type CleaningOperationConfig = {
  [K in OperationId]: {
    id: K;
    enabled: boolean;
    params: OperationParamsMap[K];
  };
}[OperationId];

export interface ColumnProfile {
  name: string;
  originalName: string;
  index: number;
  detectedType: ColumnType;
  nonEmptyCount: number;
  missingCount: number;
  uniqueCount: number;
  invalidCount: number;
  whitespaceIssueCount: number;
  ambiguousDateCount: number;
  formulaTriggerCount: number;
  sampleValues: string[];
}

export interface DetectedProblems {
  emptyRows: number;
  duplicateRows: number;
  whitespaceCells: number;
  missingCells: number;
  invalidEmails: number;
  invalidPhones: number;
  ambiguousDates: number;
  unparseableDates: number;
  formulaCells: number;
  normalizedHeadersCount: number;
  mixedTypeColumns: string[];
}

export interface QualityScoreBreakdown {
  score: number;
  missingRate: number;
  invalidRate: number;
  duplicateRate: number;
  typeInconsistencyRate: number;
  missingCount: number;
  invalidCount: number;
  duplicateRowCount: number;
  typeInconsistentCount: number;
  totalCells: number;
  totalRows: number;
  formulaDescription: string;
  passingCells?: number;
  failingCells?: number;
  validationPassRate?: number;
}

export interface DatasetInspection {
  filename: string;
  inputFormat: 'csv' | 'xlsx';
  sheetNames?: string[];
  selectedSheet?: string;
  byteSize: number;
  encoding: string;
  delimiter: ',' | ';' | '\t' | '|';
  rowCount: number;
  columnCount: number;
  headers: string[];
  originalHeaders: string[];
  rows: string[][];
  columnProfiles: ColumnProfile[];
  problems: DetectedProblems;
  qualityBefore: QualityScoreBreakdown;
  warnings: CleaningWarning[];
}

export interface CleaningWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  column?: string;
  count?: number;
}

export interface OperationSummary {
  id: OperationId;
  label: string;
  applied: boolean;
  recordsAffected: number;
  details: string;
  parameters: Record<string, unknown>;
}

export interface CleaningReport {
  jobId: string;
  createdAt: string;
  processingPath: 'browser';
  sourceFilename: string;
  inputFormat: 'csv' | 'xlsx';
  encoding: string;
  delimiter: string;
  rowsBefore: number;
  rowsAfter: number;
  columnsBefore: number;
  columnsAfter: number;
  headersBefore: string[];
  headersAfter: string[];
  operationsApplied: OperationSummary[];
  recordsChanged: number;
  recordsRemoved: number;
  duplicatesRemoved: number;
  emptyRowsRemoved: number;
  missingValuesFound: number;
  missingValuesHandled: number;
  formulaInjectionProtected: boolean;
  formulaCellsEscaped: number;
  warnings: CleaningWarning[];
  qualityBefore: QualityScoreBreakdown;
  qualityAfter: QualityScoreBreakdown;
  issues?: CleaningIssue[];
  issueCountsByRule?: Record<string, number>;
  merges?: NearDuplicateMergeRecord[];
  nearDuplicatesMerged?: number;
  includeCleaningFlags?: boolean;
}

export interface DiffCellChange {
  columnIndex: number;
  columnName: string;
  before: string;
  after: string;
}

export interface DiffRow {
  originalRowNumber: number; // 1-indexed data row
  status: 'removed' | 'modified' | 'unchanged';
  reason?: string;
  beforeRow: string[];
  afterRow: string[] | null;
  cellChanges: DiffCellChange[];
}

export interface CleaningResult {
  headers: string[];
  rows: string[][];
  originalHeaders: string[];
  originalRows: string[][];
  csvOutput: string;
  issuesCsvOutput?: string;
  report: CleaningReport;
  diffRows: DiffRow[];
}

export type ParseErrorCode =
  | 'FILE_TOO_LARGE'
  | 'EMPTY_FILE'
  | 'UNSUPPORTED_BINARY_FILE'
  | 'MALFORMED_CSV'
  | 'MALFORMED_XLSX'
  | 'TOO_MANY_ROWS'
  | 'NO_HEADERS';

export class CsvParseError extends Error {
  public readonly code: ParseErrorCode;
  public readonly details?: string;

  constructor(code: ParseErrorCode, message: string, details?: string) {
    super(message);
    this.name = 'CsvParseError';
    this.code = code;
    this.details = details;
  }
}
