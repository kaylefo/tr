import { TRANSLATION_MODEL_JA_EN } from '../../config/app';
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

type ProgressListener = (payload: WorkerProgressPayload) => void;
type ReadyListener = (payload: WorkerReadyPayload) => void;
type ErrorListener = (message: string, code?: TranslationErrorCode) => void;

export class TranslationService {
  private worker: Worker | null = null;
  private requestCounter = 0;
  private latestRequestId = 0;
  private onProgress: ProgressListener | null = null;
  private onReady: ReadyListener | null = null;
  private onError: ErrorListener | null = null;
  private initPromise: Promise<void> | null = null;

  setListeners(listeners: {
    onProgress?: ProgressListener;
    onReady?: ReadyListener;
    onError?: ErrorListener;
  }): void {
    this.onProgress = listeners.onProgress ?? null;
    this.onReady = listeners.onReady ?? null;
    this.onError = listeners.onError ?? null;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../../workers/translation.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.addEventListener('message', (event: MessageEvent<WorkerOutbound>) => {
        this.handleWorkerMessage(event.data);
      });
      this.worker.addEventListener('error', () => {
        this.onError?.(normalizeTranslationError('INIT_FAILED'), 'INIT_FAILED');
      });
    }
    return this.worker;
  }

  private post(message: WorkerInbound): void {
    this.ensureWorker().postMessage(message);
  }

  private handleWorkerMessage(message: WorkerOutbound): void {
    switch (message.type) {
      case WORKER_MESSAGE.DOWNLOAD_PROGRESS:
      case WORKER_MESSAGE.PARTIAL:
        this.onProgress?.(message.payload);
        break;
      case WORKER_MESSAGE.READY:
        void this.markPackReady(message.payload);
        this.onReady?.(message.payload);
        break;
      case WORKER_MESSAGE.RESULT:
        if (message.payload.requestId >= this.latestRequestId) {
          this.resolveTranslate?.(message.payload.translation);
        }
        break;
      case WORKER_MESSAGE.ERROR:
        if (
          message.payload.requestId === undefined ||
          message.payload.requestId >= this.latestRequestId
        ) {
          const code = message.payload.code as TranslationErrorCode;
          this.rejectTranslate?.(code);
          if (!message.payload.requestId) {
            void this.markPackFailed(code);
            this.onError?.(normalizeTranslationError(code), code);
          }
        }
        break;
      default:
        break;
    }
  }

  private resolveTranslate: ((value: string) => void) | null = null;
  private rejectTranslate: ((code: TranslationErrorCode) => void) | null = null;

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

    await this.requestPersistentStorage();

    const pack = await getJaEnPack();
    const updating: OfflinePackRecord = {
      ...pack,
      status: 'downloading',
      errorMessage: undefined,
    };
    await saveOfflinePack(updating);

    this.initPromise = new Promise<void>((resolve, reject) => {
      const readyHandler = (payload: WorkerReadyPayload) => {
        this.onReady = previousReady;
        resolve();
        previousReady?.(payload);
      };
      const previousReady = this.onReady;
      this.onReady = readyHandler;

      const errorHandler = (msg: string, code?: TranslationErrorCode) => {
        this.onError = previousError;
        reject(new Error(msg));
        previousError?.(msg, code);
      };
      const previousError = this.onError;
      this.onError = errorHandler;

      this.post({
        type: WORKER_MESSAGE.INIT,
        payload: { modelId: TRANSLATION_MODEL_JA_EN, preferWebGpu: true },
      });
    });

    await this.initPromise;
    return getJaEnPack();
  }

  private async markPackReady(payload: WorkerReadyPayload): Promise<void> {
    const pack = await getJaEnPack();
    await saveOfflinePack({
      ...pack,
      status: 'ready',
      modelId: payload.modelId,
      executionMode: payload.executionMode,
      lastValidatedAt: payload.validatedAt,
      errorMessage: undefined,
    });
  }

  private async markPackFailed(code: TranslationErrorCode): Promise<void> {
    const pack = await getJaEnPack();
    await saveOfflinePack({
      ...pack,
      status: 'failed',
      errorMessage: normalizeTranslationError(code),
    });
  }

  async healthCheck(): Promise<boolean> {
    const pack = await getJaEnPack();
    if (pack.status !== 'ready') return false;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 15000);
      const previous = this.onReady;
      this.onReady = (payload) => {
        clearTimeout(timeout);
        this.onReady = previous;
        resolve(!!payload.validatedAt);
        previous?.(payload);
      };
      this.post({ type: WORKER_MESSAGE.HEALTH });
    });
  }

  async translate(text: string, isOnline: boolean): Promise<string> {
    const pack = await getJaEnPack();
    if (pack.status !== 'ready') {
      if (!isOnline) {
        throw new Error(normalizeTranslationError('OFFLINE_NO_PACK'));
      }
      throw new Error(normalizeTranslationError('MODEL_NOT_DOWNLOADED'));
    }

    const healthy = await this.healthCheck();
    if (!healthy) {
      await saveOfflinePack({
        ...pack,
        status: 'failed',
        errorMessage: normalizeTranslationError('CACHE_REMOVED'),
      });
      throw new Error(normalizeTranslationError('CACHE_REMOVED'));
    }

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
    this.post({ type: WORKER_MESSAGE.DISPOSE });
    this.worker?.terminate();
    this.worker = null;
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
