import { describe, expect, it } from 'vitest';
import {
  allComponentsReady,
  derivePackStatus,
  isVisionPackOperational,
  normalizeVisionPack,
  type VisionPackRecord,
} from './visionPackStore';

function sampleLivePack(overrides: Partial<VisionPackRecord> = {}): VisionPackRecord {
  return {
    packId: 'vision-live-v1',
    tierId: 'live',
    label: 'Live',
    status: 'ready',
    version: 1,
    components: [
      { id: 'translation-ja-en', label: 'Translation', status: 'ready', progress: 100 },
      { id: 'ocr-jpn-vert', label: 'Vertical OCR', status: 'ready', progress: 100 },
    ],
    ...overrides,
  };
}

describe('vision pack normalization', () => {
  it('removes stale components from older live tier schema', () => {
    const stale: VisionPackRecord = sampleLivePack({
      components: [
        { id: 'translation-ja-en', label: 'Translation', status: 'ready', progress: 100 },
        { id: 'ocr-jpn-fast', label: 'Fast OCR', status: 'pending', progress: 0 },
        { id: 'ocr-jpn-vert', label: 'Vertical OCR', status: 'ready', progress: 100 },
      ],
    });

    const normalized = normalizeVisionPack(stale);
    expect(normalized.components.map((c) => c.id)).toEqual(['translation-ja-en', 'ocr-jpn-vert']);
    expect(isVisionPackOperational(normalized)).toBe(true);
  });

  it('marks pack not ready when required component is pending', () => {
    const pack = sampleLivePack({
      components: [
        { id: 'translation-ja-en', label: 'Translation', status: 'ready', progress: 100 },
        { id: 'ocr-jpn-vert', label: 'Vertical OCR', status: 'pending', progress: 0 },
      ],
    });
    expect(allComponentsReady(pack)).toBe(false);
    expect(derivePackStatus(normalizeVisionPack(pack).components)).toBe('not_downloaded');
  });

  it('treats normalized ready pack as operational', () => {
    expect(isVisionPackOperational(sampleLivePack())).toBe(true);
  });
});
