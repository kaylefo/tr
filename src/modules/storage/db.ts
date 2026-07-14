import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CachedRateRecord } from '../currency/types';
import type { ConversionHistoryItem, TranslationHistoryItem } from './historyStore';
import type { AppSettings } from './settingsStore';
import type { OfflinePackRecord } from './packStore';

export interface JapanPocketDB extends DBSchema {
  rates: {
    key: 'current';
    value: CachedRateRecord;
  };
  settings: {
    key: 'app';
    value: AppSettings;
  };
  conversionHistory: {
    key: string;
    value: ConversionHistoryItem;
    indexes: { 'by-timestamp': number };
  };
  translationHistory: {
    key: string;
    value: TranslationHistoryItem;
    indexes: { 'by-timestamp': number };
  };
  offlinePacks: {
    key: string;
    value: OfflinePackRecord;
  };
}

const DB_NAME = 'japan-pocket';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<JapanPocketDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<JapanPocketDB>> {
  if (!dbPromise) {
    dbPromise = openDB<JapanPocketDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('rates')) {
          db.createObjectStore('rates');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        if (!db.objectStoreNames.contains('conversionHistory')) {
          const store = db.createObjectStore('conversionHistory', { keyPath: 'id' });
          store.createIndex('by-timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('translationHistory')) {
          const store = db.createObjectStore('translationHistory', { keyPath: 'id' });
          store.createIndex('by-timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('offlinePacks')) {
          db.createObjectStore('offlinePacks');
        }
      },
    });
  }
  return dbPromise;
}

export async function clearAllLocalData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ['rates', 'settings', 'conversionHistory', 'translationHistory', 'offlinePacks'],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('rates').clear(),
    tx.objectStore('settings').clear(),
    tx.objectStore('conversionHistory').clear(),
    tx.objectStore('translationHistory').clear(),
    tx.objectStore('offlinePacks').clear(),
    tx.done,
  ]);
  localStorage.removeItem('jp-rate-emergency');
  localStorage.removeItem('jp-first-use-seen');
}
