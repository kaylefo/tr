import {
  pipeline,
  env,
  type TranslationPipeline,
} from '@huggingface/transformers';
import {
  TRANSLATION_MODEL_JA_EN,
  TRANSLATION_TEST_MIN_LENGTH,
  TRANSLATION_TEST_SENTENCE,
} from '../config/app';
import {
  countNonBlankSegments,
  reassembleTranslation,
  segmentJapaneseText,
  type TextSegment,
} from '../modules/translation/segmentation';
import { WORKER_MESSAGE } from '../modules/translation/messages';
import type {
  WorkerInbound,
  WorkerOutbound,
  WorkerProgressPayload,
} from '../modules/translation/messages';
import {
  extractTranslationText,
  progressPayload,
} from '../modules/translation/helpers';

env.allowLocalModels = false;
env.useBrowserCache = true;

let translator: TranslationPipeline | null = null;
let executionMode: 'webgpu' | 'wasm' = 'wasm';
let activeModelId = '';
let preferWebGpuPref = true;
let cancelledRequestId: number | null = null;
/**
 * Single in-flight initialization promise. Guarantees the model pipeline is
 * created at most once even when several translate requests race on cold start
 * (e.g. after an app reload where the worker is fresh but the model is cached).
 */
let initInFlight: Promise<TranslationPipeline> | null = null;

function post(message: WorkerOutbound): void {
  self.postMessage(message);
}

function postProgress(payload: WorkerProgressPayload): void {
  post({ type: WORKER_MESSAGE.DOWNLOAD_PROGRESS, payload });
}

async function detectWebGpu(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    if (!nav.gpu) return false;
    const adapter = await nav.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

async function createPipeline(modelId: string, preferWebGpu: boolean): Promise<TranslationPipeline> {
  const canWebGpu = preferWebGpu && (await detectWebGpu());
  const device = canWebGpu ? 'webgpu' : 'wasm';
  executionMode = device;

  postProgress({ status: 'preparing', progress: 0 });

  const pipe = await pipeline('translation', modelId, {
    device,
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
    progress_callback: (progress) => {
      postProgress(progressPayload(progress as Record<string, unknown>));
    },
  });

  return pipe as TranslationPipeline;
}

/**
 * Ensure a translation pipeline exists. When the model files are already in the
 * browser cache (Cache Storage), this resolves fully offline. Concurrent callers
 * share a single initialization promise.
 */
async function ensureTranslator(modelId: string, preferWebGpu: boolean): Promise<TranslationPipeline> {
  if (translator && activeModelId === modelId) return translator;
  if (initInFlight) return initInFlight;

  preferWebGpuPref = preferWebGpu;
  initInFlight = (async () => {
    const pipe = await createPipeline(modelId, preferWebGpu);
    translator = pipe;
    activeModelId = modelId;
    return pipe;
  })();

  try {
    return await initInFlight;
  } finally {
    initInFlight = null;
  }
}

async function validateModel(pipe: TranslationPipeline): Promise<string> {
  const result = await pipe(TRANSLATION_TEST_SENTENCE);
  const text = extractTranslationText(result);
  if (text.length < TRANSLATION_TEST_MIN_LENGTH) {
    throw new Error('Validation translation empty');
  }
  return text;
}

async function handleInit(modelId: string, preferWebGpu: boolean): Promise<void> {
  const alreadyReady = !!translator && activeModelId === modelId;
  const pipe = await ensureTranslator(modelId, preferWebGpu);
  if (!alreadyReady) {
    await validateModel(pipe);
  }

  post({
    type: WORKER_MESSAGE.READY,
    payload: {
      modelId,
      executionMode,
      validatedAt: Date.now(),
    },
  });
}

async function handleTranslate(requestId: number, text: string): Promise<void> {
  // Lazily (re)create the pipeline from cache. After an app reload the worker is
  // fresh but the model may already be cached, so this keeps translation working
  // offline without requiring an explicit re-download.
  if (!translator) {
    try {
      await ensureTranslator(activeModelId || TRANSLATION_MODEL_JA_EN, preferWebGpuPref);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Model unavailable';
      post({
        type: WORKER_MESSAGE.ERROR,
        payload: { requestId, code: 'CACHE_REMOVED', message },
      });
      return;
    }
  }

  const activeTranslator = translator;
  if (!activeTranslator) {
    post({
      type: WORKER_MESSAGE.ERROR,
      payload: {
        requestId,
        code: 'MODEL_NOT_DOWNLOADED',
        message: 'Model not ready',
      },
    });
    return;
  }

  if (!text.trim()) {
    post({
      type: WORKER_MESSAGE.RESULT,
      payload: { requestId, translation: '' },
    });
    return;
  }

  try {
    const segments = segmentJapaneseText(text);
    const nonBlank = segments.filter((s: TextSegment) => !s.isBlank && s.text.trim());
    const translations: string[] = [];

    for (const segment of nonBlank) {
      if (cancelledRequestId === requestId) {
        post({
          type: WORKER_MESSAGE.ERROR,
          payload: { requestId, code: 'CANCELLED', message: 'Cancelled' },
        });
        return;
      }

      post({
        type: WORKER_MESSAGE.PARTIAL,
        payload: { status: 'translating' },
      });

      const result = await activeTranslator(segment.text);
      translations.push(extractTranslationText(result));
    }

    if (cancelledRequestId === requestId) {
      post({
        type: WORKER_MESSAGE.ERROR,
        payload: { requestId, code: 'CANCELLED', message: 'Cancelled' },
      });
      return;
    }

    const output = reassembleTranslation(segments, translations);
    if (countNonBlankSegments(segments) > 0 && !output.trim()) {
      throw new Error('Empty output');
    }

    post({
      type: WORKER_MESSAGE.RESULT,
      payload: { requestId, translation: output },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Translation failed';
    const code = message === 'INPUT_TOO_LONG' ? 'INPUT_TOO_LONG' : 'INFERENCE_FAILED';
    post({
      type: WORKER_MESSAGE.ERROR,
      payload: { requestId, code, message },
    });
  }
}

self.addEventListener('message', async (event: MessageEvent<WorkerInbound>) => {
  const { type, payload } = event.data;

  try {
    switch (type) {
      case WORKER_MESSAGE.INIT:
        await handleInit(payload.modelId, payload.preferWebGpu);
        break;
      case WORKER_MESSAGE.TRANSLATE:
        await handleTranslate(payload.requestId, payload.text);
        break;
      case WORKER_MESSAGE.CANCEL:
        cancelledRequestId = payload.requestId;
        break;
      case WORKER_MESSAGE.DISPOSE:
        translator = null;
        activeModelId = '';
        initInFlight = null;
        break;
      case WORKER_MESSAGE.HEALTH:
        // Report genuine readiness: a live pipeline, or a cached model that can
        // be reloaded without the network.
        try {
          await ensureTranslator(activeModelId || TRANSLATION_MODEL_JA_EN, preferWebGpuPref);
          post({
            type: WORKER_MESSAGE.READY,
            payload: {
              modelId: activeModelId || TRANSLATION_MODEL_JA_EN,
              executionMode,
              validatedAt: Date.now(),
            },
          });
        } catch (err) {
          post({
            type: WORKER_MESSAGE.ERROR,
            payload: {
              code: 'CACHE_REMOVED',
              message: err instanceof Error ? err.message : 'Model unavailable',
            },
          });
        }
        break;
      default:
        break;
    }
  } catch (err) {
    post({
      type: WORKER_MESSAGE.ERROR,
      payload: {
        code: 'INIT_FAILED',
        message: err instanceof Error ? err.message : 'Worker error',
      },
    });
  }
});

export {};
