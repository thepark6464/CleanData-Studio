# Local Development Guide

This guide covers running **CleanData Studio** (React + Vite), **CleanData API** (FastAPI), Supabase migrations/RLS verification, and automated test suites.

---

## Prerequisites

* **Node.js** 20+ and `npm`
* **Python** 3.11+ and `pip`
* Optional for persistent accounts & billing: **Supabase** project (PostgreSQL + Auth + Storage) and **Razorpay** test credentials

---

## 1. Frontend Workbench Setup

```bash
# Install JavaScript dependencies
npm install

# Copy public env template if integrating Supabase or FastAPI
cp .env.example .env

# Run TypeScript check, Vitest golden-fixture suite, and production build
npm run lint
npm test
npm run build

# Start development server on port 3000
npm run dev
```

* Keep `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_BASE_URL` in `.env`.
* **Never** place `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `API_KEY_PEPPER`, or payment secrets into `VITE_*` variables.

---

## 2. Backend FastAPI Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Copy backend env template
cp .env.example .env

# Run pytest suite (cleaning parity, auth/JWT, credits/billing, API keys/security)
pytest -v

# Start FastAPI on port 8000
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 3. Supabase Database & RLS Verification

Apply the ordered SQL migrations inside `/supabase/migrations/`:

1. `0001_init.sql` (13 core tables & indexes)
2. `0002_rls.sql` (strict Row Level Security policies)
3. `0003_functions.sql` (`reserve_credits`, `commit_credit_reservation`, `refund_credit_reservation`, `process_payment_event`, `cleanup_expired_artifacts`)
4. `0004_seed.sql` (INR `plans` and `credit_packages` seed data)

Consolidated snapshots are also maintained in `/database/schema.sql` and `/database/policies.sql`.

Run the two-user RLS isolation verification script against a local/staging Postgres instance:

```bash
psql "$DATABASE_URL" -f supabase/tests/rls_two_user_test.sql
```

---

## 4. Golden Fixtures & Cross-Engine Parity

Deterministic cleaning behavior is verified across both TypeScript (Vitest) and Python (Pytest) using shared datasets in `/fixtures/`:

* `messy_customers.csv`
* `messy_orders.csv`
* `formula_injection.csv`
* `encoding_edge.csv`
