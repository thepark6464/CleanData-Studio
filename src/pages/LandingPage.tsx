import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  CaretDown,
  CheckCircle,
  Copy,
  DownloadSimple,
  EnvelopeSimple,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  UploadSimple,
} from '@phosphor-icons/react';
import {
  buildDefaultOperations,
  parseCsvBuffer,
  runCleaningPipeline,
} from '../lib/cleaner';
import messyCustomersFixture from '../../fixtures/messy_customers.csv?raw';
import { formatInrFromPaise, SUBSCRIPTION_PLANS } from '../config/pricing';
import { AppLink, type AppRoute } from '../lib/router';
import { RevealSection } from '../components/motion/RevealSection';
import { TaglineReveal } from '../components/motion/TaglineReveal';
import { DataCleaningBackground } from '../components/motion/DataCleaningBackground';

interface LandingPageProps {
  onNavigate: (to: AppRoute) => void;
}

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: UploadSimple,
    title: 'Drop any CSV or workbook',
    description:
      'Open files up to 5 MB inside browser memory to inspect delimiters, encoding, and baseline quality without server upload.',
  },
  {
    step: '02',
    icon: SlidersHorizontal,
    title: 'Confirm deterministic rules',
    description:
      'Enable whitespace trimming, key deduplication, missing value handling, and explicit regional rules with live row previews.',
  },
  {
    step: '03',
    icon: DownloadSimple,
    title: 'Export or automate via API',
    description:
      'Save formula-guarded CSV or Excel files locally or run the identical rule engine on larger files through REST API jobs.',
  },
];

const FAQ_ITEMS = [
  {
    question: 'Do files under 5 MB leave my browser?',
    answer:
      'No. In Studio mode, files up to 5 MB are parsed, cleaned, scored, and exported inside browser memory with zero network upload.',
  },
  {
    question: 'How are ambiguous dates like 03/04/2025 handled?',
    answer:
      'Ambiguous numeric dates are never guessed silently. You choose day-first or month-first explicitly before date standardization executes.',
  },
  {
    question: 'What protects exports from spreadsheet formula injection?',
    answer:
      'Formula protection stays active by default and escapes leading equals, plus, minus, at, tab, and carriage return characters across CSV and XLSX outputs without altering valid +91 phone numbers.',
  },
  {
    question: 'How are API credits calculated and spent?',
    answer:
      'One credit covers up to 1,000 rows processed on the server API. Monthly subscription credits are spent before purchased credit packs, which last 12 months.',
  },
  {
    question: 'How long are uploaded files kept on CleanData servers?',
    answer:
      'Raw server uploads expire and delete automatically after 24 hours. Cleaned output artifacts expire and delete after 7 days.',
  },
  {
    question: 'Does CleanData train AI models on customer spreadsheets?',
    answer:
      'No. Cleaning runs solely on deterministic parsers and validation logic with zero AI model training on customer files.',
  },
];

const RISK_REVERSALS = [
  'Free browser tier with no credit card required',
  'Local datasets under 5 MB stay strictly on your device',
  'Cancel monthly plans anytime; credit packs remain valid 12 months',
];

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate }) => {
  const [previewMode, setPreviewMode] = useState<'after' | 'before'>('after');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  // Real computation on the golden fixture — zero fabricated telemetry
  const samplePreview = useMemo(() => {
    const bytes = new TextEncoder().encode(messyCustomersFixture);
    const inspection = parseCsvBuffer(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      'messy_customers.csv',
    );
    const ops = buildDefaultOperations(inspection).map((op) =>
      op.id === 'trim_whitespace'
        ? { ...op, enabled: true, params: { columns: [], collapseInternal: true } }
        : op,
    );
    const result = runCleaningPipeline(inspection, ops, { formulaProtection: true });
    return { inspection, result };
  }, []);

  const rowsToShow =
    previewMode === 'after'
      ? samplePreview.result.rows.slice(0, 4)
      : samplePreview.inspection.rows.slice(0, 4);

  const scoreDelta =
    samplePreview.result.report.qualityAfter.score -
    samplePreview.result.report.qualityBefore.score;

  return (
    <div className="relative">
      {/* 1. Above the fold Liquid Glass Hero */}
      <section
        aria-labelledby="hero-heading"
        className="relative overflow-hidden pt-10 pb-16 sm:pt-16 sm:pb-24"
      >
        <DataCleaningBackground />
        <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-10">
            <div className="flex flex-col items-start gap-6 lg:col-span-6">
              <div className="space-y-4">
                <p className="inline-flex items-center gap-1.5 caption-3 text-blue-700">
                  <Sparkle size={14} weight="fill" className="text-violet-600" aria-hidden="true" />
                  <span>CleanData Studio · Deterministic Data Hygiene</span>
                </p>
                <h1 id="hero-heading" className="heading-1 hero-heading-gradient max-w-[640px]">
                  Clean Your Data.
                  <br />
                  Unlock Your Insights.
                </h1>
                <p className="body-3 max-w-[560px] text-slate-600 leading-relaxed">
                  Inspect raw CSV and Excel spreadsheets, fix broken dates, emails, phones, and duplicates deterministically, and export verified files right inside your browser.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <AppLink
                  to="/cleaner"
                  onNavigate={onNavigate}
                  className="glass-btn-primary button-sm inline-flex min-h-[44px] items-center gap-2 rounded-xl px-5 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0"
                >
                  <span>Try Free</span>
                  <ArrowRight size={16} weight="bold" aria-hidden="true" />
                </AppLink>
                <AppLink
                  to="/pricing"
                  onNavigate={onNavigate}
                  className="glass-btn-secondary button-sm inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0"
                >
                  <span>View Pricing</span>
                </AppLink>
              </div>

              <div className="flex items-start gap-2.5 caption-5 text-slate-600 max-w-[560px]">
                <ShieldCheck
                  size={16}
                  weight="fill"
                  className="mt-0.5 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                <span>
                  Files up to 5 MB run privately in browser memory · Zero AI model training on customer spreadsheets.
                </span>
              </div>
            </div>

            {/* Interactive Liquid Glass Workbench Showcase */}
            <div className="lg:col-span-6">
              <div className="glass-surface-elevated rounded-3xl p-2.5 sm:p-3">
                <div className="glass-table-wrap rounded-2xl p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="caption-3 text-slate-950">
                        Live Engine Workbench · messy_customers.csv
                      </p>
                      <p className="mt-0.5 caption-5 font-mono text-slate-600 tabular-nums">
                        Quality{' '}
                        <span className="text-slate-900 font-semibold">
                          {samplePreview.result.report.qualityBefore.score}
                        </span>{' '}
                        →{' '}
                        <span className="text-emerald-700 font-semibold">
                          {samplePreview.result.report.qualityAfter.score}/100
                        </span>{' '}
                        <span className="text-blue-700">(+{scoreDelta})</span> ·{' '}
                        {samplePreview.result.report.rowsBefore} →{' '}
                        {samplePreview.result.report.rowsAfter} rows
                      </p>
                    </div>

                    <div
                      className="glass-segmented inline-flex rounded-xl p-1"
                      role="tablist"
                      aria-label="Sample dataset view"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={previewMode === 'before'}
                        onClick={() => setPreviewMode('before')}
                        className={`button-xsm rounded-lg px-3 py-1.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap shrink-0 cursor-pointer ${
                          previewMode === 'before'
                            ? 'bg-white text-slate-950 shadow-sm'
                            : 'text-slate-600 hover:text-slate-950'
                        }`}
                      >
                        Raw input
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={previewMode === 'after'}
                        onClick={() => setPreviewMode('after')}
                        className={`button-xsm rounded-lg px-3 py-1.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap shrink-0 cursor-pointer ${
                          previewMode === 'after'
                            ? 'bg-white text-blue-800 shadow-sm'
                            : 'text-slate-600 hover:text-slate-950'
                        }`}
                      >
                        Cleaned output
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200/90 bg-white">
                    <table className="w-full border-collapse text-left font-mono caption-5">
                      <thead className="border-b border-slate-200 bg-slate-50/90 text-slate-700">
                        <tr>
                          {samplePreview.result.headers.slice(0, 4).map((h) => (
                            <th key={h} scope="col" className="px-3 py-2.5 font-semibold whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rowsToShow.map((row, idx) => (
                          <tr key={idx} className="hover:bg-blue-50/35 transition-colors">
                            {row.slice(0, 4).map((cell, cIdx) => {
                              const isMissing = cell === '';
                              const looksSuspicious =
                                previewMode === 'before' &&
                                (cell === 'invalid-email' || /^\s|\s$/.test(cell));
                              return (
                                <td
                                  key={cIdx}
                                  className={`max-w-[150px] truncate px-3 py-2.5 whitespace-nowrap ${
                                    looksSuspicious
                                      ? 'bg-rose-50/80 text-rose-800'
                                      : previewMode === 'after' && !isMissing
                                      ? 'text-slate-900'
                                      : 'text-slate-700'
                                  }`}
                                >
                                  {isMissing ? (
                                    <span className="text-slate-400 italic">empty</span>
                                  ) : (
                                    cell
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <p className="caption-5 text-slate-600">
                      {previewMode === 'after'
                        ? 'Blank rows removed, duplicates collapsed, emails normalized.'
                        : 'Raw fixture contains trailing spaces, blank line, and invalid tokens.'}
                    </p>
                    <AppLink
                      to="/cleaner"
                      onNavigate={onNavigate}
                      className="caption-3 inline-flex items-center gap-1 text-blue-700 transition-colors hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded whitespace-nowrap shrink-0"
                    >
                      <span>Inspect full report</span>
                      <ArrowRight size={13} weight="bold" aria-hidden="true" />
                    </AppLink>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Asymmetric Liquid Glass Bento Features */}
      <RevealSection aria-labelledby="benefits-heading" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl space-y-10 px-4 sm:px-6">
          <div className="max-w-[680px] space-y-3">
            <p className="caption-3 text-blue-700">Deterministic precision</p>
            <h2 id="benefits-heading" className="heading-3 text-slate-950">
              Stop repairing broken CSV files by hand
            </h2>
            <p className="body-3 text-slate-600">
              Silent date flips, hidden whitespace, duplicate customer rows, and unsafe formula strings stall CRM and billing imports. CleanData runs repeatable rules with full inspection first.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
            {/* Wide Bento Card 1 */}
            <article className="glass-surface glass-card-hover rounded-3xl p-6 sm:p-7 md:col-span-7 flex flex-col justify-between gap-6">
              <div className="space-y-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600/15 to-violet-600/15 border border-blue-200/70 text-blue-700">
                  <Copy size={22} weight="duotone" aria-hidden="true" />
                </div>
                <h3 className="title-2 text-slate-950">Cut duplicate contact cleanup</h3>
                <p className="body-6 text-slate-600 max-w-xl">
                  Remove identical rows or deduplicate across chosen key columns such as customer ID or email while keeping the first or most complete entry with a downloadable audit trail.
                </p>
              </div>
              <div className="glass-table-wrap rounded-xl px-3.5 py-2.5 font-mono text-[11px] text-slate-700 flex flex-wrap items-center justify-between gap-2">
                <span>key: customer_id · keep: most_complete</span>
                <span className="text-emerald-700 font-semibold">Deterministic merge log</span>
              </div>
            </article>

            {/* Compact Bento Card 2 */}
            <article className="glass-surface glass-card-hover rounded-3xl p-6 sm:p-7 md:col-span-5 flex flex-col justify-between gap-6">
              <div className="space-y-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600/15 to-cyan-500/15 border border-violet-200/70 text-violet-700">
                  <CalendarCheck size={22} weight="duotone" aria-hidden="true" />
                </div>
                <h3 className="title-2 text-slate-950">Stop silent date corruption</h3>
                <p className="body-6 text-slate-600">
                  Convert mixed text and numeric dates into ISO YYYY-MM-DD only after you confirm day-first or month-first order.
                </p>
              </div>
              <div className="glass-table-wrap rounded-xl px-3.5 py-2.5 font-mono text-[11px] flex items-center justify-between">
                <span className="text-rose-700">19/04/2025</span>
                <span className="text-slate-400">→</span>
                <span className="text-emerald-700 font-semibold">2025-04-19</span>
              </div>
            </article>

            {/* Compact Bento Card 3 */}
            <article className="glass-surface glass-card-hover rounded-3xl p-6 sm:p-7 md:col-span-5 flex flex-col justify-between gap-6">
              <div className="space-y-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/15 to-blue-600/15 border border-cyan-200/70 text-cyan-700">
                  <EnvelopeSimple size={22} weight="duotone" aria-hidden="true" />
                </div>
                <h3 className="title-2 text-slate-950">Validate emails &amp; regional phones</h3>
                <p className="body-6 text-slate-600">
                  Lowercase addresses, flag disposable or placeholder tokens, and normalize numbers to E.164 by chosen country code.
                </p>
              </div>
              <div className="glass-table-wrap rounded-xl px-3.5 py-2.5 font-mono text-[11px] flex items-center justify-between">
                <span className="text-slate-500">9876543210</span>
                <span className="text-slate-400">→</span>
                <span className="text-blue-700 font-semibold">+919876543210</span>
              </div>
            </article>

            {/* Wide Bento Card 4 */}
            <article className="glass-surface glass-card-hover rounded-3xl p-6 sm:p-7 md:col-span-7 flex flex-col justify-between gap-6">
              <div className="space-y-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/15 to-cyan-500/15 border border-emerald-200/70 text-emerald-700">
                  <ShieldCheck size={22} weight="duotone" aria-hidden="true" />
                </div>
                <h3 className="title-2 text-slate-950">Guard spreadsheets against formula injection</h3>
                <p className="body-6 text-slate-600 max-w-xl">
                  Neutralize dangerous leading triggers (<code className="font-mono text-xs">=</code>, <code className="font-mono text-xs">+</code>, <code className="font-mono text-xs">-</code>, <code className="font-mono text-xs">@</code>) by default while preserving valid <code className="font-mono text-xs">+91</code> phone numbers and numeric columns alongside a 4-factor quality score.
                </p>
              </div>
              <div className="glass-table-wrap rounded-xl px-3.5 py-2.5 font-mono text-[11px] text-slate-700 flex flex-wrap items-center justify-between gap-2">
                <span>=CMD(...) → &apos;=CMD(...)</span>
                <span className="text-emerald-700 font-semibold">+919876543210 untouched</span>
              </div>
            </article>
          </div>
        </div>
      </RevealSection>

      {/* 3. Editorial Tagline Reveal */}
      <section aria-label="Core promise" className="py-20 sm:py-24 px-4 sm:px-6">
        <TaglineReveal
          lines={[
            'Every column cleaned once,',
            'every report verified before export.',
          ]}
        />
      </section>

      {/* 4. How It Works (3 Liquid Glass Steps) */}
      <RevealSection aria-labelledby="workflow-heading" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl space-y-10 px-4 sm:px-6">
          <div className="max-w-[680px] space-y-3">
            <p className="caption-3 text-blue-700">How it works</p>
            <h2 id="workflow-heading" className="heading-3 text-slate-950">
              Three predictable steps from raw upload to clean output
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {HOW_IT_WORKS.map((item) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.step}
                  className="glass-surface glass-card-hover flex flex-col justify-between gap-6 rounded-3xl p-6"
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-mono caption-3 text-blue-700">Step {item.step}</span>
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-blue-200/70 bg-white/80 text-blue-700">
                        <Icon size={20} weight="duotone" aria-hidden="true" />
                      </div>
                    </div>
                    <h3 className="title-2 text-slate-950">{item.title}</h3>
                    <p className="body-6 text-slate-600">{item.description}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </RevealSection>

      {/* 5. Verifiable Engine Proof & Simple INR Plans */}
      <RevealSection aria-labelledby="proof-pricing-heading" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl space-y-10 px-4 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-[680px] space-y-3">
              <p className="caption-3 text-blue-700">Transparent plans</p>
              <h2 id="proof-pricing-heading" className="heading-3 text-slate-950">
                Start locally free, scale cleanly with credits
              </h2>
              <p className="body-6 text-slate-600">
                Measured on the included messy customer dataset: quality rises from{' '}
                <span className="font-mono font-semibold text-slate-950 tabular-nums">
                  {samplePreview.result.report.qualityBefore.score}
                </span>{' '}
                to{' '}
                <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                  {samplePreview.result.report.qualityAfter.score}
                </span>{' '}
                out of 100 in a single local pass.
              </p>
            </div>
            <AppLink
              to="/pricing"
              onNavigate={onNavigate}
              className="button-sm inline-flex items-center gap-1.5 text-blue-700 transition-colors hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded whitespace-nowrap shrink-0"
            >
              <span>Open full credit estimator</span>
              <ArrowRight size={14} weight="bold" aria-hidden="true" />
            </AppLink>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {SUBSCRIPTION_PLANS.map((plan) => (
              <article
                key={plan.id}
                className={`flex flex-col justify-between gap-6 rounded-3xl p-6 glass-card-hover ${
                  plan.highlighted ? 'glass-card-pro' : 'glass-surface'
                }`}
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <h3 className="title-2 text-slate-950">{plan.name}</h3>
                      <p className="caption-5 text-slate-600">{plan.audience}</p>
                    </div>
                    {plan.highlighted && (
                      <span className="inline-flex items-center rounded-md bg-gradient-to-r from-blue-600 to-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap shrink-0">
                        Recommended
                      </span>
                    )}
                  </div>

                  <p className="font-mono heading-5 text-slate-950 tabular-nums">
                    {formatInrFromPaise(plan.monthlyPricePaise)}
                    <span className="caption-5 font-sans text-slate-500"> / month</span>
                  </p>

                  <ul className="space-y-2 caption-4 text-slate-700">
                    {plan.features.slice(0, 3).map((feat) => (
                      <li key={feat} className="flex items-start gap-2">
                        <CheckCircle
                          size={16}
                          weight="fill"
                          className="mt-0.5 shrink-0 text-emerald-600"
                          aria-hidden="true"
                        />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <AppLink
                  to={plan.id === 'free' ? '/cleaner' : '/pricing'}
                  onNavigate={onNavigate}
                  className={`button-sm inline-flex min-h-[42px] items-center justify-center rounded-xl px-3.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap shrink-0 ${
                    plan.highlighted ? 'glass-btn-primary' : 'glass-btn-secondary'
                  }`}
                >
                  {plan.id === 'free' ? 'Try Free' : `Explore ${plan.name}`}
                </AppLink>
              </article>
            ))}
          </div>
        </div>
      </RevealSection>

      {/* 6. Objection Handling FAQ */}
      <RevealSection aria-labelledby="faq-heading" className="py-16 sm:py-20">
        <div className="mx-auto max-w-4xl space-y-8 px-4 sm:px-6">
          <div className="max-w-[680px] space-y-3">
            <p className="caption-3 text-blue-700">Frequently asked questions</p>
            <h2 id="faq-heading" className="heading-3 text-slate-950">
              Clear answers before you upload any file
            </h2>
          </div>

          <div className="space-y-3.5">
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <article
                  key={item.question}
                  className="glass-surface rounded-2xl p-4 sm:p-6 transition-all"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between gap-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-lg cursor-pointer"
                  >
                    <h3 className="title-3 text-slate-950">{item.question}</h3>
                    <CaretDown
                      size={18}
                      weight="bold"
                      aria-hidden="true"
                      className={`shrink-0 text-slate-600 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        isOpen ? 'rotate-180 text-blue-700' : 'rotate-0'
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="body-6 mt-3 text-slate-600 leading-relaxed">{item.answer}</p>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </RevealSection>

      {/* 7. Risk Reversal & Aurora Final CTA */}
      <RevealSection aria-labelledby="final-cta-heading" className="py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-blue-950 to-violet-950 p-8 sm:p-12 text-white shadow-2xl">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-violet-500/25 blur-3xl"
            />
            <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-[680px] space-y-4">
                <p className="caption-3 text-cyan-300">Zero risk verification</p>
                <h2 id="final-cta-heading" className="heading-2 text-white">
                  Verify your next spreadsheet before anything goes live
                </h2>
                <ul className="space-y-2 body-6 text-slate-200">
                  {RISK_REVERSALS.map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <CheckCircle
                        size={16}
                        weight="fill"
                        className="mt-0.5 shrink-0 text-emerald-400"
                        aria-hidden="true"
                      />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="shrink-0 flex flex-wrap gap-3">
                <AppLink
                  to="/cleaner"
                  onNavigate={onNavigate}
                  className="button-sm inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-slate-950 shadow-lg transition-all hover:bg-blue-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 whitespace-nowrap shrink-0"
                >
                  <span>Open Browser Cleaner</span>
                  <ArrowRight size={16} weight="bold" aria-hidden="true" />
                </AppLink>
              </div>
            </div>
          </div>
        </div>
      </RevealSection>
    </div>
  );
};
