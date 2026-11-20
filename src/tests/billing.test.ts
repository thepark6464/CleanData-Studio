import { afterEach, describe, expect, it, vi } from 'vitest';
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from '../config/pricing';
import { CleanDataApiClient } from '../lib/api/client';

describe('Pricing catalog & Cashfree billing API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves exact INR subscription plans and one-time credit packs', () => {
    expect(SUBSCRIPTION_PLANS.map((p) => [p.name, p.monthlyPricePaise, p.monthlyCredits])).toEqual([
      ['Free', 0, null],
      ['Starter', 29900, 100],
      ['Pro', 79900, 500],
      ['Business', 199900, 2000],
    ]);

    expect(CREDIT_PACKS.map((p) => [p.name, p.credits, p.pricePaise])).toEqual([
      ['10 Credits', 10, 4900],
      ['50 Credits', 50, 14900],
      ['150 Credits', 150, 34900],
      ['500 Credits', 500, 89900],
    ]);
  });

  it('creates Cashfree PG order session, verifies payment server-side, and cancels subscription', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          payment_id: 'pay-1',
          provider: 'cashfree',
          order_id: 'cd_ord_abc',
          subscription_id: null,
          payment_session_id: 'session_pg_abc',
          subscription_session_id: null,
          cashfree_mode: 'sandbox',
          amount_paise: 14900,
          currency: 'INR',
          kind: 'credit_pack',
          item_name: '50 Credits',
          message: 'Created',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          kind: 'subscription',
          status: 'active',
          item_name: 'Pro',
          wallet: {
            subscription_balance: 500,
            purchased_balance: 50,
            total_balance: 550,
            subscription_expires_at: '2026-07-01T00:00:00Z',
            purchased_expires_at: '2027-06-01T00:00:00Z',
          },
          subscription: {
            plan_name: 'Pro',
            status: 'active',
            provider: 'cashfree',
            provider_subscription_id: 'cd_sub_1',
            cancel_at_period_end: false,
            monthly_price_paise: 79900,
            monthly_credits: 500,
            max_file_size_mb: 100,
            daily_job_limit: null,
            api_access: true,
            api_rate_limit_per_min: 60,
            current_period_end: '2026-07-01T00:00:00Z',
          },
          message: 'Subscription active',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          subscription_id: 'cd_sub_1',
          status: 'canceled',
          plan_name: 'Pro',
          message: 'Cancelled',
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const client = new CleanDataApiClient('/api', 'supabase-jwt-token');
    const checkout = await client.createCheckout({
      kind: 'credit_pack',
      item_name: '50 Credits',
      customer_phone: '9876543210',
    });

    expect(checkout.provider).toBe('cashfree');
    expect(checkout.payment_session_id).toBe('session_pg_abc');
    expect(checkout.cashfree_mode).toBe('sandbox');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/billing/checkout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer supabase-jwt-token',
          'Content-Type': 'application/json',
        }),
      }),
    );

    const verified = await client.verifyCheckout({
      kind: 'subscription',
      subscription_id: 'cd_sub_1',
    });
    expect(verified.status).toBe('active');
    expect(verified.subscription.plan_name).toBe('Pro');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/billing/verify',
      expect.objectContaining({ method: 'POST' }),
    );

    const canceled = await client.cancelSubscription();
    expect(canceled.status).toBe('canceled');
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/billing/subscription/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
