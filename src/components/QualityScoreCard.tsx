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

  const scoreColor =
    breakdown.score >= 90
      ? { text: 'text-emerald-700', stroke: '#059669', track: '#D1FAE5' }
      : breakdown.score >= 70
      ? { text: 'text-amber-700', stroke: '#D97706', track: '#FEF3C7' }
      : { text: 'text-rose-700', stroke: '#E11D48', track: '#FFE4E6' };

  const hasPassMetrics =
    breakdown.passingCells !== undefined && breakdown.totalCells > 0;
  const passPct =
    breakdown.validationPassRate !== undefined
      ? Math.round(breakdown.validationPassRate * 1000) / 10
      : breakdown.score;

  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = Math.max(0, Math.min(100, breakdown.score));
  const strokeDashoffset = circumference - (clampedScore / 100) * circumference;

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
    <div className="glass-surface rounded-2xl p-5">
      <div className="flex items-center justify-between gap-4 border-b border-slate-200/70 pb-4">
        <div className="min-w-0">
          <h3 className="font-display text-sm font-semibold text-slate-950">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-600">
            {hasPassMetrics
              ? `Measured passing cells: ${breakdown.passingCells?.toLocaleString()} / ${breakdown.totalCells.toLocaleString()} (${passPct}%)`
              : 'Measured validation & deduplication score (0–100)'}
          </p>
          {delta !== null && delta !== 0 && (
            <p
              className={`mt-1 font-mono text-xs font-semibold tabular-nums ${
                delta > 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {delta > 0 ? `+${delta}` : delta} pts vs. input
            </p>
          )}
        </div>

        {/* Crisp SVG radial quality gauge */}
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
          <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64" aria-hidden="true">
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              stroke={scoreColor.track}
              strokeWidth="5.5"
            />
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              stroke={scoreColor.stroke}
              strokeWidth="5.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-[stroke-dashoffset] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
            />
          </svg>
          <span
            className={`absolute font-mono text-sm font-bold tabular-nums ${scoreColor.text}`}
          >
            {breakdown.score}
          </span>
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
              <span className="w-16 text-right font-semibold text-slate-900">
                -{item.penalty}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
