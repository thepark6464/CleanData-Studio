import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { CleanDataApiClient, CleanDataApiError, getApiBaseUrl } from '../lib/api/client';
import type { ApiKeyMetadata, ApiUsageItem } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthContext';
import type { AppRoute } from '../lib/router';
import { getSupabaseClient } from '../lib/supabase/client';

interface ApiKeysPageProps {
  onNavigate: (to: AppRoute) => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export const ApiKeysPage: React.FC<ApiKeysPageProps> = ({ onNavigate }) => {
  const { isConfigured, isLoading, session, user, activePlan } = useAuth();

  const [keys, setKeys] = useState<ApiKeyMetadata[]>([]);
  const [usage, setUsage] = useState<ApiUsageItem[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revealedPlaintext, setRevealedPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = getApiBaseUrl();

  useEffect(() => {
    if (isConfigured && !isLoading && !user) {
      onNavigate('/auth');
    }
  }, [isConfigured, isLoading, user, onNavigate]);

  const loadKeysAndUsage = useCallback(async () => {
    if (!user) return;
    setLoadingKeys(true);
    setError(null);
    try {
      if (apiBase && session?.access_token) {
        const client = new CleanDataApiClient(apiBase, session.access_token);
        const [keysRes, usageRes] = await Promise.all([
          client.listApiKeys(),
          client.getUsage(),
        ]);
        setKeys(keysRes.items);
        setUsage(usageRes.items);
        return;
      }

      // Read-only fallback via Supabase RLS (column-level grant exposes metadata only, never key_hash)
      const supabase = getSupabaseClient();
      if (supabase) {
        const [keysRes, usageRes] = await Promise.all([
          supabase
            .from('api_keys')
            .select('id, user_id, name, prefix, last_used_at, revoked_at, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('api_usage')
            .select('id, api_key_id, endpoint, credits_used, status_code, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(30),
        ]);
        if (keysRes.data) setKeys(keysRes.data as ApiKeyMetadata[]);
        if (usageRes.data) setUsage(usageRes.data as ApiUsageItem[]);
      }
    } catch (err) {
      if (err instanceof CleanDataApiError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError('Unable to load API keys.');
      }
    } finally {
      setLoadingKeys(false);
    }
  }, [user, apiBase, session?.access_token]);

  useEffect(() => {
    void loadKeysAndUsage();
  }, [loadKeysAndUsage]);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setRevealedPlaintext(null);

    if (!apiBase || !session?.access_token) {
      setError(
        'FastAPI backend URL (VITE_API_BASE_URL) is required to mint and hash new cd_live_ API keys server-side.',
      );
      return;
    }

    setCreating(true);
    try {
      const client = new CleanDataApiClient(apiBase, session.access_token);
      const res = await client.createApiKey(keyName.trim() || 'Production Pipeline');
      setRevealedPlaintext(res.plaintext_key);
      setKeyName('');
      await loadKeysAndUsage();
    } catch (err) {
      if (err instanceof CleanDataApiError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError('Failed to create API key.');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!apiBase || !session?.access_token) {
      setError('Configure VITE_API_BASE_URL to revoke keys via FastAPI.');
      return;
    }
    setError(null);
    setRevokingId(keyId);
    try {
      const client = new CleanDataApiClient(apiBase, session.access_token);
      await client.revokeApiKey(keyId);
      await loadKeysAndUsage();
    } catch (err) {
      if (err instanceof CleanDataApiError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError('Failed to revoke API key.');
      }
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopyPlaintext = async () => {
    if (!revealedPlaintext) return;
    await navigator.clipboard.writeText(revealedPlaintext);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (!isConfigured || isLoading || !user) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="h-44 animate-pulse rounded-xl bg-slate-200" />
      </div>
    );
  }

  const hasApiPlan = Boolean(activePlan?.api_access);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            API Keys &amp; Usage
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Keys use the <code className="font-mono text-xs">cd_live_</code> prefix, are shown once
            at creation, and are stored exclusively as peppered SHA-256 hashes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void loadKeysAndUsage()}
            disabled={loadingKeys}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingKeys ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
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

      {!hasApiPlan && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 text-xs text-amber-950">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <div>
              <p className="font-semibold">
                REST API Access Requires Pro (60 req/min) or Business (240 req/min)
              </p>
              <p className="mt-0.5">
                Your current plan is <strong>{activePlan?.name ?? 'Free'}</strong>. Upgrade in
                Billing to mint live <code className="font-mono">cd_live_</code> API keys.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/dashboard/billing')}
            className="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Upgrade Plan
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {revealedPlaintext && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-950">
            <KeyRound className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            <span>Copy Your New API Key Now — It Will Never Be Shown Again</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="flex-1 overflow-x-auto rounded-lg border border-emerald-200 bg-white px-3 py-2 font-mono text-xs text-slate-950 select-all">
              {revealedPlaintext}
            </code>
            <button
              type="button"
              onClick={() => void handleCopyPlaintext()}
              className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 cursor-pointer shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              <span>{copied ? 'Copied' : 'Copy Key'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Create Key Form */}
      <form
        onSubmit={(e) => void handleCreateKey(e)}
        className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
      >
        <h2 className="font-display text-base font-semibold text-slate-950">Create New API Key</h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Key label (e.g. Nightly ETL Sync)"
            maxLength={80}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          />
          <button
            type="submit"
            disabled={creating || !hasApiPlan}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 cursor-pointer disabled:opacity-50 shrink-0"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>{creating ? 'Generating...' : 'Generate API Key'}</span>
          </button>
        </div>
      </form>

      {/* API Keys Table */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <h2 className="font-display text-base font-semibold text-slate-950">Issued API Keys</h2>
          <span className="font-mono text-xs text-slate-600 tabular-nums">
            Rate Limit: {activePlan?.api_rate_limit_per_min ?? 0} req/min
          </span>
        </div>

        {keys.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-slate-500">
            No API keys issued yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Label</th>
                  <th className="px-4 py-3 font-medium">Prefix</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Last Used</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {keys.map((k) => {
                  const revoked = Boolean(k.revoked_at);
                  return (
                    <tr key={k.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {k.name || 'API Key'}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700">{k.prefix}...</td>
                      <td className="px-4 py-3 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                        {formatDate(k.created_at)}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                        {formatDate(k.last_used_at)}
                      </td>
                      <td
                        className={`px-4 py-3 font-medium ${
                          revoked ? 'text-slate-500' : 'text-emerald-700'
                        }`}
                      >
                        {revoked ? 'Revoked' : 'Active'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!revoked && (
                          <button
                            type="button"
                            disabled={revokingId === k.id}
                            onClick={() => void handleRevokeKey(k.id)}
                            className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                            <span>{revokingId === k.id ? 'Revoking...' : 'Revoke'}</span>
                          </button>
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

      {/* API Usage Log */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-display text-base font-semibold text-slate-950">Recent API Usage</h2>
        </div>

        {usage.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-slate-500">
            No API requests recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Endpoint</th>
                  <th className="px-4 py-3 font-medium text-right">Credits Used</th>
                  <th className="px-4 py-3 font-medium text-right">HTTP Status</th>
                  <th className="px-4 py-3 font-medium">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usage.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 font-mono text-slate-900">{u.endpoint}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                      {u.credits_used}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                      {u.status_code}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                      {formatDate(u.created_at)}
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
