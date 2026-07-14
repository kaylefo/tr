import { useEffect, useState } from 'react';
import type { OfflinePackRecord } from '../modules/storage/packStore';
import { languagePackManager } from '../modules/languagePack/languagePackManager';
import { formatProgressLabel } from '../modules/languagePack/progress';

interface OfflinePackPanelProps {
  pack: OfflinePackRecord | null;
  isOnline: boolean;
  onPackChange: () => Promise<void>;
}

function statusLabel(status: OfflinePackRecord['status']): string {
  switch (status) {
    case 'not_downloaded':
      return 'Not downloaded';
    case 'downloading':
      return 'Downloading…';
    case 'preparing':
      return 'Preparing model…';
    case 'ready':
      return 'Offline translation ready';
    case 'failed':
      return 'Download failed';
    case 'update_available':
      return 'Update available';
    default:
      return 'Unknown';
  }
}

function executionLabel(mode?: 'webgpu' | 'wasm'): string {
  if (!mode) return '';
  return mode === 'webgpu' ? 'Fast mode (WebGPU)' : 'Compatibility mode (WASM)';
}

export function OfflinePackPanel({ pack, isOnline, onPackChange }: OfflinePackPanelProps) {
  const [busy, setBusy] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);

  useEffect(() => {
    const unsubs = [
      languagePackManager.subscribeTranslationProgress((progress) => {
        setProgressLabel(formatProgressLabel(progress));
        setProgressPercent(progress.progress);
      }),
      languagePackManager.subscribeTranslationReady(() => {
        setProgressLabel('');
        setProgressPercent(100);
        setBusy(false);
        void onPackChange();
      }),
      languagePackManager.subscribeTranslationError(() => {
        setBusy(false);
        void onPackChange();
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [onPackChange]);

  const download = async () => {
    if (!isOnline) return;
    if (
      !window.confirm(
        'The offline translation pack is a substantial download. Wi‑Fi is recommended. Continue?',
      )
    ) {
      return;
    }
    setBusy(true);
    setProgressLabel('Starting download…');
    try {
      await languagePackManager.downloadTranslationPack(isOnline);
    } catch {
      /* surfaced via pack state */
    } finally {
      setBusy(false);
      await onPackChange();
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete the offline translation pack? The app will remain installed.')) return;
    setBusy(true);
    await languagePackManager.deleteTranslationPack();
    setBusy(false);
    await onPackChange();
  };

  const validated = pack?.lastValidatedAt
    ? new Date(pack.lastValidatedAt).toLocaleString()
    : null;

  const barPercent = pack?.status === 'ready' ? 100 : progressPercent;

  return (
    <div className="offline-pack" aria-labelledby="offline-pack-heading">
      <h3 id="offline-pack-heading">Offline Translation Pack</h3>
      <dl className="offline-pack__details">
        <div>
          <dt>Pack</dt>
          <dd>{pack?.label ?? 'Japanese → English'}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd role="status" aria-live="polite">
            {statusLabel(pack?.status ?? 'not_downloaded')}
          </dd>
        </div>
        {pack?.executionMode ? (
          <div>
            <dt>Runtime</dt>
            <dd>{executionLabel(pack.executionMode)}</dd>
          </div>
        ) : null}
        {validated ? (
          <div>
            <dt>Last validated</dt>
            <dd>{validated}</dd>
          </div>
        ) : null}
        {progressLabel ? (
          <div>
            <dt>Progress</dt>
            <dd>{progressLabel}</dd>
          </div>
        ) : null}
        {pack?.errorMessage ? (
          <div>
            <dt>Error</dt>
            <dd className="notice notice--warn">{pack.errorMessage}</dd>
          </div>
        ) : null}
      </dl>

      {(busy || pack?.status === 'downloading' || pack?.status === 'preparing') ? (
        <div
          className="vision-component__bar offline-pack__bar"
          role="progressbar"
          aria-valuenow={barPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Translation pack download progress"
        >
          <span style={{ width: `${Math.max(0, Math.min(100, barPercent))}%` }} />
        </div>
      ) : null}

      <div className="action-row">
        {pack?.status !== 'ready' ? (
          <button type="button" className="button" disabled={!isOnline || busy} onClick={() => void download()}>
            Download offline pack
          </button>
        ) : (
          <>
            <button type="button" className="button button--secondary" disabled={!isOnline || busy} onClick={() => void download()}>
              Repair / redownload
            </button>
            <button type="button" className="button button--danger" disabled={busy} onClick={() => void remove()}>
              Delete pack
            </button>
          </>
        )}
        {pack?.status === 'failed' ? (
          <button type="button" className="button" disabled={!isOnline || busy} onClick={() => void download()}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
