import type {
  CleaningWarning,
  ColumnRenameConvention,
  ColumnType,
  OperationParamsMap,
} from './types';
import {
  isMissingValue,
  isValidEmailSyntax,
  parseDateValue,
  validateAndFormatPhone,
} from './validators';

export interface TrackedRow {
  originalRowNumber: number; // 1-indexed data row
  cells: string[];
}

export interface OperationStepResult {
  headers: string[];
  rows: TrackedRow[];
  removedRows: Array<{ originalRowNumber: number; reason: string; cells: string[] }>;
  recordsAffected: number;
  details: string;
  warnings: CleaningWarning[];
}

function resolveColumnIndices(
  headers: string[],
  selectedColumns: string[],
  fallbackPredicate?: (header: string, index: number) => boolean,
): number[] {
  if (selectedColumns.length > 0) {
    const selectedSet = new Set(selectedColumns);
    const indices: number[] = [];
    headers.forEach((h, i) => {
      if (selectedSet.has(h)) indices.push(i);
    });
    return indices;
  }
  if (fallbackPredicate) {
    const indices: number[] = [];
    headers.forEach((h, i) => {
      if (fallbackPredicate(h, i)) indices.push(i);
    });
    return indices;
  }
  return headers.map((_, i) => i);
}

export function applyRemoveEmptyRows(
  headers: string[],
  rows: TrackedRow[],
): OperationStepResult {
  const kept: TrackedRow[] = [];
  const removedRows: OperationStepResult['removedRows'] = [];

  for (const row of rows) {
    const isFullyBlank = row.cells.every((cell) => cell.trim() === '');
    if (isFullyBlank) {
      removedRows.push({
        originalRowNumber: row.originalRowNumber,
        reason: 'Fully blank row',
        cells: [...row.cells],
      });
    } else {
      kept.push(row);
    }
  }

  return {
    headers,
    rows: kept,
    removedRows,
    recordsAffected: removedRows.length,
    details:
      removedRows.length > 0
        ? `Removed ${removedRows.length} fully blank row(s). Partially populated rows were preserved.`
        : 'No fully blank rows found.',
    warnings: [],
  };
}

export function applyRemoveDuplicates(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['remove_duplicates'],
): OperationStepResult {
  const keyIndices = resolveColumnIndices(headers, params.keyColumns);
  const removedRows: OperationStepResult['removedRows'] = [];

  const getKey = (cells: string[]): string =>
    JSON.stringify(keyIndices.map((idx) => cells[idx] ?? ''));

  const kept: TrackedRow[] = [];

  if (params.keep === 'first') {
    const seen = new Set<string>();
    for (const row of rows) {
      const key = getKey(row.cells);
      if (seen.has(key)) {
        removedRows.push({
          originalRowNumber: row.originalRowNumber,
          reason:
            params.keyColumns.length > 0
              ? `Duplicate on key column(s): ${params.keyColumns.join(', ')}`
              : 'Exact duplicate row (kept first occurrence)',
          cells: [...row.cells],
        });
      } else {
        seen.add(key);
        kept.push(row);
      }
    }
  } else {
    // keep === 'last': identify last index for each key, then preserve order
    const lastIndexByKey = new Map<string, number>();
    rows.forEach((row, idx) => {
      lastIndexByKey.set(getKey(row.cells), idx);
    });
    rows.forEach((row, idx) => {
      const key = getKey(row.cells);
      if (lastIndexByKey.get(key) === idx) {
        kept.push(row);
      } else {
        removedRows.push({
          originalRowNumber: row.originalRowNumber,
          reason:
            params.keyColumns.length > 0
              ? `Duplicate on key column(s): ${params.keyColumns.join(', ')} (kept last)`
              : 'Exact duplicate row (kept last occurrence)',
          cells: [...row.cells],
        });
      }
    });
  }

  return {
    headers,
    rows: kept,
    removedRows,
    recordsAffected: removedRows.length,
    details:
      removedRows.length > 0
        ? `Removed ${removedRows.length} duplicate row(s) (keep: ${params.keep}).`
        : 'No duplicate rows matched the selected key columns.',
    warnings: [],
  };
}

export function applyTrimWhitespace(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['trim_whitespace'],
): OperationStepResult {
  const targetIndices = resolveColumnIndices(headers, params.columns);
  const targetSet = new Set(targetIndices);
  let cellsChanged = 0;

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      if (!targetSet.has(idx)) return cell;
      let next = cell.trim();
      if (params.collapseInternal) {
        next = next.replace(/[ \t]+/g, ' ');
      }
      if (next !== cell) cellsChanged++;
      return next;
    });
    return { ...row, cells: newCells };
  });

  return {
    headers,
    rows: updatedRows,
    removedRows: [],
    recordsAffected: cellsChanged,
    details:
      cellsChanged > 0
        ? `Trimmed whitespace in ${cellsChanged} cell(s).`
        : 'No leading/trailing whitespace changes needed.',
    warnings: [],
  };
}

function toTitleCase(value: string): string {
  return value.replace(/\S+/g, (word) => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

export function applyNormalizeText(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['normalize_text'],
  columnTypes: Record<string, ColumnType>,
): OperationStepResult {
  const targetIndices = resolveColumnIndices(headers, params.columns, (header) => {
    const t = columnTypes[header];
    return t === 'text' || t === 'mixed';
  });
  const targetSet = new Set(targetIndices);
  let cellsChanged = 0;

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      if (!targetSet.has(idx) || isMissingValue(cell)) return cell;
      let next = cell;
      if (params.collapseWhitespace) {
        next = next.trim().replace(/[ \t]+/g, ' ');
      }
      if (params.caseMode === 'lower') next = next.toLowerCase();
      else if (params.caseMode === 'upper') next = next.toUpperCase();
      else if (params.caseMode === 'title') next = toTitleCase(next);

      if (next !== cell) cellsChanged++;
      return next;
    });
    return { ...row, cells: newCells };
  });

  return {
    headers,
    rows: updatedRows,
    removedRows: [],
    recordsAffected: cellsChanged,
    details: `Normalized ${cellsChanged} text cell(s) (case: ${params.caseMode}).`,
    warnings: [],
  };
}

export function applyStandardizeDates(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['standardize_dates'],
  columnTypes: Record<string, ColumnType>,
): OperationStepResult {
  const targetIndices = resolveColumnIndices(headers, params.columns, (header) => {
    return columnTypes[header] === 'date';
  });
  const targetSet = new Set(targetIndices);
  let cellsChanged = 0;
  let ambiguousResolved = 0;
  let unparseableCount = 0;

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      if (!targetSet.has(idx) || isMissingValue(cell)) return cell;
      const parsed = parseDateValue(cell, params.dayFirst, params.outputFormat);
      if (!parsed.valid || !parsed.formatted) {
        unparseableCount++;
        return cell;
      }
      if (parsed.ambiguous) ambiguousResolved++;
      if (parsed.formatted !== cell) cellsChanged++;
      return parsed.formatted;
    });
    return { ...row, cells: newCells };
  });

  const warnings: CleaningWarning[] = [];
  if (unparseableCount > 0) {
    warnings.push({
      code: 'UNPARSEABLE_DATES_PRESERVED',
      severity: 'warning',
      message: `${unparseableCount} date value(s) could not be parsed reliably and were left unchanged (never guessed).`,
      count: unparseableCount,
    });
  }

  return {
    headers,
    rows: updatedRows,
    removedRows: [],
    recordsAffected: cellsChanged,
    details: `Standardized ${cellsChanged} date cell(s) to ${params.outputFormat} using ${
      params.dayFirst ? 'day-first (DD/MM)' : 'month-first (MM/DD)'
    } (${ambiguousResolved} ambiguous date(s) resolved).`,
    warnings,
  };
}

export function applyNormalizeEmails(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['normalize_emails'],
  columnTypes: Record<string, ColumnType>,
): OperationStepResult {
  const targetIndices = resolveColumnIndices(headers, params.columns, (header) => {
    return columnTypes[header] === 'email';
  });
  const targetSet = new Set(targetIndices);
  let cellsChanged = 0;
  let invalidSyntaxCount = 0;

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      if (!targetSet.has(idx) || isMissingValue(cell)) return cell;
      const normalized = cell.trim().toLowerCase();
      if (!isValidEmailSyntax(normalized)) {
        invalidSyntaxCount++;
      }
      if (normalized !== cell) cellsChanged++;
      return normalized;
    });
    return { ...row, cells: newCells };
  });

  const warnings: CleaningWarning[] = [];
  if (invalidSyntaxCount > 0) {
    warnings.push({
      code: 'INVALID_EMAIL_SYNTAX_REMAINING',
      severity: 'warning',
      message: `${invalidSyntaxCount} email value(s) still fail syntax checks after normalization. Syntax validation never verifies mailbox existence.`,
      count: invalidSyntaxCount,
    });
  }

  return {
    headers,
    rows: updatedRows,
    removedRows: [],
    recordsAffected: cellsChanged,
    details: `Normalized ${cellsChanged} email cell(s) (trimmed & lowercased). Syntax checked only.`,
    warnings,
  };
}

export function applyNormalizePhoneNumbers(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['normalize_phone_numbers'],
  columnTypes: Record<string, ColumnType>,
): OperationStepResult {
  const targetIndices = resolveColumnIndices(headers, params.columns, (header) => {
    return columnTypes[header] === 'phone';
  });
  const targetSet = new Set(targetIndices);
  let cellsChanged = 0;
  let invalidCount = 0;

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      if (!targetSet.has(idx) || isMissingValue(cell)) return cell;
      const res = validateAndFormatPhone(cell, params.defaultRegion, params.format);
      if (!res.valid) {
        invalidCount++;
        return cell;
      }
      if (res.formatted !== cell) cellsChanged++;
      return res.formatted;
    });
    return { ...row, cells: newCells };
  });

  const warnings: CleaningWarning[] = [];
  if (invalidCount > 0) {
    warnings.push({
      code: 'INVALID_PHONE_FORMAT',
      severity: 'warning',
      message: `${invalidCount} phone value(s) could not be validated as valid ${params.defaultRegion} numbers and were preserved untouched. Phone validation checks format only, never active line status.`,
      count: invalidCount,
    });
  }

  return {
    headers,
    rows: updatedRows,
    removedRows: [],
    recordsAffected: cellsChanged,
    details: `Formatted ${cellsChanged} phone number(s) using region ${params.defaultRegion} (${params.format}, format check only).`,
    warnings,
  };
}

function computeMedian(numbers: number[]): number {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function applyHandleMissingValues(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['handle_missing_values'],
): OperationStepResult {
  let currentRows = rows;
  const removedRows: OperationStepResult['removedRows'] = [];
  const warnings: CleaningWarning[] = [];
  let cellsFilled = 0;

  headers.forEach((header, colIdx) => {
    const rule = params.strategies[header];
    if (!rule || rule.strategy === 'keep') return;

    if (rule.strategy === 'remove_row') {
      const nextRows: TrackedRow[] = [];
      for (const row of currentRows) {
        if (isMissingValue(row.cells[colIdx] ?? '')) {
          removedRows.push({
            originalRowNumber: row.originalRowNumber,
            reason: `Missing value in column "${header}"`,
            cells: [...row.cells],
          });
        } else {
          nextRows.push(row);
        }
      }
      currentRows = nextRows;
      return;
    }

    let replacement: string | null = null;
    if (rule.strategy === 'fill_constant') {
      replacement = rule.constantValue ?? '';
    } else if (rule.strategy === 'fill_zero') {
      replacement = '0';
    } else if (rule.strategy === 'fill_mean' || rule.strategy === 'fill_median') {
      const nums: number[] = [];
      for (const row of currentRows) {
        const raw = (row.cells[colIdx] ?? '').trim();
        if (!isMissingValue(raw) && /^[+-]?\d+(?:\.\d+)?$/.test(raw)) {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) nums.push(parsed);
        }
      }
      if (nums.length === 0) {
        warnings.push({
          code: 'NUMERIC_FILL_NO_DATA',
          severity: 'warning',
          column: header,
          message: `Cannot compute ${rule.strategy === 'fill_mean' ? 'mean' : 'median'} for "${header}" because no valid numeric values exist.`,
        });
        return;
      }
      const stat =
        rule.strategy === 'fill_mean'
          ? nums.reduce((a, b) => a + b, 0) / nums.length
          : computeMedian(nums);
      replacement = Number.isInteger(stat) ? String(stat) : String(Number(stat.toFixed(2)));
    }

    if (replacement !== null) {
      currentRows = currentRows.map((row) => {
        const val = row.cells[colIdx] ?? '';
        if (!isMissingValue(val)) return row;
        const nextCells = [...row.cells];
        nextCells[colIdx] = replacement!;
        cellsFilled++;
        return { ...row, cells: nextCells };
      });
    }
  });

  const totalAffected = cellsFilled + removedRows.length;
  return {
    headers,
    rows: currentRows,
    removedRows,
    recordsAffected: totalAffected,
    details: `Filled ${cellsFilled} missing cell(s) and removed ${removedRows.length} row(s) via per-column missing rules.`,
    warnings,
  };
}

function formatColumnName(raw: string, convention: ColumnRenameConvention): string {
  const cleaned = raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();

  if (!cleaned) return 'column';
  const parts = cleaned.split(/\s+/);

  if (convention === 'snake_case') {
    return parts.map((p) => p.toLowerCase()).join('_');
  }
  if (convention === 'lowercase') {
    return parts.map((p) => p.toLowerCase()).join('');
  }
  if (convention === 'camelCase') {
    return parts
      .map((p, i) =>
        i === 0
          ? p.toLowerCase()
          : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
      )
      .join('');
  }
  return raw.trim() || 'column';
}

export function applyRenameColumns(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['rename_columns'],
): OperationStepResult {
  const seen = new Set<string>();
  let renamedCount = 0;

  const newHeaders = headers.map((header, idx) => {
    let candidate =
      params.convention === 'custom'
        ? (params.customMap[header] ?? header).trim() || `column_${idx + 1}`
        : formatColumnName(header, params.convention);

    if (seen.has(candidate)) {
      let suffix = 2;
      while (seen.has(`${candidate}_${suffix}`)) suffix++;
      candidate = `${candidate}_${suffix}`;
    }
    seen.add(candidate);
    if (candidate !== header) renamedCount++;
    return candidate;
  });

  return {
    headers: newHeaders,
    rows,
    removedRows: [],
    recordsAffected: renamedCount,
    details:
      renamedCount > 0
        ? `Renamed ${renamedCount} column header(s) (${params.convention}).`
        : 'All column headers already match the selected convention.',
    warnings: [],
  };
}
