import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  LogOut,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import { formatInrFromPaise } from '../config/pricing';
import { ApiUsageCard } from '../components/ApiUsageCard';
import { DashboardShell } from '../components/DashboardShell';
import { CleanDataApiClient, CleanDataApiError, getApiBaseUrl } from '../lib/api/client';
import { useAuth, type CleaningJobRecord } from '../lib/auth/AuthContext';
import { resolveBillingDisplayState } from '../lib/billing/displayState';
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
    transactions,
    payments,
    billingError,
    billingErrorDetail,
    billingStatus,
    jobs,
    isDataLoading,
    signOut,
    refreshAccountData,
  } = useAuth();

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);
  const [backendAuthStatus, setBackendAuthStatus] = useState<'idle' | 'verified' | 'error'>('idle');
  const [backendAuthMethod, setBackendAuthMethod] = useState<string | null>(null);
  const [jobSearch, setJobSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'failed' | 'expired'>('all');

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

  // Real computed statistics derived strictly from actual server jobs
  const jobStats = useMemo(() => {
    const scoredJobs = jobs.filter((j) => typeof j.quality_score === 'number');
    const avgScore =
      scoredJobs.length > 0
        ? Math.round(
            scoredJobs.reduce((acc, j) => acc + (j.quality_score ?? 0), 0) / scoredJobs.length,
          )
        : null;
    const totalRows = jobs.reduce((acc, j) => acc + (j.rows_processed || 0), 0);
    const completedCount = jobs.filter((j) => j.status === 'completed').length;
    const recentScored = [...scoredJobs].slice(0, 8).reverse();
    return { avgScore, totalRows, completedCount, recentScored };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const query = jobSearch.trim().toLowerCase();
    return jobs.filter((j) => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false;
      if (!query) return true;
      return (
        (j.input_name || '').toLowerCase().includes(query) ||
        j.output_format.toLowerCase().includes(query)
      );
    });
  }, [jobs, jobSearch, statusFilter]);

  if (!isConfigured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="glass-surface-elevated rounded-3xl p-6 sm:p-8 space-y-4">
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
            className="glass-btn-primary inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer"
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
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 space-y-6">
        <div className="h-24 animate-pulse rounded-3xl bg-white/70" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="h-32 animate-pulse rounded-3xl bg-white/70" />
          <div className="h-32 animate-pulse rounded-3xl bg-white/70" />
          <div className="h-32 animate-pulse rounded-3xl bg-white/70" />
        </div>
      </div>
    );
  }

  const subBalance = wallet?.subscription_balance ?? 0;
  const purBalance = wallet?.purchased_balance ?? 0;
  const totalWallet = subBalance + purBalance;
  const subRatio = totalWallet > 0 ? (subBalance / totalWallet) * 100 : 0;

  const billingDisplay = resolveBillingDisplayState({
    billingStatus,
    isDataLoading,
    billingError,
    billingErrorDetail,
    activePlan,
    wallet,
    transactions,
    payments,
  });

  return (
    <DashboardShell
      currentRoute="/dashboard"
      onNavigate={onNavigate}
      title={`Welcome back${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
      subtitle={`${user.email ?? 'Authenticated account'} · ${
        backendAuthStatus === 'verified'
          ? `FastAPI verified (${backendAuthMethod ?? 'jwt'})`
          : 'Authenticated session active'
      }`}
      actions={
        <>
          <button
            type="button"
            onClick={() => void refreshAccountData()}
            disabled={isDataLoading}
            className="glass-btn-secondary inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isDataLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/cleaner')}
            className="glass-btn-primary inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold cursor-pointer"
          >
            <span>New Cleaning Job</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void signOut().then(() => onNavigate('/'))}
            className="glass-btn-secondary inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </>
      }
    >
      {profile?.deletion_requested_at && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/95 p-4 text-xs text-amber-950"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <span>
            Account deletion request recorded on{' '}
            <strong className="font-mono">{formatDateTime(profile.deletion_requested_at)}</strong>.
          </span>
        </div>
      )}

      {billingDisplay.isSyncUnavailable && (
        <div
          role="alert"
          className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50/95 p-4 text-xs text-amber-950"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <div className="space-y-0.5">
              <p className="font-semibold">{billingDisplay.errorTitle}</p>
              <p className="text-amber-900">{billingDisplay.errorMessage}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshAccountData()}
              disabled={isDataLoading}
              className="rounded-xl border border-amber-400 bg-white px-3 py-1.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 cursor-pointer disabled:opacity-50"
            >
              {isDataLoading ? 'Retrying...' : 'Retry'}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/dashboard/billing')}
              className="rounded-xl border border-amber-400 bg-white px-3 py-1.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 cursor-pointer"
            >
              Open Billing
            </button>
          </div>
        </div>
      )}

      {/* Bento Overview Stats */}
      <section aria-label="Account summary" className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <div className="glass-surface glass-card-hover rounded-3xl p-5 md:col-span-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500">Current Plan</p>
            {billingDisplay.isSyncUnavailable && (
              <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${billingDisplay.badgeTone}`}>
                {billingDisplay.badgeLabel}
              </span>
            )}
          </div>
          <p className="font-display text-2xl font-bold text-slate-950">
            {billingDisplay.planDisplayName}
          </p>
          <p className="font-mono text-xs text-slate-600 tabular-nums">
            {billingDisplay.phase === 'loaded'
              ? `${formatInrFromPaise(activePlan?.monthly_price ?? 0)}/mo · Max ${activePlan?.max_file_size_mb ?? 5} MB · ${activePlan?.api_access ? 'API enabled' : 'Studio only'}`
              : billingDisplay.phase === 'loading'
              ? 'Loading plan entitlements...'
              : 'Live plan status temporarily unavailable'}
          </p>
        </div>

        <div className="glass-surface glass-card-hover rounded-3xl p-5 md:col-span-4 space-y-2.5">
          <p className="text-xs font-medium text-slate-500">Available Credits</p>
          <p className="font-mono text-2xl font-bold text-slate-950 tabular-nums">
            {billingDisplay.totalCreditsText}
          </p>
          {billingDisplay.phase === 'loaded' && totalWallet > 0 && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80" aria-hidden="true">
              <div
                className="h-full bg-gradient-to-r from-blue-600 to-violet-600"
                style={{ width: `${subRatio}%` }}
              />
            </div>
          )}
          <p className="font-mono text-xs text-slate-600 tabular-nums">
            {billingDisplay.phase === 'loaded'
              ? `Sub: ${subBalance} · Pack: ${purBalance} (1 cr = 1,000 rows)`
              : billingDisplay.phase === 'loading'
              ? 'Loading credit wallet...'
              : 'Live credit wallet sync unavailable'}
          </p>
        </div>

        <div className="glass-surface glass-card-hover rounded-3xl p-5 md:col-span-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500">Data Quality &amp; Volume</p>
            <BarChart3 className="h-4 w-4 text-blue-700" aria-hidden="true" />
          </div>
          <div className="flex items-baseline gap-3">
            <p className="font-mono text-2xl font-bold text-slate-950 tabular-nums">
              {jobs.length} <span className="text-xs font-sans font-normal text-slate-500">jobs</span>
            </p>
            {jobStats.avgScore !== null && (
              <span className="font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                Avg {jobStats.avgScore}/100
              </span>
            )}
          </div>
          {jobStats.recentScored.length > 0 ? (
            <div className="flex items-end gap-1.5 pt-1 h-7" aria-label="Recent job quality scores">
              {jobStats.recentScored.map((j) => {
                const h = Math.max(20, Math.min(100, Math.round(j.quality_score ?? 0)));
                return (
                  <div
                    key={j.id}
                    title={`${j.input_name || 'dataset'}: ${Math.round(j.quality_score ?? 0)}/100`}
                    className="flex-1 rounded-t bg-gradient-to-t from-blue-600 to-cyan-400 opacity-85"
                    style={{ height: `${h}%` }}
                  />
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-600">
              Inputs purge after 24 hours; outputs expire after 7 days.
            </p>
          )}
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
          className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50/95 p-4 text-xs text-red-900"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
          <span>{downloadError}</span>
        </div>
      )}

      {/* Processing & Download History */}
      <section className="glass-surface rounded-3xl overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200/70 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-950">
              Processing &amp; Download History
            </h2>
            <p className="text-xs text-slate-600">
              Server-side cleaning jobs tied to your authenticated account ({jobStats.totalRows.toLocaleString()} total rows processed).
            </p>
          </div>

          {jobs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="search"
                  value={jobSearch}
                  onChange={(e) => setJobSearch(e.target.value)}
                  placeholder="Filter filename..."
                  aria-label="Filter jobs by filename"
                  className="glass-input rounded-xl py-1.5 pl-8 pr-3 text-xs w-44"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as 'all' | 'completed' | 'failed' | 'expired')
                }
                aria-label="Filter jobs by status"
                className="glass-input rounded-xl px-2.5 py-1.5 text-xs"
              >
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="expired">Expired</option>
              </select>
            </div>
          )}
        </div>

        {isDataLoading ? (
          <div className="space-y-3 p-5">
            <div className="h-10 animate-pulse rounded-xl bg-white/60" />
            <div className="h-10 animate-pulse rounded-xl bg-white/60" />
            <div className="h-10 animate-pulse rounded-xl bg-white/60" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/80 border border-slate-200/80 text-blue-700">
              <FileSpreadsheet className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">No server cleaning jobs yet</p>
              <p className="max-w-md text-xs text-slate-600">
                Switch to the Server API path in the Workbench to run server-side FastAPI jobs with
                7-day download retention, or continue using the private browser cleaner.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/cleaner')}
              className="glass-btn-primary mt-1 inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer"
            >
              <span>Open Cleaner Workbench</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="p-2">
            <div className="glass-table-wrap overflow-x-auto rounded-2xl">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/90 text-slate-600">
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
                  {filteredJobs.map((job) => {
                    const outputExpired =
                      job.status === 'expired' ||
                      (job.output_expires_at ? new Date(job.output_expires_at) <= new Date() : false);

                    return (
                      <tr key={job.id} className="hover:bg-blue-50/35 transition-colors">
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
                              className="glass-btn-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium cursor-pointer disabled:opacity-50"
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
                  {filteredJobs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                        No jobs match the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </DashboardShell>
  );
};
