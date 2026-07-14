import { lazy, Suspense, useEffect, useState } from 'react';
import { APP_NAME } from './config/app';
import type { MainTab } from './config/app';
import { BottomNav } from './components/BottomNav';
import { ConnectionIndicator } from './components/ConnectionIndicator';
import { FirstUseSheet } from './components/FirstUseSheet';
import { ConvertPage } from './pages/ConvertPage';
import { useConnectivity } from './hooks/useConnectivity';
import { usePwaUpdate } from './hooks/usePwaUpdate';
import { useSettings } from './hooks/useSettings';
import { useExchangeRate } from './hooks/useExchangeRate';

const TranslatePage = lazy(() =>
  import('./pages/TranslatePage').then((m) => ({ default: m.TranslatePage })),
);
const SeePage = lazy(() =>
  import('./pages/SeePage').then((m) => ({ default: m.SeePage })),
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

export default function App() {
  const { settings, updateSettings, loading } = useSettings();
  const [tab, setTab] = useState<MainTab>('convert');
  const connection = useConnectivity();
  const { needRefresh, offlineReady, updateApp } = usePwaUpdate();
  const { refresh } = useExchangeRate(settings?.autoRefreshRate ?? true);

  useEffect(() => {
    if (settings?.lastTab) setTab(settings.lastTab);
  }, [settings?.lastTab]);

  const changeTab = (next: MainTab) => {
    setTab(next);
    void updateSettings({ lastTab: next });
  };

  if (loading || !settings) {
    return (
      <div className="app-shell app-shell--loading">
        <p>{APP_NAME}</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">{APP_NAME}</span>
        <ConnectionIndicator state={connection} />
      </header>

      <main className="app-main">
        {tab === 'convert' ? (
          <ConvertPage
            defaultDirection={settings.defaultDirection}
            defaultFeePercent={settings.defaultFeePercent}
            autoRefreshEnabled={settings.autoRefreshRate}
          />
        ) : null}
        {tab === 'see' ? (
          <Suspense fallback={<p className="loading">Loading camera translator…</p>}>
            <SeePage />
          </Suspense>
        ) : null}
        {tab === 'translate' ? (
          <Suspense fallback={<p className="loading">Loading translator…</p>}>
            <TranslatePage />
          </Suspense>
        ) : null}
        {tab === 'history' ? (
          <Suspense fallback={<p className="loading">Loading history…</p>}>
            <HistoryPage />
          </Suspense>
        ) : null}
        {tab === 'settings' ? (
          <Suspense fallback={<p className="loading">Loading settings…</p>}>
            <SettingsPage
              settings={settings}
              onUpdate={updateSettings}
              onRefreshRate={() => refresh(true)}
              needRefresh={needRefresh}
              offlineReady={offlineReady}
              onUpdateApp={updateApp}
            />
          </Suspense>
        ) : null}
      </main>

      <BottomNav active={tab} onChange={changeTab} />

      <FirstUseSheet
        open={!settings.firstUseSeen}
        onDismiss={() => void updateSettings({ firstUseSeen: true })}
      />
    </div>
  );
}
