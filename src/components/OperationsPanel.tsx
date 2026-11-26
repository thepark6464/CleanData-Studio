import React from 'react';
import { ArrowDown, ArrowUp, Flag, Play, Shield } from 'lucide-react';
import {
  DEFAULT_PLACEHOLDER_TOKENS,
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
  includeCleaningFlags?: boolean;
  onChangeIncludeCleaningFlags?: (enabled: boolean) => void;
  onRunCleaning: () => void;
}

const OP_METADATA: Record<OperationId, { title: string; description: string }> = {
  remove_empty_rows: {
    title: 'Remove Empty Rows',
    description: 'Removes only fully blank rows; partially populated rows are preserved.',
  },
  remove_duplicates: {
    title: 'Remove & Merge Duplicate Rows',
    description:
      'Removes exact duplicates and optionally merges key-duplicate rows (e.g. order_id), filling blanks and flagging conflicts.',
  },
  trim_whitespace: {
    title: 'Trim Whitespace',
    description: 'Strips leading/trailing whitespace and optionally collapses internal space runs.',
  },
  placeholder_to_null: {
    title: 'Placeholder-to-Null Cleanup',
    description:
      'Converts sentinel placeholder strings (N/A, null, unknown, ??, -, invalid-email, not-a-date, misc) into clean empty cells.',
  },
  canonicalize_coupons: {
    title: 'Canonicalize Coupon Codes',
    description:
      'Treats "NONE" and blank coupons identically as empty (no coupon) and uppercases valid promo codes.',
  },
  normalize_text: {
    title: 'Normalize & Canonicalize Text',
    description:
      'Normalizes casing/whitespace and merges frequency-backed case variants cleanly while preserving short codes.',
  },
  standardize_dates: {
    title: 'Standardize Dates',
    description:
      'Parses supported dates to a uniform format, enforces calendar/year bounds, and clears or flags impossible dates.',
  },
  normalize_emails: {
    title: 'Normalize & Validate Emails',
    description:
      'Trims, lowercases, and syntax-checks emails (never guesses addresses or claims mailbox existence).',
  },
  normalize_phone_numbers: {
    title: 'Normalize & Validate Phones',
    description:
      'Formats valid phone numbers using an explicit region and clears or flags junk/too-short numbers.',
  },
  validate_numbers: {
    title: 'Validate Numeric Fields',
    description:
      'Validates quantities and prices against deterministic range/sentinel rules; unparseable/out-of-range values are cleared or flagged.',
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
  includeCleaningFlags = false,
  onChangeIncludeCleaningFlags,
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
      <div className="glass-surface rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/70 pb-4">
          <div>
            <h2
              id="operations-heading"
              className="font-display text-lg font-semibold text-slate-950"
            >
              03. Configure Cleaning Pipeline
            </h2>
            <p className="mt-1 text-xs text-slate-600 font-mono tabular-nums">
              {enabledCount} active rule{enabledCount === 1 ? '' : 's'} · Browser execution: 0 credits (server equivalent: {serverCreditEquivalent} credit{serverCreditEquivalent === 1 ? '' : 's'} for {inspection.rowCount.toLocaleString()} rows)
            </p>
          </div>

          <button
            type="button"
            onClick={onRunCleaning}
            className="glass-btn-primary inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            <span>Run Cleaning Preview</span>
          </button>
        </div>

        <div className="mt-5 space-y-2.5">
          {operations.map((op, index) => {
            const meta = OP_METADATA[op.id];
            return (
              <div
                key={op.id}
                className={`rounded-xl border p-4 transition-all duration-200 ${
                  op.enabled
                    ? 'border-blue-300/75 bg-white/95 shadow-sm'
                    : 'border-slate-200/70 bg-white/55 hover:bg-white/75'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <label className="flex items-start gap-3 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={op.enabled}
                      onChange={() => toggleOperation(index)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                    />
                    <div>
                      <span className="font-display text-sm font-semibold text-slate-950">
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
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200/80 bg-white/90 text-slate-600 hover:bg-white disabled:opacity-35 cursor-pointer"
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={index === operations.length - 1}
                      onClick={() => moveOperation(index, 1)}
                      aria-label={`Move ${meta.title} down`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200/80 bg-white/90 text-slate-600 hover:bg-white disabled:opacity-35 cursor-pointer"
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Operation-specific controls when enabled */}
                {op.enabled && op.id === 'remove_duplicates' && (
                  <div className="mt-3 pl-7 space-y-3 border-t border-slate-200/60 pt-3">
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
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(op.params.mergeNearDuplicates)}
                        onChange={(e) =>
                          updateOp<Extract<CleaningOperationConfig, { id: 'remove_duplicates' }>>(
                            index,
                            (prev) => ({
                              ...prev,
                              params: { ...prev.params, mergeNearDuplicates: e.target.checked },
                            }),
                          )
                        }
                      />
                      <span>
                        Merge key-duplicate rows (keeps most complete row, fills blanks from duplicates, logs field conflicts)
                      </span>
                    </label>
                    {op.params.mergeNearDuplicates && (
                      <div className="text-xs">
                        <p className="font-medium text-slate-700 mb-1.5">
                          Near-duplicate merge key columns (leave unchecked to auto-detect primary ID e.g.{' '}
                          <code className="font-mono">order_id</code> or <code className="font-mono">customer_id</code>):
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {inspection.headers.map((h) => {
                            const selectedMergeKeys = op.params.mergeKeyColumns ?? [];
                            const checked = selectedMergeKeys.includes(h);
                            return (
                              <label
                                key={`merge-${h}`}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/90 px-2.5 py-1 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const nextMergeKeys = e.target.checked
                                      ? [...selectedMergeKeys, h]
                                      : selectedMergeKeys.filter((k) => k !== h);
                                    updateOp<
                                      Extract<CleaningOperationConfig, { id: 'remove_duplicates' }>
                                    >(index, (prev) => ({
                                      ...prev,
                                      params: { ...prev.params, mergeKeyColumns: nextMergeKeys },
                                    }));
                                  }}
                                />
                                <span className="font-mono text-slate-800">{h}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className="text-xs">
                      <p className="font-medium text-slate-700 mb-1.5">
                        Exact-duplicate key columns (leave all unchecked to match entire row):
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {inspection.headers.map((h) => {
                          const checked = op.params.keyColumns.includes(h);
                          return (
                            <label
                              key={h}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/90 px-2.5 py-1 cursor-pointer"
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
                  <div className="mt-3 pl-7 border-t border-slate-200/60 pt-3 text-xs">
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

                {op.enabled && op.id === 'placeholder_to_null' && (
                  <div className="mt-3 pl-7 border-t border-slate-200/60 pt-3 text-xs space-y-2">
                    <label className="block">
                      <span className="font-medium text-slate-700">
                        Placeholder tokens (comma-separated, case-insensitive):
                      </span>
                      <input
                        type="text"
                        value={op.params.tokens.join(', ')}
                        onChange={(e) => {
                          const parsed = e.target.value
                            .split(',')
                            .map((t) => t.trim())
                            .filter(Boolean);
                          updateOp<
                            Extract<CleaningOperationConfig, { id: 'placeholder_to_null' }>
                          >(index, (prev) => ({
                            ...prev,
                            params: {
                              ...prev.params,
                              tokens: parsed.length > 0 ? parsed : [...DEFAULT_PLACEHOLDER_TOKENS],
                            },
                          }));
                        }}
                        className="glass-input mt-1.5 w-full rounded-lg px-2.5 py-1.5 font-mono text-xs"
                      />
                    </label>
                  </div>
                )}

                {op.enabled && op.id === 'canonicalize_coupons' && (
                  <div className="mt-3 pl-7 border-t border-slate-200/60 pt-3 flex flex-wrap items-center gap-4 text-xs">
                    <label className="inline-flex items-center gap-2">
                      <span className="font-medium text-slate-700">Valid coupon casing:</span>
                      <select
                        value={op.params.caseMode ?? 'upper'}
                        onChange={(e) =>
                          updateOp<
                            Extract<CleaningOperationConfig, { id: 'canonicalize_coupons' }>
                          >(index, (prev) => ({
                            ...prev,
                            params: {
                              ...prev.params,
                              caseMode: e.target.value as 'upper' | 'preserve',
                            },
                          }))
                        }
                        className="glass-input rounded-lg px-2.5 py-1.5 text-xs"
                      >
                        <option value="upper">UPPERCASE (recommended)</option>
                        <option value="preserve">Preserve original case</option>
                      </select>
                    </label>
                  </div>
                )}

                {op.enabled && op.id === 'normalize_text' && (
                  <div className="mt-3 pl-7 border-t border-slate-200/60 pt-3 flex flex-wrap items-center gap-4 text-xs">
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
                        className="glass-input rounded-lg px-2.5 py-1.5 text-xs"
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
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(op.params.canonicalMerge)}
                        onChange={(e) =>
                          updateOp<Extract<CleaningOperationConfig, { id: 'normalize_text' }>>(
                            index,
                            (prev) => ({
                              ...prev,
                              params: { ...prev.params, canonicalMerge: e.target.checked },
                            }),
                          )
                        }
                      />
                      <span>Canonicalize frequency variants (preserves acronyms ≤3 chars)</span>
                    </label>
                  </div>
                )}

                {op.enabled && op.id === 'standardize_dates' && (
                  <div className="mt-3 pl-7 border-t border-slate-200/60 pt-3 space-y-2.5 text-xs">
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
                    <div className="flex flex-wrap items-center gap-4">
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
                          className="glass-input rounded-lg px-2.5 py-1.5 font-mono text-xs"
                        >
                          <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
                          <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                          <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                        </select>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700">
                        <input
                          type="checkbox"
                          checked={Boolean(op.params.clearInvalid)}
                          onChange={(e) =>
                            updateOp<Extract<CleaningOperationConfig, { id: 'standardize_dates' }>>(
                              index,
                              (prev) => ({
                                ...prev,
                                params: { ...prev.params, clearInvalid: e.target.checked },
                              }),
                            )
                          }
                        />
                        <span>Clear impossible/out-of-range dates to empty (instead of keeping)</span>
                      </label>
                    </div>
                  </div>
                )}

                {op.enabled && op.id === 'normalize_emails' && (
                  <div className="mt-3 pl-7 border-t border-slate-200/60 pt-3 text-xs">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(op.params.clearInvalid)}
                        onChange={(e) =>
                          updateOp<Extract<CleaningOperationConfig, { id: 'normalize_emails' }>>(
                            index,
                            (prev) => ({
                              ...prev,
                              params: { ...prev.params, clearInvalid: e.target.checked },
                            }),
                          )
                        }
                      />
                      <span>Clear syntactically invalid emails to empty (logged in audit report)</span>
                    </label>
                  </div>
                )}

                {op.enabled && op.id === 'normalize_phone_numbers' && (
                  <div className="mt-3 pl-7 border-t border-slate-200/60 pt-3 flex flex-wrap items-center gap-4 text-xs">
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
                        className="glass-input rounded-lg px-2.5 py-1.5 text-xs"
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
                        className="glass-input rounded-lg px-2.5 py-1.5 font-mono text-xs"
                      >
                        <option value="E.164">E.164 (+919876543210)</option>
                        <option value="INTERNATIONAL">International (+91 98765 43210)</option>
                        <option value="NATIONAL">National (098765 43210)</option>
                      </select>
                    </label>

                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(op.params.clearInvalid)}
                        onChange={(e) =>
                          updateOp<
                            Extract<CleaningOperationConfig, { id: 'normalize_phone_numbers' }>
                          >(index, (prev) => ({
                            ...prev,
                            params: { ...prev.params, clearInvalid: e.target.checked },
                          }))
                        }
                      />
                      <span>Clear junk/invalid phones to empty (e.g. 12345, 0000000000)</span>
                    </label>
                  </div>
                )}

                {op.enabled && op.id === 'validate_numbers' && (
                  <div className="mt-3 pl-7 border-t border-slate-200/60 pt-3 flex flex-wrap items-center gap-4 text-xs">
                    <label className="inline-flex items-center gap-2">
                      <span className="font-medium text-slate-700">Max quantity bound:</span>
                      <input
                        type="number"
                        min={1}
                        max={1000000}
                        value={op.params.defaultMaxQuantity ?? 1000}
                        onChange={(e) => {
                          const val = Math.max(1, Number(e.target.value) || 1000);
                          updateOp<Extract<CleaningOperationConfig, { id: 'validate_numbers' }>>(
                            index,
                            (prev) => ({
                              ...prev,
                              params: { ...prev.params, defaultMaxQuantity: val },
                            }),
                          );
                        }}
                        className="glass-input w-24 rounded-lg px-2.5 py-1 font-mono text-xs"
                      />
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700">
                      <input
                        type="checkbox"
                        checked={op.params.clearInvalid ?? true}
                        onChange={(e) =>
                          updateOp<Extract<CleaningOperationConfig, { id: 'validate_numbers' }>>(
                            index,
                            (prev) => ({
                              ...prev,
                              params: { ...prev.params, clearInvalid: e.target.checked },
                            }),
                          )
                        }
                      />
                      <span>Clear invalid/sentinel numbers to empty (-99, 0, negative, text)</span>
                    </label>
                  </div>
                )}

                {op.enabled && op.id === 'handle_missing_values' && (
                  <div className="mt-3 pl-7 border-t border-slate-200/60 pt-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {inspection.columnProfiles.map((col) => {
                        const rule = op.params.strategies[col.name] ?? { strategy: 'keep' };
                        const isNumeric =
                          col.detectedType === 'integer' || col.detectedType === 'decimal';
                        return (
                          <div
                            key={col.name}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/85 px-3 py-2 text-xs"
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
                                className="glass-input rounded-lg px-2 py-1 text-xs"
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
                                  className="glass-input w-24 rounded-lg px-2 py-1 text-xs"
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
                  <div className="mt-3 pl-7 border-t border-slate-200/60 pt-3 space-y-3 text-xs">
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
                        className="glass-input rounded-lg px-2.5 py-1.5 text-xs"
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
                              className="glass-input flex-1 rounded-lg px-2 py-1 font-mono text-xs"
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

        {/* Formula-injection & audit flags guardrails */}
        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="glass-surface-subtle flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
              <div className="text-xs">
                <p className="font-semibold text-slate-950">
                  CSV Formula-Injection Protection (Default ON)
                </p>
                <p className="mt-0.5 text-slate-600">
                  Prefixes unsafe cells starting with <code className="font-mono">= + - @</code>, tab, or CR with <code className="font-mono">'</code> while keeping valid <code className="font-mono">+91...</code> phone numbers uncorrupted.
                </p>
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 shrink-0 cursor-pointer">
              <input
                type="checkbox"
                checked={formulaProtection}
                onChange={(e) => onChangeFormulaProtection(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
              />
              <span>Protect export</span>
            </label>
          </div>

          {onChangeIncludeCleaningFlags && (
            <div className="glass-surface-subtle flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Flag className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" aria-hidden="true" />
                <div className="text-xs">
                  <p className="font-semibold text-slate-950">
                    Append Per-Row <code className="font-mono">_cleaning_flags</code> Audit Column
                  </p>
                  <p className="mt-0.5 text-slate-600">
                    Adds a <code className="font-mono">_cleaning_flags</code> column listing exact rule triggers per row directly in the exported dataset.
                  </p>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 shrink-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeCleaningFlags}
                  onChange={(e) => onChangeIncludeCleaningFlags(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                />
                <span>Include column</span>
              </label>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
