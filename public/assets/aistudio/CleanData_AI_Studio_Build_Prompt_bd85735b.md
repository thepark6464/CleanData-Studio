# CLEANDATA API — GOOGLE AI STUDIO BUILD PROMPT

> HOW TO USE: Copy everything from "BEGIN PROMPT" to "END PROMPT" into Google AI Studio. Send it as ONE message. Then reply "Proceed to Phase 1", "Proceed to Phase 2", etc. after verifying each phase. Part A (analysis) is for you; it is already summarized inside the prompt.

---

# PART A — BLUEPRINT ANALYSIS (for the founder)

## A1. What the blueprint asks for
One shared cleaning engine, two interfaces: **CleanData Studio** (Next.js web app) and **CleanData API** (FastAPI REST API). Monetized by subscriptions (Free/Starter/Pro/Business) plus one-time credit packs, with Supabase for auth/Postgres/storage, payments via webhooks, API keys, usage metering, and strong privacy/security rules. The first milestone is a **working CSV cleaner**, not billing or dashboards.

## A2. Conflicts and ambiguities found (and the assumptions the prompt makes)
| # | Issue in blueprint | Assumption used in the prompt (change if you disagree) |
|---|---|---|
| 1 | "Browser-side processing for small CSVs" vs "one shared engine used by web app and API" (engine is Pandas/Python) | Phase 1–2: browser-side TypeScript engine for small CSVs (<= 5 MB) that **mirrors the documented operation semantics**. Phase 3+: Python/Pandas engine is the source of truth for server jobs. Shared **golden test fixtures** (same input → same expected output) keep both engines in agreement. |
| 2 | Google AI Studio may not run a Python backend | Prompt requires the model to **clearly separate** frontend generation from backend, and to output exact integration contracts (OpenAPI) so the FastAPI service can be built/run separately. |
| 3 | Pandas jobs must not run in Next.js serverless functions | Next.js does UI + light orchestration only. All server-side cleaning is FastAPI + worker. |
| 4 | Free plan = "3 jobs/day, 5 MB, no API" yet "small free cleaning without registration" | Anonymous users: browser-only cleaning, no server upload, no history. Registered Free: 3 server jobs/day, 5 MB. |
| 5 | Currency symbol is garbled in the PDF (shown as ■) but SQL defaults to `INR` | All prices in **INR (₹)**. Money stored as **integer paise**. Display converts to ₹. |
| 6 | Schema lists 13 tables but SQL only gives 9 | Prompt requires all 13 (adds subscriptions, credit_packages, webhook_events, user_preferences) plus RLS, status CHECK constraints and atomic functions. |
| 7 | Plan SQL has no credits-source distinction, but spec says subscription vs purchased credits must be distinguishable | Wallet has `subscription_balance` and `purchased_balance`; ledger has `credit_source`. Subscription credits expire at period end (assumption); purchased credits expire after 12 months (assumption, configurable). |
| 8 | Credit = 1,000 rows, but failed-job policy undefined | Credits are **reserved at job creation and committed on success; fully refunded on failure**. Retries with the same idempotency key never double-charge. |
| 9 | API access: Free = no, Pro = yes, Starter = unspecified | Assumption: API access starts at **Pro** (matches pricing table). Flagged as open decision. |
| 10 | CSV-only vs CSV+XLSX for v1 | v1 MVP = **CSV only**. XLSX read/write added in Phase 2 (server) / Phase 3, as in roadmap Sprint 2. |
| 11 | 21-day roadmap vs six build phases in Section 18 | Six phases are the build order; the 21-day sprints map onto them (mapping given in the prompt). |
| 12 | `POST /files/upload` and `POST /clean` are separate endpoints, but the example `POST /clean` also sends the file | Support both: `/files/upload` returns `file_id`; `/clean` accepts either `file_id` **or** an inline multipart `file`. |
| 13 | Retention duration, row/file limits, payment gateway not decided | Defaults: inputs deleted 24h after job completion, outputs 7 days; limits come from config and must be load-tested. Gateway = **provider-agnostic adapter** (Razorpay implementation as reference, since INR; user must confirm eligibility). |
| 14 | "Quality score" must be transparent | Documented weighted formula returned inside every report. |
| 15 | Phone/date ambiguity unresolved | Explicit region parameter required for phones; ambiguous dates (e.g., 03/04/2025) require user-chosen day-first/month-first, never guessed silently. |

## A3. Which parts need the separate Python FastAPI backend
Everything server-side: file parsing for XLSX, Pandas operations, async jobs/worker, API-key auth, rate limiting, credit reserve/commit, signed downloads, payment webhooks, OpenAPI docs. The **Next.js app + browser-side CSV engine + Supabase Auth UI** can be built and run entirely inside AI Studio.

---
---

# PART B — THE PROMPT

## ===== BEGIN PROMPT =====

You are a senior full-stack engineer, security engineer and product designer. Build **CleanData API**, a global Data-as-a-Service SaaS whose promise is **"Messy data in. Clean data out."** Build a REAL working application with real file parsing and real cleaning logic. **Never** use hardcoded demo results, fake data, fake security or static mockups.

## 0. OPERATING RULES (read first)

1. **Before writing any code**, output a short "Reconciliation" section: confirm you understand the requirements, list conflicts/ambiguities, and list the assumptions in Section 1.3. Do not silently simplify or drop any requirement. If something cannot be done in this environment, say so explicitly and provide an exact integration contract instead.
2. Build in the **six phases** in Section 12. Complete **one phase per response**. At the end of each phase output: (a) run commands, (b) tests and expected output, (c) a verification checklist, (d) the next phase name. Then STOP and wait for me to say "Proceed".
3. For every file you create or change, give the **complete file path and the complete file contents** (no "…rest unchanged", no placeholders for logic).
4. Use environment variables only. Provide `.env.example` files with **placeholders only**. Never invent API keys, payment credentials, domains or provider capabilities. Never commit secrets.
5. Include validation, error handling, loading states, empty states, accessibility (WCAG AA contrast, keyboard nav, ARIA labels, focus states), responsive design (mobile-first), and the security controls in Section 9.
6. If the Google AI Studio workflow cannot create or run the Python backend, clearly **separate** (a) frontend generation (run here) from (b) backend implementation (provided as complete files to run locally/deploy elsewhere), and give the exact API contracts (OpenAPI 3.1 snippet + TypeScript types) that connect them.
7. Never log raw uploaded data, row contents, API secrets or payment details.
8. Clearly state for each processing path whether data stays in the browser or is sent to the server, in the UI and in docs.

## 1. PRODUCT

### 1.1 Overview
CleanData API is a privacy-conscious data quality platform with **one shared cleaning engine behind two interfaces**:
- **CleanData Studio** — self-service website: upload CSV/Excel, inspect problems, choose cleaning operations, preview changes, export cleaned data.
- **CleanData API** — developer REST API: submit datasets, run cleaning jobs, fetch reports, download results.

The web app and API must call the **same tested cleaning services** with shared validation rules, reporting and usage accounting. Do not build two separate systems.

### 1.2 Customers and value
Students (messy coursework data), freelancers (client spreadsheets), small businesses (inconsistent customer records), e-commerce teams (failing product/customer imports), developers/startups (incoming data normalization), marketing agencies (duplicate/invalid contact lists). Position as an **all-in-one data quality platform**: understand, standardize, validate and automate data quality — more than a basic CSV cleaner.

### 1.3 Assumptions (state these back to me in your Reconciliation; do not silently change them)
- Currency INR (₹); money stored as integer paise.
- v1 MVP = CSV only; XLSX added in Phase 2/3; JSON input/output later.
- Anonymous users: browser-only cleaning (≤5 MB), no server upload, no history. Registered Free: 3 server jobs/day, 5 MB.
- API access starts at Pro plan.
- Credits: 1 credit = up to 1,000 rows (ceil). Reserved at job creation, committed on success, refunded on failure. Idempotency keys prevent double charge.
- Subscription credits expire at period end; purchased credits expire after 12 months (configurable).
- Retention: input files deleted 24 h after job completion; output files 7 days; reports/metadata kept until account deletion.
- Payment gateway behind a provider-agnostic adapter; reference implementation Razorpay (INR). Do not claim eligibility; I will confirm.
- Browser engine (TypeScript) mirrors the Python engine; shared golden fixtures keep them consistent.

## 2. FEATURE MODULES (ALL are required)

### A. File upload and inspection
- Formats: CSV and XLSX now (CSV first in MVP); JSON input later.
- Drag-and-drop + browse upload.
- Validate size and **content** (not only extension); detect encoding (UTF-8, UTF-8-BOM, Latin-1/Windows-1252 fallback) and CSV delimiter (comma, semicolon, tab, pipe).
- Show filename, size, row count, column count, detected column types (text, integer, decimal, date, email, phone, boolean, mixed) and a **safe preview** (escaped, never executed, truncated to the first 100 rows).
- Small CSVs processed in the browser to reduce server cost and avoid transmitting content.

### B. Cleaning operations (each independent, deterministic where possible, unit-testable, with preview)
| Operation | Required behaviour |
|---|---|
| remove_duplicates | Exact duplicate rows; optionally by selected key columns; option keep first/last |
| remove_empty_rows | Remove only **fully blank** rows; never silently remove partially populated rows |
| handle_missing_values | User-selected per column: keep, remove row, fill constant, fill numeric (mean/median/zero) where appropriate |
| trim_whitespace | Leading/trailing whitespace in selected text columns (also collapse internal runs optionally) |
| normalize_text | Optional case (lower/upper/title) and whitespace normalization with preview |
| standardize_dates | Parse supported formats; export in chosen format (default YYYY-MM-DD); ambiguous dates require explicit day-first/month-first choice; unparseable values reported, not guessed |
| normalize_emails | Trim + lowercase; **never claim the mailbox exists** |
| normalize_phone_numbers | Requires explicit country/region; validates **format only**, never that a number is active (use `phonenumbers` in Python, `libphonenumber-js` in browser) |
| rename_columns | Map inconsistent names to a convention (snake_case default) or a user mapping |

### C. Validation
- Email syntax, phone format, required-field, date parsing, numeric type, duplicate, invalid-character checks.
- Distinguish four states: **invalid, missing, duplicate, unverified**. Syntactically valid ≠ real.
- **Transparent data-quality score**: documented weights, visible in every report, with counts. Default formula (document it in UI and docs):
  `score = 100 − (30×missing_rate + 30×invalid_rate + 25×duplicate_rate + 15×type_inconsistency_rate)` clamped to 0–100, where each rate is a fraction of total cells/rows as defined in the docs. Show the components, never just a number.

### D. Exports and reports
- Cleaned CSV, cleaned XLSX, JSON output (later), validation/error report, cleaning summary.
- Report includes: rows before/after, operations applied (in order, with parameters), records changed, records removed, warnings, quality score + components.
- Before/after preview; user must **approve destructive changes** (row removal) before final export.
- Original input is never mutated; cleaned output is a separate artifact.
- **CSV formula-injection mitigation**: for cells beginning with `=`, `+`, `-`, `@`, tab or CR in exported text columns, prefix with a single quote `'` (offer a toggle, default ON, and note it in the report). No formula/macro is ever executed on input.

### E. Dashboard
Overview, clean new file, processing history, download history, API keys, usage and credits, billing, profile, settings (cleaning defaults via `user_preferences`). Don't overload with analytics.

### F. Developer platform
API key create/revoke, asynchronous jobs, job status, downloadable output, reports, usage tracking, rate limits, documentation with **Python and JavaScript examples**, OpenAPI docs.

## 3. ARCHITECTURE

```
CUSTOMERS
 |-- Individuals / businesses --> CleanData Studio (Next.js + TS + Tailwind)
 |-- Developers ---------------> CleanData REST API (FastAPI)
                                  |
                        Shared cleaning engine
                  Pandas / validators / file adapters
              +-------------------+-------------------+
        Supabase Auth +      Private Storage       Worker / queue
        PostgreSQL           (temporary files)     (long jobs)
              +-------------------+-------------------+
                       CSV / XLSX / JSON + report
```

**Stack:** Next.js (App Router) + TypeScript + Tailwind CSS; Python 3.11+ + FastAPI + Pandas + openpyxl + Pydantic + `phonenumbers` + `email-validator` + `chardet`/`charset-normalizer`; Supabase Auth + PostgreSQL + private Storage; Vercel (frontend); a Python-capable host for FastAPI (verify free-tier sleep, memory, timeouts, commercial terms); GitHub monorepo.

**Architecture rule:** Do NOT run large Pandas jobs inside Next.js serverless functions. Next.js = UI + lightweight orchestration. FastAPI + worker = server-side processing. Start with small synchronous jobs and introduce a proper queue (e.g., Postgres-backed job table polled by a worker, or RQ/Arq with Redis) when needed. Explain the choice you make.

**Separate Python FastAPI backend is REQUIRED for:** XLSX parsing/writing, Pandas operations, async jobs/worker, API-key auth, rate limiting, credit reserve/commit/refund, signed downloads, payment webhook verification, OpenAPI docs, retention cleanup.

## 4. UI / UX (premium, modern, responsive)

- **Visual direction:** minimal premium SaaS; white/light-grey surfaces, deep blue primary (e.g., #1E3A8A / #2563EB), purple accent (e.g., #7C3AED), clear typography (Inter or Geist), rounded-2xl cards, subtle shadows, soft gradients on hero only, generous whitespace, dark mode optional via CSS variables.
- Accessible contrast, visible progress states, skeleton loaders, empty states, helpful errors, toasts, mobile-friendly tables (horizontal scroll with sticky first column, or card view on small screens), focus rings, reduced-motion support.
- Design tokens in `tailwind.config.ts` and CSS variables; reusable components (Button, Card, Badge, Table, Stepper, Dropzone, Modal, Toast, Tabs, Stat, EmptyState, CodeBlock with copy button).

### Routes
| Route | Purpose |
|---|---|
| `/` | Landing: value proposition, features, use cases, pricing, CTA |
| `/cleaner` | Upload, inspect, configure, preview, clean, export |
| `/dashboard` | Jobs, usage, credits, account overview |
| `/pricing` | Subscription and credit plan comparison |
| `/developers` | API overview, quick start, docs |
| `/dashboard/api-keys` | Create, list, revoke API keys |
| `/dashboard/billing` | Plans, payments, invoices/receipts |
| `/auth` | Signup, login, password reset, email verification |
Also add (small, needed for compliance): `/privacy`, `/terms`, `/dashboard/settings` (profile, preferences, **request account/data deletion**).

### Primary cleaner workflow (stepper UI)
1. Upload CSV → 2. Show rows, columns, detected types, safe preview → 3. Auto-detect problems (blanks, duplicates, whitespace, mixed types, bad emails/phones/dates) → 4. Suggested operations pre-selected but user-editable → 5. Show **estimated credit usage** before processing (if applicable) → 6. Run with progress → 7. Before/after preview + transparent report → 8. Download cleaned CSV and report.
Anonymous users can do small free cleaning without registering; prompt registration for saved history, credits, larger files or API access.

## 5. DATABASE (Supabase PostgreSQL) — create real migrations

Create `supabase/migrations/0001_init.sql`, `0002_rls.sql`, `0003_functions.sql`, `0004_seed.sql`. Use the following as the required baseline and **complete** it (do not shorten). All 13 tables: `profiles, plans, subscriptions, credit_wallets, credit_transactions, credit_packages, cleaning_jobs, cleaning_reports, api_keys, api_usage, payments, webhook_events, user_preferences`.

```sql
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, full_name text, created_at timestamptz default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  monthly_price integer not null default 0,        -- paise
  monthly_credits integer not null default 0,
  max_file_size_mb integer not null default 5,
  daily_job_limit integer,                          -- null = unlimited
  api_access boolean not null default false,
  api_rate_limit_per_min integer not null default 0,
  limits jsonb not null default '{}'::jsonb,
  active boolean default true
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status text not null check (status in ('active','past_due','canceled','expired','pending')),
  provider text, provider_subscription_id text unique,
  current_period_start timestamptz, current_period_end timestamptz,
  cancel_at_period_end boolean default false, created_at timestamptz default now()
);

create table public.credit_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  subscription_balance integer not null default 0 check (subscription_balance >= 0),
  purchased_balance integer not null default 0 check (purchased_balance >= 0),
  updated_at timestamptz default now()
);

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  amount integer not null,                          -- + grant/refund, - spend
  credit_source text not null check (credit_source in ('subscription','purchased')),
  transaction_type text not null check (transaction_type in
    ('subscription_grant','purchase','reserve','commit','refund','expire','adjustment')),
  reference_id text, idempotency_key text unique,
  expires_at timestamptz, created_at timestamptz default now()
);

create table public.credit_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null, credits integer not null, price integer not null, -- paise
  currency text not null default 'INR', active boolean default true
);

create table public.cleaning_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  status text not null default 'queued'
    check (status in ('queued','processing','completed','failed','canceled','expired')),
  input_name text, input_format text check (input_format in ('csv','xlsx','json')),
  output_format text default 'csv',
  input_path text, output_path text,
  operations jsonb not null default '[]'::jsonb,
  credits_reserved integer default 0, credits_charged integer default 0,
  idempotency_key text, rows_processed integer default 0,
  error_code text, error_message text,
  created_at timestamptz default now(), completed_at timestamptz,
  input_expires_at timestamptz, output_expires_at timestamptz,
  unique (user_id, idempotency_key)
);

create table public.cleaning_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid unique references public.cleaning_jobs(id) on delete cascade,
  quality_score numeric, report_json jsonb default '{}'::jsonb
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text, key_hash text not null unique, prefix text not null,
  last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz default now()
);

create table public.api_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  api_key_id uuid references public.api_keys(id),
  endpoint text, credits_used integer default 0, status_code integer,
  created_at timestamptz default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  amount integer not null, currency text not null default 'INR',
  provider text, provider_payment_id text unique,
  kind text check (kind in ('credit_pack','subscription')),
  package_id uuid references public.credit_packages(id),
  plan_id uuid references public.plans(id),
  status text not null default 'pending'
    check (status in ('pending','paid','failed','refunded')),
  created_at timestamptz default now()
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null, event_id text not null,
  processed_at timestamptz default now(), payload_meta jsonb default '{}'::jsonb,
  unique (provider, event_id)
);

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  preferences_json jsonb not null default '{}'::jsonb
);

create index idx_jobs_user on public.cleaning_jobs(user_id, created_at desc);
create index idx_usage_user on public.api_usage(user_id, created_at desc);
create index idx_credit_tx_user on public.credit_transactions(user_id, created_at desc);
create index idx_api_keys_user on public.api_keys(user_id);
create index idx_payments_user on public.payments(user_id, created_at desc);
```

**You must also write:**
- A trigger on `auth.users` insert that creates `profiles`, a `credit_wallets` row and assigns the Free plan.
- **RLS enabled on every user-owned table.** Policies: users can `select` only their own jobs, reports (via job ownership), payments, api_keys (metadata only), api_usage, credit_wallets, credit_transactions, subscriptions, preferences; users can update only their own `profiles` and `user_preferences`. Users **cannot** insert/update/delete wallets, ledger rows, payments, subscriptions or webhook_events. `plans` and `credit_packages` are readable by all (active only). `webhook_events` has no client access.
- **Privileged, atomic SQL functions** (`security definer`, `set search_path = public`, execute granted only to `service_role`): `reserve_credits(user_id, amount, job_id, idempotency_key)` (spends subscription credits first, then purchased, row-locks the wallet, fails if insufficient), `commit_credits(job_id)`, `refund_credits(job_id)`, `grant_subscription_credits(user_id, amount, period_end)`, `grant_purchased_credits(user_id, amount, payment_id)`, `process_payment_event(provider, event_id, ...)` (inserts into `webhook_events` first; if conflict, returns "already processed"; otherwise marks payment paid and grants credits/activates subscription in ONE transaction), `expire_credits()`.
- Seed data (plans, credit packages) matching Section 8, in paise.
- Instructions for running a **two-user RLS test** (user A must not read user B's rows) and automated SQL/pytest tests for it.
- Backups and migrations workflow; no untracked production schema edits; separate dev and production Supabase projects.

## 6. DATABASE SECURITY AND AUTHORIZATION
- Service-role key is **server-side only**; never in browser bundles or `NEXT_PUBLIC_*` vars. State clearly which keys go where.
- Users cannot modify their credit balance or mark a payment as paid.
- Credit deductions/grants only via the atomic functions called by trusted backend code.
- Frontend checks are UX only; every rule is enforced server-side/in the DB.

## 7. REST API (FastAPI, base path `/v1`, bearer API key)

Base URL example: `https://api.cleandataapi.com/v1` (use a temporary host URL during beta; do not assume the domain exists).

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /files/upload | Upload dataset (multipart) → returns `file_id` |
| POST | /clean | Create cleaning job with selected operations (accepts `file_id` or inline `file`) |
| GET | /jobs/{job_id} | Job status and summary |
| GET | /jobs | List authenticated user's jobs (paginated) |
| GET | /jobs/{job_id}/report | Validation and cleaning report |
| GET | /jobs/{job_id}/download | Short-lived signed download URL |
| GET | /usage | API usage and limits |
| POST | /api-keys | Create API key (secret shown **once**) |
| GET | /api-keys | List key metadata; never return secrets/hashes |
| DELETE | /api-keys/{id} | Revoke key |
| GET | /credits | Available credits (split subscription/purchased) |
| POST | /billing/checkout | Create payment checkout session/order |
| POST | /webhooks/payments | Receive and verify payment events |
Also: `GET /health`, `GET /openapi.json`, `/docs`.

Example request:
```
POST /v1/clean
Authorization: Bearer YOUR_API_KEY
Content-Type: multipart/form-data
file: customers.csv
operations: remove_duplicates,trim_whitespace,normalize_emails
output_format: csv
```
Example response:
```json
{ "success": true, "job_id": "job_123456", "status": "queued", "message": "Your cleaning job has been created." }
```
Job status response:
```json
{ "job_id": "job_123456", "status": "completed", "rows_processed": 5000, "duplicates_removed": 120,
  "missing_values_found": 45, "quality_score": 94, "download_url": "SHORT_LIVED_SIGNED_URL" }
```

**Behaviour requirements (all mandatory):**
- Consistent JSON error format: `{ "success": false, "error": { "code": "...", "message": "...", "request_id": "..." } }` with correct HTTP codes (400, 401, 402 insufficient credits, 403, 404, 409, 413, 415, 422, 429, 500).
- Validate file type, size, encoding, operation names, output format and per-operation parameters (Pydantic).
- Async jobs for longer processing; return job ID. Small jobs may complete synchronously but still return the job object.
- **Idempotency** via `Idempotency-Key` header on `/clean`.
- **Per-key rate limits** and account-level quotas (plan-driven, 429 with `Retry-After`).
- **Check job ownership** before returning reports or downloads.
- **Short-lived signed download URLs** (e.g., 5 minutes).
- **First release accepts uploaded files only — no remote dataset URLs** (SSRF risk). If URL import is ever added: strict allowlist, DNS/IP checks, redirect control, timeouts, egress restrictions. Document this.
- API keys: cryptographically random (`secrets.token_urlsafe`), format `cd_live_<random>`, shown once, only a SHA-256 (or stronger, with server pepper) hash stored, prefix stored for display, revocation supported, `last_used_at` updated.
- Publish OpenAPI docs and Python + JavaScript quick starts on `/developers`.

## 8. PRICING AND CREDITS (hypotheses to validate — keep configurable in DB)

| Plan | Price (₹/month) | Allowance |
|---|---|---|
| Free | 0 | 3 jobs/day, 5 MB, basic cleaning, CSV export, no API |
| Starter | 299 | 100 credits/month, 25 MB, advanced cleaning, CSV/XLSX |
| Pro | 799 | 500 credits/month, 100 MB, API access, bulk processing, reports |
| Business | 1,999 | 2,000 credits/month, 250 MB, higher API limits, batch processing, priority support |

| One-time pack | Price (₹) |
|---|---|
| 10 credits | 49 |
| 50 credits | 149 |
| 150 credits | 349 |
| 500 credits | 899 |

- 1 credit = up to 1,000 rows (ceil). 5,000 rows = 5 credits; 20,000 rows = 20 credits. **Show estimated cost before processing.** Revisit if operations have different compute costs.
- Subscription and purchased credits distinguishable in the ledger (`credit_source`).
- Document: subscription credits expire monthly; purchased credits expire (default 12 months). Show expiry in the UI.
- Atomic deduction; clearly disclosed billing policy; failed jobs refunded; retries never double-charge.
- Display (on pricing page footnote or internal docs only, labelled as illustrative revenue, not profit): at ₹499 average monthly revenue — 10 customers = ₹4,990; 100 = ₹49,900; 500 = ₹2,49,500; 1,000 = ₹4,99,000.

## 9. PAYMENTS
Pick the provider via an adapter interface (`create_checkout`, `verify_webhook`, `fetch_payment`, `refund`). Reference implementation: Razorpay (Orders for credit packs; Subscriptions for plans). Tell me what I must confirm (account/business-type eligibility, countries, one-time + recurring support, fees, settlement, refunds, taxes/GST, international payments) — **do not assume**.

Flow:
```
User selects plan/pack → backend creates checkout/order (payments row 'pending')
→ provider processes → provider sends signed webhook
→ backend verifies signature (official SDK/documented method) and event identity
→ ONE idempotent DB transaction: mark paid + grant credits OR activate subscription
→ UI shows updated balance/plan
```
- **Never** grant credits from a frontend success redirect.
- Store provider event IDs; process each exactly once (unique constraint).
- Payment secrets server-side only; log metadata only.
- Provide receipts, refund handling, cancellation and subscription status management in `/dashboard/billing`.
- Write tests: duplicate webhook, invalid signature, out-of-order events, partial failure rollback.

## 10. SECURITY AND PRIVACY (implement ALL; list each control with where it's implemented)

| Area | Required control |
|---|---|
| Transport | HTTPS everywhere; secure/HttpOnly/SameSite cookies; security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors) |
| Authentication | Supabase Auth; verify JWT on server routes; email verification and password reset |
| API keys | Random secrets, show once, hashed storage, revocation |
| Database | RLS, least privilege, privileged ops server-only |
| Uploads | Check content (magic bytes / parse test), not just extension; size limits; reject malformed files; zip-bomb protection for XLSX (cap uncompressed size/entries) |
| Storage | Private buckets, random object names (UUID), short-lived signed links |
| Retention | Automatic scheduled deletion of temp files per policy; documented retention |
| CSV export | Formula-injection mitigation (Section 2D) |
| Processing | Memory/time limits; isolated jobs; no macro or formula execution (`openpyxl` with `data_only=True`, never evaluate) |
| Network | No arbitrary URL fetching; SSRF defence if ever added |
| Logging | No raw data, secrets or row contents; structured logs with request IDs |
| Payments | Signed webhooks; idempotency; server-side payment state |
| CORS | Exact production frontend origin only, from env var |

**Privacy commitments (put in UI copy, `/privacy`, and `docs/privacy.md`):** explain whether each path is browser-only or server; no customer files used to train AI models; state what account/usage metadata is collected; publish deletion and retention rules and provide a data/account deletion request flow; do **not** claim end-to-end encryption; privacy policy, terms and data-processing terms are **drafts requiring legal review** — add a visible note that generic policies are not a substitute for compliance and recommend legal advice for the target markets.

## 11. REPOSITORY STRUCTURE (create exactly; add to it where needed)

```
cleandata-api/
  frontend/
    app/
      page.tsx
      layout.tsx
      pricing/page.tsx
      cleaner/page.tsx
      dashboard/{page.tsx, api-keys/page.tsx, billing/page.tsx, settings/page.tsx}
      developers/page.tsx
      auth/page.tsx
      privacy/page.tsx
      terms/page.tsx
    components/
    lib/            (supabase client, api client, browser cleaning engine, types)
    public/
    tests/
    package.json  tailwind.config.ts  tsconfig.json  .env.example
  backend/
    app/
      main.py  config.py  database.py
      auth/
      routes/
      services/
        cleaners/{duplicates.py, missing_values.py, text_cleaner.py, date_cleaner.py,
                  phone_cleaner.py, email_cleaner.py, columns.py, empty_rows.py}
        validators/
        reports.py  scoring.py  credits.py  billing/
      workers/
      utils/
    tests/  fixtures/
    requirements.txt  .env.example  Dockerfile
  supabase/migrations/
  database/{schema.sql, policies.sql}
  docs/{api.md, privacy.md, development.md, security.md, deployment.md}
  .github/workflows/ci.yml
  .gitignore  README.md  LICENSE
```

**Engineering principles:** each cleaning operation independent, deterministic, unit-testable; preserve original input; record applied operations; one report schema and one API error format; pin dependencies; never commit secrets, production exports or user-uploaded data. Tests must cover: nulls, unusual encodings, large files, ambiguous dates, duplicate keys, malformed input, BOM, mixed delimiters, quoted newlines, formula-injection cells, empty files, header-only files, duplicate/blank header names.

## 12. PHASED IMPLEMENTATION (one phase per response; STOP after each)

**Phase 1 — Local CSV cleaner (roadmap days 1–5).** Next.js + TS + Tailwind scaffold; browser-side CSV parser (PapaParse) with encoding/delimiter detection; type detection; operations: remove_duplicates, remove_empty_rows, handle_missing_values, trim_whitespace (plus normalize_text, standardize_dates, normalize_emails, rename_columns if feasible); report object; cleaned-CSV download with formula-injection protection; unit tests (Vitest) with golden fixtures in `fixtures/`; safe failure on malformed/oversized/unsupported files. **No auth, no DB.**

**Phase 2 — Polished frontend and preview (days 6–10).** Landing page, pricing page (static data from a typed config mirroring Section 8), full `/cleaner` stepper, configuration panel, before/after diff preview, destructive-change approval, report view with quality-score breakdown, mobile responsiveness, accessibility pass. Add normalize_phone_numbers and XLSX (SheetJS or `exceljs`, no formula evaluation) on the browser path if size permits; otherwise declare XLSX server-only.

**Phase 3 — FastAPI processing API (part of days 11–15).** Complete backend: Pandas cleaners mirroring the browser engine, validators, reports/scoring, XLSX via openpyxl, `/files/upload`, `/clean`, `/jobs*`, `/health`, standard errors, size/content validation, rate-limit middleware, retention cleanup job, pytest suite that runs the **same golden fixtures** as the frontend. Frontend gets a typed API client (and a "server processing" toggle for larger files). Provide OpenAPI contract and TypeScript types.

**Phase 4 — Supabase auth and history (days 11–15).** Migrations 0001–0004, RLS, profile trigger, `/auth` page (signup, login, reset, email verification), protected dashboard, job history, download history, preferences, account deletion request, RLS tests with two users, JWT verification in FastAPI.

**Phase 5 — Credits and payments (days 16–21).** Credit reserve/commit/refund functions wired into job lifecycle, estimated-cost UI, ledger UI, plans/packs, provider adapter + Razorpay reference, checkout, verified idempotent webhooks, billing page (receipts, cancel, status), failure/refund tests.

**Phase 6 — Public API keys, metering, docs and hardening (days 16–21).** API-key management UI + backend auth, per-key rate limits, `/usage`, `/credits`, `/developers` docs with Python and JavaScript examples, OpenAPI polish, security headers, CI workflow, security test checklist, deployment, policy drafts, beta launch checklist, metrics instrumentation hooks (Section 14).

> The 21-day schedule is an ambitious solo-founder target, not a guarantee. A working, tested CSV cleaner takes priority over incomplete billing or dashboard features.

## 13. DEPLOYMENT (provide exact steps and files in the final phase; mention in earlier phases as relevant)
1. Create GitHub monorepo; protect `main`; add CI (lint, type-check, tests).
2. Deploy `frontend/` to Vercel; set env vars (public vs server-only clearly separated).
3. Create Supabase projects (dev + prod); apply migrations; run RLS tests; configure private storage bucket and auth redirect URLs.
4. Deploy FastAPI (Dockerfile) to a Python-capable host; **check** sleep/cold-start behaviour, memory, CPU, request timeouts, and commercial-use terms — do not assume free tiers allow either.
5. Configure CORS to the exact frontend origin.
6. Configure retention cleanup (scheduled job), signed downloads, health checks, structured logs, error reporting (e.g., Sentry placeholder), usage limits.
7. Run end-to-end tests before inviting beta users.
8. Use temporary host subdomains for beta; no domain assumed.

Budget target ₹0 for development and a small beta using free tiers (GitHub, Vercel, Supabase, local Python, open-source libs). Warn me that free tiers may limit processing, sleep, or restrict commercial use.

### Environment variables (provide `.env.example` with placeholders only)
Frontend: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_APP_URL`.
Backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`, `API_KEY_PEPPER`, `ALLOWED_ORIGIN`, `STORAGE_BUCKET`, `MAX_UPLOAD_MB_DEFAULT`, `MAX_ROWS_DEFAULT`, `SIGNED_URL_TTL_SECONDS`, `INPUT_RETENTION_HOURS`, `OUTPUT_RETENTION_DAYS`, `PAYMENT_PROVIDER`, `PAYMENT_KEY_ID`, `PAYMENT_KEY_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `SENTRY_DSN`, `ENVIRONMENT`.

## 14. METRICS (instrument as events/tables; no sensitive data)
Landing visitors and signup conversion; **first successful cleaning rate (north-star activation)**; jobs per user; repeat usage and weekly retention; free-to-paid conversion and MRR; API request volume and active API customers; processing cost per 1,000 rows; failed-job rate, latency, support requests; refunds, churn, payment failures. 90-day learning targets (not guarantees): 500 registered users, 100 weekly active, 20 paying, 5 active API customers.

## 15. SEO AND LAUNCH (Phase 2/6 content)
Create genuinely useful, distinct tool pages (each with a working feature or real guidance, no thin duplicates): Free CSV Cleaner, Remove Duplicate Rows from CSV, Excel Data Cleaner, CSV Email Validator, Phone Number Format Validator, CSV to JSON Converter, CSV Data Validation API, Bulk CSV Processing API, Remove Empty Rows from Excel. Add metadata, sitemap, OpenGraph tags. Provide a launch checklist covering Product Hunt, Reddit (follow community rules), GitHub, LinkedIn, YouTube, Hacker News (Show HN only when ready) and developer communities.

## 16. SCOPE CONTROL
**Build in MVP:** CSV upload/preview, duplicate detection, missing-value detection and handling, whitespace/text/date normalization, basic validation report, cleaned CSV download, basic job history, reliable tests, safe processing.
**Defer (do not build; do not add AI for marketing):** AI-powered cleaning, ML anomaly detection, enterprise SSO, team collaboration, multi-cloud integrations, Zapier, advanced analytics, real-time collaborative editing. Make CSV cleaning excellent first.

## 17. ACCEPTANCE CRITERIA FOR VERSION 1 (verify explicitly at the end of Phases 1–3 and report pass/fail)
- [ ] Upload a valid CSV and see a safe preview of rows/columns.
- [ ] Blank values and duplicate rows detected accurately.
- [ ] User selects operations and previews their effects.
- [ ] Original file unchanged; cleaned output is a separate artifact.
- [ ] Download a valid cleaned CSV.
- [ ] Report lists operations, rows before/after, duplicate counts, missing counts, warnings.
- [ ] Malformed, oversized, unsupported files fail safely with clear messages.
- [ ] Works on desktop and mobile.
- [ ] Automated tests cover core transformations and edge cases.
- [ ] No customer file content or secrets in logs.

## 18. OPEN FOUNDER DECISIONS (do not silently assume; list them with your recommended default at the end of Phase 1 and ask me)
Brand/domain/trademark; CSV-only vs CSV+XLSX for v1; row/file limits after performance tests; exact credit calculation and whether failed jobs consume credits; retention durations; payment gateway eligibility; whether API is in Pro or sold separately; supported phone regions and date-ambiguity handling; legal terms and target-country privacy requirements.

## 19. FINAL DIRECTION
Build one reliable cleaning engine with two ways to use it: a simple web app for people and a documented REST API for developers. Lead with trustworthy results, transparent transformations and privacy-conscious processing. The first milestone is a **working, deployable CSV cleaner** — not a landing page, dashboard mockup or payment screen.

**Now begin: output the Reconciliation (conflicts, assumptions, what runs here vs. needs the separate FastAPI backend), then deliver Phase 1 in full, then STOP and wait for "Proceed".**

## ===== END PROMPT =====
