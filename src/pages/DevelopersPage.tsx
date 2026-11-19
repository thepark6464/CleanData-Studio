import React, { useState } from 'react';
import { ArrowRight, KeyRound } from 'lucide-react';
import { CodeBlock } from '../components/ui/CodeBlock';
import { useAuth } from '../lib/auth/AuthContext';
import type { AppRoute } from '../lib/router';

interface DevelopersPageProps {
  onNavigate?: (to: AppRoute) => void;
}

const PYTHON_EXAMPLE = `import requests

API_KEY = "cd_live_your_api_key_here"
BASE_URL = "https://api.cleandata.example/v1"

with open("customers.csv", "rb") as f:
    resp = requests.post(
        f"{BASE_URL}/clean",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Idempotency-Key": "job-customers-2026-11-19",
        },
        files={"file": ("customers.csv", f, "text/csv")},
        data={
            "operations": "remove_empty_rows,remove_duplicates,trim_whitespace,normalize_emails",
            "output_format": "csv",
        },
        timeout=30,
    )

resp.raise_for_status()
job = resp.json()
print("Job ID:", job["job_id"], "Status:", job["status"])`;

const JS_EXAMPLE = `const form = new FormData();
form.append("file", fileInput.files[0]);
form.append("operations", "remove_empty_rows,remove_duplicates,trim_whitespace,normalize_emails");
form.append("output_format", "csv");

const response = await fetch("https://api.cleandata.example/v1/clean", {
  method: "POST",
  headers: {
    Authorization: "Bearer cd_live_your_api_key_here",
    "Idempotency-Key": "job-customers-2026-11-19",
  },
  body: form,
});

const result = await response.json();
console.log(result.job_id, result.status);`;

const CREDITS_SAMPLE_JSON = `{
  "success": true,
  "plan_name": "Pro",
  "wallet": {
    "subscription_balance": 482,
    "purchased_balance": 150,
    "total_credits": 632,
    "credit_unit_rows": 1000
  }
}`;

const USAGE_SAMPLE_JSON = `{
  "success": true,
  "plan_name": "Pro",
  "rate_limit_per_min": 60,
  "items": [
    {
      "id": "usg_01j9k...",
      "endpoint": "/v1/clean",
      "credits_used": 2,
      "response_status": 200,
      "created_at": "2026-11-19T10:42:18Z"
    }
  ]
}`;

const ERROR_JSON_EXAMPLE = `{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "This job requires 12 credits, but your wallet has 5 available.",
    "request_id": "req_9f2c8b1a"
  }
}`;

const ENDPOINTS = [
  { method: 'POST', path: '/v1/files/upload', purpose: 'Upload dataset (multipart) and receive file_id' },
  { method: 'POST', path: '/v1/clean', purpose: 'Create cleaning job from file_id or inline multipart file' },
  { method: 'GET', path: '/v1/jobs/{job_id}', purpose: 'Fetch job status, row counts, and summary' },
  { method: 'GET', path: '/v1/jobs/{job_id}/report', purpose: 'Retrieve validation report and quality score breakdown' },
  { method: 'GET', path: '/v1/jobs/{job_id}/download', purpose: 'Issue short-lived signed download URL' },
  { method: 'GET', path: '/v1/usage', purpose: 'Inspect API rate limits and recent request usage' },
  { method: 'GET', path: '/v1/credits', purpose: 'Inspect subscription vs. purchased credit balances' },
];

export const DevelopersPage: React.FC<DevelopersPageProps> = ({ onNavigate }) => {
  const [sdkTab, setSdkTab] = useState<'python' | 'javascript'>('python');
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-medium text-blue-800">CleanData REST API v1</p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl [text-wrap:balance]">
            One cleaning engine behind a predictable REST API
          </h1>
          <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
            Submit CSV and XLSX files via multipart upload, apply deterministic cleaning rules with idempotency keys, and inspect structured quality reports. Authenticate with <code className="font-mono text-xs text-slate-800">Authorization: Bearer cd_live_...</code> on Pro (60 req/min) or Business (240 req/min).
          </p>
        </div>

        {onNavigate && (
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate(user ? '/dashboard/api-keys' : '/auth')}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 cursor-pointer"
            >
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              <span>{user ? 'Manage API Keys' : 'Sign in for API Access'}</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Quick Start */}
      <section aria-labelledby="quickstart-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="quickstart-heading" className="font-display text-xl font-bold text-slate-950">
            Quick Start Example
          </h2>
          <div className="inline-flex rounded-lg bg-slate-100 p-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={sdkTab === 'python'}
              onClick={() => setSdkTab('python')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                sdkTab === 'python'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Python
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sdkTab === 'javascript'}
              onClick={() => setSdkTab('javascript')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                sdkTab === 'javascript'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              JavaScript
            </button>
          </div>
        </div>

        <CodeBlock
          language={sdkTab}
          label={sdkTab === 'python' ? 'python · POST /v1/clean' : 'javascript · POST /v1/clean'}
          code={sdkTab === 'python' ? PYTHON_EXAMPLE : JS_EXAMPLE}
        />
      </section>

      {/* Endpoint Reference */}
      <section aria-labelledby="endpoints-heading" className="space-y-4">
        <h2 id="endpoints-heading" className="font-display text-xl font-bold text-slate-950">
          REST Endpoints Contract (<code className="font-mono text-base">/v1</code>)
        </h2>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Method</th>
                <th scope="col" className="px-4 py-3 font-semibold">Endpoint</th>
                <th scope="col" className="px-4 py-3 font-semibold">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ENDPOINTS.map((ep) => (
                <tr key={ep.path}>
                  <td className="px-4 py-3 font-mono font-semibold text-blue-800 whitespace-nowrap">
                    {ep.method}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-900 whitespace-nowrap">
                    {ep.path}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{ep.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Credits & Usage Sample Payloads */}
      <section aria-labelledby="account-endpoints-heading" className="space-y-4">
        <h2 id="account-endpoints-heading" className="font-display text-xl font-bold text-slate-950">
          Credits &amp; Usage Responses
        </h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-700">
              <code className="font-mono text-blue-800">GET /v1/credits</code> — Wallet Balances
            </h3>
            <CodeBlock language="json" label="application/json · 200" code={CREDITS_SAMPLE_JSON} />
          </div>
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-700">
              <code className="font-mono text-blue-800">GET /v1/usage</code> — Rate Limit &amp; Logs
            </h3>
            <CodeBlock language="json" label="application/json · 200" code={USAGE_SAMPLE_JSON} />
          </div>
        </div>
      </section>

      {/* Error format & SSRF note */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-950">
            Consistent JSON Error Format
          </h2>
          <CodeBlock language="json" label="application/json · 402" code={ERROR_JSON_EXAMPLE} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs text-slate-600 leading-relaxed">
          <h2 className="font-display text-base font-semibold text-slate-950">
            Security &amp; Ingestion Rules
          </h2>
          <p>
            <strong className="font-semibold text-slate-900">Uploaded Files Only (No Remote URLs):</strong>{' '}
            First-release API endpoints accept multipart file uploads only—remote dataset URL fetching is intentionally disabled to eliminate SSRF exposure.
          </p>
          <p>
            <strong className="font-semibold text-slate-900">API Key Handling:</strong>{' '}
            Keys use the <code className="font-mono">cd_live_</code> prefix, are displayed once at creation, and only a peppered HMAC-SHA256 hash is persisted.
          </p>
          <p>
            <strong className="font-semibold text-slate-900">Idempotency &amp; Rate Limits:</strong>{' '}
            Include <code className="font-mono">Idempotency-Key</code> on <code className="font-mono">POST /v1/clean</code> retries to prevent duplicate credit reservation. Rate-limited responses return <code className="font-mono">429</code> with <code className="font-mono">Retry-After</code> and <code className="font-mono">X-RateLimit-*</code> headers.
          </p>
        </div>
      </section>
    </div>
  );
};
