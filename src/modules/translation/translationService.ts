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

export interface TranslationListeners {
  onProgress?: ProgressListener;
  onReady?: ReadyListener;
  onError?: ErrorListener;
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

  private readonly progressListeners = new Set<ProgressListener>();
  private readonly readyListeners = new Set<ReadyListener>();
  private readonly errorListeners = new Set<ErrorListener>();

  /** In-flight translate requests keyed by request id. */
  private readonly pending = new Map<
    number,
    { resolve: (value: string) => void; reject: (error: TranslationError) => void }
  >();

  /** Idempotent worker initialization; shared across concurrent callers. */
  private initPromise: Promise<WorkerReadyPayload> | null = null;
  private initResolve: ((payload: WorkerReadyPayload) => void) | null = null;
  private initReject: ((error: TranslationError) => void) | null = null;

  /** Small LRU cache so re-translating identical text is instant. */
  private readonly resultCache = new Map<string, string>();

  /**
   * Subscribe to worker lifecycle events. Returns an unsubscribe function.
   * Multiple views (Translate page, See page, download panel) can listen
   * simultaneously without clobbering each other.
   */
  subscribe(listeners: TranslationListeners): () => void {
    if (listeners.onProgress) this.progressListeners.add(listeners.onProgress);
    if (listeners.onReady) this.readyListeners.add(listeners.onReady);
    if (listeners.onError) this.errorListeners.add(listeners.onError);
    return () => {
      if (listeners.onProgress) this.progressListeners.delete(listeners.onProgress);
      if (listeners.onReady) this.readyListeners.delete(listeners.onReady);
      if (listeners.onError) this.errorListeners.delete(listeners.onError);
    };
  }

  private emitProgress(payload: WorkerProgressPayload): void {
    this.progressListeners.forEach((l) => l(payload));
  }

  private emitReady(payload: WorkerReadyPayload): void {
    this.readyListeners.forEach((l) => l(payload));
  }

  private emitError(code: TranslationErrorCode): void {
    const message = normalizeTranslationError(code);
    this.errorListeners.forEach((l) => l(message, code));
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
        this.failInit('INIT_FAILED');
        this.emitError('INIT_FAILED');
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
        this.emitProgress(message.payload);
        break;
      case WORKER_MESSAGE.READY:
        this.initResolve?.(message.payload);
        this.initResolve = null;
        this.initReject = null;
        void this.markPackReady(message.payload);
        this.emitReady(message.payload);
        break;
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
          // Initialization / global failure.
          this.failInit(code);
          void this.markPackFailed(code);
          this.emitError(code);
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

  async requestPersistentStorage(): Promise<boolean> {
    if (!navigator.storage?.persist) return false;
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }

  /**
   * Ensure the worker pipeline is initialized (loading from cache when possible,
   * so this works offline once the pack has been downloaded). Idempotent: the
   * same promise is reused while initialization is in flight.
   */
  private ensureReady(preferWebGpu = true): Promise<WorkerReadyPayload> {
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

  /**
   * Proactively initialize the model when a downloaded pack exists, so the first
   * translation after opening the app is instant. Safe to call repeatedly.
   */
  async warmUp(): Promise<void> {
    const pack = await getJaEnPack();
    if (pack.status !== 'ready') return;
    try {
      await this.ensureReady(true);
    } catch {
      /* surfaced via listeners / pack state */
    }
  }

  async downloadAndInitialize(isOnline: boolean): Promise<OfflinePackRecord> {
    if (!isOnline) {
      throw new TranslationError('OFFLINE_NO_PACK');
    }

    await this.requestPersistentStorage();

    const pack = await getJaEnPack();
    await saveOfflinePack({ ...pack, status: 'downloading', errorMessage: undefined });

    // Force a fresh init pass so download progress is reported even if a stale
    // init promise is lingering.
    this.initPromise = null;
    await this.ensureReady(true);
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
    // Only downgrade the stored status if we were mid-setup; a transient
    // inference error should not wipe a ready pack.
    if (pack.status === 'ready' && code === 'INFERENCE_FAILED') return;
    await saveOfflinePack({
      ...pack,
      status: 'failed',
      errorMessage: normalizeTranslationError(code),
    });
  }

  async translate(text: string, isOnline: boolean): Promise<string> {
    if (!text.trim()) return '';

    const cached = this.resultCache.get(text);
    if (cached !== undefined) {
      // Refresh LRU recency.
      this.resultCache.delete(text);
      this.resultCache.set(text, cached);
      return cached;
    }

    const pack = await getJaEnPack();
    if (pack.status !== 'ready') {
      throw new TranslationError(isOnline ? 'MODEL_NOT_DOWNLOADED' : 'OFFLINE_NO_PACK');
    }

    await this.ensureReady(true);

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
    this.post({ type: WORKER_MESSAGE.DISPOSE });
    this.worker?.terminate();
    this.worker = null;
    this.initPromise = null;
    this.initResolve = null;
    this.initReject = null;
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
