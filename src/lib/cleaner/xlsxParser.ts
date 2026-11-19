import readXlsxFile from 'read-excel-file/universal';
import { MAX_BROWSER_FILE_BYTES, inspectParsedTable, normalizeHeaderNames } from './parser';
import { CsvParseError, type DatasetInspection } from './types';

export const MAX_BROWSER_XLSX_ROWS = 50000;

function cellValueToString(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return '';
    const yyyy = cell.getUTCFullYear();
    const mm = String(cell.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(cell.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  return String(cell);
}

export async function parseXlsxBuffer(
  buffer: ArrayBuffer,
  filename: string,
  selectedSheetName?: string,
): Promise<DatasetInspection> {
  if (buffer.byteLength === 0) {
    throw new CsvParseError(
      'EMPTY_FILE',
      'The uploaded XLSX workbook is empty (0 bytes).',
      'Please choose a valid .xlsx spreadsheet.',
    );
  }

  if (buffer.byteLength > MAX_BROWSER_FILE_BYTES) {
    throw new CsvParseError(
      'FILE_TOO_LARGE',
      `Workbook size (${(buffer.byteLength / (1024 * 1024)).toFixed(2)} MB) exceeds the 5 MB browser limit.`,
      'Browser-only cleaning supports files up to 5 MB. Larger workbooks will route to server processing in Phase 3.',
    );
  }

  const bytes = new Uint8Array(buffer);
  const hasZipSignature =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;

  if (!hasZipSignature) {
    throw new CsvParseError(
      'MALFORMED_XLSX',
      'Invalid XLSX file signature.',
      'The file extension is .xlsx, but the contents do not match an OpenXML spreadsheet archive.',
    );
  }

  let sheets;
  try {
    sheets = await readXlsxFile(buffer);
  } catch (err) {
    throw new CsvParseError(
      'MALFORMED_XLSX',
      'Unable to read the XLSX workbook safely.',
      err instanceof Error ? err.message : 'Corrupted or unsupported OpenXML workbook.',
    );
  }

  if (!sheets || sheets.length === 0) {
    throw new CsvParseError('EMPTY_FILE', 'This XLSX workbook contains no worksheets.');
  }

  const sheetNames = sheets.map((s) => s.sheet);
  const chosenSheet =
    (selectedSheetName ? sheets.find((s) => s.sheet === selectedSheetName) : undefined) ??
    sheets[0];

  const rawRows = chosenSheet.data;
  if (!rawRows || rawRows.length === 0) {
    throw new CsvParseError(
      'NO_HEADERS',
      `Worksheet "${chosenSheet.sheet}" is empty and has no header row.`,
    );
  }

  if (rawRows.length - 1 > MAX_BROWSER_XLSX_ROWS) {
    throw new CsvParseError(
      'TOO_MANY_ROWS',
      `Worksheet "${chosenSheet.sheet}" exceeds the ${MAX_BROWSER_XLSX_ROWS.toLocaleString()} row browser safety limit.`,
      'Use server-side processing (Phase 3) for very large spreadsheets.',
    );
  }

  const rawHeaders = rawRows[0].map(cellValueToString);
  if (rawHeaders.length === 0 || (rawHeaders.length === 1 && rawHeaders[0].trim() === '' && rawRows.length === 1)) {
    throw new CsvParseError('NO_HEADERS', `Worksheet "${chosenSheet.sheet}" has an empty header row.`);
  }

  const { headers, originalHeaders, normalizedCount } = normalizeHeaderNames(rawHeaders);
  const colCount = headers.length;

  const dataRows: string[][] = rawRows.slice(1).map((row) => {
    const normalized = new Array<string>(colCount);
    for (let i = 0; i < colCount; i++) {
      normalized[i] = cellValueToString(row[i]);
    }
    return normalized;
  });

  return inspectParsedTable({
    filename,
    inputFormat: 'xlsx',
    sheetNames,
    selectedSheet: chosenSheet.sheet,
    byteSize: buffer.byteLength,
    encoding: 'XLSX OpenXML (static values, no formula evaluation)',
    delimiter: ',',
    headers,
    originalHeaders,
    normalizedHeadersCount: normalizedCount,
    rows: dataRows,
  });
}
