import Papa from 'papaparse';
import writeXlsxFile, { type Row as XlsxRow } from 'write-excel-file/universal';
import type { CleaningIssue, CleaningReport, ColumnType } from './types';
import { isFormulaTrigger, isValidPhoneLiteralForExport } from './validators';

export interface ExportCsvOptions {
  delimiter?: ',' | ';' | '\t' | '|';
  formulaProtection: boolean;
  columnTypes?: Record<string, ColumnType>;
}

export function escapeFormulaCell(
  value: string,
  isNumericColumn: boolean,
  isPhoneColumn = false,
): {
  value: string;
  escaped: boolean;
} {
  if (!value) return { value, escaped: false };
  const first = value.charAt(0);

  if (first === '=' || first === '@' || first === '\t' || first === '\r') {
    return { value: `'${value}`, escaped: true };
  }

  if (first === '+') {
    if (isValidPhoneLiteralForExport(value)) {
      return { value, escaped: false };
    }
    if (isPhoneColumn && /^\+[1-9][\d\s().-]{6,19}$/.test(value.trim()) && !value.slice(1).includes('+')) {
      return { value, escaped: false };
    }
    if (isNumericColumn && /^\+\d+(?:\.\d+)?$/.test(value.trim())) {
      return { value, escaped: false };
    }
    return { value: `'${value}`, escaped: true };
  }

  if (first === '-') {
    if (/^-\d+(?:\.\d+)?$/.test(value.trim())) {
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
      const isPhone = colType === 'phone';
      const result = escapeFormulaCell(cell, isNumeric, isPhone);
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

export function exportIssuesToCsv(
  issues: CleaningIssue[],
  delimiter: ',' | ';' | '\t' | '|' = ',',
): string {
  const fields = ['row', 'column', 'original', 'new', 'rule_id', 'severity'];
  const data = issues.map((issue) => [
    String(issue.row),
    issue.column,
    issue.original,
    issue.new,
    issue.rule_id,
    issue.severity,
  ]);
  return Papa.unparse(
    { fields, data },
    {
      delimiter,
      quotes: false,
      quoteChar: '"',
      escapeChar: '"',
      newline: '\n',
    },
  );
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
      const isPhone = colType === 'phone';

      if (isNumeric && /^-?\d+(?:\.\d+)?$/.test(cell.trim())) {
        const num = Number(cell.trim());
        if (Number.isFinite(num)) {
          return { value: num, type: Number };
        }
      }

      const safeText = options.formulaProtection
        ? escapeFormulaCell(cell, isNumeric, isPhone).value
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
