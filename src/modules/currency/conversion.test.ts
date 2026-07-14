import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  convertAmount,
  formatJpy,
  formatUsd,
  parseSanitizedAmount,
  sanitizeCurrencyInput,
  computeFreshness,
  getRateStatusLabel,
} from './conversion';

describe('conversion', () => {
  it('converts JPY to USD', () => {
    const result = convertAmount({
      amount: new Decimal(1000),
      direction: 'JPY_TO_USD',
      rate: 0.00617,
      feePercent: 0,
    });
    expect(result.outputAmount.toNumber()).toBeCloseTo(6.17, 2);
  });

  it('converts USD to JPY', () => {
    const result = convertAmount({
      amount: new Decimal(10),
      direction: 'USD_TO_JPY',
      rate: 0.00617,
      feePercent: 0,
    });
    expect(result.outputAmount.toNumber()).toBeCloseTo(1620.75, 0);
  });

  it('applies fee adjustment', () => {
    const result = convertAmount({
      amount: new Decimal(10000),
      direction: 'JPY_TO_USD',
      rate: 0.00617,
      feePercent: 3,
    });
    expect(result.outputAmount.toNumber()).toBeCloseTo(59.85, 2);
  });

  it('formats currencies', () => {
    expect(formatJpy(1000)).toContain('1,000');
    expect(formatUsd(6.17)).toContain('6.17');
  });

  it('sanitizes pasted currency text', () => {
    expect(sanitizeCurrencyInput('¥1,234')).toBe('1234');
    expect(parseSanitizedAmount('1234')?.toNumber()).toBe(1234);
    expect(parseSanitizedAmount('１０００')?.toNumber()).toBe(1000);
  });

  it('handles empty input', () => {
    expect(parseSanitizedAmount('')).toBeNull();
    expect(parseSanitizedAmount('-')).toBeNull();
  });

  it('computes freshness', () => {
    const now = Date.now();
    expect(computeFreshness(now - 1000, now, true)).toBe('fresh');
    expect(computeFreshness(now - 86400001, now, true)).toBe('stale');
    expect(computeFreshness(now - 1000, now, false)).toBe('offline');
  });

  it('maps rate status labels', () => {
    expect(getRateStatusLabel('fresh', false, true)).toBe('Latest rate');
    expect(getRateStatusLabel('offline', false, true)).toBe('Offline rate');
    expect(getRateStatusLabel('unavailable', false, false)).toBe('Rate unavailable');
  });
});
