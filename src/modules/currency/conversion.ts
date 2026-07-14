import Decimal from 'decimal.js';
import { RATE_STALE_MS } from '../../config/app';
import type { FreshnessStatus, NormalizedRate } from './types';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export function computeFreshness(
  fetchedAt: number,
  now = Date.now(),
  isOnline = true,
): FreshnessStatus {
  if (!isOnline) return 'offline';
  if (now - fetchedAt > RATE_STALE_MS) return 'stale';
  return 'fresh';
}

export function withFreshness(
  rate: NormalizedRate,
  isOnline: boolean,
  now = Date.now(),
): NormalizedRate {
  return {
    ...rate,
    freshnessStatus: computeFreshness(rate.fetchedAt, now, isOnline),
  };
}

export interface ConversionInput {
  amount: Decimal;
  direction: 'JPY_TO_USD' | 'USD_TO_JPY';
  rate: number;
  feePercent: number;
}

export interface ConversionResult {
  inputAmount: Decimal;
  outputAmount: Decimal;
  direction: 'JPY_TO_USD' | 'USD_TO_JPY';
  rate: Decimal;
  feePercent: Decimal;
  inverseRate: Decimal;
}

export function convertAmount(input: ConversionInput): ConversionResult {
  const rate = new Decimal(input.rate);
  const feeMultiplier = new Decimal(1).minus(new Decimal(input.feePercent).div(100));
  let output: Decimal;

  if (input.direction === 'JPY_TO_USD') {
    output = input.amount.mul(rate).mul(feeMultiplier);
  } else {
    if (rate.isZero()) {
      output = new Decimal(0);
    } else {
      output = input.amount.div(rate).mul(feeMultiplier);
    }
  }

  const inverseRate = rate.isZero() ? new Decimal(0) : new Decimal(1).div(rate);

  return {
    inputAmount: input.amount,
    outputAmount: output,
    direction: input.direction,
    rate,
    feePercent: new Decimal(input.feePercent),
    inverseRate,
  };
}

export function formatJpy(value: Decimal | number): string {
  const num = Decimal.isDecimal(value) ? value.toNumber() : value;
  if (!Number.isFinite(num)) return '';
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatUsd(value: Decimal | number): string {
  const num = Decimal.isDecimal(value) ? value.toNumber() : value;
  if (!Number.isFinite(num)) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatInverseExplanation(rate: number): {
  oneUsdInJpy: string;
  oneJpyInUsd: string;
} {
  const r = new Decimal(rate);
  const oneUsdInJpy = r.isZero() ? '—' : formatJpy(new Decimal(1).div(r));
  const oneJpyInUsd = formatUsd(r);
  return { oneUsdInJpy, oneJpyInUsd };
}

const FULLWIDTH_DIGITS = '０１２３４５６７８９';

export function sanitizeCurrencyInput(raw: string): string {
  let value = raw.trim();
  value = value.replace(/[¥$￥]/g, '');
  value = value.replace(/\s+/g, '');
  value = value.replace(/,/g, '');
  value = value.replace(/usd|jpy|yen|dollar/gi, '');
  value = value
    .split('')
    .map((ch) => {
      const idx = FULLWIDTH_DIGITS.indexOf(ch);
      return idx >= 0 ? String(idx) : ch;
    })
    .join('');
  if (value === '-' || value === '.' || value === '-.') return value;
  return value;
}

export function parseSanitizedAmount(value: string): Decimal | null {
  const cleaned = sanitizeCurrencyInput(value);
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  try {
    const d = new Decimal(cleaned);
    if (!d.isFinite() || d.isNegative()) return null;
    return d;
  } catch {
    return null;
  }
}

export function displayAmount(value: Decimal | null): string {
  if (!value) return '';
  if (!value.isFinite()) return '';
  return value.toFixed();
}

export type RateStatusLabel =
  | 'Latest rate'
  | 'Checking for update'
  | 'Saved rate'
  | 'Offline rate'
  | 'Rate unavailable'
  | 'Source disagreement';

export function getRateStatusLabel(
  freshness: FreshnessStatus,
  isChecking: boolean,
  hasRate: boolean,
): RateStatusLabel {
  if (isChecking) return 'Checking for update';
  if (!hasRate) return 'Rate unavailable';
  switch (freshness) {
    case 'fresh':
      return 'Latest rate';
    case 'stale':
      return 'Saved rate';
    case 'offline':
      return 'Offline rate';
    case 'disagreement':
      return 'Source disagreement';
    default:
      return 'Rate unavailable';
  }
}
