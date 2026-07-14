import { RATE_DIVERGENCE_THRESHOLD, RATE_STALE_MS } from '../../config/app';
import {
  compareRates,
  fetchFromProvider,
  frankfurterProvider,
  rateProviders,
} from './providers';
import { withFreshness } from './conversion';
import type { CachedRateRecord, NormalizedRate } from './types';
import { getCachedRate, saveCachedRate } from '../storage/rateStore';
import { saveEmergencyRateSnapshot } from '../storage/localSnapshot';

export interface RateRefreshResult {
  rate: NormalizedRate | null;
  error?: string;
  fromCache?: boolean;
  disagreement?: boolean;
}

let refreshInFlight: Promise<RateRefreshResult> | null = null;

export async function loadInitialRate(isOnline: boolean): Promise<RateRefreshResult> {
  const cached = await getCachedRate();
  if (cached) {
    return {
      rate: withFreshness(cached, isOnline),
      fromCache: true,
    };
  }
  return { rate: null, fromCache: true };
}

export async function refreshExchangeRate(options: {
  force?: boolean;
  isOnline?: boolean;
} = {}): Promise<RateRefreshResult> {
  const isOnline = options.isOnline ?? navigator.onLine;

  if (!isOnline) {
    const cached = await getCachedRate();
    if (cached) {
      return { rate: withFreshness(cached, false), fromCache: true };
    }
    return { rate: null, error: 'Connect once while online to download an exchange rate.' };
  }

  if (!options.force) {
    const cached = await getCachedRate();
    if (cached && Date.now() - cached.fetchedAt < RATE_STALE_MS) {
      return { rate: withFreshness(cached, true), fromCache: true };
    }
  }

  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = performRefresh(isOnline).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function performRefresh(isOnline: boolean): Promise<RateRefreshResult> {
  const previous = await getCachedRate();
  const successes: NormalizedRate[] = [];
  let lastError: string | undefined;

  for (const provider of rateProviders) {
    try {
      const result = await fetchFromProvider(provider);
      successes.push(result.rate);
      if (provider.id !== 'frankfurter') {
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Provider failed';
      if (import.meta.env.DEV) {
        console.warn(`Rate provider ${provider.id} failed`, err);
      }
    }
  }

  if (successes.length === 0) {
    if (previous) {
      return {
        rate: withFreshness(previous, isOnline),
        fromCache: true,
        error: "Couldn't update the exchange rate. Your saved rate is still available.",
      };
    }
    return {
      rate: null,
      error: lastError ?? 'Rate unavailable',
    };
  }

  let selected = successes[0];

  const independent = await tryIndependentValidation();
  if (independent) {
    successes.push(independent);
  }

  if (successes.length >= 2) {
    const primary = successes[0];
    const secondary = successes[1];
    const divergence = compareRates(primary.rate, secondary.rate);
    if (divergence > RATE_DIVERGENCE_THRESHOLD) {
      if (previous) {
        const record: CachedRateRecord = {
          ...withFreshness(previous, isOnline),
          id: 'current',
          freshnessStatus: 'disagreement',
          lastValidation: {
            comparedProviders: [primary.providerId, secondary.providerId],
            divergence,
            keptPrevious: true,
          },
        };
        await persistRate(record);
        return {
          rate: record,
          disagreement: true,
          error: 'Sources disagree. Using your last trusted rate.',
        };
      }
      selected = {
        ...primary,
        freshnessStatus: 'disagreement',
      };
    }
  }

  const record: CachedRateRecord = {
    ...withFreshness(selected, isOnline),
    id: 'current',
    lastValidation:
      successes.length >= 2
        ? {
            comparedProviders: successes.slice(0, 2).map((s) => s.providerId),
            divergence: compareRates(successes[0].rate, successes[1].rate),
            keptPrevious: false,
          }
        : undefined,
  };

  await persistRate(record);
  return { rate: record };
}

async function tryIndependentValidation(): Promise<NormalizedRate | null> {
  const alreadyUsed = rateProviders.some((p) => p.id === 'frankfurter');
  if (alreadyUsed) {
    try {
      const result = await fetchFromProvider(frankfurterProvider);
      return result.rate;
    } catch {
      return null;
    }
  }
  return null;
}

async function persistRate(record: CachedRateRecord): Promise<void> {
  await saveCachedRate(record);
  saveEmergencyRateSnapshot(record);
}

export function shouldAutoRefresh(rate: NormalizedRate | null, autoRefreshEnabled: boolean): boolean {
  if (!autoRefreshEnabled || !rate) return false;
  return Date.now() - rate.fetchedAt >= RATE_STALE_MS;
}
