-- CleanData API: 0007_billing_cycle1_payment_dedup_and_expiry_guard.sql
-- Minimal additive patch on top of 0001..0006:
-- 1) Prevents Cycle-1 subscription verification/webhook settlement from inserting
--    a duplicate `payments` row when `p_provider_payment_id` differs from `p_subscription_id`
--    (while preserving distinct `payments` rows for Month 2+ renewals).
-- 2) Guards `reserve_credits` directly against expired subscription/purchased wallet
--    timestamps inside the `FOR UPDATE` row lock even if lazy `expire_credits()` failed.

create or replace function public.process_subscription_event(
  p_provider text,
  p_event_id text,
  p_subscription_id text,
  p_event_kind text,
  p_provider_payment_id text default null,
  p_amount_paise integer default null,
  p_currency text default 'INR',
  p_period_end timestamptz default null,
  p_payload_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_webhook_row public.webhook_events%rowtype;
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_pending_pay public.payments%rowtype;
  v_user_id uuid;
  v_plan_id uuid;
  v_period_end timestamptz;
  v_should_credit boolean := false;
  v_is_renewal_cycle boolean := false;
  v_cf_sub_id text;
  v_provider_plan_id text;
  v_wallet public.credit_wallets%rowtype;
  v_superseded jsonb := '[]'::jsonb;
  v_event_type text;
  v_result jsonb;
begin
  v_event_type := nullif(coalesce(p_payload_meta ->> 'event', ''), '');

  insert into public.webhook_events (provider, event_id, event_type, processing_status, payload_meta)
  values (p_provider, p_event_id, v_event_type, 'processing', coalesce(p_payload_meta, '{}'::jsonb))
  on conflict (provider, event_id) do nothing;

  select * into v_webhook_row
  from public.webhook_events
  where provider = p_provider and event_id = p_event_id
  for update;

  if v_webhook_row.processing_status in ('processed', 'ignored', 'amount_mismatch', 'currency_mismatch') then
    return jsonb_build_object('status', 'already_processed');
  end if;

  select * into v_sub
  from public.subscriptions
  where provider_subscription_id = p_subscription_id
  for update;

  if not found then
    select * into v_pending_pay
    from public.payments
    where provider_payment_id = p_subscription_id
       or provider_order_id = p_subscription_id
    order by created_at desc
    limit 1
    for update;

    if not found or v_pending_pay.plan_id is null then
      v_result := jsonb_build_object('status', 'subscription_not_found');
      update public.webhook_events
      set processing_status = 'subscription_not_found',
          processing_result = v_result,
          processed_at = now()
      where id = v_webhook_row.id;
      return v_result;
    end if;

    v_user_id := v_pending_pay.user_id;
    v_plan_id := v_pending_pay.plan_id;

    insert into public.subscriptions (
      user_id, plan_id, status, provider, provider_subscription_id,
      cf_subscription_id, provider_plan_id
    ) values (
      v_user_id,
      v_plan_id,
      'pending',
      p_provider,
      p_subscription_id,
      nullif(coalesce(p_payload_meta ->> 'cf_subscription_id', ''), ''),
      nullif(coalesce(p_payload_meta ->> 'provider_plan_id', ''), '')
    )
    returning * into v_sub;
  end if;

  select * into v_plan from public.plans where id = v_sub.plan_id;
  if not found then
    v_result := jsonb_build_object('status', 'plan_not_found');
    update public.webhook_events
    set processing_status = 'plan_not_found',
        processing_result = v_result,
        processed_at = now()
    where id = v_webhook_row.id;
    return v_result;
  end if;

  v_cf_sub_id := nullif(coalesce(p_payload_meta ->> 'cf_subscription_id', ''), '');
  v_provider_plan_id := nullif(coalesce(p_payload_meta ->> 'provider_plan_id', ''), '');
  v_period_end := coalesce(p_period_end, now() + interval '1 month');

  if p_event_kind in ('activated', 'renewal_paid') then
    if p_currency is not null and upper(p_currency) <> 'INR' then
      v_result := jsonb_build_object('status', 'currency_mismatch', 'received_currency', p_currency);
      update public.webhook_events
      set processing_status = 'currency_mismatch',
          processing_result = v_result,
          processed_at = now()
      where id = v_webhook_row.id;
      return v_result;
    end if;
    if p_amount_paise is not null and p_amount_paise > 0 and p_amount_paise <> v_plan.monthly_price then
      v_result := jsonb_build_object(
        'status', 'amount_mismatch',
        'expected_amount_paise', v_plan.monthly_price,
        'received_amount_paise', p_amount_paise
      );
      update public.webhook_events
      set processing_status = 'amount_mismatch',
          processing_result = v_result,
          processed_at = now()
      where id = v_webhook_row.id;
      return v_result;
    end if;

    if v_sub.last_credited_at is null then
      v_should_credit := true;
    elsif nullif(p_provider_payment_id, '') is not null
      and coalesce(v_sub.last_credited_payment_id, '') <> p_provider_payment_id
      and (now() - v_sub.last_credited_at) > interval '12 hours' then
      v_should_credit := true;
      v_is_renewal_cycle := true;
    end if;

    -- Settle Cycle-1 checkout payment row (and attach cf_payment_id when a delayed
    -- SUBSCRIPTION_PAYMENT_SUCCESS arrives shortly after SUBSCRIPTION_ACTIVATED).
    update public.payments
    set status = 'paid',
        provider_reference_id = coalesce(nullif(p_provider_payment_id, ''), provider_reference_id),
        updated_at = now()
    where (provider_payment_id = p_subscription_id or provider_order_id = p_subscription_id)
      and (
        status = 'pending'
        or (
          not v_is_renewal_cycle
          and provider_reference_id is null
          and nullif(p_provider_payment_id, '') is not null
        )
      );

    if not exists (
      select 1 from public.payments
      where provider_payment_id = p_subscription_id or provider_order_id = p_subscription_id
    ) then
      insert into public.payments (
        user_id, amount, currency, provider, provider_payment_id, provider_order_id,
        provider_reference_id, kind, plan_id, status
      ) values (
        v_sub.user_id, v_plan.monthly_price, 'INR', p_provider, p_subscription_id,
        p_subscription_id, nullif(p_provider_payment_id, ''), 'subscription', v_plan.id, 'paid'
      )
      on conflict (provider_payment_id) do update
      set status = 'paid',
          provider_reference_id = coalesce(excluded.provider_reference_id, public.payments.provider_reference_id),
          updated_at = now();
    end if;

    -- Insert distinct recurring payment ledger rows ONLY for Month 2+ renewal cycles
    -- (when v_sub.last_credited_at was already set in an earlier billing cycle).
    if v_is_renewal_cycle
      and nullif(p_provider_payment_id, '') is not null
      and p_provider_payment_id <> p_subscription_id then
      insert into public.payments (
        user_id, amount, currency, provider, provider_payment_id, provider_order_id,
        provider_reference_id, kind, plan_id, status
      ) values (
        v_sub.user_id, v_plan.monthly_price, 'INR', p_provider, p_provider_payment_id,
        p_subscription_id, p_provider_payment_id, 'subscription', v_plan.id, 'paid'
      )
      on conflict (provider_payment_id) do update
      set status = 'paid',
          provider_order_id = excluded.provider_order_id,
          updated_at = now();
    end if;

    select coalesce(jsonb_agg(provider_subscription_id), '[]'::jsonb) into v_superseded
    from public.subscriptions
    where user_id = v_sub.user_id
      and id <> v_sub.id
      and status in ('active', 'past_due')
      and provider = 'cashfree'
      and provider_subscription_id is not null;

    update public.subscriptions
    set status = 'canceled',
        cancel_at_period_end = true,
        updated_at = now()
    where user_id = v_sub.user_id
      and id <> v_sub.id
      and status in ('active', 'past_due');

    update public.subscriptions
    set status = 'active',
        cf_subscription_id = coalesce(v_cf_sub_id, cf_subscription_id),
        provider_plan_id = coalesce(v_provider_plan_id, provider_plan_id),
        cancel_at_period_end = false,
        current_period_start = case when v_should_credit or current_period_start is null then now() else current_period_start end,
        current_period_end = case when v_should_credit or current_period_end is null then v_period_end else current_period_end end,
        last_credited_at = case when v_should_credit then now() else last_credited_at end,
        last_credited_payment_id = coalesce(nullif(p_provider_payment_id, ''), last_credited_payment_id),
        updated_at = now()
    where id = v_sub.id;

    if v_should_credit then
      perform public.grant_subscription_credits(v_sub.user_id, v_plan.monthly_credits, v_period_end);
    end if;

    v_result := jsonb_build_object(
      'status', 'processed',
      'subscription_id', v_sub.id,
      'subscription_status', 'active',
      'credited', v_should_credit,
      'superseded_subscription_ids', v_superseded
    );
    update public.webhook_events
    set processing_status = 'processed',
        processing_result = v_result,
        processed_at = now()
    where id = v_webhook_row.id;
    return v_result;

  elsif p_event_kind = 'payment_failed' then
    update public.payments
    set status = 'failed',
        provider_reference_id = coalesce(nullif(p_provider_payment_id, ''), provider_reference_id),
        updated_at = now()
    where (provider_payment_id = p_subscription_id or provider_order_id = p_subscription_id)
      and status = 'pending';

    if nullif(p_provider_payment_id, '') is not null and p_provider_payment_id <> p_subscription_id then
      insert into public.payments (
        user_id, amount, currency, provider, provider_payment_id, provider_order_id,
        provider_reference_id, kind, plan_id, status
      ) values (
        v_sub.user_id, v_plan.monthly_price, 'INR', p_provider, p_provider_payment_id,
        p_subscription_id, p_provider_payment_id, 'subscription', v_plan.id, 'failed'
      )
      on conflict (provider_payment_id) do nothing;
    end if;

    update public.subscriptions
    set status = case when v_sub.status = 'pending' then 'canceled' else 'past_due' end,
        cf_subscription_id = coalesce(v_cf_sub_id, cf_subscription_id),
        provider_plan_id = coalesce(v_provider_plan_id, provider_plan_id),
        updated_at = now()
    where id = v_sub.id;

    v_result := jsonb_build_object(
      'status', 'processed',
      'subscription_id', v_sub.id,
      'subscription_status', case when v_sub.status = 'pending' then 'canceled' else 'past_due' end
    );
    update public.webhook_events
    set processing_status = 'processed',
        processing_result = v_result,
        processed_at = now()
    where id = v_webhook_row.id;
    return v_result;

  elsif p_event_kind = 'canceled' then
    update public.payments
    set status = 'failed', updated_at = now()
    where (provider_payment_id = p_subscription_id or provider_order_id = p_subscription_id)
      and status = 'pending';

    update public.subscriptions
    set status = 'canceled',
        cancel_at_period_end = true,
        cf_subscription_id = coalesce(v_cf_sub_id, cf_subscription_id),
        provider_plan_id = coalesce(v_provider_plan_id, provider_plan_id),
        updated_at = now()
    where id = v_sub.id;

    v_result := jsonb_build_object('status', 'processed', 'subscription_id', v_sub.id, 'subscription_status', 'canceled');
    update public.webhook_events
    set processing_status = 'processed',
        processing_result = v_result,
        processed_at = now()
    where id = v_webhook_row.id;
    return v_result;

  elsif p_event_kind = 'expired' then
    update public.subscriptions
    set status = 'expired',
        cf_subscription_id = coalesce(v_cf_sub_id, cf_subscription_id),
        provider_plan_id = coalesce(v_provider_plan_id, provider_plan_id),
        updated_at = now()
    where id = v_sub.id;

    select * into v_wallet from public.credit_wallets where user_id = v_sub.user_id for update;
    if found and v_wallet.subscription_balance > 0 then
      insert into public.credit_transactions (user_id, amount, credit_source, transaction_type, reference_id)
      values (v_sub.user_id, -v_wallet.subscription_balance, 'subscription', 'expire', p_subscription_id);

      update public.credit_wallets
      set subscription_balance = 0,
          subscription_expires_at = now(),
          updated_at = now()
      where user_id = v_sub.user_id;
    end if;

    v_result := jsonb_build_object('status', 'processed', 'subscription_id', v_sub.id, 'subscription_status', 'expired');
    update public.webhook_events
    set processing_status = 'processed',
        processing_result = v_result,
        processed_at = now()
    where id = v_webhook_row.id;
    return v_result;
  end if;

  v_result := jsonb_build_object('status', 'ignored', 'subscription_id', v_sub.id);
  update public.webhook_events
  set processing_status = 'ignored',
      processing_result = v_result,
      processed_at = now()
  where id = v_webhook_row.id;
  return v_result;
end;
$$;

-- Atomic credit reservation with built-in expiry enforcement under row lock:
-- spends valid subscription credits first, then valid purchased credits.
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

  -- Expire stale balances atomically inside the lock if lazy expire_credits() has not run
  if v_wallet.subscription_balance > 0
     and v_wallet.subscription_expires_at is not null
     and v_wallet.subscription_expires_at <= now() then
    insert into public.credit_transactions (
      user_id, amount, credit_source, transaction_type, reference_id
    ) values (
      p_user_id, -v_wallet.subscription_balance, 'subscription', 'expire', p_job_id::text
    );
    v_wallet.subscription_balance := 0;
  end if;

  if v_wallet.purchased_balance > 0
     and v_wallet.purchased_expires_at is not null
     and v_wallet.purchased_expires_at <= now() then
    insert into public.credit_transactions (
      user_id, amount, credit_source, transaction_type, reference_id
    ) values (
      p_user_id, -v_wallet.purchased_balance, 'purchased', 'expire', p_job_id::text
    );
    v_wallet.purchased_balance := 0;
  end if;

  if (v_wallet.subscription_balance + v_wallet.purchased_balance) < p_amount then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  v_sub_spend := least(v_wallet.subscription_balance, p_amount);
  v_pur_spend := p_amount - v_sub_spend;

  update public.credit_wallets
  set subscription_balance = v_wallet.subscription_balance - v_sub_spend,
      purchased_balance = v_wallet.purchased_balance - v_pur_spend,
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

revoke all on function public.process_subscription_event(text, text, text, text, text, integer, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.process_subscription_event(text, text, text, text, text, integer, text, timestamptz, jsonb) to service_role;

revoke all on function public.reserve_credits(uuid, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid, integer, uuid, text) to service_role;
