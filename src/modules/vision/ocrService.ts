import { createWorker, PSM } from 'tesseract.js';
import {
  OCR_DOWNLOAD_TIMEOUT_MS,
  OCR_WORKER_INIT_TIMEOUT_MS,
  OCR_WORKER_RUNTIME_INIT_TIMEOUT_MS,
  PACK_DOWNLOAD_MAX_ATTEMPTS,
  PACK_DOWNLOAD_RETRY_DELAY_MS,
  VISION_OCR_RECOGNIZE_TIMEOUT_MS,
} from '../../config/languagePack';
import type { PackComponentId } from '../../config/vision';
import { COMPONENT_ESTIMATED_MB, COMPONENT_LABELS } from '../../config/vision';
import type {
  OcrLangProfile,
  OcrLineBox,
  OcrProgressPayload,
  OcrResultPayload,
} from './ocrMessages';
import { profileToLangPath } from './ocrMessages';
import { parseTesseractPage } from './ocrParse';
import { toError, toErrorMessage } from './visionErrors';

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function tesseractCdnOptions(cacheMethod?: 'read' | 'write' | 'refresh' | 'none') {
  // Always use absolute same-origin URLs. Relative/BASE_URL paths break inside
  // the Tesseract worker and silently fall back to third-party CDNs.
  const origin =
    typeof self !== 'undefined' && 'location' in self && self.location?.origin
      ? self.location.origin
      : '';
  const basePath = (import.meta.env.BASE_URL ?? '/').replace(/^\.\//, '/');
  const root = `${origin}${basePath.endsWith('/') ? basePath : `${basePath}/`}`;
  return {
    workerPath: `${root}tesseract/worker.min.js`,
    corePath: `${root}tesseract`,
    langPath: `${root}tesseract`,
    gzip: false as const,
    workerBlobURL: false as const,
    cacheMethod,
  };
}

function componentToProfile(componentId: PackComponentId): OcrLangProfile | null {
  switch (componentId) {
    case 'ocr-jpn-fast':
      return 'jpn-fast';
    case 'ocr-jpn-best':
      return 'jpn-best';
    case 'ocr-jpn-vert':
      return 'jpn-vert';
    default:
      return null;
  }
}

function mapLinesFromPage(
  page: Parameters<typeof parseTesseractPage>[0],
  width: number,
  height: number,
): { lines: OcrLineBox[]; fullText: string } {
  const lines = parseTesseractPage(page, width, height);
  const fullText = page.text?.trim() ?? lines.map((l) => l.text).join('\n');
  return { lines, fullText };
}

function normalizePsm(psm: number): PSM {
  const value = String(psm) as PSM;
  return Object.values(PSM).includes(value) ? value : PSM.AUTO;
}

function profileFallbackLangs(profile: OcrLangProfile): string[] {
  if (profile === 'jpn-vert') {
    return ['jpn_vert', 'jpn'];
  }
  return ['jpn'];
}

function profilePsm(profile: OcrLangProfile, requestedPsm: number, mode: 'photo' | 'live' = 'photo'): PSM {
  if (profile === 'jpn-vert') {
    // Live camera: vertical page mode. Photo uploads: auto-segment mixed layouts.
    return mode === 'live' ? normalizePsm(5) : normalizePsm(requestedPsm || 3);
  }
  return normalizePsm(requestedPsm);
}

function formatOcrStatus(status: string, langs: string): string {
  switch (status) {
    case 'loading tesseract core':
      return 'Loading OCR engine…';
    case 'initializing tesseract':
      return 'Initializing OCR…';
    case 'loading language traineddata':
      return `Downloading ${langs} language data…`;
    case 'initializing api':
      return 'Starting OCR…';
    default:
      return status;
  }
}

class OcrService {
  private worker: TesseractWorker | null = null;
  private activeProfile: OcrLangProfile | null = null;
  private initPromise: Promise<void> | null = null;
  private pendingProfile: OcrLangProfile | null = null;

  async downloadComponent(
    componentId: PackComponentId,
    onProgress: (payload: OcrProgressPayload) => void,
  ): Promise<void> {
    const profile = componentToProfile(componentId);
    if (!profile) throw new Error(`Unknown OCR component ${componentId}`);

    const label = COMPONENT_LABELS[componentId];
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= PACK_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
      const stopHeartbeat = this.startHeartbeat(
        onProgress,
        label,
        COMPONENT_ESTIMATED_MB[componentId],
      );

      try {
        onProgress({
          status: attempt > 1 ? `Retrying ${label} (attempt ${attempt})…` : `Starting ${label}…`,
          progress: 2,
        });

        await withTimeout(
          this.loadProfileInternal(profile, onProgress, {
            cacheMethod: attempt === 1 ? 'write' : 'refresh',
          }),
          OCR_DOWNLOAD_TIMEOUT_MS,
          `${label} download timed out after ${Math.round(OCR_DOWNLOAD_TIMEOUT_MS / 60000)} minutes. Check Wi‑Fi and tap Retry.`,
        );

        stopHeartbeat();
        onProgress({ status: `${label} ready`, progress: 100 });
        return;
      } catch (err) {
        stopHeartbeat();
        lastError = err instanceof Error ? err : new Error('OCR download failed');
        await this.dispose();
        if (attempt < PACK_DOWNLOAD_MAX_ATTEMPTS) {
          await sleep(PACK_DOWNLOAD_RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw lastError ?? new Error('OCR download failed');
  }

  async ensureProfile(profile: OcrLangProfile): Promise<void> {
    await this.loadProfileInternal(profile, () => undefined, {
      cacheMethod: 'read',
      initTimeoutMs: OCR_WORKER_RUNTIME_INIT_TIMEOUT_MS,
    });
  }

  private async loadProfileInternal(
    profile: OcrLangProfile,
    onProgress: (payload: OcrProgressPayload) => void,
    options: {
      cacheMethod?: 'read' | 'write' | 'refresh' | 'none';
      initTimeoutMs?: number;
    } = {},
  ): Promise<void> {
    if (this.worker && this.activeProfile === profile) {
      onProgress({ status: 'OCR ready', progress: 100 });
      return;
    }

    if (this.initPromise) {
      await this.initPromise;
      if (this.activeProfile === profile) return;
    }

    this.initPromise = this.loadProfile(profile, onProgress, options).finally(() => {
      this.initPromise = null;
    });

    await this.initPromise;
  }

  private async loadProfile(
    profile: OcrLangProfile,
    onProgress: (payload: OcrProgressPayload) => void,
    options: {
      cacheMethod?: 'read' | 'write' | 'refresh' | 'none';
      initTimeoutMs?: number;
    } = {},
  ): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.activeProfile = null;
    }

    this.pendingProfile = profile;
    const candidates = profileFallbackLangs(profile);
    let lastError: unknown = null;

    for (const langs of candidates) {
      try {
        await this.createWorker(langs, profile, onProgress, options);
        return;
      } catch (err) {
        lastError = err;
        await this.dispose();
      }
    }

    throw toError(lastError, 'OCR initialization failed');
  }

  private async createWorker(
    langs: string,
    profile: OcrLangProfile,
    onProgress: (payload: OcrProgressPayload) => void,
    options: {
      cacheMethod?: 'read' | 'write' | 'refresh' | 'none';
      initTimeoutMs?: number;
    } = {},
  ): Promise<void> {
    const initTimeoutMs = options.initTimeoutMs ?? OCR_WORKER_INIT_TIMEOUT_MS;
    let lastReported = 0;

    onProgress({ status: formatOcrStatus('loading tesseract core', langs), progress: 5 });

    const worker = await withTimeout(
      createWorker(langs, 1, {
          ...tesseractCdnOptions(options.cacheMethod),
          langPath: profileToLangPath(profile),
          logger: (msg) => {
            const progress =
              typeof msg.progress === 'number'
                ? Math.max(0, Math.min(100, Math.round(msg.progress * 100)))
                : undefined;
            const nextProgress = progress ?? lastReported;
            if (progress != null) lastReported = progress;

            const status = msg.status ?? 'downloading';
            onProgress({
              status: formatOcrStatus(status, langs),
              progress: nextProgress > 0 ? nextProgress : undefined,
            });
          },
          errorHandler: (err) => {
            console.error('[OCR]', err);
          },
      }),
      initTimeoutMs,
      'OCR worker initialization timed out',
    );

    this.worker = worker;
    this.activeProfile = profile;
    onProgress({ status: 'OCR ready', progress: 100 });
  }

  async recognize(
    imageData: ImageData,
    psm: number,
    mode: 'photo' | 'live' = 'photo',
  ): Promise<OcrResultPayload> {
    const activeProfile = this.activeProfile ?? this.pendingProfile;
    if (!this.worker || !this.activeProfile) {
      if (!activeProfile) {
        throw new Error('OCR not initialized');
      }
      await this.ensureProfile(activeProfile);
    }

    if (!this.worker || !this.activeProfile) {
      throw new Error('OCR not initialized');
    }

    if (imageData.width <= 0 || imageData.height <= 0) {
      throw new Error('Image has no pixels');
    }

    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.putImageData(imageData, 0, 0);

    const psmValue = profilePsm(this.activeProfile, psm, mode);

    try {
      return await this.recognizeCanvas(canvas, psmValue, { blocks: true, text: true });
    } catch (firstErr) {
      console.warn('[OCR] Block recognition failed:', toErrorMessage(firstErr));

      try {
        return await this.recognizeCanvas(canvas, psmValue, { blocks: false, text: true });
      } catch (secondErr) {
        console.warn('[OCR] Text-only recognition failed, reloading OCR:', toErrorMessage(secondErr));
      }

      const reloadProfile = this.activeProfile ?? this.pendingProfile;
      if (!reloadProfile) {
        throw toError(firstErr, 'OCR failed');
      }
      await this.loadProfile(reloadProfile, () => undefined, { cacheMethod: 'refresh' });

      const reloadPsm = profilePsm(reloadProfile, psm, mode);
      try {
        return await this.recognizeCanvas(canvas, reloadPsm, {
          blocks: true,
          text: true,
        });
      } catch (thirdErr) {
        try {
          return await this.recognizeCanvas(canvas, reloadPsm, {
            blocks: false,
            text: true,
          });
        } catch (fourthErr) {
          throw toError(fourthErr, toErrorMessage(thirdErr, 'OCR failed'));
        }
      }
    }
  }

  private async recognizeCanvas(
    canvas: HTMLCanvasElement,
    psmValue: PSM,
    output: { blocks: boolean; text: boolean },
  ): Promise<OcrResultPayload> {
    if (!this.worker) {
      throw new Error('OCR not initialized');
    }

    await this.worker.setParameters({
      tessedit_pageseg_mode: psmValue,
      preserve_interword_spaces: '1',
    });

    const result = await withTimeout(
      this.worker.recognize(canvas, {}, output),
      VISION_OCR_RECOGNIZE_TIMEOUT_MS,
      'OCR timed out',
    );
    const mapped = mapLinesFromPage(result.data, canvas.width, canvas.height);

    return {
      requestId: 0,
      lines: mapped.lines,
      fullText: mapped.fullText,
    };
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    this.activeProfile = null;
    this.initPromise = null;
  }

  private startHeartbeat(
    onProgress: (payload: OcrProgressPayload) => void,
    label: string,
    estimatedMb: number,
  ): () => void {
    let tick = 8;
    const max = 90;
    const intervalMs = Math.max(1500, Math.min(4000, estimatedMb * 80));

    const timer = window.setInterval(() => {
      tick = Math.min(max, tick + 3);
      onProgress({
        status: `Downloading ${label}…`,
        progress: tick,
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }
}

export const ocrService = new OcrService();
