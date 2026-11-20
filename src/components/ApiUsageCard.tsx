import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, ArrowRight, Gauge, KeyRound, RefreshCw } from 'lucide-react';
import { CleanDataApiClient, CleanDataApiError, getApiBaseUrl } from '../lib/api/client';
import type { ApiUsageResponse } from '../lib/api/types';
import type { AppRoute } from '../lib/router';

interface ApiUsageCardProps {
  accessToken?: string | null;
  planName?: string | null;
  planRateLimitPerMin?: number;
  planApiAccess?: boolean;
  onNavigate: (to: AppRoute) => void;
}

function formatShortTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-IN', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export const ApiUsageCard: React.FC<ApiUsageCardProps> = ({
  accessToken,
  planName,
  planRateLimitPerMin = 0,
  planApiAccess = false,
  onNavigate,
}) => {
  const [usage, setUsage] = useState<ApiUsageResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    if (!accessToken) {
      setUsage(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const client = new CleanDataApiClient(getApiBaseUrl(), accessToken);
      const res = await client.getDashboardUsage();
      setUsage(res);
    } catch (err) {
      if (err instanceof CleanDataApiError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError('Unable to reach /api/usage to retrieve live rate-limit metrics.');
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void fetchUsage();
  }, [fetchUsage]);

  const effectiveLimit =
    usage?.rate_limit?.limit_per_min ??
    (usage?.rate_limit_per_min && usage.rate_limit_per_min > 0
      ? usage.rate_limit_per_min
      : planRateLimitPerMin || 60);

  const usedInWindow = usage?.rate_limit?.used ?? usage?.requests_used_current_window ?? 0;
  const remaining =
    usage?.rate_limit?.remaining ??
    usage?.remaining_rate_limit ??
    Math.max(0, effectiveLimit - usedInWindow);
  const resetInSeconds =
    usage?.rate_limit?.reset_in_seconds ?? usage?.rate_limit_reset_in_seconds ?? 60;
  const totalLogged = usage?.total_requests_logged ?? 0;
  const totalCreditsUsed =
    usage?.total_credits_used ??
    (usage?.items ?? []).reduce((sum, item) => sum + (item.credits_used || 0), 0);

  const remainingRatio = effectiveLimit > 0 ? Math.min(100, Math.max(0, (remaining / effectiveLimit) * 100)) : 0;
  const meterColor =
    remainingRatio > 35 ? '#047857' : remainingRatio > 15 ? '#D97706' : '#DC2626';

  const resolvedPlanName = usage?.plan_name ?? planName ?? 'Free';
  const resolvedApiAccess = usage?.api_access ?? planApiAccess;

  return (
    <section
      aria-labelledby="dashboard-api-usage-heading"
      className="rounded-xl border border-slate-200 bg-white overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-blue-700" aria-hidden="true" />
            <h2
              id="dashboard-api-usage-heading"
              className="font-display text-base font-semibold text-slate-950"
            >
              API Usage &amp; Rate Limit
            </h2>
          </div>
          <p className="text-xs text-slate-600">
            Live sliding-window quota and recent request telemetry from{' '}
            <code className="font-mono text-[11px] text-slate-800">/api/usage</code>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchUsage()}
            disabled={loading || !accessToken}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/dashboard/api-keys')}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Manage Keys</span>
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {loading && !usage ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
          </div>
        ) : error ? (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5 text-xs text-amber-950">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="font-medium">Live /api/usage metrics unavailable</p>
                <p className="text-amber-900">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void fetchUsage()}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 shrink-0 cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              <span>Retry</span>
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {/* Remaining Rate Limit */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">Remaining Rate Limit</span>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    Resets in {resetInSeconds}s
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-2xl font-bold text-slate-950 tabular-nums">
                    {remaining.toLocaleString()}
                  </span>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    / {effectiveLimit.toLocaleString()} req/min
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Remaining rate limit percentage"
                  aria-valuemin={0}
                  aria-valuemax={effectiveLimit}
                  aria-valuenow={remaining}
                >
                  <svg viewBox="0 0 100 4" className="h-1.5 w-full overflow-hidden rounded-full" aria-hidden="true">
                    <rect width="100" height="4" rx="2" fill="#E2E8F0" />
                    <rect width={remainingRatio} height="4" rx="2" fill={meterColor} />
                  </svg>
                </div>
              </div>

              {/* Current Window & Plan Access */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-2">
                <span className="text-xs font-medium text-slate-600">Current 60s Window</span>
                <p className="font-mono text-2xl font-bold text-slate-950 tabular-nums">
                  {usedInWindow.toLocaleString()}{' '}
                  <span className="text-xs font-normal text-slate-500">requests</span>
                </p>
                <p className="text-xs text-slate-600">
                  Plan: <strong className="text-slate-900">{resolvedPlanName}</strong> ·{' '}
                  {resolvedApiAccess ? (
                    <span className="text-emerald-700 font-medium">REST API enabled</span>
                  ) : (
                    <span className="text-slate-500">Upgrade for API keys</span>
                  )}
                </p>
              </div>

              {/* Logged Usage & Credits */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-2">
                <span className="text-xs font-medium text-slate-600">Logged API Activity</span>
                <p className="font-mono text-2xl font-bold text-slate-950 tabular-nums">
                  {totalLogged.toLocaleString()}
                </p>
                <p className="font-mono text-xs text-slate-600 tabular-nums">
                  {totalCreditsUsed.toLocaleString()} credits consumed via API
                </p>
              </div>
            </div>

            {usage && usage.items.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3.5 py-2.5 font-medium">Endpoint</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">Credits</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">Status</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {usage.items.slice(0, 5).map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/60">
                        <td className="px-3.5 py-2 font-mono text-slate-900">{item.endpoint}</td>
                        <td className="px-3.5 py-2 text-right font-mono tabular-nums text-slate-700">
                          {item.credits_used}
                        </td>
                        <td
                          className={`px-3.5 py-2 text-right font-mono tabular-nums font-medium ${
                            item.status_code >= 200 && item.status_code < 300
                              ? 'text-emerald-700'
                              : 'text-red-700'
                          }`}
                        >
                          {item.status_code}
                        </td>
                        <td className="px-3.5 py-2 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          {formatShortTime(item.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border border-dashed border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Activity className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                  <span>
                    {resolvedApiAccess
                      ? 'No programmatic API requests recorded yet. Issue a cd_live_ key to start.'
                      : 'Upgrade to Pro or Business to mint cd_live_ API keys and call /v1/clean.'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onNavigate(resolvedApiAccess ? '/dashboard/api-keys' : '/dashboard/billing')
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 shrink-0 cursor-pointer"
                >
                  <span>{resolvedApiAccess ? 'View API Keys' : 'Compare Plans'}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
