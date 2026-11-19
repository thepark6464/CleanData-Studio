import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileJson, FileSpreadsheet } from 'lucide-react';
import {
  exportReportToJson,
  exportRowsToXlsxBlob,
  type CleaningResult,
  type ColumnType,
} from '../lib/cleaner';
import { QualityScoreCard } from './QualityScoreCard';

interface ReviewExportPanelProps {
  result: CleaningResult;
  columnTypes?: Record<string, ColumnType>;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function triggerDownload(content: string, filename: string, mimeType: string) {
  triggerBlobDownload(new Blob([content], { type: mimeType }), filename);
}

export const ReviewExportPanel: React.FC<ReviewExportPanelProps> = ({
  result,
  columnTypes,
}) => {
  const [activeTab, setActiveTab] = useState<'cleaned' | 'diff' | 'report'>('cleaned');
  const [diffFilter, setDiffFilter] = useState<'all' | 'modified' | 'removed'>('all');
  const [destructiveApproved, setDestructiveApproved] = useState(false);

  const { report, diffRows } = result;
  const requiresApproval = report.recordsRemoved > 0;
  const canDownloadCsv = !requiresApproval || destructiveApproved;

  const baseName = report.sourceFilename.replace(/\.[^/.]+$/, '') || 'dataset';

  const filteredDiffRows = diffRows.filter((row) => {
    if (diffFilter === 'all') return row.status !== 'unchanged';
    return row.status === diffFilter;
  });

  const previewCleanedRows = result.rows.slice(0, 100);

  return (
    <section id="quality-score" aria-labelledby="review-heading" className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              id="review-heading"
              className="font-display text-lg font-semibold text-slate-900"
            >
              Before/After Preview, Quality Score &amp; Export
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
              <span>Rows: {report.rowsBefore} → {report.rowsAfter}</span>
              <span aria-hidden="true">·</span>
              <span>Changed: {report.recordsChanged}</span>
              <span aria-hidden="true">·</span>
              <span>Removed: {report.recordsRemoved}</span>
              <span aria-hidden="true">·</span>
              <span>Formula-escaped cells: {report.formulaCellsEscaped}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                triggerDownload(
                  exportReportToJson(report),
                  `report_${baseName}.json`,
                  'application/json;charset=utf-8',
                )
              }
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileJson className="h-4 w-4" aria-hidden="true" />
              <span>Download Report JSON</span>
            </button>

            <button
              type="button"
              disabled={!canDownloadCsv}
              onClick={async () => {
                const blob = await exportRowsToXlsxBlob(result.headers, result.rows, {
                  formulaProtection: report.formulaInjectionProtected,
                  columnTypes,
                });
                triggerBlobDownload(blob, `cleaned_${baseName}.xlsx`);
              }}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              <span>Download Cleaned XLSX</span>
            </button>

            <button
              type="button"
              disabled={!canDownloadCsv}
              onClick={() =>
                triggerDownload(
                  result.csvOutput,
                  `cleaned_${baseName}.csv`,
                  'text/csv;charset=utf-8',
                )
              }
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Download Cleaned CSV</span>
            </button>
          </div>
        </div>

        {/* Destructive-change approval gate */}
        {requiresApproval && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
              <div className="space-y-2 text-xs text-amber-950">
                <p className="font-semibold">
                  Destructive change confirmation required ({report.recordsRemoved} row(s) removed: {report.emptyRowsRemoved} blank, {report.duplicatesRemoved} duplicate, {report.recordsRemoved - report.emptyRowsRemoved - report.duplicatesRemoved} missing-rule)
                </p>
                <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={destructiveApproved}
                    onChange={(e) => setDestructiveApproved(e.target.checked)}
                    className="h-4 w-4 rounded border-amber-400 text-blue-700 focus:ring-blue-600 cursor-pointer"
                  />
                  <span>
                    I have reviewed the Before vs. After diff and approve exporting the cleaned CSV without the removed rows.
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Transparent Quality Score Before vs After */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <QualityScoreCard
            title="Input Quality Score (Before)"
            breakdown={report.qualityBefore}
          />
          <QualityScoreCard
            title="Cleaned Quality Score (After)"
            breakdown={report.qualityAfter}
            comparisonScore={report.qualityBefore.score}
          />
        </div>
        <p className="mt-2 font-mono text-[11px] text-slate-500">
          Formula: {report.qualityAfter.formulaDescription}
        </p>

        {/* Sub-tabs */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="inline-flex rounded-lg bg-slate-100 p-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'cleaned'}
              onClick={() => setActiveTab('cleaned')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'cleaned'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Cleaned Preview ({previewCleanedRows.length} rows)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'diff'}
              onClick={() => setActiveTab('diff')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'diff'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Before vs. After Diff ({diffRows.filter((d) => d.status !== 'unchanged').length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'report'}
              onClick={() => setActiveTab('report')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'report'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Operations &amp; Report
            </button>
          </div>
        </div>

        {/* Tab content */}
        {activeTab === 'cleaned' && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            {previewCleanedRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-600">
                0 data rows in cleaned output. Headers: {result.headers.join(', ')}
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
                    {result.headers.map((header, i) => (
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
                  {previewCleanedRows.map((row, rowIdx) => (
                    <tr key={rowIdx} className="hover:bg-slate-50/80">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 text-right text-slate-400 border-r border-slate-200 tabular-nums">
                        {rowIdx + 1}
                      </td>
                      {result.headers.map((_, colIdx) => {
                        const val = row[colIdx] ?? '';
                        return (
                          <td
                            key={colIdx}
                            className="max-w-[260px] truncate px-3 py-2 text-slate-800 whitespace-pre"
                            title={val}
                          >
                            {val === '' ? (
                              <span className="italic text-slate-400">empty</span>
                            ) : (
                              val
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'diff' && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'modified', 'removed'] as const).map((filterVal) => (
                <button
                  key={filterVal}
                  type="button"
                  onClick={() => setDiffFilter(filterVal)}
                  className={`rounded-md border px-3 py-1 text-xs font-medium capitalize cursor-pointer ${
                    diffFilter === filterVal
                      ? 'border-blue-700 bg-blue-50 text-blue-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {filterVal === 'all' ? 'All changes' : filterVal}
                </button>
              ))}
            </div>

            {filteredDiffRows.length === 0 ? (
              <div className="rounded-lg border border-slate-200 p-8 text-center text-sm text-slate-600">
                No rows match this diff filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
                {filteredDiffRows.slice(0, 100).map((diff) => (
                  <div key={diff.originalRowNumber} className="p-3.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        Source Row #{diff.originalRowNumber}
                      </span>
                      <span
                        className={`font-medium ${
                          diff.status === 'removed' ? 'text-red-700' : 'text-blue-700'
                        }`}
                      >
                        {diff.status === 'removed'
                          ? `Removed · ${diff.reason}`
                          : `${diff.cellChanges.length} cell(s) modified`}
                      </span>
                    </div>

                    {diff.status === 'removed' ? (
                      <p className="mt-2 font-mono text-slate-600 break-all">
                        {diff.beforeRow.map((c) => (c === '' ? '(blank)' : c)).join(' | ')}
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1.5 font-mono">
                        {diff.cellChanges.map((change) => (
                          <li
                            key={change.columnIndex}
                            className="flex flex-wrap items-baseline gap-2"
                          >
                            <span className="font-semibold text-slate-700">
                              {change.columnName}:
                            </span>
                            <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-800 line-through">
                              {change.before || '(empty)'}
                            </span>
                            <span aria-hidden="true" className="text-slate-400">
                              →
                            </span>
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-900">
                              {change.after || '(empty)'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'report' && (
          <div className="mt-4 space-y-4">
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Order</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Operation</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold text-right">Affected</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.operationsApplied.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                        No cleaning operations were enabled.
                      </td>
                    </tr>
                  ) : (
                    report.operationsApplied.map((op, i) => (
                      <tr key={op.id}>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-slate-500">
                          {i + 1}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-900 whitespace-nowrap">
                          {op.label}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800">
                          {op.recordsAffected}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{op.details}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {report.warnings.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-display text-xs font-semibold text-slate-900">
                  Report Warnings &amp; Disclosures
                </h3>
                <ul className="space-y-1.5 text-xs">
                  {report.warnings.map((w, idx) => (
                    <li
                      key={`${w.code}-${idx}`}
                      className="flex items-start gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                    >
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                      <span>{w.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
