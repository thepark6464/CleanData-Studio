import type {
  ActivePlanInfo,
  BillingErrorInfo,
  BillingSyncStatus,
  CreditTransactionRecord,
  CreditWallet,
  PaymentRecord,
} from '../auth/AuthContext';

export type BillingUiPhase = 'loading' | 'error' | 'loaded';

export interface BillingDisplayState {
  phase: BillingUiPhase;
  isSyncUnavailable: boolean;
  badgeLabel: string;
  badgeTone: string;
  planDisplayName: string;
  subscriptionCreditsText: string;
  purchasedCreditsText: string;
  totalCreditsText: string;
  ledgerEmptyMessage: string | null;
  paymentsEmptyMessage: string | null;
  errorTitle: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  errorRequestId: string | null;
}

export function getSubscriptionStatusBadge(
  status: string | undefined,
  planName: string,
): { label: string; tone: string } {
  if (planName === 'Free') {
    return { label: 'Free Tier', tone: 'border-slate-200 bg-slate-100 text-slate-700' };
  }
  switch ((status || '').toLowerCase()) {
    case 'active':
      return {
        label: 'Subscription active',
        tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      };
    case 'past_due':
      return { label: 'Payment due', tone: 'border-amber-200 bg-amber-50 text-amber-900' };
    case 'canceled':
      return { label: 'Cancelled', tone: 'border-slate-300 bg-slate-100 text-slate-700' };
    case 'expired':
      return { label: 'Subscription expired', tone: 'border-red-200 bg-red-50 text-red-800' };
    default:
      return { label: 'Pending', tone: 'border-amber-200 bg-amber-50 text-amber-900' };
  }
}

export function resolveBillingDisplayState(params: {
  billingStatus: BillingSyncStatus;
  isDataLoading: boolean;
  billingError: string | null;
  billingErrorDetail: BillingErrorInfo | null;
  activePlan: ActivePlanInfo | null;
  wallet: CreditWallet | null;
  transactions: CreditTransactionRecord[];
  payments: PaymentRecord[];
}): BillingDisplayState {
  const {
    billingStatus,
    isDataLoading,
    billingError,
    billingErrorDetail,
    activePlan,
    wallet,
    transactions,
    payments,
  } = params;

  const hasError = billingStatus === 'error' || Boolean(billingError) || Boolean(billingErrorDetail);

  if (!hasError && (billingStatus === 'loading' || (billingStatus === 'idle' && isDataLoading)) && !activePlan) {
    return {
      phase: 'loading',
      isSyncUnavailable: false,
      badgeLabel: 'Syncing...',
      badgeTone: 'border-slate-200 bg-slate-100 text-slate-600',
      planDisplayName: 'Loading...',
      subscriptionCreditsText: '—',
      purchasedCreditsText: '—',
      totalCreditsText: '—',
      ledgerEmptyMessage: 'Loading credit ledger...',
      paymentsEmptyMessage: 'Loading payment history...',
      errorTitle: null,
      errorMessage: null,
      errorCode: null,
      errorRequestId: null,
    };
  }

  if (hasError || billingStatus !== 'loaded' || !activePlan) {
    return {
      phase: 'error',
      isSyncUnavailable: true,
      badgeLabel: 'Sync unavailable',
      badgeTone: 'border-amber-300 bg-amber-50 text-amber-900',
      planDisplayName: 'Temporarily unavailable',
      subscriptionCreditsText: '—',
      purchasedCreditsText: '—',
      totalCreditsText: '—',
      ledgerEmptyMessage:
        'Credit ledger is temporarily unavailable until live billing sync succeeds.',
      paymentsEmptyMessage:
        'Payment history is temporarily unavailable until live billing sync succeeds.',
      errorTitle: 'Unable to synchronize live billing status from backend',
      errorMessage:
        billingErrorDetail?.message ||
        billingError ||
        'Billing status could not be loaded from the backend.',
      errorCode: billingErrorDetail?.code ?? null,
      errorRequestId: billingErrorDetail?.requestId ?? null,
    };
  }

  const badge = getSubscriptionStatusBadge(activePlan.status, activePlan.name);
  const subBalance = wallet?.subscription_balance ?? 0;
  const purBalance = wallet?.purchased_balance ?? 0;

  return {
    phase: 'loaded',
    isSyncUnavailable: false,
    badgeLabel: badge.label,
    badgeTone: badge.tone,
    planDisplayName: activePlan.name,
    subscriptionCreditsText: subBalance.toLocaleString(),
    purchasedCreditsText: purBalance.toLocaleString(),
    totalCreditsText: (subBalance + purBalance).toLocaleString(),
    ledgerEmptyMessage:
      transactions.length === 0 ? 'No credit ledger transactions recorded yet.' : null,
    paymentsEmptyMessage:
      payments.length === 0 ? 'No Cashfree payment sessions created yet.' : null,
    errorTitle: null,
    errorMessage: null,
    errorCode: null,
    errorRequestId: null,
  };
}
