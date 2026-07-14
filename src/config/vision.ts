import { TRANSLATION_MODEL_JA_EN } from './app';

export type VisionTierId = 'essential' | 'standard' | 'live';

export type VisionMode = 'photo' | 'live';

export type PackComponentId =
  | 'translation-ja-en'
  | 'ocr-jpn-fast'
  | 'ocr-jpn-best'
  | 'ocr-jpn-vert';

export type ComponentStatus =
  | 'pending'
  | 'downloading'
  | 'preparing'
  | 'ready'
  | 'failed';

export interface VisionTierDefinition {
  tierId: VisionTierId;
  packId: string;
  label: string;
  description: string;
  estimatedSizeMb: number;
  minTierForMode: VisionMode;
  components: PackComponentId[];
  liveScanIntervalMs: number;
  ocrPsm: number;
}

export const VISION_OCR_TEST_TEXT = 'こんにちは';

export const VISION_OCR_MIN_CONFIDENCE = 55;

export const VISION_LIVE_MIN_INTERVAL_MS = 450;

export const VISION_PHOTO_MAX_DIMENSION = 1920;

export const VISION_TIERS: VisionTierDefinition[] = [
  {
    tierId: 'essential',
    packId: 'vision-essential-v1',
    label: 'Essential',
    description: 'Photo translation with compact Japanese OCR and on-device English output.',
    estimatedSizeMb: 95,
    minTierForMode: 'photo',
    components: ['translation-ja-en', 'ocr-jpn-fast'],
    liveScanIntervalMs: 900,
    ocrPsm: 6,
  },
  {
    tierId: 'standard',
    packId: 'vision-standard-v1',
    label: 'Standard',
    description: 'Sharper photo OCR for menus, signs, and dense printed text.',
    estimatedSizeMb: 175,
    minTierForMode: 'photo',
    components: ['translation-ja-en', 'ocr-jpn-best'],
    liveScanIntervalMs: 700,
    ocrPsm: 6,
  },
  {
    tierId: 'live',
    packId: 'vision-live-v1',
    label: 'Live',
    description: 'Continuous camera translation with vertical Japanese text support.',
    estimatedSizeMb: 205,
    minTierForMode: 'live',
    components: ['translation-ja-en', 'ocr-jpn-vert'],
    liveScanIntervalMs: 450,
    ocrPsm: 11,
  },
];

export const COMPONENT_LABELS: Record<PackComponentId, string> = {
  'translation-ja-en': `Translation (${TRANSLATION_MODEL_JA_EN})`,
  'ocr-jpn-fast': 'Japanese OCR (fast)',
  'ocr-jpn-best': 'Japanese OCR (best accuracy)',
  'ocr-jpn-vert': 'Vertical Japanese OCR',
};

export const COMPONENT_ESTIMATED_MB: Record<PackComponentId, number> = {
  'translation-ja-en': 80,
  'ocr-jpn-fast': 5,
  'ocr-jpn-best': 14,
  'ocr-jpn-vert': 5,
};

export function getVisionTier(tierId: VisionTierId): VisionTierDefinition {
  const tier = VISION_TIERS.find((t) => t.tierId === tierId);
  if (!tier) throw new Error(`Unknown vision tier: ${tierId}`);
  return tier;
}

export function tierSupportsMode(tierId: VisionTierId, mode: VisionMode): boolean {
  const tier = getVisionTier(tierId);
  if (mode === 'photo') return true;
  return tier.minTierForMode === 'live';
}
