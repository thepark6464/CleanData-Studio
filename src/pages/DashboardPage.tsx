import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileSpreadsheet,
  KeyRound,
  LogOut,
  RefreshCw,
  Settings,
  XCircle,
} from 'lucide-react';
import { formatInrFromPaise } from '../config/pricing';
import { ApiUsageCard } from '../components/ApiUsageCard';
import { CleanDataApiClient, CleanDataApiError, getApiBaseUrl } from '../lib/api/client';
import { useAuth, type CleaningJobRecord } from '../lib/auth/AuthContext';
import type { AppRoute } from '../lib/router';
import { setIntendedRoute } from '../lib/router';

interface DashboardPageProps {
  onNavigate: (to: AppRoute) => void;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function StatusCell({ status }: { status: CleaningJobRecord['status'] }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Completed</span>
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700">
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Failed</span>
      </span>
    );
  }
  if (status === 'expired') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Expired</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="capitalize">{status}</span>
    </span>
  );
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const {
    isConfigured,
    isLoading,
    session,
    user,
    profile,
    wallet,
    activePlan,
    jobs,
    isDataLoading,
    signOut,
    refreshAccountData,
  } = useAuth();

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);
  const [backendAuthStatus, setBackendAuthStatus] = useState<
    'idle' | 'verified' | 'error'
  >('idle');
  const [backendAuthMethod, setBackendAuthMethod] = useState<string | null>(null);

  useEffect(() => {
    if (isConfigured && !isLoading && !user) {
      setIntendedRoute('/dashboard');
      onNavigate('/auth');
    }
  }, [isConfigured, isLoading, user, onNavigate]);

  const apiBase = getApiBaseUrl();

  useEffect(() => {
    let active = true;
    if (!apiBase || !session?.access_token) {
      setBackendAuthStatus('idle');
      setBackendAuthMethod(null);
      return;
    }
    const client = new CleanDataApiClient(apiBase, session.access_token);
    client
      .getAccountMe()
      .then((res) => {
        if (!active) return;
        setBackendAuthStatus('verified');
        setBackendAuthMethod(res.user.auth_method ?? 'jwt');
      })
      .catch(() => {
        if (!active) return;
        setBackendAuthStatus('error');
        setBackendAuthMethod(null);
      });
    return () => {
      active = false;
    };
  }, [apiBase, session?.access_token]);

  const handleFetchSignedDownload = async (jobId: string) => {
    if (!apiBase || !session?.access_token) return;
    setDownloadError(null);
    setDownloadingJobId(jobId);
    try {
      const client = new CleanDataApiClient(apiBase, session.access_token);
      const res = await client.getSignedDownload(jobId);
      const link = document.createElement('a');
      link.href = res.download_url;
      link.download = '';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      if (err instanceof CleanDataApiError) {
        setDownloadError(err.message);
      } else {
        setDownloadError('Unable to fetch signed download URL from the FastAPI backend.');
      }
    } finally {
      setDownloadingJobId(null);
    }
  };

  if (!isConfigured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-950">
            Dashboard Unavailable Without Supabase Auth
          </h1>
          <p className="text-sm text-slate-600">
            Set <code className="font-mono text-xs">VITE_SUPABASE_URL</code> and{' '}
            <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> to enable account
            sign-in and job history. Local browser cleaning remains available without an account.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/cleaner')}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 cursor-pointer"
          >
            <span>Open Cleaner Workbench</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !user) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 space-y-6">
        <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="h-28 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-28 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-28 animate-pulse rounded-xl bg-slate-200" />
        </div>
      </div>
    );
  }

  const subBalance = wallet?.subscription_balance ?? 0;
  const purBalance = wallet?.purchased_balance ?? 0;
  const totalCredits = subBalance + purBalance;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Account Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as{' '}
            <span className="font-medium text-slate-900">
              {profile?.full_name || user.email}
            </span>{' '}
            <span className="font-mono text-xs text-slate-500">({user.email})</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Authenticated session active</span>
            </span>
            {backendAuthStatus === 'verified' && (
              <span className="font-mono text-[11px] text-slate-600">
                FastAPI verified ({backendAuthMethod ?? 'jwt'})
              </span>
            )}
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
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/dashboard/billing')}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Billing &amp; Credits</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/dashboard/api-keys')}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            <span>API Keys</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/dashboard/settings')}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Settings</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/cleaner')}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800 cursor-pointer"
          >
            <span>New Cleaning Job</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void signOut().then(() => onNavigate('/'))}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {profile?.deletion_requested_at && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <span>
            Account deletion request recorded on{' '}
            <strong className="font-mono">{formatDateTime(profile.deletion_requested_at)}</strong>.
          </span>
        </div>
      )}

      {/* Overview Stats (3 cards, flat single border, tabular numerals) */}
      <section aria-label="Account summary" className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <p className="text-xs font-medium text-slate-500">Current Plan</p>
          <p className="font-display text-2xl font-bold text-slate-950">
            {activePlan?.name ?? 'Free'}
          </p>
          <p className="font-mono text-xs text-slate-600 tabular-nums">
            {formatInrFromPaise(activePlan?.monthly_price ?? 0)}/mo · Max{' '}
            {activePlan?.max_file_size_mb ?? 5} MB ·{' '}
            {activePlan?.api_access ? 'API enabled' : 'Studio only'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <p className="text-xs font-medium text-slate-500">Available Credits</p>
          <p className="font-mono text-2xl font-bold text-slate-950 tabular-nums">
            {totalCredits}
          </p>
          <p className="font-mono text-xs text-slate-600 tabular-nums">
            Subscription: {subBalance} · Purchased: {purBalance} (1 credit = up to 1,000 rows)
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <p className="text-xs font-medium text-slate-500">Server Jobs Recorded</p>
          <p className="font-mono text-2xl font-bold text-slate-950 tabular-nums">
            {jobs.length}
          </p>
          <p className="text-xs text-slate-600">
            Inputs purge after 24 hours; cleaned outputs expire after 7 days.
          </p>
        </div>
      </section>

      {/* API Usage & Remaining Rate Limit (/api/usage) */}
      <ApiUsageCard
        accessToken={session?.access_token}
        planName={activePlan?.name}
        planRateLimitPerMin={activePlan?.api_rate_limit_per_min ?? 0}
        planApiAccess={Boolean(activePlan?.api_access)}
        onNavigate={onNavigate}
      />

      {downloadError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
          <span>{downloadError}</span>
        </div>
      )}

      {/* Processing & Download History */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-950">
              Processing &amp; Download History
            </h2>
            <p className="text-xs text-slate-600">
              Server-side cleaning jobs tied to your authenticated account (browser-local jobs stay
              only on your device).
            </p>
          </div>
        </div>

        {isDataLoading ? (
          <div className="space-y-3 p-5">
            <div className="h-10 animate-pulse rounded bg-slate-100" />
            <div className="h-10 animate-pulse rounded bg-slate-100" />
            <div className="h-10 animate-pulse rounded bg-slate-100" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <FileSpreadsheet className="h-8 w-8 text-slate-400" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-900">No server cleaning jobs yet</p>
              <p className="max-w-md text-xs text-slate-600">
                Switch to the Server API path in the Workbench to run server-side FastAPI jobs with
                7-day download retention, or continue using the private browser cleaner.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/cleaner')}
              className="mt-1 inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 cursor-pointer"
            >
              <span>Open Cleaner Workbench</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Dataset</th>
                  <th className="px-4 py-3 font-medium">Formats</th>
                  <th className="px-4 py-3 font-medium text-right">Rows</th>
                  <th className="px-4 py-3 font-medium text-right">Score</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Output Retention</th>
                  <th className="px-4 py-3 font-medium text-right">Artifact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((job) => {
                  const outputExpired =
                    job.status === 'expired' ||
                    (job.output_expires_at ? new Date(job.output_expires_at) <= new Date() : false);

                  return (
                    <tr key={job.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {job.input_name || 'dataset'}
                      </td>
                      <td className="px-4 py-3 font-mono uppercase text-slate-600">
                        {(job.input_format || 'csv').toUpperCase()} →{' '}
                        {job.output_format.toUpperCase()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                        {job.rows_processed.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                        {job.quality_score !== null ? `${Math.round(job.quality_score)}/100` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusCell status={job.status} />
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                        {formatDateTime(job.created_at)}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                        {job.output_expires_at ? formatDateTime(job.output_expires_at) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {job.status === 'completed' && !outputExpired && apiBase ? (
                          <button
                            type="button"
                            disabled={downloadingJobId === job.id}
                            onClick={() => void handleFetchSignedDownload(job.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>
                              {downloadingJobId === job.id ? 'Fetching...' : 'Signed Link'}
                            </span>
                          </button>
                        ) : outputExpired ? (
                          <span className="text-slate-400">Expired</span>
                        ) : (
                          <span className="text-slate-400">API offline</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
