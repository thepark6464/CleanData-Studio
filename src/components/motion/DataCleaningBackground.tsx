import React from 'react';
import { ArrowRight, Check } from '@phosphor-icons/react';

interface CleaningTrack {
  id: string;
  messy: string;
  clean: string;
  rule: string;
  durationSec: number;
  delaySec: number;
  topClass: string;
}

const TRACKS: CleaningTrack[] = [
  {
    id: 't1',
    messy: '  ALICE@Example.COM ',
    clean: 'alice@example.com',
    rule: 'Trimmed & lowercased',
    durationSec: 20,
    delaySec: -2,
    topClass: 'top-8',
  },
  {
    id: 't2',
    messy: '14/03/2025',
    clean: '2025-03-14 ISO',
    rule: 'Date verified',
    durationSec: 24,
    delaySec: -9,
    topClass: 'top-24',
  },
  {
    id: 't3',
    messy: '=HYPERLINK("http://x")',
    clean: "'=HYPERLINK(...)",
    rule: 'Formula guarded',
    durationSec: 21,
    delaySec: -14,
    topClass: 'top-44',
  },
  {
    id: 't4',
    messy: 'row #402 duplicate',
    clean: 'Row collapsed',
    rule: 'Key deduplicated',
    durationSec: 26,
    delaySec: -5,
    topClass: 'top-64',
  },
  {
    id: 't5',
    messy: '098201 11234',
    clean: '+91 98201 11234',
    rule: 'Phone formatted',
    durationSec: 21,
    delaySec: -12,
    topClass: 'top-80',
  },
  {
    id: 't6',
    messy: '   N/A   ',
    clean: 'Null cleared',
    rule: 'Placeholder cleaned',
    durationSec: 23,
    delaySec: -7,
    topClass: 'top-96',
  },
];

export const DataCleaningBackground: React.FC = () => {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden select-none opacity-65 sm:opacity-80"
    >
      {/* Crisp architectural spreadsheet grid */}
      <svg
        className="absolute inset-0 h-full w-full text-blue-900/[0.045]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="sheet-grid-pattern" width="64" height="48" patternUnits="userSpaceOnUse">
            <path d="M 64 0 L 0 0 0 48" fill="none" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#sheet-grid-pattern)" />
      </svg>

      {/* Ambient sweeping clean pass scan bar */}
      <div className="clean-scan-beam absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-blue-500/0 via-cyan-500/35 to-violet-500/0" />

      {/* Moving frosted data transformation tokens */}
      <div className="relative mx-auto h-full max-w-6xl">
        {TRACKS.map((track) => (
          <div
            key={track.id}
            style={{
              animationDuration: `${track.durationSec}s`,
              animationDelay: `${track.delaySec}s`,
            }}
            className={`clean-bg-track absolute left-0 flex items-center gap-3 whitespace-nowrap ${track.topClass}`}
          >
            <div className="flex items-center gap-2 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-1.5 font-mono text-xs text-amber-900 backdrop-blur-md shadow-sm">
              <span>{track.messy}</span>
            </div>

            <ArrowRight size={14} weight="bold" className="text-blue-500/60" />

            <div className="flex items-center gap-2 rounded-xl border border-white/90 bg-white/80 px-3 py-1.5 font-mono text-xs text-emerald-900 backdrop-blur-md shadow-sm">
              <Check size={12} weight="bold" className="text-emerald-600" />
              <span>{track.clean}</span>
              <span className="font-sans text-xs text-slate-600">· {track.rule}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Soft translucent veil keeping hero copy crystal-clear */}
      <div
        className="absolute inset-y-0 left-0 w-full lg:w-7/12"
        style={{
          background:
            'linear-gradient(90deg, rgba(246,248,255,0.92) 0%, rgba(246,248,255,0.82) 72%, rgba(246,248,255,0) 100%)',
        }}
      />
    </div>
  );
};
