import { exportRowsToCsv } from './exporter';
import {
  applyHandleMissingValues,
  applyNormalizeEmails,
  applyNormalizePhoneNumbers,
  applyNormalizeText,
  applyRemoveDuplicates,
  applyRemoveEmptyRows,
  applyRenameColumns,
  applyStandardizeDates,
  applyTrimWhitespace,
  type OperationStepResult,
  type TrackedRow,
} from './operations';
import { inspectParsedTable } from './parser';
import type {
  CleaningOperationConfig,
  CleaningReport,
  CleaningResult,
  CleaningWarning,
  ColumnType,
  DatasetInspection,
  DateOutputFormat,
  DiffCellChange,
  DiffRow,
  OperationId,
  OperationSummary,
  SupportedPhoneRegion,
} from './types';

const OPERATION_LABELS: Record<OperationId, string> = {
  remove_empty_rows: 'Remove Empty Rows',
  remove_duplicates: 'Remove Duplicate Rows',
  trim_whitespace: 'Trim Whitespace',
  normalize_text: 'Normalize Text',
  standardize_dates: 'Standardize Dates',
  normalize_emails: 'Normalize Emails',
  normalize_phone_numbers: 'Normalize Phone Numbers',
  handle_missing_values: 'Handle Missing Values',
  rename_columns: 'Rename Columns',
};

export interface DefaultOperationPreferences {
  dayFirst?: boolean;
  dateFormat?: DateOutputFormat;
  phoneRegion?: SupportedPhoneRegion;
}

export function buildDefaultOperations(
  inspection: DatasetInspection,
  preferences?: DefaultOperationPreferences,
): CleaningOperationConfig[] {
  const { problems, columnProfiles } = inspection;

  const missingStrategies: Record<string, { strategy: 'keep' }> = {};
  for (const col of columnProfiles) {
    missingStrategies[col.name] = { strategy: 'keep' };
  }

  return [
    {
      id: 'remove_empty_rows',
      enabled: problems.emptyRows > 0,
      params: {},
    },
    {
      id: 'trim_whitespace',
      enabled: problems.whitespaceCells > 0,
      params: {
        columns: [],
        collapseInternal: false,
      },
    },
    {
      id: 'normalize_emails',
      enabled: columnProfiles.some((c) => c.detectedType === 'email'),
      params: {
        columns: [],
      },
    },
    {
      id: 'normalize_phone_numbers',
      enabled: columnProfiles.some((c) => c.detectedType === 'phone'),
      params: {
        columns: [],
        defaultRegion: preferences?.phoneRegion ?? 'IN',
        format: 'E.164',
      },
    },
    {
      id: 'standardize_dates',
      enabled: columnProfiles.some((c) => c.detectedType === 'date'),
      params: {
        columns: [],
        dayFirst: preferences?.dayFirst ?? true,
        outputFormat: preferences?.dateFormat ?? 'YYYY-MM-DD',
      },
    },
    {
      id: 'normalize_text',
      enabled: false,
      params: {
        columns: [],
        caseMode: 'none',
        collapseWhitespace: true,
      },
    },
    {
      id: 'handle_missing_values',
      enabled: false,
      params: {
        strategies: missingStrategies,
      },
    },
    {
      id: 'remove_duplicates',
      enabled: problems.duplicateRows > 0,
      params: {
        keyColumns: [],
        keep: 'first',
      },
    },
    {
      id: 'rename_columns',
      enabled: problems.normalizedHeadersCount > 0,
      params: {
        convention: 'snake_case',
        customMap: {},
      },
    },
  ];
}

export interface RunPipelineOptions {
  formulaProtection?: boolean;
  outputDelimiter?: ',' | ';' | '\t' | '|';
}

export function runCleaningPipeline(
  inspection: DatasetInspection,
  operations: CleaningOperationConfig[],
  options: RunPipelineOptions = {},
): CleaningResult {
  const formulaProtection = options.formulaProtection ?? true;
  const outputDelimiter = options.outputDelimiter ?? inspection.delimiter;

  // Deep-clone rows so original inspection is NEVER mutated
  let currentHeaders = [...inspection.headers];
  let currentRows: TrackedRow[] = inspection.rows.map((cells, index) => ({
    originalRowNumber: index + 1,
    cells: [...cells],
  }));

  const initialTypeMap: Record<string, ColumnType> = {};
  for (const col of inspection.columnProfiles) {
    initialTypeMap[col.name] = col.detectedType;
  }

  const removedMap = new Map<number, { reason: string; cells: string[] }>();
  const summaries: OperationSummary[] = [];
  const allWarnings: CleaningWarning[] = [...inspection.warnings];

  let emptyRowsRemoved = 0;
  let duplicatesRemoved = 0;

  for (const op of operations) {
    if (!op.enabled) continue;

    let stepResult: OperationStepResult;

    switch (op.id) {
      case 'remove_empty_rows':
        stepResult = applyRemoveEmptyRows(currentHeaders, currentRows);
        emptyRowsRemoved += stepResult.removedRows.length;
        break;
      case 'remove_duplicates':
        stepResult = applyRemoveDuplicates(currentHeaders, currentRows, op.params);
        duplicatesRemoved += stepResult.removedRows.length;
        break;
      case 'trim_whitespace':
        stepResult = applyTrimWhitespace(currentHeaders, currentRows, op.params);
        break;
      case 'normalize_text':
        stepResult = applyNormalizeText(currentHeaders, currentRows, op.params, initialTypeMap);
        break;
      case 'standardize_dates':
        stepResult = applyStandardizeDates(currentHeaders, currentRows, op.params, initialTypeMap);
        break;
      case 'normalize_emails':
        stepResult = applyNormalizeEmails(currentHeaders, currentRows, op.params, initialTypeMap);
        break;
      case 'normalize_phone_numbers':
        stepResult = applyNormalizePhoneNumbers(
          currentHeaders,
          currentRows,
          op.params,
          initialTypeMap,
        );
        break;
      case 'handle_missing_values':
        stepResult = applyHandleMissingValues(currentHeaders, currentRows, op.params);
        break;
      case 'rename_columns':
        stepResult = applyRenameColumns(currentHeaders, currentRows, op.params);
        break;
    }

    currentHeaders = stepResult.headers;
    currentRows = stepResult.rows;

    for (const removed of stepResult.removedRows) {
      removedMap.set(removed.originalRowNumber, {
        reason: removed.reason,
        cells: removed.cells,
      });
    }

    allWarnings.push(...stepResult.warnings);
    summaries.push({
      id: op.id,
      label: OPERATION_LABELS[op.id],
      applied: true,
      recordsAffected: stepResult.recordsAffected,
      details: stepResult.details,
      parameters: op.params as unknown as Record<string, unknown>,
    });
  }

  const cleanedRows = currentRows.map((r) => r.cells);
  const survivedByOriginalNumber = new Map<number, string[]>();
  for (const r of currentRows) {
    survivedByOriginalNumber.set(r.originalRowNumber, r.cells);
  }

  let recordsChanged = 0;
  const diffRows: DiffRow[] = inspection.rows.map((beforeRow, idx) => {
    const rowNum = idx + 1;
    const removedInfo = removedMap.get(rowNum);
    if (removedInfo) {
      return {
        originalRowNumber: rowNum,
        status: 'removed',
        reason: removedInfo.reason,
        beforeRow,
        afterRow: null,
        cellChanges: [],
      };
    }

    const afterRow = survivedByOriginalNumber.get(rowNum) ?? beforeRow;
    const cellChanges: DiffCellChange[] = [];
    for (let c = 0; c < currentHeaders.length; c++) {
      const bVal = beforeRow[c] ?? '';
      const aVal = afterRow[c] ?? '';
      if (bVal !== aVal) {
        cellChanges.push({
          columnIndex: c,
          columnName: currentHeaders[c] ?? `column_${c + 1}`,
          before: bVal,
          after: aVal,
        });
      }
    }

    if (cellChanges.length > 0) {
      recordsChanged++;
      return {
        originalRowNumber: rowNum,
        status: 'modified',
        beforeRow,
        afterRow,
        cellChanges,
      };
    }

    return {
      originalRowNumber: rowNum,
      status: 'unchanged',
      beforeRow,
      afterRow,
      cellChanges: [],
    };
  });

  // Re-inspect cleaned dataset for accurate after-cleaning quality score
  const afterInspection = inspectParsedTable({
    filename: inspection.filename,
    byteSize: inspection.byteSize,
    encoding: inspection.encoding,
    delimiter: outputDelimiter,
    headers: currentHeaders,
    originalHeaders: currentHeaders,
    normalizedHeadersCount: 0,
    rows: cleanedRows,
  });

  const postTypeMap: Record<string, ColumnType> = {};
  for (const col of afterInspection.columnProfiles) {
    postTypeMap[col.name] = col.detectedType;
  }

  const { csvOutput, formulaCellsEscaped } = exportRowsToCsv(currentHeaders, cleanedRows, {
    delimiter: outputDelimiter,
    formulaProtection,
    columnTypes: postTypeMap,
  });

  if (formulaProtection && formulaCellsEscaped > 0) {
    allWarnings.push({
      code: 'FORMULA_CELLS_ESCAPED',
      severity: 'info',
      message: `Formula-injection protection prefixed ${formulaCellsEscaped} cell(s) starting with =, +, -, @, tab, or CR with a single quote (') in the exported CSV.`,
      count: formulaCellsEscaped,
    });
  }

  const missingValuesFound = inspection.problems.missingCells;
  const missingValuesAfter = afterInspection.problems.missingCells;
  const missingValuesHandled = Math.max(0, missingValuesFound - missingValuesAfter);

  const report: CleaningReport = {
    jobId: `local_${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    processingPath: 'browser',
    sourceFilename: inspection.filename,
    inputFormat: inspection.inputFormat,
    encoding: inspection.encoding,
    delimiter: outputDelimiter,
    rowsBefore: inspection.rowCount,
    rowsAfter: cleanedRows.length,
    columnsBefore: inspection.columnCount,
    columnsAfter: currentHeaders.length,
    headersBefore: inspection.headers,
    headersAfter: currentHeaders,
    operationsApplied: summaries,
    recordsChanged,
    recordsRemoved: inspection.rowCount - cleanedRows.length,
    duplicatesRemoved,
    emptyRowsRemoved,
    missingValuesFound,
    missingValuesHandled,
    formulaInjectionProtected: formulaProtection,
    formulaCellsEscaped,
    warnings: deduplicateWarnings(allWarnings),
    qualityBefore: inspection.qualityBefore,
    qualityAfter: afterInspection.qualityBefore,
  };

  return {
    headers: currentHeaders,
    rows: cleanedRows,
    originalHeaders: inspection.headers,
    originalRows: inspection.rows,
    csvOutput,
    report,
    diffRows,
  };
}

function deduplicateWarnings(warnings: CleaningWarning[]): CleaningWarning[] {
  const seen = new Set<string>();
  const result: CleaningWarning[] = [];
  for (const w of warnings) {
    const key = `${w.code}:${w.column ?? ''}:${w.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(w);
    }
  }
  return result;
}
