-- CleanData API: Consolidated Row Level Security Policies
-- Mirrors /supabase/migrations/0002_rls.sql.

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.credit_packages enable row level security;
alter table public.cleaning_jobs enable row level security;
alter table public.cleaning_reports enable row level security;
alter table public.api_keys enable row level security;
alter table public.api_usage enable row level security;
alter table public.payments enable row level security;
alter table public.webhook_events enable row level security;
alter table public.user_preferences enable row level security;

create policy "plans_select_active"
  on public.plans for select
  to anon, authenticated
  using (active = true);

create policy "credit_packages_select_active"
  on public.credit_packages for select
  to anon, authenticated
  using (active = true);

create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "user_preferences_select_own"
  on public.user_preferences for select
  to authenticated
  using (auth.uid() = user_id);

create policy "user_preferences_insert_own"
  on public.user_preferences for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "user_preferences_update_own"
  on public.user_preferences for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "subscriptions_select_own"
  on public.subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

create policy "credit_wallets_select_own"
  on public.credit_wallets for select
  to authenticated
  using (auth.uid() = user_id);

create policy "credit_transactions_select_own"
  on public.credit_transactions for select
  to authenticated
  using (auth.uid() = user_id);

create policy "cleaning_jobs_select_own"
  on public.cleaning_jobs for select
  to authenticated
  using (auth.uid() = user_id);

create policy "cleaning_reports_select_own"
  on public.cleaning_reports for select
  to authenticated
  using (
    exists (
      select 1
      from public.cleaning_jobs j
      where j.id = cleaning_reports.job_id
        and j.user_id = auth.uid()
    )
  );

create policy "api_keys_select_own"
  on public.api_keys for select
  to authenticated
  using (auth.uid() = user_id);

revoke select on public.api_keys from anon, authenticated;
grant select (id, user_id, name, prefix, last_used_at, revoked_at, created_at)
  on public.api_keys to authenticated;

create policy "api_usage_select_own"
  on public.api_usage for select
  to authenticated
  using (auth.uid() = user_id);

create policy "payments_select_own"
  on public.payments for select
  to authenticated
  using (auth.uid() = user_id);
