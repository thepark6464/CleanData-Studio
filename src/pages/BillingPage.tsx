import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  CREDIT_PACKS,
  formatInrFromPaise,
  PURCHASED_CREDIT_EXPIRY_MONTHS,
  ROWS_PER_CREDIT,
  SUBSCRIPTION_PLANS,
} from '../config/pricing';
import { CleanDataApiClient, CleanDataApiError, getApiBaseUrl } from '../lib/api/client';
import type { CheckoutCreateResponse } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthContext';
import type { AppRoute } from '../lib/router';
import { setIntendedRoute } from '../lib/router';

interface BillingPageProps {
  onNavigate: (to: AppRoute) => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export const BillingPage: React.FC<BillingPageProps> = ({ onNavigate }) => {
  const {
    isConfigured,
    isLoading,
    session,
    user,
    wallet,
    activePlan,
    transactions,
    payments,
    isDataLoading,
    refreshAccountData,
  } = useAuth();

  const [checkoutBusyItem, setCheckoutBusyItem] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutOrder, setCheckoutOrder] = useState<CheckoutCreateResponse | null>(null);

  useEffect(() => {
    if (isConfigured && !isLoading && !user) {
      setIntendedRoute('/dashboard/billing');
      onNavigate('/auth');
    }
  }, [isConfigured, isLoading, user, onNavigate]);

  const apiBase = getApiBaseUrl();

  const handleCheckout = async (kind: 'subscription' | 'credit_pack', itemName: string) => {
    setCheckoutError(null);
    setCheckoutOrder(null);

    if (!apiBase) {
      setCheckoutError(
        'FastAPI backend URL (VITE_API_BASE_URL) is not configured. Start the FastAPI service with payment keys to initialize server-verified checkout orders.',
      );
      return;
    }
    if (!session?.access_token) {
      setCheckoutError('Sign in again to authorize checkout.');
      return;
    }

    setCheckoutBusyItem(`${kind}:${itemName}`);
    try {
      const client = new CleanDataApiClient(apiBase, session.access_token);
      const order = await client.createCheckout({ kind, item_name: itemName });
      setCheckoutOrder(order);
      await refreshAccountData();
    } catch (err) {
      if (err instanceof CleanDataApiError) {
        setCheckoutError(`${err.code}: ${err.message}`);
      } else {
        setCheckoutError('Could not connect to FastAPI billing endpoint.');
      }
    } finally {
      setCheckoutBusyItem(null);
    }
  };

  if (!isConfigured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
          <h1 className="font-display text-xl font-bold text-slate-950">
            Billing Unavailable Without Supabase Auth
          </h1>
          <p className="text-sm text-slate-600">
            Configure <code className="font-mono text-xs">VITE_SUPABASE_URL</code> and{' '}
            <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> to manage plans,
            credits, and checkout orders.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !user) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 space-y-6">
        <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-200" />
      </div>
    );
  }

  const subBalance = wallet?.subscription_balance ?? 0;
  const purBalance = wallet?.purchased_balance ?? 0;
  const paidPlans = SUBSCRIPTION_PLANS.filter((p) => p.monthlyPricePaise > 0);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Credits &amp; Billing
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            1 credit = up to {ROWS_PER_CREDIT.toLocaleString()} server rows. Subscription credits are
            spent before purchased credits.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void refreshAccountData()}
            disabled={isDataLoading}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isDataLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh Ledger</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/dashboard')}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to Dashboard</span>
          </button>
        </div>
      </div>

      {/* Split Credit Wallet Summary */}
      <section aria-label="Wallet balances" className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <p className="text-xs font-medium text-slate-500">Active Subscription</p>
          <p className="font-display text-2xl font-bold text-slate-950">
            {activePlan?.name ?? 'Free'}
          </p>
          <p className="font-mono text-xs text-slate-600 tabular-nums">
            {formatInrFromPaise(activePlan?.monthly_price ?? 0)}/mo ·{' '}
            {activePlan?.monthly_credits ?? 0} monthly credits
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <p className="text-xs font-medium text-slate-500">Subscription Credits (Spent First)</p>
          <p className="font-mono text-2xl font-bold text-slate-950 tabular-nums">
            {subBalance.toLocaleString()}
          </p>
          <p className="font-mono text-xs text-slate-600 tabular-nums">
            Expires: {wallet?.subscription_expires_at ? formatDate(wallet.subscription_expires_at) : 'Monthly cycle'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <p className="text-xs font-medium text-slate-500">Purchased Pack Credits</p>
          <p className="font-mono text-2xl font-bold text-slate-950 tabular-nums">
            {purBalance.toLocaleString()}
          </p>
          <p className="font-mono text-xs text-slate-600 tabular-nums">
            Valid {PURCHASED_CREDIT_EXPIRY_MONTHS} months ·{' '}
            {wallet?.purchased_expires_at ? formatDate(wallet.purchased_expires_at) : 'No active packs'}
          </p>
        </div>
      </section>

      {checkoutError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
          <span>{checkoutError}</span>
        </div>
      )}

      {checkoutOrder && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950 space-y-1.5">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            <span>
              Checkout Order Initialized ({checkoutOrder.item_name} —{' '}
              {formatInrFromPaise(checkoutOrder.amount_paise)})
            </span>
          </div>
          <p className="font-mono text-[11px] text-emerald-900">
            Provider: {checkoutOrder.provider} · Order ID: {checkoutOrder.order_id} · Payment ID:{' '}
            {checkoutOrder.payment_id}
          </p>
          <p>{checkoutOrder.message}</p>
        </div>
      )}

      {/* Paid Subscriptions */}
      <section aria-labelledby="billing-plans-heading" className="space-y-4">
        <h2 id="billing-plans-heading" className="font-display text-lg font-semibold text-slate-950">
          Upgrade Monthly Plan
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {paidPlans.map((plan) => {
            const isCurrent = activePlan?.name === plan.name;
            const busy = checkoutBusyItem === `subscription:${plan.name}`;
            return (
              <div
                key={plan.id}
                className={`flex flex-col justify-between rounded-xl border bg-white p-5 ${
                  plan.highlighted ? 'border-blue-700' : 'border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-display text-base font-semibold text-slate-950">
                      {plan.name}
                    </h3>
                    <span className="font-mono text-lg font-bold tabular-nums text-slate-950">
                      {formatInrFromPaise(plan.monthlyPricePaise)}/mo
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{plan.audience}</p>
                  <p className="mt-3 font-mono text-xs text-slate-700 tabular-nums">
                    {plan.monthlyCredits?.toLocaleString()} credits/mo · {plan.maxFileSizeMb} MB max ·{' '}
                    {plan.apiAccess ? `${plan.apiRateLimitPerMin} API req/min` : 'Studio only'}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={busy || isCurrent}
                  onClick={() => void handleCheckout('subscription', plan.name)}
                  className={`mt-5 inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                    isCurrent
                      ? 'border border-slate-200 bg-slate-50 text-slate-600 cursor-default'
                      : 'bg-blue-700 text-white hover:bg-blue-800'
                  }`}
                >
                  <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {isCurrent
                      ? 'Current Active Plan'
                      : busy
                      ? 'Creating Order...'
                      : `Subscribe (${formatInrFromPaise(plan.monthlyPricePaise)})`}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* One-Time Credit Packs */}
      <section aria-labelledby="billing-packs-heading" className="space-y-4">
        <div className="flex flex-col gap-1">
          <h2 id="billing-packs-heading" className="font-display text-lg font-semibold text-slate-950">
            Buy One-Time Credit Packs
          </h2>
          <p className="text-xs text-slate-600">
            Credits expire {PURCHASED_CREDIT_EXPIRY_MONTHS} months after purchase. Failed server jobs
            are automatically refunded.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CREDIT_PACKS.map((pack) => {
            const busy = checkoutBusyItem === `credit_pack:${pack.name}`;
            return (
              <div
                key={pack.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
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
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleCheckout('credit_pack', pack.name)}
                  className="mt-4 inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                >
                  <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{busy ? 'Creating Order...' : `Buy ${pack.credits} Credits`}</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Credit Ledger */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-display text-base font-semibold text-slate-950">
            Credit Ledger
          </h2>
          <p className="text-xs text-slate-600">
            Immutable audit log of credit grants, reservations, commits, automatic failure refunds,
            and expirations.
          </p>
        </div>

        {transactions.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-slate-500">
            No credit ledger transactions recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium text-right">Credits</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono text-slate-900">{tx.transaction_type}</td>
                    <td className="px-4 py-3 capitalize text-slate-700">{tx.credit_source}</td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${
                        tx.amount > 0
                          ? 'text-emerald-700'
                          : tx.amount < 0
                          ? 'text-slate-900'
                          : 'text-slate-500'
                      }`}
                    >
                      {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">
                      {tx.reference_id || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                      {formatDate(tx.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Payment Records */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-950">Payment History</h2>
            <p className="text-xs text-slate-600">
              All amounts are stored in INR paise and confirmed exclusively via HMAC-signed webhooks.
            </p>
          </div>
          <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
        </div>

        {payments.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-slate-500">
            No payment orders created yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-mono text-slate-900">{p.kind || 'payment'}</td>
                    <td className="px-4 py-3 text-slate-700">{p.provider || 'razorpay'}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                      {formatInrFromPaise(p.amount)}
                    </td>
                    <td
                      className={`px-4 py-3 font-medium capitalize ${
                        p.status === 'paid'
                          ? 'text-emerald-700'
                          : p.status === 'failed'
                          ? 'text-red-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {p.status}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                      {formatDate(p.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
