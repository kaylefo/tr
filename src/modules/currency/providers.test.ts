import { describe, expect, it } from 'vitest';
import {
  compareRates,
  normalizeFawazResponse,
  normalizeFrankfurterResponse,
} from './providers';

describe('providers', () => {
  it('normalizes fawaz response', () => {
    const result = normalizeFawazResponse(
      { date: '2026-07-13', jpy: { usd: 0.00617 } },
      'fawaz-jsdelivr',
      'Fawaz Currency API',
    );
    expect(result.rate.rate).toBe(0.00617);
    expect(result.rate.providerSourceDate).toBe('2026-07-13');
  });

  it('rejects invalid fawaz response', () => {
    expect(() => normalizeFawazResponse({}, 'x', 'x')).toThrow();
    expect(() =>
      normalizeFawazResponse({ date: '2026-07-13', jpy: { usd: -1 } }, 'x', 'x'),
    ).toThrow();
  });

  it('normalizes frankfurter response', () => {
    const result = normalizeFrankfurterResponse({
      date: '2026-07-13',
      rates: { USD: 0.00617 },
    });
    expect(result.rate.providerId).toBe('frankfurter');
  });

  it('detects source divergence', () => {
    expect(compareRates(0.00617, 0.00618)).toBeLessThan(0.01);
    expect(compareRates(0.00617, 0.007)).toBeGreaterThan(0.01);
  });
});
