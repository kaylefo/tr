/** Single source of truth for the application name. */
export const APP_NAME = 'JAPAN POCKET';

export const APP_SHORT_NAME = 'Japan Pocket';

export const APP_DESCRIPTION =
  'Yen converter and offline Japanese-to-English translator for travel in Japan.';

export const APP_VERSION = '1.0.0';

export const BUILD_ID =
  typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';

export const QUICK_JPY_AMOUNTS = [
  100, 500, 1000, 5000, 10000, 50000, 100000, 1000000,
] as const;

export const FEE_PRESETS = [0, 1, 2, 3, 5] as const;

export const HISTORY_MAX_ITEMS = 50;

export const RATE_STALE_MS = 12 * 60 * 60 * 1000;

export const RATE_DIVERGENCE_THRESHOLD = 0.01;

export const TRANSLATION_DEBOUNCE_MS = 280;

export const TRANSLATION_MAX_CHARS = 8000;

export const TRANSLATION_MODEL_JA_EN = 'Xenova/opus-mt-ja-en';

export const TRANSLATION_TEST_SENTENCE = 'これはいくらですか？';

export const TRANSLATION_TEST_MIN_LENGTH = 2;

export type MainTab = 'convert' | 'translate' | 'history' | 'settings';

export type AppearanceMode = 'system' | 'light' | 'dark';

export type ConversionDirection = 'JPY_TO_USD' | 'USD_TO_JPY';

export type FeePreset = (typeof FEE_PRESETS)[number];
