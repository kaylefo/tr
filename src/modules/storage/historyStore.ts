import { HISTORY_MAX_ITEMS } from '../../config/app';
import { getDb } from './db';

export interface ConversionHistoryItem {
  id: string;
  jpyAmount: string;
  usdAmount: string;
  direction: 'JPY_TO_USD' | 'USD_TO_JPY';
  rate: number;
  feePercent: number;
  timestamp: number;
  rateSourceDate: string;
}

export interface TranslationHistoryItem {
  id: string;
  source: string;
  translation: string;
  timestamp: number;
  modelId: string;
  favorite: boolean;
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function listConversionHistory(): Promise<ConversionHistoryItem[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('conversionHistory', 'by-timestamp');
  return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, HISTORY_MAX_ITEMS);
}

export async function addConversionHistory(
  item: Omit<ConversionHistoryItem, 'id' | 'timestamp'>,
): Promise<void> {
  const db = await getDb();
  const recent = await listConversionHistory();
  const last = recent[0];
  if (
    last &&
    last.jpyAmount === item.jpyAmount &&
    last.usdAmount === item.usdAmount &&
    last.direction === item.direction &&
    last.feePercent === item.feePercent
  ) {
    return;
  }
  const record: ConversionHistoryItem = {
    ...item,
    id: makeId(),
    timestamp: Date.now(),
  };
  await db.put('conversionHistory', record);
  await trimHistory('conversionHistory');
}

export async function clearConversionHistory(): Promise<void> {
  const db = await getDb();
  await db.clear('conversionHistory');
}

export async function deleteConversionHistoryItem(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('conversionHistory', id);
}

export async function listTranslationHistory(): Promise<TranslationHistoryItem[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('translationHistory', 'by-timestamp');
  return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, HISTORY_MAX_ITEMS);
}

export async function addTranslationHistory(
  item: Omit<TranslationHistoryItem, 'id' | 'timestamp' | 'favorite'>,
): Promise<void> {
  const db = await getDb();
  const recent = await listTranslationHistory();
  const last = recent[0];
  if (last && last.source === item.source && last.translation === item.translation) {
    return;
  }
  const record: TranslationHistoryItem = {
    ...item,
    id: makeId(),
    timestamp: Date.now(),
    favorite: false,
  };
  await db.put('translationHistory', record);
  await trimHistory('translationHistory');
}

export async function toggleTranslationFavorite(id: string): Promise<void> {
  const db = await getDb();
  const item = await db.get('translationHistory', id);
  if (!item) return;
  await db.put('translationHistory', { ...item, favorite: !item.favorite });
}

export async function clearTranslationHistory(): Promise<void> {
  const db = await getDb();
  await db.clear('translationHistory');
}

export async function deleteTranslationHistoryItem(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('translationHistory', id);
}

async function trimHistory(store: 'conversionHistory' | 'translationHistory'): Promise<void> {
  const db = await getDb();
  const all = await db.getAllFromIndex(store, 'by-timestamp');
  const sorted = all.sort((a, b) => b.timestamp - a.timestamp);
  const excess = sorted.slice(HISTORY_MAX_ITEMS);
  await Promise.all(excess.map((item) => db.delete(store, item.id)));
}
