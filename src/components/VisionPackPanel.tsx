import type { VisionPackRecord } from '../modules/storage/visionPackStore';
import type { VisionTierId } from '../config/vision';
import { VISION_TIERS } from '../config/vision';

interface VisionPackPanelProps {
  packs: VisionPackRecord[];
  activeTierId: VisionTierId | null;
  isOnline: boolean;
  busy: boolean;
  onSelectTier: (tierId: VisionTierId) => void;
  onDownload: (tierId: VisionTierId) => void;
  onDelete: (tierId: VisionTierId) => void;
  onRefresh: () => void;
}

function statusLabel(status: VisionPackRecord['status']): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'downloading':
      return 'Downloading…';
    case 'preparing':
      return 'Preparing…';
    case 'failed':
      return 'Failed';
    default:
      return 'Not downloaded';
  }
}

export function VisionPackPanel({
  packs,
  activeTierId,
  isOnline,
  busy,
  onSelectTier,
  onDownload,
  onDelete,
}: VisionPackPanelProps) {
  return (
    <div className="vision-packs" aria-labelledby="vision-packs-heading">
      <h3 id="vision-packs-heading">Offline vision language packs</h3>
      <p className="vision-packs__hint">
        Each tier downloads translation and OCR data on your device. Live camera requires the Live tier.
      </p>

      {VISION_TIERS.map((tierDef) => {
        const pack = packs.find((p) => p.tierId === tierDef.tierId)!;
        const selected = activeTierId === tierDef.tierId;
        return (
          <article
            key={tierDef.tierId}
            className={`vision-pack-card${selected ? ' vision-pack-card--active' : ''}`}
          >
            <header className="vision-pack-card__header">
              <div>
                <h4>{tierDef.label}</h4>
                <p>{tierDef.description}</p>
                <p className="vision-pack-card__meta">
                  ~{tierDef.estimatedSizeMb} MB · {statusLabel(pack.status)}
                </p>
              </div>
              <button
                type="button"
                className={`chip${selected ? ' chip--active' : ''}`}
                onClick={() => onSelectTier(tierDef.tierId)}
                disabled={pack.status !== 'ready'}
              >
                {selected ? 'Active' : 'Use'}
              </button>
            </header>

            <ul className="vision-components" aria-label={`${tierDef.label} components`}>
              {pack.components.map((component) => (
                <li key={component.id} className="vision-component">
                  <div className="vision-component__row">
                    <span>{component.label}</span>
                    <span className="vision-component__status">{component.status}</span>
                  </div>
                  <div
                    className="vision-component__bar"
                    role="progressbar"
                    aria-valuenow={Math.round(component.progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${component.label} download progress`}
                  >
                    <span style={{ width: `${Math.max(0, Math.min(100, component.progress))}%` }} />
                  </div>
                  {component.errorMessage ? (
                    <p className="notice notice--warn">{component.errorMessage}</p>
                  ) : null}
                </li>
              ))}
            </ul>

            {pack.errorMessage ? <p className="notice notice--warn">{pack.errorMessage}</p> : null}

            <div className="action-row">
              {pack.status !== 'ready' ? (
                <button
                  type="button"
                  className="button"
                  disabled={!isOnline || busy}
                  onClick={() => onDownload(tierDef.tierId)}
                >
                  Download {tierDef.label} pack
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={!isOnline || busy}
                    onClick={() => onDownload(tierDef.tierId)}
                  >
                    Repair / redownload
                  </button>
                  <button
                    type="button"
                    className="button button--danger"
                    disabled={busy}
                    onClick={() => onDelete(tierDef.tierId)}
                  >
                    Delete pack
                  </button>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
