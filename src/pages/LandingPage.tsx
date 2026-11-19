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

const BENEFITS = [
  {
    icon: Copy,
    title: 'Cut duplicate contact cleanup',
    summary:
      'Remove identical rows or deduplicate across chosen key columns such as email while keeping the first or last entry.',
  },
  {
    icon: CalendarCheck,
    title: 'Stop silent date corruption',
    summary:
      'Convert mixed text and numeric dates into standard ISO format only after you confirm day first or month first order.',
  },
  {
    icon: EnvelopeSimple,
    title: 'Validate emails and regional phones',
    summary:
      'Lowercase addresses, check RFC syntax, and format numbers by chosen country code before any CRM or billing import.',
  },
  {
    icon: ShieldCheck,
    title: 'Guard spreadsheets against formula risks',
    summary:
      'Neutralize leading equals, plus, minus, and at triggers by default alongside a transparent four factor quality score.',
  },
];

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
      'Save formula guarded CSV or Excel files locally or run the identical rule engine on larger files through REST API jobs.',
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
      'Ambiguous numeric dates are never guessed silently. You choose day first or month first explicitly before date standardization executes.',
  },
  {
    question: 'What protects exports from spreadsheet formula injection?',
    answer:
      'Formula protection stays active by default and escapes leading equals, plus, minus, at, tab, and carriage return characters across CSV and XLSX outputs.',
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

  return (
    <div className="bg-white">
      {/* 1. Above the fold Hero */}
      <section
        aria-labelledby="hero-heading"
        className="relative overflow-hidden bg-white pt-12 pb-16 sm:pt-16 sm:pb-24"
      >
        <DataCleaningBackground />
        <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="flex flex-col items-start gap-6 lg:col-span-6">
              <div className="space-y-4">
                <p className="caption-3 text-blue-800">CleanData Studio</p>
                <h1 id="hero-heading" className="heading-1 hero-heading-gradient max-w-[680px]">
                  Clean messy sheets
                  <br />
                  before imports break
                </h1>
                <p className="body-3 max-w-[680px] text-slate-600">
                  Inspect raw CSV and Excel files, resolve ambiguous dates explicitly, remove duplicate contacts, and export verified output straight in your browser.
                </p>
              </div>

              {/* Single clear primary CTA above the fold (A4) */}
              <AppLink
                to="/cleaner"
                onNavigate={onNavigate}
                className="button-md inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-white transition-[background-color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-slate-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 whitespace-nowrap shrink-0"
              >
                <span>Open browser cleaner</span>
                <ArrowRight size={16} weight="bold" aria-hidden="true" />
              </AppLink>

              {/* Proof signal right beside CTA */}
              <div className="flex items-start gap-2 caption-5 text-slate-600 max-w-[680px]">
                <ShieldCheck
                  size={16}
                  weight="fill"
                  className="mt-0.5 shrink-0 text-emerald-700"
                  aria-hidden="true"
                />
                <span>
                  CSV and Excel files up to 5 MB stay in your browser with zero AI model training on customer data.
                </span>
              </div>
            </div>

            {/* Live deterministic workbench sample preview (nested radius: 16px outer - 8px padding = 8px inner) */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2 lg:col-span-6">
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="caption-3 text-slate-950">
                      Live engine sample: messy_customers.csv
                    </p>
                    <p className="caption-5 font-mono text-slate-600 tabular-nums">
                      Score {samplePreview.result.report.qualityBefore.score} to{' '}
                      {samplePreview.result.report.qualityAfter.score} / 100 ·{' '}
                      {samplePreview.result.report.rowsBefore} to{' '}
                      {samplePreview.result.report.rowsAfter} rows
                    </p>
                  </div>

                  <div
                    className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1"
                    role="tablist"
                    aria-label="Sample dataset view"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={previewMode === 'before'}
                      onClick={() => setPreviewMode('before')}
                      className={`button-xsm rounded px-2 py-1 transition-[background-color,color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 whitespace-nowrap shrink-0 cursor-pointer ${
                        previewMode === 'before'
                          ? 'bg-white text-slate-950'
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
                      className={`button-xsm rounded px-2 py-1 transition-[background-color,color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 whitespace-nowrap shrink-0 cursor-pointer ${
                        previewMode === 'after'
                          ? 'bg-white text-slate-950'
                          : 'text-slate-600 hover:text-slate-950'
                      }`}
                    >
                      Cleaned output
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full border-collapse text-left font-mono caption-5">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
                      <tr>
                        {samplePreview.result.headers.slice(0, 4).map((h) => (
                          <th key={h} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rowsToShow.map((row, idx) => (
                        <tr key={idx}>
                          {row.slice(0, 4).map((cell, cIdx) => (
                            <td
                              key={cIdx}
                              className="max-w-[140px] truncate px-3 py-2 text-slate-800 whitespace-nowrap"
                            >
                              {cell === '' ? (
                                <span className="text-slate-400">empty</span>
                              ) : (
                                cell
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="caption-5 text-slate-600">
                    {previewMode === 'after'
                      ? 'Blank rows removed, duplicates collapsed, emails normalized.'
                      : 'Raw fixture contains trailing spaces, blank line, and mixed dates.'}
                  </p>
                  <AppLink
                    to="/cleaner"
                    onNavigate={onNavigate}
                    className="caption-3 text-blue-700 transition-colors duration-300 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded whitespace-nowrap shrink-0"
                  >
                    Inspect full report
                  </AppLink>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Problem to Solution & Benefits */}
      <RevealSection aria-labelledby="benefits-heading" className="bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl space-y-12 px-4 sm:px-6">
          <div className="max-w-[680px] space-y-3">
            <p className="caption-3 text-blue-800">Problem to solution</p>
            <h2 id="benefits-heading" className="heading-3 text-slate-950">
              Stop repairing broken CSV files by hand
            </h2>
            <p className="body-3 text-slate-600">
              Silent date flips, hidden whitespace, duplicate customer rows, and unsafe formula strings stall CRM and accounting uploads. CleanData applies repeatable rules with clear inspection first.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {BENEFITS.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <article
                  key={benefit.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4"
                >
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-900">
                    <Icon size={20} weight="duotone" aria-hidden="true" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="title-2 text-slate-950">{benefit.title}</h3>
                    <p className="body-6 text-slate-600">{benefit.summary}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </RevealSection>

      {/* 3. Mandatory Tagline Reveal Section (B11) */}
      <section aria-label="Core promise" className="bg-white py-20 sm:py-24 px-4 sm:px-6">
        <TaglineReveal
          lines={[
            'Every column cleaned once,',
            'every report verified before export.',
          ]}
        />
      </section>

      {/* 4. How It Works (3 steps) */}
      <RevealSection aria-labelledby="workflow-heading" className="bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl space-y-12 px-4 sm:px-6">
          <div className="max-w-[680px] space-y-3">
            <p className="caption-3 text-blue-800">How it works</p>
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
                  className="flex flex-col justify-between gap-6 rounded-2xl border border-slate-200 bg-white p-6"
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-mono caption-3 text-slate-500">Step {item.step}</span>
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-900">
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
      <RevealSection aria-labelledby="proof-pricing-heading" className="bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-6xl space-y-12 px-4 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-[680px] space-y-3">
              <p className="caption-3 text-blue-800">Transparent plans</p>
              <h2 id="proof-pricing-heading" className="heading-3 text-slate-950">
                Start locally free, scale cleanly with credits
              </h2>
              <p className="body-6 text-slate-600">
                Measured on the included messy customer dataset: quality rises from{' '}
                <span className="font-mono text-slate-950 tabular-nums">
                  {samplePreview.result.report.qualityBefore.score}
                </span>{' '}
                to{' '}
                <span className="font-mono text-slate-950 tabular-nums">
                  {samplePreview.result.report.qualityAfter.score}
                </span>{' '}
                out of 100 in a single local pass.
              </p>
            </div>
            <AppLink
              to="/pricing"
              onNavigate={onNavigate}
              className="button-sm text-blue-700 transition-colors duration-300 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded whitespace-nowrap shrink-0"
            >
              Open full credit estimator
            </AppLink>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {SUBSCRIPTION_PLANS.map((plan) => (
              <article
                key={plan.id}
                className={`flex flex-col justify-between gap-6 rounded-2xl border bg-white p-6 ${
                  plan.highlighted ? 'border-blue-700' : 'border-slate-200'
                }`}
              >
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h3 className="title-2 text-slate-950">{plan.name}</h3>
                    <p className="caption-5 text-slate-600">{plan.audience}</p>
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
                          className="mt-0.5 shrink-0 text-emerald-700"
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
                  className={`button-sm inline-flex items-center justify-center rounded-lg px-3 py-2 transition-[background-color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 whitespace-nowrap shrink-0 ${
                    plan.highlighted
                      ? 'bg-slate-950 text-white hover:bg-slate-800'
                      : 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {plan.id === 'free' ? 'Open browser cleaner' : `Explore ${plan.name}`}
                </AppLink>
              </article>
            ))}
          </div>
        </div>
      </RevealSection>

      {/* 6. Objection Handling FAQ (AEO) */}
      <RevealSection aria-labelledby="faq-heading" className="bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-4xl space-y-8 px-4 sm:px-6">
          <div className="max-w-[680px] space-y-3">
            <p className="caption-3 text-blue-800">Frequently asked questions</p>
            <h2 id="faq-heading" className="heading-3 text-slate-950">
              Clear answers before you upload any file
            </h2>
          </div>

          <div className="space-y-4">
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <article
                  key={item.question}
                  className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between gap-4 text-left transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded cursor-pointer"
                  >
                    <h3 className="title-3 text-slate-950">{item.question}</h3>
                    <CaretDown
                      size={18}
                      weight="bold"
                      aria-hidden="true"
                      className={`shrink-0 text-slate-600 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        isOpen ? 'rotate-180' : 'rotate-0'
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="body-6 mt-3 text-slate-600">{item.answer}</p>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </RevealSection>

      {/* 7. Risk Reversal & Final CTA */}
      <RevealSection aria-labelledby="final-cta-heading" className="bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="rounded-3xl bg-[#181818] p-8 sm:p-12 text-white">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-[680px] space-y-4">
                <p className="caption-3 text-blue-400">Zero risk verification</p>
                <h2 id="final-cta-heading" className="heading-2 text-white">
                  Verify your next spreadsheet before anything goes live
                </h2>
                <ul className="space-y-2 body-6 text-slate-300">
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

              <div className="shrink-0">
                <AppLink
                  to="/cleaner"
                  onNavigate={onNavigate}
                  className="button-md inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-slate-950 transition-[background-color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-slate-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#181818] whitespace-nowrap shrink-0"
                >
                  <span>Open browser cleaner</span>
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
