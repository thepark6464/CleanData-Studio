# Production Deployment, Backup & Launch Runbook

---

## 1. Environment & Infrastructure Checklist

### Frontend (Vite SPA — Port 3000 / Vercel)
* Build static assets with `npm run build` (`dist/`).
* Configure public build variables only:
  * `VITE_API_BASE_URL` (optional; defaults to `/api` in production builds)
  * `VITE_SUPABASE_URL`
  * `VITE_SUPABASE_ANON_KEY`

### Backend (FastAPI — Docker / Vercel Multi-Service)
* **Critical for multi-service Vercel deployments:** Backend services do not automatically inherit `VITE_SUPABASE_URL` or variables assigned only to the frontend service. Explicitly configure `SUPABASE_URL` (for ES256 JWKS verification via `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) on the FastAPI backend Vercel project for **both Production and Preview** environments and trigger a fresh deployment.
* Set `ENVIRONMENT=production` and `ALLOWED_ORIGIN` to the exact HTTPS frontend origin (`https://cleandata-studio.vercel.app`).
* Provide strong, distinct 32+ byte random secrets:
  * `API_KEY_PEPPER`
  * `DOWNLOAD_SIGNING_SECRET`
  * `SUPABASE_SERVICE_ROLE_KEY`
  * `SUPABASE_JWT_SECRET` (optional legacy HS256 fallback)
  * `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_WEBHOOK_SECRET`
  * `CASHFREE_ENV` (`sandbox` for testing, `production` only after full end-to-end verification)
  * `CASHFREE_API_VERSION` (e.g., `2025-01-01`)
* Provision private storage (`STORAGE_BUCKET=cleandata-private`) with public access disabled.

### Cashfree Dashboard & Webhook Configuration
* Full step-by-step setup instructions (API keys, Subscriptions activation, webhook tabs, Sandbox/Production promotion): see [`docs/cashfree-setup.md`](./cashfree-setup.md).
* **Payment Gateway Webhooks**: Register `https://cleandata-studio.vercel.app/api/v1/webhooks/payments` under **Payment Gateway → Developers → Webhooks** for payment success, failure, and refund events.
* **Cashfree Subscriptions Activation & Webhooks**: Confirm **Cashfree Subscriptions** (recurring UPI AutoPay / Cards / eNACH mandates) is enabled on your Cashfree merchant account and register the same `https://cleandata-studio.vercel.app/api/v1/webhooks/payments` endpoint under the **Subscriptions** webhook tab (`SUBSCRIPTION_STATUS_CHANGED`, `SUBSCRIPTION_PAYMENT_SUCCESS`, `SUBSCRIPTION_PAYMENT_FAILED`).
* Signatures are verified via Base64 HMAC-SHA256 over `x-webhook-timestamp` + raw request body using `CASHFREE_WEBHOOK_SECRET` (or `CASHFREE_SECRET_KEY`). Never place Cashfree credentials in `VITE_*` variables.

### Supabase Auth Dashboard Configuration
* Under **Authentication → URL Configuration**:
  * Site URL: `https://cleandata-studio.vercel.app`
  * Redirect URLs: `https://cleandata-studio.vercel.app/auth`, `https://cleandata-studio.vercel.app/auth/callback`, `http://localhost:3000/auth`
* Swagger documentation is mounted at `/api/docs` with OpenAPI schema at `/api/openapi.json` (docs routes use a route-scoped CSP permitting `https://cdn.jsdelivr.net`, while API routes enforce `default-src 'none'`).

---

## 2. Retention Worker & Scheduled Cleanup

Schedule an hourly or daily cron job / Supabase pg_cron task to invoke `cleanup_expired_artifacts()`:

* Purges raw uploaded inputs older than `INPUT_RETENTION_HOURS` (`24h`).
* Purges output artifacts older than `OUTPUT_RETENTION_DAYS` (`7d`) and transitions job status to `expired`.
* Removes expired signed-download and stale rate-limit entries.

---

## 3. Backup & Restore Runbook

1. **Automated Daily Backups**: Enable daily Point-in-Time Recovery (PITR) or scheduled `pg_dump --format=custom` snapshots of Supabase PostgreSQL to encrypted backup storage.
2. **Ledger & Subscription Integrity**: Because `credit_ledger` and `credit_reservations` are append-only/auditable, restore tests verify that `sum(wallet balances)` matches active reservations and settled payments without double-crediting.
3. **Restore Drill**: Restore into an isolated staging database (`pg_restore`), re-run `supabase/tests/rls_two_user_test.sql`, and verify `/health` and `/health/metrics` before cutover.

---

## 4. Observability & Health Checks

* **Liveness**: `GET /health` -> `200 {"status":"ok","service":"cleandata-api","version":"1.0.0"}`
* **Metrics**: `GET /health/metrics` -> non-PII uptime, completed/failed job counters, active upload count.
* **CORS**: Verify `ALLOWED_ORIGIN` matches the deployed frontend domain exactly (no wildcard `*` in production).

---

## 5. Final Launch Verification Checklist

- [ ] Browser-local cleaning tested on CSV and XLSX up to 5 MB with zero network file upload.
- [ ] `npm run lint`, `npm test`, and `npm run build` exit `0`.
- [ ] `pytest -v` passes all cleaning parity, JWT auth, billing/credit, and API key/security suites.
- [ ] Supabase migrations `0001`–`0005` applied and `supabase/tests/rls_two_user_test.sql` passes.
- [ ] Cashfree Sandbox/Production webhook URLs registered for `/api/v1/webhooks/payments` (both PG and Subscriptions tabs) with `CASHFREE_WEBHOOK_SECRET` and Subscriptions enabled on merchant account.
- [ ] `ENVIRONMENT=production` verified so HSTS, CSP, `Permissions-Policy`, and `nosniff` headers are active.
- [ ] Retention cleanup cron job active for 24h inputs / 7d outputs.
