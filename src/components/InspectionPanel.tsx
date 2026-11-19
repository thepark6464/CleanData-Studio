import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { DatasetInspection } from '../lib/cleaner';

interface InspectionPanelProps {
  inspection: DatasetInspection;
  onDelimiterOverride: (delimiter: ',' | ';' | '\t' | '|') => void;
  onSheetChange?: (sheetName: string) => void;
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

export const InspectionPanel: React.FC<InspectionPanelProps> = ({
  inspection,
  onDelimiterOverride,
  onSheetChange,
}) => {
  const [viewTab, setViewTab] = useState<'preview' | 'columns'>('preview');
  const previewRows = inspection.rows.slice(0, 100);
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

  return (
    <section aria-labelledby="inspection-heading" className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div>
            <h2
              id="inspection-heading"
              className="font-display text-lg font-semibold text-slate-900"
            >
              02. Dataset Inspection &amp; Safe Preview
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
              <span className="font-semibold text-slate-900">{inspection.filename}</span>
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
                className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
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
                className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                {(['.', ',', ';', '\t', '|'] as const)
                  .filter((d): d is ',' | ';' | '\t' | '|' => d !== '.')
                  .map((delim) => (
                    <option key={delim} value={delim}>
                      {DELIMITER_LABELS[delim]}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
        </div>

        {/* Auto-detected problems summary */}
        <div className="mt-4">
          {detectedIssues.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {detectedIssues.map((issue) => (
                <div
                  key={issue.label}
                  className="rounded-lg border border-amber-200 bg-amber-50/60 px-3.5 py-2.5"
                >
                  <p className="text-xs text-amber-900">{issue.label}</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-amber-950">
                    {issue.count.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
              <span>No structural anomalies, blanks, or duplicate rows detected in this CSV.</span>
            </div>
          )}
        </div>

        {/* Warnings list */}
        {inspection.warnings.length > 0 && (
          <ul className="mt-4 space-y-2" aria-label="Inspection warnings">
            {inspection.warnings.map((w, idx) => (
              <li
                key={`${w.code}-${idx}`}
                className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs ${
                  w.severity === 'warning'
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                {w.severity === 'warning' ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                ) : (
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                )}
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Segmented tabs for Raw Preview vs Column Schema */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
          <div className="inline-flex rounded-lg bg-slate-100 p-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={viewTab === 'preview'}
              onClick={() => setViewTab('preview')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewTab === 'preview'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Raw Preview (First {previewRows.length} rows)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewTab === 'columns'}
              onClick={() => setViewTab('columns')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewTab === 'columns'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Detected Column Types ({inspection.columnCount})
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Escaped read-only preview · Original file is never mutated
          </p>
        </div>

        {viewTab === 'preview' ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            {previewRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-600">
                Headers loaded ({inspection.headers.join(', ')}), with 0 data rows.
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th
                      scope="col"
                      className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 font-mono font-medium text-slate-500 border-r border-slate-200 w-12 text-right"
                    >
                      #
                    </th>
                    {inspection.headers.map((header, i) => (
                      <th
                        key={`${header}-${i}`}
                        scope="col"
                        className="px-3 py-2.5 font-semibold whitespace-nowrap"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {previewRows.map((row, rowIdx) => {
                    const isBlank = row.every((c) => c.trim() === '');
                    return (
                      <tr
                        key={rowIdx}
                        className={
                          isBlank ? 'bg-amber-50/50' : 'hover:bg-slate-50/80'
                        }
                      >
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 text-right text-slate-400 border-r border-slate-200 tabular-nums">
                          {rowIdx + 1}
                        </td>
                        {inspection.headers.map((_, colIdx) => {
                          const cell = row[colIdx] ?? '';
                          const hasEdgeSpace = cell !== cell.trim();
                          return (
                            <td
                              key={colIdx}
                              className="max-w-[260px] truncate px-3 py-2 text-slate-800 whitespace-pre"
                              title={cell}
                            >
                              {cell === '' ? (
                                <span className="italic text-slate-400">empty</span>
                              ) : (
                                <span className={hasEdgeSpace ? 'bg-amber-100/70 px-0.5 rounded' : ''}>
                                  {cell}
                                </span>
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
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
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
                    <td className="px-3 py-2.5 font-medium text-slate-900 whitespace-nowrap">
                      {col.name}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-blue-800 whitespace-nowrap">
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
                        col.invalidCount > 0 ? 'font-semibold text-red-700' : 'text-slate-700'
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
