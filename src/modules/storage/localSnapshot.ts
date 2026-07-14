import type { CachedRateRecord } from '../currency/types';

const EMERGENCY_KEY = 'jp-rate-emergency';

export function saveEmergencyRateSnapshot(rate: CachedRateRecord): void {
  try {
    localStorage.setItem(EMERGENCY_KEY, JSON.stringify(rate));
  } catch {
    /* ignore quota */
  }
}
