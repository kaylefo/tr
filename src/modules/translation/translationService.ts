import { TRANSLATION_MODEL_JA_EN } from '../../config/app';
import {
  PACK_DOWNLOAD_MAX_ATTEMPTS,
  PACK_DOWNLOAD_RETRY_DELAY_MS,
  TRANSLATION_DOWNLOAD_TIMEOUT_MS,
} from '../../config/languagePack';
import {
  WORKER_MESSAGE,
  normalizeTranslationError,
  type TranslationErrorCode,
  type WorkerInbound,
  type WorkerOutbound,
  type WorkerProgressPayload,
  type WorkerReadyPayload,
} from './messages';
import { getJaEnPack, saveOfflinePack, type OfflinePackRecord } from '../storage/packStore';
import { normalizeDownloadProgress } from '../languagePack/progress';
import { Subscribable } from '../languagePack/subscribable';

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

const KNOWN_ERROR_CODES = new Set<TranslationErrorCode>([
  'MODEL_NOT_DOWNLOADED',
  'DOWNLOAD_INTERRUPTED',
  'INSUFFICIENT_STORAGE',
  'INIT_FAILED',
  'INPUT_TOO_LONG',
  'CANCELLED',
  'FEATURE_UNAVAILABLE',
  'PACK_MISSING',
  'CACHE_REMOVED',
  'INFERENCE_FAILED',
  'OFFLINE_NO_PACK',
]);

function toErrorCode(code: string | undefined): TranslationErrorCode {
  return code && KNOWN_ERROR_CODES.has(code as TranslationErrorCode)
    ? (code as TranslationErrorCode)
    : 'INFERENCE_FAILED';
}

/** Error carrying a machine-readable translation error code. */
export class TranslationError extends Error {
  readonly code: TranslationErrorCode;
  constructor(code: TranslationErrorCode) {
    super(normalizeTranslationError(code));
    this.code = code;
    this.name = 'TranslationError';
  }
}

const RESULT_CACHE_LIMIT = 200;

export class TranslationService {
  private worker: Worker | null = null;
  private requestCounter = 0;
  private latestRequestId = 0;
  private downloadPromise: Promise<OfflinePackRecord> | null = null;
  private downloadGeneration = 0;

  private readonly pending = new Map<
    number,
    { resolve: (value: string) => void; reject: (error: TranslationError) => void }
  >();

  private initPromise: Promise<WorkerReadyPayload> | null = null;
  private initResolve: ((payload: WorkerReadyPayload) => void) | null = null;
  private initReject: ((error: TranslationError) => void) | null = null;

  private readonly resultCache = new Map<string, string>();

  readonly progressEvents = new Subscribable<{ payload: WorkerProgressPayload; pack: OfflinePackRecord }>();
  readonly readyEvents = new Subscribable<{ payload: WorkerReadyPayload; pack: OfflinePackRecord }>();
  readonly errorEvents = new Subscribable<{ message: string; code: TranslationErrorCode; pack: OfflinePackRecord }>();

  subscribeProgress(listener: (payload: WorkerProgressPayload, pack: OfflinePackRecord) => void): () => void {
    return this.progressEvents.subscribe(({ payload, pack }) => listener(payload, pack));
  }

  subscribeReady(listener: (payload: WorkerReadyPayload, pack: OfflinePackRecord) => void): () => void {
    return this.readyEvents.subscribe(({ payload, pack }) => listener(payload, pack));
  }

  subscribeError(listener: (message: string, pack: OfflinePackRecord) => void): () => void {
    return this.errorEvents.subscribe(({ message, pack }) => listener(message, pack));
  }

  /** @deprecated Prefer subscribeProgress / subscribeReady / subscribeError */
  setListeners(listeners: {
    onProgress?: (payload: WorkerProgressPayload) => void;
    onReady?: (payload: WorkerReadyPayload) => void;
    onError?: (message: string, code?: TranslationErrorCode) => void;
  }): void {
    const unsubs: Array<() => void> = [];
    if (listeners.onProgress) {
      unsubs.push(this.subscribeProgress((payload) => listeners.onProgress?.(payload)));
    }
    if (listeners.onReady) {
      unsubs.push(this.subscribeReady((payload) => listeners.onReady?.(payload)));
    }
    if (listeners.onError) {
      unsubs.push(this.subscribeError((message) => listeners.onError?.(message)));
    }
    void unsubs;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../../workers/translation.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.addEventListener('message', (event: MessageEvent<WorkerOutbound>) => {
        void this.handleWorkerMessage(event.data);
      });
      this.worker.addEventListener('error', () => {
        void this.markPackFailed('INIT_FAILED').then((pack) => {
          this.failInit('INIT_FAILED');
          this.errorEvents.emit({
            message: normalizeTranslationError('INIT_FAILED'),
            code: 'INIT_FAILED',
            pack,
          });
        });
      });
    }
    return this.worker;
  }

  private post(message: WorkerInbound): void {
    this.ensureWorker().postMessage(message);
  }

  private async handleWorkerMessage(message: WorkerOutbound): Promise<void> {
    switch (message.type) {
      case WORKER_MESSAGE.DOWNLOAD_PROGRESS: {
        const pack = await this.persistProgress(message.payload);
        this.progressEvents.emit({ payload: message.payload, pack });
        break;
      }
      case WORKER_MESSAGE.PARTIAL: {
        // Inference progress is not download progress. Persisting it as
        // "downloading" corrupts a ready pack while translating vision lines.
        const pack = await getJaEnPack();
        this.progressEvents.emit({ payload: message.payload, pack });
        break;
      }
      case WORKER_MESSAGE.READY: {
        this.initResolve?.(message.payload);
        this.initResolve = null;
        this.initReject = null;
        const pack = await this.markPackReady(message.payload);
        this.readyEvents.emit({ payload: message.payload, pack });
        break;
      }
      case WORKER_MESSAGE.RESULT: {
        const entry = this.pending.get(message.payload.requestId);
        if (entry) {
          this.pending.delete(message.payload.requestId);
          entry.resolve(message.payload.translation);
        }
        break;
      }
      case WORKER_MESSAGE.ERROR: {
        const code = toErrorCode(message.payload.code);
        const { requestId } = message.payload;
        if (requestId !== undefined && this.pending.has(requestId)) {
          const entry = this.pending.get(requestId)!;
          this.pending.delete(requestId);
          entry.reject(new TranslationError(code));
        } else {
          this.failInit(code);
          const pack = await this.markPackFailed(code);
          this.errorEvents.emit({
            message: normalizeTranslationError(code),
            code,
            pack,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  private failInit(code: TranslationErrorCode): void {
    this.initReject?.(new TranslationError(code));
    this.initResolve = null;
    this.initReject = null;
    this.initPromise = null;
  }

  private async persistProgress(payload: WorkerProgressPayload): Promise<OfflinePackRecord> {
    const normalized = normalizeDownloadProgress(payload);
    const pack = await getJaEnPack();
    const next: OfflinePackRecord = {
      ...pack,
      status: normalized.status === 'preparing' || normalized.status === 'validating' ? 'preparing' : 'downloading',
      downloadedBytes: normalized.loaded ?? pack.downloadedBytes,
      totalBytes: normalized.total ?? pack.totalBytes,
      errorMessage: undefined,
    };
    await saveOfflinePack(next);
    return next;
  }

  async requestPersistentStorage(): Promise<boolean> {
    if (!navigator.storage?.persist) return false;
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }

  private ensureWorkerReady(preferWebGpu = true): Promise<WorkerReadyPayload> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<WorkerReadyPayload>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
      this.post({
        type: WORKER_MESSAGE.INIT,
        payload: { modelId: TRANSLATION_MODEL_JA_EN, preferWebGpu },
      });
    });

    return this.initPromise;
  }

  async warmUp(): Promise<void> {
    const pack = await getJaEnPack();
    if (pack.status !== 'ready') return;
    try {
      await this.ensureWorkerReady(true);
    } catch {
      /* surfaced via listeners / pack state */
    }
  }

  async downloadAndInitialize(isOnline: boolean): Promise<OfflinePackRecord> {
    if (!isOnline) {
      throw new TranslationError('OFFLINE_NO_PACK');
    }

    if (typeof window !== 'undefined' && window.__JP_E2E__?.mockPackDownload) {
      const pack = await getJaEnPack();
      const ready: OfflinePackRecord = {
        ...pack,
        status: 'ready',
        modelId: TRANSLATION_MODEL_JA_EN,
        executionMode: 'wasm',
        lastValidatedAt: Date.now(),
        errorMessage: undefined,
      };
      await saveOfflinePack(ready);
      return ready;
    }

    if (this.downloadPromise) {
      return this.downloadPromise;
    }

    const generation = ++this.downloadGeneration;
    const promise = this.runDownloadWithRetry(isOnline, generation);
    const trackedPromise = promise.finally(() => {
      if (this.downloadPromise === trackedPromise) {
        this.downloadPromise = null;
      }
    });
    this.downloadPromise = trackedPromise;

    return this.downloadPromise;
  }

  private assertCurrentDownload(generation: number): void {
    if (generation !== this.downloadGeneration) {
      throw new TranslationError('CANCELLED');
    }
  }

  private async runDownloadWithRetry(
    _isOnline: boolean,
    generation: number,
  ): Promise<OfflinePackRecord> {
    await this.requestPersistentStorage();

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= PACK_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
      this.assertCurrentDownload(generation);
      const pack = await getJaEnPack();
      await saveOfflinePack({
        ...pack,
        status: 'downloading',
        errorMessage: undefined,
        downloadedBytes: undefined,
        totalBytes: undefined,
      });

      try {
        this.initPromise = null;
        await withTimeout(
          this.ensureWorkerReady(attempt === 1),
          TRANSLATION_DOWNLOAD_TIMEOUT_MS,
          normalizeTranslationError('DOWNLOAD_INTERRUPTED'),
        );
        this.assertCurrentDownload(generation);
        return getJaEnPack();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Download failed');
        await this.resetWorker();
        if (err instanceof TranslationError && err.code === 'CANCELLED') {
          throw err;
        }
        if (attempt < PACK_DOWNLOAD_MAX_ATTEMPTS) {
          await sleep(PACK_DOWNLOAD_RETRY_DELAY_MS * attempt);
        }
      }
    }

    this.assertCurrentDownload(generation);
    const code: TranslationErrorCode = 'INIT_FAILED';
    const pack = await this.markPackFailed(code);
    this.errorEvents.emit({
      message: lastError?.message ?? normalizeTranslationError(code),
      code,
      pack,
    });
    throw lastError ?? new TranslationError(code);
  }

  private async resetWorker(): Promise<void> {
    if (this.worker) {
      this.post({ type: WORKER_MESSAGE.DISPOSE });
      this.worker.terminate();
      this.worker = null;
    }
    this.initPromise = null;
    this.initResolve = null;
    this.initReject = null;
  }

  private async markPackReady(payload: WorkerReadyPayload): Promise<OfflinePackRecord> {
    const pack = await getJaEnPack();
    const next: OfflinePackRecord = {
      ...pack,
      status: 'ready',
      modelId: payload.modelId,
      executionMode: payload.executionMode,
      lastValidatedAt: payload.validatedAt,
      errorMessage: undefined,
    };
    await saveOfflinePack(next);
    return next;
  }

  private async markPackFailed(code: TranslationErrorCode): Promise<OfflinePackRecord> {
    const pack = await getJaEnPack();
    if (pack.status === 'ready' && code === 'INFERENCE_FAILED') {
      return pack;
    }
    const next: OfflinePackRecord = {
      ...pack,
      status: 'failed',
      errorMessage: normalizeTranslationError(code),
    };
    await saveOfflinePack(next);
    return next;
  }

  async ensureReady(isOnline = true): Promise<void> {
    if (typeof window !== 'undefined' && window.__JP_E2E__?.mockTranslate) {
      return;
    }

    const pack = await getJaEnPack();
    if (pack.status !== 'ready') {
      throw new TranslationError(isOnline ? 'MODEL_NOT_DOWNLOADED' : 'OFFLINE_NO_PACK');
    }

    await this.ensureWorkerReady(true);
  }

  async translate(text: string, isOnline: boolean): Promise<string> {
    if (!text.trim()) return '';

    if (typeof window !== 'undefined' && window.__JP_E2E__?.mockTranslate) {
      const mapped = window.__JP_E2E__.translations?.[text];
      return mapped ?? `[en] ${text}`;
    }

    const cached = this.resultCache.get(text);
    if (cached !== undefined) {
      this.resultCache.delete(text);
      this.resultCache.set(text, cached);
      return cached;
    }

    const pack = await getJaEnPack();
    if (pack.status !== 'ready') {
      throw new TranslationError(isOnline ? 'MODEL_NOT_DOWNLOADED' : 'OFFLINE_NO_PACK');
    }

    await this.ensureWorkerReady(true);

    const requestId = ++this.requestCounter;
    this.latestRequestId = requestId;

    const translation = await new Promise<string>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.post({ type: WORKER_MESSAGE.TRANSLATE, payload: { requestId, text } });
    });

    this.cacheResult(text, translation);
    return translation;
  }

  private cacheResult(text: string, translation: string): void {
    if (!translation) return;
    this.resultCache.set(text, translation);
    if (this.resultCache.size > RESULT_CACHE_LIMIT) {
      const oldest = this.resultCache.keys().next().value;
      if (oldest !== undefined) this.resultCache.delete(oldest);
    }
  }

  cancel(): void {
    if (this.latestRequestId > 0) {
      this.post({
        type: WORKER_MESSAGE.CANCEL,
        payload: { requestId: this.latestRequestId },
      });
    }
  }

  async deletePack(): Promise<void> {
    this.downloadGeneration += 1;
    await this.resetWorker();
    this.downloadPromise = null;
    this.resultCache.clear();
    this.pending.forEach((entry) => entry.reject(new TranslationError('CACHE_REMOVED')));
    this.pending.clear();

    if ('caches' in self) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.includes('jp-model') || k.includes('transformers'))
          .map((k) => caches.delete(k)),
      );
    }

    const pack = await getJaEnPack();
    await saveOfflinePack({
      ...pack,
      status: 'not_downloaded',
      lastValidatedAt: undefined,
      executionMode: undefined,
      errorMessage: undefined,
      downloadedBytes: undefined,
      totalBytes: undefined,
    });
  }
}

export const translationService = new TranslationService();
