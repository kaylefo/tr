import { useEffect, useRef } from 'react';
import type { OverlayLabel } from '../modules/vision/imageProcessing';
import { wrapOverlayText } from '../modules/vision/imageProcessing';

interface TranslationOverlayProps {
  labels: OverlayLabel[];
  scanning: boolean;
}

export function TranslationOverlay({ labels, scanning }: TranslationOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scanning) {
      containerRef.current?.setAttribute('aria-busy', 'true');
    } else {
      containerRef.current?.removeAttribute('aria-busy');
    }
  }, [scanning]);

  return (
    <div ref={containerRef} className="translation-overlay" aria-live="polite">
      {scanning ? <p className="translation-overlay__status">Scanning…</p> : null}
      {labels.map((label) => {
        const width = Math.max(96, label.bbox.x1 - label.bbox.x0);
        const lines = wrapOverlayText(label.translation || label.source);
        return (
          <div
            key={label.id}
            className="translation-overlay__label"
            style={{
              left: `${label.bbox.x0}px`,
              top: `${label.bbox.y0}px`,
              width: `${width}px`,
            }}
          >
            <span className="translation-overlay__source">{label.source}</span>
            {lines.map((line) => (
              <span key={line} className="translation-overlay__english">
                {line}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

interface CameraViewportProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  mirror?: boolean;
  children?: React.ReactNode;
}

export function CameraViewport({ videoRef, mirror = true, children }: CameraViewportProps) {
  return (
    <div className="camera-viewport">
      <video
        ref={videoRef}
        className={`camera-viewport__video${mirror ? ' camera-viewport__video--mirror' : ''}`}
        playsInline
        muted
        autoPlay
      />
      <div className="camera-viewport__overlay">{children}</div>
    </div>
  );
}
