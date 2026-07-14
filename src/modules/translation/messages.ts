export const WORKER_MESSAGE = {
  INIT: 'initialize',
  DOWNLOAD_PROGRESS: 'download_progress',
  READY: 'ready',
  TRANSLATE: 'translate',
  PARTIAL: 'partial_status',
  RESULT: 'result',
  ERROR: 'error',
  DISPOSE: 'dispose',
  HEALTH: 'health_check',
  CANCEL: 'cancel',
} as const;

export type WorkerMessageType = (typeof WORKER_MESSAGE)[keyof typeof WORKER_MESSAGE];

export interface WorkerInitPayload {
  modelId: string;
  preferWebGpu: boolean;
}

export interface WorkerProgressPayload {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface WorkerTranslatePayload {
  requestId: number;
  text: string;
}

export interface WorkerResultPayload {
  requestId: number;
  translation: string;
}

export interface WorkerErrorPayload {
  requestId?: number;
  code: string;
  message: string;
}

export interface WorkerReadyPayload {
  modelId: string;
  executionMode: 'webgpu' | 'wasm';
  validatedAt: number;
}

export type WorkerInbound =
  | { type: typeof WORKER_MESSAGE.INIT; payload: WorkerInitPayload }
  | { type: typeof WORKER_MESSAGE.TRANSLATE; payload: WorkerTranslatePayload }
  | { type: typeof WORKER_MESSAGE.DISPOSE; payload?: undefined }
  | { type: typeof WORKER_MESSAGE.HEALTH; payload?: undefined }
  | { type: typeof WORKER_MESSAGE.CANCEL; payload: { requestId: number } };

export type WorkerOutbound =
  | { type: typeof WORKER_MESSAGE.DOWNLOAD_PROGRESS; payload: WorkerProgressPayload }
  | { type: typeof WORKER_MESSAGE.READY; payload: WorkerReadyPayload }
  | { type: typeof WORKER_MESSAGE.PARTIAL; payload: WorkerProgressPayload }
  | { type: typeof WORKER_MESSAGE.RESULT; payload: WorkerResultPayload }
  | { type: typeof WORKER_MESSAGE.ERROR; payload: WorkerErrorPayload };

export type TranslationErrorCode =
  | 'MODEL_NOT_DOWNLOADED'
  | 'DOWNLOAD_INTERRUPTED'
  | 'INSUFFICIENT_STORAGE'
  | 'INIT_FAILED'
  | 'INPUT_TOO_LONG'
  | 'CANCELLED'
  | 'FEATURE_UNAVAILABLE'
  | 'PACK_MISSING'
  | 'CACHE_REMOVED'
  | 'INFERENCE_FAILED'
  | 'OFFLINE_NO_PACK';

export function normalizeTranslationError(code: TranslationErrorCode): string {
  const messages: Record<TranslationErrorCode, string> = {
    MODEL_NOT_DOWNLOADED: 'Connect to the internet once to download the translation pack.',
    DOWNLOAD_INTERRUPTED: 'Download interrupted. Tap Retry to continue.',
    INSUFFICIENT_STORAGE: 'The phone may not have enough free browser storage for this model.',
    INIT_FAILED: 'Model initialization failed. Tap Repair Pack.',
    INPUT_TOO_LONG: 'Translation input is too long. Shorten the text and try again.',
    CANCELLED: 'Translation cancelled.',
    FEATURE_UNAVAILABLE: 'Translation is not available in this browser.',
    PACK_MISSING: 'The translation pack appears incomplete. Tap Repair Pack.',
    CACHE_REMOVED: 'The model cache was removed. Download the pack again.',
    INFERENCE_FAILED: 'Translation failed unexpectedly. Try again.',
    OFFLINE_NO_PACK: 'Download the offline translation pack while connected.',
  };
  return messages[code];
}
