-- CleanData API: Consolidated Database Schema
-- Mirrors /supabase/migrations/0001_init.sql and /supabase/migrations/0003_functions.sql.
-- Apply incremental changes via /supabase/migrations/ rather than editing production directly.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  deletion_requested_at timestamptz,
  deletion_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  monthly_price integer not null default 0,
  monthly_credits integer not null default 0,
  max_file_size_mb integer not null default 5,
  daily_job_limit integer,
  api_access boolean not null default false,
  api_rate_limit_per_min integer not null default 0,
  limits jsonb not null default '{}'::jsonb,
  active boolean not null default true
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status text not null check (status in ('active','past_due','canceled','expired','pending')),
  provider text,
  provider_subscription_id text unique,
  cf_subscription_id text,
  provider_plan_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_credited_at timestamptz,
  last_credited_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  subscription_balance integer not null default 0 check (subscription_balance >= 0),
  purchased_balance integer not null default 0 check (purchased_balance >= 0),
  subscription_expires_at timestamptz,
  purchased_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  credit_source text not null check (credit_source in ('subscription','purchased')),
  transaction_type text not null check (transaction_type in
    ('subscription_grant','purchase','reserve','commit','refund','expire','adjustment')),
  reference_id text,
  idempotency_key text unique,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.credit_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  credits integer not null check (credits > 0),
  price integer not null check (price >= 0),
  currency text not null default 'INR',
  active boolean not null default true
);

create table if not exists public.cleaning_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','failed','canceled','expired')),
  input_name text,
  input_format text check (input_format in ('csv','xlsx','json')),
  output_format text not null default 'csv',
  input_path text,
  output_path text,
  operations jsonb not null default '[]'::jsonb,
  credits_reserved integer not null default 0,
  credits_charged integer not null default 0,
  idempotency_key text,
  rows_processed integer not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  input_expires_at timestamptz,
  output_expires_at timestamptz,
  unique (user_id, idempotency_key)
);

create table if not exists public.cleaning_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid unique not null references public.cleaning_jobs(id) on delete cascade,
  quality_score numeric,
  report_json jsonb not null default '{}'::jsonb
);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text,
  key_hash text not null unique,
  prefix text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.api_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  endpoint text,
  credits_used integer not null default 0,
  status_code integer,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  currency text not null default 'INR',
  provider text,
  provider_payment_id text unique,
  provider_order_id text,
  provider_reference_id text,
  kind text check (kind in ('credit_pack','subscription')),
  package_id uuid references public.credit_packages(id),
  plan_id uuid references public.plans(id),
  status text not null default 'pending'
    check (status in ('pending','paid','failed','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text,
  processing_status text,
  processing_result jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  payload_meta jsonb not null default '{}'::jsonb,
  unique (provider, event_id)
);

create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  preferences_json jsonb not null default '{}'::jsonb
);

create index if not exists idx_jobs_user on public.cleaning_jobs(user_id, created_at desc);
create index if not exists idx_usage_user on public.api_usage(user_id, created_at desc);
create index if not exists idx_credit_tx_user on public.credit_transactions(user_id, created_at desc);
create index if not exists idx_api_keys_user on public.api_keys(user_id);
create index if not exists idx_payments_user on public.payments(user_id, created_at desc);
create index if not exists idx_subscriptions_user on public.subscriptions(user_id, created_at desc);
