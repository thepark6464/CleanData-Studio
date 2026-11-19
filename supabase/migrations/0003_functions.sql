-- CleanData API: 0003_functions.sql
-- Signup trigger + privileged atomic credit & payment functions (service_role only).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_free_plan_id uuid;
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;

  insert into public.credit_wallets (user_id, subscription_balance, purchased_balance)
  values (new.id, 0, 0)
  on conflict (user_id) do nothing;

  insert into public.user_preferences (user_id, preferences_json)
  values (
    new.id,
    '{"dayFirst": true, "dateFormat": "YYYY-MM-DD", "phoneRegion": "IN", "formulaProtection": true}'::jsonb
  )
  on conflict (user_id) do nothing;

  select id into v_free_plan_id
  from public.plans
  where name = 'Free' and active = true
  limit 1;

  if v_free_plan_id is not null then
    insert into public.subscriptions (
      user_id, plan_id, status, provider, current_period_start
    )
    values (new.id, v_free_plan_id, 'active', 'system', now());
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Atomic credit reservation: spends subscription credits first, then purchased credits.
create or replace function public.reserve_credits(
  p_user_id uuid,
  p_amount integer,
  p_job_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.credit_wallets%rowtype;
  v_sub_spend integer := 0;
  v_pur_spend integer := 0;
begin
  if p_amount <= 0 then
    return jsonb_build_object('status', 'ok', 'reserved', 0);
  end if;

  -- Idempotency check
  if p_idempotency_key is not null and exists (
    select 1 from public.credit_transactions
    where idempotency_key = p_idempotency_key || ':sub'
       or idempotency_key = p_idempotency_key || ':pur'
  ) then
    return jsonb_build_object('status', 'already_reserved', 'reserved', p_amount);
  end if;

  select * into v_wallet
  from public.credit_wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'WALLET_NOT_FOUND';
  end if;

  if (v_wallet.subscription_balance + v_wallet.purchased_balance) < p_amount then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  v_sub_spend := least(v_wallet.subscription_balance, p_amount);
  v_pur_spend := p_amount - v_sub_spend;

  update public.credit_wallets
  set subscription_balance = subscription_balance - v_sub_spend,
      purchased_balance = purchased_balance - v_pur_spend,
      updated_at = now()
  where user_id = p_user_id;

  if v_sub_spend > 0 then
    insert into public.credit_transactions (
      user_id, amount, credit_source, transaction_type, reference_id, idempotency_key
    ) values (
      p_user_id, -v_sub_spend, 'subscription', 'reserve', p_job_id::text,
      case when p_idempotency_key is not null then p_idempotency_key || ':sub' else null end
    );
  end if;

  if v_pur_spend > 0 then
    insert into public.credit_transactions (
      user_id, amount, credit_source, transaction_type, reference_id, idempotency_key
    ) values (
      p_user_id, -v_pur_spend, 'purchased', 'reserve', p_job_id::text,
      case when p_idempotency_key is not null then p_idempotency_key || ':pur' else null end
    );
  end if;

  update public.cleaning_jobs
  set credits_reserved = p_amount
  where id = p_job_id and user_id = p_user_id;

  return jsonb_build_object(
    'status', 'reserved',
    'reserved', p_amount,
    'subscription_spent', v_sub_spend,
    'purchased_spent', v_pur_spend
  );
end;
$$;

-- Commit reserved credits upon successful job completion
create or replace function public.commit_credits(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.cleaning_jobs%rowtype;
begin
  select * into v_job
  from public.cleaning_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;

  if v_job.credits_charged > 0 or v_job.credits_reserved = 0 then
    return jsonb_build_object('status', 'noop', 'charged', v_job.credits_charged);
  end if;

  update public.cleaning_jobs
  set credits_charged = credits_reserved
  where id = p_job_id;

  insert into public.credit_transactions (
    user_id, amount, credit_source, transaction_type, reference_id, idempotency_key
  ) values (
    v_job.user_id, 0, 'subscription', 'commit', p_job_id::text, 'commit:' || p_job_id::text
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('status', 'committed', 'charged', v_job.credits_reserved);
end;
$$;

-- Refund reserved credits back to original credit_source on failure
create or replace function public.refund_credits(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.cleaning_jobs%rowtype;
  v_sub_refund integer := 0;
  v_pur_refund integer := 0;
begin
  select * into v_job
  from public.cleaning_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.credit_transactions
    where reference_id = p_job_id::text and transaction_type = 'refund'
  ) then
    return jsonb_build_object('status', 'already_refunded');
  end if;

  select coalesce(sum(-amount), 0) into v_sub_refund
  from public.credit_transactions
  where reference_id = p_job_id::text
    and transaction_type = 'reserve'
    and credit_source = 'subscription';

  select coalesce(sum(-amount), 0) into v_pur_refund
  from public.credit_transactions
  where reference_id = p_job_id::text
    and transaction_type = 'reserve'
    and credit_source = 'purchased';

  if (v_sub_refund + v_pur_refund) = 0 then
    return jsonb_build_object('status', 'nothing_to_refund');
  end if;

  perform 1 from public.credit_wallets where user_id = v_job.user_id for update;

  update public.credit_wallets
  set subscription_balance = subscription_balance + v_sub_refund,
      purchased_balance = purchased_balance + v_pur_refund,
      updated_at = now()
  where user_id = v_job.user_id;

  if v_sub_refund > 0 then
    insert into public.credit_transactions (
      user_id, amount, credit_source, transaction_type, reference_id, idempotency_key
    ) values (
      v_job.user_id, v_sub_refund, 'subscription', 'refund', p_job_id::text, 'refund_sub:' || p_job_id::text
    );
  end if;

  if v_pur_refund > 0 then
    insert into public.credit_transactions (
      user_id, amount, credit_source, transaction_type, reference_id, idempotency_key
    ) values (
      v_job.user_id, v_pur_refund, 'purchased', 'refund', p_job_id::text, 'refund_pur:' || p_job_id::text
    );
  end if;

  update public.cleaning_jobs
  set credits_reserved = 0, credits_charged = 0
  where id = p_job_id;

  return jsonb_build_object(
    'status', 'refunded',
    'subscription_refunded', v_sub_refund,
    'purchased_refunded', v_pur_refund
  );
end;
$$;

create or replace function public.grant_subscription_credits(
  p_user_id uuid,
  p_amount integer,
  p_period_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.credit_wallets where user_id = p_user_id for update;
  update public.credit_wallets
  set subscription_balance = p_amount,
      subscription_expires_at = p_period_end,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_transactions (
    user_id, amount, credit_source, transaction_type, expires_at
  ) values (
    p_user_id, p_amount, 'subscription', 'subscription_grant', p_period_end
  );
end;
$$;

create or replace function public.grant_purchased_credits(
  p_user_id uuid,
  p_amount integer,
  p_payment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expiry timestamptz := now() + interval '12 months';
begin
  perform 1 from public.credit_wallets where user_id = p_user_id for update;
  update public.credit_wallets
  set purchased_balance = purchased_balance + p_amount,
      purchased_expires_at = greatest(coalesce(purchased_expires_at, v_expiry), v_expiry),
      updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_transactions (
    user_id, amount, credit_source, transaction_type, reference_id, idempotency_key, expires_at
  ) values (
    p_user_id, p_amount, 'purchased', 'purchase', p_payment_id::text, 'purchase:' || p_payment_id::text, v_expiry
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

create or replace function public.process_payment_event(
  p_provider text,
  p_event_id text,
  p_provider_payment_id text,
  p_status text,
  p_payload_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_id uuid;
  v_payment public.payments%rowtype;
  v_pack public.credit_packages%rowtype;
  v_plan public.plans%rowtype;
  v_period_end timestamptz := now() + interval '1 month';
begin
  insert into public.webhook_events (provider, event_id, payload_meta)
  values (p_provider, p_event_id, coalesce(p_payload_meta, '{}'::jsonb))
  on conflict (provider, event_id) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return jsonb_build_object('status', 'already_processed');
  end if;

  select * into v_payment
  from public.payments
  where provider_payment_id = p_provider_payment_id
  for update;

  if not found then
    return jsonb_build_object('status', 'payment_not_found');
  end if;

  update public.payments
  set status = p_status
  where id = v_payment.id;

  if p_status = 'paid' and v_payment.status <> 'paid' then
    if v_payment.kind = 'credit_pack' and v_payment.package_id is not null then
      select * into v_pack from public.credit_packages where id = v_payment.package_id;
      if found then
        perform public.grant_purchased_credits(v_payment.user_id, v_pack.credits, v_payment.id);
      end if;
    elsif v_payment.kind = 'subscription' and v_payment.plan_id is not null then
      select * into v_plan from public.plans where id = v_payment.plan_id;
      if found then
        update public.subscriptions
        set status = 'canceled'
        where user_id = v_payment.user_id and status = 'active';

        insert into public.subscriptions (
          user_id, plan_id, status, provider, current_period_start, current_period_end
        ) values (
          v_payment.user_id, v_plan.id, 'active', p_provider, now(), v_period_end
        );
        perform public.grant_subscription_credits(v_payment.user_id, v_plan.monthly_credits, v_period_end);
      end if;
    end if;
  end if;

  return jsonb_build_object('status', 'processed', 'payment_id', v_payment.id);
end;
$$;

create or replace function public.expire_credits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.credit_wallets%rowtype;
  v_expired integer := 0;
begin
  for v_row in
    select * from public.credit_wallets
    where (subscription_balance > 0 and subscription_expires_at is not null and subscription_expires_at <= now())
       or (purchased_balance > 0 and purchased_expires_at is not null and purchased_expires_at <= now())
    for update
  loop
    if v_row.subscription_balance > 0 and v_row.subscription_expires_at is not null and v_row.subscription_expires_at <= now() then
      insert into public.credit_transactions (user_id, amount, credit_source, transaction_type)
      values (v_row.user_id, -v_row.subscription_balance, 'subscription', 'expire');
      update public.credit_wallets set subscription_balance = 0, updated_at = now() where user_id = v_row.user_id;
      v_expired := v_expired + 1;
    end if;
    if v_row.purchased_balance > 0 and v_row.purchased_expires_at is not null and v_row.purchased_expires_at <= now() then
      insert into public.credit_transactions (user_id, amount, credit_source, transaction_type)
      values (v_row.user_id, -v_row.purchased_balance, 'purchased', 'expire');
      update public.credit_wallets set purchased_balance = 0, updated_at = now() where user_id = v_row.user_id;
      v_expired := v_expired + 1;
    end if;
  end loop;
  return v_expired;
end;
$$;

-- Restrict privileged credit/payment functions to service_role only
revoke all on function public.reserve_credits(uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.commit_credits(uuid) from public, anon, authenticated;
revoke all on function public.refund_credits(uuid) from public, anon, authenticated;
revoke all on function public.grant_subscription_credits(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.grant_purchased_credits(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.process_payment_event(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.expire_credits() from public, anon, authenticated;

grant execute on function public.reserve_credits(uuid, integer, uuid, text) to service_role;
grant execute on function public.commit_credits(uuid) to service_role;
grant execute on function public.refund_credits(uuid) to service_role;
grant execute on function public.grant_subscription_credits(uuid, integer, timestamptz) to service_role;
grant execute on function public.grant_purchased_credits(uuid, integer, uuid) to service_role;
grant execute on function public.process_payment_event(text, text, text, text, jsonb) to service_role;
grant execute on function public.expire_credits() to service_role;
