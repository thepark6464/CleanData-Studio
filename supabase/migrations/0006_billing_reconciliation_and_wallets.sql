-- CleanData API: 0006_billing_reconciliation_and_wallets.sql
-- Hardens webhook_events auditability, retry-safe idempotency, wallet upserts,
-- and missing-record reconciliation support for Cashfree PG & Subscriptions.

alter table public.webhook_events
  add column if not exists event_type text,
  add column if not exists processing_status text,
  add column if not exists processing_result jsonb not null default '{}'::jsonb;

-- Ensure wallet rows exist on credit grants (self-heals pre-trigger auth users).
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
  insert into public.credit_wallets (
    user_id, subscription_balance, purchased_balance, subscription_expires_at, updated_at
  ) values (
    p_user_id, greatest(coalesce(p_amount, 0), 0), 0, p_period_end, now()
  )
  on conflict (user_id) do update
  set subscription_balance = greatest(coalesce(p_amount, 0), 0),
      subscription_expires_at = p_period_end,
      updated_at = now();

  insert into public.credit_transactions (
    user_id, amount, credit_source, transaction_type, expires_at
  ) values (
    p_user_id, greatest(coalesce(p_amount, 0), 0), 'subscription', 'subscription_grant', p_period_end
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
  insert into public.credit_wallets (
    user_id, subscription_balance, purchased_balance, purchased_expires_at, updated_at
  ) values (
    p_user_id, 0, greatest(coalesce(p_amount, 0), 0), v_expiry, now()
  )
  on conflict (user_id) do update
  set purchased_balance = public.credit_wallets.purchased_balance + greatest(coalesce(p_amount, 0), 0),
      purchased_expires_at = greatest(coalesce(public.credit_wallets.purchased_expires_at, v_expiry), v_expiry),
      updated_at = now();

  insert into public.credit_transactions (
    user_id, amount, credit_source, transaction_type, reference_id, idempotency_key, expires_at
  ) values (
    p_user_id,
    greatest(coalesce(p_amount, 0), 0),
    'purchased',
    'purchase',
    p_payment_id::text,
    'purchase:' || p_payment_id::text,
    v_expiry
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

-- Update process_payment_event to record event_type & processing_result and allow safe retry
-- if an earlier attempt returned payment_not_found before reconciliation.
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
  v_webhook_row public.webhook_events%rowtype;
  v_payment public.payments%rowtype;
  v_pack public.credit_packages%rowtype;
  v_plan public.plans%rowtype;
  v_period_end timestamptz := now() + interval '1 month';
  v_meta_amount integer;
  v_meta_currency text;
  v_cf_payment_id text;
  v_wallet public.credit_wallets%rowtype;
  v_revoke integer := 0;
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

  if v_webhook_row.processing_status in ('processed', 'ignored', 'amount_mismatch', 'currency_mismatch', 'ignored_stale_failure') then
    return jsonb_build_object('status', 'already_processed');
  end if;

  select * into v_payment
  from public.payments
  where provider_payment_id = p_provider_payment_id
     or provider_order_id = p_provider_payment_id
  order by created_at desc
  limit 1
  for update;

  if not found then
    v_result := jsonb_build_object('status', 'payment_not_found');
    update public.webhook_events
    set processing_status = 'payment_not_found',
        processing_result = v_result,
        processed_at = now()
    where id = v_webhook_row.id;
    return v_result;
  end if;

  v_cf_payment_id := nullif(coalesce(p_payload_meta ->> 'cf_payment_id', ''), '');

  if p_status = 'paid' then
    v_meta_currency := upper(nullif(coalesce(p_payload_meta ->> 'currency', ''), ''));
    if v_meta_currency is not null and v_meta_currency <> upper(v_payment.currency) then
      v_result := jsonb_build_object(
        'status', 'currency_mismatch',
        'expected_currency', v_payment.currency,
        'received_currency', v_meta_currency
      );
      update public.webhook_events
      set processing_status = 'currency_mismatch',
          processing_result = v_result,
          processed_at = now()
      where id = v_webhook_row.id;
      return v_result;
    end if;

    if (p_payload_meta ? 'amount_paise') and nullif(p_payload_meta ->> 'amount_paise', '') is not null then
      v_meta_amount := (p_payload_meta ->> 'amount_paise')::integer;
      if v_meta_amount <> v_payment.amount then
        v_result := jsonb_build_object(
          'status', 'amount_mismatch',
          'expected_amount_paise', v_payment.amount,
          'received_amount_paise', v_meta_amount
        );
        update public.webhook_events
        set processing_status = 'amount_mismatch',
            processing_result = v_result,
            processed_at = now()
        where id = v_webhook_row.id;
        return v_result;
      end if;
    end if;
  end if;

  if v_payment.status in ('paid', 'refunded') and p_status = 'failed' then
    v_result := jsonb_build_object('status', 'ignored_stale_failure', 'payment_id', v_payment.id);
    update public.webhook_events
    set processing_status = 'ignored_stale_failure',
        processing_result = v_result,
        processed_at = now()
    where id = v_webhook_row.id;
    return v_result;
  end if;

  update public.payments
  set status = p_status,
      provider_reference_id = coalesce(v_cf_payment_id, provider_reference_id),
      updated_at = now()
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
        set status = 'canceled', updated_at = now()
        where user_id = v_payment.user_id and status = 'active';

        insert into public.subscriptions (
          user_id, plan_id, status, provider, current_period_start, current_period_end, last_credited_at, last_credited_payment_id
        ) values (
          v_payment.user_id, v_plan.id, 'active', p_provider, now(), v_period_end, now(), v_cf_payment_id
        );
        perform public.grant_subscription_credits(v_payment.user_id, v_plan.monthly_credits, v_period_end);
      end if;
    end if;
  elsif p_status = 'refunded' and v_payment.status = 'paid' then
    if v_payment.kind = 'credit_pack' and v_payment.package_id is not null then
      select * into v_pack from public.credit_packages where id = v_payment.package_id;
      if found and not exists (
        select 1 from public.credit_transactions where idempotency_key = 'refund_revoke:' || v_payment.id::text
      ) then
        select * into v_wallet from public.credit_wallets where user_id = v_payment.user_id for update;
        if found then
          v_revoke := least(v_wallet.purchased_balance, v_pack.credits);
          if v_revoke > 0 then
            update public.credit_wallets
            set purchased_balance = purchased_balance - v_revoke,
                updated_at = now()
            where user_id = v_payment.user_id;

            insert into public.credit_transactions (
              user_id, amount, credit_source, transaction_type, reference_id, idempotency_key
            ) values (
              v_payment.user_id, -v_revoke, 'purchased', 'adjustment', v_payment.id::text, 'refund_revoke:' || v_payment.id::text
            )
            on conflict (idempotency_key) do nothing;
          end if;
        end if;
      end if;
    end if;
  end if;

  v_result := jsonb_build_object('status', 'processed', 'payment_id', v_payment.id);
  update public.webhook_events
  set processing_status = 'processed',
      processing_result = v_result,
      processed_at = now()
  where id = v_webhook_row.id;

  return v_result;
end;
$$;

-- Update process_subscription_event to track processing_status/processing_result,
-- allow retry after reconciliation if subscription_not_found occurred, and keep
-- subscription + wallet grants atomic.
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

    -- Settle initial pending payment row if present, or backfill a settled payment row if missing.
    update public.payments
    set status = 'paid',
        provider_reference_id = coalesce(nullif(p_provider_payment_id, ''), provider_reference_id),
        updated_at = now()
    where (provider_payment_id = p_subscription_id or provider_order_id = p_subscription_id)
      and status = 'pending';

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

    -- Log distinct recurring payment transactions without overwriting the initial subscription row
    if nullif(p_provider_payment_id, '') is not null and p_provider_payment_id <> p_subscription_id then
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

    if v_sub.last_credited_at is null then
      v_should_credit := true;
    elsif nullif(p_provider_payment_id, '') is not null
      and coalesce(v_sub.last_credited_payment_id, '') <> p_provider_payment_id
      and (now() - v_sub.last_credited_at) > interval '12 hours' then
      v_should_credit := true;
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

revoke all on function public.grant_subscription_credits(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.grant_subscription_credits(uuid, integer, timestamptz) to service_role;

revoke all on function public.grant_purchased_credits(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.grant_purchased_credits(uuid, integer, uuid) to service_role;

revoke all on function public.process_payment_event(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.process_payment_event(text, text, text, text, jsonb) to service_role;

revoke all on function public.process_subscription_event(text, text, text, text, text, integer, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.process_subscription_event(text, text, text, text, text, integer, text, timestamptz, jsonb) to service_role;
