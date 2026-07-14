export type FreshnessStatus =
  | 'fresh'
  | 'stale'
  | 'offline'
  | 'unavailable'
  | 'disagreement';

export interface NormalizedRate {
  baseCurrency: 'JPY';
  quoteCurrency: 'USD';
  rate: number;
  providerId: string;
  providerLabel: string;
  providerSourceDate: string;
  fetchedAt: number;
  freshnessStatus: FreshnessStatus;
  rawVersion?: string;
}

export interface ProviderFetchResult {
  rate: NormalizedRate;
  raw?: unknown;
}

export interface RateProvider {
  id: string;
  label: string;
  fetchRate(signal: AbortSignal): Promise<ProviderFetchResult>;
}

export interface CachedRateRecord extends NormalizedRate {
  id: 'current';
  lastValidation?: {
    comparedProviders: string[];
    divergence?: number;
    keptPrevious: boolean;
  };
}
