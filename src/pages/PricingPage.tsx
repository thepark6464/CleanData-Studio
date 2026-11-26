import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import {
  CREDIT_PACKS,
  estimateCreditsForRows,
  formatInrFromPaise,
  ILLUSTRATIVE_REVENUE_PROJECTIONS,
  PURCHASED_CREDIT_EXPIRY_MONTHS,
  ROWS_PER_CREDIT,
  SUBSCRIPTION_PLANS,
} from '../config/pricing';
import { useAuth } from '../lib/auth/AuthContext';
import { AppLink, type AppRoute } from '../lib/router';

interface PricingPageProps {
  onNavigate: (to: AppRoute) => void;
}

export const PricingPage: React.FC<PricingPageProps> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [sampleRows, setSampleRows] = useState<number>(5000);
  const estimatedCredits = estimateCreditsForRows(sampleRows);
  const billingOrAuthRoute: AppRoute = user ? '/dashboard/billing' : '/auth';

  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6 sm:py-14">
      <div className="max-w-2xl space-y-3">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
          <Sparkles className="h-3.5 w-3.5 text-violet-600" aria-hidden="true" />
          <span>Transparent INR Pricing</span>
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight hero-heading-gradient sm:text-4xl [text-wrap:balance]">
          Predictable plans and pay-as-you-go credit packs
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed sm:text-base">
          Browser cleaning for files up to 5 MB is free with no registration. Server-side processing and API jobs consume 1 credit per {ROWS_PER_CREDIT.toLocaleString()} rows (rounded up), reserved at job creation and fully refunded if a job fails.
        </p>
      </div>

      {/* Interactive Credit Estimator */}
      <section
        aria-labelledby="credit-calc-heading"
        className="glass-surface-elevated rounded-3xl p-5 sm:p-7"
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2 md:max-w-md">
            <h2
              id="credit-calc-heading"
              className="font-display text-base font-semibold text-slate-950"
            >
              Row-to-Credit Estimator
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              1 credit = up to 1,000 rows (<code className="font-mono">ceil(rows / 1000)</code>). Estimate server credit consumption before submitting a file.
            </p>
          </div>

          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <label className="flex flex-col gap-1.5 text-xs">
              <span className="font-medium text-slate-700">Dataset rows</span>
              <input
                type="number"
                min={1}
                max={2000000}
                step={500}
                value={sampleRows}
                onChange={(e) => setSampleRows(Math.max(0, Number(e.target.value) || 0))}
                className="glass-input w-44 rounded-xl px-3.5 py-2.5 font-mono text-sm tabular-nums"
              />
            </label>

            <div className="glass-table-wrap rounded-2xl px-5 py-3 text-right">
              <p className="text-[11px] font-medium text-slate-500">Estimated Server Cost</p>
              <p className="font-mono text-2xl font-bold tabular-nums text-blue-700">
                {estimatedCredits.toLocaleString()} credit{estimatedCredits === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Subscription Plans */}
      <section aria-labelledby="plans-heading" className="space-y-5">
        <h2 id="plans-heading" className="font-display text-xl font-bold text-slate-950">
          Monthly Subscription Plans
        </h2>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SUBSCRIPTION_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`flex flex-col justify-between rounded-3xl p-6 glass-card-hover ${
                plan.highlighted ? 'glass-card-pro' : 'glass-surface'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-lg font-semibold text-slate-950">
                    {plan.name}
                  </h3>
                  {plan.highlighted && (
                    <span className="inline-flex items-center rounded-md bg-gradient-to-r from-blue-600 to-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap shrink-0">
                      Most Popular
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-600">{plan.audience}</p>
                <p className="mt-5 font-mono text-3xl font-bold tabular-nums text-slate-950">
                  {formatInrFromPaise(plan.monthlyPricePaise)}
                  <span className="text-xs font-sans font-normal text-slate-500"> / month</span>
                </p>

                <ul className="mt-5 space-y-2.5 text-xs text-slate-700">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2">
                      <CheckCircle2
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                        aria-hidden="true"
                      />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6">
                <AppLink
                  to={plan.id === 'free' ? '/cleaner' : billingOrAuthRoute}
                  onNavigate={onNavigate}
                  className={`inline-flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 ${
                    plan.highlighted ? 'glass-btn-primary' : 'glass-btn-secondary'
                  }`}
                >
                  <span>
                    {plan.id === 'free'
                      ? 'Use Browser Cleaner Now'
                      : user
                      ? `Choose ${plan.name} in Billing`
                      : `Sign In to Choose ${plan.name}`}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </AppLink>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Concrete Comparison Matrix */}
      <section aria-labelledby="matrix-heading" className="space-y-4">
        <h2 id="matrix-heading" className="font-display text-xl font-bold text-slate-950">
          Plan Limits Matrix
        </h2>

        <div className="glass-surface rounded-3xl p-2">
          <div className="glass-table-wrap overflow-x-auto rounded-2xl">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/90 text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3.5 font-semibold">Limit / Capability</th>
                  {SUBSCRIPTION_PLANS.map((plan) => (
                    <th key={plan.id} scope="col" className="px-4 py-3.5 font-semibold whitespace-nowrap">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <th scope="row" className="px-4 py-3 font-medium text-slate-800">Monthly Price</th>
                  {SUBSCRIPTION_PLANS.map((plan) => (
                    <td key={plan.id} className="px-4 py-3 font-mono tabular-nums text-slate-900">
                      {formatInrFromPaise(plan.monthlyPricePaise)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-3 font-medium text-slate-800">Monthly Credits</th>
                  {SUBSCRIPTION_PLANS.map((plan) => (
                    <td key={plan.id} className="px-4 py-3 font-mono tabular-nums text-slate-900">
                      {plan.monthlyCredits !== null ? `${plan.monthlyCredits.toLocaleString()} / mo` : '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-3 font-medium text-slate-800">Server Job Limit</th>
                  {SUBSCRIPTION_PLANS.map((plan) => (
                    <td key={plan.id} className="px-4 py-3 font-mono tabular-nums text-slate-900">
                      {plan.dailyJobLimit !== null ? `${plan.dailyJobLimit} / day` : 'Credit-based'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-3 font-medium text-slate-800">Max File Size</th>
                  {SUBSCRIPTION_PLANS.map((plan) => (
                    <td key={plan.id} className="px-4 py-3 font-mono tabular-nums text-slate-900">
                      {plan.maxFileSizeMb} MB
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-3 font-medium text-slate-800">REST API Access</th>
                  {SUBSCRIPTION_PLANS.map((plan) => (
                    <td key={plan.id} className="px-4 py-3 font-mono tabular-nums text-slate-900">
                      {plan.apiAccess ? `${plan.apiRateLimitPerMin} req/min` : 'Not included'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-3 font-medium text-slate-800">Export Formats</th>
                  {SUBSCRIPTION_PLANS.map((plan) => (
                    <td key={plan.id} className="px-4 py-3 text-slate-700">
                      {plan.exports}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* One-Time Credit Packs */}
      <section aria-labelledby="packs-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="packs-heading" className="font-display text-xl font-bold text-slate-950">
            One-Time Credit Packs
          </h2>
          <p className="text-xs text-slate-600">
            Purchased credits remain valid for {PURCHASED_CREDIT_EXPIRY_MONTHS} months and are spent only after monthly subscription credits are used.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CREDIT_PACKS.map((pack) => (
            <div
              key={pack.id}
              className="glass-surface glass-card-hover flex flex-col justify-between rounded-3xl p-5"
            >
              <div>
                <h3 className="font-display text-base font-semibold text-slate-950">
                  {pack.name}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Up to {pack.maxRowsEquivalent.toLocaleString()} rows
                </p>
                <p className="mt-3 font-mono text-2xl font-bold tabular-nums text-slate-950">
                  {formatInrFromPaise(pack.pricePaise)}
                </p>
                <p className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                  ₹{(pack.pricePaise / 100 / pack.credits).toFixed(2)} / credit
                </p>
              </div>
              <AppLink
                to={billingOrAuthRoute}
                onNavigate={onNavigate}
                className="glass-btn-secondary mt-4 inline-flex min-h-[40px] w-full items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0"
              >
                {user ? `Buy ${pack.credits} Credits` : 'Sign In to Buy'}
              </AppLink>
            </div>
          ))}
        </div>
      </section>

      {/* Policy & Illustrative Revenue Footnote */}
      <section className="glass-surface-subtle rounded-3xl p-6 text-xs text-slate-600 space-y-2.5">
        <p>
          <strong className="font-semibold text-slate-900">Credit &amp; Expiry Policy:</strong>{' '}
          Subscription credits reset monthly and expire at the end of each billing cycle. Purchased credit packs expire after {PURCHASED_CREDIT_EXPIRY_MONTHS} months. Server credits are reserved on job creation, committed only upon completion, and automatically refunded if processing fails.
        </p>
        <p>
          <strong className="font-semibold text-slate-900">
            Illustrative Revenue Benchmarks (not profit guarantees, assuming ₹499 average monthly revenue):
          </strong>{' '}
          {ILLUSTRATIVE_REVENUE_PROJECTIONS.map(
            (p) => `${p.customers.toLocaleString()} customers = ${formatInrFromPaise(p.monthlyRevenuePaise)}`,
          ).join(' · ')}
          .
        </p>
        <p className="pt-2 border-t border-slate-200/70 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-medium text-slate-800">Policies &amp; Support:</span>
          <AppLink to="/refund-policy" onNavigate={onNavigate} className="text-blue-700 hover:underline">
            Refund &amp; Cancellation Policy
          </AppLink>
          <AppLink to="/terms" onNavigate={onNavigate} className="text-blue-700 hover:underline">
            Terms &amp; Conditions
          </AppLink>
          <AppLink to="/privacy" onNavigate={onNavigate} className="text-blue-700 hover:underline">
            Privacy Policy
          </AppLink>
          <AppLink to="/contact" onNavigate={onNavigate} className="text-blue-700 hover:underline">
            Contact Us
          </AppLink>
        </p>
      </section>
    </div>
  );
};
