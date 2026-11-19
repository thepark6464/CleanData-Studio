-- CleanData API: 0004_seed.sql
-- Seed plans and one-time credit packages in INR paise matching Section 8.

insert into public.plans (
  name, monthly_price, monthly_credits, max_file_size_mb, daily_job_limit, api_access, api_rate_limit_per_min, limits, active
) values
  (
    'Free', 0, 0, 5, 3, false, 0,
    '{"exports": ["csv"], "browser_unlimited_mb": 5}'::jsonb, true
  ),
  (
    'Starter', 29900, 100, 25, null, false, 0,
    '{"exports": ["csv", "xlsx"]}'::jsonb, true
  ),
  (
    'Pro', 79900, 500, 100, null, true, 60,
    '{"exports": ["csv", "xlsx", "json"]}'::jsonb, true
  ),
  (
    'Business', 199900, 2000, 250, null, true, 240,
    '{"exports": ["csv", "xlsx", "json"], "priority_support": true}'::jsonb, true
  )
on conflict (name) do update set
  monthly_price = excluded.monthly_price,
  monthly_credits = excluded.monthly_credits,
  max_file_size_mb = excluded.max_file_size_mb,
  daily_job_limit = excluded.daily_job_limit,
  api_access = excluded.api_access,
  api_rate_limit_per_min = excluded.api_rate_limit_per_min,
  limits = excluded.limits,
  active = excluded.active;

insert into public.credit_packages (name, credits, price, currency, active)
select v.name, v.credits, v.price, 'INR', true
from (
  values
    ('10 Credits', 10, 4900),
    ('50 Credits', 50, 14900),
    ('150 Credits', 150, 34900),
    ('500 Credits', 500, 89900)
) as v(name, credits, price)
where not exists (
  select 1 from public.credit_packages cp where cp.name = v.name
);
