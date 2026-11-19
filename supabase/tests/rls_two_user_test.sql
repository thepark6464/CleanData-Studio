-- Two-User RLS Isolation Verification Test (PostgreSQL / Supabase)
-- Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_two_user_test.sql

begin;

-- Create two synthetic auth.users rows to trigger profiles, wallets, preferences, and Free plans
insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'usera@example.com', '{"full_name": "User A"}'),
  ('22222222-2222-2222-2222-222222222222', 'userb@example.com', '{"full_name": "User B"}')
on conflict (id) do nothing;

-- Seed a job and report owned by User B (via privileged session)
insert into public.cleaning_jobs (id, user_id, status, input_name, input_format, output_format)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222',
  'completed',
  'secret_b.csv',
  'csv',
  'csv'
) on conflict (id) do nothing;

insert into public.cleaning_reports (job_id, quality_score, report_json)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  95.0,
  '{"rowsBefore": 10}'::jsonb
) on conflict (job_id) do nothing;

-- Impersonate User A as authenticated role
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  v_count integer;
begin
  -- 1. User A must NOT see User B's profile, wallet, jobs, or reports
  select count(*) into v_count from public.profiles where id = '22222222-2222-2222-2222-222222222222';
  if v_count <> 0 then raise exception 'RLS_FAIL: User A read User B profile'; end if;

  select count(*) into v_count from public.credit_wallets where user_id = '22222222-2222-2222-2222-222222222222';
  if v_count <> 0 then raise exception 'RLS_FAIL: User A read User B wallet'; end if;

  select count(*) into v_count from public.cleaning_jobs where user_id = '22222222-2222-2222-2222-222222222222';
  if v_count <> 0 then raise exception 'RLS_FAIL: User A read User B jobs'; end if;

  select count(*) into v_count from public.cleaning_reports where job_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  if v_count <> 0 then raise exception 'RLS_FAIL: User A read User B reports'; end if;

  -- 2. User A CAN read own profile and wallet
  select count(*) into v_count from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  if v_count <> 1 then raise exception 'RLS_FAIL: User A could not read own profile'; end if;

  -- 3. User A MUST NOT be able to mutate credit_wallets directly
  begin
    update public.credit_wallets set purchased_balance = 9999 where user_id = '11111111-1111-1111-1111-111111111111';
    get diagnostics v_count = row_count;
    if v_count > 0 then raise exception 'RLS_FAIL: User A updated own wallet directly'; end if;
  exception when insufficient_privilege then
    -- expected
  end;
end;
$$;

rollback;
