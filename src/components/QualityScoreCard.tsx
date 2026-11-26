import React from 'react';
import type { QualityScoreBreakdown } from '../lib/cleaner';

interface QualityScoreCardProps {
  title: string;
  breakdown: QualityScoreBreakdown;
  comparisonScore?: number;
}

export const QualityScoreCard: React.FC<QualityScoreCardProps> = ({
  title,
  breakdown,
  comparisonScore,
}) => {
  const delta =
    comparisonScore !== undefined
      ? Math.round((breakdown.score - comparisonScore) * 10) / 10
      : null;

  const scoreTone =
    breakdown.score >= 90
      ? 'text-emerald-700'
      : breakdown.score >= 70
      ? 'text-amber-700'
      : 'text-red-700';

  const hasPassMetrics =
    breakdown.passingCells !== undefined && breakdown.totalCells > 0;
  const passPct =
    breakdown.validationPassRate !== undefined
      ? Math.round(breakdown.validationPassRate * 1000) / 10
      : breakdown.score;

  const components = [
    {
      label: 'Missing cells',
      weight: '30 pts',
      rate: breakdown.missingRate,
      countText: `${breakdown.missingCount} / ${breakdown.totalCells} cells`,
      penalty: Math.round(30 * breakdown.missingRate * 10) / 10,
    },
    {
      label: 'Invalid syntax / dates / numbers',
      weight: '30 pts',
      rate: breakdown.invalidRate,
      countText: `${breakdown.invalidCount} / ${breakdown.totalCells} cells`,
      penalty: Math.round(30 * breakdown.invalidRate * 10) / 10,
    },
    {
      label: 'Duplicate rows',
      weight: '25 pts',
      rate: breakdown.duplicateRate,
      countText: `${breakdown.duplicateRowCount} / ${breakdown.totalRows} rows`,
      penalty: Math.round(25 * breakdown.duplicateRate * 10) / 10,
    },
    {
      label: 'Type inconsistency',
      weight: '15 pts',
      rate: breakdown.typeInconsistencyRate,
      countText: `${breakdown.typeInconsistentCount} inconsistent`,
      penalty: Math.round(15 * breakdown.typeInconsistencyRate * 10) / 10,
    },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {hasPassMetrics
              ? `Measured passing cells: ${breakdown.passingCells?.toLocaleString()} / ${breakdown.totalCells.toLocaleString()} (${passPct}%)`
              : 'Measured validation & deduplication score (0–100)'}
          </p>
        </div>
        <div className="text-right">
          <span className={`font-mono text-3xl font-semibold tabular-nums ${scoreTone}`}>
            {breakdown.score}
          </span>
          <span className="font-mono text-sm text-slate-400"> / 100</span>
          {delta !== null && delta !== 0 && (
            <p
              className={`mt-0.5 font-mono text-xs tabular-nums ${
                delta > 0 ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {delta > 0 ? `+${delta}` : delta} pts vs. input
            </p>
          )}
        </div>
      </div>

      <dl className="mt-4 space-y-2.5 text-xs">
        {components.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-4">
            <dt className="text-slate-600">
              <span className="font-medium text-slate-800">{item.label}</span>
              <span className="text-slate-400"> · weight {item.weight}</span>
            </dt>
            <dd className="flex items-center gap-3 font-mono tabular-nums text-slate-700">
              <span className="text-slate-500">{item.countText}</span>
              <span className="w-16 text-right font-medium text-slate-900">
                -{item.penalty}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
