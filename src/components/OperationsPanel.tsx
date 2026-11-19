import React from 'react';
import { ArrowDown, ArrowUp, Play, Shield } from 'lucide-react';
import {
  SUPPORTED_PHONE_REGIONS,
  type CleaningOperationConfig,
  type ColumnRenameConvention,
  type DatasetInspection,
  type DateOutputFormat,
  type MissingStrategy,
  type OperationId,
  type PhoneOutputFormat,
  type SupportedPhoneRegion,
  type TextCaseMode,
} from '../lib/cleaner';
import { estimateCreditsForRows } from '../config/pricing';

interface OperationsPanelProps {
  inspection: DatasetInspection;
  operations: CleaningOperationConfig[];
  onChangeOperations: (next: CleaningOperationConfig[]) => void;
  formulaProtection: boolean;
  onChangeFormulaProtection: (enabled: boolean) => void;
  onRunCleaning: () => void;
}

const OP_METADATA: Record<OperationId, { title: string; description: string }> = {
  remove_empty_rows: {
    title: 'Remove Empty Rows',
    description: 'Removes only fully blank rows; partially populated rows are preserved.',
  },
  remove_duplicates: {
    title: 'Remove Duplicate Rows',
    description: 'Detects exact duplicates across all columns or selected key columns.',
  },
  trim_whitespace: {
    title: 'Trim Whitespace',
    description: 'Strips leading/trailing whitespace and optionally collapses internal space runs.',
  },
  normalize_text: {
    title: 'Normalize Text',
    description: 'Applies consistent letter casing (lower, upper, title) and whitespace cleanup.',
  },
  standardize_dates: {
    title: 'Standardize Dates',
    description:
      'Parses supported dates to a uniform format. Ambiguous dates strictly follow your day-first or month-first selection.',
  },
  normalize_emails: {
    title: 'Normalize Emails',
    description:
      'Trims and lowercases emails and checks syntax only (never claims a mailbox exists).',
  },
  normalize_phone_numbers: {
    title: 'Normalize Phone Numbers',
    description:
      'Formats valid phone numbers using an explicit country/region. Validates format only, never line activity.',
  },
  handle_missing_values: {
    title: 'Handle Missing Values',
    description: 'Configure per-column strategies: keep, remove row, or fill with constant/mean/median/zero.',
  },
  rename_columns: {
    title: 'Rename Columns',
    description: 'Standardize header naming (snake_case, camelCase, lowercase, or custom map).',
  },
};

export const OperationsPanel: React.FC<OperationsPanelProps> = ({
  inspection,
  operations,
  onChangeOperations,
  formulaProtection,
  onChangeFormulaProtection,
  onRunCleaning,
}) => {
  const toggleOperation = (index: number) => {
    const next = operations.map((op, i) =>
      i === index ? { ...op, enabled: !op.enabled } : op,
    );
    onChangeOperations(next);
  };

  const moveOperation = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= operations.length) return;
    const next = [...operations];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChangeOperations(next);
  };

  const updateOp = <T extends CleaningOperationConfig>(
    index: number,
    updater: (prev: T) => T,
  ) => {
    const next = operations.map((op, i) => (i === index ? updater(op as T) : op));
    onChangeOperations(next);
  };

  const enabledCount = operations.filter((o) => o.enabled).length;
  const serverCreditEquivalent = estimateCreditsForRows(inspection.rowCount);

  return (
    <section id="operations" aria-labelledby="operations-heading" className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div>
            <h2
              id="operations-heading"
              className="font-display text-lg font-semibold text-slate-900"
            >
              Configure Cleaning Pipeline
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              {enabledCount} active step(s) · Browser local execution: 0 credits (server equivalent: {serverCreditEquivalent} credit{serverCreditEquivalent === 1 ? '' : 's'} for {inspection.rowCount.toLocaleString()} rows)
            </p>
          </div>

          <button
            type="button"
            onClick={onRunCleaning}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            <span>Run Cleaning Preview</span>
          </button>
        </div>

        <div className="mt-5 divide-y divide-slate-200 rounded-lg border border-slate-200">
          {operations.map((op, index) => {
            const meta = OP_METADATA[op.id];
            return (
              <div
                key={op.id}
                className={`p-4 transition-colors ${
                  op.enabled ? 'bg-white' : 'bg-slate-50/60'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <label className="flex items-start gap-3 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={op.enabled}
                      onChange={() => toggleOperation(index)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600 cursor-pointer"
                    />
                    <div>
                      <span className="font-display text-sm font-semibold text-slate-900">
                        {index + 1}. {meta.title}
                      </span>
                      <p className="mt-0.5 text-xs text-slate-600">{meta.description}</p>
                    </div>
                  </label>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveOperation(index, -1)}
                      aria-label={`Move ${meta.title} up`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={index === operations.length - 1}
                      onClick={() => moveOperation(index, 1)}
                      aria-label={`Move ${meta.title} down`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Operation-specific controls when enabled */}
                {op.enabled && op.id === 'remove_duplicates' && (
                  <div className="mt-3 pl-7 space-y-3 border-t border-slate-100 pt-3">
                    <div className="flex flex-wrap items-center gap-4 text-xs">
                      <span className="font-medium text-slate-700">Retention rule:</span>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="dup-keep"
                          checked={op.params.keep === 'first'}
                          onChange={() =>
                            updateOp<Extract<CleaningOperationConfig, { id: 'remove_duplicates' }>>(
                              index,
                              (prev) => ({ ...prev, params: { ...prev.params, keep: 'first' } }),
                            )
                          }
                        />
                        <span>Keep first occurrence</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="dup-keep"
                          checked={op.params.keep === 'last'}
                          onChange={() =>
                            updateOp<Extract<CleaningOperationConfig, { id: 'remove_duplicates' }>>(
                              index,
                              (prev) => ({ ...prev, params: { ...prev.params, keep: 'last' } }),
                            )
                          }
                        />
                        <span>Keep last occurrence</span>
                      </label>
                    </div>
                    <div className="text-xs">
                      <p className="font-medium text-slate-700 mb-1.5">
                        Key columns (leave all unchecked to match entire row):
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {inspection.headers.map((h) => {
                          const checked = op.params.keyColumns.includes(h);
                          return (
                            <label
                              key={h}
                              className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const nextKeys = e.target.checked
                                    ? [...op.params.keyColumns, h]
                                    : op.params.keyColumns.filter((k) => k !== h);
                                  updateOp<
                                    Extract<CleaningOperationConfig, { id: 'remove_duplicates' }>
                                  >(index, (prev) => ({
                                    ...prev,
                                    params: { ...prev.params, keyColumns: nextKeys },
                                  }));
                                }}
                              />
                              <span className="font-mono text-slate-800">{h}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {op.enabled && op.id === 'trim_whitespace' && (
                  <div className="mt-3 pl-7 border-t border-slate-100 pt-3 text-xs">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700">
                      <input
                        type="checkbox"
                        checked={op.params.collapseInternal}
                        onChange={(e) =>
                          updateOp<Extract<CleaningOperationConfig, { id: 'trim_whitespace' }>>(
                            index,
                            (prev) => ({
                              ...prev,
                              params: { ...prev.params, collapseInternal: e.target.checked },
                            }),
                          )
                        }
                      />
                      <span>Also collapse repeated internal spaces (e.g. "Alice  Johnson" → "Alice Johnson")</span>
                    </label>
                  </div>
                )}

                {op.enabled && op.id === 'normalize_text' && (
                  <div className="mt-3 pl-7 border-t border-slate-100 pt-3 flex flex-wrap items-center gap-4 text-xs">
                    <label className="flex items-center gap-2">
                      <span className="font-medium text-slate-700">Letter case:</span>
                      <select
                        value={op.params.caseMode}
                        onChange={(e) =>
                          updateOp<Extract<CleaningOperationConfig, { id: 'normalize_text' }>>(
                            index,
                            (prev) => ({
                              ...prev,
                              params: {
                                ...prev.params,
                                caseMode: e.target.value as TextCaseMode,
                              },
                            }),
                          )
                        }
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="none">Keep original case</option>
                        <option value="title">Title Case</option>
                        <option value="lower">lowercase</option>
                        <option value="upper">UPPERCASE</option>
                      </select>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={op.params.collapseWhitespace}
                        onChange={(e) =>
                          updateOp<Extract<CleaningOperationConfig, { id: 'normalize_text' }>>(
                            index,
                            (prev) => ({
                              ...prev,
                              params: { ...prev.params, collapseWhitespace: e.target.checked },
                            }),
                          )
                        }
                      />
                      <span>Collapse extra whitespace</span>
                    </label>
                  </div>
                )}

                {op.enabled && op.id === 'standardize_dates' && (
                  <div className="mt-3 pl-7 border-t border-slate-100 pt-3 space-y-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="font-medium text-slate-700">Ambiguous date interpretation (e.g. 03/04/2025):</span>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="date-order"
                          checked={op.params.dayFirst}
                          onChange={() =>
                            updateOp<Extract<CleaningOperationConfig, { id: 'standardize_dates' }>>(
                              index,
                              (prev) => ({
                                ...prev,
                                params: { ...prev.params, dayFirst: true },
                              }),
                            )
                          }
                        />
                        <span>Day-first (DD/MM/YYYY → 2025-04-03)</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="date-order"
                          checked={!op.params.dayFirst}
                          onChange={() =>
                            updateOp<Extract<CleaningOperationConfig, { id: 'standardize_dates' }>>(
                              index,
                              (prev) => ({
                                ...prev,
                                params: { ...prev.params, dayFirst: false },
                              }),
                            )
                          }
                        />
                        <span>Month-first (MM/DD/YYYY → 2025-03-04)</span>
                      </label>
                    </div>
                    <label className="inline-flex items-center gap-2">
                      <span className="font-medium text-slate-700">Output format:</span>
                      <select
                        value={op.params.outputFormat}
                        onChange={(e) =>
                          updateOp<Extract<CleaningOperationConfig, { id: 'standardize_dates' }>>(
                            index,
                            (prev) => ({
                              ...prev,
                              params: {
                                ...prev.params,
                                outputFormat: e.target.value as DateOutputFormat,
                              },
                            }),
                          )
                        }
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                      >
                        <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
                        <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                        <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                      </select>
                    </label>
                  </div>
                )}

                {op.enabled && op.id === 'normalize_phone_numbers' && (
                  <div className="mt-3 pl-7 border-t border-slate-100 pt-3 flex flex-wrap items-center gap-4 text-xs">
                    <label className="inline-flex items-center gap-2">
                      <span className="font-medium text-slate-700">Default region (required):</span>
                      <select
                        value={op.params.defaultRegion}
                        onChange={(e) =>
                          updateOp<
                            Extract<CleaningOperationConfig, { id: 'normalize_phone_numbers' }>
                          >(index, (prev) => ({
                            ...prev,
                            params: {
                              ...prev.params,
                              defaultRegion: e.target.value as SupportedPhoneRegion,
                            },
                          }))
                        }
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      >
                        {SUPPORTED_PHONE_REGIONS.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="inline-flex items-center gap-2">
                      <span className="font-medium text-slate-700">Output format:</span>
                      <select
                        value={op.params.format}
                        onChange={(e) =>
                          updateOp<
                            Extract<CleaningOperationConfig, { id: 'normalize_phone_numbers' }>
                          >(index, (prev) => ({
                            ...prev,
                            params: {
                              ...prev.params,
                              format: e.target.value as PhoneOutputFormat,
                            },
                          }))
                        }
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                      >
                        <option value="E.164">E.164 (+919876543210)</option>
                        <option value="INTERNATIONAL">International (+91 98765 43210)</option>
                        <option value="NATIONAL">National (098765 43210)</option>
                      </select>
                    </label>
                  </div>
                )}

                {op.enabled && op.id === 'handle_missing_values' && (
                  <div className="mt-3 pl-7 border-t border-slate-100 pt-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {inspection.columnProfiles.map((col) => {
                        const rule = op.params.strategies[col.name] ?? { strategy: 'keep' };
                        const isNumeric =
                          col.detectedType === 'integer' || col.detectedType === 'decimal';
                        return (
                          <div
                            key={col.name}
                            className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                          >
                            <div className="min-w-0">
                              <span className="font-mono font-medium text-slate-900">
                                {col.name}
                              </span>
                              <span className="ml-2 text-slate-500">
                                ({col.missingCount} missing)
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <select
                                aria-label={`Missing value strategy for ${col.name}`}
                                value={rule.strategy}
                                onChange={(e) => {
                                  const nextStrat = e.target.value as MissingStrategy;
                                  updateOp<
                                    Extract<CleaningOperationConfig, { id: 'handle_missing_values' }>
                                  >(index, (prev) => ({
                                    ...prev,
                                    params: {
                                      strategies: {
                                        ...prev.params.strategies,
                                        [col.name]: {
                                          strategy: nextStrat,
                                          constantValue: rule.constantValue ?? '',
                                        },
                                      },
                                    },
                                  }));
                                }}
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                              >
                                <option value="keep">Keep as-is</option>
                                <option value="remove_row">Remove row</option>
                                <option value="fill_constant">Fill constant</option>
                                <option value="fill_zero">Fill 0</option>
                                {isNumeric && <option value="fill_mean">Fill mean</option>}
                                {isNumeric && <option value="fill_median">Fill median</option>}
                              </select>
                              {rule.strategy === 'fill_constant' && (
                                <input
                                  type="text"
                                  placeholder="Value..."
                                  value={rule.constantValue ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    updateOp<
                                      Extract<
                                        CleaningOperationConfig,
                                        { id: 'handle_missing_values' }
                                      >
                                    >(index, (prev) => ({
                                      ...prev,
                                      params: {
                                        strategies: {
                                          ...prev.params.strategies,
                                          [col.name]: {
                                            strategy: 'fill_constant',
                                            constantValue: val,
                                          },
                                        },
                                      },
                                    }));
                                  }}
                                  className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {op.enabled && op.id === 'rename_columns' && (
                  <div className="mt-3 pl-7 border-t border-slate-100 pt-3 space-y-3 text-xs">
                    <label className="inline-flex items-center gap-2">
                      <span className="font-medium text-slate-700">Convention:</span>
                      <select
                        value={op.params.convention}
                        onChange={(e) =>
                          updateOp<Extract<CleaningOperationConfig, { id: 'rename_columns' }>>(
                            index,
                            (prev) => ({
                              ...prev,
                              params: {
                                ...prev.params,
                                convention: e.target.value as ColumnRenameConvention,
                              },
                            }),
                          )
                        }
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="snake_case">snake_case (recommended)</option>
                        <option value="camelCase">camelCase</option>
                        <option value="lowercase">lowercase</option>
                        <option value="custom">Custom mapping</option>
                      </select>
                    </label>
                    {op.params.convention === 'custom' && (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {inspection.headers.map((h) => (
                          <div key={h} className="flex items-center gap-2">
                            <span className="w-32 truncate font-mono text-slate-600">{h}</span>
                            <span aria-hidden="true">→</span>
                            <input
                              type="text"
                              value={op.params.customMap[h] ?? h}
                              onChange={(e) => {
                                const val = e.target.value;
                                updateOp<
                                  Extract<CleaningOperationConfig, { id: 'rename_columns' }>
                                >(index, (prev) => ({
                                  ...prev,
                                  params: {
                                    ...prev.params,
                                    customMap: { ...prev.params.customMap, [h]: val },
                                  },
                                }));
                              }}
                              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Formula-injection security guardrail */}
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
            <div className="text-xs">
              <p className="font-semibold text-slate-900">
                CSV Formula-Injection Protection (Default ON)
              </p>
              <p className="mt-0.5 text-slate-600">
                Prefixes text cells starting with <code className="font-mono">= + - @</code>, tab, or CR with a single quote (<code className="font-mono">'</code>) so Excel/Sheets never execute formulas.
              </p>
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 shrink-0 cursor-pointer">
            <input
              type="checkbox"
              checked={formulaProtection}
              onChange={(e) => onChangeFormulaProtection(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600 cursor-pointer"
            />
            <span>Protect export</span>
          </label>
        </div>
      </div>
    </section>
  );
};
