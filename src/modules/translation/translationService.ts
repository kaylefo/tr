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

export class TranslationService {
  private worker: Worker | null = null;
  private requestCounter = 0;
  private latestRequestId = 0;
  private initPromise: Promise<OfflinePackRecord> | null = null;
  private workerReady = false;

  private resolveTranslate: ((value: string) => void) | null = null;
  private rejectTranslate: ((code: TranslationErrorCode) => void) | null = null;

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
      case WORKER_MESSAGE.DOWNLOAD_PROGRESS:
      case WORKER_MESSAGE.PARTIAL: {
        const pack = await this.persistProgress(message.payload);
        this.progressEvents.emit({ payload: message.payload, pack });
        break;
      }
      case WORKER_MESSAGE.READY: {
        this.workerReady = true;
        const pack = await this.markPackReady(message.payload);
        this.readyEvents.emit({ payload: message.payload, pack });
        break;
      }
      case WORKER_MESSAGE.RESULT:
        if (message.payload.requestId >= this.latestRequestId) {
          this.resolveTranslate?.(message.payload.translation);
        }
        break;
      case WORKER_MESSAGE.ERROR: {
        const code = message.payload.code as TranslationErrorCode;
        if (
          message.payload.requestId === undefined ||
          message.payload.requestId >= this.latestRequestId
        ) {
          this.rejectTranslate?.(code);
          if (!message.payload.requestId) {
            const pack = await this.markPackFailed(code);
            this.errorEvents.emit({
              message: normalizeTranslationError(code),
              code,
              pack,
            });
          }
        }
        break;
      }
      default:
        break;
    }
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

  async downloadAndInitialize(isOnline: boolean): Promise<OfflinePackRecord> {
    if (!isOnline) {
      throw new Error(normalizeTranslationError('OFFLINE_NO_PACK'));
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.runDownloadWithRetry(isOnline).finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  private async runDownloadWithRetry(_isOnline: boolean): Promise<OfflinePackRecord> {
    await this.requestPersistentStorage();

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= PACK_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
      const pack = await getJaEnPack();
      await saveOfflinePack({
        ...pack,
        status: 'downloading',
        errorMessage: undefined,
        downloadedBytes: undefined,
        totalBytes: undefined,
      });

      try {
        await withTimeout(
          this.waitForWorkerInit(attempt > 1),
          TRANSLATION_DOWNLOAD_TIMEOUT_MS,
          normalizeTranslationError('DOWNLOAD_INTERRUPTED'),
        );
        return getJaEnPack();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Download failed');
        this.workerReady = false;
        if (attempt < PACK_DOWNLOAD_MAX_ATTEMPTS) {
          await this.resetWorker();
          await sleep(PACK_DOWNLOAD_RETRY_DELAY_MS * attempt);
        }
      }
    }

    const code: TranslationErrorCode = 'INIT_FAILED';
    await this.markPackFailed(code);
    throw lastError ?? new Error(normalizeTranslationError(code));
  }

  private waitForWorkerInit(force: boolean): Promise<WorkerReadyPayload> {
    return new Promise((resolve, reject) => {
      const unsubReady = this.subscribeReady((payload) => {
        cleanup();
        resolve(payload);
      });
      const unsubError = this.subscribeError((message) => {
        cleanup();
        reject(new Error(message));
      });

      const cleanup = () => {
        unsubReady();
        unsubError();
      };

      void (async () => {
        const pack = await getJaEnPack();
        if (!force && pack.status === 'ready' && this.workerReady) {
          cleanup();
          resolve({
            modelId: pack.modelId,
            executionMode: pack.executionMode ?? 'wasm',
            validatedAt: pack.lastValidatedAt ?? Date.now(),
          });
          return;
        }

        this.post({
          type: WORKER_MESSAGE.INIT,
          payload: { modelId: TRANSLATION_MODEL_JA_EN, preferWebGpu: false },
        });
      })();
    });
  }

  private async resetWorker(): Promise<void> {
    if (this.worker) {
      this.post({ type: WORKER_MESSAGE.DISPOSE });
      this.worker.terminate();
      this.worker = null;
    }
    this.workerReady = false;
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
    const next: OfflinePackRecord = {
      ...pack,
      status: 'failed',
      errorMessage: normalizeTranslationError(code),
    };
    await saveOfflinePack(next);
    return next;
  }

  async ensureReady(isOnline = true): Promise<void> {
    const pack = await getJaEnPack();
    if (pack.status !== 'ready') {
      if (!isOnline) {
        throw new Error(normalizeTranslationError('OFFLINE_NO_PACK'));
      }
      throw new Error(normalizeTranslationError('MODEL_NOT_DOWNLOADED'));
    }

    if (!this.workerReady) {
      await this.downloadAndInitialize(isOnline);
    }
  }

  async translate(text: string, isOnline: boolean): Promise<string> {
    await this.ensureReady(isOnline);

    const requestId = ++this.requestCounter;
    this.latestRequestId = requestId;

    return new Promise<string>((resolve, reject) => {
      this.resolveTranslate = resolve;
      this.rejectTranslate = (code) => reject(new Error(normalizeTranslationError(code)));
      this.post({
        type: WORKER_MESSAGE.TRANSLATE,
        payload: { requestId, text },
      });
    });
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
    await this.resetWorker();
    this.initPromise = null;

    if ('caches' in window) {
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
