import type { AppearanceMode, ConversionDirection, MainTab } from '../../config/app';
import { getDb } from './db';

export interface AppSettings {
  appearance: AppearanceMode;
  defaultDirection: ConversionDirection;
  defaultFeePercent: number;
  autoRefreshRate: boolean;
  lastTab: MainTab;
  firstUseSeen: boolean;
}

export const defaultSettings: AppSettings = {
  appearance: 'system',
  defaultDirection: 'JPY_TO_USD',
  defaultFeePercent: 0,
  autoRefreshRate: true,
  lastTab: 'convert',
  firstUseSeen: false,
};

let saveQueue: Promise<AppSettings> = Promise.resolve(defaultSettings);

export async function loadSettings(): Promise<AppSettings> {
  const db = await getDb();
  const stored = await db.get('settings', 'app');
  const firstUseSeen =
    localStorage.getItem('jp-first-use-seen') === '1' || stored?.firstUseSeen === true;
  return stored
    ? { ...defaultSettings, ...stored, firstUseSeen }
    : { ...defaultSettings, firstUseSeen };
}

export async function saveSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const save = async () => {
    const current = await loadSettings();
    const next = { ...current, ...partial };
    if (partial.firstUseSeen) {
      localStorage.setItem('jp-first-use-seen', '1');
    }
    const db = await getDb();
    await db.put('settings', next, 'app');
    return next;
  };

  saveQueue = saveQueue.then(save, save);
  return saveQueue;
}
