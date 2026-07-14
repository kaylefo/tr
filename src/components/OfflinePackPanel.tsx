import { useState } from 'react';
import type { OfflinePackRecord } from '../modules/storage/packStore';
import { translationService } from '../modules/translation/translationService';

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
  const [progress, setProgress] = useState<string>('');

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
    setProgress('Starting download…');
    translationService.setListeners({
      onProgress: (p) => {
        const pct =
          p.progress != null
            ? `${Math.round(p.progress)}%`
            : p.loaded && p.total
              ? `${Math.round((p.loaded / p.total) * 100)}%`
              : '';
        setProgress(`${p.status}${p.file ? `: ${p.file}` : ''} ${pct}`.trim());
      },
      onReady: () => {
        setProgress('');
        setBusy(false);
        void onPackChange();
      },
      onError: () => {
        setBusy(false);
        void onPackChange();
      },
    });
    try {
      await translationService.downloadAndInitialize(isOnline);
    } catch {
      /* surfaced via pack state */
    } finally {
      setBusy(false);
      await onPackChange();
    }
  };

  const repair = () => download();

  const remove = async () => {
    if (!window.confirm('Delete the offline translation pack? The app will remain installed.')) return;
    setBusy(true);
    await translationService.deletePack();
    setBusy(false);
    await onPackChange();
  };

  const validated = pack?.lastValidatedAt
    ? new Date(pack.lastValidatedAt).toLocaleString()
    : null;

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
        {progress ? (
          <div>
            <dt>Progress</dt>
            <dd>{progress}</dd>
          </div>
        ) : null}
        {pack?.errorMessage ? (
          <div>
            <dt>Error</dt>
            <dd className="notice notice--warn">{pack.errorMessage}</dd>
          </div>
        ) : null}
      </dl>

      <div className="action-row">
        {pack?.status !== 'ready' ? (
          <button type="button" className="button" disabled={!isOnline || busy} onClick={() => void download()}>
            Download offline pack
          </button>
        ) : (
          <>
            <button type="button" className="button button--secondary" disabled={!isOnline || busy} onClick={() => void repair()}>
              Repair / redownload
            </button>
            <button type="button" className="button button--danger" disabled={busy} onClick={() => void remove()}>
              Delete pack
            </button>
          </>
        )}
        {pack?.status === 'failed' ? (
          <button type="button" className="button" disabled={!isOnline || busy} onClick={() => void repair()}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
