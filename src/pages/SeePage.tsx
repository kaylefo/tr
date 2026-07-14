import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { VisionMode, VisionTierId } from '../config/vision';
import { getVisionTier, tierSupportsMode, VISION_LIVE_MIN_INTERVAL_MS } from '../config/vision';
import { useConnectivity } from '../hooks/useConnectivity';
import { CameraViewport, TranslationOverlay } from '../components/TranslationOverlay';
import {
  captureVideoFrame,
  preprocessCanvas,
  type OverlayLabel,
} from '../modules/vision/imageProcessing';
import { getActiveVisionPack, listVisionPacks, type VisionPackRecord } from '../modules/storage/visionPackStore';
import { visionService } from '../modules/vision/visionService';
import { translationService } from '../modules/translation/translationService';
import { addTranslationHistory } from '../modules/storage/historyStore';
import { TRANSLATION_MODEL_JA_EN } from '../config/app';

const VisionPackPanel = lazy(() =>
  import('../components/VisionPackPanel').then((m) => ({ default: m.VisionPackPanel })),
);

export function SeePage() {
  const connection = useConnectivity();
  const isOnline = connection === 'online' || connection === 'uncertain';

  const [mode, setMode] = useState<VisionMode>('live');
  const [packs, setPacks] = useState<VisionPackRecord[]>([]);
  const [activeTierId, setActiveTierId] = useState<VisionTierId | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<OverlayLabel[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [showPacks, setShowPacks] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveTimerRef = useRef<number | null>(null);
  const scanInFlightRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const reloadPacks = useCallback(async () => {
    const all = await listVisionPacks();
    setPacks(all);
    const active = await getActiveVisionPack();
    setActiveTierId(active?.tierId ?? null);
  }, []);

  useEffect(() => {
    void reloadPacks();
    void translationService.warmUp();
  }, [reloadPacks]);

  const stopCamera = useCallback(() => {
    if (liveTimerRef.current) {
      window.clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = useCallback(async () => {
    stopCamera();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('Camera preview unavailable');
      video.srcObject = stream;
      await video.play();
      setCameraOn(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Camera access failed');
    }
  }, [stopCamera]);

  const processCanvas = useCallback(
    async (canvas: HTMLCanvasElement) => {
      if (!activeTierId) {
        setError('Download a vision language pack first.');
        return;
      }

      const tier = getVisionTier(activeTierId);
      if (!tierSupportsMode(activeTierId, mode)) {
        setError(`${tier.label} tier does not support ${mode} mode. Download the Live tier.`);
        return;
      }

      setScanning(true);
      setError(null);

      try {
        await visionService.ensureTierReady(activeTierId, isOnline);
        const imageData = preprocessCanvas(canvas);
        const viewport = viewportRef.current;
        const displayWidth = viewport?.clientWidth ?? canvas.width;
        const displayHeight = viewport?.clientHeight ?? canvas.height;

        const overlays = await visionService.processImageToOverlays(
          imageData,
          activeTierId,
          tier.ocrPsm,
          displayWidth,
          displayHeight,
          isOnline,
        );

        setLabels(overlays);
        setAnnouncement(`${overlays.length} translation overlays updated`);

        const combinedSource = overlays.map((o) => o.source).join('\n');
        const combinedTranslation = overlays.map((o) => o.translation).join('\n');
        if (combinedSource && combinedTranslation) {
          await addTranslationHistory({
            source: combinedSource,
            translation: combinedTranslation,
            modelId: `${TRANSLATION_MODEL_JA_EN}+tesseract`,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Vision processing failed');
      } finally {
        setScanning(false);
        scanInFlightRef.current = false;
      }
    },
    [activeTierId, isOnline, mode],
  );

  const scanCurrentFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !cameraOn || scanInFlightRef.current) return;
    scanInFlightRef.current = true;
    const canvas = captureVideoFrame(video);
    await processCanvas(canvas);
  }, [cameraOn, processCanvas]);

  useEffect(() => {
    if (mode !== 'live' || !cameraOn || !activeTierId) return;

    const tier = getVisionTier(activeTierId);
    const interval = Math.max(VISION_LIVE_MIN_INTERVAL_MS, tier.liveScanIntervalMs);

    liveTimerRef.current = window.setInterval(() => {
      void scanCurrentFrame();
    }, interval);

    void scanCurrentFrame();

    return () => {
      if (liveTimerRef.current) {
        window.clearInterval(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    };
  }, [mode, cameraOn, activeTierId, scanCurrentFrame]);

  const handlePhotoCapture = async () => {
    const video = videoRef.current;
    if (!video || !cameraOn) {
      await startCamera();
      return;
    }
    await scanCurrentFrame();
  };

  const handleFile = async (file: File) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    await processCanvas(canvas);
  };

  const downloadTier = async (tierId: VisionTierId) => {
    if (!isOnline) {
      setError('Connect to the internet to download language packs.');
      return;
    }
    if (!window.confirm('Language packs are large. Wi‑Fi is recommended. Continue?')) return;

    setBusy(true);
    setError(null);
    try {
      await visionService.downloadTier(tierId, isOnline, (pack) => {
        setPacks((prev) => prev.map((p) => (p.tierId === pack.tierId ? pack : p)));
      });
      await reloadPacks();
      setActiveTierId(tierId);
      setAnnouncement(`${getVisionTier(tierId).label} pack ready`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
      await reloadPacks();
    } finally {
      setBusy(false);
    }
  };

  const deleteTier = async (tierId: VisionTierId) => {
    if (!window.confirm('Delete this vision language pack?')) return;
    setBusy(true);
    try {
      await visionService.deleteTier(tierId);
      await reloadPacks();
      if (activeTierId === tierId) {
        setActiveTierId(null);
        setLabels([]);
      }
    } finally {
      setBusy(false);
    }
  };

  const activePackReady = activeTierId
    ? packs.find((p) => p.tierId === activeTierId)?.status === 'ready'
    : false;

  return (
    <section className="page see-page" aria-labelledby="see-heading">
      <header className="page__header">
        <h1 id="see-heading">See</h1>
        <p className="page__subtitle">Photo or live camera Japanese → English overlay</p>
      </header>

      <div className="see-mode-switch segmented" role="tablist" aria-label="Vision mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'photo'}
          className={`segmented__item${mode === 'photo' ? ' segmented__item--active' : ''}`}
          onClick={() => setMode('photo')}
        >
          Photo
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'live'}
          className={`segmented__item${mode === 'live' ? ' segmented__item--active' : ''}`}
          onClick={() => setMode('live')}
        >
          Live
        </button>
      </div>

      <div className="action-row">
        <button type="button" className="button" onClick={() => void startCamera()} disabled={cameraOn}>
          {cameraOn ? 'Camera on' : 'Start camera'}
        </button>
        {mode === 'photo' ? (
          <>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void handlePhotoCapture()}
              disabled={!cameraOn || !activePackReady}
            >
              Capture & translate
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={!activePackReady}
            >
              Choose photo
            </button>
          </>
        ) : null}
        <button type="button" className="button button--secondary" onClick={() => setShowPacks((v) => !v)}>
          Language packs
        </button>
        {cameraOn ? (
          <button type="button" className="button button--secondary" onClick={stopCamera}>
            Stop camera
          </button>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      {!activePackReady ? (
        <p className="notice" role="status">
          Download a vision language pack to enable photo and live translation overlays.
        </p>
      ) : null}

      {error ? <p className="notice notice--warn" role="alert">{error}</p> : null}

      <div ref={viewportRef} className="see-viewport-wrap">
        <CameraViewport videoRef={videoRef} mirror={false}>
          <TranslationOverlay labels={labels} scanning={scanning} />
        </CameraViewport>
      </div>

      {showPacks ? (
        <Suspense fallback={<p className="loading">Loading pack controls…</p>}>
          <VisionPackPanel
            packs={packs}
            activeTierId={activeTierId}
            isOnline={isOnline}
            busy={busy}
            onSelectTier={setActiveTierId}
            onDownload={(tierId) => void downloadTier(tierId)}
            onDelete={(tierId) => void deleteTier(tierId)}
            onRefresh={() => void reloadPacks()}
          />
        </Suspense>
      ) : null}

      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </section>
  );
}
