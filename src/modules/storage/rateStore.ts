import { getDb } from './db';
import type { CachedRateRecord } from '../currency/types';

const EMERGENCY_KEY = 'jp-rate-emergency';

export async function getCachedRate(): Promise<CachedRateRecord | null> {
  try {
    const db = await getDb();
    const record = await db.get('rates', 'current');
    if (record) return record;
  } catch (err) {
    if (import.meta.env.DEV) console.warn('IndexedDB rate read failed', err);
  }
  return readEmergencySnapshot();
}

export async function saveCachedRate(rate: CachedRateRecord): Promise<void> {
  const db = await getDb();
  await db.put('rates', rate, 'current');
}

export function saveEmergencyRateSnapshot(rate: CachedRateRecord): void {
  try {
    localStorage.setItem(EMERGENCY_KEY, JSON.stringify(rate));
  } catch {
    /* ignore quota */
  }
}

function readEmergencySnapshot(): CachedRateRecord | null {
  try {
    const raw = localStorage.getItem(EMERGENCY_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedRateRecord;
  } catch {
    return null;
  }
}
