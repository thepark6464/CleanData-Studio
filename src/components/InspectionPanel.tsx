import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Eraser,
  Info,
  Redo2,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  COUPON_EMPTY_TOKENS,
  defaultNumericRuleForHeader,
  isCouponHeader,
  isFormulaTrigger,
  isMissingValue,
  isValidEmailSyntax,
  parseDateValue,
  validateAndFormatPhone,
  validateNumericValue,
  type ColumnProfile,
  type DatasetInspection,
} from '../lib/cleaner';

interface InspectionPanelProps {
  inspection: DatasetInspection;
  onDelimiterOverride: (delimiter: ',' | ';' | '\t' | '|') => void;
  onSheetChange?: (sheetName: string) => void;
  onEditCell?: (rowIndex: number, colIndex: number, nextValue: string) => void;
  onDeleteRows?: (rowIndices: number[]) => void;
  onTrimSelectedRows?: (rowIndices: number[]) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

type CellIssueSeverity = 'none' | 'warning' | 'error' | 'info';

interface CellDiagnosis {
  severity: CellIssueSeverity;
  code: string;
  label: string;
  suggestion: string;
}

const DELIMITER_LABELS: Record<',' | ';' | '\t' | '|', string> = {
  ',': 'Comma (,)',
  ';': 'Semicolon (;)',
  '\t': 'Tab (\\t)',
  '|': 'Pipe (|)',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function diagnoseCell(
  raw: string,
  header: string,
  profile?: ColumnProfile,
): CellDiagnosis {
  const val = raw ?? '';
  const trimmed = val.trim();
  const isCouponCol = isCouponHeader(header);
  const isNumericCol =
    profile?.detectedType === 'integer' || profile?.detectedType === 'decimal';

  if (isCouponCol && trimmed === '') {
    if (val !== '') {
      return {
        severity: 'warning',
        code: 'WHITESPACE',
        label: 'Whitespace-only coupon cell',
        suggestion: 'Trim whitespace to canonical empty coupon',
      };
    }
    return { severity: 'none', code: 'OK', label: '', suggestion: '' };
  }

  if (isCouponCol && COUPON_EMPTY_TOKENS.has(trimmed.toLowerCase())) {
    return {
      severity: 'info',
      code: 'COUPON_SENTINEL',
      label: `Sentinel coupon "${trimmed}"`,
      suggestion: 'Canonicalize Coupon Codes converts "NONE"/null to empty',
    };
  }

  if (isFormulaTrigger(val, isNumericCol)) {
    return {
      severity: 'error',
      code: 'FORMULA',
      label: 'Formula-injection trigger (=, +, -, @)',
      suggestion: 'Protected by Formula Guard on export',
    };
  }

  if (isMissingValue(val)) {
    return {
      severity: 'warning',
      code: 'MISSING',
      label: trimmed === '' ? 'Empty cell' : `Placeholder token "${trimmed}"`,
      suggestion:
        trimmed === ''
          ? 'Configure Missing Value strategy or fill inline'
          : 'Placeholder-to-Null cleans sentinel text to empty',
    };
  }

  if (val !== trimmed || / {2,}|\t/.test(val)) {
    return {
      severity: 'info',
      code: 'WHITESPACE',
      label: 'Leading, trailing, or repeated spaces',
      suggestion: 'Trim Whitespace removes extra spaces automatically',
    };
  }

  if (profile?.detectedType === 'email') {
    if (!isValidEmailSyntax(val)) {
      return {
        severity: 'error',
        code: 'INVALID_EMAIL',
        label: 'Invalid email syntax',
        suggestion: 'Fix inline or clear with Normalize Emails',
      };
    }
    if (trimmed !== trimmed.toLowerCase()) {
      return {
        severity: 'info',
        code: 'EMAIL_CASE',
        label: 'Uppercase characters in email',
        suggestion: 'Normalize Emails lowercases addresses cleanly',
      };
    }
  }

  if (profile?.detectedType === 'date') {
    const parsed = parseDateValue(val, true);
    if (!parsed.valid) {
      return {
        severity: 'error',
        code: 'INVALID_DATE',
        label: 'Unparseable or out-of-range date',
        suggestion: 'Edit date inline or enable Clear invalid dates',
      };
    }
    if (parsed.ambiguous) {
      return {
        severity: 'warning',
        code: 'AMBIGUOUS_DATE',
        label: 'Ambiguous date (DD/MM vs MM/DD)',
        suggestion: 'Confirm Day-first or Month-first explicitly in rules',
      };
    }
  }

  if (profile?.detectedType === 'phone') {
    const phoneCheck = validateAndFormatPhone(val, 'IN', 'E.164');
    if (!phoneCheck.valid) {
      return {
        severity: 'error',
        code: 'INVALID_PHONE',
        label: 'Invalid or junk phone number',
        suggestion: 'Select correct phone region or clear invalid phones',
      };
    }
  }

  const numericRule = defaultNumericRuleForHeader(header);
  if (numericRule && !validateNumericValue(val, numericRule).valid) {
    return {
      severity: 'error',
      code: 'INVALID_NUMBER',
      label: 'Out-of-range or invalid numeric value',
      suggestion: 'Edit value inline or enable Validate Numeric Fields',
    };
  }

  return { severity: 'none', code: 'OK', label: '', suggestion: '' };
}

export const InspectionPanel: React.FC<InspectionPanelProps> = ({
  inspection,
  onDelimiterOverride,
  onSheetChange,
  onEditCell,
  onDeleteRows,
  onTrimSelectedRows,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}) => {
  const [viewTab, setViewTab] = useState<'preview' | 'columns'>('preview');
  const [issueOnlyFilter, setIssueOnlyFilter] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{
    rowIdx: number;
    colIdx: number;
    draft: string;
  } | null>(null);

  const { problems } = inspection;

  const detectedIssues = [
    { label: 'Fully blank rows', count: problems.emptyRows },
    { label: 'Exact duplicate rows', count: problems.duplicateRows },
    { label: 'Missing cells', count: problems.missingCells },
    { label: 'Whitespace issues', count: problems.whitespaceCells },
    { label: 'Invalid email syntax', count: problems.invalidEmails },
    { label: 'Invalid phone formats', count: problems.invalidPhones },
    { label: 'Ambiguous dates', count: problems.ambiguousDates },
    { label: 'Unparseable dates', count: problems.unparseableDates },
    { label: 'Formula-trigger cells', count: problems.formulaCells },
  ].filter((item) => item.count > 0);

  // Track duplicate row indices in preview window & diagnose cells
  const analyzedRows = useMemo(() => {
    const slice = inspection.rows.slice(0, 100);
    const seenKeys = new Set<string>();
    return slice.map((row, rowIdx) => {
      const isBlank = row.every((c) => (c ?? '').trim() === '');
      const key = JSON.stringify(row);
      const isDuplicate = !isBlank && seenKeys.has(key);
      if (!isBlank) seenKeys.add(key);

      const cellDiagnoses = inspection.headers.map((header, colIdx) =>
        diagnoseCell(row[colIdx] ?? '', header, inspection.columnProfiles[colIdx]),
      );
      const hasIssue =
        isBlank ||
        isDuplicate ||
        cellDiagnoses.some((d) => d.severity !== 'none');

      return { row, rowIdx, isBlank, isDuplicate, cellDiagnoses, hasIssue };
    });
  }, [inspection]);

  const filteredPreviewRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return analyzedRows.filter((item) => {
      if (issueOnlyFilter && !item.hasIssue) return false;
      if (!q) return true;
      return item.row.some((c) => (c ?? '').toLowerCase().includes(q));
    });
  }, [analyzedRows, issueOnlyFilter, searchQuery]);

  const allVisibleSelected =
    filteredPreviewRows.length > 0 &&
    filteredPreviewRows.every((r) => selectedRows.has(r.rowIdx));

  const toggleRowSelection = (rowIdx: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx);
      else next.add(rowIdx);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(filteredPreviewRows.map((r) => r.rowIdx)));
    }
  };

  const commitCellEdit = () => {
    if (!editingCell || !onEditCell) {
      setEditingCell(null);
      return;
    }
    const { rowIdx, colIdx, draft } = editingCell;
    const current = inspection.rows[rowIdx]?.[colIdx] ?? '';
    if (draft !== current) {
      onEditCell(rowIdx, colIdx, draft);
    }
    setEditingCell(null);
  };

  const handleBulkDelete = () => {
    if (!onDeleteRows || selectedRows.size === 0) return;
    onDeleteRows(Array.from(selectedRows));
    setSelectedRows(new Set());
  };

  const handleBulkTrim = () => {
    if (!onTrimSelectedRows || selectedRows.size === 0) return;
    onTrimSelectedRows(Array.from(selectedRows));
    setSelectedRows(new Set());
  };

  return (
    <section aria-labelledby="inspection-heading" className="space-y-6">
      <div className="glass-surface rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/70 pb-4">
          <div>
            <h2
              id="inspection-heading"
              className="font-display text-lg font-semibold text-slate-950"
            >
              02. Dataset Inspection &amp; Interactive Grid
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
              <span className="font-semibold text-slate-950">{inspection.filename}</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(inspection.byteSize)}</span>
              <span aria-hidden="true">·</span>
              <span>{inspection.encoding}</span>
              <span aria-hidden="true">·</span>
              <span>{inspection.rowCount.toLocaleString()} rows</span>
              <span aria-hidden="true">·</span>
              <span>{inspection.columnCount} columns</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {(onUndo || onRedo) && (
              <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200/80 bg-white/80 p-1">
                <button
                  type="button"
                  disabled={!canUndo}
                  onClick={onUndo}
                  title="Undo last grid edit"
                  aria-label="Undo last grid edit"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-35 cursor-pointer"
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={!canRedo}
                  onClick={onRedo}
                  title="Redo grid edit"
                  aria-label="Redo grid edit"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-35 cursor-pointer"
                >
                  <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            {inspection.inputFormat === 'xlsx' &&
            inspection.sheetNames &&
            inspection.sheetNames.length > 1 &&
            onSheetChange ? (
              <div className="flex items-center gap-2 shrink-0">
                <label htmlFor="sheet-select" className="text-xs font-medium text-slate-600">
                  Worksheet
                </label>
                <select
                  id="sheet-select"
                  value={inspection.selectedSheet ?? inspection.sheetNames[0]}
                  onChange={(e) => onSheetChange(e.target.value)}
                  className="glass-input min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-medium"
                >
                  {inspection.sheetNames.map((sheet) => (
                    <option key={sheet} value={sheet}>
                      {sheet}
                    </option>
                  ))}
                </select>
              </div>
            ) : inspection.inputFormat === 'csv' ? (
              <div className="flex items-center gap-2 shrink-0">
                <label htmlFor="delimiter-select" className="text-xs font-medium text-slate-600">
                  Delimiter
                </label>
                <select
                  id="delimiter-select"
                  value={inspection.delimiter}
                  onChange={(e) =>
                    onDelimiterOverride(e.target.value as ',' | ';' | '\t' | '|')
                  }
                  className="glass-input min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-medium"
                >
                  {([',', ';', '\t', '|'] as const).map((delim) => (
                    <option key={delim} value={delim}>
                      {DELIMITER_LABELS[delim]}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </div>

        {/* Auto-detected problems summary */}
        <div className="mt-4">
          {detectedIssues.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {detectedIssues.map((issue) => (
                <div
                  key={issue.label}
                  className="rounded-xl border border-amber-200/80 bg-amber-50/75 px-3.5 py-2.5 backdrop-blur-sm"
                >
                  <p className="text-xs font-medium text-amber-900">{issue.label}</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-amber-950">
                    {issue.count.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>No structural anomalies, blanks, or duplicate rows detected in this file.</span>
            </div>
          )}
        </div>

        {/* Warnings list */}
        {inspection.warnings.length > 0 && (
          <ul className="mt-4 space-y-2" aria-label="Inspection warnings">
            {inspection.warnings.map((w, idx) => (
              <li
                key={`${w.code}-${idx}`}
                className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs ${
                  w.severity === 'warning'
                    ? 'border-amber-200/80 bg-amber-50/80 text-amber-950'
                    : 'border-slate-200/80 bg-white/75 text-slate-700'
                }`}
              >
                {w.severity === 'warning' ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                ) : (
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                )}
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Toolbar: Tabs + Search + Issue Filter */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 pb-3.5">
          <div className="glass-segmented inline-flex rounded-xl p-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={viewTab === 'preview'}
              onClick={() => setViewTab('preview')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                viewTab === 'preview'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              Spreadsheet Grid ({Math.min(100, inspection.rows.length)} rows)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewTab === 'columns'}
              onClick={() => setViewTab('columns')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                viewTab === 'columns'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              Column Schema ({inspection.columnCount})
            </button>
          </div>

          {viewTab === 'preview' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter rows..."
                  aria-label="Filter preview rows"
                  className="glass-input h-9 w-44 sm:w-52 rounded-xl pl-8 pr-3 text-xs"
                />
              </div>

              <button
                type="button"
                aria-pressed={issueOnlyFilter}
                onClick={() => setIssueOnlyFilter((prev) => !prev)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  issueOnlyFilter
                    ? 'border-amber-400 bg-amber-50 text-amber-950'
                    : 'border-slate-200/90 bg-white/80 text-slate-700 hover:bg-white'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                <span>Issues only</span>
              </button>
            </div>
          )}
        </div>

        {/* Bulk selection action bar */}
        {viewTab === 'preview' && selectedRows.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/85 px-4 py-2.5 text-xs">
            <span className="font-mono font-semibold text-blue-950 tabular-nums">
              {selectedRows.size} row{selectedRows.size === 1 ? '' : 's'} selected
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {onTrimSelectedRows && (
                <button
                  type="button"
                  onClick={handleBulkTrim}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-2.5 font-medium text-blue-900 hover:bg-blue-50 cursor-pointer"
                >
                  <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Trim spaces</span>
                </button>
              )}
              {onDeleteRows && (
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-2.5 font-medium text-rose-800 hover:bg-rose-100 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Remove rows</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedRows(new Set())}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-slate-600 hover:text-slate-950 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Clear</span>
              </button>
            </div>
          </div>
        )}

        {/* Color key legend & inline edit hint */}
        {viewTab === 'preview' && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-200 border border-rose-400" />
                <span>Invalid / Formula</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-amber-200 border border-amber-400" />
                <span>Missing / Ambiguous</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-cyan-100 border border-cyan-400" />
                <span>Whitespace / Format hint</span>
              </span>
            </div>
            {onEditCell && (
              <span className="inline-flex items-center gap-1 text-slate-500">
                <Edit3 className="h-3 w-3" aria-hidden="true" />
                <span>Double-click any cell to edit inline</span>
              </span>
            )}
          </div>
        )}

        {viewTab === 'preview' ? (
          <div className="glass-table-wrap mt-3 overflow-x-auto rounded-xl">
            {analyzedRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-600">
                Headers loaded ({inspection.headers.join(', ')}), with 0 data rows.
              </div>
            ) : filteredPreviewRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-600">
                No rows in the first 100 rows match your current filter.
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-50/95 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th scope="col" className="w-9 px-2.5 py-2.5 text-center border-r border-slate-200">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        aria-label="Select all visible rows"
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 cursor-pointer"
                      />
                    </th>
                    <th
                      scope="col"
                      className="sticky left-0 z-10 bg-slate-50/95 px-3 py-2.5 font-mono font-medium text-slate-500 border-r border-slate-200 w-12 text-right"
                    >
                      #
                    </th>
                    {inspection.headers.map((header, i) => (
                      <th
                        key={`${header}-${i}`}
                        scope="col"
                        className="px-3 py-2.5 font-semibold whitespace-nowrap border-r border-slate-100 last:border-r-0"
                      >
                        <div className="flex items-center gap-1.5">
                          <span>{header}</span>
                          <span className="font-mono text-[10px] font-normal text-slate-400">
                            {inspection.columnProfiles[i]?.detectedType}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {filteredPreviewRows.map(({ row, rowIdx, isBlank, isDuplicate, cellDiagnoses }) => {
                    const isSelected = selectedRows.has(rowIdx);
                    return (
                      <tr
                        key={rowIdx}
                        className={
                          isSelected
                            ? 'bg-blue-50/70'
                            : isBlank
                            ? 'bg-amber-50/55'
                            : isDuplicate
                            ? 'bg-violet-50/45'
                            : 'hover:bg-slate-50/80'
                        }
                      >
                        <td className="px-2.5 py-2 text-center border-r border-slate-200">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRowSelection(rowIdx)}
                            aria-label={`Select row ${rowIdx + 1}`}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 cursor-pointer"
                          />
                        </td>
                        <td
                          className="sticky left-0 z-10 bg-white/95 px-3 py-2 text-right text-slate-500 border-r border-slate-200 tabular-nums"
                          title={isDuplicate ? 'Exact duplicate of an earlier row' : undefined}
                        >
                          <span>{rowIdx + 1}</span>
                          {isDuplicate && (
                            <span className="ml-1 font-sans text-[10px] font-semibold text-violet-700">
                              DUP
                            </span>
                          )}
                        </td>
                        {inspection.headers.map((_, colIdx) => {
                          const cell = row[colIdx] ?? '';
                          const diag = cellDiagnoses[colIdx];
                          const isEditing =
                            editingCell?.rowIdx === rowIdx && editingCell?.colIdx === colIdx;

                          const cellTone =
                            diag.severity === 'error'
                              ? 'bg-rose-50/90 text-rose-950 shadow-[inset_0_0_0_1px_rgba(244,63,94,0.28)]'
                              : diag.severity === 'warning'
                              ? 'bg-amber-50/85 text-amber-950 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.28)]'
                              : diag.severity === 'info'
                              ? 'bg-cyan-50/75 text-slate-900 shadow-[inset_0_0_0_1px_rgba(6,182,212,0.24)]'
                              : 'text-slate-800';

                          const tooltipText =
                            diag.severity !== 'none'
                              ? `${diag.label} — ${diag.suggestion}`
                              : cell;

                          return (
                            <td
                              key={colIdx}
                              onDoubleClick={() => {
                                if (onEditCell) {
                                  setEditingCell({ rowIdx, colIdx, draft: cell });
                                }
                              }}
                              title={tooltipText}
                              className={`max-w-[260px] px-3 py-2 border-r border-slate-100 last:border-r-0 ${
                                isEditing ? 'p-1 bg-white' : `truncate whitespace-pre ${cellTone}`
                              } ${onEditCell ? 'cursor-text' : ''}`}
                            >
                              {isEditing ? (
                                <input
                                  type="text"
                                  autoFocus
                                  value={editingCell.draft}
                                  aria-label={`Edit row ${rowIdx + 1} column ${inspection.headers[colIdx]}`}
                                  onChange={(e) =>
                                    setEditingCell((prev) =>
                                      prev ? { ...prev, draft: e.target.value } : null,
                                    )
                                  }
                                  onBlur={commitCellEdit}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      commitCellEdit();
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault();
                                      setEditingCell(null);
                                    }
                                  }}
                                  className="w-full min-w-[110px] rounded border border-blue-500 bg-white px-2 py-1 font-mono text-xs text-slate-950 focus:outline-none"
                                />
                              ) : cell === '' ? (
                                <span className="italic text-slate-400">empty</span>
                              ) : (
                                cell
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="glass-table-wrap mt-4 overflow-x-auto rounded-xl">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-50/95 text-slate-700 border-b border-slate-200">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Column</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Detected Type</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold text-right">Non-empty</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold text-right">Missing</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold text-right">Invalid</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold text-right">Whitespace</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold text-right">Unique</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Samples</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inspection.columnProfiles.map((col) => (
                  <tr key={col.name} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2.5 font-medium text-slate-950 whitespace-nowrap">
                      {col.name}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-blue-700 whitespace-nowrap">
                      {col.detectedType}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {col.nonEmptyCount}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {col.missingCount}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                        col.invalidCount > 0 ? 'font-semibold text-rose-700' : 'text-slate-700'
                      }`}
                    >
                      {col.invalidCount}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {col.whitespaceIssueCount}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {col.uniqueCount}
                    </td>
                    <td className="max-w-[240px] truncate px-3 py-2.5 font-mono text-slate-500">
                      {col.sampleValues.join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
