import type {
  CleaningIssue,
  CleaningWarning,
  ColumnRenameConvention,
  ColumnType,
  NearDuplicateMergeConflict,
  NearDuplicateMergeRecord,
  NumericColumnRule,
  OperationParamsMap,
} from './types';
import {
  COUPON_EMPTY_TOKENS,
  DEFAULT_PLACEHOLDER_TOKENS,
  defaultNumericRuleForHeader,
  isCouponHeader,
  isFormulaTrigger,
  isMissingValue,
  isPlaceholderValue,
  isQuantityHeader,
  isValidEmailSyntax,
  parseDateValue,
  validateAndFormatPhone,
  validateNumericValue,
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
  issues: CleaningIssue[];
  merges?: NearDuplicateMergeRecord[];
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
  const issues: CleaningIssue[] = [];

  for (const row of rows) {
    const isFullyBlank = row.cells.every((cell) => cell.trim() === '');
    if (isFullyBlank) {
      removedRows.push({
        originalRowNumber: row.originalRowNumber,
        reason: 'Fully blank row',
        cells: [...row.cells],
      });
      issues.push({
        row: row.originalRowNumber,
        column: '*',
        original: '(blank row)',
        new: '',
        rule_id: 'empty_row_removed',
        severity: 'info',
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
    issues,
  };
}

export function detectMergeKeyColumns(headers: string[], rows: TrackedRow[]): string[] {
  if (rows.length === 0) return [];
  const priorityPatterns = [
    /^order_id$/i,
    /^customer_id$/i,
    /^record_id$/i,
    /^account_id$/i,
    /^user_id$/i,
    /^id$/i,
  ];
  for (const pat of priorityPatterns) {
    const idx = headers.findIndex((h) => pat.test(h.trim()));
    if (idx === -1) continue;
    let nonEmpty = 0;
    const distinct = new Set<string>();
    for (const row of rows) {
      const v = (row.cells[idx] ?? '').trim().toLowerCase();
      if (v !== '') {
        nonEmpty++;
        distinct.add(v);
      }
    }
    const nonEmptyRatio = nonEmpty / rows.length;
    const distinctRatio = nonEmpty > 0 ? distinct.size / nonEmpty : 0;
    if (nonEmptyRatio >= 0.9 && distinctRatio >= 0.85) {
      return [headers[idx]];
    }
  }
  return [];
}

export function applyRemoveDuplicates(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['remove_duplicates'],
): OperationStepResult {
  const keyIndices = resolveColumnIndices(headers, params.keyColumns);
  const removedRows: OperationStepResult['removedRows'] = [];
  const issues: CleaningIssue[] = [];
  const merges: NearDuplicateMergeRecord[] = [];

  const getKey = (cells: string[]): string =>
    JSON.stringify(keyIndices.map((idx) => cells[idx] ?? ''));

  const keptAfterExact: TrackedRow[] = [];

  if (params.keep === 'first') {
    const seen = new Set<string>();
    for (const row of rows) {
      const key = getKey(row.cells);
      if (seen.has(key)) {
        const reason =
          params.keyColumns.length > 0
            ? `Duplicate on key column(s): ${params.keyColumns.join(', ')}`
            : 'Exact duplicate row (kept first occurrence)';
        removedRows.push({
          originalRowNumber: row.originalRowNumber,
          reason,
          cells: [...row.cells],
        });
        issues.push({
          row: row.originalRowNumber,
          column: params.keyColumns.length > 0 ? params.keyColumns.join(',') : '*',
          original: 'duplicate_row',
          new: '',
          rule_id: 'duplicate_exact_removed',
          severity: 'info',
        });
      } else {
        seen.add(key);
        keptAfterExact.push(row);
      }
    }
  } else {
    const lastIndexByKey = new Map<string, number>();
    rows.forEach((row, idx) => {
      lastIndexByKey.set(getKey(row.cells), idx);
    });
    rows.forEach((row, idx) => {
      const key = getKey(row.cells);
      if (lastIndexByKey.get(key) === idx) {
        keptAfterExact.push(row);
      } else {
        const reason =
          params.keyColumns.length > 0
            ? `Duplicate on key column(s): ${params.keyColumns.join(', ')} (kept last)`
            : 'Exact duplicate row (kept last occurrence)';
        removedRows.push({
          originalRowNumber: row.originalRowNumber,
          reason,
          cells: [...row.cells],
        });
        issues.push({
          row: row.originalRowNumber,
          column: params.keyColumns.length > 0 ? params.keyColumns.join(',') : '*',
          original: 'duplicate_row',
          new: '',
          rule_id: 'duplicate_exact_removed',
          severity: 'info',
        });
      }
    });
  }

  let finalKept = keptAfterExact;
  let mergedCount = 0;

  if (params.mergeNearDuplicates) {
    const mergeCols =
      params.mergeKeyColumns && params.mergeKeyColumns.length > 0
        ? params.mergeKeyColumns.filter((c) => headers.includes(c))
        : detectMergeKeyColumns(headers, keptAfterExact);

    if (mergeCols.length > 0) {
      const mergeIndices = resolveColumnIndices(headers, mergeCols);
      const groups = new Map<string, TrackedRow[]>();
      const rowOrderKeys: Array<{ isGroup: boolean; key?: string; row?: TrackedRow }> = [];

      for (const row of keptAfterExact) {
        const keyParts = mergeIndices.map((idx) => (row.cells[idx] ?? '').trim().toLowerCase());
        const hasBlankKey = keyParts.some((k) => k === '');
        if (hasBlankKey) {
          rowOrderKeys.push({ isGroup: false, row });
          continue;
        }
        const mKey = JSON.stringify(keyParts);
        const existing = groups.get(mKey);
        if (!existing) {
          groups.set(mKey, [row]);
          rowOrderKeys.push({ isGroup: true, key: mKey });
        } else {
          existing.push(row);
        }
      }

      const nextKept: TrackedRow[] = [];
      for (const entry of rowOrderKeys) {
        if (!entry.isGroup) {
          nextKept.push(entry.row!);
          continue;
        }
        const group = groups.get(entry.key!)!;
        if (group.length === 1) {
          nextKept.push(group[0]);
          continue;
        }

        // Pick most complete row; tie-breaker respects params.keep
        let winner = group[0];
        let winnerScore = winner.cells.reduce((acc, c) => acc + (c.trim() !== '' ? 1 : 0), 0);
        for (let gIdx = 1; gIdx < group.length; gIdx++) {
          const candidate = group[gIdx];
          const score = candidate.cells.reduce((acc, c) => acc + (c.trim() !== '' ? 1 : 0), 0);
          if (score > winnerScore || (score === winnerScore && params.keep === 'last')) {
            winner = candidate;
            winnerScore = score;
          }
        }

        const mergedCells = [...winner.cells];
        const filledColumns: string[] = [];
        const conflicts: NearDuplicateMergeConflict[] = [];

        for (let c = 0; c < headers.length; c++) {
          const colName = headers[c];
          if (mergedCells[c].trim() === '') {
            for (const other of group) {
              if (other.originalRowNumber === winner.originalRowNumber) continue;
              const val = other.cells[c] ?? '';
              if (val.trim() !== '') {
                mergedCells[c] = val;
                filledColumns.push(colName);
                issues.push({
                  row: winner.originalRowNumber,
                  column: colName,
                  original: '',
                  new: val,
                  rule_id: 'duplicate_key_merged',
                  severity: 'info',
                });
                break;
              }
            }
          }

          const conflictVals: string[] = [];
          for (const other of group) {
            if (other.originalRowNumber === winner.originalRowNumber) continue;
            const otherVal = other.cells[c] ?? '';
            if (
              otherVal.trim() !== '' &&
              otherVal !== mergedCells[c] &&
              !conflictVals.includes(otherVal)
            ) {
              conflictVals.push(otherVal);
              issues.push({
                row: other.originalRowNumber,
                column: colName,
                original: otherVal,
                new: mergedCells[c],
                rule_id: 'duplicate_key_conflict',
                severity: 'warning',
              });
            }
          }
          if (conflictVals.length > 0) {
            conflicts.push({
              column: colName,
              keptValue: mergedCells[c],
              conflictingValues: conflictVals,
            });
          }
        }

        const mergedRowNumbers: number[] = [];
        const keyDisplay = mergeIndices.map((idx) => mergedCells[idx]).join('|');
        for (const other of group) {
          if (other.originalRowNumber === winner.originalRowNumber) continue;
          mergedRowNumbers.push(other.originalRowNumber);
          mergedCount++;
          removedRows.push({
            originalRowNumber: other.originalRowNumber,
            reason: `Near-duplicate merged on ${mergeCols.join(', ')}="${keyDisplay}" into row #${winner.originalRowNumber}`,
            cells: [...other.cells],
          });
          issues.push({
            row: other.originalRowNumber,
            column: mergeCols.join(','),
            original: keyDisplay,
            new: `merged_into_row_${winner.originalRowNumber}`,
            rule_id: 'duplicate_key_merged',
            severity: 'info',
          });
        }

        merges.push({
          keyColumns: mergeCols,
          keyValue: keyDisplay,
          keptRowNumber: winner.originalRowNumber,
          mergedRowNumbers,
          filledColumns,
          conflicts,
        });

        nextKept.push({
          originalRowNumber: winner.originalRowNumber,
          cells: mergedCells,
        });
      }
      finalKept = nextKept;
    }
  }

  const totalRemoved = removedRows.length;
  const exactRemoved = totalRemoved - mergedCount;
  const parts: string[] = [];
  if (exactRemoved > 0) parts.push(`Removed ${exactRemoved} exact duplicate row(s) (keep: ${params.keep})`);
  if (mergedCount > 0) parts.push(`Merged ${mergedCount} key-duplicate row(s)`);

  return {
    headers,
    rows: finalKept,
    removedRows,
    recordsAffected: totalRemoved,
    details:
      parts.length > 0
        ? `${parts.join('; ')}.`
        : 'No duplicate rows matched the selected key columns.',
    warnings: [],
    issues,
    merges,
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
  const issues: CleaningIssue[] = [];

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      if (!targetSet.has(idx)) return cell;
      let next = cell.trim();
      if (params.collapseInternal) {
        next = next.replace(/[ \t]+/g, ' ');
      }
      if (next !== cell) {
        cellsChanged++;
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: next,
          rule_id: 'whitespace_trimmed',
          severity: 'info',
        });
      }
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
    issues,
  };
}

export function applyPlaceholderToNull(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['placeholder_to_null'],
): OperationStepResult {
  const excluded = new Set(params.excludeColumns ?? []);
  const targetIndices = resolveColumnIndices(
    headers,
    params.columns,
    (h) => !excluded.has(h),
  ).filter((idx) => !excluded.has(headers[idx]));
  const targetSet = new Set(targetIndices);
  const tokenSet = new Set(
    (params.tokens.length > 0 ? params.tokens : DEFAULT_PLACEHOLDER_TOKENS).map((t) =>
      t.trim().toLowerCase(),
    ),
  );

  let cellsChanged = 0;
  const issues: CleaningIssue[] = [];

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      if (!targetSet.has(idx)) return cell;
      const trimmed = cell.trim();
      if (trimmed === '') return cell;
      if (isPlaceholderValue(trimmed, tokenSet)) {
        cellsChanged++;
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: '',
          rule_id: 'placeholder_to_null',
          severity: 'warning',
        });
        return '';
      }
      return cell;
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
        ? `Converted ${cellsChanged} placeholder token(s) to empty null values.`
        : 'No placeholder tokens detected.',
    warnings: [],
    issues,
  };
}

export function applyCanonicalizeCoupons(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['canonicalize_coupons'],
): OperationStepResult {
  const targetIndices = resolveColumnIndices(headers, params.columns, (h) => isCouponHeader(h));
  const targetSet = new Set(targetIndices);
  const emptyTokens =
    params.emptyTokens && params.emptyTokens.length > 0
      ? new Set(params.emptyTokens.map((t) => t.trim().toLowerCase()))
      : COUPON_EMPTY_TOKENS;
  const caseMode = params.caseMode ?? 'upper';

  let cellsChanged = 0;
  const issues: CleaningIssue[] = [];

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      if (!targetSet.has(idx)) return cell;
      const trimmed = cell.trim().replace(/[ \t]+/g, ' ');
      if (trimmed === '') {
        if (cell !== '') {
          cellsChanged++;
          issues.push({
            row: row.originalRowNumber,
            column: headers[idx],
            original: cell,
            new: '',
            rule_id: 'coupon_canonicalized',
            severity: 'info',
          });
        }
        return '';
      }
      if (emptyTokens.has(trimmed.toLowerCase())) {
        cellsChanged++;
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: '',
          rule_id: 'coupon_canonicalized',
          severity: 'info',
        });
        return '';
      }
      const next = caseMode === 'upper' ? trimmed.toUpperCase() : trimmed;
      if (next !== cell) {
        cellsChanged++;
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: next,
          rule_id: 'coupon_canonicalized',
          severity: 'info',
        });
      }
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
      targetIndices.length === 0
        ? 'No coupon columns selected or detected.'
        : `Canonicalized ${cellsChanged} coupon cell(s) (treating NONE and blank identically).`,
    warnings: [],
    issues,
  };
}

function toTitleCase(value: string): string {
  return value.replace(/\S+/g, (word) => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function chooseCanonicalVariant(
  variants: Map<string, number>,
  caseMode: OperationParamsMap['normalize_text']['caseMode'],
): string {
  const entries = Array.from(variants.entries());
  // Sort deterministically: highest frequency first, then prefer mixed/Title Case over all-lower/all-upper, then lexicographical
  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const aMixed = a[0] !== a[0].toLowerCase() && a[0] !== a[0].toUpperCase() ? 1 : 0;
    const bMixed = b[0] !== b[0].toLowerCase() && b[0] !== b[0].toUpperCase() ? 1 : 0;
    if (bMixed !== aMixed) return bMixed - aMixed;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  const top = entries[0][0];
  if (caseMode === 'lower') return top.toLowerCase();
  if (caseMode === 'upper') return top.toUpperCase();
  if (caseMode === 'title') {
    const isShortAcronym = top.length <= 3 && top === top.toUpperCase() && /[A-Z]/.test(top);
    const isMixedCase = top !== top.toLowerCase() && top !== top.toUpperCase();
    if (isShortAcronym || isMixedCase) {
      return top;
    }
    return toTitleCase(top);
  }
  return top;
}

export function applyNormalizeText(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['normalize_text'],
  columnTypes: Record<string, ColumnType>,
): OperationStepResult {
  const targetIndices = resolveColumnIndices(headers, params.columns, (header) => {
    const t = columnTypes[header];
    const trimmed = header.trim();
    const isId = /^(?:.*_)?id$/i.test(trimmed);
    return (t === 'text' || t === 'mixed') && !isCouponHeader(header) && !isId && trimmed !== '_cleaning_flags';
  });
  const targetSet = new Set(targetIndices);
  let cellsChanged = 0;
  const issues: CleaningIssue[] = [];

  if (params.canonicalMerge) {
    // Pass 1: build per-column case-insensitive variant frequencies
    const colCanonicalMaps = new Map<number, Map<string, string>>();
    for (const idx of targetIndices) {
      const grouped = new Map<string, Map<string, number>>();
      for (const row of rows) {
        const cell = row.cells[idx] ?? '';
        if (isMissingValue(cell) || isFormulaTrigger(cell)) continue;
        const collapsed = params.collapseWhitespace
          ? cell.trim().replace(/[ \t]+/g, ' ')
          : cell;
        if (!collapsed) continue;
        const key = collapsed.toLowerCase();
        let variants = grouped.get(key);
        if (!variants) {
          variants = new Map<string, number>();
          grouped.set(key, variants);
        }
        variants.set(collapsed, (variants.get(collapsed) ?? 0) + 1);
      }
      const canonicalByLower = new Map<string, string>();
      for (const [lowerKey, variants] of grouped.entries()) {
        canonicalByLower.set(lowerKey, chooseCanonicalVariant(variants, params.caseMode));
      }
      colCanonicalMaps.set(idx, canonicalByLower);
    }

    const updatedRows: TrackedRow[] = rows.map((row) => {
      const newCells = row.cells.map((cell, idx) => {
        if (!targetSet.has(idx) || isMissingValue(cell) || isFormulaTrigger(cell)) return cell;
        const collapsed = params.collapseWhitespace
          ? cell.trim().replace(/[ \t]+/g, ' ')
          : cell;
        const canonical = colCanonicalMaps.get(idx)?.get(collapsed.toLowerCase()) ?? collapsed;
        if (canonical !== cell) {
          cellsChanged++;
          issues.push({
            row: row.originalRowNumber,
            column: headers[idx],
            original: cell,
            new: canonical,
            rule_id: 'text_case_normalized',
            severity: 'info',
          });
        }
        return canonical;
      });
      return { ...row, cells: newCells };
    });

    return {
      headers,
      rows: updatedRows,
      removedRows: [],
      recordsAffected: cellsChanged,
      details: `Normalized ${cellsChanged} text cell(s) with canonical variant merge (case: ${params.caseMode}).`,
      warnings: [],
      issues,
    };
  }

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      if (!targetSet.has(idx) || isMissingValue(cell) || isFormulaTrigger(cell)) return cell;
      let next = cell;
      if (params.collapseWhitespace) {
        next = next.trim().replace(/[ \t]+/g, ' ');
      }
      if (params.caseMode === 'lower') next = next.toLowerCase();
      else if (params.caseMode === 'upper') next = next.toUpperCase();
      else if (params.caseMode === 'title') next = toTitleCase(next);

      if (next !== cell) {
        cellsChanged++;
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: next,
          rule_id: 'text_case_normalized',
          severity: 'info',
        });
      }
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
    issues,
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
  const clearInvalid = params.clearInvalid ?? false;
  let cellsChanged = 0;
  let ambiguousResolved = 0;
  let unparseableCount = 0;
  const issues: CleaningIssue[] = [];

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      if (!targetSet.has(idx) || cell.trim() === '') return cell;
      if (isMissingValue(cell)) {
        if (clearInvalid && cell !== '') {
          unparseableCount++;
          cellsChanged++;
          issues.push({
            row: row.originalRowNumber,
            column: headers[idx],
            original: cell,
            new: '',
            rule_id: 'date_invalid_cleared',
            severity: 'warning',
          });
          return '';
        }
        return cell;
      }
      const parsed = parseDateValue(cell, params.dayFirst, params.outputFormat);
      if (!parsed.valid || !parsed.formatted) {
        unparseableCount++;
        if (clearInvalid) {
          cellsChanged++;
          issues.push({
            row: row.originalRowNumber,
            column: headers[idx],
            original: cell,
            new: '',
            rule_id: 'date_invalid_cleared',
            severity: 'warning',
          });
          return '';
        }
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: cell,
          rule_id: 'date_invalid_flagged',
          severity: 'warning',
        });
        return cell;
      }
      if (parsed.ambiguous) ambiguousResolved++;
      if (parsed.formatted !== cell) {
        cellsChanged++;
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: parsed.formatted,
          rule_id: 'date_standardized',
          severity: 'info',
        });
      }
      return parsed.formatted;
    });
    return { ...row, cells: newCells };
  });

  const warnings: CleaningWarning[] = [];
  if (unparseableCount > 0) {
    warnings.push({
      code: clearInvalid ? 'INVALID_DATES_CLEARED' : 'UNPARSEABLE_DATES_PRESERVED',
      severity: 'warning',
      message: clearInvalid
        ? `${unparseableCount} invalid/out-of-range date value(s) could not be parsed reliably and were cleared to empty (never guessed).`
        : `${unparseableCount} date value(s) could not be parsed reliably and were left unchanged (never guessed).`,
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
    issues,
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
  const clearInvalid = params.clearInvalid ?? false;
  let cellsChanged = 0;
  let invalidSyntaxCount = 0;
  const issues: CleaningIssue[] = [];

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      if (!targetSet.has(idx) || cell.trim() === '') return cell;
      if (isMissingValue(cell)) {
        if (clearInvalid && cell !== '') {
          invalidSyntaxCount++;
          cellsChanged++;
          issues.push({
            row: row.originalRowNumber,
            column: headers[idx],
            original: cell,
            new: '',
            rule_id: 'email_invalid_cleared',
            severity: 'warning',
          });
          return '';
        }
        return cell;
      }
      const normalized = cell.trim().toLowerCase();
      if (!isValidEmailSyntax(normalized)) {
        invalidSyntaxCount++;
        if (clearInvalid) {
          cellsChanged++;
          issues.push({
            row: row.originalRowNumber,
            column: headers[idx],
            original: cell,
            new: '',
            rule_id: 'email_invalid_cleared',
            severity: 'warning',
          });
          return '';
        }
        if (normalized !== cell) cellsChanged++;
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: normalized,
          rule_id: 'email_invalid_flagged',
          severity: 'warning',
        });
        return normalized;
      }
      if (normalized !== cell) {
        cellsChanged++;
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: normalized,
          rule_id: 'email_normalized',
          severity: 'info',
        });
      }
      return normalized;
    });
    return { ...row, cells: newCells };
  });

  const warnings: CleaningWarning[] = [];
  if (invalidSyntaxCount > 0) {
    warnings.push({
      code: clearInvalid ? 'INVALID_EMAILS_CLEARED' : 'INVALID_EMAIL_SYNTAX_REMAINING',
      severity: 'warning',
      message: clearInvalid
        ? `${invalidSyntaxCount} invalid email value(s) failed syntax checks and were cleared to empty.`
        : `${invalidSyntaxCount} email value(s) still fail syntax checks after normalization. Syntax validation never verifies mailbox existence.`,
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
    issues,
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
  const clearInvalid = params.clearInvalid ?? false;
  let cellsChanged = 0;
  let invalidCount = 0;
  const issues: CleaningIssue[] = [];

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      if (!targetSet.has(idx) || cell.trim() === '') return cell;
      if (isMissingValue(cell)) {
        if (clearInvalid && cell !== '') {
          invalidCount++;
          cellsChanged++;
          issues.push({
            row: row.originalRowNumber,
            column: headers[idx],
            original: cell,
            new: '',
            rule_id: 'phone_invalid_cleared',
            severity: 'warning',
          });
          return '';
        }
        return cell;
      }
      const res = validateAndFormatPhone(cell, params.defaultRegion, params.format);
      if (!res.valid) {
        invalidCount++;
        if (clearInvalid) {
          cellsChanged++;
          issues.push({
            row: row.originalRowNumber,
            column: headers[idx],
            original: cell,
            new: '',
            rule_id: 'phone_invalid_cleared',
            severity: 'warning',
          });
          return '';
        }
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: cell,
          rule_id: 'phone_invalid_flagged',
          severity: 'warning',
        });
        return cell;
      }
      if (res.formatted !== cell) {
        cellsChanged++;
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: res.formatted,
          rule_id: 'phone_normalized',
          severity: 'info',
        });
      }
      return res.formatted;
    });
    return { ...row, cells: newCells };
  });

  const warnings: CleaningWarning[] = [];
  if (invalidCount > 0) {
    warnings.push({
      code: 'INVALID_PHONE_FORMAT',
      severity: 'warning',
      message: clearInvalid
        ? `${invalidCount} invalid/junk phone value(s) failed ${params.defaultRegion} format checks and were cleared to empty.`
        : `${invalidCount} phone value(s) could not be validated as valid ${params.defaultRegion} numbers and were preserved untouched. Phone validation checks format only, never active line status.`,
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
    issues,
  };
}

export function applyValidateNumbers(
  headers: string[],
  rows: TrackedRow[],
  params: OperationParamsMap['validate_numbers'],
  columnTypes: Record<string, ColumnType>,
): OperationStepResult {
  const clearInvalid = params.clearInvalid ?? true;
  const maxQty = params.defaultMaxQuantity ?? 1000;
  const colRules = new Map<number, NumericColumnRule>();

  const explicitSet = params.columns.length > 0 ? new Set(params.columns) : null;
  headers.forEach((h, idx) => {
    if (explicitSet && !explicitSet.has(h) && !params.rules?.[h]) return;
    let rule = params.rules?.[h] ?? defaultNumericRuleForHeader(h);
    if (!rule && explicitSet?.has(h)) {
      const colType = columnTypes[h];
      rule =
        colType === 'integer'
          ? { mode: 'positive_integer', min: 1, max: maxQty, sentinels: ['-99', '-999'] }
          : { mode: 'positive_decimal', min: 0.000001, decimals: 2, sentinels: ['-99', '-999'] };
    }
    if (rule) {
      if (isQuantityHeader(h) && params.defaultMaxQuantity !== undefined && !params.rules?.[h]) {
        rule = { ...rule, max: maxQty };
      }
      colRules.set(idx, rule);
    }
  });

  let cellsChanged = 0;
  let invalidCount = 0;
  const issues: CleaningIssue[] = [];

  const updatedRows: TrackedRow[] = rows.map((row) => {
    const newCells = row.cells.map((cell, idx) => {
      const rule = colRules.get(idx);
      if (!rule || cell.trim() === '') return cell;

      const res = validateNumericValue(cell, rule);
      if (!res.valid) {
        invalidCount++;
        if (clearInvalid) {
          cellsChanged++;
          issues.push({
            row: row.originalRowNumber,
            column: headers[idx],
            original: cell,
            new: '',
            rule_id: 'numeric_invalid_cleared',
            severity: 'warning',
          });
          return '';
        }
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: cell,
          rule_id: 'numeric_invalid_flagged',
          severity: 'warning',
        });
        return cell;
      }

      if (res.formatted !== cell) {
        cellsChanged++;
        issues.push({
          row: row.originalRowNumber,
          column: headers[idx],
          original: cell,
          new: res.formatted,
          rule_id: 'numeric_normalized',
          severity: 'info',
        });
      }
      return res.formatted;
    });
    return { ...row, cells: newCells };
  });

  const warnings: CleaningWarning[] = [];
  if (invalidCount > 0) {
    warnings.push({
      code: 'INVALID_NUMERIC_VALUES',
      severity: 'warning',
      message: clearInvalid
        ? `${invalidCount} invalid/out-of-range numeric cell(s) were cleared to empty (never auto-filled).`
        : `${invalidCount} invalid/out-of-range numeric cell(s) were flagged.`,
      count: invalidCount,
    });
  }

  return {
    headers,
    rows: updatedRows,
    removedRows: [],
    recordsAffected: cellsChanged,
    details: `Validated numeric fields across ${colRules.size} column(s); ${cellsChanged} cell(s) updated (${invalidCount} invalid).`,
    warnings,
    issues,
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
  const issues: CleaningIssue[] = [];
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
          issues.push({
            row: row.originalRowNumber,
            column: header,
            original: row.cells[colIdx] ?? '',
            new: '',
            rule_id: 'missing_row_removed',
            severity: 'warning',
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
        issues.push({
          row: row.originalRowNumber,
          column: header,
          original: val,
          new: replacement!,
          rule_id: 'missing_filled',
          severity: 'info',
        });
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
    issues,
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
    issues: [],
  };
}
