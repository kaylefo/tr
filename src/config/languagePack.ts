/** Maximum time to wait for a full translation model download + validation. */
export const TRANSLATION_DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

/** Maximum time to wait for an OCR language data download. */
export const OCR_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** Retry attempts for transient download / init failures. */
export const PACK_DOWNLOAD_MAX_ATTEMPTS = 3;

/** Delay between retry attempts (ms). */
export const PACK_DOWNLOAD_RETRY_DELAY_MS = 1500;

/** Hugging Face CDN mirror used when the primary hub is slow or blocked. */
export const HF_CDN_MIRROR = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@';
