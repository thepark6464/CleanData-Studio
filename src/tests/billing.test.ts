import { afterEach, describe, expect, it, vi } from 'vitest';
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from '../config/pricing';
import { CleanDataApiClient, CleanDataApiError } from '../lib/api/client';
import { resolveBillingDisplayState } from '../lib/billing/displayState';

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

  it('creates Cashfree PG order session, verifies payment server-side, fetches summary, and cancels subscription', async () => {
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
            provider_subscription_id: 'cd_sub_7ca9fa3d69e7452c',
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
            provider_subscription_id: 'cd_sub_7ca9fa3d69e7452c',
            cancel_at_period_end: false,
            monthly_price_paise: 79900,
            monthly_credits: 500,
            max_file_size_mb: 100,
            daily_job_limit: null,
            api_access: true,
            api_rate_limit_per_min: 60,
            current_period_end: '2026-07-01T00:00:00Z',
          },
          transactions: [],
          payments: [
            {
              id: 'pay-sub-1',
              amount_paise: 79900,
              currency: 'INR',
              provider: 'cashfree',
              provider_payment_id: 'cd_sub_7ca9fa3d69e7452c',
              kind: 'subscription',
              item_name: 'Pro',
              status: 'paid',
              created_at: '2026-06-01T00:00:00Z',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          subscription_id: 'cd_sub_7ca9fa3d69e7452c',
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
      subscription_id: 'cd_sub_7ca9fa3d69e7452c',
    });
    expect(verified.status).toBe('active');
    expect(verified.subscription.plan_name).toBe('Pro');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/billing/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          kind: 'subscription',
          subscription_id: 'cd_sub_7ca9fa3d69e7452c',
        }),
      }),
    );

    const summary = await client.getBillingSummary();
    expect(summary.subscription.plan_name).toBe('Pro');
    expect(summary.payments[0]?.item_name).toBe('Pro');
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/billing/summary',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer supabase-jwt-token',
        }),
      }),
    );

    const canceled = await client.cancelSubscription();
    expect(canceled.status).toBe('canceled');
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/billing/subscription/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces backend error codes clearly when subscription ownership or DB checks fail', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error: {
          code: 'SUBSCRIPTION_OWNERSHIP_MISMATCH',
          message: 'This Cashfree subscription is linked to a different user account.',
          request_id: 'req_123',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new CleanDataApiClient('/api', 'supabase-jwt-token');
    await expect(
      client.verifyCheckout({
        kind: 'subscription',
        subscription_id: 'cd_sub_7ca9fa3d69e7452c',
      }),
    ).rejects.toMatchObject({
      name: 'CleanDataApiError',
      status: 403,
      code: 'SUBSCRIPTION_OWNERSHIP_MISMATCH',
      requestId: 'req_123',
    });
  });

  it('preserves structured 503/500 envelopes and x-request-id header fallback on non-JSON 500s', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers({ 'x-request-id': 'req_hdr_503' }),
        json: async () => ({
          success: false,
          error: {
            code: 'BILLING_MIGRATION_MISSING',
            message: 'Billing database tables or RPC functions are missing or outdated.',
            request_id: 'req_env_503',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'x-request-id': 'req_hdr_500' }),
        json: async () => {
          throw new SyntaxError('Unexpected token A in JSON');
        },
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new CleanDataApiClient('/api', 'supabase-jwt-token');

    await expect(client.getBillingSummary()).rejects.toMatchObject({
      name: 'CleanDataApiError',
      status: 503,
      code: 'BILLING_MIGRATION_MISSING',
      requestId: 'req_env_503',
    });

    await expect(client.getBillingSummary()).rejects.toMatchObject({
      name: 'CleanDataApiError',
      status: 500,
      code: 'HTTP_500',
      message: 'Server returned HTTP 500.',
      requestId: 'req_hdr_500',
    });
  });

  it('distinguishes billing sync error from confirmed Free Tier and supports retry recovery', () => {
    const errorState = resolveBillingDisplayState({
      billingStatus: 'error',
      isDataLoading: false,
      billingError: 'Server returned HTTP 500.',
      billingErrorDetail: {
        code: 'HTTP_500',
        message: 'Server returned HTTP 500.',
        status: 500,
        requestId: 'req_500',
      },
      activePlan: null,
      wallet: null,
      transactions: [],
      payments: [],
    });

    expect(errorState.phase).toBe('error');
    expect(errorState.isSyncUnavailable).toBe(true);
    expect(errorState.badgeLabel).toBe('Sync unavailable');
    expect(errorState.planDisplayName).toBe('Temporarily unavailable');
    expect(errorState.subscriptionCreditsText).toBe('—');
    expect(errorState.purchasedCreditsText).toBe('—');
    expect(errorState.totalCreditsText).toBe('—');
    expect(errorState.errorCode).toBe('HTTP_500');
    expect(errorState.errorRequestId).toBe('req_500');
    expect(errorState.paymentsEmptyMessage).toContain('temporarily unavailable');

    const freeTierState = resolveBillingDisplayState({
      billingStatus: 'loaded',
      isDataLoading: false,
      billingError: null,
      billingErrorDetail: null,
      activePlan: {
        name: 'Free',
        monthly_price: 0,
        monthly_credits: 0,
        max_file_size_mb: 5,
        daily_job_limit: 3,
        api_access: false,
        api_rate_limit_per_min: 0,
        status: 'free',
        current_period_end: null,
      },
      wallet: {
        user_id: 'u1',
        subscription_balance: 0,
        purchased_balance: 0,
        subscription_expires_at: null,
        purchased_expires_at: null,
        updated_at: '2026-06-01T00:00:00Z',
      },
      transactions: [],
      payments: [],
    });

    expect(freeTierState.phase).toBe('loaded');
    expect(freeTierState.isSyncUnavailable).toBe(false);
    expect(freeTierState.badgeLabel).toBe('Free Tier');
    expect(freeTierState.planDisplayName).toBe('Free');
    expect(freeTierState.subscriptionCreditsText).toBe('0');
    expect(freeTierState.purchasedCreditsText).toBe('0');
    expect(freeTierState.paymentsEmptyMessage).toBe('No Cashfree payment sessions created yet.');

    const recoveredProState = resolveBillingDisplayState({
      billingStatus: 'loaded',
      isDataLoading: false,
      billingError: null,
      billingErrorDetail: null,
      activePlan: {
        name: 'Pro',
        monthly_price: 79900,
        monthly_credits: 500,
        max_file_size_mb: 100,
        daily_job_limit: null,
        api_access: true,
        api_rate_limit_per_min: 60,
        status: 'active',
        provider: 'cashfree',
        provider_subscription_id: 'cd_sub_1',
        current_period_end: '2026-07-01T00:00:00Z',
      },
      wallet: {
        user_id: 'u1',
        subscription_balance: 500,
        purchased_balance: 50,
        subscription_expires_at: '2026-07-01T00:00:00Z',
        purchased_expires_at: '2027-06-01T00:00:00Z',
        updated_at: '2026-06-01T00:00:00Z',
      },
      transactions: [],
      payments: [],
    });

    expect(recoveredProState.phase).toBe('loaded');
    expect(recoveredProState.badgeLabel).toBe('Subscription active');
    expect(recoveredProState.planDisplayName).toBe('Pro');
    expect(recoveredProState.subscriptionCreditsText).toBe('500');
    expect(recoveredProState.purchasedCreditsText).toBe('50');
    expect(recoveredProState.totalCreditsText).toBe('550');
  });
});

