import { describe, expect, it } from 'vitest';
import { MERCHANT_INFO } from '../config/merchant';
import { normalizeRoute } from '../lib/router';

describe('Cashfree merchant verification pages & routes', () => {
  it('resolves all public compliance and merchant info routes cleanly', () => {
    expect(normalizeRoute('/about')).toBe('/about');
    expect(normalizeRoute('/about-us')).toBe('/about');
    expect(normalizeRoute('/contact')).toBe('/contact');
    expect(normalizeRoute('/contact-us')).toBe('/contact');
    expect(normalizeRoute('/support')).toBe('/contact');
    expect(normalizeRoute('/privacy')).toBe('/privacy');
    expect(normalizeRoute('/privacy-policy')).toBe('/privacy');
    expect(normalizeRoute('/terms')).toBe('/terms');
    expect(normalizeRoute('/terms-and-conditions')).toBe('/terms');
    expect(normalizeRoute('/terms-of-service')).toBe('/terms');
    expect(normalizeRoute('/refund-policy')).toBe('/refund-policy');
    expect(normalizeRoute('/refunds')).toBe('/refund-policy');
    expect(normalizeRoute('/refund-and-cancellation-policy')).toBe('/refund-policy');
    expect(normalizeRoute('/cancellation-policy')).toBe('/refund-policy');
  });

  it('exposes the verified merchant legal identity without email or phone', () => {
    expect(MERCHANT_INFO.legalName).toBe('PATHAN RAYYAN KHAN');
    expect(MERCHANT_INFO.websiteUrl).toBe('https://cleandata-studio.vercel.app/');
    expect('contactEmail' in MERCHANT_INFO).toBe(false);
    expect('contactPhone' in MERCHANT_INFO).toBe(false);
  });
});
