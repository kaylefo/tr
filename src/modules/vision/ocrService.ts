import { createWorker, PSM } from 'tesseract.js';
import {
  OCR_DOWNLOAD_TIMEOUT_MS,
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
import { profileToLangs } from './ocrMessages';
import { parseTesseractPage } from './ocrParse';

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

const TESSERACT_VERSION = '6.0.1';

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

function tesseractCdnOptions() {
  return {
    workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@v${TESSERACT_VERSION}/dist/worker.min.js`,
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.0',
    gzip: true as const,
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
  const primary = profileToLangs(profile);
  if (profile === 'jpn-vert' && primary.includes('+')) {
    return [primary, 'jpn'];
  }
  return [primary];
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
  private activeLangs: string | null = null;
  private initPromise: Promise<void> | null = null;

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
          this.loadProfileInternal(profile, onProgress),
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
    await this.loadProfileInternal(profile, () => undefined);
  }

  private async loadProfileInternal(
    profile: OcrLangProfile,
    onProgress: (payload: OcrProgressPayload) => void,
  ): Promise<void> {
    if (this.worker && this.activeProfile === profile) {
      onProgress({ status: 'OCR ready', progress: 100 });
      return;
    }

    if (this.initPromise) {
      await this.initPromise;
      if (this.activeProfile === profile) return;
    }

    this.initPromise = this.loadProfile(profile, onProgress).finally(() => {
      this.initPromise = null;
    });

    await this.initPromise;
  }

  private async loadProfile(
    profile: OcrLangProfile,
    onProgress: (payload: OcrProgressPayload) => void,
  ): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.activeProfile = null;
      this.activeLangs = null;
    }

    const candidates = profileFallbackLangs(profile);
    let lastError: Error | null = null;

    for (const langs of candidates) {
      try {
        await this.createWorker(langs, profile, onProgress);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('OCR initialization failed');
        await this.dispose();
      }
    }

    throw lastError ?? new Error('OCR initialization failed');
  }

  private async createWorker(
    langs: string,
    profile: OcrLangProfile,
    onProgress: (payload: OcrProgressPayload) => void,
  ): Promise<void> {
    let lastReported = 0;

    onProgress({ status: formatOcrStatus('loading tesseract core', langs), progress: 5 });

    const worker = await createWorker(langs, 1, {
      ...tesseractCdnOptions(),
      logger: (msg) => {
        const progress =
          typeof msg.progress === 'number'
            ? Math.max(0, Math.min(100, Math.round(msg.progress * 100)))
            : undefined;
        const nextProgress = progress ?? lastReported;
        if (progress != null) lastReported = progress;

        onProgress({
          status: formatOcrStatus(msg.status ?? 'downloading', langs),
          progress: nextProgress > 0 ? nextProgress : undefined,
        });
      },
      errorHandler: (err) => {
        console.error('[OCR]', err);
      },
    });

    this.worker = worker;
    this.activeProfile = profile;
    this.activeLangs = langs;
    onProgress({ status: 'OCR ready', progress: 100 });
  }

  async recognize(imageData: ImageData, psm: number): Promise<OcrResultPayload> {
    if (!this.worker) {
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

    const psmValue = normalizePsm(
      this.activeProfile === 'jpn-vert' && this.activeLangs === 'jpn' ? 5 : psm,
    );

    await this.worker.setParameters({
      tessedit_pageseg_mode: psmValue,
      preserve_interword_spaces: '1',
    });

    const result = await withTimeout(
      this.worker.recognize(canvas, {}, { blocks: true, text: true }),
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
    this.activeLangs = null;
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
