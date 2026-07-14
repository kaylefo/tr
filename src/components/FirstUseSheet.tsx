import { APP_NAME } from '../config/app';

interface FirstUseSheetProps {
  open: boolean;
  onDismiss: () => void;
}

export function FirstUseSheet({ open, onDismiss }: FirstUseSheetProps) {
  if (!open) return null;

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onDismiss}>
      <div
        className="sheet"
        role="dialog"
        aria-labelledby="first-use-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="first-use-title">Welcome to {APP_NAME}</h2>
        <ul className="sheet__list">
          <li>The converter fetches the newest reference rate when you are connected.</li>
          <li>Your saved rate keeps converting offline.</li>
          <li>See, Translate, and Settings let you download offline language packs for camera and text translation.</li>
          <li>Your text and history never leave this device.</li>
        </ul>
        <button type="button" className="button" onClick={onDismiss}>
          Continue
        </button>
      </div>
    </div>
  );
}
