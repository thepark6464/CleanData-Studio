import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  consumeIntendedRoute,
  normalizeRoute,
  setIntendedRoute,
} from '../lib/router';
import { CleanDataApiClient, CleanDataApiError, getApiBaseUrl } from '../lib/api/client';

describe('Auth routing and intended route persistence', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { pathname: '/' },
        sessionStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, val: string) => store.set(key, val),
          removeItem: (key: string) => store.delete(key),
        },
      },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('maps auth and account route aliases to canonical AppRoute paths', () => {
    expect(normalizeRoute('/login')).toBe('/auth');
    expect(normalizeRoute('/signin')).toBe('/auth');
    expect(normalizeRoute('/signup')).toBe('/auth');
    expect(normalizeRoute('/reset-password')).toBe('/auth');
    expect(normalizeRoute('/auth/callback')).toBe('/auth');
    expect(normalizeRoute('/settings')).toBe('/dashboard/settings');
    expect(normalizeRoute('/billing')).toBe('/dashboard/billing');
    expect(normalizeRoute('/api-keys')).toBe('/dashboard/api-keys');
    expect(normalizeRoute('/dashboard/')).toBe('/dashboard');
    expect(normalizeRoute('/non-existent-route')).toBe('/404');
  });

  it('stores and consumes protected intended routes while ignoring /auth', () => {
    expect(consumeIntendedRoute()).toBe('/dashboard');

    setIntendedRoute('/dashboard/settings');
    expect(consumeIntendedRoute()).toBe('/dashboard/settings');
    expect(consumeIntendedRoute('/dashboard')).toBe('/dashboard');

    setIntendedRoute('/auth');
    expect(consumeIntendedRoute('/dashboard')).toBe('/dashboard');
  });

  it('defaults getApiBaseUrl to /api when VITE_API_BASE_URL is unset', () => {
    const apiBase = getApiBaseUrl();
    expect(apiBase).toBe('/api');
  });

  it('fetches /api/usage with Bearer token and parses rate limit metrics', async () => {
    const mockPayload = {
      success: true,
      plan_name: 'Pro',
      api_access: true,
      rate_limit_per_min: 60,
      remaining_rate_limit: 57,
      requests_used_current_window: 3,
      rate_limit_window_seconds: 60,
      rate_limit_reset_in_seconds: 44,
      rate_limit: {
        limit_per_min: 60,
        used: 3,
        remaining: 57,
        window_seconds: 60,
        reset_in_seconds: 44,
      },
      total_requests_logged: 12,
      total_credits_used: 8,
      items: [],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockPayload,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new CleanDataApiClient('/api', 'jwt-access-token');
    const result = await client.getDashboardUsage();

    expect(fetchMock).toHaveBeenCalledWith('/api/usage', {
      headers: { Authorization: 'Bearer jwt-access-token' },
    });
    expect(result.remaining_rate_limit).toBe(57);
    expect(result.rate_limit?.limit_per_min).toBe(60);
    expect(result.total_credits_used).toBe(8);
  });

  it('surfaces CleanDataApiError when /api/usage returns HTTP 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Valid Bearer JWT or cd_live_ API key authentication is required.',
          request_id: 'req_123',
        },
      }),
    }) as unknown as typeof fetch;

    const client = new CleanDataApiClient('https://cleandata-studio.vercel.app', 'bad-token');
    await expect(client.getDashboardUsage()).rejects.toMatchObject({
      name: 'CleanDataApiError',
      status: 401,
      code: 'UNAUTHORIZED',
    } satisfies Partial<CleanDataApiError>);
  });
});
