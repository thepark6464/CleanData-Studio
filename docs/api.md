# CleanData REST API (`/v1`) Documentation

CleanData API exposes the same deterministic CSV and XLSX cleaning rules, quality scoring breakdown, and spreadsheet formula-injection protections as **CleanData Studio**.

Machine-readable specification: [`docs/openapi-v1.yaml`](./openapi-v1.yaml).

---

## Authentication

Endpoints under `/v1` accept Bearer credentials via the `Authorization` header:

```http
Authorization: Bearer <token>
```

Two credential types are accepted:

1. **Supabase User JWT**: Issued to signed-in web users. Required for account management, billing checkout, and creating or revoking API keys.
2. **Developer API Key (`cd_live_...`)**: Available on **Pro** (`60 req/min`) and **Business** (`240 req/min`) plans. Accepted on cleaning, job, report, download, `/v1/credits`, and `/v1/usage` endpoints. Plaintext keys are displayed once at creation and stored strictly as peppered HMAC-SHA256 hashes.

---

## Credit Metering & Idempotency

* **Billing Unit**: `1 credit = up to 1,000 rows (ceil(rows_in / 1000))`.
* **Deduction Priority**: Expiring monthly `subscription_balance` credits are spent before 12-month `purchased_balance` credits.
* **Atomic Settlement**: Credits are reserved before execution, committed upon completion, and automatically refunded if processing fails.
* **Idempotent Retries**: Pass an `Idempotency-Key` header on `POST /v1/clean` so network retries return the existing job instead of reserving duplicate credits.

---

## Core Endpoints

| Method | Path | Auth | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Public | Liveness probe (`status`, `service`, `version`) |
| `GET` | `/health/metrics` | Public | Non-PII operational counters (`uptime_seconds`, `jobs_completed`, `jobs_failed`, `active_uploads`) |
| `POST` | `/v1/files/upload` | Optional / Bearer | Multipart upload validation (MIME, size, ZIP-bomb guard for XLSX, delimiter & encoding detection) |
| `POST` | `/v1/clean` | Optional / Bearer | Run deterministic cleaning from `file_id` or inline multipart `file` |
| `GET` | `/v1/jobs` | Optional / Bearer | Paginated job history scoped to caller |
| `GET` | `/v1/jobs/{job_id}` | Optional / Bearer | Job status, row counts, and credit settlement summary |
| `GET` | `/v1/jobs/{job_id}/report` | Optional / Bearer | Quality score breakdown (`before` vs `after`) and per-operation changes |
| `GET` | `/v1/jobs/{job_id}/download` | Optional / Bearer | Short-lived signed URL (`SIGNED_URL_TTL_SECONDS`, default 300s) |
| `GET` | `/v1/credits` | JWT or `cd_live_` | Inspect active plan and subscription vs. purchased credit balances |
| `GET` | `/v1/usage` | JWT or `cd_live_` | Inspect plan rate limit (`req/min`) and recent API usage records |
| `GET` | `/v1/api-keys` | Supabase JWT | List API key metadata (prefixes, timestamps, revoked state) |
| `POST` | `/v1/api-keys` | Supabase JWT | Generate a new `cd_live_` API key (Pro/Business plans only) |
| `DELETE` | `/v1/api-keys/{key_id}` | Supabase JWT | Immediately revoke an API key |
| `GET` | `/v1/billing/summary` | Supabase JWT | Fetch active subscription, credit wallet, and recent INR payments |
| `POST` | `/v1/billing/checkout` | Supabase JWT | Initialize a Razorpay order (amounts stored in integer paise) |
| `POST` | `/v1/webhooks/payments` | Signature HMAC | Process verified payment webhooks idempotently |
| `GET` | `/v1/account/me` | Supabase JWT | Return authenticated user claims |
| `POST` | `/v1/account/delete-request` | Supabase JWT | Record account and personal data deletion request |

---

## Supported Cleaning Operations

Pass `operations` as either a comma-separated string (`"remove_empty_rows,trim_whitespace"`) or a JSON array of operation objects (`[{"id": "normalize_phones", "options": {"phoneRegion": "IN"}}]`).

* `remove_empty_rows`
* `remove_duplicates`
* `trim_whitespace`
* `standardize_case` (`lower`, `upper`, `title`, optional `columns`)
* `normalize_dates` (`iso_date`, optional `columns`)
* `normalize_emails` (optional `columns`)
* `normalize_phones` (`phoneRegion`: `US`, `IN`, `GB`, `CA`, `AU`, optional `columns`)
* `clean_numbers` (optional `columns`)
* `fix_missing_values` (`missingStrategy`: `fill_value` | `drop_rows` | `fill_mean` | `fill_median` | `fill_mode`, `fillValue`, optional `columns`)
* `rename_columns` (`columnRenames` map)
* `drop_columns` (`columns` list)

---

## Consistent Error Responses & Rate Limits

All errors return a structured envelope without stack traces:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "This job requires 12 credits, but your wallet has 5 available.",
    "request_id": "req_9f2c8b1a"
  }
}
```

Rate-limited endpoints emit `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers. Exceeding the per-minute limit returns `429` with `Retry-After`.
