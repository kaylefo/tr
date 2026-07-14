import { TRANSLATION_MODEL_JA_EN } from '../../config/app';
import { getDb } from './db';

export type PackStatus =
  | 'not_downloaded'
  | 'downloading'
  | 'preparing'
  | 'ready'
  | 'failed'
  | 'update_available';

export interface OfflinePackRecord {
  packId: string;
  modelId: string;
  direction: 'ja-en';
  label: string;
  status: PackStatus;
  downloadedBytes?: number;
  totalBytes?: number;
  lastValidatedAt?: number;
  executionMode?: 'webgpu' | 'wasm';
  errorMessage?: string;
  version: number;
}

export const JA_EN_PACK_ID = 'ja-en-v1';

export const defaultJaEnPack: OfflinePackRecord = {
  packId: JA_EN_PACK_ID,
  modelId: TRANSLATION_MODEL_JA_EN,
  direction: 'ja-en',
  label: 'Japanese → English',
  status: 'not_downloaded',
  version: 1,
};

export async function getOfflinePack(packId: string): Promise<OfflinePackRecord | null> {
  const db = await getDb();
  return (await db.get('offlinePacks', packId)) ?? null;
}

export async function saveOfflinePack(pack: OfflinePackRecord): Promise<void> {
  const db = await getDb();
  await db.put('offlinePacks', pack, pack.packId);
}

export async function deleteOfflinePackRecord(packId: string): Promise<void> {
  const db = await getDb();
  await db.delete('offlinePacks', packId);
}

export async function getJaEnPack(): Promise<OfflinePackRecord> {
  const existing = await getOfflinePack(JA_EN_PACK_ID);
  return existing ?? { ...defaultJaEnPack };
}
