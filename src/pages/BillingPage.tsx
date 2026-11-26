import React, { useCallback, useEffect, useRef, useState } from 'react';
import { load as loadCashfree } from '@cashfreepayments/cashfree-js';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  CREDIT_PACKS,
  formatInrFromPaise,
  PURCHASED_CREDIT_EXPIRY_MONTHS,
  ROWS_PER_CREDIT,
  SUBSCRIPTION_PLANS,
} from '../config/pricing';
import { DashboardShell } from '../components/DashboardShell';
import { CleanDataApiClient, CleanDataApiError, getApiBaseUrl } from '../lib/api/client';
import type { CheckoutVerifyResponse } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthContext';
import { resolveBillingDisplayState } from '../lib/billing/displayState';
import { MERCHANT_INFO } from '../config/merchant';
import { AppLink, setIntendedRoute, type AppRoute } from '../lib/router';

interface BillingPageProps {
  onNavigate: (to: AppRoute) => void;
}

interface PendingCashfreeCheckout {
  kind: 'credit_pack' | 'subscription';
  order_id?: string | null;
  subscription_id?: string | null;
  item_name: string;
  created_at: number;
}

const PENDING_CHECKOUT_STORAGE_KEY = 'cleandata_pending_cashfree_checkout';
const PENDING_CHECKOUT_TTL_MS = 2 * 60 * 60 * 1000;

function readPendingCheckout(): PendingCashfreeCheckout | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingCashfreeCheckout>;
    if (
      !parsed ||
      (parsed.kind !== 'credit_pack' && parsed.kind !== 'subscription') ||
      typeof parsed.created_at !== 'number' ||
      Date.now() - parsed.created_at > PENDING_CHECKOUT_TTL_MS
    ) {
      window.sessionStorage.removeItem(PENDING_CHECKOUT_STORAGE_KEY);
      return null;
    }
    return parsed as PendingCashfreeCheckout;
  } catch {
    return null;
  }
}

function savePendingCheckout(pending: PendingCashfreeCheckout): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PENDING_CHECKOUT_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Ignore storage errors in restricted browser contexts
  }
}

function clearPendingCheckout(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_CHECKOUT_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function maskRefId(ref: string | null | undefined): string {
  if (!ref) return '—';
  if (ref.length <= 18) return ref;
  return `${ref.slice(0, 10)}…${ref.slice(-6)}`;
}

function parseReturnTargetFromSearch(search: string): {
  target: {
    kind: 'credit_pack' | 'subscription';
    order_id?: string;
    subscription_id?: string;
  } | null;
  hasReturnParams: boolean;
} {
  const params = new URLSearchParams(search);
  const cleanUrlParam = (value: string | null): string | undefined => {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return undefined;
    return trimmed;
  };

  const orderId = cleanUrlParam(params.get('order_id') || params.get('orderId'));
  const subscriptionId = cleanUrlParam(
    params.get('subscription_id') || params.get('sub_id') || params.get('cf_subscriptionId'),
  );
  const kindParam = cleanUrlParam(params.get('kind'));
  const hasReturnParams =
    params.has('order_id') ||
    params.has('orderId') ||
    params.has('subscription_id') ||
    params.has('sub_id') ||
    params.has('cf_subscriptionId') ||
    params.has('kind');

  if (!orderId && !subscriptionId) {
    return { target: null, hasReturnParams };
  }

  const kind: 'credit_pack' | 'subscription' =
    kindParam === 'subscription' || Boolean(subscriptionId) ? 'subscription' : 'credit_pack';
  return {
    target: {
      kind,
      order_id: orderId,
      subscription_id: subscriptionId,
    },
    hasReturnParams,
  };
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
    billingError,
    billingErrorDetail,
    billingStatus,
    isDataLoading,
    refreshAccountData,
  } = useAuth();

  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [checkoutBusyItem, setCheckoutBusyItem] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [verifyingCheckout, setVerifyingCheckout] = useState<boolean>(false);
  const [verificationResult, setVerificationResult] = useState<CheckoutVerifyResponse | null>(null);
  const [lastVerifiedTarget, setLastVerifiedTarget] = useState<{
    kind: 'credit_pack' | 'subscription';
    order_id?: string;
    subscription_id?: string;
  } | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState<boolean>(false);
  const [cancelingSub, setCancelingSub] = useState<boolean>(false);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const [showManualVerify, setShowManualVerify] = useState<boolean>(false);
  const [manualSubId, setManualSubId] = useState<string>('');

  const verifiedKeysRef = useRef<Set<string>>(new Set());
  const pendingRetryCountRef = useRef<number>(0);

  useEffect(() => {
    if (isConfigured && !isLoading && !user) {
      if (typeof window !== 'undefined') {
        const { target } = parseReturnTargetFromSearch(window.location.search);
        if (target) {
          savePendingCheckout({
            kind: target.kind,
            order_id: target.order_id ?? null,
            subscription_id: target.subscription_id ?? null,
            item_name: target.kind === 'subscription' ? 'Monthly Plan' : 'Credit Pack',
            created_at: Date.now(),
          });
        }
      }
      setIntendedRoute('/dashboard/billing');
      onNavigate('/auth');
    }
  }, [isConfigured, isLoading, user, onNavigate]);

  const apiBase = getApiBaseUrl();

  const runServerVerification = useCallback(
    async (
      target: {
        kind: 'credit_pack' | 'subscription';
        order_id?: string;
        subscription_id?: string;
      },
      isAutoRetry = false,
    ) => {
      if (!session?.access_token) return;
      if (!isAutoRetry) {
        pendingRetryCountRef.current = 0;
      }
      setVerifyingCheckout(true);
      setCheckoutError(null);
      if (!isAutoRetry) {
        setVerificationResult(null);
      }
      setLastVerifiedTarget(target);

      const client = new CleanDataApiClient(apiBase, session.access_token);
      try {
        const res = await client.verifyCheckout(target);
        setVerificationResult(res);
        if (res.status !== 'pending') {
          clearPendingCheckout();
        }
        await refreshAccountData();
      } catch (err) {
        if (err instanceof CleanDataApiError) {
          if (err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429) {
            clearPendingCheckout();
          }
          setCheckoutError(`${err.code}: ${err.message}`);
        } else {
          setCheckoutError('Unable to verify Cashfree payment status with server.');
        }
      } finally {
        setVerifyingCheckout(false);
      }
    },
    [apiBase, session?.access_token, refreshAccountData],
  );

  // Verify returning Cashfree redirect checkouts or recovered pending sessions server-side
  // (never grant from URL query parameters alone).
  useEffect(() => {
    if (typeof window === 'undefined' || !session?.access_token || !user) return;
    const { target: urlTarget, hasReturnParams } = parseReturnTargetFromSearch(
      window.location.search,
    );

    let target = urlTarget;
    if (urlTarget) {
      savePendingCheckout({
        kind: urlTarget.kind,
        order_id: urlTarget.order_id ?? null,
        subscription_id: urlTarget.subscription_id ?? null,
        item_name: urlTarget.kind === 'subscription' ? 'Monthly Plan' : 'Credit Pack',
        created_at: Date.now(),
      });
    } else {
      const pending = readPendingCheckout();
      if (pending && (pending.order_id || pending.subscription_id)) {
        target = {
          kind: pending.kind,
          order_id: pending.order_id || undefined,
          subscription_id: pending.subscription_id || undefined,
        };
      }
    }

    if (hasReturnParams) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (!target) return;
    const key = `${target.kind}:${target.subscription_id || target.order_id || ''}`;
    if (verifiedKeysRef.current.has(key)) return;
    verifiedKeysRef.current.add(key);

    void runServerVerification(target);
  }, [session?.access_token, user, runServerVerification]);

  // Bounded automatic re-check (up to 2 times) while Cashfree finishes asynchronous confirmation
  useEffect(() => {
    if (
      verificationResult?.status !== 'pending' ||
      !lastVerifiedTarget ||
      verifyingCheckout ||
      !session?.access_token ||
      pendingRetryCountRef.current >= 2
    ) {
      return;
    }
    const delayMs = pendingRetryCountRef.current === 0 ? 3500 : 7000;
    const timer = window.setTimeout(() => {
      pendingRetryCountRef.current += 1;
      void runServerVerification(lastVerifiedTarget, true);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [
    verificationResult?.status,
    lastVerifiedTarget,
    verifyingCheckout,
    session?.access_token,
    runServerVerification,
  ]);

  const handleCheckout = async (kind: 'subscription' | 'credit_pack', itemName: string) => {
    setCheckoutError(null);
    setVerificationResult(null);
    setCancelNotice(null);

    if (!apiBase) {
      setCheckoutError(
        'FastAPI backend URL (VITE_API_BASE_URL) is not configured to initialize Cashfree sessions.',
      );
      return;
    }
    if (!session?.access_token) {
      setCheckoutError('Sign in again to authorize checkout.');
      return;
    }

    const normalizedDigits = customerPhone.replace(/\D/g, '');
    if (normalizedDigits.length > 0 && normalizedDigits.length < 10) {
      setCheckoutError('Please enter a valid 10-digit mobile number or leave it blank.');
      return;
    }

    setCheckoutBusyItem(`${kind}:${itemName}`);
    try {
      const client = new CleanDataApiClient(apiBase, session.access_token);
      const checkout = await client.createCheckout({
        kind,
        item_name: itemName,
        customer_phone: normalizedDigits.length >= 10 ? normalizedDigits.slice(-10) : undefined,
      });

      savePendingCheckout({
        kind,
        order_id: checkout.order_id,
        subscription_id: checkout.subscription_id,
        item_name: itemName,
        created_at: Date.now(),
      });

      const cashfree = await loadCashfree({ mode: checkout.cashfree_mode });
      if (!cashfree) {
        setCheckoutError('Cashfree Checkout SDK failed to initialize in this browser.');
        return;
      }

      if (kind === 'credit_pack') {
        if (!checkout.payment_session_id) {
          setCheckoutError('Backend did not return a Cashfree payment_session_id.');
          return;
        }
        const result = await cashfree.checkout({
          paymentSessionId: checkout.payment_session_id,
          redirectTarget: '_self',
        });
        if (result?.error) {
          setCheckoutError(result.error.message || 'Cashfree checkout could not be completed.');
          return;
        }
        if (result?.paymentDetails && checkout.order_id) {
          await runServerVerification({
            kind: 'credit_pack',
            order_id: checkout.order_id,
          });
        }
      } else {
        if (!checkout.subscription_session_id) {
          setCheckoutError('Backend did not return a Cashfree subscription_session_id.');
          return;
        }
        const result = await cashfree.subscriptionsCheckout({
          subsSessionId: checkout.subscription_session_id,
          redirectTarget: '_self',
        });
        if (result?.error) {
          setCheckoutError(result.error.message || 'Cashfree subscription checkout could not be completed.');
          return;
        }
        const targetSubId = checkout.subscription_id || checkout.order_id;
        if (targetSubId) {
          await runServerVerification({
            kind: 'subscription',
            subscription_id: targetSubId,
          });
        }
      }
    } catch (err) {
      if (err instanceof CleanDataApiError) {
        setCheckoutError(`${err.code}: ${err.message}`);
      } else {
        setCheckoutError('Could not connect to FastAPI Cashfree billing endpoint.');
      }
    } finally {
      setCheckoutBusyItem(null);
    }
  };

  const handleManualVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualSubId.trim();
    if (!cleaned) {
      setCheckoutError('Enter your Cashfree Order ID (cd_ord_...) or Subscription ID (cd_sub_...) to verify.');
      return;
    }
    if (cleaned.startsWith('cd_ord_')) {
      await runServerVerification({
        kind: 'credit_pack',
        order_id: cleaned,
      });
      return;
    }
    await runServerVerification({
      kind: 'subscription',
      subscription_id: cleaned,
    });
  };

  const handleCancelSubscription = async () => {
    if (!session?.access_token) return;
    setCancelingSub(true);
    setCheckoutError(null);
    setCancelNotice(null);
    try {
      const client = new CleanDataApiClient(apiBase, session.access_token);
      const res = await client.cancelSubscription();
      setShowCancelConfirm(false);
      setCancelNotice(res.message);
      clearPendingCheckout();
      await refreshAccountData();
    } catch (err) {
      if (err instanceof CleanDataApiError) {
        setCheckoutError(`${err.code}: ${err.message}`);
      } else {
        setCheckoutError('Unable to cancel subscription right now.');
      }
    } finally {
      setCancelingSub(false);
    }
  };

  if (!isConfigured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="glass-surface-elevated rounded-3xl p-6 sm:p-8 space-y-3">
          <h1 className="font-display text-xl font-bold text-slate-950">
            Billing Unavailable Without Supabase Auth
          </h1>
          <p className="text-sm text-slate-600">
            Configure <code className="font-mono text-xs">VITE_SUPABASE_URL</code> and{' '}
            <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> to manage plans,
            credits, and Cashfree checkout sessions.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !user) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 space-y-6">
        <div className="h-24 animate-pulse rounded-3xl bg-white/70" />
        <div className="h-40 animate-pulse rounded-3xl bg-white/70" />
      </div>
    );
  }

  const displayState = resolveBillingDisplayState({
    billingStatus,
    isDataLoading,
    billingError,
    billingErrorDetail,
    activePlan,
    wallet,
    transactions,
    payments,
  });
  const paidPlans = SUBSCRIPTION_PLANS.filter((p) => p.monthlyPricePaise > 0);
  const currentPlanName = activePlan?.name ?? 'Free';
  const currentPlanPrice = activePlan?.monthly_price ?? 0;
  const canCancelActiveSub =
    displayState.phase === 'loaded' &&
    currentPlanName !== 'Free' &&
    activePlan?.status === 'active' &&
    Boolean(activePlan?.provider_subscription_id);
  const pendingCheckTarget =
    lastVerifiedTarget ??
    (activePlan?.provider_subscription_id && activePlan.status !== 'active'
      ? { kind: 'subscription' as const, subscription_id: activePlan.provider_subscription_id }
      : null);

  return (
    <DashboardShell
      currentRoute="/dashboard/billing"
      onNavigate={onNavigate}
      title="Credits & Billing"
      subtitle={`1 credit = up to ${ROWS_PER_CREDIT.toLocaleString()} server rows. Subscription credits are spent before purchased credits. Powered by Cashfree Payments.`}
      actions={
        <button
          type="button"
          onClick={() => void refreshAccountData()}
          disabled={isDataLoading}
          className="glass-btn-secondary inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-medium cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isDataLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Refresh Ledger</span>
        </button>
      }
    >
      {displayState.isSyncUnavailable && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50/95 p-4 text-xs text-amber-950"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-semibold">{displayState.errorTitle}</p>
              <p className="text-amber-900">{displayState.errorMessage}</p>
              {(displayState.errorCode || displayState.errorRequestId) && (
                <p className="font-mono text-[11px] text-amber-800">
                  {displayState.errorCode ? `Code: ${displayState.errorCode}` : ''}
                  {displayState.errorCode && displayState.errorRequestId ? ' · ' : ''}
                  {displayState.errorRequestId ? `Request ID: ${displayState.errorRequestId}` : ''}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshAccountData()}
            disabled={isDataLoading}
            className="shrink-0 rounded-xl border border-amber-400 bg-white px-3 py-1.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 cursor-pointer disabled:opacity-50"
          >
            {isDataLoading ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      )}

      {/* Split Credit Wallet Summary */}
      <section aria-label="Wallet balances" className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="glass-surface rounded-3xl p-5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500">Active Subscription</p>
            <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${displayState.badgeTone}`}>
              {displayState.badgeLabel}
            </span>
          </div>
          <p className="font-display text-2xl font-bold text-slate-950">
            {displayState.planDisplayName}
          </p>
          {displayState.phase === 'loaded' ? (
            <>
              <p className="font-mono text-xs text-slate-600 tabular-nums">
                {formatInrFromPaise(currentPlanPrice)}/mo · {activePlan?.monthly_credits ?? 0} monthly credits
              </p>
              {currentPlanName !== 'Free' && activePlan?.current_period_end && (
                <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {activePlan.status === 'canceled' ? 'Ended / expires: ' : 'Next cycle: '}
                  {formatDate(activePlan.current_period_end)}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500">
              {displayState.phase === 'loading'
                ? 'Synchronizing live subscription status...'
                : 'Live subscription status could not be loaded. Click Retry above.'}
            </p>
          )}

          {canCancelActiveSub && !showCancelConfirm && (
            <button
              type="button"
              onClick={() => setShowCancelConfirm(true)}
              className="mt-1 inline-flex items-center text-xs font-medium text-red-700 hover:text-red-800 cursor-pointer"
            >
              Cancel monthly auto-renewal
            </button>
          )}

          {showCancelConfirm && (
            <div className="mt-2 rounded-2xl border border-red-200 bg-red-50/90 p-3 space-y-2">
              <p className="text-[11px] text-red-900">
                Cancel your Cashfree mandate for <strong>{currentPlanName}</strong>? Future
                recurring charges will stop immediately.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={cancelingSub}
                  onClick={() => void handleCancelSubscription()}
                  className="rounded-xl bg-red-700 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-red-800 cursor-pointer disabled:opacity-50"
                >
                  {cancelingSub ? 'Cancelling...' : 'Confirm Cancel'}
                </button>
                <button
                  type="button"
                  disabled={cancelingSub}
                  onClick={() => setShowCancelConfirm(false)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Keep Plan
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="glass-surface rounded-3xl p-5 space-y-2">
          <p className="text-xs font-medium text-slate-500">Subscription Credits (Spent First)</p>
          <p className="font-mono text-2xl font-bold text-slate-950 tabular-nums">
            {displayState.subscriptionCreditsText}
          </p>
          <p className="font-mono text-xs text-slate-600 tabular-nums">
            {displayState.phase === 'loaded'
              ? `Expires: ${wallet?.subscription_expires_at ? formatDate(wallet.subscription_expires_at) : 'Monthly cycle'}`
              : displayState.phase === 'loading'
              ? 'Loading credit wallet...'
              : 'Live balance sync unavailable'}
          </p>
        </div>

        <div className="glass-surface rounded-3xl p-5 space-y-2">
          <p className="text-xs font-medium text-slate-500">Purchased Pack Credits</p>
          <p className="font-mono text-2xl font-bold text-slate-950 tabular-nums">
            {displayState.purchasedCreditsText}
          </p>
          <p className="font-mono text-xs text-slate-600 tabular-nums">
            {displayState.phase === 'loaded'
              ? `Valid ${PURCHASED_CREDIT_EXPIRY_MONTHS} months · ${wallet?.purchased_expires_at ? formatDate(wallet.purchased_expires_at) : 'No active packs'}`
              : displayState.phase === 'loading'
              ? 'Loading credit wallet...'
              : 'Live balance sync unavailable'}
          </p>
        </div>
      </section>

      {verifyingCheckout && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-blue-200 bg-blue-50/95 p-4 text-xs text-blue-950">
          <Loader2 className="h-4 w-4 animate-spin text-blue-700" aria-hidden="true" />
          <span>Verifying payment &amp; mandate status directly with Cashfree...</span>
        </div>
      )}

      {cancelNotice && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-white/90 p-4 text-xs text-slate-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" aria-hidden="true" />
          <span>{cancelNotice}</span>
        </div>
      )}

      {checkoutError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50/95 p-4 text-xs text-red-900"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
          <span>{checkoutError}</span>
        </div>
      )}

      {verificationResult && (
        <div
          className={`rounded-2xl border p-4 text-xs space-y-1.5 ${
            verificationResult.status === 'paid' || verificationResult.status === 'active'
              ? 'border-emerald-200 bg-emerald-50/95 text-emerald-950'
              : verificationResult.status === 'pending'
              ? 'border-amber-200 bg-amber-50/95 text-amber-950'
              : 'border-red-200 bg-red-50/95 text-red-950'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold">
              {verificationResult.status === 'paid' || verificationResult.status === 'active' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
              ) : verificationResult.status === 'pending' ? (
                <Clock className="h-4 w-4 text-amber-700" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4 text-red-700" aria-hidden="true" />
              )}
              <span>
                {verificationResult.status === 'paid'
                  ? `Successful — ${verificationResult.item_name ?? 'Credit Pack'}`
                  : verificationResult.status === 'active'
                  ? `Subscription active — ${verificationResult.item_name ?? 'Monthly Plan'}`
                  : verificationResult.status === 'pending'
                  ? 'Pending confirmation'
                  : verificationResult.status === 'canceled'
                  ? 'Cancelled'
                  : verificationResult.status === 'expired'
                  ? 'Subscription expired'
                  : 'Failed'}
              </span>
            </div>

            {verificationResult.status === 'pending' && pendingCheckTarget && (
              <button
                type="button"
                disabled={verifyingCheckout}
                onClick={() => void runServerVerification(pendingCheckTarget)}
                className="inline-flex items-center gap-1 rounded-xl border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-950 hover:bg-amber-100 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${verifyingCheckout ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>Check Status Now</span>
              </button>
            )}
          </div>
          <p>{verificationResult.message}</p>
        </div>
      )}

      {/* Optional Mobile Number + Cashfree Subscription Reconcile */}
      <section className="glass-surface rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-950">
              Checkout Contact Number (Optional)
            </h2>
            <p className="text-xs text-slate-600">
              Provide a 10-digit mobile number for Cashfree payment receipts and UPI AutoPay mandate
              alerts.
            </p>
          </div>
          <input
            type="tel"
            inputMode="numeric"
            maxLength={14}
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="10-digit mobile (e.g. 9876543210)"
            aria-label="Mobile number for Cashfree checkout"
            className="glass-input w-full sm:w-64 rounded-xl px-3.5 py-2 font-mono text-xs placeholder:text-slate-400"
          />
        </div>

        <div className="border-t border-slate-200/70 pt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-600">
            Completed a Cashfree payment or subscription checkout and don&apos;t see credits yet?
          </p>
          <button
            type="button"
            onClick={() => setShowManualVerify((prev) => !prev)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 cursor-pointer self-start sm:self-auto"
          >
            <SearchCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{showManualVerify ? 'Hide Cashfree Lookup' : 'Verify Cashfree Order / Subscription ID'}</span>
          </button>
        </div>

        {showManualVerify && (
          <form onSubmit={(e) => void handleManualVerifySubmit(e)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={manualSubId}
              onChange={(e) => setManualSubId(e.target.value)}
              placeholder="Enter Cashfree Order ID (cd_ord_...) or Subscription ID (cd_sub_...)"
              aria-label="Cashfree Order or Subscription ID to verify"
              className="glass-input w-full sm:flex-1 rounded-xl px-3.5 py-2 font-mono text-xs placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={verifyingCheckout}
              className="glass-btn-primary inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {verifyingCheckout ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>Verify &amp; Sync</span>
            </button>
          </form>
        )}
      </section>

      {/* Paid Subscriptions (Cashfree Subscriptions) */}
      <section aria-labelledby="billing-plans-heading" className="space-y-4">
        <div>
          <h2 id="billing-plans-heading" className="font-display text-lg font-semibold text-slate-950">
            Monthly Recurring Subscriptions
          </h2>
          <p className="text-xs text-slate-600">
            Handled via Cashfree Subscriptions (UPI AutoPay, Cards, or eNACH). Switching plans
            cancels your previous recurring mandate once the new mandate activates.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {paidPlans.map((plan) => {
            const isLoaded = displayState.phase === 'loaded';
            const isCurrent = isLoaded && currentPlanName === plan.name && activePlan?.status === 'active';
            const isUpgrade = isLoaded && currentPlanName !== 'Free' && plan.monthlyPricePaise > currentPlanPrice;
            const isDowngrade = isLoaded && currentPlanName !== 'Free' && plan.monthlyPricePaise < currentPlanPrice;
            const busy = checkoutBusyItem === `subscription:${plan.name}`;
            return (
              <div
                key={plan.id}
                className={`flex flex-col justify-between rounded-3xl p-5 glass-card-hover ${
                  plan.highlighted ? 'glass-card-pro' : 'glass-surface'
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
                  disabled={busy || isCurrent || verifyingCheckout}
                  onClick={() => void handleCheckout('subscription', plan.name)}
                  className={`mt-5 inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50 ${
                    isCurrent
                      ? 'border border-slate-200 bg-slate-100/80 text-slate-600 cursor-default'
                      : 'glass-btn-primary'
                  }`}
                >
                  <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {isCurrent
                      ? 'Current Active Plan'
                      : busy
                      ? 'Launching Cashfree...'
                      : isUpgrade
                      ? `Upgrade (${formatInrFromPaise(plan.monthlyPricePaise)}/mo)`
                      : isDowngrade
                      ? `Downgrade (${formatInrFromPaise(plan.monthlyPricePaise)}/mo)`
                      : `Subscribe (${formatInrFromPaise(plan.monthlyPricePaise)}/mo)`}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* One-Time Credit Packs (Cashfree Payment Gateway) */}
      <section aria-labelledby="billing-packs-heading" className="space-y-4">
        <div className="flex flex-col gap-1">
          <h2 id="billing-packs-heading" className="font-display text-lg font-semibold text-slate-950">
            Buy One-Time Credit Packs
          </h2>
          <p className="text-xs text-slate-600">
            Processed via Cashfree Payment Gateway. Credits remain valid for{' '}
            {PURCHASED_CREDIT_EXPIRY_MONTHS} months and failed server jobs are refunded automatically.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CREDIT_PACKS.map((pack) => {
            const busy = checkoutBusyItem === `credit_pack:${pack.name}`;
            return (
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
                </div>

                <button
                  type="button"
                  disabled={busy || verifyingCheckout}
                  onClick={() => void handleCheckout('credit_pack', pack.name)}
                  className="glass-btn-secondary mt-4 inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{busy ? 'Launching Cashfree...' : `Buy ${pack.credits} Credits`}</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Credit Ledger */}
      <section className="glass-surface rounded-3xl overflow-hidden">
        <div className="border-b border-slate-200/70 px-5 py-4">
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
            {displayState.ledgerEmptyMessage ?? 'No credit ledger transactions recorded yet.'}
          </p>
        ) : (
          <div className="p-2">
            <div className="glass-table-wrap overflow-x-auto rounded-2xl">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/90 text-slate-600">
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
                    <tr key={tx.id} className="hover:bg-blue-50/35 transition-colors">
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
          </div>
        )}
      </section>

      {/* Payment Records */}
      <section className="glass-surface rounded-3xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200/70 px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-950">Payment History</h2>
            <p className="text-xs text-slate-600">
              All amounts are stored in INR paise and verified strictly via Cashfree server APIs
              and HMAC-SHA256 signed webhooks.
            </p>
          </div>
          <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
        </div>

        {payments.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-slate-500">
            {displayState.paymentsEmptyMessage ?? 'No Cashfree payment sessions created yet.'}
          </p>
        ) : (
          <div className="p-2">
            <div className="glass-table-wrap overflow-x-auto rounded-2xl">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/90 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Item / Type</th>
                    <th className="px-4 py-3 font-medium">Reference</th>
                    <th className="px-4 py-3 font-medium">Provider</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-blue-50/35 transition-colors">
                      <td className="px-4 py-3 text-slate-900">
                        <span className="font-medium">
                          {p.item_name || (p.kind === 'subscription' ? 'Subscription' : 'Credit Pack')}
                        </span>
                        <span className="ml-1.5 font-mono text-[11px] text-slate-500">
                          ({p.kind || 'payment'})
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 font-mono text-[11px] text-slate-600"
                        title={p.provider_payment_id || undefined}
                      >
                        {maskRefId(p.provider_payment_id)}
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-700">{p.provider || 'cashfree'}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {formatInrFromPaise(p.amount)}
                      </td>
                      <td
                        className={`px-4 py-3 font-medium capitalize ${
                          p.status === 'paid'
                            ? 'text-emerald-700'
                            : p.status === 'failed'
                            ? 'text-red-700'
                            : p.status === 'refunded'
                            ? 'text-slate-600'
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
          </div>
        )}
      </section>

      <section className="glass-surface-subtle rounded-3xl px-5 py-4 text-xs text-slate-600 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p>Billing &amp; Support ({MERCHANT_INFO.legalName})</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <AppLink to="/refund-policy" onNavigate={onNavigate} className="text-blue-700 hover:underline">
            Refund &amp; Cancellation Policy
          </AppLink>
          <AppLink to="/terms" onNavigate={onNavigate} className="text-blue-700 hover:underline">
            Terms &amp; Conditions
          </AppLink>
          <AppLink to="/contact" onNavigate={onNavigate} className="text-blue-700 hover:underline">
            Contact Us
          </AppLink>
        </div>
      </section>
    </DashboardShell>
  );
};
