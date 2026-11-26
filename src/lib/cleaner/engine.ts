import { exportIssuesToCsv, exportRowsToCsv } from './exporter';
import {
  applyCanonicalizeCoupons,
  applyHandleMissingValues,
  applyNormalizeEmails,
  applyNormalizePhoneNumbers,
  applyNormalizeText,
  applyPlaceholderToNull,
  applyRemoveDuplicates,
  applyRemoveEmptyRows,
  applyRenameColumns,
  applyStandardizeDates,
  applyTrimWhitespace,
  applyValidateNumbers,
  detectMergeKeyColumns,
  type OperationStepResult,
  type TrackedRow,
} from './operations';
import { inspectParsedTable } from './parser';
import type {
  CleaningIssue,
  CleaningOperationConfig,
  CleaningReport,
  CleaningResult,
  CleaningWarning,
  ColumnType,
  DatasetInspection,
  DateOutputFormat,
  DiffCellChange,
  DiffRow,
  NearDuplicateMergeRecord,
  OperationId,
  OperationSummary,
  SupportedPhoneRegion,
} from './types';
import {
  DEFAULT_PLACEHOLDER_TOKENS,
  defaultNumericRuleForHeader,
  isCouponHeader,
} from './validators';

const OPERATION_LABELS: Record<OperationId, string> = {
  remove_empty_rows: 'Remove Empty Rows',
  remove_duplicates: 'Remove & Merge Duplicate Rows',
  trim_whitespace: 'Trim Whitespace',
  placeholder_to_null: 'Placeholder-to-Null Cleanup',
  canonicalize_coupons: 'Canonicalize Coupon Codes',
  normalize_text: 'Normalize & Canonicalize Text',
  standardize_dates: 'Standardize Dates',
  normalize_emails: 'Normalize & Validate Emails',
  normalize_phone_numbers: 'Normalize & Validate Phones',
  validate_numbers: 'Validate Numeric Fields',
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
  const { problems, columnProfiles, headers, rows } = inspection;

  const missingStrategies: Record<string, { strategy: 'keep' }> = {};
  for (const col of columnProfiles) {
    missingStrategies[col.name] = { strategy: 'keep' };
  }

  const hasCouponCol = headers.some((h) => isCouponHeader(h));
  const hasNumericRuleCol = headers.some((h) => defaultNumericRuleForHeader(h) !== null);
  const hasTextCol = columnProfiles.some(
    (c) => (c.detectedType === 'text' || c.detectedType === 'mixed') && !isCouponHeader(c.name),
  );
  const trackedSample: TrackedRow[] = rows
    .slice(0, 500)
    .map((cells, idx) => ({ originalRowNumber: idx + 1, cells }));
  const detectedMergeKeys = detectMergeKeyColumns(headers, trackedSample);

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
        collapseInternal: true,
      },
    },
    {
      id: 'canonicalize_coupons',
      enabled: hasCouponCol,
      params: {
        columns: [],
        caseMode: 'upper',
      },
    },
    {
      id: 'placeholder_to_null',
      enabled: true,
      params: {
        columns: [],
        tokens: [...DEFAULT_PLACEHOLDER_TOKENS],
        excludeColumns: ['_cleaning_flags'],
      },
    },
    {
      id: 'normalize_emails',
      enabled: columnProfiles.some((c) => c.detectedType === 'email'),
      params: {
        columns: [],
        clearInvalid: true,
      },
    },
    {
      id: 'normalize_phone_numbers',
      enabled: columnProfiles.some((c) => c.detectedType === 'phone'),
      params: {
        columns: [],
        defaultRegion: preferences?.phoneRegion ?? 'IN',
        format: 'E.164',
        clearInvalid: true,
      },
    },
    {
      id: 'standardize_dates',
      enabled: columnProfiles.some((c) => c.detectedType === 'date'),
      params: {
        columns: [],
        dayFirst: preferences?.dayFirst ?? true,
        outputFormat: preferences?.dateFormat ?? 'YYYY-MM-DD',
        clearInvalid: true,
      },
    },
    {
      id: 'validate_numbers',
      enabled: hasNumericRuleCol,
      params: {
        columns: [],
        defaultMaxQuantity: 1000,
        clearInvalid: true,
      },
    },
    {
      id: 'normalize_text',
      enabled: hasTextCol,
      params: {
        columns: [],
        caseMode: 'title',
        collapseWhitespace: true,
        canonicalMerge: true,
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
      enabled: problems.duplicateRows > 0 || detectedMergeKeys.length > 0,
      params: {
        keyColumns: [],
        keep: 'first',
        mergeNearDuplicates: detectedMergeKeys.length > 0,
        mergeKeyColumns: detectedMergeKeys,
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
  includeCleaningFlags?: boolean;
}

export function runCleaningPipeline(
  inspection: DatasetInspection,
  operations: CleaningOperationConfig[],
  options: RunPipelineOptions = {},
): CleaningResult {
  const formulaProtection = options.formulaProtection ?? true;
  const outputDelimiter = options.outputDelimiter ?? inspection.delimiter;
  const includeCleaningFlags = options.includeCleaningFlags ?? false;

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
  const allIssues: CleaningIssue[] = [];
  const allMerges: NearDuplicateMergeRecord[] = [];

  let emptyRowsRemoved = 0;
  let duplicatesRemoved = 0;
  let nearDuplicatesMerged = 0;

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
        if (stepResult.merges && stepResult.merges.length > 0) {
          allMerges.push(...stepResult.merges);
          nearDuplicatesMerged += stepResult.merges.reduce(
            (acc, m) => acc + m.mergedRowNumbers.length,
            0,
          );
        }
        break;
      case 'trim_whitespace':
        stepResult = applyTrimWhitespace(currentHeaders, currentRows, op.params);
        break;
      case 'placeholder_to_null':
        stepResult = applyPlaceholderToNull(currentHeaders, currentRows, op.params);
        break;
      case 'canonicalize_coupons':
        stepResult = applyCanonicalizeCoupons(currentHeaders, currentRows, op.params);
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
      case 'validate_numbers':
        stepResult = applyValidateNumbers(currentHeaders, currentRows, op.params, initialTypeMap);
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
    allIssues.push(...stepResult.issues);
    summaries.push({
      id: op.id,
      label: OPERATION_LABELS[op.id],
      applied: true,
      recordsAffected: stepResult.recordsAffected,
      details: stepResult.details,
      parameters: op.params as unknown as Record<string, unknown>,
    });
  }

  const deduplicatedIssues = coalesceCellIssues(allIssues);

  const issueCountsByRule: Record<string, number> = {};
  const flagsByRow = new Map<number, string[]>();
  for (const issue of deduplicatedIssues) {
    issueCountsByRule[issue.rule_id] = (issueCountsByRule[issue.rule_id] ?? 0) + 1;
    if (includeCleaningFlags && issue.column !== '*') {
      const tag = `${issue.column}:${issue.rule_id}`;
      const existing = flagsByRow.get(issue.row);
      if (!existing) {
        flagsByRow.set(issue.row, [tag]);
      } else if (!existing.includes(tag)) {
        existing.push(tag);
      }
    }
  }

  const baseCleanedRows = currentRows.map((r) => r.cells);
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

  // Re-inspect cleaned dataset (without _cleaning_flags metadata column) for accurate qualityAfter score
  const afterInspection = inspectParsedTable({
    filename: inspection.filename,
    byteSize: inspection.byteSize,
    encoding: inspection.encoding,
    delimiter: outputDelimiter,
    headers: currentHeaders,
    originalHeaders: currentHeaders,
    normalizedHeadersCount: 0,
    rows: baseCleanedRows,
  });

  let exportHeaders = currentHeaders;
  let exportRows = baseCleanedRows;
  if (includeCleaningFlags) {
    exportHeaders = [...currentHeaders, '_cleaning_flags'];
    exportRows = currentRows.map((r) => {
      const tags = flagsByRow.get(r.originalRowNumber);
      return [...r.cells, tags ? tags.join(';') : ''];
    });
  }

  const postTypeMap: Record<string, ColumnType> = {};
  for (const col of afterInspection.columnProfiles) {
    postTypeMap[col.name] = col.detectedType;
  }
  if (includeCleaningFlags) {
    postTypeMap['_cleaning_flags'] = 'text';
  }

  const { csvOutput, formulaCellsEscaped } = exportRowsToCsv(exportHeaders, exportRows, {
    delimiter: outputDelimiter,
    formulaProtection,
    columnTypes: postTypeMap,
  });

  const issuesCsvOutput = exportIssuesToCsv(deduplicatedIssues, outputDelimiter);

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
    rowsAfter: exportRows.length,
    columnsBefore: inspection.columnCount,
    columnsAfter: exportHeaders.length,
    headersBefore: inspection.headers,
    headersAfter: exportHeaders,
    operationsApplied: summaries,
    recordsChanged,
    recordsRemoved: inspection.rowCount - exportRows.length,
    duplicatesRemoved,
    emptyRowsRemoved,
    missingValuesFound,
    missingValuesHandled,
    formulaInjectionProtected: formulaProtection,
    formulaCellsEscaped,
    warnings: deduplicateWarnings(allWarnings),
    qualityBefore: inspection.qualityBefore,
    qualityAfter: afterInspection.qualityBefore,
    issues: deduplicatedIssues,
    issueCountsByRule,
    merges: allMerges,
    nearDuplicatesMerged,
    includeCleaningFlags,
  };

  return {
    headers: exportHeaders,
    rows: exportRows,
    originalHeaders: inspection.headers,
    originalRows: inspection.rows,
    csvOutput,
    issuesCsvOutput,
    report,
    diffRows,
  };
}

const RULE_PRECEDENCE: Record<string, number> = {
  whitespace_trimmed: 1,
  text_case_normalized: 2,
  coupon_canonicalized: 3,
  email_normalized: 4,
  phone_normalized: 4,
  date_standardized: 4,
  numeric_normalized: 4,
  missing_filled: 5,
  placeholder_to_null: 6,
  email_invalid_flagged: 7,
  email_invalid_cleared: 7,
  phone_invalid_flagged: 7,
  phone_invalid_cleared: 7,
  date_invalid_flagged: 7,
  date_invalid_cleared: 7,
  numeric_invalid_flagged: 7,
  numeric_invalid_cleared: 7,
  duplicate_key_merged: 8,
  duplicate_key_conflict: 9,
  empty_row_removed: 10,
  missing_row_removed: 10,
  duplicate_exact_removed: 10,
};

const SEVERITY_RANK: Record<CleaningIssue['severity'], number> = {
  info: 1,
  warning: 2,
  error: 3,
};

const ROW_LEVEL_RULES = new Set([
  'empty_row_removed',
  'missing_row_removed',
  'duplicate_exact_removed',
]);

export function coalesceCellIssues(issues: CleaningIssue[]): CleaningIssue[] {
  const result: CleaningIssue[] = [];
  const cellIndexMap = new Map<string, number>();

  for (const issue of issues) {
    if (issue.column === '*' || ROW_LEVEL_RULES.has(issue.rule_id)) {
      result.push(issue);
      continue;
    }

    const key = `${issue.row}\0${issue.column}`;
    const existingIdx = cellIndexMap.get(key);
    if (existingIdx === undefined) {
      cellIndexMap.set(key, result.length);
      result.push({ ...issue });
      continue;
    }

    const prev = result[existingIdx];
    const prevRank = RULE_PRECEDENCE[prev.rule_id] ?? 5;
    const nextRank = RULE_PRECEDENCE[issue.rule_id] ?? 5;
    const nextSev =
      SEVERITY_RANK[issue.severity] >= SEVERITY_RANK[prev.severity]
        ? issue.severity
        : prev.severity;

    result[existingIdx] = {
      row: prev.row,
      column: prev.column,
      original: prev.original,
      new: issue.new,
      rule_id: nextRank >= prevRank ? issue.rule_id : prev.rule_id,
      severity: nextSev,
    };
  }

  return result;
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
