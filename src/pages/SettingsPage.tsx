import { useCallback, useEffect, useState } from 'react';
import { APP_DESCRIPTION, APP_NAME, APP_VERSION, BUILD_ID, FEE_PRESETS } from '../config/app';
import { isStandaloneDisplay } from '../hooks/usePwaUpdate';
import { useConnectivity } from '../hooks/useConnectivity';
import { refreshExchangeRate } from '../modules/currency/rateService';
import { clearAllLocalData } from '../modules/storage/db';
import {
  clearConversionHistory,
  clearTranslationHistory,
} from '../modules/storage/historyStore';
import { getJaEnPack, type OfflinePackRecord } from '../modules/storage/packStore';
import { translationService } from '../modules/translation/translationService';
import type { AppSettings } from '../modules/storage/settingsStore';
import { OfflinePackPanel } from '../components/OfflinePackPanel';

interface SettingsPageProps {
  settings: AppSettings;
  onUpdate: (partial: Partial<AppSettings>) => Promise<void>;
  onRefreshRate: () => Promise<void>;
  needRefresh: boolean;
  onUpdateApp: () => void;
}

async function estimateStorage(): Promise<string> {
  if (!navigator.storage?.estimate) return 'Estimate unavailable';
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (usage == null || quota == null) return 'Estimate unavailable';
    const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${mb(usage)} used of ${mb(quota)} (estimate)`;
  } catch {
    return 'Estimate unavailable';
  }
}

export function SettingsPage({
  settings,
  onUpdate,
  onRefreshRate,
  needRefresh,
  onUpdateApp,
}: SettingsPageProps) {
  const connection = useConnectivity();
  const isOnline = connection === 'online' || connection === 'uncertain';
  const [pack, setPack] = useState<OfflinePackRecord | null>(null);
  const [storageEstimate, setStorageEstimate] = useState('Loading…');
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const standalone = isStandaloneDisplay();

  const reload = useCallback(async () => {
    setPack(await getJaEnPack());
    setStorageEstimate(await estimateStorage());
    if (navigator.storage?.persisted) {
      setPersistent(await navigator.storage.persisted());
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section className="page settings-page" aria-labelledby="settings-heading">
      <header className="page__header">
        <h1 id="settings-heading">Settings</h1>
        <p className="page__subtitle">{APP_NAME}</p>
      </header>

      <section className="settings-group" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading">Appearance</h2>
        <div className="segmented" role="radiogroup" aria-label="Appearance">
          {(['system', 'light', 'dark'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={settings.appearance === mode}
              className={`segmented__item${settings.appearance === mode ? ' segmented__item--active' : ''}`}
              onClick={() => void onUpdate({ appearance: mode })}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-group" aria-labelledby="currency-settings-heading">
        <h2 id="currency-settings-heading">Currency</h2>
        <label className="setting-row">
          <span>Default direction</span>
          <select
            value={settings.defaultDirection}
            onChange={(e) =>
              void onUpdate({
                defaultDirection: e.target.value as AppSettings['defaultDirection'],
              })
            }
          >
            <option value="JPY_TO_USD">JPY → USD</option>
            <option value="USD_TO_JPY">USD → JPY</option>
          </select>
        </label>
        <label className="setting-row">
          <span>Default fee %</span>
          <select
            value={settings.defaultFeePercent}
            onChange={(e) => void onUpdate({ defaultFeePercent: Number(e.target.value) })}
          >
            {FEE_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
          </select>
        </label>
        <label className="setting-row setting-row--toggle">
          <span>Automatic rate refresh</span>
          <input
            type="checkbox"
            checked={settings.autoRefreshRate}
            onChange={(e) => void onUpdate({ autoRefreshRate: e.target.checked })}
          />
        </label>
        <button type="button" className="button button--secondary" onClick={() => void onRefreshRate()} disabled={!isOnline}>
          Refresh rate now
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void clearConversionHistory()}
        >
          Clear conversion history
        </button>
      </section>

      <section className="settings-group" aria-labelledby="vision-settings-heading">
        <h2 id="vision-settings-heading">See (camera translation)</h2>
        <p className="settings-meta">
          Manage Essential, Standard, and Live vision language packs in the See tab.
          Live tier enables continuous camera overlays with vertical Japanese text support.
        </p>
      </section>

      <section className="settings-group" aria-labelledby="translation-settings-heading">
        <h2 id="translation-settings-heading">Translation</h2>
        <OfflinePackPanel pack={pack} isOnline={isOnline} onPackChange={reload} />
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void clearTranslationHistory()}
        >
          Clear translation history
        </button>
      </section>

      <section className="settings-group" aria-labelledby="storage-heading">
        <h2 id="storage-heading">Storage</h2>
        <p className="settings-meta">{storageEstimate}</p>
        {persistent != null ? (
          <p className="settings-meta">
            Persistent storage: {persistent ? 'Granted' : 'Not granted (estimate)'}
          </p>
        ) : null}
        <button
          type="button"
          className="button button--danger"
          onClick={() => {
            if (window.confirm('Clear all local application data? This removes history, settings, rates, and offline packs.')) {
              void clearAllLocalData().then(() => {
                void translationService.deletePack();
                window.location.reload();
              });
            }
          }}
        >
          Clear all local data
        </button>
      </section>

      <section className="settings-group" aria-labelledby="app-heading">
        <h2 id="app-heading">Application</h2>
        <p className="settings-meta">Version {APP_VERSION}</p>
        <p className="settings-meta">Build {BUILD_ID}</p>
        <p className="settings-meta">{APP_DESCRIPTION}</p>
        {needRefresh ? (
          <button type="button" className="button" onClick={onUpdateApp}>
            Update available — reload
          </button>
        ) : (
          <button type="button" className="button button--secondary" onClick={() => void refreshExchangeRate({ force: true })}>
            Check for app update
          </button>
        )}
        {standalone ? (
          <p className="settings-meta">Installed</p>
        ) : (
          <details className="install-guide">
            <summary>How to Install on iPhone</summary>
            <ol>
              <li>Tap the Share button in Safari.</li>
              <li>Tap Add to Home Screen.</li>
              <li>Turn on Open as Web App when shown.</li>
              <li>Tap Add.</li>
              <li>Open Japan Pocket from the new Home Screen icon.</li>
              <li>Download the Offline Translation Pack before traveling offline.</li>
            </ol>
          </details>
        )}
        <p className="privacy-statement">
          Conversions, translations, and history stay on this device. No account is required.
        </p>
        <details>
          <summary>Open-source licenses</summary>
          <ul className="license-list">
            <li>React — MIT</li>
            <li>Vite — MIT</li>
            <li>@huggingface/transformers — Apache-2.0</li>
            <li>Xenova/opus-mt-ja-en — Apache-2.0 (Helsinki-NLP/opus-mt-ja-en)</li>
            <li>Fawaz Ahmed Currency API — MIT</li>
            <li>Frankfurter — Open Data</li>
            <li>decimal.js — MIT</li>
            <li>idb — ISC</li>
          </ul>
        </details>
      </section>
    </section>
  );
}
