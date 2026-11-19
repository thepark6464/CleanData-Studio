import Papa from 'papaparse';
import writeXlsxFile, { type Row as XlsxRow } from 'write-excel-file/universal';
import type { CleaningReport, ColumnType } from './types';
import { isFormulaTrigger } from './validators';

export interface ExportCsvOptions {
  delimiter?: ',' | ';' | '\t' | '|';
  formulaProtection: boolean;
  columnTypes?: Record<string, ColumnType>;
}

export function escapeFormulaCell(
  value: string,
  isNumericColumn: boolean,
): {
  value: string;
  escaped: boolean;
} {
  if (!value) return { value, escaped: false };
  const first = value.charAt(0);

  if (first === '=' || first === '+' || first === '@' || first === '\t' || first === '\r') {
    return { value: `'${value}`, escaped: true };
  }

  if (first === '-') {
    if (isNumericColumn && /^-?\d+(?:\.\d+)?$/.test(value)) {
      return { value, escaped: false };
    }
    return { value: `'${value}`, escaped: true };
  }

  return { value, escaped: false };
}

export function exportRowsToCsv(
  headers: string[],
  rows: string[][],
  options: ExportCsvOptions,
): { csvOutput: string; formulaCellsEscaped: number } {
  let formulaCellsEscaped = 0;

  const safeHeaders = headers.map((h) => {
    if (!options.formulaProtection) return h;
    if (isFormulaTrigger(h)) {
      formulaCellsEscaped++;
      return `'${h}`;
    }
    return h;
  });

  const safeRows = rows.map((row) =>
    row.map((cell, idx) => {
      if (!options.formulaProtection) return cell;
      const colName = headers[idx] ?? '';
      const colType = options.columnTypes?.[colName];
      const isNumeric = colType === 'integer' || colType === 'decimal';
      const result = escapeFormulaCell(cell, isNumeric);
      if (result.escaped) formulaCellsEscaped++;
      return result.value;
    }),
  );

  const csvOutput = Papa.unparse(
    {
      fields: safeHeaders,
      data: safeRows,
    },
    {
      delimiter: options.delimiter ?? ',',
      quotes: false,
      quoteChar: '"',
      escapeChar: '"',
      newline: '\n',
    },
  );

  return { csvOutput, formulaCellsEscaped };
}

export async function exportRowsToXlsxBlob(
  headers: string[],
  rows: string[][],
  options: { formulaProtection: boolean; columnTypes?: Record<string, ColumnType> },
): Promise<Blob> {
  const safeHeaderRow: XlsxRow = headers.map((h) => {
    const val = options.formulaProtection && isFormulaTrigger(h) ? `'${h}` : h;
    return { value: val, fontWeight: 'bold', type: String };
  });

  const safeDataRows: XlsxRow[] = rows.map((row) =>
    row.map((cell, idx) => {
      const colName = headers[idx] ?? '';
      const colType = options.columnTypes?.[colName];
      const isNumeric = colType === 'integer' || colType === 'decimal';

      if (isNumeric && /^-?\d+(?:\.\d+)?$/.test(cell.trim())) {
        const num = Number(cell.trim());
        if (Number.isFinite(num)) {
          return { value: num, type: Number };
        }
      }

      const safeText = options.formulaProtection
        ? escapeFormulaCell(cell, isNumeric).value
        : cell;
      return { value: safeText, type: String };
    }),
  );

  const sheetData = [safeHeaderRow, ...safeDataRows];
  const result = writeXlsxFile(sheetData, { sheet: 'Cleaned Data' });
  return result.toBlob();
}

export function exportReportToJson(report: CleaningReport): string {
  return JSON.stringify(report, null, 2);
}
