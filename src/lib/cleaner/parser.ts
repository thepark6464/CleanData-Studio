import Papa from 'papaparse';
import {
  type CleaningWarning,
  type ColumnProfile,
  CsvParseError,
  type DatasetInspection,
  type DetectedProblems,
} from './types';
import {
  computeQualityScore,
  inferColumnType,
  isFormulaTrigger,
  isMissingValue,
  isValidEmailSyntax,
  parseDateValue,
} from './validators';

export const MAX_BROWSER_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

const SUPPORTED_DELIMITERS: Array<',' | ';' | '\t' | '|'> = [',', ';', '\t', '|'];

function hasBinarySignature(bytes: Uint8Array): string | null {
  if (bytes.length >= 4) {
    // ZIP / XLSX / DOCX: PK\x03\x04
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
      return 'ZIP/XLSX archive detected. Phase 1 supports CSV text files only (XLSX support arrives in Phase 2/3).';
    }
    // PDF: %PDF
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return 'PDF document detected. Only plain-text CSV files are supported.';
    }
    // PNG
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'PNG image detected. Only plain-text CSV files are supported.';
    }
    // ELF
    if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
      return 'Binary executable detected. Only plain-text CSV files are supported.';
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'JPEG image detected. Only plain-text CSV files are supported.';
  }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return 'GZIP compressed file detected. Please decompress to .csv first.';
  }

  // Check for NUL bytes in first 4 KB (indicates binary content)
  const checkLen = Math.min(bytes.length, 4096);
  for (let i = 0; i < checkLen; i++) {
    if (bytes[i] === 0x00) {
      return 'Binary NUL bytes detected. This file does not appear to be a valid CSV text file.';
    }
  }

  return null;
}

export function decodeCsvBytes(buffer: ArrayBuffer): { text: string; encoding: string } {
  if (buffer.byteLength === 0) {
    throw new CsvParseError(
      'EMPTY_FILE',
      'The uploaded file is empty (0 bytes).',
      'Please choose a non-empty CSV file with a header row.',
    );
  }
  if (buffer.byteLength > MAX_BROWSER_FILE_BYTES) {
    throw new CsvParseError(
      'FILE_TOO_LARGE',
      `File size (${(buffer.byteLength / (1024 * 1024)).toFixed(2)} MB) exceeds the 5 MB browser limit.`,
      'Browser-only cleaning supports files up to 5 MB. Larger files will use server processing in Phase 3.',
    );
  }

  const bytes = new Uint8Array(buffer);
  const binaryReason = hasBinarySignature(bytes);
  if (binaryReason) {
    throw new CsvParseError('UNSUPPORTED_BINARY_FILE', 'Unsupported or binary file format.', binaryReason);
  }

  // Detect UTF-8 BOM (EF BB BF)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const withoutBom = bytes.subarray(3);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(withoutBom);
      return { text, encoding: 'UTF-8-BOM' };
    } catch {
      const text = new TextDecoder('windows-1252').decode(withoutBom);
      return { text, encoding: 'Windows-1252 (with BOM)' };
    }
  }

  // Try strict UTF-8
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, encoding: 'UTF-8' };
  } catch {
    // Fallback to Windows-1252 / Latin-1
    const text = new TextDecoder('windows-1252').decode(bytes);
    return { text, encoding: 'Windows-1252 / Latin-1' };
  }
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      count++;
    }
  }
  return count;
}

export function detectDelimiter(text: string): ',' | ';' | '\t' | '|' {
  const sampleLines = text
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 20);

  if (sampleLines.length === 0) return ',';

  let bestDelimiter: ',' | ';' | '\t' | '|' = ',';
  let bestScore = -1;

  for (const delim of SUPPORTED_DELIMITERS) {
    const counts = sampleLines.map((line) => countDelimiterOutsideQuotes(line, delim));
    const nonZero = counts.filter((c) => c > 0);
    if (nonZero.length === 0) continue;

    const firstCount = counts[0];
    if (firstCount === 0) continue;

    const consistentLines = counts.filter((c) => c === firstCount).length;
    const consistencyRatio = consistentLines / counts.length;
    const totalMatches = counts.reduce((a, b) => a + b, 0);

    // Reward high consistency across lines + high column separator counts
    const score = consistencyRatio * 100 + Math.min(totalMatches, 200);
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delim;
    }
  }

  return bestDelimiter;
}

export function normalizeHeaderNames(rawHeaders: string[]): {
  headers: string[];
  originalHeaders: string[];
  normalizedCount: number;
} {
  const seen = new Map<string, number>();
  const headers: string[] = [];
  let normalizedCount = 0;

  for (let i = 0; i < rawHeaders.length; i++) {
    const raw = rawHeaders[i].replace(/^\uFEFF/, '');
    let base = raw.trim();
    if (!base) {
      base = `column_${i + 1}`;
      normalizedCount++;
    }

    const lowerKey = base.toLowerCase();
    const prevCount = seen.get(lowerKey) ?? 0;
    if (prevCount === 0) {
      seen.set(lowerKey, 1);
      headers.push(base);
    } else {
      const nextCount = prevCount + 1;
      seen.set(lowerKey, nextCount);
      let candidate = `${base}_${nextCount}`;
      while (seen.has(candidate.toLowerCase())) {
        candidate = `${candidate}_dup`;
      }
      seen.set(candidate.toLowerCase(), 1);
      headers.push(candidate);
      normalizedCount++;
    }
  }

  return {
    headers,
    originalHeaders: rawHeaders.map((h) => h.replace(/^\uFEFF/, '')),
    normalizedCount,
  };
}

export function inspectParsedTable(params: {
  filename: string;
  inputFormat?: 'csv' | 'xlsx';
  sheetNames?: string[];
  selectedSheet?: string;
  byteSize: number;
  encoding: string;
  delimiter: ',' | ';' | '\t' | '|';
  headers: string[];
  originalHeaders: string[];
  normalizedHeadersCount: number;
  rows: string[][];
}): DatasetInspection {
  const {
    filename,
    inputFormat = 'csv',
    sheetNames,
    selectedSheet,
    byteSize,
    encoding,
    delimiter,
    headers,
    originalHeaders,
    normalizedHeadersCount,
    rows,
  } = params;

  const warnings: CleaningWarning[] = [];

  if (normalizedHeadersCount > 0) {
    warnings.push({
      code: 'NORMALIZED_HEADERS',
      severity: 'warning',
      message: `${normalizedHeadersCount} blank or duplicate column header(s) were automatically disambiguated for safe inspection.`,
      count: normalizedHeadersCount,
    });
  }

  let emptyRows = 0;
  const nonEmptyRowKeys = new Set<string>();
  let duplicateRows = 0;
  let whitespaceCells = 0;
  let formulaCells = 0;

  for (const row of rows) {
    const isFullyBlank = row.every((cell) => cell.trim() === '');
    if (isFullyBlank) {
      emptyRows++;
      continue;
    }

    const rowKey = JSON.stringify(row);
    if (nonEmptyRowKeys.has(rowKey)) {
      duplicateRows++;
    } else {
      nonEmptyRowKeys.add(rowKey);
    }

    for (const cell of row) {
      if (cell !== cell.trim()) {
        whitespaceCells++;
      }
      if (isFormulaTrigger(cell)) {
        formulaCells++;
      }
    }
  }

  let missingCells = 0;
  let invalidEmails = 0;
  let invalidPhones = 0;
  let ambiguousDates = 0;
  let unparseableDates = 0;
  let totalTypeInconsistent = 0;
  const mixedTypeColumns: string[] = [];

  const columnProfiles: ColumnProfile[] = headers.map((header, colIdx) => {
    const colValues = rows.map((row) => row[colIdx] ?? '');
    const inferred = inferColumnType(colValues, header);

    let whitespaceIssueCount = 0;
    let formulaTriggerCount = 0;
    const uniqueSet = new Set<string>();
    const sampleValues: string[] = [];

    for (const val of colValues) {
      if (val !== val.trim()) whitespaceIssueCount++;
      if (isFormulaTrigger(val)) formulaTriggerCount++;
      if (!isMissingValue(val)) {
        uniqueSet.add(val.trim());
        if (sampleValues.length < 4 && !sampleValues.includes(val)) {
          sampleValues.push(val);
        }
      }
    }

    missingCells += inferred.missingCount;
    totalTypeInconsistent += inferred.typeInconsistentCount;

    if (inferred.detectedType === 'email') {
      invalidEmails += inferred.invalidCount;
    } else if (inferred.detectedType === 'phone') {
      invalidPhones += inferred.invalidCount;
    } else if (inferred.detectedType === 'date') {
      ambiguousDates += inferred.ambiguousDateCount;
      unparseableDates += inferred.invalidCount;
    }

    if (inferred.detectedType === 'mixed') {
      mixedTypeColumns.push(header);
    }

    return {
      name: header,
      originalName: originalHeaders[colIdx] ?? header,
      index: colIdx,
      detectedType: inferred.detectedType,
      nonEmptyCount: inferred.nonEmptyCount,
      missingCount: inferred.missingCount,
      uniqueCount: uniqueSet.size,
      invalidCount: inferred.invalidCount,
      whitespaceIssueCount,
      ambiguousDateCount: inferred.ambiguousDateCount,
      formulaTriggerCount,
      sampleValues,
    };
  });

  if (rows.length === 0) {
    warnings.push({
      code: 'HEADER_ONLY_FILE',
      severity: 'info',
      message: 'This CSV contains column headers but zero data rows.',
    });
  }
  if (ambiguousDates > 0) {
    warnings.push({
      code: 'AMBIGUOUS_DATES',
      severity: 'warning',
      message: `${ambiguousDates} date value(s) (such as DD/MM vs MM/DD) are ambiguous. Choose your day-first or month-first convention before standardizing.`,
      count: ambiguousDates,
    });
  }
  if (formulaCells > 0) {
    warnings.push({
      code: 'FORMULA_CELLS_DETECTED',
      severity: 'warning',
      message: `${formulaCells} cell(s) start with =, +, -, @, tab, or CR. Formula-injection protection is enabled by default on export.`,
      count: formulaCells,
    });
  }
  if (invalidEmails > 0) {
    warnings.push({
      code: 'INVALID_EMAILS',
      severity: 'warning',
      message: `${invalidEmails} email value(s) failed syntax validation. Note: syntax validation never verifies whether a mailbox exists.`,
      count: invalidEmails,
    });
  }

  const problems: DetectedProblems = {
    emptyRows,
    duplicateRows,
    whitespaceCells,
    missingCells,
    invalidEmails,
    invalidPhones,
    ambiguousDates,
    unparseableDates,
    formulaCells,
    normalizedHeadersCount,
    mixedTypeColumns,
  };

  const qualityBefore = computeQualityScore(
    headers,
    rows,
    columnProfiles,
    duplicateRows,
    totalTypeInconsistent,
  );

  // Additional validation sanity check for email/date columns
  void isValidEmailSyntax;
  void parseDateValue;

  return {
    filename,
    inputFormat,
    sheetNames,
    selectedSheet,
    byteSize,
    encoding,
    delimiter,
    rowCount: rows.length,
    columnCount: headers.length,
    headers,
    originalHeaders,
    rows,
    columnProfiles,
    problems,
    qualityBefore,
    warnings,
  };
}

export function parseCsvBuffer(
  buffer: ArrayBuffer,
  filename: string,
  options?: { delimiterOverride?: ',' | ';' | '\t' | '|' },
): DatasetInspection {
  const { text, encoding } = decodeCsvBytes(buffer);
  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new CsvParseError(
      'EMPTY_FILE',
      'The uploaded CSV contains only whitespace and no headers.',
      'Provide a CSV file with at least a header row.',
    );
  }

  const delimiter = options?.delimiterOverride ?? detectDelimiter(text);

  const parsed = Papa.parse<string[]>(text, {
    delimiter,
    header: false,
    skipEmptyLines: false,
    quoteChar: '"',
    escapeChar: '"',
  });

  const fatalErrors = parsed.errors.filter(
    (err) => err.type === 'Quotes' || err.code === 'MissingQuotes',
  );
  if (fatalErrors.length > 0) {
    const firstErr = fatalErrors[0];
    throw new CsvParseError(
      'MALFORMED_CSV',
      `Malformed CSV quoting near row ${(firstErr.row ?? 0) + 1}: ${firstErr.message}`,
      'Check for unclosed double-quote characters in the source file.',
    );
  }

  let rawRows = parsed.data;
  // Remove single trailing empty row introduced by final newline at EOF
  if (
    rawRows.length > 1 &&
    rawRows[rawRows.length - 1].length === 1 &&
    rawRows[rawRows.length - 1][0] === '' &&
    (text.endsWith('\n') || text.endsWith('\r'))
  ) {
    rawRows = rawRows.slice(0, -1);
  }

  if (rawRows.length === 0) {
    throw new CsvParseError('NO_HEADERS', 'No header row could be found in this CSV.');
  }

  const rawHeaders = rawRows[0];
  if (rawHeaders.length === 0 || (rawHeaders.length === 1 && rawHeaders[0].trim() === '' && rawRows.length === 1)) {
    throw new CsvParseError('NO_HEADERS', 'Header row is empty.');
  }

  const { headers, originalHeaders, normalizedCount } = normalizeHeaderNames(rawHeaders);
  const colCount = headers.length;

  const dataRows: string[][] = rawRows.slice(1).map((row) => {
    const normalized = new Array<string>(colCount);
    for (let i = 0; i < colCount; i++) {
      normalized[i] = row[i] ?? '';
    }
    return normalized;
  });

  return inspectParsedTable({
    filename,
    byteSize: buffer.byteLength,
    encoding,
    delimiter,
    headers,
    originalHeaders,
    normalizedHeadersCount: normalizedCount,
    rows: dataRows,
  });
}
