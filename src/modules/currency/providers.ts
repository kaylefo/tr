import type { ProviderFetchResult } from './types';

const FETCH_TIMEOUT_MS = 8000;

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function parsePositiveRate(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json') && contentType !== '') {
    throw new Error('Unexpected content type');
  }
  return response.json();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return promise.finally(() => clearTimeout(timer));
}

export function normalizeFawazResponse(
  data: unknown,
  providerId: string,
  providerLabel: string,
): ProviderFetchResult {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid response');
  }
  const record = data as Record<string, unknown>;
  const date = typeof record.date === 'string' ? record.date : null;
  if (!date || !isValidDate(date)) {
    throw new Error('Missing date');
  }
  const jpy = record.jpy;
  if (!jpy || typeof jpy !== 'object') {
    throw new Error('Missing jpy object');
  }
  const usd = parsePositiveRate((jpy as Record<string, unknown>).usd);
  if (usd === null) {
    throw new Error('Invalid USD rate');
  }
  return {
    rate: {
      baseCurrency: 'JPY',
      quoteCurrency: 'USD',
      rate: usd,
      providerId,
      providerLabel,
      providerSourceDate: date,
      fetchedAt: Date.now(),
      freshnessStatus: 'fresh',
    },
  };
}

export function normalizeFrankfurterResponse(data: unknown): ProviderFetchResult {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid response');
  }
  const record = data as Record<string, unknown>;
  const date = typeof record.date === 'string' ? record.date : null;
  if (!date || !isValidDate(date)) {
    throw new Error('Missing date');
  }
  const rates = record.rates;
  if (!rates || typeof rates !== 'object') {
    throw new Error('Missing rates');
  }
  const usd = parsePositiveRate((rates as Record<string, unknown>).USD);
  if (usd === null) {
    throw new Error('Invalid USD rate');
  }
  return {
    rate: {
      baseCurrency: 'JPY',
      quoteCurrency: 'USD',
      rate: usd,
      providerId: 'frankfurter',
      providerLabel: 'Frankfurter',
      providerSourceDate: date,
      fetchedAt: Date.now(),
      freshnessStatus: 'fresh',
    },
  };
}

export const fawazPrimaryProvider = {
  id: 'fawaz-jsdelivr',
  label: 'Fawaz Currency API',
  async fetchRate(signal: AbortSignal): Promise<ProviderFetchResult> {
    const data = await fetchJson(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/jpy.min.json',
      signal,
    );
    return normalizeFawazResponse(data, 'fawaz-jsdelivr', 'Fawaz Currency API');
  },
};

export const fawazMirrorProvider = {
  id: 'fawaz-mirror',
  label: 'Fawaz Mirror',
  async fetchRate(signal: AbortSignal): Promise<ProviderFetchResult> {
    const data = await fetchJson(
      'https://latest.currency-api.pages.dev/v1/currencies/jpy.min.json',
      signal,
    );
    return normalizeFawazResponse(data, 'fawaz-mirror', 'Fawaz Mirror');
  },
};

export const frankfurterProvider = {
  id: 'frankfurter',
  label: 'Frankfurter',
  async fetchRate(signal: AbortSignal): Promise<ProviderFetchResult> {
    const data = await fetchJson(
      'https://api.frankfurter.dev/v1/latest?base=JPY&symbols=USD',
      signal,
    );
    return normalizeFrankfurterResponse(data);
  },
};

export const rateProviders = [fawazPrimaryProvider, fawazMirrorProvider, frankfurterProvider];

export async function fetchFromProvider(
  provider: { id: string; label: string; fetchRate: (signal: AbortSignal) => Promise<ProviderFetchResult> },
): Promise<ProviderFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await withTimeout(provider.fetchRate(controller.signal), FETCH_TIMEOUT_MS + 500);
  } finally {
    clearTimeout(timeout);
  }
}

export function compareRates(a: number, b: number): number {
  if (a <= 0 || b <= 0) return Infinity;
  return Math.abs(a - b) / ((a + b) / 2);
}
