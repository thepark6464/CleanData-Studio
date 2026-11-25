import React from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { MERCHANT_INFO } from '../config/merchant';
import { AppLink, type AppRoute } from '../lib/router';

interface AboutPageProps {
  onNavigate: (to: AppRoute) => void;
}

const CAPABILITIES = [
  {
    icon: FileSpreadsheet,
    title: 'Deterministic CSV & Excel Cleaning',
    description:
      'Parse, inspect, deduplicate, trim whitespace, standardize dates only with explicit day-first or month-first selection, and validate email and regional phone formats.',
  },
  {
    icon: ShieldCheck,
    title: 'Privacy-First Local Mode & Formula Guard',
    description:
      'Datasets up to 5 MB run directly in your browser with zero network upload. Exported CSV and XLSX files apply spreadsheet formula-injection protection by default.',
  },
  {
    icon: Database,
    title: 'Scalable Server API & Transparent Metering',
    description:
      'Larger spreadsheets and automated workflows run on the shared REST API with 1 credit per 1,000 rows (rounded up), upfront reservation, and automatic credit refunds on job failure.',
  },
];

export const AboutPage: React.FC<AboutPageProps> = ({ onNavigate }) => {
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="space-y-3">
        <p className="text-xs font-medium text-blue-800">About Us</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl [text-wrap:balance]">
          About {MERCHANT_INFO.brandName}
        </h1>
        <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
          {MERCHANT_INFO.brandName} is an independent software workbench and REST API built to help teams inspect, clean, validate, and safely export CSV and Excel datasets before importing them into CRMs, billing tools, or databases.
        </p>
      </header>

      <section
        aria-labelledby="about-operator-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5"
      >
        <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-blue-800">
            <UserCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2
              id="about-operator-heading"
              className="font-display text-lg font-semibold text-slate-950"
            >
              Ownership &amp; Operator Information
            </h2>
            <p className="text-sm leading-relaxed text-slate-600">
              {MERCHANT_INFO.brandName} (available at{' '}
              <a
                href={MERCHANT_INFO.websiteUrl}
                className="font-mono text-xs text-blue-800 underline underline-offset-2 hover:text-blue-950"
              >
                {MERCHANT_INFO.websiteUrl}
              </a>
              ) is owned and operated by{' '}
              <strong className="font-semibold text-slate-950">{MERCHANT_INFO.legalName}</strong>.
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-xs font-medium text-slate-500">Legal Name / Operator</dt>
            <dd className="text-sm font-semibold text-slate-950">{MERCHANT_INFO.legalName}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-medium text-slate-500">Official Website</dt>
            <dd className="text-sm font-mono text-slate-900 break-all">
              <a
                href={MERCHANT_INFO.websiteUrl}
                className="text-blue-800 hover:text-blue-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded"
              >
                {MERCHANT_INFO.websiteUrl}
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="about-what-we-do-heading" className="space-y-4">
        <h2
          id="about-what-we-do-heading"
          className="font-display text-xl font-semibold text-slate-950"
        >
          What {MERCHANT_INFO.brandName} Provides
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {CAPABILITIES.map((item) => {
            const Icon = item.icon;
            return (
              <article
                key={item.title}
                className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
              >
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-900">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <h3 className="font-display text-sm font-semibold text-slate-950">{item.title}</h3>
                <p className="text-xs leading-relaxed text-slate-600">{item.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section
        aria-labelledby="about-standards-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-4"
      >
        <h2
          id="about-standards-heading"
          className="font-display text-lg font-semibold text-slate-950"
        >
          Our Operating Commitments
        </h2>
        <ul className="space-y-2.5 text-sm text-slate-700">
          <li className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
            <span>
              <strong>Transparent pricing in INR:</strong> Clear free browser tier, monthly recurring plans (Starter, Pro, Business), and 12-month one-time credit packs processed via Cashfree Payments.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
            <span>
              <strong>Zero AI model training on customer files:</strong> Every transformation is deterministic and rule-based, with before-and-after quality scoring so nothing is silently altered.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
            <span>
              <strong>Clear billing &amp; policy controls:</strong> Self-service subscription cancellation, server-side payment reconciliation, and transparent privacy and refund policies.
            </span>
          </li>
        </ul>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
          <AppLink
            to="/contact"
            onNavigate={onNavigate}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            <span>Contact &amp; Support</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </AppLink>
          <AppLink
            to="/pricing"
            onNavigate={onNavigate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            <span>View Pricing</span>
          </AppLink>
          <AppLink
            to="/refund-policy"
            onNavigate={onNavigate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            <span>Refund &amp; Cancellation Policy</span>
          </AppLink>
        </div>
      </section>
    </div>
  );
};
