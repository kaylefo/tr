/** Maximum time to wait for a full translation model download + validation. */
export const TRANSLATION_DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

/** Maximum time to wait for an OCR language data download. */
export const OCR_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** Maximum time to wait for a single OCR worker create/init attempt during download. */
export const OCR_WORKER_INIT_TIMEOUT_MS = 45_000;

/** Maximum time to wait when initializing OCR for recognition after data is cached. */
export const OCR_WORKER_RUNTIME_INIT_TIMEOUT_MS = 45_000;

/** Retry attempts for transient download / init failures. */
export const PACK_DOWNLOAD_MAX_ATTEMPTS = 3;

/** Delay between retry attempts (ms). */
export const PACK_DOWNLOAD_RETRY_DELAY_MS = 1500;

/** Maximum time for a single OCR recognize call (live + photo). */
export const VISION_OCR_RECOGNIZE_TIMEOUT_MS = 45_000;

/** Maximum time per unique line sent to the translation model. */
export const VISION_TRANSLATE_LINE_TIMEOUT_MS = 15_000;

/** Maximum time to wait for a camera frame with valid dimensions. */
export const VISION_VIDEO_FRAME_TIMEOUT_MS = 5_000;

/** Hugging Face CDN mirror used when the primary hub is slow or blocked. */
export const HF_CDN_MIRROR = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@';
