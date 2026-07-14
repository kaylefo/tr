import { useCallback, useEffect, useState } from 'react';
import type { AppearanceMode } from '../config/app';
import { loadSettings, saveSettings, type AppSettings } from '../modules/storage/settingsStore';

function applyAppearance(mode: AppearanceMode): void {
  const root = document.documentElement;
  if (mode === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }
}

export function useSettings(): {
  settings: AppSettings | null;
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  loading: boolean;
} {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setSettings(loaded);
      applyAppearance(loaded.appearance);
      setLoading(false);
    });
  }, []);

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    const next = await saveSettings(partial);
    setSettings(next);
    if (partial.appearance) {
      applyAppearance(next.appearance);
    }
  }, []);

  return { settings, updateSettings, loading };
}
